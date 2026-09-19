'use strict';

const { RateLimitStore } = require('../lib/rateLimitStore.js');

const WINDOW_MS = 60 * 1000;
const MAX_REQUESTS_PER_IP = 1200;
const limiter = new RateLimitStore(WINDOW_MS);

function normalizeRequestIp(req) {
  const value =
    typeof req.ip === 'string' && req.ip.trim()
      ? req.ip
      : 'unknown';

  return value.trim().slice(0, 120);
}

function publicApiRateLimit(req, res, next) {
  const ip = normalizeRequestIp(req);
  const result = limiter.hit(
    `public-api:${ip}`,
    WINDOW_MS,
    MAX_REQUESTS_PER_IP
  );

  res.setHeader(
    'X-RateLimit-Limit',
    String(MAX_REQUESTS_PER_IP)
  );
  res.setHeader(
    'X-RateLimit-Remaining',
    String(Math.max(result.remaining ?? 0, 0))
  );

  if (!result.allowed) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil(
        (result.retryAfterMs || WINDOW_MS) /
        1000
      )
    );

    res.setHeader(
      'Retry-After',
      String(retryAfterSeconds)
    );

    res.status(429).json({
      ok: false,
      error:
        'Demasiadas solicitudes. Intenta nuevamente en un momento.'
    });

    return;
  }

  next();
}

module.exports = {
  publicApiRateLimit,
  normalizeRequestIp,
  WINDOW_MS,
  MAX_REQUESTS_PER_IP
};
