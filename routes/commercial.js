'use strict';

const express = require('express');

const { requireAdminKey } = require('../middleware/auth.js');

const {
  createBar,
  getBarById,
  getBarBySlug,
  listBars,
  updateBar
} = require('../services/barService.js');

const {
  getLicenseByBarId,
  getLicenseStatus,
  activateSubscription,
  suspendLicense,
  reactivateLicense,
  getPaymentsByBarId
} = require('../services/licenseService.js');

const {
  getQueue,
  addToQueue,
  removeFromQueue,
  clearQueue
} = require('../services/queueService.js');

const {
  getHistory,
  addToHistory,
  clearHistory
} = require('../services/historyService.js');
const { createAdminUser } = require('../services/operatorAuthService.js');

const router = express.Router();

router.use(requireAdminKey);


// ============================================================
// BARES
// ============================================================

router.get('/bars/by-slug/:slug', async (req, res) => {
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
      data: bar
    });
  } catch (error) {
    console.error('[COMMERCIAL] Error obteniendo bar por slug:', error);

    res.status(500).json({
      ok: false,
      error: 'No se pudo obtener el bar'
    });
  }
});

router.get('/bars', async (req, res) => {
  try {
    const bars = await listBars();

    res.json({
      ok: true,
      data: bars
    });
  } catch (error) {
    console.error('[COMMERCIAL] Error listando bares:', error);

    res.status(500).json({
      ok: false,
      error: 'No se pudieron obtener los bares'
    });
  }
});


router.get('/bars/:id', async (req, res) => {
  try {
    const bar = await getBarById(req.params.id);

    if (!bar) {
      return res.status(404).json({
        ok: false,
        error: 'Bar no encontrado'
      });
    }

    res.json({
      ok: true,
      data: bar
    });
  } catch (error) {
    console.error('[COMMERCIAL] Error obteniendo bar:', error);

    res.status(500).json({
      ok: false,
      error: 'No se pudo obtener el bar'
    });
  }
});


router.post('/bars', async (req, res) => {
  try {
    const {
      name,
      slug,
      displayName,
      welcomeMessage
    } = req.body;

    if (!name || !slug) {
      return res.status(400).json({
        ok: false,
        error: 'name y slug son obligatorios'
      });
    }

    const bar = await createBar({
      name,
      slug,
      displayName,
      welcomeMessage
    });

    res.status(201).json({
      ok: true,
      data: bar
    });
  } catch (error) {
    console.error('[COMMERCIAL] Error creando bar:', error);

    res.status(500).json({
      ok: false,
      error: 'No se pudo crear el bar'
    });
  }
});


router.put('/bars/:id', async (req, res) => {
  try {
    const bar = await updateBar(
      req.params.id,
      req.body
    );

    res.json({
      ok: true,
      data: bar
    });
  } catch (error) {
    console.error('[COMMERCIAL] Error actualizando bar:', error);

    res.status(500).json({
      ok: false,
      error: 'No se pudo actualizar el bar'
    });
  }
});

router.post('/bars/:id/admins', async (req, res) => {
  try {
    const admin = await createAdminUser({ barId: req.params.id, ...req.body });
    res.status(201).json({ ok: true, data: admin });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message || 'No se pudo crear el administrador.' });
  }
});


// ============================================================
// LICENCIAS
// ============================================================

router.get('/bars/:id/license', async (req, res) => {
  try {
    const license = await getLicenseByBarId(
      req.params.id
    );

    if (!license) {
      return res.status(404).json({
        ok: false,
        error: 'El bar no tiene licencia'
      });
    }

    res.json({
      ok: true,
      data: license
    });
  } catch (error) {
    console.error(
      '[LICENSE] Error obteniendo licencia:',
      error
    );

    res.status(500).json({
      ok: false,
      error: 'No se pudo obtener la licencia'
    });
  }
});


router.get(
  '/bars/:id/license/status',
  async (req, res) => {
    try {
      const status = await getLicenseStatus(
        req.params.id
      );

      if (!status) {
        return res.status(404).json({
          ok: false,
          error: 'No se pudo obtener el estado de la licencia'
        });
      }

      res.json({
        ok: true,
        data: status
      });
    } catch (error) {
      console.error(
        '[LICENSE] Error obteniendo estado:',
        error
      );

      res.status(500).json({
        ok: false,
        error: 'No se pudo obtener el estado de la licencia'
      });
    }
  }
);


router.post(
  '/bars/:id/license/activate',
  async (req, res) => {
    try {
      const {
        plan,
        amount,
        method,
        notes
      } = req.body;

      const resultado =
        await activateSubscription({
          barId: req.params.id,
          plan,
          amount,
          method,
          notes
        });

      res.json({
        ok: true,
        mensaje: 'Suscripción activada correctamente',
        data: resultado
      });
    } catch (error) {
      console.error(
        '[LICENSE] Error activando suscripción:',
        error
      );

      res.status(400).json({
        ok: false,
        error:
          error.message ||
          'No se pudo activar la suscripción'
      });
    }
  }
);


router.post(
  '/bars/:id/license/suspend',
  async (req, res) => {
    try {
      const license =
        await suspendLicense(
          req.params.id
        );

      res.json({
        ok: true,
        mensaje: 'Licencia suspendida correctamente',
        data: license
      });
    } catch (error) {
      console.error(
        '[LICENSE] Error suspendiendo licencia:',
        error
      );

      res.status(400).json({
        ok: false,
        error:
          error.message ||
          'No se pudo suspender la licencia'
      });
    }
  }
);


router.post(
  '/bars/:id/license/reactivate',
  async (req, res) => {
    try {
      const license =
        await reactivateLicense(
          req.params.id
        );

      res.json({
        ok: true,
        mensaje: 'Licencia procesada correctamente',
        data: license
      });
    } catch (error) {
      console.error(
        '[LICENSE] Error reactivando licencia:',
        error
      );

      res.status(400).json({
        ok: false,
        error:
          error.message ||
          'No se pudo reactivar la licencia'
      });
    }
  }
);


router.get(
  '/bars/:id/payments',
  async (req, res) => {
    try {
      const payments =
        await getPaymentsByBarId(
          req.params.id
        );

      res.json({
        ok: true,
        data: payments
      });
    } catch (error) {
      console.error(
        '[PAYMENT] Error obteniendo pagos:',
        error
      );

      res.status(500).json({
        ok: false,
        error: 'No se pudieron obtener los pagos'
      });
    }
  }
);


// ============================================================
// COLA
// ============================================================

router.get(
  '/bars/:id/queue',
  async (req, res) => {
    try {
      const queue =
        await getQueue(
          req.params.id
        );

      res.json({
        ok: true,
        data: queue
      });
    } catch (error) {
      console.error(
        '[QUEUE] Error obteniendo cola:',
        error
      );

      res.status(500).json({
        ok: false,
        error: 'No se pudo obtener la cola'
      });
    }
  }
);


router.post(
  '/bars/:id/queue',
  async (req, res) => {
    try {
      const result =
        await addToQueue(
          req.params.id,
          req.body
        );

      res.status(
        result.created ? 201 : 200
      ).json({
        ok: true,
        created: result.created,
        data: result.item
      });
    } catch (error) {
      console.error(
        '[QUEUE] Error agregando canción:',
        error
      );

      res.status(400).json({
        ok: false,
        error: error.message
      });
    }
  }
);


router.delete(
  '/bars/:id/queue/:itemId',
  async (req, res) => {
    try {
      const removed =
        await removeFromQueue(
          req.params.id,
          req.params.itemId
        );

      if (!removed) {
        return res.status(404).json({
          ok: false,
          error: 'Canción no encontrada en la cola'
        });
      }

      res.json({
        ok: true
      });
    } catch (error) {
      console.error(
        '[QUEUE] Error eliminando canción:',
        error
      );

      res.status(400).json({
        ok: false,
        error: error.message
      });
    }
  }
);


router.delete(
  '/bars/:id/queue',
  async (req, res) => {
    try {
      const deleted =
        await clearQueue(
          req.params.id
        );

      res.json({
        ok: true,
        deleted
      });
    } catch (error) {
      console.error(
        '[QUEUE] Error vaciando cola:',
        error
      );

      res.status(400).json({
        ok: false,
        error: error.message
      });
    }
  }
);


// ============================================================
// HISTORIAL
// ============================================================

router.get(
  '/bars/:id/history',
  async (req, res) => {
    try {
      const history =
        await getHistory(
          req.params.id,
          req.query.limit
        );

      res.json({
        ok: true,
        data: history
      });
    } catch (error) {
      console.error(
        '[HISTORY] Error obteniendo historial:',
        error
      );

      res.status(500).json({
        ok: false,
        error: 'No se pudo obtener el historial'
      });
    }
  }
);


router.post(
  '/bars/:id/history',
  async (req, res) => {
    try {
      const item =
        await addToHistory(
          req.params.id,
          req.body
        );

      res.status(201).json({
        ok: true,
        data: item
      });
    } catch (error) {
      console.error(
        '[HISTORY] Error agregando historial:',
        error
      );

      res.status(400).json({
        ok: false,
        error: error.message
      });
    }
  }
);


router.delete(
  '/bars/:id/history',
  async (req, res) => {
    try {
      const deleted =
        await clearHistory(
          req.params.id
        );

      res.json({
        ok: true,
        deleted
      });
    } catch (error) {
      console.error(
        '[HISTORY] Error eliminando historial:',
        error
      );

      res.status(400).json({
        ok: false,
        error: error.message
      });
    }
  }
);


// ============================================================
// EXPORTAR
// ============================================================

module.exports = router;
