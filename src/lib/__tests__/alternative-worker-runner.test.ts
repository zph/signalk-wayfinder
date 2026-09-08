import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import type { Worker } from 'node:worker_threads';

import {
  aggregateAlternativeProgress,
  resolveAlternativeWorkerCount,
  runAlternativeAttempts,
} from '../routing/alternative-worker-runner';
import type { AlternativeWorkerInitialization } from '../routing/alternative-worker-protocol';

test('route worker count uses a bounded multi-core default', () => {
  assert.equal(resolveAlternativeWorkerCount(10, undefined, 20), 4);
  assert.equal(resolveAlternativeWorkerCount(2, undefined, 20), 2);
  assert.equal(resolveAlternativeWorkerCount(10, undefined, 2), 1);
});

test('route worker count honors safe configured bounds', () => {
  assert.equal(resolveAlternativeWorkerCount(10, 6, 20), 6);
  assert.equal(resolveAlternativeWorkerCount(10, 99, 20), 8);
  assert.equal(resolveAlternativeWorkerCount(10, 0, 20), 1);
});

test('parallel attempt progress is the aggregate of every attempt', () => {
  assert.equal(aggregateAlternativeProgress([]), 100);
  assert.equal(aggregateAlternativeProgress([0, 0, 0, 0]), 0);
  assert.equal(aggregateAlternativeProgress([1, 0.5, 0, 0]), 37.5);
  assert.equal(aggregateAlternativeProgress([2, -1]), 50);
});

test('route worker pool dispatches attempts and returns deterministic order', async () => {
  const activeWorkers = new Set<Worker>();
  const progress: number[] = [];
  const outcomes = await runAlternativeAttempts({
    initialization: {} as AlternativeWorkerInitialization,
    tasks: [2, 0, 1].map((attempt) => ({ attempt, options: {} })),
    workerCount: 2,
    activeWorkers,
    onProgress: (value) => progress.push(value),
    workerPath: path.join(__dirname, 'fixtures/alternative-runner-worker.cjs'),
  });

  assert.deepEqual(
    outcomes.map((outcome) => outcome.attempt),
    [0, 1, 2],
  );
  assert.equal(
    outcomes.every((outcome) => outcome.route?.[0].time instanceof Date),
    true,
  );
  assert.equal(progress.at(-1), 100);
  assert.equal(activeWorkers.size, 0);
});
