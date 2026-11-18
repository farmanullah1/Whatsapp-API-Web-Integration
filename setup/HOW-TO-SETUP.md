# Run the WhatsApp API on a Windows laptop

These steps set the API up on a laptop, make it public on the internet with Tailscale Funnel, and start it automatically every time the laptop turns on, even before anyone signs in.

You don't type any commands: double-click the files in this folder in order. Each one opens a window, explains what it is doing, and waits for you to press a key at the end. Running a file again is safe.

## Before you start

1. Get the project onto the laptop:
   - **With Git:** clone `https://github.com/rafaykhanzada/WHATSAPPAPI.git`. If Git isn't installed yet, copy this `setup` folder over first and run step 1, which installs Git.
   - **By copying the folder** (USB or cloud): don't copy `node_modules`, `.wwebjs_auth`, or `.wwebjs_cache`.
2. **Use each WhatsApp number on only one laptop at a time.** If you're moving a number from another laptop, stop it there first (`pm2 stop whatsapp-api`). Two laptops on one number keep logging each other out.

## Steps

| # | Double-click | What happens | Your part |
|---|---|---|---|
| 1 | `1-install-tools.bat` | Installs Node.js, Git, Tailscale, and PM2 (skips anything already installed) | Click **Yes** on Windows permission prompts |
| 2 | `2-setup-app.bat` | Installs packages, creates `.env` with a new API key, starts the app, opens a QR code in your browser | On your phone: **WhatsApp → Settings → Linked devices → Link a device**, scan the code |
| 3 | `3-public-url.bat` | Signs in to Tailscale and turns on Funnel, then shows your public URL | Ctrl+click the sign-in link and sign in. If it says Funnel/HTTPS isn't enabled, open that link and click **Enable** |
| 4 | `4-autostart.bat` | Makes the app start at power-on and turns off sleep (including when the lid closes) | Click **Yes** on the admin prompt; press Enter in the admin window when it's done |
| 5 | `5-check-status.bat` | Shows whether everything is running. Changes nothing | Run it whenever something seems wrong |

## Test it

1. Restart the laptop and **don't sign in**.
2. Wait about 2 minutes.
3. On your phone, using mobile data (not Wi-Fi), open `<your public URL>/health`.
   You should see `{"status":"ok","state":"READY"}`.

## Where things are

- **Public URL:** `setup\PUBLIC_URL.txt`. It looks like `https://<laptop-name>.<tailnet>.ts.net`.
- **API key:** `setup\API_KEY.txt` (also `API_KEY` in `.env`). Keep it private.
- **Logs:** `pm2 logs whatsapp-api`, and `%USERPROFILE%\.pm2\resurrect-task.log` for the power-on start.

## Send a test message

```bash
curl -X POST <your public URL>/api/messages/text \
  -H "x-api-key: <your API key>" -H "content-type: application/json" \
  -d '{"to": "923001234567", "message": "Hello from the API"}'
```

## Good to know

- The API is only reachable while the laptop is on and connected to the internet. When it comes back, everything starts again by itself.
- If WhatsApp gets unlinked (for example, you removed the device on your phone), run `2-setup-app.bat` again to scan a new QR code.
- If you change `PORT` in `.env`, run steps 2, 3, and 4 again.
