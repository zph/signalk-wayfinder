// Tests for the public wayfinding readiness contract.

import assert from 'node:assert/strict';
import test from 'node:test';
import { wayfinderCapabilities } from '../capabilities';

test('reports ready only with every required planning input', () => {
  assert.deepEqual(
    wayfinderCapabilities({
      hasPolar: true,
      hasForecast: true,
      hasShoreline: true,
      configuredDraftPath: 'design.draft.current',
    }),
    {
      apiVersion: '1.3',
      ready: true,
      objectives: ['fastest', 'leastMotoring', 'allMotoring', 'bestWeather'],
      maximumAlternatives: 10,
      passageConstraints: ['daylightOnly', 'maxHoursPerDay'],
      navigationConstraints: ['minimumShoreDistanceNm', 'maximumOffshoreDistanceNm'],
      configuredDraftPath: 'design.draft.current',
    },
  );
});

test('advertises the resolved Signal K vessel draft and selected path', () => {
  const capabilities = wayfinderCapabilities({
    hasPolar: true,
    hasForecast: true,
    hasShoreline: true,
    vesselDraft: { valueM: 1.8, path: 'design.draft.maximum' },
    configuredDraftPath: 'design.draft.current',
  });
  assert.deepEqual(capabilities.vesselDraft, { valueM: 1.8, path: 'design.draft.maximum' });
  assert.equal(capabilities.configuredDraftPath, 'design.draft.current');
});

test('explains every missing input without a safety fallback', () => {
  const capabilities = wayfinderCapabilities({
    hasPolar: false,
    hasForecast: false,
    hasShoreline: false,
    configuredDraftPath: 'design.draft.current',
  });
  assert.equal(capabilities.ready, false);
  assert.match(capabilities.unavailableReason ?? '', /a polar/);
  assert.match(capabilities.unavailableReason ?? '', /forecast coverage/);
  assert.match(capabilities.unavailableReason ?? '', /shoreline index/);
});
