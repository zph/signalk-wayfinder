// Tests for the public wayfinding readiness contract.

import assert from 'node:assert/strict';
import test from 'node:test';
import { wayfinderCapabilities } from '../capabilities';

test('reports ready only with every required planning input', () => {
  assert.deepEqual(wayfinderCapabilities({ hasPolar: true, hasForecast: true, hasShoreline: true }), {
    apiVersion: '1.2',
    ready: true,
    objectives: ['fastest'],
    passageConstraints: ['daylightOnly', 'maxHoursPerDay'],
    navigationConstraints: ['minimumShoreDistanceNm', 'maximumOffshoreDistanceNm'],
  });
});

test('advertises minimum depth only when a numeric bathymetry source is loaded', () => {
  const capabilities = wayfinderCapabilities({
    hasPolar: true,
    hasForecast: true,
    hasShoreline: true,
    depthSource: '/charts/depth.tif',
  });
  assert.deepEqual(capabilities.navigationConstraints, [
    'minimumShoreDistanceNm',
    'maximumOffshoreDistanceNm',
    'minimumDepthM',
  ]);
  assert.equal(capabilities.depthSource, '/charts/depth.tif');
});

test('explains every missing input without a safety fallback', () => {
  const capabilities = wayfinderCapabilities({ hasPolar: false, hasForecast: false, hasShoreline: false });
  assert.equal(capabilities.ready, false);
  assert.match(capabilities.unavailableReason ?? '', /a polar/);
  assert.match(capabilities.unavailableReason ?? '', /forecast coverage/);
  assert.match(capabilities.unavailableReason ?? '', /shoreline index/);
});
