import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RasterDepthProvider, type RasterDepthSource } from '../raster-depth';

function source(values: number[], width = 4, height = 2, noDataValue: number | null = -9999): RasterDepthSource {
  return {
    width,
    height,
    noDataValue,
    source: 'synthetic bathymetry',
    toPixel(lat, lon) {
      return { x: lon, y: lat };
    },
    readPixel(x, y) {
      return values[y * width + x];
    },
    close() {},
  };
}

test('RasterDepthProvider converts negative elevations into positive depths', () => {
  const provider = new RasterDepthProvider(source([-10, -8, -6, -4, -3, -2, -1, 0]), 'elevation');
  assert.equal(provider.depthAt(0.2, 0.2), 10);
  assert.equal(provider.depthAt(0.2, 3.2), 4);
});

test('RasterDepthProvider finds the shallowest raster cell touched by a leg', () => {
  const provider = new RasterDepthProvider(source([10, 8, 2, 9, 10, 10, 10, 10]), 'depth');
  assert.equal(provider.minimumDepthAlongSegment(0.2, 0.2, 0.2, 3.2), 2);
});

test('RasterDepthProvider treats nodata and out-of-bounds coverage as unavailable', () => {
  const provider = new RasterDepthProvider(source([10, -9999, 8, 7, 10, 10, 10, 10]), 'depth');
  assert.equal(provider.minimumDepthAlongSegment(0.2, 0.2, 0.2, 2.2), undefined);
  assert.equal(provider.depthAt(9, 9), undefined);
});
