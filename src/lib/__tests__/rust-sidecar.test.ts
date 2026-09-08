import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import type { GribData, GribFileEntry, PolarData } from '../../types';
import { RustSidecarClient } from '../routing/rust-sidecar-client';
import { serializeWindGrid } from '../routing/rust-sidecar-protocol';
import { IsochroneAlgorithm } from '../routing/isochrone';
import { MultiFileWindProvider } from '../windprovider';

const binary = process.env.WAYFINDER_RUST_SIDECAR_BIN;

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

test('Rust sidecar negotiates capabilities and calculates an open-water route', { skip: !binary }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'wayfinder-rust-sidecar-'));
  const socket = path.join(directory, 'core.sock');
  const child = spawn(path.resolve(binary!), ['--socket', socket], { stdio: ['ignore', 'pipe', 'pipe'] });
  const client = new RustSidecarClient(socket, 5_000);
  try {
    await waitForSidecar(client, child);
    const hello = await client.hello();
    assert.equal(hello.capabilities.openWaterWind, true);
    assert.equal(hello.capabilities.landAvoidance, false);

    const times = Array.from({ length: 8 }, (_, index) => new Date(Date.UTC(2024, 0, 1, index)));
    const frameSize = 25;
    const grib: GribData = {
      times,
      latMin: 40,
      latStep: 0.5,
      lonMin: 10,
      lonStep: 0.5,
      nLat: 5,
      nLon: 5,
      u10: times.map(() => new Float32Array(frameSize)),
      v10: times.map(() => new Float32Array(frameSize).fill(5)),
    };
    const polar: PolarData = {
      tws: [1, 30],
      twa: [0, 45, 90, 135, 180],
      speeds: [
        [0, 0],
        [5, 5],
        [5, 5],
        [5, 5],
        [5, 5],
      ],
    };
    const progress: number[] = [];
    const route = await client.calculate(
      {
        request: {
          start: { lat: 41, lon: 11 },
          end: { lat: 41.2, lon: 11 },
          departureTimeMs: times[0].getTime(),
        },
        options: { arrivalRadiusNm: 1 },
        polar,
        wind: serializeWindGrid(grib, 'fixture.grib2'),
      },
      (percent) => progress.push(percent),
    );

    assert.equal(route[0].lat, 41);
    assert.equal(route.at(-1)?.lat, 41.2);
    assert.equal(route.at(-1)?.gribFilePath, 'fixture.grib2');
    assert.ok(route.every((point) => point.time instanceof Date));
    assert.equal(progress.at(-1), 100);

    const entry: GribFileEntry = {
      meta: {
        path: 'fixture.grib2',
        mtime: 0,
        type: 'wind',
        latMin: 40,
        latMax: 42,
        lonMin: 10,
        lonMax: 12,
        latStep: 0.5,
        lonStep: 0.5,
        timeStart: times[0],
        timeEnd: times.at(-1)!,
        nTimes: times.length,
        referenceTime: times[0],
      },
      data: grib,
    };
    const nodeRoute = await new IsochroneAlgorithm().calculate(
      new MultiFileWindProvider([entry]),
      null,
      polar,
      null,
      null,
      {
        start: { lat: 41, lon: 11 },
        end: { lat: 41.2, lon: 11 },
        departureTime: times[0].toISOString(),
      },
      () => {},
      { arrivalRadiusNm: 1 },
    );
    assert.ok(Math.abs(route.at(-1)!.time.getTime() - nodeRoute.route.at(-1)!.time.getTime()) < 1_000);
    assert.equal(route.length, nodeRoute.route.length);
  } finally {
    child.kill('SIGTERM');
    await new Promise<void>((resolve) => child.once('exit', () => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
