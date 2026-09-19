'use strict';

const { RateLimitStore } = require('../lib/rateLimitStore.js');
const { normalizeSocketIp } = require('./songRequestPolicy.js');

const WINDOW_MS = 60 * 1000;
const MAX_BAR_SELECTIONS_PER_IP = 60;
const MAX_STATE_REQUESTS_PER_SOCKET = 120;

function createSocketStateRequestPolicy() {
  const selectionLimits = new RateLimitStore(WINDOW_MS);
  const stateLimits = new RateLimitStore(WINDOW_MS);

  function allowBarSelection(socket) {
    const ip = normalizeSocketIp(socket);

    return selectionLimits.hit(
      `bar-select:${ip}`,
      WINDOW_MS,
      MAX_BAR_SELECTIONS_PER_IP
    ).allowed;
  }

  function allowStateRequest(socket) {
    const socketId =
      typeof socket?.id === 'string' && socket.id
        ? socket.id
        : 'unknown';

    return stateLimits.hit(
      `state:${socketId}`,
      WINDOW_MS,
      MAX_STATE_REQUESTS_PER_SOCKET
    ).allowed;
  }

  return {
    allowBarSelection,
    allowStateRequest
  };
}

const defaultPolicy = createSocketStateRequestPolicy();

module.exports = {
  allowBarSelection: defaultPolicy.allowBarSelection,
  allowStateRequest: defaultPolicy.allowStateRequest,
  createSocketStateRequestPolicy,
  WINDOW_MS,
  MAX_BAR_SELECTIONS_PER_IP,
  MAX_STATE_REQUESTS_PER_SOCKET
};
