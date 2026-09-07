import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateCalculateInput, isValidCoordinate } from '../validation';

test('BUG-92: lat=0 and lon=0 are accepted (not rejected as falsy)', () => {
  const result = validateCalculateInput({
    start: { lat: 0, lon: 0 },
    end: { lat: 1, lon: 1 },
    departureTime: '2024-01-01T00:00:00Z',
  });
  assert.deepStrictEqual(result, { valid: true });
});

test('BUG-92: isValidCoordinate accepts 0, rejects undefined/null/NaN/string', () => {
  assert.strictEqual(isValidCoordinate(0), true);
  assert.strictEqual(isValidCoordinate(-0), true);
  assert.strictEqual(isValidCoordinate(59.5), true);
  assert.strictEqual(isValidCoordinate(undefined), false);
  assert.strictEqual(isValidCoordinate(null), false);
  assert.strictEqual(isValidCoordinate(NaN), false);
  assert.strictEqual(isValidCoordinate('0'), false);
});

test('validateCalculateInput: rejects missing start', () => {
  const result = validateCalculateInput({ end: { lat: 1, lon: 1 }, departureTime: '2024-01-01' });
  assert.strictEqual(result.valid, false);
});

test('validateCalculateInput: rejects missing departureTime', () => {
  const result = validateCalculateInput({
    start: { lat: 0, lon: 0 },
    end: { lat: 1, lon: 1 },
  });
  assert.strictEqual(result.valid, false);
});

test('validateCalculateInput: rejects empty departureTime string', () => {
  const result = validateCalculateInput({
    start: { lat: 0, lon: 0 },
    end: { lat: 1, lon: 1 },
    departureTime: '',
  });
  assert.strictEqual(result.valid, false);
});

test('validateCalculateInput: accepts valid input with negative coordinates', () => {
  const result = validateCalculateInput({
    start: { lat: -33.45, lon: -70.66 },
    end: { lat: 0, lon: 0 },
    departureTime: '2024-06-15T12:00:00Z',
  });
  assert.deepStrictEqual(result, { valid: true });
});

test('validateCalculateInput: validates departure and passage constraint values', () => {
  const base = {
    start: { lat: 0, lon: 0 },
    end: { lat: 1, lon: 1 },
    departureTime: '2024-06-15T12:00:00Z',
  };
  assert.equal(validateCalculateInput({ ...base, departureTime: 'not-a-date' }).valid, false);
  assert.equal(validateCalculateInput({ ...base, options: { daylightOnly: 'yes' } }).valid, false);
  assert.equal(validateCalculateInput({ ...base, options: { maxHoursPerDay: 25 } }).valid, false);
  assert.deepEqual(validateCalculateInput({ ...base, options: { daylightOnly: true, maxHoursPerDay: 8 } }), {
    valid: true,
  });
});

test('validateCalculateInput: validates navigation safety constraint values', () => {
  const base = {
    start: { lat: 1, lon: 2 },
    end: { lat: 3, lon: 4 },
    departureTime: '2026-06-21T12:00:00Z',
  };
  assert.deepEqual(
    validateCalculateInput({
      ...base,
      options: { minimumDepthM: 2, minimumShoreDistanceNm: 0.5, maximumOffshoreDistanceNm: 20 },
    }),
    { valid: true },
  );
  assert.deepEqual(validateCalculateInput({ ...base, options: { minimumDepthM: -1 } }), {
    valid: false,
    error: 'options.minimumDepthM must be between 0 and 12000',
  });
  assert.deepEqual(validateCalculateInput({ ...base, options: { minimumShoreDistanceNm: 51 } }), {
    valid: false,
    error: 'options.minimumShoreDistanceNm must be between 0 and 50',
  });
});
