"use strict";
// Loads pre-built land index files bundled in the package, with optional hires (f-tier) override.
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.DILATED_INDEX_VERSION = exports.DILATED_INDEX_MAGIC = exports.EDGE_INDEX_VERSION = exports.EDGE_INDEX_MAGIC = void 0;
exports.pluginDataDir = pluginDataDir;
exports.loadBundledEdgeIndex = loadBundledEdgeIndex;
exports.loadBundledDilatedIndex = loadBundledDilatedIndex;
exports.hiresLandAvailable = hiresLandAvailable;
exports.loadHiresEdgeIndex = loadHiresEdgeIndex;
exports.loadHiresDilatedIndex = loadHiresDilatedIndex;
const zlib = __importStar(require("node:zlib"));
const fs = __importStar(require("node:fs"));
const os = __importStar(require("node:os"));
const path = __importStar(require("node:path"));
exports.EDGE_INDEX_MAGIC = 0x4c4e4458; // 'LNDX'
exports.EDGE_INDEX_VERSION = 2; // v2: polygon data included
exports.DILATED_INDEX_MAGIC = 0x444c4e44; // 'DLND'
exports.DILATED_INDEX_VERSION = 2;
function pluginDataDir(app) {
    const configPath = app.config?.configPath ?? path.join(os.homedir(), '.signalk');
    return path.join(configPath, 'plugin-config-data', 'signalk-weather-routing');
}
function bundledDataDir() {
    // Try the separate land-data package first (REQ-128).
    // Falls back to the bundled data/ directory for backward compatibility.
    try {
        const pkgPath = require.resolve('@kristianwiklund/wr-land-data/package.json');
        return path.join(path.dirname(pkgPath), 'data');
    }
    catch {
        // __dirname is dist/lib/ at runtime; data/ is two levels up at the package root
        return path.join(__dirname, '../../data');
    }
}
// Both edge and dilated indices share this binary layout after the 32-byte header:
//   polygons: per poly → 4×f64BE bbox + u32LE nFloats + 4-byte pad + nFloats×f64 exterior
//   edge grid: per cell → u32LE key + u32LE n + n×u32LE entries
//   poly grid: per cell → u32LE key + u32LE n + n×u32LE indices
function parseIndexBuffer(buf) {
    const nPolygons = buf.readUInt32LE(16);
    const nEdgeCells = buf.readUInt32LE(20);
    const nPolyCells = buf.readUInt32LE(24);
    let off = 32;
    const polygons = [];
    for (let i = 0; i < nPolygons; i++) {
        const bboxLatMin = buf.readDoubleBE(off);
        const bboxLatMax = buf.readDoubleBE(off + 8);
        const bboxLonMin = buf.readDoubleBE(off + 16);
        const bboxLonMax = buf.readDoubleBE(off + 24);
        const nFloats = buf.readUInt32LE(off + 32);
        off += 40; // 4×f64 + u32 + 4 pad → exterior starts on 8-byte boundary
        const exterior = new Float64Array(buf.buffer, buf.byteOffset + off, nFloats);
        off += nFloats * 8;
        polygons.push({ bboxLatMin, bboxLatMax, bboxLonMin, bboxLonMax, exterior });
    }
    const edgeGrid = new Map();
    for (let i = 0; i < nEdgeCells; i++) {
        const key = buf.readUInt32LE(off);
        off += 4;
        const n = buf.readUInt32LE(off);
        off += 4;
        edgeGrid.set(key, new Uint32Array(buf.buffer, buf.byteOffset + off, n));
        off += n * 4;
    }
    const polyGrid = new Map();
    for (let i = 0; i < nPolyCells; i++) {
        const key = buf.readUInt32LE(off);
        off += 4;
        const n = buf.readUInt32LE(off);
        off += 4;
        const polys = [];
        for (let j = 0; j < n; j++) {
            polys.push(buf.readUInt32LE(off));
            off += 4;
        }
        polyGrid.set(key, polys);
    }
    return { polygons, edgeGrid, polyGrid };
}
function extractAndLoad(bundledGz, cachePath, magic, version) {
    if (fs.existsSync(cachePath)) {
        try {
            const buf = fs.readFileSync(cachePath);
            // Magic guards against corrupt or wrong-format files; version bump invalidates caches written by older index formats.
            if (buf.length >= 8 && buf.readUInt32LE(0) === magic && buf.readUInt32LE(4) === version) {
                return parseIndexBuffer(buf);
            }
        }
        catch {
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
function loadBundledEdgeIndex(dataDir) {
    return extractAndLoad(path.join(bundledDataDir(), 'edge-index.bin.gz'), path.join(dataDir, 'edge-index.bin'), exports.EDGE_INDEX_MAGIC, exports.EDGE_INDEX_VERSION);
}
function loadBundledDilatedIndex(dataDir) {
    return extractAndLoad(path.join(bundledDataDir(), 'dilated-edge-index.bin.gz'), path.join(dataDir, 'dilated-edge-index.bin'), exports.DILATED_INDEX_MAGIC, exports.DILATED_INDEX_VERSION);
}
function hiresLandAvailable() {
    return (fs.existsSync(path.join(bundledDataDir(), 'edge-index-hires.bin.gz')) &&
        fs.existsSync(path.join(bundledDataDir(), 'dilated-edge-index-hires.bin.gz')));
}
function loadHiresEdgeIndex(dataDir) {
    return extractAndLoad(path.join(bundledDataDir(), 'edge-index-hires.bin.gz'), path.join(dataDir, 'edge-index-hires.bin'), exports.EDGE_INDEX_MAGIC, exports.EDGE_INDEX_VERSION);
}
function loadHiresDilatedIndex(dataDir) {
    return extractAndLoad(path.join(bundledDataDir(), 'dilated-edge-index-hires.bin.gz'), path.join(dataDir, 'dilated-edge-index-hires.bin'), exports.DILATED_INDEX_MAGIC, exports.DILATED_INDEX_VERSION);
}
