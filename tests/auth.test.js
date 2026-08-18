'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

const {
  requireTestDatabase,
  ensureOperatorSecret,
  createTestBar,
  deleteTestBar,
  uniqueSlug,
  createTestOperatorToken
} = require('./helpers.js');

describe('auth', () => {
  let prisma;
  let bar;
  let operatorAuthService;

  before(async () => {
    requireTestDatabase();
    ensureOperatorSecret();

    delete require.cache[require.resolve('../db.js')];
    ({ prisma } = require('../db.js'));

    operatorAuthService = require('../services/operatorAuthService.js');

    bar = await createTestBar(prisma, {
      slug: uniqueSlug('auth-bar')
    });

    await operatorAuthService.createAdminUser({
      barId: bar.id,
      email: 'operator@test.local',
      displayName: 'Operador Test',
      password: 'password-test-12',
      role: 'OPERATOR'
    });
  });

  after(async () => {
    if (bar?.id) {
      await deleteTestBar(prisma, bar.id);
    }

    await prisma.$disconnect();
  });

  it('login correcto devuelve token', async () => {
    const result = await operatorAuthService.authenticateOperator({
      slug: bar.slug,
      email: 'operator@test.local',
      password: 'password-test-12'
    });

    assert.ok(result?.token);
    assert.equal(result.admin.barId, bar.id);
  });

  it('login incorrecto (email inexistente) devuelve null', async () => {
    const result = await operatorAuthService.authenticateOperator({
      slug: bar.slug,
      email: 'noexiste@test.local',
      password: 'password-test-12'
    });

    assert.equal(result, null);
  });

  it('password incorrecto devuelve null', async () => {
    const result = await operatorAuthService.authenticateOperator({
      slug: bar.slug,
      email: 'operator@test.local',
      password: 'wrong-password'
    });

    assert.equal(result, null);
  });

  it('token expirado es rechazado', async () => {
    const secret = process.env.OPERATOR_TOKEN_SECRET;
    const login = await operatorAuthService.authenticateOperator({
      slug: bar.slug,
      email: 'operator@test.local',
      password: 'password-test-12'
    });

    const expiredToken = createTestOperatorToken(
      {
        sub: login.admin.id,
        barId: login.admin.barId,
        email: login.admin.email,
        tv: 0,
        exp: Date.now() - 1000
      },
      secret
    );

    const admin = await operatorAuthService.getActiveAdminFromToken(expiredToken);
    assert.equal(admin, null);
  });

  it('token manipulado es rechazado', async () => {
    const login = await operatorAuthService.authenticateOperator({
      slug: bar.slug,
      email: 'operator@test.local',
      password: 'password-test-12'
    });

    const tampered = `${login.token.slice(0, -4)}XXXX`;
    const admin = await operatorAuthService.getActiveAdminFromToken(tampered);
    assert.equal(admin, null);
  });

  it('token de otro bar es rechazado', async () => {
    const otherBar = await createTestBar(prisma, { slug: uniqueSlug('other-bar') });
    const secret = process.env.OPERATOR_TOKEN_SECRET;

    const login = await operatorAuthService.authenticateOperator({
      slug: bar.slug,
      email: 'operator@test.local',
      password: 'password-test-12'
    });

    const wrongBarToken = createTestOperatorToken(
      {
        sub: login.admin.id,
        barId: otherBar.id,
        email: login.admin.email,
        tv: 0,
        exp: Date.now() + 3600000
      },
      secret
    );

    const admin = await operatorAuthService.getActiveAdminFromToken(wrongBarToken);
    assert.equal(admin, null);

    await deleteTestBar(prisma, otherBar.id);
  });

  it('token revocado tras incrementar tokenVersion', async () => {
    const login = await operatorAuthService.authenticateOperator({
      slug: bar.slug,
      email: 'operator@test.local',
      password: 'password-test-12'
    });

    const admin = await operatorAuthService.getActiveAdminFromToken(login.token);
    assert.ok(admin);

    await operatorAuthService.revokeOperatorTokens(admin.id);

    const revoked = await operatorAuthService.getActiveAdminFromToken(login.token);
    assert.equal(revoked, null);
  });

  it('usuario desactivado no puede autenticarse', async () => {
    const email = 'inactive@test.local';

    await operatorAuthService.createAdminUser({
      barId: bar.id,
      email,
      displayName: 'Inactivo',
      password: 'password-test-12',
      role: 'OPERATOR'
    });

    await prisma.adminUser.updateMany({
      where: { barId: bar.id, email },
      data: { active: false }
    });

    const result = await operatorAuthService.authenticateOperator({
      slug: bar.slug,
      email,
      password: 'password-test-12'
    });

    assert.equal(result, null);
  });
});
