'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  buildRequestOrigin,
  isTrustedRequestOrigin
} = require('../lib/originValidation.js');

describe('origin validation', () => {
  it('acepta el mismo origen de la solicitud', () => {
    const previous = process.env.APP_URL;
    process.env.APP_URL = '';

    const req = {
      protocol: 'https',
      headers: {
        host: 'jukebox.example.com',
        origin: 'https://jukebox.example.com'
      },
      get(name) {
        return this.headers[name.toLowerCase()] || null;
      }
    };

    assert.equal(
      buildRequestOrigin(req),
      'https://jukebox.example.com'
    );
    assert.equal(isTrustedRequestOrigin(req), true);

    process.env.APP_URL = previous;
  });

  it('acepta un origen configurado en APP_URL', () => {
    const previous = process.env.APP_URL;
    process.env.APP_URL =
      'https://jukebox.example.com,https://admin.example.com';

    const req = {
      protocol: 'https',
      headers: {
        host: 'jukebox.example.com',
        origin: 'https://admin.example.com'
      },
      get(name) {
        return this.headers[name.toLowerCase()] || null;
      }
    };

    assert.equal(isTrustedRequestOrigin(req), true);

    process.env.APP_URL = previous;
  });

  it('rechaza un origen externo', () => {
    const previous = process.env.APP_URL;
    process.env.APP_URL = 'https://jukebox.example.com';

    const req = {
      protocol: 'https',
      headers: {
        host: 'jukebox.example.com',
        origin: 'https://evil.example.net'
      },
      get(name) {
        return this.headers[name.toLowerCase()] || null;
      }
    };

    assert.equal(isTrustedRequestOrigin(req), false);

    process.env.APP_URL = previous;
  });

  it('permite clientes no navegador sin cabecera Origin', () => {
    const req = {
      protocol: 'https',
      headers: { host: 'jukebox.example.com' },
      get(name) {
        return this.headers[name.toLowerCase()] || null;
      }
    };

    assert.equal(isTrustedRequestOrigin(req), true);
  });
});
