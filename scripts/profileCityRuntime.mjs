import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'vite';
import { createInterface } from 'node:readline';

const output = `artifacts/city-performance/${process.argv[2] ?? 'full-current'}`;
const large = process.argv.includes('--large');
mkdirSync(output, { recursive: true });
const server = await createServer({ server: { host: '127.0.0.1', port: 5191, strictPort: true, hmr: false } });
await server.listen();
const browser = await chromium.launchPersistentContext('artifacts/city-performance/world-browser-cache', { channel: 'msedge', headless: true, args: ['--enable-unsafe-webgpu'], viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const cdp = process.argv.includes('--profile') ? await page.context().newCDPSession(page) : null;
await page.exposeFunction('__cityProfileStart', async () => { if(cdp){await cdp.send('Profiler.enable');await cdp.send('Profiler.start');} });
await page.exposeFunction('__cityProfileEnd', async () => { if(cdp){const {profile}=await cdp.send('Profiler.stop');writeFileSync(`${output}/cpu-profile.json`,JSON.stringify(profile));} });
const errors = [];
page.on('pageerror', e => { errors.push(e.message); console.log('pageerror', e.message); });
page.on('console', e => { if (e.type() === 'error') errors.push(e.text()); });
await page.route('**/src/main.ts*', async route => {
  const response = await route.fetch();
  const body = (await response.text()).replace('const app = new App(root);', 'const app = new App(root); window.__cityApp = app;');
  await route.fulfill({ response, body });
});
try {
  await page.goto('http://127.0.0.1:5191/?visualQa=daylight&visualProfile=1', { timeout: 120000 });
  for (let i = 0; i < 90; i++) {
    for(const name of [/Continue to Heraldry/, /Continue to Map Generation/, /^Start world$/]) {
      const button=page.getByRole('button',{name});
      if(await button.isVisible())await button.click();
    }
    const state = await page.evaluate(() => ({ ready: !!window.__visualPerf, loading: document.querySelector('[data-loading-label]')?.textContent }));
    if (state.ready) break;
    if (i % 5 === 0) console.log('loading', JSON.stringify(state), await page.locator('body').innerText().then(x=>x.slice(0,160)));
    await page.waitForTimeout(2000);
  }
  const skipTutorials = page.locator('[data-tutorial-skip]');
  if(await skipTutorials.isVisible()) {
    await skipTutorials.check();
    await page.locator('[data-tutorial-confirm]').click();
  }
  // The introductory overlay blurs the entire live canvas and can take over
  // the camera. Measure ordinary gameplay after it has been dismissed.
  await page.locator('[data-tutorial-confirm]').waitFor({state:'hidden'});
  const state = await page.evaluate(() => {
    const app = window.__cityApp;
    return {
      appKeys: Object.keys(app),
      stats: app.sceneManager?.getPerformanceStats(),
      adapter: app.sceneManager?.getRendererAdapterEvidence(),
      buildings: [...(app.gameState?.buildings.values() ?? [])],
      residences: [...(app.gameState?.residences.values() ?? [])],
      villagersKeys: app.villagers && Object.keys(app.villagers),
      cameraKeys: Object.keys(app.cameraController ?? {}),
      sceneKeys: Object.keys(app.sceneManager ?? {}),
      report: window.__visualPerf?.getReport(),
    };
  });
  writeFileSync(`${output}/initial-runtime.json`, JSON.stringify({ ...state, errors }, null, 2));
  await page.screenshot({ path: `${output}/initial-runtime.png` });
  await page.evaluate(() => window.__visualPerf?.stopFrameCollection());
  console.log('ready', JSON.stringify({ stats: state.stats, buildings: state.buildings.length, residences: state.residences.length, errors }));
  const measured = await page.evaluate(async large => {
    const app = window.__cityApp;
    const manager = app.sceneManager;
    const phases = {};
    for(const [name,owner,key] of [
      ['buildings',app.buildingMarkers,'tick'], ['residences',app.residenceMarkers,'tick'],
      ['villagers',app.villagers,'tick'], ['oxen',app.villagers.oxen,'tick'],
      ['logistics',app.deliveryAgents,'update'], ['render',manager,'render'],
    ]) {
      const original=owner?.[key]; if(!original)continue;
      owner[key]=function(...args){const start=performance.now();try{return original.apply(this,args);}finally{phases[name]=(phases[name]??0)+performance.now()-start;}};
    }
    const { createDefaultNeeds }=await import('/src/residences/residenceNeedState.ts');
    const camp=app.visualQaFoundersCampFixture;
    const center={x:camp.x,z:camp.z};
    const kinds=['stable','carpenter','smokehouse','weaver','potter_kiln','bakery'];
    const position=(i)=>large ? {x:center.x+(i%14-6.5)*18,z:center.z+(Math.floor(i/14)-6.5)*18} : {x:center.x+(i%3-1)*20,z:center.z+Math.floor(i/3)*20+24};
    const buildings=Array.from({length:large?100:6},(_,i)=>({...camp,id:`perf-building-${i}`,kind:kinds[i%kinds.length],...position(i),foundingShelterActive:false,assignedLabor:4,yaw:0}));
    const residences=Array.from({length:large?100:5},(_,i)=>({id:`perf-home-${i}`,zoneId:'perf',parcelIndex:i,...(large?position(i+100):{x:center.x+(i-2)*16,z:center.z-25}),yaw:0,population:large?5:6,populationCapacity:6,tier:1,settlementTicks:0,needs:createDefaultNeeds(),abandoned:false,householdWealth:8}));
    if(large)app.cameraController.applyShowcaseView(center.x,center.z,.7,.75,320);
    const stableIds=buildings.filter(b=>b.kind==='stable').map(b=>b.id);
    const { AnimalCombatRenderer }=await import('/src/settlement/AnimalCombatRenderer.ts');
    const dogs=new AnimalCombatRenderer(manager.scene);await dogs.ready;
    const dogPoses=[];
    const baseRender=manager.render;
    manager.render=function(dt,...args){const begin=performance.now();dogs.sync(dogPoses,undefined,dt);phases.dogs=performance.now()-begin;return baseRender.call(this,dt,...args);};
    const reports=[];
    for(const arm of ['terrain-and-camp','buildings','populated',...(large?['populated-stationary','populated-camera-sweep']:[])]) {
      if(arm==='buildings') {
        app.buildingMarkers.syncBuildings([camp,...buildings]);
        app.residenceMarkers.syncResidences(residences,(x,z)=>manager.terrain.getHeightAt(x,z));
      }
      if(arm==='populated') {
        app.villagers.sync({residences,buildings:[camp,...buildings],quarries:[],foragingNodes:[],trees:new Map(),treeRegistry:null,farmFields:[],pastures:[],roadNetwork:app.roadNetwork,oxen:Array.from({length:large?30:3},(_,i)=>({id:`perf-ox-${i}`,stableId:stableIds[Math.floor(i/3)%stableIds.length],slot:i%3,purchaseCost:10}))});
        if(large)for(let i=0;i<100;i++){const x=center.x+(i%20-10)*2,z=center.z+(Math.floor(i/20)-2)*3;dogPoses.push({id:`perf-dog-${i}`,faction:'dog',x,y:manager.terrain.getHeightAt(x,z),z,yaw:0,moveSpeed:1,status:'advancing'});}
      }
      for(let i=0;i<(arm.startsWith('populated-')?240:120);i++)await new Promise(requestAnimationFrame);
      if(arm==='populated')await window.__cityProfileStart();
      const samples=[]; let last;
      for(let i=0;i<(arm.startsWith('populated-')?360:180);i++) {
        if(arm==='populated-camera-sweep')app.cameraController.applyShowcaseView(center.x,center.z,.7+.4*Math.sin(i*Math.PI/180),.75,320);
        for(const k of Object.keys(phases)) phases[k]=0;
        const time=await new Promise(requestAnimationFrame);
        if(last!==undefined)samples.push({intervalMs:time-last,...phases});
        last=time;
      }
      if(arm==='populated')await window.__cityProfileEnd();
      reports.push({arm,samples,stats:manager.getPerformanceStats(),crowd:app.villagers.renderer.authoredCrowdDiagnostics(),oxen:app.villagers.oxen.diagnostics(),dogs:dogs.diagnostics(),visualReport:window.__visualPerf?.getReport()});
    }
    return reports;
  }, large);
  writeFileSync(`${output}/gameplay-phases.json`,JSON.stringify({ measured, errors },null,2));
  const summary=measured.map(({arm,samples,stats})=>{
    const times=samples.map(s=>s.intervalMs).sort((a,b)=>a-b);
    const mean=times.reduce((a,b)=>a+b,0)/times.length;
    return {arm,meanFrameMs:mean,averageFps:1000/mean,medianFrameMs:times[Math.floor(times.length*.5)],p95FrameMs:times[Math.floor(times.length*.95)],meanRenderCpuMs:samples.reduce((a,b)=>a+b.render,0)/samples.length,stats};
  });
  writeFileSync(`${output}/summary.json`,JSON.stringify({viewport:[1280,720],pixelRatio:1,requested:large?{workplaces:100,homes:100,civilians:500,dogs:100,oxen:30}:{workplaces:6,homes:5,civilians:30,dogs:0,oxen:3},summary,errors},null,2));
  await page.screenshot({path:`${output}/populated-gameplay.png`});
  console.log('gameplay phases',JSON.stringify(measured.map(x=>({arm:x.arm,stats:x.stats,average:Object.fromEntries(Object.keys(x.samples[0]).map(k=>[k,x.samples.reduce((s,v)=>s+(v[k]??0),0)/x.samples.length]))}))));
  if(process.argv.includes('--parity')) {
    const parity=await page.evaluate(async()=> (await import('/scripts/fixtures/citySceneParity.js')).checkCitySceneParity());
    writeFileSync(`${output}/scene-parity.json`,JSON.stringify(parity,null,2));
    console.log('SCENE_PARITY',JSON.stringify(parity));
    if(parity.some(frame=>frame.changedPixels>150))throw new Error('Full-world instance culling changed visible geometry or shadows');
  }
  if (process.argv.includes('--keep')) {
    console.log('CITY_LAB_READY');
    for await (const line of createInterface({ input: process.stdin, terminal: false })) {
      if(line==='quit')break;
      try { console.log('LAB_RESULT',JSON.stringify(await page.evaluate(line))); }
      catch(error){console.log('LAB_ERROR',String(error));}
    }
  }
} finally {
  await browser.close();
  await server.close();
}
