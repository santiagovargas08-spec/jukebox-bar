'use strict';

const LOCK_NAMESPACE = Object.freeze({
  QUEUE: 1001,
  LICENSE: 1002
});

async function acquireBarScopedLock(
  tx,
  namespace,
  barId
) {
  const id = Number(barId);

  if (
    !Number.isInteger(namespace) ||
    !Number.isInteger(id) ||
    id <= 0
  ) {
    throw new Error('Advisory lock inválido.');
  }

  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(
      ${namespace},
      ${id}
    )
  `;
}

function acquireQueueLock(tx, barId) {
  return acquireBarScopedLock(
    tx,
    LOCK_NAMESPACE.QUEUE,
    barId
  );
}

function acquireLicenseLock(tx, barId) {
  return acquireBarScopedLock(
    tx,
    LOCK_NAMESPACE.LICENSE,
    barId
  );
}

module.exports = {
  LOCK_NAMESPACE,
  acquireBarScopedLock,
  acquireQueueLock,
  acquireLicenseLock
};
