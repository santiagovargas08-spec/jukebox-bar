'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  MASTER_ADMIN_COOKIE,
  getCookieValue,
  getMasterAdminToken
} = require('../middleware/masterAdminAuth.js');

describe('master admin cookie auth helpers', () => {
  it('extrae la sesión desde cookie HttpOnly transportada por HTTP', () => {
    const req = {
      headers: {
        cookie: `other=1; ${MASTER_ADMIN_COOKIE}=token-demo; theme=dark`
      }
    };

    assert.equal(
      getCookieValue(req, MASTER_ADMIN_COOKIE),
      'token-demo'
    );

    assert.equal(
      getMasterAdminToken(req),
      'token-demo'
    );
  });

  it('Bearer conserva prioridad para compatibilidad', () => {
    const req = {
      headers: {
        authorization: 'Bearer bearer-token',
        cookie: `${MASTER_ADMIN_COOKIE}=cookie-token`
      }
    };

    assert.equal(
      getMasterAdminToken(req),
      'bearer-token'
    );
  });

  it('devuelve cadena vacía cuando no existe sesión', () => {
    assert.equal(
      getMasterAdminToken({ headers: {} }),
      ''
    );
  });
});
