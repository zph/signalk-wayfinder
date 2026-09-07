import { DepthProvider } from '../types';
import { haversineNM } from './geo';

export type BathymetryValueConvention = 'elevation' | 'depth';

export interface RasterDepthSource {
  readonly width: number;
  readonly height: number;
  readonly noDataValue: number | null;
  readonly source: string;
  toPixel(lat: number, lon: number): { x: number; y: number };
  readPixel(x: number, y: number): number;
  close(): void;
}

function cellsOnLine(x0: number, y0: number, x1: number, y1: number): Array<[number, number]> {
  let x = Math.floor(x0);
  let y = Math.floor(y0);
  const endX = Math.floor(x1);
  const endY = Math.floor(y1);
  const cells: Array<[number, number]> = [[x, y]];
  const dx = x1 - x0;
  const dy = y1 - y0;
  const stepX = Math.sign(dx);
  const stepY = Math.sign(dy);
  const tDeltaX = stepX === 0 ? Infinity : Math.abs(1 / dx);
  const tDeltaY = stepY === 0 ? Infinity : Math.abs(1 / dy);
  let tMaxX = stepX > 0 ? (x + 1 - x0) / dx : stepX < 0 ? (x0 - x) / -dx : Infinity;
  let tMaxY = stepY > 0 ? (y + 1 - y0) / dy : stepY < 0 ? (y0 - y) / -dy : Infinity;
  const maximumCells = Math.abs(endX - x) + Math.abs(endY - y) + 2;
  while ((x !== endX || y !== endY) && cells.length <= maximumCells) {
    if (tMaxX < tMaxY) {
      x += stepX;
      tMaxX += tDeltaX;
    } else if (tMaxY < tMaxX) {
      y += stepY;
      tMaxY += tDeltaY;
    } else {
      x += stepX;
      y += stepY;
      tMaxX += tDeltaX;
      tMaxY += tDeltaY;
    }
    cells.push([x, y]);
  }
  return cells;
}

export class RasterDepthProvider implements DepthProvider {
  readonly source: string;

  constructor(
    private readonly raster: RasterDepthSource,
    private readonly convention: BathymetryValueConvention,
  ) {
    this.source = raster.source;
  }

  depthAt(lat: number, lon: number): number | undefined {
    const pixel = this.raster.toPixel(lat, lon);
    return this.depthAtPixel(Math.floor(pixel.x), Math.floor(pixel.y));
  }

  minimumDepthAlongSegment(lat1: number, lon1: number, lat2: number, lon2: number): number | undefined {
    const lengthNm = haversineNM(lat1, lon1, lat2, lon2);
    const geographicPieces = Math.max(1, Math.ceil(lengthNm));
    let minimum = Infinity;
    let previous = this.raster.toPixel(lat1, lon1);
    for (let piece = 1; piece <= geographicPieces; piece++) {
      const fraction = piece / geographicPieces;
      const current = this.raster.toPixel(lat1 + (lat2 - lat1) * fraction, lon1 + (lon2 - lon1) * fraction);
      for (const [x, y] of cellsOnLine(previous.x, previous.y, current.x, current.y)) {
        const depth = this.depthAtPixel(x, y);
        if (depth === undefined) return undefined;
        minimum = Math.min(minimum, depth);
      }
      previous = current;
    }
    return Number.isFinite(minimum) ? minimum : undefined;
  }

  close(): void {
    this.raster.close();
  }

  private depthAtPixel(x: number, y: number): number | undefined {
    if (x < 0 || y < 0 || x >= this.raster.width || y >= this.raster.height) return undefined;
    const raw = this.raster.readPixel(x, y);
    if (!Number.isFinite(raw)) return undefined;
    const noData = this.raster.noDataValue;
    if (noData !== null && (raw === noData || Math.abs(raw - noData) <= Number.EPSILON * Math.abs(noData))) {
      return undefined;
    }
    const depth = this.convention === 'elevation' ? -raw : raw;
    return depth >= 0 ? depth : undefined;
  }
}
