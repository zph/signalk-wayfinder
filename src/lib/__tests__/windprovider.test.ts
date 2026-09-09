import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { MultiFileWindProvider, nearestIdx, withDepartureTime, withMaximumTimeStep } from '../windprovider';
import { GribData, GribFileEntry } from '../../types';

function makeGrib(opts: {
  latMin?: number;
  latMax?: number;
  lonMin?: number;
  lonMax?: number;
  u?: number;
  v?: number;
  times?: Date[];
}): GribData {
  const latMin = opts.latMin ?? 40;
  const latStep = 1;
  const lonMin = opts.lonMin ?? 10;
  const lonStep = 1;
  const nLat = 3,
    nLon = 3;
  const nPoints = nLat * nLon;
  const t0 = opts.times?.[0] ?? new Date('2024-01-01T00:00:00Z');
  const t1 = opts.times?.[1] ?? new Date('2024-01-01T01:00:00Z');
  const times = opts.times ?? [t0, t1];
  const u = opts.u ?? 0;
  const v = opts.v ?? 5;
  return {
    latMin,
    latStep,
    lonMin,
    lonStep,
    nLat,
    nLon,
    times,
    u10: times.map(() => new Float32Array(nPoints).fill(u)),
    v10: times.map(() => new Float32Array(nPoints).fill(v)),
  };
}

function makeEntry(grib: GribData, mtime: number, path_ = 'test.grib2'): GribFileEntry {
  return {
    meta: {
      path: path_,
      mtime,
      type: 'wind',
      latMin: grib.latMin,
      latMax: grib.latMin + grib.latStep * (grib.nLat - 1),
      lonMin: grib.lonMin,
      lonMax: grib.lonMin + grib.lonStep * (grib.nLon - 1),
      latStep: grib.latStep,
      lonStep: grib.lonStep,
      timeStart: grib.times[0],
      timeEnd: grib.times[grib.times.length - 1],
      nTimes: grib.times.length,
      referenceTime: grib.times[0],
    },
    data: grib,
  };
}

test('nearestIdx: returns 0 for single-element array', () => {
  const times = [new Date('2024-01-01T00:00:00Z')];
  assert.strictEqual(nearestIdx(times, new Date('2024-01-01T06:00:00Z')), 0);
});

test('nearestIdx: finds exact match', () => {
  const times = [new Date('2024-01-01T00:00:00Z'), new Date('2024-01-01T01:00:00Z'), new Date('2024-01-01T02:00:00Z')];
  assert.strictEqual(nearestIdx(times, new Date('2024-01-01T01:00:00Z')), 1);
});

test('nearestIdx: rounds to nearest', () => {
  const times = [new Date('2024-01-01T00:00:00Z'), new Date('2024-01-01T02:00:00Z')];
  // 30 minutes past midnight is closer to index 0
  assert.strictEqual(nearestIdx(times, new Date('2024-01-01T00:30:00Z')), 0);
  // 90 minutes past midnight is closer to index 1
  assert.strictEqual(nearestIdx(times, new Date('2024-01-01T01:30:00Z')), 1);
});

test('MultiFileWindProvider: merged times axis contains entries from all files', () => {
  const t0 = new Date('2024-01-01T00:00:00Z');
  const t1 = new Date('2024-01-01T01:00:00Z');
  const t2 = new Date('2024-01-01T02:00:00Z');
  const g1 = makeGrib({ times: [t0, t1] });
  const g2 = makeGrib({ times: [t1, t2] });
  const provider = new MultiFileWindProvider([makeEntry(g1, 1000), makeEntry(g2, 2000)]);
  // t1 appears in both files — should be deduplicated
  assert.strictEqual(provider.times.length, 3);
  assert.strictEqual(provider.times[0].getTime(), t0.getTime());
  assert.strictEqual(provider.times[1].getTime(), t1.getTime());
  assert.strictEqual(provider.times[2].getTime(), t2.getTime());
});

test('withMaximumTimeStep densifies a coarse forecast without changing sampled wind coverage', () => {
  const t0 = new Date('2024-01-01T00:00:00Z');
  const t3 = new Date('2024-01-01T03:00:00Z');
  const provider = new MultiFileWindProvider([makeEntry(makeGrib({ times: [t0, t3], v: 7 }), 1000)]);

  const routed = withMaximumTimeStep(provider, 0.25);

  assert.strictEqual(routed.times.length, 13);
  assert.strictEqual(routed.times[1].toISOString(), '2024-01-01T00:15:00.000Z');
  assert.strictEqual(routed.times.at(-1)?.toISOString(), t3.toISOString());
  assert.strictEqual(routed.getWind(41, 11, 1).v, 7);
  assert.strictEqual(routed.coversPointAtTime(41, 11, 11), true);
});

test('withDepartureTime starts routing at the requested time while retaining later forecast steps', () => {
  const t0 = new Date('2024-01-01T00:00:00Z');
  const t3 = new Date('2024-01-01T03:00:00Z');
  const t6 = new Date('2024-01-01T06:00:00Z');
  const departure = new Date('2024-01-01T01:15:00Z');
  const provider = new MultiFileWindProvider([makeEntry(makeGrib({ times: [t0, t3, t6], v: 7 }), 1000)]);

  const routed = withDepartureTime(provider, departure);

  assert.deepEqual(
    routed.times.map((time) => time.toISOString()),
    [departure, t3, t6].map((time) => time.toISOString()),
  );
  assert.strictEqual(routed.getWind(41, 11, 0).v, 7);
  assert.strictEqual(routed.coversPointAtTime(41, 11, 0), true);
  assert.strictEqual(withDepartureTime(routed, departure), routed);
});

test('MultiFileWindProvider: getWind returns freshest file when files overlap spatially', () => {
  const t0 = new Date('2024-01-01T00:00:00Z');
  const t1 = new Date('2024-01-01T01:00:00Z');
  // Older file: v=5 (southerly), newer file: v=10 (stronger southerly)
  const gOld = makeGrib({ v: 5, times: [t0, t1] });
  const gNew = makeGrib({ v: 10, times: [t0, t1] });
  const provider = new MultiFileWindProvider([makeEntry(gOld, 1000, 'old.grib2'), makeEntry(gNew, 2000, 'new.grib2')]);
  const wind = provider.getWind(41, 11, 0); // both files cover this point
  assert.strictEqual(wind.v, 10, 'should use the newer file (mtime 2000)');
});

test('MultiFileWindProvider: getWind prefers newer referenceTime over newer file mtime', () => {
  const t0 = new Date('2024-01-01T12:00:00Z');
  const t1 = new Date('2024-01-01T13:00:00Z');
  // fileA: older model run (referenceTime 00z) but a freshly re-downloaded file (high mtime)
  const gA = makeGrib({ v: 5, times: [t0, t1] });
  const entryA = makeEntry(gA, 9000, '/data/oldRun.grib2');
  entryA.meta.referenceTime = new Date('2024-01-01T00:00:00Z');
  // fileB: newer model run (referenceTime 06z) but an old download (low mtime)
  const gB = makeGrib({ v: 10, times: [t0, t1] });
  const entryB = makeEntry(gB, 1000, '/data/newRun.grib2');
  entryB.meta.referenceTime = new Date('2024-01-01T06:00:00Z');
  const provider = new MultiFileWindProvider([entryA, entryB]);
  // Both cover (41,11) at t0; fileB has the newer prognosis despite an older mtime → B wins
  assert.strictEqual(provider.getWind(41, 11, 0).v, 10, 'newer referenceTime must beat newer mtime');
  assert.strictEqual(provider.getFilePathForPoint(41, 11, 0), '/data/newRun.grib2');
});

test('MultiFileWindProvider: getWind prefers finer temporal granularity on equal referenceTime', () => {
  const t0 = new Date('2024-01-01T00:00:00Z');
  // Coarse file: 3-hourly; fine file: hourly. Same referenceTime (t0), same mtime.
  const coarse = makeGrib({
    v: 5,
    times: [t0, new Date('2024-01-01T03:00:00Z'), new Date('2024-01-01T06:00:00Z')],
  });
  const fine = makeGrib({
    v: 10,
    times: [t0, new Date('2024-01-01T01:00:00Z'), new Date('2024-01-01T02:00:00Z')],
  });
  const provider = new MultiFileWindProvider([
    makeEntry(coarse, 1000, '/data/coarse.grib2'),
    makeEntry(fine, 1000, '/data/fine.grib2'),
  ]);
  const idx0 = provider.times.findIndex((t) => t.getTime() === t0.getTime());
  assert.strictEqual(provider.getWind(41, 11, idx0).v, 10, 'finer timestep must win on equal referenceTime');
});

test('MultiFileWindProvider: getWind returns {u:0,v:0} when point outside all bboxes (BUG-93)', () => {
  const t0 = new Date('2024-01-01T00:00:00Z');
  const t1 = new Date('2024-01-01T01:00:00Z');
  const g = makeGrib({ latMin: 40, lonMin: 10, v: 7, times: [t0, t1] });
  const provider = new MultiFileWindProvider([makeEntry(g, 1000)]);
  // Point is outside the 40–42 lat / 10–12 lon bbox — no silent fallback to wrong file
  const wind = provider.getWind(60, 20, 0);
  assert.strictEqual(wind.u, 0, 'u should be 0 (no wind data outside coverage)');
  assert.strictEqual(wind.v, 0, 'v should be 0 (no wind data outside coverage)');
});

test('MultiFileWindProvider: getWind prefers temporally-correct file over newer file outside the requested time', () => {
  const may24 = new Date('2026-05-24T00:00:00Z');
  const may25 = new Date('2026-05-25T00:00:00Z');
  const jun6 = new Date('2026-06-06T00:00:00Z');
  const jun7 = new Date('2026-06-07T00:00:00Z');
  // Older file covers May 24–25 with v=5 (the correct data for a May 24 departure)
  const gOld = makeGrib({ v: 5, times: [may24, may25] });
  // Newer file (higher mtime) covers June 6–7 with v=10 — same spatial bbox, wrong time period
  const gNew = makeGrib({ v: 10, times: [jun6, jun7] });
  const provider = new MultiFileWindProvider([
    makeEntry(gOld, 1000, 'may24.grib2'),
    makeEntry(gNew, 2000, 'jun06.grib2'),
  ]);
  // timeIdx 0 is May 24 in the merged timeline — gOld covers it, gNew does not
  const wind = provider.getWind(41, 11, 0);
  assert.strictEqual(wind.v, 5, 'should use the May 24 file which covers the requested time');
});

test('MultiFileWindProvider: getWind returns {u:0,v:0} when point covered spatially but not temporally (BUG-93)', () => {
  const t0 = new Date('2024-01-01T00:00:00Z');
  const t1 = new Date('2024-01-01T01:00:00Z');
  const t2 = new Date('2024-01-01T02:00:00Z');
  // File A covers lat 40-42 lon 10-12, times [t0, t1] only
  const gA = makeGrib({ latMin: 40, lonMin: 10, v: 5, times: [t0, t1] });
  // File B covers lat 50-52 lon 50-52, time [t2] — different spatial area
  const gB = makeGrib({ latMin: 50, lonMin: 50, v: 9, times: [t2] });
  const provider = new MultiFileWindProvider([makeEntry(gA, 1000, 'a.grib2'), makeEntry(gB, 2000, 'b.grib2')]);
  // At t2: file A covers (41,11) spatially but not temporally (t2 > t1).
  // File B covers t2 but not at (41,11). No file covers both → {u:0, v:0}.
  const idx2 = provider.times.findIndex((t) => t.getTime() === t2.getTime());
  const wind = provider.getWind(41, 11, idx2);
  assert.strictEqual(wind.u, 0, 'u should be 0 (no spatiotemporal coverage)');
  assert.strictEqual(wind.v, 0, 'v should be 0 (no spatiotemporal coverage)');
});

test('MultiFileWindProvider: coversPointAtTime rejects point covered spatially by wrong-time file (BUG-75)', () => {
  const may24 = new Date('2026-05-24T00:00:00Z');
  const may25 = new Date('2026-05-25T00:00:00Z');
  const jun6 = new Date('2026-06-06T00:00:00Z');
  const jun7 = new Date('2026-06-07T00:00:00Z');
  // May GRIB covers lat 40–42, lon 10–12
  const gMay = makeGrib({ latMin: 40, lonMin: 10, times: [may24, may25] });
  // June GRIB covers lat 40–42, lon 13–15 (spatially non-overlapping extension)
  const gJun = makeGrib({ latMin: 40, lonMin: 13, times: [jun6, jun7] });
  const provider = new MultiFileWindProvider([makeEntry(gMay, 1000, 'may.grib2'), makeEntry(gJun, 2000, 'jun.grib2')]);
  // timeIdx 0 is May 24 in the merged timeline
  const mayIdx = provider.times.findIndex((t) => t.getTime() === may24.getTime());
  // Point at lon 14 is inside June GRIB spatially but June GRIB doesn't cover May time
  assert.strictEqual(
    provider.coversPointAtTime(41, 14, mayIdx),
    false,
    'point covered only by the June GRIB must not be considered valid at a May time step',
  );
  // Point at lon 11 is inside May GRIB — should be valid at May time
  assert.strictEqual(
    provider.coversPointAtTime(41, 11, mayIdx),
    true,
    'point covered by the May GRIB should be valid at a May time step',
  );
  // Point at lon 14 IS valid at a June time index
  const junIdx = provider.times.findIndex((t) => t.getTime() === jun6.getTime());
  assert.strictEqual(
    provider.coversPointAtTime(41, 14, junIdx),
    true,
    'point covered by the June GRIB should be valid at a June time step',
  );
});

test('MultiFileWindProvider: getWave returns undefined when no file has swh data', () => {
  const g = makeGrib({});
  const provider = new MultiFileWindProvider([makeEntry(g, 1000)]);
  assert.strictEqual(provider.getWave(41, 11, new Date('2024-01-01T00:00:00Z')), undefined);
});

test('MultiFileWindProvider: getWave returns undefined when no file covers point temporally (BUG-101)', () => {
  const t0 = new Date('2024-01-01T00:00:00Z');
  const t1 = new Date('2024-01-01T01:00:00Z');
  const t2 = new Date('2024-01-01T02:00:00Z');
  // File A has wave data at lat 40-42 lon 10-12, times [t0, t1]
  const gA = makeGrib({ latMin: 40, lonMin: 10, times: [t0, t1] });
  gA.swhByTime = new Map([[t0.getTime(), new Float32Array(9).fill(0.5)]]);
  // File B has wave data at lat 50-52 lon 50-52, time [t2]
  const gB = makeGrib({ latMin: 50, lonMin: 50, times: [t2] });
  gB.swhByTime = new Map([[t2.getTime(), new Float32Array(9).fill(1.0)]]);
  const provider = new MultiFileWindProvider([makeEntry(gA, 1000, 'a.grib2'), makeEntry(gB, 2000, 'b.grib2')]);
  // At t2, point (41,11): file A covers spatially but not temporally;
  // file B covers temporally but not spatially → undefined (no fallback)
  assert.strictEqual(
    provider.getWave(41, 11, t2),
    undefined,
    'should return undefined when no wave file covers the point temporally',
  );
});

test('MultiFileWindProvider: single file times axis matches grib.times', () => {
  const t0 = new Date('2024-01-01T00:00:00Z');
  const t1 = new Date('2024-01-01T01:00:00Z');
  const t2 = new Date('2024-01-01T02:00:00Z');
  const g = makeGrib({ times: [t0, t1, t2] });
  const provider = new MultiFileWindProvider([makeEntry(g, 1000)]);
  assert.strictEqual(provider.times.length, 3);
  assert.strictEqual(provider.times[0].getTime(), t0.getTime());
  assert.strictEqual(provider.times[2].getTime(), t2.getTime());
});

test('MultiFileWindProvider: getFilePathForPoint returns path of the file getWind selects', () => {
  // Two spatially overlapping files; file B is fresher (higher mtime) and covers all times.
  // getWind prefers the fresher file → getFilePathForPoint must return file B's path.
  const t0 = new Date('2024-01-01T00:00:00Z');
  const t1 = new Date('2024-01-01T01:00:00Z');
  const gribA = makeGrib({ times: [t0, t1] });
  const gribB = makeGrib({ times: [t0, t1], u: 1 });
  const entryA = makeEntry(gribA, 1000, '/data/fileA.grib2');
  const entryB = makeEntry(gribB, 2000, '/data/fileB.grib2');
  const provider = new MultiFileWindProvider([entryA, entryB]);
  // Both files cover (41, 11) and time index 0; B has higher mtime → B wins
  assert.strictEqual(provider.getFilePathForPoint(41, 11, 0), '/data/fileB.grib2');
});

test('MultiFileWindProvider: getFilePathForPoint returns empty string when no file covers the time (BUG-93)', () => {
  // File A covers the point spatially and temporally; file B only covers spatially (time mismatch).
  const t0 = new Date('2024-01-01T00:00:00Z');
  const t1 = new Date('2024-01-01T01:00:00Z');
  const t2 = new Date('2024-01-01T02:00:00Z');
  const gribA = makeGrib({ times: [t0, t1] }); // covers t0 and t1
  const gribB = makeGrib({ times: [t1, t2] }); // covers t1 and t2 only
  const entryA = makeEntry(gribA, 1000, '/data/fileA.grib2');
  const entryB = makeEntry(gribB, 500, '/data/fileB.grib2');
  const provider = new MultiFileWindProvider([entryA, entryB]);
  // At time index for t0: only A covers temporally → A selected
  const idx0 = provider.times.findIndex((t) => t.getTime() === t0.getTime());
  assert.strictEqual(provider.getFilePathForPoint(41, 11, idx0), '/data/fileA.grib2');
  // At time index for t2: only B covers temporally → B selected
  const idx2 = provider.times.findIndex((t) => t.getTime() === t2.getTime());
  assert.strictEqual(provider.getFilePathForPoint(41, 11, idx2), '/data/fileB.grib2');
  // Point outside all files spatially → empty string (no fallback)
  assert.strictEqual(
    provider.getFilePathForPoint(60, 20, idx0),
    '',
    'should return empty string for uncovered point, not fall back to a file',
  );
});

// scanGribDir: integration test using a real temp directory
import { existsSync } from 'node:fs';
import { scanGribDir, loadGrib, getWaveAt } from '../grib';

test('scanGribDir: finds grib2 files and ignores others', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'grib-test-'));
  try {
    await fs.writeFile(path.join(dir, 'forecast.grib2'), '');
    await fs.writeFile(path.join(dir, 'other.grib'), '');
    await fs.writeFile(path.join(dir, 'readme.txt'), '');
    await fs.writeFile(path.join(dir, 'DATA.GRB2'), ''); // uppercase extension
    const files = await scanGribDir(dir);
    assert.strictEqual(files.length, 3, 'should find .grib2, .grib, .GRB2 (case-insensitive)');
    assert.ok(
      files.every((f) => f.startsWith(dir)),
      'paths should be absolute',
    );
    assert.ok(
      files.every((f) => !f.endsWith('.txt')),
      'should not include .txt',
    );
  } finally {
    await fs.rm(dir, { recursive: true });
  }
});

test('scanGribDir: returns empty array for empty directory', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'grib-test-'));
  try {
    const files = await scanGribDir(dir);
    assert.strictEqual(files.length, 0);
  } finally {
    await fs.rm(dir, { recursive: true });
  }
});

test('scanGribDir: throws for non-existent directory', async () => {
  await assert.rejects(() => scanGribDir('/nonexistent/path/that/does/not/exist'), /ENOENT/);

  test('getWaveAt: returns undefined for lat/lon outside wave grid bounds (BUG-104)', () => {
    const t0 = new Date('2024-01-01T00:00:00Z');
    const grib: GribData = {
      latMin: 40,
      latStep: 1,
      lonMin: 10,
      lonStep: 1,
      nLat: 3,
      nLon: 3,
      times: [t0],
      u10: [new Float32Array(9)],
      v10: [new Float32Array(9)],
      swhByTime: new Map([[t0.getTime(), new Float32Array(9).fill(0.5)]]),
    };
    // Point inside the grid → should return a value
    assert.ok(getWaveAt(grib, 41, 11, t0.getTime()) !== undefined, 'point inside grid should return wave height');
    // Points outside the grid → should return undefined (not clamped edge values)
    assert.strictEqual(getWaveAt(grib, 50, 11, t0.getTime()), undefined, 'lat above grid max should return undefined');
    assert.strictEqual(getWaveAt(grib, 39, 11, t0.getTime()), undefined, 'lat below grid min should return undefined');
    assert.strictEqual(
      getWaveAt(grib, 41, 20, t0.getTime()),
      undefined,
      'lon east of grid max should return undefined',
    );
    assert.strictEqual(getWaveAt(grib, 41, 9, t0.getTime()), undefined, 'lon west of grid min should return undefined');
  });
});

// Integration test: BUG-65 — mixed-grid GRIB files must read wave data at correct coordinates.
// Denmark file has atmospheric wind at 0.0625° and ocean wave at 0.1°×0.05° on separate grids.
// XyGrib confirms 0.64 m at N56°55.6 E11°18.7 (Kattegat) for 2026-06-06T01:00Z.
const DENMARK_GRIB = path.join(process.cwd(), 'test-data', 'Denmark_ICON_EU_EWAM_20260606-00.grb2');
test(
  'getWaveAt: mixed-grid GRIB reads wave height at correct coordinates (BUG-65)',
  { skip: existsSync(DENMARK_GRIB) ? false : 'Denmark test GRIB not present' },
  async () => {
    const grib = await loadGrib(DENMARK_GRIB);
    const waveHeight = getWaveAt(grib, 56.927, 11.312, 1780707600000 /* 2026-06-06T01:00Z */);
    assert.ok(waveHeight !== undefined, 'wave height should be defined at Kattegat');
    assert.ok(
      waveHeight >= 0.55 && waveHeight <= 0.75,
      `wave height at Kattegat should be ~0.64 m (XyGrib reference), got ${waveHeight?.toFixed(3)}`,
    );
  },
);
