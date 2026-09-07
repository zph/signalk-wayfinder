// Access policy for the small Sail Wayfinder API consumed by Binnacle.

import type { Router } from 'express';

export type RouteAccessLevel = 'readonly' | 'readwrite';
export type AccessScopedRouter = Pick<Router, 'get' | 'post' | 'put' | 'patch' | 'delete'>;
export interface PluginRouter extends Router {
  access(level: RouteAccessLevel): AccessScopedRouter;
}

export const BINNACLE_ROUTE_ACCESS = {
  capabilities: 'readonly',
  calculate: 'readwrite',
  status: 'readonly',
  cancel: 'readwrite',
  saveRoute: 'readwrite',
} as const;

export type BinnacleRoute = keyof typeof BINNACLE_ROUTE_ACCESS;

export function binnacleRoute(router: PluginRouter, route: BinnacleRoute): AccessScopedRouter {
  return router.access(BINNACLE_ROUTE_ACCESS[route]);
}
