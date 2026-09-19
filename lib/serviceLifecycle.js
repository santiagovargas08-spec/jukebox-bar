'use strict';

let shuttingDown = false;

function beginShutdown() {
  if (shuttingDown) {
    return false;
  }

  shuttingDown = true;
  return true;
}

function isShuttingDown() {
  return shuttingDown;
}

function resetLifecycleForTests() {
  shuttingDown = false;
}

module.exports = {
  beginShutdown,
  isShuttingDown,
  resetLifecycleForTests
};
