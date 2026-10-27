# Use the terminal from the production site

The terminal runs on the user's computer and connects to the Kaktus site through the loopback terminal service on port 3001.

1. Install the project dependencies on the computer that will provide the terminal: npm install.
2. Start the local terminal service and keep the window open:

       npm run terminal:bridge

3. Open the production site while signed in. Allow the browser's local-network access prompt for Kaktus.
4. Use the terminal's retry button if it was opened before the service or permission was ready.

The production Kaktus origins are allowlisted in terminal-service.js. Other trusted deployments can be added with KAKTUS_WEB_ORIGINS in .env.local. When running the full local app with npm run dev, the terminal service starts automatically; do not start the companion command at the same time.
