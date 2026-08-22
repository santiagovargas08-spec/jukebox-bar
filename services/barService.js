'use strict';

const { prisma } = require('../db.js');

const TRIAL_DAYS = 14;

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

  while (await tx.bar.findUnique({ where: { slug: candidate }, select: { id: true } })) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }

  return candidate;
}

async function createBar({
  name,
  slug = null,
  displayName = null,
  welcomeMessage = null
}) {
  if (typeof name !== 'string' || !name.trim()) {
    throw new Error('El nombre del bar es obligatorio.');
  }

  const cleanName = name.trim();
  const cleanDisplayName = typeof displayName === 'string' && displayName.trim() ? displayName.trim() : cleanName;
  const cleanWelcomeMessage = typeof welcomeMessage === 'string' && welcomeMessage.trim() ? welcomeMessage.trim() : null;

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
                welcomeMessage: cleanWelcomeMessage
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
      // Another request can win the same slug between the existence check and insert.
      // Retry the complete transaction; PostgreSQL/Prisma still guarantees the unique constraint.
      if (error?.code === 'P2002' && attempt < 2) continue;
      throw error;
    }
  }

  throw new Error('No se pudo generar un slug único para el bar.');
}

async function getBarBySlug(slug) {
  if (!slug || typeof slug !== 'string') return null;
  const normalized = slug.trim().toLowerCase();
  if (!normalized) return null;

  return prisma.bar.findUnique({
    where: { slug: normalized },
    include: { settings: true, license: true }
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
      users: true,
      _count: { select: { users: true, queue: true, history: true, payments: true } }
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

async function updateBar(id, data) {
  const barId = Number(id);
  if (!Number.isInteger(barId) || barId <= 0) throw new Error('ID de bar inválido.');

  const barData = {};
  if (typeof data.name === 'string' && data.name.trim()) barData.name = data.name.trim();
  if (typeof data.active === 'boolean') barData.active = data.active;

  return prisma.bar.update({
    where: { id: barId },
    data: barData,
    include: { settings: true, license: true }
  });
}

module.exports = {
  createBar,
  getBarBySlug,
  getBarById,
  listBars,
  updateBar,
  slugify
};
