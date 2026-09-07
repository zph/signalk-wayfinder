// Resolves advisory vessel draft from configurable and standard Signal K self paths.

import type { SignalKApp } from './signalk-app';

export const STANDARD_DRAFT_PATHS = ['design.draft.current', 'design.draft.maximum', 'design.draft.minimum'] as const;

export interface VesselDraft {
  valueM: number;
  path: string;
}

function numericValue(value: unknown): number | undefined {
  const candidate =
    typeof value === 'object' && value !== null && 'value' in value ? (value as { value?: unknown }).value : value;
  return typeof candidate === 'number' && Number.isFinite(candidate) && candidate > 0 ? candidate : undefined;
}

export function resolveVesselDraft(
  app: SignalKApp,
  configuredPath?: string,
  fallbackToStandardPaths = true,
): VesselDraft | undefined {
  if (!app.getSelfPath) return undefined;
  const paths = [configuredPath, ...(fallbackToStandardPaths ? STANDARD_DRAFT_PATHS : [])].filter(
    (path, index, all): path is string => Boolean(path) && all.indexOf(path) === index,
  );
  for (const path of paths) {
    const valueM = numericValue(app.getSelfPath(path));
    if (valueM !== undefined) return { valueM, path };
  }
  return undefined;
}
