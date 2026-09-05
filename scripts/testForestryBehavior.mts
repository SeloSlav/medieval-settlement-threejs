import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { ForestManager } from '../src/props/ForestManager.ts';
import { createStubForestInstances } from '../src/props/forestInstanceStub.ts';
import { TimberLogVisuals, registerTimberLogMaterials } from '../src/forestry/TimberLogVisuals.ts';
import { treeFallAngle, timberLogDimensions } from '../src/forestry/forestry.ts';
import { collectWorkerTargets, pickWorkerWalkPlan } from '../src/settlement/workerPaths.ts';
import { ForestryAudio } from '../src/audio/ForestryAudio.ts';
import type { BuildingState, TreeEntityState } from '../src/resources/types.ts';

const placement = { x: 20, z: 24, scale: 1.2, species: 'beech', form: 'broad' } as const;
assert.equal(treeFallAngle(-1), 0);
assert.equal(treeFallAngle(2), Math.PI/2);
assert.ok(treeFallAngle(0.8)-treeFallAngle(0.7) > treeFallAngle(0.3)-treeFallAngle(0.2));
assert.notDeepEqual(timberLogDimensions(placement), timberLogDimensions({...placement,species:'silverFir'}));
const root = new THREE.Group();
const material = new THREE.MeshBasicMaterial();
const forest = createStubForestInstances([placement]);
const manager = new ForestManager(root, forest, {group:new THREE.Group(),instances:[]}, null, [],
  {mesh:{material},getHeightAt:()=>0} as never, ()=>{});
const camera = new THREE.PerspectiveCamera();
const bounds = { minX:-100,maxX:100,minZ:-100,maxZ:100 };
const phase = (phase: TreeEntityState['phase'], harvestProgress=0) => manager.applyTreePhases([
  {layoutIndex:0,phase,harvestProgress,growthProgress:phase==='mature'?1:0},
]);
phase('fallen'); manager.updateCameraState(camera,20,false,bounds);
assert.deepEqual(manager.drainForestrySoundEvents(), [], 'joining an already fallen tree is silent');
phase('mature'); phase('falling');
assert.deepEqual(manager.drainForestrySoundEvents().map(e=>e.kind), ['fall']);
phase('falling',0.5); manager.updateCameraState(camera,20,false,bounds,false,0.1);
assert.deepEqual(manager.drainForestrySoundEvents(), []);
phase('fallen');
for(let i=0;i<40;i++) manager.updateCameraState(camera,20,false,bounds,false,1/60);
assert.deepEqual(manager.drainForestrySoundEvents().map(e=>e.kind), ['impact']);
phase('fallen'); manager.updateCameraState(camera,20,false,bounds);
assert.deepEqual(manager.drainForestrySoundEvents(), [], 'snapshots never replay impact');
manager.dispose();

const bark = new THREE.MeshStandardMaterial({color:0x665544});
const cut = new THREE.MeshStandardMaterial({color:0xccaa77});
registerTimberLogMaterials('beech',[bark,cut,cut]);
const logs = new TimberLogVisuals((x,z)=>x*0.02+z*0.04);
const stock = {x:22,z:26,health:40,maxHealth:40,firewood:0};
logs.sync(0,placement,[stock]);
const full = logs.group.children[0].children[0] as THREE.Mesh;
const fullLength = full.scale.y;
assert.equal((full.material as THREE.Material[])[0],bark);
assert.equal((full.material as THREE.Material[])[1],cut);
logs.sync(0,placement,[{...stock,health:20,firewood:4}]);
const half = logs.group.children[0].children[0] as THREE.Mesh;
assert.equal(half.scale.y,fullLength/2);
assert.equal(logs.group.children[0].children.length,5,'remaining raw log plus four cut pieces');
assert.ok(half.position.y > 0.5,'trunk follows ground height');
logs.sync(0,placement,[]); assert.equal(logs.group.children.length,0);
logs.dispose();

const camp = {id:'camp',kind:'lumber_mill',x:0,z:0,workRadius:60,assignedLabor:2,constructionComplete:true} as BuildingState;
const trees = new Map<string,TreeEntityState>([['cut',{treeId:'cut',layoutIndex:0,phase:'falling',growthProgress:0}],
  ['standing',{treeId:'standing',layoutIndex:1,phase:'mature',growthProgress:1}]]);
const inputs = {trees,treeRegistry:{treesInRadius:()=>[
  {id:'cut',layoutIndex:0,x:20,z:24},{id:'standing',layoutIndex:1,x:30,z:24},
]},quarries:[],foragingNodes:[],farmFields:[],pastures:[]} as never;
assert.equal(collectWorkerTargets(camp,inputs).length,0,'stand clear during the fall');
trees.get('cut')!.phase='fallen';
let targets=collectWorkerTargets(camp,inputs);
assert.deepEqual(targets.map(t=>t.id),['cut:bucking']);
let plan;
for(let seed=0;seed<20&&!plan?.activity;seed++) plan=pickWorkerWalkPlan(camp,0,targets,seed);
assert.equal(plan?.activity,'chop');
assert.deepEqual(plan?.path[2],targets[0].workStand,'chopping stance is beside the actual trunk');
trees.get('cut')!.phase='logs'; trees.get('cut')!.logs=[stock];
assert.equal(collectWorkerTargets(camp,inputs).length,0,'logging crew waits for ox instead of felling more trees');
targets=collectWorkerTargets({...camp,kind:'woodcutters_lodge'},inputs);
assert.deepEqual(targets.map(t=>t.id),['cut:log:0']);

// Exercise the runtime audio controller: range, zoom, mute, contact cutoff,
// bounded voices, and pan all operate before a sound can become audible.
const starts: any[] = []; const gains: any[] = []; const pans: any[] = [];
const param = () => ({value:0,setTargetAtTime(value:number){this.value=value;}});
const node = () => ({connect(next:any){return next;},disconnect(){}});
const context = {state:'running',currentTime:0,destination:node(),
  decodeAudioData:async()=>({}),
  createBufferSource(){const source={...node(),buffer:null,onended:null as (()=>void)|null,stopped:false,
    start(){starts.push(this);},stop(){this.stopped=true;this.onended?.();}};return source;},
  createGain(){const gain={...node(),gain:param()};gains.push(gain);return gain;},
  createStereoPanner(){const pan={...node(),pan:param()};pans.push(pan);return pan;},
};
THREE.AudioContext.setContext(context as never);
const originalFetch=globalThis.fetch;
globalThis.fetch=(async()=>({ok:true,arrayBuffer:async()=>new ArrayBuffer(4)})) as typeof fetch;
const audio=new ForestryAudio();
await new Promise(resolve=>setTimeout(resolve,0));
const event={kind:'fall',layoutIndex:0,x:20,y:0,z:0} as const;
const view={centerX:0,centerZ:0,orbitDistance:20};
audio.tick([event],view,camera);
assert.equal(starts.length,1);
assert.ok(gains[0].gain.value>0 && gains[0].gain.value<0.8);
assert.ok(pans[0].pan.value>0,'source on the right pans right');
audio.tick([{...event,x:41}],view,camera);
audio.tick([event],{...view,orbitDistance:51},camera);
assert.equal(starts.length,1,'distant and zoomed-out trees are inaudible');
audio.tick([{...event,kind:'impact'}],view,camera);
assert.equal(starts.length,2); assert.ok(starts[0].stopped,'impact ends falling creaks');
audio.setEnabled(false); audio.tick([event],view,camera);
assert.equal(starts.length,2); assert.ok(starts[1].stopped);
audio.setEnabled(true);
audio.tick(Array.from({length:20},(_,i)=>({...event,layoutIndex:i+1})),view,camera);
assert.equal(starts.length,10,'at most eight voices survive a burst');
audio.dispose(); globalThis.fetch=originalFetch;
const manifest=JSON.parse(readFileSync('public/sounds/elevenlabs-generation.json','utf8'));
for(const id of ['forestry-tree-fall','forestry-tree-impact']) {
  const record=manifest.generations.find((clip:any)=>clip.id===id);
  assert.ok(record,`${id} has ElevenLabs generation provenance`);
  const bytes=readFileSync(record.output);
  assert.equal(bytes.length,record.byteLength);
  assert.equal(createHash('sha256').update(bytes).digest('hex'),record.sha256);
}
console.log('Forestry behavior passed: phase events, species materials, finite log meshes, worker targets, spatial audio and generated clip integrity.');
