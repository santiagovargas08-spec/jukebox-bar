'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

const {
  requireTestDatabase,
  createTestBar,
  deleteTestBar,
  uniqueSlug
} = require('./helpers.js');

describe('license', () => {
  let prisma;
  let bar;
  let licenseService;

  before(async () => {
    requireTestDatabase();

    delete require.cache[require.resolve('../db.js')];
    ({ prisma } = require('../db.js'));
    licenseService = require('../services/licenseService.js');

    bar = await createTestBar(prisma, { slug: uniqueSlug('license-bar') });
  });

  after(async () => {
    if (bar?.id) await deleteTestBar(prisma, bar.id);
    await prisma.$disconnect();
  });

  it('activación doble registra dos pagos sin error', async () => {
    const first = await licenseService.activateSubscription({
      barId: bar.id,
      plan: 'MONTHLY',
      amount: 10,
      method: 'CASH',
      reference: 'REF-1',
      createdBy: 'test'
    });

    const second = await licenseService.activateSubscription({
      barId: bar.id,
      plan: 'MONTHLY',
      amount: 10,
      method: 'CASH',
      reference: 'REF-2',
      createdBy: 'test'
    });

    assert.equal(first.license.status, 'ACTIVE');
    assert.equal(second.license.status, 'ACTIVE');

    const payments = await licenseService.getPaymentsByBarId(bar.id);
    assert.equal(payments.length, 2);
  });

  it('activación simultánea no duplica licencias activas', async () => {
    const concurrentBar = await createTestBar(prisma, {
      slug: uniqueSlug('license-concurrent')
    });

    const results = await Promise.all([
      licenseService.activateSubscription({
        barId: concurrentBar.id,
        plan: 'MONTHLY',
        amount: 15,
        method: 'CASH',
        reference: 'CONC-1'
      }),
      licenseService.activateSubscription({
        barId: concurrentBar.id,
        plan: 'MONTHLY',
        amount: 15,
        method: 'CASH',
        reference: 'CONC-2'
      })
    ]);

    assert.equal(results[0].license.status, 'ACTIVE');
    assert.equal(results[1].license.status, 'ACTIVE');

    const licenses = await prisma.license.findMany({
      where: { barId: concurrentBar.id }
    });
    assert.equal(licenses.length, 1);

    const payments = await licenseService.getPaymentsByBarId(concurrentBar.id);
    assert.equal(payments.length, 2);

    await deleteTestBar(prisma, concurrentBar.id);
  });

  it('rechaza monto fuera de rango', async () => {
    await assert.rejects(
      () => licenseService.activateSubscription({
        barId: bar.id,
        plan: 'MONTHLY',
        amount: 100000000,
        method: 'CASH'
      }),
      /no superar/
    );
  });

  it('rechaza código de moneda inválido', async () => {
    await assert.rejects(
      () => licenseService.activateSubscription({
        barId: bar.id,
        plan: 'MONTHLY',
        amount: 10,
        method: 'CASH',
        currency: 'US'
      }),
      /3 letras/
    );
  });

  it('rechaza notas excesivamente largas', async () => {
    await assert.rejects(
      () => licenseService.activateSubscription({
        barId: bar.id,
        plan: 'MONTHLY',
        amount: 10,
        method: 'CASH',
        notes: 'x'.repeat(1001)
      }),
      /notas no pueden superar/i
    );
  });

  it('isLicenseRecordValid evalúa fechas sin consultar la base de datos', () => {
    const now = new Date('2026-09-19T12:00:00Z');

    assert.equal(
      licenseService.isLicenseRecordValid({
        status: 'TRIAL',
        trialEndsAt: new Date('2026-09-20T12:00:00Z')
      }, now),
      true
    );

    assert.equal(
      licenseService.isLicenseRecordValid({
        status: 'TRIAL',
        trialEndsAt: new Date('2026-09-18T12:00:00Z')
      }, now),
      false
    );

    assert.equal(
      licenseService.isLicenseRecordValid({
        status: 'ACTIVE',
        expiresAt: new Date('2026-10-19T12:00:00Z')
      }, now),
      true
    );

    assert.equal(
      licenseService.isLicenseRecordValid({
        status: 'SUSPENDED',
        expiresAt: new Date('2026-10-19T12:00:00Z')
      }, now),
      false
    );
  });

  it('TRIAL vigente permite uso', async () => {
    const trialBar = await createTestBar(prisma, { slug: uniqueSlug('trial-bar') });
    const valid = await licenseService.isLicenseValid(trialBar.id);
    assert.equal(valid, true);
    await deleteTestBar(prisma, trialBar.id);
  });

  it('EXPIRED bloquea uso', async () => {
    const expiredBar = await createTestBar(prisma, { slug: uniqueSlug('expired-bar') });
    await prisma.license.update({
      where: { barId: expiredBar.id },
      data: {
        status: 'EXPIRED',
        trialEndsAt: new Date(Date.now() - 86400000)
      }
    });
    const valid = await licenseService.isLicenseValid(expiredBar.id);
    assert.equal(valid, false);
    await deleteTestBar(prisma, expiredBar.id);
  });

  it('SUSPENDED bloquea uso', async () => {
    const suspendedBar = await createTestBar(prisma, { slug: uniqueSlug('suspended-bar') });
    await prisma.license.update({
      where: { barId: suspendedBar.id },
      data: { status: 'SUSPENDED' }
    });
    const valid = await licenseService.isLicenseValid(suspendedBar.id);
    assert.equal(valid, false);
    await deleteTestBar(prisma, suspendedBar.id);
  });
});
