"use strict";
// Geographic primitives: haversine distance, bearing, destination point, wind vector conversions.
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEG_TO_RAD = void 0;
exports.haversineNM = haversineNM;
exports.bearingTo = bearingTo;
exports.destinationPoint = destinationPoint;
exports.windSpeedKnots = windSpeedKnots;
exports.windDirection = windDirection;
const R_NM = 3440.065; // Earth radius in nautical miles
const RAD_TO_DEG = 180 / Math.PI;
exports.DEG_TO_RAD = Math.PI / 180;
function haversineNM(lat1, lon1, lat2, lon2) {
    const dLat = (lat2 - lat1) * exports.DEG_TO_RAD;
    const dLon = (lon2 - lon1) * exports.DEG_TO_RAD;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * exports.DEG_TO_RAD) * Math.cos(lat2 * exports.DEG_TO_RAD) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R_NM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function bearingTo(lat1, lon1, lat2, lon2) {
    const dLon = (lon2 - lon1) * exports.DEG_TO_RAD;
    const lat1R = lat1 * exports.DEG_TO_RAD;
    const lat2R = lat2 * exports.DEG_TO_RAD;
    const y = Math.sin(dLon) * Math.cos(lat2R);
    const x = Math.cos(lat1R) * Math.sin(lat2R) - Math.sin(lat1R) * Math.cos(lat2R) * Math.cos(dLon);
    return (Math.atan2(y, x) * RAD_TO_DEG + 360) % 360;
}
function destinationPoint(lat, lon, distNM, bearingDeg) {
    const d = distNM / R_NM;
    const brng = bearingDeg * exports.DEG_TO_RAD;
    const lat1 = lat * exports.DEG_TO_RAD;
    const lon1 = lon * exports.DEG_TO_RAD;
    const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brng));
    const lon2 = lon1 + Math.atan2(Math.sin(brng) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
    return {
        lat: lat2 * RAD_TO_DEG,
        lon: ((lon2 * RAD_TO_DEG + 540) % 360) - 180, // +540 not +360: guarantees positive operand for % when lon2 is just outside [−π, π]
    };
}
function windSpeedKnots(u, v) {
    return Math.sqrt(u * u + v * v) * 1.94384; // m/s → knots
}
// Meteorological wind direction: the direction FROM which the wind blows (0=N, 90=E)
function windDirection(u, v) {
    return (Math.atan2(-u, -v) * RAD_TO_DEG + 360) % 360;
}
