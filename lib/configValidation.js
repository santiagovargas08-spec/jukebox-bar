'use strict';

function splitOrigins(raw) {
  return String(raw || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function isHttpOrigin(value) {
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'https:' || url.protocol === 'http:') &&
      url.origin === value.replace(/\/$/, '')
    );
  } catch {
    return false;
  }
}

function validateProductionConfig(env = process.env) {
  const errors = [];

  if (env.NODE_ENV !== 'production') {
    return errors;
  }

  if (
    !env.DATABASE_URL ||
    !/^postgres(?:ql)?:\/\//i.test(env.DATABASE_URL)
  ) {
    errors.push(
      'DATABASE_URL debe usar PostgreSQL y estar configurada en producción.'
    );
  }

  if (!env.OPERATOR_TOKEN_SECRET || env.OPERATOR_TOKEN_SECRET.length < 32) {
    errors.push('OPERATOR_TOKEN_SECRET debe tener al menos 32 caracteres.');
  }

  if (!env.MASTER_ADMIN_TOKEN_SECRET || env.MASTER_ADMIN_TOKEN_SECRET.length < 32) {
    errors.push('MASTER_ADMIN_TOKEN_SECRET debe tener al menos 32 caracteres.');
  }

  if (
    env.OPERATOR_TOKEN_SECRET &&
    env.MASTER_ADMIN_TOKEN_SECRET &&
    env.OPERATOR_TOKEN_SECRET === env.MASTER_ADMIN_TOKEN_SECRET
  ) {
    errors.push(
      'OPERATOR_TOKEN_SECRET y MASTER_ADMIN_TOKEN_SECRET deben ser diferentes.'
    );
  }

  const origins = splitOrigins(env.APP_URL);

  if (origins.length === 0) {
    errors.push('APP_URL debe definir al menos un origen público en producción.');
  } else {
    for (const origin of origins) {
      if (!isHttpOrigin(origin)) {
        errors.push(`APP_URL contiene un origen inválido: ${origin}`);
        continue;
      }

      if (!origin.startsWith('https://')) {
        errors.push(
          `APP_URL debe usar HTTPS en producción: ${origin}`
        );
      }
    }
  }

  if (env.ENABLE_LEGACY_COMMERCIAL_API === 'true') {
    if (!env.ADMIN_API_KEY || env.ADMIN_API_KEY.length < 32) {
      errors.push(
        'ADMIN_API_KEY debe tener al menos 32 caracteres cuando la API legacy está habilitada.'
      );
    }

    if (
      env.ADMIN_API_KEY &&
      (
        env.ADMIN_API_KEY === env.OPERATOR_TOKEN_SECRET ||
        env.ADMIN_API_KEY === env.MASTER_ADMIN_TOKEN_SECRET
      )
    ) {
      errors.push(
        'ADMIN_API_KEY no debe reutilizar los secretos de sesión.'
      );
    }
  }

  return errors;
}

function assertProductionConfig(env = process.env) {
  const errors = validateProductionConfig(env);

  if (errors.length > 0) {
    throw new Error(
      ['Configuración de producción inválida:', ...errors.map((e) => `- ${e}`)].join('\n')
    );
  }
}

module.exports = {
  splitOrigins,
  isHttpOrigin,
  validateProductionConfig,
  assertProductionConfig
};
