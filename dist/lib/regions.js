"use strict";
// SignalK region avoidance: loads regions from resources/regions and checks segment/point against them.
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildRegionIndex = buildRegionIndex;
exports.validRegionUuids = validRegionUuids;
exports.segmentCrossesRegion = segmentCrossesRegion;
exports.isPointInRegion = isPointInRegion;
const landmask_1 = require("./landmask");
// Builds a RegionIndex from SignalK resource data.
// Accepts two formats:
//   - array of { id, name?, feature: { geometry } } — from app.resourcesApi.listResources()
//   - object keyed by UUID { "uuid": { name?, feature: { geometry } } } — from raw HTTP API
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- SignalK resource API returns untyped data
function buildRegionIndex(apiRegions) {
    const regions = new Map();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- GeoJSON geometry is arbitrarily shaped
    const entries = [];
    if (Array.isArray(apiRegions)) {
        for (const entry of apiRegions) {
            if (entry.id && entry.feature?.geometry)
                entries.push(entry);
        }
    }
    else if (apiRegions && typeof apiRegions === 'object') {
        for (const [uuid, entry] of Object.entries(apiRegions)) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- SignalK resource entry shape varies
            const e = entry;
            if (e?.feature?.geometry)
                entries.push({ id: uuid, name: e.name, feature: e.feature });
        }
    }
    for (const { id, feature } of entries) {
        const geo = feature.geometry;
        let rings = [];
        if (geo.type === 'Polygon') {
            rings = geo.coordinates;
        }
        else if (geo.type === 'MultiPolygon') {
            // Merge all polygons into a single ring set — treat multi-part as one region.
            for (const poly of geo.coordinates)
                rings.push(...poly);
        }
        let ringIdx = 0;
        for (const ringCoords of rings) {
            // ringCoords is [[lon,lat], [lon,lat], ...] — extract exterior ring only.
            const n = ringCoords.length;
            const exterior = new Float64Array(n * 2);
            let latMin = Infinity, latMax = -Infinity;
            let lonMin = Infinity, lonMax = -Infinity;
            for (let i = 0; i < n; i++) {
                const lon = ringCoords[i][0];
                const lat = ringCoords[i][1];
                exterior[i * 2] = lon;
                exterior[i * 2 + 1] = lat;
                if (lat < latMin)
                    latMin = lat;
                if (lat > latMax)
                    latMax = lat;
                if (lon < lonMin)
                    lonMin = lon;
                if (lon > lonMax)
                    lonMax = lon;
            }
            // Key format: always id__ringIdx for consistency across single and multi-ring regions.
            const key = `${id}__${ringIdx}`;
            regions.set(key, { bboxLatMin: latMin, bboxLatMax: latMax, bboxLonMin: lonMin, bboxLonMax: lonMax, exterior });
            ringIdx++;
        }
    }
    return { regions };
}
// Returns the set of UUID prefixes present in the index (for auto-clean of stale IDs).
function validRegionUuids(index) {
    const uuids = new Set();
    for (const key of index.regions.keys()) {
        const uuid = key.includes('__') ? key.split('__')[0] : key;
        uuids.add(uuid);
    }
    return uuids;
}
// Checks whether the segment (lat1,lon1)→(lat2,lon2) crosses any region whose UUID is in avoidIds.
function segmentCrossesRegion(index, avoidIds, lat1, lon1, lat2, lon2) {
    for (const [key, ring] of index.regions) {
        const uuid = key.includes('__') ? key.split('__')[0] : key;
        if (!avoidIds.has(uuid))
            continue;
        if (Math.max(lat1, lat2) < ring.bboxLatMin)
            continue;
        if (Math.min(lat1, lat2) > ring.bboxLatMax)
            continue;
        if (Math.max(lon1, lon2) < ring.bboxLonMin)
            continue;
        if (Math.min(lon1, lon2) > ring.bboxLonMax)
            continue;
        if ((0, landmask_1.segmentCrossesRing)(lat1, lon1, lat2, lon2, ring.exterior))
            return true;
    }
    return false;
}
// Returns true if (lat, lon) falls inside any region whose UUID is in avoidIds.
function isPointInRegion(index, avoidIds, lat, lon) {
    for (const [key, ring] of index.regions) {
        const uuid = key.includes('__') ? key.split('__')[0] : key;
        if (!avoidIds.has(uuid))
            continue;
        if (lat < ring.bboxLatMin || lat > ring.bboxLatMax)
            continue;
        if (lon < ring.bboxLonMin || lon > ring.bboxLonMax)
            continue;
        if ((0, landmask_1.pointInRing)(lat, lon, ring.exterior))
            return true;
    }
    return false;
}
