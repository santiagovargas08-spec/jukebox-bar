'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { getAppUrl, buildBarUrls } = require('../lib/barUrls.js');

describe('barUrls', () => {
  it('usa el primer origen de APP_URL para generar enlaces', () => {
    const previous = process.env.APP_URL;
    process.env.APP_URL =
      'https://jukebox.example.com,https://admin.example.com';

    assert.equal(
      getAppUrl(),
      'https://jukebox.example.com'
    );

    process.env.APP_URL = previous;
  });

  it('codifica el slug al construir URLs', () => {
    const previous = process.env.APP_URL;
    process.env.APP_URL = 'https://jukebox.example.com';

    const urls = buildBarUrls({
      slug: 'bar demo'
    });

    assert.equal(
      urls.cliente,
      'https://jukebox.example.com/cliente.html?bar=bar%20demo'
    );

    process.env.APP_URL = previous;
  });

  it('versiona el QR cuando cambia la configuración del bar', () => {
    const previous = process.env.APP_URL;
    process.env.APP_URL = 'https://jukebox.example.com';

    const urls = buildBarUrls({
      slug: 'demo',
      settings: {
        updatedAt: '2026-09-20T12:00:00.000Z'
      }
    });

    assert.equal(
      urls.qr,
      'https://jukebox.example.com/api/public/bars/demo/qr?v=1789905600000'
    );

    process.env.APP_URL = previous;
  });

  it('usa request como fallback fuera de configuración explícita', () => {
    const previous = process.env.APP_URL;
    process.env.APP_URL = '';

    const req = {
      headers: {},
      protocol: 'http',
      get(name) {
        return name === 'host'
          ? 'localhost:3000'
          : null;
      }
    };

    assert.equal(
      getAppUrl(req),
      'http://localhost:3000'
    );

    process.env.APP_URL = previous;
  });
});
