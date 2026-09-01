"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const grid_1 = require("../grid");
function makeEntry(latMin, latMax, lonMin, lonMax, latStep, lonStep) {
    return {
        meta: {
            path: 'test.grib2',
            mtime: 0,
            type: 'wind',
            latMin,
            latMax,
            lonMin,
            lonMax,
            latStep,
            lonStep,
            timeStart: new Date('2024-01-01'),
            timeEnd: new Date('2024-01-02'),
            nTimes: 2,
            referenceTime: new Date('2024-01-01'),
        },
        data: null,
    };
}
(0, node_test_1.test)('computeGridBounds: union bbox of two overlapping files', () => {
    const a = makeEntry(40, 42, 10, 12, 0.5, 0.5);
    const b = makeEntry(41, 44, 11, 14, 0.5, 0.5);
    const bounds = (0, grid_1.computeGridBounds)([a, b]);
    strict_1.default.strictEqual(bounds.latMin, 40);
    strict_1.default.strictEqual(bounds.latMax, 44);
    strict_1.default.strictEqual(bounds.lonMin, 10);
    strict_1.default.strictEqual(bounds.lonMax, 14);
});
(0, node_test_1.test)('computeGridBounds: picks finest step when files differ', () => {
    const a = makeEntry(40, 42, 10, 12, 1.0, 1.0);
    const b = makeEntry(41, 43, 11, 13, 0.25, 0.25);
    const bounds = (0, grid_1.computeGridBounds)([a, b]);
    strict_1.default.strictEqual(bounds.latStep, 0.25);
    strict_1.default.strictEqual(bounds.lonStep, 0.25);
});
(0, node_test_1.test)('computeGridBounds: nLat/nLon computed from union bbox and finest step', () => {
    const a = makeEntry(40, 42, 10, 12, 0.5, 0.5);
    const bounds = (0, grid_1.computeGridBounds)([a]);
    strict_1.default.strictEqual(bounds.nLat, 4); // (42-40)/0.5 = 4
    strict_1.default.strictEqual(bounds.nLon, 4); // (12-10)/0.5 = 4
});
(0, node_test_1.test)('computeGridBounds: single file', () => {
    const a = makeEntry(50, 55, 0, 10, 1, 2);
    const bounds = (0, grid_1.computeGridBounds)([a]);
    strict_1.default.strictEqual(bounds.latMin, 50);
    strict_1.default.strictEqual(bounds.latMax, 55);
    strict_1.default.strictEqual(bounds.lonMin, 0);
    strict_1.default.strictEqual(bounds.lonMax, 10);
    strict_1.default.strictEqual(bounds.latStep, 1);
    strict_1.default.strictEqual(bounds.lonStep, 2);
    strict_1.default.strictEqual(bounds.nLat, 5);
    strict_1.default.strictEqual(bounds.nLon, 5); // (10-0)/2 = 5
});
