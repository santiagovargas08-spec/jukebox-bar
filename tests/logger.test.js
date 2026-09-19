'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { sanitizeLogValue } = require('../lib/logger.js');

describe('logger redaction', () => {
  it('redacta campos sensibles de forma recursiva', () => {
    const input = {
      user: 'demo@example.com',
      password: 'secret-password',
      nested: {
        operatorToken: 'token-value',
        apiKey: 'api-key-value',
        safe: 'ok'
      }
    };

    const result = sanitizeLogValue(input);

    assert.equal(result.user, 'demo@example.com');
    assert.equal(result.password, '[REDACTED]');
    assert.equal(result.nested.operatorToken, '[REDACTED]');
    assert.equal(result.nested.apiKey, '[REDACTED]');
    assert.equal(result.nested.safe, 'ok');
  });

  it('maneja referencias circulares sin lanzar error', () => {
    const input = { name: 'demo' };
    input.self = input;

    const result = sanitizeLogValue(input);

    assert.equal(result.self, '[Circular]');
  });

  it('recorta strings extremadamente largos', () => {
    const result = sanitizeLogValue({
      message: 'x'.repeat(2500)
    });

    assert.ok(result.message.length < 2100);
    assert.match(result.message, /…$/);
  });
});
