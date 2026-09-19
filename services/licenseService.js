'use strict';

const { prisma } = require('../db.js');
const { acquireLicenseLock } = require('../lib/advisoryLocks.js');
const { logInfo } = require('../lib/logger.js');


// ============================================================
// CONFIGURACIÓN
// ============================================================

const TRIAL_DAYS = 14;

const PLAN_MONTHS = {
  MONTHLY: 1,
  QUARTERLY: 3
};

const MAX_PAYMENT_AMOUNT = 99999999.99;
const MAX_PAYMENT_NOTES_LENGTH = 1000;


// ============================================================
// UTILIDADES
// ============================================================

function calcularFinTrial(inicio) {
  const fin = new Date(inicio);

  fin.setDate(
    fin.getDate() + TRIAL_DAYS
  );

  return fin;
}


function calcularFinSuscripcion(inicio, plan) {
  const meses =
    PLAN_MONTHS[plan];

  if (!meses) {
    throw new Error(
      'Plan de suscripción inválido.'
    );
  }

  const fin =
    new Date(inicio);

  fin.setMonth(
    fin.getMonth() + meses
  );

  return fin;
}


function normalizarBarId(barId) {
  const id =
    Number(barId);

  if (
    !Number.isInteger(id) ||
    id <= 0
  ) {
    return null;
  }

  return id;
}


function normalizarPlan(plan) {
  if (
    plan === 'MONTHLY' ||
    plan === 'QUARTERLY'
  ) {
    return plan;
  }

  return null;
}


function normalizarMetodoPago(method) {
  if (
    method === 'CASH' ||
    method === 'TRANSFER'
  ) {
    return method;
  }

  return null;
}


function normalizarMonto(amount) {
  const numero =
    Number(amount);

  if (
    !Number.isFinite(numero) ||
    numero <= 0 ||
    numero > MAX_PAYMENT_AMOUNT
  ) {
    return null;
  }

  return numero;
}


// ============================================================
// OBTENER LICENCIA
// ============================================================

async function getLicenseByBarId(barId) {

  const id =
    normalizarBarId(barId);

  if (!id) {
    return null;
  }

  return prisma.license.findUnique({
    where: {
      barId: id
    },

    include: {
      bar: {
        include: {
          settings: true
        }
      },

      payments: {
        orderBy: {
          paidAt: 'desc'
        },
        take: 50
      }
    }
  });
}


// ============================================================
// CREAR LICENCIA DE PRUEBA
// ============================================================

async function createTrialLicense(barId) {

  const id =
    normalizarBarId(barId);

  if (!id) {
    throw new Error(
      'ID de bar inválido.'
    );
  }

  const trialStartedAt =
    new Date();

  const trialEndsAt =
    calcularFinTrial(
      trialStartedAt
    );

  try {
    return await prisma.license.create({
      data: {
        barId: id,

        status: 'TRIAL',

        trialStartedAt,

        trialEndsAt
      }
    });
  } catch (error) {
    if (error.code === 'P2002') {
      return prisma.license.findUnique({
        where: {
          barId: id
        }
      });
    }

    throw error;
  }
}


// ============================================================
// ACTUALIZAR ESTADO SEGÚN FECHAS
// ============================================================

async function refreshLicenseStatus(barId) {

  const id =
    normalizarBarId(barId);

  if (!id) {
    return null;
  }

  let license =
    await prisma.license.findUnique({
      where: {
        barId: id
      }
    });

  /*
   * Si el bar todavía no tiene licencia,
   * creamos automáticamente su periodo
   * de prueba.
   */

  if (!license) {

    license =
      await createTrialLicense(
        id
      );
  }


  const ahora =
    new Date();


  /*
   * LICENCIA ACTIVA
   *
   * Si está activa y ya pasó expiresAt,
   * pasa automáticamente a EXPIRED.
   */

  if (
    license.status === 'ACTIVE' &&
    license.expiresAt &&
    ahora >= license.expiresAt
  ) {
    // Actualización condicional: evita que una lectura obsoleta marque EXPIRED
    // una licencia que acaba de ser renovada concurrentemente.
    await prisma.license.updateMany({
      where: {
        id: license.id,
        status: 'ACTIVE',
        expiresAt: {
          lte: ahora
        }
      },
      data: {
        status: 'EXPIRED'
      }
    });

    license =
      await prisma.license.findUnique({
        where: {
          id: license.id
        }
      });
  }


  /*
   * PERIODO DE PRUEBA
   *
   * Si el trial terminó, pasa automáticamente
   * a EXPIRED.
   */

  else if (
    license.status === 'TRIAL' &&
    license.trialEndsAt &&
    ahora >= license.trialEndsAt
  ) {
    await prisma.license.updateMany({
      where: {
        id: license.id,
        status: 'TRIAL',
        trialEndsAt: {
          lte: ahora
        }
      },
      data: {
        status: 'EXPIRED'
      }
    });

    license =
      await prisma.license.findUnique({
        where: {
          id: license.id
        }
      });
  }


  return license;
}


// ============================================================
// COMPROBAR SI EL BAR PUEDE UTILIZAR EL SISTEMA
// ============================================================

function isLicenseRecordValid(
  license,
  now = new Date()
) {
  if (!license) {
    return false;
  }

  if (license.status === 'TRIAL') {
    return Boolean(
      license.trialEndsAt &&
      now < new Date(license.trialEndsAt)
    );
  }

  if (license.status === 'ACTIVE') {
    return Boolean(
      license.expiresAt &&
      now < new Date(license.expiresAt)
    );
  }

  return false;
}

async function isLicenseValid(barId) {
  const license =
    await refreshLicenseStatus(
      barId
    );

  return isLicenseRecordValid(
    license
  );
}


// ============================================================
// OBTENER INFORMACIÓN COMPLETA DE LICENCIA
// ============================================================

async function getLicenseStatus(barId) {

  const license =
    await refreshLicenseStatus(
      barId
    );

  if (!license) {
    return null;
  }


  const ahora =
    new Date();


  let diasRestantes =
    0;


  let fechaFin =
    null;


  if (
    license.status === 'TRIAL' &&
    license.trialEndsAt
  ) {

    fechaFin =
      license.trialEndsAt;

  } else if (
    license.status === 'ACTIVE' &&
    license.expiresAt
  ) {

    fechaFin =
      license.expiresAt;
  }


  if (fechaFin) {

    const diferencia =
      fechaFin.getTime() -
      ahora.getTime();

    diasRestantes =
      Math.max(
        0,
        Math.ceil(
          diferencia /
          (1000 * 60 * 60 * 24)
        )
      );
  }


  return {
    ...license,

    // Ya tenemos la licencia refrescada; reutilizar este registro evita
    // una segunda consulta/refresh redundante por cada lectura de estado.
    puedeUsar:
      isLicenseRecordValid(
        license,
        ahora
      ),

    diasRestantes,

    fechaFin
  };
}


// ============================================================
// ACTIVAR SUSCRIPCIÓN
// ============================================================

async function activateSubscription({
  barId,
  plan,
  amount,
  method,
  notes = null,
  reference = null,
  currency = 'USD',
  createdBy = null
}) {

  const id =
    normalizarBarId(barId);

  if (!id) {
    throw new Error(
      'ID de bar inválido.'
    );
  }


  const planNormalizado =
    normalizarPlan(plan);

  if (!planNormalizado) {
    throw new Error(
      'El plan debe ser MONTHLY o QUARTERLY.'
    );
  }


  const metodoNormalizado =
    normalizarMetodoPago(
      method
    );

  if (!metodoNormalizado) {
    throw new Error(
      'El método de pago debe ser CASH o TRANSFER.'
    );
  }


  const monto =
    normalizarMonto(amount);

  if (monto === null) {
    throw new Error(
      `El monto debe ser mayor que cero y no superar ${MAX_PAYMENT_AMOUNT}.`
    );
  }

  const currencyNormalizada =
    typeof currency === 'string'
      ? currency.trim().toUpperCase()
      : '';

  if (!/^[A-Z]{3}$/.test(currencyNormalizada)) {
    throw new Error(
      'La moneda debe usar un código ISO de 3 letras.'
    );
  }

  const notesNormalizadas =
    notes && String(notes).trim()
      ? String(notes).trim()
      : null;

  if (
    notesNormalizadas &&
    notesNormalizadas.length > MAX_PAYMENT_NOTES_LENGTH
  ) {
    throw new Error(
      `Las notas no pueden superar ${MAX_PAYMENT_NOTES_LENGTH} caracteres.`
    );
  }


  const bar =
    await prisma.bar.findUnique({
      where: {
        id
      },

      include: {
        license: true
      }
    });


  if (!bar) {
    throw new Error(
      'Bar no encontrado.'
    );
  }


  /*
   * Si por alguna razón el bar no tiene licencia,
   * creamos su licencia.
   */

  let license =
    bar.license;


  if (!license) {

    license =
      await createTrialLicense(
        id
      );
  }


  const ahora =
    new Date();


  /*
   * Registramos licencia y pago
   * dentro de una misma transacción.
   */

  const resultado =
    await prisma.$transaction(
      async (tx) => {
        await acquireLicenseLock(tx, id);

        const licenseActual = await tx.license.findUnique({
          where: { barId: id }
        });

        if (!licenseActual) {
          throw new Error('El bar no tiene licencia.');
        }

        let inicioSuscripcionTx = ahora;

        if (
          licenseActual.status === 'ACTIVE' &&
          licenseActual.expiresAt &&
          licenseActual.expiresAt > ahora
        ) {
          inicioSuscripcionTx = new Date(licenseActual.expiresAt);
        }

        const expiresAtTx = calcularFinSuscripcion(
          inicioSuscripcionTx,
          planNormalizado
        );

        const licenciaActualizada =
          await tx.license.update({
            where: {
              id: licenseActual.id
            },

            data: {

              status:
                'ACTIVE',

              plan:
                planNormalizado,

              startedAt:
                inicioSuscripcionTx,

              expiresAt: expiresAtTx
            }
          });


        const payment =
          await tx.payment.create({
            data: {

              barId:
                id,

              licenseId:
                licenciaActualizada.id,

              amount:
                monto,

              currency:
                currencyNormalizada,

              plan:
                planNormalizado,

              method:
                metodoNormalizado,

              reference:
                reference && String(reference).trim()
                  ? String(reference).trim().slice(0, 120)
                  : null,

              createdBy:
                createdBy && String(createdBy).trim()
                  ? String(createdBy).trim().slice(0, 120)
                  : null,

              paidAt:
                ahora,

              notes:
                notesNormalizadas
            }
          });


        return {
          license:
            licenciaActualizada,

          payment
        };
      }
    );


  logInfo('Suscripción activada', {
    event: 'license_activated',
    barId: id,
    plan: planNormalizado,
    expiresAt: resultado.license.expiresAt.toISOString(),
    paymentId: resultado.payment.id,
    method: metodoNormalizado,
    currency: currencyNormalizada
  });


  return resultado;
}


// ============================================================
// SUSPENDER LICENCIA
// ============================================================

async function suspendLicense(barId) {

  const id =
    normalizarBarId(barId);

  if (!id) {
    throw new Error(
      'ID de bar inválido.'
    );
  }


  return prisma.$transaction(async (tx) => {
    await acquireLicenseLock(tx, id);

    const license =
      await tx.license.findUnique({
        where: {
          barId: id
        }
      });

    if (!license) {
      throw new Error(
        'El bar no tiene licencia.'
      );
    }

    return tx.license.update({
      where: {
        id: license.id
      },
      data: {
        status: 'SUSPENDED'
      }
    });
  });
}


// ============================================================
// REACTIVAR LICENCIA
// ============================================================

async function reactivateLicense(barId) {

  const id =
    normalizarBarId(barId);

  if (!id) {
    throw new Error(
      'ID de bar inválido.'
    );
  }

  return prisma.$transaction(async (tx) => {
    await acquireLicenseLock(tx, id);

    const license =
      await tx.license.findUnique({
        where: {
          barId: id
        }
      });

    if (!license) {
      throw new Error(
        'El bar no tiene licencia.'
      );
    }

    if (
      license.status !== 'SUSPENDED'
    ) {
      return license;
    }

    const ahora =
      new Date();

    /*
     * Si la suscripción todavía tiene
     * fecha de vencimiento futura,
     * vuelve a ACTIVE.
     *
     * Si ya venció, pasa a EXPIRED.
     */

    const status =
      license.expiresAt &&
      license.expiresAt > ahora
        ? 'ACTIVE'
        : 'EXPIRED';

    return tx.license.update({
      where: {
        id: license.id
      },
      data: {
        status
      }
    });
  });
}


// ============================================================
// OBTENER HISTORIAL DE PAGOS
// ============================================================

async function getPaymentsByBarId(barId, limit = 100) {

  const id =
    normalizarBarId(barId);

  if (!id) {
    return [];
  }


  const safeLimit = Math.min(
    Math.max(Number(limit) || 100, 1),
    200
  );

  return prisma.payment.findMany({
    where: {
      barId: id
    },

    orderBy: {
      paidAt: 'desc'
    },

    take: safeLimit
  });
}


// ============================================================
// EXPORTACIONES
// ============================================================

module.exports = {

  TRIAL_DAYS,

  PLAN_MONTHS,

  calcularFinTrial,

  calcularFinSuscripcion,

  getLicenseByBarId,

  createTrialLicense,

  refreshLicenseStatus,

  isLicenseValid,

  isLicenseRecordValid,

  getLicenseStatus,

  activateSubscription,

  suspendLicense,

  reactivateLicense,

  getPaymentsByBarId

};