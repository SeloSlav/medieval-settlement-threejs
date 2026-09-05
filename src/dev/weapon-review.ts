import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { SettlementCrowdRenderer, type CrowdRenderAgent } from '../settlement/SettlementCrowdRenderer.ts';
import { MILITARY_EQUIPMENT_KINDS, createMilitaryEquipmentSources } from '../settlement/militaryEquipment.ts';
import { buildCrowdViewState } from '../settlement/crowdView.ts';
import { resetCombatWeaponRig, resolveCombatWeaponPresentation } from '../settlement/combatWeaponAnimation.ts';

type ReviewState={weapon:string;variant:string;mode:string;phase:number;time:number;view:string;seed:number;paused:boolean;standard:boolean};
const params=new URLSearchParams(location.search);
const state:ReviewState={weapon:params.get('weapon')??'sidearm',variant:params.get('variant')??'man',mode:params.get('mode')??'walk',phase:Number(params.get('phase')??.5),time:Number(params.get('time')??.35),view:params.get('view')??'front',seed:Number(params.get('seed')??431),paused:params.get('play')!=='1',standard:params.has('standard')};
const scene=new THREE.Scene();scene.background=new THREE.Color('#b8c2ca');
const renderer=new WebGPURenderer({antialias:true});renderer.setPixelRatio(1);renderer.setSize(innerWidth,innerHeight);document.body.append(renderer.domElement);await renderer.init();
const camera=new THREE.PerspectiveCamera(38,innerWidth/innerHeight,.02,100);
scene.add(new THREE.HemisphereLight(0xeaf2ff,0x71766d,2));
const key=new THREE.DirectionalLight(0xfff2da,3);key.position.set(-3,7,5);scene.add(key);
const fill=new THREE.DirectionalLight(0xd8e4ff,.8);fill.position.set(4,3,-4);scene.add(fill);
const ground=new THREE.Mesh(new THREE.PlaneGeometry(40,40),new THREE.MeshStandardMaterial({color:0x87917c,roughness:1}));ground.rotation.x=-Math.PI/2;ground.position.y=-.02;scene.add(ground);
const parent=new THREE.Group();scene.add(parent);
const crowd=new SettlementCrowdRenderer({parent});await crowd.ready;
const view=buildCrowdViewState(0,0,25);
const sources=createMilitaryEquipmentSources();
const standalone=new THREE.Group();scene.add(standalone);
let standaloneWeapon:THREE.Group|null=null;
let frame=0,clock=0,last=performance.now();const errors:string[]=[];
window.addEventListener('error',e=>errors.push(e.message));
const temp=new THREE.Vector3(),temp2=new THREE.Vector3();
function agent():CrowdRenderAgent{
 const tool=state.weapon as CrowdRenderAgent['tool'];
 const attack=state.mode==='attack'||state.mode==='hit'||state.mode==='fallback';
 const distance=state.mode==='fallback'?1.5:8;
 const presentation=resolveCombatWeaponPresentation(tool!,distance);
 const duration=presentation?.attackSeconds??1;
 return{id:'review',slot:0,x:0,y:.02,z:0,yaw:0,appearanceSeed:state.seed,
  variant:state.variant==='woman'?'woman':'man',presentation:state.variant==='raider'?'raider':'common',
  mode:state.mode==='attack'||state.mode==='fallback'?'fight':state.mode==='hit'?'hurt':state.mode as CrowdRenderAgent['mode'],
  tool,movementSpeed:state.mode==='run'||state.mode==='flee'?2.15:1.2,animationRateScale:1,
  tunicColor:0x835f3f,skinColor:0xc9946a,hairColor:0x3d2b22,active:true,
  ...(attack?{combatAttackCooldown:(1-state.phase)*duration,combatAttackSeconds:duration,combatTargetDistance:distance,combatTargetX:0,combatTargetY:1.15,combatTargetZ:distance}:{}),
  ...(state.standard?{companyStandard:{id:'review-standard',faction:'player' as const}}:{}),
 };
}
function rig(){return (crowd as any).animated.get('review');}
function pose(frozen=false,dt=0){
 const a=agent();crowd.syncAgents([a],view,dt);
 const visual=rig();
 if(frozen&&visual){
  if(visual.combatRig)resetCombatWeaponRig(visual.combatRig);
  visual.mixer.stopAllAction();
  const action=visual.actions[visual.actionMode];action.reset().setEffectiveWeight(1).play();
  visual.mixer.setTime(state.time*action.getClip().duration);
  crowd.syncAgents([a],view,0);
 }
}
function frameCamera(){
 const visual=rig();if(!visual)return;
 const hand=state.weapon==='bow'&&state.mode!=='fallback'?visual.combatRig.armBones.leftHand:visual.combatRig.armBones.rightHand;
 if(state.view.startsWith('grip')){
  hand.getWorldPosition(temp);temp.add(new THREE.Vector3(0,.01,.03));
  const offset=state.view==='grip-inside'?new THREE.Vector3(.32,.1,.28):state.view==='grip-back'?new THREE.Vector3(-.32,.06,-.22):new THREE.Vector3(-.27,.11,.35);
  camera.position.copy(temp).add(offset);camera.lookAt(temp);
 }else if(state.view==='weapon'){
  const bounds=new THREE.Box3().setFromObject(standalone);const size=bounds.getSize(temp2);bounds.getCenter(temp);
  camera.position.copy(temp).add(new THREE.Vector3(size.y*.28,size.y*.12,Math.max(size.y,size.x)*1.8));camera.lookAt(temp);
 }else{
  const pelvis=visual.model.getObjectByName('Pelvis')??visual.model;
  pelvis.getWorldPosition(temp);temp.y=1.06;temp.z+=.12;
  const offset=state.view==='side'?new THREE.Vector3(-3.3,.35,.15):state.view==='back'?new THREE.Vector3(-2.5,.4,-2.9):state.view==='far'?new THREE.Vector3(4,6,8):new THREE.Vector3(-1.25,.55,3.3);
  camera.position.copy(temp).add(offset);camera.lookAt(temp);
 }
}
function stats(){
 const visual=rig();const r=visual?.combatRig;
 const bones=r?Object.fromEntries(Object.entries(r.armBones).map(([name,b])=>[name,(b as THREE.Bone).getWorldPosition(new THREE.Vector3()).toArray()])):{};
 return {ready:true,state:{...state},frame,errors:[...errors],bones,backend:renderer.backend.constructor.name,drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,memory:renderer.info.memory};
}
function render(){frameCamera();renderer.render(scene,camera);frame++;document.querySelector('#status')!.textContent=`${state.weapon} · ${state.variant} · ${state.mode}\nphase ${state.phase.toFixed(2)} · clip ${state.time.toFixed(2)} · ${state.view}\n${errors.join('\n')}`;}
function set(patch:Partial<ReviewState>){
 Object.assign(state,patch);clock=state.phase;
 pose(true);
 parent.visible=state.view!=='weapon';standalone.visible=state.view==='weapon';
 if(standaloneWeapon){standalone.remove(standaloneWeapon);standaloneWeapon=null;}
 if(state.view==='weapon'){
  const source=sources[state.weapon as keyof typeof sources];standaloneWeapon=source.scene.clone(true);
  standaloneWeapon.scale.setScalar(source.targetLength/source.sourceLength);standalone.add(standaloneWeapon);
 }
 render();return stats();
}
const controls=document.querySelector('#controls')!;
function select(key:keyof ReviewState,values:string[]){const el=document.createElement('select');for(const value of values)el.add(new Option(value,value));el.value=String(state[key]);el.onchange=()=>set({[key]:el.value});controls.append(el);}
select('weapon',[...MILITARY_EQUIPMENT_KINDS]);select('variant',['man','woman','raider']);select('mode',['idle','walk','run','flee','hurt','attack','hit','fallback','fall']);select('view',['front','side','back','grip','grip-inside','grip-back','weapon','far']);
const phase=document.createElement('input');phase.type='range';phase.min='0';phase.max='1';phase.step='.01';phase.value=String(state.phase);phase.oninput=()=>set({phase:Number(phase.value),paused:true});controls.append(phase);
const play=document.createElement('button');play.textContent='Play / pause';play.onclick=()=>set({paused:!state.paused});controls.append(play);
(window as any).weaponReview={set,stats,state};set({});
function animate(now:number){const dt=Math.min(.05,(now-last)/1000);last=now;if(!state.paused){clock+=dt;state.phase=clock%1;state.time=clock%1;pose(false,dt);}render();requestAnimationFrame(animate);}requestAnimationFrame(animate);
window.addEventListener('resize',()=>{renderer.setSize(innerWidth,innerHeight);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();});
