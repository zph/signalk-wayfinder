// Saves a computed route to SignalK resources/routes as a GeoJSON Feature.

import { RouteAlternativeSummary, RoutePoint, RouteQualityReport } from '../types';
import { haversineNM } from './geo';
import { SignalKApp } from './signalk-app';

export async function saveRoute(
  app: SignalKApp,
  route: RoutePoint[],
  name: string,
  quality?: RouteQualityReport,
  metadata?: {
    alternative?: RouteAlternativeSummary;
    vesselDraft?: { valueM: number; path: string };
  },
): Promise<string> {
  const uuid = crypto.randomUUID();

  const totalDistNM = route.slice(1).reduce((sum, p, i) => {
    return sum + haversineNM(route[i].lat, route[i].lon, p.lat, p.lon);
  }, 0);

  const resource = {
    name,
    description: `Isochrone route calculated by Sail Wayfinder`,
    distance: Math.round(totalDistNM * 1852), // SignalK stores distance in metres
    feature: {
      type: 'Feature' as const,
      geometry: {
        type: 'LineString' as const,
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
          ...(p.propulsion ? { propulsion: p.propulsion } : {}),
          legCalcMs: p.legCalcMs,
          ...(p.waveHeight !== undefined ? { waveHeight: Math.round(p.waveHeight * 100) / 100 } : {}),
          ...(p.gribFilePath !== undefined ? { gribFile: p.gribFilePath } : {}),
        })),
        ...(quality ? { wayfinderQuality: quality } : {}),
        ...(metadata?.alternative ? { wayfinderAlternative: metadata.alternative } : {}),
        ...(metadata?.vesselDraft ? { vesselDraft: metadata.vesselDraft } : {}),
      },
    },
  };

  if (!app.resourcesApi?.setResource) {
    throw new Error('SignalK resourcesApi is not available — requires SignalK server >= 2.0');
  }

  await app.resourcesApi.setResource('routes', uuid, resource);
  return uuid;
}
