# Kaktus Hardware Cloud Bridge

The hosted app sends hardware operations to an authenticated Kaktus API. A paired computer polls that API over outbound HTTPS and forwards a small allowlist of hardware requests to its loopback USB service. The hosted browser never fetches `127.0.0.1`, so production hardware flashing does not depend on browser Local Network Access permission.

## Pair a computer

1. Sign in to the hosted Kaktus app and open the Hardware console.
2. Choose **Pair computer and download setup file**. The JSON file contains a revocable, computer-scoped secret; keep it private.
3. On the computer physically connected to the microcontroller, use a trusted Kaktus checkout with Node.js 20+ and Python available. Keep the downloaded JSON outside any shared/public folder.
4. Run `npm run hardware:bridge:cloud -- --config "<path-to-kaktus-hardware-bridge.json>"` from the project folder. The agent starts the local authorization service and USB service if needed, then waits for authenticated commands over HTTPS.
5. Return to the app and retry device detection. The selected board, compile, and flash requests are routed through the paired computer.

The bridge agent never accepts a shell command or arbitrary URL from the cloud. It only forwards the explicit allowlist in `scripts/hardware-cloud-bridge.js`. User Firebase ID tokens are passed only with a claimed command, then removed from its Firestore document.

## Scope and operations

Cloud relay currently supports hardware health, board/port discovery, compile, upload, board-core/library install, and serial writes. The long-lived serial-monitor stream is not relayed yet; it needs a separate streaming transport. Keep the local cloud bridge process running while using hosted compile/flash. The bridge key can be revoked server-side by marking its device document inactive; the app API rejects revoked keys.

This source workflow is not a signed desktop installer. Shipping an installer that launches at login requires a separately built and signed release artifact. Pairing and connecting the physical USB board remain one-time computer setup steps.
