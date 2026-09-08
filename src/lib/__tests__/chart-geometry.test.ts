import assert from 'node:assert/strict';
import test from 'node:test';
import { routeBounds, vectorLandCharts } from '../chart-geometry';

test('routeBounds leaves room for coastal detours around the direct passage', () => {
  assert.deepEqual(routeBounds([{ lat: 38, lon: -122 }, { lat: 37, lon: -121 }]), [-122.5, 36.5, -120.5, 38.5]);
});

test('vectorLandCharts ranks local large-scale LNDARE vector charts ahead of broad charts', () => {
  const charts = vectorLandCharts({
    raster: { format: 'png', bounds: [-180, -90, 180, 90], url: '/r/{z}/{x}/{y}', layers: [] },
    broad: {
      identifier: 'broad',
      format: 'pbf',
      bounds: [-180, -80, 180, 80],
      minzoom: 3,
      maxzoom: 12,
      scale: 1_000_000,
      url: '/b/{z}/{x}/{y}',
      layers: ['LNDARE'],
    },
    california: {
      identifier: 'california',
      name: 'NOAA ENC California',
      format: 'pbf',
      bounds: [-125.42, 31.95, -116.71, 43.2],
      minzoom: 8,
      maxzoom: 16,
      scale: 250_000,
      url: '/c/{z}/{x}/{y}',
      layers: ['COALNE', 'LNDARE', 'DEPARE'],
    },
  });
  assert.deepEqual(
    charts.map((chart) => chart.identifier),
    ['california', 'broad'],
  );
});

test('vectorLandCharts rejects vector sources without navigable land polygons', () => {
  assert.deepEqual(
    vectorLandCharts({ depth: { format: 'pbf', bounds: [-123, 37, -121, 39], url: '/d', layers: ['DEPARE'] } }),
    [],
  );
});
