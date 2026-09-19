'use strict';

const ytSearch = require('yt-search');
const { sanitizeThumbnailUrl, isValidYoutubeVideoId } = require('../lib/urlValidation.js');
const { withTimeout } = require('../lib/promiseTimeout.js');
const { logWarn } = require('../lib/logger.js');

const CACHE_TTL_MS = 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 500;
const SEARCH_TIMEOUT_MS = 8 * 1000;
const PROVIDER_FAILURE_THRESHOLD = 5;
const PROVIDER_OPEN_MS = 30 * 1000;

const cache = new Map();
const inFlight = new Map();

const providerCircuit = {
  failures: 0,
  openedAt: 0
};

function resetProviderCircuit() {
  providerCircuit.failures = 0;
  providerCircuit.openedAt = 0;
}

function isProviderCircuitOpen(now = Date.now()) {
  if (!providerCircuit.openedAt) {
    return false;
  }

  if (now - providerCircuit.openedAt >= PROVIDER_OPEN_MS) {
    resetProviderCircuit();
    return false;
  }

  return true;
}

function recordProviderFailure(now = Date.now()) {
  providerCircuit.failures += 1;

  if (
    providerCircuit.failures >= PROVIDER_FAILURE_THRESHOLD &&
    !providerCircuit.openedAt
  ) {
    providerCircuit.openedAt = now;
  }
}

function normalizeYoutubeResult(video) {
  if (!video) return null;

  const videoId =
    typeof video.videoId === 'string'
      ? video.videoId.trim()
      : '';

  if (!isValidYoutubeVideoId(videoId)) return null;

  let title =
    typeof video.title === 'string'
      ? video.title.trim()
      : String(video.title ?? '').trim();

  if (!title) title = 'Sin título';

  const author =
    video.author && typeof video.author.name === 'string'
      ? video.author.name.trim()
      : 'Canal desconocido';

  const thumbnail =
    typeof video.thumbnail === 'string'
      ? video.thumbnail.trim()
      : String(video.thumbnail ?? '').trim();

  return {
    videoId,
    title,
    author: { name: author },
    thumbnail: sanitizeThumbnailUrl(thumbnail)
  };
}

function getCached(queryKey) {
  const cached = cache.get(queryKey);
  if (!cached) return null;

  if (Date.now() - cached.timestamp >= CACHE_TTL_MS) {
    cache.delete(queryKey);
    return null;
  }

  return cached.videos;
}

function setCached(queryKey, videos) {
  cache.set(queryKey, {
    videos,
    timestamp: Date.now()
  });

  if (cache.size > MAX_CACHE_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    cache.delete(oldestKey);
  }
}

async function searchYoutube(
  query,
  {
    searchFn = ytSearch,
    timeoutMs = SEARCH_TIMEOUT_MS
  } = {}
) {
  const text = String(query || '').trim();
  if (!text) return { videos: [], cached: false };

  const key = text.toLowerCase();
  const cachedVideos = getCached(key);

  if (cachedVideos) {
    return {
      videos: cachedVideos,
      cached: true
    };
  }

  if (isProviderCircuitOpen()) {
    logWarn('Búsqueda de YouTube omitida por circuit breaker', {
      event: 'youtube_search_circuit_open',
      failures: providerCircuit.failures
    });

    return {
      videos: [],
      cached: false
    };
  }

  let pending = inFlight.get(key);
  if (!pending) {
    pending = (async () => {
      try {
        const result = await withTimeout(
          Promise.resolve().then(() => searchFn(text)),
          timeoutMs,
          {
            message: 'YOUTUBE_SEARCH_TIMEOUT',
            code: 'YOUTUBE_SEARCH_TIMEOUT'
          }
        );

        if (!result || !Array.isArray(result.videos)) {
          recordProviderFailure();
          return [];
        }

        const videos = result.videos
          .slice(0, 25)
          .map(normalizeYoutubeResult)
          .filter(Boolean);

        if (videos.length > 0) {
          setCached(key, videos);
          resetProviderCircuit();
        } else {
          recordProviderFailure();
        }

        return videos;
      } catch (error) {
        recordProviderFailure();

        logWarn('Error en búsqueda de YouTube', {
          event: 'youtube_search_provider_error',
          code: error?.code || null,
          error: error?.message || String(error)
        });

        return [];
      } finally {
        inFlight.delete(key);
      }
    })();

    inFlight.set(key, pending);
  }

  const videos = await pending;

  return {
    videos,
    cached: false
  };
}

function clearSearchCache() {
  cache.clear();
  inFlight.clear();
  resetProviderCircuit();
}

module.exports = {
  searchYoutube,
  clearSearchCache,
  normalizeYoutubeResult,
  resetProviderCircuit,
  isProviderCircuitOpen,
  recordProviderFailure,
  SEARCH_TIMEOUT_MS,
  PROVIDER_FAILURE_THRESHOLD,
  PROVIDER_OPEN_MS
};
