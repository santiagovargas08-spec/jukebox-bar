'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

const {
  requireTestDatabase,
  createTestBar,
  deleteTestBar,
  uniqueSlug
} = require('./helpers.js');

describe('playback', () => {
  let prisma;
  let bar;
  let playbackService;
  let queueService;

  before(async () => {
    requireTestDatabase();

    delete require.cache[require.resolve('../db.js')];
    ({ prisma } = require('../db.js'));
    playbackService = require('../services/playbackService.js');
    queueService = require('../services/queueService.js');

    bar = await createTestBar(prisma, { slug: uniqueSlug('playback-bar') });
  });

  after(async () => {
    if (bar?.id) await deleteTestBar(prisma, bar.id);
    await prisma.$disconnect();
  });

  it('guarda y recupera estado de reproducción', async () => {
    const playing = await playbackService.setNowPlaying(bar.id, {
      id: 99,
      videoId: 'Play0000001',
      title: 'Now Playing',
      name: 'DJ',
      thumbnail: 'https://i.ytimg.com/vi/play-1/hqdefault.jpg'
    });

    assert.equal(playing.videoId, 'Play0000001');
    assert.equal(playing.titulo, 'Now Playing');

    const restored = await playbackService.getPlaybackState(bar.id);
    assert.equal(restored.videoId, 'Play0000001');
  });

  it('rechaza videoId inválido', async () => {
    await assert.rejects(
      () => playbackService.setNowPlaying(bar.id, {
        id: 101,
        videoId: '../bad-id',
        title: 'Inválida',
        name: 'DJ'
      }),
      /videoId inválido/
    );
  });

  it('advancePlayback mueve cola y reproducción en una sola operación', async () => {
    await queueService.clearQueue(bar.id);
    await playbackService.clearPlaybackState(bar.id);

    await queueService.addToQueue(bar.id, {
      videoId: 'Atomic00001',
      title: 'Atomic Song',
      name: 'Cliente'
    });

    const result = await playbackService.advancePlayback(bar.id);

    assert.ok(result);
    assert.equal(result.item.videoId, 'Atomic00001');
    assert.equal(result.playback.videoId, 'Atomic00001');
    assert.equal((await queueService.getQueue(bar.id)).length, 0);

    const state = await playbackService.getPlaybackState(bar.id);
    assert.equal(state.videoId, 'Atomic00001');
  });

  it('advancePlayback deja idle cuando la cola está vacía', async () => {
    await queueService.clearQueue(bar.id);

    await playbackService.setNowPlaying(bar.id, {
      id: 300,
      videoId: 'IdleNow0001',
      title: 'Idle Next',
      name: 'DJ'
    });

    const result = await playbackService.advancePlayback(bar.id);

    assert.equal(result, null);
    assert.equal(
      await playbackService.getPlaybackState(bar.id),
      null
    );
  });

  it('clearPlaybackState deja el bar en idle', async () => {
    await playbackService.clearPlaybackState(bar.id);
    const state = await playbackService.getPlaybackState(bar.id);
    assert.equal(state, null);
  });

  it('clear condicional ignora finalización obsoleta', async () => {
    await playbackService.setNowPlaying(bar.id, {
      id: 200,
      videoId: 'Currnt00001',
      title: 'Current Song',
      name: 'DJ'
    });

    const stale = await playbackService.clearPlaybackStateIfMatches(
      bar.id,
      'OldSng00001'
    );

    assert.equal(stale, false);

    const stillPlaying = await playbackService.getPlaybackState(bar.id);
    assert.equal(stillPlaying.videoId, 'Currnt00001');
  });

  it('clear condicional solo limpia el video actual', async () => {
    await playbackService.setNowPlaying(bar.id, {
      id: 201,
      videoId: 'Finish00001',
      title: 'Finished Song',
      name: 'DJ'
    });

    const completed = await playbackService.clearPlaybackStateIfMatches(
      bar.id,
      'Finish00001'
    );

    assert.equal(completed, true);
    assert.equal(
      await playbackService.getPlaybackState(bar.id),
      null
    );
  });

  it('completeCurrentAndAdvance ignora eventos obsoletos', async () => {
    await queueService.clearQueue(bar.id);
    await playbackService.setNowPlaying(bar.id, {
      id: 401,
      videoId: 'Current0001',
      title: 'Current Track',
      name: 'Cliente Uno'
    });

    const result = await playbackService.completeCurrentAndAdvance(
      bar.id,
      'Stale000001'
    );

    assert.equal(result.completed, false);
    assert.equal(result.reason, 'STALE_COMPLETION');

    const state = await playbackService.getPlaybackState(bar.id);
    assert.equal(state.videoId, 'Current0001');
  });

  it('completeCurrentAndAdvance conserva metadatos del servidor y avanza una sola canción', async () => {
    await queueService.clearQueue(bar.id);

    await playbackService.setNowPlaying(bar.id, {
      id: 402,
      videoId: 'DoneNow0001',
      title: 'Título confiable',
      name: 'Cliente Real'
    });

    await queueService.addToQueue(bar.id, {
      videoId: 'NextUp00001',
      title: 'Siguiente',
      name: 'Cliente Dos'
    });

    const result = await playbackService.completeCurrentAndAdvance(
      bar.id,
      'DoneNow0001'
    );

    assert.equal(result.completed, true);
    assert.equal(result.completedSong.title, 'Título confiable');
    assert.equal(result.completedSong.name, 'Cliente Real');
    assert.equal(result.playback.videoId, 'NextUp00001');

    const history = await prisma.songHistory.findFirst({
      where: {
        barId: bar.id,
        videoId: 'DoneNow0001'
      },
      orderBy: { playedAt: 'desc' }
    });

    assert.equal(history.title, 'Título confiable');
    assert.equal(history.name, 'Cliente Real');
    assert.equal((await queueService.getQueue(bar.id)).length, 0);
  });

  it('evento de finalización duplicado no salta dos canciones', async () => {
    await queueService.clearQueue(bar.id);

    await playbackService.setNowPlaying(bar.id, {
      id: 500,
      videoId: 'FinishA0001',
      title: 'Finalizada',
      name: 'Cliente A'
    });

    await queueService.addToQueue(bar.id, {
      videoId: 'NextAA00001',
      title: 'Siguiente A',
      name: 'Cliente B'
    });
    await queueService.addToQueue(bar.id, {
      videoId: 'NextBB00001',
      title: 'Siguiente B',
      name: 'Cliente C'
    });

    const first = await playbackService.completeCurrentAndAdvance(
      bar.id,
      'FinishA0001'
    );
    const duplicate = await playbackService.completeCurrentAndAdvance(
      bar.id,
      'FinishA0001'
    );

    assert.equal(first.completed, true);
    assert.equal(first.playback.videoId, 'NextAA00001');
    assert.equal(duplicate.completed, false);
    assert.equal(duplicate.reason, 'STALE_COMPLETION');

    const state = await playbackService.getPlaybackState(bar.id);
    assert.equal(state.videoId, 'NextAA00001');

    const queue = await queueService.getQueue(bar.id);
    assert.equal(queue.length, 1);
    assert.equal(queue[0].videoId, 'NextBB00001');
  });

  it('ignora una señal de avance atrasada sin consumir la cola', async () => {
    await queueService.clearQueue(bar.id);

    await playbackService.setNowPlaying(bar.id, {
      id: 600,
      videoId: 'GuardA00001',
      title: 'Actual protegida',
      name: 'Cliente A'
    });

    await queueService.addToQueue(bar.id, {
      videoId: 'GuardB00001',
      title: 'Debe permanecer',
      name: 'Cliente B'
    });

    const result = await playbackService.advancePlayback(
      bar.id,
      { expectedPlaybackId: 599 }
    );

    assert.equal(result.ignored, true);
    assert.equal(result.reason, 'STALE_PLAYBACK');

    const state = await playbackService.getPlaybackState(bar.id);
    assert.equal(state.videoId, 'GuardA00001');

    const queue = await queueService.getQueue(bar.id);
    assert.equal(queue.length, 1);
    assert.equal(queue[0].videoId, 'GuardB00001');
  });

  it('avanza cuando la señal corresponde a la reproducción vigente', async () => {
    await queueService.clearQueue(bar.id);

    await playbackService.setNowPlaying(bar.id, {
      id: 700,
      videoId: 'MatchA00001',
      title: 'Actual válida',
      name: 'Cliente A'
    });

    await queueService.addToQueue(bar.id, {
      videoId: 'MatchB00001',
      title: 'Siguiente válida',
      name: 'Cliente B'
    });

    const result = await playbackService.advancePlayback(
      bar.id,
      { expectedPlaybackId: 700 }
    );

    assert.equal(result.ignored, undefined);
    assert.equal(result.playback.videoId, 'MatchB00001');
    assert.equal((await queueService.getQueue(bar.id)).length, 0);
  });

  it('estado sobrevive desconexión de Prisma (simula reinicio)', async () => {
    await playbackService.setNowPlaying(bar.id, {
      id: 100,
      videoId: 'Persist0001',
      title: 'Persist',
      name: 'DJ'
    });

    await prisma.$disconnect();

    delete require.cache[require.resolve('../db.js')];
    delete require.cache[require.resolve('../services/playbackService.js')];

    ({ prisma } = require('../db.js'));
    playbackService = require('../services/playbackService.js');

    const restored = await playbackService.getPlaybackState(bar.id);
    assert.equal(restored.videoId, 'Persist0001');
  });
});
