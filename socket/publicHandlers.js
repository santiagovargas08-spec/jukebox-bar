'use strict';

const {
  obtenerBarIdAutorizado,
  emitBarIdRechazado
} = require('../lib/socketBar.js');

const {
  addToQueue
} = require('../services/queueService.js');

const { searchYoutube } = require('../services/youtubeSearchService.js');
const { canSearch } = require('../services/searchRequestPolicy.js');
const {
  canRequestSong,
  isBlockedSong
} = require('../services/songRequestPolicy.js');

const SEARCH_COOLDOWN_MS = 1500;

function registerPublicSocketHandlers({
  socket,
  clienteId,
  verificarLicenciaSocket,
  emitirEstadoSocket,
  emitirEstadoBar
}) {
  socket.on('seleccionar_bar', async (payload) => {
    try {
      const barId =
        payload && typeof payload === 'object'
          ? payload.barId
          : payload;

      const id = obtenerBarIdAutorizado(socket, barId);

      if (!id) {
        if (socket.data.operator) {
          socket.emit('error_autorizacion', {
            mensaje:
              'No puedes acceder a un bar distinto al de tu sesión.'
          });
          return;
        }

        socket.emit('error_bar', {
          mensaje: 'barId inválido.'
        });
        return;
      }

      const acceso = await verificarLicenciaSocket(
        socket,
        id
      );

      if (!acceso) return;

      if (socket.data.barId) {
        socket.leave(`bar:${socket.data.barId}`);
      }

      socket.data.barId = id;
      socket.join(`bar:${id}`);

      console.log(
        `[BAR] Cliente [${clienteId}] asociado al bar ${id} · Licencia: ${acceso.status}`
      );

      await emitirEstadoSocket(socket, id);
    } catch (error) {
      console.error('[BAR] Error seleccionando bar:', error);

      socket.emit('error_bar', {
        mensaje: 'No se pudo seleccionar el bar.'
      });
    }
  });

  socket.on('solicitar_estado', async (payload) => {
    try {
      const barId =
        payload && typeof payload === 'object'
          ? payload.barId
          : payload;

      const id = obtenerBarIdAutorizado(
        socket,
        barId
      );

      if (!id) {
        socket.emit('error_bar', {
          mensaje: 'Primero debes seleccionar un bar.'
        });
        return;
      }

      const acceso = await verificarLicenciaSocket(
        socket,
        id
      );

      if (!acceso) return;

      await emitirEstadoSocket(socket, id);
    } catch (error) {
      console.error('[ESTADO] Error:', error);
    }
  });

  socket.on('buscar_canciones', async (query) => {
    try {
      const id = obtenerBarIdAutorizado(
        socket,
        null
      );

      if (!id) {
        emitBarIdRechazado(socket, {
          evento: 'error_busqueda',
          mensaje: 'Primero debes seleccionar un bar.'
        });
        return;
      }

      const acceso = await verificarLicenciaSocket(
        socket,
        id
      );

      if (!acceso) return;

      if (!canSearch(socket, id)) {
        socket.emit('error_busqueda', {
          mensaje:
            'Se alcanzó temporalmente el límite de búsquedas. Intenta nuevamente en un minuto.'
        });
        return;
      }

      const texto = String(query || '').trim();

      if (!texto || texto.length > 120) {
        socket.emit('error_busqueda', {
          mensaje:
            'La búsqueda debe tener entre 1 y 120 caracteres.'
        });
        return;
      }

      const ahoraBusqueda = Date.now();

      if (
        socket.data.lastSearchAt &&
        ahoraBusqueda - socket.data.lastSearchAt <
          SEARCH_COOLDOWN_MS
      ) {
        socket.emit('error_busqueda', {
          mensaje:
            'Espera un momento antes de buscar de nuevo.'
        });
        return;
      }

      socket.data.lastSearchAt = ahoraBusqueda;

      const {
        videos,
        cached
      } = await searchYoutube(texto);

      console.log(
        `[BUSQUEDA] Bar ${id} · cliente ${clienteId} · cache=${cached} · resultados=${videos.length} · longitud=${texto.length}`
      );

      if (videos.length === 0) {
        socket.emit('error_busqueda', {
          mensaje:
            'No se pudieron obtener resultados de YouTube. Intenta nuevamente en unos segundos.'
        });
        return;
      }

      socket.emit('resultados_busqueda', {
        items: videos,
        query: texto
      });
    } catch (error) {
      console.error(
        '[BUSQUEDA] Error buscando canciones:',
        error
      );

      socket.emit('error_busqueda', {
        mensaje:
          'Error al buscar canciones. Intenta nuevamente.'
      });
    }
  });

  socket.on('agregar_cancion', async (payload) => {
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

      if (!id) {
        socket.emit('error_cancion', {
          mensaje: 'Primero debes seleccionar un bar.'
        });
        return;
      }

      const acceso = await verificarLicenciaSocket(
        socket,
        id
      );

      if (!acceso) return;

      if (!canRequestSong(socket, id)) {
        socket.emit('error_cancion', {
          mensaje:
            'Puedes solicitar hasta 3 canciones por minuto.'
        });
        return;
      }

      if (!cancion || !cancion.videoId) {
        socket.emit('error_cancion', {
          mensaje: 'Datos incompletos.'
        });
        return;
      }

      const titulo = String(
        cancion.title ||
        cancion.titulo ||
        ''
      ).trim();

      const nombre = String(
        cancion.name ||
        cancion.nombre ||
        'Cliente'
      ).trim();

      if (!titulo) {
        socket.emit('error_cancion', {
          mensaje: 'La canción no tiene título.'
        });
        return;
      }

      const song = {
        videoId: String(cancion.videoId).trim(),
        title: titulo,
        name: nombre,
        thumbnail: cancion.thumbnail || null
      };

      if (
        song.title.length > 100 ||
        song.name.length > 30
      ) {
        socket.emit('error_cancion', {
          mensaje:
            'El título o nombre es demasiado largo.'
        });
        return;
      }

      if (isBlockedSong(song)) {
        socket.emit('error_cancion', {
          mensaje:
            'Esta solicitud no está permitida por el bar.'
        });
        return;
      }

      const result = await addToQueue(
        id,
        song
      );

      if (!result.created) {
        socket.emit('error_cancion', {
          mensaje:
            `🎵 "${song.title}" ya está en la fila.`
        });
        return;
      }

      console.log(
        `[COLA] Bar ${id} → videoId=${result.item.videoId}`
      );

      socket.emit('cancion_confirmada', {
        titulo: result.item.title
      });

      await emitirEstadoBar(id);
    } catch (error) {
      if (error?.message === 'QUEUE_FULL') {
        socket.emit('error_cancion', {
          mensaje:
            'La cola está llena. Intenta más tarde.'
        });
        return;
      }

      console.error(
        '[COLA] Error agregando canción:',
        error
      );

      socket.emit('error_cancion', {
        mensaje: 'No se pudo agregar la canción.'
      });
    }
  });
}

module.exports = {
  registerPublicSocketHandlers,
  SEARCH_COOLDOWN_MS
};
