import { readFileSync } from 'node:fs';

const profile = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const nodes = new Map(profile.nodes.map(node => [node.id, node]));
const parents = new Map();
for (const node of profile.nodes) for (const child of node.children || []) parents.set(child, node.id);
const self = new Map(), inclusive = new Map();
const key = node => `${node.callFrame.functionName || '(anonymous)'} ${node.callFrame.url.split('?')[0]}:${node.callFrame.lineNumber + 1}`;
for (let i = 0; i < (profile.samples?.length || 0); i++) {
  let id = profile.samples[i];
  const ms = profile.timeDeltas[i] / 1000;
  const name = key(nodes.get(id));
  self.set(name, (self.get(name) || 0) + ms);
  // A recursive function can appear many times on one stack. Count each
  // function/location once per sample, so its inclusive cost is not inflated.
  const seen = new Set();
  while (id) {
    const name = key(nodes.get(id));
    if (!seen.has(name)) inclusive.set(name, (inclusive.get(name) || 0) + ms);
    seen.add(name);
    id = parents.get(id);
  }
}
const top = costs => [...costs].sort((a, b) => b[1] - a[1]).slice(0, 25)
  .map(([location, ms]) => ({ ms: Math.round(ms * 100) / 100, location }));
console.log(JSON.stringify({ durationMs: (profile.endTime - profile.startTime) / 1000,
  self: top(self), inclusive: top(inclusive) }, null, 2));
