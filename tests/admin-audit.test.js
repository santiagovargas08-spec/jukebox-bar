'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { auditAdminAction } = require('../lib/adminAudit.js');

describe('admin audit', () => {
  it('emite un evento sin lanzar error con actor master admin', () => {
    const req = {
      id: 'req-audit-1234',
      masterAdmin: {
        id: 7,
        email: 'admin@example.com'
      }
    };

    assert.doesNotThrow(() => {
      auditAdminAction({
        req,
        action: 'bar.update',
        barId: 3,
        entityType: 'bar',
        entityId: '3',
        details: { fields: ['name'] }
      });
    });
  });

  it('tolera requests sin actor para mantener el logger robusto', () => {
    assert.doesNotThrow(() => {
      auditAdminAction({
        req: { id: 'req-audit-5678' },
        action: 'system.test'
      });
    });
  });
});
