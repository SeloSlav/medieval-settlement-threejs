import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const uri = process.env.REALM_TEST_URI || 'http://127.0.0.1:3100';
const database = process.env.REALM_TEST_DB || 'city-builder-realm-loadtest';
if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(uri).hostname)) throw Error('Local inspection only');
const { token } = JSON.parse(readFileSync('.tmp-realm-publisher/identity.json', 'utf8'));
async function request(path, body) {
  const response = await fetch(`${uri}/v1/database/${database}/${path}`, {
    method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}` }, body,
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw Error(`Inspection failed: ${response.status}`);
  return response.text();
}
const logs = await request('logs?num_lines=1200'), phases = new Map(), deliveryLaborPhases = [];
let firstTimestamp = Infinity, lastTimestamp = 0;
for (const line of logs.split('\n')) {
  if (!line.trim()) continue;
  const entry = JSON.parse(line);
  const labor = /^Cart labor cache phase: (\d+) lookups, (\d+) scanned rows$/.exec(entry.message);
  if (labor) deliveryLaborPhases.push({ atMicros: entry.ts, lookups: Number(labor[1]), scannedRows: Number(labor[2]) });
  const match = /^Timing span "([^"]+)": ([\d.]+)(ns|µs|ms|s)$/.exec(entry.message);
  if (!match) continue;
  const milliseconds = Number(match[2]) * ({ ns: .000001, 'µs': .001, ms: 1, s: 1000 }[match[3]]);
  const values = phases.get(match[1]) ?? []; values.push(milliseconds); phases.set(match[1], values);
  firstTimestamp = Math.min(firstTimestamp, entry.ts); lastTimestamp = Math.max(lastTimestamp, entry.ts);
}
const summaries = [...phases].map(([phase, values]) => {
  values.sort((a, b) => a - b);
  return { phase, count: values.length, meanMs: values.reduce((a, b) => a + b, 0) / values.length,
    p95Ms: values[Math.min(values.length - 1, Math.floor(values.length * .95))], maxMs: values.at(-1) };
}).sort((a, b) => b.meanMs - a.meanMs);
const [{ rows: [[tick, lastWall]] }] = JSON.parse(await request('sql',
  'SELECT world_config.sim_tick, realm_clock.last_wall_micros FROM world_config JOIN realm_clock ON world_config.id = realm_clock.id'));
const lagMs = Date.now() - lastWall / 1000;
const counts = {};
for (const table of ['building', 'residence', 'delivery_trip', 'corpse', 'graveyard', 'farm_field', 'pasture']) {
  const [{ rows }] = JSON.parse(await request('sql', `SELECT id FROM ${table}`)); counts[table] = rows.length;
}
const report = { atUtc: new Date().toISOString(), tick, lagMs,
  logSpanSeconds: (lastTimestamp - firstTimestamp) / 1e6, counts, phases: summaries, deliveryLaborPhases };
mkdirSync('artifacts', { recursive: true });
writeFileSync(process.env.REALM_PHASE_OUTPUT || 'artifacts/realm-phase-report.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
