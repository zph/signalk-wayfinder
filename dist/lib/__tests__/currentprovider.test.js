"use strict";
// Unit tests for ocean current GRIB loading and interpolation (REQ-91).
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const grib_1 = require("../grib");
const currentprovider_1 = require("../currentprovider");
function makeCurrentGrib(opts = {}) {
    const latMin = opts.latMin ?? 40;
    const latStep = opts.latStep ?? 1;
    const lonMin = opts.lonMin ?? 10;
    const lonStep = opts.lonStep ?? 1;
    const nLat = opts.nLat ?? 2;
    const nLon = opts.nLon ?? 2;
    const nPts = nLat * nLon;
    const t0 = opts.times?.[0] ?? new Date('2024-01-01T00:00:00Z');
    const t1 = opts.times?.[1] ?? new Date('2024-01-01T03:00:00Z');
    const times = opts.times ?? [t0, t1];
    return {
        latMin,
        latStep,
        lonMin,
        lonStep,
        nLat,
        nLon,
        times,
        u: times.map(() => new Float32Array(nPts).fill(opts.u ?? 1.0)),
        v: times.map(() => new Float32Array(nPts).fill(opts.v ?? 0.5)),
    };
}
function makeEntry(data) {
    return {
        meta: {
            path: 'current.grib2',
            mtime: 0,
            type: 'current',
            latMin: data.latMin,
            latMax: data.latMin + data.latStep * (data.nLat - 1),
            lonMin: data.lonMin,
            lonMax: data.lonMin + data.lonStep * (data.nLon - 1),
            latStep: data.latStep,
            lonStep: data.lonStep,
            timeStart: data.times[0],
            timeEnd: data.times[data.times.length - 1],
            nTimes: data.times.length,
            referenceTime: data.times[0],
        },
        data,
    };
}
// --- getCurrentAt ---
(0, node_test_1.test)('getCurrentAt: returns interpolated value at centre of uniform 2×2 grid', () => {
    const data = makeCurrentGrib({ u: 2.0, v: 1.0 });
    // Centre of a 2×2 grid starting at (40,10) with step 1: query at (40.5, 10.5)
    const result = (0, grib_1.getCurrentAt)(data, 40.5, 10.5, 0);
    strict_1.default.ok(Math.abs(result.u - 2.0) < 0.001, `u should be ≈2.0, got ${result.u}`);
    strict_1.default.ok(Math.abs(result.v - 1.0) < 0.001, `v should be ≈1.0, got ${result.v}`);
});
(0, node_test_1.test)('getCurrentAt: returns {u:0,v:0} for point south of grid (out-of-domain, no clamping)', () => {
    const data = makeCurrentGrib({ u: 5.0, v: 3.0 });
    const result = (0, grib_1.getCurrentAt)(data, 39.0, 10.5, 0); // lat=39 < latMin=40
    strict_1.default.strictEqual(result.u, 0);
    strict_1.default.strictEqual(result.v, 0);
});
(0, node_test_1.test)('getCurrentAt: returns {u:0,v:0} for point north of grid', () => {
    const data = makeCurrentGrib({ u: 5.0, v: 3.0 });
    const result = (0, grib_1.getCurrentAt)(data, 42.0, 10.5, 0); // lat=42 > latMax=41
    strict_1.default.strictEqual(result.u, 0);
    strict_1.default.strictEqual(result.v, 0);
});
(0, node_test_1.test)('getCurrentAt: returns {u:0,v:0} for point west of grid', () => {
    const data = makeCurrentGrib({ u: 5.0, v: 3.0 });
    const result = (0, grib_1.getCurrentAt)(data, 40.5, 9.0, 0); // lon=9 < lonMin=10
    strict_1.default.strictEqual(result.u, 0);
    strict_1.default.strictEqual(result.v, 0);
});
(0, node_test_1.test)('getCurrentAt: returns {u:0,v:0} for point east of grid', () => {
    const data = makeCurrentGrib({ u: 5.0, v: 3.0 });
    const result = (0, grib_1.getCurrentAt)(data, 40.5, 12.0, 0); // lon=12 > lonMax=11
    strict_1.default.strictEqual(result.u, 0);
    strict_1.default.strictEqual(result.v, 0);
});
(0, node_test_1.test)('getCurrentAt: returns non-zero for point exactly on grid boundary', () => {
    const data = makeCurrentGrib({ u: 3.0, v: 1.5 });
    const result = (0, grib_1.getCurrentAt)(data, 40.0, 10.0, 0); // at latMin, lonMin exactly
    strict_1.default.ok(result.u !== 0 || result.v !== 0, 'boundary point should have non-zero current');
});
// --- nearestCurrentTimeIndex ---
(0, node_test_1.test)('nearestCurrentTimeIndex: returns 0 for single-element time axis', () => {
    const data = makeCurrentGrib({ times: [new Date('2024-01-01T00:00:00Z')] });
    const idx = (0, grib_1.nearestCurrentTimeIndex)(data, new Date('2024-01-01T06:00:00Z'));
    strict_1.default.strictEqual(idx, 0);
});
(0, node_test_1.test)('nearestCurrentTimeIndex: returns nearest index for 3-hourly axis', () => {
    const t0 = new Date('2024-01-01T00:00:00Z');
    const t1 = new Date('2024-01-01T03:00:00Z');
    const t2 = new Date('2024-01-01T06:00:00Z');
    const data = makeCurrentGrib({ times: [t0, t1, t2] });
    // 1.5h past t0 → equidistant; implementation breaks ties toward lower index
    strict_1.default.strictEqual((0, grib_1.nearestCurrentTimeIndex)(data, new Date('2024-01-01T02:00:00Z')), 1);
    strict_1.default.strictEqual((0, grib_1.nearestCurrentTimeIndex)(data, new Date('2024-01-01T04:00:00Z')), 1);
    strict_1.default.strictEqual((0, grib_1.nearestCurrentTimeIndex)(data, new Date('2024-01-01T05:00:00Z')), 2);
});
// --- SingleFileCurrentProvider ---
(0, node_test_1.test)('SingleFileCurrentProvider: getCurrent returns {u:0,v:0} outside bbox', () => {
    const data = makeCurrentGrib({ u: 2.0, v: 1.0 });
    const provider = new currentprovider_1.SingleFileCurrentProvider(makeEntry(data));
    const result = provider.getCurrent(30.0, 10.5, new Date('2024-01-01T00:00:00Z'));
    strict_1.default.strictEqual(result.u, 0);
    strict_1.default.strictEqual(result.v, 0);
});
(0, node_test_1.test)('SingleFileCurrentProvider: getCurrent returns non-zero inside bbox', () => {
    const data = makeCurrentGrib({ u: 2.0, v: 1.0 });
    const provider = new currentprovider_1.SingleFileCurrentProvider(makeEntry(data));
    const result = provider.getCurrent(40.5, 10.5, new Date('2024-01-01T00:00:00Z'));
    strict_1.default.ok(result.u !== 0 || result.v !== 0, 'inside-domain query should return non-zero current');
});
(0, node_test_1.test)('SingleFileCurrentProvider: coversPoint returns true inside bbox', () => {
    const data = makeCurrentGrib();
    const provider = new currentprovider_1.SingleFileCurrentProvider(makeEntry(data));
    strict_1.default.ok(provider.coversPoint(40.5, 10.5));
});
(0, node_test_1.test)('SingleFileCurrentProvider: coversPoint returns false outside bbox', () => {
    const data = makeCurrentGrib();
    const provider = new currentprovider_1.SingleFileCurrentProvider(makeEntry(data));
    strict_1.default.ok(!provider.coversPoint(30.0, 10.5));
    strict_1.default.ok(!provider.coversPoint(40.5, 5.0));
});
(0, node_test_1.test)('SingleFileCurrentProvider: times matches the underlying data times', () => {
    const t0 = new Date('2024-01-01T00:00:00Z');
    const t1 = new Date('2024-01-01T03:00:00Z');
    const data = makeCurrentGrib({ times: [t0, t1] });
    const provider = new currentprovider_1.SingleFileCurrentProvider(makeEntry(data));
    strict_1.default.strictEqual(provider.times.length, 2);
    strict_1.default.strictEqual(provider.times[0].getTime(), t0.getTime());
    strict_1.default.strictEqual(provider.times[1].getTime(), t1.getTime());
});
