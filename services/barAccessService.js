'use strict';

const { normalizarBarId } = require('../lib/socketBar.js');
const { getBarById } = require('./barService.js');
const {
  refreshLicenseStatus,
  isLicenseValid
} = require('./licenseService.js');

async function validarAccesoBar(barId) {
  const id = normalizarBarId(barId);

  if (!id) {
    return {
      valid: false,
      reason: 'INVALID_BAR',
      message: 'Bar inválido.'
    };
  }

  try {
    const bar = await getBarById(id);

    if (!bar) {
      return {
        valid: false,
        reason: 'BAR_NOT_FOUND',
        message: 'El bar no existe.'
      };
    }

    if (!bar.active) {
      return {
        valid: false,
        reason: 'BAR_INACTIVE',
        message: 'Este bar está desactivado.'
      };
    }

    const license = await refreshLicenseStatus(id);

    if (!license) {
      return {
        valid: false,
        reason: 'NO_LICENSE',
        message: 'Este bar no tiene una licencia configurada.',
        bar
      };
    }

    const puedeUsar = await isLicenseValid(id);

    if (!puedeUsar) {
      let reason = 'INVALID_LICENSE';
      let message = 'La licencia de este bar no es válida.';

      if (license.status === 'EXPIRED') {
        reason = 'EXPIRED';
        message = 'La licencia de este bar ha expirado.';
      } else if (license.status === 'SUSPENDED') {
        reason = 'SUSPENDED';
        message = 'La licencia de este bar está suspendida.';
      }

      return {
        valid: false,
        reason,
        message,
        bar,
        license
      };
    }

    return {
      valid: true,
      status: license.status,
      bar: {
        ...bar,
        license
      },
      license
    };
  } catch (error) {
    console.error('[LICENCIA] Error comprobando acceso:', error);

    return {
      valid: false,
      reason: 'LICENSE_CHECK_ERROR',
      message: 'No se pudo comprobar la licencia del bar.'
    };
  }
}

module.exports = {
  validarAccesoBar
};
