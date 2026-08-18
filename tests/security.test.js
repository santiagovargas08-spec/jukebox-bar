'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { sanitizeThumbnailUrl } = require('../lib/urlValidation.js');
const { getAuthorizedBarId, emitBarIdRechazado } = require('../lib/socketBar.js');

describe('security', () => {
  it('rechaza thumbnails con file:', () => {
    assert.equal(sanitizeThumbnailUrl('file:///etc/passwd'), null);
  });

  it('rechaza thumbnails con vbscript:', () => {
    assert.equal(sanitizeThumbnailUrl('vbscript:msgbox(1)'), null);
  });

  it('thumbnail null devuelve null', () => {
    assert.equal(sanitizeThumbnailUrl(null), null);
    assert.equal(sanitizeThumbnailUrl(''), null);
  });

  it('rechaza thumbnails con javascript:', () => {
    assert.equal(sanitizeThumbnailUrl('javascript:alert(1)'), null);
  });

  it('rechaza thumbnails con data:', () => {
    assert.equal(sanitizeThumbnailUrl('data:text/html,test'), null);
  });

  it('rechaza hosts no permitidos', () => {
    assert.equal(
      sanitizeThumbnailUrl('https://evil.example.com/image.jpg'),
      null
    );
  });

  it('acepta thumbnails de YouTube', () => {
    const url = sanitizeThumbnailUrl(
      'https://i.ytimg.com/vi/abc123/hqdefault.jpg'
    );
    assert.ok(url?.includes('i.ytimg.com'));
  });

  it('operador no puede autorizar barId distinto', () => {
    const socket = {
      data: {
        operator: { barId: 1 }
      }
    };

    const authorized = getAuthorizedBarId(socket, 2);
    assert.equal(authorized, null);
  });

  it('cliente sin operador usa barId recibido', () => {
    const socket = { data: {} };
    const authorized = getAuthorizedBarId(socket, 5);
    assert.equal(authorized, 5);
  });

  it('emitBarIdRechazado notifica al operador con error_autorizacion', () => {
    const events = [];
    const socket = {
      data: { operator: { barId: 1 } },
      emit(name, payload) {
        events.push({ name, payload });
      }
    };

    emitBarIdRechazado(socket);

    assert.equal(events.length, 1);
    assert.equal(events[0].name, 'error_autorizacion');
  });
});
