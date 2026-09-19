'use strict';

const { RateLimitStore } = require('../lib/rateLimitStore.js');

const REQUEST_WINDOW_MS = 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 3;
const MAX_IP_REQUESTS_PER_WINDOW = 20;

function normalizeSocketIp(socket) {
  const forwarded = socket?.handshake?.headers?.['x-forwarded-for'];

  if (typeof forwarded === 'string' && forwarded.trim()) {
    const chain = forwarded
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);

    // Detrás de un único proxy confiable, el último valor es el cliente
    // que el proxy observó. Evita confiar ciegamente en un primer valor
    // X-Forwarded-For que el cliente pudiera haber inyectado.
    const clientIp = chain.at(-1);

    if (clientIp) {
      return clientIp.slice(0, 120);
    }
  }

  const direct = socket?.handshake?.address;
  return typeof direct === 'string' && direct.trim()
    ? direct.trim().slice(0, 120)
    : 'unknown';
}

function parseBlockedTerms(raw) {
  return String(raw || '')
    .split(',')
    .map((term) => term.trim().toLowerCase())
    .filter(Boolean);
}

function createSongRequestPolicy({
  blockedTermsRaw = process.env.BLOCKED_SONG_TERMS || ''
} = {}) {
  const blockedTerms = parseBlockedTerms(blockedTermsRaw);
  const requestLimits = new RateLimitStore(REQUEST_WINDOW_MS);
  const ipRequestLimits = new RateLimitStore(REQUEST_WINDOW_MS);

  function canRequestSong(socket, barId) {
    const socketKey = `${socket.id}:${barId}`;
    const socketLimit = requestLimits.hit(
      socketKey,
      REQUEST_WINDOW_MS,
      MAX_REQUESTS_PER_WINDOW
    );

    if (!socketLimit.allowed) return false;

    const ip = normalizeSocketIp(socket);
    const ipLimit = ipRequestLimits.hit(
      `ip:${ip}:${barId}`,
      REQUEST_WINDOW_MS,
      MAX_IP_REQUESTS_PER_WINDOW
    );

    return ipLimit.allowed;
  }

  function isBlockedSong(song) {
    if (blockedTerms.length === 0) return false;

    const text = `${song?.title || ''} ${song?.name || ''}`.toLowerCase();
    return blockedTerms.some((term) => text.includes(term));
  }

  return {
    canRequestSong,
    isBlockedSong
  };
}

const defaultPolicy = createSongRequestPolicy();

module.exports = {
  canRequestSong: defaultPolicy.canRequestSong,
  isBlockedSong: defaultPolicy.isBlockedSong,
  createSongRequestPolicy,
  normalizeSocketIp,
  parseBlockedTerms
};
