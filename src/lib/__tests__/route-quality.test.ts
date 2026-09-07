import assert from 'node:assert/strict';
import test from 'node:test';
import { DepthProvider, LandPolygon, PolarData, RoutePoint } from '../../types';
import { buildLandEdgeIndex } from '../landmask';
import { assessRouteQuality, RouteQualityContext } from '../route-quality';

const polar: PolarData = {
  tws: [6, 20],
  twa: [45, 90, 135, 180],
  speeds: [
    [4, 6],
    [5, 8],
    [5, 8],
    [4, 6],
  ],
};

function point(overrides: Partial<RoutePoint> = {}): RoutePoint {
  return {
    lat: 58.6,
    lon: 19,
    time: new Date('2026-06-06T06:00:00Z'),
    heading: 90,
    twa: 90,
    tws: 10,
    boatSpeed: 6,
    windDir: 180,
    legCalcMs: 1,
    gribFilePath: '/forecast.grb2',
    ...overrides,
  };
}

function context(overrides: Partial<RouteQualityContext> = {}): RouteQualityContext {
  return {
    start: { lat: 58.6, lon: 19 },
    end: { lat: 58.6, lon: 19.1 },
    polar,
    landIndex: null,
    shorelineIndex: null,
    regionIndex: null,
    avoidRegionIds: new Set(),
    useLandAvoidance: true,
    gribFiles: [
      {
        path: '/forecast.grb2',
        mtime: 0,
        type: 'wind',
        latMin: 50,
        latMax: 65,
        lonMin: 10,
        lonMax: 30,
        latStep: 0.1,
        lonStep: 0.1,
        timeStart: new Date('2026-06-06T00:00:00Z'),
        timeEnd: new Date('2026-06-11T00:00:00Z'),
        nTimes: 121,
        referenceTime: new Date('2026-06-06T00:00:00Z'),
      },
    ],
    forecastSkillHorizonHours: 96,
    motorSpeedKn: 0,
    motorBelowKn: 0,
    daylightOnly: false,
    maxHoursPerDay: 0,
    depthProvider: null,
    navigationConstraints: {
      minimumDepthM: 0,
      minimumShoreDistanceNm: 0,
      maximumOffshoreDistanceNm: 0,
    },
    ...overrides,
  };
}

function validRoute(): RoutePoint[] {
  return [
    point({ heading: 0, twa: 0, boatSpeed: undefined }),
    point({ lon: 19.1, time: new Date('2026-06-06T07:00:00Z') }),
  ];
}

test('accepts a route whose geometry, time, and displayed wind pattern agree', () => {
  const report = assessRouteQuality(validRoute(), context());
  assert.equal(report.valid, true);
  assert.deepEqual(report.issues, []);
  assert.equal(report.metrics.pointCount, 2);
  assert.ok(report.metrics.totalDistanceNm > 3);
  assert.equal(report.metrics.averageWindKn, 10);
  assert.equal(report.metrics.maximumWindKn, 10);
});

test('reports explicit motoring time and wave conditions', () => {
  const route = validRoute();
  route[0].waveHeight = 0.8;
  route[1].waveHeight = 1.2;
  route[1].propulsion = 'motor';
  const report = assessRouteQuality(route, context());
  assert.equal(report.metrics.motorHours, 1);
  assert.equal(report.metrics.averageWaveHeightM, 1);
  assert.equal(report.metrics.maximumWaveHeightM, 1.2);
});

test('fails a route whose TWA disagrees with heading and resampled wind direction', () => {
  const route = validRoute();
  route[1].twa = 45;
  const report = assessRouteQuality(route, context());
  assert.equal(report.valid, false);
  assert.ok(report.issues.some((issue) => issue.code === 'twa-mismatch' && issue.severity === 'error'));
});

test('fails implausible wind values that can indicate an unhandled GRIB fill cell', () => {
  const route = validRoute();
  route[1].tws = 19_438;
  const report = assessRouteQuality(route, context());
  assert.equal(report.valid, false);
  assert.ok(report.issues.some((issue) => issue.code === 'invalid-conditions'));
});

test('fails a route leg that crosses the configured shoreline mask', () => {
  const exterior = new Float64Array([19.04, 58.5, 19.06, 58.5, 19.06, 58.7, 19.04, 58.7, 19.04, 58.5]);
  const island: LandPolygon = {
    bboxLatMin: 58.5,
    bboxLatMax: 58.7,
    bboxLonMin: 19.04,
    bboxLonMax: 19.06,
    exterior,
  };
  const report = assessRouteQuality(validRoute(), context({ landIndex: buildLandEdgeIndex([island]) }));
  assert.equal(report.valid, false);
  assert.ok(report.issues.some((issue) => issue.code === 'land-crossing'));
});

test('warns when route conditions exceed forecast and polar confidence ranges', () => {
  const route = validRoute();
  route[1].time = new Date('2026-06-10T12:00:00Z');
  route[1].tws = 25;
  const report = assessRouteQuality(route, context());
  assert.equal(report.valid, true);
  assert.ok(report.issues.some((issue) => issue.code === 'low-forecast-confidence'));
  assert.ok(report.issues.some((issue) => issue.code === 'polar-wind-cap'));
  assert.equal(report.metrics.maxForecastLeadHours, 108);
});

test('warns about non-timed arrival snaps and disabled land checks', () => {
  const route = validRoute();
  route[1].time = route[0].time;
  const report = assessRouteQuality(route, context({ useLandAvoidance: false }));
  assert.equal(report.valid, true);
  assert.ok(report.issues.some((issue) => issue.code === 'zero-duration-leg'));
  assert.ok(report.issues.some((issue) => issue.code === 'land-check-disabled'));
});

test('fails a moving route leg outside daylight when daylight-only routing is requested', () => {
  const route = validRoute();
  route[0].time = new Date('2026-06-06T00:00:00Z');
  route[1].time = new Date('2026-06-06T01:00:00Z');
  const report = assessRouteQuality(route, context({ daylightOnly: true }));
  assert.equal(report.valid, false);
  assert.ok(report.issues.some((issue) => issue.code === 'night-sailing'));
});

test('fails a route that exceeds its daily underway-hours budget', () => {
  const route = validRoute();
  route[1].time = new Date('2026-06-06T09:00:00Z');
  const report = assessRouteQuality(route, context({ maxHoursPerDay: 2 }));
  assert.equal(report.valid, false);
  assert.ok(report.issues.some((issue) => issue.code === 'daily-hours-exceeded'));
  assert.equal(report.metrics.underwayHours, 3);
});

test('fails a route with missing numeric depth coverage', () => {
  const depthProvider: DepthProvider = {
    source: 'test',
    depthAt: () => undefined,
    minimumDepthAlongSegment: () => undefined,
    close() {},
  };
  const report = assessRouteQuality(
    validRoute(),
    context({
      depthProvider,
      navigationConstraints: {
        minimumDepthM: 2,
        minimumShoreDistanceNm: 0,
        maximumOffshoreDistanceNm: 0,
      },
    }),
  );
  assert.equal(report.valid, false);
  assert.ok(report.issues.some((issue) => issue.code === 'depth-coverage-missing'));
});

test('fails a route shallower than the minimum and reports the observed depth', () => {
  const depthProvider: DepthProvider = {
    source: 'test',
    depthAt: () => 1.5,
    minimumDepthAlongSegment: () => 1.5,
    close() {},
  };
  const report = assessRouteQuality(
    validRoute(),
    context({
      depthProvider,
      navigationConstraints: {
        minimumDepthM: 2,
        minimumShoreDistanceNm: 0,
        maximumOffshoreDistanceNm: 0,
      },
    }),
  );
  assert.equal(report.valid, false);
  assert.ok(report.issues.some((issue) => issue.code === 'minimum-depth-violated'));
  assert.equal(report.metrics.minimumObservedDepthM, 1.5);
});
