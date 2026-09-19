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

  it('rechaza videoId malformado', async () => {
    await assert.rejects(
      () => queueService.addToQueue(bar.id, {
        videoId: '../invalid',
        title: 'Inválida',
        name: 'Cliente'
      }),
      /videoId inválido/
    );
  });

  it('agregar y eliminar canción', async () => {
    const added = await queueService.addToQueue(bar.id, {
      videoId: 'Queue000001',
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
      videoId: 'QueueA00001',
      title: 'A',
      name: 'Cliente'
    });
    await queueService.addToQueue(bar.id, {
      videoId: 'QueueB00001',
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

  it('reordenar cambia position sin alterar createdAt', async () => {
    await queueService.clearQueue(bar.id);

    await queueService.addToQueue(bar.id, {
      videoId: 'OrderA00001',
      title: 'Primera',
      name: 'Cliente'
    });
    await queueService.addToQueue(bar.id, {
      videoId: 'OrderB00001',
      title: 'Segunda',
      name: 'Cliente'
    });
    await queueService.addToQueue(bar.id, {
      videoId: 'OrderC00001',
      title: 'Tercera',
      name: 'Cliente'
    });

    const before = await queueService.getQueue(bar.id);
    const createdAtById = new Map(
      before.map((item) => [item.id, item.createdAt.getTime()])
    );

    const reversedIds = before.map((item) => item.id).reverse();
    const reordered = await queueService.reorderQueue(bar.id, reversedIds);

    assert.deepEqual(
      reordered.map((item) => item.id),
      reversedIds
    );
    assert.deepEqual(
      reordered.map((item) => item.position),
      [1, 2, 3]
    );

    for (const item of reordered) {
      assert.equal(
        item.createdAt.getTime(),
        createdAtById.get(item.id)
      );
    }
  });

  it('concurrencia: cola no supera MAX_QUEUE_PER_BAR', async () => {
    await queueService.clearQueue(bar.id);

    const max = queueService.MAX_QUEUE_PER_BAR;
    const attempts = max + 10;

    const results = await Promise.allSettled(
      Array.from({ length: attempts }, (_, index) =>
        queueService.addToQueue(bar.id, {
          videoId: `C${String(index).padStart(10, '0')}`,
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

  it('remove y reorder concurrentes no corrompen la cola', async () => {
    await queueService.clearQueue(bar.id);

    await queueService.addToQueue(bar.id, {
      videoId: 'RaceA000001',
      title: 'Race A',
      name: 'Cliente'
    });
    await queueService.addToQueue(bar.id, {
      videoId: 'RaceB000001',
      title: 'Race B',
      name: 'Cliente'
    });
    await queueService.addToQueue(bar.id, {
      videoId: 'RaceC000001',
      title: 'Race C',
      name: 'Cliente'
    });

    const before = await queueService.getQueue(bar.id);
    const middleId = before[1].id;
    const reversedIds = before.map((item) => item.id).reverse();

    const [reorderResult, removeResult] = await Promise.allSettled([
      queueService.reorderQueue(bar.id, reversedIds),
      queueService.removeFromQueue(bar.id, middleId)
    ]);

    assert.equal(removeResult.status, 'fulfilled');
    assert.equal(removeResult.value, true);
    assert.ok(['fulfilled', 'rejected'].includes(reorderResult.status));

    const after = await queueService.getQueue(bar.id);
    assert.equal(after.length, 2);
    assert.equal(new Set(after.map((item) => item.id)).size, 2);
    assert.equal(after.some((item) => item.id === middleId), false);

    for (let index = 1; index < after.length; index += 1) {
      assert.ok(after[index - 1].position < after[index].position);
    }
  });

  it('takeNext concurrente sobre un solo item devuelve una sola canción', async () => {
    await queueService.clearQueue(bar.id);

    await queueService.addToQueue(bar.id, {
      videoId: 'TakeS000001',
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
