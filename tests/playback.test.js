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

  before(async () => {
    requireTestDatabase();

    delete require.cache[require.resolve('../db.js')];
    ({ prisma } = require('../db.js'));
    playbackService = require('../services/playbackService.js');

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

    assert.equal(playing.videoId, 'play-1');
    assert.equal(playing.titulo, 'Now Playing');

    const restored = await playbackService.getPlaybackState(bar.id);
    assert.equal(restored.videoId, 'play-1');
  });

  it('clearPlaybackState deja el bar en idle', async () => {
    await playbackService.clearPlaybackState(bar.id);
    const state = await playbackService.getPlaybackState(bar.id);
    assert.equal(state, null);
  });

  it('estado sobrevive desconexión de Prisma (simula reinicio)', async () => {
    await playbackService.setNowPlaying(bar.id, {
      id: 100,
      videoId: 'Persist00001',
      title: 'Persist',
      name: 'DJ'
    });

    await prisma.$disconnect();

    delete require.cache[require.resolve('../db.js')];
    delete require.cache[require.resolve('../services/playbackService.js')];

    ({ prisma } = require('../db.js'));
    playbackService = require('../services/playbackService.js');

    const restored = await playbackService.getPlaybackState(bar.id);
    assert.equal(restored.videoId, 'persist-1');
  });
});
