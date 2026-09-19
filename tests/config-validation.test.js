'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  splitOrigins,
  isHttpOrigin,
  validateProductionConfig
} = require('../lib/configValidation.js');

function validProductionEnv() {
  return {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://user:pass@db.example.com:5432/jukebox',
    OPERATOR_TOKEN_SECRET: 'a'.repeat(32),
    MASTER_ADMIN_TOKEN_SECRET: 'b'.repeat(32),
    APP_URL: 'https://app.example.com',
    ENABLE_LEGACY_COMMERCIAL_API: 'false'
  };
}

describe('production config validation', () => {
  it('no exige configuración de producción fuera de production', () => {
    assert.deepEqual(
      validateProductionConfig({ NODE_ENV: 'test' }),
      []
    );
  });

  it('valida secretos, base de datos y APP_URL en producción', () => {
    const errors = validateProductionConfig({
      NODE_ENV: 'production',
      OPERATOR_TOKEN_SECRET: 'short',
      MASTER_ADMIN_TOKEN_SECRET: '',
      APP_URL: ''
    });

    assert.ok(errors.some((error) => error.includes('DATABASE_URL')));
    assert.ok(errors.some((error) => error.includes('OPERATOR_TOKEN_SECRET')));
    assert.ok(errors.some((error) => error.includes('MASTER_ADMIN_TOKEN_SECRET')));
    assert.ok(errors.some((error) => error.includes('APP_URL')));
  });

  it('acepta múltiples orígenes HTTPS válidos', () => {
    const env = validProductionEnv();
    env.APP_URL =
      'https://app.example.com,https://bar.example.com';

    assert.deepEqual(validateProductionConfig(env), []);
  });

  it('producción rechaza DATABASE_URL ausente', () => {
    const env = validProductionEnv();
    delete env.DATABASE_URL;

    const errors = validateProductionConfig(env);
    assert.ok(errors.some((error) => error.includes('DATABASE_URL')));
  });

  it('producción exige APP_URL con HTTPS', () => {
    const env = validProductionEnv();
    env.APP_URL = 'http://jukebox.example.com';

    const errors = validateProductionConfig(env);
    assert.ok(errors.some((error) => error.includes('HTTPS')));
  });

  it('producción rechaza secretos de sesión iguales', () => {
    const env = validProductionEnv();
    env.MASTER_ADMIN_TOKEN_SECRET =
      env.OPERATOR_TOKEN_SECRET;

    const errors = validateProductionConfig(env);
    assert.ok(
      errors.some((error) =>
        error.includes('deben ser diferentes')
      )
    );
  });

  it('exige ADMIN_API_KEY segura si se habilita la API legacy', () => {
    const env = validProductionEnv();
    env.ENABLE_LEGACY_COMMERCIAL_API = 'true';
    env.ADMIN_API_KEY = 'short';

    const errors = validateProductionConfig(env);
    assert.ok(
      errors.some((error) =>
        error.includes('ADMIN_API_KEY')
      )
    );
  });

  it('API legacy no puede reutilizar secretos de sesión', () => {
    const env = validProductionEnv();
    env.ENABLE_LEGACY_COMMERCIAL_API = 'true';
    env.ADMIN_API_KEY = env.OPERATOR_TOKEN_SECRET;

    const errors = validateProductionConfig(env);
    assert.ok(
      errors.some((error) =>
        error.includes('no debe reutilizar')
      )
    );
  });

  it('normaliza lista de orígenes', () => {
    assert.deepEqual(
      splitOrigins(
        ' https://a.example.com, ,https://b.example.com '
      ),
      [
        'https://a.example.com',
        'https://b.example.com'
      ]
    );
  });

  it('rechaza URL con path como origen', () => {
    assert.equal(
      isHttpOrigin('https://app.example.com/path'),
      false
    );
    assert.equal(
      isHttpOrigin('https://app.example.com'),
      true
    );
  });
});
