'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  createSocketStateRequestPolicy,
  MAX_BAR_SELECTIONS_PER_IP,
  MAX_STATE_REQUESTS_PER_SOCKET
} = require('../services/socketStateRequestPolicy.js');

function makeSocket(id = 'socket-a', ip = '198.51.100.9') {
  return {
    id,
    handshake: {
      headers: {},
      address: ip
    }
  };
}

describe('socket state request policy', () => {
  it('limita selecciones de bar por IP', () => {
    const policy = createSocketStateRequestPolicy();
    const socket = makeSocket();

    for (
      let index = 0;
      index < MAX_BAR_SELECTIONS_PER_IP;
      index += 1
    ) {
      assert.equal(policy.allowBarSelection(socket), true);
    }

    assert.equal(policy.allowBarSelection(socket), false);
  });

  it('limita solicitudes de estado por socket', () => {
    const policy = createSocketStateRequestPolicy();
    const socket = makeSocket();

    for (
      let index = 0;
      index < MAX_STATE_REQUESTS_PER_SOCKET;
      index += 1
    ) {
      assert.equal(policy.allowStateRequest(socket), true);
    }

    assert.equal(policy.allowStateRequest(socket), false);
  });

  it('separa presupuestos de estado por socket', () => {
    const policy = createSocketStateRequestPolicy();
    const first = makeSocket('socket-a');
    const second = makeSocket('socket-b');

    for (
      let index = 0;
      index < MAX_STATE_REQUESTS_PER_SOCKET;
      index += 1
    ) {
      policy.allowStateRequest(first);
    }

    assert.equal(policy.allowStateRequest(second), true);
  });
});
