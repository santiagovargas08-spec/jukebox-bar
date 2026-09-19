'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  buildContentSecurityPolicy,
  securityHeaders
} = require('../lib/securityHeaders.js');

describe('security headers', () => {
  it('CSP bloquea objetos y limita el origen por defecto', () => {
    const policy = buildContentSecurityPolicy();
    assert.match(policy, /default-src 'self'/);
    assert.match(policy, /object-src 'none'/);
    assert.match(policy, /frame-ancestors 'self'/);
  });

  it('middleware añade cabeceras base', () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'test';

    const headers = {};
    const res = {
      setHeader(name, value) {
        headers[name.toLowerCase()] = value;
      }
    };

    let called = false;
    securityHeaders({}, res, () => {
      called = true;
    });

    assert.equal(called, true);
    assert.equal(headers['x-content-type-options'], 'nosniff');
    assert.equal(headers['x-frame-options'], 'SAMEORIGIN');
    assert.ok(headers['content-security-policy']);
    assert.equal(headers['strict-transport-security'], undefined);

    process.env.NODE_ENV = previous;
  });

  it('producción añade HSTS', () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    const headers = {};
    const res = {
      setHeader(name, value) {
        headers[name.toLowerCase()] = value;
      }
    };

    securityHeaders({}, res, () => {});
    assert.match(headers['strict-transport-security'], /max-age=31536000/);

    process.env.NODE_ENV = previous;
  });
});
