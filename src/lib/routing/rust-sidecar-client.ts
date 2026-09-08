import { randomUUID } from 'node:crypto';
import { createConnection } from 'node:net';
import { createInterface } from 'node:readline';

import type { RoutePoint } from '../../types';
import {
  RUST_SIDECAR_PROTOCOL_VERSION,
  type RustCalculatePayload,
  type RustSidecarCapabilities,
  type RustSidecarResponse,
} from './rust-sidecar-protocol';

export class RustSidecarError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'RustSidecarError';
  }
}

export class RustSidecarClient {
  constructor(
    private readonly socketPath: string,
    private readonly timeoutMs = 30_000,
  ) {}

  hello(): Promise<{ engineVersion: string; capabilities: RustSidecarCapabilities }> {
    return this.exchange<{ engineVersion: string; capabilities: RustSidecarCapabilities }>(
      { type: 'hello' },
      (message) =>
        message.type === 'hello'
          ? { done: true, value: { engineVersion: message.engineVersion, capabilities: message.capabilities } }
          : { done: false },
    );
  }

  calculate(
    payload: RustCalculatePayload,
    onProgress: (percent: number, frontier: Array<[number, number]>) => void = () => {},
  ): Promise<RoutePoint[]> {
    return this.calculateDetailed(payload, onProgress).then(({ route }) => route);
  }

  calculateDetailed(
    payload: RustCalculatePayload,
    onProgress: (percent: number, frontier: Array<[number, number]>) => void = () => {},
  ): Promise<{ route: RoutePoint[]; calculationMs: number }> {
    return this.exchange<{ route: RoutePoint[]; calculationMs: number }>(
      { type: 'calculate', ...payload },
      (message) => {
        if (message.type === 'progress') {
          onProgress(
            message.percent,
            message.frontier.map((point) => [point.lat, point.lon]),
          );
          return { done: false };
        }
        if (message.type !== 'result') return { done: false };
        return {
          done: true,
          value: {
            route: message.route.map(({ timeMs, ...point }) => ({ ...point, time: new Date(timeMs) })),
            calculationMs: message.calculationMs,
          },
        };
      },
    );
  }

  private exchange<T>(
    request: Record<string, unknown>,
    handle: (message: RustSidecarResponse) => { done: false } | { done: true; value: T },
  ): Promise<T> {
    const requestId = randomUUID();
    return new Promise<T>((resolve, reject) => {
      const socket = createConnection(this.socketPath);
      const lines = createInterface({ input: socket });
      let settled = false;
      const finish = (error?: Error, value?: T): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        lines.close();
        socket.destroy();
        if (error) reject(error);
        else resolve(value as T);
      };
      const timer = setTimeout(
        () => finish(new RustSidecarError(`Rust sidecar timed out after ${this.timeoutMs} ms`, 'timeout')),
        this.timeoutMs,
      );

      socket.once('connect', () => {
        socket.write(`${JSON.stringify({ ...request, protocolVersion: RUST_SIDECAR_PROTOCOL_VERSION, requestId })}\n`);
      });
      socket.once('error', (error) => finish(error));
      lines.once('error', (error) => finish(error));
      lines.on('line', (line) => {
        let message: RustSidecarResponse;
        try {
          message = JSON.parse(line) as RustSidecarResponse;
        } catch {
          finish(new RustSidecarError('Rust sidecar returned invalid JSON', 'invalid_response'));
          return;
        }
        if (message.protocolVersion !== RUST_SIDECAR_PROTOCOL_VERSION) {
          finish(new RustSidecarError('Rust sidecar protocol version mismatch', 'protocol_mismatch'));
          return;
        }
        // Each exchange owns a dedicated socket, so an error with requestId="unknown" is the
        // parse failure for this request and must not be ignored until the timeout fires.
        if (message.type === 'error') {
          finish(new RustSidecarError(message.message, message.code));
          return;
        }
        if (message.requestId !== requestId) return;
        const outcome = handle(message);
        if (outcome.done) finish(undefined, outcome.value);
      });
      lines.once('close', () => {
        if (!settled) finish(new RustSidecarError('Rust sidecar closed the connection before replying', 'connection_closed'));
      });
    });
  }
}
