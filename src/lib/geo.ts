// Geographic primitives: haversine distance, bearing, destination point, wind vector conversions.

const R_NM = 3440.065; // Earth radius in nautical miles
const RAD_TO_DEG = 180 / Math.PI;
export const DEG_TO_RAD = Math.PI / 180;

export function haversineNM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * DEG_TO_RAD;
  const dLon = (lon2 - lon1) * DEG_TO_RAD;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * DEG_TO_RAD) * Math.cos(lat2 * DEG_TO_RAD) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R_NM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function bearingTo(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLon = (lon2 - lon1) * DEG_TO_RAD;
  const lat1R = lat1 * DEG_TO_RAD;
  const lat2R = lat2 * DEG_TO_RAD;
  const y = Math.sin(dLon) * Math.cos(lat2R);
  const x = Math.cos(lat1R) * Math.sin(lat2R) - Math.sin(lat1R) * Math.cos(lat2R) * Math.cos(dLon);
  return (Math.atan2(y, x) * RAD_TO_DEG + 360) % 360;
}

export function destinationPoint(
  lat: number,
  lon: number,
  distNM: number,
  bearingDeg: number,
): { lat: number; lon: number } {
  const d = distNM / R_NM;
  const brng = bearingDeg * DEG_TO_RAD;
  const lat1 = lat * DEG_TO_RAD;
  const lon1 = lon * DEG_TO_RAD;

  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brng));
  const lon2 =
    lon1 + Math.atan2(Math.sin(brng) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));

  return {
    lat: lat2 * RAD_TO_DEG,
    lon: ((lon2 * RAD_TO_DEG + 540) % 360) - 180, // +540 not +360: guarantees positive operand for % when lon2 is just outside [−π, π]
  };
}

export function windSpeedKnots(u: number, v: number): number {
  return Math.sqrt(u * u + v * v) * 1.94384; // m/s → knots
}

// Meteorological wind direction: the direction FROM which the wind blows (0=N, 90=E)
export function windDirection(u: number, v: number): number {
  return (Math.atan2(-u, -v) * RAD_TO_DEG + 360) % 360;
}

// Smallest angle between a vessel heading and meteorological wind direction.
export function trueWindAngle(heading: number, windDir: number): number {
  const angle = (((heading - windDir) % 360) + 360) % 360;
  return angle > 180 ? 360 - angle : angle;
}
