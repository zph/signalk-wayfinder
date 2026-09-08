import { availableParallelism } from 'node:os';
import { Worker } from 'node:worker_threads';

import type { RoutePoint } from '../../types';
import type {
  AlternativeWorkerInitialization,
  AlternativeWorkerMessage,
  AlternativeWorkerTask,
} from './alternative-worker-protocol';

export interface AlternativeAttemptOutcome {
  attempt: number;
  route?: RoutePoint[];
  routes?: RoutePoint[][];
  warning?: string;
  error?: Error;
}

export function expandSharedAlternativeOutcomes(outcomes: AlternativeAttemptOutcome[]): AlternativeAttemptOutcome[] {
  return outcomes.flatMap((outcome) =>
    outcome.routes
      ? outcome.routes.map((route, attempt) => ({
          attempt,
          route,
          ...(outcome.warning ? { warning: outcome.warning } : {}),
        }))
      : [outcome],
  );
}

export function resolveAlternativeWorkerCount(
  attemptCount: number,
  configuredWorkers: number | undefined,
  parallelism = availableParallelism(),
): number {
  const fallback = Math.min(4, Math.max(1, parallelism - 1));
  const requested = Number.isFinite(configuredWorkers) ? Math.trunc(configuredWorkers!) : fallback;
  return Math.max(1, Math.min(8, attemptCount, requested));
}

export function aggregateAlternativeProgress(fractions: readonly number[]): number {
  if (fractions.length === 0) return 100;
  return (fractions.reduce((sum, fraction) => sum + Math.max(0, Math.min(1, fraction)), 0) / fractions.length) * 100;
}

export async function runAlternativeAttempts(options: {
  initialization: AlternativeWorkerInitialization;
  tasks: Array<Omit<AlternativeWorkerTask, 'type'>>;
  workerCount: number;
  activeWorkers: Set<Worker>;
  onProgress: (progress: number, frontier: Array<[number, number]>) => void;
  workerPath?: string;
}): Promise<AlternativeAttemptOutcome[]> {
  const { initialization, tasks, activeWorkers, onProgress } = options;
  if (tasks.length === 0) return [];

  const workerPath = options.workerPath ?? require.resolve('./alternative-worker');
  const fractions = tasks.map(() => 0);
  const outcomes: AlternativeAttemptOutcome[] = [];

  return new Promise((resolve, reject) => {
    const workers: Worker[] = [];
    const assignedAttempts = new Map<Worker, number>();
    let nextTask = 0;
    let settledTasks = 0;
    let finished = false;

    const removeWorkers = (): void => {
      for (const worker of workers) activeWorkers.delete(worker);
    };

    const terminateWorkers = (): void => {
      for (const worker of workers) void worker.terminate();
      removeWorkers();
    };

    const fail = (error: Error): void => {
      if (finished) return;
      finished = true;
      terminateWorkers();
      reject(error);
    };

    const finishIfComplete = (): boolean => {
      if (settledTasks !== tasks.length) return false;
      finished = true;
      terminateWorkers();
      outcomes.sort((a, b) => a.attempt - b.attempt);
      resolve(outcomes);
      return true;
    };

    const dispatch = (worker: Worker): void => {
      if (nextTask >= tasks.length) return;
      const task = tasks[nextTask++];
      assignedAttempts.set(worker, task.attempt);
      worker.postMessage({ type: 'run', ...task } satisfies AlternativeWorkerTask);
    };

    const handleMessage = (worker: Worker, message: AlternativeWorkerMessage): void => {
      if (finished) return;
      if (message.type === 'fatal') {
        fail(new Error(`Route worker failed to initialize: ${message.error}`));
        return;
      }
      if (message.type === 'ready') {
        dispatch(worker);
        return;
      }
      if (message.type === 'progress') {
        fractions[message.attempt] = message.fraction;
        onProgress(aggregateAlternativeProgress(fractions), message.frontier);
        return;
      }
      const expectedAttempt = assignedAttempts.get(worker);
      if (expectedAttempt !== message.attempt) {
        fail(new Error(`Route worker returned attempt ${message.attempt}; expected ${expectedAttempt ?? 'none'}`));
        return;
      }
      assignedAttempts.delete(worker);
      fractions[message.attempt] = 1;
      settledTasks += 1;
      if (message.type === 'result') {
        outcomes.push({
          attempt: message.attempt,
          route: message.route,
          ...(message.routes ? { routes: message.routes } : {}),
          ...(message.warning ? { warning: message.warning } : {}),
        });
      } else {
        const error = new Error(message.error);
        if (message.reason) Object.assign(error, { reason: message.reason });
        outcomes.push({ attempt: message.attempt, error });
      }
      onProgress(aggregateAlternativeProgress(fractions), []);
      if (!finishIfComplete()) dispatch(worker);
    };

    for (let index = 0; index < options.workerCount; index++) {
      const worker = new Worker(workerPath, { workerData: initialization });
      workers.push(worker);
      activeWorkers.add(worker);
      worker.on('message', (message: AlternativeWorkerMessage) => handleMessage(worker, message));
      worker.on('error', (error) => fail(error));
      worker.on('exit', (code) => {
        activeWorkers.delete(worker);
        if (!finished) fail(new Error(`Route worker exited before completing its tasks (code ${code})`));
      });
    }
  });
}
