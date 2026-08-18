'use strict';

const LEVELS = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3
};

const configuredLevel = LEVELS[process.env.LOG_LEVEL] ?? LEVELS.info;

function write(level, message, meta = {}) {
  if (LEVELS[level] > configuredLevel) {
    return;
  }

  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...meta
  };

  const line = JSON.stringify(entry);

  if (level === 'error') {
    console.error(line);
    return;
  }

  if (level === 'warn') {
    console.warn(line);
    return;
  }

  console.log(line);
}

function logError(message, meta = {}) {
  write('error', message, meta);
}

function logWarn(message, meta = {}) {
  write('warn', message, meta);
}

function logInfo(message, meta = {}) {
  write('info', message, meta);
}

function logDebug(message, meta = {}) {
  write('debug', message, meta);
}

module.exports = {
  logError,
  logWarn,
  logInfo,
  logDebug
};
