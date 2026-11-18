const express = require('express');
const wa = require('./whatsapp');
const { AppError } = require('./errors');

const router = express.Router();

// ---------- validation helpers ----------

function requireString(body, field, { max = 4096, optional = false } = {}) {
    const value = body?.[field];
    if (value === undefined || value === null || value === '') {
        if (optional) return undefined;
        throw new AppError(400, 'VALIDATION_ERROR', `"${field}" is required.`);
    }
    if (typeof value !== 'string' && typeof value !== 'number') {
        throw new AppError(400, 'VALIDATION_ERROR', `"${field}" must be a string.`);
    }
    const str = String(value);
    if (str.length > max) {
        throw new AppError(400, 'VALIDATION_ERROR', `"${field}" must be at most ${max} characters.`);
    }
    return str;
}

function requireHttpUrl(value) {
    let url;
    try {
        url = new URL(value);
    } catch {
        throw new AppError(400, 'VALIDATION_ERROR', '"url" must be a valid URL.');
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new AppError(400, 'VALIDATION_ERROR', '"url" must use http or https.');
    }
    return url.toString();
}

// ---------- session ----------

router.get('/session/status', (req, res) => {
    res.json({ success: true, data: wa.status() });
});

router.get('/session/qr', async (req, res) => {
    if (wa.isReady) {
        throw new AppError(409, 'ALREADY_CONNECTED', 'Session is already connected; no QR code needed.');
    }
    if (req.query.format === 'json') {
        const qr = await wa.qrDataUrl();
        if (!qr) throw new AppError(404, 'QR_NOT_AVAILABLE', `No QR code yet (state: ${wa.state}). Retry in a few seconds.`);
        return res.json({ success: true, data: { qr } });
    }
    const png = await wa.qrPng();
    if (!png) throw new AppError(404, 'QR_NOT_AVAILABLE', `No QR code yet (state: ${wa.state}). Retry in a few seconds.`);
    res.set('cache-control', 'no-store').type('png').send(png);
});

router.post('/session/restart', async (req, res) => {
    wa.restart();
    res.status(202).json({ success: true, data: { message: 'Restart initiated.' } });
});

router.post('/session/logout', async (req, res) => {
    await wa.logout();
    res.json({ success: true, data: { message: 'Logged out. Scan the new QR code to link again.' } });
});

// ---------- contacts ----------

router.get('/numbers/:number', async (req, res) => {
    const chatId = await wa.lookupNumber(req.params.number);
    res.json({ success: true, data: { exists: !!chatId, chatId } });
});

// ---------- messages ----------

router.post('/messages/text', async (req, res) => {
    const to = requireString(req.body, 'to', { max: 100 });
    const message = requireString(req.body, 'message', { max: 65536 });
    const quotedMessageId = requireString(req.body, 'quotedMessageId', { max: 200, optional: true });

    const result = await wa.sendText(to, message, { quotedMessageId });
    res.status(201).json({ success: true, data: result });
});

router.post('/messages/media', async (req, res) => {
    const body = req.body ?? {};
    const to = requireString(body, 'to', { max: 100 });
    const caption = requireString(body, 'caption', { max: 4096, optional: true });
    const filename = requireString(body, 'filename', { max: 255, optional: true });
    const quotedMessageId = requireString(body, 'quotedMessageId', { max: 200, optional: true });
    const asDocument = body.asDocument === true;

    let media;
    if (body.url) {
        media = { url: requireHttpUrl(requireString(body, 'url', { max: 2048 })) };
    } else if (body.base64) {
        media = {
            base64: requireString(body, 'base64', { max: 100 * 1024 * 1024 }),
            mimetype: requireString(body, 'mimetype', { max: 255 }),
        };
    } else {
        throw new AppError(400, 'VALIDATION_ERROR', 'Provide either "url" or "base64" + "mimetype".');
    }

    const result = await wa.sendMedia(to, { ...media, filename, caption, asDocument, quotedMessageId });
    res.status(201).json({ success: true, data: result });
});

module.exports = router;
