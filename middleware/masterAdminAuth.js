'use strict';

const { getActiveMasterAdminFromToken } = require('../services/masterAdminAuthService.js');
const { RateLimitStore } = require('../lib/rateLimitStore.js');
const { logError } = require('../lib/logger.js');
const { getCookieValueFromHeader } = require('../lib/cookies.js');

const WINDOW_MS = 60 * 1000;
const MAX_REQUESTS = 180;
const limiter = new RateLimitStore(WINDOW_MS);
const MASTER_ADMIN_COOKIE = 'jukebox_master_admin';

function getMasterAdminToken(req) {
  const header = req.headers.authorization || '';

  if (header.startsWith('Bearer ')) {
    return header.slice(7).trim();
  }

  return getCookieValueFromHeader(req.headers.cookie, MASTER_ADMIN_COOKIE);
}

async function requireMasterAdmin(req, res, next) {
  try {
    const ip =
      req.ip ||
      req.headers['x-forwarded-for'] ||
      'unknown';

    const limit = limiter.hit(
      `master:${String(ip).slice(0, 120)}`,
      WINDOW_MS,
      MAX_REQUESTS
    );

    if (!limit.allowed) {
      return res.status(429).json({
        ok: false,
        error: 'Demasiadas solicitudes. Intenta más tarde.'
      });
    }

    const token = getMasterAdminToken(req);

    if (!token) {
      return res.status(401).json({
        ok: false,
        error: 'No autorizado.'
      });
    }

    const admin = await getActiveMasterAdminFromToken(token);

    if (!admin) {
      res.clearCookie(MASTER_ADMIN_COOKIE, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        path: '/api/public/master-admin'
      });

      return res.status(401).json({
        ok: false,
        error: 'Sesión inválida o expirada.'
      });
    }

    req.masterAdmin = admin;
    next();
  } catch (error) {
    logError('Error validando sesión Master Admin', {
      event: 'master_auth_error',
      requestId: req.id || null,
      error: error?.message || String(error)
    });

    res.status(401).json({ ok: false, error: 'No autorizado.' });
  }
}

module.exports = {
  MASTER_ADMIN_COOKIE,
  getMasterAdminToken,
  requireMasterAdmin
};
