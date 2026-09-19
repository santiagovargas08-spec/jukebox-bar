'use strict';

const { getActiveAdminFromToken } = require('../services/operatorAuthService.js');
const { RateLimitStore } = require('../lib/rateLimitStore.js');

const OPERATOR_COOKIE = 'jukebox_operator';
const AUTH_WINDOW_MS = 60 * 1000;
const MAX_AUTH_CHECKS_PER_IP = 600;
const authLimiter = new RateLimitStore(AUTH_WINDOW_MS);

function getCookieValueFromHeader(raw, name) {
  if (typeof raw !== 'string' || !raw) return '';

  for (const part of raw.split(';')) {
    const [key, ...valueParts] = part.trim().split('=');

    if (key === name) {
      return decodeURIComponent(valueParts.join('='));
    }
  }

  return '';
}

function getBearerToken(req) {
  const authorization = req.headers.authorization;

  if (typeof authorization !== 'string') return null;

  const [scheme, token] = authorization.trim().split(/\s+/, 2);

  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    return null;
  }

  return token;
}

function getOperatorToken(req) {
  return (
    getBearerToken(req) ||
    getCookieValueFromHeader(
      req.headers.cookie,
      OPERATOR_COOKIE
    )
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
      return res.status(401).json({
        ok: false,
        error: 'La sesión del operador no es válida o expiró.'
      });
    }

    req.operator = operator;
    req.operatorToken = token;
    next();
  } catch (error) {
    console.error('[AUTH] Error validando operador HTTP:', error);

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
  requireOperatorHttp,
  AUTH_WINDOW_MS,
  MAX_AUTH_CHECKS_PER_IP
};
