'use strict';

const QRCode = require('qrcode');
const { PNG } = require('pngjs');

const QR_CACHE_TTL_MS = 60 * 60 * 1000;
const MAX_QR_CACHE_ENTRIES = 500;
const QR_WIDTH = 400;
const LOGO_SIZE = 64;
const LOGO_PLATE_SIZE = 80;
const LOGO_FETCH_TIMEOUT_MS = 3000;
const MAX_LOGO_BYTES = 1024 * 1024;

const cache = new Map();
const inFlight = new Map();

function normalizeLogoUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null;

  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'res.cloudinary.com') {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function buildCloudinaryPngUrl(value) {
  const normalized = normalizeLogoUrl(value);
  if (!normalized) return null;

  const parsed = new URL(normalized);
  const uploadMarker = '/upload/';
  const markerIndex = parsed.pathname.indexOf(uploadMarker);
  if (markerIndex === -1) return null;

  const beforeUpload = parsed.pathname.slice(0, markerIndex + uploadMarker.length);
  const assetPath = parsed.pathname.slice(markerIndex + uploadMarker.length);
  parsed.pathname = `${beforeUpload}f_png,w_${LOGO_SIZE},h_${LOGO_SIZE},c_pad,b_transparent/${assetPath}`;
  return parsed.toString();
}

async function fetchLogoPng(logoUrl, { fetchImpl = globalThis.fetch } = {}) {
  const transformedUrl = buildCloudinaryPngUrl(logoUrl);
  if (!transformedUrl || typeof fetchImpl !== 'function') {
    throw new Error('Logo no disponible para el QR.');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LOGO_FETCH_TIMEOUT_MS);

  try {
    const response = await fetchImpl(transformedUrl, {
      signal: controller.signal,
      redirect: 'error',
      headers: { Accept: 'image/png' }
    });

    if (!response.ok) throw new Error(`Cloudinary respondió ${response.status}.`);

    const contentType = String(response.headers.get('content-type') || '')
      .split(';')[0]
      .trim()
      .toLowerCase();
    const contentLength = Number(response.headers.get('content-length') || 0);

    if (contentType !== 'image/png') throw new Error('El logo no es PNG.');
    if (contentLength > MAX_LOGO_BYTES) throw new Error('El logo supera el tamaño permitido.');

    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length || buffer.length > MAX_LOGO_BYTES) {
      throw new Error('El logo supera el tamaño permitido.');
    }

    return buffer;
  } finally {
    clearTimeout(timeout);
  }
}

function setPixel(png, x, y, red, green, blue, alpha = 255) {
  const index = (png.width * y + x) << 2;
  png.data[index] = red;
  png.data[index + 1] = green;
  png.data[index + 2] = blue;
  png.data[index + 3] = alpha;
}

function drawRoundedWhitePlate(png, left, top, size, radius) {
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const nearestX = Math.max(radius, Math.min(x, size - radius - 1));
      const nearestY = Math.max(radius, Math.min(y, size - radius - 1));
      const dx = x - nearestX;
      const dy = y - nearestY;

      if ((dx * dx) + (dy * dy) <= radius * radius) {
        setPixel(png, left + x, top + y, 255, 255, 255);
      }
    }
  }
}

function overlayLogo(destination, logo, left, top) {
  for (let y = 0; y < logo.height; y += 1) {
    for (let x = 0; x < logo.width; x += 1) {
      const sourceIndex = (logo.width * y + x) << 2;
      const destinationIndex =
        (destination.width * (top + y) + left + x) << 2;
      const alpha = logo.data[sourceIndex + 3] / 255;

      if (alpha === 0) continue;

      for (let channel = 0; channel < 3; channel += 1) {
        destination.data[destinationIndex + channel] = Math.round(
          (logo.data[sourceIndex + channel] * alpha) +
          (destination.data[destinationIndex + channel] * (1 - alpha))
        );
      }

      destination.data[destinationIndex + 3] = 255;
    }
  }
}

function compositeQrWithLogo(qrBuffer, logoBuffer) {
  const qr = PNG.sync.read(qrBuffer);
  const logo = PNG.sync.read(logoBuffer);

  if (qr.width !== QR_WIDTH || qr.height !== QR_WIDTH) {
    throw new Error('Dimensiones de QR inesperadas.');
  }

  if (logo.width > LOGO_SIZE || logo.height > LOGO_SIZE) {
    throw new Error('Dimensiones de logo inesperadas.');
  }

  const plateLeft = Math.floor((qr.width - LOGO_PLATE_SIZE) / 2);
  const plateTop = Math.floor((qr.height - LOGO_PLATE_SIZE) / 2);
  drawRoundedWhitePlate(qr, plateLeft, plateTop, LOGO_PLATE_SIZE, 10);

  const logoLeft = Math.floor((qr.width - logo.width) / 2);
  const logoTop = Math.floor((qr.height - logo.height) / 2);
  overlayLogo(qr, logo, logoLeft, logoTop);

  return PNG.sync.write(qr);
}

function getCached(key) {
  const item = cache.get(key);
  if (!item) return null;

  if (Date.now() - item.createdAt >= QR_CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }

  return item.result;
}

function setCached(key, result) {
  cache.set(key, { result, createdAt: Date.now() });

  if (cache.size > MAX_QR_CACHE_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    cache.delete(oldestKey);
  }
}

async function getClientQrPng(
  clientUrl,
  {
    logoUrl = null,
    generate = QRCode.toBuffer,
    loadLogo = fetchLogoPng,
    compose = compositeQrWithLogo
  } = {}
) {
  const url = String(clientUrl || '').trim();
  if (!url) throw new Error('URL de cliente inválida.');

  const normalizedLogoUrl = normalizeLogoUrl(logoUrl);
  const key = JSON.stringify([url, normalizedLogoUrl || '']);
  const cachedResult = getCached(key);

  if (cachedResult) return { ...cachedResult, cached: true };

  let pending = inFlight.get(key);
  const shared = Boolean(pending);

  if (!pending) {
    pending = Promise.resolve()
      .then(async () => {
        const baseBuffer = await generate(url, {
          type: 'png',
          width: QR_WIDTH,
          margin: 2,
          errorCorrectionLevel: 'H',
          color: {
            dark: '#00f0ff',
            light: '#0a0a0f'
          }
        });

        if (!normalizedLogoUrl) {
          return { buffer: baseBuffer, logoApplied: false };
        }

        try {
          const logoBuffer = await loadLogo(normalizedLogoUrl);
          const buffer = await compose(baseBuffer, logoBuffer);
          return { buffer, logoApplied: true };
        } catch {
          return { buffer: baseBuffer, logoApplied: false };
        }
      })
      .then((result) => {
        setCached(key, result);
        return result;
      })
      .finally(() => {
        inFlight.delete(key);
      });

    inFlight.set(key, pending);
  }

  const result = await pending;
  return { ...result, cached: false, shared };
}

function clearQrCache() {
  cache.clear();
  inFlight.clear();
}

module.exports = {
  getClientQrPng,
  clearQrCache,
  buildCloudinaryPngUrl,
  compositeQrWithLogo,
  QR_CACHE_TTL_MS,
  MAX_QR_CACHE_ENTRIES
};
