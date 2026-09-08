// Pure grid interpolation helpers. Kept separate from the GDAL-backed loader so routing
// workers can consume already-loaded SharedArrayBuffer data without loading native addons.

import type { CurrentGribData, GribData, WindVector } from '../types';

type GridParams = Pick<GribData, 'latMin' | 'latStep' | 'lonMin' | 'lonStep' | 'nLat' | 'nLon'>;

interface PreparedGrid {
  inverseLatStep: number;
  inverseLonStep: number;
  rowOffsets: Int32Array;
}

const preparedGridCache = new WeakMap<object, PreparedGrid>();
const waveTimeCache = new WeakMap<GribData, Map<number, number>>();

function prepareGrid(params: GridParams): PreparedGrid {
  const cached = preparedGridCache.get(params);
  if (cached) return cached;
  const prepared = {
    inverseLatStep: 1 / params.latStep,
    inverseLonStep: 1 / params.lonStep,
    rowOffsets: Int32Array.from({ length: params.nLat }, (_, latitude) => latitude * params.nLon),
  };
  preparedGridCache.set(params, prepared);
  return prepared;
}

function bilinear(grid: Float32Array, params: GridParams, lat: number, lon: number): number {
  const prepared = prepareGrid(params);
  const latF = (lat - params.latMin) * prepared.inverseLatStep;
  const lonF = (lon - params.lonMin) * prepared.inverseLonStep;
  const latI = Math.max(0, Math.min(params.nLat - 2, Math.floor(latF)));
  const lonI = Math.max(0, Math.min(params.nLon - 2, Math.floor(lonF)));
  const tLat = latF - latI;
  const tLon = lonF - lonI;
  const i00 = prepared.rowOffsets[latI] + lonI;
  const i10 = prepared.rowOffsets[latI + 1] + lonI;
  const i01 = prepared.rowOffsets[latI] + lonI + 1;
  const i11 = prepared.rowOffsets[latI + 1] + lonI + 1;
  return (
    (1 - tLat) * (1 - tLon) * grid[i00] +
    tLat * (1 - tLon) * grid[i10] +
    (1 - tLat) * tLon * grid[i01] +
    tLat * tLon * grid[i11]
  );
}

export function getWaveAt(grib: GribData, lat: number, lon: number, timeMs: number): number | undefined {
  if (!grib.swhByTime || grib.swhByTime.size === 0) return undefined;
  let cache = waveTimeCache.get(grib);
  if (!cache) {
    cache = new Map();
    waveTimeCache.set(grib, cache);
  }
  let bestMs = cache.get(timeMs);
  if (bestMs === undefined) {
    let bestDiff = Infinity;
    for (const ms of grib.swhByTime.keys()) {
      const diff = Math.abs(ms - timeMs);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestMs = ms;
      }
    }
    cache.set(timeMs, bestMs!);
  }
  const gridParams = grib.swhGrid ?? grib;
  const latMax = gridParams.latMin + gridParams.latStep * (gridParams.nLat - 1);
  const lonMax = gridParams.lonMin + gridParams.lonStep * (gridParams.nLon - 1);
  if (lat < gridParams.latMin || lat > latMax || lon < gridParams.lonMin || lon > lonMax) return undefined;
  if (bestMs === undefined) return undefined;
  const value = bilinear(grib.swhByTime.get(bestMs)!, gridParams, lat, lon);
  return value >= 100 ? undefined : value;
}

export function getWindAt(grib: GribData, lat: number, lon: number, timeIdx: number): WindVector {
  return {
    u: bilinear(grib.u10[timeIdx], grib, lat, lon),
    v: bilinear(grib.v10[timeIdx], grib, lat, lon),
  };
}

export function nearestTimeIndex(grib: GribData, time: Date): number {
  const ms = time.getTime();
  let best = 0;
  let bestDiff = Math.abs(grib.times[0].getTime() - ms);
  for (let index = 1; index < grib.times.length; index++) {
    const diff = Math.abs(grib.times[index].getTime() - ms);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = index;
    }
  }
  return best;
}

export function getCurrentAt(data: CurrentGribData, lat: number, lon: number, timeIdx: number): WindVector {
  const latMax = data.latMin + data.latStep * (data.nLat - 1);
  const lonMax = data.lonMin + data.lonStep * (data.nLon - 1);
  if (lat < data.latMin || lat > latMax || lon < data.lonMin || lon > lonMax) return { u: 0, v: 0 };
  return {
    u: bilinear(data.u[timeIdx], data, lat, lon),
    v: bilinear(data.v[timeIdx], data, lat, lon),
  };
}

export function nearestCurrentTimeIndex(data: CurrentGribData, time: Date): number {
  const ms = time.getTime();
  let best = 0;
  let bestDiff = Math.abs(data.times[0].getTime() - ms);
  for (let index = 1; index < data.times.length; index++) {
    const diff = Math.abs(data.times[index].getTime() - ms);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = index;
    }
  }
  return best;
}
