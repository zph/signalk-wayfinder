import assert from 'node:assert/strict';
import test from 'node:test';
import { vectorLandCharts } from '../chart-geometry';

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
