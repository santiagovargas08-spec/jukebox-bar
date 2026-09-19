'use strict';

require('dotenv').config();

const {
  parseAuditRetentionDays
} = require('../lib/retention.js');

async function cleanupAuditLogs({
  prismaClient,
  retentionDaysRaw = process.env.AUDIT_RETENTION_DAYS,
  now = Date.now(),
  apply = false
}) {
  if (!prismaClient) {
    throw new Error('prismaClient es obligatorio.');
  }

  const retentionDays = parseAuditRetentionDays(
    retentionDaysRaw
  );

  const cutoff = new Date(
    now -
    retentionDays * 24 * 60 * 60 * 1000
  );

  const where = {
    createdAt: {
      lt: cutoff
    }
  };

  const count = await prismaClient.adminAuditLog.count({
    where
  });

  if (!apply) {
    return {
      mode: 'dry-run',
      retentionDays,
      cutoff: cutoff.toISOString(),
      rowsEligible: count
    };
  }

  const result =
    await prismaClient.adminAuditLog.deleteMany({
      where
    });

  return {
    mode: 'apply',
    retentionDays,
    cutoff: cutoff.toISOString(),
    rowsDeleted: result.count
  };
}

async function main() {
  const { prisma } = require('../db.js');

  try {
    const result = await cleanupAuditLogs({
      prismaClient: prisma,
      apply: process.argv.includes('--apply')
    });

    console.log(JSON.stringify(result));
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(
      JSON.stringify({
        level: 'error',
        message:
          error?.message ||
          String(error)
      })
    );

    process.exitCode = 1;
  });
}

module.exports = {
  main,
  cleanupAuditLogs
};
