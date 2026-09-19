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

async function addToHistory(barId, song) {
  const id = normalizarBarId(barId);

  if (!song || !song.videoId || !song.title || !song.name) {
    throw new Error('Datos de canción incompletos');
  }

  const videoId = String(song.videoId).trim();

  if (!isValidYoutubeVideoId(videoId)) {
    throw new Error('videoId inválido');
  }

  return prisma.songHistory.create({
    data: {
      barId: id,
      videoId,
      title: String(song.title).trim().slice(0, 100),
      name: String(song.name).trim().slice(0, 30),
      thumbnail: sanitizeThumbnailUrl(song.thumbnail),
    }
  });
}

async function getHistory(barId, limit = 10) {
  const id = normalizarBarId(barId);

  const safeLimit = Math.min(
    Math.max(Number(limit) || 10, 1),
    50
  );

  return prisma.songHistory.findMany({
    where: {
      barId: id
    },
    orderBy: {
      playedAt: 'desc'
    },
    take: safeLimit
  });
}

async function clearHistory(barId) {
  const id = normalizarBarId(barId);

  const result = await prisma.songHistory.deleteMany({
    where: {
      barId: id
    }
  });

  return result.count;
}

module.exports = {
  addToHistory,
  getHistory,
  clearHistory
};