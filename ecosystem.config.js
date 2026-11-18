// PM2 config: `npm i -g pm2 && pm2 start ecosystem.config.js`
module.exports = {
    apps: [
        {
            name: 'whatsapp-api',
            script: 'src/server.js',
            instances: 1, // one WhatsApp session = one process; never run in cluster mode
            exec_mode: 'fork',
            autorestart: true,
            max_memory_restart: '1G',
            kill_timeout: 20000,
            env: { NODE_ENV: 'production' },
        },
    ],
};
