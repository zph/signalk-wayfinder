import type { CurrentGribData, GribData } from '../types';

const sharedGribCache = new WeakMap<GribData, GribData>();
const sharedCurrentCache = new WeakMap<CurrentGribData, CurrentGribData>();

function shareGrid(grid: Float32Array): Float32Array {
  if (grid.buffer instanceof SharedArrayBuffer) return grid;
  const buffer = new SharedArrayBuffer(grid.byteLength);
  const shared = new Float32Array(buffer);
  shared.set(grid);
  return shared;
}

export function shareGribData(data: GribData): GribData {
  const cached = sharedGribCache.get(data);
  if (cached) return cached;
  const shared: GribData = {
    ...data,
    u10: data.u10.map(shareGrid),
    v10: data.v10.map(shareGrid),
    ...(data.swhByTime
      ? { swhByTime: new Map(Array.from(data.swhByTime, ([time, grid]) => [time, shareGrid(grid)])) }
      : {}),
  };
  sharedGribCache.set(data, shared);
  return shared;
}

export function shareCurrentGribData(data: CurrentGribData): CurrentGribData {
  const cached = sharedCurrentCache.get(data);
  if (cached) return cached;
  const shared: CurrentGribData = {
    ...data,
    u: data.u.map(shareGrid),
    v: data.v.map(shareGrid),
  };
  sharedCurrentCache.set(data, shared);
  return shared;
}
