'use strict';

require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const publicRoutes = require('./routes/public.js');
const { errorHandler } = require('./middleware/errorHandler.js');

const {
  getQueue,
  addToQueue,
  removeFromQueue,
  clearQueue,
  reorderQueue,
  takeNextFromQueue,
  MAX_QUEUE_PER_BAR
} = require('./services/queueService.js');

const {
  addToHistory,
  getHistory
} = require('./services/historyService.js');

const {
  getActiveAdminFromToken
} = require('./services/operatorAuthService.js');

const {
  getPlaybackState,
  setNowPlaying,
  clearPlaybackState
} = require('./services/playbackService.js');

const {
  normalizarBarId,
  obtenerBarIdAutorizado,
  requireOperatorSocket,
  emitBarIdRechazado,
  createSocketCorsOptions
} = require('./lib/socketBar.js');

const { logError, logInfo } = require('./lib/logger.js');
const { securityHeaders } = require('./lib/securityHeaders.js');
const { prisma, pool } = require('./db.js');
const { searchYoutube } = require('./services/youtubeSearchService.js');
const { validarAccesoBar } = require('./services/barAccessService.js');
const { canRequestSong, isBlockedSong } = require('./services/songRequestPolicy.js');
const { createSocketStateService, HISTORIAL_MAX } = require('./services/socketStateService.js');


// ============================================================
// SERVIDOR
// ============================================================

const app = express();

// Render y otros proxies terminan TLS antes de entregar la petición a Node.
// Confiar en un único proxy permite que req.ip/req.secure reflejen al cliente real.
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

const server = http.createServer(app);

const io = new Server(server, {
  cors: createSocketCorsOptions(),

  pingTimeout: 60000,
  pingInterval: 25000
});

const {
  verificarLicenciaSocket,
  emitirEstadoBar,
  emitirEstadoSocket
} = createSocketStateService(io);

const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';

io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth?.operatorToken;
    if (!token) return next();
    const operator = await getActiveAdminFromToken(token);
    if (!operator) return next(new Error('UNAUTHORIZED_OPERATOR'));
    socket.data.operator = operator;
    next();
  } catch (error) {
    console.error('[AUTH] Error validando operador Socket.IO:', error);
    next(new Error('UNAUTHORIZED_OPERATOR'));
  }
});


// ============================================================
// CONFIGURACIÓN
// ============================================================

// ============================================================
// MIDDLEWARE
// ============================================================

app.disable('x-powered-by');
app.use(securityHeaders);
app.use(express.json({ limit: '32kb' }));

app.get('/health', (req, res) => {
  res.status(200).json({ ok: true });
});

app.get('/ready', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.status(200).json({ ok: true, database: 'ready' });
  } catch (error) {
    logError('[READY] Base de datos no disponible', {
      error: error?.message || String(error)
    });
    res.status(503).json({ ok: false, database: 'unavailable' });
  }
});

app.use(
  express.static(
    path.join(__dirname, 'public')
  )
);


// ============================================================
// API PÚBLICA
// ============================================================

app.use(
  '/api/public',
  publicRoutes
);


// ============================================================
// API COMERCIAL LEGACY (deshabilitada por defecto)
// ============================================================

if (process.env.ENABLE_LEGACY_COMMERCIAL_API === 'true') {
  // Carga diferida: si la API legacy no se usa, no amplía la superficie activa.
  // Mantener solo para integraciones externas que todavía dependan de ADMIN_API_KEY.
  const commercialRoutes = require('./routes/commercial.js');
  app.use('/api/commercial', commercialRoutes);
}

app.use(errorHandler);


// ============================================================
// UTILIDADES
// ============================================================

// normalizarBarId, obtenerBarIdAutorizado y requireOperatorSocket
// provienen de lib/socketBar.js (fuente única de tenant).

// ============================================================
// SOCKET.IO
// ============================================================

io.on(
  'connection',
  (socket) => {

    const clienteId =
      socket.id.slice(0, 8);


    console.log(
      `[+] Conectado [${clienteId}] · Total: ${io.engine.clientsCount} cliente(s)`
    );


    // ========================================================
    // SELECCIONAR BAR
    // ========================================================

    socket.on(
      'seleccionar_bar',
      async (payload) => {

        try {

          let barId;


          if (
            payload &&
            typeof payload === 'object'
          ) {

            barId =
              payload.barId;

          } else {

            barId =
              payload;
          }


          const id =
            obtenerBarIdAutorizado(
              socket,
              barId
            );


          if (!id) {

            if (socket.data.operator) {
              socket.emit(
                'error_autorizacion',
                {
                  mensaje:
                    'No puedes acceder a un bar distinto al de tu sesión.'
                }
              );
              return;
            }

            socket.emit(
              'error_bar',
              {
                mensaje:
                  'barId inválido.'
              }
            );

            return;
          }


          /*
           * COMPROBACIÓN DE LICENCIA
           */

          const acceso =
            await verificarLicenciaSocket(
              socket,
              id
            );


          if (!acceso) {
            return;
          }


          /*
           * Salir del bar anterior.
           */

          if (
            socket.data.barId
          ) {

            socket.leave(
              `bar:${socket.data.barId}`
            );
          }


          /*
           * Guardar bar actual.
           */

          socket.data.barId =
            id;


          /*
           * Entrar a la sala.
           */

          socket.join(
            `bar:${id}`
          );


          console.log(
            `[BAR] Cliente [${clienteId}] asociado al bar ${id} · Licencia: ${acceso.status}`
          );


          /*
           * Enviar estado solamente
           * de este bar.
           */

          await emitirEstadoSocket(
            socket,
            id
          );

        } catch (error) {

          console.error(
            '[BAR] Error seleccionando bar:',
            error
          );


          socket.emit(
            'error_bar',
            {
              mensaje:
                'No se pudo seleccionar el bar.'
            }
          );
        }
      }
    );


    // ========================================================
    // SOLICITAR ESTADO
    // ========================================================

    socket.on(
      'solicitar_estado',
      async (payload) => {

        try {

          let barId;


          if (
            payload &&
            typeof payload === 'object'
          ) {

            barId =
              payload.barId;

          } else {

            barId =
              payload;
          }


          const id =
            obtenerBarIdAutorizado(
              socket,
              barId
            );


          if (!id) {

            socket.emit(
              'error_bar',
              {
                mensaje:
                  'Primero debes seleccionar un bar.'
              }
            );

            return;
          }


          const acceso =
            await verificarLicenciaSocket(
              socket,
              id
            );


          if (!acceso) {
            return;
          }


          await emitirEstadoSocket(
            socket,
            id
          );

        } catch (error) {

          console.error(
            '[ESTADO] Error:',
            error
          );
        }
      }
    );


    // ========================================================
    // BUSCAR CANCIONES
    // ========================================================

    socket.on(
      'buscar_canciones',
      async (query) => {

        try {

          /*
           * La búsqueda solamente se permite cuando
           * el socket está asociado a un bar válido.
           */

          const id =
            obtenerBarIdAutorizado(
              socket,
              null
            );


          if (!id) {

            emitBarIdRechazado(socket, {
              evento: 'error_busqueda',
              mensaje:
                'Primero debes seleccionar un bar.'
            });

            return;
          }


          const acceso =
            await verificarLicenciaSocket(
              socket,
              id
            );


          if (!acceso) {
            return;
          }


          const texto =
            String(
              query || ''
            ).trim();


          if (!texto || texto.length > 120) {
            socket.emit(
              'error_busqueda',
              {
                mensaje: 'La búsqueda debe tener entre 1 y 120 caracteres.'
              }
            );
            return;
          }

          const ahoraBusqueda = Date.now();

          if (
            socket.data.lastSearchAt &&
            ahoraBusqueda - socket.data.lastSearchAt < SEARCH_COOLDOWN_MS
          ) {
            socket.emit(
              'error_busqueda',
              {
                mensaje: 'Espera un momento antes de buscar de nuevo.'
              }
            );
            return;
          }

          socket.data.lastSearchAt = ahoraBusqueda;


          const {
            videos,
            cached
          } = await searchYoutube(texto);

          console.log(
            cached
              ? `[CACHE] "${texto}" · ${clienteId}`
              : `[BUSQUEDA] "${texto}" · ${clienteId} · ${videos.length} resultado(s)`
          );


          if (
            videos.length === 0
          ) {

            socket.emit(
              'error_busqueda',
              {
                mensaje:
                  'No se pudieron obtener resultados de YouTube. Intenta nuevamente en unos segundos.'
              }
            );

            return;
          }


          socket.emit(
            'resultados_busqueda',
            {
              items:
                videos,

              query:
                texto
            }
          );

        } catch (error) {

          console.error(
            '[BUSQUEDA] Error buscando canciones:',
            error
          );


          socket.emit(
            'error_busqueda',
            {
              mensaje:
                'Error al buscar canciones. Intenta nuevamente.'
            }
          );
        }
      }
    );


    // ========================================================
    // AGREGAR CANCIÓN
    // ========================================================

    socket.on(
      'agregar_cancion',
      async (payload) => {

        try {

          let barId;

          let cancion;


          if (
            payload &&
            payload.cancion
          ) {

            barId =
              payload.barId;

            cancion =
              payload.cancion;

          } else {

            barId =
              socket.data.barId;

            cancion =
              payload;
          }


          const id =
            obtenerBarIdAutorizado(
              socket,
              barId
            );


          if (!id) {

            socket.emit(
              'error_cancion',
              {
                mensaje:
                  'Primero debes seleccionar un bar.'
              }
            );

            return;
          }


          const acceso =
            await verificarLicenciaSocket(
              socket,
              id
            );


          if (!acceso) {
            return;
          }


          if (!canRequestSong(socket, id)) {

            socket.emit(
              'error_cancion',
              {
                mensaje:
                  'Puedes solicitar hasta 3 canciones por minuto.'
              }
            );

            return;
          }


          if (
            !cancion ||
            !cancion.videoId
          ) {

            socket.emit(
              'error_cancion',
              {
                mensaje:
                  'Datos incompletos.'
              }
            );

            return;
          }


          const titulo =
            String(
              cancion.title ||
              cancion.titulo ||
              ''
            ).trim();


          const nombre =
            String(
              cancion.name ||
              cancion.nombre ||
              'Cliente'
            ).trim();


          if (!titulo) {

            socket.emit(
              'error_cancion',
              {
                mensaje:
                  'La canción no tiene título.'
              }
            );

            return;
          }


          const song = {

            videoId:
              String(
                cancion.videoId
              ).trim(),

            title:
              titulo,

            name:
              nombre,

            thumbnail:
              cancion.thumbnail ||
              null
          };


          if (
            song.title.length > 100 ||
            song.name.length > 30
          ) {

            socket.emit(
              'error_cancion',
              {
                mensaje:
                  'El título o nombre es demasiado largo.'
              }
            );

            return;
          }


          if (isBlockedSong(song)) {

            socket.emit(
              'error_cancion',
              {
                mensaje:
                  'Esta solicitud no está permitida por el bar.'
              }
            );

            return;
          }


          const queue =
            await getQueue(
              id
            );


          if (queue.length >= MAX_QUEUE_PER_BAR) {

            socket.emit(
              'error_cancion',
              {
                mensaje:
                  'La cola está llena. Intenta más tarde.'
              }
            );

            return;
          }


          const result =
            await addToQueue(
              id,
              song
            );


          if (!result.created) {

            socket.emit(
              'error_cancion',
              {
                mensaje:
                  `🎵 "${song.title}" ya está en la fila.`
              }
            );

            return;
          }


          console.log(
            `[COLA] Bar ${id} → "${result.item.title}" · ${result.item.name}`
          );


          socket.emit(
            'cancion_confirmada',
            {
              titulo:
                result.item.title
            }
          );


          await emitirEstadoBar(
            id
          );

        } catch (error) {

          console.error(
            '[COLA] Error agregando canción:',
            error
          );


          socket.emit(
            'error_cancion',
            {
              mensaje:
                'No se pudo agregar la canción.'
            }
          );
        }
      }
    );


    // ========================================================
    // SIGUIENTE CANCIÓN
    // ========================================================

    socket.on(
      'siguiente_cancion',
      async (payload) => {

        try {

          let barId;


          if (
            payload &&
            typeof payload === 'object'
          ) {

            barId =
              payload.barId;

          } else {

            barId =
              payload;
          }


          const id =
            obtenerBarIdAutorizado(
              socket,
              barId
            );


          if (!id) {

            socket.emit(
              'error_bar',
              {
                mensaje:
                  'Primero debes seleccionar un bar.'
              }
            );

            return;
          }

          if (!requireOperatorSocket(socket, id)) {
            return;
          }


          const acceso =
            await verificarLicenciaSocket(
              socket,
              id
            );


          if (!acceso) {
            return;
          }


          const siguiente =
            await takeNextFromQueue(
              id
            );


          if (!siguiente) {

            await clearPlaybackState(id);

            io
              .to(`bar:${id}`)
              .emit(
                'cola_actualizada',
                {
                  cola: [],

                  reproduciendo:
                    null
                }
              );

            return;
          }


          const reproduciendo =
            await setNowPlaying(
              id,
              siguiente
            );


          console.log(
            `[REPRODUCCION] Bar ${id} → "${siguiente.title}"`
          );


          io
            .to(`bar:${id}`)
            .emit(
              'nueva_reproduccion',
              reproduciendo || {
                id:
                  siguiente.id,

                videoId:
                  siguiente.videoId,

                titulo:
                  siguiente.title,

                nombre:
                  siguiente.name,

                thumbnail:
                  siguiente.thumbnail
              }
            );


          await emitirEstadoBar(
            id
          );

        } catch (error) {

          console.error(
            '[REPRODUCCION] Error:',
            error
          );
        }
      }
    );


    // ========================================================
    // ADMIN SALTAR
    // ========================================================

    socket.on(
      'admin_saltar',
      async (payload) => {

        try {

          const id =
            obtenerBarIdAutorizado(
              socket,
              payload?.barId
            );


          if (!id) {

            socket.emit(
              'error_bar',
              {
                mensaje:
                  'Bar inválido.'
              }
            );

            return;
          }

          if (!requireOperatorSocket(socket, id)) {
            return;
          }


          const acceso =
            await verificarLicenciaSocket(
              socket,
              id
            );


          if (!acceso) {
            return;
          }


          const siguiente =
            await takeNextFromQueue(
              id
            );


          if (!siguiente) {

            await clearPlaybackState(id);

            io
              .to(`bar:${id}`)
              .emit(
                'cola_actualizada',
                {
                  cola: [],

                  reproduciendo:
                    null
                }
              );

            return;
          }


          const reproduciendo =
            await setNowPlaying(
              id,
              siguiente
            );


          console.log(
            `[ADMIN] Bar ${id} → "${siguiente.title}"`
          );


          io
            .to(`bar:${id}`)
            .emit(
              'nueva_reproduccion',
              reproduciendo || {
                id:
                  siguiente.id,

                videoId:
                  siguiente.videoId,

                titulo:
                  siguiente.title,

                nombre:
                  siguiente.name,

                thumbnail:
                  siguiente.thumbnail
              }
            );


          await emitirEstadoBar(
            id
          );

        } catch (error) {

          console.error(
            '[ADMIN] Error saltando:',
            error
          );
        }
      }
    );


    // ========================================================
    // ADMIN ELIMINAR
    // ========================================================

    socket.on(
      'admin_eliminar_cancion',
      async (payload) => {

        try {

          const id =
            obtenerBarIdAutorizado(
              socket,
              payload?.barId
            );


          const itemId =
            payload?.id;


          if (!id) {

            socket.emit(
              'error_bar',
              {
                mensaje:
                  'Bar inválido.'
              }
            );

            return;
          }

          if (!requireOperatorSocket(socket, id)) {
            return;
          }


          const acceso =
            await verificarLicenciaSocket(
              socket,
              id
            );


          if (!acceso) {
            return;
          }


          const eliminado =
            await removeFromQueue(
              id,
              itemId
            );


          console.log(
            `[ADMIN] Bar ${id} → Eliminación ${itemId}: ${eliminado}`
          );


          await emitirEstadoBar(
            id
          );

        } catch (error) {

          console.error(
            '[ADMIN] Error eliminando:',
            error
          );
        }
      }
    );


    // ========================================================
    // ADMIN VACIAR COLA
    // ========================================================

    socket.on(
      'admin_vaciar_cola',
      async (payload) => {

        try {

          const id =
            obtenerBarIdAutorizado(
              socket,
              payload?.barId
            );


          if (!id) {

            socket.emit(
              'error_bar',
              {
                mensaje:
                  'Bar inválido.'
              }
            );

            return;
          }

          if (!requireOperatorSocket(socket, id)) {
            return;
          }


          const acceso =
            await verificarLicenciaSocket(
              socket,
              id
            );


          if (!acceso) {
            return;
          }


          const cantidad =
            await clearQueue(
              id
            );


          console.log(
            `[ADMIN] Bar ${id} → Se eliminaron ${cantidad} canciones`
          );


          await emitirEstadoBar(
            id
          );

        } catch (error) {

          console.error(
            '[ADMIN] Error vaciando:',
            error
          );
        }
      }
    );


    // ========================================================
    // REORDENAR COLA
    // ========================================================

    socket.on(
      'reordenar_cola',
      async (payload) => {

        try {

          const id =
            obtenerBarIdAutorizado(
              socket,
              payload?.barId
            );


          if (!id) {

            socket.emit(
              'error_cola',
              {
                mensaje:
                  'Primero debes seleccionar un bar.'
              }
            );

            return;
          }

          if (!requireOperatorSocket(socket, id)) {
            return;
          }


          const acceso =
            await verificarLicenciaSocket(
              socket,
              id
            );


          if (!acceso) {
            return;
          }


          const orderedIds =
            Array.isArray(payload)
              ? payload
              : payload?.orderedIds;


          if (
            !Array.isArray(orderedIds) ||
            orderedIds.length === 0
          ) {

            socket.emit(
              'error_cola',
              {
                mensaje:
                  'Orden de cola inválido.'
              }
            );

            return;
          }


          await reorderQueue(
            id,
            orderedIds
          );


          await emitirEstadoBar(
            id
          );

        } catch (error) {

          console.error(
            '[COLA] Error reordenando:',
            error
          );


          socket.emit(
            'error_cola',
            {
              mensaje:
                error.message ||
                'No se pudo reordenar la cola.'
            }
          );
        }
      }
    );


    // ========================================================
    // CANCIÓN TERMINADA
    // ========================================================

    socket.on(
      'cancion_terminada',
      async (payload) => {

        try {

          let barId;

          let cancion;


          if (
            payload &&
            payload.cancion
          ) {

            barId =
              payload.barId;

            cancion =
              payload.cancion;

          } else {

            barId =
              socket.data.barId;

            cancion =
              payload;
          }


          const id =
            obtenerBarIdAutorizado(
              socket,
              barId
            );


          if (
            !id ||
            !cancion?.videoId
          ) {

            return;
          }

          if (!requireOperatorSocket(socket, id)) {
            return;
          }


          const acceso =
            await verificarLicenciaSocket(
              socket,
              id
            );


          if (!acceso) {
            return;
          }


          const song = {

            videoId:
              String(
                cancion.videoId
              ).trim(),

            title:
              String(
                cancion.title ||
                cancion.titulo ||
                ''
              ).trim(),

            name:
              String(
                cancion.name ||
                cancion.nombre ||
                'Cliente'
              ).trim(),

            thumbnail:
              cancion.thumbnail ||
              null
          };


          if (!song.title) {
            return;
          }


          const ultimo =
            await getHistory(
              id,
              1
            );


          if (
            ultimo.length > 0 &&
            ultimo[0].videoId ===
              song.videoId
          ) {

            console.log(
              `[HISTORIAL] Bar ${id} → duplicado ignorado`
            );

          } else {

            await addToHistory(
              id,
              song
            );
          }


          await clearPlaybackState(id);

          await emitirEstadoBar(id);


          const historial =
            await getHistory(
              id,
              HISTORIAL_MAX
            );


          io
            .to(`bar:${id}`)
            .emit(
              'historial_actualizado',
              {
                historialReproducidas:
                  historial
              }
            );


          console.log(
            `[HISTORIAL] Bar ${id} → "${song.title}"`
          );

        } catch (error) {

          console.error(
            '[HISTORIAL] Error:',
            error
          );
        }
      }
    );


    // ========================================================
    // DESCONEXIÓN
    // ========================================================

    socket.on(
      'disconnect',
      () => {

        console.log(
          `[-] Desconectado [${clienteId}]`
        );
      }
    );
  }
);


// ============================================================
// INICIAR SERVIDOR
// ============================================================

if (require.main === module) {
  let shuttingDown = false;

  async function shutdown(reason, exitCode = 0) {
    if (shuttingDown) return;
    shuttingDown = true;

    logInfo('[SHUTDOWN] Cerrando servidor', { reason, exitCode });

    const forceTimer = setTimeout(() => {
      logError('[SHUTDOWN] Cierre forzado por timeout', { reason });
      process.exit(1);
    }, 10000);

    forceTimer.unref();

    try {
      await new Promise((resolve) => {
        if (!server.listening) {
          resolve();
          return;
        }

        server.close(() => resolve());
      });

      io.disconnectSockets(true);
      await prisma.$disconnect();
      await pool.end();

      clearTimeout(forceTimer);
      process.exit(exitCode);
    } catch (error) {
      clearTimeout(forceTimer);
      logError('[SHUTDOWN] Error cerrando recursos', {
        reason,
        error: error?.message || String(error)
      });
      process.exit(1);
    }
  }

  process.once('SIGTERM', () => {
    void shutdown('SIGTERM', 0);
  });

  process.once('SIGINT', () => {
    void shutdown('SIGINT', 0);
  });

  process.once('uncaughtException', (error) => {
    logError('[ERROR GLOBAL] uncaughtException', {
      error: error?.stack || error?.message || String(error)
    });
    void shutdown('uncaughtException', 1);
  });

  process.once('unhandledRejection', (error) => {
    logError('[ERROR GLOBAL] unhandledRejection', {
      error: error?.stack || error?.message || String(error)
    });
    void shutdown('unhandledRejection', 1);
  });

  server.listen(PORT, HOST, () => {
    console.log(`
==============================================
 JUKEBOX DIGITAL — MULTI-BAR
==============================================
 Puerto: ${PORT}
 Health: http://localhost:${PORT}/health
 Ready: http://localhost:${PORT}/ready
 Cliente: http://localhost:${PORT}/cliente.html?bar=slug
 Bar: http://localhost:${PORT}/bar.html?bar=slug
 Admin: http://localhost:${PORT}/admin.html?bar=slug
 Master Admin: http://localhost:${PORT}/master-admin.html

 API comercial legacy:
   ${process.env.ENABLE_LEGACY_COMMERCIAL_API === 'true' ? '✓ Habilitada' : '✓ Deshabilitada por defecto'}

 PostgreSQL:
   ✓ Cola persistente
   ✓ Historial persistente

 Licencias:
   ✓ Prueba inicial
   ✓ Suscripción mensual
   ✓ Suscripción trimestral
   ✓ Bloqueo por expiración
   ✓ Bloqueo por suspensión
   ✓ Control central del bar

 Socket.io:
   ✓ Estado aislado por bar
   ✓ Salas bar:<id>
   ✓ Validación de licencia

 YouTube:
   ✓ Búsqueda aislada en servicio
   ✓ Caché de búsquedas
   ✓ Normalización de resultados
==============================================
`);
  });
}

module.exports = {
  app,
  server,
  io
};
