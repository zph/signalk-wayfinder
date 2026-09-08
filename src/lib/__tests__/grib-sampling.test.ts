import assert from 'node:assert/strict';
import test from 'node:test';

import type { CurrentGribData, GribData } from '../../types';
import { getCurrentAt, getWaveAt, getWindAt, nearestCurrentTimeIndex, nearestTimeIndex } from '../grib-sampling';

const times = [new Date('2024-01-01T00:00:00Z'), new Date('2024-01-01T03:00:00Z')];
const grid = {
  times,
  latMin: 0,
  latStep: 1,
  lonMin: 0,
  lonStep: 1,
  nLat: 2,
  nLon: 2,
};

test('prepared grid interpolation preserves bilinear wind and current values', () => {
  const wind: GribData = {
    ...grid,
    u10: [new Float32Array([0, 2, 4, 6]), new Float32Array(4)],
    v10: [new Float32Array([6, 4, 2, 0]), new Float32Array(4)],
  };
  const current: CurrentGribData = {
    ...grid,
    u: [new Float32Array([0, 2, 4, 6]), new Float32Array(4)],
    v: [new Float32Array([6, 4, 2, 0]), new Float32Array(4)],
  };

  assert.deepEqual(getWindAt(wind, 0.5, 0.5, 0), { u: 3, v: 3 });
  assert.deepEqual(getCurrentAt(current, 0.5, 0.5, 0), { u: 3, v: 3 });
  assert.equal(nearestTimeIndex(wind, new Date('2024-01-01T02:00:00Z')), 1);
  assert.equal(nearestCurrentTimeIndex(current, new Date('2024-01-01T02:00:00Z')), 1);
});

test('wave sampling reuses a nearest timestamp without changing interpolation', () => {
  const wind: GribData = {
    ...grid,
    u10: times.map(() => new Float32Array(4)),
    v10: times.map(() => new Float32Array(4)),
    swhByTime: new Map([
      [times[0].getTime(), new Float32Array([0, 2, 4, 6])],
      [times[1].getTime(), new Float32Array([10, 12, 14, 16])],
    ]),
  };

  const requestedTime = new Date('2024-01-01T02:00:00Z').getTime();
  assert.equal(getWaveAt(wind, 0.5, 0.5, requestedTime), 13);
  assert.equal(getWaveAt(wind, 0.5, 0.5, requestedTime), 13);
});
