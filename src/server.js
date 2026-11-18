const crypto = require('node:crypto');
const express = require('express');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const pinoHttp = require('pino-http');
const config = require('./config');
const logger = require('./logger');
const wa = require('./whatsapp');
const routes = require('./routes');
const { AppError } = require('./errors');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use(helmet());
app.use(
    pinoHttp({
        logger,
        autoLogging: { ignore: (req) => req.url === '/health' },
        customLogLevel: (req, res, err) => (err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'),
        serializers: {
            // Keep the ?api_key= value out of the logs (headers are redacted in logger.js).
            req: (req) => {
                if (req.url) req.url = req.url.replace(/([?&]api_key=)[^&]*/gi, '$1[Redacted]');
                if (req.query?.api_key !== undefined) req.query = { ...req.query, api_key: '[Redacted]' };
                return req;
            },
        },
    }),
);
app.use(express.json({ limit: config.maxBodySize }));

// Public liveness/readiness probe (no secrets exposed).
app.get('/health', (req, res) => {
    res.status(wa.isReady ? 200 : 503).json({ status: wa.isReady ? 'ok' : 'unavailable', state: wa.state });
});

const expectedKey = crypto.createHash('sha256').update(config.apiKey).digest();

function authenticate(req, res, next) {
    const header = req.get('authorization');
    const queryKey = typeof req.query.api_key === 'string' ? req.query.api_key : '';
    const provided = req.get('x-api-key') || (header?.startsWith('Bearer ') ? header.slice(7) : '') || queryKey;
    const providedHash = crypto.createHash('sha256').update(provided || '').digest();
    if (!provided || !crypto.timingSafeEqual(providedHash, expectedKey)) {
        return next(new AppError(401, 'UNAUTHORIZED', 'Missing or invalid API key.'));
    }
    next();
}

app.use(
    '/api',
    rateLimit({
        windowMs: 60 * 1000,
        limit: config.rateLimitPerMinute,
        standardHeaders: 'draft-7',
        legacyHeaders: false,
        handler: (req, res, next) => next(new AppError(429, 'RATE_LIMITED', 'Too many requests, slow down.')),
    }),
    authenticate,
    routes,
);

app.use((req, res, next) => next(new AppError(404, 'NOT_FOUND', `Route ${req.method} ${req.path} not found.`)));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') err = new AppError(400, 'INVALID_JSON', 'Request body is not valid JSON.');
    if (err.type === 'entity.too.large') err = new AppError(413, 'PAYLOAD_TOO_LARGE', `Body exceeds ${config.maxBodySize}.`);

    const isKnown = err instanceof AppError;
    const status = isKnown ? err.status : 500;
    if (!isKnown) req.log.error({ err }, 'Unhandled error');

    res.status(status).json({
        success: false,
        error: {
            code: isKnown ? err.code : 'INTERNAL_ERROR',
            message: isKnown ? err.message : 'Something went wrong while processing the request.',
            ...(isKnown && err.details ? { details: err.details } : {}),
        },
    });
});

const server = app.listen(config.port, config.host, () => {
    logger.info(`WhatsApp API listening on http://${config.host}:${config.port}`);
});
server.on('error', (err) => {
    logger.fatal({ err: err.message }, err.code === 'EADDRINUSE' ? `Port ${config.port} is already in use` : 'HTTP server error');
    process.exit(1);
});

wa.start().catch((err) => logger.error({ err }, 'WhatsApp start failed'));

let shuttingDown = false;
async function shutdown(signal, exitCode = 0) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down');
    const force = setTimeout(() => process.exit(1), 20000).unref();
    server.close();
    await wa.stop();
    clearTimeout(force);
    process.exit(exitCode);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (err) => logger.error({ err }, 'Unhandled promise rejection'));
process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'Uncaught exception');
    shutdown('uncaughtException', 1);
});
