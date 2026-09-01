"use strict";
// Versioned public readiness contract for headless sail-wayfinding clients.
Object.defineProperty(exports, "__esModule", { value: true });
exports.wayfinderCapabilities = wayfinderCapabilities;
function wayfinderCapabilities(inputs) {
    const missing = [];
    if (!inputs.hasPolar)
        missing.push('a polar');
    if (!inputs.hasForecast)
        missing.push('forecast coverage');
    if (!inputs.hasShoreline)
        missing.push('the shoreline index');
    return {
        apiVersion: '1.0',
        ready: missing.length === 0,
        objectives: ['fastest', 'leastMotoring'],
        ...(missing.length > 0
            ? { unavailableReason: `Wayfinder needs ${missing.join(', ')} before it can plan a passage.` }
            : {}),
    };
}
