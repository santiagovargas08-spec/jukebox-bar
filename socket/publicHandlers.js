'use strict';

const {
  obtenerBarIdAutorizado,
  emitBarIdRechazado
} = require('../lib/socketBar.js');

const {
  addToQueue
} = require('../services/queueService.js');

const {
  startPlaybackIfIdle
} = require('../services/playbackService.js');

const { getBarBySlug } = require('../services/barService.js');

const { searchYoutube } = require('../services/youtubeSearchService.js');
const { canSearch } = require('../services/searchRequestPolicy.js');
const { allowBarSelection, allowStateRequest } = require('../services/socketStateRequestPolicy.js');
const {
  canRequestSong,
  isBlockedSong,
  normalizeRequesterName
} = require('../services/songRequestPolicy.js');

const { logError, logInfo } = require('../lib/logger.js');

const SEARCH_COOLDOWN_MS = 0;

function registerPublicSocketHandlers({
  socket,
  clienteId,
  verificarLicenciaSocket,
  emitirEstadoSocket,
  emitirEstadoBar
}) {
  socket.on('seleccionar_bar', async (payload) => {
    try {
      if (!allowBarSelection(socket)) {
        socket.emit('error_bar', {
          mensaje:
            'Demasiados cambios de bar. Intenta nuevamente en un momento.'
        });
        return;
      }
      const isOperator = Boolean(socket.data.operator);
      const previousBarId = socket.data.barId;
      let id = null;

      if (isOperator) {
        const barId =
          payload && typeof payload === 'object'
            ? payload.barId
            : payload;

        id = obtenerBarIdAutorizado(socket, barId);
      } else {
        const slug =
          payload && typeof payload === 'object'
            ? payload.slug
            : payload;
        const bar = await getBarBySlug(slug);
        id = bar?.id || null;
      }

      if (!id) {
        if (socket.data.operator) {
          socket.emit('error_autorizacion', {
            mensaje:
              'No puedes acceder a un bar distinto al de tu sesión.'
          });
          return;
        }

        socket.emit('error_bar', {
          mensaje: 'Bar inválido.'
        });
        return;
      }

      const acceso = await verificarLicenciaSocket(
        socket,
        id
      );

      if (!acceso) return;

      if (previousBarId && previousBarId !== id) {
        socket.leave(`bar:${previousBarId}`);
      }

      socket.data.barId = id;
      socket.join(`bar:${id}`);

      logInfo('Socket asociado a bar', {
        event: 'socket_bar_selected',
        socketId: clienteId,
        barId: id,
        licenseStatus: acceso.status
      });

      await emitirEstadoSocket(socket, id);
    } catch (error) {
      logError('[BAR] Error seleccionando bar:', { socketId: clienteId, error: error?.message || String(error) });

      socket.emit('error_bar', {
        mensaje: 'No se pudo seleccionar el bar.'
      });
    }
  });

  socket.on('solicitar_estado', async (payload) => {
    try {
      if (!allowStateRequest(socket)) {
        socket.emit('error_bar', {
          mensaje:
            'Demasiadas solicitudes de estado. Intenta nuevamente en un momento.'
        });
        return;
      }
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
      logError('[ESTADO] Error:', { socketId: clienteId, error: error?.message || String(error) });
    }
  });

  socket.on('buscar_canciones', async (payload) => {
    let id = null;

    try {
      id = obtenerBarIdAutorizado(
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

      const texto = String(
        payload && typeof payload === 'object'
          ? payload.query
          : payload
      ).trim();

      const requestId =
        payload && typeof payload === 'object'
          ? String(payload.requestId || '')
          : '';

      if (!texto || texto.length > 120) {
        socket.emit('error_busqueda', {
          mensaje:
            'La búsqueda debe tener entre 1 y 120 caracteres.',
          codigo: 'INVALID_QUERY',
          requestId
        });
        return;
      }

      const ahoraBusqueda = Date.now();

      if (
        SEARCH_COOLDOWN_MS > 0 &&
        socket.data.lastSearchAt &&
        ahoraBusqueda - socket.data.lastSearchAt <
          SEARCH_COOLDOWN_MS
      ) {
        socket.emit('error_busqueda', {
          mensaje:
            'Espera un instante antes de buscar de nuevo.',
          codigo: 'COOLDOWN',
          requestId
        });
        return;
      }

      socket.data.lastSearchAt = ahoraBusqueda;

      const {
        videos,
        cached,
        cacheLayer,
        status,
        elapsedMs,
        timings,
        degraded,
        providerStatus,
        stale
      } = await searchYoutube(texto);

      logInfo('Búsqueda YouTube completada', {
        event: 'youtube_search',
        socketId: clienteId,
        barId: id,
        cached,
        stale: Boolean(stale),
        degraded: Boolean(degraded),
        providerStatus: providerStatus || null,
        cacheLayer,
        results: videos.length,
        queryLength: texto.length,
        status,
        elapsedMs,
        timings: timings || null
      });

      if (videos.length === 0) {
        const mensajes = {
          NO_RESULTS:
            'No encontramos canciones relacionadas. Prueba escribiendo artista y canción.',
          PROVIDER_TIMEOUT:
            'La búsqueda tardó demasiado. Intenta nuevamente en unos segundos.',
          PROVIDER_ERROR:
            'YouTube no respondió correctamente. Intenta nuevamente.'
        };

        socket.emit('error_busqueda', {
          mensaje:
            mensajes[status] ||
            'No se encontraron resultados.',
          codigo: status || 'NO_RESULTS',
          requestId
        });
        return;
      }

      socket.emit('resultados_busqueda', {
        items: videos,
        query: texto,
        requestId
      });
    } catch (error) {
      logError('Error buscando canciones', {
        event: 'youtube_search_error',
        socketId: clienteId,
        barId: id,
        error: error?.message || String(error)
      });

      socket.emit('error_busqueda', {
        mensaje:
          'Error al buscar canciones. Intenta nuevamente.',
        codigo: 'INTERNAL_ERROR',
        requestId:
          payload && typeof payload === 'object'
            ? String(payload.requestId || '')
            : ''
      });
    }
  });

  socket.on('agregar_cancion', async (payload) => {
    let id = null;

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

      id = obtenerBarIdAutorizado(
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

      const nombre = normalizeRequesterName(
        cancion.name ||
        cancion.nombre ||
        'Cliente',
        Boolean(socket.data.operator)
      );

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

      logInfo('Canción agregada a cola', {
        event: 'queue_song_added',
        socketId: clienteId,
        barId: id,
        videoId: result.item.videoId
      });

      socket.emit('cancion_confirmada', {
        titulo: result.item.title
      });

      const playbackStart = await startPlaybackIfIdle(id);

      if (playbackStart.started && playbackStart.playback) {
        socket.to(`bar:${id}`).emit(
          'nueva_reproduccion',
          playbackStart.playback
        );
      }

      await emitirEstadoBar(id);
    } catch (error) {
      if (error?.message === 'QUEUE_FULL') {
        socket.emit('error_cancion', {
          mensaje:
            'La cola está llena. Intenta más tarde.'
        });
        return;
      }

      logError('Error agregando canción', {
        event: 'queue_song_add_error',
        socketId: clienteId,
        barId: id,
        error: error?.message || String(error)
      });

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
