'use strict';

const BAR_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;

function normalizeBarSlug(value) {
  if (typeof value !== 'string') return null;

  const slug = value
    .trim()
    .toLowerCase();

  if (
    slug.length === 0 ||
    slug.length > 80 ||
    !BAR_SLUG_RE.test(slug)
  ) {
    return null;
  }

  return slug;
}

module.exports = {
  normalizeBarSlug,
  BAR_SLUG_RE
};
