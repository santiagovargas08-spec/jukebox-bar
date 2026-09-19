'use strict';

const express = require('express');
const QRCode = require('qrcode');

const { getBarBySlug } = require('../services/barService.js');
const {
  getLicenseStatus,
  activateSubscription,
  suspendLicense,
  reactivateLicense,
  getPaymentsByBarId
} = require('../services/licenseService.js');
const { authenticateOperator, createAdminUser, revokeOperatorTokens } = require('../services/operatorAuthService.js');
const { authenticateMasterAdmin, revokeMasterAdminToken } = require('../services/masterAdminAuthService.js');
const { requireMasterAdmin } = require('../middleware/masterAdminAuth.js');
const { requireOperatorHttp } = require('../middleware/operatorAuth.js');
const { prisma } = require('../db.js');
const { createBar, getBarById, listBars, updateBar } = require('../services/barService.js');
const { buildBarUrls, getAppUrl } = require('../lib/barUrls.js');

const router = express.Router();

function noStore(req, res, next) {
  res.set('Cache-Control', 'no-store, max-age=0');
  res.set('Pragma', 'no-cache');
  next();
}

// ============================================================
// MASTER ADMIN / SUPER_ADMIN
// ============================================================

router.use('/master-admin', noStore);

router.post('/master-admin/login', async (req, res) => {
  try {
    const result = await authenticateMasterAdmin({ email: req.body?.email, password: req.body?.password, ip: req.ip });
    if (!result) return res.status(401).json({ ok: false, error: 'Credenciales inválidas.' });
    res.json({ ok: true, data: result });
  } catch (error) {
    console.error('[MASTER_ADMIN] Error iniciando sesión:', error);
    res.status(500).json({ ok: false, error: 'No se pudo iniciar sesión.' });
  }
});

router.use('/master-admin', requireMasterAdmin);

router.get('/master-admin/me', (req, res) => {
  res.json({ ok: true, data: { ...req.masterAdmin, role: 'SUPER_ADMIN' } });
});

router.post('/master-admin/logout', async (req, res) => {
  try {
    await revokeMasterAdminToken(req.masterAdmin.id);
    res.json({ ok: true });
  } catch (error) {
    console.error('[MASTER_ADMIN] Error cerrando sesión:', error);
    res.status(500).json({ ok: false, error: 'No se pudo cerrar la sesión.' });
  }
});

router.get('/master-admin/dashboard', async (req, res) => {
  try {
    const [total, active, inactive, trial, activeLicense, expired, suspended] = await Promise.all([
      prisma.bar.count(),
      prisma.bar.count({ where: { active: true } }),
      prisma.bar.count({ where: { active: false } }),
      prisma.license.count({ where: { status: 'TRIAL' } }),
      prisma.license.count({ where: { status: 'ACTIVE' } }),
      prisma.license.count({ where: { status: 'EXPIRED' } }),
      prisma.license.count({ where: { status: 'SUSPENDED' } })
    ]);
    res.json({ ok: true, data: { total, active, inactive, trial, activeLicense, expired, suspended } });
  } catch (error) {
    console.error('[MASTER_ADMIN] Error obteniendo dashboard:', error);
    res.status(500).json({ ok: false, error: 'No se pudo obtener el dashboard.' });
  }
});

router.get('/master-admin/bars', async (req, res) => {
  try {
    const bars = await listBars();
    res.json({ ok: true, data: bars.map((bar) => ({ ...bar, urls: buildBarUrls(bar, req) })) });
  } catch (error) {
    console.error('[MASTER_ADMIN] Error listando bares:', error);
    res.status(500).json({ ok: false, error: 'No se pudieron obtener los bares.' });
  }
});

router.get('/master-admin/bars/:id', async (req, res) => {
  try {
    const bar = await getBarById(req.params.id);
    if (!bar) return res.status(404).json({ ok: false, error: 'Bar no encontrado.' });
    res.json({ ok: true, data: { ...bar, urls: buildBarUrls(bar, req) } });
  } catch (error) {
    console.error('[MASTER_ADMIN] Error obteniendo bar:', error);
    res.status(500).json({ ok: false, error: 'No se pudo obtener el bar.' });
  }
});

router.post('/master-admin/bars', async (req, res) => {
  try {
    const { name, displayName, welcomeMessage, slug } = req.body || {};
    if (typeof name !== 'string' || !name.trim()) return res.status(400).json({ ok: false, error: 'El nombre del bar es obligatorio.' });
    const bar = await createBar({ name, slug, displayName, welcomeMessage });
    res.status(201).json({ ok: true, data: { ...bar, urls: buildBarUrls(bar, req) } });
  } catch (error) {
    console.error('[MASTER_ADMIN] Error creando bar:', error);
    res.status(400).json({ ok: false, error: error.message || 'No se pudo crear el bar.' });
  }
});

router.post('/master-admin/bars/:id/admins', async (req, res) => {
  try {
    const bar = await getBarById(req.params.id);
    if (!bar) return res.status(404).json({ ok: false, error: 'Bar no encontrado.' });
    const { email, displayName, password, role = 'BAR_ADMIN' } = req.body || {};
    if (role !== 'BAR_ADMIN') return res.status(400).json({ ok: false, error: 'Desde Master Admin solo se crean administradores BAR_ADMIN.' });
    const admin = await createAdminUser({ barId: bar.id, email, displayName, password, role });
    res.status(201).json({ ok: true, data: admin });
  } catch (error) {
    console.error('[MASTER_ADMIN] Error creando administrador del bar:', error);
    res.status(400).json({ ok: false, error: error.message || 'No se pudo crear el administrador.' });
  }
});

router.put('/master-admin/bars/:id', async (req, res) => {
  try {
    const bar = await updateBar(req.params.id, req.body || {});
    res.json({ ok: true, data: { ...bar, urls: buildBarUrls(bar, req) } });
  } catch (error) {
    console.error('[MASTER_ADMIN] Error actualizando bar:', error);
    res.status(error.code === 'P2025' ? 404 : 400).json({ ok: false, error: error.message || 'No se pudo actualizar el bar.' });
  }
});

router.patch('/master-admin/bars/:id/active', async (req, res) => {
  try {
    if (typeof req.body?.active !== 'boolean') return res.status(400).json({ ok: false, error: 'active debe ser boolean.' });
    const bar = await updateBar(req.params.id, { active: req.body.active });
    res.json({ ok: true, data: { ...bar, urls: buildBarUrls(bar, req) } });
  } catch (error) {
    console.error('[MASTER_ADMIN] Error cambiando estado:', error);
    res.status(error.code === 'P2025' ? 404 : 400).json({ ok: false, error: error.message || 'No se pudo cambiar el estado.' });
  }
});

router.get('/master-admin/bars/:id/license', async (req, res) => {
  try {
    const bar = await getBarById(req.params.id);
    if (!bar) return res.status(404).json({ ok: false, error: 'Bar no encontrado.' });
    res.json({ ok: true, data: await getLicenseStatus(bar.id) });
  } catch (error) {
    console.error('[MASTER_ADMIN] Error obteniendo licencia:', error);
    res.status(500).json({ ok: false, error: 'No se pudo obtener la licencia.' });
  }
});

router.post('/master-admin/bars/:id/license/activate', async (req, res) => {
  try {
    const bar = await getBarById(req.params.id);
    if (!bar) return res.status(404).json({ ok: false, error: 'Bar no encontrado.' });

    const { plan, amount, method, notes, reference, currency } = req.body || {};
    const result = await activateSubscription({
      barId: bar.id,
      plan,
      amount,
      method,
      notes,
      reference,
      currency,
      createdBy: req.masterAdmin.email
    });

    res.json({ ok: true, data: result });
  } catch (error) {
    console.error('[MASTER_ADMIN] Error activando suscripción:', error);
    res.status(400).json({ ok: false, error: error.message || 'No se pudo activar la suscripción.' });
  }
});

router.post('/master-admin/bars/:id/license/suspend', async (req, res) => {
  try {
    const bar = await getBarById(req.params.id);
    if (!bar) return res.status(404).json({ ok: false, error: 'Bar no encontrado.' });
    const license = await suspendLicense(bar.id);
    res.json({ ok: true, data: license });
  } catch (error) {
    console.error('[MASTER_ADMIN] Error suspendiendo licencia:', error);
    res.status(400).json({ ok: false, error: error.message || 'No se pudo suspender la licencia.' });
  }
});

router.post('/master-admin/bars/:id/license/reactivate', async (req, res) => {
  try {
    const bar = await getBarById(req.params.id);
    if (!bar) return res.status(404).json({ ok: false, error: 'Bar no encontrado.' });
    const license = await reactivateLicense(bar.id);
    res.json({ ok: true, data: license });
  } catch (error) {
    console.error('[MASTER_ADMIN] Error reactivando licencia:', error);
    res.status(400).json({ ok: false, error: error.message || 'No se pudo reactivar la licencia.' });
  }
});

router.get('/master-admin/bars/:id/payments', async (req, res) => {
  try {
    const bar = await getBarById(req.params.id);
    if (!bar) return res.status(404).json({ ok: false, error: 'Bar no encontrado.' });
    res.json({ ok: true, data: await getPaymentsByBarId(bar.id) });
  } catch (error) {
    console.error('[MASTER_ADMIN] Error obteniendo pagos:', error);
    res.status(500).json({ ok: false, error: 'No se pudieron obtener los pagos.' });
  }
});

router.get('/master-admin/bars/:id/urls', async (req, res) => {
  try {
    const bar = await getBarById(req.params.id);
    if (!bar) return res.status(404).json({ ok: false, error: 'Bar no encontrado.' });
    res.json({ ok: true, data: buildBarUrls(bar, req) });
  } catch (error) {
    console.error('[MASTER_ADMIN] Error construyendo URLs:', error);
    res.status(500).json({ ok: false, error: 'No se pudieron construir las URLs.' });
  }
});

// ============================================================
// OPERADORES DEL BAR
// ============================================================

router.post('/bars/:slug/operator/login', noStore, async (req, res) => {
  try {
    const result = await authenticateOperator({ slug: req.params.slug, email: req.body?.email, password: req.body?.password, ip: req.ip });
    if (!result) return res.status(401).json({ ok: false, error: 'Credenciales inválidas.' });
    res.json({ ok: true, data: result });
  } catch (error) {
    console.error('[PUBLIC] Error iniciando sesión de operador:', error);
    res.status(500).json({ ok: false, error: 'No se pudo iniciar sesión.' });
  }
});

router.post('/bars/:slug/operator/logout', noStore, requireOperatorHttp, async (req, res) => {
  try {
    const bar = await getBarBySlug(req.params.slug);

    if (!bar || bar.id !== req.operator.barId) {
      return res.status(403).json({
        ok: false,
        error: 'La sesión no corresponde a este bar.'
      });
    }

    await revokeOperatorTokens(req.operator.id);
    res.json({ ok: true });
  } catch (error) {
    console.error('[PUBLIC] Error cerrando sesión de operador:', error);
    res.status(500).json({ ok: false, error: 'No se pudo cerrar la sesión.' });
  }
});

function obtenerBaseUrl(req) { return getAppUrl(req); }

router.get('/bars/:slug', async (req, res) => {
  try {
    const bar = await getBarBySlug(req.params.slug);
    if (!bar) return res.status(404).json({ ok: false, error: 'Bar no encontrado' });
    res.json({ ok: true, data: { id: bar.id, name: bar.name, slug: bar.slug, active: bar.active, settings: bar.settings ? { displayName: bar.settings.displayName, welcomeMessage: bar.settings.welcomeMessage, primaryColor: bar.settings.primaryColor, secondaryColor: bar.settings.secondaryColor, logoUrl: bar.settings.logoUrl } : null } });
  } catch (error) {
    console.error('[PUBLIC] Error obteniendo bar:', error);
    res.status(500).json({ ok: false, error: 'No se pudo obtener el bar' });
  }
});

router.get('/bars/:slug/license/status', async (req, res) => {
  try {
    const bar = await getBarBySlug(req.params.slug);
    if (!bar) return res.status(404).json({ ok: false, error: 'Bar no encontrado' });
    const status = await getLicenseStatus(bar.id);
    if (!status) return res.status(404).json({ ok: false, error: 'No se pudo obtener el estado de la licencia' });
    res.json({ ok: true, data: { status: status.status, plan: status.plan, puedeUsar: status.puedeUsar, diasRestantes: status.diasRestantes, fechaFin: status.fechaFin, trialEndsAt: status.trialEndsAt, expiresAt: status.expiresAt } });
  } catch (error) {
    console.error('[PUBLIC] Error obteniendo licencia:', error);
    res.status(500).json({ ok: false, error: 'No se pudo obtener el estado de la licencia' });
  }
});

router.get('/bars/:slug/qr', async (req, res) => {
  try {
    const bar = await getBarBySlug(req.params.slug);
    if (!bar) return res.status(404).json({ ok: false, error: 'Bar no encontrado' });
    const clienteUrl = buildBarUrls(bar, req).cliente;
    const png = await QRCode.toBuffer(clienteUrl, { type: 'png', width: 400, margin: 2, color: { dark: '#00f0ff', light: '#0a0a0f' } });
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(png);
  } catch (error) {
    console.error('[PUBLIC] Error generando QR:', error);
    res.status(500).json({ ok: false, error: 'No se pudo generar el QR' });
  }
});

router.get('/bars/:slug/urls', async (req, res) => {
  try {
    const bar = await getBarBySlug(req.params.slug);
    if (!bar) return res.status(404).json({ ok: false, error: 'Bar no encontrado' });
    res.json({ ok: true, data: buildBarUrls(bar, req) });
  } catch (error) {
    console.error('[PUBLIC] Error obteniendo URLs:', error);
    res.status(500).json({ ok: false, error: 'No se pudieron obtener las URLs' });
  }
});

module.exports = router;
