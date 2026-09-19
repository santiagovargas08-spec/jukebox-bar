'use strict';

function withTimeout(
  promise,
  timeoutMs,
  {
    message = 'OPERATION_TIMEOUT',
    code = 'OPERATION_TIMEOUT'
  } = {}
) {
  const ms = Number(timeoutMs);

  if (!Number.isFinite(ms) || ms <= 0) {
    return Promise.resolve(promise);
  }

  let timer;

  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(message);
      error.code = code;
      reject(error);
    }, ms);

  });

  return Promise.race([
    Promise.resolve(promise),
    timeout
  ]).finally(() => {
    clearTimeout(timer);
  });
}

module.exports = {
  withTimeout
};
