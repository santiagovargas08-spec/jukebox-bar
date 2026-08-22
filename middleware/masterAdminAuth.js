'use strict';

const { getActiveMasterAdminFromToken } = require('../services/masterAdminAuthService.js');
const { RateLimitStore } = require('../lib/rateLimitStore.js');

const WINDOW_MS = 60 * 1000;
const MAX_REQUESTS = 180;
const limiter = new RateLimitStore(WINDOW_MS);

async function requireMasterAdmin(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';

    if (!token) return res.status(401).json({ ok: false, error: 'No autorizado.' });

    const admin = await getActiveMasterAdminFromToken(token);
    if (!admin) return res.status(401).json({ ok: false, error: 'Sesión inválida o expirada.' });

    const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';
    const limit = limiter.hit(`master:${ip}`, WINDOW_MS, MAX_REQUESTS);
    if (!limit.allowed) return res.status(429).json({ ok: false, error: 'Demasiadas solicitudes. Intenta más tarde.' });

    req.masterAdmin = admin;
    next();
  } catch (error) {
    console.error('[MASTER_AUTH] Error validando sesión:', error);
    res.status(401).json({ ok: false, error: 'No autorizado.' });
  }
}

module.exports = { requireMasterAdmin };
