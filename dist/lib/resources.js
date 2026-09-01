"use strict";
// Saves a computed route to SignalK resources/routes as a GeoJSON Feature.
Object.defineProperty(exports, "__esModule", { value: true });
exports.saveRoute = saveRoute;
const geo_1 = require("./geo");
async function saveRoute(app, route, name) {
    const uuid = crypto.randomUUID();
    const totalDistNM = route.slice(1).reduce((sum, p, i) => {
        return sum + (0, geo_1.haversineNM)(route[i].lat, route[i].lon, p.lat, p.lon);
    }, 0);
    const resource = {
        name,
        description: `Isochrone route calculated by signalk-weather-routing`,
        distance: Math.round(totalDistNM * 1852), // SignalK stores distance in metres
        feature: {
            type: 'Feature',
            geometry: {
                type: 'LineString',
                coordinates: route.map((p) => [p.lon, p.lat]),
            },
            properties: {
                name,
                coordinatesMeta: route.map((p) => ({
                    name: p.time.toISOString(),
                    time: p.time.toISOString(),
                    windDir: Math.round(p.windDir),
                    heading: Math.round(p.heading),
                    twa: Math.round(p.twa),
                    tws: Math.round(p.tws * 10) / 10,
                    ...(p.boatSpeed !== undefined ? { boatSpeed: Math.round(p.boatSpeed * 10) / 10 } : {}),
                    legCalcMs: p.legCalcMs,
                    ...(p.waveHeight !== undefined ? { waveHeight: Math.round(p.waveHeight * 100) / 100 } : {}),
                    ...(p.gribFilePath !== undefined ? { gribFile: p.gribFilePath } : {}),
                })),
            },
        },
    };
    if (!app.resourcesApi?.setResource) {
        throw new Error('SignalK resourcesApi is not available — requires SignalK server >= 2.0');
    }
    await app.resourcesApi.setResource('routes', uuid, resource);
    return uuid;
}
