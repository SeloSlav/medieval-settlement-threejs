import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { SettlementCrowdRenderer, type CrowdRenderAgent } from '../settlement/SettlementCrowdRenderer.ts';
import { MILITARY_EQUIPMENT_KINDS, createMilitaryEquipmentSources } from '../settlement/militaryEquipment.ts';
import { buildCrowdViewState } from '../settlement/crowdView.ts';
import { resetCombatWeaponRig, resolveCombatWeaponPresentation } from '../settlement/combatWeaponAnimation.ts';
import { CameraController } from '../camera/CameraController.ts';
import { CombatProjectileRenderer } from '../settlement/CombatProjectileRenderer.ts';

const REVIEW_VARIANTS=['man','raider'] as const;
type ReviewState={weapon:string;variant:typeof REVIEW_VARIANTS[number];mode:string;phase:number;time:number;view:string;seed:number;paused:boolean;standard:boolean};
const params=new URLSearchParams(location.search);
const state:ReviewState={weapon:params.get('weapon')??'sidearm',variant:params.get('variant')==='raider'?'raider':'man',mode:params.get('mode')??'walk',phase:Number(params.get('phase')??.5),time:Number(params.get('time')??.35),view:params.get('view')??'front',seed:Number(params.get('seed')??431),paused:params.get('play')!=='1',standard:params.has('standard')};
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
let standaloneProjectile:CombatProjectileRenderer|null=null;
let frame=0,clock=0,last=performance.now();const errors:string[]=[];
window.addEventListener('error',e=>errors.push(e.message));
const temp=new THREE.Vector3(),temp2=new THREE.Vector3(),cameraOffset=new THREE.Vector3();
const orbitTarget=new THREE.Vector3(0,1.06,.12);
let cameraInitialized=false,cameraUserAdjusted=false;
const cameraController=new CameraController({
 camera,target:orbitTarget,domElement:renderer.domElement,
 bounds:{minX:-12,maxX:12,minZ:-12,maxZ:12},
 getHeightAt:()=>orbitTarget.y,
 isIllustratedMapReady:()=>false,
 continuousRenderLoop:true,orbitOnly:true,orbitFov:camera.fov,
 minimumOrbitDistance:.08,maximumOrbitDistance:30,
});
renderer.domElement.addEventListener('mousedown',event=>{
 if(event.button===1||event.button===2)cameraUserAdjusted=true;
},{capture:true});
renderer.domElement.addEventListener('wheel',()=>{cameraUserAdjusted=true;},{capture:true});
function agent():CrowdRenderAgent{
 const tool=state.weapon as CrowdRenderAgent['tool'];
 const attack=state.mode==='attack'||state.mode==='hit'||state.mode==='fallback';
 const distance=state.mode==='fallback'?1.5:8;
 const presentation=resolveCombatWeaponPresentation(tool!,distance);
 const duration=presentation?.attackSeconds??1;
 return{id:'review',slot:0,x:0,y:.02,z:0,yaw:0,appearanceSeed:state.seed,
  variant:'man',presentation:state.variant==='raider'?'raider':'common',
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
function cameraFocus(out:THREE.Vector3){
 const visual=rig();if(!visual)return;
 const hand=state.weapon==='bow'&&state.mode!=='fallback'?visual.combatRig.armBones.leftHand:visual.combatRig.armBones.rightHand;
 if(state.view.startsWith('shield')&&visual.combatRig.shieldMount){
  visual.combatRig.shieldMount.localToWorld(out.set(0,0,-.07));
 }else if(state.view==='nock'&&visual.combatRig.nockedArrow){
  visual.combatRig.nockedArrow.localToWorld(out.set(0,0,.085));
 }else if(state.view==='quiver'&&(state.weapon==='bow'||state.weapon==='crossbow')){
  visual.tool.userData.workerToolMounts[1].localToWorld(out.set(0,.72,0));
 }else if(state.view.startsWith('elbow')){
  (state.view.startsWith('elbow-left')?visual.combatRig.armBones.leftForearm:visual.combatRig.armBones.rightForearm).getWorldPosition(out);
 }else if(state.view.startsWith('grip')){
  hand.getWorldPosition(out);out.add(temp2.set(0,.01,.03));
 }else if(state.view==='weapon'||state.view==='projectile'){
  new THREE.Box3().setFromObject(standalone).getCenter(out);
 }else{
  const pelvis=visual.model.getObjectByName('Pelvis')??visual.model;
  pelvis.getWorldPosition(out);out.y=1.06;out.z+=.12;
 }
}
function applyCameraPreset(){
 cameraFocus(temp);if(!Number.isFinite(temp.x))return;
 if(state.view==='shield')cameraOffset.set(.12,.42,.015);
 else if(state.view==='shield-side')cameraOffset.set(.8,.1,.03);
 else if(state.view==='nock')cameraOffset.set(-.36,.13,.34);
 else if(state.view==='quiver')cameraOffset.set(-.4,.22,-.46);
 else if(state.view==='projectile')cameraOffset.set(1.25,.6,.15);
 else if(state.view.startsWith('elbow'))cameraOffset.set(state.view.startsWith('elbow-left')?.38:-.38,.12,state.view.endsWith('back')?-.38:.38);
 else if(state.view.startsWith('grip'))cameraOffset.copy(state.view==='grip-inside'?temp2.set(.32,.1,.28):state.view==='grip-back'?temp2.set(-.32,.06,-.22):temp2.set(-.27,.11,.35));
 else if(state.view==='weapon'){
  const size=new THREE.Box3().setFromObject(standalone).getSize(temp2);
  cameraOffset.set(size.y*.28,size.y*.12,Math.max(size.y,size.x)*1.8);
 }else cameraOffset.copy(state.view==='side'?temp2.set(-3.3,.35,.15):state.view==='back'?temp2.set(-2.5,.4,-2.9):state.view==='left-back'?temp2.set(2.5,.4,-2.9):state.view==='left-front'?temp2.set(1.25,.55,3.3):state.view==='far'?temp2.set(4,6,8):temp2.set(-1.25,.55,3.3));
 orbitTarget.y=temp.y;
 const distance=Math.max(.08,cameraOffset.length());
 cameraController.applyShowcaseView(temp.x,temp.z,Math.atan2(cameraOffset.z,cameraOffset.x),Math.asin(THREE.MathUtils.clamp(cameraOffset.y/distance,-1,1)),distance);
 cameraInitialized=true;cameraUserAdjusted=false;
}
function followAnimatedGrip(){
 if(cameraUserAdjusted||(!state.view.startsWith('grip')&&!state.view.startsWith('elbow')&&!state.view.startsWith('shield')&&state.view!=='nock'&&state.view!=='quiver'))return;
 cameraFocus(temp);orbitTarget.copy(temp);
}
function stats(){
 const visual=rig();const r=visual?.combatRig;
 const bones=r?Object.fromEntries(Object.entries(r.armBones).map(([name,b])=>[name,(b as THREE.Bone).getWorldPosition(new THREE.Vector3()).toArray()])):{};
 return {ready:true,state:{...state},frame,errors:[...errors],bones,backend:renderer.backend.constructor.name,drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,memory:renderer.info.memory,camera:{position:camera.position.toArray(),target:cameraController.getTargetPosition().toArray(),distance:cameraController.getOrbitDistance(),yaw:cameraController.getYaw(),userAdjusted:cameraUserAdjusted}};
}
function render(){renderer.render(scene,camera);frame++;document.body.dataset.weaponReviewCamera=JSON.stringify({position:camera.position.toArray(),target:orbitTarget.toArray(),distance:cameraController.getOrbitDistance(),yaw:cameraController.getYaw(),userAdjusted:cameraUserAdjusted});document.querySelector('#status')!.textContent=`${state.weapon} · ${state.variant} · ${state.mode}\nphase ${state.phase.toFixed(2)} · clip ${state.time.toFixed(2)} · ${state.view}\n${errors.join('\n')}`;}
function set(patch:Partial<ReviewState>){
 if(patch.variant!==undefined&&!REVIEW_VARIANTS.includes(patch.variant))throw new Error('Weapon review supports only male combatants.');
 const resetCamera=!cameraInitialized||['weapon','variant','mode','view','standard'].some(key=>Object.hasOwn(patch,key));
 Object.assign(state,patch);clock=state.phase;
 for(const el of document.querySelectorAll<HTMLSelectElement>('select[data-key]'))el.value=String(state[el.dataset.key as keyof ReviewState]);
 phase.value=String(state.phase);
 pose(true);
 const isolated=state.view==='weapon'||state.view==='projectile';
 parent.visible=!isolated;standalone.visible=isolated;
 standaloneProjectile?.dispose();standaloneProjectile=null;
 if(standaloneWeapon){standalone.remove(standaloneWeapon);standaloneWeapon=null;}
 if(state.view==='weapon'){
  const source=sources[state.weapon as keyof typeof sources];standaloneWeapon=source.scene.clone(true);
  standaloneWeapon.scale.setScalar(source.targetLength/source.sourceLength);
  standaloneWeapon.position.y=-source.bounds.min.y*standaloneWeapon.scale.y+.2;
  standalone.add(standaloneWeapon);
 }
 if(state.view==='projectile'){
  standaloneProjectile=new CombatProjectileRenderer(standalone);
  standaloneProjectile.spawnRelease(state.weapon==='crossbow'?'bolt':'arrow',new THREE.Vector3(0,.7,0),new THREE.Vector3(0,.7,8),431);
  standaloneProjectile.update(.001);
 }
 if(resetCamera)applyCameraPreset();
 render();return stats();
}
const controls=document.querySelector('#controls')!;
function select(key:keyof ReviewState,values:string[]){const el=document.createElement('select');el.dataset.key=key;for(const value of values)el.add(new Option(value,value));el.value=String(state[key]);el.onchange=()=>set({[key]:el.value});controls.append(el);}
select('weapon',[...MILITARY_EQUIPMENT_KINDS]);select('variant',[...REVIEW_VARIANTS]);select('mode',['idle','walk','run','flee','hurt','attack','hit','fallback','fall']);select('view',['front','side','back','left-front','left-back','grip','grip-inside','grip-back','elbow-right','elbow-left','elbow-left-back','shield','shield-side','nock','quiver','projectile','weapon','far']);
const phase=document.createElement('input');phase.type='range';phase.min='0';phase.max='1';phase.step='.01';phase.value=String(state.phase);phase.oninput=()=>set({phase:Number(phase.value),paused:true});controls.append(phase);
const play=document.createElement('button');play.textContent='Play / pause';play.onclick=()=>set({paused:!state.paused});controls.append(play);
const resetCamera=document.createElement('button');resetCamera.textContent='Reset camera';resetCamera.onclick=()=>{applyCameraPreset();render();};controls.append(resetCamera);
(window as any).weaponReview={set,stats,state};set({});
function animate(now:number){const dt=Math.min(.05,(now-last)/1000);last=now;if(!state.paused){clock+=dt/(resolveCombatWeaponPresentation(state.weapon as any,state.mode==='fallback'?1.5:8)?.attackSeconds??1);state.phase=clock%1;state.time=clock%1;phase.value=String(state.phase);pose(false,dt);}followAnimatedGrip();cameraController.update(dt);render();requestAnimationFrame(animate);}requestAnimationFrame(animate);
window.addEventListener('resize',()=>{renderer.setSize(innerWidth,innerHeight);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();});
window.addEventListener('pagehide',()=>cameraController.dispose(),{once:true});
