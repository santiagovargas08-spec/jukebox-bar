'use strict';

const {
  obtenerBarIdAutorizado,
  requireOperatorSocket
} = require('../lib/socketBar.js');

const {
  removeFromQueue,
  clearQueue,
  reorderQueue,
  takeNextFromQueue
} = require('../services/queueService.js');

const {
  addToHistory,
  getHistory
} = require('../services/historyService.js');

const {
  setNowPlaying,
  clearPlaybackState
} = require('../services/playbackService.js');

const { HISTORIAL_MAX } = require('../services/socketStateService.js');

function registerPlaybackAdminHandlers({
  socket,
  io,
  verificarLicenciaSocket,
  emitirEstadoBar
}) {
  async function reproducirSiguiente(id, logPrefix) {
    const siguiente = await takeNextFromQueue(id);

    if (!siguiente) {
      await clearPlaybackState(id);

      io.to(`bar:${id}`).emit('cola_actualizada', {
        cola: [],
        reproduciendo: null
      });

      return;
    }

    const reproduciendo = await setNowPlaying(id, siguiente);

    console.log(
      `[${logPrefix}] Bar ${id} → "${siguiente.title}"`
    );

    io.to(`bar:${id}`).emit(
      'nueva_reproduccion',
      reproduciendo || {
        id: siguiente.id,
        videoId: siguiente.videoId,
        titulo: siguiente.title,
        nombre: siguiente.name,
        thumbnail: siguiente.thumbnail
      }
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

      const acceso = await verificarLicenciaSocket(socket, id);
      if (!acceso) return;

      await reproducirSiguiente(id, 'REPRODUCCION');
    } catch (error) {
      console.error('[REPRODUCCION] Error:', error);
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

      const acceso = await verificarLicenciaSocket(socket, id);
      if (!acceso) return;

      await reproducirSiguiente(id, 'ADMIN');
    } catch (error) {
      console.error('[ADMIN] Error saltando:', error);
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

      const acceso = await verificarLicenciaSocket(socket, id);
      if (!acceso) return;

      const eliminado = await removeFromQueue(
        id,
        payload?.id
      );

      console.log(
        `[ADMIN] Bar ${id} → Eliminación ${payload?.id}: ${eliminado}`
      );

      await emitirEstadoBar(id);
    } catch (error) {
      console.error('[ADMIN] Error eliminando:', error);
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

      const acceso = await verificarLicenciaSocket(socket, id);
      if (!acceso) return;

      const cantidad = await clearQueue(id);

      console.log(
        `[ADMIN] Bar ${id} → Se eliminaron ${cantidad} canciones`
      );

      await emitirEstadoBar(id);
    } catch (error) {
      console.error('[ADMIN] Error vaciando:', error);
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

      const acceso = await verificarLicenciaSocket(socket, id);
      if (!acceso) return;

      const orderedIds = Array.isArray(payload)
        ? payload
        : payload?.orderedIds;

      if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
        socket.emit('error_cola', {
          mensaje: 'Orden de cola inválido.'
        });
        return;
      }

      await reorderQueue(id, orderedIds);
      await emitirEstadoBar(id);
    } catch (error) {
      console.error('[COLA] Error reordenando:', error);

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

      const acceso = await verificarLicenciaSocket(socket, id);
      if (!acceso) return;

      const song = {
        videoId: String(cancion.videoId).trim(),
        title: String(
          cancion.title ||
          cancion.titulo ||
          ''
        ).trim(),
        name: String(
          cancion.name ||
          cancion.nombre ||
          'Cliente'
        ).trim(),
        thumbnail: cancion.thumbnail || null
      };

      if (!song.title) return;

      const ultimo = await getHistory(id, 1);

      if (
        ultimo.length > 0 &&
        ultimo[0].videoId === song.videoId
      ) {
        console.log(
          `[HISTORIAL] Bar ${id} → duplicado ignorado`
        );
      } else {
        await addToHistory(id, song);
      }

      await clearPlaybackState(id);
      await emitirEstadoBar(id);

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

      console.log(
        `[HISTORIAL] Bar ${id} → "${song.title}"`
      );
    } catch (error) {
      console.error('[HISTORIAL] Error:', error);
    }
  });
}

module.exports = {
  registerPlaybackAdminHandlers
};
