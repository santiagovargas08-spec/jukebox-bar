'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { getBearerToken } = require('../middleware/operatorAuth.js');

describe('operator auth middleware helpers', () => {
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
