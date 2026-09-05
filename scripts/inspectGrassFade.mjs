import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { chromium } from '@playwright/test';

const sharp=createRequire(new URL('../vendor/seedthree/package.json',import.meta.url))('sharp');
const out=`artifacts/environment-pass/${process.argv[2]??'grass-opacity-regression-01'}`;
mkdirSync(out,{recursive:true});
const cohort=await fetch('http://127.0.0.1:5187/__environment_cohort').then(r=>r.json());
writeFileSync(`${out}/source-cohort.json`,JSON.stringify(cohort,null,2));
const browser=await chromium.launch({channel:'msedge',headless:true,args:['--enable-unsafe-webgpu']});
try {
  const context=await browser.newContext({viewport:{width:1280,height:720},deviceScaleFactor:1,
    recordVideo:{dir:`${out}/video`,size:{width:1280,height:720}}});
  const page=await context.newPage();
  const errors=[];
  await page.route('**/favicon.ico',route=>route.fulfill({status:204}));
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{
    if(message.type()==='error') errors.push(message.text());
    if(message.text().startsWith('[grass-fade]')) console.log(message.text());
  });
  await page.goto('http://127.0.0.1:5187/environment-lineup.html',{timeout:120000});
  await page.waitForFunction(()=>window.__ENVIRONMENT_GAUNTLET__,{},{timeout:300000});
  const result=await page.evaluate(async()=>{
    const api=window.__ENVIRONMENT_GAUNTLET__,manager=api.manager,grass=manager.grassField;
    await api.capture({view:'meadow',sampleCount:1});
    const materials=[...new Set(grass.group.children.map(mesh=>mesh.material)
      .filter(material=>material?.name==='SeedThree close meadow grass'))];
    if(materials.length!==1) throw new Error(`Expected shared grass material, found ${materials.length}`);
    const direction=manager.camera.position.clone().sub(manager.cameraTarget).normalize();
    let distance=22;
    const setDistance=value=>{
      distance=value;
      manager.camera.position.copy(manager.cameraTarget).addScaledVector(direction,distance);
      manager.camera.lookAt(manager.cameraTarget);manager.camera.updateMatrixWorld(true);
    };
    const render=async(dt=0)=>{await new Promise(requestAnimationFrame);manager.render(dt,distance);};
    setDistance(22);
    for(let i=0;i<360;i++) await render(1/60);
    for(let i=0;i<720&&!grass.isStreamSettled();i++) await render(1/60);
    if(!grass.isStreamSettled()) throw new Error('Grass fade inspection stream did not settle');
    const images={},sweeps=[],routes=[],shaders={};
    try {
      for(const corrected of [false,true]) {
        api.setGrassOpacityCorrection(corrected);
        const label=corrected?'corrected':'original';
        setDistance(22);
        for(let i=0;i<60;i++) await render();
        for(const opacity of [0,.05,.15,.35,.65,1]) {
          for(const material of materials) material.opacity=opacity;
          for(let i=0;i<3;i++) await render();
          await manager.waitForSubmittedWork();
          images[`${label}-opacity-${opacity}`]=manager.renderer.domElement.toDataURL('image/png');
          sweeps.push({corrected,opacity,materialOpacity:materials[0].opacity,
            renderer:manager.getPerformanceStats()});
        }
        shaders[label]=Object.fromEntries(['vertex','fragment'].map(stage=>[stage,
          [...manager.renderer._pipelines.programs[stage]].filter(([,program])=>
            program.name==='SeedThree close meadow grass').map(([code])=>code)]));
      }
      // Complete both fixed-view sweeps before moving the camera. Returning
      // from a zoom route can still be rebuilding the resident grass stream.
      for(const corrected of [false,true]) {
        api.setGrassOpacityCorrection(corrected);
        const label=corrected?'corrected':'original';
        setDistance(88/1.9);
        for(let i=0;i<90;i++) await render(1/60);
        const route=[];
        for(let frame=0;frame<480;frame++) {
          const progress=frame<240?frame/239:1-(frame-240)/239;
          const zoom=190+progress*260;
          setDistance(88/(zoom/100));
          await render(1/60);
          route.push({frame,zoom,distance,gate:grass.group.userData.lodFadeOpacity,
            visible:grass.group.userData.lodFadeVisible,materialOpacity:materials[0].opacity});
          if([10,28,60,100,150,210,239,350,451,479].includes(frame)) {
            await manager.waitForSubmittedWork();
            images[`${label}-zoom-${frame}`]=manager.renderer.domElement.toDataURL('image/png');
          }
        }
        routes.push({corrected,route});
        console.log('[grass-fade]',label,'zoom route complete');
      }
    } finally { api.setGrassOpacityCorrection(false); }
    const ivyNormalInstalled=[...manager.renderer._pipelines.programs.vertex]
      .some(([code,program])=>program.name?.includes('woodland ivy')&&code.includes('vIvyHingeNormal'));
    return {images,sweeps,routes,shaders,ivyNormalInstalled,adapter:manager.getRendererAdapterEvidence()};
  });
  for(const[name,png]of Object.entries(result.images)) writeFileSync(`${out}/${name}.png`,Buffer.from(png.split(',')[1],'base64'));
  const pixels=async name=>sharp(Buffer.from(result.images[name].split(',')[1],'base64')).removeAlpha().raw().toBuffer();
  const difference=(a,b)=>{let sum=0;for(let i=0;i<a.length;i++)sum+=Math.abs(a[i]-b[i]);return sum/a.length;};
  const originalZero=await pixels('original-opacity-0'),originalFull=await pixels('original-opacity-1');
  const correctedZero=await pixels('corrected-opacity-0'),correctedFull=await pixels('corrected-opacity-1');
  result.imageEvidence={originalOpacityResponse:difference(originalZero,originalFull),
    correctedOpacityResponse:difference(correctedZero,correctedFull),
    fullStrengthDifference:difference(originalFull,correctedFull),
    correctedRamp:await Promise.all([0,.05,.15,.35,.65,1].map(async opacity=>({opacity,
      differenceFromZero:difference(correctedZero,await pixels(`corrected-opacity-${opacity}`))})))};
  delete result.images;
  writeFileSync(`${out}/results.json`,JSON.stringify(result,null,2));
  writeFileSync(`${out}/runtime.json`,JSON.stringify({errors},null,2));
  console.log(result.imageEvidence);
  await context.close();
  assert.equal(errors.length,0,errors.join('\n'));
  assert.equal(result.ivyNormalInstalled,true,'Installed ivy normal correction must be compiled in the game pass');
  assert.ok(result.imageEvidence.originalOpacityResponse<.02,'Archived control should reproduce the missing opacity');
  assert.ok(result.imageEvidence.correctedOpacityResponse>.2,'Corrected opacity must visibly fade actual grass pixels');
  assert.ok(result.imageEvidence.fullStrengthDifference<.02,'Full-strength grass appearance must remain unchanged');
} finally {await browser.close();}
