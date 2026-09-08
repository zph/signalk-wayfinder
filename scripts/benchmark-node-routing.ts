import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';

import type { GribData, GribFileEntry, LandEdgeIndex, LandPolygon, PolarData, RoutePoint } from '../src/types';
import { haversineNM } from '../src/lib/geo';
import { buildLandEdgeIndex, segmentCrossesLandBatch, segmentsIntersect } from '../src/lib/landmask';
import { IsochroneAlgorithm } from '../src/lib/routing/isochrone';
import { MultiFileWindProvider } from '../src/lib/windprovider';

const iterations = positiveInteger(process.env.WAYFINDER_BENCH_ITERATIONS, 7);
const warmups = positiveInteger(process.env.WAYFINDER_BENCH_WARMUPS, 2);

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function metrics(samples: number[]): { meanMs: number; p50Ms: number; p95Ms: number; minMs: number; maxMs: number } {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (quantile: number) => sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1)];
  return {
    meanMs: samples.reduce((sum, value) => sum + value, 0) / samples.length,
    p50Ms: at(0.5),
    p95Ms: at(0.95),
    minMs: sorted[0],
    maxMs: sorted.at(-1)!,
  };
}

function averageRouteSeparationNm(a: RoutePoint[], b: RoutePoint[]): number {
  const samples = Math.min(12, Math.max(2, Math.min(a.length, b.length)));
  let total = 0;
  for (let sample = 1; sample < samples - 1; sample++) {
    const fraction = sample / (samples - 1);
    const pointA = a[Math.round(fraction * (a.length - 1))];
    const pointB = b[Math.round(fraction * (b.length - 1))];
    total += haversineNM(pointA.lat, pointA.lon, pointB.lat, pointB.lon);
  }
  return total / Math.max(1, samples - 2);
}

function minimumSeparationNm(routes: RoutePoint[][]): number {
  if (routes.length < 2) return 0;
  let result = Infinity;
  for (let first = 0; first < routes.length; first++) {
    for (let second = first + 1; second < routes.length; second++) {
      result = Math.min(result, averageRouteSeparationNm(routes[first], routes[second]));
    }
  }
  return result;
}

const times = Array.from({ length: 97 }, (_, index) => new Date(Date.UTC(2024, 0, 1, index)));
const nLat = 81;
const nLon = 81;
const frameSize = nLat * nLon;
const grib: GribData = {
  times,
  latMin: 38,
  latStep: 0.1,
  lonMin: 8,
  lonStep: 0.1,
  nLat,
  nLon,
  u10: times.map(() => new Float32Array(frameSize).fill(2)),
  v10: times.map(() => new Float32Array(frameSize).fill(5)),
};
const entry: GribFileEntry = {
  meta: {
    path: 'benchmark-wind.grib2',
    mtime: 0,
    type: 'wind',
    latMin: 38,
    latMax: 46,
    lonMin: 8,
    lonMax: 16,
    latStep: 0.1,
    lonStep: 0.1,
    timeStart: times[0],
    timeEnd: times.at(-1)!,
    nTimes: times.length,
    referenceTime: times[0],
  },
  data: grib,
};
const polar: PolarData = {
  tws: [1, 30],
  twa: [0, 35, 60, 90, 120, 150, 180],
  speeds: [
    [0, 0],
    [5, 5],
    [6, 6],
    [7, 7],
    [7, 7],
    [6, 6],
    [5, 5],
  ],
};
const barrier: LandPolygon = {
  bboxLatMin: 42.3,
  bboxLatMax: 42.7,
  bboxLonMin: 12.3,
  bboxLonMax: 12.7,
  exterior: new Float64Array([12.3, 42.3, 12.7, 42.3, 12.7, 42.7, 12.3, 42.7]),
};
const land = buildLandEdgeIndex([barrier]);
const wind = new MultiFileWindProvider([entry]);
const request = { start: { lat: 40, lon: 10 }, end: { lat: 45, lon: 15 }, departureTime: times[0].toISOString() };
const options = {
  arrivalRadiusNm: 1,
  headingStep: 2,
  sectorSize: 0.5,
  coneHalfAngle: 100,
  coneDisableLookaheadNm: 100,
  sharedAlternativeCount: 10,
};

async function calculate(extra: Record<string, unknown>): Promise<RoutePoint[][]> {
  const result = await new IsochroneAlgorithm().calculate(wind, null, polar, land, null, request, () => {}, {
    ...options,
    ...extra,
  });
  const routes = result.alternatives ?? [result.route];
  for (const route of routes) {
    assert.deepEqual(route[0] && { lat: route[0].lat, lon: route[0].lon }, request.start);
    assert.deepEqual(route.at(-1) && { lat: route.at(-1)!.lat, lon: route.at(-1)!.lon }, request.end);
  }
  return routes;
}

async function benchmarkRouteMode(extra: Record<string, unknown>): Promise<{
  timing: ReturnType<typeof metrics>;
  routesReturned: number;
  minimumRouteSeparationNm: number;
  primaryArrivalHours: number;
}> {
  for (let index = 0; index < warmups; index++) await calculate(extra);
  const samples: number[] = [];
  let routes: RoutePoint[][] = [];
  for (let index = 0; index < iterations; index++) {
    const started = performance.now();
    routes = await calculate(extra);
    samples.push(performance.now() - started);
  }
  return {
    timing: metrics(samples),
    routesReturned: routes.length,
    minimumRouteSeparationNm: minimumSeparationNm(routes),
    primaryArrivalHours: (routes[0].at(-1)!.time.getTime() - routes[0][0].time.getTime()) / 3_600_000,
  };
}

async function calculateHighArrival(): Promise<RoutePoint[][]> {
  const result = await new IsochroneAlgorithm().calculate(
    wind,
    null,
    polar,
    null,
    null,
    {
      start: { lat: 40, lon: 10 },
      end: { lat: 40.12, lon: 10 },
      departureTime: times[0].toISOString(),
    },
    () => {},
    { arrivalRadiusNm: 5, headingStep: 5, sectorSize: 1, sharedAlternativeCount: 5 },
  );
  return result.alternatives ?? [result.route];
}

async function benchmarkHighArrival(): Promise<{
  timing: ReturnType<typeof metrics>;
  routesReturned: number;
}> {
  for (let index = 0; index < warmups; index++) await calculateHighArrival();
  const samples: number[] = [];
  let routes: RoutePoint[][] = [];
  for (let index = 0; index < iterations; index++) {
    const started = performance.now();
    routes = await calculateHighArrival();
    samples.push(performance.now() - started);
  }
  return { timing: metrics(samples), routesReturned: routes.length };
}

function edgeCellKey(latCell: number, lonCell: number): number {
  return (latCell + 900) * 3600 + (((lonCell % 3600) + 3600) % 3600);
}

function legacySegmentCrosses(index: LandEdgeIndex, lat1: number, lon1: number, lat2: number, lon2: number): boolean {
  const cellSize = 0.1;
  let latCell = Math.floor(lat1 / cellSize);
  let lonCell = Math.floor(lon1 / cellSize);
  const latEnd = Math.floor(lat2 / cellSize);
  const lonEnd = Math.floor(lon2 / cellSize);
  const dLat = lat2 - lat1;
  const dLon = lon2 - lon1;
  const sLat = dLat > 0 ? 1 : dLat < 0 ? -1 : 0;
  const sLon = dLon > 0 ? 1 : dLon < 0 ? -1 : 0;
  const tDLat = sLat !== 0 ? Math.abs(cellSize / dLat) : Infinity;
  const tDLon = sLon !== 0 ? Math.abs(cellSize / dLon) : Infinity;
  let tMLat =
    sLat > 0 ? ((latCell + 1) * cellSize - lat1) / dLat : sLat < 0 ? (latCell * cellSize - lat1) / dLat : Infinity;
  let tMLon =
    sLon > 0 ? ((lonCell + 1) * cellSize - lon1) / dLon : sLon < 0 ? (lonCell * cellSize - lon1) / dLon : Infinity;
  const maxCells = Math.abs(latEnd - latCell) + Math.abs(lonEnd - lonCell) + 1;
  for (let step = 0; step < maxCells; step++) {
    const entries = index.edgeGrid.get(edgeCellKey(latCell, lonCell));
    if (entries) {
      for (let i = 0; i < entries.length; i += 3) {
        const polygon = index.polygons[entries[i]];
        const ring = entries[i + 1] === 0 ? polygon.exterior : polygon.interiors?.[entries[i + 1] - 1];
        if (!ring) continue;
        const edge = entries[i + 2];
        const next = edge + 1 < ring.length / 2 ? edge + 1 : 0;
        if (
          segmentsIntersect(
            lon1,
            lat1,
            lon2,
            lat2,
            ring[edge * 2],
            ring[edge * 2 + 1],
            ring[next * 2],
            ring[next * 2 + 1],
          )
        )
          return true;
      }
    }
    if (latCell === latEnd && lonCell === lonEnd) break;
    if (tMLat < tMLon) {
      tMLat += tDLat;
      latCell += sLat;
    } else {
      tMLon += tDLon;
      lonCell += sLon;
    }
  }
  return false;
}

function makeComplexCoast(): LandEdgeIndex {
  const vertices = 2_000;
  const ring = new Float64Array(vertices * 2);
  for (let index = 0; index < vertices; index++) {
    const angle = (index / vertices) * Math.PI * 2;
    const radius = 0.8 + Math.sin(angle * 37) * 0.08;
    ring[index * 2] = Math.cos(angle) * radius;
    ring[index * 2 + 1] = Math.sin(angle) * radius;
  }
  return buildLandEdgeIndex([
    { bboxLatMin: -0.88, bboxLatMax: 0.88, bboxLonMin: -0.88, bboxLonMax: 0.88, exterior: ring },
  ]);
}

function benchmarkShoreline(): {
  legacy: ReturnType<typeof metrics>;
  compiledBatch: ReturnType<typeof metrics>;
  p50Speedup: number;
} {
  const coast = makeComplexCoast();
  const count = 256;
  const lat = new Float64Array(count);
  const lon = new Float64Array(count).fill(1.5);
  const blocked = new Uint8Array(count);
  for (let index = 0; index < count; index++) lat[index] = -1.2 + (2.4 * index) / (count - 1);
  segmentCrossesLandBatch(coast, 0, -1.5, lat, lon, count, blocked);
  const expected = [...lat].map((endLat, index) => (legacySegmentCrosses(coast, 0, -1.5, endLat, lon[index]) ? 1 : 0));
  assert.deepEqual([...blocked], expected);
  const legacySamples: number[] = [];
  const compiledSamples: number[] = [];
  for (let iteration = 0; iteration < iterations; iteration++) {
    let started = performance.now();
    for (let repeat = 0; repeat < 100; repeat++) {
      for (let candidate = 0; candidate < count; candidate++)
        legacySegmentCrosses(coast, 0, -1.5, lat[candidate], lon[candidate]);
    }
    legacySamples.push(performance.now() - started);
    started = performance.now();
    for (let repeat = 0; repeat < 100; repeat++) segmentCrossesLandBatch(coast, 0, -1.5, lat, lon, count, blocked);
    compiledSamples.push(performance.now() - started);
  }
  const legacy = metrics(legacySamples);
  const compiledBatch = metrics(compiledSamples);
  return { legacy, compiledBatch, p50Speedup: legacy.p50Ms / compiledBatch.p50Ms };
}

async function main(): Promise<void> {
  const shoreline = benchmarkShoreline();
  const highArrival = await benchmarkHighArrival();
  const exact = await benchmarkRouteMode({ coarseToFine: false, speculativeHeadingStride: 1 });
  const singleCorridor = await benchmarkRouteMode({ coarseToFine: true, coarseCorridorCount: 1 });
  const multipleCorridors = await benchmarkRouteMode({ coarseToFine: true, coarseCorridorCount: 4 });
  process.stdout.write(
    `${JSON.stringify({ iterations, warmups, fixture: '375 nm, 81x81x97 wind grid, blocking island, 10 alternatives', shoreline, highArrival, exact, singleCorridor, multipleCorridors, p50MultiVsExactSpeedup: exact.timing.p50Ms / multipleCorridors.timing.p50Ms, p50MultiVsSingleRatio: singleCorridor.timing.p50Ms / multipleCorridors.timing.p50Ms }, null, 2)}\n`,
  );
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
