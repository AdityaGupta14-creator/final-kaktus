"""Windows companion for the authenticated Kaktus hardware relay."""

from __future__ import annotations

import ctypes
from ctypes import wintypes
import json
import logging
import os
import re
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from xml.sax.saxutils import escape as xml_escape
from pathlib import Path

VERSION = "1.0.6"
LOCAL_API = "http://127.0.0.1:8001"
PROJECT_ID = "otpdemo-291bd"
STARTUP_TASK_NAME = r"\KaktusHardwareBridge"
MAX_RESULT_BYTES = 1_000_000
ALLOWED_ROUTES = {
    ("GET", "/"): "health",
    ("GET", "/flash/status"): "status",
    ("GET", "/flash/boards"): "boards",
    ("GET", "/flash/upload/status"): "upload-status",
    ("POST", "/flash/compile"): "compile",
    ("POST", "/flash/upload"): "upload",
    ("POST", "/flash/install-core"): "install-core",
    ("POST", "/flash/install-library"): "install-library",
    ("POST", "/flash/serial-write"): "serial-write",
}
ALLOWED_API_HOSTS = {
    "final-kaktus.vercel.app",
    "final-kaktus-hello-4da5.vercel.app",
    "final-kaktus-git-main-hello-4da5.vercel.app",
    "yc-drab.vercel.app",
}
PAIRING_ID = re.compile(r"^[a-f0-9]{32}$")
PAIRING_CODE = re.compile(r"^[A-Za-z0-9_-]{40,48}$")
_instance_mutex_handle = None


class RelayHttpError(RuntimeError):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


def data_dir() -> Path:
    base = os.environ.get("APPDATA") or str(Path.home() / "AppData" / "Roaming")
    directory = Path(base) / "Kaktus" / "HardwareBridge"
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def log(message: str) -> None:
    try:
        log_path = data_dir() / "agent.log"
        if log_path.exists() and log_path.stat().st_size > 1_000_000:
            log_path.write_text("", encoding="utf-8")
        with log_path.open("a", encoding="utf-8") as log_file:
            log_file.write(f"{time.strftime('%Y-%m-%d %H:%M:%S')} {message[:1000]}\n")
    except OSError:
        pass


def run_schtasks(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["schtasks.exe", *args], capture_output=True, text=True,
        timeout=20, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0), check=False,
    )


def show_error(message: str) -> None:
    log(message)
    try:
        message_box = ctypes.WinDLL("user32", use_last_error=True).MessageBoxW
        message_box.argtypes = [wintypes.HWND, wintypes.LPCWSTR, wintypes.LPCWSTR, wintypes.UINT]
        message_box.restype = ctypes.c_int
        message_box(None, message[:1500], "Kaktus Hardware Bridge", 0x10 | 0x1000)
    except Exception:
        pass


class DATA_BLOB(ctypes.Structure):
    _fields_ = [("cbData", wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_ubyte))]


def _blob(data: bytes):
    buffer = ctypes.create_string_buffer(data, len(data))
    return DATA_BLOB(len(data), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_ubyte))), buffer


def protect(data: bytes) -> bytes:
    if os.name != "nt":
        raise OSError("The Kaktus desktop companion currently requires Windows.")
    crypt32 = ctypes.WinDLL("crypt32", use_last_error=True)
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    crypt_protect = crypt32.CryptProtectData
    crypt_protect.argtypes = [
        ctypes.POINTER(DATA_BLOB), wintypes.LPCWSTR, ctypes.POINTER(DATA_BLOB),
        wintypes.LPVOID, wintypes.LPVOID, wintypes.DWORD, ctypes.POINTER(DATA_BLOB),
    ]
    crypt_protect.restype = wintypes.BOOL
    source, source_buffer = _blob(data)
    entropy, entropy_buffer = _blob(b"Kaktus Hardware Bridge v1")
    encrypted = DATA_BLOB()
    success = crypt_protect(
        ctypes.byref(source), "Kaktus Hardware Bridge", ctypes.byref(entropy),
        None, None, 0x1, ctypes.byref(encrypted),
    )
    _ = source_buffer, entropy_buffer
    if not success:
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        return ctypes.string_at(encrypted.pbData, encrypted.cbData)
    finally:
        local_free = kernel32.LocalFree
        local_free.argtypes = [wintypes.HLOCAL]
        local_free.restype = wintypes.HLOCAL
        local_free(ctypes.cast(encrypted.pbData, wintypes.HLOCAL))


def unprotect(data: bytes) -> bytes:
    if os.name != "nt":
        raise OSError("The Kaktus desktop companion currently requires Windows.")
    crypt32 = ctypes.WinDLL("crypt32", use_last_error=True)
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    crypt_unprotect = crypt32.CryptUnprotectData
    crypt_unprotect.argtypes = [
        ctypes.POINTER(DATA_BLOB), ctypes.POINTER(wintypes.LPWSTR), ctypes.POINTER(DATA_BLOB),
        wintypes.LPVOID, wintypes.LPVOID, wintypes.DWORD, ctypes.POINTER(DATA_BLOB),
    ]
    crypt_unprotect.restype = wintypes.BOOL
    source, source_buffer = _blob(data)
    entropy, entropy_buffer = _blob(b"Kaktus Hardware Bridge v1")
    decrypted = DATA_BLOB()
    success = crypt_unprotect(
        ctypes.byref(source), None, ctypes.byref(entropy), None, None, 0x1,
        ctypes.byref(decrypted),
    )
    _ = source_buffer, entropy_buffer
    if not success:
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        return ctypes.string_at(decrypted.pbData, decrypted.cbData)
    finally:
        local_free = kernel32.LocalFree
        local_free.argtypes = [wintypes.HLOCAL]
        local_free.restype = wintypes.HLOCAL
        local_free(ctypes.cast(decrypted.pbData, wintypes.HLOCAL))


def save_config(config: dict) -> None:
    target = data_dir() / "bridge.secret"
    encrypted = protect(json.dumps(config, separators=(",", ":")).encode("utf-8"))
    handle, temporary = tempfile.mkstemp(prefix="bridge-", dir=str(target.parent))
    try:
        with os.fdopen(handle, "wb") as output:
            output.write(encrypted)
        os.replace(temporary, target)
    finally:
        try:
            os.unlink(temporary)
        except OSError:
            pass


def load_config() -> dict:
    raw = unprotect((data_dir() / "bridge.secret").read_bytes())
    config = json.loads(raw.decode("utf-8"))
    if not valid_api_base(config.get("apiBase")):
        raise ValueError("The saved Kaktus server address is invalid. Pair this computer again.")
    if not PAIRING_ID.fullmatch(str(config.get("bridgeId", ""))) or len(str(config.get("bridgeToken", ""))) < 40:
        raise ValueError("The saved bridge credentials are invalid. Pair this computer again.")
    return config


def valid_api_base(value: object) -> bool:
    if not isinstance(value, str) or len(value) > 300:
        return False
    try:
        parsed = urllib.parse.urlsplit(value)
        if parsed.path not in ("", "/") or parsed.query or parsed.fragment or parsed.username or parsed.password:
            return False
        if parsed.scheme == "https" and parsed.hostname in ALLOWED_API_HOSTS:
            return True
        return parsed.scheme == "http" and parsed.hostname in ("localhost", "127.0.0.1") and parsed.port == 3000
    except (ValueError, TypeError):
        return False


def pair_from_uri(uri: str) -> dict:
    parsed = urllib.parse.urlsplit(uri)
    if parsed.scheme.lower() != "kaktus-bridge" or parsed.netloc.lower() != "pair":
        raise ValueError("This is not a valid Kaktus pairing link.")
    params = urllib.parse.parse_qs(parsed.query, strict_parsing=True)
    api_base = params.get("apiBase", [""])[0]
    pairing_id = params.get("pairingId", [""])[0]
    pairing_code = params.get("pairingCode", [""])[0]
    if not valid_api_base(api_base) or not PAIRING_ID.fullmatch(pairing_id) or not PAIRING_CODE.fullmatch(pairing_code):
        raise ValueError("This pairing link is invalid or expired. Start pairing again in Kaktus.")
    payload = post_json(api_base, "/api/hardware/relay", {
        "action": "complete-pairing",
        "pairingId": pairing_id,
        "pairingCode": pairing_code,
    })
    if not isinstance(payload.get("bridgeId"), str) or not isinstance(payload.get("bridgeToken"), str):
        raise ValueError("Kaktus did not return valid pairing credentials.")
    return {"apiBase": api_base.rstrip("/"), "bridgeId": payload["bridgeId"], "bridgeToken": payload["bridgeToken"]}


def post_json(api_base: str, path: str, payload: dict, token: str | None = None, timeout: float = 15) -> dict:
    body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(api_base.rstrip("/") + path, data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read(MAX_RESULT_BYTES + 16_384)
            if len(raw) > MAX_RESULT_BYTES + 16_384:
                raise ValueError("Kaktus returned an unexpectedly large relay response.")
            result = json.loads(raw.decode("utf-8")) if raw else {}
            if response.status < 200 or response.status >= 300:
                raise RuntimeError(result.get("error") or f"Kaktus returned HTTP {response.status}.")
            return result
    except urllib.error.HTTPError as error:
        raw = error.read(4096)
        try:
            message = json.loads(raw.decode("utf-8")).get("error") or f"Kaktus returned HTTP {error.code}."
        except Exception:
            message = f"Kaktus returned HTTP {error.code}."
        raise RelayHttpError(error.code, message) from error


def register_startup() -> bool:
    if os.name != "nt":
        return False
    import winreg

    executable = Path(sys.executable).resolve()
    if getattr(sys, "frozen", False):
        command = str(executable)
        arguments = "--background --task-agent"
    else:
        command = str(executable)
        arguments = f'"{Path(__file__).resolve()}" --background --task-agent'

    def remove_legacy_run_entry() -> None:
        key_path = r"Software\Microsoft\Windows\CurrentVersion\Run"
        try:
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, key_path, 0, winreg.KEY_SET_VALUE) as key:
                winreg.DeleteValue(key, "KaktusHardwareBridge")
        except OSError:
            pass

    try:
        existing = run_schtasks("/Query", "/TN", STARTUP_TASK_NAME, "/XML")
        if existing.returncode == 0 and str(executable).lower() in existing.stdout.lower():
            remove_legacy_run_entry()
            log("Automatic startup and crash recovery are already registered.")
            return True

        username = os.environ.get("USERNAME", "").strip()
        domain = (os.environ.get("USERDOMAIN") or os.environ.get("COMPUTERNAME") or ".").strip()
        if not username:
            raise RuntimeError("Windows user identity is unavailable for automatic startup.")
        user_id = xml_escape(f"{domain}\\{username}")
        task_xml = f'''<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.3" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>Kaktus hardware bridge for the signed-in Windows user.</Description></RegistrationInfo>
  <Triggers><LogonTrigger><Enabled>true</Enabled><UserId>{user_id}</UserId></LogonTrigger></Triggers>
  <Principals><Principal id="Author"><UserId>{user_id}</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
  <Settings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <RestartOnFailure><Interval>PT1M</Interval><Count>255</Count></RestartOnFailure>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <Enabled>true</Enabled><Hidden>true</Hidden>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit><Priority>7</Priority>
  </Settings>
  <Actions Context="Author"><Exec><Command>{xml_escape(command)}</Command><Arguments>{xml_escape(arguments)}</Arguments><WorkingDirectory>{xml_escape(str(executable.parent))}</WorkingDirectory></Exec></Actions>
</Task>'''
        task_file = data_dir() / "startup-task.xml"
        try:
            task_file.write_text(task_xml, encoding="utf-16")
            result = run_schtasks("/Create", "/TN", STARTUP_TASK_NAME, "/XML", str(task_file), "/F")
        finally:
            try:
                task_file.unlink()
            except OSError:
                pass
        if result.returncode != 0:
            raise RuntimeError((result.stderr or result.stdout or "Task Scheduler registration failed.").strip())
        remove_legacy_run_entry()
        log("Automatic Windows sign-in startup and crash recovery registered.")
        return True
    except Exception as error:
        log(f"Task Scheduler registration failed ({type(error).__name__}); using Windows sign-in startup fallback.")

    command_line = f'"{command}" {arguments}'
    key_path = r"Software\Microsoft\Windows\CurrentVersion\Run"
    try:
        with winreg.CreateKeyEx(winreg.HKEY_CURRENT_USER, key_path, 0, winreg.KEY_SET_VALUE) as key:
            winreg.SetValueEx(key, "KaktusHardwareBridge", 0, winreg.REG_SZ, command_line)
    except OSError as error:
        log(f"Windows sign-in startup fallback could not be registered ({type(error).__name__}).")
        return False
    return False


def unregister_startup() -> None:
    if os.name != "nt":
        return
    try:
        run_schtasks("/Delete", "/TN", STARTUP_TASK_NAME, "/F")
    except Exception:
        pass
    try:
        import winreg

        key_path = r"Software\Microsoft\Windows\CurrentVersion\Run"
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, key_path, 0, winreg.KEY_SET_VALUE) as key:
            winreg.DeleteValue(key, "KaktusHardwareBridge")
    except OSError:
        pass


def clear_saved_config() -> None:
    try:
        (data_dir() / "bridge.secret").unlink()
    except OSError:
        pass


def acquire_single_instance() -> bool:
    """Keep startup, protocol-link, and manual launches from spawning duplicate agents."""
    global _instance_mutex_handle
    if os.name != "nt":
        return True

    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    create_mutex = kernel32.CreateMutexW
    create_mutex.argtypes = [wintypes.LPVOID, wintypes.BOOL, wintypes.LPCWSTR]
    create_mutex.restype = wintypes.HANDLE
    ctypes.set_last_error(0)
    handle = create_mutex(None, True, "Local\\KaktusHardwareBridgeAgent")
    if not handle:
        raise ctypes.WinError(ctypes.get_last_error())
    if ctypes.get_last_error() == 183:  # ERROR_ALREADY_EXISTS
        kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
        kernel32.CloseHandle(handle)
        return False

    _instance_mutex_handle = handle
    return True


def release_single_instance() -> None:
    global _instance_mutex_handle
    if not _instance_mutex_handle or os.name != "nt":
        return
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.ReleaseMutex.argtypes = [wintypes.HANDLE]
    kernel32.ReleaseMutex.restype = wintypes.BOOL
    kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel32.CloseHandle.restype = wintypes.BOOL
    kernel32.ReleaseMutex(_instance_mutex_handle)
    kernel32.CloseHandle(_instance_mutex_handle)
    _instance_mutex_handle = None


def hand_off_to_registered_task() -> bool:
    """Run the persistent agent as a Task Scheduler instance for crash recovery."""
    release_single_instance()
    result = run_schtasks("/Run", "/TN", STARTUP_TASK_NAME)
    if result.returncode == 0:
        return True
    # Restore this process as the singleton if the scheduled launch failed.
    if acquire_single_instance():
        log("Could not start the registered task; continuing in this process.")
        return False
    log("Another helper instance took over while Task Scheduler was starting it.")
    return True


def resource_root() -> Path:
    if getattr(sys, "frozen", False):
        return Path(getattr(sys, "_MEIPASS"))
    return Path(__file__).resolve().parents[1]


def configure_hardware_runtime() -> Path:
    root = resource_root()
    backend_path = root / "backend"
    if not backend_path.exists():
        backend_path = root
    if str(backend_path) not in sys.path:
        sys.path.insert(0, str(backend_path))
    os.environ["KAKTUS_HARDWARE_HOME"] = str(data_dir())
    os.environ["KAKTUS_HARDWARE_PORT"] = "8001"
    os.environ["FIREBASE_PROJECT_ID"] = PROJECT_ID
    cli_candidates = (
        root / "arduino-cli" / "arduino-cli.exe",
        root / "backend" / "arduino-cli" / "arduino-cli.exe",
    )
    cli = next((path for path in cli_candidates if path.exists()), None)
    if cli:
        os.environ["ARDUINO_CLI_PATH"] = str(cli)
    return root


def packaged_self_check() -> int:
    try:
        root = configure_hardware_runtime()
        import google.auth.transport.requests  # noqa: F401
        import requests  # noqa: F401
        import serial  # noqa: F401
        import uvicorn  # noqa: F401
        import main as hardware_main

        cli = os.environ.get("ARDUINO_CLI_PATH", "")
        if not cli or not Path(cli).is_file():
            raise RuntimeError(f"Bundled Arduino CLI is missing (resource root: {root}).")
        if hardware_main.app is None:
            raise RuntimeError("The packaged Kaktus hardware API did not initialize.")
        configure_local_uvicorn(uvicorn, hardware_main.app)
        log("Packaged companion dependency check passed.")
        return 0
    except Exception as error:
        log(f"Packaged companion dependency check failed: {type(error).__name__}: {error}")
        return 1


def configure_local_uvicorn(uvicorn_module, app):
    # The companion is built with PyInstaller's --windowed flag, so stdout and
    # stderr are None. Uvicorn's default formatter probes them with isatty().
    logger = logging.getLogger("uvicorn")
    logger.handlers.clear()
    logger.addHandler(logging.NullHandler())
    logger.propagate = False
    return uvicorn_module.Config(
        app,
        host="127.0.0.1",
        port=8001,
        log_level="warning",
        access_log=False,
        log_config=None,
    )


def start_local_hardware_api() -> None:
    import urllib.request

    local_opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        with local_opener.open(LOCAL_API + "/", timeout=2) as response:
            data = json.loads(response.read(16_384).decode("utf-8"))
            if response.status == 200 and data.get("service") == "kaktus-hardware-bridge":
                log("Using the already running local Kaktus hardware service.")
                return
        raise RuntimeError("Port 8001 is in use by a different service; Kaktus did not stop it.")
    except urllib.error.HTTPError as error:
        raise RuntimeError(f"Port 8001 is in use (HTTP {error.code}); Kaktus did not stop it.") from error
    except urllib.error.URLError as error:
        if not isinstance(error.reason, (ConnectionRefusedError, TimeoutError, OSError)):
            raise RuntimeError(f"Could not check the local USB service: {error.reason}") from error

    configure_hardware_runtime()
    import main as hardware_main
    import uvicorn

    config = configure_local_uvicorn(uvicorn, hardware_main.app)
    server = uvicorn.Server(config)
    server_thread = threading.Thread(target=server.run, name="KaktusLocalUSBService", daemon=True)
    server_thread.start()
    for _ in range(40):
        try:
            with local_opener.open(LOCAL_API + "/", timeout=1) as response:
                data = json.loads(response.read(16_384).decode("utf-8"))
                if response.status == 200 and data.get("service") == "kaktus-hardware-bridge":
                    log("Local USB service started on loopback.")
                    return
        except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError):
            time.sleep(0.5)
    server.should_exit = True
    raise RuntimeError("The Kaktus USB service did not become ready. See the helper log in %APPDATA%\\Kaktus\\HardwareBridge.")


def execute_command(command: dict) -> tuple[int, object]:
    if not isinstance(command.get("path"), str) or not isinstance(command.get("method"), str):
        raise ValueError("The cloud relay sent a malformed hardware command.")
    method = command["method"].upper()
    target = urllib.parse.urlsplit(command["path"])
    if target.scheme or target.netloc or target.fragment or not target.path.startswith("/") or ".." in target.path.split("/"):
        raise ValueError("The cloud relay sent an invalid hardware path.")
    if (method, target.path) not in ALLOWED_ROUTES:
        raise ValueError("The cloud relay sent a hardware operation outside the allowlist.")
    url = LOCAL_API + target.path + ("?" + target.query if target.query else "")
    body = None
    headers = {"Accept": "application/json"}
    if command.get("authToken"):
        headers["Authorization"] = "Bearer " + str(command["authToken"])
    if method != "GET" and command.get("body") is not None:
        body = json.dumps(command["body"], separators=(",", ":")).encode("utf-8")
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(url, data=body, headers=headers, method=method)
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        with opener.open(request, timeout=240) as response:
            raw = response.read(MAX_RESULT_BYTES + 1)
            status = response.status
    except urllib.error.HTTPError as error:
        raw = error.read(MAX_RESULT_BYTES + 1)
        status = error.code
    if len(raw) > MAX_RESULT_BYTES:
        raise ValueError("The local hardware service returned more than 1 MB.")
    text = raw.decode("utf-8", errors="replace")
    try:
        return status, json.loads(text) if text else None
    except json.JSONDecodeError:
        return status, text


def run_agent(config: dict) -> bool:
    log("Kaktus Hardware Bridge is connected and waiting for hardware operations.")
    while True:
        try:
            response = post_json(
                config["apiBase"], "/api/hardware/relay",
                {"action": "poll", "bridgeId": config["bridgeId"], "agentVersion": VERSION},
                config["bridgeToken"], timeout=20,
            )
            command = response.get("command")
            if not command:
                time.sleep(3)
                continue
            stop_heartbeat = threading.Event()

            def heartbeat() -> None:
                while not stop_heartbeat.wait(10):
                    try:
                        post_json(config["apiBase"], "/api/hardware/relay", {
                            "action": "heartbeat",
                            "bridgeId": config["bridgeId"],
                            "agentVersion": VERSION,
                        }, config["bridgeToken"], timeout=10)
                    except Exception as error:
                        log(f"Bridge heartbeat failed ({type(error).__name__}).")

            heartbeat_thread = threading.Thread(target=heartbeat, name="KaktusBridgeHeartbeat", daemon=True)
            heartbeat_thread.start()
            try:
                status, result = execute_command(command)
            except Exception as error:
                status, result = 502, {"status": "error", "error": str(error)[:1000]}
            finally:
                stop_heartbeat.set()
                heartbeat_thread.join(timeout=1)
            post_json(config["apiBase"], "/api/hardware/relay", {
                "action": "result",
                "bridgeId": config["bridgeId"],
                "commandId": command.get("id"),
                "responseStatus": status,
                "responseBody": result,
                "agentVersion": VERSION,
            }, config["bridgeToken"], timeout=20)
        except RelayHttpError as error:
            if error.status == 401:
                log("The paired bridge was revoked or its credentials expired; stopping this helper instance.")
                unregister_startup()
                clear_saved_config()
                return False
            log(f"Cloud relay request failed with HTTP {error.status}; retrying shortly.")
            time.sleep(5)
        except Exception as error:
            log(f"Cloud relay is temporarily unavailable ({type(error).__name__}); retrying shortly.")
            time.sleep(5)


def main() -> int:
    if os.name != "nt":
        show_error("Kaktus Hardware Bridge setup is currently available for Windows.")
        return 1
    if "--self-check" in sys.argv[1:]:
        return packaged_self_check()
    task_agent = "--task-agent" in sys.argv[1:]
    try:
        if not acquire_single_instance():
            if "--background" in sys.argv[1:] and (data_dir() / "bridge.secret").exists():
                try:
                    # An installer upgrade may start while the previous helper
                    # still owns the mutex. Register this executable for future
                    # sign-ins without disturbing the already-running agent.
                    register_startup()
                except Exception as error:
                    log(f"Could not refresh automatic startup during upgrade ({type(error).__name__}).")
            log("The Kaktus Hardware Bridge is already running; ignored duplicate launch.")
            return 0

        uri = next((arg for arg in sys.argv[1:] if arg.lower().startswith("kaktus-bridge://")), None)
        if uri:
            parsed_uri = urllib.parse.urlsplit(uri)
            if parsed_uri.netloc.lower() == "pair":
                config = pair_from_uri(uri)
                save_config(config)
                log("This computer was paired successfully with Kaktus.")
            elif parsed_uri.netloc.lower() == "start" and not parsed_uri.query and not parsed_uri.fragment:
                config = load_config()
                log("Started the previously paired Kaktus Hardware Bridge.")
            else:
                raise ValueError("This Kaktus link is invalid. Pair this computer once from the app.")
        else:
            if "--background" in sys.argv[1:] and not (data_dir() / "bridge.secret").exists():
                return 0
            config = load_config()
        task_registered = register_startup()
        if task_registered and not task_agent and hand_off_to_registered_task():
            return 0
        while True:
            try:
                start_local_hardware_api()
                if run_agent(config) is False:
                    return 0
            except Exception as error:
                log(f"Hardware bridge startup failed ({type(error).__name__}); retrying automatically.")
                time.sleep(15)
    except KeyboardInterrupt:
        return 0
    except Exception as error:
        log(f"Hardware bridge could not initialize ({type(error).__name__}).")
        if "--background" not in sys.argv[1:]:
            show_error(str(error) or "Kaktus Hardware Bridge could not start.")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
