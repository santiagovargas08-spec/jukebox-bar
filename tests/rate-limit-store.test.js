'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { RateLimitStore } = require('../lib/rateLimitStore.js');

describe('RateLimitStore', () => {
  it('bloquea después del máximo de hits', () => {
    const store = new RateLimitStore(1000);

    assert.equal(store.hit('demo', 1000, 2).allowed, true);
    assert.equal(store.hit('demo', 1000, 2).allowed, true);
    assert.equal(store.hit('demo', 1000, 2).allowed, false);
  });

  it('reset elimina el contador de una clave', () => {
    const store = new RateLimitStore(1000);

    store.hit('demo', 1000, 1);
    assert.equal(store.hit('demo', 1000, 1).allowed, false);

    assert.equal(store.reset('demo'), true);
    assert.equal(store.hit('demo', 1000, 1).allowed, true);
  });
});
