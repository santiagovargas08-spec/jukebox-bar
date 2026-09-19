'use strict';

function normalizarBarId(barId) {
  const id = Number(barId);

  if (!Number.isInteger(id) || id <= 0) {
    return null;
  }

  return id;
}

function obtenerBarIdAutorizado(socket, barIdRecibido = null) {
  const operator = socket.data.operator;

  if (operator) {
    const recibido = normalizarBarId(barIdRecibido);

    if (recibido && recibido !== operator.barId) {
      return null;
    }

    return operator.barId;
  }

  const recibido = normalizarBarId(barIdRecibido);

  if (recibido) {
    return recibido;
  }

  return normalizarBarId(socket.data.barId);
}

function requireOperatorSocket(socket, barId) {
  const id = normalizarBarId(barId);
  const operator = socket.data.operator;

  if (operator && operator.barId === id) {
    return true;
  }

  socket.emit('error_autorizacion', {
    mensaje: 'Esta acción requiere un operador autorizado para este bar.'
  });

  return false;
}

function getAllowedOrigins() {
  const raw = process.env.APP_URL || process.env.CORS_ORIGINS || '';

  return raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function createSocketCorsOptions() {
  const allowedOrigins = getAllowedOrigins();

  if (allowedOrigins.length === 0) {
    if (process.env.NODE_ENV === 'production') {
      return {
        origin: false,
        methods: ['GET', 'POST']
      };
    }

    return {
      origin: true,
      methods: ['GET', 'POST']
    };
  }

  return {
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error('CORS_NOT_ALLOWED'));
    },
    methods: ['GET', 'POST']
  };
}

function emitBarIdRechazado(socket, options = {}) {
  const evento = options.evento || 'error_bar';
  const mensaje =
    options.mensaje || 'Primero debes seleccionar un bar.';
  const mensajeOperador =
    options.mensajeOperador ||
    'No puedes acceder a un bar distinto al de tu sesión.';

  if (socket.data.operator) {
    socket.emit('error_autorizacion', {
      mensaje: mensajeOperador
    });
    return;
  }

  socket.emit(evento, { mensaje });
}

module.exports = {
  normalizarBarId,
  obtenerBarIdAutorizado,
  getAuthorizedBarId: obtenerBarIdAutorizado,
  requireOperatorSocket,
  emitBarIdRechazado,
  createSocketCorsOptions,
  getAllowedOrigins
};
