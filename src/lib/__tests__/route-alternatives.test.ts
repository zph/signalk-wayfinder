// Tests objective-specific route variation, deduplication, and ranking.

import assert from 'node:assert/strict';
import test from 'node:test';
import type { RoutePoint, RouteQualityReport } from '../../types';
import {
  optionsForAlternative,
  planAlternativeSearch,
  rankDistinctAlternatives,
  type RouteAlternative,
} from '../route-alternatives';

function route(lon: number, durationHours: number): RoutePoint[] {
  return [
    {
      lat: 58.6,
      lon: 19,
      time: new Date('2026-06-06T06:00:00Z'),
      heading: 0,
      twa: 0,
      tws: 12,
      windDir: 180,
      legCalcMs: 0,
    },
    {
      lat: 58.8,
      lon,
      time: new Date(Date.parse('2026-06-06T06:00:00Z') + durationHours * 3_600_000),
      heading: 30,
      twa: 150,
      tws: 14,
      boatSpeed: 6,
      propulsion: 'sail',
      windDir: 180,
      legCalcMs: 1,
    },
  ];
}

function quality(overrides: Partial<RouteQualityReport['metrics']> = {}): RouteQualityReport {
  return {
    valid: true,
    issues: [],
    metrics: {
      pointCount: 2,
      totalDistanceNm: 20,
      maxWindShiftDeg: 0,
      maxTwaErrorDeg: 0,
      maxForecastLeadHours: 6,
      underwayHours: 6,
      passageDays: 1,
      minimumObservedDepthM: null,
      motorHours: 0,
      averageWaveHeightM: 1,
      maximumWaveHeightM: 1.5,
      averageWindKn: 13,
      maximumWindKn: 14,
      ...overrides,
    },
  };
}

function alternative(
  lon: number,
  durationHours: number,
  metrics: Partial<RouteQualityReport['metrics']> = {},
): RouteAlternative {
  return { route: route(lon, durationHours), quality: quality(metrics), complete: true };
}

test('configures objective-specific propulsion and distinct heading offsets', () => {
  assert.deepEqual(optionsForAlternative({ headingStep: 5 }, 'leastMotoring', 1, 5), {
    headingStep: 5,
    headingOffsetDeg: 0.5,
    forceMotor: false,
    motorBelowKn: 0,
    waitForWind: true,
  });
  assert.deepEqual(optionsForAlternative({ headingStep: 5 }, 'allMotoring', 2, 5), {
    headingStep: 5,
    headingOffsetDeg: 1,
    forceMotor: true,
    motorBelowKn: 0,
  });
});

test('plans one shared search for direct alternatives and preserves repeated fallback', () => {
  const shared = planAlternativeSearch({ headingStep: 5 }, 'fastest', 10, true);
  assert.equal(shared.shared, true);
  assert.equal(shared.tasks.length, 1);
  assert.equal(shared.tasks[0].options.sharedAlternativeCount, 10);
  assert.equal(shared.tasks[0].options.coarseToFine, true);

  const exact = planAlternativeSearch({ headingStep: 5, coarseToFine: false }, 'fastest', 10, true);
  assert.equal(exact.tasks[0].options.coarseToFine, false);

  const repeated = planAlternativeSearch({ headingStep: 5 }, 'fastest', 5, false);
  assert.equal(repeated.shared, false);
  assert.equal(repeated.tasks.length, 10);
  assert.equal(repeated.tasks[1].options.headingOffsetDeg, 0.5);
});

test('fastest ranks complete routes by duration and removes duplicate geometry', () => {
  const duplicate = alternative(19.2, 4);
  const ranked = rankDistinctAlternatives(
    [alternative(19.1, 8), duplicate, { ...duplicate, quality: quality({ totalDistanceNm: 99 }) }],
    'fastest',
    5,
  );
  assert.equal(ranked.length, 2);
  assert.deepEqual(
    ranked.map(({ summary }) => [summary.index, summary.durationHours]),
    [
      [0, 4],
      [1, 8],
    ],
  );
});

test('least-motoring ranks motor hours before elapsed duration', () => {
  const ranked = rankDistinctAlternatives(
    [alternative(19.1, 5, { motorHours: 2 }), alternative(19.2, 8, { motorHours: 0 })],
    'leastMotoring',
    2,
  );
  assert.equal(ranked[0].summary.motorHours, 0);
  assert.equal(ranked[0].summary.durationHours, 8);
});

test('best-weather ranks calmer waves and winds before duration', () => {
  const ranked = rankDistinctAlternatives(
    [
      alternative(19.1, 5, {
        averageWaveHeightM: 2,
        maximumWaveHeightM: 3,
        averageWindKn: 20,
        maximumWindKn: 28,
      }),
      alternative(19.2, 8, {
        averageWaveHeightM: 0.7,
        maximumWaveHeightM: 1.1,
        averageWindKn: 13,
        maximumWindKn: 18,
      }),
    ],
    'bestWeather',
    2,
  );
  assert.equal(ranked[0].summary.averageWaveHeightM, 0.7);
  assert.equal(ranked[0].summary.durationHours, 8);
});

test('ranks warning-free routes before objective ties', () => {
  const warningQuality = quality();
  warningQuality.issues.push({ code: 'advisory', severity: 'warning', message: 'Check this route.' });
  const ranked = rankDistinctAlternatives(
    [{ route: route(19.1, 4), quality: warningQuality, complete: true }, alternative(19.2, 5)],
    'fastest',
    2,
  );
  assert.equal(ranked[0].summary.durationHours, 5);
  assert.deepEqual(ranked[0].summary.quality.issues, []);
});

test('best-weather ranks measured wave conditions ahead of missing wave data', () => {
  const ranked = rankDistinctAlternatives(
    [
      alternative(19.1, 5, { averageWaveHeightM: null, maximumWaveHeightM: null }),
      alternative(19.2, 8, { averageWaveHeightM: 1.5, maximumWaveHeightM: 2 }),
    ],
    'bestWeather',
    2,
  );
  assert.equal(ranked[0].summary.averageWaveHeightM, 1.5);
});
