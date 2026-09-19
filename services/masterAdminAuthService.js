'use strict';

const crypto = require('crypto');
const { prisma } = require('../db.js');
const { RateLimitStore } = require('../lib/rateLimitStore.js');

const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_TOKEN_LENGTH = 4096;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 10;
const MAX_IP_LOGIN_ATTEMPTS = 30;

const loginAttempts = new RateLimitStore(LOGIN_WINDOW_MS);
const ipLoginAttempts = new RateLimitStore(LOGIN_WINDOW_MS);

function getSecret() {
  const secret = process.env.MASTER_ADMIN_TOKEN_SECRET;

  if (!secret || secret.length < 32) {
    throw new Error(
      'MASTER_ADMIN_TOKEN_SECRET debe tener al menos 32 caracteres.'
    );
  }

  return secret;
}

function normalizeEmail(email) {
  return typeof email === 'string'
    ? email.trim().toLowerCase()
    : '';
}

function hashPassword(
  password,
  salt = crypto.randomBytes(16).toString('base64url')
) {
  if (
    typeof password !== 'string' ||
    password.length < 12 ||
    password.length > 256
  ) {
    throw new Error(
      'La contraseña debe tener entre 12 y 256 caracteres.'
    );
  }

  const hash = crypto
    .scryptSync(password, salt, 64)
    .toString('base64url');

  return `scrypt$${salt}$${hash}`;
}

const DUMMY_PASSWORD_HASH =
  'scrypt$jukebox-dummy-salt$' +
  crypto
    .scryptSync(
      'jukebox-dummy-password-not-used',
      'jukebox-dummy-salt',
      64
    )
    .toString('base64url');

function deriveScryptKey(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (error, derivedKey) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(derivedKey);
    });
  });
}

async function verifyPassword(password, storedHash) {
  if (
    typeof password !== 'string' ||
    typeof storedHash !== 'string'
  ) {
    return false;
  }

  const [algorithm, salt, expected] =
    storedHash.split('$');

  if (
    algorithm !== 'scrypt' ||
    !salt ||
    !expected
  ) {
    return false;
  }

  const actualBuffer =
    await deriveScryptKey(password, salt);

  let expectedBuffer;

  try {
    expectedBuffer = Buffer.from(expected, 'base64url');
  } catch {
    return false;
  }

  return (
    actualBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(
      actualBuffer,
      expectedBuffer
    )
  );
}

function encode(value) {
  return Buffer
    .from(JSON.stringify(value))
    .toString('base64url');
}

function sign(value) {
  return crypto
    .createHmac('sha256', getSecret())
    .update(value)
    .digest('base64url');
}

function createToken(admin) {
  const payload = encode({
    sub: admin.id,
    email: admin.email,
    tv: admin.tokenVersion ?? 0,
    role: 'SUPER_ADMIN',
    exp: Date.now() + TOKEN_TTL_MS
  });

  return `${payload}.${sign(payload)}`;
}

function verifyToken(token) {
  if (
    typeof token !== 'string' ||
    token.length === 0 ||
    token.length > MAX_TOKEN_LENGTH
  ) {
    return null;
  }

  const parts = token.split('.');

  if (parts.length !== 2) {
    return null;
  }

  const [payload, signature] = parts;

  if (!payload || !signature) {
    return null;
  }

  const expected = sign(payload);
  const providedBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);

  if (
    providedBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(
      providedBuffer,
      expectedBuffer
    )
  ) {
    return null;
  }

  try {
    const data = JSON.parse(
      Buffer
        .from(payload, 'base64url')
        .toString('utf8')
    );

    if (
      !Number.isInteger(data.sub) ||
      !Number.isInteger(data.tv) ||
      data.role !== 'SUPER_ADMIN' ||
      data.exp <= Date.now()
    ) {
      return null;
    }

    return data;
  } catch {
    return null;
  }
}

function normalizeIp(ip) {
  if (
    typeof ip !== 'string' ||
    !ip.trim()
  ) {
    return 'unknown';
  }

  return ip
    .split(',')[0]
    .trim()
    .slice(0, 120);
}

function checkLoginRateLimit(
  email,
  ip = 'unknown'
) {
  const accountLimit = loginAttempts.hit(
    `master:${normalizeEmail(email)}`,
    LOGIN_WINDOW_MS,
    MAX_LOGIN_ATTEMPTS
  );

  const ipLimit = ipLoginAttempts.hit(
    `master-ip:${normalizeIp(ip)}`,
    LOGIN_WINDOW_MS,
    MAX_IP_LOGIN_ATTEMPTS
  );

  return (
    accountLimit.allowed &&
    ipLimit.allowed
  );
}

async function createMasterAdmin({
  email,
  displayName,
  password
}) {
  const normalizedEmail = normalizeEmail(email);

  if (
    normalizedEmail.length === 0 ||
    normalizedEmail.length > 254 ||
    !/^\S+@\S+\.\S+$/.test(normalizedEmail)
  ) {
    throw new Error(
      'Correo electrónico inválido.'
    );
  }

  if (
    typeof displayName !== 'string' ||
    !displayName.trim()
  ) {
    throw new Error(
      'El nombre es obligatorio.'
    );
  }

  return prisma.masterAdmin.create({
    data: {
      email: normalizedEmail,
      displayName:
        displayName.trim().slice(0, 80),
      passwordHash:
        hashPassword(password)
    },
    select: {
      id: true,
      email: true,
      displayName: true,
      active: true,
      createdAt: true
    }
  });
}

async function authenticateMasterAdmin({
  email,
  password,
  ip = 'unknown'
}) {
  const normalizedEmail = normalizeEmail(email);

  if (
    normalizedEmail.length === 0 ||
    normalizedEmail.length > 254 ||
    typeof password !== 'string' ||
    password.length === 0 ||
    password.length > 256
  ) {
    return null;
  }

  if (
    !checkLoginRateLimit(
      normalizedEmail,
      ip
    )
  ) {
    return null;
  }

  const admin =
    await prisma.masterAdmin.findUnique({
      where: {
        email: normalizedEmail
      },
      select: {
        id: true,
        email: true,
        displayName: true,
        passwordHash: true,
        tokenVersion: true,
        active: true
      }
    });

  const passwordHash =
    admin?.passwordHash ||
    DUMMY_PASSWORD_HASH;

  const passwordValid =
    await verifyPassword(
      password,
      passwordHash
    );

  if (
    !admin ||
    !admin.active ||
    !passwordValid
  ) {
    return null;
  }

  loginAttempts.reset(
    `master:${normalizedEmail}`
  );

  return {
    token: createToken(admin),
    admin: {
      id: admin.id,
      email: admin.email,
      displayName: admin.displayName,
      role: 'SUPER_ADMIN'
    },
    expiresAt:
      new Date(
        Date.now() + TOKEN_TTL_MS
      ).toISOString()
  };
}

async function getActiveMasterAdminFromToken(
  token
) {
  const data = verifyToken(token);

  if (!data) {
    return null;
  }

  return prisma.masterAdmin.findFirst({
    where: {
      id: data.sub,
      email: data.email,
      tokenVersion: data.tv,
      active: true
    },
    select: {
      id: true,
      email: true,
      displayName: true,
      active: true
    }
  });
}

async function revokeMasterAdminToken(
  adminId
) {
  const id = Number(adminId);

  if (
    !Number.isInteger(id) ||
    id <= 0
  ) {
    return false;
  }

  await prisma.masterAdmin.update({
    where: { id },
    data: {
      tokenVersion: {
        increment: 1
      }
    }
  });

  return true;
}

module.exports = {
  createMasterAdmin,
  authenticateMasterAdmin,
  getActiveMasterAdminFromToken,
  revokeMasterAdminToken,
  hashPassword
};
