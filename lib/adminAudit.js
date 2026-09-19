'use strict';

const { prisma } = require('../db.js');
const { logError, logInfo } = require('./logger.js');

function normalizeDetails(details) {
  if (!details || typeof details !== 'object') {
    return {};
  }

  return JSON.parse(JSON.stringify(details));
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

module.exports = {
  auditAdminAction,
  normalizeDetails
};
