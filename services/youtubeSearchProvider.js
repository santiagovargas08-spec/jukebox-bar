'use strict';

const ytSearch = require('yt-search');
const { withTimeout } = require('../lib/promiseTimeout.js');

const DEFAULT_YOUTUBE_SEARCH_TIMEOUT_MS = 15000;
const MIN_YOUTUBE_SEARCH_TIMEOUT_MS = 5000;
const MAX_YOUTUBE_SEARCH_TIMEOUT_MS = 30000;

function getYoutubeSearchTimeoutMs() {
  const configured = Number(
    process.env.YOUTUBE_SEARCH_TIMEOUT_MS ||
    DEFAULT_YOUTUBE_SEARCH_TIMEOUT_MS
  );

  if (!Number.isFinite(configured)) {
    return DEFAULT_YOUTUBE_SEARCH_TIMEOUT_MS;
  }

  return Math.min(
    Math.max(
      Math.round(configured),
      MIN_YOUTUBE_SEARCH_TIMEOUT_MS
    ),
    MAX_YOUTUBE_SEARCH_TIMEOUT_MS
  );
}

async function searchWithYoutubeProvider(
  query,
  {
    searchFn = ytSearch,
    timeoutMs = getYoutubeSearchTimeoutMs()
  } = {}
) {
  return withTimeout(
    Promise.resolve().then(
      () => searchFn(query)
    ),
    timeoutMs,
    {
      message: 'YOUTUBE_SEARCH_TIMEOUT',
      code: 'YOUTUBE_SEARCH_TIMEOUT'
    }
  );
}

module.exports = {
  searchWithYoutubeProvider,
  getYoutubeSearchTimeoutMs,
  DEFAULT_YOUTUBE_SEARCH_TIMEOUT_MS,
  MIN_YOUTUBE_SEARCH_TIMEOUT_MS,
  MAX_YOUTUBE_SEARCH_TIMEOUT_MS
};
