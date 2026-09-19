'use strict';

const MIN_AUDIT_RETENTION_DAYS = 30;
const MAX_AUDIT_RETENTION_DAYS = 3650;
const DEFAULT_AUDIT_RETENTION_DAYS = 180;

function parseAuditRetentionDays(raw) {
  const parsed = Number.parseInt(raw, 10);

  if (!Number.isInteger(parsed)) {
    return DEFAULT_AUDIT_RETENTION_DAYS;
  }

  return Math.min(
    Math.max(parsed, MIN_AUDIT_RETENTION_DAYS),
    MAX_AUDIT_RETENTION_DAYS
  );
}

module.exports = {
  parseAuditRetentionDays,
  MIN_AUDIT_RETENTION_DAYS,
  MAX_AUDIT_RETENTION_DAYS,
  DEFAULT_AUDIT_RETENTION_DAYS
};
