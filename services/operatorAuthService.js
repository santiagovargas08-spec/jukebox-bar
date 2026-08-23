'use strict';

const crypto = require('crypto');
const { prisma } = require('../db.js');
const { RateLimitStore } = require('../lib/rateLimitStore.js');
const { logWarn } = require('../lib/logger.js');

const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 10;

const loginAttempts = new RateLimitStore(LOGIN_WINDOW_MS);

function getSecret() {
  const secret = process.env.OPERATOR_TOKEN_SECRET;

  if (!secret || secret.length < 32) {
    throw new Error('OPERATOR_TOKEN_SECRET debe tener al menos 32 caracteres.');
  }

  return secret;
}

function encode(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function sign(value) {
  return crypto.createHmac('sha256', getSecret()).update(value).digest('base64url');
}

function normalizeEmail(email) {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('base64url')) {
  if (typeof password !== 'string' || password.length < 12) {
    throw new Error('La contraseña debe tener al menos 12 caracteres.');
  }

  const hash = crypto.scryptSync(password, salt, 64).toString('base64url');
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password, storedHash) {
  if (typeof password !== 'string' || typeof storedHash !== 'string') {
    return false;
  }

  const [algorithm, salt, expected] = storedHash.split('$');

  if (algorithm !== 'scrypt' || !salt || !expected) {
    return false;
  }

  const actual = crypto.scryptSync(password, salt, 64).toString('base64url');
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);

  if (actualBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

function createToken(admin) {
  const payload = encode({
    sub: admin.id,
    barId: admin.barId,
    email: admin.email,
    tv: admin.tokenVersion ?? 0,
    exp: Date.now() + TOKEN_TTL_MS
  });

  return `${payload}.${sign(payload)}`;
}

function verifyToken(token) {
  if (typeof token !== 'string') {
    return null;
  }

  const [payload, signature] = token.split('.');

  if (!payload || !signature) {
    return null;
  }

  const expected = sign(payload);
  const providedBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);

  if (providedBuffer.length !== expectedBuffer.length) {
    return null;
  }

  if (!crypto.timingSafeEqual(providedBuffer, expectedBuffer)) {
    return null;
  }

  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));

    if (
      !Number.isInteger(data.sub) ||
      !Number.isInteger(data.barId) ||
      !Number.isInteger(data.tv) ||
      data.exp <= Date.now()
    ) {
      return null;
    }

    return data;
  } catch {
    return null;
  }
}

function getLoginKey(slug, email) {
  return `${String(slug || '').trim().toLowerCase()}:${normalizeEmail(email)}`;
}

function checkLoginRateLimit(slug, email) {
  const result = loginAttempts.hit(
    getLoginKey(slug, email),
    LOGIN_WINDOW_MS,
    MAX_LOGIN_ATTEMPTS
  );

  return result.allowed;
}

async function createAdminUser({ barId, email, displayName, password, role = 'OPERATOR' }) {
  const normalizedEmail = normalizeEmail(email);

  if (!Number.isInteger(Number(barId)) || Number(barId) <= 0) {
    throw new Error('ID de bar inválido.');
  }

  if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) {
    throw new Error('Correo electrónico inválido.');
  }

  if (typeof displayName !== 'string' || !displayName.trim()) {
    throw new Error('El nombre es obligatorio.');
  }

  // SUPER_ADMIN tiene su propia entidad y flujo de autenticación.
  // Este servicio solo crea usuarios ligados a un bar.
  const allowedRoles = new Set(['BAR_ADMIN', 'DJ', 'OPERATOR']);

  if (!allowedRoles.has(role)) {
    throw new Error('Rol inválido para un administrador de bar.');
  }

  return prisma.adminUser.create({
    data: {
      barId: Number(barId),
      email: normalizedEmail,
      displayName: displayName.trim().slice(0, 80),
      passwordHash: hashPassword(password),
      role
    },
    select: {
      id: true,
      barId: true,
      email: true,
      displayName: true,
      active: true,
      role: true,
      createdAt: true
    }
  });
}

async function authenticateOperator({ slug, email, password }) {
  const normalizedEmail = normalizeEmail(email);

  if (!checkLoginRateLimit(slug, normalizedEmail)) {
    logWarn('Login bloqueado por rate limit', {
      event: 'operator_login_rate_limited',
      slug: String(slug || '').trim().toLowerCase()
    });
    return null;
  }

  const admin = await prisma.adminUser.findFirst({
    where: {
      email: normalizedEmail,
      active: true,
      role: { in: ['BAR_ADMIN', 'DJ', 'OPERATOR'] },
      bar: {
        slug: String(slug || '').trim().toLowerCase(),
        active: true
      }
    },
    select: {
      id: true,
      barId: true,
      email: true,
      displayName: true,
      tokenVersion: true,
      role: true
    }
  });

  if (!admin) {
    return null;
  }

  const credential = await prisma.adminUser.findUnique({
    where: { id: admin.id },
    select: { passwordHash: true }
  });

  if (!credential || !verifyPassword(password, credential.passwordHash)) {
    return null;
  }

  return {
    token: createToken(admin),
    admin: {
      id: admin.id,
      barId: admin.barId,
      email: admin.email,
      displayName: admin.displayName,
      role: admin.role
    },
    expiresAt: new Date(Date.now() + TOKEN_TTL_MS).toISOString()
  };
}

async function getActiveAdminFromToken(token) {
  const data = verifyToken(token);

  if (!data) {
    return null;
  }

  const admin = await prisma.adminUser.findFirst({
    where: {
      id: data.sub,
      barId: data.barId,
      email: data.email,
      tokenVersion: data.tv,
      active: true,
      role: { in: ['BAR_ADMIN', 'DJ', 'OPERATOR'] },
      bar: { active: true }
    },
    select: {
      id: true,
      barId: true,
      email: true,
      displayName: true,
      role: true,
      tokenVersion: true
    }
  });

  return admin || null;
}

async function revokeOperatorTokens(adminUserId) {
  const id = Number(adminUserId);

  if (!Number.isInteger(id) || id <= 0) {
    throw new Error('ID de administrador inválido.');
  }

  return prisma.adminUser.update({
    where: { id },
    data: {
      tokenVersion: {
        increment: 1
      }
    },
    select: {
      id: true,
      barId: true,
      tokenVersion: true
    }
  });
}

module.exports = {
  createAdminUser,
  authenticateOperator,
  getActiveAdminFromToken,
  revokeOperatorTokens,
  checkLoginRateLimit
};
