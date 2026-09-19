'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  getCookieValueFromHeader
} = require('../lib/cookies.js');

describe('cookie parsing', () => {
  it('extrae una cookie codificada', () => {
    assert.equal(
      getCookieValueFromHeader(
        'a=1; session=hello%20world; b=2',
        'session'
      ),
      'hello world'
    );
  });

  it('tolera valores con signo igual', () => {
    assert.equal(
      getCookieValueFromHeader(
        'session=abc=def==; a=1',
        'session'
      ),
      'abc=def=='
    );
  });

  it('rechaza percent-encoding malformado sin lanzar error', () => {
    assert.doesNotThrow(() => {
      getCookieValueFromHeader(
        'session=%E0%A4%A',
        'session'
      );
    });

    assert.equal(
      getCookieValueFromHeader(
        'session=%E0%A4%A',
        'session'
      ),
      ''
    );
  });
});
