'use strict';

const express = require('express');
const QRCode = require('qrcode');

const { getBarBySlug } = require('../services/barService.js');
const { getLicenseStatus } = require('../services/licenseService.js');
const { authenticateOperator } = require('../services/operatorAuthService.js');

const router = express.Router();

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
  if (process.env.APP_URL) {
    return process.env.APP_URL.replace(/\/$/, '');
  }

  const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
  const host = req.headers['x-forwarded-host'] || req.get('host');

  return `${protocol}://${host}`;
}

router.get('/bars/:slug', async (req, res) => {
  try {
    const bar = await getBarBySlug(req.params.slug);

    if (!bar) {
      return res.status(404).json({
        ok: false,
        error: 'Bar no encontrado'
      });
    }

    res.json({
      ok: true,
      data: {
        id: bar.id,
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
    console.error('[PUBLIC] Error obteniendo bar:', error);

    res.status(500).json({
      ok: false,
      error: 'No se pudo obtener el bar'
    });
  }
});

router.get('/bars/:slug/license/status', async (req, res) => {
  try {
    const bar = await getBarBySlug(req.params.slug);

    if (!bar) {
      return res.status(404).json({
        ok: false,
        error: 'Bar no encontrado'
      });
    }

    const status = await getLicenseStatus(bar.id);

    if (!status) {
      return res.status(404).json({
        ok: false,
        error: 'No se pudo obtener el estado de la licencia'
      });
    }

    res.json({
      ok: true,
      data: {
        status: status.status,
        plan: status.plan,
        puedeUsar: status.puedeUsar,
        diasRestantes: status.diasRestantes,
        fechaFin: status.fechaFin,
        trialEndsAt: status.trialEndsAt,
        expiresAt: status.expiresAt
      }
    });
  } catch (error) {
    console.error('[PUBLIC] Error obteniendo licencia:', error);

    res.status(500).json({
      ok: false,
      error: 'No se pudo obtener el estado de la licencia'
    });
  }
});

router.get('/bars/:slug/qr', async (req, res) => {
  try {
    const bar = await getBarBySlug(req.params.slug);

    if (!bar) {
      return res.status(404).json({
        ok: false,
        error: 'Bar no encontrado'
      });
    }

    const baseUrl = obtenerBaseUrl(req);
    const clienteUrl = `${baseUrl}/cliente.html?bar=${encodeURIComponent(bar.slug)}`;

    const png = await QRCode.toBuffer(clienteUrl, {
      type: 'png',
      width: 400,
      margin: 2,
      color: {
        dark: '#00f0ff',
        light: '#0a0a0f'
      }
    });

    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(png);
  } catch (error) {
    console.error('[PUBLIC] Error generando QR:', error);

    res.status(500).json({
      ok: false,
      error: 'No se pudo generar el QR'
    });
  }
});

router.get('/bars/:slug/urls', async (req, res) => {
  try {
    const bar = await getBarBySlug(req.params.slug);

    if (!bar) {
      return res.status(404).json({
        ok: false,
        error: 'Bar no encontrado'
      });
    }

    const baseUrl = obtenerBaseUrl(req);
    const slug = encodeURIComponent(bar.slug);

    res.json({
      ok: true,
      data: {
        cliente: `${baseUrl}/cliente.html?bar=${slug}`,
        bar: `${baseUrl}/bar.html?bar=${slug}`,
        admin: `${baseUrl}/admin.html?bar=${slug}`,
        qr: `${baseUrl}/api/public/bars/${slug}/qr`
      }
    });
  } catch (error) {
    console.error('[PUBLIC] Error obteniendo URLs:', error);

    res.status(500).json({
      ok: false,
      error: 'No se pudieron obtener las URLs'
    });
  }
});

module.exports = router;
