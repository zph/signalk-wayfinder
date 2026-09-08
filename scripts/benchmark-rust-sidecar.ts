import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

import type { GribData, GribFileEntry, LandPolygon, PolarData, RoutePoint } from '../src/types';
import { buildLandEdgeIndex, segmentCrossesLandFast } from '../src/lib/landmask';
import { IsochroneAlgorithm } from '../src/lib/routing/isochrone';
import { RustSidecarClient } from '../src/lib/routing/rust-sidecar-client';
import { serializeLandEdgeIndex, serializeWindGrid } from '../src/lib/routing/rust-sidecar-protocol';
import { MultiFileWindProvider } from '../src/lib/windprovider';

const iterations = positiveInteger(process.env.WAYFINDER_BENCH_ITERATIONS, 7);
const warmups = positiveInteger(process.env.WAYFINDER_BENCH_WARMUPS, 2);
const binary = path.resolve(process.env.WAYFINDER_RUST_SIDECAR_BIN ?? 'sidecar/target/release/wayfinder-core-sidecar');

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function percentile(samples: number[], quantile: number): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1)];
}

function metrics(samples: number[]): { meanMs: number; p50Ms: number; p95Ms: number; minMs: number; maxMs: number } {
  return {
    meanMs: samples.reduce((sum, sample) => sum + sample, 0) / samples.length,
    p50Ms: percentile(samples, 0.5),
    p95Ms: percentile(samples, 0.95),
    minMs: Math.min(...samples),
    maxMs: Math.max(...samples),
  };
}

async function waitForSidecar(client: RustSidecarClient, child: ChildProcess): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`sidecar exited with code ${child.exitCode}`);
    try {
      await client.hello();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  throw new Error('sidecar did not create its socket');
}

function assertClearRoute(route: RoutePoint[], land: ReturnType<typeof buildLandEdgeIndex>): void {
  for (let index = 1; index < route.length; index += 1) {
    const previous = route[index - 1];
    const point = route[index];
    assert.equal(
      segmentCrossesLandFast(land, previous.lat, previous.lon, point.lat, point.lon),
      false,
      `route leg ${index - 1} crosses the benchmark land polygon`,
    );
  }
}

const times = Array.from({ length: 37 }, (_, index) => new Date(Date.UTC(2024, 0, 1, index)));
const nLat = 41;
const nLon = 41;
const frameSize = nLat * nLon;
const grib: GribData = {
  times,
  latMin: 39,
  latStep: 0.1,
  lonMin: 9,
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
    latMin: 39,
    latMax: 43,
    lonMin: 9,
    lonMax: 13,
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
  bboxLatMin: 40.8,
  bboxLatMax: 41.2,
  bboxLonMin: 10.8,
  bboxLonMax: 11.2,
  exterior: new Float64Array([10.8, 40.8, 11.2, 40.8, 11.2, 41.2, 10.8, 41.2]),
};
const land = buildLandEdgeIndex([barrier]);
const request = {
  start: { lat: 40, lon: 10 },
  end: { lat: 42, lon: 12 },
  departureTime: times[0].toISOString(),
};
const options = {
  arrivalRadiusNm: 1,
  headingStep: 2,
  sectorSize: 0.5,
  coneHalfAngle: 100,
  coneDisableLookaheadNm: 100,
};
const windProvider = new MultiFileWindProvider([entry]);
const rustPayload = {
  request: {
    start: request.start,
    end: request.end,
    departureTimeMs: times[0].getTime(),
  },
  options,
  polar,
  windSources: [serializeWindGrid(grib, entry.meta.path, entry.meta)],
  land: serializeLandEdgeIndex(land),
  emitProgress: false,
};

async function calculateNode(): Promise<RoutePoint[]> {
  return (
    await new IsochroneAlgorithm().calculate(
      windProvider,
      null,
      polar,
      land,
      null,
      request,
      () => {},
      options,
    )
  ).route;
}

async function main(): Promise<void> {
  const directory = await mkdtemp(path.join(tmpdir(), 'wayfinder-rust-benchmark-'));
  const socket = path.join(directory, 'core.sock');
  const child = spawn(binary, ['--socket', socket], { stdio: ['ignore', 'pipe', 'pipe'] });
  const client = new RustSidecarClient(socket, 120_000);

  try {
    await waitForSidecar(client, child);
    for (let index = 0; index < warmups; index += 1) {
      await calculateNode();
      await client.calculate(rustPayload);
    }

    const nodeSamples: number[] = [];
    const rustSamples: number[] = [];
    const rustCalculationSamples: number[] = [];
    let nodeRoute: RoutePoint[] = [];
    let rustRoute: RoutePoint[] = [];
    for (let index = 0; index < iterations; index += 1) {
      let started = performance.now();
      nodeRoute = await calculateNode();
      nodeSamples.push(performance.now() - started);

      started = performance.now();
      const rustResult = await client.calculateDetailed(rustPayload);
      rustSamples.push(performance.now() - started);
      rustRoute = rustResult.route;
      rustCalculationSamples.push(rustResult.calculationMs);
    }

    assert.deepEqual(rustRoute[0] && { lat: rustRoute[0].lat, lon: rustRoute[0].lon }, request.start);
    assert.deepEqual(rustRoute.at(-1) && { lat: rustRoute.at(-1)!.lat, lon: rustRoute.at(-1)!.lon }, request.end);
    assertClearRoute(nodeRoute, land);
    assertClearRoute(rustRoute, land);
    const arrivalDeltaMs = Math.abs(rustRoute.at(-1)!.time.getTime() - nodeRoute.at(-1)!.time.getTime());
    assert.ok(arrivalDeltaMs <= 3_600_000, `arrival time differs by ${arrivalDeltaMs} ms`);

    const node = metrics(nodeSamples);
    const rust = metrics(rustSamples);
    const rustCalculation = metrics(rustCalculationSamples);
    const report = {
      fixture: {
        grid: `${nLat}x${nLon}x${times.length}`,
        routeDistanceClass: 'approximately 150 nautical miles with a blocking land polygon',
        headingStepDeg: options.headingStep,
        sectorSizeDeg: options.sectorSize,
      },
      iterations,
      warmups,
      node,
      rustEndToEnd: rust,
      rustCalculation,
      p50EndToEndSpeedup: node.p50Ms / rust.p50Ms,
      p50CalculationSpeedup: node.p50Ms / rustCalculation.p50Ms,
      arrivalDeltaSeconds: arrivalDeltaMs / 1_000,
      nodeRoutePoints: nodeRoute.length,
      rustRoutePoints: rustRoute.length,
      note: 'Rust end-to-end timing includes Unix-socket setup plus NDJSON serialization and parsing; calculation timing is measured inside the sidecar with progress emission disabled.',
    };
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } finally {
    child.kill('SIGTERM');
    await new Promise<void>((resolve) => child.once('exit', () => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
