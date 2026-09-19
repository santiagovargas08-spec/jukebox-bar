'use strict';

const { getAllowedOrigins } = require('./socketBar.js');

function buildRequestOrigin(req) {
  const protocol = req.protocol || 'http';
  const host = req.get?.('host') || req.headers?.host;

  if (!host) return null;
  return `${protocol}://${host}`;
}

function isTrustedRequestOrigin(req) {
  const origin = req.get?.('origin') || req.headers?.origin;

  // Si el navegador no envía Origin, Sec-Fetch-Site todavía permite
  // distinguir una navegación legítima de una petición cross-site.
  if (!origin) {
    const fetchSite =
      req.get?.('sec-fetch-site') ||
      req.headers?.['sec-fetch-site'];

    if (
      fetchSite &&
      !['same-origin', 'same-site', 'none'].includes(fetchSite)
    ) {
      return false;
    }

    // Clientes no navegador pueden omitir ambas cabeceras.
    // La autenticación de la ruta sigue siendo obligatoria.
    return true;
  }

  const allowed = new Set(getAllowedOrigins());
  const requestOrigin = buildRequestOrigin(req);

  if (requestOrigin) {
    allowed.add(requestOrigin);
  }

  return allowed.has(origin);
}

function requireTrustedOrigin(req, res, next) {
  if (
    req.method === 'GET' ||
    req.method === 'HEAD' ||
    req.method === 'OPTIONS'
  ) {
    next();
    return;
  }

  if (!isTrustedRequestOrigin(req)) {
    res.status(403).json({
      ok: false,
      error: 'Origen de solicitud no permitido.'
    });
    return;
  }

  next();
}

module.exports = {
  buildRequestOrigin,
  isTrustedRequestOrigin,
  requireTrustedOrigin
};
