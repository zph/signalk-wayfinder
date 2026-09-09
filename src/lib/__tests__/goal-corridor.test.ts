import assert from 'node:assert/strict';
import test from 'node:test';

import type { CalculationRequest, LandPolygon } from '../../types';
import { buildLandEdgeIndex, segmentCrossesLandFast } from '../landmask';
import { buildGoalDirectedCorridor } from '../routing/goal-corridor';

const departureTime = '2026-09-09T00:00:00Z';
const constraints = { minimumDepthM: 0, minimumShoreDistanceNm: 0, maximumOffshoreDistanceNm: 0 };

function rectangle(west: number, south: number, east: number, north: number): LandPolygon {
  return {
    bboxLatMin: south,
    bboxLatMax: north,
    bboxLonMin: west,
    bboxLonMax: east,
    exterior: new Float64Array([west, south, east, south, east, north, west, north]),
  };
}

test('goal-directed corridor reaches open-water destination with a bounded A* search', () => {
  const request: CalculationRequest = {
    start: { lat: 38, lon: -122.3 },
    end: { lat: 37.8, lon: -122.3 },
    departureTime,
  };
  const progress: number[] = [];
  const corridor = buildGoalDirectedCorridor(null, null, request, undefined, { constraints }, (value) =>
    progress.push(value),
  );
  assert.deepEqual(corridor[0], { ...request.start, timeMs: Date.parse(departureTime) });
  assert.equal(corridor.at(-1)?.lat, request.end.lat);
  assert.equal(corridor.at(-1)?.lon, request.end.lon);
  assert.equal(progress.at(-1), 15);
  assert.ok(corridor.length < 40);
});

test('goal-directed corridor detours around land and never returns a crossing segment', () => {
  const land = buildLandEdgeIndex([rectangle(-122.31, 37.88, -122.29, 37.96)]);
  const request: CalculationRequest = {
    start: { lat: 38, lon: -122.3 },
    end: { lat: 37.84, lon: -122.3 },
    departureTime,
  };
  const corridor = buildGoalDirectedCorridor(
    land,
    null,
    request,
    { shorelineIndex: land, depthProvider: null },
    { constraints, gridStepNm: 0.5 },
    () => {},
  );
  assert.ok(corridor.some((point) => Math.abs(point.lon - request.start.lon) > 0.01));
  for (let index = 1; index < corridor.length; index++) {
    const previous = corridor[index - 1];
    const point = corridor[index];
    assert.equal(segmentCrossesLandFast(land, previous.lat, previous.lon, point.lat, point.lon), false);
  }
});

test('goal-directed corridor fails at its hard expansion budget instead of falling back', () => {
  const land = buildLandEdgeIndex([rectangle(-122.5, 37.7, -122.1, 37.95)]);
  const request: CalculationRequest = {
    start: { lat: 38, lon: -122.3 },
    end: { lat: 37.65, lon: -122.3 },
    departureTime,
  };
  assert.throws(
    () =>
      buildGoalDirectedCorridor(
        land,
        null,
        request,
        { shorelineIndex: land, depthProvider: null },
        { constraints, gridStepNm: 0.5, maximumExpansions: 100 },
        () => {},
      ),
    /No bounded chart-safe corridor found within 100 A\* expansions/,
  );
});
