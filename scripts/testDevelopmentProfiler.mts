import assert from 'node:assert/strict';
import { DevelopmentProfiler, type DevelopmentProfileContext } from '../src/performance/DevelopmentProfiler.ts';
import type { VisualGpuTimestampProfiler } from '../src/e2e/webGpuTimestampProfiler.ts';

const parse = (text: string | null) => {
  assert.ok(text?.startsWith('SELO_PROFILE_V1\n'));
  return JSON.parse(text.slice(text.indexOf('\n') + 1));
};
let clock = 1000;
const profiler = new DevelopmentProfiler(() => clock);
let context: DevelopmentProfileContext = {
  camera: { position: [0, 20, 20], target: [0, 0, 0], rotation: [0, 0, 0, 1], distance: 20, mode: 'orbit', navigating: false },
  tool: 'none', menuOpen: false, visible: true, gameSpeed: 1, world: { buildings: 1 },
};
const owner = {
  update() { clock += 6; },
  snapshot() { clock += 20; },
};
const originalUpdate = owner.update;
const originalSnapshot = owner.snapshot;
profiler.start({ metadata: { test: 'preceding-frame-alignment' }, toggles: { hidden: [] }, getContext: () => structuredClone(context) });
profiler.instrument(owner, 'update', 'people.update');
profiler.instrument(owner, 'snapshot', 'snapshot.apply');
clock = 1002;
profiler.beginFrame(1000, clock);
owner.update();
clock = 1012;
profiler.completeFrame(clock, { calls: 100, triangles: 2000 });
clock = 1020; owner.snapshot();
profiler.togglesChanged({ hidden: ['trees'] });
context = { ...context, camera: { ...context.camera, distance: 10, target: [4, 0, 0] }, tool: 'building:well' };
clock = 1104;
profiler.beginFrame(1100, clock);
owner.update();
clock = 1114;
profiler.completeFrame(clock, { calls: 40, triangles: 300 });
clock = 1117;
profiler.beginFrame(1116, clock);
const report = parse(profiler.stop());
assert.equal(report.summary.frames, 2, 'recording retains switch-adjacent frames and omits the final partial interval');
assert.equal(report.worstFrames[0].intervalMs, 100);
assert.equal(report.worstFrames[0].callbackCpuMs, 10);
assert.equal(report.worstFrames[0].cpuMsInclusive['people.update'], 6);
assert.equal(report.worstFrames[0].betweenCallbacksCpuMs, 20);
assert.equal(report.worstFrames[0].betweenCallbacksMsInclusive['snapshot.apply'], 20);
assert.equal(report.worstFrames[0].state, 0, 'the long interval belongs to the preceding full-tree frame');
assert.equal(report.worstFrames[0].renderer.calls, 100);
assert.equal(report.worstFrames[1].state, 1);
assert.equal(report.worstFrames[1].motion, 'zoom+pan');
assert.equal(report.worstFrames[1].context.tool, 'building:well');
assert.deepEqual(report.states[1].toggles.hidden, ['trees']);
assert.ok(report.events.some((event: {kind: string}) => event.kind === 'render-toggles'));
assert.equal(owner.update, originalUpdate);
assert.equal(owner.snapshot, originalSnapshot);
assert.equal(report.gpu.meanQueueSpanMs, null, 'CPU frame time is never reported as GPU timing');

profiler.start({ metadata: {}, toggles: { hidden: [] }, getContext: () => structuredClone(context) });
profiler.togglesChanged({ hidden: ['trees'] });
profiler.togglesChanged({ hidden: [] });
const repeated = parse(profiler.stop());
assert.equal(repeated.states.length, 2, 'repeat A/B toggles share state cohorts without losing the event timeline');
assert.equal(repeated.events.filter((event: {kind: string}) => event.kind === 'render-toggles').at(-1).data.state, 0);

// Mutable gameplay input must be captured at dispatch, while request wall time stays separate from CPU.
clock = 2000;
profiler.start({ metadata: {}, toggles: {}, getContext: () => structuredClone(context) });
let resolveAction!: () => void;
const promise = new Promise<void>(resolve => { resolveAction = resolve; });
const actions = { placeBuilding(_input: { x: number }) { return promise; } };
const originalAction = actions.placeBuilding;
profiler.instrumentAction(actions, 'placeBuilding');
const input = { x: 3 };
assert.equal(actions.placeBuilding(input), promise, 'instrumentation preserves the original promise identity');
input.x = 999;
clock = 2150; resolveAction(); await promise; await Promise.resolve();
const actionReport = parse(profiler.stop());
assert.equal(actionReport.events.find((event: {kind: string}) => event.kind === 'action-request').data.args[0].x, 3);
assert.equal(actionReport.events.find((event: {kind: string}) => event.kind === 'action-result').data.wallMs, 150);
assert.equal(actions.placeBuilding, originalAction);

// A delayed readback updates the same retained worst-frame record, without relabeling CPU as GPU.
clock = 3000;
let gpuResolved = false;
let gpuDisposed = false;
const gpu = {
  beginFrame: (raf: number) => ({ frameRafTimestampMs: raf, queryId: 1, slotIndex: 0 }),
  endFrame: () => {}, dispose: () => { gpuDisposed = true; }, getEvidence: () => ({ status: 'available' }),
  getFrameTiming: (raf: number) => ({ frameRafTimestampMs: raf, queryId: 1,
    status: gpuResolved ? 'available' : 'pending', durationMs: gpuResolved ? 7 : null, limitation: null }),
} as unknown as VisualGpuTimestampProfiler;
profiler.start({ metadata: {}, toggles: {}, gpu, getContext: () => structuredClone(context) });
profiler.beginFrame(3000, 3001); clock = 3010; profiler.completeFrame(clock, { calls: 10, triangles: 20 });
clock = 3100; profiler.beginFrame(3100, clock); profiler.completeFrame(clock + 2, { calls: 10, triangles: 20 });
gpuResolved = true;
clock = 3116; profiler.beginFrame(3116, clock);
const gpuReport = parse(profiler.stop());
assert.equal(gpuReport.worstFrames[0].gpu.durationMs, 7);
assert.equal(gpuReport.gpu.samples, 1);
assert.equal(gpuReport.gpu.evidence.span, 'application-callback-queue-bookends');
assert.equal(gpuDisposed, true);

// Long sessions coarsen the timeline, preserve global totals, and mark background gaps.
clock = 4000;
profiler.start({ metadata: {}, toggles: {}, getContext: () => structuredClone(context) });
for (let i = 0; i <= 300; i++) {
  clock = 4000 + i * 1000;
  if (i === 1) profiler.event('visibility', { visible: false });
  profiler.beginFrame(clock, clock); profiler.completeFrame(clock + 5, { calls: 1, triangles: 12 });
}
const longReport = parse(profiler.stop());
assert.equal(longReport.summary.frames, 300);
assert.equal(longReport.gameplay.frames, 299);
assert.ok(longReport.timeline.length <= 120);
assert.ok(longReport.timelineBucketMs > 1000);
assert.equal(longReport.timeline.reduce((sum: number, row: number[]) => sum + row[1], 0), 300);
assert.ok(longReport.worstFrames.some((frame: {backgroundGap: boolean}) => frame.backgroundGap));
console.log('Development profiler: preceding-frame alignment, toggle history, camera motion, CPU spans, action timing, GPU readback, cleanup, bounded timeline and visibility gaps passed.');
