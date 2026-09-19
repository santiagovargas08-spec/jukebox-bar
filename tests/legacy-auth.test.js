'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  safeEqualSecret
} = require('../middleware/auth.js');

describe('legacy commercial auth helpers', () => {
  it('acepta secretos idénticos', () => {
    assert.equal(
      safeEqualSecret('a'.repeat(32), 'a'.repeat(32)),
      true
    );
  });

  it('rechaza secretos distintos', () => {
    assert.equal(
      safeEqualSecret('a'.repeat(32), 'b'.repeat(32)),
      false
    );
  });

  it('rechaza secretos con longitud distinta', () => {
    assert.equal(
      safeEqualSecret('short', 'a'.repeat(32)),
      false
    );
  });

  it('rechaza valores no string', () => {
    assert.equal(
      safeEqualSecret(null, 'a'.repeat(32)),
      false
    );
  });
});
