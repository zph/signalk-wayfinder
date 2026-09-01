"use strict";
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const fs = __importStar(require("node:fs"));
const fsp = __importStar(require("node:fs/promises"));
const os = __importStar(require("node:os"));
const path = __importStar(require("node:path"));
const polar_1 = require("../polar");
// Minimal inline polar for testing — minimum TWA is 30° (realistic tacking angle):
// TWS: 10, 20
// TWA: 30 →  3,  5
//       90 →  5, 10
//      180 →  3,  6
const POLAR_CSV = ['twa/tws;10;20', '30;3;5', '90;5;10', '180;3;6'].join('\n');
let tmpDir;
let polar;
(0, node_test_1.before)(async () => {
    tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'polar-test-'));
    const tmpFile = path.join(tmpDir, 'polar.csv');
    fs.writeFileSync(tmpFile, POLAR_CSV);
    polar = (0, polar_1.parsePolar)(tmpFile);
});
(0, node_test_1.after)(async () => {
    if (tmpDir)
        await fsp.rm(tmpDir, { recursive: true, force: true });
});
(0, node_test_1.test)('parsePolar: parses header TWS values', () => {
    strict_1.default.deepStrictEqual(polar.tws, [10, 20]);
});
(0, node_test_1.test)('parsePolar: parses TWA rows', () => {
    strict_1.default.deepStrictEqual(polar.twa, [30, 90, 180]);
});
(0, node_test_1.test)('parsePolar: speeds array shape', () => {
    strict_1.default.strictEqual(polar.speeds.length, 3);
    strict_1.default.deepStrictEqual(polar.speeds[1], [5, 10]);
});
(0, node_test_1.test)('interpolateBoatSpeed: exact grid point TWA=90 TWS=10 → 5 kt', () => {
    const spd = (0, polar_1.interpolateBoatSpeed)(polar, 90, 10);
    strict_1.default.ok(Math.abs(spd - 5) < 0.001, `expected 5, got ${spd}`);
});
(0, node_test_1.test)('interpolateBoatSpeed: exact grid point TWA=90 TWS=20 → 10 kt', () => {
    const spd = (0, polar_1.interpolateBoatSpeed)(polar, 90, 20);
    strict_1.default.ok(Math.abs(spd - 10) < 0.001, `expected 10, got ${spd}`);
});
(0, node_test_1.test)('interpolateBoatSpeed: midpoint TWS=15 at TWA=90 → 7.5 kt', () => {
    const spd = (0, polar_1.interpolateBoatSpeed)(polar, 90, 15);
    strict_1.default.ok(Math.abs(spd - 7.5) < 0.001, `expected 7.5, got ${spd}`);
});
(0, node_test_1.test)('interpolateBoatSpeed: midpoint TWA=135 at TWS=10 → midpoint 5 and 3 = 4 kt', () => {
    // TWA=135 is midpoint between 90 and 180; TWS=10 gives (5+3)/2 = 4
    const spd = (0, polar_1.interpolateBoatSpeed)(polar, 135, 10);
    strict_1.default.ok(Math.abs(spd - 4) < 0.001, `expected 4, got ${spd}`);
});
(0, node_test_1.test)('interpolateBoatSpeed: bilinear centre TWA=135 TWS=15 → (5+10+3+6)/4 = 6', () => {
    const spd = (0, polar_1.interpolateBoatSpeed)(polar, 135, 15);
    strict_1.default.ok(Math.abs(spd - 6) < 0.001, `expected 6, got ${spd}`);
});
(0, node_test_1.test)('interpolateBoatSpeed: polar is symmetric — negative TWA same as positive', () => {
    const pos = (0, polar_1.interpolateBoatSpeed)(polar, 90, 10);
    const neg = (0, polar_1.interpolateBoatSpeed)(polar, -90, 10);
    strict_1.default.strictEqual(pos, neg);
});
(0, node_test_1.test)('interpolateBoatSpeed: TWA below polar minimum returns 0', () => {
    // Boat cannot sail below its tacking angle — 0° and 15° are both below min TWA of 30°
    strict_1.default.strictEqual((0, polar_1.interpolateBoatSpeed)(polar, 0, 15), 0);
    strict_1.default.strictEqual((0, polar_1.interpolateBoatSpeed)(polar, 15, 15), 0);
});
(0, node_test_1.test)('interpolateBoatSpeed: TWA at polar minimum returns nonzero', () => {
    const spd = (0, polar_1.interpolateBoatSpeed)(polar, 30, 10);
    strict_1.default.ok(spd > 0, `expected positive speed at minimum TWA, got ${spd}`);
});
(0, node_test_1.test)('interpolateBoatSpeed: TWS above polar maximum is clamped — returns polar-max speed, not extrapolated beyond', () => {
    // At TWA=90, polar max TWS=20 gives 10 kt. TWS=40 (2× above max) must still give 10 kt.
    const atMax = (0, polar_1.interpolateBoatSpeed)(polar, 90, 20);
    const beyond = (0, polar_1.interpolateBoatSpeed)(polar, 90, 40);
    strict_1.default.ok(Math.abs(beyond - atMax) < 0.001, `expected ${atMax}, got ${beyond}`);
});
(0, node_test_1.test)('interpolateBoatSpeed: TWA above 180° is clamped to 180°', () => {
    const at180 = (0, polar_1.interpolateBoatSpeed)(polar, 180, 10);
    const beyond = (0, polar_1.interpolateBoatSpeed)(polar, 200, 10);
    strict_1.default.ok(Math.abs(beyond - at180) < 0.001, `expected ${at180}, got ${beyond}`);
});
(0, node_test_1.test)('interpolateBoatSpeed: linear interpolation toward zero for TWS below polar minimum (BUG-58)', () => {
    // Test polar has TWS columns [10, 20]. Minimum TWS = 10.
    const atMin = (0, polar_1.interpolateBoatSpeed)(polar, 90, 10);
    const halfMin = (0, polar_1.interpolateBoatSpeed)(polar, 90, 5);
    const quarter = (0, polar_1.interpolateBoatSpeed)(polar, 90, 2.5);
    strict_1.default.ok(halfMin < atMin, `5 kn (${halfMin}) should be slower than 10 kn (${atMin})`);
    strict_1.default.ok(Math.abs(halfMin - atMin / 2) < 0.001, `5 kn (half min TWS) should give ~half speed: ${halfMin} vs ${atMin / 2}`);
    strict_1.default.ok(Math.abs(quarter - atMin / 4) < 0.001, `2.5 kn (quarter min TWS) should give ~quarter speed: ${quarter} vs ${atMin / 4}`);
    strict_1.default.strictEqual((0, polar_1.interpolateBoatSpeed)(polar, 90, 0), 0, '0 kn should give 0 speed');
});
