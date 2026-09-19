'use strict';

const ytSearch = require('yt-search');
const { logWarn } = require('../lib/logger.js');
const {
  getPersistentSearchCache,
  setPersistentSearchCache,
  normalizeSearchQuery
} = require('./searchCacheService.js');

const CACHE_TTL_MS = 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 500;
const MAX_SEARCH_RESULTS = 25;

const cache = new Map();
const inFlight = new Map();

function getCached(queryKey) {
  const cached = cache.get(queryKey);

  if (!cached) {
    return null;
  }

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
    searchFn = ytSearch
  } = {}
) {
  const text = String(query || '').trim();

  if (!text) {
    return {
      videos: [],
      cached: false,
      status: 'EMPTY_QUERY'
    };
  }

  const key = normalizeSearchQuery(text);
  const cachedVideos = getCached(key);

  if (cachedVideos) {
    return {
      videos: cachedVideos,
      cached: true,
      cacheLayer: 'memory',
      status: 'OK'
    };
  }

  const persistentVideos =
    await getPersistentSearchCache(text);

  if (
    Array.isArray(persistentVideos) &&
    persistentVideos.length > 0
  ) {
    setCached(
      key,
      persistentVideos
    );

    return {
      videos: persistentVideos,
      cached: true,
      cacheLayer: 'database',
      status: 'OK'
    };
  }

  let pending = inFlight.get(key);

  if (!pending) {
    pending = (async () => {
      const startedAt = Date.now();

      try {
        // Mismo enfoque del proyecto original:
        // consulta directa a yt-search sin timeout artificial,
        // circuit breaker, ranking ni filtros previos.
        const result = await searchFn(text);

        const videos =
          result && Array.isArray(result.videos)
            ? result.videos.slice(0, MAX_SEARCH_RESULTS)
            : [];

        if (videos.length > 0) {
          setCached(key, videos);

          // Guardado asíncrono: no retrasa la respuesta al cliente.
          void setPersistentSearchCache(
            text,
            videos
          );
        }

        return {
          videos,
          cacheLayer: 'youtube',
          status:
            videos.length > 0
              ? 'OK'
              : 'NO_RESULTS',
          elapsedMs:
            Date.now() - startedAt
        };
      } catch (error) {
        logWarn('Error en búsqueda directa de YouTube', {
          event: 'youtube_search_provider_error',
          error:
            error?.message ||
            String(error),
          elapsedMs:
            Date.now() - startedAt
        });

        return {
          videos: [],
          cacheLayer: 'youtube',
          status: 'PROVIDER_ERROR',
          elapsedMs:
            Date.now() - startedAt
        };
      } finally {
        inFlight.delete(key);
      }
    })();

    inFlight.set(key, pending);
  }

  const result = await pending;

  return {
    videos: result.videos,
    cached: false,
    cacheLayer:
      result.cacheLayer ||
      'youtube',
    status: result.status,
    elapsedMs: result.elapsedMs || 0
  };
}

function clearSearchCache() {
  cache.clear();
  inFlight.clear();
}

module.exports = {
  searchYoutube,
  clearSearchCache,
  CACHE_TTL_MS,
  MAX_CACHE_ENTRIES,
  MAX_SEARCH_RESULTS
};
