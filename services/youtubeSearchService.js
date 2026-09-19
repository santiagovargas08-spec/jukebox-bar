'use strict';

const ytSearch = require('yt-search');
const { logWarn } = require('../lib/logger.js');
const {
  getPersistentSearchCache,
  setPersistentSearchCache,
  normalizeSearchQuery,
  canonicalSearchKey
} = require('./searchCacheService.js');
const {
  warmKnownSongs,
  searchKnownSongs,
  rememberKnownSong
} = require('./knownSongCatalogService.js');

const CACHE_TTL_MS = 60 * 60 * 1000;
const NEGATIVE_CACHE_TTL_MS = 2 * 60 * 1000;
const MAX_CACHE_ENTRIES = 500;
const MAX_NEGATIVE_CACHE_ENTRIES = 200;
const MAX_SEARCH_RESULTS = 10;

const cache = new Map();
const negativeCache = new Map();
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
    const oldestKey =
      cache.keys().next().value;

    cache.delete(oldestKey);
  }
}

function hasNegativeCache(queryKey) {
  const cachedAt =
    negativeCache.get(queryKey);

  if (!cachedAt) {
    return false;
  }

  if (
    Date.now() - cachedAt >=
    NEGATIVE_CACHE_TTL_MS
  ) {
    negativeCache.delete(queryKey);
    return false;
  }

  return true;
}

function setNegativeCache(queryKey) {
  negativeCache.set(
    queryKey,
    Date.now()
  );

  if (
    negativeCache.size >
    MAX_NEGATIVE_CACHE_ENTRIES
  ) {
    const oldestKey =
      negativeCache.keys()
        .next().value;

    negativeCache.delete(
      oldestKey
    );
  }
}

function rememberSearchResults(videos) {
  for (
    const video of
    Array.isArray(videos)
      ? videos.slice(0, 10)
      : []
  ) {
    rememberKnownSong(video, 1);
  }
}

async function searchYoutube(
  query,
  {
    searchFn = ytSearch,
    usePersistentCache = true,
    useKnownSongs = true
  } = {}
) {
  const text =
    String(query || '').trim();

  if (!text) {
    return {
      videos: [],
      cached: false,
      status: 'EMPTY_QUERY'
    };
  }

  const key =
    canonicalSearchKey(text) ||
    normalizeSearchQuery(text);

  const cachedVideos =
    getCached(key);

  if (cachedVideos) {
    return {
      videos: cachedVideos,
      cached: true,
      cacheLayer: 'memory',
      status: 'OK'
    };
  }

  const persistent =
    usePersistentCache
      ? await getPersistentSearchCache(text)
      : null;

  if (
    persistent &&
    Array.isArray(persistent.videos) &&
    persistent.videos.length > 0
  ) {
    setCached(
      key,
      persistent.videos
    );

    rememberSearchResults(
      persistent.videos
    );

    if (
      persistent.matchType ===
      'approximate'
    ) {
      void setPersistentSearchCache(
        text,
        persistent.videos
      );
    }

    return {
      videos:
        persistent.videos,
      cached: true,
      cacheLayer:
        persistent.matchType ===
        'approximate'
          ? 'database-approx'
          : 'database',
      status: 'OK'
    };
  }

  if (useKnownSongs) {
    await warmKnownSongs();

    const knownVideos =
      searchKnownSongs(
        text,
        10
      );

    if (
      knownVideos.length > 0
    ) {
      setCached(
        key,
        knownVideos
      );

      if (usePersistentCache) {
        void setPersistentSearchCache(
          text,
          knownVideos
        );
      }

      return {
        videos: knownVideos,
        cached: true,
        cacheLayer: 'history',
        status: 'OK'
      };
    }
  }

  if (hasNegativeCache(key)) {
    return {
      videos: [],
      cached: true,
      cacheLayer:
        'negative-memory',
      status: 'NO_RESULTS'
    };
  }

  let pending =
    inFlight.get(key);

  if (!pending) {
    pending = (async () => {
      const startedAt =
        Date.now();

      try {
        // Se conserva el mismo motor de búsqueda del proyecto original.
        const result =
          await searchFn(text);

        const videos =
          result &&
          Array.isArray(
            result.videos
          )
            ? result.videos.slice(
                0,
                MAX_SEARCH_RESULTS
              )
            : [];

        if (videos.length > 0) {
          setCached(
            key,
            videos
          );

          rememberSearchResults(
            videos
          );

          if (usePersistentCache) {
            void setPersistentSearchCache(
              text,
              videos
            );
          }
        } else {
          setNegativeCache(key);
        }

        return {
          videos,
          cacheLayer: 'youtube',
          status:
            videos.length > 0
              ? 'OK'
              : 'NO_RESULTS',
          elapsedMs:
            Date.now() -
            startedAt
        };
      } catch (error) {
        logWarn(
          'Error en búsqueda directa de YouTube',
          {
            event:
              'youtube_search_provider_error',
            error:
              error?.message ||
              String(error),
            elapsedMs:
              Date.now() -
              startedAt
          }
        );

        return {
          videos: [],
          cacheLayer: 'youtube',
          status:
            'PROVIDER_ERROR',
          elapsedMs:
            Date.now() -
            startedAt
        };
      } finally {
        inFlight.delete(key);
      }
    })();

    inFlight.set(
      key,
      pending
    );
  }

  const result =
    await pending;

  return {
    videos: result.videos,
    cached: false,
    cacheLayer:
      result.cacheLayer ||
      'youtube',
    status: result.status,
    elapsedMs:
      result.elapsedMs || 0
  };
}

function clearSearchCache() {
  cache.clear();
  negativeCache.clear();
  inFlight.clear();
}

module.exports = {
  searchYoutube,
  clearSearchCache,
  CACHE_TTL_MS,
  NEGATIVE_CACHE_TTL_MS,
  MAX_CACHE_ENTRIES,
  MAX_NEGATIVE_CACHE_ENTRIES,
  MAX_SEARCH_RESULTS
};
