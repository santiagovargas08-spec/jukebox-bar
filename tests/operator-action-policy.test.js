'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  createOperatorActionPolicy,
  MAX_OPERATOR_ACTIONS_PER_WINDOW,
  MAX_DESTRUCTIVE_ACTIONS_PER_WINDOW
} = require('../services/operatorActionPolicy.js');

function socket(operatorId = 10) {
  return {
    data: {
      operator: {
        id: operatorId
      }
    }
  };
}

describe('operator action policy', () => {
  it('rechaza acciones sin operador autenticado', () => {
    const policy = createOperatorActionPolicy();

    assert.equal(
      policy.allowOperatorAction({ data: {} }, 1),
      false
    );
  });

  it('limita acciones administrativas generales por operador y bar', () => {
    const policy = createOperatorActionPolicy();
    const s = socket();

    for (
      let index = 0;
      index < MAX_OPERATOR_ACTIONS_PER_WINDOW;
      index += 1
    ) {
      assert.equal(
        policy.allowOperatorAction(s, 1),
        true
      );
    }

    assert.equal(
      policy.allowOperatorAction(s, 1),
      false
    );
  });

  it('aplica un límite más estricto a acciones destructivas', () => {
    const policy = createOperatorActionPolicy();
    const s = socket();

    for (
      let index = 0;
      index < MAX_DESTRUCTIVE_ACTIONS_PER_WINDOW;
      index += 1
    ) {
      assert.equal(
        policy.allowOperatorAction(
          s,
          2,
          { destructive: true }
        ),
        true
      );
    }

    assert.equal(
      policy.allowOperatorAction(
        s,
        2,
        { destructive: true }
      ),
      false
    );
  });

  it('separa los presupuestos entre bares', () => {
    const policy = createOperatorActionPolicy();
    const s = socket();

    for (
      let index = 0;
      index < MAX_OPERATOR_ACTIONS_PER_WINDOW;
      index += 1
    ) {
      policy.allowOperatorAction(s, 1);
    }

    assert.equal(
      policy.allowOperatorAction(s, 2),
      true
    );
  });
});
