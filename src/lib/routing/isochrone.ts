// Isochrone routing: time-optimal route search via iterative frontier expansion.

import {
  CurrentProvider,
  WindProvider,
  LandEdgeIndex,
  LatLon,
  RegionIndex,
  PolarData,
  CalculationRequest,
  IsochronePoint,
  NavigationSafetyContext,
  RoutePoint,
} from '../../types';
import { RoutingAlgorithm } from './algorithm';
import { nearestIdx } from '../windprovider';
import { interpolateBoatSpeed } from '../polar';
import { segmentCrossesLandBatch, segmentCrossesLandFast, isPointOnLand } from '../landmask';
import { segmentCrossesRegion, isPointInRegion } from '../regions';
import {
  haversineNM,
  bearingTo,
  destinationPoint,
  destinationPointPrepared,
  prepareHeading,
  type PreparedHeading,
  windSpeedKnots,
  windDirection,
  trueWindAngle,
  DEG_TO_RAD,
} from '../geo';
import { advanceUnderwayBudget, isLegInDaylight, passageDayIndex, solarElevationDeg } from '../passage-constraints';
import { navigationConstraintViolation, type NavigationConstraints } from '../navigation-safety';
import { NodeRoutingPhaseProfiler } from './node-phase-profiler';

const DEFAULT_HEADING_STEP = 5;
const DEFAULT_SECTOR_SIZE = 1;
const DEFAULT_MIN_BOAT_SPEED = 0.3;
const DEFAULT_ARRIVAL_RADIUS_NM = 2;
// Applied when the direct segment from a frontier point to the destination is clear of land.
// When land blocks that segment, the cone is disabled (180°) so the frontier can find a way
// around the obstacle — e.g. eastward escape from the Roslagen archipelago (BUG-51).
// Value matches OpenCPN's MaxDivertedCourse default (REQ-73).
const FINE_PASS_CONE_HALF_ANGLE = 100;
// Land check for cone disable uses only the first N nm of the bearing to destination.
// Checking the full segment (up to 250 nm) causes nearly every Baltic frontier point to
// have its cone disabled because the long segment crosses Finnish/Estonian land — removing
// all directional constraint and causing excessive wandering (BUG-53).
const CONE_DISABLE_LOOKAHEAD_NM = 100;
const MAX_HEADING_CHANGE = 120;
const MIN_SHARED_ALTERNATIVE_SEPARATION_NM = 0.25;
const DEFAULT_COARSE_HEADING_STEP = 10;
const DEFAULT_COARSE_SECTOR_SIZE = 2;
const DEFAULT_CORRIDOR_WIDTH_NM = 30;
const MAX_POLAR_HEADING_CACHE_ENTRIES = 128;
const MIN_ADAPTIVE_HEADING_ROUTE_NM = 250;

interface RoutingCorridorPoint extends LatLon {
  timeMs: number;
}

interface FrontierEntry<T> {
  point: T;
  distSq: number;
}

interface FrontierPlacement {
  sector: number;
  distSq: number;
  index: number;
}

class FrontierAccumulator<T extends { lat: number; lon: number }> {
  readonly sectors = new Map<number, FrontierEntry<T>[]>();
  candidateCount = 0;
  private readonly longitudeScale: number;

  constructor(
    private readonly startLat: number,
    private readonly startLon: number,
    private readonly sectorSize: number,
    private readonly lanes = 1,
  ) {
    this.longitudeScale = Math.cos(startLat * DEG_TO_RAD);
  }

  consider(lat: number, lon: number, lane = 0): FrontierPlacement | null {
    this.candidateCount++;
    const brng = bearingTo(this.startLat, this.startLon, lat, lon);
    const bearingSector = Math.floor((((brng % 360) + 360) % 360) / this.sectorSize);
    const sector = bearingSector * this.lanes + Math.min(Math.max(0, lane), this.lanes - 1);
    const dLat = lat - this.startLat;
    const dLon = (lon - this.startLon) * this.longitudeScale;
    const distSq = dLat * dLat + dLon * dLon;
    const existing = this.sectors.get(sector);
    if (!existing) return { sector, distSq, index: 0 };
    if (existing.length < 2) return { sector, distSq, index: existing.length };
    const minIndex = existing[0].distSq <= existing[1].distSq ? 0 : 1;
    return distSq > existing[minIndex].distSq ? { sector, distSq, index: minIndex } : null;
  }

  commit(point: T, placement: FrontierPlacement): void {
    const entry = { point, distSq: placement.distSq };
    const existing = this.sectors.get(placement.sector);
    if (!existing) this.sectors.set(placement.sector, [entry]);
    else if (placement.index === existing.length) existing.push(entry);
    else existing[placement.index] = entry;
  }

  add(point: T): void {
    const placement = this.consider(point.lat, point.lon);
    if (placement) this.commit(point, placement);
  }

  frontier(): T[] {
    return [...this.sectors.values()].flatMap((entries) => entries.map(({ point }) => point));
  }
}

function routingCorridor(value: unknown): RoutingCorridorPoint[] | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const points = value.filter(
    (point): point is RoutingCorridorPoint =>
      typeof point === 'object' &&
      point !== null &&
      Number.isFinite((point as RoutingCorridorPoint).lat) &&
      Number.isFinite((point as RoutingCorridorPoint).lon) &&
      Number.isFinite((point as RoutingCorridorPoint).timeMs),
  );
  return points.length >= 2 ? points : null;
}

function routingCorridors(options: Record<string, unknown> | undefined): RoutingCorridorPoint[][] {
  const multiple = options?._routingCorridors;
  if (Array.isArray(multiple)) {
    const corridors = multiple
      .map(routingCorridor)
      .filter((corridor): corridor is RoutingCorridorPoint[] => !!corridor);
    if (corridors.length > 0) return corridors;
  }
  const single = routingCorridor(options?._routingCorridor);
  return single ? [single] : [];
}

function prepareCorridorAnchors(times: Date[], corridor: RoutingCorridorPoint[] | null): Array<LatLon | null> {
  if (!corridor) return times.map(() => null);
  let corridorIndex = 0;
  return times.map((time) => {
    while (
      corridorIndex + 1 < corridor.length &&
      Math.abs(corridor[corridorIndex + 1].timeMs - time.getTime()) <=
        Math.abs(corridor[corridorIndex].timeMs - time.getTime())
    ) {
      corridorIndex++;
    }
    return corridor[corridorIndex];
  });
}

function maximumPathSeparationNm(a: RoutePoint[], b: RoutePoint[]): number {
  const samples = Math.min(24, Math.max(2, Math.min(a.length, b.length)));
  let maximum = 0;
  for (let sample = 1; sample < samples - 1; sample++) {
    const fraction = sample / (samples - 1);
    const pointA = a[Math.round(fraction * (a.length - 1))];
    const pointB = b[Math.round(fraction * (b.length - 1))];
    maximum = Math.max(maximum, haversineNM(pointA.lat, pointA.lon, pointB.lat, pointB.lon));
  }
  return maximum;
}

interface StepTiming {
  step: number;
  frontierSize: number;
  coneDisabledCount: number;
  candidatesEvaluated: number;
  landChecksPerformed: number;
  windLookupMs: number;
  polarMs: number;
  landCheckMs: number;
  pruningMs: number;
  totalMs: number;
}

function logStepTiming(t: StepTiming): void {
  if (!process.env.DEBUG) return;
  console.log(
    `[isochrone] step=${t.step} frontier=${t.frontierSize} coneDisabled=${t.coneDisabledCount}/${t.frontierSize} candidates=${t.candidatesEvaluated}` +
      ` landChecks=${t.landChecksPerformed}` +
      ` wind=${t.windLookupMs.toFixed(1)}ms polar=${t.polarMs.toFixed(1)}ms` +
      ` land=${t.landCheckMs.toFixed(1)}ms prune=${t.pruningMs.toFixed(1)}ms` +
      ` total=${t.totalMs.toFixed(1)}ms`,
  );
}

function logTimingSummary(timings: StepTiming[]): void {
  if (!process.env.DEBUG) return;
  if (timings.length === 0) return;
  const fields: (keyof StepTiming)[] = [
    'frontierSize',
    'coneDisabledCount',
    'candidatesEvaluated',
    'landChecksPerformed',
    'windLookupMs',
    'polarMs',
    'landCheckMs',
    'pruningMs',
    'totalMs',
  ];
  const lines = fields.map((f) => {
    const vals = timings.map((t) => t[f] as number);
    const total = vals.reduce((a, b) => a + b, 0);
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    return `  ${f}: min=${min.toFixed(1)} max=${max.toFixed(1)} total=${total.toFixed(1)}`;
  });
  console.log(`[isochrone] summary over ${timings.length} steps:\n${lines.join('\n')}`);
}

type FailureReason = 'land' | 'wind' | 'grib_exhausted' | 'safety';

// Structured routing failure — carries a machine-readable reason so the frontend
// can show the sailor a specific diagnostic rather than a generic error string.
export class RoutingError extends Error {
  constructor(
    message: string,
    public readonly reason: FailureReason,
  ) {
    super(message);
    this.name = 'RoutingError';
  }
}

export class IsochroneAlgorithm implements RoutingAlgorithm {
  readonly id = 'isochrone';
  readonly name = 'Isochrone';

  async calculate(
    wind: WindProvider,
    current: CurrentProvider | null,
    polar: PolarData,
    edgeIndex: LandEdgeIndex | null,
    regionIndex: RegionIndex | null,
    request: CalculationRequest,
    onProgress: (pct: number, frontier: Array<[number, number]>) => void,
    options?: Record<string, unknown>,
    navigationSafety?: NavigationSafetyContext,
  ): Promise<{ route: RoutePoint[]; warning?: string; alternatives?: RoutePoint[][] }> {
    const requestedSharedAlternatives = Math.max(
      1,
      Math.min(10, Math.trunc(Number(options?.sharedAlternativeCount ?? 1))),
    );
    if (options?.coarseToFine === true && routingCorridors(options).length === 0) {
      const coarseHeadingStep = Math.max(
        Number(options?.headingStep ?? DEFAULT_HEADING_STEP),
        Number(options?.coarseHeadingStep ?? DEFAULT_COARSE_HEADING_STEP),
      );
      const coarseSectorSize = Math.max(
        Number(options?.sectorSize ?? DEFAULT_SECTOR_SIZE),
        Number(options?.coarseSectorSize ?? DEFAULT_COARSE_SECTOR_SIZE),
      );
      const requestedCoarseCorridors = Number(options?.coarseCorridorCount ?? Math.min(requestedSharedAlternatives, 4));
      const coarseCorridorCount = Math.max(
        1,
        Math.min(
          requestedSharedAlternatives,
          Number.isFinite(requestedCoarseCorridors) ? Math.trunc(requestedCoarseCorridors) : 1,
        ),
      );
      try {
        const coarse = await this.calculate(
          wind,
          current,
          polar,
          edgeIndex,
          regionIndex,
          request,
          (percent, frontier) => onProgress(percent * 0.15, frontier),
          {
            ...options,
            headingStep: coarseHeadingStep,
            sectorSize: coarseSectorSize,
            sharedAlternativeCount: coarseCorridorCount,
            coarseToFine: false,
            _profileStage: 'coarse',
          },
          navigationSafety,
        );
        const coarseEnd = coarse.route.at(-1);
        if (!coarse.warning && coarseEnd?.lat === request.end.lat && coarseEnd.lon === request.end.lon) {
          const coarseCandidates = coarse.alternatives ?? [coarse.route];
          const coarseRoutes = [coarseCandidates[0]];
          const minimumCorridorSeparationNm = Math.max(
            2,
            Math.min(10, Number(options?.corridorWidthNm ?? DEFAULT_CORRIDOR_WIDTH_NM) * 0.25),
          );
          for (const candidate of coarseCandidates.slice(1)) {
            if (coarseRoutes.length >= coarseCorridorCount) break;
            if (
              coarseRoutes.every(
                (selected) => maximumPathSeparationNm(selected, candidate) >= minimumCorridorSeparationNm,
              )
            )
              coarseRoutes.push(candidate);
          }
          const fine = await this.calculate(
            wind,
            current,
            polar,
            edgeIndex,
            regionIndex,
            request,
            (percent, frontier) => onProgress(15 + percent * 0.85, frontier),
            {
              ...options,
              coarseToFine: false,
              sharedAlternativeCount: requestedSharedAlternatives,
              _profileStage: 'fine',
              _routingCorridors: coarseRoutes.map((route) =>
                route.map((point) => ({
                  lat: point.lat,
                  lon: point.lon,
                  timeMs: point.time.getTime(),
                })),
              ),
            },
            navigationSafety,
          );
          const fineEnd = fine.route.at(-1);
          if (!fine.warning && fineEnd?.lat === request.end.lat && fineEnd.lon === request.end.lon) return fine;
        }
      } catch {
        // The approximation may fail even when the full-resolution search can find a route.
      }
      return this.calculate(
        wind,
        current,
        polar,
        edgeIndex,
        regionIndex,
        request,
        (percent, frontier) => onProgress(15 + percent * 0.85, frontier),
        {
          ...options,
          coarseToFine: false,
          sharedAlternativeCount: requestedSharedAlternatives,
          _profileStage: 'full-fallback',
        },
        navigationSafety,
      );
    }
    const headingStep = Number(options?.headingStep ?? DEFAULT_HEADING_STEP);
    const sectorSize = Number(options?.sectorSize ?? DEFAULT_SECTOR_SIZE);
    const minBoatSpeed = Number(options?.minBoatSpeed ?? DEFAULT_MIN_BOAT_SPEED);
    const arrivalRadiusNm = Number(options?.arrivalRadiusNm ?? DEFAULT_ARRIVAL_RADIUS_NM);
    const maxWindKn = Number(options?.maxWindKn ?? 0); // 0 = no limit
    const maxWaveM = Number(options?.maxWaveM ?? 0); // 0 = no limit
    const motorSpeedKn = Number(options?.motorSpeedKn ?? 0); // 0 = no motor
    const motorBelowKn = Number(options?.motorBelowKn ?? 0); // 0 = disabled
    const forceMotor = Boolean(options?.forceMotor ?? false);
    const headingOffsetDeg = Number(options?.headingOffsetDeg ?? 0);
    const waitForWind = Boolean(options?.waitForWind ?? false);
    const daylightOnly = Boolean(options?.daylightOnly ?? false);
    const requestedMaxHours = Number(options?.maxHoursPerDay ?? 0);
    const maxHoursPerDay = Number.isFinite(requestedMaxHours) ? Math.max(0, Math.min(24, requestedMaxHours)) : 0;
    const configuredConeHalfAngle = Number(options?.coneHalfAngle ?? FINE_PASS_CONE_HALF_ANGLE);
    const coneDisableLookaheadNm = Number(options?.coneDisableLookaheadNm ?? CONE_DISABLE_LOOKAHEAD_NM);
    const maxHeadingChangeDeg = Number(options?.maxHeadingChange ?? MAX_HEADING_CHANGE);
    const sharedAlternativeCount = requestedSharedAlternatives;
    const requestedCorridorWidthNm = Number(options?.corridorWidthNm ?? DEFAULT_CORRIDOR_WIDTH_NM);
    const corridorWidthNm = Number.isFinite(requestedCorridorWidthNm)
      ? Math.max(1, requestedCorridorWidthNm)
      : DEFAULT_CORRIDOR_WIDTH_NM;
    const headings: PreparedHeading[] = [];
    for (let rawHeading = headingOffsetDeg; rawHeading < 360 + headingOffsetDeg; rawHeading += headingStep) {
      headings.push(prepareHeading(((rawHeading % 360) + 360) % 360));
    }
    const pendingLat = new Float64Array(headings.length);
    const pendingLon = new Float64Array(headings.length);
    const pendingTwa = new Float64Array(headings.length);
    const pendingSpeed = new Float64Array(headings.length);
    const pendingHeadingIndex = new Uint32Array(headings.length);
    const pendingMotoring = new Uint8Array(headings.length);
    const pendingCorridorLane = new Uint8Array(headings.length);
    const pendingBlockedByLand = new Uint8Array(headings.length);
    const polarHeadingCache = new Map<string, { twa: Float64Array; speed: Float64Array }>();
    const navigationConstraints: NavigationConstraints = {
      minimumDepthM: Number(options?.minimumDepthM ?? 0),
      minimumShoreDistanceNm: Number(options?.minimumShoreDistanceNm ?? 0),
      maximumOffshoreDistanceNm: Number(options?.maximumOffshoreDistanceNm ?? 0),
    };
    const hasNavigationConstraints =
      navigationConstraints.minimumDepthM > 0 ||
      navigationConstraints.minimumShoreDistanceNm > 0 ||
      navigationConstraints.maximumOffshoreDistanceNm > 0;

    const { start, end } = request;
    const departureTime = new Date(request.departureTime);
    const startTimeIdx = nearestIdx(wind.times, departureTime);
    const passageDepartureTime = new Date(
      String(options?.passageDepartureTime ?? wind.times[startTimeIdx].toISOString()),
    );
    const configuredInitialDay = Number(options?.initialPassageDayIndex);
    const configuredInitialHours = Number(options?.initialUnderwayHoursToday);
    const initialPassageDayIndex = Number.isFinite(configuredInitialDay)
      ? Math.max(0, Math.floor(configuredInitialDay))
      : passageDayIndex(wind.times[startTimeIdx], passageDepartureTime);
    const initialUnderwayHoursToday = Number.isFinite(configuredInitialHours) ? Math.max(0, configuredInitialHours) : 0;
    const nSteps = wind.times.length - startTimeIdx - 1;
    const activeCorridors = routingCorridors(options);
    const preparedCorridors = activeCorridors.map((corridor) => prepareCorridorAnchors(wind.times, corridor));
    const requestedHeadingStride = Number(
      options?.speculativeHeadingStride ??
        (haversineNM(start.lat, start.lon, end.lat, end.lon) >= MIN_ADAPTIVE_HEADING_ROUTE_NM ? 2 : 1),
    );
    const speculativeHeadingStride =
      activeCorridors.length > 0
        ? Math.max(1, Number.isFinite(requestedHeadingStride) ? Math.trunc(requestedHeadingStride) : 2)
        : 1;

    if (nSteps <= 0) throw new Error('Departure time is at or after the end of the forecast data');

    const phaseProfiler = new NodeRoutingPhaseProfiler({
      attempt: Number(options?._profileAttempt ?? 0),
      stage: String(options?._profileStage ?? 'full'),
      routeDistanceNm: Number(haversineNM(start.lat, start.lon, end.lat, end.lon).toFixed(1)),
      stepsAvailable: nSteps,
      headingStepDeg: headingStep,
      sectorSizeDeg: sectorSize,
    });
    const profiling = phaseProfiler.enabled;
    const debugTiming = Boolean(process.env.DEBUG);
    const detailedTiming = profiling || debugTiming;

    const avoidIds = new Set(request.avoidRegionIds ?? []);

    // Nautical Safety Rule: hard error if start or destination is inside an avoided region.
    if (regionIndex && avoidIds.size > 0) {
      if (isPointInRegion(regionIndex, avoidIds, start.lat, start.lon))
        throw new Error('Start point is inside an avoided region — move it to open water or unmark that region');
      if (isPointInRegion(regionIndex, avoidIds, end.lat, end.lon))
        throw new Error('Destination is inside an avoided region — move it to open water or unmark that region');
    }

    const seedVec = wind.getWind(start.lat, start.lon, startTimeIdx);
    let isochrone: IsochronePoint[] = [
      {
        lat: start.lat,
        lon: start.lon,
        time: wind.times[startTimeIdx],
        heading: 0,
        twa: 0,
        tws: windSpeedKnots(seedVec.u, seedVec.v),
        boatSpeed: undefined,
        windDir: windDirection(seedVec.u, seedVec.v),
        passageDayIndex: initialPassageDayIndex,
        underwayHoursToday: initialUnderwayHoursToday,
        stepCalcMs: 0,
        parent: undefined,
      },
    ];

    let arrived: IsochronePoint | null = null;
    const arrivedCandidates: IsochronePoint[] = [];
    let firstArrivalStep: number | null = null;

    const stepTimings: StepTiming[] = [];
    let stepsCompleted = 0;
    let lastFrontier: IsochronePoint[] | null = null;
    let lastRejectedByLand = 0;
    let lastRejectedByPolar = 0;
    let lastRejectedByGrib = 0;
    let lastRejectedBySafety = 0;

    for (let step = startTimeIdx; step < wind.times.length - 1; step++) {
      const stepStart = performance.now();
      phaseProfiler.startStep(step, isochrone.length);
      const nextTime = wind.times[step + 1];
      const dtHours = (nextTime.getTime() - wind.times[step].getTime()) / 3_600_000;
      const corridorAnchors = preparedCorridors
        .map((corridor) => corridor[step + 1])
        .filter((anchor): anchor is LatLon => anchor !== null);
      const frontierAccumulator = new FrontierAccumulator<IsochronePoint>(
        start.lat,
        start.lon,
        sectorSize,
        Math.max(1, corridorAnchors.length),
      );
      const stepArrivals: IsochronePoint[] = [];

      let windLookupMs = 0;
      let landCheckMs = 0;
      let candidatesEvaluated = 0;
      let landChecksPerformed = 0;
      let rejectedByPolar = 0;
      let rejectedByLand = 0;
      let rejectedByGrib = 0;
      let rejectedBySafety = 0;
      let coneDisabledCount = 0;

      const t0frontier = debugTiming ? performance.now() : 0;

      for (const point of isochrone) {
        if (profiling) phaseProfiler.increment('frontierPoints');
        let phaseStarted = profiling ? phaseProfiler.mark() : 0;
        const pointOnLand = edgeIndex !== null && isPointOnLand(edgeIndex, point.lat, point.lon);
        const pointInRegion =
          regionIndex !== null && avoidIds.size > 0 && isPointInRegion(regionIndex, avoidIds, point.lat, point.lon);
        if (profiling) phaseProfiler.record('frontierGuard', phaseStarted);
        if (pointOnLand || pointInRegion) continue;

        // Per-position bearing: cone axis points from this frontier point toward the destination,
        // not from the original start. A fixed start→end axis blocked Öresund transit headings
        // that were within 100° of the current-position bearing but >100° off the initial bearing.
        phaseStarted = profiling ? phaseProfiler.mark() : 0;
        const pointToDestBearing = bearingTo(point.lat, point.lon, end.lat, end.lon);
        if (profiling) phaseProfiler.record('cone', phaseStarted);

        const t0wind = detailedTiming ? performance.now() : 0;
        phaseStarted = profiling ? phaseProfiler.mark() : 0;
        const windVec = wind.getWind(point.lat, point.lon, step);
        const gribFilePath = wind.getFilePathForPoint(point.lat, point.lon, step);
        if (detailedTiming) windLookupMs += performance.now() - t0wind;
        if (profiling) phaseProfiler.record('wind', phaseStarted);

        const tws = windSpeedKnots(windVec.u, windVec.v);
        const wdir = windDirection(windVec.u, windVec.v);

        phaseStarted = profiling ? phaseProfiler.mark() : 0;
        const restBudget = advanceUnderwayBudget({
          start: point.time,
          end: nextTime,
          departure: passageDepartureTime,
          currentDayIndex: point.passageDayIndex,
          currentHoursToday: point.underwayHoursToday,
          maxHoursPerDay,
          underway: false,
        });
        let waitCandidateAdded = false;
        const addWaitCandidate = (): void => {
          if (waitCandidateAdded) return;
          const candidate: IsochronePoint = {
            lat: point.lat,
            lon: point.lon,
            time: nextTime,
            heading: point.heading,
            twa: point.parent === undefined ? 0 : trueWindAngle(point.heading, wdir),
            tws,
            boatSpeed: 0,
            propulsion: 'wait',
            windDir: wdir,
            passageDayIndex: restBudget.passageDayIndex,
            underwayHoursToday: restBudget.hoursToday,
            stepCalcMs: 0,
            gribFilePath,
            parent: point,
          };
          const pruneStarted = profiling ? phaseProfiler.mark() : 0;
          frontierAccumulator.add(candidate);
          if (profiling) phaseProfiler.record('prune', pruneStarted);
          waitCandidateAdded = true;
          if (profiling) phaseProfiler.increment('waitsAdded');
        };

        const underwayBudget = advanceUnderwayBudget({
          start: point.time,
          end: nextTime,
          departure: passageDepartureTime,
          currentDayIndex: point.passageDayIndex,
          currentHoursToday: point.underwayHoursToday,
          maxHoursPerDay,
          underway: true,
        });
        const departureOutsideDaylight = daylightOnly && solarElevationDeg(point.time, point.lat, point.lon) <= 0;
        if (profiling) phaseProfiler.record('budget', phaseStarted);
        if (!underwayBudget.allowed || departureOutsideDaylight) {
          addWaitCandidate();
          continue;
        }

        if (maxWindKn > 0 && tws > maxWindKn) {
          rejectedByPolar++;
          if (profiling) phaseProfiler.increment('rejectedWindLimit');
          continue;
        }
        if (maxWaveM > 0) {
          phaseStarted = profiling ? phaseProfiler.mark() : 0;
          const wh = wind.getWave(point.lat, point.lon, wind.times[step]);
          if (profiling) phaseProfiler.record('wind', phaseStarted);
          if (wh != null && wh > maxWaveM) {
            if (profiling) phaseProfiler.increment('rejectedWaveLimit');
            continue;
          }
        }
        phaseStarted = profiling ? phaseProfiler.mark() : 0;
        const distToDest = haversineNM(point.lat, point.lon, end.lat, end.lon);
        const coneCheckEnd =
          distToDest <= coneDisableLookaheadNm
            ? end
            : destinationPoint(point.lat, point.lon, coneDisableLookaheadNm, pointToDestBearing);
        const directPathBlockedByLand =
          edgeIndex !== null &&
          segmentCrossesLandFast(edgeIndex, point.lat, point.lon, coneCheckEnd.lat, coneCheckEnd.lon);
        const directPathBlockedByRegion =
          regionIndex !== null &&
          avoidIds.size > 0 &&
          segmentCrossesRegion(regionIndex, avoidIds, point.lat, point.lon, coneCheckEnd.lat, coneCheckEnd.lon);
        if (directPathBlockedByLand || directPathBlockedByRegion) {
          coneDisabledCount++;
          if (profiling) phaseProfiler.increment('coneDisabled');
        }
        const coneHalfAngle = directPathBlockedByLand || directPathBlockedByRegion ? 180 : configuredConeHalfAngle;
        if (profiling) phaseProfiler.record('cone', phaseStarted);

        const candidatesBeforeHeadings = frontierAccumulator.candidateCount;
        let rejectedByDaylight = false;
        const polarCacheKey = `${windVec.u}:${windVec.v}`;
        let headingPerformance = polarHeadingCache.get(polarCacheKey);
        if (!headingPerformance) {
          if (profiling) phaseProfiler.increment('polarCacheMisses');
          headingPerformance = {
            twa: new Float64Array(headings.length).fill(Number.NaN),
            speed: new Float64Array(headings.length).fill(Number.NaN),
          };
          if (polarHeadingCache.size < MAX_POLAR_HEADING_CACHE_ENTRIES)
            polarHeadingCache.set(polarCacheKey, headingPerformance);
        } else if (profiling) phaseProfiler.increment('polarCacheHits');
        const headingStride = directPathBlockedByLand || directPathBlockedByRegion ? 1 : speculativeHeadingStride;
        const headingStartIndex =
          headingStride === 1 || point.parent === undefined
            ? 0
            : Math.abs(Math.round(point.heading / headingStep)) % headingStride;
        let pendingCount = 0;
        for (let headingIndex = headingStartIndex; headingIndex < headings.length; headingIndex += headingStride) {
          if (profiling) phaseProfiler.increment('headingsConsidered');
          phaseStarted = profiling ? phaseProfiler.mark() : 0;
          const preparedHeading = headings[headingIndex];
          const hdg = preparedHeading.heading;
          const deviation = Math.abs(((hdg - pointToDestBearing + 180 + 360) % 360) - 180);
          if (deviation > coneHalfAngle) {
            if (profiling) phaseProfiler.increment('rejectedCone');
            if (profiling) phaseProfiler.record('headingAndPolar', phaseStarted);
            continue;
          }

          // Seed point (parent===undefined) has no meaningful prior heading — allow all cone-valid
          // headings unconditionally on step 1 (BUG-44).
          if (point.parent !== undefined) {
            const delta = Math.abs(((hdg - point.heading + 180 + 360) % 360) - 180);
            if (delta > maxHeadingChangeDeg) {
              if (profiling) phaseProfiler.increment('rejectedHeadingChange');
              if (profiling) phaseProfiler.record('headingAndPolar', phaseStarted);
              continue;
            }
          }

          let twa = headingPerformance.twa[headingIndex];
          let polarSpeed = headingPerformance.speed[headingIndex];
          if (Number.isNaN(polarSpeed)) {
            twa = trueWindAngle(hdg, wdir);
            polarSpeed = interpolateBoatSpeed(polar, twa, tws);
            headingPerformance.twa[headingIndex] = twa;
            headingPerformance.speed[headingIndex] = polarSpeed;
          }
          // REQ-84: motor fires when polarSpeed < motorBelowKn threshold.
          const motoring = motorSpeedKn > 0 && (forceMotor || (motorBelowKn > 0 && polarSpeed < motorBelowKn));
          const effectiveSpeed = motoring ? motorSpeedKn : polarSpeed;
          // REQ-82: below minimum → zero-speed gate before discard.
          if (effectiveSpeed < minBoatSpeed) {
            // REQ-83: stay in place for one candidate per frontier point; advancing time only.
            if (waitForWind) addWaitCandidate();
            rejectedByPolar++;
            if (profiling) phaseProfiler.increment('rejectedMinSpeed');
            if (profiling) phaseProfiler.record('headingAndPolar', phaseStarted);
            continue;
          }
          candidatesEvaluated++;
          const distNM = effectiveSpeed * dtHours;
          const wt = destinationPointPrepared(point.lat, point.lon, distNM, preparedHeading);
          let newLat = wt.lat;
          let newLon = wt.lon;
          if (profiling) phaseProfiler.record('headingAndPolar', phaseStarted);

          // Apply ocean current drift: water-track endpoint + current displacement over dtHours.
          // Current is sampled at the frontier point (start of the step) in m/s.
          // Cosine correction uses point.lat (original latitude) — not newLat which is
          // already modified by the latitude drift (BUG-94).
          phaseStarted = profiling ? phaseProfiler.mark() : 0;
          if (current) {
            const cur = current.getCurrent(point.lat, point.lon, nextTime);
            const dtS = dtHours * 3600;
            newLat += (cur.v * dtS) / (1852 * 60);
            newLon += (cur.u * dtS) / (1852 * 60 * Math.cos(point.lat * DEG_TO_RAD));
          }
          if (profiling) phaseProfiler.record('current', phaseStarted);

          phaseStarted = profiling ? phaseProfiler.mark() : 0;
          const candidateCovered = wind.coversPointAtTime(newLat, newLon, step);
          if (profiling) phaseProfiler.record('coverage', phaseStarted);
          if (!candidateCovered) {
            rejectedByGrib++;
            if (profiling) phaseProfiler.increment('rejectedCoverage');
            continue;
          } // discard candidates outside spatiotemporal GRIB domain (BUG-37, BUG-75)

          phaseStarted = profiling ? phaseProfiler.mark() : 0;
          let corridorLane = 0;
          let corridorDistanceNm = Infinity;
          for (let corridorIndex = 0; corridorIndex < corridorAnchors.length; corridorIndex++) {
            const anchor = corridorAnchors[corridorIndex];
            const distance = haversineNM(newLat, newLon, anchor.lat, anchor.lon);
            if (distance < corridorDistanceNm) {
              corridorDistanceNm = distance;
              corridorLane = corridorIndex;
            }
          }
          const outsideCorridor =
            corridorAnchors.length > 0 &&
            !directPathBlockedByLand &&
            !directPathBlockedByRegion &&
            corridorDistanceNm > corridorWidthNm;
          if (profiling) phaseProfiler.record('coverage', phaseStarted);
          if (outsideCorridor) {
            if (profiling) phaseProfiler.increment('rejectedCorridor');
            continue;
          }

          phaseStarted = profiling ? phaseProfiler.mark() : 0;
          const candidateOutsideDaylight =
            daylightOnly && !isLegInDaylight(point.time, nextTime, point, { lat: newLat, lon: newLon });
          if (profiling) phaseProfiler.record('daylight', phaseStarted);
          if (candidateOutsideDaylight) {
            rejectedByDaylight = true;
            if (profiling) phaseProfiler.increment('rejectedDaylight');
            continue;
          }

          pendingLat[pendingCount] = newLat;
          pendingLon[pendingCount] = newLon;
          pendingTwa[pendingCount] = twa;
          pendingSpeed[pendingCount] = effectiveSpeed;
          pendingHeadingIndex[pendingCount] = headingIndex;
          pendingMotoring[pendingCount] = motoring ? 1 : 0;
          pendingCorridorLane[pendingCount] = corridorLane;
          pendingCount++;
        }

        phaseStarted = profiling ? phaseProfiler.mark() : 0;
        if (edgeIndex && pendingCount > 0) {
          const t0land = detailedTiming ? performance.now() : 0;
          segmentCrossesLandBatch(
            edgeIndex,
            point.lat,
            point.lon,
            pendingLat,
            pendingLon,
            pendingCount,
            pendingBlockedByLand,
          );
          if (detailedTiming) landCheckMs += performance.now() - t0land;
          landChecksPerformed += pendingCount;
        } else {
          pendingBlockedByLand.fill(0, 0, pendingCount);
        }
        if (profiling) phaseProfiler.record('land', phaseStarted);

        for (let candidateIndex = 0; candidateIndex < pendingCount; candidateIndex++) {
          if (pendingBlockedByLand[candidateIndex] !== 0) {
            rejectedByLand++;
            if (profiling) phaseProfiler.increment('rejectedLand');
            continue;
          }

          const newLat = pendingLat[candidateIndex];
          const newLon = pendingLon[candidateIndex];
          const twa = pendingTwa[candidateIndex];
          const effectiveSpeed = pendingSpeed[candidateIndex];
          const hdg = headings[pendingHeadingIndex[candidateIndex]].heading;
          const motoring = pendingMotoring[candidateIndex] !== 0;

          phaseStarted = profiling ? phaseProfiler.mark() : 0;
          const candidateSafetyViolation = hasNavigationConstraints
            ? navigationConstraintViolation(
                navigationSafety?.shorelineIndex ?? null,
                navigationSafety?.depthProvider ?? null,
                navigationConstraints,
                point.lat,
                point.lon,
                newLat,
                newLon,
              )
            : undefined;
          if (profiling) phaseProfiler.record('safety', phaseStarted);
          if (candidateSafetyViolation) {
            rejectedBySafety++;
            if (profiling) phaseProfiler.increment('rejectedSafety');
            continue;
          }

          phaseStarted = profiling ? phaseProfiler.mark() : 0;
          const candidateBlockedByRegion =
            regionIndex &&
            avoidIds.size > 0 &&
            segmentCrossesRegion(regionIndex, avoidIds, point.lat, point.lon, newLat, newLon);
          if (profiling) phaseProfiler.record('region', phaseStarted);
          if (candidateBlockedByRegion) {
            rejectedByLand++;
            if (profiling) phaseProfiler.increment('rejectedRegion');
            continue;
          }

          phaseStarted = profiling ? phaseProfiler.mark() : 0;
          const distToEnd = haversineNM(newLat, newLon, end.lat, end.lon);
          if (profiling) phaseProfiler.record('candidateAndArrival', phaseStarted);
          phaseStarted = profiling ? phaseProfiler.mark() : 0;
          const frontierPlacement = frontierAccumulator.consider(newLat, newLon, pendingCorridorLane[candidateIndex]);
          if (profiling) phaseProfiler.record('prune', phaseStarted);
          const isArrivalCandidate = distToEnd <= arrivalRadiusNm;
          if (isArrivalCandidate && profiling) phaseProfiler.increment('arrivalCandidates');
          if (!frontierPlacement && !isArrivalCandidate) continue;
          phaseStarted = profiling ? phaseProfiler.mark() : 0;
          const newPoint: IsochronePoint = {
            lat: newLat,
            lon: newLon,
            time: nextTime,
            heading: hdg,
            twa,
            tws,
            boatSpeed: effectiveSpeed,
            propulsion: motoring ? 'motor' : 'sail',
            windDir: wdir,
            passageDayIndex: underwayBudget.passageDayIndex,
            underwayHoursToday: underwayBudget.hoursToday,
            stepCalcMs: 0,
            gribFilePath,
            parent: point,
          };
          if (frontierPlacement) frontierAccumulator.commit(newPoint, frontierPlacement);
          if (profiling) phaseProfiler.increment('acceptedCandidates');
          if (profiling) phaseProfiler.record('candidateAndArrival', phaseStarted);
          if (isArrivalCandidate) {
            const finalArrivalTime = new Date(nextTime.getTime() + (distToEnd / effectiveSpeed) * 3_600_000);
            phaseStarted = profiling ? phaseProfiler.mark() : 0;
            const finalBudget = advanceUnderwayBudget({
              start: nextTime,
              end: finalArrivalTime,
              departure: passageDepartureTime,
              currentDayIndex: underwayBudget.passageDayIndex,
              currentHoursToday: underwayBudget.hoursToday,
              maxHoursPerDay,
              underway: true,
            });
            if (profiling) phaseProfiler.record('budget', phaseStarted);

            phaseStarted = profiling ? phaseProfiler.mark() : 0;
            const arrivalBlockedByLand =
              edgeIndex !== null && segmentCrossesLandFast(edgeIndex, newLat, newLon, end.lat, end.lon);
            if (profiling) phaseProfiler.record('land', phaseStarted);

            phaseStarted = profiling ? phaseProfiler.mark() : 0;
            const arrivalSafetyViolation = hasNavigationConstraints
              ? navigationConstraintViolation(
                  navigationSafety?.shorelineIndex ?? null,
                  navigationSafety?.depthProvider ?? null,
                  navigationConstraints,
                  newLat,
                  newLon,
                  end.lat,
                  end.lon,
                )
              : undefined;
            if (profiling) phaseProfiler.record('safety', phaseStarted);

            phaseStarted = profiling ? phaseProfiler.mark() : 0;
            const arrivalInDaylight =
              !daylightOnly || isLegInDaylight(nextTime, finalArrivalTime, { lat: newLat, lon: newLon }, end);
            if (profiling) phaseProfiler.record('daylight', phaseStarted);

            phaseStarted = profiling ? phaseProfiler.mark() : 0;
            if (finalBudget.allowed && arrivalInDaylight && !arrivalBlockedByLand && !arrivalSafetyViolation) {
              stepArrivals.push(newPoint);
              if (sharedAlternativeCount > 1) arrivedCandidates.push(newPoint);
              if (
                firstArrivalStep === null &&
                (!arrived || distToEnd < haversineNM(arrived.lat, arrived.lon, end.lat, end.lon))
              )
                arrived = newPoint;
            }
            if (profiling) phaseProfiler.record('candidateAndArrival', phaseStarted);
          }
        }
        if (rejectedByDaylight && frontierAccumulator.candidateCount === candidatesBeforeHeadings) addWaitCandidate();
      }

      const frontierLoopMs = debugTiming ? performance.now() - t0frontier : 0;
      const polarMs = Math.max(0, frontierLoopMs - windLookupMs - landCheckMs);

      const stepCalcMs = performance.now() - stepStart;
      const t0prune = performance.now();
      let phaseStarted = profiling ? phaseProfiler.mark() : 0;
      const nextFrontier = frontierAccumulator.frontier();
      const pruningMs = performance.now() - t0prune;
      if (profiling) phaseProfiler.record('prune', phaseStarted);
      phaseStarted = profiling ? phaseProfiler.mark() : 0;
      for (const candidate of nextFrontier) candidate.stepCalcMs = Math.round(stepCalcMs);
      for (const candidate of stepArrivals) candidate.stepCalcMs = Math.round(stepCalcMs);
      if (profiling) phaseProfiler.record('candidateStamp', phaseStarted);

      if (arrived) {
        if (sharedAlternativeCount === 1) {
          phaseProfiler.endStep(nextFrontier.length, frontierAccumulator.candidateCount);
          break;
        }
        if (firstArrivalStep === null) firstArrivalStep = step;
        // Later arrivals are often the routes that pass an obstruction on a different side.
        // Keep expanding briefly after the fastest arrival instead of returning variants that
        // differ only in their final approach to the same path.
        if (step - firstArrivalStep >= 6) {
          phaseProfiler.endStep(nextFrontier.length, frontierAccumulator.candidateCount);
          break;
        }
      }

      lastRejectedByLand = rejectedByLand;
      lastRejectedByPolar = rejectedByPolar;
      lastRejectedByGrib = rejectedByGrib;
      lastRejectedBySafety = rejectedBySafety;

      isochrone = nextFrontier;

      if (isochrone.length > 0) lastFrontier = isochrone;

      if (isochrone.length === 0) {
        const reason: FailureReason =
          lastRejectedBySafety > lastRejectedByGrib &&
          lastRejectedBySafety > lastRejectedByLand &&
          lastRejectedBySafety > lastRejectedByPolar
            ? 'safety'
            : lastRejectedByGrib > lastRejectedByLand && lastRejectedByGrib > lastRejectedByPolar
              ? 'grib_exhausted'
              : lastRejectedByLand > lastRejectedByPolar
                ? 'land'
                : 'wind';
        const reasonText = (r: FailureReason) =>
          r === 'land'
            ? 'land blocks all paths'
            : r === 'safety'
              ? 'navigation safety constraints block all paths'
              : r === 'grib_exhausted'
                ? 'frontier reached GRIB boundary'
                : 'wind too adverse or light';
        const counts = `(land: ${lastRejectedByLand}, safety: ${lastRejectedBySafety}, wind: ${lastRejectedByPolar}, grib: ${lastRejectedByGrib})`;
        if (lastFrontier !== null) {
          const closest = closestTo(lastFrontier, end);
          const dist = Math.round(haversineNM(closest.lat, closest.lon, end.lat, end.lon));
          const result = {
            route: backtrack(closest, wind, false),
            warning: `No reachable positions at step ${stepsCompleted + 1} (${reasonText(reason)}) ${counts} — partial route shown (${dist} nm from destination)`,
          };
          phaseProfiler.endStep(0, frontierAccumulator.candidateCount);
          phaseProfiler.finish('partial');
          return result;
        }
        phaseProfiler.endStep(0, frontierAccumulator.candidateCount);
        phaseProfiler.finish('failed');
        throw new RoutingError(
          `No reachable positions at step ${step - startTimeIdx + 1} — ${reasonText(reason)}${reason === 'wind' ? ' to make progress' : ''} ${counts}`,
          reason,
        );
      }

      if (debugTiming) {
        const timing: StepTiming = {
          step,
          frontierSize: isochrone.length,
          coneDisabledCount,
          candidatesEvaluated,
          landChecksPerformed,
          windLookupMs,
          polarMs: Math.max(0, polarMs),
          landCheckMs,
          pruningMs,
          totalMs: performance.now() - stepStart,
        };
        stepTimings.push(timing);
        logStepTiming(timing);
      }

      phaseStarted = profiling ? phaseProfiler.mark() : 0;
      const frontier: Array<[number, number]> = isochrone.map((p) => [p.lat, p.lon]);
      stepsCompleted++;
      onProgress(Math.round(((step - startTimeIdx + 1) / nSteps) * 100), frontier);
      if (profiling) phaseProfiler.record('progress', phaseStarted);
      phaseProfiler.endStep(isochrone.length, frontierAccumulator.candidateCount);
      // Let Signal K flush progress and accept a cancellation request between forecast steps.
      await new Promise<void>((resolve) => setImmediate(resolve));
    }

    logTimingSummary(stepTimings);

    if (!arrived) {
      if (isochrone.length > 0) {
        // Time steps exhausted with a live frontier — route extends past forecast coverage.
        const closest = closestTo(isochrone, end);
        const dist = Math.round(haversineNM(closest.lat, closest.lon, end.lat, end.lon));
        const result = {
          route: backtrack(closest, wind, false),
          warning: `Route extends past forecast coverage after ${stepsCompleted} steps — partial route shown (${dist} nm from destination)`,
        };
        phaseProfiler.finish('partial');
        return result;
      }
      phaseProfiler.finish('failed');
      throw new RoutingError(
        `Destination not reached within forecast period after ${stepsCompleted} steps`,
        'grib_exhausted',
      );
    }

    const routeAssemblyStarted = profiling ? phaseProfiler.mark() : 0;
    const route = backtrack(arrived, wind, true, end);
    if (sharedAlternativeCount === 1) {
      if (profiling) phaseProfiler.record('routeAssembly', routeAssemblyStarted);
      phaseProfiler.finish('complete');
      return { route };
    }
    const result = {
      route,
      alternatives: collectDistinctArrivalRoutes(route, arrivedCandidates, sharedAlternativeCount, wind, end),
    };
    if (profiling) phaseProfiler.record('routeAssembly', routeAssemblyStarted);
    phaseProfiler.finish('complete');
    return result;
  }
}

function routeGeometryKey(route: RoutePoint[]): string {
  return route.map((point) => `${point.lat.toFixed(6)},${point.lon.toFixed(6)}`).join(';');
}

function collectDistinctArrivalRoutes(
  primary: RoutePoint[],
  arrivals: IsochronePoint[],
  requestedCount: number,
  wind: WindProvider,
  end: { lat: number; lon: number },
): RoutePoint[][] {
  const routes = [primary];
  const seen = new Set([routeGeometryKey(primary)]);
  const candidates = arrivals
    .map((arrival) => ({
      route: backtrack(arrival, wind, true, end),
      arrivalTimeMs:
        arrival.time.getTime() +
        (haversineNM(arrival.lat, arrival.lon, end.lat, end.lon) / (arrival.boatSpeed ?? 1)) * 3_600_000,
    }))
    .sort((a, b) => a.arrivalTimeMs - b.arrivalTimeMs)
    .slice(0, 2_000)
    .filter(({ route }) => {
      const key = routeGeometryKey(route);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  while (routes.length < requestedCount && candidates.length > 0) {
    let bestIndex = 0;
    let bestSeparation = -1;
    for (let index = 0; index < candidates.length; index++) {
      const separation = Math.min(...routes.map((selected) => routeSeparationNm(selected, candidates[index].route)));
      if (separation > bestSeparation) {
        bestIndex = index;
        bestSeparation = separation;
      }
    }
    if (bestSeparation < MIN_SHARED_ALTERNATIVE_SEPARATION_NM) break;
    routes.push(candidates.splice(bestIndex, 1)[0].route);
  }
  return routes;
}

function routeSeparationNm(a: RoutePoint[], b: RoutePoint[]): number {
  const samples = Math.min(12, Math.max(2, Math.min(a.length, b.length)));
  let total = 0;
  for (let sample = 1; sample < samples - 1; sample++) {
    const fraction = sample / (samples - 1);
    const pointA = a[Math.round(fraction * (a.length - 1))];
    const pointB = b[Math.round(fraction * (b.length - 1))];
    total += haversineNM(pointA.lat, pointA.lon, pointB.lat, pointB.lon);
  }
  return total / Math.max(1, samples - 2);
}

// Farthest-from-start dominance: within each bearing sector keep the two candidates
// that have travelled the greatest distance from the original start (BUG-45).
// Keeping two per sector instead of one allows a channel-threading path and an
// open-water escape in the same 1° sector to coexist — with single-survivor selection
// the farther (open-water) point always won, silently discarding the channel path.
// OpenCPN uses topologically correct closed-contour merging instead; top-2 is a
// deliberate simplification that fixes the immediate failure mode (D16). The full
// closed-contour merge remains a candidate for a future sprint if top-2 proves
// insufficient.
// g+h (A*) was attempted but fails here because all step-N candidates share the
// same g value (wind.times[N]), reducing g+h to min-h = min haversine-to-destination.
// For routes requiring a southward detour (e.g. Öresund), min-h prefers near-start
// points (smaller haversine) over correctly advancing south-going points, pinning
// the frontier near the start indefinitely (D13, BUG-37).
// Frontier escape (escaped points are farthest from start) is prevented by the GRIB
// domain boundary check applied before candidates enter this function.
// Returns the point in `points` closest to `target` by haversine distance.
function closestTo<T extends { lat: number; lon: number }>(points: T[], target: { lat: number; lon: number }): T {
  return points.reduce((best, p) =>
    haversineNM(p.lat, p.lon, target.lat, target.lon) < haversineNM(best.lat, best.lon, target.lat, target.lon)
      ? p
      : best,
  );
}

// includeEnd=true appends the destination as the final waypoint (normal arrival).
// includeEnd=false omits it (partial route — boat never reached destination).
function backtrack(
  arrived: IsochronePoint,
  wind: WindProvider,
  includeEnd: boolean,
  end?: { lat: number; lon: number },
): RoutePoint[] {
  const route: RoutePoint[] = [];

  if (includeEnd && end) {
    const distanceNm = haversineNM(arrived.lat, arrived.lon, end.lat, end.lon);
    const boatSpeed = arrived.boatSpeed ?? 0;
    if (boatSpeed <= 0) throw new Error('Cannot time the final arrival leg without a positive boat speed');
    const arrivalTime = new Date(arrived.time.getTime() + (distanceNm / boatSpeed) * 3_600_000);
    const resampled = wind.getWind(end.lat, end.lon, nearestIdx(wind.times, arrivalTime));
    const resampledWindDir = windDirection(resampled.u, resampled.v);
    const heading = bearingTo(arrived.lat, arrived.lon, end.lat, end.lon);
    route.unshift({
      lat: end.lat,
      lon: end.lon,
      time: arrivalTime,
      heading,
      twa: trueWindAngle(heading, resampledWindDir),
      tws: windSpeedKnots(resampled.u, resampled.v),
      boatSpeed,
      propulsion: arrived.propulsion,
      windDir: resampledWindDir,
      legCalcMs: 0,
      waveHeight: wind.getWave(end.lat, end.lon, arrivalTime),
      gribFilePath: arrived.gribFilePath,
    });
  }

  let cur: IsochronePoint | undefined = arrived;
  while (cur) {
    // Resample wind at each waypoint's own position and time (BUG-134).
    // The stored tws/windDir come from the parent point's position at the
    // current step — one position and one time step earlier. Resampling
    // gives the actual wind at the displayed waypoint position.
    const resampled = wind.getWind(cur.lat, cur.lon, nearestIdx(wind.times, cur.time));
    const resampledWindDir = windDirection(resampled.u, resampled.v);
    route.unshift({
      lat: cur.lat,
      lon: cur.lon,
      time: cur.time,
      heading: cur.heading,
      twa: cur.parent === undefined ? 0 : trueWindAngle(cur.heading, resampledWindDir),
      tws: windSpeedKnots(resampled.u, resampled.v),
      boatSpeed: cur.boatSpeed,
      propulsion: cur.propulsion,
      windDir: resampledWindDir,
      legCalcMs: cur.stepCalcMs,
      waveHeight: wind.getWave(cur.lat, cur.lon, cur.time),
      gribFilePath: cur.gribFilePath,
    });
    cur = cur.parent;
  }

  return route;
}
