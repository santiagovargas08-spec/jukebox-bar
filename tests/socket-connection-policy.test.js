'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  createSocketConnectionPolicy,
  MAX_CONNECTIONS_PER_IP
} = require('../services/socketConnectionPolicy.js');

describe('socket connection policy', () => {
  it('limita conexiones repetidas desde la misma IP', () => {
    const policy = createSocketConnectionPolicy();
    const socket = {
      handshake: {
        headers: {},
        address: '198.51.100.40'
      }
    };

    for (let index = 0; index < MAX_CONNECTIONS_PER_IP; index += 1) {
      assert.equal(policy.allowConnection(socket), true);
    }

    assert.equal(policy.allowConnection(socket), false);
  });

  it('separa el límite por IP', () => {
    const policy = createSocketConnectionPolicy();

    const first = {
      handshake: {
        headers: {},
        address: '198.51.100.40'
      }
    };
    const second = {
      handshake: {
        headers: {},
        address: '198.51.100.41'
      }
    };

    for (let index = 0; index < MAX_CONNECTIONS_PER_IP; index += 1) {
      policy.allowConnection(first);
    }

    assert.equal(policy.allowConnection(second), true);
  });
});
