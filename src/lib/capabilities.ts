// Versioned public readiness contract for headless sail-wayfinding clients.

export interface WayfinderCapabilities {
  apiVersion: '1.2';
  ready: boolean;
  objectives: readonly ['fastest'];
  passageConstraints: readonly ['daylightOnly', 'maxHoursPerDay'];
  navigationConstraints: ReadonlyArray<'minimumDepthM' | 'minimumShoreDistanceNm' | 'maximumOffshoreDistanceNm'>;
  depthSource?: string;
  unavailableReason?: string;
}

export function wayfinderCapabilities(inputs: {
  hasPolar: boolean;
  hasForecast: boolean;
  hasShoreline: boolean;
  depthSource?: string;
}): WayfinderCapabilities {
  const missing: string[] = [];
  if (!inputs.hasPolar) missing.push('a polar');
  if (!inputs.hasForecast) missing.push('forecast coverage');
  if (!inputs.hasShoreline) missing.push('the shoreline index');
  return {
    apiVersion: '1.2',
    ready: missing.length === 0,
    objectives: ['fastest'],
    passageConstraints: ['daylightOnly', 'maxHoursPerDay'],
    navigationConstraints: [
      'minimumShoreDistanceNm',
      'maximumOffshoreDistanceNm',
      ...(inputs.depthSource ? (['minimumDepthM'] as const) : []),
    ],
    ...(inputs.depthSource ? { depthSource: inputs.depthSource } : {}),
    ...(missing.length > 0
      ? { unavailableReason: `Wayfinder needs ${missing.join(', ')} before it can plan a passage.` }
      : {}),
  };
}
