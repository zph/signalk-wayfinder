// Ocean current provider: resolves current lookups from a single ocean current GRIB file.

import { CurrentFileEntry, CurrentProvider, GribFileMeta, WindVector } from '../types';
import { getCurrentAt, nearestCurrentTimeIndex } from './grib-sampling';

function coversPoint(meta: GribFileMeta, lat: number, lon: number): boolean {
  return lat >= meta.latMin && lat <= meta.latMax && lon >= meta.lonMin && lon <= meta.lonMax;
}

export class SingleFileCurrentProvider implements CurrentProvider {
  readonly times: Date[];
  readonly meta: GribFileMeta;
  private readonly entry: CurrentFileEntry;

  constructor(entry: CurrentFileEntry) {
    if (!entry.data) throw new Error('CurrentFileEntry has no loaded data');
    this.entry = entry;
    this.times = entry.data.times;
    this.meta = entry.meta;
  }

  getCurrent(lat: number, lon: number, t: Date): WindVector {
    if (!coversPoint(this.meta, lat, lon)) return { u: 0, v: 0 };
    const timeIdx = nearestCurrentTimeIndex(this.entry.data!, t);
    return getCurrentAt(this.entry.data!, lat, lon, timeIdx);
  }

  coversPoint(lat: number, lon: number): boolean {
    return coversPoint(this.meta, lat, lon);
  }
}
