'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const originalLoad = Module._load;
let barResult = null;

try {
  Module._load = function loadWithStub(request, parent, isMain) {
    if (
      parent?.filename.endsWith('/services/screenAccessService.js') &&
      request === '../db.js'
    ) {
      return {
        prisma: {
          bar: {
            findUnique: async () => barResult
          }
        }
      };
    }

    return originalLoad.call(this, request, parent, isMain);
  };

  module.exports.screenAccess = require('../services/screenAccessService.js');
} finally {
  Module._load = originalLoad;
}

const {
  authenticateScreenAccess,
  createScreenAccessKey,
  isValidScreenAccessKey,
  keysMatch
} = module.exports.screenAccess;

describe('screen access', () => {
  it('genera claves aptas para URL', () => {
    const key = createScreenAccessKey();
    assert.equal(isValidScreenAccessKey(key), true);
    assert.equal(key.length, 32);
  });

  it('compara claves válidas sin aceptar formatos arbitrarios', () => {
    const key = createScreenAccessKey();
    assert.equal(keysMatch(key, key), true);
    assert.equal(keysMatch(key, createScreenAccessKey()), false);
    assert.equal(keysMatch(key, 'corta'), false);
  });

  it('autoriza solo la pantalla activa configurada sin correo', async () => {
    const key = createScreenAccessKey();
    barResult = {
      id: 7,
      active: true,
      settings: {
        screenAuthRequired: false,
        screenAccessKey: key
      }
    };

    assert.deepEqual(
      await authenticateScreenAccess({ slug: 'bar-demo', accessKey: key }),
      { barId: 7, role: 'SCREEN' }
    );

    barResult.settings.screenAuthRequired = true;
    assert.equal(
      await authenticateScreenAccess({ slug: 'bar-demo', accessKey: key }),
      null
    );
  });
});
