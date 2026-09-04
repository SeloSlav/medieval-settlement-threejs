import { readFileSync } from 'node:fs';

const events = readFileSync(process.argv[2] ?? 'artifacts/camp-placement/events.jsonl', 'utf8')
  .trim().split('\n').flatMap(JSON.parse);
const runs = [];
for (const event of events) {
  if (event.name === 'probe-installed') runs.push([]);
  runs.at(-1)?.push(event);
}
const percentile = (values, fraction) => {
  const sorted = values.filter(Number.isFinite).toSorted((a, b) => a - b);
  return sorted.length ? +sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))].toFixed(2) : null;
};
for (const run of runs) {
  const timings = run.findLast(e => e.name === 'zoom-timings');
  if (!timings) continue;
  const manifest = run.findLast(e => e.name === 'zoom-manifest');
  console.log(JSON.stringify({ manifest, phases: [...new Set(timings.frames.map(f => f.phase))].map(phase => {
    const frames = timings.frames.filter(f => f.phase === phase);
    const resources = run.filter(e => e.name === 'render-resources' && e.phase === phase);
    const gpuResources = run.filter(e => e.name === 'zoom-gpu-resource' && e.phase === phase);
    const checkpoint = run.find(e => e.name === 'zoom-checkpoint' && e.phase === phase);
    const first = frames.slice(0, 10);
    return { phase, frames: frames.length,
      first10: { maxFrameGapMs: percentile(first.map(f => f.intervalMs), 1),
        maxCpuRenderMs: percentile(first.map(f => f.cpuMs), 1),
        maxGpuMs: percentile(first.map(f => f.gpu?.durationMs), 1) },
      p95FrameMs: percentile(frames.map(f => f.intervalMs), 0.95),
      maxFrameMs: percentile(frames.map(f => f.intervalMs), 1),
      p95GpuMs: percentile(frames.map(f => f.gpu?.durationMs), 0.95),
      shaders: resources.reduce((n, r) => n + r.shaders, 0)
        + gpuResources.filter(r => r.resource === 'createShaderModule').length,
      pipelines: resources.reduce((n, r) => n + r.pipelines, 0)
        + gpuResources.filter(r => r.resource !== 'createShaderModule').length,
      grassMaxUpdateMs: checkpoint?.grass.maxUpdateDurationMs,
      pendingSlots: checkpoint?.grass.pendingSlots,
      meshes: checkpoint?.meshes,
      newObjects: resources.flatMap(r => Object.keys(r.objects)),
    };
  }) }));
}
