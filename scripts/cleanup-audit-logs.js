'use strict';

require('dotenv').config();

const { prisma } = require('../db.js');

const MIN_DAYS = 30;
const MAX_DAYS = 3650;
const DEFAULT_DAYS = 180;

function parseRetentionDays(raw) {
  const parsed = Number.parseInt(raw, 10);

  if (!Number.isInteger(parsed)) {
    return DEFAULT_DAYS;
  }

  return Math.min(
    Math.max(parsed, MIN_DAYS),
    MAX_DAYS
  );
}

async function main() {
  const retentionDays = parseRetentionDays(
    process.env.AUDIT_RETENTION_DAYS
  );

  const cutoff = new Date(
    Date.now() -
    retentionDays * 24 * 60 * 60 * 1000
  );

  const where = {
    createdAt: {
      lt: cutoff
    }
  };

  const count = await prisma.adminAuditLog.count({
    where
  });

  const apply = process.argv.includes('--apply');

  if (!apply) {
    console.log(
      JSON.stringify({
        mode: 'dry-run',
        retentionDays,
        cutoff: cutoff.toISOString(),
        rowsEligible: count
      })
    );
    return;
  }

  const result = await prisma.adminAuditLog.deleteMany({
    where
  });

  console.log(
    JSON.stringify({
      mode: 'apply',
      retentionDays,
      cutoff: cutoff.toISOString(),
      rowsDeleted: result.count
    })
  );
}

main()
  .catch((error) => {
    console.error(
      JSON.stringify({
        level: 'error',
        message:
          error?.message ||
          String(error)
      })
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
