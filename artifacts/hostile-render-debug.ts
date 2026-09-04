import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { VillagerRenderer } from '../src/settlement/VillagerRenderer.ts';
import { buildCrowdViewState } from '../src/settlement/crowdView.ts';
const status = document.querySelector('#status')!;
const errors: string[] = [];
window.addEventListener('error', e => { errors.push(e.message); status.textContent = errors.join('\n'); });
window.addEventListener('unhandledrejection', e => { errors.push(String(e.reason?.stack ?? e.reason)); status.textContent = errors.join('\n'); });
const scene = new THREE.Scene(); scene.background = new THREE.Color('#aabac9');
const parent = new THREE.Group(); scene.add(parent);
const renderer = new WebGPURenderer({antialias:true});
renderer.setSize(innerWidth,innerHeight); document.body.append(renderer.domElement);
await renderer.init();
const camera = new THREE.PerspectiveCamera(45,innerWidth/innerHeight,0.1,2000);
camera.position.set(108,8,215); camera.lookAt(100,0.5,200);
scene.add(new THREE.HemisphereLight(0xffffff,0x666666,2));
const sun = new THREE.DirectionalLight(0xffffff,3); sun.position.set(100,20,205);scene.add(sun);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(60,60),new THREE.MeshStandardMaterial({color:0x83926c})); ground.rotation.x=-Math.PI/2; ground.position.set(100,-0.01,200);scene.add(ground);
scene.add(new THREE.GridHelper(60,60));
const villagers = new VillagerRenderer({parent,getGameSpeed:()=>1,getHeightAt:()=>0});
const ready = await villagers.visualAssetsReady;
const factions = ['bandit','dog','fox','wolf'] as const;
const agents = new Map(factions.map((faction,i)=>[String(i+1),{
 id:String(i+1),raidId:'debug',faction,sourceBuildingId:null,sourceSlot:0,ottomanRole:null,
 targetKind:'ground',targetId:'ground-0',x:96+i*2.5,z:200,homeX:96+i*2.5,homeZ:190,
 health:70,maxHealth:70,readiness:1,status:'advancing',attackCooldown:0,lootProgress:0,carryingLoot:false,
 issuedPolearms:0,raidAnchorBuildingId:null,banditCampId:null,companyId:null,homeResidenceId:null,personIdentity:null,stateChangedTick:0,
}]));
// Let empty batches participate in the live frame before an incursion spawns.
const view = buildCrowdViewState(100,200,20);
let elapsed=0, previous=0;
renderer.setAnimationLoop(time=>{
 const dt=Math.min(0.05,(time-previous)/1000);previous=time;elapsed+=dt;
 if(elapsed > 3 && Math.floor(elapsed*5)!==Math.floor((elapsed-dt)*5)){
  for(const a of agents.values()) a.z=200+Math.sin(elapsed*0.5)*3;
  villagers.setCombatAgents(new Map([...agents].map(([id,a])=>[id,{...a}])) as any);
 }
 villagers.tick(dt,view);
 renderer.render(scene,camera);
 const d = villagers.authoredCrowdDiagnostics();
 status.textContent=JSON.stringify({ready,time:elapsed.toFixed(1),humanoids:d.submittedInstances,animals:Object.fromEntries(Object.entries((villagers as any).combatAnimals.diagnostics()).map(([k,v]:any)=>[k,{count:v.count,drawCalls:v.drawCalls}])),errors},null,2);
});
