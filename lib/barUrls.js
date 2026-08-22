'use strict';

function getAppUrl(req) {
  const configured = String(process.env.APP_URL || '').trim().replace(/\/$/, '');
  if (configured) return configured;

  const protocol = req?.headers?.['x-forwarded-proto'] || req?.protocol || 'http';
  const host = req?.headers?.['x-forwarded-host'] || req?.get?.('host');
  if (!host) throw new Error('No se pudo determinar la URL pública de la aplicación. Configura APP_URL.');
  return `${protocol}://${host}`;
}

function buildBarUrls(bar, req) {
  if (!bar?.slug) throw new Error('No se puede construir URLs sin slug.');
  const base = getAppUrl(req);
  const slug = encodeURIComponent(bar.slug);
  return {
    cliente: `${base}/cliente.html?bar=${slug}`,
    bar: `${base}/bar.html?bar=${slug}`,
    admin: `${base}/admin.html?bar=${slug}`,
    qr: `${base}/api/public/bars/${slug}/qr`
  };
}

module.exports = { getAppUrl, buildBarUrls };
