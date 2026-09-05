import {chromium} from '@playwright/test';
import {mkdirSync,writeFileSync} from 'node:fs';
const out=`water-gauntlet-evidence/${process.argv[2] ?? 'world-01'}`;
mkdirSync(out,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true,args:['--enable-unsafe-webgpu']});
try {
 const page=await browser.newPage({viewport:{width:1280,height:720}});
 const errors=[];
 page.on('pageerror',e=>{errors.push(e.message);console.log('ERROR',e.message);});
 page.on('console',m=>{if(m.type()==='error'&&!m.location().url.endsWith('/favicon.ico')){errors.push(m.text());console.log(m.text().slice(0,1500));}});
 for(const profile of (process.argv.includes('--all')?['river','inland','coastal']:[process.argv[3]??'river'])) {
  await page.goto(`${process.env.WATER_GAUNTLET_ORIGIN ?? 'http://127.0.0.1:5186'}/water-world-gauntlet.html?profile=${profile}&clean=1&baseline=${process.argv.includes('--baseline')?'1':'0'}`);
  await page.waitForFunction(()=>window.__WATER_WORLD_GAUNTLET__,{},{timeout:240000});
  for(const view of ['near','design','far']) {
   if(process.argv.includes('--paired')) {
    const cohorts=await page.evaluate(view=>window.__WATER_WORLD_GAUNTLET__.compare(view),view);
    if(errors.length)throw new Error(errors.join('\n'));
    writeFileSync(`${out}/${profile}-${view}-paired.json`,JSON.stringify(cohorts,null,2));
    console.log(profile,view,cohorts.map(c=>({baseline:c.baseline,fps:c.fps,gpu:c.gpuMedianMs,compute:c.computeGpuMedianMs,cpu:c.medianCpuMs})));
    await page.screenshot({path:`${out}/${profile}-${view}.png`});
    continue;
   }
   const ev=await page.evaluate(view=>window.__WATER_WORLD_GAUNTLET__.capture({view}),view);
   if(errors.length)throw new Error(errors.join('\n'));
   const proof=await page.screenshot({path:`${out}/${profile}-${view}.png`});
   if(proof.byteLength<80000)throw new Error('Rendered world proof is suspiciously empty.');
   writeFileSync(`${out}/${profile}-${view}.json`,JSON.stringify({...ev,baseline:process.argv.includes('--baseline'),errors},null,2));
   console.log(profile,view,ev.fps,ev.p95FrameMs,ev.medianCpuMs,ev.renderer);
  }
  if(profile==='coastal'&&process.argv.includes('--conditions')){
   const join=await page.evaluate(()=>{
    const m=window.__WATER_WORLD_GAUNTLET__.manager,extent=m.terrain.size*0.5,meshes=[];
    m.scene.traverse(o=>{if(o.isMesh&&o.material?.userData?.waterSurfaceProfile==='coastal')meshes.push(o);});
    const coverage=(x,z)=>{
     let count=0;
     for(const mesh of meshes){const p=mesh.geometry.getAttribute('position'),idx=mesh.geometry.index;
      for(let i=0;i<idx.count;i+=3){
       const a=idx.getX(i),b=idx.getX(i+1),c=idx.getX(i+2),ax=p.getX(a),az=p.getZ(a),bx=p.getX(b),bz=p.getZ(b),cx=p.getX(c),cz=p.getZ(c);
       const den=(bz-cz)*(ax-cx)+(cx-bx)*(az-cz);if(Math.abs(den)<1e-8)continue;
       const u=((bz-cz)*(x-cx)+(cx-bx)*(z-cz))/den,v=((cz-az)*(x-cx)+(ax-cx)*(z-cz))/den;
       if(u>1e-7&&v>1e-7&&u+v<1-1e-7)count++;
      }
     }return count;
    };
    const samples=[-80.371,-20.371,35.371,91.371].flatMap(z=>[-.173,.173].map(dx=>({x:-extent+dx,z,coverage:coverage(-extent+dx,z)})));
    m.camera.position.set(-extent+24,5,-24);m.cameraTarget.set(-extent,-4.4,0);m.camera.lookAt(m.cameraTarget);m.camera.updateMatrixWorld();
    return {extent,samples,camera:m.camera.position.toArray(),target:m.cameraTarget.toArray()};
   });
   if(join.samples.some(s=>s.coverage!==1))throw new Error('Water horizon coverage failed: '+JSON.stringify(join));
   await page.evaluate(()=>new Promise(resolve=>{let n=0;function frame(){if(++n>=120)resolve();else requestAnimationFrame(frame);}requestAnimationFrame(frame);}));
   await page.screenshot({path:`${out}/coastal-join.png`});
   for(const [label,options] of [['rain',{view:'near',hour:13,rain:true}],['night',{view:'near',hour:2,rain:false}]]){
    await page.evaluate(options=>window.__WATER_WORLD_GAUNTLET__.capture(options),options);
    if(errors.length)throw new Error(errors.join('\n'));
    await page.screenshot({path:`${out}/coastal-${label}.png`});
   }
   writeFileSync(`${out}/conditions.json`,JSON.stringify({join,errors,performanceValid:false},null,2));
   console.log('Production sea join, rain and night passed.');
  }
 }
}finally{await browser.close();}
