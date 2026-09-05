import { chromium } from '@playwright/test';
const browser=await chromium.launch({headless:true,channel:'chrome',args:['--enable-unsafe-webgpu','--ignore-gpu-blocklist']});
try {
 const page=await browser.newPage();
 await page.goto('http://127.0.0.1:5175/artifacts/weapon-review.html');
 await page.waitForFunction(()=>Boolean((window as any).weaponReview?.stats().ready),null,{timeout:60000});
 console.log(JSON.stringify(await page.evaluate(async()=>{
  const THREE=await import('/node_modules/three/build/three.module.js' as any);
  const api=(window as any).weaponReview;
  return [.82,1].map(phase=>{
   api.set({weapon:'sidearm',mode:'attack',phase});const visual=api.rig(),r=visual.combatRig;
   const meshes:any[]=[];
   visual.model.traverse((o:any)=>{if(o.isSkinnedMesh){
    const bone=o.skeleton.bones.find((b:any)=>b.name==='Spine02');
    const vertex=o.geometry.getAttribute('position'),index=o.geometry.getAttribute('skinIndex');
    const bi=o.skeleton.bones.indexOf(bone);let vi=0;while(vi<vertex.count&&index.getX(vi)!==bi)vi++;
    meshes.push({name:o.name,same:bone===r.torsoBones.spineUpper,rotation:bone?.getWorldQuaternion(new THREE.Quaternion()).toArray(),vertex:vi<vertex.count?o.localToWorld(o.applyBoneTransform(vi,new THREE.Vector3().fromBufferAttribute(vertex,vi))).toArray():null});
   }});
   return {phase,motion:r.attackMotion,meshes};
  });
 }),null,2));
}finally{await browser.close();}
