'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

const {
  requireTestDatabase
} = require('./helpers.js');

describe('admin audit', () => {
  let prisma;
  let auditAdminAction;
  let normalizeDetails;

  before(async () => {
    requireTestDatabase();

    delete require.cache[require.resolve('../db.js')];
    ({ prisma } = require('../db.js'));

    ({
      auditAdminAction,
      normalizeDetails
    } = require('../lib/adminAudit.js'));
  });

  after(async () => {
    await prisma.adminAuditLog.deleteMany({
      where: {
        requestId: {
          startsWith: 'req-audit-test-'
        }
      }
    });

    await prisma.$disconnect();
  });

  it('persiste una acción administrativa con actor y metadatos', async () => {
    const requestId =
      `req-audit-test-${Date.now()}`;

    const ok = await auditAdminAction({
      req: {
        id: requestId,
        masterAdmin: {
          id: 7,
          email: 'admin@example.com'
        }
      },
      action: 'bar.update',
      barId: 3,
      entityType: 'bar',
      entityId: '3',
      details: {
        fields: ['name']
      }
    });

    assert.equal(ok, true);

    const row = await prisma.adminAuditLog.findFirst({
      where: {
        requestId,
        action: 'bar.update'
      }
    });

    assert.ok(row);
    assert.equal(row.actorId, 7);
    assert.equal(row.actorEmail, 'admin@example.com');
    assert.equal(row.actorRole, 'SUPER_ADMIN');
    assert.equal(row.barId, 3);
    assert.equal(row.entityType, 'bar');
    assert.equal(row.entityId, '3');
    assert.deepEqual(row.details, {
      fields: ['name']
    });
  });

  it('normaliza detalles serializables', () => {
    assert.deepEqual(
      normalizeDetails({
        safe: true,
        nested: {
          value: 2
        }
      }),
      {
        safe: true,
        nested: {
          value: 2
        }
      }
    );
  });
});
