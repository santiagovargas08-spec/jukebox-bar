'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeBarSlug
} = require('../lib/barSlug.js');

describe('bar slug validation', () => {
  it('normaliza un slug válido', () => {
    assert.equal(
      normalizeBarSlug('  Bar-Demo-01  '),
      'bar-demo-01'
    );
  });

  it('rechaza slugs con rutas o caracteres ajenos al formato', () => {
    assert.equal(normalizeBarSlug('../admin'), null);
    assert.equal(normalizeBarSlug('bar_demo'), null);
    assert.equal(normalizeBarSlug('-bar'), null);
    assert.equal(normalizeBarSlug('bar-'), null);
  });

  it('rechaza slugs mayores a 80 caracteres', () => {
    assert.equal(normalizeBarSlug('a'.repeat(81)), null);
  });
});
