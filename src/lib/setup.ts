// Loads pre-built land index files bundled in the package, with optional hires (f-tier) override.

import * as zlib from 'node:zlib';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { LandPolygon, LandEdgeIndex } from '../types';
import { SignalKApp } from './signalk-app';

export const EDGE_INDEX_MAGIC = 0x4c4e4458; // 'LNDX'
export const EDGE_INDEX_VERSION = 3; // v3: polygon interiors and their shoreline edges included

export const DILATED_INDEX_MAGIC = 0x444c4e44; // 'DLND'
export const DILATED_INDEX_VERSION = 3;

export function pluginDataDir(app: SignalKApp): string {
  const configPath: string = app.config?.configPath ?? path.join(os.homedir(), '.signalk');
  const root = path.join(configPath, 'plugin-config-data');
  const current = path.join(root, 'signalk-wayfinder');
  const legacy = path.join(root, 'signalk-weather-routing');
  // The product rename must not discard an installed user's extracted shoreline cache. Move the
  // old directory once, before any current-name cache is created. A failed move merely rebuilds the
  // bundled cache in the current directory, which is safe and does not change routing inputs.
  if (!fs.existsSync(current) && fs.existsSync(legacy)) {
    try {
      fs.renameSync(legacy, current);
    } catch {
      /* rebuilt from bundled data below */
    }
  }
  return current;
}

function bundledDataDir(): string {
  // Try the separate land-data package first (REQ-128).
  // Falls back to the bundled data/ directory for backward compatibility.
  try {
    const pkgPath = require.resolve('@kristianwiklund/wr-land-data/package.json');
    return path.join(path.dirname(pkgPath), 'data');
  } catch {
    // __dirname is dist/lib/ at runtime; data/ is two levels up at the package root
    return path.join(__dirname, '../../data');
  }
}

function highResolutionDataDir(dataDir: string): string {
  const externalEdge = path.join(dataDir, 'edge-index-hires.bin.gz');
  const externalDilated = path.join(dataDir, 'dilated-edge-index-hires.bin.gz');
  if (fs.existsSync(externalEdge) && fs.existsSync(externalDilated)) return dataDir;
  return bundledDataDir();
}

// Both edge and dilated indices share this binary layout after the 32-byte header:
//   polygons: per poly → 4×f64BE bbox + u32LE nRings + 4-byte pad,
//             then per ring → u32LE nFloats + 4-byte pad + nFloats×f64 coordinates
//   edge grid: per cell → u32LE key + u32LE n + n×u32LE entries
//   poly grid: per cell → u32LE key + u32LE n + n×u32LE indices
function parseIndexBuffer(buf: Buffer): LandEdgeIndex {
  const nPolygons = buf.readUInt32LE(16);
  const nEdgeCells = buf.readUInt32LE(20);
  const nPolyCells = buf.readUInt32LE(24);
  let off = 32;

  const polygons: LandPolygon[] = [];
  for (let i = 0; i < nPolygons; i++) {
    const bboxLatMin = buf.readDoubleBE(off);
    const bboxLatMax = buf.readDoubleBE(off + 8);
    const bboxLonMin = buf.readDoubleBE(off + 16);
    const bboxLonMax = buf.readDoubleBE(off + 24);
    const nRings = buf.readUInt32LE(off + 32);
    off += 40;
    const rings: Float64Array[] = [];
    for (let ringIndex = 0; ringIndex < nRings; ringIndex++) {
      const nFloats = buf.readUInt32LE(off);
      off += 8;
      rings.push(new Float64Array(buf.buffer, buf.byteOffset + off, nFloats));
      off += nFloats * 8;
    }
    const [exterior, ...interiors] = rings;
    if (!exterior) throw new Error(`Land polygon ${i} has no exterior ring`);
    polygons.push({ bboxLatMin, bboxLatMax, bboxLonMin, bboxLonMax, exterior, interiors });
  }

  const edgeGrid = new Map<number, Uint32Array>();
  for (let i = 0; i < nEdgeCells; i++) {
    const key = buf.readUInt32LE(off);
    off += 4;
    const n = buf.readUInt32LE(off);
    off += 4;
    edgeGrid.set(key, new Uint32Array(buf.buffer, buf.byteOffset + off, n));
    off += n * 4;
  }

  const polyGrid = new Map<number, number[]>();
  for (let i = 0; i < nPolyCells; i++) {
    const key = buf.readUInt32LE(off);
    off += 4;
    const n = buf.readUInt32LE(off);
    off += 4;
    const polys: number[] = [];
    for (let j = 0; j < n; j++) {
      polys.push(buf.readUInt32LE(off));
      off += 4;
    }
    polyGrid.set(key, polys);
  }

  return { polygons, edgeGrid, polyGrid };
}

function extractAndLoad(bundledGz: string, cachePath: string, magic: number, version: number): LandEdgeIndex {
  if (fs.existsSync(cachePath)) {
    try {
      const buf = fs.readFileSync(cachePath);
      // Magic guards against corrupt or wrong-format files; version bump invalidates caches written by older index formats.
      if (buf.length >= 8 && buf.readUInt32LE(0) === magic && buf.readUInt32LE(4) === version) {
        return parseIndexBuffer(buf);
      }
    } catch {
      /* stale or corrupt — fall through to re-extract */
    }
  }

  if (!fs.existsSync(bundledGz)) {
    throw new Error(`Bundled land data not found: ${bundledGz}. ` + 'Run "npm run prepare-land-data" to generate it.');
  }

  const gz = fs.readFileSync(bundledGz);
  const buf = zlib.gunzipSync(gz);
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  fs.writeFileSync(cachePath, buf);
  return parseIndexBuffer(buf);
}

export function loadBundledEdgeIndex(dataDir: string): LandEdgeIndex {
  return extractAndLoad(
    path.join(bundledDataDir(), 'edge-index.bin.gz'),
    path.join(dataDir, 'edge-index.bin'),
    EDGE_INDEX_MAGIC,
    EDGE_INDEX_VERSION,
  );
}

export function loadBundledDilatedIndex(dataDir: string): LandEdgeIndex {
  return extractAndLoad(
    path.join(bundledDataDir(), 'dilated-edge-index.bin.gz'),
    path.join(dataDir, 'dilated-edge-index.bin'),
    DILATED_INDEX_MAGIC,
    DILATED_INDEX_VERSION,
  );
}

export function hiresLandAvailable(dataDir: string): boolean {
  const sourceDir = highResolutionDataDir(dataDir);
  return (
    fs.existsSync(path.join(sourceDir, 'edge-index-hires.bin.gz')) &&
    fs.existsSync(path.join(sourceDir, 'dilated-edge-index-hires.bin.gz'))
  );
}

export function loadHiresEdgeIndex(dataDir: string): LandEdgeIndex {
  return extractAndLoad(
    path.join(highResolutionDataDir(dataDir), 'edge-index-hires.bin.gz'),
    path.join(dataDir, 'edge-index-hires.bin'),
    EDGE_INDEX_MAGIC,
    EDGE_INDEX_VERSION,
  );
}

export function loadHiresDilatedIndex(dataDir: string): LandEdgeIndex {
  return extractAndLoad(
    path.join(highResolutionDataDir(dataDir), 'dilated-edge-index-hires.bin.gz'),
    path.join(dataDir, 'dilated-edge-index-hires.bin'),
    DILATED_INDEX_MAGIC,
    DILATED_INDEX_VERSION,
  );
}
