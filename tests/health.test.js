'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { ensureOperatorSecret, requireTestDatabase } = require('./helpers.js');

describe('health', () => {
  let server;
  let baseUrl;

  before(async () => {
    ensureOperatorSecret();
    requireTestDatabase();

    delete require.cache[require.resolve('../db.js')];
    delete require.cache[require.resolve('../server.js')];

    const { server: appServer } = require('../server.js');

    server = appServer;

    await new Promise((resolve, reject) => {
      server.listen(0, (error) => {
        if (error) {
          reject(error);
          return;
        }

        const address = server.address();
        baseUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });
  });

  after(async () => {
    if (server?.listening) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  async function getResponse(pathname) {
    return new Promise((resolve, reject) => {
      http.get(`${baseUrl}${pathname}`, (res) => {
        let body = '';

        res.on('data', (chunk) => {
          body += chunk;
        });

        res.on('end', () => {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body
          });
        });
      }).on('error', reject);
    });
  }

  async function getJson(pathname) {
    const response = await getResponse(pathname);

    return {
      ...response,
      body: JSON.parse(response.body)
    };
  }

  it('GET /health responde 200', async () => {
    const data = await getJson('/health');

    assert.equal(data.status, 200);
    assert.equal(data.body.ok, true);
  });

  it('GET /ready responde 200 cuando PostgreSQL está disponible', async () => {
    const data = await getJson('/ready');

    assert.equal(data.status, 200);
    assert.equal(data.body.ok, true);
    assert.equal(data.body.database, 'ready');
  });

  it('sirve las cuatro interfaces públicas con cabeceras de seguridad', async () => {
    const pages = [
      '/cliente.html',
      '/bar.html',
      '/admin.html',
      '/master-admin.html'
    ];

    for (const page of pages) {
      const response = await getResponse(page);

      assert.equal(response.status, 200, page);
      assert.match(
        String(response.headers['content-type'] || ''),
        /text\/html/i,
        page
      );
      assert.match(
        String(response.headers['content-security-policy'] || ''),
        /default-src 'self'/,
        page
      );
      assert.equal(
        response.headers['x-content-type-options'],
        'nosniff',
        page
      );
      assert.doesNotMatch(response.body, /^\s*```/, page);
    }
  });
});
