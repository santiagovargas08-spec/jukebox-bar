'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  parseAuditRetentionDays,
  MIN_AUDIT_RETENTION_DAYS,
  MAX_AUDIT_RETENTION_DAYS,
  DEFAULT_AUDIT_RETENTION_DAYS
} = require('../lib/retention.js');

describe('audit retention parser', () => {
  it('usa el valor por defecto cuando no hay número válido', () => {
    assert.equal(
      parseAuditRetentionDays(undefined),
      DEFAULT_AUDIT_RETENTION_DAYS
    );
    assert.equal(
      parseAuditRetentionDays('abc'),
      DEFAULT_AUDIT_RETENTION_DAYS
    );
  });

  it('aplica límites mínimo y máximo', () => {
    assert.equal(
      parseAuditRetentionDays('1'),
      MIN_AUDIT_RETENTION_DAYS
    );
    assert.equal(
      parseAuditRetentionDays('99999'),
      MAX_AUDIT_RETENTION_DAYS
    );
  });

  it('acepta valores dentro del rango', () => {
    assert.equal(
      parseAuditRetentionDays('365'),
      365
    );
  });
});
