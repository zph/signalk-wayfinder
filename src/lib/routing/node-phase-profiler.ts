import { performance } from 'node:perf_hooks';

export const NODE_ROUTING_PHASES = [
  'frontierGuard',
  'wind',
  'budget',
  'cone',
  'headingAndPolar',
  'current',
  'coverage',
  'daylight',
  'land',
  'safety',
  'region',
  'candidateAndArrival',
  'candidateStamp',
  'prune',
  'routeAssembly',
  'progress',
] as const;

export type NodeRoutingPhase = (typeof NODE_ROUTING_PHASES)[number];

export const NODE_ROUTING_COUNTERS = [
  'frontierPoints',
  'headingsConsidered',
  'polarCacheHits',
  'polarCacheMisses',
  'coneDisabled',
  'waitsAdded',
  'rejectedCone',
  'rejectedHeadingChange',
  'rejectedWindLimit',
  'rejectedWaveLimit',
  'rejectedMinSpeed',
  'rejectedCoverage',
  'rejectedCorridor',
  'rejectedDaylight',
  'rejectedLand',
  'rejectedSafety',
  'rejectedRegion',
  'acceptedCandidates',
  'arrivalCandidates',
] as const;

export type NodeRoutingCounter = (typeof NODE_ROUTING_COUNTERS)[number];

export interface NodeRoutingProfileContext {
  attempt: number;
  stage: string;
  routeDistanceNm: number;
  stepsAvailable: number;
  headingStepDeg: number;
  sectorSizeDeg: number;
}

interface StepProfile {
  step: number;
  inputFrontier: number;
  outputFrontier: number;
  candidates: number;
  phasesMs: Record<NodeRoutingPhase, number>;
  counters: Record<NodeRoutingCounter, number>;
}

type ProfileEmitter = (line: string) => void;

function emptyPhases(): Record<NodeRoutingPhase, number> {
  return Object.fromEntries(NODE_ROUTING_PHASES.map((phase) => [phase, 0])) as Record<NodeRoutingPhase, number>;
}

function emptyCounters(): Record<NodeRoutingCounter, number> {
  return Object.fromEntries(NODE_ROUTING_COUNTERS.map((counter) => [counter, 0])) as Record<NodeRoutingCounter, number>;
}

function roundedPhases(phases: Record<NodeRoutingPhase, number>): Record<NodeRoutingPhase, number> {
  return Object.fromEntries(NODE_ROUTING_PHASES.map((phase) => [phase, Number(phases[phase].toFixed(3))])) as Record<
    NodeRoutingPhase,
    number
  >;
}

export class NodeRoutingPhaseProfiler {
  readonly enabled: boolean;
  private readonly emitSteps: boolean;
  private readonly emit: ProfileEmitter;
  private readonly now: () => number;
  private readonly totals = emptyPhases();
  private readonly counterTotals = emptyCounters();
  private readonly startedAt: number;
  private current: StepProfile | null = null;
  private completedSteps = 0;
  private totalCandidates = 0;
  private peakFrontier = 0;
  private finished = false;

  constructor(
    private readonly context: NodeRoutingProfileContext,
    options: {
      enabled?: boolean;
      emitSteps?: boolean;
      emit?: ProfileEmitter;
      now?: () => number;
    } = {},
  ) {
    this.enabled = options.enabled ?? process.env.WAYFINDER_NODE_PROFILE === '1';
    this.emitSteps = options.emitSteps ?? process.env.WAYFINDER_NODE_PROFILE_STEPS === '1';
    this.emit = options.emit ?? ((line) => console.log(line));
    this.now = options.now ?? performance.now.bind(performance);
    this.startedAt = this.enabled ? this.now() : 0;
  }

  mark(): number {
    return this.enabled ? this.now() : 0;
  }

  record(phase: NodeRoutingPhase, startedAt: number): void {
    if (!this.enabled) return;
    const duration = this.now() - startedAt;
    this.totals[phase] += duration;
    if (this.current) this.current.phasesMs[phase] += duration;
  }

  increment(counter: NodeRoutingCounter, amount = 1): void {
    if (!this.enabled) return;
    this.counterTotals[counter] += amount;
    if (this.current) this.current.counters[counter] += amount;
  }

  startStep(step: number, inputFrontier: number): void {
    if (!this.enabled) return;
    this.current = {
      step,
      inputFrontier,
      outputFrontier: 0,
      candidates: 0,
      phasesMs: emptyPhases(),
      counters: emptyCounters(),
    };
    this.peakFrontier = Math.max(this.peakFrontier, inputFrontier);
  }

  endStep(outputFrontier: number, candidates: number): void {
    if (!this.enabled || !this.current) return;
    this.current.outputFrontier = outputFrontier;
    this.current.candidates = candidates;
    this.completedSteps++;
    this.totalCandidates += candidates;
    this.peakFrontier = Math.max(this.peakFrontier, outputFrontier);
    if (this.emitSteps) {
      this.emit(
        `[wayfinder-node-profile] ${JSON.stringify({
          type: 'step',
          attempt: this.context.attempt,
          ...this.current,
          phasesMs: roundedPhases(this.current.phasesMs),
        })}`,
      );
    }
    this.current = null;
  }

  finish(outcome: 'complete' | 'partial' | 'failed'): void {
    if (!this.enabled || this.finished) return;
    this.finished = true;
    const wallMs = this.now() - this.startedAt;
    const measuredMs = NODE_ROUTING_PHASES.reduce((sum, phase) => sum + this.totals[phase], 0);
    this.emit(
      `[wayfinder-node-profile] ${JSON.stringify({
        type: 'summary',
        outcome,
        context: this.context,
        completedSteps: this.completedSteps,
        totalCandidates: this.totalCandidates,
        peakFrontier: this.peakFrontier,
        wallMs: Number(wallMs.toFixed(3)),
        measuredMs: Number(measuredMs.toFixed(3)),
        unmeasuredMs: Number(Math.max(0, wallMs - measuredMs).toFixed(3)),
        phasesMs: roundedPhases(this.totals),
        counters: this.counterTotals,
      })}`,
    );
  }
}
