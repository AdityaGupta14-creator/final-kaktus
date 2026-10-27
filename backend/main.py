from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Optional
from threading import RLock
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
import time
import urllib.request
import urllib.error

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

ALLOWED_HOSTS = {
    "127.0.0.1",
    "127.0.0.1:8000",
    "localhost",
    "localhost:8000",
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
_local_auth_opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))


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

    verification_request = urllib.request.Request(
        "http://127.0.0.1:3001/internal/verify-token",
        data=b"",
        headers={"Authorization": f"Bearer {token}"},
        method="POST",
    )
    try:
        with _local_auth_opener.open(verification_request, timeout=3) as response:
            if response.status != 204:
                return False
    except (urllib.error.URLError, TimeoutError, OSError):
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
ARDUINO_CLI = os.getenv(
    "ARDUINO_CLI_PATH",
    os.path.join(os.path.dirname(__file__), "arduino-cli", _bundled_cli),
)
BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
ARDUINO_CONFIG_FILE = os.path.join(BACKEND_DIR, ".arduino-cli.yaml")
ARDUINO_DATA_DIR = os.path.join(BACKEND_DIR, ".arduino-data")
ARDUINO_DOWNLOADS_DIR = os.path.join(BACKEND_DIR, ".arduino-downloads")
ARDUINO_USER_DIR = os.path.join(BACKEND_DIR, ".arduino-user")
BUILD_TEMP_DIR = os.path.join(BACKEND_DIR, ".work")

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

@app.post("/flash/upload")
async def upload_to_board(req: FlashRequest):
    if req.board not in BOARD_CATALOG:
        raise HTTPException(status_code=400, detail="Unsupported board target.")
    if not os.path.exists(ARDUINO_CLI):
        raise HTTPException(status_code=500, detail="arduino-cli not found")
    if not any(port.device == req.port for port in serial.tools.list_ports.comports()):
        return {"status": "error", "error": f"Serial port {req.port} is no longer available. Re-scan USB ports and select the connected board."}
    try:
        await asyncio.to_thread(_ensure_board_core, req.board)
    except Exception as e:
        return {"status": "error", "error": f"Could not prepare board support: {e}"}
    await asyncio.to_thread(_close_serial_connection, req.port)
    os.makedirs(BUILD_TEMP_DIR, exist_ok=True)
    tmp_dir = tempfile.mkdtemp(prefix="hw_studio_", dir=BUILD_TEMP_DIR)
    sketch_name = "sketch"
    sketch_dir = os.path.join(tmp_dir, sketch_name)
    os.makedirs(sketch_dir, exist_ok=True)
    ino_path = os.path.join(sketch_dir, f"{sketch_name}.ino")
    with open(ino_path, "w", encoding="utf-8") as f:
        f.write(req.code)
    try:
        result = await asyncio.to_thread(
            _run_cli,
            ["compile", "--upload", "--fqbn", req.board, "--port", req.port, sketch_dir],
            300,
        )
        return {"status": "success", "stdout": (result.stdout + result.stderr).strip(), "message": f"Firmware uploaded to {req.port}"}
    except subprocess.TimeoutExpired:
        return {"status": "error", "error": "Compile and upload timed out (300s)"}
    except RuntimeError as e:
        return {"status": "error", "error": str(e)}
    except Exception as e:
        return {"status": "error", "error": str(e)}
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


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
