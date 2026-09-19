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
});
