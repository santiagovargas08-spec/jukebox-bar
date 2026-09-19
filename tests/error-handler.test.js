'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { errorHandler } = require('../middleware/errorHandler.js');

function createResponse() {
  return {
    headersSent: false,
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    }
  };
}

describe('error handler', () => {
  it('incluye requestId y oculta errores internos en producción', () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    const req = {
      id: 'req-error-1234',
      path: '/api/test',
      method: 'GET'
    };
    const res = createResponse();

    errorHandler(
      new Error('detalle interno sensible'),
      req,
      res,
      () => {}
    );

    assert.equal(res.statusCode, 500);
    assert.equal(res.payload.ok, false);
    assert.equal(
      res.payload.error,
      'Error interno del servidor.'
    );
    assert.equal(
      res.payload.requestId,
      'req-error-1234'
    );

    process.env.NODE_ENV = previous;
  });

  it('respeta status explícito para errores controlados', () => {
    const req = {
      id: 'req-error-5678',
      path: '/api/test',
      method: 'POST'
    };
    const res = createResponse();
    const error = new Error('Entrada inválida');
    error.status = 400;

    errorHandler(error, req, res, () => {});

    assert.equal(res.statusCode, 400);
    assert.equal(res.payload.error, 'Entrada inválida');
    assert.equal(res.payload.requestId, 'req-error-5678');
  });
  it('normaliza JSON inválido sin filtrar detalles del parser', () => {
    const req = {
      id: 'req-json-1234',
      path: '/api/public/test',
      method: 'POST'
    };
    const res = createResponse();
    const error = new SyntaxError('Unexpected token } in JSON at position 12');
    error.status = 400;
    error.type = 'entity.parse.failed';

    errorHandler(error, req, res, () => {});

    assert.equal(res.statusCode, 400);
    assert.equal(res.payload.error, 'JSON inválido.');
    assert.equal(res.payload.requestId, 'req-json-1234');
  });

  it('normaliza payload demasiado grande', () => {
    const req = {
      id: 'req-large-1234',
      path: '/api/public/test',
      method: 'POST'
    };
    const res = createResponse();
    const error = new Error('request entity too large');
    error.status = 413;
    error.type = 'entity.too.large';

    errorHandler(error, req, res, () => {});

    assert.equal(res.statusCode, 413);
    assert.equal(
      res.payload.error,
      'El cuerpo de la solicitud es demasiado grande.'
    );
  });

});
