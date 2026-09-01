// Tests for the public wayfinding readiness contract.

import assert from 'node:assert/strict';
import test from 'node:test';
import { wayfinderCapabilities } from '../capabilities';

test('reports ready only with every required planning input', () => {
  assert.deepEqual(wayfinderCapabilities({ hasPolar: true, hasForecast: true, hasShoreline: true }), {
    apiVersion: '1.0',
    ready: true,
    objectives: ['fastest', 'leastMotoring'],
  });
});

test('explains every missing input without a safety fallback', () => {
  const capabilities = wayfinderCapabilities({ hasPolar: false, hasForecast: false, hasShoreline: false });
  assert.equal(capabilities.ready, false);
  assert.match(capabilities.unavailableReason ?? '', /a polar/);
  assert.match(capabilities.unavailableReason ?? '', /forecast coverage/);
  assert.match(capabilities.unavailableReason ?? '', /shoreline index/);
});
