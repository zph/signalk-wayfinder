// Bounded, goal-directed chart-geometry search used to seed the time-dependent router.

import type { CalculationRequest, LandEdgeIndex, LatLon, NavigationSafetyContext, RegionIndex } from '../../types';
import { bearingTo, haversineNM } from '../geo';
import { isPointOnLand, segmentCrossesLandFast } from '../landmask';
import { navigationConstraintViolation, segmentHasShoreClearance, type NavigationConstraints } from '../navigation-safety';
import { isPointInRegion, segmentCrossesRegion } from '../regions';

export interface GoalCorridorPoint extends LatLon {
  timeMs: number;
}

interface SearchNode extends LatLon {
  ix: number;
  iy: number;
  g: number;
  f: number;
  clearanceEstablished: boolean;
  parent?: SearchNode;
}

class MinHeap {
  private readonly values: SearchNode[] = [];

  get size(): number {
    return this.values.length;
  }

  push(value: SearchNode): void {
    let index = this.values.length;
    this.values.push(value);
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (this.values[parent].f <= value.f) break;
      this.values[index] = this.values[parent];
      index = parent;
    }
    this.values[index] = value;
  }

  pop(): SearchNode {
    const first = this.values[0];
    const last = this.values.pop()!;
    if (this.values.length === 0) return first;
    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      if (left >= this.values.length) break;
      const right = left + 1;
      const child = right < this.values.length && this.values[right].f < this.values[left].f ? right : left;
      if (this.values[child].f >= last.f) break;
      this.values[index] = this.values[child];
      index = child;
    }
    this.values[index] = last;
    return first;
  }
}

const NEIGHBORS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
];

function fromGrid(start: LatLon, longitudeScale: number, stepNm: number, ix: number, iy: number): LatLon {
  return {
    lat: start.lat + (iy * stepNm) / 60,
    lon: start.lon + (ix * stepNm) / (60 * longitudeScale),
  };
}

function gridKey(ix: number, iy: number, clearanceEstablished: boolean): string {
  return `${ix}:${iy}:${clearanceEstablished ? 1 : 0}`;
}

function reconstruct(node: SearchNode): LatLon[] {
  const result: LatLon[] = [];
  for (let current: SearchNode | undefined = node; current; current = current.parent) {
    result.push({ lat: current.lat, lon: current.lon });
  }
  return result.reverse();
}

function withTimes(points: LatLon[], departureTimeMs: number, planningSpeedKn: number): GoalCorridorPoint[] {
  let timeMs = departureTimeMs;
  return points.map((point, index) => {
    if (index > 0) {
      const previous = points[index - 1];
      timeMs += (haversineNM(previous.lat, previous.lon, point.lat, point.lon) / planningSpeedKn) * 3_600_000;
    }
    return { ...point, timeMs };
  });
}

export interface GoalCorridorOptions {
  gridStepNm?: number;
  maximumExpansions?: number;
  maximumDetourFactor?: number;
  planningSpeedKn?: number;
  constraints: NavigationConstraints;
}

/**
 * Finds one bounded chart-safe corridor with A*. Unlike an isochrone, this search expands the
 * lowest estimated total-distance node first and has a hard spatial/expansion budget.
 */
export function buildGoalDirectedCorridor(
  edgeIndex: LandEdgeIndex | null,
  regionIndex: RegionIndex | null,
  request: CalculationRequest,
  navigationSafety: NavigationSafetyContext | undefined,
  options: GoalCorridorOptions,
  onProgress: (percent: number, frontier: Array<[number, number]>) => void,
): GoalCorridorPoint[] {
  const directNm = haversineNM(request.start.lat, request.start.lon, request.end.lat, request.end.lon);
  if (!(directNm > 0)) return [{ ...request.start, timeMs: Date.parse(request.departureTime) }];
  const stepNm = Math.max(0.25, Math.min(2, Number(options.gridStepNm ?? Math.max(0.5, directNm / 100))));
  const maximumExpansions = Math.max(100, Math.trunc(Number(options.maximumExpansions ?? 30_000)));
  const maximumDetourNm = directNm * Math.max(1.1, Number(options.maximumDetourFactor ?? 2.25)) + 10;
  const planningSpeedKn = Math.max(0.3, Number(options.planningSpeedKn ?? 5));
  const longitudeScale = Math.max(0.05, Math.cos((request.start.lat * Math.PI) / 180));
  const avoidIds = new Set(Array.isArray(request.avoidRegionIds) ? request.avoidRegionIds : []);
  const shorelineIndex = navigationSafety?.shorelineIndex ?? edgeIndex;
  const minimumShoreDistanceNm = options.constraints.minimumShoreDistanceNm;
  const departureClearanceEstablished =
    !(minimumShoreDistanceNm > 0) ||
    !!shorelineIndex &&
      segmentHasShoreClearance(
        shorelineIndex,
        request.start.lat,
        request.start.lon,
        request.start.lat,
        request.start.lon,
        minimumShoreDistanceNm,
      );
  const start: SearchNode = {
    ...request.start,
    ix: 0,
    iy: 0,
    g: 0,
    f: directNm,
    clearanceEstablished: departureClearanceEstablished,
  };
  const open = new MinHeap();
  open.push(start);
  const best = new Map<string, number>([[gridKey(0, 0, departureClearanceEstablished), 0]]);

  for (let expansions = 0; open.size > 0 && expansions < maximumExpansions; expansions++) {
    const current = open.pop();
    const remainingNm = haversineNM(current.lat, current.lon, request.end.lat, request.end.lon);
    if (remainingNm <= stepNm * 1.5) {
      const finalViolation = navigationConstraintViolation(
        shorelineIndex,
        null,
        { ...options.constraints, minimumDepthM: 0 },
        current.lat,
        current.lon,
        request.end.lat,
        request.end.lon,
        {
          start: request.start,
          end: request.end,
          departureClearanceEstablished: current.clearanceEstablished,
          departureMinimumDistanceNm: 0.05,
        },
      );
      if (
        !finalViolation &&
        (!edgeIndex ||
          (!isPointOnLand(edgeIndex, request.end.lat, request.end.lon) &&
            !segmentCrossesLandFast(edgeIndex, current.lat, current.lon, request.end.lat, request.end.lon))) &&
        (!regionIndex ||
          avoidIds.size === 0 ||
          (!isPointInRegion(regionIndex, avoidIds, request.end.lat, request.end.lon) &&
            !segmentCrossesRegion(regionIndex, avoidIds, current.lat, current.lon, request.end.lat, request.end.lon)))
      ) {
        const path = [...reconstruct(current), request.end];
        onProgress(15, path.map((point) => [point.lat, point.lon]));
        return withTimes(path, Date.parse(request.departureTime), planningSpeedKn);
      }
    }

    if (expansions % 250 === 0) {
      onProgress(Math.min(14, (expansions / maximumExpansions) * 14), [[current.lat, current.lon]]);
    }
    for (const [dx, dy] of NEIGHBORS) {
      const ix = current.ix + dx;
      const iy = current.iy + dy;
      const next = fromGrid(request.start, longitudeScale, stepNm, ix, iy);
      const edgeDistanceNm = stepNm * (dx !== 0 && dy !== 0 ? Math.SQRT2 : 1);
      const nextG = current.g + edgeDistanceNm;
      if (nextG + haversineNM(next.lat, next.lon, request.end.lat, request.end.lon) > maximumDetourNm) continue;
      if (edgeIndex && (isPointOnLand(edgeIndex, next.lat, next.lon) || segmentCrossesLandFast(edgeIndex, current.lat, current.lon, next.lat, next.lon)))
        continue;
      if (
        regionIndex &&
        avoidIds.size > 0 &&
        (isPointInRegion(regionIndex, avoidIds, next.lat, next.lon) ||
          segmentCrossesRegion(regionIndex, avoidIds, current.lat, current.lon, next.lat, next.lon))
      )
        continue;
      const violation = navigationConstraintViolation(
        shorelineIndex,
        null,
        { ...options.constraints, minimumDepthM: 0 },
        current.lat,
        current.lon,
        next.lat,
        next.lon,
        {
          start: request.start,
          end: request.end,
          departureClearanceEstablished: current.clearanceEstablished,
          departureMinimumDistanceNm: 0.05,
        },
      );
      if (violation) continue;
      const clearanceEstablished =
        current.clearanceEstablished ||
        (!(minimumShoreDistanceNm > 0) ||
          (!!shorelineIndex &&
            segmentHasShoreClearance(
              shorelineIndex,
              next.lat,
              next.lon,
              next.lat,
              next.lon,
              minimumShoreDistanceNm,
            )));
      const key = gridKey(ix, iy, clearanceEstablished);
      if ((best.get(key) ?? Infinity) <= nextG) continue;
      best.set(key, nextG);
      const heuristic = haversineNM(next.lat, next.lon, request.end.lat, request.end.lon);
      // Small turn penalty discourages jagged corridors without changing feasibility.
      const previousBearing = current.parent
        ? bearingTo(current.parent.lat, current.parent.lon, current.lat, current.lon)
        : bearingTo(request.start.lat, request.start.lon, request.end.lat, request.end.lon);
      const nextBearing = bearingTo(current.lat, current.lon, next.lat, next.lon);
      const turn = Math.abs((((nextBearing - previousBearing + 540) % 360) - 180) / 180);
      open.push({ ...next, ix, iy, g: nextG, f: nextG + heuristic + turn * stepNm * 0.2, clearanceEstablished, parent: current });
    }
  }
  throw new Error(`No bounded chart-safe corridor found within ${maximumExpansions} A* expansions`);
}
