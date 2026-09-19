'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  requestId,
  sanitizeRequestId
} = require('../middleware/requestId.js');

describe('request ID middleware', () => {
  it('acepta un ID entrante válido', () => {
    assert.equal(
      sanitizeRequestId('req-12345678'),
      'req-12345678'
    );
  });

  it('rechaza IDs con caracteres inesperados', () => {
    assert.equal(
      sanitizeRequestId('bad id<script>'),
      null
    );
  });

  it('genera un ID cuando no llega uno válido', () => {
    const headers = {};
    const req = {
      headers: {},
      get() {
        return null;
      }
    };
    const res = {
      setHeader(name, value) {
        headers[name.toLowerCase()] = value;
      }
    };

    let called = false;

    requestId(req, res, () => {
      called = true;
    });

    assert.equal(called, true);
    assert.match(req.id, /^[0-9a-f-]{36}$/i);
    assert.equal(
      headers['x-request-id'],
      req.id
    );
  });
});
