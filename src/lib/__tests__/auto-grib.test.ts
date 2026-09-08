import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as nodepath from 'node:path';
import test from 'node:test';
import { ensureAutoGrib, estimateForecastHours } from '../auto-grib';

const request = {
  points: [
    { lat: 38.0667186, lon: -122.2132886 },
    { lat: 38.05, lon: -122.4 },
  ],
  departureTime: new Date('2026-09-08T12:00:00Z'),
  planningSpeedKn: 6,
  maxHoursPerDay: 8,
  gribDir: '',
};

test('estimateForecastHours accounts for daily underway limit and includes contingency', () => {
  assert.ok(estimateForecastHours(request) >= 24);
  assert.equal(estimateForecastHours({ ...request, maxHoursPerDay: 0 }), 24);
});

test('ensureAutoGrib downloads wind and wave subsets then reuses the route cache', async () => {
  const dir = await fs.mkdtemp(nodepath.join(os.tmpdir(), 'wayfinder-grib-'));
  let calls = 0;
  const grib = Buffer.concat([Buffer.from('GRIB'), Buffer.alloc(12)]);
  const fetcher: typeof fetch = async () => {
    calls++;
    return new Response(grib, { status: 200 });
  };
  try {
    const first = await ensureAutoGrib({ ...request, gribDir: dir }, fetcher, new Date('2026-09-08T14:00:00Z'));
    assert.equal(first.cacheHit, false);
    assert.ok(calls > 0);
    assert.ok((await fs.stat(first.path)).size > 16);
    const callsAfterFirst = calls;
    const second = await ensureAutoGrib({ ...request, gribDir: dir }, fetcher, new Date('2026-09-08T14:00:00Z'));
    assert.equal(second.path, first.path);
    assert.equal(second.cacheHit, true);
    assert.equal(calls, callsAfterFirst);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
