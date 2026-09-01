"use strict";
// Tests for unit conversion helpers used by the weather routing webapp.
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const unitconversion_1 = require("../unitconversion");
// Representative SignalK unit preset shapes
const nauticalMetric = {
    speed: { formula: 'value / 0.514444', inverseFormula: 'value * 0.514444', symbol: 'kn', displayFormat: '0.0' },
    depth: { formula: 'value * 1', inverseFormula: 'value / 1', symbol: 'm', displayFormat: '0.0' },
    distance: { formula: 'value / 1852.001', inverseFormula: 'value * 1852.001', symbol: 'nmi', displayFormat: '0.00' },
};
const imperialUs = {
    speed: { formula: 'value * 2.23694', inverseFormula: 'value / 2.23694', symbol: 'mph', displayFormat: '0.0000' },
    depth: { formula: 'value * 3.28084', inverseFormula: 'value / 3.28084', symbol: 'ft', displayFormat: '0.0000' },
};
const metric = {
    speed: { formula: 'value * 3.6', inverseFormula: 'value / 3.6', symbol: 'km/h', displayFormat: '0.0000' },
    distance: { formula: 'value / 1000', inverseFormula: 'value * 1000', symbol: 'km', displayFormat: '0.0000' },
};
// --- evalFormula ---
(0, node_test_1.test)('evalFormula: multiply', () => {
    strict_1.default.ok(Math.abs((0, unitconversion_1.evalFormula)('value * 3.6', 10) - 36) < 0.001);
});
(0, node_test_1.test)('evalFormula: divide', () => {
    strict_1.default.ok(Math.abs((0, unitconversion_1.evalFormula)('value / 0.514444', 0.514444) - 1) < 0.001);
});
(0, node_test_1.test)('evalFormula: add', () => {
    strict_1.default.ok(Math.abs((0, unitconversion_1.evalFormula)('value + 273.15', 0) - 273.15) < 0.001);
});
(0, node_test_1.test)('evalFormula: subtract', () => {
    strict_1.default.ok(Math.abs((0, unitconversion_1.evalFormula)('value - 273.15', 273.15) - 0) < 0.001);
});
(0, node_test_1.test)('evalFormula: unknown operator returns value unchanged', () => {
    strict_1.default.equal((0, unitconversion_1.evalFormula)('value ^ 2', 5), 5);
});
// --- fmt: nautical-metric (kn internal → kn display, identity) ---
(0, node_test_1.test)('fmt: speed kn→kn with nautical-metric preset', () => {
    const { sym } = (0, unitconversion_1.fmt)(10, 'speed', nauticalMetric);
    strict_1.default.equal(sym, 'kn');
});
(0, node_test_1.test)('fmt: speed 10 kn rounds correctly with nautical-metric', () => {
    const { num } = (0, unitconversion_1.fmt)(10, 'speed', nauticalMetric);
    strict_1.default.ok(Math.abs(parseFloat(num) - 10) < 0.1);
});
(0, node_test_1.test)('fmt: depth m→m identity with nautical-metric', () => {
    const r = (0, unitconversion_1.fmt)(5, 'depth', nauticalMetric);
    strict_1.default.equal(r.sym, 'm');
    strict_1.default.ok(Math.abs(parseFloat(r.num) - 5) < 0.01);
});
// --- fmt: imperial-us (kn → mph, m → ft) ---
(0, node_test_1.test)('fmt: speed kn→mph with imperial-us preset', () => {
    const r = (0, unitconversion_1.fmt)(1, 'speed', imperialUs);
    strict_1.default.equal(r.sym, 'mph');
    // 1 kn = 0.514444 m/s * 2.23694 = 1.15078 mph
    strict_1.default.ok(Math.abs(parseFloat(r.num) - 1.151) < 0.01);
});
(0, node_test_1.test)('fmt: depth m→ft with imperial-us preset', () => {
    const r = (0, unitconversion_1.fmt)(1, 'depth', imperialUs);
    strict_1.default.equal(r.sym, 'ft');
    // 1 m = 3.28084 ft
    strict_1.default.ok(Math.abs(parseFloat(r.num) - 3.281) < 0.01);
});
// --- fmt: metric (kn → km/h, nmi → km) ---
(0, node_test_1.test)('fmt: speed kn→km/h with metric preset', () => {
    const r = (0, unitconversion_1.fmt)(1, 'speed', metric);
    strict_1.default.equal(r.sym, 'km/h');
    // 1 kn = 0.514444 m/s * 3.6 = 1.852 km/h
    strict_1.default.ok(Math.abs(parseFloat(r.num) - 1.852) < 0.01);
});
(0, node_test_1.test)('fmt: distance nmi→km with metric preset', () => {
    const r = (0, unitconversion_1.fmt)(1, 'distance', metric);
    strict_1.default.equal(r.sym, 'km');
    // 1 nmi = 1852.001 m / 1000 = 1.852 km
    strict_1.default.ok(Math.abs(parseFloat(r.num) - 1.852) < 0.01);
});
// --- fmt: null prefs fallback ---
(0, node_test_1.test)('fmt: speed falls back to kn when prefs null', () => {
    const r = (0, unitconversion_1.fmt)(10, 'speed', null);
    strict_1.default.equal(r.sym, 'kn');
    strict_1.default.equal(r.num, '10.0');
});
(0, node_test_1.test)('fmt: depth falls back to m when prefs null', () => {
    const r = (0, unitconversion_1.fmt)(3, 'depth', null);
    strict_1.default.equal(r.sym, 'm');
    strict_1.default.equal(r.num, '3.0');
});
(0, node_test_1.test)('fmt: distance falls back to nmi when prefs null', () => {
    const r = (0, unitconversion_1.fmt)(100, 'distance', null);
    strict_1.default.equal(r.sym, 'nmi');
});
// --- fmt: windSpeedMs override ---
(0, node_test_1.test)('fmt: forceMs=true converts kn to m/s', () => {
    const r = (0, unitconversion_1.fmt)(1, 'speed', nauticalMetric, true);
    strict_1.default.equal(r.sym, 'm/s');
    // 1 kn = 0.514444 m/s; toFixed(2) gives 0.51 — tolerance covers rounding
    strict_1.default.ok(Math.abs(parseFloat(r.num) - 0.514444) < 0.01);
});
(0, node_test_1.test)('fmt: forceMs=true ignores preset', () => {
    const r = (0, unitconversion_1.fmt)(1, 'speed', imperialUs, true);
    strict_1.default.equal(r.sym, 'm/s');
});
// --- parseUnit round-trips ---
(0, node_test_1.test)('parseUnit: speed nautical-metric round-trip', () => {
    const displayed = parseFloat((0, unitconversion_1.fmt)(10, 'speed', nauticalMetric).num);
    const back = (0, unitconversion_1.parseUnit)(displayed, 'speed', nauticalMetric);
    strict_1.default.ok(Math.abs(back - 10) < 0.1);
});
(0, node_test_1.test)('parseUnit: speed imperial-us round-trip', () => {
    const displayed = parseFloat((0, unitconversion_1.fmt)(10, 'speed', imperialUs).num);
    const back = (0, unitconversion_1.parseUnit)(displayed, 'speed', imperialUs);
    strict_1.default.ok(Math.abs(back - 10) < 0.1);
});
(0, node_test_1.test)('parseUnit: depth imperial-us round-trip', () => {
    const displayed = parseFloat((0, unitconversion_1.fmt)(3, 'depth', imperialUs).num);
    const back = (0, unitconversion_1.parseUnit)(displayed, 'depth', imperialUs);
    strict_1.default.ok(Math.abs(back - 3) < 0.01);
});
(0, node_test_1.test)('parseUnit: forceMs=true parses m/s back to kn', () => {
    const ms = unitconversion_1.toSI.speed(10); // 10 kn in m/s
    const back = (0, unitconversion_1.parseUnit)(ms, 'speed', nauticalMetric, true);
    strict_1.default.ok(Math.abs(back - 10) < 0.01);
});
(0, node_test_1.test)('parseUnit: falls back to identity when prefs null', () => {
    strict_1.default.equal((0, unitconversion_1.parseUnit)(10, 'speed', null), 10);
});
// --- toDisplay ---
(0, node_test_1.test)('toDisplay: returns m/s when forceMs', () => {
    const ms = (0, unitconversion_1.toDisplay)(1, 'speed', null, true);
    strict_1.default.ok(Math.abs(ms - unitconversion_1.toSI.speed(1)) < 0.001);
});
(0, node_test_1.test)('toDisplay: returns internal value when prefs null', () => {
    strict_1.default.equal((0, unitconversion_1.toDisplay)(5, 'speed', null), 5);
});
