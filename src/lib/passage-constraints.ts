// Time-window helpers for daylight-only and limited-underway-hours routing.

import type { RoutePoint } from '../types';
import { haversineNM } from './geo';

const DAY_MS = 86_400_000;

export function solarElevationDeg(time: Date, lat: number, lon: number): number {
  const startOfYear = Date.UTC(time.getUTCFullYear(), 0, 0);
  const dayOfYear = Math.floor((time.getTime() - startOfYear) / DAY_MS);
  const utcHours = time.getUTCHours() + time.getUTCMinutes() / 60 + time.getUTCSeconds() / 3600;
  const gamma = (2 * Math.PI * (dayOfYear - 1 + (utcHours - 12) / 24)) / 365;
  const equationOfTime =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(gamma) -
      0.032077 * Math.sin(gamma) -
      0.014615 * Math.cos(2 * gamma) -
      0.040849 * Math.sin(2 * gamma));
  const declination =
    0.006918 -
    0.399912 * Math.cos(gamma) +
    0.070257 * Math.sin(gamma) -
    0.006758 * Math.cos(2 * gamma) +
    0.000907 * Math.sin(2 * gamma) -
    0.002697 * Math.cos(3 * gamma) +
    0.00148 * Math.sin(3 * gamma);
  const solarMinutes = (((utcHours * 60 + equationOfTime + 4 * lon) % 1440) + 1440) % 1440;
  const hourAngle = ((solarMinutes / 4 - 180) * Math.PI) / 180;
  const latRad = (lat * Math.PI) / 180;
  const sinElevation =
    Math.sin(latRad) * Math.sin(declination) + Math.cos(latRad) * Math.cos(declination) * Math.cos(hourAngle);
  return (Math.asin(Math.max(-1, Math.min(1, sinElevation))) * 180) / Math.PI;
}

export function isLegInDaylight(
  start: Date,
  end: Date,
  startPosition: { lat: number; lon: number },
  endPosition: { lat: number; lon: number },
): boolean {
  const midpoint = new Date((start.getTime() + end.getTime()) / 2);
  const midpointPosition = {
    lat: (startPosition.lat + endPosition.lat) / 2,
    lon: (startPosition.lon + endPosition.lon) / 2,
  };
  return (
    solarElevationDeg(start, startPosition.lat, startPosition.lon) > 0 &&
    solarElevationDeg(midpoint, midpointPosition.lat, midpointPosition.lon) > 0 &&
    solarElevationDeg(end, endPosition.lat, endPosition.lon) > 0
  );
}

export function passageDayIndex(time: Date, departure: Date): number {
  return Math.max(0, Math.floor((time.getTime() - departure.getTime()) / DAY_MS));
}

export interface UnderwayBudget {
  allowed: boolean;
  passageDayIndex: number;
  hoursToday: number;
}

export function advanceUnderwayBudget(inputs: {
  start: Date;
  end: Date;
  departure: Date;
  currentDayIndex: number;
  currentHoursToday: number;
  maxHoursPerDay: number;
  underway: boolean;
}): UnderwayBudget {
  const { start, end, departure, maxHoursPerDay, underway } = inputs;
  let dayIndex = passageDayIndex(start, departure);
  let hoursToday = inputs.currentDayIndex === dayIndex ? inputs.currentHoursToday : 0;
  let cursorMs = start.getTime();

  while (cursorMs < end.getTime()) {
    const boundaryMs = departure.getTime() + (dayIndex + 1) * DAY_MS;
    const chunkEndMs = Math.min(end.getTime(), boundaryMs);
    if (underway) {
      hoursToday += (chunkEndMs - cursorMs) / 3_600_000;
      if (maxHoursPerDay > 0 && hoursToday > maxHoursPerDay + 1e-9) {
        return { allowed: false, passageDayIndex: dayIndex, hoursToday };
      }
    }
    cursorMs = chunkEndMs;
    if (cursorMs < end.getTime() || cursorMs === boundaryMs) {
      dayIndex += 1;
      hoursToday = 0;
    }
  }

  return { allowed: true, passageDayIndex: passageDayIndex(end, departure), hoursToday };
}

export function routeUnderwayBudget(route: RoutePoint[], departure: Date, maxHoursPerDay: number): UnderwayBudget {
  let budget: UnderwayBudget = {
    allowed: true,
    passageDayIndex: passageDayIndex(route[0]?.time ?? departure, departure),
    hoursToday: 0,
  };
  for (let index = 1; index < route.length; index++) {
    const previous = route[index - 1];
    const point = route[index];
    if (point.time <= previous.time) continue;
    budget = advanceUnderwayBudget({
      start: previous.time,
      end: point.time,
      departure,
      currentDayIndex: budget.passageDayIndex,
      currentHoursToday: budget.hoursToday,
      maxHoursPerDay,
      underway: haversineNM(previous.lat, previous.lon, point.lat, point.lon) > 0.01 && (point.boatSpeed ?? 0) > 0,
    });
    if (!budget.allowed) return budget;
  }
  return budget;
}
