class AppError extends Error {
    constructor(status, code, message, details) {
        super(message);
        this.status = status;
        this.code = code;
        this.details = details;
    }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function withTimeout(promise, ms, label = 'Operation') {
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(
            () => reject(new AppError(504, 'TIMEOUT', `${label} timed out after ${ms}ms`)),
            ms,
        );
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

module.exports = { AppError, sleep, withTimeout };
