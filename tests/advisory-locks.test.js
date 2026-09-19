'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  LOCK_NAMESPACE,
  acquireQueueLock,
  acquireLicenseLock
} = require('../lib/advisoryLocks.js');

function createTx() {
  const calls = [];

  return {
    calls,
    async $executeRaw(strings, ...values) {
      calls.push({
        sql: strings.join('?'),
        values
      });
      return 1;
    }
  };
}

describe('advisory lock namespaces', () => {
  it('usa namespaces distintos para cola y licencia', () => {
    assert.notEqual(
      LOCK_NAMESPACE.QUEUE,
      LOCK_NAMESPACE.LICENSE
    );
  });

  it('adquiere lock de cola con namespace dedicado', async () => {
    const tx = createTx();

    await acquireQueueLock(tx, 7);

    assert.equal(tx.calls.length, 1);
    assert.deepEqual(
      tx.calls[0].values,
      [LOCK_NAMESPACE.QUEUE, 7]
    );
  });

  it('adquiere lock de licencia con namespace dedicado', async () => {
    const tx = createTx();

    await acquireLicenseLock(tx, 7);

    assert.equal(tx.calls.length, 1);
    assert.deepEqual(
      tx.calls[0].values,
      [LOCK_NAMESPACE.LICENSE, 7]
    );
  });

  it('rechaza barId inválido', async () => {
    const tx = createTx();

    await assert.rejects(
      () => acquireQueueLock(tx, 0),
      /Advisory lock inválido/
    );
  });
});
