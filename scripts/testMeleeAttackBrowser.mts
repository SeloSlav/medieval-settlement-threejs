import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import { chromium } from '@playwright/test';
const browser=await chromium.launch({headless:true,channel:'chrome',args:['--enable-unsafe-webgpu','--ignore-gpu-blocklist']});
const sources=Object.fromEntries(await Promise.all([
 'src/settlement/weaponAttackMotion.ts','src/settlement/meleeBodyPose.ts',
 'src/settlement/combatWeaponAnimation.ts','src/settlement/meleeHandGrip.ts',
 'public/assets/models/villagers/worker-male-common-01-v002.glb',
 'public/assets/models/villagers/ottoman-raider-common-01-v001.glb',
].map(async file=>[file,createHash('sha256').update(await readFile(file)).digest('hex')])));
try {
 const page=await browser.newPage({viewport:{width:1280,height:1000}});
 // Freeze this review page's loaded code while other workspace tasks use Vite.
 await page.routeWebSocket('**',()=>{});
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`${process.env.WEAPON_REVIEW_URL??'http://127.0.0.1:5175'}/artifacts/weapon-review.html`);
 await page.waitForFunction(()=>Boolean((window as any).weaponReview?.stats().ready),null,{timeout:60000});
 const cases=[];
 for(const variant of ['man','raider'])for(const weapon of ['spear','spear-shield','pike-kit','halberd','sidearm','sidearm-shield','sword-shield','bow','crossbow'])cases.push({unit:'on-foot',variant,weapon,standard:false});
 for(const [unit,weapons] of [['hussars',['spear-shield','sidearm-shield']],['armored-lancers',['spear','sidearm']],['mounted-archers',['bow','sidearm']],['akinci',['bow','sidearm-shield']],['sipahi',['spear-shield','sidearm-shield']]] as const)for(const weapon of weapons)cases.push({unit,variant:unit==='akinci'||unit==='sipahi'?'raider':'man',weapon,standard:false});
 for(const [unit,variant] of [['on-foot','man'],['on-foot','raider'],['armored-lancers','man']])cases.push({unit,variant,weapon:'sidearm',standard:true});
 const reports=[];
 const seeds=process.argv.includes('--stress')?[0,32768,65280]:[431];
 const scenarios=cases.flatMap(base=>seeds.flatMap(seed=>[
  {...base,seed,yaw:seed===0?.7:seed===65280?2.5:0,defensive:false},...(base.weapon.endsWith('shield')?[{...base,seed,yaw:seed===0?.7:seed===65280?2.5:0,defensive:true}]:[]),
 ]));
 const filter=process.argv.find(arg=>arg.startsWith('--filter='))?.slice(9);
 for(const input of scenarios) {
  if(filter&&!input.weapon.includes(filter))continue;
  if(process.argv.includes('--defense-only')&&!input.defensive)continue;
  const report=await page.evaluate(async input=>{
   const T=await import('/node_modules/three/build/three.module.js' as any);
   const {meleePalmLocal}=await import('/src/settlement/meleeHandGrip.ts' as any);
   const api=(window as any).weaponReview;
   const mode=input.defensive?'defend':['bow','crossbow'].includes(input.weapon)?'fallback':'attack';
   api.set({...input,mode,phase:0,paused:true});
   const visual=api.rig(),rig=visual.combatRig,horse=api.horseRig();
   const mount=visual.tool.userData.workerToolMounts.find((m:any)=>m.userData.workerToolCombatRole==='melee-held')??visual.tool;
   const localBounds=new T.Box3(),inverse=mount.matrixWorld.clone().invert(),weaponVertices:any[]=[];
   mount.traverse((o:any)=>{if(o.isMesh){const p=o.geometry.getAttribute('position');for(let i=0;i<p.count;i++){const v=new T.Vector3().fromBufferAttribute(p,i).applyMatrix4(o.matrixWorld).applyMatrix4(inverse);localBounds.expandByPoint(v);weaponVertices.push(v);}}});
   const bodies:any[]=[];visual.model.traverse((o:any)=>{if(o.isSkinnedMesh)bodies.push(o);});
   const problems:Record<string,number[]>={};let maxStep=0,worstJoint='',maxFootSlide=0,maxGripError=0,maxRidingLegChange=0,minWeaponY=Infinity;let previous:any[]=[];let feet:any[]=[];let ridingLegs:any[]=[];
   const note=(label:string,phase:number)=>{const p=problems[label]??=[];if(!p.includes(phase))p.push(phase);};
   for(let f=0;f<=200;f+=input.defensive?10:1) {
    api.set({phase:f/200},false);
    const q=rig.ownedBones.map((b:any)=>b.getWorldQuaternion(new T.Quaternion()));
    if(previous.length)q.forEach((q:any,i:number)=>{const angle=q.angleTo(previous[i]);if(angle>maxStep){maxStep=angle;worstJoint=rig.ownedBones[i].name;}});
    previous=q;
    const anchors=[mount.localToWorld(new T.Vector3(...mount.userData.workerToolGripLocal))];
    maxGripError=Math.max(maxGripError,anchors[0].distanceTo(rig.armBones.rightHand.localToWorld(meleePalmLocal(rig.armBones.rightHand,false,new T.Vector3()))));
    if(input.unit==='on-foot'&&mount.userData.workerToolSupportGripLocal){
     const support=mount.localToWorld(new T.Vector3(...mount.userData.workerToolSupportGripLocal));anchors.push(support);
     maxGripError=Math.max(maxGripError,support.distanceTo(rig.armBones.leftHand.localToWorld(meleePalmLocal(rig.armBones.leftHand,true,new T.Vector3()))));
    }
    if(input.unit==='on-foot') {
     const current=['L_Foot','R_Foot'].map(n=>visual.model.getObjectByName(n).getWorldPosition(new T.Vector3()));
     if(feet.length)current.forEach((v:any,i:number)=>{maxFootSlide=Math.max(maxFootSlide,v.distanceTo(feet[i]));});
     else feet=current;
    }else{
     const current=['Hip','L_Thigh','R_Thigh','L_Calf','R_Calf','L_Foot','R_Foot'].map(n=>visual.model.getObjectByName(n).quaternion.clone());
     if(ridingLegs.length)current.forEach((q:any,i:number)=>{maxRidingLegChange=Math.max(maxRidingLegChange,q.angleTo(ridingLegs[i]));});
     else ridingLegs=current;
    }
    if(f%10!==0)continue;
    if(input.defensive&&f%100!==0)continue;
    for(const vertex of weaponVertices)minWeaponY=Math.min(minWeaponY,mount.localToWorld(vertex.clone()).y);
    visual.model.updateMatrixWorld(true);horse?.model.updateMatrixWorld(true);
    for(const m of bodies)m.boundingSphere=null;
    horse?.model.traverse((o:any)=>{if(o.isSkinnedMesh)o.boundingSphere=null;});
    for(const offset of [[0,0],[.012,0],[-.012,0],[0,.012],[0,-.012]]) {
     const a=mount.localToWorld(new T.Vector3(offset[0],localBounds.min.y,offset[1]));
     const b=mount.localToWorld(new T.Vector3(offset[0],localBounds.max.y,offset[1]));
     const ray=new T.Raycaster(a,b.clone().sub(a).normalize(),0,a.distanceTo(b));
     if(horse&&ray.intersectObject(horse.model,true).length)note('weapon/horse',f/200);
     if(rig.shieldMount&&ray.intersectObject(rig.shieldMount,true).length)note('weapon/shield',f/200);
     for(const hit of ray.intersectObjects(bodies,false)) {
      const skin=hit.object.geometry.getAttribute('skinIndex'),weight=hit.object.geometry.getAttribute('skinWeight');
      const v=hit.face.a;let best=0;for(let j=1;j<4;j++)if(weight.getComponent(v,j)>weight.getComponent(v,best))best=j;
      const tag=hit.object.skeleton.bones[skin.getComponent(v,best)].name;
      // Contact with fingers, palm and wrist next to the actual held point is
      // checked by the separate grip-surface tests, not treated as a body hit.
      if(/Hand|Grip|Forearm/.test(tag)&&anchors.some(p=>p.distanceTo(hit.point)<.115))continue;
      note(`weapon/body:${tag}`,f/200);
     }
    }
   }
   return {input,problems,bodyScale:visual.model.scale.x,maxJointStepDegrees:maxStep*180/Math.PI,worstJoint,maxFootSlide,maxGripError,maxRidingLegChange,minWeaponY};
  },input);
  reports.push(report);
  if(Object.keys(report.problems).length)console.log(JSON.stringify(report));
  else if(reports.length%10===0)console.log(`Verified ${reports.length}/${scenarios.length} melee scenarios.`);
 }
 await mkdir('artifacts/weapon-qa',{recursive:true});
 await writeFile(`artifacts/weapon-qa/melee-${process.argv.includes('--stress')?'stress':'matrix'}${filter?`-${filter}`:''}${process.argv.includes('--defense-only')?'-defense':''}.json`,JSON.stringify({capturedAt:new Date().toISOString(),sources,errors,reports},null,2));
 assert.ok(reports.length>0,'the requested filter must select at least one melee scenario');
 assert.deepEqual(errors,[]);
 assert.ok(reports.every(r=>r.maxGripError<.002),'both hands must remain on their physical grips within 2 mm');
 assert.ok(reports.every(r=>r.maxRidingLegChange<1e-4),'attacks must preserve the riding legs');
 assert.ok(reports.every(r=>r.minWeaponY>.02),'weapons must stay above the ground');
 if(process.argv.includes('--stress')) {
  const min=reports.find(r=>r.input.seed===0)!;
  const max=reports.find(r=>r.input.seed===65280)!;
  assert.ok(Math.abs(max.bodyScale/min.bodyScale-1.04/.96)<1e-6,'stress seeds must change the actual body scale');
 }
 assert.ok(reports.every(r=>r.maxFootSlide<.002),'planted ankles must not slide through the attack cycle');
 assert.ok(reports.every(r=>r.maxJointStepDegrees<13),'every owned joint must move smoothly at 200 samples per attack');
 assert.ok(reports.every(r=>Object.keys(r.problems).length===0),'weapons must clear the body, shield and horse throughout the sampled cycle');
 console.log(`${reports.length} scenarios passed; maximum grip error ${(Math.max(...reports.map(r=>r.maxGripError))*1000).toFixed(3)} mm, foot slide ${(Math.max(...reports.map(r=>r.maxFootSlide))*1000).toFixed(4)} mm.`);
}finally{await browser.close();}
