"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const landmask_1 = require("../landmask");
// A 2°×2° square island: lon 1–3, lat 1–3 (counterclockwise exterior ring)
function makeSquarePoly() {
    const coords = [1, 1, 3, 1, 3, 3, 1, 3, 1, 1]; // [lon,lat, ...]
    const exterior = new Float64Array(coords.length);
    coords.forEach((v, i) => {
        exterior[i] = v;
    });
    return { bboxLatMin: 1, bboxLatMax: 3, bboxLonMin: 1, bboxLonMax: 3, exterior };
}
const poly = makeSquarePoly();
const index = (0, landmask_1.buildLandIndex)([poly]);
(0, node_test_1.test)('segmentCrossesLand: endpoint inside polygon → true', () => {
    strict_1.default.ok((0, landmask_1.segmentCrossesLand)(index, 0, 0, 2, 2));
});
(0, node_test_1.test)('segmentCrossesLand: both endpoints outside but segment crosses polygon → true', () => {
    // horizontal segment from lon=-1 to lon=5, at lat=2 (bisects the square)
    strict_1.default.ok((0, landmask_1.segmentCrossesLand)(index, 2, -1, 2, 5));
});
(0, node_test_1.test)('segmentCrossesLand: both endpoints outside, segment does not cross → false', () => {
    strict_1.default.ok(!(0, landmask_1.segmentCrossesLand)(index, 0, 0, 0, 5));
});
(0, node_test_1.test)('segmentCrossesLand: both endpoints inside → true', () => {
    strict_1.default.ok((0, landmask_1.segmentCrossesLand)(index, 2, 1.5, 2, 2.5));
});
(0, node_test_1.test)('segmentCrossesLand: segment entirely in water, far from polygon → false', () => {
    strict_1.default.ok(!(0, landmask_1.segmentCrossesLand)(index, -10, -10, -9, -9));
});
(0, node_test_1.test)('buildLandIndex: grid has entries for cells the polygon occupies', () => {
    // polygon covers cells (lat=1,lon=1), (lat=1,lon=2), (lat=2,lon=1), (lat=2,lon=2)
    const key = (1 + 90) * 360 + (1 + 180);
    strict_1.default.ok(index.grid.has(key));
});
(0, node_test_1.test)('polygonsInBbox: returns polygon when bbox overlaps its grid cell', () => {
    const result = (0, landmask_1.polygonsInBbox)(index, 1, 1, 3, 3);
    strict_1.default.strictEqual(result.length, 1);
    strict_1.default.strictEqual(result[0], poly);
});
(0, node_test_1.test)('polygonsInBbox: deduplicates polygon spanning multiple cells', () => {
    // poly spans cells (1,1),(1,2),(2,1),(2,2) — querying a bbox covering all four must return it once
    const result = (0, landmask_1.polygonsInBbox)(index, 0, 0, 4, 4);
    strict_1.default.strictEqual(result.length, 1);
});
(0, node_test_1.test)('polygonsInBbox: returns empty array for bbox with no land', () => {
    const result = (0, landmask_1.polygonsInBbox)(index, -10, -10, -8, -8);
    strict_1.default.strictEqual(result.length, 0);
});
// ── Edge-tile index tests ──────────────────────────────────────────────────
const edgeIdx = (0, landmask_1.buildLandEdgeIndex)([poly]);
(0, node_test_1.test)('buildLandEdgeIndex: edgeGrid is non-empty for a polygon', () => {
    strict_1.default.ok(edgeIdx.edgeGrid.size > 0);
});
(0, node_test_1.test)('buildLandEdgeIndex: polyGrid has an entry for the polygon cell', () => {
    // polygon covers lat 1–3, lon 1–3; the 1° cell (floor(1),floor(1)) = (1,1)
    const key = (1 + 90) * 360 + (1 + 180);
    strict_1.default.ok(edgeIdx.polyGrid.has(key));
});
(0, node_test_1.test)('segmentCrossesLandFast: segment crosses polygon edge → true', () => {
    // vertical at lon=2 from lat=0 to lat=2 — crosses bottom edge at (lat=1,lon=2)
    strict_1.default.ok((0, landmask_1.segmentCrossesLandFast)(edgeIdx, 0, 2, 2, 2));
});
(0, node_test_1.test)('segmentCrossesLandFast: horizontal bisects polygon → true', () => {
    strict_1.default.ok((0, landmask_1.segmentCrossesLandFast)(edgeIdx, 2, -1, 2, 5));
});
(0, node_test_1.test)('segmentCrossesLandFast: open water → false', () => {
    strict_1.default.ok(!(0, landmask_1.segmentCrossesLandFast)(edgeIdx, 0, 0, 0, 5));
});
(0, node_test_1.test)('segmentCrossesLandFast: far from polygon → false', () => {
    strict_1.default.ok(!(0, landmask_1.segmentCrossesLandFast)(edgeIdx, -10, -10, -9, -9));
});
(0, node_test_1.test)('segmentCrossesLandFast: segment entirely inside polygon → false (no edge crossing)', () => {
    // both endpoints inside; no polygon edges in the path cells → edge check returns false
    strict_1.default.ok(!(0, landmask_1.segmentCrossesLandFast)(edgeIdx, 2, 1.5, 2, 2.5));
});
(0, node_test_1.test)('isPointOnLand: point inside polygon → true', () => {
    strict_1.default.ok((0, landmask_1.isPointOnLand)(edgeIdx, 2, 2));
});
(0, node_test_1.test)('isPointOnLand: point outside polygon → false', () => {
    strict_1.default.ok(!(0, landmask_1.isPointOnLand)(edgeIdx, 0, 0));
});
(0, node_test_1.test)('isPointOnLand: point far from polygon → false', () => {
    strict_1.default.ok(!(0, landmask_1.isPointOnLand)(edgeIdx, -10, -10));
});
(0, node_test_1.test)('land-polygons serialization: exterior Float64Array converts to closed [lon,lat] GeoJSON ring', () => {
    // makeSquarePoly exterior: [1,1, 3,1, 3,3, 1,3, 1,1] interleaved as [lon,lat,...]
    const p = makeSquarePoly();
    const coords = [];
    for (let j = 0; j < p.exterior.length; j += 2)
        coords.push([p.exterior[j], p.exterior[j + 1]]);
    if (coords.length > 0)
        coords.push(coords[0]);
    const feature = JSON.parse(JSON.stringify({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [coords] },
        properties: null,
    }));
    strict_1.default.strictEqual(feature.type, 'Feature');
    strict_1.default.strictEqual(feature.geometry.type, 'Polygon');
    const ring = feature.geometry.coordinates[0];
    strict_1.default.deepStrictEqual(ring[0], ring[ring.length - 1]); // ring is closed
    strict_1.default.strictEqual(ring[0][0], 1); // lon
    strict_1.default.strictEqual(ring[0][1], 1); // lat
});
