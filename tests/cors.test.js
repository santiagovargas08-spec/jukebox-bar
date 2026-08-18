'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  createSocketCorsOptions,
  getAllowedOrigins
} = require('../lib/socketBar.js');

describe('cors', () => {
  it('producción sin APP_URL no permite wildcard', () => {
    const previous = process.env.APP_URL;
    const previousEnv = process.env.NODE_ENV;

    process.env.APP_URL = '';
    process.env.NODE_ENV = 'production';

    const options = createSocketCorsOptions();
    assert.equal(options.origin, false);

    process.env.APP_URL = previous;
    process.env.NODE_ENV = previousEnv;
  });

  it('origen permitido en lista APP_URL', () => {
    const previous = process.env.APP_URL;
    process.env.APP_URL = 'https://app.example.com,https://bar.example.com';

    const origins = getAllowedOrigins();
    assert.ok(origins.includes('https://app.example.com'));

    const options = createSocketCorsOptions();
    let allowed = false;

    options.origin('https://app.example.com', (error, result) => {
      allowed = !error && result === true;
    });

    assert.equal(allowed, true);

    process.env.APP_URL = previous;
  });

  it('origen no permitido es rechazado', () => {
    const previous = process.env.APP_URL;
    process.env.APP_URL = 'https://app.example.com';

    const options = createSocketCorsOptions();
    let rejected = false;

    options.origin('https://evil.example.com', (error) => {
      rejected = Boolean(error);
    });

    assert.equal(rejected, true);

    process.env.APP_URL = previous;
  });
});
