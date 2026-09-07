// Tests Signal K vessel-draft discovery and configured-path precedence.

import assert from 'node:assert/strict';
import test from 'node:test';
import type { SignalKApp } from '../signalk-app';
import { resolveVesselDraft } from '../vessel-draft';

function app(values: Record<string, unknown>): SignalKApp {
  return {
    setPluginStatus() {},
    setPluginError() {},
    debug() {},
    getSelfPath: (path) => values[path],
  };
}

test('uses a configured Signal K path before the standard paths', () => {
  assert.deepEqual(
    resolveVesselDraft(
      app({ 'design.customDraft': { value: 2.15 }, 'design.draft.current': 1.8 }),
      'design.customDraft',
    ),
    { valueM: 2.15, path: 'design.customDraft' },
  );
});

test('does not silently substitute a standard path for an explicit override', () => {
  assert.equal(resolveVesselDraft(app({ 'design.draft.current': 1.8 }), 'design.customDraft', false), undefined);
});

test('falls back through the standard current, maximum, and minimum draft paths', () => {
  assert.deepEqual(resolveVesselDraft(app({ 'design.draft.maximum': 2.4 })), {
    valueM: 2.4,
    path: 'design.draft.maximum',
  });
});

test('returns undefined when no positive numeric draft is available', () => {
  assert.equal(
    resolveVesselDraft(
      app({
        'design.draft.current': 0,
        'design.draft.maximum': { value: '2.4' },
        'design.draft.minimum': Number.NaN,
      }),
    ),
    undefined,
  );
});
