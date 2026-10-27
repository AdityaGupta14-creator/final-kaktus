from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Optional
from queue import Empty, Queue
from threading import RLock, Thread
import subprocess
import tempfile
import os
import json
import shutil
import asyncio
import glob
import re
import serial.tools.list_ports
import serial
import platform
import hashlib
import secrets
import time
from google.auth.transport.requests import Request as GoogleAuthRequest
from google.oauth2 import id_token

app = FastAPI(title="Hardware Gatekeeper API")

DEFAULT_WEB_ORIGINS = {
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:3001",
    "http://127.0.0.1:3001",
    "https://final-kaktus.vercel.app",
    "https://final-kaktus-hello-4da5.vercel.app",
    "https://final-kaktus-git-main-hello-4da5.vercel.app",
    "https://yc-drab.vercel.app",
}
configured_origins = {
    origin.strip().rstrip("/")
    for origin in os.getenv("KAKTUS_WEB_ORIGINS", "").split(",")
    if origin.strip()
}
ALLOWED_WEB_ORIGINS = DEFAULT_WEB_ORIGINS | configured_origins

HARDWARE_PORT = int(os.getenv("KAKTUS_HARDWARE_PORT", "8000"))
ALLOWED_HOSTS = {
    "127.0.0.1",
    "127.0.0.1:8000",
    f"127.0.0.1:{HARDWARE_PORT}",
    "localhost",
    "localhost:8000",
    f"localhost:{HARDWARE_PORT}",
    "[::1]",
    "[::1]:8000",
}

app.add_middleware(
    CORSMiddleware,
    allow_origins=sorted(ALLOWED_WEB_ORIGINS),
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
    allow_private_network=True,
    max_age=600,
)

_verified_browser_tokens = {}
_google_auth_request = GoogleAuthRequest()
_firebase_project_id = (
    os.getenv("FIREBASE_PROJECT_ID")
    or os.getenv("NEXT_PUBLIC_FIREBASE_PROJECT_ID")
    or "otpdemo-291bd"
).strip()


def _bounded_google_auth_request(url, **kwargs):
    kwargs.setdefault("timeout", 3)
    return _google_auth_request(url, **kwargs)


def _is_valid_firebase_bearer(request: Request) -> bool:
    authorization = request.headers.get("authorization", "")
    match = re.fullmatch(r"Bearer\s+(.+)", authorization, flags=re.IGNORECASE)
    if not match:
        return False
    token = match.group(1).strip()
    if len(token) > 4096:
        return False

    now = time.monotonic()
    token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
    expires_at = _verified_browser_tokens.get(token_hash, 0)
    if expires_at > now:
        return True

    try:
        decoded = id_token.verify_firebase_token(
            token,
            _bounded_google_auth_request,
            audience=_firebase_project_id,
        )
        if (
            decoded.get("aud") != _firebase_project_id
            or decoded.get("iss") != f"https://securetoken.google.com/{_firebase_project_id}"
            or not isinstance(decoded.get("sub"), str)
            or not decoded.get("sub")
        ):
            return False
    except Exception:
        return False

    if len(_verified_browser_tokens) > 5000:
        _verified_browser_tokens.clear()
    _verified_browser_tokens[token_hash] = now + 300
    return True


@app.middleware("http")
async def security_guard_middleware(request: Request, call_next):
    # DNS-rebinding protection: restrict Host header to loopback addresses
    raw_host = request.headers.get("host", "").lower().strip().rstrip(".")
    if raw_host and raw_host not in ALLOWED_HOSTS:
        return JSONResponse(
            status_code=403,
            content={"detail": "Forbidden: Request Host header rejected by local bridge DNS-rebinding protection."},
        )

    # Restrict cross-origin requests to trusted Kaktus origins
    origin = request.headers.get("origin")
    if origin and origin not in ALLOWED_WEB_ORIGINS:
        return JSONResponse(
            status_code=403,
            content={"detail": "This local USB service does not accept requests from this website origin."},
        )

    content_length = request.headers.get("content-length")
    if content_length and content_length.isdigit() and int(content_length) > 1_500_000:
        return JSONResponse(status_code=413, content={"detail": "Request body is too large."})

    return await call_next(request)

_bundled_cli = "arduino-cli.exe" if platform.system() == "Windows" else "arduino-cli"
BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
HARDWARE_HOME = os.path.abspath(os.getenv("KAKTUS_HARDWARE_HOME", BACKEND_DIR))
os.makedirs(HARDWARE_HOME, exist_ok=True)
ARDUINO_CLI = os.getenv(
    "ARDUINO_CLI_PATH",
    os.path.join(BACKEND_DIR, "arduino-cli", _bundled_cli),
)
ARDUINO_CONFIG_FILE = os.path.join(HARDWARE_HOME, ".arduino-cli.yaml")
ARDUINO_DATA_DIR = os.path.join(HARDWARE_HOME, ".arduino-data")
ARDUINO_DOWNLOADS_DIR = os.path.join(HARDWARE_HOME, ".arduino-downloads")
ARDUINO_USER_DIR = os.path.join(HARDWARE_HOME, ".arduino-user")
BUILD_TEMP_DIR = os.path.join(HARDWARE_HOME, ".work")

BOARD_CATALOG = {
    "arduino:avr:uno": {"name": "Arduino Uno", "chip": "ATmega328P", "default_baud": 9600},
    "arduino:avr:nano": {"name": "Arduino Nano", "chip": "ATmega328P", "default_baud": 9600},
    "arduino:avr:mega": {"name": "Arduino Mega 2560", "chip": "ATmega2560", "default_baud": 9600},
    "arduino:avr:leonardo": {"name": "Arduino Leonardo", "chip": "ATmega32U4", "default_baud": 9600},
    "arduino:megaavr:nona4809": {"name": "Arduino Nano Every", "chip": "ATmega4809", "default_baud": 9600},
    "esp32:esp32:esp32": {"name": "ESP32 Dev Module", "chip": "ESP32", "default_baud": 115200},
    "esp32:esp32:esp32s2": {"name": "ESP32-S2", "chip": "ESP32-S2", "default_baud": 115200},
    "esp32:esp32:esp32s3": {"name": "ESP32-S3", "chip": "ESP32-S3", "default_baud": 115200},
    "esp32:esp32:esp32c3": {"name": "ESP32-C3", "chip": "ESP32-C3", "default_baud": 115200},
    "rp2040:rp2040:pico": {"name": "Raspberry Pi Pico", "chip": "RP2040", "default_baud": 115200},
    "rp2040:rp2040:rpipicow": {"name": "Raspberry Pi Pico W", "chip": "RP2040", "default_baud": 115200},
    "STMicroelectronics:stm32:GenF1:pnum=BLUEPILL_F103C8,upload_method=serialMethod": {
        "name": "STM32 Blue Pill (F103C8)", "chip": "STM32F103C8T6", "default_baud": 115200,
    },
}

BOARD_CORE_IDS = {
    "arduino:avr": "arduino:avr",
    "arduino:megaavr": "arduino:megaavr",
    "esp32:esp32": "esp32:esp32",
    "rp2040:rp2040": "rp2040:rp2040",
    "STMicroelectronics:stm32": "STMicroelectronics:stm32",
}

BOARD_MANAGER_URLS = {
    "esp32:esp32": "https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json",
    "rp2040:rp2040": "https://github.com/earlephilhower/arduino-pico/releases/download/global/package_rp2040_index.json",
    "STMicroelectronics:stm32": "https://github.com/stm32duino/BoardManagerFiles/raw/main/package_stmicroelectronics_index.json",
}

BOARD_MAP = {
    "arduino:avr:uno": {
        "name": "Arduino Uno",
        "vid_pid": ["2341:0043", "2341:0001"],
    },
    "arduino:avr:nano": {
        "name": "Arduino Nano",
        "vid_pid": [],
    },
    "arduino:avr:mega": {
        "name": "Arduino Mega",
        "vid_pid": ["2341:0042", "2341:0010"],
    },
    "arduino:avr:leonardo": {
        "name": "Arduino Leonardo",
        "vid_pid": ["2341:0036", "2341:8036"],
    },
    "arduino:megaavr:nona4809": {
        "name": "Arduino Nano Every",
        "vid_pid": ["2341:0058"],
    },
    "esp32:esp32:esp32": {
        "name": "ESP32 Dev Module",
        "vid_pid": [],
    },
    "esp32:esp32:esp32s2": {
        "name": "ESP32-S2",
        "vid_pid": [],
    },
    "esp32:esp32:esp32s3": {
        "name": "ESP32-S3",
        "vid_pid": [],
    },
    "esp32:esp32:esp32c3": {
        "name": "ESP32-C3",
        "vid_pid": [],
    },
    "rp2040:rp2040:pico": {
        "name": "Raspberry Pi Pico",
        "vid_pid": [],
    },
    "rp2040:rp2040:rpipicow": {
        "name": "Raspberry Pi Pico W",
        "vid_pid": [],
    },
}

USB_DEVICE_LABELS = {
    "1A86:7523": "CH340 USB-to-serial adapter",
    "1A86:55D4": "CH9102 USB-to-serial adapter",
    "0403:6001": "FTDI USB-to-serial adapter",
    "10C4:EA60": "CP210x USB-to-serial adapter",
    "10C4:EA70": "CP210x USB-to-serial adapter",
    "303A:0002": "Espressif USB Serial/JTAG device — select the exact board",
    "303A:1001": "Espressif USB Serial/JTAG device — select the exact board",
    "2E8A:000A": "RP2040 USB device — select the exact board",
    "2E8A:F00A": "RP2040 USB device — select the exact board",
    "0483:5740": "STMicroelectronics virtual COM port",
}

def _board_core(board: str) -> str:
    if board not in BOARD_CATALOG:
        raise HTTPException(status_code=400, detail=f"Unsupported board target: {board}")
    prefix = ":".join(board.split(":")[:2])
    return BOARD_CORE_IDS[prefix]


def _run_cli(args: List[str], timeout: int = 120):
    for directory in (ARDUINO_DATA_DIR, ARDUINO_DOWNLOADS_DIR, ARDUINO_USER_DIR, BUILD_TEMP_DIR):
        os.makedirs(directory, exist_ok=True)
    if not os.path.exists(ARDUINO_CONFIG_FILE):
        with open(ARDUINO_CONFIG_FILE, "w", encoding="utf-8") as config_file:
            config_file.write(
                "directories:\n"
                f"  data: {json.dumps(ARDUINO_DATA_DIR)}\n"
                f"  downloads: {json.dumps(ARDUINO_DOWNLOADS_DIR)}\n"
                f"  user: {json.dumps(ARDUINO_USER_DIR)}\n"
            )
    result = subprocess.run(
        [ARDUINO_CLI, "--config-file", ARDUINO_CONFIG_FILE, *args],
        capture_output=True,
        text=True,
        timeout=timeout,
    )
    if result.returncode != 0:
        message = (result.stderr or result.stdout or "Arduino CLI command failed.").strip()
        raise RuntimeError(message)
    return result


def _installed_core_ids() -> set:
    result = _run_cli(["core", "list", "--format", "json"], timeout=20)
    payload = json.loads(result.stdout) if result.stdout.strip() else []
    rows = payload.get("platforms", []) if isinstance(payload, dict) else payload
    return {row.get("id") for row in rows if isinstance(row, dict) and row.get("id")}


def _ensure_board_core(board: str):
    core_id = _board_core(board)
    if core_id in _installed_core_ids():
        return

    index_url = BOARD_MANAGER_URLS.get(core_id)
    extra_args = ["--additional-urls", index_url] if index_url else []
    _run_cli(["core", "update-index", *extra_args], timeout=120)
    _run_cli(["core", "install", core_id, *extra_args], timeout=600)


class InstallCoreRequest(BaseModel):
    board: str = "arduino:avr:uno"


class SerialWriteRequest(BaseModel):
    port: str = Field(max_length=120)
    text: str = Field(max_length=4096)

class ComponentInstance(BaseModel):
    id: str
    type: str
    x: float
    y: float

class Wire(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    from_pin: str = Field(alias="from")
    to_pin: str = Field(alias="to")

class Circuit(BaseModel):
    components: List[ComponentInstance]
    wiring: List[Wire]

def _split_endpoint(value: str):
    if not isinstance(value, str) or ":" not in value:
        return (None, None)
    component_id, pin = value.split(":", 1)
    return component_id.strip(), pin.strip()

def _is_ground(pin: str) -> bool:
    return pin.lower().startswith("gnd") or pin.lower() == "ground"

def _is_power(pin: str) -> bool:
    return pin.lower() in frozenset({"3.3v", "24v", "5v", "12v", "vcc", "3v3", "vbatt", "battery+", "vin"})

def _pin_kind(component_type: str, pin: str):
    component = COMPONENTS_DB.get(component_type.lower(), {})
    return component.get("pins", {}).get(pin)

class CompileRequest(BaseModel):
    code: str = Field(max_length=1_000_000)
    board: str = Field(max_length=120)

class FlashRequest(BaseModel):
    code: str = Field(max_length=1_000_000)
    board: str = Field(max_length=120)
    port: str = Field(max_length=120)
    vid_pid: Optional[str] = Field(default=None, max_length=20)
    serial_number: Optional[str] = Field(default=None, max_length=120)

class InstallLibRequest(BaseModel):
    library: str = Field(min_length=1, max_length=100)

COMPONENTS_DB = {
    "esp32": {
        "type": "mcu",
        "logic_voltage": 3.3,
        "pins": {
            "5V": "power_out",
            "3V3": "power_out",
            "GND": "gnd",
            "D2": "digital_io",
            "D4": "digital_io",
        },
    },
    "led": {
        "type": "output",
        "logic_voltage": 3.3,
        "pins": {
            "A": "power_in",
            "C": "gnd",
        },
    },
    "resistor": {
        "type": "passive",
        "pins": {
            "1": "passive",
            "2": "passive",
        },
    },
    "dht22": {
        "type": "sensor",
        "logic_voltage": 3.3,
        "pins": {
            "VCC": "power_in",
            "GND": "gnd",
            "DATA": "digital_io",
        },
    },
}

@app.get("/")
def read_root():
    return {
        "message": "Gatekeeper API is running",
        "flash_enabled": True,
        "service": "kaktus-hardware-bridge",
        "version": "1.0.0",
    }

@app.post("/validate-circuit")
async def validate_circuit(circuit: Circuit):
    if len(circuit.components) > 512 or len(circuit.wiring) > 2048:
        return {"status": "error", "errors": ["Circuit exceeds the validation limits."]}
    
    instances = {comp.id: comp.type for comp in circuit.components}
    errors = []
    warnings = []
    
    if len(instances) != len(circuit.components):
        errors.append("Component ids must be unique.")
    
    for wire in circuit.wiring:
        from_comp_id, from_pin = _split_endpoint(wire.from_pin)
        to_comp_id, to_pin = _split_endpoint(wire.to_pin)
        
        if not from_comp_id or not from_pin or not to_comp_id or not to_pin:
            errors.append(f"Invalid wire format: {wire.from_pin} -> {wire.to_pin}. Must be 'comp_id:pin'")
            continue
        
        if from_comp_id not in instances:
            errors.append(f"Component '{from_comp_id}' not found in BOM.")
            continue
        
        if to_comp_id not in instances:
            errors.append(f"Component '{to_comp_id}' not found in BOM.")
            continue
        
        if from_comp_id == to_comp_id and from_pin.lower() == to_pin.lower():
            errors.append(f"Invalid self-connection: {wire.from_pin} -> {wire.to_pin}")
        
        if (_is_power(from_pin) and _is_ground(to_pin)) or (_is_ground(from_pin) and _is_power(to_pin)):
            errors.append(f"SHORT CIRCUIT DETECTED: Connected {wire.from_pin} directly to {wire.to_pin}")
        
        from_kind = _pin_kind(instances[from_comp_id], from_pin)
        to_kind = _pin_kind(instances[to_comp_id], to_pin)
        
        if from_kind == "power_out" and to_kind == "power_out":
            errors.append(f"POWER CONTENTION: Two power outputs are directly connected: {wire.from_pin} -> {wire.to_pin}")
        
        if from_kind is None or to_kind is None:
            warnings.append(f"Pin model not found for {wire.from_pin} or {wire.to_pin}; verify the custom component contract.")
            
    if errors:
        return {"status": "error", "errors": errors, "warnings": warnings}
    return {"status": "success", "message": "Circuit passed Gatekeeper validation!", "warnings": warnings}

@app.get("/flash/status")
async def flash_status():
    if not os.path.exists(ARDUINO_CLI):
        return {
            "ready": False,
            "error": f"Arduino CLI was not found at {ARDUINO_CLI}. Set ARDUINO_CLI_PATH to an installed Arduino CLI executable.",
        }
    try:
        result = await asyncio.to_thread(_run_cli, ["version"], 10)
        version = result.stdout.strip()
    except Exception as e:
        return {"ready": False, "error": str(e)}
    try:
        cores = await asyncio.to_thread(_installed_core_ids)
    except Exception:
        cores = []
    return {
        "ready": True,
        "version": version,
        "cores": sorted(cores) if isinstance(cores, set) else cores,
        "boards": [
            {"fqbn": fqbn, **details}
            for fqbn, details in BOARD_CATALOG.items()
        ],
    }

@app.get("/flash/boards")
async def detect_boards():
    ports = []
    for port_info in serial.tools.list_ports.comports():
        vid_pid = f"{port_info.vid:04X}:{port_info.pid:04X}" if port_info.vid and port_info.pid else None
        identity_text = " ".join(
            str(value or "")
            for value in (port_info.description, port_info.product, port_info.manufacturer)
        ).lower()
        if not vid_pid and "bluetooth" in identity_text:
            continue
        detected_board = None
        detected_fqbn = None
        usb_label = USB_DEVICE_LABELS.get(vid_pid or "")
        if vid_pid:
            for fqbn, info in BOARD_MAP.items():
                if vid_pid in info["vid_pid"]:
                    detected_board = info["name"]
                    detected_fqbn = fqbn
                    break
        if not detected_fqbn and "esp32-s3" in identity_text:
            detected_board = BOARD_CATALOG["esp32:esp32:esp32s3"]["name"]
            detected_fqbn = "esp32:esp32:esp32s3"
        elif not detected_fqbn and "esp32-c3" in identity_text:
            detected_board = BOARD_CATALOG["esp32:esp32:esp32c3"]["name"]
            detected_fqbn = "esp32:esp32:esp32c3"
        elif not detected_fqbn and "esp32-s2" in identity_text:
            detected_board = BOARD_CATALOG["esp32:esp32:esp32s2"]["name"]
            detected_fqbn = "esp32:esp32:esp32s2"
        elif not detected_fqbn and "nano every" in identity_text:
            detected_board = BOARD_CATALOG["arduino:megaavr:nona4809"]["name"]
            detected_fqbn = "arduino:megaavr:nona4809"
        elif not detected_fqbn and re.search(r"\barduino\s+nano\b", identity_text) and "esp32" not in identity_text:
            detected_board = BOARD_CATALOG["arduino:avr:nano"]["name"]
            detected_fqbn = "arduino:avr:nano"
        ports.append({
            "port": port_info.device,
            "description": port_info.description,
            "vid_pid": vid_pid,
            "manufacturer": port_info.manufacturer,
            "product": port_info.product,
            "serial_number": port_info.serial_number,
            "location": port_info.location,
            "board": detected_board,
            "fqbn": detected_fqbn,
            "usb_label": usb_label,
        })
    return {"ports": ports}

@app.post("/flash/install-core")
async def install_core(req: InstallCoreRequest = InstallCoreRequest()):
    try:
        await asyncio.to_thread(_ensure_board_core, req.board)
        return {"status": "success", "message": f"Board support installed for {req.board}"}
    except Exception as e:
        return {"status": "error", "error": str(e)}

@app.post("/flash/install-library")
async def install_library(req: InstallLibRequest):
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9 ._+-]{0,99}", req.library.strip()):
        raise HTTPException(status_code=400, detail="Invalid library name.")
    try:
        result = await asyncio.to_thread(_run_cli, ["lib", "install", req.library], 120)
        return {"status": "success", "message": f"Installed {req.library}"}
    except Exception as e:
        return {"status": "error", "error": str(e)}

@app.post("/flash/compile")
async def compile_code(req: CompileRequest):
    if req.board not in BOARD_CATALOG:
        raise HTTPException(status_code=400, detail="Unsupported board target.")
    if not os.path.exists(ARDUINO_CLI):
        raise HTTPException(status_code=500, detail="arduino-cli not found")
    try:
        await asyncio.to_thread(_ensure_board_core, req.board)
    except Exception as e:
        return {"status": "error", "error": f"Could not prepare board support: {e}", "stdout": ""}
    os.makedirs(BUILD_TEMP_DIR, exist_ok=True)
    tmp_dir = tempfile.mkdtemp(prefix="hw_studio_", dir=BUILD_TEMP_DIR)
    sketch_name = "sketch"
    sketch_dir = os.path.join(tmp_dir, sketch_name)
    os.makedirs(sketch_dir, exist_ok=True)
    ino_path = os.path.join(sketch_dir, f"{sketch_name}.ino")
    with open(ino_path, "w", encoding="utf-8") as f:
        f.write(req.code)
    build_dir = os.path.join(tmp_dir, "build")
    os.makedirs(build_dir, exist_ok=True)
    try:
        result = await asyncio.to_thread(
            _run_cli,
            ["compile", "--fqbn", req.board, "--output-dir", build_dir, sketch_dir],
            180,
        )
        artifacts = glob.glob(os.path.join(build_dir, "*.bin")) + glob.glob(os.path.join(build_dir, "*.hex")) + glob.glob(os.path.join(build_dir, "*.uf2")) + glob.glob(os.path.join(build_dir, "*.elf"))
        binary_size = sum(os.path.getsize(path) for path in artifacts)
        shutil.rmtree(tmp_dir, ignore_errors=True)
        return {
            "status": "success",
            "stdout": (result.stdout + result.stderr).strip(),
            "binary_size": binary_size,
            "artifact_count": len(artifacts),
        }
    except subprocess.TimeoutExpired:
        shutil.rmtree(tmp_dir, ignore_errors=True)
        return {"status": "error", "error": "Compilation timed out (180s)"}
    except RuntimeError as e:
        shutil.rmtree(tmp_dir, ignore_errors=True)
        error_text = str(e)
        missing_libraries = []
        for line in error_text.splitlines():
            if "#include" in line and "No such file or directory" in line:
                match = re.search(r'#include\s*[<"]([^>"]+)[>"]', line)
                if match:
                    missing_libraries.append(match.group(1).split("/")[0].replace(".h", ""))
        return {
            "status": "error",
            "error": error_text,
            "stdout": "",
            "missing_libraries": sorted(set(missing_libraries)),
        }
    except Exception as e:
        shutil.rmtree(tmp_dir, ignore_errors=True)
        return {"status": "error", "error": str(e)}

_upload_operations = {}
_upload_operations_lock = RLock()
_UPLOAD_OPERATION_MAX_AGE_SECONDS = 30 * 60
_UPLOAD_OUTPUT_MAX_CHARS = 12_000


def _upload_operation_snapshot(operation_id: str):
    with _upload_operations_lock:
        operation = _upload_operations.get(operation_id)
        return dict(operation) if operation else None


def _update_upload_operation(operation_id: str, **updates):
    with _upload_operations_lock:
        operation = _upload_operations.get(operation_id)
        if operation is None:
            return
        operation.update(updates)
        operation["updated_at"] = int(time.time() * 1000)


def _append_upload_output(operation_id: str, line: str):
    current = _upload_operation_snapshot(operation_id)
    if not current:
        return
    output = (str(current.get("stdout", "")) + line)[-_UPLOAD_OUTPUT_MAX_CHARS:]
    updates = {"stdout": output}
    if current.get("stage") == "compiling":
        lower_line = line.lower()
        compile_milestones = (
            ("detecting libraries used", 34),
            ("generating function prototypes", 40),
            ("compiling sketch", 45),
            ("compiling libraries", 50),
            ("linking everything together", 58),
            ("sketch uses", 60),
        )
        for marker, progress in compile_milestones:
            if marker in lower_line:
                updates["progress"] = max(int(current.get("progress", 30)), progress)
                updates["message"] = f"Compiling firmware ({progress}% build stage)…"
                break
    elif current.get("stage") == "uploading":
        match = re.search(r"\b(?:Writing|Uploading)[^\r\n]*?\b(\d{1,3})\s*%", line, flags=re.IGNORECASE)
        if match:
            percent = min(100, max(0, int(match.group(1))))
            updates["progress"] = max(int(current.get("progress", 65)), 65 + round(percent * 0.3))
            updates["message"] = f"Uploading firmware to the board ({percent}% reported by the uploader)."
    _update_upload_operation(operation_id, **updates)


def _port_identity_matches(port_info, requested_port: str, requested_vid_pid: Optional[str], requested_serial: Optional[str], board: str):
    if str(port_info.device or "").casefold() == requested_port.casefold():
        return True
    vid_pid = f"{port_info.vid:04X}:{port_info.pid:04X}" if port_info.vid and port_info.pid else ""
    if requested_serial and str(port_info.serial_number or "") == requested_serial:
        # ESP32 bootloaders can expose a different USB product ID after reset.
        # The stable serial number is enough to identify that same physical board.
        return board.startswith("esp32:") or not requested_vid_pid or vid_pid.casefold() == requested_vid_pid.casefold()
    # Native USB ESP boards may re-enumerate under another COM port on reset.
    # A matching USB identity lets the upload survive that bootloader hand-off.
    return bool(
        board.startswith("esp32:")
        and requested_vid_pid
        and vid_pid.casefold() == requested_vid_pid.casefold()
    )


def _target_board_is_present(req: FlashRequest) -> bool:
    try:
        return any(
            _port_identity_matches(port, req.port, req.vid_pid, req.serial_number, req.board)
            for port in serial.tools.list_ports.comports()
        )
    except Exception:
        return False


def _terminate_upload_process(process):
    if process.poll() is not None:
        return
    if os.name == "nt":
        try:
            subprocess.run(
                ["taskkill", "/PID", str(process.pid), "/T", "/F"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=5,
                check=False,
            )
        except Exception:
            process.kill()
    else:
        process.terminate()
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=5)


def _run_upload_cli(operation_id: str, args: List[str], timeout: int, req: FlashRequest, watch_disconnect: bool = False):
    for directory in (ARDUINO_DATA_DIR, ARDUINO_DOWNLOADS_DIR, ARDUINO_USER_DIR, BUILD_TEMP_DIR):
        os.makedirs(directory, exist_ok=True)
    if not os.path.exists(ARDUINO_CONFIG_FILE):
        with open(ARDUINO_CONFIG_FILE, "w", encoding="utf-8") as config_file:
            config_file.write(
                "directories:\n"
                f"  data: {json.dumps(ARDUINO_DATA_DIR)}\n"
                f"  downloads: {json.dumps(ARDUINO_DOWNLOADS_DIR)}\n"
                f"  user: {json.dumps(ARDUINO_USER_DIR)}\n"
            )

    process = subprocess.Popen(
        [ARDUINO_CLI, "--config-file", ARDUINO_CONFIG_FILE, *args],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        universal_newlines=True,
        bufsize=1,
    )
    output_queue = Queue()

    def collect_output():
        try:
            if process.stdout:
                for line in process.stdout:
                    output_queue.put(line)
        finally:
            output_queue.put(None)

    reader = Thread(target=collect_output, name="KaktusArduinoCliOutput", daemon=True)
    reader.start()
    started = time.monotonic()
    missing_since = None
    output_finished = False

    while process.poll() is None or not output_finished:
        if time.monotonic() - started > timeout:
            _terminate_upload_process(process)
            snapshot = _upload_operation_snapshot(operation_id) or {}
            raise subprocess.TimeoutExpired([ARDUINO_CLI, *args], timeout, output=snapshot.get("stdout", ""))

        if watch_disconnect and process.poll() is None:
            attached = _target_board_is_present(req)
            current = _upload_operation_snapshot(operation_id) or {}
            if attached:
                missing_since = None
            else:
                if missing_since is None:
                    missing_since = time.monotonic()
                    _update_upload_operation(
                        operation_id,
                        stage="disconnecting",
                        resume_stage=current.get("stage") if current.get("stage") in {"compiling", "uploading"} else "uploading",
                        message="Board disconnected. Checking the firmware operation…",
                        board_connected=False,
                    )
                phase = "upload" if current.get("stage") == "uploading" or current.get("resume_stage") == "uploading" else "compile"
                grace_seconds = (15 if req.board.startswith("esp32:") else 4) if phase == "upload" else 2
                if time.monotonic() - missing_since >= grace_seconds:
                    _terminate_upload_process(process)
                    raise RuntimeError(f"Board {req.port} disconnected during {phase}. The firmware upload did not complete; reconnect the board and retry.")
            if missing_since is None:
                if current.get("stage") == "disconnecting":
                    resume_stage = current.get("resume_stage") if current.get("resume_stage") in {"compiling", "uploading"} else "uploading"
                    message = "Board reconnected. Compilation is continuing." if resume_stage == "compiling" else "Board reconnected to the bootloader. Upload is continuing."
                    _update_upload_operation(operation_id, stage=resume_stage, message=message, board_connected=True, resume_stage=None)

        try:
            line = output_queue.get(timeout=0.2)
            if line is None:
                output_finished = True
            else:
                _append_upload_output(operation_id, line)
        except Empty:
            pass

    reader.join(timeout=1)
    return_code = process.wait()
    operation = _upload_operation_snapshot(operation_id) or {}
    output = str(operation.get("stdout", ""))
    if return_code != 0:
        raise RuntimeError(output.strip() or f"Arduino CLI exited with code {return_code}.")
    return subprocess.CompletedProcess(args, return_code, stdout=output, stderr="")


def _run_upload_operation(operation_id: str, req: FlashRequest):
    tmp_dir = None
    try:
        _update_upload_operation(stage="preparing", progress=12, message=f"Preparing {BOARD_CATALOG[req.board]['name']} support…", board_connected=True)
        _ensure_board_core(req.board)
        if not _target_board_is_present(req):
            raise RuntimeError(f"Board {req.port} disconnected before compilation. Reconnect it and scan USB ports again.")

        os.makedirs(BUILD_TEMP_DIR, exist_ok=True)
        tmp_dir = tempfile.mkdtemp(prefix="hw_studio_", dir=BUILD_TEMP_DIR)
        sketch_name = "sketch"
        sketch_dir = os.path.join(tmp_dir, sketch_name)
        build_dir = os.path.join(tmp_dir, "build")
        os.makedirs(sketch_dir, exist_ok=True)
        os.makedirs(build_dir, exist_ok=True)
        with open(os.path.join(sketch_dir, f"{sketch_name}.ino"), "w", encoding="utf-8") as sketch_file:
            sketch_file.write(req.code)

        _update_upload_operation(stage="compiling", progress=30, message=f"Compiling firmware for {BOARD_CATALOG[req.board]['name']}…")
        _run_upload_cli(operation_id, ["compile", "--fqbn", req.board, "--output-dir", build_dir, sketch_dir], 180, req, watch_disconnect=True)

        if not _target_board_is_present(req):
            raise RuntimeError(f"Board {req.port} disconnected after compilation. The firmware was compiled but not uploaded.")

        _update_upload_operation(stage="uploading", progress=65, message=f"Uploading compiled firmware to {req.port}…", board_connected=True)
        _run_upload_cli(
            operation_id,
            ["upload", "--fqbn", req.board, "--port", req.port, "--input-dir", build_dir, sketch_dir],
            180,
            req,
            watch_disconnect=True,
        )
        board_still_connected = _target_board_is_present(req)
        _update_upload_operation(
            status="success",
            stage="success",
            progress=100,
            message=(f"Firmware upload completed on {req.port}." if board_still_connected else f"Firmware upload completed on {req.port}; the board disconnected after transfer."),
            board_connected=board_still_connected,
            error="",
        )
    except subprocess.TimeoutExpired as error:
        _update_upload_operation(status="error", stage="error", message="Firmware operation timed out.", error=f"Compile and upload timed out ({error.timeout}s).", board_connected=_target_board_is_present(req))
    except Exception as error:
        _update_upload_operation(status="error", stage="error", message="Firmware upload failed.", error=str(error)[:3000], board_connected=_target_board_is_present(req))
    finally:
        if tmp_dir:
            shutil.rmtree(tmp_dir, ignore_errors=True)


@app.post("/flash/upload")
async def upload_to_board(req: FlashRequest):
    if req.board not in BOARD_CATALOG:
        raise HTTPException(status_code=400, detail="Unsupported board target.")
    if not os.path.exists(ARDUINO_CLI):
        raise HTTPException(status_code=500, detail="arduino-cli not found")
    if not _target_board_is_present(req):
        return {"status": "error", "error": f"Serial port {req.port} is no longer available. Re-scan USB ports and select the connected board."}

    with _upload_operations_lock:
        now = time.time()
        stale_ids = [
            operation_id for operation_id, operation in _upload_operations.items()
            if operation.get("status") != "running"
            and now - (float(operation.get("updated_at", 0)) / 1000) > _UPLOAD_OPERATION_MAX_AGE_SECONDS
        ]
        for operation_id in stale_ids:
            _upload_operations.pop(operation_id, None)
        if any(operation.get("status") == "running" for operation in _upload_operations.values()):
            raise HTTPException(status_code=409, detail="A firmware operation is already running. Wait for it to finish before starting another.")
        operation_id = secrets.token_hex(16)
        _upload_operations[operation_id] = {
            "operation_id": operation_id,
            "status": "running",
            "stage": "preparing",
            "progress": 5,
            "message": "Starting firmware preparation…",
            "stdout": "",
            "error": "",
            "board_connected": True,
            "created_at": int(now * 1000),
            "updated_at": int(now * 1000),
        }

    worker = Thread(target=_run_upload_operation, args=(operation_id, req), name="KaktusFirmwareUpload", daemon=True)
    worker.start()
    return {"status": "running", "operation_id": operation_id, "stage": "preparing", "progress": 5, "message": "Starting firmware preparation…"}


@app.get("/flash/upload/status")
async def flash_upload_status(operation_id: str):
    if not re.fullmatch(r"[a-f0-9]{32}", operation_id):
        raise HTTPException(status_code=400, detail="Invalid firmware operation id.")
    operation = _upload_operation_snapshot(operation_id)
    if not operation:
        raise HTTPException(status_code=404, detail="Firmware operation not found. Start a new upload.")
    return operation


_serial_connections = {}
_serial_connections_lock = RLock()


def _open_serial_connection(port: str, baud: int):
    with _serial_connections_lock:
        existing = _serial_connections.get(port)
        if existing and existing.is_open:
            if existing.baudrate != baud:
                existing.close()
                del _serial_connections[port]
            else:
                return existing
        connection = serial.Serial(port, baudrate=baud, timeout=0.25, write_timeout=2)
        _serial_connections[port] = connection
        return connection


def _close_serial_connection(port: str):
    with _serial_connections_lock:
        connection = _serial_connections.pop(port, None)
        if connection and connection.is_open:
            connection.close()

@app.get("/flash/serial-monitor")
async def serial_monitor(port: str, baud: int = 9600):
    try:
        connection = await asyncio.to_thread(_open_serial_connection, port, baud)
    except Exception as e:
        raise HTTPException(status_code=409, detail=f"Could not open {port} at {baud} baud: {e}")

    async def generate():
        pending = bytearray()
        try:
            while True:
                chunk = await asyncio.to_thread(connection.read, max(1, connection.in_waiting))
                if chunk:
                    pending.extend(chunk)
                    while b"\n" in pending:
                        raw_line, _, remainder = pending.partition(b"\n")
                        pending = bytearray(remainder)
                        line = raw_line.rstrip(b"\r").decode("utf-8", errors="replace")
                        yield f"data: {json.dumps({'line': line})}\n\n"
                else:
                    await asyncio.sleep(0.04)
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n"
        finally:
            await asyncio.to_thread(_close_serial_connection, port)

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.post("/flash/serial-write")
async def serial_write(req: SerialWriteRequest):
    with _serial_connections_lock:
        connection = _serial_connections.get(req.port)
    if not connection or not connection.is_open:
        raise HTTPException(status_code=409, detail="Start the serial monitor before sending data.")
    try:
        await asyncio.to_thread(connection.write, (req.text + "\r\n").encode("utf-8"))
        return {"status": "success"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Could not write to {req.port}: {e}")
