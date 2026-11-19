<div align="center">

# 💬 WhatsApp REST API

**A lightweight, self-hosted REST API for sending and receiving WhatsApp messages, built on [whatsapp-web.js](https://github.com/pedroslopez/whatsapp-web.js).**

[![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![Express](https://img.shields.io/badge/Express.js-REST%20API-000000?style=for-the-badge&logo=express&logoColor=white)](https://expressjs.com/)
[![whatsapp-web.js](https://img.shields.io/badge/whatsapp--web.js-Powered-25D366?style=for-the-badge&logo=whatsapp&logoColor=white)](https://wwebjs.dev/)
[![PM2](https://img.shields.io/badge/PM2-Production%20Ready-2B037A?style=for-the-badge&logo=pm2&logoColor=white)](https://pm2.keymetrics.io/)

[Features](#-features) • [Quick Start](#-quick-start) • [Authentication](#-authentication) • [API Reference](#-api-reference) • [Webhooks](#-webhooks) • [Production](#-production-deployment)

</div>

---

## ✨ Features

* **Rich Messaging Support:** Send plain text, images, videos, audio, and documents (via public URL or Base64), reply to specific messages, and message groups.
* **Smart Number Validation:** Check whether a phone number is registered on WhatsApp before sending (results are cached for 24 hours to reduce overhead).
* **Anti-Ban Message Queue:** Processes one message at a time with a configurable delay and random jitter between sends to mimic human behavior and reduce ban risk.
* **Self-Healing Connection:** Automatically reconnects using exponential backoff on network drops, paired with a built-in watchdog that restarts the browser if it freezes.
* **Persistent Session:** Saves your authentication state locally so you only scan the QR code once—even across server restarts.
* **Real-Time Webhooks:** Receive instant HTTP `POST` notifications for incoming messages, read/delivery receipts, and session status changes, secured with HMAC-SHA256 signatures and automatic retries.
* **Production Hardened:** Built-in timing-safe API key authentication, rate limiting, Helmet security headers, structured JSON logging (Pino) with automatic secret redaction, and graceful shutdown handling.

---

## 📁 Project Structure

```text
Whatsapp-API-Web-Integration/
├── src/                    # Core Express server, WhatsApp client, queue & webhook handlers
├── setup/                  # One-click Windows startup & Tailscale Funnel setup guides/scripts
├── scripts/                # Utility and maintenance scripts
├── ecosystem.config.js     # PM2 process manager configuration
├── .env.example            # Environment variable template
└── package.json            # Dependencies and npm scripts
```

---

## 🚀 Quick Start

### Prerequisites
* **Node.js `v18.0.0` or higher**
* **Google Chrome or Chromium** installed (or let Puppeteer use its bundled browser)
* A smartphone with an active **WhatsApp** account

### 1. Clone & Install

```bash
git clone [https://github.com/farmanullah1/Whatsapp-API-Web-Integration.git](https://github.com/farmanullah1/Whatsapp-API-Web-Integration.git)
cd Whatsapp-API-Web-Integration
npm install
```

### 2. Configure Environment Variables

Copy the example environment file and set your `API_KEY`:

**Windows (PowerShell):**
```powershell
Copy-Item .env.example .env
```

**Linux / macOS (Bash):**
```bash
cp .env.example .env
```

Open `.env` and customize your settings (see [Configuration](#-configuration) below).

### 3. Start the Server

```bash
# Production mode
npm start

# Development mode (auto-restarts on file changes)
npm run dev
```

### 4. Link Your WhatsApp Account

When the server starts for the first time, a **QR code** will appear in your terminal:

1. Open **WhatsApp** on your phone.
2. Go to **Settings** (or **⋮**) → **Linked Devices** → **Link a Device**.
3. Scan the QR code displayed in your terminal.

> [!TIP]
> **Running headlessly?** You can also download the QR code as a PNG image from the API:
> ```bash
> curl -H "x-api-key: YOUR_API_KEY" http://localhost:3000/api/session/qr -o qr.png
> ```

### 💻 Windows Auto-Start & Public Tunnel (Optional)
Want to run this API on a Windows laptop so it launches automatically at power-on and exposes a public HTTPS URL via **Tailscale Funnel**? Follow the step-by-step guide in [`setup/HOW-TO-SETUP.md`](setup/HOW-TO-SETUP.md) and run the numbered files in the `setup/` folder.

---

## ⚙️ Configuration

Edit your `.env` file to match your environment:

| Variable | Description | Example |
| :--- | :--- | :--- |
| `PORT` | Port the HTTP server listens on | `3000` |
| `API_KEY` | Secret key required to authorize `/api/*` requests | `your-strong-random-key` |
| `DEFAULT_COUNTRY_CODE` | Country code prepended when local numbers (e.g., `0300...`) are passed | `92` |
| `SEND_DELAY_MS` | Base delay (in milliseconds) between queued outgoing messages | `1500` |
| `WEBHOOK_URL` | Public URL where incoming message and status events are sent | `https://yourapp.com/webhook` |
| `WEBHOOK_SECRET` | Secret key used to sign webhook payloads (`x-signature`) | `whsec_your_secret` |
| `CHROME_PATH` | Optional custom path to an installed Chrome/Chromium executable | `/usr/bin/google-chrome` |

---

## 🔐 Authentication

All `/api/*` routes require your `API_KEY`. You can provide it in three ways:

1. **`x-api-key` Header (Recommended):**
   ```http
   x-api-key: YOUR_API_KEY
   ```
2. **`Authorization` Bearer Header:**
   ```http
   Authorization: Bearer YOUR_API_KEY
   ```
3. **Query Parameter (For quick browser testing only):**
   ```text
   http://localhost:3000/api/session/status?api_key=YOUR_API_KEY
   ```

> [!NOTE]
> Always use HTTP headers in production scripts and apps. Query parameters can be saved in browser history and reverse-proxy access logs. The server automatically redacts your key from its own Pino logs.

---

## 📡 API Reference

### Endpoints Overview

| Method | Endpoint | Auth | Description |
| :--- | :--- | :---: | :--- |
| `GET` | `/health` | Public | Health check (`200` when ready, `503` if disconnected) |
| `GET` | `/api/session/status` | Required | Returns connection state, linked phone number, and queue size |
| `GET` | `/api/session/qr` | Required | Returns the login QR code as a PNG (`?format=json` for Data URL) |
| `POST` | `/api/session/restart` | Required | Restarts the underlying WhatsApp Web browser session |
| `POST` | `/api/session/logout` | Required | Unlinks the current device and generates a fresh QR code |
| `GET` | `/api/numbers/:number` | Required | Checks if a phone number has an active WhatsApp account |
| `POST` | `/api/messages/text` | Required | Queues and sends a text message (or reply) |
| `POST` | `/api/messages/media` | Required | Queues and sends an image, video, audio, or document |

---

### 1. Check Session Status

```bash
curl -H "x-api-key: YOUR_API_KEY" http://localhost:3000/api/session/status
```

---

### 2. Verify a WhatsApp Number

Checks if a number is registered on WhatsApp (cached for 24 hours):

```bash
curl -H "x-api-key: YOUR_API_KEY" http://localhost:3000/api/numbers/923001234567
```

---

### 3. Send a Text Message

```bash
curl -X POST http://localhost:3000/api/messages/text \
  -H "x-api-key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "to": "923001234567",
    "message": "Hello from the WhatsApp API 🚀"
  }'
```

**Success Response (`200` / `201`):**
```json
{
  "success": true,
  "data": {
    "id": "true_923001234567@c.us_3EB0...",
    "to": "923001234567@c.us",
    "timestamp": 1760375000
  }
}
```

#### Request Body Fields
| Field | Type | Required | Description |
| :--- | :--- | :---: | :--- |
| `to` | `string` | Yes | Accepts `923001234567`, `+92 300 1234567`, `0092...`, or local `03001234567` (when `DEFAULT_COUNTRY_CODE=92`). Also accepts group IDs like `120363...@g.us`. |
| `message` | `string` | Yes | The text content to send. |
| `quotedMessageId` | `string` | No | Message ID to quote/reply to directly. |

---

### 4. Send Media (Image, Video, Audio, Document)

#### Option A: Send from a Public URL
```bash
curl -X POST http://localhost:3000/api/messages/media \
  -H "x-api-key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "to": "923001234567",
    "url": "[https://example.com/invoice.pdf](https://example.com/invoice.pdf)",
    "caption": "Here is your invoice 📄",
    "asDocument": true
  }'
```

#### Option B: Send from Base64
```bash
curl -X POST http://localhost:3000/api/messages/media \
  -H "x-api-key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "to": "923001234567",
    "base64": "<BASE64_ENCODED_DATA>",
    "mimetype": "image/png",
    "filename": "photo.png",
    "caption": "Sent via Base64"
  }'
```

---

### 5. Error Responses

All errors follow a consistent JSON structure:

```json
{
  "success": false,
  "error": {
    "code": "NOT_ON_WHATSAPP",
    "message": "923001234567 is not registered on WhatsApp."
  }
}
```

| Error Code | HTTP Status | Meaning |
| :--- | :---: | :--- |
| `VALIDATION_ERROR`, `INVALID_NUMBER`, `INVALID_JSON` | `400` | Invalid request payload or malformed phone number |
| `UNAUTHORIZED` | `401` | Missing or invalid `API_KEY` |
| `NOT_ON_WHATSAPP` | `404` | The target phone number does not have a WhatsApp account |
| `MEDIA_DOWNLOAD_FAILED` | `422` | Could not download the file from the provided `url` |
| `RATE_LIMITED`, `QUEUE_FULL` | `429` | Too many requests or outgoing queue is full; retry later |
| `SEND_UNCONFIRMED` | `502` | WhatsApp did not confirm delivery; verify chat before retrying |
| `NOT_READY` | `503` | WhatsApp session is disconnected; check `/api/session/status` |
| `TIMEOUT` | `504` | WhatsApp Web did not respond within the timeout window |

---

## 🔔 Webhooks

Set `WEBHOOK_URL` in your `.env` file to receive real-time HTTP `POST` events whenever activity occurs on your account.

### Supported Events

| Event Name | Triggered When |
| :--- | :--- |
| `message.received` | A new incoming message arrives (direct chat or group) |
| `message.ack` | An outgoing message status updates (`sent`, `delivered`, `read`, or `played`) |
| `session.ready` | WhatsApp Web connects and is ready to send/receive |
| `session.disconnected` | The WhatsApp Web session disconnects |

### Sample Webhook Payload

```json
{
  "event": "message.received",
  "data": {
    "id": "false_923001234567@c.us_3EB0...",
    "from": "923001234567@c.us",
    "body": "Hi there!",
    "type": "chat",
    "isGroup": false
  },
  "timestamp": 1760375000000
}
```

> **Automatic Retries:** If your webhook endpoint returns a `5xx`, `429`, or encounters a network error, the API automatically retries delivery up to **4 times** with exponential backoff.

### Verifying Webhook Signatures (Security)

If `WEBHOOK_SECRET` is configured, every webhook request includes an `x-signature` header (`sha256=<hmac>`). Verify it against the raw request body before processing:

```javascript
const crypto = require('crypto');

function isValidSignature(rawBody, signatureHeader, secret) {
  const expected = 'sha256=' + crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(signatureHeader),
    Buffer.from(expected)
  );
}
```

---

## 🏭 Production Deployment

Use **PM2** to keep the API running in the background and automatically restart it on crashes or server reboots:

```bash
npm install -g pm2
pm2 start ecosystem.config.js
pm2 save && pm2 startup
```

### Production Best Practices
* **Single Instance Only:** Always run **one process per WhatsApp number**. Never enable PM2 cluster mode—WhatsApp Web sessions cannot be shared across multiple processes.
* **Use HTTPS:** Place the API behind a reverse proxy such as **Nginx**, **Caddy**, or **Tailscale Funnel** so your `API_KEY` is encrypted in transit.
* **Protect Session Data:** Keep `.env` and `.wwebjs_auth/` strictly private and excluded from version control. Anyone with access to `.wwebjs_auth/` has full access to your WhatsApp account.
* **Linux Server Dependencies:** On minimal Linux distributions (Ubuntu/Debian), install Chromium's required shared libraries or point `CHROME_PATH` to an existing Chrome installation.

---

> [!WARNING]
> **Unofficial Client Notice:** `whatsapp-web.js` automates WhatsApp Web and is **not** affiliated with or endorsed by WhatsApp. WhatsApp actively bans accounts used for spam, bulk messaging, or unsolicited outreach. Keep `SEND_DELAY_MS` at a safe interval and only message recipients who expect to hear from you.
>
> For high-volume or mission-critical business messaging, use the official **[WhatsApp Business Cloud API](https://developers.facebook.com/docs/whatsapp/cloud-api)**.