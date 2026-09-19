'use strict';

const ytSearch = require('yt-search');
const { sanitizeThumbnailUrl, isValidYoutubeVideoId } = require('../lib/urlValidation.js');
const { withTimeout } = require('../lib/promiseTimeout.js');
const { logWarn } = require('../lib/logger.js');

const CACHE_TTL_MS = 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 500;
const SEARCH_TIMEOUT_MS = 15 * 1000;
const PROVIDER_FAILURE_THRESHOLD = 5;
const PROVIDER_OPEN_MS = 30 * 1000;
const MIN_VIDEO_DURATION_SECONDS = 45;
const MAX_VIDEO_DURATION_SECONDS = 15 * 60;
const MAX_SEARCH_RESULTS = 12;
const NEGATIVE_TITLE_TERMS = [
  'mix',
  'playlist',
  'compilation',
  'full album',
  'album completo',
  '1 hour',
  '2 hours',
  '3 hours',
  'hour loop',
  'radio',
  'live stream',
  'livestream',
  'karaoke'
];

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

    logWarn('Circuit breaker de YouTube abierto', {
      event: 'youtube_search_circuit_open',
      failures: providerCircuit.failures,
      openMs: PROVIDER_OPEN_MS
    });
  }
}

function getVideoDurationSeconds(video) {
  const seconds = Number(video?.duration?.seconds);

  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.round(seconds);
  }

  return null;
}

function isAcceptableYoutubeResult(video) {
  if (!video) return false;

  if (video.live === true || video.isLive === true) {
    return false;
  }

  const durationSeconds = getVideoDurationSeconds(video);

  if (
    durationSeconds !== null &&
    (
      durationSeconds < MIN_VIDEO_DURATION_SECONDS ||
      durationSeconds > MAX_VIDEO_DURATION_SECONDS
    )
  ) {
    return false;
  }

  return true;
}

function normalizeSearchText(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function scoreYoutubeResult(video, query) {
  const normalizedQuery = normalizeSearchText(query);
  const queryTokens = normalizedQuery
    .split(' ')
    .filter((token) => token.length >= 2);

  const title = normalizeSearchText(video?.title);
  const author = normalizeSearchText(video?.author?.name);
  const combined = `${title} ${author}`.trim();

  let score = 0;

  if (normalizedQuery && title === normalizedQuery) {
    score += 120;
  } else if (normalizedQuery && title.includes(normalizedQuery)) {
    score += 70;
  }

  if (normalizedQuery && combined.includes(normalizedQuery)) {
    score += 25;
  }

  for (const token of queryTokens) {
    if (title.includes(token)) score += 18;
    else if (author.includes(token)) score += 8;
  }

  if (/official (video|audio)|video oficial|audio oficial/.test(title)) {
    score += 20;
  }

  const durationSeconds = getVideoDurationSeconds(video);
  if (
    durationSeconds !== null &&
    durationSeconds >= 120 &&
    durationSeconds <= 420
  ) {
    score += 10;
  }

  for (const term of NEGATIVE_TITLE_TERMS) {
    if (title.includes(term)) {
      score -= 45;
    }
  }

  return score;
}

function rankYoutubeResults(videos, query) {
  return videos
    .map((video, index) => ({
      video,
      index,
      score: scoreYoutubeResult(video, query)
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.video);
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

  const durationSeconds = getVideoDurationSeconds(video);

  return {
    videoId,
    title,
    author: { name: author },
    thumbnail: sanitizeThumbnailUrl(thumbnail),
    durationSeconds,
    duration: video?.duration?.timestamp || null
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
  if (!text) {
    return {
      videos: [],
      cached: false,
      status: 'EMPTY_QUERY'
    };
  }

  const key = text.toLowerCase();
  const cachedVideos = getCached(key);

  if (cachedVideos) {
    return {
      videos: cachedVideos,
      cached: true,
      status: 'OK'
    };
  }

  if (isProviderCircuitOpen()) {
    return {
      videos: [],
      cached: false,
      status: 'PROVIDER_UNAVAILABLE'
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
          return {
            videos: [],
            status: 'PROVIDER_ERROR'
          };
        }

        const videos = rankYoutubeResults(
          result.videos.filter(isAcceptableYoutubeResult),
          text
        )
          .map(normalizeYoutubeResult)
          .filter(Boolean)
          .slice(0, MAX_SEARCH_RESULTS);

        // Una respuesta válida del proveedor, incluso sin resultados,
        // demuestra que el servicio sigue disponible. Solo errores, timeouts
        // o respuestas malformadas cuentan como fallo del proveedor.
        resetProviderCircuit();

        if (videos.length > 0) {
          setCached(key, videos);
        }

        return {
          videos,
          status: videos.length > 0 ? 'OK' : 'NO_RESULTS'
        };
      } catch (error) {
        recordProviderFailure();

        logWarn('Error en búsqueda de YouTube', {
          event: 'youtube_search_provider_error',
          code: error?.code || null,
          error: error?.message || String(error)
        });

        return {
          videos: [],
          status:
            error?.code === 'YOUTUBE_SEARCH_TIMEOUT'
              ? 'TIMEOUT'
              : 'PROVIDER_ERROR'
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
    status: result.status
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
  normalizeSearchText,
  scoreYoutubeResult,
  rankYoutubeResults,
  isAcceptableYoutubeResult,
  getVideoDurationSeconds,
  resetProviderCircuit,
  isProviderCircuitOpen,
  recordProviderFailure,
  SEARCH_TIMEOUT_MS,
  PROVIDER_FAILURE_THRESHOLD,
  PROVIDER_OPEN_MS,
  MIN_VIDEO_DURATION_SECONDS,
  MAX_VIDEO_DURATION_SECONDS,
  MAX_SEARCH_RESULTS
};
