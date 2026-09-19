'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { withTimeout } = require('../lib/promiseTimeout.js');

describe('promise timeout', () => {
  it('resuelve la operación cuando termina a tiempo', async () => {
    const result = await withTimeout(
      Promise.resolve('ok'),
      50
    );

    assert.equal(result, 'ok');
  });

  it('rechaza una operación bloqueada al vencer el timeout', async () => {
    await assert.rejects(
      () => withTimeout(
        new Promise(() => {}),
        15,
        {
          message: 'TEST_TIMEOUT',
          code: 'TEST_TIMEOUT'
        }
      ),
      (error) =>
        error.message === 'TEST_TIMEOUT' &&
        error.code === 'TEST_TIMEOUT'
    );
  });

  it('ignora timeout inválido', async () => {
    const result = await withTimeout(
      Promise.resolve(42),
      0
    );

    assert.equal(result, 42);
  });
});
