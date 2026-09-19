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

describe('multi-tenant', () => {
  let prisma;
  let barA;
  let barB;
  let queueService;
  let historyService;
  let playbackService;
  let operatorAuthService;
  let tokenA;

  before(async () => {
    requireTestDatabase();
    ensureOperatorSecret();

    delete require.cache[require.resolve('../db.js')];
    ({ prisma } = require('../db.js'));

    queueService = require('../services/queueService.js');
    historyService = require('../services/historyService.js');
    playbackService = require('../services/playbackService.js');
    operatorAuthService = require('../services/operatorAuthService.js');

    barA = await createTestBar(prisma, { slug: uniqueSlug('bar-a') });
    barB = await createTestBar(prisma, { slug: uniqueSlug('bar-b') });

    await operatorAuthService.createAdminUser({
      barId: barA.id,
      email: 'op-a@test.local',
      displayName: 'Op A',
      password: 'password-test-12',
      role: 'OPERATOR'
    });

    const login = await operatorAuthService.authenticateOperator({
      slug: barA.slug,
      email: 'op-a@test.local',
      password: 'password-test-12'
    });

    tokenA = login.token;

    await queueService.addToQueue(barB.id, {
      videoId: 'VidB0000001',
      title: 'Canción B',
      name: 'Cliente B'
    });
  });

  after(async () => {
    if (barA?.id) await deleteTestBar(prisma, barA.id);
    if (barB?.id) await deleteTestBar(prisma, barB.id);
    await prisma.$disconnect();
  });

  it('operador A no puede leer cola de bar B vía token', async () => {
    const admin = await operatorAuthService.getActiveAdminFromToken(tokenA);
    assert.equal(admin.barId, barA.id);
    assert.notEqual(admin.barId, barB.id);
  });

  it('removeFromQueue no elimina items de otro bar', async () => {
    const colaB = await queueService.getQueue(barB.id);
    assert.equal(colaB.length, 1);

    const removed = await queueService.removeFromQueue(barA.id, colaB[0].id);
    assert.equal(removed, false);

    const colaBAfter = await queueService.getQueue(barB.id);
    assert.equal(colaBAfter.length, 1);
  });

  it('reorder rechaza IDs de otro bar', async () => {
    const colaB = await queueService.getQueue(barB.id);

    await assert.rejects(
      () => queueService.reorderQueue(barA.id, [colaB[0].id]),
      /inválidos|reordenaba/
    );
  });

  it('takeNext de bar A no consume cola de bar B', async () => {
    const taken = await queueService.takeNextFromQueue(barA.id);
    assert.equal(taken, null);

    const colaB = await queueService.getQueue(barB.id);
    assert.equal(colaB.length, 1);
  });

  it('historial de bar A no incluye bar B', async () => {
    await historyService.addToHistory(barB.id, {
      videoId: 'HistB000001',
      title: 'Hist B',
      name: 'Cliente'
    });

    const histA = await historyService.getHistory(barA.id, 10);
    assert.equal(histA.length, 0);
  });

  it('playback de bar A no lee estado de bar B', async () => {
    await playbackService.setNowPlaying(barB.id, {
      id: 1,
      videoId: 'PlayB000001',
      title: 'Play B',
      name: 'DJ'
    });

    const playA = await playbackService.getPlaybackState(barA.id);
    assert.equal(playA, null);
  });
});
