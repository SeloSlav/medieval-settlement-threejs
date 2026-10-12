import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { mkdirSync,readFileSync,writeFileSync } from 'node:fs';

const server=await createServer({cacheDir:'artifacts/map-icon-visibility-vite-cache',server:{host:'127.0.0.1',port:0,hmr:false}});
await server.listen();let browser;
try {
  browser=await chromium.launch({channel:process.platform==='win32'?'msedge':undefined,headless:true});
  const errors=[],results=[];
  const css=['mapIcons.css','polishedGameUi.css','gameplayCraft.css'].map(file=>readFileSync(`src/ui/${file}`,'utf8')).join('\n');
  for(const mode of ['singleplayer','multiplayer']) {
    const page=await browser.newPage({viewport:{width:800,height:600}});
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/map-icon-visibility-probe?*',route=>route.fulfill({contentType:'text/html',body:
      `<html><head><style>${css}</style></head><body><canvas width="800" height="600"></canvas><div data-ui-root></div></body></html>`}));
    await page.goto(`${server.resolvedUrls.local[0]}map-icon-visibility-probe?mode=${mode}`,{waitUntil:'domcontentloaded',timeout:120000});
    const result=await page.evaluate(async mode=>{
      const {THREE}=await import('/scripts/fixtures/webgpuTestImports.ts');
      const {QuarryMapIcons}=await import('/src/map/QuarryMapIcons.ts');
      const {ForagingMapIcons}=await import('/src/map/ForagingMapIcons.ts');
      const {realmFog}=await import('/src/multiplayer/realmVisibility.ts');
      const terrain={bounds:{minX:-6144,maxX:6144,minZ:-6144,maxZ:6144},getHeightAt:()=>0};
      const camera=new THREE.PerspectiveCamera(50,800/600,.1,1000);
      camera.position.set(0,80,130);camera.lookAt(0,0,0);camera.updateMatrixWorld();
      let blocked=false,paper=false;
      const options={uiRoot:document.querySelector('[data-ui-root]'),domElement:document.querySelector('canvas'),terrain,
        getCamera:()=>camera,getZoomPercent:()=>100,isBlocked:()=>blocked,isIllustratedMapActive:()=>paper,getIllustratedMapY:()=>0,
        getGeologicalNodes:()=>new Map(),getForagingNodes:()=>new Map(),onQuarrySelect:()=>{},onForagingSelect:()=>{},onClaySelect:()=>{}};
      const positions=[{x:0,z:0},{x:80,z:0},{x:0,z:4000}];
      const quarry=new QuarryMapIcons({...options,markers:positions.map((p,i)=>({id:`quarry-${i}`,kind:'quarry',label:'Stone',resource:'stone',...p}))});
      const forage=new ForagingMapIcons({...options,markers:positions.map((p,i)=>({id:`clay-${i}`,kind:'clay',label:'Clay',...p}))});
      const buttons=[...document.querySelectorAll('.quarry-map-icon,.foraging-map-icon')];
      const checks=[];
      const capture=name=>{
        const states=buttons.map(button=>({hidden:button.hidden,display:getComputedStyle(button).display,
          rects:button.getClientRects().length,clickable:!button.hidden&&button.getClientRects().length>0}));
        for(const state of states)if(state.hidden&&(state.display!=='none'||state.rects!==0))throw Error(`${mode}/${name}: hidden marker still paints`);
        checks.push({name,states});return states;
      };
      const update=()=>{quarry.update();forage.update();};
      capture('before-first-update');
      realmFog.pixels.fill(0);update();const unknown=capture('unknown-fog');
      if(mode==='multiplayer'&&unknown.some(state=>!state.hidden))throw Error('Unknown realm markers became visible');
      realmFog.pixels.fill(255);update();const revealed=capture('revealed');
      if(revealed[0].hidden||revealed[3].hidden||!revealed[2].hidden||!revealed[5].hidden)throw Error('Projection visibility/reveal failed');
      const mutations=[];const observer=new MutationObserver(records=>mutations.push(...records));
      for(const button of buttons)observer.observe(button,{attributes:true,attributeFilter:['hidden']});
      update();await Promise.resolve();observer.disconnect();
      if(mutations.length)throw Error('Stationary markers repeatedly toggle hidden attributes');
      paper=true;realmFog.pixels.fill(96);update();capture('remembered-paper-map');
      realmFog.pixels.fill(0);update();const lost=capture('fog-after-reveal');
      if(mode==='multiplayer'&&lost.some(state=>!state.hidden))throw Error('Fog did not hide previously revealed markers');
      blocked=true;update();if(buttons.some(button=>button.getClientRects().length))throw Error('Blocked overlay still paints');
      blocked=false;paper=false;realmFog.pixels.fill(255);update();capture('restored-world');
      const settlement=document.createElement('button');settlement.className='settlement-map-icon';settlement.hidden=true;
      options.uiRoot.append(settlement);if(getComputedStyle(settlement).display!=='none')throw Error('Hidden settlement marker still paints');
      quarry.dispose();forage.dispose();settlement.remove();
      return {mode,checks,stationaryHiddenMutations:mutations.length};
    },mode);
    results.push(result);await page.close();
  }
  assert.deepEqual(errors,[]);
  mkdirSync('artifacts/map-icon-visibility',{recursive:true});
  writeFileSync('artifacts/map-icon-visibility/report.json',JSON.stringify({results,errors},null,2));
  console.log(JSON.stringify({modes:results.length,cases:results.reduce((sum,result)=>sum+result.checks.length,0),errors}));
} finally {await browser?.close();await server.close();}
