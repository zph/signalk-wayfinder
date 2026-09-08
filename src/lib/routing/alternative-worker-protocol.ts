import type {
  CalculationRequest,
  CurrentGribData,
  GribData,
  GribFileMeta,
  LandEdgeIndex,
  LatLon,
  PolarData,
  RegionRing,
  RoutePoint,
} from '../../types';

export type WorkerLandMode = 'none' | 'base' | 'dilated';

export interface AlternativeWorkerInitialization {
  gribEntries: Array<{ meta: GribFileMeta; data: GribData }>;
  currentEntry?: { meta: GribFileMeta; data: CurrentGribData };
  polar: PolarData;
  dataDir: string;
  hiresLand: boolean;
  routeLandMode: WorkerLandMode;
  inlineLandIndex?: LandEdgeIndex;
  needsShorelineIndex: boolean;
  regions: Array<[string, RegionRing]>;
  request: CalculationRequest;
  points: LatLon[];
}

export interface AlternativeWorkerTask {
  type: 'run';
  attempt: number;
  options: Record<string, unknown>;
}

export type AlternativeWorkerMessage =
  | { type: 'ready' }
  | { type: 'progress'; attempt: number; fraction: number; frontier: Array<[number, number]> }
  | { type: 'result'; attempt: number; route: RoutePoint[]; warning?: string }
  | { type: 'taskError'; attempt: number; error: string; reason?: string }
  | { type: 'fatal'; error: string };
