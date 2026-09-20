'use strict';

function getAppUrl(req) {
  const configured = String(process.env.APP_URL || '')
    .split(',')[0]
    .trim()
    .replace(/\/$/, '');

  if (configured) return configured;

  const protocol = req?.headers?.['x-forwarded-proto'] || req?.protocol || 'http';
  const host = req?.headers?.['x-forwarded-host'] || req?.get?.('host');
  if (!host) throw new Error('No se pudo determinar la URL pública de la aplicación. Configura APP_URL.');
  return `${protocol}://${host}`;
}

function buildBarUrls(
  bar,
  req,
  { includeScreenAccessKey = false } = {}
) {
  if (!bar?.slug) throw new Error('No se puede construir URLs sin slug.');
  const base = getAppUrl(req);
  const slug = encodeURIComponent(bar.slug);
  const settingsUpdatedAt =
    bar.settings?.updatedAt
      ? new Date(bar.settings.updatedAt).getTime()
      : NaN;
  const qrVersion = Number.isFinite(settingsUpdatedAt)
    ? `?v=${settingsUpdatedAt}`
    : '';

  let barUrl = `${base}/bar.html?bar=${slug}`;
  const screenAccessKey =
    typeof bar.settings?.screenAccessKey === 'string'
      ? bar.settings.screenAccessKey
      : '';

  if (
    includeScreenAccessKey &&
    bar.settings?.screenAuthRequired === false &&
    /^[A-Za-z0-9_-]{32}$/.test(screenAccessKey)
  ) {
    barUrl += `#screenKey=${encodeURIComponent(screenAccessKey)}`;
  }

  return {
    cliente: `${base}/cliente.html?bar=${slug}`,
    bar: barUrl,
    admin: `${base}/admin.html?bar=${slug}`,
    qr: `${base}/api/public/bars/${slug}/qr${qrVersion}`
  };
}

module.exports = { getAppUrl, buildBarUrls };
