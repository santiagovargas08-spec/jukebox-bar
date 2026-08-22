'use strict';

const express = require('express');
const { prisma } = require('../db.js');
const { requireMasterAdmin } = require('../middleware/masterAdminAuth.js');
const { authenticateMasterAdmin } = require('../services/masterAdminAuthService.js');
const { createBar, getBarById, listBars, updateBar } = require('../services/barService.js');
const { getLicenseStatus } = require('../services/licenseService.js');
const { buildBarUrls } = require('../lib/barUrls.js');

const router = express.Router();

router.post('/login', async (req, res) => {
  try {
    const result = await authenticateMasterAdmin({ email: req.body?.email, password: req.body?.password });
    if (!result) return res.status(401).json({ ok: false, error: 'Credenciales inválidas.' });
    res.json({ ok: true, data: result });
  } catch (error) {
    console.error('[MASTER_ADMIN] Error iniciando sesión:', error);
    res.status(500).json({ ok: false, error: 'No se pudo iniciar sesión.' });
  }
});

router.use(requireMasterAdmin);

router.get('/me', (req, res) => {
  res.json({ ok: true, data: { ...req.masterAdmin, role: 'SUPER_ADMIN' } });
});

router.get('/dashboard', async (req, res) => {
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

router.get('/bars', async (req, res) => {
  try {
    const bars = await listBars();
    res.json({
      ok: true,
      data: bars.map((bar) => ({ ...bar, urls: buildBarUrls(bar, req) }))
    });
  } catch (error) {
    console.error('[MASTER_ADMIN] Error listando bares:', error);
    res.status(500).json({ ok: false, error: 'No se pudieron obtener los bares.' });
  }
});

router.get('/bars/:id', async (req, res) => {
  try {
    const bar = await getBarById(req.params.id);
    if (!bar) return res.status(404).json({ ok: false, error: 'Bar no encontrado.' });
    res.json({ ok: true, data: { ...bar, urls: buildBarUrls(bar, req) } });
  } catch (error) {
    console.error('[MASTER_ADMIN] Error obteniendo bar:', error);
    res.status(500).json({ ok: false, error: 'No se pudo obtener el bar.' });
  }
});

router.post('/bars', async (req, res) => {
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

router.put('/bars/:id', async (req, res) => {
  try {
    const bar = await updateBar(req.params.id, req.body || {});
    res.json({ ok: true, data: { ...bar, urls: buildBarUrls(bar, req) } });
  } catch (error) {
    console.error('[MASTER_ADMIN] Error actualizando bar:', error);
    const status = error.code === 'P2025' ? 404 : 400;
    res.status(status).json({ ok: false, error: error.message || 'No se pudo actualizar el bar.' });
  }
});

router.patch('/bars/:id/active', async (req, res) => {
  try {
    if (typeof req.body?.active !== 'boolean') {
      return res.status(400).json({ ok: false, error: 'active debe ser boolean.' });
    }
    const bar = await updateBar(req.params.id, { active: req.body.active });
    res.json({ ok: true, data: { ...bar, urls: buildBarUrls(bar, req) } });
  } catch (error) {
    console.error('[MASTER_ADMIN] Error cambiando estado:', error);
    const status = error.code === 'P2025' ? 404 : 400;
    res.status(status).json({ ok: false, error: error.message || 'No se pudo cambiar el estado.' });
  }
});

router.get('/bars/:id/license', async (req, res) => {
  try {
    const bar = await getBarById(req.params.id);
    if (!bar) return res.status(404).json({ ok: false, error: 'Bar no encontrado.' });
    const status = await getLicenseStatus(bar.id);
    res.json({ ok: true, data: status });
  } catch (error) {
    console.error('[MASTER_ADMIN] Error obteniendo licencia:', error);
    res.status(500).json({ ok: false, error: 'No se pudo obtener la licencia.' });
  }
});

router.get('/bars/:id/urls', async (req, res) => {
  try {
    const bar = await getBarById(req.params.id);
    if (!bar) return res.status(404).json({ ok: false, error: 'Bar no encontrado.' });
    res.json({ ok: true, data: buildBarUrls(bar, req) });
  } catch (error) {
    console.error('[MASTER_ADMIN] Error construyendo URLs:', error);
    res.status(500).json({ ok: false, error: 'No se pudieron construir las URLs.' });
  }
});

module.exports = router;
