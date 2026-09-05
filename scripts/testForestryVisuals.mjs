import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const out = 'artifacts/forestry'; mkdirSync(out,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true,args:['--enable-unsafe-webgpu']});
try {
  const page=await browser.newPage({viewport:{width:1280,height:720}});
  await page.routeWebSocket('**', socket => socket.close());
  const errors=[];
  page.on('pageerror',e=>{errors.push(e.message);console.log('PAGEERROR',e.message);});
  await page.goto('http://127.0.0.1:5193/forestry-lineup.html',{waitUntil:'domcontentloaded',timeout:120000});
  await page.waitForFunction(()=>window.__FORESTRY_QA__,{},{timeout:300000});
  for(const species of ['beech','silverFir','sessileOak']) {
    await page.evaluate(s=>window.__FORESTRY_QA__.select(s),species);
    for(const [phase,progress,health] of [['mature',0,1],['falling',0.72,1],['fallen',1,1],['logs',0,1],['logs',0,0.5]]) {
      await page.evaluate(([p,t,h])=>window.__FORESTRY_QA__.phase(p,t,h),[phase,progress,health]);
      const {png,...evidence}=await page.evaluate(()=>window.__FORESTRY_QA__.capture(28));
      const name=`${species}-${phase}-${health}`;
      writeFileSync(`${out}/${name}.png`,Buffer.from(png.split(',')[1],'base64'));
      writeFileSync(`${out}/${name}.json`,JSON.stringify(evidence,null,2));
      console.log('captured',name);
    }
  }
  for(const distance of [13,65,180]) {
    const {png,...evidence}=await page.evaluate(d=>window.__FORESTRY_QA__.capture(d),distance);
    writeFileSync(`${out}/distance-${distance}.png`,Buffer.from(png.split(',')[1],'base64'));
    writeFileSync(`${out}/distance-${distance}.json`,JSON.stringify(evidence,null,2));
  }
  for(const diagnostic of ['lighting','normal','ao']) {
    const {png,...evidence}=await page.evaluate(mode=>window.__FORESTRY_QA__.capture(28,mode),diagnostic);
    writeFileSync(`${out}/diagnostic-${diagnostic}.png`,Buffer.from(png.split(',')[1],'base64'));
    writeFileSync(`${out}/diagnostic-${diagnostic}.json`,JSON.stringify(evidence,null,2));
  }
  const events=await page.evaluate(()=>window.__FORESTRY_QA__.fall());
  assert.equal(events.filter(e=>e.kind==='fall').length,1);
  assert.equal(events.filter(e=>e.kind==='impact').length,1);
  const haulEvidence=[];
  for(const [commodity,loaded] of [['timber',false],['timber',true],['firewood',true]]) {
    const haul=await page.evaluate(([kind,loaded])=>window.__FORESTRY_QA__.haul(kind,loaded),[commodity,loaded]);
    assert.equal(haul.oxen,commodity==='timber'?1:0);
    assert.equal(haul.workers,1);
    if(commodity==='timber') {
      assert.equal(haul.cargo.length,loaded?1:0);
      if(loaded) assert.ok(Math.abs(haul.cargo[0].length-haul.expectedLength)<1e-6);
    }
    const {png,...evidence}=await page.evaluate(()=>window.__FORESTRY_QA__.capture(18));
    const name=`haul-${commodity}-${loaded?'loaded':'empty'}`;
    writeFileSync(`${out}/${name}.png`,Buffer.from(png.split(',')[1],'base64'));
    writeFileSync(`${out}/${name}.json`,JSON.stringify({...evidence,haul},null,2));
    haulEvidence.push({commodity,loaded,haul});
  }
  const workers=await page.evaluate(()=>window.__FORESTRY_QA__.workers());
  assert.ok(workers.some(w=>w.mode==='chop' && w.target.id.endsWith(':bucking')),'workers must reach and cut the fallen trunk');
  const {png:workerPng,...workerEvidence}=await page.evaluate(()=>window.__FORESTRY_QA__.capture(20));
  writeFileSync(`${out}/workers-bucking.png`,Buffer.from(workerPng.split(',')[1],'base64'));
  writeFileSync(`${out}/workers-bucking.json`,JSON.stringify({...workerEvidence,workers},null,2));
  const decoded=await page.evaluate(async()=>{
    const context=new AudioContext(); const results=[];
    for(const name of ['tree_fall','tree_impact']) { const bytes=await (await fetch(`/sounds/world/${name}.mp3`)).arrayBuffer(); const buffer=await context.decodeAudioData(bytes); results.push({name,duration:buffer.duration,channels:buffer.numberOfChannels}); }
    await context.close(); return results;
  });
  writeFileSync(`${out}/verification.json`,JSON.stringify({events,decoded,haulEvidence,workers,errors},null,2));
  assert.equal(errors.length,0,errors.join('\n'));
  console.log('Forestry visual timeline and audio decode passed',JSON.stringify(decoded));
} finally {await browser.close();}
