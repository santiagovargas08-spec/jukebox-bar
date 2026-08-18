'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

const {
  requireTestDatabase,
  createTestBar,
  deleteTestBar,
  uniqueSlug
} = require('./helpers.js');

describe('queue', () => {
  let prisma;
  let bar;
  let queueService;

  before(async () => {
    requireTestDatabase();

    delete require.cache[require.resolve('../db.js')];
    ({ prisma } = require('../db.js'));
    queueService = require('../services/queueService.js');

    bar = await createTestBar(prisma, { slug: uniqueSlug('queue-bar') });
  });

  after(async () => {
    if (bar?.id) await deleteTestBar(prisma, bar.id);
    await prisma.$disconnect();
  });

  it('agregar y eliminar canción', async () => {
    const added = await queueService.addToQueue(bar.id, {
      videoId: 'q-1',
      title: 'Test Song',
      name: 'Cliente'
    });

    assert.equal(added.created, true);

    const cola = await queueService.getQueue(bar.id);
    assert.equal(cola.length, 1);

    const removed = await queueService.removeFromQueue(bar.id, cola[0].id);
    assert.equal(removed, true);
    assert.equal((await queueService.getQueue(bar.id)).length, 0);
  });

  it('rechaza IDs duplicados en reorder', async () => {
    await queueService.addToQueue(bar.id, {
      videoId: 'q-a',
      title: 'A',
      name: 'Cliente'
    });
    await queueService.addToQueue(bar.id, {
      videoId: 'q-b',
      title: 'B',
      name: 'Cliente'
    });

    const cola = await queueService.getQueue(bar.id);
    const id = cola[0].id;

    await assert.rejects(
      () => queueService.reorderQueue(bar.id, [id, id]),
      /duplicados/
    );
  });

  it('concurrencia: cola no supera MAX_QUEUE_PER_BAR', async () => {
    await queueService.clearQueue(bar.id);

    const max = queueService.MAX_QUEUE_PER_BAR;
    const attempts = max + 10;

    const results = await Promise.allSettled(
      Array.from({ length: attempts }, (_, index) =>
        queueService.addToQueue(bar.id, {
          videoId: `conc-${index}`,
          title: `Song ${index}`,
          name: 'Cliente'
        })
      )
    );

    const cola = await queueService.getQueue(bar.id);
    assert.ok(cola.length <= max);

    const rejected = results.filter(
      (result) =>
        result.status === 'rejected' &&
        String(result.reason?.message || result.reason).includes('QUEUE_FULL')
    );

    assert.ok(rejected.length >= 10);
  });

  it('takeNext concurrente sobre un solo item devuelve una sola canción', async () => {
    await queueService.clearQueue(bar.id);

    await queueService.addToQueue(bar.id, {
      videoId: 'take-single',
      title: 'Take Single',
      name: 'Cliente'
    });

    const [first, second] = await Promise.all([
      queueService.takeNextFromQueue(bar.id),
      queueService.takeNextFromQueue(bar.id)
    ]);

    const taken = [first, second].filter(Boolean);
    assert.equal(taken.length, 1);

    const cola = await queueService.getQueue(bar.id);
    assert.equal(cola.length, 0);
  });
});
