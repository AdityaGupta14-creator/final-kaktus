# Kaktus Hardware Bridge for Windows

This companion removes the manual terminal command and browser local-network permission from hosted USB flashing. It runs the existing FastAPI/pyserial/Arduino CLI hardware service on loopback port 8001, then makes authenticated outbound HTTPS requests to the Kaktus relay. It uses a separate port from local development and executes only the hardware API routes allowed by `src/app/api/hardware/relay/route.ts`.

## User flow

1. Download and install `KaktusHardwareBridgeSetup.exe` once on the Windows computer connected to the board. The per-user installer registers the `kaktus-bridge:` link and does not require administrator access.
2. In Kaktus, choose **Pair this computer once**. Approve the Windows app-open prompt once if shown.
3. The helper stores the relay secret with Windows DPAPI, registers a per-user Windows sign-in task with crash recovery, and starts the local USB API. After that, connect the board and use Flash in Kaktus.

The helper stays in the background, retries temporary network or USB-service failures, and starts again after Windows sign-in or an unexpected exit. The app refreshes its connection status automatically; there is no recurring start or reconnect action. Pairing stays saved until the user revokes the computer or uninstalls the helper. Future sessions need no PowerShell, downloaded config, Python setup, or browser local-network permission.

## Build

The `Build Windows hardware companion` GitHub Actions workflow downloads Arduino CLI, packages the Python service and companion with PyInstaller, and builds a per-user installer with Inno Setup. Run it manually to get a 30-day build artifact, or push a tag such as `hardware-bridge-v1.0.0` to publish a GitHub release asset at the URL used by FlashPanel.

The workflow currently creates an unsigned installer. A public signed release requires a Windows code-signing certificate and a protected signing secret; never commit the certificate or password. Windows may show a publisher warning until a signed release is configured.

## Pairing protocol

The web app creates a random 256-bit pairing code valid for five minutes and stores only its SHA-256 hash. The native app redeems it once over HTTPS, receives a random relay secret, encrypts that secret with the current Windows user's DPAPI, then registers itself in the per-user Run key. Pairing requests are account-scoped and rate-limited; relay commands remain authenticated and allowlisted.
