import type {
  CurrentGribData,
  GribData,
  GribFileEntry,
  GribFileMeta,
  LandEdgeIndex,
  LatLon,
  PolarData,
  RegionIndex,
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

export interface RustLandPolygon {
  bboxLatMin: number;
  bboxLatMax: number;
  bboxLonMin: number;
  bboxLonMax: number;
  exterior: number[];
  interiors: number[][];
}

export interface RustLandEdgeIndex {
  polygons: RustLandPolygon[];
  edgeGrid: Record<string, number[]>;
  polyGrid: Record<string, number[]>;
}

export interface RustAvoidedRegion {
  bboxLatMin: number;
  bboxLatMax: number;
  bboxLonMin: number;
  bboxLonMax: number;
  exterior: number[];
}

export interface RustCalculatePayload {
  request: { start: LatLon; end: LatLon; departureTimeMs: number };
  options: {
    headingStep?: number;
    sectorSize?: number;
    minBoatSpeed?: number;
    arrivalRadiusNm?: number;
    coneHalfAngle?: number;
    coneDisableLookaheadNm?: number;
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
  land?: RustLandEdgeIndex;
  avoidedRegions?: RustAvoidedRegion[];
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

export function serializeLandEdgeIndex(index: LandEdgeIndex): RustLandEdgeIndex {
  return {
    polygons: index.polygons.map((polygon) => ({
      bboxLatMin: polygon.bboxLatMin,
      bboxLatMax: polygon.bboxLatMax,
      bboxLonMin: polygon.bboxLonMin,
      bboxLonMax: polygon.bboxLonMax,
      exterior: Array.from(polygon.exterior),
      interiors: (polygon.interiors ?? []).map((ring) => Array.from(ring)),
    })),
    edgeGrid: Object.fromEntries([...index.edgeGrid].map(([key, entries]) => [String(key), Array.from(entries)])),
    polyGrid: Object.fromEntries([...index.polyGrid].map(([key, entries]) => [String(key), entries])),
  };
}

export function serializeAvoidedRegions(index: RegionIndex, avoidIds: Iterable<string>): RustAvoidedRegion[] {
  const selected = new Set(avoidIds);
  const regions: RustAvoidedRegion[] = [];
  for (const [key, ring] of index.regions) {
    const uuid = key.includes('__') ? key.split('__')[0] : key;
    if (!selected.has(uuid)) continue;
    regions.push({
      bboxLatMin: ring.bboxLatMin,
      bboxLatMax: ring.bboxLatMax,
      bboxLonMin: ring.bboxLonMin,
      bboxLonMax: ring.bboxLonMax,
      exterior: Array.from(ring.exterior),
    });
  }
  return regions;
}
