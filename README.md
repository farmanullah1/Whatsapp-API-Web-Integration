# WhatsApp API

REST API for sending WhatsApp messages, built on [whatsapp-web.js](https://github.com/pedroslopez/whatsapp-web.js).

**Features**
- Send text and media (from a URL or base64), reply to a message, and send to groups
- Check whether a number is on WhatsApp (results cached for 24 hours)
- Sends one message at a time, with a gap and random jitter between messages to lower the risk of a ban
- Reconnects automatically with exponential backoff, and a watchdog restarts the browser if it freezes
- The session persists, so you scan the QR code only once
- Webhooks for incoming messages and delivery or read receipts, signed with HMAC
- API key auth (timing-safe), rate limiting, helmet, structured logs (pino), and graceful shutdown

## Setup

```bash
npm install
cp .env.example .env      # then set API_KEY (a key is already generated if .env exists)
npm start                 # production
npm run dev               # auto-reload on changes
```

On first start, a QR code prints in the terminal. Scan it with **WhatsApp → Linked devices → Link a device**.
You can also download it as an image:

```bash
curl -H "x-api-key: $API_KEY" http://localhost:3000/api/session/qr -o qr.png
```

To run it on a Windows laptop that starts the API at power-on and serves it publicly through Tailscale Funnel, double-click the numbered files in [`setup/`](setup/HOW-TO-SETUP.md).

## Authentication

Send `x-api-key: <API_KEY>` or `Authorization: Bearer <API_KEY>` on every `/api/*` request.

For quick checks from a browser, you can pass the key as a query parameter instead, for example `/api/session/status?api_key=<API_KEY>`.
Prefer the headers for anything automated: URLs end up in browser history and proxy logs. The app redacts the key from its own logs.

## Endpoints

| Method | Path | Description |
|---|---|---|
| GET  | `/health` | Public probe: returns 200 when ready, 503 otherwise |
| GET  | `/api/session/status` | Connection state, linked number, queue size |
| GET  | `/api/session/qr` | QR code as PNG (`?format=json` returns a data URL) |
| POST | `/api/session/restart` | Restart the browser session |
| POST | `/api/session/logout` | Unlink the device and generate a new QR code |
| GET  | `/api/numbers/:number` | Check whether a number is on WhatsApp |
| POST | `/api/messages/text` | Send a text message |
| POST | `/api/messages/media` | Send an image, video, audio, or document |

### Send text

```bash
curl -X POST http://localhost:3000/api/messages/text \
  -H "x-api-key: $API_KEY" -H "content-type: application/json" \
  -d '{"to": "923001234567", "message": "Hello from the API 🚀"}'
```

```json
{ "success": true, "data": { "id": "true_923001234567@c.us_3EB0...", "to": "923001234567@c.us", "timestamp": 1760375000 } }
```

`to` accepts `923001234567`, `+92 300 1234567`, `0092...`, or `03001234567` (when `DEFAULT_COUNTRY_CODE=92`).
It also accepts a raw chat ID such as `120363...@g.us` for groups. Optional field: `quotedMessageId`, to reply to a message.

### Send media

```bash
# from URL
curl -X POST http://localhost:3000/api/messages/media \
  -H "x-api-key: $API_KEY" -H "content-type: application/json" \
  -d '{"to": "923001234567", "url": "https://example.com/invoice.pdf", "caption": "Your invoice", "asDocument": true}'

# from base64
-d '{"to": "923001234567", "base64": "<data>", "mimetype": "image/png", "filename": "photo.png", "caption": "Hi"}'
```

### Errors

Every error uses the same shape:

```json
{ "success": false, "error": { "code": "NOT_ON_WHATSAPP", "message": "923001234567 is not registered on WhatsApp." } }
```

| Code | HTTP | Meaning |
|---|---|---|
| `VALIDATION_ERROR`, `INVALID_NUMBER`, `INVALID_JSON` | 400 | Bad input |
| `UNAUTHORIZED` | 401 | Missing or invalid API key |
| `NOT_ON_WHATSAPP` | 404 | The number has no WhatsApp account |
| `MEDIA_DOWNLOAD_FAILED` | 422 | Could not fetch the media URL |
| `RATE_LIMITED`, `QUEUE_FULL` | 429 | Slow down and retry |
| `NOT_READY` | 503 | Session not connected; check `/api/session/status` |
| `SEND_UNCONFIRMED` | 502 | WhatsApp did not confirm the send; check the chat before retrying |
| `TIMEOUT` | 504 | WhatsApp did not respond in time |

## Webhooks

Set `WEBHOOK_URL` to receive a `POST` for each of these events:

```json
{ "event": "message.received", "data": { "id": "...", "from": "923001234567@c.us", "body": "Hi", "type": "chat", "isGroup": false }, "timestamp": 1760375000000 }
```

Events: `message.received`, `message.ack` (`sent` / `delivered` / `read` / `played`), `session.ready`, `session.disconnected`.
Failed deliveries are retried up to 4 times with backoff on 5xx, 429, and network errors.
If `WEBHOOK_SECRET` is set, verify the `x-signature: sha256=<hmac>` header:

```js
const expected = 'sha256=' + crypto.createHmac('sha256', SECRET).update(rawBody).digest('hex');
```

## Production

```bash
npm i -g pm2
pm2 start ecosystem.config.js
pm2 save && pm2 startup
```

- Run **one process per WhatsApp number**. Do not use cluster mode, because a session cannot be shared.
- Put the API behind HTTPS (nginx or Caddy), and keep `.env` and `.wwebjs_auth/` private. The session folder gives full access to the account.
- On Linux servers, Chromium needs its system libraries. Alternatively, set `CHROME_PATH` to an installed Chrome.

## Important

whatsapp-web.js is an **unofficial** client that automates WhatsApp Web. WhatsApp may ban numbers used for bulk or unsolicited messaging.
Keep `SEND_DELAY_MS` reasonable, and message only people who expect to hear from you.
For high-volume or business-critical messaging, use the official [WhatsApp Business Cloud API](https://developers.facebook.com/docs/whatsapp/cloud-api).
