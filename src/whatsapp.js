const { execFile } = require('node:child_process');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcodeTerminal = require('qrcode-terminal');
const QRCode = require('qrcode');
const config = require('./config');
const logger = require('./logger').child({ module: 'whatsapp' });
const SendQueue = require('./queue');
const { emitWebhook } = require('./webhook');
const { AppError, withTimeout } = require('./errors');
const { normalizePhone, isChatId } = require('./phone');

const STATE = {
    STOPPED: 'STOPPED',
    INITIALIZING: 'INITIALIZING',
    QR: 'WAITING_FOR_QR_SCAN',
    AUTHENTICATED: 'AUTHENTICATED',
    READY: 'READY',
    DISCONNECTED: 'DISCONNECTED',
    AUTH_FAILURE: 'AUTH_FAILURE',
};

const NUMBER_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const NUMBER_CACHE_MAX = 10000;
const MAX_RECONNECT_DELAY_MS = 60000;

class WhatsAppService {
    constructor() {
        this.client = null;
        this.state = STATE.STOPPED;
        this.qr = null;
        this.readySince = null;
        this.lastDisconnectReason = null;
        this.reconnectAttempts = 0;
        this.reconnectTimer = null;
        this.watchdogTimer = null;
        this.watchdogFailures = 0;
        this.restarting = null;
        this.stopping = false;
        this.numberCache = new Map();
        this.queue = new SendQueue({
            delayMs: config.sendDelayMs,
            jitterMs: config.sendJitterMs,
            maxSize: config.maxQueueSize,
        });
    }

    // ---------- lifecycle ----------

    async start() {
        this.stopping = false;
        this.#createClient();
        await this.#initialize();
        this.#startWatchdog();
    }

    async stop() {
        this.stopping = true;
        clearTimeout(this.reconnectTimer);
        clearInterval(this.watchdogTimer);
        this.queue.clear(new AppError(503, 'SHUTTING_DOWN', 'Server is shutting down.'));
        await this.#destroyClient();
        this.state = STATE.STOPPED;
    }

    restart() {
        // Collapse concurrent restart requests into one.
        if (!this.restarting) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
            this.restarting = (async () => {
                logger.info('Restarting WhatsApp client');
                await this.#destroyClient();
                if (this.stopping) return;
                this.#createClient();
                await this.#initialize();
            })().finally(() => {
                this.restarting = null;
            });
        }
        return this.restarting;
    }

    async logout() {
        if (this.client && this.state === STATE.READY) {
            await withTimeout(this.client.logout(), 30000, 'Logout').catch((err) =>
                logger.warn({ err: err.message }, 'Logout did not complete cleanly'),
            );
        }
        this.numberCache.clear();
        await this.restart();
    }

    #createClient() {
        const client = new Client({
            authStrategy: new LocalAuth({ clientId: config.clientId, dataPath: config.sessionDir }),
            takeoverOnConflict: true,
            takeoverTimeoutMs: 10000,
            puppeteer: {
                headless: config.headless,
                executablePath: config.chromePath,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-gpu',
                    '--disable-extensions',
                    '--no-first-run',
                    '--no-default-browser-check',
                ],
            },
        });

        client.on('qr', (qr) => {
            this.state = STATE.QR;
            this.qr = qr;
            logger.info('QR code received - scan it with WhatsApp > Linked devices (or GET /api/session/qr)');
            qrcodeTerminal.generate(qr, { small: true });
        });

        client.on('authenticated', () => {
            this.state = STATE.AUTHENTICATED;
            this.qr = null;
            logger.info('Authenticated');
        });

        client.on('auth_failure', (msg) => {
            this.state = STATE.AUTH_FAILURE;
            logger.error({ msg }, 'Authentication failed - session will be reset');
            this.#scheduleReconnect();
        });

        client.on('ready', async () => {
            await patchMsgKey(client);
            this.state = STATE.READY;
            this.qr = null;
            this.readySince = new Date();
            this.reconnectAttempts = 0;
            this.watchdogFailures = 0;
            logger.info({ number: client.info?.wid?.user, name: client.info?.pushname }, 'WhatsApp is ready');
            emitWebhook('session.ready', { number: client.info?.wid?.user });
        });

        client.on('change_state', (state) => logger.info({ state }, 'Connection state changed'));

        client.on('disconnected', (reason) => {
            if (this.client !== client) return; // stale event from a client we already replaced
            this.state = STATE.DISCONNECTED;
            this.readySince = null;
            this.lastDisconnectReason = reason;
            logger.warn({ reason }, 'Disconnected');
            emitWebhook('session.disconnected', { reason });
            this.#scheduleReconnect();
        });

        client.on('message', (msg) => {
            if (msg.from === 'status@broadcast') return;
            emitWebhook('message.received', serializeMessage(msg));
        });

        client.on('message_ack', (msg, ack) => {
            emitWebhook('message.ack', { id: messageId(msg), to: msg.to, ack, status: ackName(ack) });
        });

        this.client = client;
    }

    async #initialize() {
        this.state = STATE.INITIALIZING;
        try {
            await this.client.initialize();
        } catch (err) {
            logger.error({ err: err.message }, 'Failed to initialize WhatsApp client');
            this.state = STATE.DISCONNECTED;
            this.#scheduleReconnect();
        }
    }

    async #destroyClient() {
        const client = this.client;
        this.client = null;
        this.readySince = null;
        if (!client) return;
        client.removeAllListeners();
        const browserProcess = client.pupBrowser?.process();
        await withTimeout(client.destroy(), 15000, 'Browser shutdown').catch((err) =>
            logger.warn({ err: err.message }, 'Client destroy failed'),
        );
        // A browser left running keeps the session folder locked, and every reconnect after that fails.
        if (browserProcess && browserProcess.exitCode === null && browserProcess.signalCode === null) {
            logger.warn({ pid: browserProcess.pid }, 'Browser still running after destroy - killing it');
            await killProcessTree(browserProcess);
        }
    }

    #scheduleReconnect() {
        if (this.stopping || this.reconnectTimer) return;
        const delay = Math.min(MAX_RECONNECT_DELAY_MS, 2000 * 2 ** this.reconnectAttempts++);
        logger.info({ delayMs: delay, attempt: this.reconnectAttempts }, 'Scheduling reconnect');
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.restart().catch((err) => logger.error({ err: err.message }, 'Restart failed'));
        }, delay);
    }

    // Detects a silently frozen browser tab, which otherwise never emits "disconnected".
    #startWatchdog() {
        if (!config.watchdogIntervalMs) return;
        clearInterval(this.watchdogTimer);
        this.watchdogTimer = setInterval(async () => {
            if (this.state !== STATE.READY || !this.client || this.restarting) return;
            try {
                const state = await withTimeout(this.client.getState(), 15000, 'Health check');
                this.watchdogFailures = state === 'CONNECTED' ? 0 : this.watchdogFailures + 1;
                if (state !== 'CONNECTED') logger.warn({ state }, 'Health check: not connected');
            } catch (err) {
                this.watchdogFailures++;
                logger.warn({ err: err.message }, 'Health check failed');
            }
            if (this.watchdogFailures >= 3) {
                this.watchdogFailures = 0;
                this.restart().catch((err) => logger.error({ err: err.message }, 'Restart failed'));
            }
        }, config.watchdogIntervalMs);
        this.watchdogTimer.unref();
    }

    // ---------- status ----------

    get isReady() {
        return this.state === STATE.READY && !!this.client;
    }

    ensureReady() {
        if (!this.isReady) {
            throw new AppError(503, 'NOT_READY', `WhatsApp is not ready (state: ${this.state}).`, { state: this.state });
        }
    }

    status() {
        const info = this.isReady ? this.client.info : null;
        return {
            state: this.state,
            ready: this.isReady,
            number: info?.wid?.user ?? null,
            name: info?.pushname ?? null,
            readySince: this.readySince,
            lastDisconnectReason: this.lastDisconnectReason,
            queueSize: this.queue.size,
            hasQr: !!this.qr,
        };
    }

    async qrPng() {
        if (!this.qr) return null;
        return QRCode.toBuffer(this.qr, { width: 400, margin: 2 });
    }

    async qrDataUrl() {
        if (!this.qr) return null;
        return QRCode.toDataURL(this.qr, { width: 400, margin: 2 });
    }

    // ---------- messaging ----------

    async lookupNumber(input) {
        this.ensureReady();
        const number = normalizePhone(input, config.defaultCountryCode);

        const cached = this.numberCache.get(number);
        if (cached && cached.expires > Date.now()) return cached.chatId;

        const id = await withTimeout(this.client.getNumberId(number), 15000, 'Number lookup');
        // The lookup may answer with a privacy id (xxx@lid). whatsapp-web.js cannot open a new
        // chat from an @lid id, so always address the phone number; WhatsApp maps it internally.
        const chatId = id ? `${number}@c.us` : null;

        if (this.numberCache.size >= NUMBER_CACHE_MAX) {
            this.numberCache.delete(this.numberCache.keys().next().value);
        }
        this.numberCache.set(number, { chatId, expires: Date.now() + NUMBER_CACHE_TTL_MS });
        return chatId;
    }

    async resolveChatId(to) {
        if (isChatId(to)) return String(to).trim();
        const chatId = await this.lookupNumber(to);
        if (!chatId) {
            throw new AppError(404, 'NOT_ON_WHATSAPP', `${to} is not registered on WhatsApp.`);
        }
        return chatId;
    }

    async sendText(to, text, { quotedMessageId } = {}) {
        this.ensureReady();
        const chatId = await this.resolveChatId(to);
        return this.#enqueueSend(chatId, text, { quotedMessageId });
    }

    async sendMedia(to, { url, base64, mimetype, filename, caption, asDocument, quotedMessageId }) {
        this.ensureReady();
        const chatId = await this.resolveChatId(to);

        // Download/prepare outside the queue so slow downloads do not block other sends.
        let media;
        if (url) {
            media = await withTimeout(
                MessageMedia.fromUrl(url, { unsafeMime: true, filename }),
                config.sendTimeoutMs,
                'Media download',
            ).catch((err) => {
                if (err instanceof AppError) throw err;
                throw new AppError(422, 'MEDIA_DOWNLOAD_FAILED', `Could not download media: ${err.message}`);
            });
        } else {
            media = new MessageMedia(mimetype, base64.replace(/^data:[^;]+;base64,/, ''), filename || null);
        }

        return this.#enqueueSend(chatId, media, {
            caption,
            sendMediaAsDocument: !!asDocument,
            quotedMessageId,
        });
    }

    #enqueueSend(chatId, content, options) {
        return this.queue.push(async () => {
            this.ensureReady(); // the connection may have dropped while this job was waiting
            const startedAt = Math.floor(Date.now() / 1000);
            let msg = await withTimeout(
                this.client.sendMessage(chatId, content, stripUndefined(options)),
                config.sendTimeoutMs,
                'Send',
            );

            // whatsapp-web.js returns undefined when it cannot find the message it just sent
            // (common when WhatsApp keys the chat by @lid), or when the chat could not be opened.
            if (!msg) {
                msg = await this.#findSentMessage(chatId, content, startedAt);
                if (!msg) {
                    throw new AppError(502, 'SEND_UNCONFIRMED', 'WhatsApp did not confirm the message. Check the chat before retrying to avoid duplicates.');
                }
                logger.debug({ chatId, id: messageId(msg) }, 'Send confirmed via chat history');
            }
            return { id: messageId(msg), to: chatId, timestamp: msg.timestamp };
        });
    }

    async #findSentMessage(chatId, content, startedAt) {
        try {
            const chat = await withTimeout(this.client.getChatById(chatId), 10000, 'Chat lookup');
            const recent = await withTimeout(chat.fetchMessages({ limit: 10, fromMe: true }), 10000, 'History lookup');
            const isText = typeof content === 'string';
            return (
                recent
                    .reverse()
                    .find((m) => m.timestamp >= startedAt - 5 && (isText ? m.body === content : m.hasMedia)) ?? null
            );
        } catch (err) {
            logger.warn({ chatId, err: err.message }, 'Could not verify sent message');
            return null;
        }
    }
}

/**
 * Newer WhatsApp Web builds (2.3000.1043+) dropped MsgKey._serialized. whatsapp-web.js 1.34.7
 * relies on it to look up a message right after sending, so sendMessage() resolves to undefined
 * even though the message was delivered. Restore it as a getter (same approach as upstream
 * PR wwebjs/whatsapp-web.js#201901). Runs on every "ready" because a page reload drops it.
 */
async function patchMsgKey(client) {
    try {
        const patched = await client.pupPage.evaluate(() => {
            const proto = window.require('WAWebMsgKey')?.prototype;
            if (!proto || '_serialized' in proto) return false;
            Object.defineProperty(proto, '_serialized', {
                configurable: true,
                get() {
                    return this.toString();
                },
                set(value) {
                    Object.defineProperty(this, '_serialized', { value, writable: true, enumerable: true, configurable: true });
                },
            });
            return true;
        });
        if (patched) logger.info('Applied MsgKey._serialized compatibility patch');
    } catch (err) {
        logger.warn({ err: err.message }, 'Could not apply MsgKey compatibility patch');
    }
}

/** Message id as a string, tolerating keys that arrive without _serialized. */
function messageId(msg) {
    const id = msg?.id;
    if (!id) return null;
    if (typeof id === 'string') return id;
    if (id._serialized) return id._serialized;
    if (typeof id.$1 === 'string') return id.$1;
    const wid = (w) => (typeof w === 'string' ? w : w?._serialized || (w?.user ? `${w.user}@${w.server}` : ''));
    const parts = [String(!!id.fromMe), wid(id.remote), id.id];
    if (id.participant) parts.push(wid(id.participant));
    return parts.join('_');
}

function serializeMessage(msg) {
    return {
        id: messageId(msg),
        from: msg.from,
        to: msg.to,
        author: msg.author ?? null,
        isGroup: msg.from?.endsWith('@g.us') ?? false,
        type: msg.type,
        body: msg.body,
        hasMedia: msg.hasMedia,
        timestamp: msg.timestamp,
        notifyName: msg._data?.notifyName ?? null,
    };
}

function ackName(ack) {
    return { [-1]: 'error', 0: 'pending', 1: 'sent', 2: 'delivered', 3: 'read', 4: 'played' }[ack] ?? 'unknown';
}

function stripUndefined(obj) {
    return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined && v !== null));
}

// Chrome runs as a tree of processes; on Windows, killing only the parent leaves the children holding the profile.
function killProcessTree(proc) {
    return new Promise((resolve) => {
        const done = (err) => {
            if (err) logger.warn({ pid: proc.pid, err: err.message }, 'Could not kill browser process');
            resolve();
        };
        if (process.platform === 'win32') {
            execFile('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { windowsHide: true }, done);
        } else {
            try {
                proc.kill('SIGKILL');
                done();
            } catch (err) {
                done(err);
            }
        }
    });
}

module.exports = new WhatsAppService();
module.exports.STATE = STATE;
