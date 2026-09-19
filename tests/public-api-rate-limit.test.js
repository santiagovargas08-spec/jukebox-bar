'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeRequestIp
} = require('../middleware/publicApiRateLimit.js');

describe('public API rate limit', () => {
  it('normaliza req.ip', () => {
    assert.equal(
      normalizeRequestIp({ ip: ' 203.0.113.50 ' }),
      '203.0.113.50'
    );
  });

  it('usa unknown cuando req.ip no está disponible', () => {
    assert.equal(
      normalizeRequestIp({}),
      'unknown'
    );
  });

  it('acota la longitud de la IP registrada', () => {
    assert.equal(
      normalizeRequestIp({ ip: 'x'.repeat(500) }).length,
      120
    );
  });
});
