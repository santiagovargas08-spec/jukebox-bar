'use strict';

const { logWarn } = require('../lib/logger.js');

let prismaClient = null;

function getPrisma() {
  if (!prismaClient) {
    prismaClient =
      require('../db.js').prisma;
  }

  return prismaClient;
}

const SEARCH_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SEARCH_CACHE_MAX_ROWS = 500;
const SEARCH_CACHE_RESULTS_PER_QUERY = 10;
const SEARCH_CACHE_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
const APPROX_CACHE_SCAN_LIMIT = 80;
const APPROX_MIN_TOKENS = 2;
const APPROX_MIN_SCORE = 0.72;

let lastCleanupAt = 0;

function normalizeSearchQuery(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
}

function tokenizeSearchQuery(value) {
  return normalizeSearchQuery(value)
    .split(' ')
    .filter(
      (token) =>
        token.length >= 2
    );
}

function canonicalSearchKey(value) {
  return tokenizeSearchQuery(value)
    .sort()
    .join(' ')
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
      video.duration ||
      null
  };
}

function compactSearchResults(videos) {
  return (Array.isArray(videos) ? videos : [])
    .map(compactSearchResult)
    .filter(Boolean)
    .slice(0, SEARCH_CACHE_RESULTS_PER_QUERY);
}

function approximateQueryScore(
  query,
  candidate
) {
  const queryTokens =
    [...new Set(
      tokenizeSearchQuery(query)
    )];

  const candidateTokens =
    [...new Set(
      tokenizeSearchQuery(candidate)
    )];

  if (
    queryTokens.length <
      APPROX_MIN_TOKENS ||
    candidateTokens.length === 0
  ) {
    return 0;
  }

  const candidateSet =
    new Set(candidateTokens);

  const matched =
    queryTokens.filter(
      (token) =>
        candidateSet.has(token)
    ).length;

  if (matched < 2) {
    return 0;
  }

  const coverage =
    matched /
    queryTokens.length;

  const union =
    new Set([
      ...queryTokens,
      ...candidateTokens
    ]).size;

  const jaccard =
    union > 0
      ? matched / union
      : 0;

  return (
    coverage * 0.7 +
    jaccard * 0.3
  );
}

async function findExactPersistentCache(
  query
) {
  const canonical =
    canonicalSearchKey(query);

  const legacy =
    normalizeSearchQuery(query);

  if (!canonical) {
    return null;
  }

  let cached =
    await getPrisma().searchCache.findUnique({
      where: {
        queryKey: canonical
      }
    });

  if (
    !cached &&
    legacy &&
    legacy !== canonical
  ) {
    cached =
      await getPrisma().searchCache.findUnique({
        where: {
          queryKey: legacy
        }
      });
  }

  return cached;
}

async function getPersistentSearchCache(query) {
  const normalized =
    normalizeSearchQuery(query);

  if (!normalized) {
    return null;
  }

  try {
    const now = Date.now();

    const exact =
      await findExactPersistentCache(
        query
      );

    if (exact) {
      if (
        exact.expiresAt.getTime() <=
        now
      ) {
        getPrisma().searchCache.delete({
          where: {
            queryKey:
              exact.queryKey
          }
        }).catch(() => {});
      } else {
        return {
          videos:
            Array.isArray(exact.results)
              ? exact.results
              : [],
          matchType: 'exact'
        };
      }
    }

    const queryTokens =
      tokenizeSearchQuery(query);

    if (
      queryTokens.length <
      APPROX_MIN_TOKENS
    ) {
      return null;
    }

    const candidates =
      await getPrisma().searchCache.findMany({
        where: {
          expiresAt: {
            gt: new Date(now)
          }
        },
        orderBy: {
          updatedAt: 'desc'
        },
        take:
          APPROX_CACHE_SCAN_LIMIT,
        select: {
          query: true,
          results: true
        }
      });

    let best = null;

    for (const candidate of candidates) {
      const score =
        approximateQueryScore(
          query,
          candidate.query
        );

      if (
        score >=
          APPROX_MIN_SCORE &&
        (!best || score > best.score)
      ) {
        best = {
          score,
          results:
            candidate.results
        };
      }
    }

    if (
      best &&
      Array.isArray(best.results)
    ) {
      return {
        videos:
          best.results,
        matchType:
          'approximate'
      };
    }

    return null;
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
    await getPrisma().searchCache.deleteMany({
      where: {
        expiresAt: {
          lte: new Date(now)
        }
      }
    });

    const count =
      await getPrisma().searchCache.count();

    if (count <= SEARCH_CACHE_MAX_ROWS) {
      return;
    }

    const overflow =
      count - SEARCH_CACHE_MAX_ROWS;

    const oldest =
      await getPrisma().searchCache.findMany({
        orderBy: {
          updatedAt: 'asc'
        },
        take: overflow,
        select: {
          queryKey: true
        }
      });

    if (oldest.length > 0) {
      await getPrisma().searchCache.deleteMany({
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
    canonicalSearchKey(query);

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

    await getPrisma().searchCache.upsert({
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
  tokenizeSearchQuery,
  canonicalSearchKey,
  approximateQueryScore,
  compactSearchResults,
  SEARCH_CACHE_TTL_MS,
  SEARCH_CACHE_MAX_ROWS,
  SEARCH_CACHE_RESULTS_PER_QUERY,
  APPROX_CACHE_SCAN_LIMIT,
  APPROX_MIN_SCORE
};
