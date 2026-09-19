'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

const {
  requireTestDatabase,
  createTestBar,
  deleteTestBar,
  uniqueSlug
} = require('./helpers.js');

describe('master dashboard service', () => {
  let prisma;
  let getMasterDashboardStats;
  let activeBar;
  let inactiveBar;

  before(async () => {
    requireTestDatabase();

    delete require.cache[require.resolve('../db.js')];
    ({ prisma } = require('../db.js'));
    ({ getMasterDashboardStats } = require('../services/masterDashboardService.js'));

    activeBar = await createTestBar(prisma, {
      slug: uniqueSlug('dashboard-active')
    });

    inactiveBar = await createTestBar(prisma, {
      slug: uniqueSlug('dashboard-inactive')
    });

    await prisma.bar.update({
      where: { id: inactiveBar.id },
      data: { active: false }
    });
  });

  after(async () => {
    if (activeBar?.id) await deleteTestBar(prisma, activeBar.id);
    if (inactiveBar?.id) await deleteTestBar(prisma, inactiveBar.id);
    await prisma.$disconnect();
  });

  it('agrega estadísticas de bares y licencias', async () => {
    const stats = await getMasterDashboardStats();

    assert.ok(stats.total >= 2);
    assert.ok(stats.active >= 1);
    assert.ok(stats.inactive >= 1);
    assert.ok(stats.trial >= 2);
    assert.equal(
      stats.total,
      stats.active + stats.inactive
    );
  });
});
