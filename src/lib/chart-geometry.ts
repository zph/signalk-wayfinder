// Route-local navigability geometry sourced from installed Signal K vector charts.

import { VectorTile } from '@mapbox/vector-tile';
import Pbf from 'pbf';
import type { LandEdgeIndex, LandPolygon, LatLon } from '../types';
import { buildLandEdgeIndex } from './landmask';

export interface VectorChartDescriptor {
  identifier: string;
  name?: string;
  format: string;
  bounds: [number, number, number, number];
  minzoom: number;
  maxzoom: number;
  scale?: number;
  url: string;
  layers: string[];
}

export interface RouteGeometry {
  index: LandEdgeIndex;
  source: string;
  zoom: number;
  tileCount: number;
}

type GeoJsonPolygon = { type: 'Polygon'; coordinates: number[][][] };
type GeoJsonMultiPolygon = { type: 'MultiPolygon'; coordinates: number[][][][] };

const MAX_TILES = 96;
const ROUTE_PADDING_DEG = 0.04;
const MAX_CACHED_TILES = 512;
const tileCache = new Map<string, Promise<Uint8Array>>();

function finiteBounds(value: unknown): value is [number, number, number, number] {
  return (
    Array.isArray(value) &&
    value.length === 4 &&
    value.every((coordinate) => typeof coordinate === 'number' && Number.isFinite(coordinate))
  );
}

export function vectorLandCharts(resources: unknown): VectorChartDescriptor[] {
  if (!resources || typeof resources !== 'object') return [];
  return Object.entries(resources as Record<string, unknown>)
    .flatMap(([id, raw]) => {
      if (!raw || typeof raw !== 'object') return [];
      const chart = raw as Record<string, unknown>;
      const layers = Array.isArray(chart.layers)
        ? chart.layers.filter((layer): layer is string => typeof layer === 'string')
        : [];
      if (
        chart.format !== 'pbf' ||
        !finiteBounds(chart.bounds) ||
        typeof chart.url !== 'string' ||
        !layers.includes('LNDARE')
      )
        return [];
      return [
        {
          identifier: typeof chart.identifier === 'string' ? chart.identifier : id,
          name: typeof chart.name === 'string' ? chart.name : undefined,
          format: chart.format,
          bounds: chart.bounds,
          minzoom: Number(chart.minzoom ?? 0),
          maxzoom: Number(chart.maxzoom ?? 14),
          scale: typeof chart.scale === 'number' ? chart.scale : undefined,
          url: chart.url,
          layers,
        },
      ];
    })
    .sort((a, b) => (a.scale ?? Number.MAX_SAFE_INTEGER) - (b.scale ?? Number.MAX_SAFE_INTEGER));
}

function routeBounds(points: LatLon[]): [number, number, number, number] {
  const lons = points.map((point) => point.lon);
  const lats = points.map((point) => point.lat);
  return [
    Math.max(-180, Math.min(...lons) - ROUTE_PADDING_DEG),
    Math.max(-85, Math.min(...lats) - ROUTE_PADDING_DEG),
    Math.min(180, Math.max(...lons) + ROUTE_PADDING_DEG),
    Math.min(85, Math.max(...lats) + ROUTE_PADDING_DEG),
  ];
}

function contains(outer: [number, number, number, number], inner: [number, number, number, number]): boolean {
  return inner[0] >= outer[0] && inner[1] >= outer[1] && inner[2] <= outer[2] && inner[3] <= outer[3];
}

function lonToX(lon: number, zoom: number): number {
  return Math.floor(((lon + 180) / 360) * 2 ** zoom);
}

function latToY(lat: number, zoom: number): number {
  return Math.floor(((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * 2 ** zoom);
}

function tileRange(bounds: [number, number, number, number], zoom: number) {
  const xMin = lonToX(bounds[0], zoom);
  const xMax = lonToX(bounds[2], zoom);
  const yMin = latToY(bounds[3], zoom);
  const yMax = latToY(bounds[1], zoom);
  return { xMin, xMax, yMin, yMax, count: (xMax - xMin + 1) * (yMax - yMin + 1) };
}

function ring(values: number[][]): Float64Array {
  const flat = new Float64Array(values.length * 2);
  for (let i = 0; i < values.length; i++) {
    flat[i * 2] = values[i][0];
    flat[i * 2 + 1] = values[i][1];
  }
  return flat;
}

function landPolygon(values: number[][][]): LandPolygon | null {
  if (values.length === 0 || values[0].length < 3) return null;
  const exterior = ring(values[0]);
  const lons = values[0].map((point) => point[0]);
  const lats = values[0].map((point) => point[1]);
  return {
    bboxLatMin: Math.min(...lats),
    bboxLatMax: Math.max(...lats),
    bboxLonMin: Math.min(...lons),
    bboxLonMax: Math.max(...lons),
    exterior,
    ...(values.length > 1 ? { interiors: values.slice(1).map(ring) } : {}),
  };
}

function polygonsFromGeometry(geometry: GeoJsonPolygon | GeoJsonMultiPolygon): LandPolygon[] {
  const values = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  return values.map(landPolygon).filter((polygon): polygon is LandPolygon => polygon !== null);
}

async function fetchTile(url: URL, fetcher: typeof fetch): Promise<Uint8Array> {
  const key = url.href;
  const cached = tileCache.get(key);
  if (cached) return cached;
  const pending = (async () => {
    const response = await fetcher(url);
    if (!response.ok) throw new Error(`Chart tile ${url.pathname} failed: HTTP ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  })();
  tileCache.set(key, pending);
  if (tileCache.size > MAX_CACHED_TILES) tileCache.delete(tileCache.keys().next().value!);
  try {
    return await pending;
  } catch (error) {
    tileCache.delete(key);
    throw error;
  }
}

export async function resolveChartGeometry(
  resources: unknown,
  points: LatLon[],
  origin: string,
  fetcher: typeof fetch = fetch,
): Promise<RouteGeometry | null> {
  const bounds = routeBounds(points);
  const chart = vectorLandCharts(resources).find((candidate) => contains(candidate.bounds, bounds));
  if (!chart) return null;

  let zoom = Math.min(chart.maxzoom, 16);
  let tiles = tileRange(bounds, zoom);
  while (zoom > chart.minzoom && tiles.count > MAX_TILES) tiles = tileRange(bounds, --zoom);
  if (tiles.count > MAX_TILES) return null;

  const coordinates: Array<{ x: number; y: number }> = [];
  for (let x = tiles.xMin; x <= tiles.xMax; x++) {
    for (let y = tiles.yMin; y <= tiles.yMax; y++) coordinates.push({ x, y });
  }
  const decoded = await Promise.all(
    coordinates.map(async ({ x, y }) => {
      const path = chart.url.replace('{z}', String(zoom)).replace('{x}', String(x)).replace('{y}', String(y));
      const tile = new VectorTile(new Pbf(await fetchTile(new URL(path, origin), fetcher)));
      const layer = tile.layers.LNDARE;
      const tilePolygons: LandPolygon[] = [];
      if (!layer) return tilePolygons;
      for (let i = 0; i < layer.length; i++) {
        const geometry = layer.feature(i).toGeoJSON(x, y, zoom).geometry;
        if (geometry.type === 'Polygon' || geometry.type === 'MultiPolygon')
          tilePolygons.push(...polygonsFromGeometry(geometry as GeoJsonPolygon | GeoJsonMultiPolygon));
      }
      return tilePolygons;
    }),
  );
  const polygons = decoded.flat();
  if (polygons.length === 0) return null;
  return {
    index: buildLandEdgeIndex(polygons),
    source: chart.name ?? chart.identifier,
    zoom,
    tileCount: tiles.count,
  };
}
