'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

const {
  requireTestDatabase
} = require('./helpers.js');

describe('master admin HttpOnly session', () => {
  let prisma;
  let server;
  let baseUrl;
  let masterAdminId;

  before(async () => {
    requireTestDatabase();

    if (
      !process.env.MASTER_ADMIN_TOKEN_SECRET ||
      process.env.MASTER_ADMIN_TOKEN_SECRET.length < 32
    ) {
      process.env.MASTER_ADMIN_TOKEN_SECRET =
        'master-admin-test-secret-0123456789-abcdef';
    }

    delete require.cache[require.resolve('../db.js')];
    delete require.cache[require.resolve('../server.js')];

    ({ prisma } = require('../db.js'));

    const {
      createMasterAdmin
    } = require('../services/masterAdminAuthService.js');

    const email =
      `master-cookie-${Date.now()}@test.local`;

    const admin = await createMasterAdmin({
      email,
      displayName: 'Master Cookie Test',
      password: 'password-test-12'
    });

    masterAdminId = admin.id;

    ({ server } = require('../server.js'));

    await new Promise((resolve, reject) => {
      server.listen(0, '127.0.0.1', (error) => {
        if (error) {
          reject(error);
          return;
        }

        baseUrl =
          `http://127.0.0.1:${server.address().port}`;

        resolve();
      });
    });

    globalThis.__masterCookieTestEmail = email;
  });

  after(async () => {
    if (server?.listening) {
      await new Promise((resolve) => server.close(resolve));
    }

    if (masterAdminId) {
      await prisma.masterAdmin.delete({
        where: { id: masterAdminId }
      });
    }

    delete globalThis.__masterCookieTestEmail;
    await prisma.$disconnect();
  });

  it('login entrega cookie HttpOnly y no expone token en JSON', async () => {
    const response = await fetch(
      `${baseUrl}/api/public/master-admin/login`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          email: globalThis.__masterCookieTestEmail,
          password: 'password-test-12'
        })
      }
    );

    assert.equal(response.status, 200);

    const body = await response.json();

    assert.equal(body.ok, true);
    assert.equal(body.data.token, undefined);
    assert.ok(body.data.admin);

    const cookie = response.headers.get('set-cookie');

    assert.ok(cookie);
    assert.match(cookie, /jukebox_master_admin=/);
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Strict/i);

    const sessionCookie =
      cookie.split(';')[0];

    const meResponse = await fetch(
      `${baseUrl}/api/public/master-admin/me`,
      {
        headers: {
          Cookie: sessionCookie
        }
      }
    );

    assert.equal(meResponse.status, 200);

    const auditResponse = await fetch(
      `${baseUrl}/api/public/master-admin/audit?limit=5&offset=0`,
      {
        headers: {
          Cookie: sessionCookie
        }
      }
    );

    assert.equal(auditResponse.status, 200);

    const auditBody = await auditResponse.json();

    assert.equal(auditBody.ok, true);
    assert.ok(Array.isArray(auditBody.data.items));
    assert.ok(auditBody.data.limit <= 5);

    const logoutResponse = await fetch(
      `${baseUrl}/api/public/master-admin/logout`,
      {
        method: 'POST',
        headers: {
          Cookie: sessionCookie
        }
      }
    );

    assert.equal(logoutResponse.status, 200);

    const clearCookie =
      logoutResponse.headers.get('set-cookie');

    assert.ok(clearCookie);
    assert.match(clearCookie, /Max-Age=0|Expires=/i);
  });
});
