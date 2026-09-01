"use strict";
// Polar diagram loading (ORC/OpenCPN semicolon-delimited CSV) and bilinear boat-speed interpolation.
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
exports.parsePolar = parsePolar;
exports.interpolateBoatSpeed = interpolateBoatSpeed;
const fs = __importStar(require("node:fs"));
function parsePolar(filePath) {
    const lines = fs
        .readFileSync(filePath, 'utf-8')
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0 && !l.startsWith('#'));
    // Header: twa/tws;6;8;10;12;14;16;20
    const header = lines[0].split(';');
    const tws = header
        .slice(1)
        .map(Number)
        .filter((v) => !isNaN(v));
    const twa = [];
    const speeds = [];
    for (let i = 1; i < lines.length; i++) {
        const parts = lines[i].split(';').map(Number);
        if (isNaN(parts[0]))
            continue;
        twa.push(parts[0]);
        speeds.push(parts.slice(1, 1 + tws.length));
    }
    return { tws, twa, speeds };
}
function interpolateBoatSpeed(polar, twaDeg, twsKnots) {
    // Polar is symmetric: use absolute TWA clamped to 0–180
    const twa = Math.min(180, Math.max(0, Math.abs(twaDeg)));
    // Below the polar's minimum close-hauled angle the boat cannot make progress against the wind.
    // Bilinear extrapolation below polar.twa[0] produces non-zero speeds for impossible headings.
    if (twa < polar.twa[0])
        return 0;
    const twsIdx = bracketIndex(polar.tws, twsKnots);
    const twaIdx = bracketIndex(polar.twa, twa);
    if (twsIdx < 0 || twaIdx < 0)
        return 0;
    const twa0 = polar.twa[twaIdx];
    const twa1 = polar.twa[Math.min(twaIdx + 1, polar.twa.length - 1)];
    const tTwa = twa1 === twa0 ? 0 : Math.max(0, Math.min(1, (twa - twa0) / (twa1 - twa0)));
    const twaNext = Math.min(twaIdx + 1, polar.twa.length - 1);
    // Below polar minimum TWS: linearly interpolate toward zero (BUG-58).
    // ORC polars start at 6 kn because the VPP aero model is unreliable below that,
    // not because boats can't sail. At 4-5 kn TWS a typical boat makes 1-3 kn.
    // Linear ramp from (0, 0) to (polar.tws[0], polar_min_speed) preserves
    // frontier points at moderate TWS while correctly showing less wind = less speed.
    if (twsKnots < polar.tws[0]) {
        const minTwsSpeed = (1 - tTwa) * polar.speeds[twaIdx][0] + tTwa * polar.speeds[twaNext][0];
        return minTwsSpeed * (twsKnots / polar.tws[0]);
    }
    const tws0 = polar.tws[twsIdx];
    const tws1 = polar.tws[Math.min(twsIdx + 1, polar.tws.length - 1)];
    const tTws = tws1 === tws0 ? 0 : Math.max(0, Math.min(1, (twsKnots - tws0) / (tws1 - tws0)));
    const twsNext = Math.min(twsIdx + 1, polar.tws.length - 1);
    const s00 = polar.speeds[twaIdx][twsIdx];
    const s10 = polar.speeds[twaNext][twsIdx];
    const s01 = polar.speeds[twaIdx][twsNext];
    const s11 = polar.speeds[twaNext][twsNext];
    return (1 - tTwa) * (1 - tTws) * s00 + tTwa * (1 - tTws) * s10 + (1 - tTwa) * tTws * s01 + tTwa * tTws * s11;
}
function bracketIndex(arr, value) {
    if (value <= arr[0])
        return 0; // clamp to lowest bracket; tTws/tTwa lower-clamp prevents below-minimum extrapolation
    if (value >= arr[arr.length - 1])
        return arr.length - 2;
    for (let i = 0; i < arr.length - 1; i++) {
        if (value >= arr[i] && value <= arr[i + 1])
            return i;
    }
    return -1;
}
