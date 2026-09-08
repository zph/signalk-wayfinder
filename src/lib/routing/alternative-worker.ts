// Worker-thread entry point for CPU-bound route-alternative attempts.

import { parentPort, workerData } from 'node:worker_threads';

// gdal-async's platform binary must be available before importing GRIB readers.
import '../ensure-gdal-binary';

import type { CurrentProvider, LandEdgeIndex, RegionIndex, RoutePoint } from '../../types';
import { loadCurrentGrib, loadGrib } from '../grib';
import { SingleFileCurrentProvider } from '../currentprovider';
import { loadGdalBathymetry } from '../gdal-bathymetry';
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
  depthProvider: Awaited<ReturnType<typeof loadGdalBathymetry>> | null;
}> {
  const gribEntries = await Promise.all(
    initialization.gribEntries.map(async (entry) => ({
      meta: entry.meta,
      data: await loadGrib(entry.path),
    })),
  );
  const wind = new MultiFileWindProvider(gribEntries);

  let current: CurrentProvider | null = null;
  if (initialization.currentEntry) {
    current = new SingleFileCurrentProvider({
      meta: initialization.currentEntry.meta,
      data: await loadCurrentGrib(initialization.currentEntry.path),
    });
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
  const depthProvider = initialization.bathymetry
    ? await loadGdalBathymetry(
        initialization.bathymetry.path,
        initialization.bathymetry.band,
        initialization.bathymetry.valueConvention,
      )
    : null;

  return {
    wind,
    current,
    routeLandIndex,
    shorelineIndex: initialization.needsShorelineIndex ? baseLandIndex : null,
    regionIndex,
    depthProvider,
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
          task.options,
          { shorelineIndex: context.shorelineIndex, depthProvider: context.depthProvider },
        );
        if (result.warning) warnings.push(`Leg ${leg + 1}: ${result.warning}`);
        fullRoute.push(...(leg === 0 ? result.route : result.route.slice(1)));
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
