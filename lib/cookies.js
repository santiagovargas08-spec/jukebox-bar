'use strict';

function getCookieValueFromHeader(raw, name) {
  if (
    typeof raw !== 'string' ||
    !raw ||
    typeof name !== 'string' ||
    !name
  ) {
    return '';
  }

  for (const part of raw.split(';')) {
    const [key, ...valueParts] =
      part.trim().split('=');

    if (key !== name) continue;

    const encoded =
      valueParts.join('=');

    try {
      return decodeURIComponent(encoded);
    } catch {
      return '';
    }
  }

  return '';
}

module.exports = {
  getCookieValueFromHeader
};
