// Candidate-route generation settings, summaries, deduplication, and objective ranking.

import type { RouteAlternativeSummary, RoutePoint, RouteQualityReport, RoutingObjective } from '../types';

export const ROUTING_OBJECTIVES: readonly RoutingObjective[] = [
  'fastest',
  'leastMotoring',
  'allMotoring',
  'bestWeather',
];

export interface RouteAlternative {
  route: RoutePoint[];
  warning?: string;
  quality: RouteQualityReport;
  complete: boolean;
}

export function optionsForAlternative(
  base: Record<string, unknown>,
  objective: RoutingObjective,
  attempt: number,
  requestedCount: number,
): Record<string, unknown> {
  const headingStep = Number(base.headingStep ?? 5);
  const offsetSlots = Math.max(requestedCount * 2, 1);
  const options = {
    ...base,
    headingOffsetDeg: (attempt * headingStep) / offsetSlots,
  };
  if (objective === 'leastMotoring') {
    return { ...options, forceMotor: false, motorBelowKn: 0, waitForWind: true };
  }
  if (objective === 'allMotoring') {
    return { ...options, forceMotor: true, motorBelowKn: 0 };
  }
  return { ...options, forceMotor: false };
}

function durationHours(route: RoutePoint[]): number {
  if (route.length < 2) return 0;
  return Math.max(0, (route.at(-1)!.time.getTime() - route[0].time.getTime()) / 3_600_000);
}

export function summarizeAlternative(
  alternative: RouteAlternative,
  objective: RoutingObjective,
  index: number,
): RouteAlternativeSummary {
  const metrics = alternative.quality.metrics;
  return {
    index,
    objective,
    complete: alternative.complete,
    durationHours: durationHours(alternative.route),
    distanceNm: metrics.totalDistanceNm,
    motorHours: metrics.motorHours,
    averageWaveHeightM: metrics.averageWaveHeightM,
    maximumWaveHeightM: metrics.maximumWaveHeightM,
    averageWindKn: metrics.averageWindKn,
    maximumWindKn: metrics.maximumWindKn,
    ...(alternative.warning ? { warning: alternative.warning } : {}),
    quality: alternative.quality,
  };
}

function qualityWarningCount(summary: RouteAlternativeSummary): number {
  return summary.quality.issues.filter((issue) => issue.severity === 'warning').length;
}

function weatherScore(summary: RouteAlternativeSummary): number {
  const waveScore =
    summary.averageWaveHeightM === null
      ? 0
      : summary.averageWaveHeightM * 100 + (summary.maximumWaveHeightM ?? summary.averageWaveHeightM) * 30;
  return waveScore + summary.averageWindKn * 2 + summary.maximumWindKn;
}

export function compareAlternativeSummaries(a: RouteAlternativeSummary, b: RouteAlternativeSummary): number {
  if (a.complete !== b.complete) return a.complete ? -1 : 1;
  const warningDifference = qualityWarningCount(a) - qualityWarningCount(b);
  if (warningDifference !== 0) return warningDifference;
  if (a.objective === 'leastMotoring') {
    return a.motorHours - b.motorHours || a.durationHours - b.durationHours || a.distanceNm - b.distanceNm;
  }
  if (a.objective === 'bestWeather') {
    if (a.averageWaveHeightM === null && b.averageWaveHeightM !== null) return 1;
    if (a.averageWaveHeightM !== null && b.averageWaveHeightM === null) return -1;
    return weatherScore(a) - weatherScore(b) || a.durationHours - b.durationHours || a.distanceNm - b.distanceNm;
  }
  return a.durationHours - b.durationHours || a.distanceNm - b.distanceNm;
}

export function routeGeometryKey(route: RoutePoint[]): string {
  return route.map((point) => `${point.lat.toFixed(5)},${point.lon.toFixed(5)}`).join(';');
}

export function rankDistinctAlternatives(
  alternatives: RouteAlternative[],
  objective: RoutingObjective,
  requestedCount: number,
): Array<RouteAlternative & { summary: RouteAlternativeSummary }> {
  const distinct = new Map<string, RouteAlternative>();
  for (const alternative of alternatives) {
    const key = routeGeometryKey(alternative.route);
    if (!distinct.has(key)) distinct.set(key, alternative);
  }
  return [...distinct.values()]
    .map((alternative) => ({
      ...alternative,
      summary: summarizeAlternative(alternative, objective, 0),
    }))
    .sort((a, b) => compareAlternativeSummaries(a.summary, b.summary))
    .slice(0, requestedCount)
    .map((alternative, index) => ({
      ...alternative,
      summary: { ...alternative.summary, index },
    }));
}
