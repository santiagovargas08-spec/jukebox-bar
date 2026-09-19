'use strict';

require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const publicRoutes = require('./routes/public.js');
const { errorHandler } = require('./middleware/errorHandler.js');
const { publicApiRateLimit } = require('./middleware/publicApiRateLimit.js');
const { getOperatorTokenFromCookieHeader } = require('./middleware/operatorAuth.js');

const {
  getActiveAdminFromToken
} = require('./services/operatorAuthService.js');

const {
  createSocketCorsOptions
} = require('./lib/socketBar.js');

const { logError, logInfo } = require('./lib/logger.js');
const { securityHeaders } = require('./lib/securityHeaders.js');
const { assertProductionConfig } = require('./lib/configValidation.js');
const { prisma, pool } = require('./db.js');
const { createSocketStateService } = require('./services/socketStateService.js');
const { registerPlaybackAdminHandlers } = require('./socket/playbackAdminHandlers.js');
const { registerPublicSocketHandlers } = require('./socket/publicHandlers.js');
const { allowConnection } = require('./services/socketConnectionPolicy.js');


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

// Límites conservadores para evitar conexiones HTTP lentas consumiendo recursos.
// El timeout de 60 s sigue siendo compatible con el long-polling de Socket.IO.
server.headersTimeout = 15 * 1000;
server.requestTimeout = 60 * 1000;
server.keepAliveTimeout = 5 * 1000;
server.maxHeadersCount = 100;

const io = new Server(server, {
  cors: createSocketCorsOptions(),

  pingTimeout: 60000,
  pingInterval: 25000,
  maxHttpBufferSize: 64 * 1024,
  perMessageDeflate: false
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
    if (!allowConnection(socket)) {
      return next(new Error('RATE_LIMITED'));
    }
    const token =
      socket.handshake.auth?.operatorToken ||
      getOperatorTokenFromCookieHeader(
        socket.handshake.headers?.cookie
      );

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
    path.join(__dirname, 'public'),
    {
      etag: true,
      maxAge: '5m',
      setHeaders(res, filePath) {
        if (filePath.endsWith('.html')) {
          res.setHeader('Cache-Control', 'no-cache');
        }
      }
    }
  )
);


// ============================================================
// API PÚBLICA
// ============================================================

app.use(
  '/api/public',
  publicApiRateLimit,
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


    registerPublicSocketHandlers({
      socket,
      clienteId,
      verificarLicenciaSocket,
      emitirEstadoSocket,
      emitirEstadoBar
    });


    registerPlaybackAdminHandlers({
      socket,
      io,
      verificarLicenciaSocket,
      emitirEstadoBar
    });


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
  assertProductionConfig();

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
