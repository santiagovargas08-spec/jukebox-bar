'use strict';

require('dotenv').config();

const crypto = require('crypto');

function getTestDatabaseUrl() {
  return process.env.TEST_DATABASE_URL || null;
}

function requireTestDatabase() {
  const url = getTestDatabaseUrl();

  if (!url) {
    throw new Error(
      'TEST_DATABASE_URL is required for tests.\nTests will not use DATABASE_URL.'
    );
  }

  process.env.DATABASE_URL = url;
  return url;
}

function ensureOperatorSecret() {
  if (
    !process.env.OPERATOR_TOKEN_SECRET ||
    process.env.OPERATOR_TOKEN_SECRET.length < 32
  ) {
    process.env.OPERATOR_TOKEN_SECRET = crypto
      .randomBytes(48)
      .toString('hex');
  }
}

function uniqueSlug(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

async function createTestBar(prisma, { name, slug, trialDays = 30 } = {}) {
  const barSlug = slug || uniqueSlug('test-bar');
  const trialEndsAt = new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000);

  return prisma.bar.create({
    data: {
      name: name || `Test ${barSlug}`,
      slug: barSlug,
      license: {
        create: {
          status: 'TRIAL',
          trialStartedAt: new Date(),
          trialEndsAt
        }
      }
    }
  });
}

async function deleteTestBar(prisma, barId) {
  await prisma.bar.delete({ where: { id: barId } });
}

function createTestOperatorToken(payload, secret) {
  const encode = (value) =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  const sign = (value) =>
    crypto.createHmac('sha256', secret).update(value).digest('base64url');
  const encoded = encode(payload);
  return `${encoded}.${sign(encoded)}`;
}

module.exports = {
  getTestDatabaseUrl,
  requireTestDatabase,
  ensureOperatorSecret,
  uniqueSlug,
  createTestBar,
  deleteTestBar,
  createTestOperatorToken
};
