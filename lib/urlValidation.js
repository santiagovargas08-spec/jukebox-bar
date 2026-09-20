'use strict';

const ALLOWED_IMAGE_HOSTS = new Set([
  'i.ytimg.com',
  'img.youtube.com',
  'yt3.ggpht.com',
  'yt3.googleusercontent.com'
]);

const BAR_LOGO_HOSTS = new Set([
  'res.cloudinary.com'
]);

const YOUTUBE_VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

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

function sanitizeBarLogoUrl(value) {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  if (!isSafeHttpUrl(trimmed)) {
    throw new Error('La URL del logo no es válida.');
  }

  const parsed = new URL(trimmed);

  if (
    parsed.protocol !== 'https:' ||
    !BAR_LOGO_HOSTS.has(parsed.hostname)
  ) {
    throw new Error(
      'El logo debe usar una URL HTTPS directa de Cloudinary.'
    );
  }

  return parsed.toString();
}

function isValidYoutubeVideoId(value) {
  return (
    typeof value === 'string' &&
    YOUTUBE_VIDEO_ID_RE.test(value.trim())
  );
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
  sanitizeBarLogoUrl,
  isValidYoutubeVideoId,
  sanitizeThumbnailUrl
};
