'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

const {
  requireTestDatabase,
  ensureOperatorSecret,
  createTestBar,
  deleteTestBar,
  uniqueSlug
} = require('./helpers.js');

describe('operator logout HTTP', () => {
  let prisma;
  let server;
  let baseUrl;
  let bar;
  let authService;

  before(async () => {
    requireTestDatabase();
    ensureOperatorSecret();

    delete require.cache[require.resolve('../db.js')];
    delete require.cache[require.resolve('../server.js')];

    ({ prisma } = require('../db.js'));
    authService = require('../services/operatorAuthService.js');

    bar = await createTestBar(prisma, {
      slug: uniqueSlug('logout-bar')
    });

    await authService.createAdminUser({
      barId: bar.id,
      email: 'logout@test.local',
      displayName: 'Logout Test',
      password: 'password-test-12',
      role: 'OPERATOR'
    });

    ({ server } = require('../server.js'));

    await new Promise((resolve, reject) => {
      server.listen(0, '127.0.0.1', (error) => {
        if (error) {
          reject(error);
          return;
        }

        baseUrl = `http://127.0.0.1:${server.address().port}`;
        resolve();
      });
    });
  });

  after(async () => {
    if (server?.listening) {
      await new Promise((resolve) => server.close(resolve));
    }

    if (bar?.id) {
      await deleteTestBar(prisma, bar.id);
    }

    await prisma.$disconnect();
  });

  it('revoca el token del operador al cerrar sesión', async () => {
    const loginResponse = await fetch(
      `${baseUrl}/api/public/bars/${encodeURIComponent(bar.slug)}/operator/login`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'logout@test.local',
          password: 'password-test-12'
        })
      }
    );

    assert.equal(loginResponse.status, 200);

    const loginBody = await loginResponse.json();
    const token = loginBody.data.token;

    assert.ok(
      await authService.getActiveAdminFromToken(token)
    );

    const logoutResponse = await fetch(
      `${baseUrl}/api/public/bars/${encodeURIComponent(bar.slug)}/operator/logout`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    );

    assert.equal(logoutResponse.status, 200);
    assert.equal(
      logoutResponse.headers.get('cache-control'),
      'no-store, max-age=0'
    );

    const revoked =
      await authService.getActiveAdminFromToken(token);

    assert.equal(revoked, null);
  });

  it('rechaza logout sin Bearer token', async () => {
    const response = await fetch(
      `${baseUrl}/api/public/bars/${encodeURIComponent(bar.slug)}/operator/logout`,
      { method: 'POST' }
    );

    assert.equal(response.status, 401);
  });
});
