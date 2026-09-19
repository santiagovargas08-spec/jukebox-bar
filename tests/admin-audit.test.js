'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

const {
  requireTestDatabase
} = require('./helpers.js');

describe('admin audit', () => {
  let prisma;
  let auditAdminAction;
  let auditSocketAdminAction;
  let listAdminAuditLogs;
  let normalizeDetails;

  before(async () => {
    requireTestDatabase();

    delete require.cache[require.resolve('../db.js')];
    ({ prisma } = require('../db.js'));

    ({
      auditAdminAction,
      auditSocketAdminAction,
      listAdminAuditLogs,
      normalizeDetails
    } = require('../lib/adminAudit.js'));
  });

  after(async () => {
    await prisma.adminAuditLog.deleteMany({
      where: {
        OR: [
          {
            requestId: {
              startsWith: 'req-audit-test-'
            }
          },
          {
            actorId: 21,
            action: 'queue.clear'
          }
        ]
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

  it('lista auditoría paginada y permite filtrar por acción', async () => {
    const base = Date.now();

    await auditAdminAction({
      req: {
        id: `req-audit-test-${base}-1`,
        masterAdmin: {
          id: 8,
          email: 'audit@example.com'
        }
      },
      action: 'license.activate',
      barId: 9,
      entityType: 'license',
      entityId: '91'
    });

    await auditAdminAction({
      req: {
        id: `req-audit-test-${base}-2`,
        masterAdmin: {
          id: 8,
          email: 'audit@example.com'
        }
      },
      action: 'bar.update',
      barId: 9,
      entityType: 'bar',
      entityId: '9'
    });

    const page = await listAdminAuditLogs({
      action: 'license.activate',
      barId: 9,
      limit: 10,
      offset: 0
    });

    assert.ok(page.total >= 1);
    assert.equal(page.limit, 10);
    assert.equal(page.offset, 0);
    assert.ok(
      page.items.every(
        (item) =>
          item.action === 'license.activate' &&
          item.barId === 9
      )
    );
  });

  it('acota campos de auditoría antes de persistir', async () => {
    const requestId = 'req-audit-test-' + 'x'.repeat(200);

    const ok = await auditAdminAction({
      req: {
        id: requestId,
        masterAdmin: {
          id: 11,
          email: 'a'.repeat(300) + '@example.com'
        }
      },
      action: 'a'.repeat(200),
      barId: 4,
      entityType: 'entity'.repeat(30),
      entityId: 'id'.repeat(100)
    });

    assert.equal(ok, true);

    const row = await prisma.adminAuditLog.findFirst({
      where: {
        actorId: 11
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    assert.ok(row.requestId.length <= 128);
    assert.ok(row.actorEmail.length <= 254);
    assert.ok(row.action.length <= 120);
    assert.ok(row.entityType.length <= 80);
    assert.ok(row.entityId.length <= 120);
  });

  it('persiste una acción desde socket de operador', async () => {
    const socketId = `socket-audit-${Date.now()}`;

    const ok = await auditSocketAdminAction({
      socket: {
        id: socketId,
        data: {
          operator: {
            id: 21,
            email: 'operator@example.com',
            role: 'BAR_ADMIN'
          }
        }
      },
      action: 'queue.clear',
      barId: 12,
      entityType: 'queue',
      details: { removedCount: 2 }
    });

    assert.equal(ok, true);

    const row = await prisma.adminAuditLog.findFirst({
      where: {
        actorId: 21,
        action: 'queue.clear'
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    assert.ok(row);
    assert.equal(row.actorEmail, 'operator@example.com');
    assert.equal(row.actorRole, 'BAR_ADMIN');
    assert.equal(row.barId, 12);
    assert.match(row.requestId, /^socket:/);
  });

  it('redacta metadatos sensibles antes de persistir', () => {
    assert.deepEqual(
      normalizeDetails({
        safe: 'ok',
        token: 'secret-token',
        nested: {
          apiKey: 'secret-key'
        }
      }),
      {
        safe: 'ok',
        token: '[REDACTED]',
        nested: {
          apiKey: '[REDACTED]'
        }
      }
    );
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
