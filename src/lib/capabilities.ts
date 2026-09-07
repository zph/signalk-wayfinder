// Versioned public readiness contract for headless sail-wayfinding clients.

export interface WayfinderCapabilities {
  apiVersion: '1.3';
  ready: boolean;
  objectives: readonly ['fastest', 'leastMotoring', 'allMotoring', 'bestWeather'];
  maximumAlternatives: 10;
  passageConstraints: readonly ['daylightOnly', 'maxHoursPerDay'];
  navigationConstraints: ReadonlyArray<'minimumShoreDistanceNm' | 'maximumOffshoreDistanceNm'>;
  vesselDraft?: { valueM: number; path: string };
  configuredDraftPath: string;
  unavailableReason?: string;
}

export function wayfinderCapabilities(inputs: {
  hasPolar: boolean;
  hasForecast: boolean;
  hasShoreline: boolean;
  vesselDraft?: { valueM: number; path: string };
  configuredDraftPath: string;
}): WayfinderCapabilities {
  const missing: string[] = [];
  if (!inputs.hasPolar) missing.push('a polar');
  if (!inputs.hasForecast) missing.push('forecast coverage');
  if (!inputs.hasShoreline) missing.push('the shoreline index');
  return {
    apiVersion: '1.3',
    ready: missing.length === 0,
    objectives: ['fastest', 'leastMotoring', 'allMotoring', 'bestWeather'],
    maximumAlternatives: 10,
    passageConstraints: ['daylightOnly', 'maxHoursPerDay'],
    navigationConstraints: ['minimumShoreDistanceNm', 'maximumOffshoreDistanceNm'],
    ...(inputs.vesselDraft ? { vesselDraft: inputs.vesselDraft } : {}),
    configuredDraftPath: inputs.configuredDraftPath,
    ...(missing.length > 0
      ? { unavailableReason: `Wayfinder needs ${missing.join(', ')} before it can plan a passage.` }
      : {}),
  };
}
