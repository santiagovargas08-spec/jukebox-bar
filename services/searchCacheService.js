'use strict';

const { prisma } = require('../db.js');
const { logWarn } = require('../lib/logger.js');

const SEARCH_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SEARCH_CACHE_MAX_ROWS = 500;
const SEARCH_CACHE_RESULTS_PER_QUERY = 10;
const SEARCH_CACHE_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

let lastCleanupAt = 0;

function normalizeSearchQuery(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
}

function compactSearchResult(video) {
  if (!video || !video.videoId) {
    return null;
  }

  return {
    videoId: String(video.videoId),
    title: String(video.title || ''),
    author: {
      name: String(video.author?.name || '')
    },
    thumbnail:
      video.thumbnail
        ? String(video.thumbnail)
        : null,
    duration:
      video.duration?.timestamp ||
      null
  };
}

function compactSearchResults(videos) {
  return (Array.isArray(videos) ? videos : [])
    .map(compactSearchResult)
    .filter(Boolean)
    .slice(0, SEARCH_CACHE_RESULTS_PER_QUERY);
}

async function getPersistentSearchCache(query) {
  const queryKey = normalizeSearchQuery(query);

  if (!queryKey) {
    return null;
  }

  try {
    const cached =
      await prisma.searchCache.findUnique({
        where: { queryKey }
      });

    if (!cached) {
      return null;
    }

    if (
      cached.expiresAt.getTime() <=
      Date.now()
    ) {
      prisma.searchCache.delete({
        where: { queryKey }
      }).catch(() => {});

      return null;
    }

    return Array.isArray(cached.results)
      ? cached.results
      : null;
  } catch (error) {
    logWarn('No se pudo leer el cache persistente de busqueda', {
      event: 'search_cache_read_error',
      error:
        error?.message ||
        String(error)
    });

    return null;
  }
}

async function cleanupPersistentSearchCache() {
  const now = Date.now();

  if (
    now - lastCleanupAt <
    SEARCH_CACHE_CLEANUP_INTERVAL_MS
  ) {
    return;
  }

  lastCleanupAt = now;

  try {
    await prisma.searchCache.deleteMany({
      where: {
        expiresAt: {
          lte: new Date(now)
        }
      }
    });

    const count =
      await prisma.searchCache.count();

    if (count <= SEARCH_CACHE_MAX_ROWS) {
      return;
    }

    const overflow =
      count - SEARCH_CACHE_MAX_ROWS;

    const oldest =
      await prisma.searchCache.findMany({
        orderBy: {
          updatedAt: 'asc'
        },
        take: overflow,
        select: {
          queryKey: true
        }
      });

    if (oldest.length > 0) {
      await prisma.searchCache.deleteMany({
        where: {
          queryKey: {
            in: oldest.map(
              (entry) =>
                entry.queryKey
            )
          }
        }
      });
    }
  } catch (error) {
    logWarn('No se pudo limpiar el cache persistente de busqueda', {
      event: 'search_cache_cleanup_error',
      error:
        error?.message ||
        String(error)
    });
  }
}

async function setPersistentSearchCache(
  query,
  videos
) {
  const queryKey =
    normalizeSearchQuery(query);

  const results =
    compactSearchResults(videos);

  if (
    !queryKey ||
    results.length === 0
  ) {
    return;
  }

  try {
    const expiresAt =
      new Date(
        Date.now() +
        SEARCH_CACHE_TTL_MS
      );

    await prisma.searchCache.upsert({
      where: { queryKey },
      create: {
        queryKey,
        query:
          String(query || '')
            .trim()
            .slice(0, 160),
        results,
        expiresAt
      },
      update: {
        query:
          String(query || '')
            .trim()
            .slice(0, 160),
        results,
        expiresAt
      }
    });

    await cleanupPersistentSearchCache();
  } catch (error) {
    logWarn('No se pudo guardar el cache persistente de busqueda', {
      event: 'search_cache_write_error',
      error:
        error?.message ||
        String(error)
    });
  }
}

module.exports = {
  getPersistentSearchCache,
  setPersistentSearchCache,
  cleanupPersistentSearchCache,
  normalizeSearchQuery,
  compactSearchResults,
  SEARCH_CACHE_TTL_MS,
  SEARCH_CACHE_MAX_ROWS,
  SEARCH_CACHE_RESULTS_PER_QUERY
};
