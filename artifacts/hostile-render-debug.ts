import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { VillagerRenderer } from '../src/settlement/VillagerRenderer.ts';
import { buildCrowdViewState } from '../src/settlement/crowdView.ts';
import { createPostProcessor } from '../src/scene/PostProcessing.ts';
import { MilitaryCompanyStrategicOverlay } from '../src/security/MilitaryCompanyStrategicOverlay.ts';
import { hostileStrategicMarkers } from '../src/security/hostileStrategicMarkers.ts';
import type { CombatAgentState } from '../src/security/combatAgents.ts';
import { float } from 'three/tsl';
import '../src/ui/mapIcons.css';
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
const hemisphere = new THREE.HemisphereLight(0xffffff,0x666666,2);
const ambient = new THREE.AmbientLight(0xffffff,0.15);
scene.add(hemisphere,ambient);
const sun = new THREE.DirectionalLight(0xffffff,3); sun.position.set(100,20,205);scene.add(sun);
sun.target.position.set(100,0,200); scene.add(sun.target);sun.castShadow=true;
sun.shadow.camera.left=-20;sun.shadow.camera.right=20;sun.shadow.camera.top=20;sun.shadow.camera.bottom=-20;
renderer.shadowMap.enabled=true;
const ground = new THREE.Mesh(new THREE.PlaneGeometry(60,60),new THREE.MeshStandardMaterial({color:0x83926c})); ground.rotation.x=-Math.PI/2; ground.position.set(100,-0.01,200);scene.add(ground);
ground.receiveShadow=true;
const post = createPostProcessor({kind:'webgpu',renderer} as any,scene,camera,scene,{hemisphere,ambient},{visibility:float(1)} as any);
let usePost=true;
const villagers = new VillagerRenderer({parent,getGameSpeed:()=>1,getHeightAt:()=>0});
const ready = await villagers.visualAssetsReady;
const factions = ['bandit','dog','fox','wolf'] as const;
const agents = new Map<string, CombatAgentState>(factions.map((faction,i)=>[String(i+1),{
 id:String(i+1),raidId:'debug',faction,sourceBuildingId:null,sourceSlot:0,ottomanRole:null,
 targetKind:'ground',targetId:'ground-0',x:96+i*2.5,z:200,velocityX:0,velocityZ:0,homeX:96+i*2.5,homeZ:190,
 health:70,maxHealth:70,readiness:1,status:'advancing',attackCooldown:0,lootProgress:0,carryingLoot:false,
 issuedPolearms:0,raidAnchorBuildingId:null,banditCampId:null,companyId:null,homeResidenceId:null,personIdentity:null,stateChangedTick:0,
}]));
for(let i=5;i<=7;i++) agents.set(String(i),{...agents.get('1')!,id:String(i),status:'holding',x:85+i-5,z:195});
// Let empty batches participate in the live frame before an incursion spawns.
const view = buildCrowdViewState(100,200,20);
for(const [id,distance] of [['near',20],['design',65],['far',150]] as const){
 document.getElementById(id)!.onclick=()=>{
  camera.position.set(100+distance*0.4,distance*0.4,200+distance*0.75);camera.lookAt(100,0.5,200);
  buildCrowdViewState(100,200,distance,100,200,view);
 };
}
document.getElementById('post')!.onclick=()=>{usePost=!usePost;};
const icons = new MilitaryCompanyStrategicOverlay({
 uiRoot:document.body,domElement:renderer.domElement,camera,getZoomPercent:()=>100,getHeightAt:()=>0,
 getAgentPosition:id=>villagers.getCombatAgentPosition(id),getAgentBodyHeight:id=>villagers.getCombatAgentBodyHeight(id),
 isBlocked:()=>false,onSelect:()=>{},
});
icons.sync(hostileStrategicMarkers(agents.values()));
let elapsed=0, previous=0;
renderer.setAnimationLoop(time=>{
 const dt=Math.min(0.05,(time-previous)/1000);previous=time;elapsed+=dt;
 if(elapsed > 3 && Math.floor(elapsed*5)!==Math.floor((elapsed-dt)*5)){
  for(const a of agents.values()) if(a.status==='advancing') {
   a.z=200+Math.sin(elapsed*0.5)*3;
   a.velocityZ=Math.cos(elapsed*0.5)*2;
  }
  villagers.setCombatAgents(new Map([...agents].map(([id,a])=>[id,{...a}])));
  icons.sync(hostileStrategicMarkers(agents.values()));
 }
 villagers.tick(dt,view);
 if(usePost) post.render(dt);else renderer.render(scene,camera);
 icons.update(time,view);
 const d = villagers.authoredCrowdDiagnostics();
 status.textContent=JSON.stringify({ready,post:usePost,time:elapsed.toFixed(1),humanoids:d.submittedInstances,parties:hostileStrategicMarkers(agents.values()).map(m=>({members:m.agentIds,x:m.x,z:m.z})),bodyHeights:Object.fromEntries([...agents.values()].map(a=>[a.faction,villagers.getCombatAgentBodyHeight(a.id)])),errors},null,2);
});
