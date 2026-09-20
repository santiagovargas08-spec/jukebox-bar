'use strict';

const { prisma } = require('../db.js');
const { normalizeBarSlug } = require('../lib/barSlug.js');
const { sanitizeBarLogoUrl } = require('../lib/urlValidation.js');
const { createScreenAccessKey } = require('./screenAccessService.js');

const TRIAL_DAYS = 14;
const MAX_BAR_NAME_LENGTH = 120;
const MAX_DISPLAY_NAME_LENGTH = 120;
const MAX_WELCOME_MESSAGE_LENGTH = 500;

function calcularFinTrial(inicio) {
  const fin = new Date(inicio);
  fin.setDate(fin.getDate() + TRIAL_DAYS);
  return fin;
}

function slugify(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

async function getUniqueSlug(tx, requestedSlug, name) {
  const base = slugify(requestedSlug || name) || 'bar';
  let candidate = base;
  let suffix = 2;

  while (
    await tx.bar.findUnique({
      where: { slug: candidate },
      select: { id: true }
    })
  ) {
    const suffixText = `-${suffix}`;
    const maxBaseLength =
      80 - suffixText.length;

    const truncatedBase =
      base
        .slice(0, maxBaseLength)
        .replace(/-+$/g, '') ||
      'bar';

    candidate =
      `${truncatedBase}${suffixText}`;

    suffix += 1;
  }

  return candidate;
}

async function createBar({
  name,
  slug = null,
  displayName = null,
  welcomeMessage = null,
  logoUrl = null
}) {
  if (typeof name !== 'string' || !name.trim()) {
    throw new Error('El nombre del bar es obligatorio.');
  }

  const cleanName = name.trim();

  if (cleanName.length > MAX_BAR_NAME_LENGTH) {
    throw new Error(
      `El nombre del bar no puede superar ${MAX_BAR_NAME_LENGTH} caracteres.`
    );
  }

  const cleanDisplayName =
    typeof displayName === 'string' && displayName.trim()
      ? displayName.trim()
      : cleanName;

  if (cleanDisplayName.length > MAX_DISPLAY_NAME_LENGTH) {
    throw new Error(
      `El nombre mostrado no puede superar ${MAX_DISPLAY_NAME_LENGTH} caracteres.`
    );
  }

  const cleanWelcomeMessage =
    typeof welcomeMessage === 'string' && welcomeMessage.trim()
      ? welcomeMessage.trim()
      : null;

  const cleanLogoUrl =
    sanitizeBarLogoUrl(logoUrl);

  if (
    cleanWelcomeMessage &&
    cleanWelcomeMessage.length > MAX_WELCOME_MESSAGE_LENGTH
  ) {
    throw new Error(
      `El mensaje de bienvenida no puede superar ${MAX_WELCOME_MESSAGE_LENGTH} caracteres.`
    );
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        const uniqueSlug = await getUniqueSlug(tx, slug, cleanName);
        const trialStartedAt = new Date();
        const trialEndsAt = calcularFinTrial(trialStartedAt);

        return tx.bar.create({
          data: {
            name: cleanName,
            slug: uniqueSlug,
            settings: {
              create: {
                displayName: cleanDisplayName,
                welcomeMessage: cleanWelcomeMessage,
                logoUrl: cleanLogoUrl
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
      });
    } catch (error) {
      if (error?.code === 'P2002' && attempt < 2) continue;
      throw error;
    }
  }

  throw new Error('No se pudo generar un slug único para el bar.');
}

async function getBarBySlug(slug) {
  const normalized = normalizeBarSlug(slug);
  if (!normalized) return null;

  return prisma.bar.findUnique({
    where: { slug: normalized },
    include: { settings: true, license: true }
  });
}

async function getBarAccessRecord(id) {
  const barId = Number(id);

  if (
    !Number.isInteger(barId) ||
    barId <= 0
  ) {
    return null;
  }

  return prisma.bar.findUnique({
    where: { id: barId },
    select: {
      id: true,
      active: true,
      license: true
    }
  });
}

async function getBarById(id) {
  const barId = Number(id);
  if (!Number.isInteger(barId) || barId <= 0) return null;

  return prisma.bar.findUnique({
    where: { id: barId },
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

async function listBars() {
  return prisma.bar.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      settings: true,
      license: true,
      _count: { select: { users: true, queue: true, history: true, payments: true } }
    }
  });
}


async function listBarsPage({
  limit = 25,
  offset = 0
} = {}) {
  const safeLimit = Math.min(
    Math.max(Number.parseInt(limit, 10) || 25, 1),
    100
  );

  const safeOffset = Math.max(
    Number.parseInt(offset, 10) || 0,
    0
  );

  const include = {
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
  };

  const [items, total] = await Promise.all([
    prisma.bar.findMany({
      orderBy: { createdAt: 'desc' },
      skip: safeOffset,
      take: safeLimit,
      include
    }),
    prisma.bar.count()
  ]);

  return {
    items,
    total,
    limit: safeLimit,
    offset: safeOffset
  };
}


async function deleteBar(id) {
  const barId = Number(id);

  if (
    !Number.isInteger(barId) ||
    barId <= 0
  ) {
    throw new Error('ID de bar inválido.');
  }

  return prisma.bar.delete({
    where: {
      id: barId
    },
    select: {
      id: true,
      name: true,
      slug: true
    }
  });
}

async function updateBar(id, data) {
  const barId = Number(id);
  if (!Number.isInteger(barId) || barId <= 0) throw new Error('ID de bar inválido.');

  const barData = {};

  if (typeof data.name === 'string' && data.name.trim()) {
    const name = data.name.trim();

    if (name.length > MAX_BAR_NAME_LENGTH) {
      throw new Error(
        `El nombre del bar no puede superar ${MAX_BAR_NAME_LENGTH} caracteres.`
      );
    }

    barData.name = name;
  }

  if (typeof data.active === 'boolean') {
    barData.active = data.active;
  }

  const settingsData = {};

  if (typeof data.displayName === 'string') {
    const displayName = data.displayName.trim();

    if (displayName.length > MAX_DISPLAY_NAME_LENGTH) {
      throw new Error(
        `El nombre mostrado no puede superar ${MAX_DISPLAY_NAME_LENGTH} caracteres.`
      );
    }

    settingsData.displayName = displayName || null;
  }

  if (
    typeof data.logoUrl === 'string' ||
    data.logoUrl === null
  ) {
    settingsData.logoUrl =
      sanitizeBarLogoUrl(
        data.logoUrl
      );
  }

  if (typeof data.screenAuthRequired === 'boolean') {
    settingsData.screenAuthRequired =
      data.screenAuthRequired;
  }

  if (typeof data.welcomeMessage === 'string') {
    const welcomeMessage = data.welcomeMessage.trim();

    if (welcomeMessage.length > MAX_WELCOME_MESSAGE_LENGTH) {
      throw new Error(
        `El mensaje de bienvenida no puede superar ${MAX_WELCOME_MESSAGE_LENGTH} caracteres.`
      );
    }

    settingsData.welcomeMessage = welcomeMessage || null;
  }

  return prisma.$transaction(async (tx) => {
    if (settingsData.screenAuthRequired === false) {
      const currentSettings =
        await tx.barSettings.findUnique({
          where: { barId },
          select: { screenAccessKey: true }
        });

      if (!currentSettings?.screenAccessKey) {
        settingsData.screenAccessKey =
          createScreenAccessKey();
      }
    }

    if (Object.keys(barData).length === 0 && Object.keys(settingsData).length === 0) {
      return tx.bar.findUniqueOrThrow({
        where: { id: barId },
        include: { settings: true, license: true }
      });
    }

    const bar = await tx.bar.update({
      where: { id: barId },
      data: barData,
      include: { settings: true, license: true }
    });

    if (Object.keys(settingsData).length === 0) return bar;

    await tx.barSettings.upsert({
      where: { barId },
      create: { barId, ...settingsData },
      update: settingsData
    });

    return tx.bar.findUniqueOrThrow({
      where: { id: barId },
      include: { settings: true, license: true }
    });
  });
}

module.exports = {
  createBar,
  getBarBySlug,
  getBarById,
  getBarAccessRecord,
  listBars,
  listBarsPage,
  deleteBar,
  updateBar,
  slugify,
  MAX_BAR_NAME_LENGTH,
  MAX_DISPLAY_NAME_LENGTH,
  MAX_WELCOME_MESSAGE_LENGTH
};
