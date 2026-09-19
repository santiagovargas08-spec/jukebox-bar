'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { httpAccessLog } = require('../middleware/httpAccessLog.js');

function createResponse(statusCode = 200) {
  const listeners = new Map();

  return {
    statusCode,
    once(event, handler) {
      listeners.set(event, handler);
    },
    finish() {
      listeners.get('finish')?.();
    }
  };
}

describe('http access log', () => {
  it('registra el listener finish y continúa el middleware', () => {
    const req = {
      id: 'req-test-1234',
      method: 'GET',
      path: '/api/public/test'
    };
    const res = createResponse();

    let nextCalled = false;

    httpAccessLog(req, res, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, true);
    assert.doesNotThrow(() => res.finish());
  });

  it('no falla para health checks', () => {
    const req = {
      id: 'req-health-1234',
      method: 'GET',
      path: '/health'
    };
    const res = createResponse();

    httpAccessLog(req, res, () => {});
    assert.doesNotThrow(() => res.finish());
  });
});
