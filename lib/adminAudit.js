'use strict';

const { logInfo } = require('./logger.js');

function auditAdminAction({
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

  logInfo('Administrative action', {
    event: 'admin_audit',
    requestId: req?.id || null,
    action,
    actorId: actor?.id || null,
    actorEmail: actor?.email || null,
    actorRole: actor?.role || (req?.masterAdmin ? 'SUPER_ADMIN' : null),
    barId,
    entityType,
    entityId,
    details
  });
}

module.exports = {
  auditAdminAction
};
