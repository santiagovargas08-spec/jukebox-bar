'use strict';

const LEVELS = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3
};

const configuredLevel = LEVELS[process.env.LOG_LEVEL] ?? LEVELS.info;

const SENSITIVE_KEY_RE =
  /(password|passwd|token|authorization|cookie|secret|api[-_]?key|session)/i;

function sanitizeLogValue(value, seen = new WeakSet()) {
  if (value === null || value === undefined) return value;

  if (typeof value === 'string') {
    return value.length > 2000
      ? `${value.slice(0, 2000)}…`
      : value;
  }

  if (
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message
    };
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, 100)
      .map((item) => sanitizeLogValue(item, seen));
  }

  if (typeof value === 'object') {
    if (seen.has(value)) {
      return '[Circular]';
    }

    seen.add(value);

    const output = {};
    let count = 0;

    for (const [key, item] of Object.entries(value)) {
      if (count >= 100) {
        output.__truncated = true;
        break;
      }

      output[key] = SENSITIVE_KEY_RE.test(key)
        ? '[REDACTED]'
        : sanitizeLogValue(item, seen);

      count += 1;
    }

    seen.delete(value);
    return output;
  }

  return String(value);
}

function write(level, message, meta = {}) {
  if (LEVELS[level] > configuredLevel) {
    return;
  }

  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...sanitizeLogValue(meta)
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
  logDebug,
  sanitizeLogValue
};
