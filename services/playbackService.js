'use strict';

const { prisma } = require('../db.js');
const { sanitizeThumbnailUrl, isValidYoutubeVideoId } = require('../lib/urlValidation.js');
const { acquireQueueLock } = require('../lib/advisoryLocks.js');

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

function buildPlaybackData(song) {
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

  return {
    queueItemId: song.id ?? null,
    videoId,
    title: title.slice(0, 100),
    name: name.slice(0, 30),
    thumbnail: sanitizeThumbnailUrl(song.thumbnail),
    startedAt: new Date(),
    status: 'PLAYING'
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
  const data = buildPlaybackData(song);

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

async function advancePlayback(
  barId,
  { expectedPlaybackId = null } = {}
) {
  const id = normalizarBarId(barId);

  return prisma.$transaction(async (tx) => {
    await acquireQueueLock(tx, id);

    if (
      expectedPlaybackId !== null &&
      expectedPlaybackId !== undefined
    ) {
      const current = await tx.playbackState.findUnique({
        where: { barId: id },
        select: {
          status: true,
          queueItemId: true
        }
      });

      if (
        !current ||
        current.status !== 'PLAYING' ||
        current.queueItemId === null ||
        String(current.queueItemId) !== String(expectedPlaybackId)
      ) {
        return {
          ignored: true,
          reason: 'STALE_PLAYBACK'
        };
      }
    }

    const rows = await tx.$queryRaw`
      DELETE FROM "QueueItem"
      WHERE "id" IN (
        SELECT "id"
        FROM "QueueItem"
        WHERE "barId" = ${id}
        ORDER BY "position" ASC, "id" ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING *
    `;

    if (!Array.isArray(rows) || rows.length === 0) {
      await tx.playbackState.upsert({
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

    const nextSong = rows[0];
    const data = buildPlaybackData(nextSong);

    const state = await tx.playbackState.upsert({
      where: { barId: id },
      create: {
        barId: id,
        ...data
      },
      update: data
    });

    return {
      item: nextSong,
      playback: toPlaybackPayload(state)
    };
  });
}

async function completeCurrentAndAdvance(
  barId,
  completedVideoId
) {
  const id = normalizarBarId(barId);
  const videoId = String(completedVideoId || '').trim();

  if (!isValidYoutubeVideoId(videoId)) {
    return {
      completed: false,
      reason: 'INVALID_VIDEO'
    };
  }

  return prisma.$transaction(async (tx) => {
    await acquireQueueLock(tx, id);

    const current = await tx.playbackState.findUnique({
      where: { barId: id }
    });

    if (
      !current ||
      current.status !== 'PLAYING' ||
      current.videoId !== videoId
    ) {
      return {
        completed: false,
        reason: 'STALE_COMPLETION'
      };
    }

    const lastHistory = await tx.songHistory.findFirst({
      where: { barId: id },
      orderBy: {
        playedAt: 'desc'
      },
      select: {
        videoId: true
      }
    });

    let historyCreated = false;

    if (lastHistory?.videoId !== current.videoId) {
      await tx.songHistory.create({
        data: {
          barId: id,
          videoId: current.videoId,
          title: current.title || 'Sin título',
          name: current.name || 'Cliente',
          thumbnail: current.thumbnail
        }
      });

      historyCreated = true;
    }

    const rows = await tx.$queryRaw`
      DELETE FROM "QueueItem"
      WHERE "id" IN (
        SELECT "id"
        FROM "QueueItem"
        WHERE "barId" = ${id}
        ORDER BY "position" ASC, "id" ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING *
    `;

    if (!Array.isArray(rows) || rows.length === 0) {
      await tx.playbackState.update({
        where: { barId: id },
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

      return {
        completed: true,
        historyCreated,
        completedSong: {
          videoId: current.videoId,
          title: current.title,
          name: current.name,
          thumbnail: current.thumbnail
        },
        item: null,
        playback: null
      };
    }

    const nextSong = rows[0];
    const data = buildPlaybackData(nextSong);

    const state = await tx.playbackState.update({
      where: { barId: id },
      data
    });

    return {
      completed: true,
      historyCreated,
      completedSong: {
        videoId: current.videoId,
        title: current.title,
        name: current.name,
        thumbnail: current.thumbnail
      },
      item: nextSong,
      playback: toPlaybackPayload(state)
    };
  });
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
  advancePlayback,
  completeCurrentAndAdvance,
  clearPlaybackState,
  clearPlaybackStateIfMatches,
  toPlaybackPayload,
  buildPlaybackData
};
