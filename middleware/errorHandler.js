'use strict';

const { logError } = require('../lib/logger.js');

function normalizeHttpError(err) {
  const status =
    Number.isInteger(err?.status)
      ? err.status
      : 500;

  if (
    status === 400 &&
    (
      err?.type === 'entity.parse.failed' ||
      err instanceof SyntaxError
    )
  ) {
    return {
      status: 400,
      message: 'JSON inválido.'
    };
  }

  if (
    status === 413 ||
    err?.type === 'entity.too.large'
  ) {
    return {
      status: 413,
      message: 'El cuerpo de la solicitud es demasiado grande.'
    };
  }

  const message =
    process.env.NODE_ENV === 'production' &&
    status >= 500
      ? 'Error interno del servidor.'
      : err?.message ||
        'Error interno del servidor.';

  return {
    status,
    message
  };
}

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

  const normalized =
    normalizeHttpError(err);

  res.status(normalized.status).json({
    ok: false,
    error: normalized.message,
    requestId: req.id || null
  });
}

module.exports = {
  errorHandler,
  normalizeHttpError
};
