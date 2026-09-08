// Worker-thread entry point for CPU-bound route-alternative attempts.

import { parentPort, workerData } from 'node:worker_threads';

import type { CurrentProvider, LandEdgeIndex, RegionIndex, RoutePoint } from '../../types';
import { SingleFileCurrentProvider } from '../currentprovider';
import { routeUnderwayBudget } from '../passage-constraints';
import { MultiFileWindProvider } from '../windprovider';
import { loadBundledDilatedIndex, loadBundledEdgeIndex, loadHiresDilatedIndex, loadHiresEdgeIndex } from '../setup';
import { IsochroneAlgorithm } from './isochrone';
import type {
  AlternativeWorkerInitialization,
  AlternativeWorkerMessage,
  AlternativeWorkerTask,
} from './alternative-worker-protocol';

if (!parentPort) throw new Error('Alternative worker requires a parent port');

const initialization = workerData as AlternativeWorkerInitialization;
const algorithm = new IsochroneAlgorithm();

function post(message: AlternativeWorkerMessage): void {
  parentPort!.postMessage(message);
}

function loadBaseLandIndex(): LandEdgeIndex {
  return initialization.hiresLand
    ? loadHiresEdgeIndex(initialization.dataDir)
    : loadBundledEdgeIndex(initialization.dataDir);
}

function loadDilatedLandIndex(): LandEdgeIndex {
  return initialization.hiresLand
    ? loadHiresDilatedIndex(initialization.dataDir)
    : loadBundledDilatedIndex(initialization.dataDir);
}

async function initialize(): Promise<{
  wind: MultiFileWindProvider;
  current: CurrentProvider | null;
  routeLandIndex: LandEdgeIndex | null;
  shorelineIndex: LandEdgeIndex | null;
  regionIndex: RegionIndex | null;
}> {
  const wind = new MultiFileWindProvider(initialization.gribEntries);

  let current: CurrentProvider | null = null;
  if (initialization.currentEntry) {
    current = new SingleFileCurrentProvider(initialization.currentEntry);
  }

  let baseLandIndex: LandEdgeIndex | null = null;
  let routeLandIndex: LandEdgeIndex | null = null;
  if (initialization.routeLandMode === 'base' || initialization.needsShorelineIndex) {
    baseLandIndex = loadBaseLandIndex();
  }
  if (initialization.routeLandMode === 'base') routeLandIndex = baseLandIndex;
  if (initialization.routeLandMode === 'dilated') routeLandIndex = loadDilatedLandIndex();

  const regionIndex: RegionIndex | null =
    initialization.regions.length > 0 ? { regions: new Map(initialization.regions) } : null;
  return {
    wind,
    current,
    routeLandIndex,
    shorelineIndex: initialization.needsShorelineIndex ? baseLandIndex : null,
    regionIndex,
  };
}

async function main(): Promise<void> {
  const context = await initialize();
  post({ type: 'ready' });

  parentPort!.on('message', async (task: AlternativeWorkerTask) => {
    if (task.type !== 'run') return;
    try {
      const fullRoute: RoutePoint[] = [];
      const warnings: string[] = [];
      const legCount = initialization.points.length - 1;
      let continuationOptions = task.options;
      for (let leg = 0; leg < legCount; leg++) {
        const result = await algorithm.calculate(
          context.wind,
          context.current,
          initialization.polar,
          context.routeLandIndex,
          context.regionIndex,
          {
            ...initialization.request,
            start: initialization.points[leg],
            end: initialization.points[leg + 1],
            departureTime: leg === 0 ? initialization.request.departureTime : fullRoute.at(-1)!.time.toISOString(),
          },
          (pct, frontier) =>
            post({
              type: 'progress',
              attempt: task.attempt,
              fraction: (leg + pct / 100) / legCount,
              frontier,
            }),
          continuationOptions,
          { shorelineIndex: context.shorelineIndex, depthProvider: null },
        );
        if (result.warning) warnings.push(`Leg ${leg + 1}: ${result.warning}`);
        fullRoute.push(...(leg === 0 ? result.route : result.route.slice(1)));
        const passageDeparture = fullRoute[0].time;
        const passageBudget = routeUnderwayBudget(
          fullRoute,
          passageDeparture,
          Number(task.options.maxHoursPerDay ?? 0),
        );
        if (!passageBudget.allowed) throw new Error('A route leg exceeded the configured daily underway limit');
        continuationOptions = {
          ...task.options,
          passageDepartureTime: passageDeparture.toISOString(),
          initialPassageDayIndex: passageBudget.passageDayIndex,
          initialUnderwayHoursToday: passageBudget.hoursToday,
        };
      }
      post({
        type: 'result',
        attempt: task.attempt,
        route: fullRoute,
        ...(warnings.length > 0 ? { warning: warnings.join('; ') } : {}),
      });
    } catch (error) {
      const candidateError = error instanceof Error ? error : new Error(String(error));
      post({
        type: 'taskError',
        attempt: task.attempt,
        error: candidateError.message,
        ...('reason' in candidateError && typeof candidateError.reason === 'string'
          ? { reason: candidateError.reason }
          : {}),
      });
    }
  });
}

main().catch((error) => {
  post({ type: 'fatal', error: error instanceof Error ? error.message : String(error) });
});
