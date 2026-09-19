'use strict';

const { logInfo, logWarn } = require('../lib/logger.js');

function httpAccessLog(req, res, next) {
  const startedAt = process.hrtime.bigint();

  res.once('finish', () => {
    const durationMs =
      Number(process.hrtime.bigint() - startedAt) /
      1e6;

    const status = res.statusCode;
    const meta = {
      event: 'http_request',
      requestId: req.id || null,
      method: req.method,
      path: req.path,
      status,
      durationMs: Number(durationMs.toFixed(2))
    };

    if (status >= 400) {
      logWarn('HTTP request completed', meta);
      return;
    }

    if (req.path === '/health' || req.path === '/ready') {
      return;
    }

    logInfo('HTTP request completed', meta);
  });

  next();
}

module.exports = {
  httpAccessLog
};
