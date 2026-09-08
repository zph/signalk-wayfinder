import type {
  CurrentGribData,
  GribData,
  GribFileEntry,
  GribFileMeta,
  LatLon,
  PolarData,
  RoutePoint,
} from '../../types';

export const RUST_SIDECAR_PROTOCOL_VERSION = 2;

export interface RustSidecarCapabilities {
  openWaterWind: boolean;
  landAvoidance: boolean;
  currents: boolean;
  waves: boolean;
  multipleWindSources: boolean;
  motorFallback: boolean;
  waitForWind: boolean;
  passageConstraints: boolean;
  navigationSafety: boolean;
  transport: 'unix-ndjson-v1';
}

export interface RustWindGrid {
  sourcePath?: string;
  referenceTimeMs: number;
  mtimeMs: number;
  timesMs: number[];
  latMin: number;
  latStep: number;
  lonMin: number;
  lonStep: number;
  nLat: number;
  nLon: number;
  u10: number[][];
  v10: number[][];
  wave?: RustScalarGrid;
}

export interface RustScalarGrid {
  timesMs: number[];
  latMin: number;
  latStep: number;
  lonMin: number;
  lonStep: number;
  nLat: number;
  nLon: number;
  values: number[][];
}

export interface RustCurrentGrid {
  timesMs: number[];
  latMin: number;
  latStep: number;
  lonMin: number;
  lonStep: number;
  nLat: number;
  nLon: number;
  u: number[][];
  v: number[][];
}

export interface RustCalculatePayload {
  request: { start: LatLon; end: LatLon; departureTimeMs: number };
  options: {
    headingStep?: number;
    sectorSize?: number;
    minBoatSpeed?: number;
    arrivalRadiusNm?: number;
    coneHalfAngle?: number;
    maxHeadingChange?: number;
    headingOffsetDeg?: number;
    maxWindKn?: number;
    maxWaveM?: number;
    motorSpeedKn?: number;
    motorBelowKn?: number;
    forceMotor?: boolean;
    waitForWind?: boolean;
  };
  polar: PolarData;
  windSources: RustWindGrid[];
  current?: RustCurrentGrid;
}

export type RustSidecarResponse =
  | {
      type: 'hello';
      protocolVersion: number;
      requestId: string;
      engineVersion: string;
      capabilities: RustSidecarCapabilities;
    }
  | { type: 'progress'; protocolVersion: number; requestId: string; percent: number; frontier: LatLon[] }
  | {
      type: 'result';
      protocolVersion: number;
      requestId: string;
      route: Array<Omit<RoutePoint, 'time'> & { timeMs: number }>;
    }
  | { type: 'error'; protocolVersion: number; requestId: string; code: string; message: string };

export function serializeWindGrid(
  data: GribData,
  sourcePath?: string,
  metadata?: Pick<GribFileMeta, 'referenceTime' | 'mtime'>,
): RustWindGrid {
  const waveEntries = data.swhByTime ? [...data.swhByTime.entries()].sort(([a], [b]) => a - b) : [];
  const waveGrid = data.swhGrid ?? data;
  return {
    ...(sourcePath ? { sourcePath } : {}),
    referenceTimeMs: metadata?.referenceTime.getTime() ?? data.times[0].getTime(),
    mtimeMs: metadata?.mtime ?? 0,
    timesMs: data.times.map((time) => time.getTime()),
    latMin: data.latMin,
    latStep: data.latStep,
    lonMin: data.lonMin,
    lonStep: data.lonStep,
    nLat: data.nLat,
    nLon: data.nLon,
    u10: data.u10.map((frame) => Array.from(frame)),
    v10: data.v10.map((frame) => Array.from(frame)),
    ...(waveEntries.length > 0
      ? {
          wave: {
            timesMs: waveEntries.map(([time]) => time),
            latMin: waveGrid.latMin,
            latStep: waveGrid.latStep,
            lonMin: waveGrid.lonMin,
            lonStep: waveGrid.lonStep,
            nLat: waveGrid.nLat,
            nLon: waveGrid.nLon,
            values: waveEntries.map(([, frame]) => Array.from(frame)),
          },
        }
      : {}),
  };
}

export function serializeCurrentGrid(data: CurrentGribData): RustCurrentGrid {
  return {
    timesMs: data.times.map((time) => time.getTime()),
    latMin: data.latMin,
    latStep: data.latStep,
    lonMin: data.lonMin,
    lonStep: data.lonStep,
    nLat: data.nLat,
    nLon: data.nLon,
    u: data.u.map((frame) => Array.from(frame)),
    v: data.v.map((frame) => Array.from(frame)),
  };
}

export function serializeWindSources(entries: GribFileEntry[]): RustWindGrid[] {
  return entries.map((entry) => {
    if (!entry.data) throw new Error(`Cannot serialize unloaded GRIB source: ${entry.meta.path}`);
    return serializeWindGrid(entry.data, entry.meta.path, entry.meta);
  });
}
