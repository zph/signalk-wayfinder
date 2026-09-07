import assert from 'node:assert/strict';
import test from 'node:test';
import { advanceUnderwayBudget, isLegInDaylight, passageDayIndex, solarElevationDeg } from '../passage-constraints';

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
