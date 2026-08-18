'use strict';

window.DomSafe = (function () {
  const ALLOWED_IMAGE_HOSTS = new Set([
    'i.ytimg.com',
    'img.youtube.com',
    'yt3.ggpht.com'
  ]);

  function escapeHtml(str) {
    if (!str) {
      return '';
    }

    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function sanitizeThumbnailUrl(value) {
    if (typeof value !== 'string') {
      return '';
    }

    const trimmed = value.trim();

    if (!trimmed) {
      return '';
    }

    let parsed;

    try {
      parsed = new URL(trimmed);
    } catch {
      return '';
    }

    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return '';
    }

    if (parsed.username || parsed.password) {
      return '';
    }

    if (!ALLOWED_IMAGE_HOSTS.has(parsed.hostname)) {
      return '';
    }

    return parsed.toString();
  }

  function safeThumbnailAttr(value, fallback) {
    const safe = sanitizeThumbnailUrl(value);
    return safe ? escapeHtml(safe) : (fallback || '');
  }

  return {
    escapeHtml,
    sanitizeThumbnailUrl,
    safeThumbnailAttr
  };
})();
