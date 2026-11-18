require('dotenv').config({ quiet: true });

const int = (value, fallback) => {
    const n = Number.parseInt(value, 10);
    return Number.isFinite(n) ? n : fallback;
};

const config = {
    env: process.env.NODE_ENV || 'development',
    port: int(process.env.PORT, 3000),
    host: process.env.HOST || '0.0.0.0',
    apiKey: process.env.API_KEY || '',
    logLevel: process.env.LOG_LEVEL || 'info',

    // WhatsApp session
    clientId: process.env.CLIENT_ID || 'default',
    sessionDir: process.env.SESSION_DIR || './.wwebjs_auth',
    chromePath: process.env.CHROME_PATH || undefined,
    headless: process.env.HEADLESS !== 'false',
    defaultCountryCode: (process.env.DEFAULT_COUNTRY_CODE || '').replace(/\D/g, ''),

    // Sending (throttling protects the number from being flagged as spam)
    sendDelayMs: int(process.env.SEND_DELAY_MS, 1000),
    sendJitterMs: int(process.env.SEND_JITTER_MS, 500),
    sendTimeoutMs: int(process.env.SEND_TIMEOUT_MS, 30000),
    maxQueueSize: int(process.env.MAX_QUEUE_SIZE, 1000),
    maxBodySize: process.env.MAX_BODY_SIZE || '25mb',

    // HTTP protection
    rateLimitPerMinute: int(process.env.RATE_LIMIT_PER_MINUTE, 120),

    // Health watchdog
    watchdogIntervalMs: int(process.env.WATCHDOG_INTERVAL_MS, 60000),

    // Incoming events
    webhookUrl: process.env.WEBHOOK_URL || '',
    webhookSecret: process.env.WEBHOOK_SECRET || '',
};

if (!config.apiKey || config.apiKey.length < 16) {
    console.error('API_KEY is missing or shorter than 16 characters. Set it in .env (see .env.example).');
    process.exit(1);
}

module.exports = config;
