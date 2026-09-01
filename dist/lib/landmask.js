"use strict";
// GSHHG land polygon indices: edge-tile index for segment-crossing checks, polygon grid for point-in-polygon.
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildLandEdgeIndex = buildLandEdgeIndex;
exports.segmentCrossesLandFast = segmentCrossesLandFast;
exports.isPointOnLand = isPointOnLand;
exports.buildLandIndex = buildLandIndex;
exports.segmentCrossesLand = segmentCrossesLand;
exports.segmentsIntersect = segmentsIntersect;
exports.segmentCrossesRing = segmentCrossesRing;
exports.pointInRing = pointInRing;
exports.polygonsInBbox = polygonsInBbox;
const EDGE_CELL_DEG = 0.1;
function edgeCellKey(latCell, lonCell) {
    // At 0.1° resolution, lat cells span −900..+900 and lon cells span −1800..+1800;
    // formula produces a unique non-negative integer key for each (lat, lon) cell pair.
    return (latCell + 900) * 3600 + (((lonCell % 3600) + 3600) % 3600);
}
function insertEdgeIntoCells(accum, lat1, lon1, lat2, lon2, pi, ei) {
    const D = EDGE_CELL_DEG;
    let latCell = Math.floor(lat1 / D);
    let lonCell = Math.floor(lon1 / D);
    const latEnd = Math.floor(lat2 / D);
    const lonEnd = Math.floor(lon2 / D);
    const push = (la, lo) => {
        const key = edgeCellKey(la, lo);
        let cell = accum.get(key);
        if (!cell) {
            cell = [];
            accum.set(key, cell);
        }
        cell.push(pi, ei);
    };
    push(latCell, lonCell);
    if (latCell === latEnd && lonCell === lonEnd)
        return;
    const dLat = lat2 - lat1;
    const dLon = lon2 - lon1;
    const sLat = dLat > 0 ? 1 : dLat < 0 ? -1 : 0;
    const sLon = dLon > 0 ? 1 : dLon < 0 ? -1 : 0;
    const tDLat = sLat !== 0 ? Math.abs(D / dLat) : Infinity;
    const tDLon = sLon !== 0 ? Math.abs(D / dLon) : Infinity;
    let tMLat;
    let tMLon;
    if (sLat > 0)
        tMLat = ((latCell + 1) * D - lat1) / dLat;
    else if (sLat < 0)
        tMLat = (latCell * D - lat1) / dLat;
    else
        tMLat = Infinity;
    if (sLon > 0)
        tMLon = ((lonCell + 1) * D - lon1) / dLon;
    else if (sLon < 0)
        tMLon = (lonCell * D - lon1) / dLon;
    else
        tMLon = Infinity;
    const maxSteps = Math.abs(latEnd - latCell) + Math.abs(lonEnd - lonCell); // Manhattan distance = max cell boundaries the segment can cross
    for (let s = 0; s < maxSteps; s++) {
        if (tMLat < tMLon) {
            tMLat += tDLat;
            latCell += sLat;
        }
        else {
            tMLon += tDLon;
            lonCell += sLon;
        }
        push(latCell, lonCell);
        if (latCell === latEnd && lonCell === lonEnd)
            break;
    }
}
function buildLandEdgeIndex(polygons) {
    const edgeAccum = new Map();
    const polyGrid = new Map();
    for (let pi = 0; pi < polygons.length; pi++) {
        const poly = polygons[pi];
        const ring = poly.exterior;
        const nv = ring.length >> 1;
        // 1° polygon grid — for isPointOnLand
        const latLo = Math.floor(poly.bboxLatMin);
        const latHi = Math.floor(poly.bboxLatMax);
        const lonLo = Math.floor(poly.bboxLonMin);
        const lonHi = Math.floor(poly.bboxLonMax);
        for (let la = latLo; la <= latHi; la++) {
            for (let lo = lonLo; lo <= lonHi; lo++) {
                const key = (la + 90) * 360 + (lo + 180);
                let cell = polyGrid.get(key);
                if (!cell) {
                    cell = [];
                    polyGrid.set(key, cell);
                }
                cell.push(pi);
            }
        }
        // 0.1° edge-tile grid — index each edge into every cell it crosses
        for (let ei = 0; ei < nv; ei++) {
            const lon1 = ring[ei * 2];
            const lat1 = ring[ei * 2 + 1];
            const ni = ei + 1 < nv ? ei + 1 : 0;
            insertEdgeIntoCells(edgeAccum, lat1, lon1, ring[ni * 2 + 1], ring[ni * 2], pi, ei);
        }
    }
    const edgeGrid = new Map();
    for (const [key, arr] of edgeAccum) {
        edgeGrid.set(key, new Uint32Array(arr));
    }
    return { polygons, edgeGrid, polyGrid };
}
// Checks whether the segment crosses any polygon edge in the index.
// Does NOT check whether endpoints are inside a polygon — call isPointOnLand separately for that.
// Allocation-free on the hot path; safe to call per candidate in the isochrone loop.
function segmentCrossesLandFast(index, lat1, lon1, lat2, lon2) {
    const D = EDGE_CELL_DEG;
    let latCell = Math.floor(lat1 / D);
    let lonCell = Math.floor(lon1 / D);
    const latEnd = Math.floor(lat2 / D);
    const lonEnd = Math.floor(lon2 / D);
    const dLat = lat2 - lat1;
    const dLon = lon2 - lon1;
    const sLat = dLat > 0 ? 1 : dLat < 0 ? -1 : 0;
    const sLon = dLon > 0 ? 1 : dLon < 0 ? -1 : 0;
    const tDLat = sLat !== 0 ? Math.abs(D / dLat) : Infinity;
    const tDLon = sLon !== 0 ? Math.abs(D / dLon) : Infinity;
    let tMLat;
    let tMLon;
    if (sLat > 0)
        tMLat = ((latCell + 1) * D - lat1) / dLat;
    else if (sLat < 0)
        tMLat = (latCell * D - lat1) / dLat;
    else
        tMLat = Infinity;
    if (sLon > 0)
        tMLon = ((lonCell + 1) * D - lon1) / dLon;
    else if (sLon < 0)
        tMLon = (lonCell * D - lon1) / dLon;
    else
        tMLon = Infinity;
    const maxCells = Math.abs(latEnd - latCell) + Math.abs(lonEnd - lonCell) + 1; // Manhattan distance + 1 to include the starting cell
    for (let step = 0; step < maxCells; step++) {
        const entries = index.edgeGrid.get(edgeCellKey(latCell, lonCell));
        if (entries) {
            for (let i = 0; i < entries.length; i += 2) {
                const pi = entries[i];
                const ei = entries[i + 1];
                const ring = index.polygons[pi].exterior;
                const nv = ring.length >> 1;
                const ni = ei + 1 < nv ? ei + 1 : 0;
                if (segmentsIntersect(lon1, lat1, lon2, lat2, ring[ei * 2], ring[ei * 2 + 1], ring[ni * 2], ring[ni * 2 + 1]))
                    return true;
            }
        }
        if (latCell === latEnd && lonCell === lonEnd)
            break;
        if (tMLat < tMLon) {
            tMLat += tDLat;
            latCell += sLat;
        }
        else {
            tMLon += tDLon;
            lonCell += sLon;
        }
    }
    return false;
}
// Returns true if (lat, lon) falls inside any land polygon.
// Uses the 1° polyGrid to find candidate polygons, then exact point-in-ring test.
function isPointOnLand(index, lat, lon) {
    const key = (Math.floor(lat) + 90) * 360 + (Math.floor(lon) + 180);
    const candidates = index.polyGrid.get(key);
    if (!candidates)
        return false;
    for (const pi of candidates) {
        const poly = index.polygons[pi];
        if (lat < poly.bboxLatMin || lat > poly.bboxLatMax)
            continue;
        if (lon < poly.bboxLonMin || lon > poly.bboxLonMax)
            continue;
        if (pointInRing(lat, lon, poly.exterior))
            return true;
    }
    return false;
}
function buildLandIndex(polygons) {
    const grid = new Map();
    for (let i = 0; i < polygons.length; i++) {
        const p = polygons[i];
        const latLo = Math.floor(p.bboxLatMin);
        const latHi = Math.floor(p.bboxLatMax);
        const lonLo = Math.floor(p.bboxLonMin);
        const lonHi = Math.floor(p.bboxLonMax);
        for (let la = latLo; la <= latHi; la++) {
            for (let lo = lonLo; lo <= lonHi; lo++) {
                const key = (la + 90) * 360 + (lo + 180);
                let cell = grid.get(key);
                if (!cell) {
                    cell = [];
                    grid.set(key, cell);
                }
                cell.push(i);
            }
        }
    }
    return { polygons, grid };
}
function segmentCrossesLand(index, lat1, lon1, lat2, lon2) {
    const latLo = Math.floor(Math.min(lat1, lat2));
    const latHi = Math.floor(Math.max(lat1, lat2));
    const lonLo = Math.floor(Math.min(lon1, lon2));
    const lonHi = Math.floor(Math.max(lon1, lon2));
    const seen = new Set();
    for (let la = latLo; la <= latHi; la++) {
        for (let lo = lonLo; lo <= lonHi; lo++) {
            const cell = index.grid.get((la + 90) * 360 + (lo + 180));
            if (!cell)
                continue;
            for (const idx of cell) {
                if (seen.has(idx))
                    continue;
                seen.add(idx);
                if (segmentHitsPoly(index.polygons[idx], lat1, lon1, lat2, lon2))
                    return true;
            }
        }
    }
    return false;
}
function segmentHitsPoly(poly, lat1, lon1, lat2, lon2) {
    // bbox quick-reject for the segment
    if (Math.max(lat1, lat2) < poly.bboxLatMin)
        return false;
    if (Math.min(lat1, lat2) > poly.bboxLatMax)
        return false;
    if (Math.max(lon1, lon2) < poly.bboxLonMin)
        return false;
    if (Math.min(lon1, lon2) > poly.bboxLonMax)
        return false;
    if (pointInRing(lat1, lon1, poly.exterior))
        return true;
    if (pointInRing(lat2, lon2, poly.exterior))
        return true;
    return segmentCrossesRing(lat1, lon1, lat2, lon2, poly.exterior);
}
// Parametric segment-segment intersection — exported for reuse by region checks.
function segmentsIntersect(x1, y1, x2, y2, x3, y3, x4, y4) {
    const d1x = x2 - x1, d1y = y2 - y1;
    const d2x = x4 - x3, d2y = y4 - y3;
    const cross = d1x * d2y - d1y * d2x;
    if (Math.abs(cross) < 1e-12)
        return false;
    const dx = x3 - x1, dy = y3 - y1;
    const t = (dx * d2y - dy * d2x) / cross;
    const u = (dx * d1y - dy * d1x) / cross;
    return t > 0 && t < 1 && u > 0 && u < 1;
}
// True when segment crosses any edge of a closed ring — exported for region checks.
function segmentCrossesRing(lat1, lon1, lat2, lon2, ring) {
    const n = ring.length >> 1;
    for (let i = 0, j = n - 1; i < n; j = i++) {
        if (segmentsIntersect(lon1, lat1, lon2, lat2, ring[j * 2], ring[j * 2 + 1], ring[i * 2], ring[i * 2 + 1]))
            return true;
    }
    return false;
}
// Ray-cast point-in-ring test — exported for region checks.
function pointInRing(lat, lon, ring) {
    const n = ring.length >> 1;
    let inside = false;
    for (let i = 0, j = n - 1; i < n; j = i++) {
        const xi = ring[i * 2]; // lon
        const yi = ring[i * 2 + 1]; // lat
        const xj = ring[j * 2];
        const yj = ring[j * 2 + 1];
        if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
            inside = !inside;
        }
    }
    return inside;
}
function polygonsInBbox(index, latMin, lonMin, latMax, lonMax) {
    const seen = new Set();
    const result = [];
    for (let lat = Math.floor(latMin); lat <= Math.floor(latMax); lat++) {
        for (let lon = Math.floor(lonMin); lon <= Math.floor(lonMax); lon++) {
            const key = (lat + 90) * 360 + (lon + 180);
            for (const idx of index.grid.get(key) ?? []) {
                if (!seen.has(idx)) {
                    seen.add(idx);
                    result.push(index.polygons[idx]);
                }
            }
        }
    }
    return result;
}
