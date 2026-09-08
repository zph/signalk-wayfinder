import assert from 'node:assert/strict';
import test from 'node:test';

import type { CurrentGribData, GribData } from '../../types';
import { shareCurrentGribData, shareGribData } from '../shared-grib';

test('wind and wave grids are copied once into shared memory', () => {
  const data: GribData = {
    times: [new Date('2026-06-06T00:00:00Z')],
    latMin: 0,
    latStep: 1,
    lonMin: 0,
    lonStep: 1,
    nLat: 2,
    nLon: 2,
    u10: [new Float32Array([1, 2, 3, 4])],
    v10: [new Float32Array([5, 6, 7, 8])],
    swhByTime: new Map([[0, new Float32Array([0.5, 1, 1.5, 2])]]),
  };

  const shared = shareGribData(data);
  assert.notEqual(shared, data);
  assert.equal(shared.u10[0].buffer instanceof SharedArrayBuffer, true);
  assert.equal(shared.v10[0].buffer instanceof SharedArrayBuffer, true);
  assert.equal(shared.swhByTime!.get(0)!.buffer instanceof SharedArrayBuffer, true);
  assert.deepEqual(Array.from(shared.u10[0]), [1, 2, 3, 4]);
  assert.equal(shareGribData(data), shared);
  assert.equal(data.u10[0].buffer instanceof SharedArrayBuffer, false);
});

test('current grids are copied once into shared memory', () => {
  const data: CurrentGribData = {
    times: [new Date('2026-06-06T00:00:00Z')],
    latMin: 0,
    latStep: 1,
    lonMin: 0,
    lonStep: 1,
    nLat: 2,
    nLon: 2,
    u: [new Float32Array([1, 2, 3, 4])],
    v: [new Float32Array([5, 6, 7, 8])],
  };

  const shared = shareCurrentGribData(data);
  assert.equal(shared.u[0].buffer instanceof SharedArrayBuffer, true);
  assert.equal(shared.v[0].buffer instanceof SharedArrayBuffer, true);
  assert.deepEqual(Array.from(shared.v[0]), [5, 6, 7, 8]);
  assert.equal(shareCurrentGribData(data), shared);
  assert.equal(data.u[0].buffer instanceof SharedArrayBuffer, false);
});
