import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import * as gdal from 'gdal-async';
import { loadGdalBathymetry } from '../gdal-bathymetry';

test('loadGdalBathymetry reads a georeferenced GeoTIFF through the packaged GDAL runtime', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'wayfinder-depth-'));
  const rasterPath = path.join(directory, 'depth.tif');
  try {
    const dataset = gdal.drivers.get('GTiff').create(rasterPath, 4, 2, 1, gdal.GDT_Float32);
    dataset.geoTransform = [10, 1, 0, 42, 0, -1];
    dataset.srs = gdal.SpatialReference.fromEPSG(4326);
    const band = dataset.bands.get(1);
    band.noDataValue = -9999;
    band.pixels.write(0, 0, 4, 2, new Float32Array([-10, -8, -2, -9, -10, -10, -10, -10]));
    dataset.close();

    const provider = await loadGdalBathymetry(rasterPath, 1, 'elevation');
    assert.equal(provider.depthAt(41.5, 10.5), 10);
    assert.equal(provider.minimumDepthAlongSegment(41.5, 10.5, 41.5, 13.5), 2);
    provider.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
