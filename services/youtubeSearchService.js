'use strict';

const { logWarn } = require('../lib/logger.js');
const {
  getExactPersistentSearchCache,
  getApproxPersistentSearchCache,
  setPersistentSearchCache,
  normalizeSearchQuery,
  canonicalSearchKey
} = require('./searchCacheService.js');
const {
  warmKnownSongs,
  searchKnownSongs,
  rememberKnownSong
} = require('./knownSongCatalogService.js');
const {
  searchWithYoutubeProvider
} = require('./youtubeSearchProvider.js');

const CACHE_TTL_MS = 60 * 60 * 1000;
const NEGATIVE_CACHE_TTL_MS = 2 * 60 * 1000;
const MAX_CACHE_ENTRIES = 1500;
const MAX_NEGATIVE_CACHE_ENTRIES = 300;
const MAX_SEARCH_RESULTS = 10;

const cache = new Map();
const negativeCache = new Map();
const inFlight = new Map();

function emptyTimings() {
  return {
    memoryMs: 0,
    catalogMs: 0,
    databaseExactMs: 0,
    youtubeMs: 0,
    databaseApproxMs: 0,
    totalMs: 0
  };
}

function elapsedSince(startedAt) {
  return Date.now() - startedAt;
}

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
  cache.delete(queryKey);
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
  negativeCache.delete(queryKey);
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

async function fetchYoutube(
  text,
  key,
  {
    searchFn,
    usePersistentCache
  }
) {
  let pending =
    inFlight.get(key);

  if (!pending) {
    pending = (async () => {
      const startedAt =
        Date.now();

      try {
        const result =
          await searchWithYoutubeProvider(
            text,
            searchFn
              ? { searchFn }
              : undefined
          );

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
          negativeCache.delete(key);

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
            elapsedSince(startedAt)
        };
      } catch (error) {
        const timedOut =
          error?.code ===
          'YOUTUBE_SEARCH_TIMEOUT';

        logWarn(
          timedOut
            ? 'Timeout en búsqueda directa de YouTube'
            : 'Error en búsqueda directa de YouTube',
          {
            event:
              timedOut
                ? 'youtube_search_provider_timeout'
                : 'youtube_search_provider_error',
            error:
              error?.message ||
              String(error),
            elapsedMs:
              elapsedSince(startedAt)
          }
        );

        return {
          videos: [],
          cacheLayer: 'youtube',
          status:
            timedOut
              ? 'PROVIDER_TIMEOUT'
              : 'PROVIDER_ERROR',
          elapsedMs:
            elapsedSince(startedAt)
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

  return pending;
}

function refreshStaleInBackground(
  text,
  key
) {
  if (inFlight.has(key)) {
    return;
  }

  void fetchYoutube(
    text,
    key,
    {
      usePersistentCache: true
    }
  ).catch((error) => {
    logWarn(
      'No se pudo revalidar cache stale de busqueda',
      {
        event:
          'youtube_search_stale_revalidate_error',
        error:
          error?.message ||
          String(error)
      }
    );
  });
}

async function searchYoutube(
  query,
  {
    searchFn,
    usePersistentCache = true,
    useKnownSongs = true
  } = {}
) {
  const totalStartedAt =
    Date.now();

  const timings =
    emptyTimings();

  const text =
    String(query || '').trim();

  if (!text) {
    return {
      videos: [],
      cached: false,
      status: 'EMPTY_QUERY',
      timings: {
        ...timings,
        totalMs:
          elapsedSince(totalStartedAt)
      }
    };
  }

  const key =
    canonicalSearchKey(text) ||
    normalizeSearchQuery(text);

  let layerStartedAt =
    Date.now();

  const cachedVideos =
    getCached(key);

  timings.memoryMs =
    elapsedSince(layerStartedAt);

  if (cachedVideos) {
    return {
      videos: cachedVideos,
      cached: true,
      cacheLayer: 'memory',
      status: 'OK',
      timings: {
        ...timings,
        totalMs:
          elapsedSince(totalStartedAt)
      }
    };
  }

  if (useKnownSongs) {
    layerStartedAt =
      Date.now();

    await warmKnownSongs();

    const knownVideos =
      searchKnownSongs(
        text,
        10
      );

    timings.catalogMs =
      elapsedSince(layerStartedAt);

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
        status: 'OK',
        timings: {
          ...timings,
          totalMs:
            elapsedSince(totalStartedAt)
        }
      };
    }
  }

  if (usePersistentCache) {
    layerStartedAt =
      Date.now();

    const exact =
      await getExactPersistentSearchCache(
        text,
        { allowStale: true }
      );

    timings.databaseExactMs =
      elapsedSince(layerStartedAt);

    if (
      exact &&
      Array.isArray(exact.videos) &&
      exact.videos.length > 0
    ) {
      setCached(
        key,
        exact.videos
      );

      rememberSearchResults(
        exact.videos
      );

      if (exact.stale) {
        refreshStaleInBackground(
          text,
          key
        );
      }

      return {
        videos:
          exact.videos,
        cached: true,
        stale:
          Boolean(exact.stale),
        cacheLayer:
          exact.stale
            ? 'database-stale'
            : 'database',
        status: 'OK',
        timings: {
          ...timings,
          totalMs:
            elapsedSince(totalStartedAt)
        }
      };
    }
  }

  if (hasNegativeCache(key)) {
    return {
      videos: [],
      cached: true,
      cacheLayer:
        'negative-memory',
      status: 'NO_RESULTS',
      timings: {
        ...timings,
        totalMs:
          elapsedSince(totalStartedAt)
      }
    };
  }

  layerStartedAt =
    Date.now();

  const providerResult =
    await fetchYoutube(
      text,
      key,
      {
        searchFn,
        usePersistentCache
      }
    );

  timings.youtubeMs =
    elapsedSince(layerStartedAt);

  if (
    providerResult.videos.length > 0 ||
    providerResult.status ===
      'NO_RESULTS'
  ) {
    return {
      videos:
        providerResult.videos,
      cached: false,
      cacheLayer:
        providerResult.cacheLayer ||
        'youtube',
      status:
        providerResult.status,
      elapsedMs:
        providerResult.elapsedMs || 0,
      timings: {
        ...timings,
        youtubeMs:
          providerResult.elapsedMs ||
          timings.youtubeMs,
        totalMs:
          elapsedSince(totalStartedAt)
      }
    };
  }

  if (usePersistentCache) {
    layerStartedAt =
      Date.now();

    const approximate =
      await getApproxPersistentSearchCache(
        text
      );

    timings.databaseApproxMs =
      elapsedSince(layerStartedAt);

    if (
      approximate &&
      Array.isArray(
        approximate.videos
      ) &&
      approximate.videos.length > 0
    ) {
      setCached(
        key,
        approximate.videos
      );

      rememberSearchResults(
        approximate.videos
      );

      return {
        videos:
          approximate.videos,
        cached: true,
        degraded: true,
        providerStatus:
          providerResult.status,
        cacheLayer:
          'database-approx-fallback',
        status: 'OK',
        timings: {
          ...timings,
          youtubeMs:
            providerResult.elapsedMs ||
            timings.youtubeMs,
          totalMs:
            elapsedSince(totalStartedAt)
        }
      };
    }
  }

  return {
    videos: [],
    cached: false,
    cacheLayer:
      providerResult.cacheLayer ||
      'youtube',
    status:
      providerResult.status,
    elapsedMs:
      providerResult.elapsedMs || 0,
    timings: {
      ...timings,
      youtubeMs:
        providerResult.elapsedMs ||
        timings.youtubeMs,
      totalMs:
        elapsedSince(totalStartedAt)
    }
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
