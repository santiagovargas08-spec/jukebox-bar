'use strict';

const { normalizarBarId } = require('../lib/socketBar.js');
const { getBarAccessRecord } = require('./barService.js');
const {
  refreshLicenseStatus,
  isLicenseRecordValid
} = require('./licenseService.js');
const { logError } = require('../lib/logger.js');

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
    const bar = await getBarAccessRecord(id);

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

    let license = bar.license;

    const now = new Date();
    const needsRefresh =
      !license ||
      (
        license.status === 'TRIAL' &&
        license.trialEndsAt &&
        now >= new Date(license.trialEndsAt)
      ) ||
      (
        license.status === 'ACTIVE' &&
        license.expiresAt &&
        now >= new Date(license.expiresAt)
      );

    if (needsRefresh) {
      license = await refreshLicenseStatus(id);
    }

    if (!license) {
      return {
        valid: false,
        reason: 'NO_LICENSE',
        message: 'Este bar no tiene una licencia configurada.',
        bar
      };
    }

    if (!isLicenseRecordValid(license, now)) {
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
    logError('Error comprobando acceso del bar', {
      event: 'bar_access_error',
      barId: id,
      error: error?.message || String(error)
    });

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
