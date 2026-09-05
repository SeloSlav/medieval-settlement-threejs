import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { SettlementCrowdRenderer, seatedVillagerContactHeight, villagerStaticSeatedPoseTime, type CrowdRenderAgent } from '../settlement/SettlementCrowdRenderer.ts';
import { MILITARY_EQUIPMENT_KINDS, createMilitaryEquipmentSources } from '../settlement/militaryEquipment.ts';
import { buildCrowdViewState } from '../settlement/crowdView.ts';
import { resetCombatWeaponRig, resolveCombatWeaponPresentation } from '../settlement/combatWeaponAnimation.ts';
import { CameraController } from '../camera/CameraController.ts';
import { CombatProjectileRenderer } from '../settlement/CombatProjectileRenderer.ts';
import { CavalryHorseRenderer, CAVALRY_SADDLE_HEIGHT, type CavalryHorsePose } from '../settlement/CavalryHorseRenderer.ts';
import { restoreMountedRidingPose } from '../settlement/mountedRidingPose.ts';

const REVIEW_VARIANTS=['man','raider'] as const;
const REVIEW_UNITS={
 'on-foot':{label:'On foot',weapons:MILITARY_EQUIPMENT_KINDS,horse:null},
 hussars:{label:'Hussars',weapons:['spear-shield','sidearm-shield'],horse:'hussar'},
 'armored-lancers':{label:'Armored Lancers',weapons:['spear','sidearm'],horse:'lancer'},
 'mounted-archers':{label:'Mounted Archers',weapons:['bow','sidearm'],horse:'archer'},
} as const;
type ReviewUnit=keyof typeof REVIEW_UNITS;
type ReviewState={unit:ReviewUnit;weapon:string;variant:typeof REVIEW_VARIANTS[number];mode:string;phase:number;time:number;view:string;seed:number;paused:boolean;standard:boolean;rawSkin?:boolean};
const params=new URLSearchParams(location.search);
const requestedUnit=params.get('unit')??'on-foot';
const initialUnit:ReviewUnit=Object.hasOwn(REVIEW_UNITS,requestedUnit)?requestedUnit as ReviewUnit:'on-foot';
const initialWeapons:readonly string[]=REVIEW_UNITS[initialUnit].weapons;
const requestedWeapon=params.get('weapon')??(initialUnit==='on-foot'?'sidearm':initialWeapons[0]!);
const state:ReviewState={unit:initialUnit,weapon:initialWeapons.includes(requestedWeapon)?requestedWeapon:initialWeapons[0]!,variant:initialUnit==='on-foot'&&params.get('variant')==='raider'?'raider':'man',mode:params.get('mode')??'walk',phase:Number(params.get('phase')??.5),time:Number(params.get('time')??.35),view:params.get('view')??'front',seed:Number(params.get('seed')??431),paused:params.get('play')!=='1',standard:params.has('standard')};
const scene=new THREE.Scene();scene.background=new THREE.Color('#b8c2ca');
const renderer=new WebGPURenderer({antialias:true});renderer.setPixelRatio(1);renderer.setSize(innerWidth,innerHeight);document.body.append(renderer.domElement);await renderer.init();
const camera=new THREE.PerspectiveCamera(38,innerWidth/innerHeight,.02,100);
scene.add(new THREE.HemisphereLight(0xeaf2ff,0x71766d,2));
const key=new THREE.DirectionalLight(0xfff2da,3);key.position.set(-3,7,5);scene.add(key);
const fill=new THREE.DirectionalLight(0xd8e4ff,.8);fill.position.set(4,3,-4);scene.add(fill);
const ground=new THREE.Mesh(new THREE.PlaneGeometry(40,40),new THREE.MeshStandardMaterial({color:0x87917c,roughness:1}));ground.rotation.x=-Math.PI/2;ground.position.y=-.02;scene.add(ground);
const parent=new THREE.Group();scene.add(parent);
const crowd=new SettlementCrowdRenderer({parent});await crowd.ready;
const horses=new CavalryHorseRenderer(parent);
if(!await horses.ready)throw new Error('Mounted unit preview could not load its horse model.');
const view=buildCrowdViewState(0,0,25);
const sources=createMilitaryEquipmentSources();
const standalone=new THREE.Group();scene.add(standalone);
let standaloneWeapon:THREE.Group|null=null;
let skeletonDebug:THREE.SkeletonHelper|null=null;
let standaloneProjectile:CombatProjectileRenderer|null=null;
let frame=0,clock=0,last=performance.now();const errors:string[]=[];
window.addEventListener('error',e=>errors.push(e.message));
const temp=new THREE.Vector3(),temp2=new THREE.Vector3(),cameraOffset=new THREE.Vector3();
const mountedBounds=new THREE.Box3();
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
 const attack=state.mode==='attack'||state.mode==='hit'||state.mode==='fallback'||state.mode==='defend';
 const distance=state.mode==='fallback'?1.5:8;
 const presentation=resolveCombatWeaponPresentation(tool!,distance);
 const duration=presentation?.attackSeconds??1;
 const mounted=REVIEW_UNITS[state.unit].horse!==null&&state.mode!=='fall';
 return{id:'review',slot:0,x:0,y:mounted ? .02+CAVALRY_SADDLE_HEIGHT-seatedVillagerContactHeight('man',state.seed) : .02,z:0,yaw:0,appearanceSeed:state.seed,mounted,
  variant:'man',presentation:state.variant==='raider'?'raider':'common',
  mode:state.mode==='attack'||state.mode==='fallback'||state.mode==='defend'?'fight':state.mode==='hit'?'hurt':state.mode as CrowdRenderAgent['mode'],
  combatDefending:state.mode==='defend',
  tool,movementSpeed:state.mode==='run'||state.mode==='flee'?2.15:1.2,animationRateScale:1,
  tunicColor:0x835f3f,skinColor:0xc9946a,hairColor:0x3d2b22,active:true,
  ...(attack?{combatAttackCooldown:(1-state.phase)*duration,combatAttackSeconds:duration,combatTargetDistance:distance,combatTargetX:0,combatTargetY:1.15,combatTargetZ:distance}:{}),
  ...(state.standard?{companyStandard:{id:'review-standard',faction:'player' as const}}:{}),
 };
}
function rig(){return (crowd as any).animated.get('review');}
function horseRig(){return (horses as any).visuals.get('review-horse');}
function poseHorse(a:CrowdRenderAgent,frozen:boolean,dt:number){
 const presentation=REVIEW_UNITS[state.unit].horse;
 const moving=['walk','run','flee'].includes(state.mode);
 const poses:CavalryHorsePose[]=a.mounted&&presentation?[{
  id:'review-horse',x:a.x,y:.02,z:a.z,yaw:a.yaw,moveSpeed:moving?a.movementSpeed??0:0,
  activity:moving?'walking':'standing',presentation,appearanceSeed:state.seed,
 }]:[];
 if(horseRig()&&horseRig().appearanceSeed!==state.seed)horses.sync([],view,0);
 horses.sync(poses,view,dt);
 const visual=horseRig();
 if(frozen&&visual){
  visual.mixer.stopAllAction();
  const action=visual.actions[visual.mode];action.reset().setEffectiveWeight(1).play();
  action.time=state.time*action.getClip().duration;
  visual.mixer.update(0);
  horses.sync(poses,view,0);
 }
}
function pose(frozen=false,dt=0){
 const a=agent();crowd.syncAgents([a],view,dt);
 poseHorse(a,frozen,dt);
 const visual=rig();
 if(frozen&&visual){
  if(visual.combatRig)resetCombatWeaponRig(visual.combatRig);
  restoreMountedRidingPose(visual.mountedRig);
  visual.mixer.stopAllAction();
  const action=visual.actions[visual.actionMode];action.reset().setEffectiveWeight(1).play();
  const seatedTime=villagerStaticSeatedPoseTime(visual.actionMode,state.seed,action.getClip().duration);
  if(seatedTime!==null){
   action.time=seatedTime;action.paused=true;visual.mixer.update(0);
  }else visual.mixer.setTime(state.time*action.getClip().duration);
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
 }else if(agent().mounted){
  mountedBounds.setFromObject(visual.model,true);
  const horse=horseRig();if(horse)mountedBounds.expandByObject(horse.model,true);
  mountedBounds.getCenter(out);
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
 }else{
  cameraOffset.copy(state.view==='side'?temp2.set(-3.3,.35,.15):state.view==='back'?temp2.set(-2.5,.4,-2.9):state.view==='left-back'?temp2.set(2.5,.4,-2.9):state.view==='left-front'?temp2.set(1.25,.55,3.3):state.view==='far'?temp2.set(4,6,8):temp2.set(-1.25,.55,3.3));
  if(agent().mounted){
   const halfFov=Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov/2))*Math.min(1,camera.aspect));
   const radius=mountedBounds.getSize(temp2).length()/2;
   cameraOffset.setLength(Math.max(cameraOffset.length(),radius/Math.sin(halfFov)*1.12));
  }
 }
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
 const horse=horseRig();
 const bones=r?Object.fromEntries(Object.entries(r.armBones).map(([name,b])=>[name,(b as THREE.Bone).getWorldPosition(new THREE.Vector3()).toArray()])):{};
 const legs=visual?Object.fromEntries(['L_Calf','R_Calf','L_Foot','R_Foot'].map(name=>[name,visual.model.getObjectByName(name)?.getWorldPosition(new THREE.Vector3()).toArray()])):{};
 return {ready:true,state:{...state},frame,errors:[...errors],bones,mounted:agent().mounted,rider:{action:visual?.actionMode,y:visual?.root.position.y,time:visual?.actions[visual.actionMode].time,legs},horse:horse?{mode:horse.mode,time:horse.actions[horse.mode].time,position:horse.root.position.toArray(),presentation:REVIEW_UNITS[state.unit].horse}:null,backend:renderer.backend.constructor.name,drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,memory:renderer.info.memory,camera:{position:camera.position.toArray(),target:cameraController.getTargetPosition().toArray(),distance:cameraController.getOrbitDistance(),yaw:cameraController.getYaw(),userAdjusted:cameraUserAdjusted}};
}
function render(){renderer.render(scene,camera);frame++;document.body.dataset.weaponReviewCamera=JSON.stringify({position:camera.position.toArray(),target:orbitTarget.toArray(),distance:cameraController.getOrbitDistance(),yaw:cameraController.getYaw(),userAdjusted:cameraUserAdjusted});document.querySelector('#status')!.textContent=`${REVIEW_UNITS[state.unit].label} · ${state.weapon} · ${state.variant} · ${state.mode}\nphase ${state.phase.toFixed(2)} · clip ${state.time.toFixed(2)} · ${state.view}\n${errors.join('\n')}`;}
function set(patch:Partial<ReviewState>){
 if(patch.variant!==undefined&&!REVIEW_VARIANTS.includes(patch.variant))throw new Error('Weapon review supports only male combatants.');
 if(patch.unit!==undefined&&!Object.hasOwn(REVIEW_UNITS,patch.unit))throw new Error('Unknown army unit preview.');
 patch={...patch};
 if(patch.unit!==undefined&&patch.unit!=='on-foot'){
  patch.weapon??=REVIEW_UNITS[patch.unit].weapons[0];patch.variant='man';
 }else if(patch.unit===undefined&&patch.variant==='raider')patch.unit='on-foot';
 const unit=patch.unit??state.unit;
 const weapons:readonly string[]=REVIEW_UNITS[unit].weapons;
 if(patch.weapon!==undefined&&!weapons.includes(patch.weapon))throw new Error(`${REVIEW_UNITS[unit].label} cannot equip ${patch.weapon}.`);
 const resetCamera=!cameraInitialized||['unit','weapon','variant','mode','view','standard'].some(key=>Object.hasOwn(patch,key));
 Object.assign(state,patch);clock=state.phase;
 const weaponSelect=document.querySelector<HTMLSelectElement>('select[data-key="weapon"]')!;
 if(weaponSelect.dataset.unit!==state.unit){
  weaponSelect.replaceChildren(...weapons.map(weapon=>new Option(weapon,weapon)));
  weaponSelect.dataset.unit=state.unit;
 }
 for(const el of document.querySelectorAll<HTMLSelectElement>('select[data-key]'))el.value=String(state[el.dataset.key as keyof ReviewState]);
 phase.value=String(state.phase);
 pose(true);
 for(const batch of (crowd as any).authoredBatchList)batch.group.visible=!state.rawSkin;
 rig().model.traverse((o:THREE.Object3D)=>{if(o instanceof THREE.SkinnedMesh)o.visible=Boolean(state.rawSkin);});
 if(skeletonDebug){scene.remove(skeletonDebug);skeletonDebug.dispose();skeletonDebug=null;}
 if(state.rawSkin){skeletonDebug=new THREE.SkeletonHelper(rig().model);(skeletonDebug.material as THREE.Material).depthTest=false;scene.add(skeletonDebug);}
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
function select(key:keyof ReviewState,values:string[]){const el=document.createElement('select');el.dataset.key=key;el.setAttribute('aria-label',key==='unit'?'Army unit':key);for(const value of values)el.add(new Option(key==='unit'?REVIEW_UNITS[value as ReviewUnit].label:value,value));el.value=String(state[key]);el.onchange=()=>set({[key]:el.value});controls.append(el);}
select('unit',Object.keys(REVIEW_UNITS));
select('weapon',[...MILITARY_EQUIPMENT_KINDS]);select('variant',[...REVIEW_VARIANTS]);select('mode',['idle','walk','run','flee','hurt','attack','hit','fallback','fall']);select('view',['front','side','back','left-front','left-back','grip','grip-inside','grip-back','elbow-right','elbow-left','elbow-left-back','shield','shield-side','nock','quiver','projectile','weapon','far']);
const phase=document.createElement('input');phase.type='range';phase.min='0';phase.max='1';phase.step='.01';phase.value=String(state.phase);phase.oninput=()=>set({phase:Number(phase.value),time:Number(phase.value),paused:true});controls.append(phase);
const play=document.createElement('button');play.textContent='Play / pause';play.onclick=()=>set({paused:!state.paused});controls.append(play);
const resetCamera=document.createElement('button');resetCamera.textContent='Reset camera';resetCamera.onclick=()=>{applyCameraPreset();render();};controls.append(resetCamera);
(window as any).weaponReview={set,stats,state,rig};set({});
function animate(now:number){const dt=Math.min(.05,(now-last)/1000);last=now;if(!state.paused){clock+=dt/(resolveCombatWeaponPresentation(state.weapon as any,state.mode==='fallback'?1.5:8)?.attackSeconds??1);state.phase=clock%1;state.time=clock%1;phase.value=String(state.phase);pose(false,dt);}followAnimatedGrip();cameraController.update(dt);render();requestAnimationFrame(animate);}requestAnimationFrame(animate);
window.addEventListener('resize',()=>{renderer.setSize(innerWidth,innerHeight);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();});
window.addEventListener('pagehide',()=>{cameraController.dispose();horses.dispose();},{once:true});
