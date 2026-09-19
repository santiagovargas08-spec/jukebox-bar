'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

const {
  requireTestDatabase,
  createTestBar,
  deleteTestBar,
  uniqueSlug
} = require('./helpers.js');

describe('bar access service', () => {
  let prisma;
  let validarAccesoBar;
  const barIds = [];

  before(async () => {
    requireTestDatabase();

    delete require.cache[require.resolve('../db.js')];
    ({ prisma } = require('../db.js'));

    ({ validarAccesoBar } =
      require('../services/barAccessService.js'));
  });

  after(async () => {
    for (const id of barIds) {
      await deleteTestBar(prisma, id);
    }

    await prisma.$disconnect();
  });

  async function createBar(prefix) {
    const bar = await createTestBar(prisma, {
      slug: uniqueSlug(prefix)
    });

    barIds.push(bar.id);
    return bar;
  }

  it('permite un bar activo con trial vigente', async () => {
    const bar = await createBar('access-trial');

    const result = await validarAccesoBar(bar.id);

    assert.equal(result.valid, true);
    assert.equal(result.status, 'TRIAL');
    assert.equal(result.bar.id, bar.id);
  });

  it('bloquea un bar desactivado', async () => {
    const bar = await createBar('access-inactive');

    await prisma.bar.update({
      where: { id: bar.id },
      data: { active: false }
    });

    const result = await validarAccesoBar(bar.id);

    assert.equal(result.valid, false);
    assert.equal(result.reason, 'BAR_INACTIVE');
  });

  it('refresca una licencia ACTIVE vencida y la bloquea', async () => {
    const bar = await createBar('access-expired');

    await prisma.license.update({
      where: { barId: bar.id },
      data: {
        status: 'ACTIVE',
        plan: 'MONTHLY',
        startedAt: new Date(Date.now() - 40 * 86400000),
        expiresAt: new Date(Date.now() - 86400000)
      }
    });

    const result = await validarAccesoBar(bar.id);

    assert.equal(result.valid, false);
    assert.equal(result.reason, 'EXPIRED');

    const license = await prisma.license.findUnique({
      where: { barId: bar.id }
    });

    assert.equal(license.status, 'EXPIRED');
  });

  it('bloquea una licencia suspendida sin modificarla', async () => {
    const bar = await createBar('access-suspended');

    await prisma.license.update({
      where: { barId: bar.id },
      data: {
        status: 'SUSPENDED'
      }
    });

    const result = await validarAccesoBar(bar.id);

    assert.equal(result.valid, false);
    assert.equal(result.reason, 'SUSPENDED');
  });
});
