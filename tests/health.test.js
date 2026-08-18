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

  it('GET /health responde 200', async () => {
    const data = await new Promise((resolve, reject) => {
      http.get(`${baseUrl}/health`, (res) => {
        let body = '';

        res.on('data', (chunk) => {
          body += chunk;
        });

        res.on('end', () => {
          resolve({
            status: res.statusCode,
            body: JSON.parse(body)
          });
        });
      }).on('error', reject);
    });

    assert.equal(data.status, 200);
    assert.equal(data.body.ok, true);
  });
});
