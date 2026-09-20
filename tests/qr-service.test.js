'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const {
  getClientQrPng,
  clearQrCache,
  buildCloudinaryPngUrl
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
      assert.equal(options.errorCorrectionLevel, 'H');
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
    assert.equal(first.logoApplied, false);
    assert.equal(second.cached, true);
    assert.equal(calls, 1);
    assert.equal(second.buffer.toString(), 'qr-demo');
  });

  it('coalesce generación concurrente para la misma URL y logo', async () => {
    let calls = 0;

    const generate = async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return Buffer.from('qr-concurrente');
    };

    const options = {
      logoUrl: 'https://res.cloudinary.com/demo/image/upload/logo.png',
      generate,
      loadLogo: async () => Buffer.from('logo'),
      compose: async (qr) => qr
    };

    const [first, second] = await Promise.all([
      getClientQrPng('https://example.com/cliente.html?bar=concurrente', options),
      getClientQrPng('https://example.com/cliente.html?bar=concurrente', options)
    ]);

    assert.equal(calls, 1);
    assert.equal(first.buffer.toString(), 'qr-concurrente');
    assert.equal(second.buffer.toString(), 'qr-concurrente');
    assert.equal(first.logoApplied, true);
  });

  it('incluye el logo del bar y separa la caché por logo', async () => {
    let generated = 0;
    let loaded = 0;

    const generate = async () => Buffer.from(`qr-${++generated}`);
    const loadLogo = async (url) => {
      loaded += 1;
      return Buffer.from(url);
    };
    const compose = async (qr, logo) => Buffer.concat([qr, Buffer.from('|'), logo]);

    const first = await getClientQrPng('https://example.com/cliente.html?bar=demo', {
      logoUrl: 'https://res.cloudinary.com/demo/image/upload/logo-a.png',
      generate,
      loadLogo,
      compose
    });

    const second = await getClientQrPng('https://example.com/cliente.html?bar=demo', {
      logoUrl: 'https://res.cloudinary.com/demo/image/upload/logo-b.png',
      generate,
      loadLogo,
      compose
    });

    assert.equal(first.logoApplied, true);
    assert.equal(second.logoApplied, true);
    assert.equal(generated, 2);
    assert.equal(loaded, 2);
    assert.notEqual(first.buffer.toString(), second.buffer.toString());
  });

  it('devuelve el QR normal cuando no se puede cargar el logo', async () => {
    const result = await getClientQrPng('https://example.com/cliente.html?bar=demo', {
      logoUrl: 'https://res.cloudinary.com/demo/image/upload/logo.png',
      generate: async () => Buffer.from('qr-seguro'),
      loadLogo: async () => {
        throw new Error('Cloudinary no disponible');
      }
    });

    assert.equal(result.buffer.toString(), 'qr-seguro');
    assert.equal(result.logoApplied, false);
  });

  it('fuerza una variante PNG pequeña para el logo de Cloudinary', () => {
    assert.equal(
      buildCloudinaryPngUrl('https://res.cloudinary.com/demo/image/upload/v1/logo.jpg'),
      'https://res.cloudinary.com/demo/image/upload/f_png,w_64,h_64,c_pad,b_transparent/v1/logo.jpg'
    );
    assert.equal(buildCloudinaryPngUrl('https://example.com/logo.png'), null);
  });

  it('rechaza URL vacía', async () => {
    await assert.rejects(
      () => getClientQrPng(''),
      /URL de cliente inválida/
    );
  });
});
