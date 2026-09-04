import { readFileSync } from 'node:fs';

const events = readFileSync(process.argv[2] ?? 'artifacts/camp-placement/events.jsonl', 'utf8')
  .trim().split('\n').flatMap(line => JSON.parse(line));
let run = [];
for (const event of events) {
  if (event.name === 'startup-probe-installed') run = [];
  run.push(event);
  if (event.name !== 'startup-ready') continue;
  const renders = run.filter(e => e.name === 'startup-render' && Object.values(e.resources).some(n => n > 0));
  console.log(JSON.stringify({
    variant: event.variant ?? 'unlabeled', viewport: event.viewport,
    firstPlayableMs: event.startup.firstPlayableMs,
    terrainSource: event.startup.terrainSource,
    vegetationReadyMs: event.startup.vegetationReadyMs,
    assets: event.startup.firstPlayableAssets, resources: event.resources,
    renders: renders.map(e => ({ ms: e.duration, resources: e.resources })),
    longestTasks: run.filter(e => e.name === 'startup-long-task')
      .sort((a, b) => b.duration - a.duration).slice(0, 5)
      .map(e => ({ ms: e.duration, stage: e.stage })),
  }));
}
