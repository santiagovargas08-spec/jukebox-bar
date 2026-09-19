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
});
