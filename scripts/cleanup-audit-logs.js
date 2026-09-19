'use strict';

require('dotenv').config();

const {
  parseAuditRetentionDays
} = require('../lib/retention.js');

let prisma = null;

async function main() {
  ({ prisma } = require('../db.js'));

  const retentionDays = parseAuditRetentionDays(
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

if (require.main === module) {
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
      if (prisma) {
        await prisma.$disconnect();
      }
    });
}

module.exports = {
  main
};
