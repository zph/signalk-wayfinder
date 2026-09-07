import * as gdal from 'gdal-async';
import { DepthProvider } from '../types';
import { BathymetryValueConvention, RasterDepthProvider, RasterDepthSource } from './raster-depth';

export async function loadGdalBathymetry(
  path: string,
  bandNumber = 1,
  convention: BathymetryValueConvention = 'elevation',
): Promise<DepthProvider> {
  const dataset = await gdal.openAsync(path);
  try {
    if (dataset.rasterSize.x < 1 || dataset.rasterSize.y < 1) throw new Error('bathymetry raster is empty');
    if (bandNumber < 1 || bandNumber > dataset.bands.count()) {
      throw new Error(`bathymetry band ${bandNumber} is outside the raster band range`);
    }
    if (!dataset.geoTransform) throw new Error('bathymetry raster has no geotransform');
    const srs = dataset.srs;
    if (!srs) throw new Error('bathymetry raster has no spatial reference');
    const band = dataset.bands.get(bandNumber);
    const transform = new gdal.CoordinateTransformation(gdal.SpatialReference.fromEPSG(4326), dataset);
    const raster: RasterDepthSource = {
      width: dataset.rasterSize.x,
      height: dataset.rasterSize.y,
      noDataValue: band.noDataValue,
      source: path,
      toPixel(lat, lon) {
        const pixel = transform.transformPoint(lon, lat);
        return { x: pixel.x, y: pixel.y };
      },
      readPixel(x, y) {
        return band.pixels.get(x, y);
      },
      close() {
        dataset.close();
      },
    };
    return new RasterDepthProvider(raster, convention);
  } catch (error) {
    dataset.close();
    throw error;
  }
}
