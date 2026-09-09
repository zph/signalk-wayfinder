import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLandEdgeIndex } from '../landmask';
import {
  minimumShoreDistanceAlongSegmentNm,
  navigationConstraintViolation,
  segmentHasShoreClearance,
  segmentHasShoreClearanceWithEndpointAllowance,
  segmentStaysWithinShoreDistance,
} from '../navigation-safety';
import { LandPolygon } from '../../types';

const coast: LandPolygon = {
  bboxLatMin: 0,
  bboxLatMax: 2,
  bboxLonMin: 0,
  bboxLonMax: 1,
  exterior: new Float64Array([0, 0, 1, 0, 1, 2, 0, 2, 0, 0]),
};
const shoreline = buildLandEdgeIndex([coast]);

test('minimumShoreDistanceAlongSegmentNm measures a route corridor against shoreline edges', () => {
  const distance = minimumShoreDistanceAlongSegmentNm(shoreline, 0.5, 1.1, 1.5, 1.1, 20);
  assert.ok(distance !== undefined);
  assert.ok(Math.abs(distance - 6) < 0.1);
});

test('segmentHasShoreClearance rejects a leg inside the configured clearance', () => {
  assert.equal(segmentHasShoreClearance(shoreline, 0.5, 1.1, 1.5, 1.1, 5), true);
  assert.equal(segmentHasShoreClearance(shoreline, 0.5, 1.1, 1.5, 1.1, 7), false);
});

test('endpoint allowance permits a close departure but requires clearance after its approach zone', () => {
  const endpoints = {
    start: { lat: 0.5, lon: 1.001 },
    end: { lat: 1.8, lon: 2 },
  };
  assert.equal(segmentHasShoreClearanceWithEndpointAllowance(shoreline, 0.5, 1.001, 0.5, 1.005, 0.5, endpoints), true);
  assert.equal(segmentHasShoreClearanceWithEndpointAllowance(shoreline, 0.5, 1.001, 0.5, 1.01, 0.5, endpoints), true);
  assert.equal(
    segmentHasShoreClearanceWithEndpointAllowance(shoreline, 0.51, 1.001, 0.52, 1.001, 0.5, endpoints),
    false,
  );
});

test('adaptive departure uses narrow clearance until full clearance is established', () => {
  const endpoints = {
    start: { lat: 0.5, lon: 1.0001 },
    end: { lat: 1.8, lon: 2 },
    departureClearanceEstablished: false,
  };
  assert.equal(segmentHasShoreClearanceWithEndpointAllowance(shoreline, 0.5, 1.0001, 0.5, 1.002, 0.5, endpoints), true);
  assert.equal(segmentHasShoreClearanceWithEndpointAllowance(shoreline, 0.5, 1.002, 0.5, 1.01, 0.5, endpoints), true);
  assert.equal(
    segmentHasShoreClearanceWithEndpointAllowance(shoreline, 0.5, 1.01, 0.5, 1.002, 0.5, {
      ...endpoints,
      departureClearanceEstablished: true,
    }),
    false,
  );
});

test('segmentStaysWithinShoreDistance rejects a route too far offshore', () => {
  assert.equal(segmentStaysWithinShoreDistance(shoreline, 0.5, 1.1, 1.5, 1.1, 10), true);
  assert.equal(segmentStaysWithinShoreDistance(shoreline, 0.5, 1.5, 1.5, 1.5, 10), false);
});

test('shore distance includes the boundary of an interior water ring', () => {
  const harbor = buildLandEdgeIndex([
    {
      bboxLatMin: 0,
      bboxLatMax: 4,
      bboxLonMin: 0,
      bboxLonMax: 4,
      exterior: new Float64Array([0, 0, 4, 0, 4, 4, 0, 4, 0, 0]),
      interiors: [new Float64Array([1, 1, 3, 1, 3, 3, 1, 3, 1, 1])],
    },
  ]);
  const distance = minimumShoreDistanceAlongSegmentNm(harbor, 2, 2, 2, 2, 100);

  assert.ok(distance !== undefined);
  assert.ok(Math.abs(distance - 60) < 0.1);
});

test('navigationConstraintViolation fails closed when depth coverage is absent', () => {
  assert.equal(
    navigationConstraintViolation(
      shoreline,
      null,
      { minimumDepthM: 2, minimumShoreDistanceNm: 0, maximumOffshoreDistanceNm: 0 },
      0.5,
      1.1,
      1.5,
      1.1,
    ),
    'depth-unavailable',
  );
});
