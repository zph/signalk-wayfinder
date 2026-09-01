"use strict";
// Tests for the public wayfinding readiness contract.
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const capabilities_1 = require("../capabilities");
(0, node_test_1.default)('reports ready only with every required planning input', () => {
    strict_1.default.deepEqual((0, capabilities_1.wayfinderCapabilities)({ hasPolar: true, hasForecast: true, hasShoreline: true }), {
        apiVersion: '1.0',
        ready: true,
        objectives: ['fastest', 'leastMotoring'],
    });
});
(0, node_test_1.default)('explains every missing input without a safety fallback', () => {
    const capabilities = (0, capabilities_1.wayfinderCapabilities)({ hasPolar: false, hasForecast: false, hasShoreline: false });
    strict_1.default.equal(capabilities.ready, false);
    strict_1.default.match(capabilities.unavailableReason ?? '', /a polar/);
    strict_1.default.match(capabilities.unavailableReason ?? '', /forecast coverage/);
    strict_1.default.match(capabilities.unavailableReason ?? '', /shoreline index/);
});
