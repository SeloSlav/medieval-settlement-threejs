import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const input = process.argv[2];
if (!input) throw Error('Usage: node scripts/summarizeBrowserFrameTrace.mjs <trace.json>');
const { traceEvents } = JSON.parse(readFileSync(input,'utf8'));
const threads = new Map(),processNames = new Map();
const thread = event => {
  const key = `${event.pid}:${event.tid}`;
  if (!threads.has(key)) threads.set(key,{pid:event.pid,tid:event.tid,name:'',events:[],stack:[]});
  return threads.get(key);
};
let first = Infinity,last = 0;
for (const event of traceEvents) {
  if (event.ph === 'M') {
    if (event.name === 'process_name') processNames.set(event.pid,event.args.name);
    if (event.name === 'thread_name') thread(event).name = event.args.name;
    continue;
  }
  if (event.ts === undefined) continue;
  first = Math.min(first,event.ts); last = Math.max(last,event.ts+(event.dur ?? 0));
  const owner = thread(event);
  if (event.ph === 'X') owner.events.push(event);
  else if (event.ph === 'B') owner.stack.push(event);
  else if (event.ph === 'E') {
    const start = owner.stack.pop();
    if (start) owner.events.push({...start,dur:event.ts-start.ts});
  }
}
const result = [...threads.values()].filter(owner => owner.events.length).map(owner => {
  const byName = new Map();
  const intervals = [];
  for (const event of owner.events) {
    if (!(event.dur >= 0)) continue;
    const item = byName.get(event.name) ?? {name:event.name,calls:0,totalMs:0,maxMs:0};
    item.calls++; item.totalMs += event.dur/1000; item.maxMs = Math.max(item.maxMs,event.dur/1000);
    byName.set(event.name,item); intervals.push([event.ts,event.ts+event.dur]);
  }
  intervals.sort((a,b)=>a[0]-b[0]);
  let end = -Infinity,busyUs = 0;
  for (const [start,finish] of intervals) {
    busyUs += Math.max(0,finish-Math.max(start,end)); end = Math.max(end,finish);
  }
  return {pid:owner.pid,tid:owner.tid,process:processNames.get(owner.pid),thread:owner.name,
    coveredEventMs:busyUs/1000,events:[...byName.values()].sort((a,b)=>b.totalMs-a.totalMs).slice(0,30)};
}).sort((a,b)=>b.coveredEventMs-a.coveredEventMs);
const report = {durationMs:(last-first)/1000,
  note:'coveredEventMs merges overlapping wall-clock intervals, including waits; it is not CPU utilization. Per-event totals can overlap nested events.',threads:result};
writeFileSync(join(dirname(input),'browser-frame-summary.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({...report,threads:result.slice(0,8)},null,2));
