'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  parseRetentionDays,
  MIN_DAYS,
  MAX_DAYS,
  DEFAULT_DAYS
} = require('../scripts/cleanup-audit-logs.js');

describe('audit retention parser', () => {
  it('usa el valor por defecto cuando no hay número válido', () => {
    assert.equal(
      parseRetentionDays(undefined),
      DEFAULT_DAYS
    );
    assert.equal(
      parseRetentionDays('abc'),
      DEFAULT_DAYS
    );
  });

  it('aplica límites mínimo y máximo', () => {
    assert.equal(
      parseRetentionDays('1'),
      MIN_DAYS
    );
    assert.equal(
      parseRetentionDays('99999'),
      MAX_DAYS
    );
  });

  it('acepta valores dentro del rango', () => {
    assert.equal(
      parseRetentionDays('365'),
      365
    );
  });
});
