'use strict';

const express = require('express');
const QRCode = require('qrcode');

const { getBarBySlug } = require('../services/barService.js');
const { getLicenseStatus } = require('../services/licenseService.js');
const { authenticateOperator } = require('../services/operatorAuthService.js');
const { authenticateMasterAdmin } = require('../services/masterAdminAuthService.js');
const { requireMasterAdmin } = require('../middleware/masterAdminAuth.js');
const { prisma } = require('../db.js');
const { createBar, getBarById, listBars, updateBar } = require('../services/barService.js');
const { buildBarUrls, getAppUrl } = require('../lib/barUrls.js');

const router = express.Router();

// ============================================================
// MASTER ADMIN / SUPER_ADMIN
// Se mantiene dentro de este router para evitar tocar la arquitectura
// de server.js mientras se integra de forma incremental.
// ============================================================

router.post('/master-admin/login', async (req, res) => {
  try {
    const result = await authenticateMasterAdmin({ email: req.body?.email, password: req.body?.password });
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
    if (typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ ok: false, error: 'El nombre del bar es obligatorio.' });
    }
    const bar = await createBar({ name, slug, displayName, welcomeMessage });
    res.status(201).json({ ok: true, data: { ...bar, urls: buildBarUrls(bar, req) } });
  } catch (error) {
    console.error('[MASTER_ADMIN] Error creando bar:', error);
    res.status(400).json({ ok: false, error: error.message || 'No se pudo crear el bar.' });
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

router.post('/bars/:slug/operator/login', async (req, res) => {
  try {
    const result = await authenticateOperator({ slug: req.params.slug, email: req.body?.email, password: req.body?.password });
    if (!result) return res.status(401).json({ ok: false, error: 'Credenciales inválidas.' });
    res.json({ ok: true, data: result });
  } catch (error) {
    console.error('[PUBLIC] Error iniciando sesión de operador:', error);
    res.status(500).json({ ok: false, error: 'No se pudo iniciar sesión.' });
  }
});

function obtenerBaseUrl(req) {
  return getAppUrl(req);
}

router.get('/bars/:slug', async (req, res) => {
  try {
    const bar = await getBarBySlug(req.params.slug);
    if (!bar) return res.status(404).json({ ok: false, error: 'Bar no encontrado' });
    res.json({
      ok: true,
      data: {
        id: bar.id,
        name: bar.name,
        slug: bar.slug,
        active: bar.active,
        settings: bar.settings ? {
          displayName: bar.settings.displayName,
          welcomeMessage: bar.settings.welcomeMessage,
          primaryColor: bar.settings.primaryColor,
          secondaryColor: bar.settings.secondaryColor,
          logoUrl: bar.settings.logoUrl
        } : null
      }
    });
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
    res.json({ ok: true, data: {
      status: status.status,
      plan: status.plan,
      puedeUsar: status.puedeUsar,
      diasRestantes: status.diasRestantes,
      fechaFin: status.fechaFin,
      trialEndsAt: status.trialEndsAt,
      expiresAt: status.expiresAt
    }});
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
    const png = await QRCode.toBuffer(clienteUrl, {
      type: 'png',
      width: 400,
      margin: 2,
      color: { dark: '#00f0ff', light: '#0a0a0f' }
    });
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
