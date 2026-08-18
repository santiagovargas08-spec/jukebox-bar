'use strict';

const { prisma } = require('../db.js');

const TRIAL_DAYS = 14;

function calcularFinTrial(inicio) {
  const fin = new Date(inicio);
  fin.setDate(fin.getDate() + TRIAL_DAYS);
  return fin;
}

async function createBar({
  name,
  slug,
  displayName = null,
  welcomeMessage = null
}) {
  const trialStartedAt = new Date();
  const trialEndsAt = calcularFinTrial(trialStartedAt);

  return prisma.bar.create({
    data: {
      name: name.trim(),
      slug: slug.trim().toLowerCase(),

      settings: {
        create: {
          displayName,
          welcomeMessage
        }
      },

      license: {
        create: {
          status: 'TRIAL',
          trialStartedAt,
          trialEndsAt
        }
      }
    },

    include: {
      settings: true,
      license: true
    }
  });
}

async function getBarBySlug(slug) {
  if (!slug || typeof slug !== 'string') {
    return null;
  }

  const normalized = slug.trim().toLowerCase();

  if (!normalized) {
    return null;
  }

  return prisma.bar.findUnique({
    where: {
      slug: normalized
    },
    include: {
      settings: true,
      license: true
    }
  });
}

async function getBarById(id) {
  const barId = Number(id);

  if (!Number.isInteger(barId) || barId <= 0) {
    return null;
  }

  return prisma.bar.findUnique({
    where: {
      id: barId
    },
    include: {
      settings: true,
      license: true,
      users: true,
      _count: {
        select: {
          users: true,
          queue: true,
          history: true,
          payments: true
        }
      }
    }
  });
}

async function listBars() {
  return prisma.bar.findMany({
    orderBy: {
      createdAt: 'desc'
    },
    include: {
      settings: true,
      license: true,
      _count: {
        select: {
          users: true,
          queue: true,
          history: true,
          payments: true
        }
      }
    }
  });
}

async function updateBar(id, data) {
  const barId = Number(id);

  if (!Number.isInteger(barId) || barId <= 0) {
    throw new Error('ID de bar inválido.');
  }

  const barData = {};

  if (typeof data.name === 'string' && data.name.trim()) {
    barData.name = data.name.trim();
  }

  if (typeof data.active === 'boolean') {
    barData.active = data.active;
  }

  return prisma.bar.update({
    where: {
      id: barId
    },
    data: barData,
    include: {
      settings: true,
      license: true
    }
  });
}

module.exports = {
  createBar,
  getBarBySlug,
  getBarById,
  listBars,
  updateBar
};