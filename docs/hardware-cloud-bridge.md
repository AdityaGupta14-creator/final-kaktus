# Kaktus Hardware Bridge

Hosted Kaktus communicates with a paired Windows helper over outbound HTTPS. The helper runs the existing FastAPI, pyserial, and Arduino CLI hardware service on loopback port 8001, separate from the development bridge on port 8000. The hosted browser does not need local-network permission and users do not need to open PowerShell or run a project command.

## First-time setup

1. Download and install **Kaktus Hardware Bridge** on the Windows computer connected to the board. The installer is per-user and does not require administrator access.
2. In the Kaktus Hardware console, click **Pair and start helper** and approve Windows' app-open prompt if shown.
3. Kaktus confirms when the computer is online. Connect the board and use Flash in the app.

The helper saves its relay secret encrypted with the current Windows user's DPAPI, starts when that user signs in, and starts the local hardware API in the background. The five-minute pairing code is random, account-scoped, stored server-side only as a SHA-256 hash, and consumed once. Revoking the device in Kaktus invalidates its relay credential.

## Installer builds

Run the **Build Windows hardware companion** GitHub Actions workflow to build an installer artifact. Pushing a tag in the `hardware-bridge-v*` format publishes the installer as a GitHub release asset. FlashPanel links to the latest release asset by default; set `NEXT_PUBLIC_HARDWARE_BRIDGE_INSTALLER_URL` to override it.

The generated installer is currently unsigned. Windows may show a publisher warning until a trusted code-signing certificate is configured for release signing. Keep any certificate and password in protected CI secrets, never in the repository.

## Supported operations

The outbound agent only forwards hardware health, board/port discovery, compile, upload, core/library installation, and serial-write requests. It does not execute cloud-supplied shell commands or arbitrary URLs. Serial monitor streaming is not yet relayed. Legacy JSON-config cloud agents continue to work, but new pairing uses the companion app.
