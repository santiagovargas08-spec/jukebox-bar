'use strict';

const ytSearch = require('yt-search');
const { sanitizeThumbnailUrl, isValidYoutubeVideoId } = require('../lib/urlValidation.js');

const CACHE_TTL_MS = 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 500;

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

async function searchYoutube(query) {
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
    const result = await ytSearch(text);

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
    console.error('[YOUTUBE] Error buscando:', error);

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
  normalizeYoutubeResult
};
