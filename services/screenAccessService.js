'use strict';

const crypto = require('node:crypto');
const { prisma } = require('../db.js');
const { normalizeBarSlug } = require('../lib/barSlug.js');

const SCREEN_ACCESS_KEY_BYTES = 24;
const SCREEN_ACCESS_KEY_RE = /^[A-Za-z0-9_-]{32}$/;

function createScreenAccessKey() {
  return crypto
    .randomBytes(SCREEN_ACCESS_KEY_BYTES)
    .toString('base64url');
}

function isValidScreenAccessKey(value) {
  return (
    typeof value === 'string' &&
    SCREEN_ACCESS_KEY_RE.test(value)
  );
}

function keysMatch(expected, received) {
  if (
    !isValidScreenAccessKey(expected) ||
    !isValidScreenAccessKey(received)
  ) {
    return false;
  }

  return crypto.timingSafeEqual(
    Buffer.from(expected),
    Buffer.from(received)
  );
}

async function authenticateScreenAccess({ slug, accessKey }) {
  const normalizedSlug = normalizeBarSlug(slug);

  if (!normalizedSlug || !isValidScreenAccessKey(accessKey)) {
    return null;
  }

  const bar = await prisma.bar.findUnique({
    where: { slug: normalizedSlug },
    select: {
      id: true,
      active: true,
      settings: {
        select: {
          screenAuthRequired: true,
          screenAccessKey: true
        }
      }
    }
  });

  if (
    !bar?.active ||
    bar.settings?.screenAuthRequired !== false ||
    !keysMatch(bar.settings?.screenAccessKey, accessKey)
  ) {
    return null;
  }

  return {
    barId: bar.id,
    role: 'SCREEN'
  };
}

module.exports = {
  authenticateScreenAccess,
  createScreenAccessKey,
  isValidScreenAccessKey,
  keysMatch,
  SCREEN_ACCESS_KEY_BYTES
};
