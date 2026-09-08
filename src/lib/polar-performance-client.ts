import * as fs from 'node:fs/promises';
import * as nodepath from 'node:path';
import type { PolarData } from '../types';
import type { SignalKApp } from './signalk-app';

const POLAR_PERFORMANCE_PATH = '/plugins/signalk-polar-performance-plugin';
const MPS_TO_KNOTS = 1.9438444924406;
const RAD_TO_DEG = 180 / Math.PI;

interface CanonicalPolarResource {
  id: string;
  name?: string;
  kind: 'polarTable';
  schemaVersion: string;
  units: { tws: 'm/s'; twa: 'rad'; boatSpeed: 'm/s' };
  symmetry: { portStarboardSymmetric: true };
  axes: { tws: number[]; twa: number[] };
  values: { boatSpeedMatrix: number[][] };
}

export interface LoadedPolarPerformance {
  id: string;
  name: string;
  performanceAdjustment: number;
  polar: PolarData;
}

interface PolarPerformanceSettings {
  activePolar?: unknown;
  perfAdjust?: unknown;
}

interface StoredPolarPerformanceOptions {
  enabled?: unknown;
  configuration?: unknown;
}

function finiteArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.length > 0 && value.every((entry) => Number.isFinite(entry));
}

function strictlyIncreasing(values: number[]): boolean {
  return values.every((value, index) => index === 0 || value > values[index - 1]);
}

function canonicalPolar(value: unknown): CanonicalPolarResource {
  if (typeof value !== 'object' || value === null) throw new Error('canonical polar response is not an object');
  const resource = value as Partial<CanonicalPolarResource>;
  if (resource.kind !== 'polarTable') throw new Error('active resource is not a polarTable');
  if (resource.units?.tws !== 'm/s' || resource.units?.twa !== 'rad' || resource.units?.boatSpeed !== 'm/s') {
    throw new Error('canonical polar must use m/s and rad SI units');
  }
  if (resource.symmetry?.portStarboardSymmetric !== true) {
    throw new Error('Wayfinder currently requires a port/starboard symmetric polar');
  }
  if (!finiteArray(resource.axes?.tws) || !finiteArray(resource.axes?.twa)) {
    throw new Error('canonical polar axes are missing or invalid');
  }
  if (
    !strictlyIncreasing(resource.axes.tws) ||
    resource.axes.tws.some((value) => value < 0) ||
    !strictlyIncreasing(resource.axes.twa) ||
    resource.axes.twa.some((value) => value < 0 || value > Math.PI)
  ) {
    throw new Error('canonical polar axes must be sorted and within their supported ranges');
  }
  const matrix = resource.values?.boatSpeedMatrix;
  if (
    !Array.isArray(matrix) ||
    matrix.length !== resource.axes.tws.length ||
    !matrix.every(
      (row) => finiteArray(row) && row.length === resource.axes!.twa.length && row.every((speed) => speed >= 0),
    )
  ) {
    throw new Error('canonical polar boat-speed matrix does not match its axes');
  }
  return resource as CanonicalPolarResource;
}

function normalizedBaseUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Polar Performance API URL must use http or https');
  }
  return url.toString().replace(/\/$/, '');
}

export function polarPerformanceBaseUrl(app: SignalKApp, configuredUrl?: string): string {
  if (configuredUrl?.trim()) return normalizedBaseUrl(configuredUrl.trim());
  const configuredPort = Number(app.config?.port ?? app.config?.settings?.port);
  const port = Number.isInteger(configuredPort) && configuredPort > 0 ? configuredPort : 3000;
  return `http://127.0.0.1:${port}${POLAR_PERFORMANCE_PATH}`;
}

function performanceAdjustment(settings: PolarPerformanceSettings | null): number {
  const configuredAdjustment = Number(settings?.perfAdjust);
  return Number.isFinite(configuredAdjustment) && configuredAdjustment > 0 ? configuredAdjustment : 1;
}

function convertedPolar(resourceValue: unknown, id: string, adjustment: number): LoadedPolarPerformance {
  const resource = canonicalPolar(resourceValue);
  return {
    id,
    name: resource.name?.trim() || id,
    performanceAdjustment: adjustment,
    polar: {
      tws: resource.axes.tws.map((value) => value * MPS_TO_KNOTS),
      twa: resource.axes.twa.map((value) => value * RAD_TO_DEG),
      speeds: resource.axes.twa.map((_twa, twaIndex) =>
        resource.axes.tws.map(
          (_tws, twsIndex) => resource.values.boatSpeedMatrix[twsIndex][twaIndex] * MPS_TO_KNOTS * adjustment,
        ),
      ),
    },
  };
}

export async function loadLocalActivePolarPerformance(configPath: string): Promise<LoadedPolarPerformance> {
  const pluginConfigDir = nodepath.join(configPath, 'plugin-config-data');
  const settingsPath = nodepath.join(pluginConfigDir, 'signalk-polar-performance-plugin.json');
  let storedOptions: StoredPolarPerformanceOptions;
  try {
    storedOptions = JSON.parse(await fs.readFile(settingsPath, 'utf8')) as StoredPolarPerformanceOptions;
  } catch (error) {
    throw new Error(
      `cannot read Polar Performance settings at ${settingsPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (storedOptions.enabled !== true) throw new Error('Polar Performance is not enabled');
  if (typeof storedOptions.configuration !== 'object' || storedOptions.configuration === null) {
    throw new Error('Polar Performance configuration is missing');
  }
  const settings = storedOptions.configuration as PolarPerformanceSettings;
  if (typeof settings.activePolar !== 'string' || settings.activePolar.length === 0) {
    throw new Error('Polar Performance has no active polar');
  }
  if (nodepath.basename(settings.activePolar) !== settings.activePolar) {
    throw new Error('Polar Performance active polar id is invalid');
  }
  const resourcePath = nodepath.join(
    pluginConfigDir,
    'signalk-polar-performance-plugin',
    `${settings.activePolar}.json`,
  );
  let resource: unknown;
  try {
    resource = JSON.parse(await fs.readFile(resourcePath, 'utf8')) as unknown;
  } catch (error) {
    throw new Error(
      `cannot read active Polar Performance polar at ${resourcePath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return convertedPolar(resource, settings.activePolar, performanceAdjustment(settings));
}

async function responseJson(response: Response, description: string): Promise<unknown> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok) {
    const detail =
      typeof body === 'object' && body !== null && typeof (body as { error?: unknown }).error === 'string'
        ? `: ${(body as { error: string }).error}`
        : '';
    throw new Error(`${description} failed with HTTP ${response.status}${detail}`);
  }
  return body;
}

async function getJson(url: string, description: string, fetchImpl: typeof fetch, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { headers: { accept: 'application/json' }, signal: controller.signal });
    return await responseJson(response, description);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`${description} timed out after ${timeoutMs} ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function loadActivePolarPerformance(
  baseUrl: string,
  options: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<LoadedPolarPerformance> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 5_000;
  const base = normalizedBaseUrl(baseUrl);
  const active = (await getJson(
    `${base}/polars/active`,
    'Active Polar Performance polar request',
    fetchImpl,
    timeoutMs,
  )) as {
    id?: unknown;
  };
  if (typeof active?.id !== 'string' || active.id.length === 0) {
    throw new Error('Polar Performance has no active polar');
  }

  const encodedId = encodeURIComponent(active.id);
  const [resourceValue, settingsValue] = await Promise.all([
    getJson(`${base}/polars/${encodedId}`, 'Polar Performance table request', fetchImpl, timeoutMs),
    getJson(`${base}/settings`, 'Polar Performance settings request', fetchImpl, timeoutMs),
  ]);
  return convertedPolar(
    resourceValue,
    active.id,
    performanceAdjustment(settingsValue as PolarPerformanceSettings | null),
  );
}
