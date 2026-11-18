const crypto = require('node:crypto');
const config = require('./config');
const logger = require('./logger');
const { sleep } = require('./errors');

const MAX_ATTEMPTS = 4;

async function sendWebhook(event, data) {
    if (!config.webhookUrl) return;

    const body = JSON.stringify({ event, data, timestamp: Date.now() });
    const headers = { 'content-type': 'application/json', 'user-agent': 'whatsapp-api/1.0' };
    if (config.webhookSecret) {
        headers['x-signature'] = 'sha256=' + crypto.createHmac('sha256', config.webhookSecret).update(body).digest('hex');
    }

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
            const res = await fetch(config.webhookUrl, {
                method: 'POST',
                headers,
                body,
                signal: AbortSignal.timeout(10000),
            });
            if (res.ok) return;
            // 4xx (except 429) means the receiver rejected it; retrying will not help.
            if (res.status < 500 && res.status !== 429) {
                logger.warn({ event, status: res.status }, 'Webhook rejected');
                return;
            }
            throw new Error(`HTTP ${res.status}`);
        } catch (err) {
            if (attempt === MAX_ATTEMPTS) {
                logger.error({ event, err: err.message }, 'Webhook delivery failed');
                return;
            }
            await sleep(1000 * 2 ** (attempt - 1));
        }
    }
}

// Fire-and-forget so slow receivers never block WhatsApp event handling.
const emitWebhook = (event, data) => {
    sendWebhook(event, data).catch((err) => logger.error({ err }, 'Webhook error'));
};

module.exports = { emitWebhook };
