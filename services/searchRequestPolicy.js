'use strict';

const { RateLimitStore } = require('../lib/rateLimitStore.js');
const { normalizeSocketIp } = require('./songRequestPolicy.js');

const SEARCH_WINDOW_MS = 60 * 1000;
const MAX_SEARCHES_PER_IP_BAR = 180;
const MAX_SEARCHES_PER_BAR = 600;

function createSearchRequestPolicy() {
  const ipLimits = new RateLimitStore(SEARCH_WINDOW_MS);
  const barLimits = new RateLimitStore(SEARCH_WINDOW_MS);

  function canSearch(socket, barId) {
    const id = Number(barId);

    if (!Number.isInteger(id) || id <= 0) {
      return false;
    }

    const ip = normalizeSocketIp(socket);

    const ipLimit = ipLimits.hit(
      `search:ip:${ip}:bar:${id}`,
      SEARCH_WINDOW_MS,
      MAX_SEARCHES_PER_IP_BAR
    );

    if (!ipLimit.allowed) {
      return false;
    }

    const barLimit = barLimits.hit(
      `search:bar:${id}`,
      SEARCH_WINDOW_MS,
      MAX_SEARCHES_PER_BAR
    );

    return barLimit.allowed;
  }

  return {
    canSearch
  };
}

const defaultPolicy = createSearchRequestPolicy();

module.exports = {
  canSearch: defaultPolicy.canSearch,
  createSearchRequestPolicy,
  SEARCH_WINDOW_MS,
  MAX_SEARCHES_PER_IP_BAR,
  MAX_SEARCHES_PER_BAR
};
