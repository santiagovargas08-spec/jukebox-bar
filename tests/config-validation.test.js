'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  splitOrigins,
  isHttpOrigin,
  validateProductionConfig
} = require('../lib/configValidation.js');

describe('production config validation', () => {
  it('no exige configuración de producción fuera de production', () => {
    assert.deepEqual(
      validateProductionConfig({ NODE_ENV: 'test' }),
      []
    );
  });

  it('valida secretos y APP_URL en producción', () => {
    const errors = validateProductionConfig({
      NODE_ENV: 'production',
      OPERATOR_TOKEN_SECRET: 'short',
      MASTER_ADMIN_TOKEN_SECRET: '',
      APP_URL: ''
    });

    assert.ok(errors.some((error) => error.includes('OPERATOR_TOKEN_SECRET')));
    assert.ok(errors.some((error) => error.includes('MASTER_ADMIN_TOKEN_SECRET')));
    assert.ok(errors.some((error) => error.includes('APP_URL')));
  });

  it('acepta múltiples orígenes HTTP(S) válidos', () => {
    const env = {
      NODE_ENV: 'production',
      OPERATOR_TOKEN_SECRET: 'a'.repeat(32),
      MASTER_ADMIN_TOKEN_SECRET: 'b'.repeat(32),
      APP_URL: 'https://app.example.com,http://localhost:3000',
      ENABLE_LEGACY_COMMERCIAL_API: 'false'
    };

    assert.deepEqual(validateProductionConfig(env), []);
  });

  it('exige ADMIN_API_KEY segura si se habilita la API legacy', () => {
    const errors = validateProductionConfig({
      NODE_ENV: 'production',
      OPERATOR_TOKEN_SECRET: 'a'.repeat(32),
      MASTER_ADMIN_TOKEN_SECRET: 'b'.repeat(32),
      APP_URL: 'https://app.example.com',
      ENABLE_LEGACY_COMMERCIAL_API: 'true',
      ADMIN_API_KEY: 'short'
    });

    assert.ok(errors.some((error) => error.includes('ADMIN_API_KEY')));
  });

  it('normaliza lista de orígenes', () => {
    assert.deepEqual(
      splitOrigins(' https://a.example.com, ,https://b.example.com '),
      ['https://a.example.com', 'https://b.example.com']
    );
  });

  it('rechaza URL con path como origen', () => {
    assert.equal(isHttpOrigin('https://app.example.com/path'), false);
    assert.equal(isHttpOrigin('https://app.example.com'), true);
  });
});
