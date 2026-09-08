import assert from 'node:assert/strict';
import test from 'node:test';
import type { RoutePoint } from '../../types';
import {
  advanceUnderwayBudget,
  isLegInDaylight,
  passageDayIndex,
  routeUnderwayBudget,
  solarElevationDeg,
} from '../passage-constraints';

test('solar elevation distinguishes local noon and midnight', () => {
  assert.ok(solarElevationDeg(new Date('2026-06-21T12:00:00Z'), 51.5, 0) > 50);
  assert.ok(solarElevationDeg(new Date('2026-06-21T00:00:00Z'), 51.5, 0) < 0);
});

test('daylight legs require start, midpoint, and end to remain above the horizon', () => {
  const position = { lat: 51.5, lon: 0 };
  assert.equal(
    isLegInDaylight(new Date('2026-06-21T10:00:00Z'), new Date('2026-06-21T12:00:00Z'), position, position),
    true,
  );
  assert.equal(
    isLegInDaylight(new Date('2026-06-21T20:00:00Z'), new Date('2026-06-21T23:00:00Z'), position, position),
    false,
  );
});

test('passage days are anchored to the requested departure time', () => {
  const departure = new Date('2026-06-21T08:00:00Z');
  assert.equal(passageDayIndex(new Date('2026-06-22T07:59:00Z'), departure), 0);
  assert.equal(passageDayIndex(new Date('2026-06-22T08:00:00Z'), departure), 1);
});

test('underway budget rejects a leg that exceeds the daily limit', () => {
  const departure = new Date('2026-06-21T08:00:00Z');
  const result = advanceUnderwayBudget({
    start: departure,
    end: new Date('2026-06-21T14:00:00Z'),
    departure,
    currentDayIndex: 0,
    currentHoursToday: 4,
    maxHoursPerDay: 8,
    underway: true,
  });
  assert.equal(result.allowed, false);
});

test('waiting advances time without consuming the underway budget', () => {
  const departure = new Date('2026-06-21T08:00:00Z');
  const result = advanceUnderwayBudget({
    start: departure,
    end: new Date('2026-06-22T10:00:00Z'),
    departure,
    currentDayIndex: 0,
    currentHoursToday: 8,
    maxHoursPerDay: 8,
    underway: false,
  });
  assert.deepEqual(result, { allowed: true, passageDayIndex: 1, hoursToday: 0 });
});

test('route budget carries underway hours across required waypoint legs', () => {
  const departure = new Date('2026-06-21T08:00:00Z');
  const point = (hours: number, lat: number, boatSpeed: number): RoutePoint => ({
    lat,
    lon: 0,
    time: new Date(departure.getTime() + hours * 3_600_000),
    heading: 0,
    twa: 90,
    tws: 10,
    boatSpeed,
    propulsion: boatSpeed > 0 ? 'sail' : 'wait',
    windDir: 90,
    legCalcMs: 0,
  });
  const firstLeg = [point(0, 0, 0), point(5, 0.1, 5)];
  const firstBudget = routeUnderwayBudget(firstLeg, departure, 8);
  assert.deepEqual(firstBudget, { allowed: true, passageDayIndex: 0, hoursToday: 5 });

  const combined = [...firstLeg, point(9, 0.2, 5)];
  assert.equal(routeUnderwayBudget(combined, departure, 8).allowed, false);

  const withRest = [...firstLeg, point(24, 0.1, 0), point(27, 0.2, 5)];
  assert.deepEqual(routeUnderwayBudget(withRest, departure, 8), {
    allowed: true,
    passageDayIndex: 1,
    hoursToday: 3,
  });
});
