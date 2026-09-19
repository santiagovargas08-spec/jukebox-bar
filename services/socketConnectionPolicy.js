'use strict';

const { RateLimitStore } = require('../lib/rateLimitStore.js');
const { normalizeSocketIp } = require('./songRequestPolicy.js');

const CONNECTION_WINDOW_MS = 60 * 1000;
const MAX_CONNECTIONS_PER_IP = 300;

function createSocketConnectionPolicy() {
  const limits = new RateLimitStore(CONNECTION_WINDOW_MS);

  function allowConnection(socket) {
    const ip = normalizeSocketIp(socket);
    const result = limits.hit(
      `socket-connect:${ip}`,
      CONNECTION_WINDOW_MS,
      MAX_CONNECTIONS_PER_IP
    );

    return result.allowed;
  }

  return {
    allowConnection
  };
}

const defaultPolicy = createSocketConnectionPolicy();

module.exports = {
  allowConnection: defaultPolicy.allowConnection,
  createSocketConnectionPolicy,
  CONNECTION_WINDOW_MS,
  MAX_CONNECTIONS_PER_IP
};
