'use strict';

const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const {
  beginShutdown,
  isShuttingDown,
  resetLifecycleForTests
} = require('../lib/serviceLifecycle.js');

describe('service lifecycle', () => {
  afterEach(() => {
    resetLifecycleForTests();
  });

  it('empieza activo y permite iniciar shutdown una vez', () => {
    assert.equal(isShuttingDown(), false);
    assert.equal(beginShutdown(), true);
    assert.equal(isShuttingDown(), true);
    assert.equal(beginShutdown(), false);
  });

  it('puede reiniciarse entre procesos de test', () => {
    beginShutdown();
    resetLifecycleForTests();
    assert.equal(isShuttingDown(), false);
  });
});
