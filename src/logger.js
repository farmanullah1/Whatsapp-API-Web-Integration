const pino = require('pino');
const config = require('./config');

const usePretty = config.env !== 'production' && (() => {
    try {
        require.resolve('pino-pretty');
        return true;
    } catch {
        return false;
    }
})();

const logger = pino({
    level: config.logLevel,
    redact: ['req.headers["x-api-key"]', 'req.headers.authorization'],
    transport: usePretty
        ? { target: 'pino-pretty', options: { translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' } }
        : undefined,
});

module.exports = logger;
