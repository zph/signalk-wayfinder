"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const geo_1 = require("../geo");
const EPSILON = 0.01; // 0.01 nm / 0.01 deg tolerance
(0, node_test_1.test)('haversineNM: same point is zero', () => {
    strict_1.default.strictEqual((0, geo_1.haversineNM)(51, 4, 51, 4), 0);
});
(0, node_test_1.test)('haversineNM: known distance — London to Paris ~185 nm', () => {
    const dist = (0, geo_1.haversineNM)(51.5, -0.12, 48.85, 2.35);
    strict_1.default.ok(dist > 183 && dist < 187, `expected ~185 nm, got ${dist.toFixed(1)}`);
});
(0, node_test_1.test)('haversineNM: one degree latitude ≈ 60 nm', () => {
    const dist = (0, geo_1.haversineNM)(50, 10, 51, 10);
    strict_1.default.ok(Math.abs(dist - 60) < 0.5, `expected ~60 nm, got ${dist.toFixed(2)}`);
});
(0, node_test_1.test)('bearingTo: due north', () => {
    const b = (0, geo_1.bearingTo)(50, 10, 51, 10);
    strict_1.default.ok(Math.abs(b - 0) < EPSILON || Math.abs(b - 360) < EPSILON, `expected 0°, got ${b}`);
});
(0, node_test_1.test)('bearingTo: due east', () => {
    const b = (0, geo_1.bearingTo)(50, 10, 50, 11);
    strict_1.default.ok(Math.abs(b - 90) < 1, `expected ~90°, got ${b}`);
});
(0, node_test_1.test)('bearingTo: due south', () => {
    const b = (0, geo_1.bearingTo)(51, 10, 50, 10);
    strict_1.default.ok(Math.abs(b - 180) < EPSILON, `expected 180°, got ${b}`);
});
(0, node_test_1.test)('bearingTo: due west', () => {
    const b = (0, geo_1.bearingTo)(50, 11, 50, 10);
    strict_1.default.ok(Math.abs(b - 270) < 1, `expected ~270°, got ${b}`);
});
(0, node_test_1.test)('destinationPoint: north 60 nm → ~1 degree latitude', () => {
    const { lat, lon } = (0, geo_1.destinationPoint)(50, 10, 60, 0);
    strict_1.default.ok(Math.abs(lat - 51) < 0.01, `expected lat ~51, got ${lat}`);
    strict_1.default.ok(Math.abs(lon - 10) < 0.01, `expected lon ~10, got ${lon}`);
});
(0, node_test_1.test)('destinationPoint: round-trip — arrive back at start', () => {
    const { lat, lon } = (0, geo_1.destinationPoint)(48, 2, 100, 45);
    const dist = (0, geo_1.haversineNM)(48, 2, lat, lon);
    strict_1.default.ok(Math.abs(dist - 100) < 0.01, `round-trip distance off: ${dist}`);
});
(0, node_test_1.test)('windSpeedKnots: unit vector → 1.94384 kt', () => {
    const kt = (0, geo_1.windSpeedKnots)(1, 0);
    strict_1.default.ok(Math.abs(kt - 1.94384) < 0.0001);
});
(0, node_test_1.test)('windSpeedKnots: pythagoras', () => {
    const kt = (0, geo_1.windSpeedKnots)(3, 4); // magnitude 5 m/s
    strict_1.default.ok(Math.abs(kt - 5 * 1.94384) < 0.001);
});
(0, node_test_1.test)('windDirection: northerly (blowing from north, u=0 v=-5)', () => {
    const dir = (0, geo_1.windDirection)(0, -5);
    strict_1.default.ok(Math.abs(dir - 0) < EPSILON || Math.abs(dir - 360) < EPSILON, `expected 0°, got ${dir}`);
});
(0, node_test_1.test)('windDirection: southerly (blowing from south, u=0 v=5)', () => {
    const dir = (0, geo_1.windDirection)(0, 5);
    strict_1.default.ok(Math.abs(dir - 180) < EPSILON, `expected 180°, got ${dir}`);
});
(0, node_test_1.test)('windDirection: westerly (blowing from west, u=5 v=0)', () => {
    const dir = (0, geo_1.windDirection)(5, 0);
    strict_1.default.ok(Math.abs(dir - 270) < EPSILON, `expected 270°, got ${dir}`);
});
