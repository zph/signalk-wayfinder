// Input validation helpers for route calculation request parameters.

import { ROUTING_OBJECTIVES } from './route-alternatives';

export function isValidCoordinate(value: unknown): value is number {
  return typeof value === 'number' && !isNaN(value);
}

export interface CalculateInput {
  start?: { lat?: unknown; lon?: unknown };
  end?: { lat?: unknown; lon?: unknown };
  departureTime?: unknown;
  options?: unknown;
}

export function validateCalculateInput(input: CalculateInput): { valid: true } | { valid: false; error: string } {
  const { start, end, departureTime, options } = input;
  if (
    !isValidCoordinate(start?.lat) ||
    !isValidCoordinate(start?.lon) ||
    !isValidCoordinate(end?.lat) ||
    !isValidCoordinate(end?.lon) ||
    typeof departureTime !== 'string' ||
    !departureTime ||
    !Number.isFinite(new Date(departureTime).getTime())
  ) {
    return { valid: false, error: 'Required: start {lat,lon}, end {lat,lon}, departureTime (ISO 8601)' };
  }
  if (options !== undefined && (typeof options !== 'object' || options === null || Array.isArray(options))) {
    return { valid: false, error: 'options must be an object' };
  }
  const routeOptions = options as Record<string, unknown> | undefined;
  if (routeOptions?.daylightOnly !== undefined && typeof routeOptions.daylightOnly !== 'boolean') {
    return { valid: false, error: 'options.daylightOnly must be a boolean' };
  }
  if (
    routeOptions?.maxHoursPerDay !== undefined &&
    (typeof routeOptions.maxHoursPerDay !== 'number' ||
      !Number.isFinite(routeOptions.maxHoursPerDay) ||
      routeOptions.maxHoursPerDay < 0 ||
      routeOptions.maxHoursPerDay > 24)
  ) {
    return { valid: false, error: 'options.maxHoursPerDay must be between 0 and 24' };
  }
  const boundedOptions: Array<[string, number]> = [
    ['minimumDepthM', 12_000],
    ['minimumShoreDistanceNm', 50],
    ['maximumOffshoreDistanceNm', 1_000],
    ['vesselDraftM', 100],
    ['motorSpeedKn', 100],
    ['motorBelowKn', 100],
  ];
  for (const [name, maximum] of boundedOptions) {
    const value = routeOptions?.[name];
    if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > maximum)) {
      return { valid: false, error: `options.${name} must be between 0 and ${maximum}` };
    }
  }
  if (
    routeOptions?.objective !== undefined &&
    (typeof routeOptions.objective !== 'string' ||
      !ROUTING_OBJECTIVES.includes(routeOptions.objective as (typeof ROUTING_OBJECTIVES)[number]))
  ) {
    return { valid: false, error: `options.objective must be one of ${ROUTING_OBJECTIVES.join(', ')}` };
  }
  if (
    routeOptions?.alternativeCount !== undefined &&
    (typeof routeOptions.alternativeCount !== 'number' ||
      !Number.isInteger(routeOptions.alternativeCount) ||
      routeOptions.alternativeCount < 1 ||
      routeOptions.alternativeCount > 10)
  ) {
    return { valid: false, error: 'options.alternativeCount must be an integer between 1 and 10' };
  }
  if (routeOptions?.objective === 'allMotoring' && !(Number(routeOptions.motorSpeedKn) > 0)) {
    return { valid: false, error: 'options.motorSpeedKn must be greater than 0 for allMotoring' };
  }
  return { valid: true };
}
