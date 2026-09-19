'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  createSongRequestPolicy,
  normalizeSocketIp,
  parseBlockedTerms
} = require('../services/songRequestPolicy.js');

describe('song request policy', () => {
  it('normaliza x-forwarded-for usando la primera IP', () => {
    const socket = {
      handshake: {
        headers: {
          'x-forwarded-for': '203.0.113.10, 10.0.0.1'
        },
        address: '127.0.0.1'
      }
    };

    assert.equal(normalizeSocketIp(socket), '10.0.0.1');
  });

  it('usa handshake.address cuando no hay forwarded-for', () => {
    const socket = {
      handshake: {
        headers: {},
        address: '198.51.100.7'
      }
    };

    assert.equal(normalizeSocketIp(socket), '198.51.100.7');
  });

  it('normaliza términos bloqueados', () => {
    assert.deepEqual(
      parseBlockedTerms('  término uno,TERMINO DOS, , tercero '),
      ['término uno', 'termino dos', 'tercero']
    );
  });

  it('bloquea canciones que coinciden con una regla configurada', () => {
    const policy = createSongRequestPolicy({
      blockedTermsRaw: 'prohibida,otro termino'
    });

    assert.equal(
      policy.isBlockedSong({
        title: 'Mi canción PROHIBIDA',
        name: 'Mesa 4'
      }),
      true
    );

    assert.equal(
      policy.isBlockedSong({
        title: 'Canción permitida',
        name: 'Mesa 4'
      }),
      false
    );
  });

  it('limita solicitudes repetidas del mismo socket', () => {
    const policy = createSongRequestPolicy();
    const socket = {
      id: 'socket-1',
      handshake: {
        headers: {},
        address: '198.51.100.7'
      }
    };

    assert.equal(policy.canRequestSong(socket, 1), true);
    assert.equal(policy.canRequestSong(socket, 1), true);
    assert.equal(policy.canRequestSong(socket, 1), true);
    assert.equal(policy.canRequestSong(socket, 1), false);
  });
});
