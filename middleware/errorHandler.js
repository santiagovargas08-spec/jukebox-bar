'use strict';

const { logError } = require('../lib/logger.js');

function errorHandler(err, req, res, next) {
  logError('Error HTTP no controlado', {
    event: 'http_error',
    path: req.path,
    method: req.method,
    requestId: req.id || null,
    error: err.message
  });

  if (res.headersSent) {
    next(err);
    return;
  }

  const status = Number.isInteger(err.status) ? err.status : 500;
  const safeMessage =
    process.env.NODE_ENV === 'production' && status >= 500
      ? 'Error interno del servidor.'
      : err.message || 'Error interno del servidor.';

  res.status(status).json({
    ok: false,
    error: safeMessage,
    requestId: req.id || null
  });
}

module.exports = {
  errorHandler
};
