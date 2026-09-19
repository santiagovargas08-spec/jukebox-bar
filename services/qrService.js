'use strict';

const QRCode = require('qrcode');

const QR_CACHE_TTL_MS = 60 * 60 * 1000;
const MAX_QR_CACHE_ENTRIES = 500;

const cache = new Map();
const inFlight = new Map();

function getCached(key) {
  const item = cache.get(key);

  if (!item) return null;

  if (Date.now() - item.createdAt >= QR_CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }

  return item.buffer;
}

function setCached(key, buffer) {
  cache.set(key, {
    buffer,
    createdAt: Date.now()
  });

  if (cache.size > MAX_QR_CACHE_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    cache.delete(oldestKey);
  }
}

async function getClientQrPng(
  clientUrl,
  {
    generate = QRCode.toBuffer
  } = {}
) {
  const key = String(clientUrl || '').trim();

  if (!key) {
    throw new Error('URL de cliente inválida.');
  }

  const cached = getCached(key);

  if (cached) {
    return {
      buffer: cached,
      cached: true
    };
  }

  let pending = inFlight.get(key);
  const shared = Boolean(pending);

  if (!pending) {
    pending = Promise.resolve()
      .then(() => generate(key, {
        type: 'png',
        width: 400,
        margin: 2,
        color: {
          dark: '#00f0ff',
          light: '#0a0a0f'
        }
      }))
      .then((buffer) => {
        setCached(key, buffer);
        return buffer;
      })
      .finally(() => {
        inFlight.delete(key);
      });

    inFlight.set(key, pending);
  }

  const buffer = await pending;

  return {
    buffer,
    cached: false,
    shared
  };
}

function clearQrCache() {
  cache.clear();
  inFlight.clear();
}

module.exports = {
  getClientQrPng,
  clearQrCache,
  QR_CACHE_TTL_MS,
  MAX_QR_CACHE_ENTRIES
};
