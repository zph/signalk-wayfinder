// Minimal Signal K plugin app interface used by Sail Wayfinder.

export interface SignalKResourceEntry {
  id?: string;
  name?: string;
  feature?: { geometry?: any }; // eslint-disable-line @typescript-eslint/no-explicit-any -- GeoJSON geometry is arbitrarily shaped
  [key: string]: unknown;
}

export interface SignalKResourcesApi {
  listResources(
    category: string,
    params?: Record<string, unknown>,
  ): Promise<SignalKResourceEntry[] | Record<string, SignalKResourceEntry>>;
  setResource(category: string, id: string, resource: unknown): Promise<void>;
}

export interface SignalKApp {
  setPluginStatus(status: string): void;
  setPluginError(error: string): void;
  debug(message: string): void;
  getSelfPath?(path: string): unknown;
  savePluginConfig?(): Promise<void> | void;
  savePluginOptions?(configuration: object, callback?: (err?: Error) => void): void;
  resourcesApi?: SignalKResourcesApi;
  config?: { configPath?: string; port?: number; settings?: { port?: number } };
}
