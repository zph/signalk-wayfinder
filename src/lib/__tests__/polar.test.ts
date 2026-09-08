import { test } from 'node:test';
import assert from 'node:assert/strict';
import { interpolateBoatSpeed } from '../polar';
import { PolarData } from '../../types';

// Minimal inline polar for testing — minimum TWA is 30° (realistic tacking angle):
// TWS: 10, 20
// TWA: 30 →  3,  5
//       90 →  5, 10
//      180 →  3,  6
const polar: PolarData = {
  tws: [10, 20],
  twa: [30, 90, 180],
  speeds: [
    [3, 5],
    [5, 10],
    [3, 6],
  ],
};

test('interpolateBoatSpeed: exact grid point TWA=90 TWS=10 → 5 kt', () => {
  const spd = interpolateBoatSpeed(polar, 90, 10);
  assert.ok(Math.abs(spd - 5) < 0.001, `expected 5, got ${spd}`);
});

test('interpolateBoatSpeed: exact grid point TWA=90 TWS=20 → 10 kt', () => {
  const spd = interpolateBoatSpeed(polar, 90, 20);
  assert.ok(Math.abs(spd - 10) < 0.001, `expected 10, got ${spd}`);
});

test('interpolateBoatSpeed: midpoint TWS=15 at TWA=90 → 7.5 kt', () => {
  const spd = interpolateBoatSpeed(polar, 90, 15);
  assert.ok(Math.abs(spd - 7.5) < 0.001, `expected 7.5, got ${spd}`);
});

test('interpolateBoatSpeed: midpoint TWA=135 at TWS=10 → midpoint 5 and 3 = 4 kt', () => {
  // TWA=135 is midpoint between 90 and 180; TWS=10 gives (5+3)/2 = 4
  const spd = interpolateBoatSpeed(polar, 135, 10);
  assert.ok(Math.abs(spd - 4) < 0.001, `expected 4, got ${spd}`);
});

test('interpolateBoatSpeed: bilinear centre TWA=135 TWS=15 → (5+10+3+6)/4 = 6', () => {
  const spd = interpolateBoatSpeed(polar, 135, 15);
  assert.ok(Math.abs(spd - 6) < 0.001, `expected 6, got ${spd}`);
});

test('interpolateBoatSpeed: polar is symmetric — negative TWA same as positive', () => {
  const pos = interpolateBoatSpeed(polar, 90, 10);
  const neg = interpolateBoatSpeed(polar, -90, 10);
  assert.strictEqual(pos, neg);
});

test('interpolateBoatSpeed: TWA below polar minimum returns 0', () => {
  // Boat cannot sail below its tacking angle — 0° and 15° are both below min TWA of 30°
  assert.strictEqual(interpolateBoatSpeed(polar, 0, 15), 0);
  assert.strictEqual(interpolateBoatSpeed(polar, 15, 15), 0);
});

test('interpolateBoatSpeed: TWA at polar minimum returns nonzero', () => {
  const spd = interpolateBoatSpeed(polar, 30, 10);
  assert.ok(spd > 0, `expected positive speed at minimum TWA, got ${spd}`);
});

test('interpolateBoatSpeed: TWS above polar maximum is clamped — returns polar-max speed, not extrapolated beyond', () => {
  // At TWA=90, polar max TWS=20 gives 10 kt. TWS=40 (2× above max) must still give 10 kt.
  const atMax = interpolateBoatSpeed(polar, 90, 20);
  const beyond = interpolateBoatSpeed(polar, 90, 40);
  assert.ok(Math.abs(beyond - atMax) < 0.001, `expected ${atMax}, got ${beyond}`);
});

test('interpolateBoatSpeed: TWA above 180° is clamped to 180°', () => {
  const at180 = interpolateBoatSpeed(polar, 180, 10);
  const beyond = interpolateBoatSpeed(polar, 200, 10);
  assert.ok(Math.abs(beyond - at180) < 0.001, `expected ${at180}, got ${beyond}`);
});

test('interpolateBoatSpeed: linear interpolation toward zero for TWS below polar minimum (BUG-58)', () => {
  // Test polar has TWS columns [10, 20]. Minimum TWS = 10.
  const atMin = interpolateBoatSpeed(polar, 90, 10);
  const halfMin = interpolateBoatSpeed(polar, 90, 5);
  const quarter = interpolateBoatSpeed(polar, 90, 2.5);
  assert.ok(halfMin < atMin, `5 kn (${halfMin}) should be slower than 10 kn (${atMin})`);
  assert.ok(
    Math.abs(halfMin - atMin / 2) < 0.001,
    `5 kn (half min TWS) should give ~half speed: ${halfMin} vs ${atMin / 2}`,
  );
  assert.ok(
    Math.abs(quarter - atMin / 4) < 0.001,
    `2.5 kn (quarter min TWS) should give ~quarter speed: ${quarter} vs ${atMin / 4}`,
  );
  assert.strictEqual(interpolateBoatSpeed(polar, 90, 0), 0, '0 kn should give 0 speed');
});
