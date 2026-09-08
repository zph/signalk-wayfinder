import assert from 'node:assert/strict';
import { test } from 'node:test';

import { NodeRoutingPhaseProfiler } from '../routing/node-phase-profiler';

const context = {
  attempt: 2,
  stage: 'fine',
  start: { lat: 1, lon: 2 },
  end: { lat: 3, lon: 4 },
  stepsAvailable: 12,
  headingStepDeg: 5,
  sectorSizeDeg: 1,
};

test('NodeRoutingPhaseProfiler is silent when disabled', () => {
  const lines: string[] = [];
  const profiler = new NodeRoutingPhaseProfiler(context, { enabled: false, emit: (line) => lines.push(line) });
  profiler.startStep(0, 1);
  profiler.record('wind', profiler.mark());
  profiler.endStep(2, 3);
  profiler.finish('complete');
  assert.deepEqual(lines, []);
});

test('NodeRoutingPhaseProfiler emits deterministic step and summary records', () => {
  const lines: string[] = [];
  let clock = 10;
  const profiler = new NodeRoutingPhaseProfiler(context, {
    enabled: true,
    emitSteps: true,
    emit: (line) => lines.push(line),
    now: () => clock,
  });

  profiler.startStep(4, 6);
  const windStarted = profiler.mark();
  clock += 2.5;
  profiler.record('wind', windStarted);
  const pruneStarted = profiler.mark();
  clock += 1.25;
  profiler.record('prune', pruneStarted);
  profiler.endStep(8, 40);
  clock += 0.75;
  profiler.finish('complete');
  profiler.finish('failed');

  assert.equal(lines.length, 2);
  const step = JSON.parse(lines[0].slice(lines[0].indexOf('{')));
  assert.deepEqual(
    { type: step.type, attempt: step.attempt, inputFrontier: step.inputFrontier, outputFrontier: step.outputFrontier },
    { type: 'step', attempt: 2, inputFrontier: 6, outputFrontier: 8 },
  );
  assert.equal(step.phasesMs.wind, 2.5);
  assert.equal(step.phasesMs.prune, 1.25);

  const summary = JSON.parse(lines[1].slice(lines[1].indexOf('{')));
  assert.equal(summary.totalCandidates, 40);
  assert.equal(summary.context.stage, 'fine');
  assert.equal(summary.peakFrontier, 8);
  assert.equal(summary.wallMs, 4.5);
  assert.equal(summary.measuredMs, 3.75);
  assert.equal(summary.unmeasuredMs, 0.75);
});
