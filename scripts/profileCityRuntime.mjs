import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const output = 'artifacts/city-performance';
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--enable-unsafe-webgpu'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', e => { errors.push(e.message); console.log('pageerror', e.message); });
page.on('console', e => { if (e.type() === 'error') errors.push(e.text()); });
await page.route('**/src/main.ts*', async route => {
  const response = await route.fetch();
  const body = (await response.text()).replace('const app = new App(root);', 'const app = new App(root); window.__cityApp = app;');
  await route.fulfill({ response, body });
});
try {
  await page.goto('http://127.0.0.1:5173/?visualQa=daylight&visualProfile=1', { timeout: 120000 });
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
  console.log('ready', JSON.stringify({ stats: state.stats, buildings: state.buildings.length, residences: state.residences.length, errors }));
  const measured = await page.evaluate(async () => {
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
    const buildings=['stable','carpenter','smokehouse','weaver','potter_kiln','bakery'].map((kind,i)=>({...camp,id:`perf-${kind}`,kind,x:center.x+(i%3-1)*20,z:center.z+Math.floor(i/3)*20+24,foundingShelterActive:false,assignedLabor:4,yaw:0}));
    const residences=Array.from({length:5},(_,i)=>({id:`perf-home-${i}`,zoneId:'perf',parcelIndex:i,x:center.x+(i-2)*16,z:center.z-25,yaw:0,population:6,populationCapacity:6,tier:1,settlementTicks:0,needs:createDefaultNeeds(),abandoned:false,householdWealth:8}));
    const reports=[];
    for(const arm of ['terrain-and-camp','buildings','populated']) {
      if(arm==='buildings') {
        app.buildingMarkers.syncBuildings([camp,...buildings]);
        app.residenceMarkers.syncResidences(residences,(x,z)=>manager.terrain.getHeightAt(x,z));
      }
      if(arm==='populated') app.villagers.sync({residences,buildings:[camp,...buildings],quarries:[],foragingNodes:[],trees:new Map(),treeRegistry:null,farmFields:[],pastures:[],roadNetwork:app.roadNetwork,oxen:Array.from({length:3},(_,i)=>({id:`perf-ox-${i}`,stableId:'perf-stable',slot:i,purchaseCost:10}))});
      for(let i=0;i<120;i++)await new Promise(requestAnimationFrame);
      const samples=[]; let last;
      for(let i=0;i<180;i++) {
        for(const k of Object.keys(phases)) phases[k]=0;
        const time=await new Promise(requestAnimationFrame);
        if(last!==undefined)samples.push({intervalMs:time-last,...phases});
        last=time;
      }
      reports.push({arm,samples,stats:manager.getPerformanceStats(),crowd:app.villagers.renderer.authoredCrowdDiagnostics(),oxen:app.villagers.oxen.diagnostics()});
    }
    return reports;
  });
  writeFileSync(`${output}/gameplay-phases.json`,JSON.stringify({ measured, errors },null,2));
  await page.screenshot({path:`${output}/populated-gameplay.png`});
  console.log('gameplay phases',JSON.stringify(measured.map(x=>({arm:x.arm,stats:x.stats,average:Object.fromEntries(Object.keys(x.samples[0]).map(k=>[k,x.samples.reduce((s,v)=>s+(v[k]??0),0)/x.samples.length]))}))));
} finally {
  await browser.close();
}
