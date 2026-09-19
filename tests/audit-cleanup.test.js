'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  cleanupAuditLogs
} = require('../scripts/cleanup-audit-logs.js');

function createPrismaMock({
  count = 5,
  deleted = 5
} = {}) {
  const calls = {
    count: [],
    deleteMany: []
  };

  return {
    calls,
    adminAuditLog: {
      async count(args) {
        calls.count.push(args);
        return count;
      },
      async deleteMany(args) {
        calls.deleteMany.push(args);
        return { count: deleted };
      }
    }
  };
}

describe('audit retention cleanup', () => {
  it('dry-run no elimina filas', async () => {
    const prisma = createPrismaMock({
      count: 7
    });

    const result = await cleanupAuditLogs({
      prismaClient: prisma,
      retentionDaysRaw: '180',
      now: Date.parse('2026-09-19T12:00:00Z'),
      apply: false
    });

    assert.equal(result.mode, 'dry-run');
    assert.equal(result.rowsEligible, 7);
    assert.equal(prisma.calls.count.length, 1);
    assert.equal(prisma.calls.deleteMany.length, 0);
  });

  it('apply elimina solo filas anteriores al cutoff', async () => {
    const prisma = createPrismaMock({
      count: 3,
      deleted: 3
    });

    const result = await cleanupAuditLogs({
      prismaClient: prisma,
      retentionDaysRaw: '365',
      now: Date.parse('2026-09-19T12:00:00Z'),
      apply: true
    });

    assert.equal(result.mode, 'apply');
    assert.equal(result.rowsDeleted, 3);
    assert.equal(prisma.calls.deleteMany.length, 1);

    const cutoff =
      prisma.calls.deleteMany[0].where.createdAt.lt;

    assert.ok(cutoff instanceof Date);
    assert.equal(
      cutoff.toISOString(),
      '2025-09-19T12:00:00.000Z'
    );
  });

  it('exige un cliente Prisma explícito', async () => {
    await assert.rejects(
      () => cleanupAuditLogs({
        prismaClient: null
      }),
      /prismaClient es obligatorio/
    );
  });
});
