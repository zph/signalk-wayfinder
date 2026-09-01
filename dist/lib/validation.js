"use strict";
// Input validation helpers for route calculation request parameters.
Object.defineProperty(exports, "__esModule", { value: true });
exports.isValidCoordinate = isValidCoordinate;
exports.validateCalculateInput = validateCalculateInput;
function isValidCoordinate(value) {
    return typeof value === 'number' && !isNaN(value);
}
function validateCalculateInput(input) {
    const { start, end, departureTime } = input;
    if (!isValidCoordinate(start?.lat) ||
        !isValidCoordinate(start?.lon) ||
        !isValidCoordinate(end?.lat) ||
        !isValidCoordinate(end?.lon) ||
        !departureTime) {
        return { valid: false, error: 'Required: start {lat,lon}, end {lat,lon}, departureTime (ISO 8601)' };
    }
    return { valid: true };
}
