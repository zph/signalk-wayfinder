// Location/time-specific NOAA GFS GRIB acquisition with atomic route-bundle caching.

import * as fs from 'node:fs/promises';
import * as nodepath from 'node:path';
import type { LatLon } from '../types';

export interface AutoGribRequest {
  points: LatLon[];
  departureTime: Date;
  gribDir: string;
}

export interface AutoGribResult {
  path: string;
  cycle: Date;
  forecastHours: number;
  cacheHit: boolean;
}

const NOMADS = 'https://nomads.ncep.noaa.gov/cgi-bin';
const MAX_FORECAST_HOURS = 384;
const CACHE_VERSION = 1;

function gfsCycle(now: Date): Date {
  // GFS cycles are published every six hours; five hours leaves enough time for the run to complete.
  const ready = new Date(now.getTime() - 5 * 3_600_000);
  ready.setUTCHours(Math.floor(ready.getUTCHours() / 6) * 6, 0, 0, 0);
  return ready;
}

function paddedBounds(points: LatLon[]): [number, number, number, number] {
  const lons = points.map((point) => point.lon);
  const lats = points.map((point) => point.lat);
  return [
    Math.max(-180, Math.floor(Math.min(...lons) - 1)),
    Math.max(-89, Math.floor(Math.min(...lats) - 1)),
    Math.min(180, Math.ceil(Math.max(...lons) + 1)),
    Math.min(89, Math.ceil(Math.max(...lats) + 1)),
  ];
}

function queryUrl(kind: 'wind' | 'wave', cycle: Date, hour: number, bounds: [number, number, number, number]): URL {
  const ymd = cycle.toISOString().slice(0, 10).replace(/-/g, '');
  const hh = String(cycle.getUTCHours()).padStart(2, '0');
  const fff = String(hour).padStart(3, '0');
  const [leftlon, bottomlat, rightlon, toplat] = bounds;
  const params = new URLSearchParams({
    file: kind === 'wind' ? `gfs.t${hh}z.pgrb2.0p25.f${fff}` : `gfswave.t${hh}z.global.0p16.f${fff}.grib2`,
    ...(kind === 'wind'
      ? { lev_10_m_above_ground: 'on', var_UGRD: 'on', var_VGRD: 'on' }
      : { lev_surface: 'on', var_HTSGW: 'on' }),
    subregion: '',
    leftlon: String(leftlon),
    rightlon: String(rightlon),
    toplat: String(toplat),
    bottomlat: String(bottomlat),
    dir: kind === 'wind' ? `/gfs.${ymd}/${hh}/atmos` : `/gfs.${ymd}/${hh}/wave/gridded`,
  });
  return new URL(`${NOMADS}/${kind === 'wind' ? 'filter_gfs_0p25.pl' : 'filter_gfswave.pl'}?${params}`);
}

async function fetchGrib(url: URL, fetcher: typeof fetch): Promise<Buffer> {
  let currentUrl = url;
  let lastStatus = 0;
  for (let attempt = 0; attempt < 6; attempt++) {
    const response = await fetcher(currentUrl, {
      signal: AbortSignal.timeout(90_000),
      redirect: 'follow',
      headers: { 'user-agent': 'signalk-wayfinder/1.0 (route forecast acquisition)' },
    });
    lastStatus = response.status;

    // Some fetch implementations embedded by Signal K return redirects even when
    // redirect=follow is requested. Follow those explicitly and keep the bounded
    // retry loop for transient NOMADS load-shedding responses.
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (location) {
        currentUrl = new URL(location, currentUrl);
        continue;
      }
    }
    if (response.ok) {
      const data = Buffer.from(await response.arrayBuffer());
      if (data.length < 16 || data.subarray(0, 4).toString('ascii') !== 'GRIB')
        throw new Error('NOAA forecast response was not a GRIB2 file');
      return data;
    }
    if (response.status !== 429 && response.status < 500 && response.status !== 302) break;
    await new Promise((resolve) => setTimeout(resolve, Math.min(8_000, 1_000 * 2 ** attempt)));
  }
  throw new Error(`NOAA forecast request failed after retries: HTTP ${lastStatus}`);
}

async function mapConcurrent<T, R>(values: T[], limit: number, fn: (value: T) => Promise<R>): Promise<R[]> {
  const output = new Array<R>(values.length);
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < values.length) {
      const index = cursor++;
      output[index] = await fn(values[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, worker));
  return output;
}

export async function ensureAutoGrib(
  request: AutoGribRequest,
  fetcher: typeof fetch = fetch,
  now = new Date(),
): Promise<AutoGribResult> {
  const cycle = gfsCycle(now);
  const leadHours = Math.max(0, (request.departureTime.getTime() - cycle.getTime()) / 3_600_000);
  // Always acquire the complete model horizon for this route's geographic subset. Sailing speed,
  // daylight rests, and future winds make duration estimates unreliable, while a truncated bundle
  // can turn an otherwise routable passage into a misleading partial result.
  const finalHour = MAX_FORECAST_HOURS;
  if (request.departureTime.getTime() < cycle.getTime() - 3 * 3_600_000)
    throw new Error('Automatic GFS acquisition cannot serve historical departures; load an archived GRIB instead');
  if (leadHours > MAX_FORECAST_HOURS)
    throw new Error(`Departure is beyond the ${MAX_FORECAST_HOURS}-hour GFS forecast window`);
  const bounds = paddedBounds(request.points);
  const startHour = Math.max(0, Math.floor(leadHours / 3) * 3);
  const hours: number[] = [];
  for (let hour = startHour; hour <= finalHour; hour += 3) hours.push(hour);
  const stamp = cycle.toISOString().replace(/[-:]/g, '').slice(0, 11);
  const key = `${bounds.join('_')}_${startHour}_${finalHour}`.replace(/-/g, 'm');
  const path = nodepath.join(request.gribDir, `auto-gfs-${stamp}-${key}.grib2`);
  try {
    const stat = await fs.stat(path);
    if (stat.size > 16) return { path, cycle, forecastHours: finalHour, cacheHit: true };
  } catch {
    // Cache miss.
  }

  await fs.mkdir(request.gribDir, { recursive: true });
  const chunkDir = nodepath.join(request.gribDir, '.wayfinder-auto-grib-chunks');
  await fs.mkdir(chunkDir, { recursive: true });
  const chunkKey = `${stamp}-${bounds.join('_').replace(/-/g, 'm')}`;
  const chunks = await mapConcurrent(hours, 1, async (hour) => {
    const chunkPath = nodepath.join(chunkDir, `${chunkKey}-f${String(hour).padStart(3, '0')}.grib2`);
    try {
      const cached = await fs.readFile(chunkPath);
      if (cached.length >= 32 && cached.subarray(0, 4).toString('ascii') === 'GRIB') return cached;
    } catch {
      // Missing or unreadable slice; download it below.
    }
    // NOMADS rate-limits bursts of subset requests. Fetch the two model products
    // serially, persist each completed forecast hour, and pause briefly before
    // requesting the next one. A retry can then resume instead of starting the
    // entire 384-hour acquisition again.
    const wind = await fetchGrib(queryUrl('wind', cycle, hour, bounds), fetcher);
    const wave = await fetchGrib(queryUrl('wave', cycle, hour, bounds), fetcher);
    const chunk = Buffer.concat([wind, wave]);
    const chunkTemp = `${chunkPath}.${process.pid}.${Date.now()}.tmp`;
    try {
      await fs.writeFile(chunkTemp, chunk);
      await fs.rename(chunkTemp, chunkPath);
    } finally {
      await fs.unlink(chunkTemp).catch(() => {});
    }
    if (fetcher === fetch) await new Promise((resolve) => setTimeout(resolve, 100));
    return chunk;
  });
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fs.writeFile(temp, Buffer.concat(chunks));
    await fs.rename(temp, path);
    await fs.writeFile(
      `${path}.json`,
      JSON.stringify({ version: CACHE_VERSION, cycle: cycle.toISOString(), bounds, startHour, finalHour, hours }),
    );
  } finally {
    await fs.unlink(temp).catch(() => {});
  }
  return { path, cycle, forecastHours: finalHour, cacheHit: false };
}
