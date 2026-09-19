'use strict';

const ytSearch = require('yt-search');
const { sanitizeThumbnailUrl, isValidYoutubeVideoId } = require('../lib/urlValidation.js');
const { withTimeout } = require('../lib/promiseTimeout.js');
const { logWarn } = require('../lib/logger.js');

const CACHE_TTL_MS = 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 500;
const SEARCH_TIMEOUT_MS = 8 * 1000;

const cache = new Map();

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
      return {
        videos: [],
        cached: false
      };
    }

    const videos = result.videos
      .slice(0, 25)
      .map(normalizeYoutubeResult)
      .filter(Boolean);

    setCached(key, videos);

    return {
      videos,
      cached: false
    };
  } catch (error) {
    logWarn('Error en búsqueda de YouTube', {
      event: 'youtube_search_provider_error',
      code: error?.code || null,
      error: error?.message || String(error)
    });

    return {
      videos: [],
      cached: false
    };
  }
}

function clearSearchCache() {
  cache.clear();
}

module.exports = {
  searchYoutube,
  clearSearchCache,
  normalizeYoutubeResult,
  SEARCH_TIMEOUT_MS
};
