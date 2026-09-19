'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const originalLoad = Module._load;

try {
  Module._load = function loadWithStubs(request, parent, isMain) {
    if (parent?.filename.endsWith('/socket/publicHandlers.js')) {
      if (request === '../services/barService.js') {
        return {
          getBarBySlug: async (slug) => {
            if (slug === 'bar-uno') return { id: 1 };
            if (slug === 'bar-dos') return { id: 2 };
            return null;
          }
        };
      }

      if (request === '../services/queueService.js') {
        return { addToQueue: async () => ({ created: true, item: {} }) };
      }

      if (request === '../services/youtubeSearchService.js') {
        return { searchYoutube: async () => ({ videos: [], cached: false }) };
      }

      if (request === '../services/searchRequestPolicy.js') {
        return { canSearch: () => true };
      }

      if (request === '../services/socketStateRequestPolicy.js') {
        return {
          allowBarSelection: () => true,
          allowStateRequest: () => true
        };
      }

      if (request === '../services/songRequestPolicy.js') {
        return {
          canRequestSong: () => true,
          isBlockedSong: () => false,
          normalizeRequesterName: (value) => value || 'Cliente'
        };
      }

      if (request === '../lib/logger.js') {
        return {
          logError: () => {},
          logInfo: () => {}
        };
      }
    }

    return originalLoad.call(this, request, parent, isMain);
  };

  module.exports.publicHandlers = require('../socket/publicHandlers.js');
} finally {
  Module._load = originalLoad;
}

const { registerPublicSocketHandlers } = module.exports.publicHandlers;

function createSocket(initialBarId = null) {
  const handlers = {};
  const emitted = [];
  const joined = [];
  const left = [];

  return {
    id: 'socket-test',
    data: initialBarId ? { barId: initialBarId } : {},
    handshake: {
      address: '127.0.0.1',
      headers: {}
    },
    handlers,
    emitted,
    joined,
    left,
    on(event, handler) {
      handlers[event] = handler;
    },
    emit(event, payload) {
      emitted.push({ event, payload });
    },
    join(room) {
      joined.push(room);
    },
    leave(room) {
      left.push(room);
    }
  };
}

function registerHandlers(socket, stateCalls) {
  registerPublicSocketHandlers({
    socket,
    clienteId: 'socket-t',
    verificarLicenciaSocket: async () => ({ status: 'ACTIVE' }),
    emitirEstadoSocket: async (_socket, barId) => {
      stateCalls.push(barId);
    },
    emitirEstadoBar: async () => {}
  });
}

describe('public socket tenant isolation', () => {
  it('leaves the previous room before joining a different bar', async () => {
    const socket = createSocket(1);
    const stateCalls = [];
    registerHandlers(socket, stateCalls);

    await socket.handlers.seleccionar_bar({ slug: 'bar-dos' });

    assert.deepEqual(socket.left, ['bar:1']);
    assert.deepEqual(socket.joined, ['bar:2']);
    assert.equal(socket.data.barId, 2);
    assert.deepEqual(stateCalls, [2]);
  });

  it('rechaza barId numérico enviado por un cliente público', async () => {
    const socket = createSocket();
    const stateCalls = [];
    registerHandlers(socket, stateCalls);

    await socket.handlers.seleccionar_bar({ barId: 2 });

    assert.equal(socket.data.barId, undefined);
    assert.deepEqual(socket.joined, []);
    assert.deepEqual(stateCalls, []);
    assert.equal(socket.emitted.at(-1).event, 'error_bar');
  });

  it('serves solicitar_estado without throwing and keeps the selected bar', async () => {
    const socket = createSocket(7);
    const stateCalls = [];
    registerHandlers(socket, stateCalls);

    await socket.handlers.solicitar_estado();

    assert.deepEqual(stateCalls, [7]);
    assert.equal(socket.data.barId, 7);
    assert.equal(socket.emitted.length, 0);
  });
});
