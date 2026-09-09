import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';

import type { GribFileMeta, PolarData, WindProvider } from '../../types';
import { haversineNM } from '../geo';
import { assessRouteQuality } from '../route-quality';
import { IsochroneAlgorithm } from '../routing/isochrone';
import { loadBundledEdgeIndex } from '../setup';

const departure = new Date('2026-09-09T12:00:00Z');
const forecastEnd = new Date('2026-09-16T12:00:00Z');
const motorSpeedKn = 6;
const minimumShoreDistanceNm = 0.5;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wayfinder-known-routes-'));
const land = loadBundledEdgeIndex(dataDir);

const wind: WindProvider = {
  times: [departure, forecastEnd],
  getWind: () => ({ u: 0, v: 6 }),
  getWave: () => 1,
  coversPoint: () => true,
  coversPointAtTime: () => true,
  getFilePathForPoint: () => 'known-routes.grib2',
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

const gribMeta: GribFileMeta = {
  path: 'known-routes.grib2',
  mtime: 0,
  type: 'wind',
  latMin: 30,
  latMax: 45,
  lonMin: -130,
  lonMax: -115,
  latStep: 1,
  lonStep: 1,
  timeStart: departure,
  timeEnd: forecastEnd,
  nTimes: 2,
  referenceTime: departure,
  hasWave: true,
};

const fixtures = [
  {
    name: 'open ocean southwest of San Francisco',
    start: { lat: 37.5, lon: -123.0 },
    end: { lat: 36.8, lon: -122.6 },
    maximumDetourRatio: 1.15,
  },
  {
    name: 'coastal passage from Half Moon Bay to Monterey Bay',
    start: { lat: 37.49, lon: -122.53 },
    end: { lat: 36.65, lon: -122.0 },
    maximumDetourRatio: 1.15,
  },
  {
    name: 'Sausalito to Monterey through the Golden Gate',
    start: { lat: 37.84, lon: -122.47 },
    end: { lat: 36.62, lon: -121.97 },
    maximumDetourRatio: 1.25,
  },
] as const;

for (const fixture of fixtures) {
  test(`known-good route: ${fixture.name}`, { timeout: 10_000 }, async () => {
    const result = await new IsochroneAlgorithm().calculate(
      wind,
      null,
      polar,
      land,
      null,
      {
        start: fixture.start,
        end: fixture.end,
        departureTime: departure.toISOString(),
      },
      () => {},
      {
        coarseToFine: true,
        forceMotor: true,
        motorSpeedKn,
        minimumShoreDistanceNm,
      },
      { shorelineIndex: land, depthProvider: null },
    );

    const quality = assessRouteQuality(result.route, {
      start: fixture.start,
      end: fixture.end,
      polar,
      landIndex: land,
      shorelineIndex: land,
      regionIndex: null,
      avoidRegionIds: new Set(),
      useLandAvoidance: true,
      gribFiles: [gribMeta],
      forecastSkillHorizonHours: 168,
      motorSpeedKn,
      motorBelowKn: 0,
      daylightOnly: false,
      maxHoursPerDay: 0,
      depthProvider: null,
      navigationConstraints: {
        minimumDepthM: 0,
        minimumShoreDistanceNm,
        maximumOffshoreDistanceNm: 0,
      },
    });

    const directDistanceNm = haversineNM(
      fixture.start.lat,
      fixture.start.lon,
      fixture.end.lat,
      fixture.end.lon,
    );
    const elapsedHours =
      (result.route.at(-1)!.time.getTime() - result.route[0].time.getTime()) / 3_600_000;

    assert.equal(result.warning, undefined);
    assert.equal(result.route.at(-1)?.lat, fixture.end.lat);
    assert.equal(result.route.at(-1)?.lon, fixture.end.lon);
    assert.equal(quality.valid, true, quality.issues.map((issue) => issue.message).join(' '));
    assert.ok(quality.metrics.pointCount > 2 && quality.metrics.pointCount < 300);
    assert.ok(quality.metrics.totalDistanceNm >= directDistanceNm);
    assert.ok(quality.metrics.totalDistanceNm <= directDistanceNm * fixture.maximumDetourRatio);
    assert.ok(Math.abs(elapsedHours - quality.metrics.totalDistanceNm / motorSpeedKn) < 0.001);
    assert.ok(result.route.some((point) => point.shoreClearanceEstablished));
    assert.ok(result.route.slice(1).every((point) => point.propulsion === 'motor'));
    assert.ok(result.route.every((point, index) => index === 0 || point.time > result.route[index - 1].time));
  });
}
