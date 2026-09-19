'use strict';

const { prisma } = require('../db.js');
const { sanitizeThumbnailUrl, isValidYoutubeVideoId } = require('../lib/urlValidation.js');

function normalizarBarId(barId) {
  const id = Number(barId);

  if (!Number.isInteger(id) || id <= 0) {
    throw new Error('barId inválido');
  }

  return id;
}

function toPlaybackPayload(state) {
  if (!state || state.status !== 'PLAYING' || !state.videoId) {
    return null;
  }

  return {
    id: state.queueItemId,
    videoId: state.videoId,
    titulo: state.title,
    nombre: state.name,
    thumbnail: state.thumbnail,
    startedAt: state.startedAt
  };
}

async function getPlaybackState(barId) {
  const id = normalizarBarId(barId);

  const state = await prisma.playbackState.findUnique({
    where: { barId: id }
  });

  return toPlaybackPayload(state);
}

async function setNowPlaying(barId, song) {
  const id = normalizarBarId(barId);

  if (!song || !song.videoId) {
    throw new Error('Datos de reproducción incompletos');
  }

  const videoId = String(song.videoId).trim();

  if (!isValidYoutubeVideoId(videoId)) {
    throw new Error('videoId inválido');
  }

  const title = String(
    song.title || song.titulo || ''
  ).trim();

  const name = String(
    song.name || song.nombre || ''
  ).trim();

  if (!title || !name) {
    throw new Error('Título y nombre son obligatorios');
  }

  const now = new Date();

  const data = {
    queueItemId: song.id ?? null,
    videoId,
    title: title.slice(0, 100),
    name: name.slice(0, 30),
    thumbnail: sanitizeThumbnailUrl(song.thumbnail),
    startedAt: now,
    status: 'PLAYING'
  };

  const state = await prisma.playbackState.upsert({
    where: { barId: id },
    create: {
      barId: id,
      ...data
    },
    update: data
  });

  return toPlaybackPayload(state);
}

async function clearPlaybackState(barId) {
  const id = normalizarBarId(barId);

  await prisma.playbackState.upsert({
    where: { barId: id },
    create: {
      barId: id,
      status: 'IDLE'
    },
    update: {
      queueItemId: null,
      videoId: null,
      title: null,
      name: null,
      thumbnail: null,
      startedAt: null,
      status: 'IDLE'
    }
  });

  return null;
}

async function clearPlaybackStateIfMatches(
  barId,
  videoId
) {
  const id = normalizarBarId(barId);
  const normalizedVideoId =
    String(videoId || '').trim();

  if (!isValidYoutubeVideoId(normalizedVideoId)) {
    return false;
  }

  const result = await prisma.playbackState.updateMany({
    where: {
      barId: id,
      status: 'PLAYING',
      videoId: normalizedVideoId
    },
    data: {
      queueItemId: null,
      videoId: null,
      title: null,
      name: null,
      thumbnail: null,
      startedAt: null,
      status: 'IDLE'
    }
  });

  return result.count === 1;
}


module.exports = {
  getPlaybackState,
  setNowPlaying,
  clearPlaybackState,
  clearPlaybackStateIfMatches,
  toPlaybackPayload
};
