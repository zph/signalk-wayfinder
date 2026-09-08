/* eslint-disable @typescript-eslint/no-require-imports, no-undef */
const { parentPort } = require('node:worker_threads');

parentPort.postMessage({ type: 'ready' });
parentPort.on('message', (task) => {
  parentPort.postMessage({
    type: 'progress',
    attempt: task.attempt,
    fraction: 0.5,
    frontier: [[task.attempt, task.attempt]],
  });
  setTimeout(() => {
    parentPort.postMessage({
      type: 'result',
      attempt: task.attempt,
      route: [
        {
          lat: task.attempt,
          lon: 0,
          time: new Date('2026-06-06T00:00:00Z'),
          heading: 0,
          twa: 0,
          tws: 10,
          windDir: 180,
          legCalcMs: 0,
        },
      ],
    });
  }, 5);
});
