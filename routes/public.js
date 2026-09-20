'use strict';

const express = require('express');
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
const { requireMasterAdmin, MASTER_ADMIN_COOKIE } = require('../middleware/masterAdminAuth.js');
const { requireOperatorHttp, OPERATOR_COOKIE } = require('../middleware/operatorAuth.js');
const { prisma } = require('../db.js');
const {
  createBar,
  getBarById,
  listBarsPage,
  updateBar,
  deleteBar
} = require('../services/barService.js');
const { buildBarUrls, getAppUrl } = require('../lib/barUrls.js');
const { requireTrustedOrigin } = require('../lib/originValidation.js');
const { getClientQrPng } = require('../services/qrService.js');
const { getMasterDashboardStats } = require('../services/masterDashboardService.js');
const { auditAdminAction, listAdminAuditLogs } = require('../lib/adminAudit.js');
const { logError } = require('../lib/logger.js');

const router = express.Router();

function noStore(req, res, next) {
  res.set('Cache-Control', 'no-store, max-age=0');
  res.set('Pragma', 'no-cache');
  next();
}

function masterAdminCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/api/public/master-admin',
    maxAge: 12 * 60 * 60 * 1000
  };
}

function operatorCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: 12 * 60 * 60 * 1000
  };
}

// ============================================================
// MASTER ADMIN / SUPER_ADMIN
// ============================================================

router.use('/master-admin', noStore, requireTrustedOrigin);

router.post('/master-admin/login', async (req, res) => {
  try {
    const result = await authenticateMasterAdmin({
      email: req.body?.email,
      password: req.body?.password,
      ip: req.ip
    });

    if (!result) {
      return res.status(401).json({
        ok: false,
        error: 'Credenciales inválidas.'
      });
    }

    res.cookie(
      MASTER_ADMIN_COOKIE,
      result.token,
      masterAdminCookieOptions()
    );

    await auditAdminAction({
      req: {
        id: req.id,
        masterAdmin: result.admin
      },
      action: 'session.master.login',
      entityType: 'masterAdmin',
      entityId: String(result.admin.id)
    });

    res.json({
      ok: true,
      data: {
        admin: result.admin,
        expiresAt: result.expiresAt
      }
    });
  } catch (error) {
    logError('[MASTER_ADMIN] Error iniciando sesión:', { requestId: req.id || null, error: error?.message || String(error) });
    res.status(500).json({ ok: false, error: 'No se pudo iniciar sesión.' });
  }
});

router.use('/master-admin', requireMasterAdmin);

router.get('/master-admin/me', (req, res) => {
  res.json({ ok: true, data: { ...req.masterAdmin, role: 'SUPER_ADMIN' } });
});

router.post('/master-admin/logout', async (req, res) => {
  try {
    await auditAdminAction({
      req,
      action: 'session.master.logout',
      entityType: 'masterAdmin',
      entityId: String(req.masterAdmin.id)
    });

    await revokeMasterAdminToken(req.masterAdmin.id);

    res.clearCookie(
      MASTER_ADMIN_COOKIE,
      {
        ...masterAdminCookieOptions(),
        maxAge: undefined
      }
    );

    res.json({ ok: true });
  } catch (error) {
    logError('[MASTER_ADMIN] Error cerrando sesión:', { requestId: req.id || null, error: error?.message || String(error) });
    res.status(500).json({ ok: false, error: 'No se pudo cerrar la sesión.' });
  }
});

router.get('/master-admin/dashboard', async (req, res) => {
  try {
    const stats = await getMasterDashboardStats();
    res.json({ ok: true, data: stats });
  } catch (error) {
    logError('[MASTER_ADMIN] Error obteniendo dashboard:', { requestId: req.id || null, error: error?.message || String(error) });
    res.status(500).json({ ok: false, error: 'No se pudo obtener el dashboard.' });
  }
});

router.get('/master-admin/audit', async (req, res) => {
  try {
    const page = await listAdminAuditLogs({
      limit: req.query.limit,
      offset: req.query.offset,
      barId: req.query.barId,
      action: req.query.action
    });

    res.json({
      ok: true,
      data: page
    });
  } catch (error) {
    logError('Error consultando auditoría administrativa', {
      event: 'admin_audit_list_error',
      requestId: req.id || null,
      error: error?.message || String(error)
    });

    res.status(500).json({
      ok: false,
      error: 'No se pudo obtener la auditoría.'
    });
  }
});

router.get('/master-admin/bars', async (req, res) => {
  try {
    const page = await listBarsPage({
      limit: req.query.limit,
      offset: req.query.offset
    });

    res.json({
      ok: true,
      data: {
        ...page,
        items: page.items.map((bar) => ({
          ...bar,
          urls: buildBarUrls(bar, req)
        }))
      }
    });
  } catch (error) {
    logError('[MASTER_ADMIN] Error listando bares:', { requestId: req.id || null, error: error?.message || String(error) });
    res.status(500).json({ ok: false, error: 'No se pudieron obtener los bares.' });
  }
});

router.get('/master-admin/bars/:id', async (req, res) => {
  try {
    const bar = await getBarById(req.params.id);
    if (!bar) return res.status(404).json({ ok: false, error: 'Bar no encontrado.' });
    res.json({ ok: true, data: { ...bar, urls: buildBarUrls(bar, req) } });
  } catch (error) {
    logError('[MASTER_ADMIN] Error obteniendo bar:', { requestId: req.id || null, error: error?.message || String(error) });
    res.status(500).json({ ok: false, error: 'No se pudo obtener el bar.' });
  }
});

router.post('/master-admin/bars', async (req, res) => {
  try {
    const {
      name,
      displayName,
      welcomeMessage,
      logoUrl,
      slug
    } = req.body || {};

    if (typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({
        ok: false,
        error: 'El nombre del bar es obligatorio.'
      });
    }

    const bar = await createBar({
      name,
      slug,
      displayName,
      welcomeMessage,
      logoUrl
    });

    await auditAdminAction({
      req,
      action: 'bar.create',
      barId: bar.id,
      entityType: 'bar',
      entityId: String(bar.id),
      details: { slug: bar.slug }
    });

    res.status(201).json({ ok: true, data: { ...bar, urls: buildBarUrls(bar, req) } });
  } catch (error) {
    logError('[MASTER_ADMIN] Error creando bar:', { requestId: req.id || null, error: error?.message || String(error) });
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

    await auditAdminAction({
      req,
      action: 'bar.admin.create',
      barId: bar.id,
      entityType: 'adminUser',
      entityId: String(admin.id),
      details: {
        email: admin.email,
        role: admin.role
      }
    });

    res.status(201).json({ ok: true, data: admin });
  } catch (error) {
    logError('[MASTER_ADMIN] Error creando administrador del bar:', { requestId: req.id || null, error: error?.message || String(error) });
    res.status(400).json({ ok: false, error: error.message || 'No se pudo crear el administrador.' });
  }
});

router.put('/master-admin/bars/:id', async (req, res) => {
  try {
    const bar = await updateBar(req.params.id, req.body || {});

    await auditAdminAction({
      req,
      action: 'bar.update',
      barId: bar.id,
      entityType: 'bar',
      entityId: String(bar.id),
      details: {
        fields: Object.keys(req.body || {})
      }
    });

    res.json({ ok: true, data: { ...bar, urls: buildBarUrls(bar, req) } });
  } catch (error) {
    logError('[MASTER_ADMIN] Error actualizando bar:', { requestId: req.id || null, error: error?.message || String(error) });
    res.status(error.code === 'P2025' ? 404 : 400).json({ ok: false, error: error.message || 'No se pudo actualizar el bar.' });
  }
});


router.delete('/master-admin/bars/:id', async (req, res) => {
  try {
    const bar =
      await getBarById(req.params.id);

    if (!bar) {
      return res.status(404).json({
        ok: false,
        error: 'Bar no encontrado.'
      });
    }

    // Se registra antes del borrado. AdminAuditLog no depende
    // de Bar y conserva la trazabilidad de la acción.
    await auditAdminAction({
      req,
      action: 'bar.delete',
      barId: bar.id,
      entityType: 'bar',
      entityId: String(bar.id),
      details: {
        name: bar.name,
        slug: bar.slug,
        users: bar._count?.users || 0,
        queue: bar._count?.queue || 0,
        history: bar._count?.history || 0,
        payments: bar._count?.payments || 0
      }
    });

    const deleted =
      await deleteBar(bar.id);

    res.json({
      ok: true,
      data: deleted
    });
  } catch (error) {
    logError('[MASTER_ADMIN] Error eliminando bar:', {
      requestId: req.id || null,
      error:
        error?.message ||
        String(error)
    });

    res.status(
      error?.code === 'P2025'
        ? 404
        : 400
    ).json({
      ok: false,
      error:
        error?.code === 'P2025'
          ? 'Bar no encontrado.'
          : error.message ||
            'No se pudo eliminar el bar.'
    });
  }
});

router.patch('/master-admin/bars/:id/active', async (req, res) => {
  try {
    if (typeof req.body?.active !== 'boolean') return res.status(400).json({ ok: false, error: 'active debe ser boolean.' });
    const bar = await updateBar(req.params.id, { active: req.body.active });

    await auditAdminAction({
      req,
      action: 'bar.active.update',
      barId: bar.id,
      entityType: 'bar',
      entityId: String(bar.id),
      details: { active: bar.active }
    });

    res.json({ ok: true, data: { ...bar, urls: buildBarUrls(bar, req) } });
  } catch (error) {
    logError('[MASTER_ADMIN] Error cambiando estado:', { requestId: req.id || null, error: error?.message || String(error) });
    res.status(error.code === 'P2025' ? 404 : 400).json({ ok: false, error: error.message || 'No se pudo cambiar el estado.' });
  }
});

router.get('/master-admin/bars/:id/license', async (req, res) => {
  try {
    const bar = await getBarById(req.params.id);
    if (!bar) return res.status(404).json({ ok: false, error: 'Bar no encontrado.' });
    res.json({ ok: true, data: await getLicenseStatus(bar.id) });
  } catch (error) {
    logError('[MASTER_ADMIN] Error obteniendo licencia:', { requestId: req.id || null, error: error?.message || String(error) });
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
      createdBy: req.masterAdmin.email,
      idempotencyKey:
        req.get('idempotency-key') || null
    });

    await auditAdminAction({
      req,
      action: 'license.activate',
      barId: bar.id,
      entityType: 'license',
      entityId: String(result.license?.id || result.id || ''),
      details: {
        plan,
        amount,
        method,
        currency,
        idempotent:
          Boolean(result.idempotent)
      }
    });

    if (result.idempotent) {
      res.set('Idempotency-Replayed', 'true');
    }

    res.json({ ok: true, data: result });
  } catch (error) {
    logError('[MASTER_ADMIN] Error activando suscripción:', { requestId: req.id || null, error: error?.message || String(error) });
    res.status(400).json({ ok: false, error: error.message || 'No se pudo activar la suscripción.' });
  }
});

router.post('/master-admin/bars/:id/license/suspend', async (req, res) => {
  try {
    const bar = await getBarById(req.params.id);
    if (!bar) return res.status(404).json({ ok: false, error: 'Bar no encontrado.' });
    const license = await suspendLicense(bar.id);

    await auditAdminAction({
      req,
      action: 'license.suspend',
      barId: bar.id,
      entityType: 'license',
      entityId: String(license.id)
    });

    res.json({ ok: true, data: license });
  } catch (error) {
    logError('[MASTER_ADMIN] Error suspendiendo licencia:', { requestId: req.id || null, error: error?.message || String(error) });
    res.status(400).json({ ok: false, error: error.message || 'No se pudo suspender la licencia.' });
  }
});

router.post('/master-admin/bars/:id/license/reactivate', async (req, res) => {
  try {
    const bar = await getBarById(req.params.id);
    if (!bar) return res.status(404).json({ ok: false, error: 'Bar no encontrado.' });
    const license = await reactivateLicense(bar.id);

    await auditAdminAction({
      req,
      action: 'license.reactivate',
      barId: bar.id,
      entityType: 'license',
      entityId: String(license.id)
    });

    res.json({ ok: true, data: license });
  } catch (error) {
    logError('[MASTER_ADMIN] Error reactivando licencia:', { requestId: req.id || null, error: error?.message || String(error) });
    res.status(400).json({ ok: false, error: error.message || 'No se pudo reactivar la licencia.' });
  }
});

router.get('/master-admin/bars/:id/payments', async (req, res) => {
  try {
    const bar = await getBarById(req.params.id);
    if (!bar) return res.status(404).json({ ok: false, error: 'Bar no encontrado.' });
    res.json({ ok: true, data: await getPaymentsByBarId(bar.id) });
  } catch (error) {
    logError('[MASTER_ADMIN] Error obteniendo pagos:', { requestId: req.id || null, error: error?.message || String(error) });
    res.status(500).json({ ok: false, error: 'No se pudieron obtener los pagos.' });
  }
});

router.get('/master-admin/bars/:id/urls', async (req, res) => {
  try {
    const bar = await getBarById(req.params.id);
    if (!bar) return res.status(404).json({ ok: false, error: 'Bar no encontrado.' });
    res.json({ ok: true, data: buildBarUrls(bar, req) });
  } catch (error) {
    logError('[MASTER_ADMIN] Error construyendo URLs:', { requestId: req.id || null, error: error?.message || String(error) });
    res.status(500).json({ ok: false, error: 'No se pudieron construir las URLs.' });
  }
});

// ============================================================
// OPERADORES DEL BAR
// ============================================================

router.post('/bars/:slug/operator/login', noStore, requireTrustedOrigin, async (req, res) => {
  try {
    const result = await authenticateOperator({
      slug: req.params.slug,
      email: req.body?.email,
      password: req.body?.password,
      ip: req.ip
    });

    if (!result) {
      return res.status(401).json({
        ok: false,
        error: 'Credenciales inválidas.'
      });
    }

    res.cookie(
      OPERATOR_COOKIE,
      result.token,
      operatorCookieOptions()
    );

    await auditAdminAction({
      req: {
        id: req.id,
        operator: result.admin
      },
      action: 'session.operator.login',
      barId: result.admin.barId,
      entityType: 'adminUser',
      entityId: String(result.admin.id)
    });

    res.json({
      ok: true,
      data: {
        admin: result.admin,
        expiresAt: result.expiresAt
      }
    });
  } catch (error) {
    logError('[PUBLIC] Error iniciando sesión de operador:', { requestId: req.id || null, error: error?.message || String(error) });
    res.status(500).json({
      ok: false,
      error: 'No se pudo iniciar sesión.'
    });
  }
});

router.get('/bars/:slug/operator/session', noStore, requireOperatorHttp, async (req, res) => {
  try {
    const bar = await getBarBySlug(req.params.slug);

    if (!bar || bar.id !== req.operator.barId) {
      return res.status(403).json({
        ok: false,
        error: 'La sesión no corresponde a este bar.'
      });
    }

    res.json({
      ok: true,
      data: {
        id: req.operator.id,
        barId: req.operator.barId,
        email: req.operator.email,
        displayName: req.operator.displayName,
        role: req.operator.role
      }
    });
  } catch (error) {
    logError('[PUBLIC] Error consultando sesión de operador:', { requestId: req.id || null, error: error?.message || String(error) });
    res.status(500).json({
      ok: false,
      error: 'No se pudo validar la sesión.'
    });
  }
});

router.post('/bars/:slug/operator/logout', noStore, requireTrustedOrigin, requireOperatorHttp, async (req, res) => {
  try {
    const bar = await getBarBySlug(req.params.slug);

    if (!bar || bar.id !== req.operator.barId) {
      return res.status(403).json({
        ok: false,
        error: 'La sesión no corresponde a este bar.'
      });
    }

    await auditAdminAction({
      req,
      action: 'session.operator.logout',
      barId: req.operator.barId,
      entityType: 'adminUser',
      entityId: String(req.operator.id)
    });

    await revokeOperatorTokens(req.operator.id);

    res.clearCookie(
      OPERATOR_COOKIE,
      {
        ...operatorCookieOptions(),
        maxAge: undefined
      }
    );

    res.json({ ok: true });
  } catch (error) {
    logError('[PUBLIC] Error cerrando sesión de operador:', { requestId: req.id || null, error: error?.message || String(error) });
    res.status(500).json({ ok: false, error: 'No se pudo cerrar la sesión.' });
  }
});

function obtenerBaseUrl(req) { return getAppUrl(req); }

router.get('/bars/:slug', async (req, res) => {
  try {
    const bar = await getBarBySlug(req.params.slug);
    if (!bar) return res.status(404).json({ ok: false, error: 'Bar no encontrado' });
    res.json({
      ok: true,
      data: {
        name: bar.name,
        slug: bar.slug,
        active: bar.active,
        settings: bar.settings
          ? {
              displayName: bar.settings.displayName,
              welcomeMessage: bar.settings.welcomeMessage,
              primaryColor: bar.settings.primaryColor,
              secondaryColor: bar.settings.secondaryColor,
              logoUrl: bar.settings.logoUrl
            }
          : null
      }
    });
  } catch (error) {
    logError('[PUBLIC] Error obteniendo bar:', { requestId: req.id || null, error: error?.message || String(error) });
    res.status(500).json({ ok: false, error: 'No se pudo obtener el bar' });
  }
});

router.get('/bars/:slug/license/status', async (req, res) => {
  try {
    const bar = await getBarBySlug(req.params.slug);
    if (!bar) return res.status(404).json({ ok: false, error: 'Bar no encontrado' });
    const status = await getLicenseStatus(bar.id);
    if (!status) return res.status(404).json({ ok: false, error: 'No se pudo obtener el estado de la licencia' });
    res.json({
      ok: true,
      data: {
        status: status.status,
        puedeUsar: status.puedeUsar
      }
    });
  } catch (error) {
    logError('[PUBLIC] Error obteniendo licencia:', { requestId: req.id || null, error: error?.message || String(error) });
    res.status(500).json({ ok: false, error: 'No se pudo obtener el estado de la licencia' });
  }
});

router.get('/bars/:slug/qr', async (req, res) => {
  try {
    const bar = await getBarBySlug(req.params.slug);
    if (!bar) return res.status(404).json({ ok: false, error: 'Bar no encontrado' });
    const clienteUrl = buildBarUrls(bar, req).cliente;
    const { buffer } = await getClientQrPng(clienteUrl);
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(buffer);
  } catch (error) {
    logError('[PUBLIC] Error generando QR:', { requestId: req.id || null, error: error?.message || String(error) });
    res.status(500).json({ ok: false, error: 'No se pudo generar el QR' });
  }
});

router.get('/bars/:slug/urls', async (req, res) => {
  try {
    const bar = await getBarBySlug(req.params.slug);
    if (!bar) return res.status(404).json({ ok: false, error: 'Bar no encontrado' });
    res.json({ ok: true, data: buildBarUrls(bar, req) });
  } catch (error) {
    logError('[PUBLIC] Error obteniendo URLs:', { requestId: req.id || null, error: error?.message || String(error) });
    res.status(500).json({ ok: false, error: 'No se pudieron obtener las URLs' });
  }
});

module.exports = router;
