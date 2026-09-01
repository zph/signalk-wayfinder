"use strict";
// Isochrone routing: time-optimal route search via iterative frontier expansion.
Object.defineProperty(exports, "__esModule", { value: true });
exports.IsochroneAlgorithm = exports.RoutingError = void 0;
const windprovider_1 = require("../windprovider");
const polar_1 = require("../polar");
const landmask_1 = require("../landmask");
const regions_1 = require("../regions");
const geo_1 = require("../geo");
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
function logStepTiming(t) {
    if (!process.env.DEBUG)
        return;
    console.log(`[isochrone] step=${t.step} frontier=${t.frontierSize} coneDisabled=${t.coneDisabledCount}/${t.frontierSize} candidates=${t.candidatesEvaluated}` +
        ` landChecks=${t.landChecksPerformed}` +
        ` wind=${t.windLookupMs.toFixed(1)}ms polar=${t.polarMs.toFixed(1)}ms` +
        ` land=${t.landCheckMs.toFixed(1)}ms prune=${t.pruningMs.toFixed(1)}ms` +
        ` total=${t.totalMs.toFixed(1)}ms`);
}
function logTimingSummary(timings) {
    if (!process.env.DEBUG)
        return;
    if (timings.length === 0)
        return;
    const fields = [
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
        const vals = timings.map((t) => t[f]);
        const total = vals.reduce((a, b) => a + b, 0);
        const min = Math.min(...vals);
        const max = Math.max(...vals);
        return `  ${f}: min=${min.toFixed(1)} max=${max.toFixed(1)} total=${total.toFixed(1)}`;
    });
    console.log(`[isochrone] summary over ${timings.length} steps:\n${lines.join('\n')}`);
}
// Structured routing failure — carries a machine-readable reason so the frontend
// can show the sailor a specific diagnostic rather than a generic error string.
class RoutingError extends Error {
    constructor(message, reason) {
        super(message);
        this.reason = reason;
        this.name = 'RoutingError';
    }
}
exports.RoutingError = RoutingError;
class IsochroneAlgorithm {
    constructor() {
        this.id = 'isochrone';
        this.name = 'Isochrone';
    }
    async calculate(wind, current, polar, edgeIndex, regionIndex, request, onProgress, options) {
        const headingStep = Number(options?.headingStep ?? DEFAULT_HEADING_STEP);
        const sectorSize = Number(options?.sectorSize ?? DEFAULT_SECTOR_SIZE);
        const minBoatSpeed = Number(options?.minBoatSpeed ?? DEFAULT_MIN_BOAT_SPEED);
        const arrivalRadiusNm = Number(options?.arrivalRadiusNm ?? DEFAULT_ARRIVAL_RADIUS_NM);
        const maxWindKn = Number(options?.maxWindKn ?? 0); // 0 = no limit
        const maxWaveM = Number(options?.maxWaveM ?? 0); // 0 = no limit
        const motorSpeedKn = Number(options?.motorSpeedKn ?? 0); // 0 = no motor
        const motorBelowKn = Number(options?.motorBelowKn ?? 0); // 0 = disabled
        const waitForWind = Boolean(options?.waitForWind ?? false);
        const configuredConeHalfAngle = Number(options?.coneHalfAngle ?? FINE_PASS_CONE_HALF_ANGLE);
        const coneDisableLookaheadNm = Number(options?.coneDisableLookaheadNm ?? CONE_DISABLE_LOOKAHEAD_NM);
        const maxHeadingChangeDeg = Number(options?.maxHeadingChange ?? MAX_HEADING_CHANGE);
        const { start, end } = request;
        const departureTime = new Date(request.departureTime);
        const startTimeIdx = (0, windprovider_1.nearestIdx)(wind.times, departureTime);
        const nSteps = wind.times.length - startTimeIdx - 1;
        if (nSteps <= 0)
            throw new Error('Departure time is at or after the end of the forecast data');
        const avoidIds = new Set(request.avoidRegionIds ?? []);
        // Nautical Safety Rule: hard error if start or destination is inside an avoided region.
        if (regionIndex && avoidIds.size > 0) {
            if ((0, regions_1.isPointInRegion)(regionIndex, avoidIds, start.lat, start.lon))
                throw new Error('Start point is inside an avoided region — move it to open water or unmark that region');
            if ((0, regions_1.isPointInRegion)(regionIndex, avoidIds, end.lat, end.lon))
                throw new Error('Destination is inside an avoided region — move it to open water or unmark that region');
        }
        const seedVec = wind.getWind(start.lat, start.lon, startTimeIdx);
        let isochrone = [
            {
                lat: start.lat,
                lon: start.lon,
                time: wind.times[startTimeIdx],
                heading: 0,
                twa: 0,
                tws: (0, geo_1.windSpeedKnots)(seedVec.u, seedVec.v),
                boatSpeed: undefined,
                windDir: (0, geo_1.windDirection)(seedVec.u, seedVec.v),
                stepCalcMs: 0,
                parent: undefined,
            },
        ];
        let arrived = null;
        const stepTimings = [];
        let stepsCompleted = 0;
        let lastFrontier = null;
        let lastRejectedByLand = 0;
        let lastRejectedByPolar = 0;
        let lastRejectedByGrib = 0;
        for (let step = startTimeIdx; step < wind.times.length - 1; step++) {
            const stepStart = performance.now();
            const nextTime = wind.times[step + 1];
            const dtHours = (nextTime.getTime() - wind.times[step].getTime()) / 3600000;
            const candidates = [];
            let windLookupMs = 0;
            let landCheckMs = 0;
            let candidatesEvaluated = 0;
            let landChecksPerformed = 0;
            let rejectedByPolar = 0;
            let rejectedByLand = 0;
            let rejectedByGrib = 0;
            let coneDisabledCount = 0;
            const t0frontier = performance.now();
            for (const point of isochrone) {
                if (edgeIndex && (0, landmask_1.isPointOnLand)(edgeIndex, point.lat, point.lon))
                    continue;
                if (regionIndex && avoidIds.size > 0 && (0, regions_1.isPointInRegion)(regionIndex, avoidIds, point.lat, point.lon))
                    continue;
                // Per-position bearing: cone axis points from this frontier point toward the destination,
                // not from the original start. A fixed start→end axis blocked Öresund transit headings
                // that were within 100° of the current-position bearing but >100° off the initial bearing.
                const pointToDestBearing = (0, geo_1.bearingTo)(point.lat, point.lon, end.lat, end.lon);
                const t0wind = performance.now();
                const windVec = wind.getWind(point.lat, point.lon, step);
                const gribFilePath = wind.getFilePathForPoint(point.lat, point.lon, step);
                windLookupMs += performance.now() - t0wind;
                const tws = (0, geo_1.windSpeedKnots)(windVec.u, windVec.v);
                const wdir = (0, geo_1.windDirection)(windVec.u, windVec.v);
                if (maxWindKn > 0 && tws > maxWindKn) {
                    rejectedByPolar++;
                    continue;
                }
                if (maxWaveM > 0) {
                    const wh = wind.getWave(point.lat, point.lon, wind.times[step]);
                    if (wh != null && wh > maxWaveM)
                        continue;
                }
                const distToDest = (0, geo_1.haversineNM)(point.lat, point.lon, end.lat, end.lon);
                const coneCheckEnd = distToDest <= coneDisableLookaheadNm
                    ? end
                    : (0, geo_1.destinationPoint)(point.lat, point.lon, coneDisableLookaheadNm, pointToDestBearing);
                const directPathBlockedByLand = edgeIndex !== null &&
                    (0, landmask_1.segmentCrossesLandFast)(edgeIndex, point.lat, point.lon, coneCheckEnd.lat, coneCheckEnd.lon);
                const directPathBlockedByRegion = regionIndex !== null &&
                    avoidIds.size > 0 &&
                    (0, regions_1.segmentCrossesRegion)(regionIndex, avoidIds, point.lat, point.lon, coneCheckEnd.lat, coneCheckEnd.lon);
                if (directPathBlockedByLand || directPathBlockedByRegion)
                    coneDisabledCount++;
                const coneHalfAngle = directPathBlockedByLand || directPathBlockedByRegion ? 180 : configuredConeHalfAngle;
                let waitCandidateAdded = false;
                for (let hdg = 0; hdg < 360; hdg += headingStep) {
                    const deviation = Math.abs(((hdg - pointToDestBearing + 180 + 360) % 360) - 180);
                    if (deviation > coneHalfAngle)
                        continue;
                    // Seed point (parent===undefined) has no meaningful prior heading — allow all cone-valid
                    // headings unconditionally on step 1 (BUG-44).
                    if (point.parent !== undefined) {
                        const delta = Math.abs(((hdg - point.heading + 180 + 360) % 360) - 180);
                        if (delta > maxHeadingChangeDeg)
                            continue;
                    }
                    let twa = (hdg - wdir + 360) % 360;
                    if (twa > 180)
                        twa = 360 - twa;
                    const polarSpeed = (0, polar_1.interpolateBoatSpeed)(polar, twa, tws);
                    // REQ-84: motor fires when polarSpeed < motorBelowKn threshold.
                    const effectiveSpeed = motorBelowKn > 0 && motorSpeedKn > 0 && polarSpeed < motorBelowKn ? motorSpeedKn : polarSpeed;
                    // REQ-82: below minimum → zero-speed gate before discard.
                    if (effectiveSpeed < minBoatSpeed) {
                        // REQ-83: stay in place for one candidate per frontier point; advancing time only.
                        if (waitForWind && !waitCandidateAdded) {
                            candidates.push({
                                lat: point.lat,
                                lon: point.lon,
                                time: nextTime,
                                heading: point.heading,
                                twa: point.twa,
                                tws,
                                boatSpeed: 0,
                                windDir: wdir,
                                stepCalcMs: 0,
                                gribFilePath,
                                parent: point,
                            });
                            waitCandidateAdded = true;
                        }
                        rejectedByPolar++;
                        continue;
                    }
                    candidatesEvaluated++;
                    const distNM = effectiveSpeed * dtHours;
                    const wt = (0, geo_1.destinationPoint)(point.lat, point.lon, distNM, hdg);
                    let newLat = wt.lat;
                    let newLon = wt.lon;
                    // Apply ocean current drift: water-track endpoint + current displacement over dtHours.
                    // Current is sampled at the frontier point (start of the step) in m/s.
                    // Cosine correction uses point.lat (original latitude) — not newLat which is
                    // already modified by the latitude drift (BUG-94).
                    if (current) {
                        const cur = current.getCurrent(point.lat, point.lon, nextTime);
                        const dtS = dtHours * 3600;
                        newLat += (cur.v * dtS) / (1852 * 60);
                        newLon += (cur.u * dtS) / (1852 * 60 * Math.cos(point.lat * geo_1.DEG_TO_RAD));
                    }
                    if (!wind.coversPointAtTime(newLat, newLon, step)) {
                        rejectedByGrib++;
                        continue;
                    } // discard candidates outside spatiotemporal GRIB domain (BUG-37, BUG-75)
                    if (edgeIndex) {
                        landChecksPerformed++;
                        const t0land = performance.now();
                        const blocked = (0, landmask_1.segmentCrossesLandFast)(edgeIndex, point.lat, point.lon, newLat, newLon);
                        landCheckMs += performance.now() - t0land;
                        if (blocked) {
                            rejectedByLand++;
                            continue;
                        }
                    }
                    if (regionIndex &&
                        avoidIds.size > 0 &&
                        (0, regions_1.segmentCrossesRegion)(regionIndex, avoidIds, point.lat, point.lon, newLat, newLon)) {
                        rejectedByLand++;
                        continue;
                    }
                    const newPoint = {
                        lat: newLat,
                        lon: newLon,
                        time: nextTime,
                        heading: hdg,
                        twa,
                        tws,
                        boatSpeed: effectiveSpeed,
                        windDir: wdir,
                        stepCalcMs: 0,
                        gribFilePath,
                        parent: point,
                    };
                    candidates.push(newPoint);
                    const distToEnd = (0, geo_1.haversineNM)(newLat, newLon, end.lat, end.lon);
                    if (distToEnd <= arrivalRadiusNm) {
                        if (!arrived || distToEnd < (0, geo_1.haversineNM)(arrived.lat, arrived.lon, end.lat, end.lon)) {
                            arrived = newPoint;
                        }
                    }
                }
            }
            const frontierLoopMs = performance.now() - t0frontier;
            const polarMs = Math.max(0, frontierLoopMs - windLookupMs - landCheckMs);
            const stepCalcMs = performance.now() - stepStart;
            for (const c of candidates)
                c.stepCalcMs = Math.round(stepCalcMs);
            if (arrived)
                break;
            lastRejectedByLand = rejectedByLand;
            lastRejectedByPolar = rejectedByPolar;
            lastRejectedByGrib = rejectedByGrib;
            const t0prune = performance.now();
            isochrone = pruneToFrontier(candidates, start.lat, start.lon, sectorSize);
            const pruningMs = performance.now() - t0prune;
            if (isochrone.length > 0)
                lastFrontier = isochrone;
            if (isochrone.length === 0) {
                const reason = lastRejectedByGrib > lastRejectedByLand && lastRejectedByGrib > lastRejectedByPolar
                    ? 'grib_exhausted'
                    : lastRejectedByLand > lastRejectedByPolar
                        ? 'land'
                        : 'wind';
                const reasonText = (r) => r === 'land'
                    ? 'land blocks all paths'
                    : r === 'grib_exhausted'
                        ? 'frontier reached GRIB boundary'
                        : 'wind too adverse or light';
                const counts = `(land: ${lastRejectedByLand}, wind: ${lastRejectedByPolar}, grib: ${lastRejectedByGrib})`;
                if (lastFrontier !== null) {
                    const closest = closestTo(lastFrontier, end);
                    const dist = Math.round((0, geo_1.haversineNM)(closest.lat, closest.lon, end.lat, end.lon));
                    return {
                        route: backtrack(closest, wind, false),
                        warning: `No reachable positions at step ${stepsCompleted + 1} (${reasonText(reason)}) ${counts} — partial route shown (${dist} nm from destination)`,
                    };
                }
                throw new RoutingError(`No reachable positions at step ${step - startTimeIdx + 1} — ${reasonText(reason)}${reason === 'wind' ? ' to make progress' : ''} ${counts}`, reason);
            }
            const timing = {
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
            const frontier = isochrone.map((p) => [p.lat, p.lon]);
            stepsCompleted++;
            onProgress(Math.round(((step - startTimeIdx + 1) / nSteps) * 100), frontier);
            await new Promise((resolve) => setImmediate(resolve)); // yield event loop so SSE progress events are flushed to the browser
        }
        logTimingSummary(stepTimings);
        if (!arrived) {
            if (isochrone.length > 0) {
                // Time steps exhausted with a live frontier — route extends past forecast coverage.
                const closest = closestTo(isochrone, end);
                const dist = Math.round((0, geo_1.haversineNM)(closest.lat, closest.lon, end.lat, end.lon));
                return {
                    route: backtrack(closest, wind, false),
                    warning: `Route extends past forecast coverage after ${stepsCompleted} steps — partial route shown (${dist} nm from destination)`,
                };
            }
            throw new RoutingError(`Destination not reached within forecast period after ${stepsCompleted} steps`, 'grib_exhausted');
        }
        return { route: backtrack(arrived, wind, true, end) };
    }
}
exports.IsochroneAlgorithm = IsochroneAlgorithm;
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
function closestTo(points, target) {
    return points.reduce((best, p) => (0, geo_1.haversineNM)(p.lat, p.lon, target.lat, target.lon) < (0, geo_1.haversineNM)(best.lat, best.lon, target.lat, target.lon)
        ? p
        : best);
}
function pruneToFrontier(candidates, startLat, startLon, sectorSize) {
    const sectors = new Map();
    for (const p of candidates) {
        const brng = (0, geo_1.bearingTo)(startLat, startLon, p.lat, p.lon);
        const sector = Math.floor((((brng % 360) + 360) % 360) / sectorSize);
        const dLat = p.lat - startLat;
        const dLon = (p.lon - startLon) * Math.cos(startLat * geo_1.DEG_TO_RAD); // cosine correction: longitude degrees are shorter than latitude degrees away from the equator
        const distSq = dLat * dLat + dLon * dLon;
        const existing = sectors.get(sector) ?? [];
        if (existing.length < 2) {
            existing.push({ point: p, distSq });
            sectors.set(sector, existing);
        }
        else {
            // Replace the closer of the two survivors if the new candidate is farther.
            const minIdx = existing[0].distSq <= existing[1].distSq ? 0 : 1;
            if (distSq > existing[minIdx].distSq)
                existing[minIdx] = { point: p, distSq };
        }
    }
    return [...sectors.values()].flatMap((arr) => arr.map((e) => e.point));
}
// includeEnd=true appends the destination as the final waypoint (normal arrival).
// includeEnd=false omits it (partial route — boat never reached destination).
function backtrack(arrived, wind, includeEnd, end) {
    const route = [];
    if (includeEnd && end) {
        route.unshift({
            lat: end.lat,
            lon: end.lon,
            time: arrived.time,
            heading: arrived.heading,
            twa: arrived.twa,
            tws: arrived.tws,
            boatSpeed: arrived.boatSpeed,
            windDir: arrived.windDir,
            legCalcMs: 0,
            waveHeight: wind.getWave(end.lat, end.lon, arrived.time),
            gribFilePath: arrived.gribFilePath,
        });
    }
    let cur = arrived;
    while (cur) {
        // Resample wind at each waypoint's own position and time (BUG-134).
        // The stored tws/windDir come from the parent point's position at the
        // current step — one position and one time step earlier. Resampling
        // gives the actual wind at the displayed waypoint position.
        const resampled = wind.getWind(cur.lat, cur.lon, (0, windprovider_1.nearestIdx)(wind.times, cur.time));
        route.unshift({
            lat: cur.lat,
            lon: cur.lon,
            time: cur.time,
            heading: cur.heading,
            twa: cur.twa,
            tws: (0, geo_1.windSpeedKnots)(resampled.u, resampled.v),
            boatSpeed: cur.boatSpeed,
            windDir: (0, geo_1.windDirection)(resampled.u, resampled.v),
            legCalcMs: cur.stepCalcMs,
            waveHeight: wind.getWave(cur.lat, cur.lon, cur.time),
            gribFilePath: cur.gribFilePath,
        });
        cur = cur.parent;
    }
    return route;
}
