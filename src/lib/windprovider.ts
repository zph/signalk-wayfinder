// MultiFileWindProvider: resolves wind and wave lookups across multiple GRIB files.
// When files overlap spatially and temporally, the highest-priority covering file wins:
// newest referenceTime (model run), then finest temporal granularity, then finest spatial
// step, with file mtime only as a last-resort tiebreaker. Coverage + selection is one pass.

import { GribFileEntry, WindProvider, WindVector } from '../types';
import { getWindAt, getWaveAt, nearestTimeIndex } from './grib-sampling';

export function nearestIdx(times: Date[], t: Date): number {
  const ms = t.getTime();
  let best = 0,
    bestDiff = Infinity;
  for (let i = 0; i < times.length; i++) {
    const diff = Math.abs(times[i].getTime() - ms);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = i;
    }
  }
  return best;
}

// Mean interval between consecutive timesteps (ms). Smaller = temporally finer.
// Single-step files have no measurable granularity and sort as coarsest so multi-step
// forecasts win granularity ties.
function meanStepMs(times: Date[] | undefined | null): number {
  if (!times || times.length < 2) return Number.MAX_SAFE_INTEGER;
  let sum = 0;
  for (let i = 1; i < times.length; i++) sum += times[i].getTime() - times[i - 1].getTime();
  return sum / (times.length - 1);
}

function coversPoint(entry: GribFileEntry, lat: number, lon: number): boolean {
  const { latMin, latMax, lonMin, lonMax } = entry.meta;
  return lat >= latMin && lat <= latMax && lon >= lonMin && lon <= lonMax;
}

export class MultiFileWindProvider implements WindProvider {
  readonly times: Date[];
  // Sorted by selection priority (see file header); the first covering file wins.
  private readonly sortedFiles: GribFileEntry[];
  private readonly timeIndexes = new Map<GribFileEntry, Int32Array>();

  constructor(files: GribFileEntry[]) {
    const withGran = files.map((e) => ({ e, ms: meanStepMs(e.data?.times) }));
    withGran.sort((a, b) => {
      // Newest model run first: a fresher prognosis wins over an older one regardless of
      // file mtime (a re-downloaded old forecast must not beat a newer model run).
      const ref = b.e.meta.referenceTime.getTime() - a.e.meta.referenceTime.getTime();
      if (ref !== 0) return ref;
      // Finest temporal granularity first (smaller mean timestep).
      if (a.ms !== b.ms) return a.ms - b.ms;
      // Finest spatial resolution first (smaller latStep).
      const lat = a.e.meta.latStep - b.e.meta.latStep;
      if (lat !== 0) return lat;
      // Last-resort tiebreaker: newest file on disk.
      return b.e.meta.mtime - a.e.meta.mtime;
    });
    this.sortedFiles = withGran.map((x) => x.e);

    const msSet = new Set<number>();
    for (const f of this.sortedFiles) {
      for (const t of f.data!.times) msSet.add(t.getTime());
    }
    this.times = Array.from(msSet)
      .sort((a, b) => a - b)
      .map((ms) => new Date(ms));
    for (const entry of this.sortedFiles) {
      this.timeIndexes.set(
        entry,
        Int32Array.from(this.times, (time) => nearestTimeIndex(entry.data!, time)),
      );
    }
  }

  // Single pass: returns the highest-priority file covering the point+time, or undefined.
  private selectFile(lat: number, lon: number, timeIdx: number): GribFileEntry | undefined {
    const tMs = this.times[timeIdx].getTime();
    return this.sortedFiles.find(
      (e) => coversPoint(e, lat, lon) && e.meta.timeStart.getTime() <= tMs && e.meta.timeEnd.getTime() >= tMs,
    );
  }

  getWind(lat: number, lon: number, timeIdx: number): WindVector {
    // One scan only (was: coversPointAtTime .some() + selectFile .find() — BUG-129).
    const f = this.selectFile(lat, lon, timeIdx);
    if (!f) return { u: 0, v: 0 };
    return getWindAt(f.data!, lat, lon, this.timeIndexes.get(f)![timeIdx]);
  }

  getFilePathForPoint(lat: number, lon: number, timeIdx: number): string {
    const f = this.selectFile(lat, lon, timeIdx);
    return f ? f.meta.path : '';
  }

  getWave(lat: number, lon: number, t: Date): number | undefined {
    const waveFiles = this.sortedFiles.filter((e) => e.data?.swhByTime?.size);
    if (waveFiles.length === 0) return undefined;
    const tMs = t.getTime();
    const f = waveFiles.find(
      (e) => coversPoint(e, lat, lon) && e.meta.timeStart.getTime() <= tMs && e.meta.timeEnd.getTime() >= tMs,
    );
    if (!f) return undefined;
    return getWaveAt(f.data!, lat, lon, tMs);
  }

  coversPoint(lat: number, lon: number): boolean {
    return this.sortedFiles.some((e) => coversPoint(e, lat, lon));
  }

  coversPointAtTime(lat: number, lon: number, timeIdx: number): boolean {
    const tMs = this.times[timeIdx].getTime();
    return this.sortedFiles.some(
      (e) => coversPoint(e, lat, lon) && e.meta.timeStart.getTime() <= tMs && e.meta.timeEnd.getTime() >= tMs,
    );
  }
}
