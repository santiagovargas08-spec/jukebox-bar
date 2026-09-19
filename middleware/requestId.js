'use strict';

const crypto = require('node:crypto');

const REQUEST_ID_RE = /^[A-Za-z0-9._:-]{8,128}$/;

function sanitizeRequestId(value) {
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();

  return REQUEST_ID_RE.test(trimmed)
    ? trimmed
    : null;
}

function requestId(req, res, next) {
  const incoming =
    sanitizeRequestId(
      req.get?.('x-request-id') ||
      req.headers?.['x-request-id']
    );

  const id =
    incoming ||
    crypto.randomUUID();

  req.id = id;
  res.setHeader('X-Request-Id', id);
  next();
}

module.exports = {
  requestId,
  sanitizeRequestId
};
