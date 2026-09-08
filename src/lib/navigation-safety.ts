import { DepthProvider, LandEdgeIndex } from '../types';
import { haversineNM } from './geo';

const EDGE_CELL_DEG = 0.1;
const NM_PER_DEG_LAT = 60;

export interface NavigationConstraints {
  minimumDepthM: number;
  minimumShoreDistanceNm: number;
  maximumOffshoreDistanceNm: number;
}

export type NavigationConstraintViolation =
  'depth-unavailable' | 'too-shallow' | 'too-close-to-shore' | 'too-far-offshore';

function edgeCellKey(latCell: number, lonCell: number): number {
  return (latCell + 900) * 3600 + (((lonCell % 3600) + 3600) % 3600);
}

function longitudeDelta(lon: number, reference: number): number {
  return ((lon - reference + 540) % 360) - 180;
}

function projectedPoint(lat: number, lon: number, referenceLat: number, referenceLon: number): [number, number] {
  return [
    longitudeDelta(lon, referenceLon) * NM_PER_DEG_LAT * Math.cos((referenceLat * Math.PI) / 180),
    (lat - referenceLat) * NM_PER_DEG_LAT,
  ];
}

function pointSegmentDistanceSquared(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  if (dx === 0 && dy === 0) return (px - ax) ** 2 + (py - ay) ** 2;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  const x = ax + t * dx;
  const y = ay + t * dy;
  return (px - x) ** 2 + (py - y) ** 2;
}

function orientation(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

function segmentsTouch(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
): boolean {
  const abC = orientation(ax, ay, bx, by, cx, cy);
  const abD = orientation(ax, ay, bx, by, dx, dy);
  const cdA = orientation(cx, cy, dx, dy, ax, ay);
  const cdB = orientation(cx, cy, dx, dy, bx, by);
  const epsilon = 1e-12;
  const onSegment = (px: number, py: number, qx: number, qy: number, rx: number, ry: number): boolean =>
    qx >= Math.min(px, rx) - epsilon &&
    qx <= Math.max(px, rx) + epsilon &&
    qy >= Math.min(py, ry) - epsilon &&
    qy <= Math.max(py, ry) + epsilon;
  if (Math.abs(abC) <= epsilon && onSegment(ax, ay, cx, cy, bx, by)) return true;
  if (Math.abs(abD) <= epsilon && onSegment(ax, ay, dx, dy, bx, by)) return true;
  if (Math.abs(cdA) <= epsilon && onSegment(cx, cy, ax, ay, dx, dy)) return true;
  if (Math.abs(cdB) <= epsilon && onSegment(cx, cy, bx, by, dx, dy)) return true;
  return abC > 0 !== abD > 0 && cdA > 0 !== cdB > 0;
}

function segmentDistanceSquared(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
): number {
  if (segmentsTouch(ax, ay, bx, by, cx, cy, dx, dy)) return 0;
  return Math.min(
    pointSegmentDistanceSquared(ax, ay, cx, cy, dx, dy),
    pointSegmentDistanceSquared(bx, by, cx, cy, dx, dy),
    pointSegmentDistanceSquared(cx, cy, ax, ay, bx, by),
    pointSegmentDistanceSquared(dx, dy, ax, ay, bx, by),
  );
}

function nearbyEdges(
  index: LandEdgeIndex,
  latMin: number,
  lonMin: number,
  latMax: number,
  lonMax: number,
): Array<[number, number, number]> {
  const edges: Array<[number, number, number]> = [];
  const seen = new Set<string>();
  const latCellMin = Math.max(-900, Math.floor(latMin / EDGE_CELL_DEG));
  const latCellMax = Math.min(899, Math.floor(latMax / EDGE_CELL_DEG));
  const lonCellMin = Math.floor(lonMin / EDGE_CELL_DEG);
  const lonCellMax = Math.floor(lonMax / EDGE_CELL_DEG);
  for (let latCell = latCellMin; latCell <= latCellMax; latCell++) {
    for (let lonCell = lonCellMin; lonCell <= lonCellMax; lonCell++) {
      const entries = index.edgeGrid.get(edgeCellKey(latCell, lonCell));
      if (!entries) continue;
      for (let i = 0; i < entries.length; i += 3) {
        const pair: [number, number, number] = [entries[i], entries[i + 1], entries[i + 2]];
        const key = `${pair[0]}:${pair[1]}:${pair[2]}`;
        if (!seen.has(key)) {
          seen.add(key);
          edges.push(pair);
        }
      }
    }
  }
  return edges;
}

export function minimumShoreDistanceAlongSegmentNm(
  index: LandEdgeIndex,
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
  searchDistanceNm: number,
): number | undefined {
  if (!(searchDistanceNm > 0)) return undefined;
  const referenceLat = (lat1 + lat2) / 2;
  const referenceLon = lon1;
  const latPad = searchDistanceNm / NM_PER_DEG_LAT;
  const cosLat = Math.max(0.01, Math.cos((referenceLat * Math.PI) / 180));
  const lonPad = searchDistanceNm / (NM_PER_DEG_LAT * cosLat);
  const lon2Relative = referenceLon + longitudeDelta(lon2, referenceLon);
  const edges = nearbyEdges(
    index,
    Math.min(lat1, lat2) - latPad,
    Math.min(referenceLon, lon2Relative) - lonPad,
    Math.max(lat1, lat2) + latPad,
    Math.max(referenceLon, lon2Relative) + lonPad,
  );
  if (edges.length === 0) return undefined;

  const [ax, ay] = projectedPoint(lat1, lon1, referenceLat, referenceLon);
  const [bx, by] = projectedPoint(lat2, lon2, referenceLat, referenceLon);
  let bestSquared = Infinity;
  for (const [polygonIndex, ringIndex, edgeIndex] of edges) {
    const polygon = index.polygons[polygonIndex];
    const ring = ringIndex === 0 ? polygon.exterior : polygon.interiors?.[ringIndex - 1];
    if (!ring) continue;
    const vertexCount = ring.length >> 1;
    const nextIndex = edgeIndex + 1 < vertexCount ? edgeIndex + 1 : 0;
    const [cx, cy] = projectedPoint(ring[edgeIndex * 2 + 1], ring[edgeIndex * 2], referenceLat, referenceLon);
    const [dx, dy] = projectedPoint(ring[nextIndex * 2 + 1], ring[nextIndex * 2], referenceLat, referenceLon);
    bestSquared = Math.min(bestSquared, segmentDistanceSquared(ax, ay, bx, by, cx, cy, dx, dy));
  }
  return Math.sqrt(bestSquared);
}

export function segmentHasShoreClearance(
  index: LandEdgeIndex,
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
  minimumDistanceNm: number,
): boolean {
  if (!(minimumDistanceNm > 0)) return true;
  const distance = minimumShoreDistanceAlongSegmentNm(index, lat1, lon1, lat2, lon2, minimumDistanceNm);
  return distance === undefined || distance >= minimumDistanceNm;
}

function pointIsWithinShoreDistance(
  index: LandEdgeIndex,
  lat: number,
  lon: number,
  maximumDistanceNm: number,
): boolean {
  const distance = minimumShoreDistanceAlongSegmentNm(index, lat, lon, lat, lon, maximumDistanceNm);
  return distance !== undefined && distance <= maximumDistanceNm;
}

export function segmentStaysWithinShoreDistance(
  index: LandEdgeIndex,
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
  maximumDistanceNm: number,
): boolean {
  if (!(maximumDistanceNm > 0)) return true;
  const lengthNm = haversineNM(lat1, lon1, lat2, lon2);
  const sampleCount = Math.max(1, Math.ceil(lengthNm / Math.min(2, maximumDistanceNm / 4)));
  const halfGapNm = lengthNm / sampleCount / 2;
  const conservativeLimitNm = maximumDistanceNm - halfGapNm;
  if (conservativeLimitNm <= 0) return false;
  for (let i = 0; i <= sampleCount; i++) {
    const fraction = i / sampleCount;
    const lat = lat1 + (lat2 - lat1) * fraction;
    const lon = lon1 + longitudeDelta(lon2, lon1) * fraction;
    if (!pointIsWithinShoreDistance(index, lat, lon, conservativeLimitNm)) return false;
  }
  return true;
}

export function navigationConstraintViolation(
  shorelineIndex: LandEdgeIndex | null,
  depthProvider: DepthProvider | null,
  constraints: NavigationConstraints,
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): NavigationConstraintViolation | undefined {
  if (
    constraints.minimumShoreDistanceNm > 0 &&
    (!shorelineIndex ||
      !segmentHasShoreClearance(shorelineIndex, lat1, lon1, lat2, lon2, constraints.minimumShoreDistanceNm))
  ) {
    return 'too-close-to-shore';
  }
  if (
    constraints.maximumOffshoreDistanceNm > 0 &&
    (!shorelineIndex ||
      !segmentStaysWithinShoreDistance(shorelineIndex, lat1, lon1, lat2, lon2, constraints.maximumOffshoreDistanceNm))
  ) {
    return 'too-far-offshore';
  }
  if (constraints.minimumDepthM > 0) {
    if (!depthProvider) return 'depth-unavailable';
    const depth = depthProvider.minimumDepthAlongSegment(lat1, lon1, lat2, lon2);
    if (depth === undefined) return 'depth-unavailable';
    if (depth < constraints.minimumDepthM) return 'too-shallow';
  }
  return undefined;
}
