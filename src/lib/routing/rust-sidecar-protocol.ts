import type { GribData, LatLon, PolarData, RoutePoint } from '../../types';

export const RUST_SIDECAR_PROTOCOL_VERSION = 1;

export interface RustSidecarCapabilities {
  openWaterWind: boolean;
  landAvoidance: boolean;
  currents: boolean;
  waves: boolean;
  passageConstraints: boolean;
  navigationSafety: boolean;
  transport: 'unix-ndjson-v1';
}

export interface RustWindGrid {
  sourcePath?: string;
  timesMs: number[];
  latMin: number;
  latStep: number;
  lonMin: number;
  lonStep: number;
  nLat: number;
  nLon: number;
  u10: number[][];
  v10: number[][];
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
  };
  polar: PolarData;
  wind: RustWindGrid;
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

export function serializeWindGrid(data: GribData, sourcePath?: string): RustWindGrid {
  return {
    ...(sourcePath ? { sourcePath } : {}),
    timesMs: data.times.map((time) => time.getTime()),
    latMin: data.latMin,
    latStep: data.latStep,
    lonMin: data.lonMin,
    lonStep: data.lonStep,
    nLat: data.nLat,
    nLon: data.nLon,
    u10: data.u10.map((frame) => Array.from(frame)),
    v10: data.v10.map((frame) => Array.from(frame)),
  };
}
