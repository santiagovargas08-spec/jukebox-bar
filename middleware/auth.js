'use strict';

const { RateLimitStore } = require('../lib/rateLimitStore.js');

const ADMIN_WINDOW_MS = 60 * 1000;
const MAX_ADMIN_REQUESTS = 120;
const adminLimiter = new RateLimitStore(ADMIN_WINDOW_MS);

function requireAdminKey(req, res, next) {
  const expected = process.env.ADMIN_API_KEY;

  if (!expected) {
    console.error('[AUTH] ADMIN_API_KEY no está configurada.');
    return res.status(503).json({
      ok: false,
      error: 'Servicio no configurado correctamente.'
    });
  }

  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ')
    ? header.slice(7).trim()
    : (req.headers['x-admin-key'] || '').trim();

  if (!token || token !== expected) {
    return res.status(401).json({
      ok: false,
      error: 'No autorizado.'
    });
  }

  const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';
  const limit = adminLimiter.hit(`admin:${ip}`, ADMIN_WINDOW_MS, MAX_ADMIN_REQUESTS);

  if (!limit.allowed) {
    return res.status(429).json({
      ok: false,
      error: 'Demasiadas solicitudes. Intenta más tarde.'
    });
  }

  next();
}

module.exports = {
  requireAdminKey
};
