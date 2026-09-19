'use strict';

const { normalizarBarId } = require('../lib/socketBar.js');
const { validarAccesoBar } = require('./barAccessService.js');
const { getQueue } = require('./queueService.js');
const { getHistory } = require('./historyService.js');
const { getPlaybackState } = require('./playbackService.js');

const HISTORIAL_MAX = 10;

function createSocketStateService(io) {
  function emitirErrorLicencia(socket, resultado) {
    socket.emit('acceso_bloqueado', {
      ok: false,
      reason: resultado?.reason || 'LICENSE_ERROR',
      mensaje:
        resultado?.message ||
        'El acceso a este bar no está disponible.'
    });
  }

  async function verificarLicenciaSocket(socket, barId) {
    const resultado = await validarAccesoBar(barId);

    if (!resultado.valid) {
      emitirErrorLicencia(socket, resultado);
      return null;
    }

    return resultado;
  }

  async function getEstadoBar(barId) {
    const id = normalizarBarId(barId);
    if (!id) return null;

    const acceso = await validarAccesoBar(id);

    if (!acceso.valid) {
      return {
        id,
        acceso,
        cola: null,
        historial: null,
        reproduciendo: null
      };
    }

    const [cola, historial, reproduciendo] = await Promise.all([
      getQueue(id),
      getHistory(id, HISTORIAL_MAX),
      getPlaybackState(id)
    ]);

    return {
      id,
      acceso,
      cola,
      historial,
      reproduciendo
    };
  }

  async function emitirEstadoBar(barId) {
    const estado = await getEstadoBar(barId);
    if (!estado) return;

    const {
      id,
      acceso,
      cola,
      historial,
      reproduciendo
    } = estado;

    if (!acceso.valid) {
      io.to(`bar:${id}`).emit('acceso_bloqueado', {
        ok: false,
        reason: acceso.reason,
        mensaje: acceso.message
      });
      return;
    }

    io.to(`bar:${id}`).emit('cola_actualizada', {
      cola,
      reproduciendo
    });

    io.to(`bar:${id}`).emit('historial_actualizado', {
      historialReproducidas: historial
    });
  }

  async function emitirEstadoSocket(socket, barId) {
    const estado = await getEstadoBar(barId);
    if (!estado) return;

    const {
      acceso,
      cola,
      historial,
      reproduciendo
    } = estado;

    if (!acceso.valid) {
      emitirErrorLicencia(socket, acceso);
      return;
    }

    socket.emit('estado_inicial', {
      cola,
      reproduciendo,
      historialReproducidas: historial,
      licencia: {
        status: acceso.status,
        trialEndsAt: acceso.bar.license?.trialEndsAt || null,
        expiresAt: acceso.bar.license?.expiresAt || null,
        plan: acceso.bar.license?.plan || null
      }
    });
  }

  return {
    emitirErrorLicencia,
    verificarLicenciaSocket,
    emitirEstadoBar,
    emitirEstadoSocket
  };
}

module.exports = {
  createSocketStateService,
  HISTORIAL_MAX
};
