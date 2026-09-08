import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as nodepath from 'node:path';
import test from 'node:test';
import { ensureAutoGrib } from '../auto-grib';

const request = {
  points: [
    { lat: 38.0667186, lon: -122.2132886 },
    { lat: 38.05, lon: -122.4 },
  ],
  departureTime: new Date('2026-09-08T12:00:00Z'),
  gribDir: '',
};

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
    assert.equal(first.forecastHours, 384);
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

test('ensureAutoGrib follows redirects returned by an embedded fetch implementation', async () => {
  const dir = await fs.mkdtemp(nodepath.join(os.tmpdir(), 'wayfinder-grib-'));
  let calls = 0;
  let requestedRedirectFollow = false;
  const grib = Buffer.concat([Buffer.from('GRIB'), Buffer.alloc(12)]);
  const fetcher: typeof fetch = async (_input, init) => {
    calls++;
    requestedRedirectFollow ||= init?.redirect === 'follow';
    if (calls === 1)
      return new Response(null, {
        status: 302,
        headers: { location: 'https://example.test/redirected.grib2' },
      });
    return new Response(grib, { status: 200 });
  };
  try {
    const result = await ensureAutoGrib(
      { ...request, gribDir: dir },
      fetcher,
      new Date('2026-09-08T14:00:00Z'),
    );
    assert.equal(result.cacheHit, false);
    assert.equal(requestedRedirectFollow, true);
    assert.ok(calls > 2);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
