'use strict';

const { prisma } = require('../db.js');
const { logError, logInfo, sanitizeLogValue } = require('./logger.js');

function normalizeDetails(details) {
  if (!details || typeof details !== 'object') {
    return {};
  }

  const sanitized = sanitizeLogValue(details);

  return (
    sanitized &&
    typeof sanitized === 'object' &&
    !Array.isArray(sanitized)
  )
    ? sanitized
    : {};
}

async function auditAdminAction({
  req,
  action,
  barId = null,
  entityType = null,
  entityId = null,
  details = {}
}) {
  const actor =
    req?.masterAdmin ||
    req?.operator ||
    null;

  const entry = {
    requestId: req?.id || null,
    actorId: actor?.id || null,
    actorEmail: actor?.email || null,
    actorRole: actor?.role || (req?.masterAdmin ? 'SUPER_ADMIN' : null),
    action,
    barId: Number.isInteger(Number(barId))
      ? Number(barId)
      : null,
    entityType: entityType || null,
    entityId:
      entityId === null || entityId === undefined
        ? null
        : String(entityId),
    details: normalizeDetails(details)
  };

  logInfo('Administrative action', {
    event: 'admin_audit',
    ...entry
  });

  try {
    await prisma.adminAuditLog.create({
      data: entry
    });

    return true;
  } catch (error) {
    logError('No se pudo persistir auditoría administrativa', {
      event: 'admin_audit_persist_error',
      requestId: entry.requestId,
      action: entry.action,
      barId: entry.barId,
      error: error?.message || String(error)
    });

    return false;
  }
}

async function listAdminAuditLogs({
  limit = 50,
  offset = 0,
  barId = null,
  action = null
} = {}) {
  const safeLimit = Math.min(
    Math.max(Number.parseInt(limit, 10) || 50, 1),
    200
  );

  const safeOffset = Math.max(
    Number.parseInt(offset, 10) || 0,
    0
  );

  const normalizedBarId = Number(barId);
  const normalizedAction =
    typeof action === 'string' && action.trim()
      ? action.trim().slice(0, 120)
      : null;

  const where = {};

  if (
    Number.isInteger(normalizedBarId) &&
    normalizedBarId > 0
  ) {
    where.barId = normalizedBarId;
  }

  if (normalizedAction) {
    where.action = normalizedAction;
  }

  const [items, total] = await Promise.all([
    prisma.adminAuditLog.findMany({
      where,
      orderBy: {
        createdAt: 'desc'
      },
      skip: safeOffset,
      take: safeLimit
    }),
    prisma.adminAuditLog.count({ where })
  ]);

  return {
    items,
    total,
    limit: safeLimit,
    offset: safeOffset
  };
}

module.exports = {
  auditAdminAction,
  listAdminAuditLogs,
  normalizeDetails
};
