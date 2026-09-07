import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BINNACLE_ROUTE_ACCESS,
  binnacleRoute,
  type PluginRouter,
  type RouteAccessLevel,
} from '../binnacle-route-access';

test('opens Binnacle reads to readonly clients and mutations to readwrite clients', () => {
  assert.deepEqual(BINNACLE_ROUTE_ACCESS, {
    capabilities: 'readonly',
    calculate: 'readwrite',
    status: 'readonly',
    cancel: 'readwrite',
    saveRoute: 'readwrite',
  });

  const requested: RouteAccessLevel[] = [];
  const scoped = {};
  const router = {
    access(level: RouteAccessLevel) {
      requested.push(level);
      return scoped;
    },
  } as unknown as PluginRouter;

  assert.equal(binnacleRoute(router, 'capabilities'), scoped);
  assert.equal(binnacleRoute(router, 'calculate'), scoped);
  assert.equal(binnacleRoute(router, 'status'), scoped);
  assert.equal(binnacleRoute(router, 'cancel'), scoped);
  assert.equal(binnacleRoute(router, 'saveRoute'), scoped);
  assert.deepEqual(requested, ['readonly', 'readwrite', 'readonly', 'readwrite', 'readwrite']);
});
