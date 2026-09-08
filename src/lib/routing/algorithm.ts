// RoutingAlgorithm interface — the contract all routing algorithm implementations must satisfy.

import {
  CurrentProvider,
  WindProvider,
  LandEdgeIndex,
  RegionIndex,
  PolarData,
  CalculationRequest,
  NavigationSafetyContext,
  RoutePoint,
} from '../../types';

export interface RoutingAlgorithm {
  readonly id: string;
  readonly name: string;
  calculate(
    wind: WindProvider,
    current: CurrentProvider | null,
    polar: PolarData,
    edgeIndex: LandEdgeIndex | null,
    regionIndex: RegionIndex | null,
    request: CalculationRequest,
    onProgress: (pct: number, frontier: Array<[number, number]>) => void,
    options?: Record<string, unknown>,
    navigationSafety?: NavigationSafetyContext,
  ): Promise<{ route: RoutePoint[]; warning?: string; alternatives?: RoutePoint[][] }>;
}
