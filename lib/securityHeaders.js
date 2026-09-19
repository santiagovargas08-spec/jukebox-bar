'use strict';

function buildContentSecurityPolicy() {
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'self'",
    "form-action 'self'",
    "script-src 'self' https://www.youtube.com https://www.gstatic.com",
    "script-src-attr 'none'",
    "worker-src 'none'",
    "manifest-src 'self'",
    "style-src 'self' https://fonts.googleapis.com",
    "style-src-elem 'self' https://fonts.googleapis.com",
    "style-src-attr 'unsafe-inline'",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: blob: https://i.ytimg.com https://img.youtube.com https://yt3.ggpht.com https://yt3.googleusercontent.com",
    "frame-src https://www.youtube.com https://www.youtube-nocookie.com",
    "connect-src 'self' ws: wss: https://www.youtube.com"
  ].join('; ');
}

function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-DNS-Prefetch-Control', 'off');
  res.setHeader(
    'X-Permitted-Cross-Domain-Policies',
    'none'
  );
  // Deshabilita el filtro XSS heredado de navegadores antiguos; la defensa
  // efectiva se basa en CSP + escaping/DOM seguro.
  res.setHeader('X-XSS-Protection', '0');
  res.setHeader(
    'Cross-Origin-Opener-Policy',
    'same-origin-allow-popups'
  );
  res.setHeader(
    'Cross-Origin-Resource-Policy',
    'same-site'
  );
  res.setHeader('Origin-Agent-Cluster', '?1');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=()'
  );
  res.setHeader('Content-Security-Policy', buildContentSecurityPolicy());

  if (process.env.NODE_ENV === 'production') {
    res.setHeader(
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains'
    );
  }

  next();
}

module.exports = {
  buildContentSecurityPolicy,
  securityHeaders
};
