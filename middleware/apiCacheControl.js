'use strict';

function apiNoStore(req, res, next) {
  res.setHeader(
    'Cache-Control',
    'no-store, max-age=0'
  );
  res.setHeader('Pragma', 'no-cache');
  next();
}

module.exports = {
  apiNoStore
};
