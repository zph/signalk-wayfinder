// Bilinear boat-speed interpolation over the canonical Polar Performance table snapshot.

import { PolarData } from '../types';

export function interpolateBoatSpeed(polar: PolarData, twaDeg: number, twsKnots: number): number {
  // Polar is symmetric: use absolute TWA clamped to 0–180
  const twa = Math.min(180, Math.max(0, Math.abs(twaDeg)));

  // Below the polar's minimum close-hauled angle the boat cannot make progress against the wind.
  // Bilinear extrapolation below polar.twa[0] produces non-zero speeds for impossible headings.
  if (twa < polar.twa[0]) return 0;

  const twsIdx = bracketIndex(polar.tws, twsKnots);
  const twaIdx = bracketIndex(polar.twa, twa);

  if (twsIdx < 0 || twaIdx < 0) return 0;

  const twa0 = polar.twa[twaIdx];
  const twa1 = polar.twa[Math.min(twaIdx + 1, polar.twa.length - 1)];
  const tTwa = twa1 === twa0 ? 0 : Math.max(0, Math.min(1, (twa - twa0) / (twa1 - twa0)));
  const twaNext = Math.min(twaIdx + 1, polar.twa.length - 1);

  // Below polar minimum TWS: linearly interpolate toward zero (BUG-58).
  // ORC polars start at 6 kn because the VPP aero model is unreliable below that,
  // not because boats can't sail. At 4-5 kn TWS a typical boat makes 1-3 kn.
  // Linear ramp from (0, 0) to (polar.tws[0], polar_min_speed) preserves
  // frontier points at moderate TWS while correctly showing less wind = less speed.
  if (twsKnots < polar.tws[0]) {
    const minTwsSpeed = (1 - tTwa) * polar.speeds[twaIdx][0] + tTwa * polar.speeds[twaNext][0];
    return minTwsSpeed * (twsKnots / polar.tws[0]);
  }

  const tws0 = polar.tws[twsIdx];
  const tws1 = polar.tws[Math.min(twsIdx + 1, polar.tws.length - 1)];
  const tTws = tws1 === tws0 ? 0 : Math.max(0, Math.min(1, (twsKnots - tws0) / (tws1 - tws0)));
  const twsNext = Math.min(twsIdx + 1, polar.tws.length - 1);

  const s00 = polar.speeds[twaIdx][twsIdx];
  const s10 = polar.speeds[twaNext][twsIdx];
  const s01 = polar.speeds[twaIdx][twsNext];
  const s11 = polar.speeds[twaNext][twsNext];

  return (1 - tTwa) * (1 - tTws) * s00 + tTwa * (1 - tTws) * s10 + (1 - tTwa) * tTws * s01 + tTwa * tTws * s11;
}

function bracketIndex(arr: number[], value: number): number {
  if (value <= arr[0]) return 0; // clamp to lowest bracket; tTws/tTwa lower-clamp prevents below-minimum extrapolation
  if (value >= arr[arr.length - 1]) return arr.length - 2;
  for (let i = 0; i < arr.length - 1; i++) {
    if (value >= arr[i] && value <= arr[i + 1]) return i;
  }
  return -1;
}
