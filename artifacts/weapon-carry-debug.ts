import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { SettlementCrowdRenderer, type CrowdRenderAgent } from '../src/settlement/SettlementCrowdRenderer.ts';
import { MILITARY_EQUIPMENT_KINDS } from '../src/settlement/militaryEquipment.ts';
import { buildCrowdViewState } from '../src/settlement/crowdView.ts';
const params=new URLSearchParams(location.search);
const scene=new THREE.Scene();scene.background=new THREE.Color('#aabac9');
const renderer=new WebGPURenderer({antialias:true});
renderer.setSize(innerWidth,innerHeight);document.body.append(renderer.domElement);await renderer.init();
const camera=new THREE.PerspectiveCamera(43,innerWidth/innerHeight,.1,200);
camera.position.set(8,10,23);camera.lookAt(0,1,0);
scene.add(new THREE.HemisphereLight(0xffffff,0x667366,2));
const sun=new THREE.DirectionalLight(0xffffff,3);sun.position.set(5,12,8);scene.add(sun);
const ground=new THREE.Mesh(new THREE.PlaneGeometry(40,25),new THREE.MeshStandardMaterial({color:0x83926c}));
ground.rotation.x=-Math.PI/2;ground.position.y=-.02;scene.add(ground);
const parent=new THREE.Group();scene.add(parent);
const crowd=new SettlementCrowdRenderer({parent});await crowd.ready;
const agents: CrowdRenderAgent[]=MILITARY_EQUIPMENT_KINDS.map((tool,i)=>({
 id:tool,slot:i,x:(i%5-2)*3.4,y:.02,z:Math.floor(i/5)*4-2,yaw:Math.PI,
 appearanceSeed:431,variant:'man',mode:'walk',tool,movementSpeed:1.2,
 tunicColor:0x835f3f,skinColor:0xc9946a,hairColor:0x3d2b22,active:true,
}));
agents.push({...agents[0]!,id:'standard',slot:9,x:6.8,z:2,tool:'sidearm',companyStandard:{id:'test',faction:'player'}});
agents.push({...agents[0]!,id:'theft (unarmed)',slot:10,x:0,z:6,tool:null});
const focus=agents.find(a=>a.id===new URLSearchParams(location.search).get('focus'));
if(focus&&params.has('solo'))agents.splice(0,agents.length,focus);
if(focus){camera.position.set(focus.x+2.5,4,focus.z+7);camera.lookAt(focus.x,1.3,focus.z);}
if(focus && new URLSearchParams(location.search).has('hand')){
 camera.position.set(focus.x+.6,1.8,focus.z+2.2);camera.lookAt(focus.x-.25,1.05,focus.z+.05);
}
for(const agent of agents){
 agent.yaw=0;
 if(params.get('variant')==='raider')agent.presentation='raider';
 if(params.get('variant')==='woman')agent.variant='woman';
}
const angle=Number(params.get('angle')??0)*Math.PI/180;
if(focus&&angle){
 const target=new THREE.Vector3(focus.x-.2,1.05,focus.z+.05);
 const offset=camera.position.clone().sub(target).applyAxisAngle(new THREE.Vector3(0,1,0),angle);
 camera.position.copy(target).add(offset);camera.lookAt(target);
}
const view=buildCrowdViewState(0,0,35);
const labels=agents.map(a=>{const el=document.createElement('span');el.className='label';el.textContent=a.id;document.querySelector('#labels')!.append(el);return el;});
const mode=new URLSearchParams(location.search).get('mode')==='run'?'run':'walk';
const errors:string[]=[];window.addEventListener('error',e=>errors.push(e.message));
let last=performance.now();
renderer.setAnimationLoop(now=>{
 const dt=Math.min(.05,(now-last)/1000);last=now;
 for(const a of agents){a.mode=mode;a.movementSpeed=mode==='run'?2.15:1.2;}
 crowd.syncAgents(agents,view,dt);
 if(focus&&params.has('hand')&&!params.has('palm')){
  const rig=(crowd as any).animated.get(focus.id)?.combatRig;
  if(rig){
   const p=rig.armBones.rightUpperArm.getWorldPosition(new THREE.Vector3())
    .lerp(rig.armBones.rightHand.getWorldPosition(new THREE.Vector3()),.5);
   camera.position.copy(p).add(new THREE.Vector3(.6,.55,2.2).applyAxisAngle(new THREE.Vector3(0,1,0),angle));camera.lookAt(p);
  }
 }
 if(focus && new URLSearchParams(location.search).has('palm')){
  const rig=(crowd as any).animated.get(focus.id)?.combatRig;
  if(rig){
   const hand=focus.tool==='bow'?rig.armBones.leftHand:rig.armBones.rightHand;
   if(params.has('axes')&&!hand.userData.axes){hand.add(new THREE.AxesHelper(.15));hand.userData.axes=true;}
   const p=hand.getWorldPosition(new THREE.Vector3());
   camera.position.copy(p).add(new THREE.Vector3(.12,.1,.45).applyAxisAngle(new THREE.Vector3(0,1,0),angle));camera.lookAt(p);
  }
 }
 renderer.render(scene,camera);
 agents.forEach((a,i)=>{const p=new THREE.Vector3(a.x,.05,a.z+.7).project(camera);labels[i]!.style.left=(p.x*.5+.5)*innerWidth+'px';labels[i]!.style.top=(-p.y*.5+.5)*innerHeight+'px';});
 document.querySelector('#status')!.textContent=JSON.stringify({mode,rigs:agents.length,errors},null,2);
});
