'use strict';

const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const {
  OPERATOR_COOKIE,
  getBearerToken,
  getOperatorToken
} = require('../middleware/operatorAuth.js');

describe('operator auth middleware helpers', () => {
  afterEach(() => {
    delete process.env.ENABLE_BEARER_ADMIN_AUTH;
  });
  it('extrae un token Bearer válido', () => {
    const req = {
      headers: {
        authorization: 'Bearer token-demo'
      }
    };

    assert.equal(getBearerToken(req), 'token-demo');
  });

  it('acepta el esquema Bearer sin importar mayúsculas', () => {
    const req = {
      headers: {
        authorization: 'bearer token-demo'
      }
    };

    assert.equal(getBearerToken(req), 'token-demo');
  });

  it('Bearer queda deshabilitado por defecto para la sesión HTTP', () => {
    const req = {
      headers: {
        authorization: 'Bearer bearer-token',
        cookie: `${OPERATOR_COOKIE}=cookie-token`
      }
    };

    assert.equal(
      getOperatorToken(req),
      'cookie-token'
    );
  });

  it('Bearer puede habilitarse explícitamente por compatibilidad', () => {
    process.env.ENABLE_BEARER_ADMIN_AUTH = 'true';

    const req = {
      headers: {
        authorization: 'Bearer bearer-token',
        cookie: `${OPERATOR_COOKIE}=cookie-token`
      }
    };

    assert.equal(
      getOperatorToken(req),
      'bearer-token'
    );
  });

  it('rechaza esquemas distintos a Bearer', () => {
    const req = {
      headers: {
        authorization: 'Basic abc123'
      }
    };

    assert.equal(getBearerToken(req), null);
  });

  it('rechaza cabeceras incompletas', () => {
    assert.equal(getBearerToken({ headers: {} }), null);
    assert.equal(
      getBearerToken({ headers: { authorization: 'Bearer' } }),
      null
    );
  });
});
