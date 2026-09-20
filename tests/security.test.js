'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { sanitizeThumbnailUrl, isValidYoutubeVideoId } = require('../lib/urlValidation.js');
const {
  getAuthorizedBarId,
  emitBarIdRechazado,
  requireOperatorSocket,
  requirePlaybackControllerSocket
} = require('../lib/socketBar.js');

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

  it('valida IDs de video de YouTube', () => {
    assert.equal(isValidYoutubeVideoId('dQw4w9WgXcQ'), true);
    assert.equal(isValidYoutubeVideoId('abc123'), false);
    assert.equal(isValidYoutubeVideoId('../etc/passwd'), false);
    assert.equal(isValidYoutubeVideoId('dQw4w9WgXcQ<script>'), false);
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

  it('cliente sin operador ignora barId recibido y usa solo el asociado', () => {
    const unselected = { data: {} };
    assert.equal(getAuthorizedBarId(unselected, 5), null);

    const selected = { data: { barId: 7 } };
    assert.equal(getAuthorizedBarId(selected, 5), 7);
  });

  it('pantalla autorizada solo controla reproducción de su propio bar', () => {
    const events = [];
    const socket = {
      data: {
        screenController: { barId: 7 }
      },
      emit(name, payload) {
        events.push({ name, payload });
      }
    };

    assert.equal(
      requirePlaybackControllerSocket(socket, 7),
      true
    );
    assert.equal(
      requirePlaybackControllerSocket(socket, 8),
      false
    );
    assert.equal(
      requireOperatorSocket(socket, 7),
      false
    );
    assert.equal(events.length, 2);
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
