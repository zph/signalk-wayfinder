"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const validation_1 = require("../validation");
(0, node_test_1.test)('BUG-92: lat=0 and lon=0 are accepted (not rejected as falsy)', () => {
    const result = (0, validation_1.validateCalculateInput)({
        start: { lat: 0, lon: 0 },
        end: { lat: 1, lon: 1 },
        departureTime: '2024-01-01T00:00:00Z',
    });
    strict_1.default.deepStrictEqual(result, { valid: true });
});
(0, node_test_1.test)('BUG-92: isValidCoordinate accepts 0, rejects undefined/null/NaN/string', () => {
    strict_1.default.strictEqual((0, validation_1.isValidCoordinate)(0), true);
    strict_1.default.strictEqual((0, validation_1.isValidCoordinate)(-0), true);
    strict_1.default.strictEqual((0, validation_1.isValidCoordinate)(59.5), true);
    strict_1.default.strictEqual((0, validation_1.isValidCoordinate)(undefined), false);
    strict_1.default.strictEqual((0, validation_1.isValidCoordinate)(null), false);
    strict_1.default.strictEqual((0, validation_1.isValidCoordinate)(NaN), false);
    strict_1.default.strictEqual((0, validation_1.isValidCoordinate)('0'), false);
});
(0, node_test_1.test)('validateCalculateInput: rejects missing start', () => {
    const result = (0, validation_1.validateCalculateInput)({ end: { lat: 1, lon: 1 }, departureTime: '2024-01-01' });
    strict_1.default.strictEqual(result.valid, false);
});
(0, node_test_1.test)('validateCalculateInput: rejects missing departureTime', () => {
    const result = (0, validation_1.validateCalculateInput)({
        start: { lat: 0, lon: 0 },
        end: { lat: 1, lon: 1 },
    });
    strict_1.default.strictEqual(result.valid, false);
});
(0, node_test_1.test)('validateCalculateInput: rejects empty departureTime string', () => {
    const result = (0, validation_1.validateCalculateInput)({
        start: { lat: 0, lon: 0 },
        end: { lat: 1, lon: 1 },
        departureTime: '',
    });
    strict_1.default.strictEqual(result.valid, false);
});
(0, node_test_1.test)('validateCalculateInput: accepts valid input with negative coordinates', () => {
    const result = (0, validation_1.validateCalculateInput)({
        start: { lat: -33.45, lon: -70.66 },
        end: { lat: 0, lon: 0 },
        departureTime: '2024-06-15T12:00:00Z',
    });
    strict_1.default.deepStrictEqual(result, { valid: true });
});
