// Input validation helpers for route calculation request parameters.

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
  return { valid: true };
}
