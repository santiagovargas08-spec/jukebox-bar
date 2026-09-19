'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

const {
  requireTestDatabase,
  createTestBar,
  deleteTestBar,
  uniqueSlug
} = require('./helpers.js');

describe('bar service', () => {
  let prisma;
  let bar;
  let barService;

  before(async () => {
    requireTestDatabase();

    delete require.cache[require.resolve('../db.js')];
    ({ prisma } = require('../db.js'));
    barService = require('../services/barService.js');

    bar = await createTestBar(prisma, {
      slug: uniqueSlug('bar-service')
    });

    await prisma.user.create({
      data: {
        barId: bar.id,
        name: 'Usuario de prueba'
      }
    });
  });

  after(async () => {
    if (bar?.id) {
      await deleteTestBar(prisma, bar.id);
    }

    await prisma.$disconnect();
  });

  it('getBarById devuelve conteos sin cargar la lista completa de usuarios', async () => {
    const result = await barService.getBarById(bar.id);

    assert.ok(result);
    assert.equal(result._count.users, 1);
    assert.equal(
      Object.prototype.hasOwnProperty.call(result, 'users'),
      false
    );
  });
  it('pagina la lista de bares con total y límites seguros', async () => {
    const extra = await createTestBar(prisma, {
      slug: uniqueSlug('bar-service-page')
    });

    try {
      const page = await barService.listBarsPage({
        limit: 1,
        offset: 0
      });

      assert.equal(page.items.length, 1);
      assert.equal(page.limit, 1);
      assert.equal(page.offset, 0);
      assert.ok(page.total >= 2);

      const capped = await barService.listBarsPage({
        limit: 9999,
        offset: -20
      });

      assert.equal(capped.limit, 100);
      assert.equal(capped.offset, 0);
    } finally {
      await deleteTestBar(prisma, extra.id);
    }
  });

});
