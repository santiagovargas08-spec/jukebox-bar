'use strict';

const { getActiveAdminFromToken } = require('../services/operatorAuthService.js');
const { RateLimitStore } = require('../lib/rateLimitStore.js');
const { logError } = require('../lib/logger.js');
const { getCookieValueFromHeader } = require('../lib/cookies.js');

const OPERATOR_COOKIE = 'jukebox_operator';
const AUTH_WINDOW_MS = 60 * 1000;
const MAX_AUTH_CHECKS_PER_IP = 600;
const authLimiter = new RateLimitStore(AUTH_WINDOW_MS);

function getBearerToken(req) {
  const authorization = req.headers.authorization;

  if (typeof authorization !== 'string') return null;

  const [scheme, token] = authorization.trim().split(/\s+/, 2);

  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    return null;
  }

  return token;
}

function isBearerAdminAuthEnabled() {
  return (
    process.env.ENABLE_BEARER_ADMIN_AUTH === 'true'
  );
}

function getOperatorToken(req) {
  const cookieToken =
    getCookieValueFromHeader(
      req.headers.cookie,
      OPERATOR_COOKIE
    );

  if (!isBearerAdminAuthEnabled()) {
    return cookieToken;
  }

  return (
    getBearerToken(req) ||
    cookieToken
  );
}

function getOperatorTokenFromCookieHeader(rawCookie) {
  return getCookieValueFromHeader(
    rawCookie,
    OPERATOR_COOKIE
  );
}

async function requireOperatorHttp(req, res, next) {
  try {
    const ip =
      typeof req.ip === 'string' && req.ip.trim()
        ? req.ip.trim().slice(0, 120)
        : 'unknown';

    const limit = authLimiter.hit(
      `operator-http:${ip}`,
      AUTH_WINDOW_MS,
      MAX_AUTH_CHECKS_PER_IP
    );

    if (!limit.allowed) {
      return res.status(429).json({
        ok: false,
        error: 'Demasiadas solicitudes de autenticación.'
      });
    }

    const token = getOperatorToken(req);

    if (!token) {
      return res.status(401).json({
        ok: false,
        error: 'Sesión de operador requerida.'
      });
    }

    const operator = await getActiveAdminFromToken(token);

    if (!operator) {
      res.clearCookie(OPERATOR_COOKIE, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        path: '/'
      });

      return res.status(401).json({
        ok: false,
        error: 'La sesión del operador no es válida o expiró.'
      });
    }

    req.operator = operator;
    req.operatorToken = token;
    next();
  } catch (error) {
    logError('Error validando operador HTTP', {
      event: 'operator_auth_error',
      requestId: req.id || null,
      error: error?.message || String(error)
    });

    res.status(500).json({
      ok: false,
      error: 'No se pudo validar la sesión del operador.'
    });
  }
}

module.exports = {
  OPERATOR_COOKIE,
  getCookieValueFromHeader,
  getBearerToken,
  getOperatorToken,
  getOperatorTokenFromCookieHeader,
  isBearerAdminAuthEnabled,
  requireOperatorHttp,
  AUTH_WINDOW_MS,
  MAX_AUTH_CHECKS_PER_IP
};
