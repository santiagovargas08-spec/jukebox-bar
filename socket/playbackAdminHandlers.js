'use strict';

const {
  obtenerBarIdAutorizado,
  requireOperatorSocket
} = require('../lib/socketBar.js');

const {
  removeFromQueue,
  clearQueue,
  reorderQueue,
  MAX_QUEUE_PER_BAR
} = require('../services/queueService.js');

const {
  getHistory
} = require('../services/historyService.js');

const {
  advancePlayback,
  completeCurrentAndAdvance
} = require('../services/playbackService.js');

const { HISTORIAL_MAX } = require('../services/socketStateService.js');
const { logError, logInfo } = require('../lib/logger.js');
const { auditSocketAdminAction } = require('../lib/adminAudit.js');
const { allowOperatorAction } = require('../services/operatorActionPolicy.js');

function registerPlaybackAdminHandlers({
  socket,
  io,
  verificarLicenciaSocket,
  emitirEstadoBar
}) {
  function enforceOperatorActionLimit(
    id,
    {
      destructive = false,
      event = 'error_autorizacion'
    } = {}
  ) {
    if (
      allowOperatorAction(
        socket,
        id,
        { destructive }
      )
    ) {
      return true;
    }

    socket.emit(event, {
      mensaje:
        'Demasiadas acciones administrativas. Intenta nuevamente en un momento.'
    });

    return false;
  }
  async function reproducirSiguiente(id, logPrefix) {
    const result = await advancePlayback(id);

    if (!result) {
      io.to(`bar:${id}`).emit('cola_actualizada', {
        cola: [],
        reproduciendo: null
      });

      return;
    }

    const {
      item: siguiente,
      playback: reproduciendo
    } = result;

    logInfo('Reproduciendo siguiente canción', {
      event: 'playback_next',
      source: logPrefix,
      barId: id,
      videoId: siguiente.videoId
    });

    io.to(`bar:${id}`).emit(
      'nueva_reproduccion',
      reproduciendo
    );

    await emitirEstadoBar(id);
  }

  socket.on('siguiente_cancion', async (payload) => {
    try {
      const barId =
        payload && typeof payload === 'object'
          ? payload.barId
          : payload;

      const id = obtenerBarIdAutorizado(socket, barId);

      if (!id) {
        socket.emit('error_bar', {
          mensaje: 'Primero debes seleccionar un bar.'
        });
        return;
      }

      if (!requireOperatorSocket(socket, id)) return;
      if (!enforceOperatorActionLimit(id)) return;

      const acceso = await verificarLicenciaSocket(socket, id);
      if (!acceso) return;

      await reproducirSiguiente(id, 'REPRODUCCION');

      await auditSocketAdminAction({
        socket,
        action: 'playback.next',
        barId: id,
        entityType: 'playback'
      });
    } catch (error) {
      logError('[REPRODUCCION] Error:', { error: error?.message || String(error) });
    }
  });

  socket.on('admin_saltar', async (payload) => {
    try {
      const id = obtenerBarIdAutorizado(
        socket,
        payload?.barId
      );

      if (!id) {
        socket.emit('error_bar', {
          mensaje: 'Bar inválido.'
        });
        return;
      }

      if (!requireOperatorSocket(socket, id)) return;
      if (!enforceOperatorActionLimit(id)) return;

      const acceso = await verificarLicenciaSocket(socket, id);
      if (!acceso) return;

      await reproducirSiguiente(id, 'ADMIN');

      await auditSocketAdminAction({
        socket,
        action: 'playback.skip',
        barId: id,
        entityType: 'playback'
      });
    } catch (error) {
      logError('[ADMIN] Error saltando:', { error: error?.message || String(error) });
    }
  });

  socket.on('admin_eliminar_cancion', async (payload) => {
    try {
      const id = obtenerBarIdAutorizado(
        socket,
        payload?.barId
      );

      if (!id) {
        socket.emit('error_bar', {
          mensaje: 'Bar inválido.'
        });
        return;
      }

      if (!requireOperatorSocket(socket, id)) return;
      if (!enforceOperatorActionLimit(id)) return;

      const acceso = await verificarLicenciaSocket(socket, id);
      if (!acceso) return;

      const queueItemId = Number(payload?.id);

      if (
        !Number.isInteger(queueItemId) ||
        queueItemId <= 0
      ) {
        socket.emit('error_cola', {
          mensaje: 'Canción de cola inválida.'
        });
        return;
      }

      const eliminado = await removeFromQueue(
        id,
        queueItemId
      );

      logInfo('Canción eliminada por operador', {
        event: 'queue_song_removed',
        barId: id,
        queueItemId,
        removed: eliminado
      });

      if (eliminado) {
        await auditSocketAdminAction({
          socket,
          action: 'queue.remove',
          barId: id,
          entityType: 'queueItem',
          entityId: queueItemId
        });
      }

      await emitirEstadoBar(id);
    } catch (error) {
      logError('[ADMIN] Error eliminando:', { error: error?.message || String(error) });
    }
  });

  socket.on('admin_vaciar_cola', async (payload) => {
    try {
      const id = obtenerBarIdAutorizado(
        socket,
        payload?.barId
      );

      if (!id) {
        socket.emit('error_bar', {
          mensaje: 'Bar inválido.'
        });
        return;
      }

      if (!requireOperatorSocket(socket, id)) return;
      if (!enforceOperatorActionLimit(id, { destructive: true })) return;

      const acceso = await verificarLicenciaSocket(socket, id);
      if (!acceso) return;

      const cantidad = await clearQueue(id);

      logInfo('Cola vaciada por operador', {
        event: 'queue_cleared',
        barId: id,
        removedCount: cantidad
      });

      await auditSocketAdminAction({
        socket,
        action: 'queue.clear',
        barId: id,
        entityType: 'queue',
        details: {
          removedCount: cantidad
        }
      });

      await emitirEstadoBar(id);
    } catch (error) {
      logError('[ADMIN] Error vaciando:', { error: error?.message || String(error) });
    }
  });

  socket.on('reordenar_cola', async (payload) => {
    try {
      const id = obtenerBarIdAutorizado(
        socket,
        payload?.barId
      );

      if (!id) {
        socket.emit('error_cola', {
          mensaje: 'Primero debes seleccionar un bar.'
        });
        return;
      }

      if (!requireOperatorSocket(socket, id)) return;
      if (!enforceOperatorActionLimit(id, { event: 'error_cola' })) return;

      const acceso = await verificarLicenciaSocket(socket, id);
      if (!acceso) return;

      const orderedIds = Array.isArray(payload)
        ? payload
        : payload?.orderedIds;

      if (
        !Array.isArray(orderedIds) ||
        orderedIds.length === 0 ||
        orderedIds.length > MAX_QUEUE_PER_BAR ||
        orderedIds.some(
          (queueId) =>
            !Number.isInteger(Number(queueId)) ||
            Number(queueId) <= 0
        )
      ) {
        socket.emit('error_cola', {
          mensaje: 'Orden de cola inválido.'
        });
        return;
      }

      await reorderQueue(
        id,
        orderedIds.map(Number)
      );

      await auditSocketAdminAction({
        socket,
        action: 'queue.reorder',
        barId: id,
        entityType: 'queue',
        details: {
          itemCount: orderedIds.length
        }
      });

      await emitirEstadoBar(id);
    } catch (error) {
      logError('[COLA] Error reordenando:', { error: error?.message || String(error) });

      socket.emit('error_cola', {
        mensaje:
          error.message ||
          'No se pudo reordenar la cola.'
      });
    }
  });

  socket.on('cancion_terminada', async (payload) => {
    try {
      let barId;
      let cancion;

      if (payload && payload.cancion) {
        barId = payload.barId;
        cancion = payload.cancion;
      } else {
        barId = socket.data.barId;
        cancion = payload;
      }

      const id = obtenerBarIdAutorizado(
        socket,
        barId
      );

      if (!id || !cancion?.videoId) return;
      if (!requireOperatorSocket(socket, id)) return;
      if (!enforceOperatorActionLimit(id)) return;

      const acceso = await verificarLicenciaSocket(socket, id);
      if (!acceso) return;

      const videoId =
        String(cancion.videoId).trim();

      const result =
        await completeCurrentAndAdvance(
          id,
          videoId
        );

      if (!result.completed) {
        logInfo('Finalización de reproducción obsoleta ignorada', {
          event: 'playback_stale_completion_ignored',
          barId: id,
          videoId,
          reason: result.reason
        });
        return;
      }

      const historial = await getHistory(
        id,
        HISTORIAL_MAX
      );

      io.to(`bar:${id}`).emit(
        'historial_actualizado',
        {
          historialReproducidas: historial
        }
      );

      logInfo('Canción finalizada', {
        event: 'history_song_completed',
        barId: id,
        videoId: result.completedSong.videoId,
        historyCreated: result.historyCreated
      });

      if (result.playback) {
        logInfo('Reproduciendo siguiente canción', {
          event: 'playback_next',
          source: 'FIN_REPRODUCCION',
          barId: id,
          videoId: result.item.videoId
        });

        io.to(`bar:${id}`).emit(
          'nueva_reproduccion',
          result.playback
        );
      } else {
        io.to(`bar:${id}`).emit(
          'cola_actualizada',
          {
            cola: [],
            reproduciendo: null
          }
        );
      }

      await emitirEstadoBar(id);
    } catch (error) {
      logError('[HISTORIAL] Error:', {
        error: error?.message || String(error)
      });
    }
  });
}

module.exports = {
  registerPlaybackAdminHandlers
};
