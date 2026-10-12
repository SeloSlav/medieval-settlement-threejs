import assert from 'node:assert/strict';
import { QuarryLayout, type QuarrySite } from '../src/quarries/QuarryLayout.ts';
import { ClayDepositLayout, RICH_CLAY_DEPOSIT_RADIUS, type ClayDepositSite } from '../src/clay/ClayDepositLayout.ts';
import { MineralDepositLayout, type MineralDepositSite } from '../src/minerals/MineralDepositLayout.ts';
import { StaticFootprintIndex, ellipticalFootprintBounds } from '../src/utils/StaticFootprintIndex.ts';
import { createRealmWorldLayout } from '../src/multiplayer/realmWorldLayout.ts';

let seed = 7919;
const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
type Ellipse = { x: number; z: number; rotation: number; radiusX: number; radiusZ: number };
// Original full-scan rules are the reference; the test deliberately never
// uses the spatial index to decide which footprints contribute.
const radial = (x: number,z: number,s: Ellipse,scale = 1) => {
  const dx = x-s.x,dz = z-s.z,c = Math.cos(s.rotation),v = Math.sin(s.rotation);
  return Math.hypot((dx*c+dz*v)/(s.radiusX*scale),(-dx*v+dz*c)/(s.radiusZ*scale));
};
const smooth = (a: number,b: number,x: number) => {
  const t = Math.max(0,Math.min(1,(x-a)/(b-a))); return t*t*(3-2*t);
};
const stone = (x: number,z: number,s: QuarrySite,a: number,b: number) => 1-smooth(a,b,radial(x,z,s));
const deposit = (x: number,z: number,s: Ellipse,scale: number) => {
  const d = radial(x,z,s,scale); if (d >= 1) return 0; const t = 1-d; return t*t*(3-2*t);
};
const quarrySites: QuarrySite[] = Array.from({ length: 160 },(_,i) => ({
  x: (random()-.5)*12000,z: (random()-.5)*12000,rotation: random()*Math.PI*2,
  kind: i%3 ? 'small' : 'large',radiusX: 3+random()*110,radiusZ: 1+random()*28,pitDepth: 3+random()*12,
}));
// Put strongly rotated, overlapping footprints across negative cell borders.
quarrySites.push(...[0,1,2].map(i => ({ x: -128+i*.01,z: -256,rotation: .7+i,
  kind: 'large' as const,radiusX: 180,radiusZ: 7,pitDepth: i+1 })));
const claySites: ClayDepositSite[] = quarrySites.map((s,i) => ({ ...s,
  kind: i%2 ? 'ordinary' : 'rich',formation: 'inland_basin',radiusX: s.radiusX*.1,radiusZ: s.radiusZ*.1 }));
const mineralSites: MineralDepositSite[] = quarrySites.map((s,i) => ({ ...s,
  resource: i%2 ? 'iron' : 'salt',grade: i%3 ? 'ordinary' : 'rich',formation: 'bedrock' }));
const quarry = QuarryLayout.fromSerialized({ seed: 1,sites: quarrySites });
const clay = ClayDepositLayout.fromSites(1,claySites),mineral = MineralDepositLayout.fromSites(1,mineralSites);
const queries = Array.from({ length: 12000 },() => ({ x: (random()-.5)*12500,z: (random()-.5)*12500 }));
for (const s of [...quarrySites,...claySites]) {
  queries.push({ x: s.x,z: s.z });
  for (const scale of [1.02,1.06,1.08,1.12,1.16]) for (let i=0;i<12;i++) for (const e of [-1e-8,0,1e-8]) {
    const t = i*Math.PI/6,rx = Math.cos(t)*s.radiusX*(scale+e),rz = Math.sin(t)*s.radiusZ*(scale+e);
    queries.push({ x: s.x+rx*Math.cos(s.rotation)-rz*Math.sin(s.rotation),
      z: s.z+rx*Math.sin(s.rotation)+rz*Math.cos(s.rotation) });
  }
}
queries.push(...[{ x: NaN,z: 0 },{ x: Infinity,z: 0 },{ x: -Infinity,z: 0 }]);
for (const {x,z} of queries) {
  assert.equal(quarry.getPitDepression(x,z),quarrySites.reduce((v,s) => {
    const b = stone(x,z,s,.08,1.02); return b <= 0 ? v : Math.max(v,b*b*s.pitDepth);
  },0));
  assert.equal(quarry.getPadBlend(x,z),quarrySites.reduce((v,s) => Math.max(v,
    stone(x,z,s,s.kind==='large' ? .08 : .12,s.kind==='large' ? 1.06 : 1.08)),0));
  assert.equal(quarry.isBlockedForProps(x,z),quarrySites.some(s => stone(x,z,s,0,s.kind==='large' ? 1.04 : 1.06)>=.42));
  assert.equal(quarry.isBlockedForGrass(x,z),quarrySites.some(s => stone(x,z,s,0,s.kind==='large' ? 1.08 : 1.12)>=.28));
  assert.equal(clay.isBlockedForProps(x,z),claySites.some(s => deposit(x,z,s,1.08)>0));
  assert.equal(clay.isBlockedForGrass(x,z),claySites.some(s => deposit(x,z,s,1.16)>0));
  assert.equal(mineral.isBlockedForProps(x,z),mineralSites.some(s => deposit(x,z,s,1.08)>0));
  assert.equal(mineral.isBlockedForGrass(x,z),mineralSites.some(s => deposit(x,z,s,1.16)>0));
  assert.equal(clay.richnessAt(x,z),claySites.reduce((v,s) => {
    if (s.kind!=='rich') return v; const d = Math.hypot(x-s.x,z-s.z);
    if (d>=RICH_CLAY_DEPOSIT_RADIUS) return v; const t = 1-d/RICH_CLAY_DEPOSIT_RADIUS;
    return Math.max(v,t*t*(3-2*t));
  },0));
}
const realm = createRealmWorldLayout();
const positions = Array.from({length: 100000},() => ({ x: (random()-.5)*12288,z: (random()-.5)*12288 }));
const baseline = (x: number,z: number) => realm.quarryLayout.sites.some(s => stone(x,z,s,0,s.kind==='large' ? 1.04 : 1.06)>=.42)
  || realm.clayDepositLayout.sites.some(s => deposit(x,z,s,1.08)>0)
  || realm.mineralDepositLayout.sites.some(s => deposit(x,z,s,1.08)>0);
const indexed = (x: number,z: number) => realm.quarryLayout.isBlockedForProps(x,z)
  || realm.clayDepositLayout.isBlockedForProps(x,z) || realm.mineralDepositLayout.isBlockedForProps(x,z);
const measure = (sample: (x: number,z: number)=>boolean) => {
  let blocked = 0; const start = performance.now();
  for (const p of positions) blocked += Number(sample(p.x,p.z));
  return { ms: performance.now()-start,blocked };
};
const before = measure(baseline),after = measure(indexed);
assert.equal(after.blocked,before.blocked);
const index = new StaticFootprintIndex(realm.quarryLayout.sites,s => ellipticalFootprintBounds(s,1.12));
const candidates = positions.reduce((n,p) => n+index.at(p.x,p.z).length,0);
assert(candidates < positions.length*realm.quarryLayout.sites.length/100,'point work must scale with nearby deposits');
console.log(JSON.stringify({ passed: true,exactQueries: queries.length,realmQueries: positions.length,
  before,after,stoneCandidates: candidates,fullScanStoneCandidates: positions.length*realm.quarryLayout.sites.length }));
