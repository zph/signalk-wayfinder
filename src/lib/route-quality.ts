// Independent checks over a completed route before it can be offered for saving.

import {
  GribFileMeta,
  LandEdgeIndex,
  PolarData,
  RegionIndex,
  RoutePoint,
  RouteQualityIssue,
  RouteQualityReport,
} from '../types';
import { haversineNM, trueWindAngle } from './geo';
import { interpolateBoatSpeed } from './polar';
import { isPointOnLand, segmentCrossesLandFast } from './landmask';
import { isPointInRegion, segmentCrossesRegion } from './regions';

const ENDPOINT_TOLERANCE_NM = 0.1;
const TWA_TOLERANCE_DEG = 1;
const ABRUPT_WIND_SHIFT_DEG = 60;

export interface RouteQualityContext {
  start: { lat: number; lon: number };
  end?: { lat: number; lon: number };
  polar: PolarData;
  landIndex: LandEdgeIndex | null;
  regionIndex: RegionIndex | null;
  avoidRegionIds: Set<string>;
  useLandAvoidance: boolean;
  gribFiles: GribFileMeta[];
  forecastSkillHorizonHours: number;
  motorSpeedKn: number;
  motorBelowKn: number;
}

function angularDifference(a: number, b: number): number {
  const diff = Math.abs(((((a - b) % 360) + 540) % 360) - 180);
  return diff;
}

function isCoordinate(point: RoutePoint): boolean {
  return (
    Number.isFinite(point.lat) &&
    Number.isFinite(point.lon) &&
    point.lat >= -90 &&
    point.lat <= 90 &&
    point.lon >= -180 &&
    point.lon <= 180
  );
}

export function assessRouteQuality(route: RoutePoint[], context: RouteQualityContext): RouteQualityReport {
  const issues: RouteQualityIssue[] = [];
  const seen = new Set<string>();
  const add = (code: string, severity: RouteQualityIssue['severity'], message: string): void => {
    if (seen.has(code)) return;
    seen.add(code);
    issues.push({ code, severity, message });
  };

  let totalDistanceNm = 0;
  let maxWindShiftDeg = 0;
  let maxTwaErrorDeg = 0;
  let maxForecastLeadHours: number | null = null;

  if (route.length < 2) add('too-few-points', 'error', 'Route has fewer than two points.');

  for (let i = 0; i < route.length; i++) {
    const point = route[i];
    if (!isCoordinate(point)) add('invalid-coordinate', 'error', `Route point ${i + 1} has invalid coordinates.`);
    if (!Number.isFinite(point.time.getTime()))
      add('invalid-time', 'error', `Route point ${i + 1} has an invalid time.`);
    if (
      ![point.heading, point.twa, point.tws, point.windDir].every(Number.isFinite) ||
      point.heading < 0 ||
      point.heading >= 360 ||
      point.windDir < 0 ||
      point.windDir >= 360 ||
      point.twa < 0 ||
      point.twa > 180 ||
      point.tws < 0 ||
      point.tws > 200
    ) {
      add('invalid-conditions', 'error', `Route point ${i + 1} has invalid wind or heading data.`);
    }
    if (point.boatSpeed !== undefined && (!Number.isFinite(point.boatSpeed) || point.boatSpeed < 0)) {
      add('invalid-boat-speed', 'error', `Route point ${i + 1} has an invalid boat speed.`);
    }

    if (context.useLandAvoidance && context.landIndex && isPointOnLand(context.landIndex, point.lat, point.lon)) {
      add('point-on-land', 'error', `Route point ${i + 1} is on the configured shoreline mask.`);
    }
    if (
      context.regionIndex &&
      context.avoidRegionIds.size > 0 &&
      isPointInRegion(context.regionIndex, context.avoidRegionIds, point.lat, point.lon)
    ) {
      add('point-in-avoid-region', 'error', `Route point ${i + 1} is inside an avoided region.`);
    }

    if (i === 0) continue;
    const previous = route[i - 1];
    const legDistanceNm = haversineNM(previous.lat, previous.lon, point.lat, point.lon);
    totalDistanceNm += legDistanceNm;
    const elapsedMs = point.time.getTime() - previous.time.getTime();
    if (elapsedMs < 0) add('time-reversal', 'error', `Route time moves backward on leg ${i}.`);
    if (elapsedMs === 0 && legDistanceNm > 0.01) {
      add('zero-duration-leg', 'warning', 'The final arrival-radius snap has distance but no added passage time.');
    }

    if (
      context.useLandAvoidance &&
      context.landIndex &&
      segmentCrossesLandFast(context.landIndex, previous.lat, previous.lon, point.lat, point.lon)
    ) {
      add('land-crossing', 'error', `Route leg ${i} crosses the configured shoreline mask.`);
    }
    if (
      context.regionIndex &&
      context.avoidRegionIds.size > 0 &&
      segmentCrossesRegion(
        context.regionIndex,
        context.avoidRegionIds,
        previous.lat,
        previous.lon,
        point.lat,
        point.lon,
      )
    ) {
      add('avoid-region-crossing', 'error', `Route leg ${i} crosses an avoided region.`);
    }

    const expectedTwa = trueWindAngle(point.heading, point.windDir);
    const twaError = Math.abs(expectedTwa - point.twa);
    maxTwaErrorDeg = Math.max(maxTwaErrorDeg, twaError);
    if (twaError > TWA_TOLERANCE_DEG) {
      add(
        'twa-mismatch',
        'error',
        'A route leg has a true-wind angle inconsistent with its heading and wind direction.',
      );
    }

    const windShift = angularDifference(point.windDir, previous.windDir);
    maxWindShiftDeg = Math.max(maxWindShiftDeg, windShift);
    if (windShift > ABRUPT_WIND_SHIFT_DEG) {
      add(
        'abrupt-wind-shift',
        'warning',
        'Adjacent route points contain a wind-direction shift greater than 60 degrees.',
      );
    }

    if (point.tws > context.polar.tws[context.polar.tws.length - 1]) {
      add(
        'polar-wind-cap',
        'warning',
        'Forecast wind exceeds the polar table range, so boat speed is capped at the highest polar column.',
      );
    }
    if (point.boatSpeed !== undefined && point.boatSpeed > 0) {
      const polarSpeed = interpolateBoatSpeed(context.polar, point.twa, point.tws);
      const motoring =
        context.motorBelowKn > 0 && context.motorSpeedKn > 0 && Math.abs(point.boatSpeed - context.motorSpeedKn) <= 0.2;
      if (!motoring && point.twa < context.polar.twa[0]) {
        add(
          'polar-no-go-angle',
          'warning',
          'A moving leg falls inside the polar table no-go angle after waypoint wind resampling.',
        );
      }
      const speedTolerance = Math.max(0.75, polarSpeed * 0.25);
      if (!motoring && Math.abs(point.boatSpeed - polarSpeed) > speedTolerance) {
        add(
          'polar-speed-mismatch',
          'warning',
          'A leg speed differs materially from the polar prediction at its displayed waypoint conditions.',
        );
      }
    }

    const source = context.gribFiles.find((file) => file.path === point.gribFilePath);
    if (source) {
      const leadHours = (point.time.getTime() - source.referenceTime.getTime()) / 3_600_000;
      maxForecastLeadHours = Math.max(maxForecastLeadHours ?? leadHours, leadHours);
      if (leadHours > context.forecastSkillHorizonHours) {
        add(
          'low-forecast-confidence',
          'warning',
          `Route conditions extend beyond the configured ${context.forecastSkillHorizonHours}-hour forecast skill horizon.`,
        );
      }
    }
  }

  if (
    route[0] &&
    haversineNM(route[0].lat, route[0].lon, context.start.lat, context.start.lon) > ENDPOINT_TOLERANCE_NM
  ) {
    add('start-mismatch', 'error', 'The calculated route does not begin at the requested departure point.');
  }
  const last = route[route.length - 1];
  if (
    last &&
    context.end &&
    haversineNM(last.lat, last.lon, context.end.lat, context.end.lon) > ENDPOINT_TOLERANCE_NM
  ) {
    add('end-mismatch', 'error', 'The complete route does not end at the requested destination.');
  }
  if (!context.useLandAvoidance) {
    add('land-check-disabled', 'warning', 'Land avoidance was disabled for this calculation.');
  }

  return {
    valid: issues.every((issue) => issue.severity !== 'error'),
    issues,
    metrics: {
      pointCount: route.length,
      totalDistanceNm,
      maxWindShiftDeg,
      maxTwaErrorDeg,
      maxForecastLeadHours,
    },
  };
}

export function routeQualityWarning(report: RouteQualityReport): string | undefined {
  const warnings = report.issues.filter((issue) => issue.severity === 'warning');
  return warnings.length > 0 ? `Route quality: ${warnings.map((issue) => issue.message).join(' ')}` : undefined;
}
