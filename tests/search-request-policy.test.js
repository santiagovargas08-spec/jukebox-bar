'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  createSearchRequestPolicy,
  MAX_SEARCHES_PER_IP_BAR
} = require('../services/searchRequestPolicy.js');

describe('search request policy', () => {
  it('rechaza barId inválido', () => {
    const policy = createSearchRequestPolicy();
    const socket = {
      handshake: {
        headers: {},
        address: '198.51.100.10'
      }
    };

    assert.equal(policy.canSearch(socket, null), false);
  });

  it('limita búsquedas compartidas por IP y bar', () => {
    const policy = createSearchRequestPolicy();
    const socket = {
      handshake: {
        headers: {},
        address: '198.51.100.10'
      }
    };

    for (let i = 0; i < MAX_SEARCHES_PER_IP_BAR; i += 1) {
      assert.equal(policy.canSearch(socket, 1), true);
    }

    assert.equal(policy.canSearch(socket, 1), false);
  });

  it('separa el presupuesto entre bares', () => {
    const policy = createSearchRequestPolicy();
    const socket = {
      handshake: {
        headers: {},
        address: '198.51.100.10'
      }
    };

    for (let i = 0; i < MAX_SEARCHES_PER_IP_BAR; i += 1) {
      policy.canSearch(socket, 1);
    }

    assert.equal(policy.canSearch(socket, 2), true);
  });
});
