'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const {
  getClientQrPng,
  clearQrCache
} = require('../services/qrService.js');

describe('qr service', () => {
  beforeEach(() => {
    clearQrCache();
  });

  it('genera una vez y reutiliza el QR para la misma URL', async () => {
    let calls = 0;

    const generate = async (url, options) => {
      calls += 1;
      assert.equal(url, 'https://example.com/cliente.html?bar=demo');
      assert.equal(options.width, 400);
      return Buffer.from('qr-demo');
    };

    const first = await getClientQrPng(
      'https://example.com/cliente.html?bar=demo',
      { generate }
    );

    const second = await getClientQrPng(
      'https://example.com/cliente.html?bar=demo',
      { generate }
    );

    assert.equal(first.cached, false);
    assert.equal(second.cached, true);
    assert.equal(calls, 1);
    assert.equal(second.buffer.toString(), 'qr-demo');
  });

  it('coalesce generación concurrente para la misma URL', async () => {
    let calls = 0;

    const generate = async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return Buffer.from('qr-concurrente');
    };

    const [first, second] = await Promise.all([
      getClientQrPng('https://example.com/cliente.html?bar=concurrente', { generate }),
      getClientQrPng('https://example.com/cliente.html?bar=concurrente', { generate })
    ]);

    assert.equal(calls, 1);
    assert.equal(first.buffer.toString(), 'qr-concurrente');
    assert.equal(second.buffer.toString(), 'qr-concurrente');
  });

  it('rechaza URL vacía', async () => {
    await assert.rejects(
      () => getClientQrPng(''),
      /URL de cliente inválida/
    );
  });
});
