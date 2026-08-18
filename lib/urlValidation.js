'use strict';

const ALLOWED_IMAGE_HOSTS = new Set([
  'i.ytimg.com',
  'img.youtube.com',
  'yt3.ggpht.com'
]);

function isSafeHttpUrl(value) {
  if (typeof value !== 'string') {
    return false;
  }

  const trimmed = value.trim();

  if (!trimmed) {
    return false;
  }

  let parsed;

  try {
    parsed = new URL(trimmed);
  } catch {
    return false;
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return false;
  }

  if (parsed.username || parsed.password) {
    return false;
  }

  return true;
}

function sanitizeThumbnailUrl(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();

  if (!trimmed || !isSafeHttpUrl(trimmed)) {
    return null;
  }

  const parsed = new URL(trimmed);

  if (!ALLOWED_IMAGE_HOSTS.has(parsed.hostname)) {
    return null;
  }

  return parsed.toString();
}

module.exports = {
  isSafeHttpUrl,
  sanitizeThumbnailUrl
};
