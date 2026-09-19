'use strict';

const crypto = require('node:crypto');
const { RateLimitStore } = require('../lib/rateLimitStore.js');
const { logError } = require('../lib/logger.js');

const ADMIN_WINDOW_MS = 60 * 1000;
const MAX_ADMIN_REQUESTS = 120;
const adminLimiter = new RateLimitStore(ADMIN_WINDOW_MS);

function safeEqualSecret(provided, expected) {
  if (
    typeof provided !== 'string' ||
    typeof expected !== 'string'
  ) {
    return false;
  }

  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);

  return (
    providedBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(
      providedBuffer,
      expectedBuffer
    )
  );
}

function requireAdminKey(req, res, next) {
  const expected = process.env.ADMIN_API_KEY;

  if (!expected) {
    logError('ADMIN_API_KEY no está configurada', {
      event: 'legacy_admin_key_missing',
      requestId: req.id || null
    });

    return res.status(503).json({
      ok: false,
      error: 'Servicio no configurado correctamente.'
    });
  }

  const ip =
    typeof req.ip === 'string' && req.ip.trim()
      ? req.ip.trim().slice(0, 120)
      : 'unknown';

  const limit = adminLimiter.hit(
    `admin:${ip}`,
    ADMIN_WINDOW_MS,
    MAX_ADMIN_REQUESTS
  );

  if (!limit.allowed) {
    return res.status(429).json({
      ok: false,
      error: 'Demasiadas solicitudes. Intenta más tarde.'
    });
  }

  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ')
    ? header.slice(7).trim()
    : String(req.headers['x-admin-key'] || '').trim();

  if (!safeEqualSecret(token, expected)) {
    return res.status(401).json({
      ok: false,
      error: 'No autorizado.'
    });
  }

  next();
}

module.exports = {
  requireAdminKey,
  safeEqualSecret,
  ADMIN_WINDOW_MS,
  MAX_ADMIN_REQUESTS
};
