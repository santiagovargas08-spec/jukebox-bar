'use strict';

const { prisma } = require('../db.js');
const { sanitizeThumbnailUrl, isValidYoutubeVideoId } = require('../lib/urlValidation.js');

const MAX_QUEUE_PER_BAR = 100;

function normalizarBarId(barId) {
  const id = Number(barId);

  if (!Number.isInteger(id) || id <= 0) {
    throw new Error('barId inválido');
  }

  return id;
}

async function getQueue(barId) {
  const id = normalizarBarId(barId);

  return prisma.queueItem.findMany({
    where: {
      barId: id
    },
    orderBy: [
      { position: 'asc' },
      { id: 'asc' }
    ]
  });
}

async function addToQueue(barId, song, maxItems = MAX_QUEUE_PER_BAR) {
  const id = normalizarBarId(barId);

  if (!song || !song.videoId || !song.title || !song.name) {
    throw new Error('Datos de canción incompletos');
  }

  const videoId = String(song.videoId).trim();

  if (!isValidYoutubeVideoId(videoId)) {
    throw new Error('videoId inválido');
  }

  const thumbnail = sanitizeThumbnailUrl(song.thumbnail);

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${id})`;

    const count = await tx.queueItem.count({
      where: { barId: id }
    });

    if (count >= maxItems) {
      throw new Error('QUEUE_FULL');
    }

    const lastItem = await tx.queueItem.findFirst({
      where: { barId: id },
      orderBy: [
        { position: 'desc' },
        { id: 'desc' }
      ],
      select: { position: true }
    });

    const nextPosition = (lastItem?.position || 0) + 1;

    try {
      const item = await tx.queueItem.create({
        data: {
          barId: id,
          videoId,
          title: String(song.title).trim().slice(0, 100),
          name: String(song.name).trim().slice(0, 30),
          thumbnail,
          position: nextPosition
        }
      });

      return {
        created: true,
        item
      };
    } catch (error) {
      if (error.code === 'P2002') {
        const existente = await tx.queueItem.findFirst({
          where: {
            barId: id,
            videoId
          }
        });

        return {
          created: false,
          item: existente
        };
      }

      throw error;
    }
  });
}

async function removeFromQueue(barId, queueItemId) {
  const bar = normalizarBarId(barId);
  const itemId = Number(queueItemId);

  if (!Number.isInteger(itemId) || itemId <= 0) {
    throw new Error('queueItemId inválido');
  }

  const result = await prisma.queueItem.deleteMany({
    where: {
      id: itemId,
      barId: bar
    }
  });

  return result.count > 0;
}

async function clearQueue(barId) {
  const id = normalizarBarId(barId);

  const result = await prisma.queueItem.deleteMany({
    where: {
      barId: id
    }
  });

  return result.count;
}

async function reorderQueue(barId, orderedIds) {
  const id = normalizarBarId(barId);

  if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
    throw new Error('Orden de cola inválido');
  }

  const ids = orderedIds
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0);

  if (ids.length !== orderedIds.length) {
    throw new Error('IDs de cola inválidos');
  }

  if (new Set(ids).size !== ids.length) {
    throw new Error('La cola contiene IDs duplicados');
  }

  return prisma.$transaction(async (tx) => {
    // Serializa reordenamientos con altas/bajas concurrentes del mismo bar.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${id})`;

    const items = await tx.queueItem.findMany({
      where: {
        barId: id
      },
      orderBy: [
        { position: 'asc' },
        { id: 'asc' }
      ]
    });

    if (items.length !== ids.length) {
      throw new Error('La cola cambió mientras se reordenaba');
    }

    const itemIds = new Set(items.map((item) => item.id));

    for (const queueId of ids) {
      if (!itemIds.has(queueId)) {
        throw new Error('La cola contiene IDs inválidos');
      }
    }

    for (let index = 0; index < ids.length; index += 1) {
      await tx.queueItem.update({
        where: {
          id: ids[index]
        },
        data: {
          position: index + 1
        }
      });
    }

    return tx.queueItem.findMany({
      where: { barId: id },
      orderBy: [
        { position: 'asc' },
        { id: 'asc' }
      ]
    });
  });
}

async function takeNextFromQueue(barId) {
  const id = normalizarBarId(barId);

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${id})`;

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
      return null;
    }

    return rows[0];
  });
}

module.exports = {
  MAX_QUEUE_PER_BAR,
  getQueue,
  addToQueue,
  removeFromQueue,
  clearQueue,
  reorderQueue,
  takeNextFromQueue
};
