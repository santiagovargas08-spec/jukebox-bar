'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  createSongRequestPolicy,
  normalizeSocketIp,
  parseBlockedTerms,
  normalizeRequesterName,
  OPERATOR_REQUESTER_NAME
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

  it('impide suplantar el nombre del operador desde un cliente público', () => {
    assert.equal(
      normalizeRequesterName('👑 DJ / Admin', false),
      'Cliente'
    );
    assert.equal(
      normalizeRequesterName('Admin', false),
      'Cliente'
    );
    assert.equal(
      normalizeRequesterName('Mesa 12', false),
      'Mesa 12'
    );
  });

  it('el operador autenticado recibe el nombre reservado del DJ', () => {
    assert.equal(
      normalizeRequesterName('cualquier texto', true),
      OPERATOR_REQUESTER_NAME
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
