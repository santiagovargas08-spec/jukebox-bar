'use strict';

const { RateLimitStore } = require('../lib/rateLimitStore.js');

const ACTION_WINDOW_MS = 60 * 1000;
const MAX_OPERATOR_ACTIONS_PER_WINDOW = 120;
const MAX_DESTRUCTIVE_ACTIONS_PER_WINDOW = 12;

function createOperatorActionPolicy() {
  const generalLimits = new RateLimitStore(ACTION_WINDOW_MS);
  const destructiveLimits = new RateLimitStore(ACTION_WINDOW_MS);

  function hitGeneralLimit(key) {
    return generalLimits.hit(
      key,
      ACTION_WINDOW_MS,
      MAX_OPERATOR_ACTIONS_PER_WINDOW
    ).allowed;
  }

  function allowOperatorAction(socket, barId, {
    destructive = false
  } = {}) {
    const operatorId = Number(socket?.data?.operator?.id);
    const normalizedBarId = Number(barId);

    if (
      !Number.isInteger(operatorId) ||
      operatorId <= 0 ||
      !Number.isInteger(normalizedBarId) ||
      normalizedBarId <= 0
    ) {
      return false;
    }

    const key =
      `operator:${operatorId}:bar:${normalizedBarId}`;

    if (!hitGeneralLimit(key)) {
      return false;
    }

    if (!destructive) {
      return true;
    }

    const destructiveResult = destructiveLimits.hit(
      key,
      ACTION_WINDOW_MS,
      MAX_DESTRUCTIVE_ACTIONS_PER_WINDOW
    );

    return destructiveResult.allowed;
  }

  function allowPlaybackControllerAction(
    socket,
    barId
  ) {
    const normalizedBarId = Number(barId);
    const operatorId =
      Number(socket?.data?.operator?.id);

    if (
      Number.isInteger(operatorId) &&
      operatorId > 0
    ) {
      return allowOperatorAction(
        socket,
        normalizedBarId
      );
    }

    const screenBarId =
      Number(
        socket?.data
          ?.screenController
          ?.barId
      );

    if (
      !Number.isInteger(normalizedBarId) ||
      normalizedBarId <= 0 ||
      screenBarId !== normalizedBarId
    ) {
      return false;
    }

    return hitGeneralLimit(
      `screen:bar:${normalizedBarId}`
    );
  }

  return {
    allowOperatorAction,
    allowPlaybackControllerAction
  };
}

const defaultPolicy = createOperatorActionPolicy();

module.exports = {
  allowOperatorAction: defaultPolicy.allowOperatorAction,
  allowPlaybackControllerAction:
    defaultPolicy.allowPlaybackControllerAction,
  createOperatorActionPolicy,
  ACTION_WINDOW_MS,
  MAX_OPERATOR_ACTIONS_PER_WINDOW,
  MAX_DESTRUCTIVE_ACTIONS_PER_WINDOW
};
