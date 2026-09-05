import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
const label = process.argv[2] ?? 'iteration-01';
const out = `water-gauntlet-evidence/${label}`;
mkdirSync(out,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true,args:['--enable-unsafe-webgpu']});
try {
  const page=await browser.newPage({viewport:{width:1280,height:720}});
  const errors=[];
  page.on('pageerror',e=>{errors.push(e.message);console.log('PAGEERROR',e.message);});
  page.on('console',m=>{if(m.type()==='error'&&!m.location().url.endsWith('/favicon.ico')){errors.push(m.text());console.log('CONSOLE',m.text().slice(0,3000));}});
  if(process.argv.includes('--suite')) {
    for(const profile of ['river','inland','coastal']) {
      await page.goto(`http://127.0.0.1:5186/water-gauntlet.html?profile=${profile}&clean=1&play=0&baseline=${process.argv.includes('--baseline')?'1':'0'}`);
      await page.waitForFunction(()=>window.__WATER_GAUNTLET__);
      for(const view of ['near','design','far']) {
        const ev=await page.evaluate(view=>window.__WATER_GAUNTLET__.capture({view}),view);
        await page.screenshot({path:`${out}/${profile}-${view}.png`});
        writeFileSync(`${out}/${profile}-${view}.json`,JSON.stringify({...ev,errors},null,2));
        console.log(profile,view,{fps:ev.fps,gpuMs:ev.gpuMedianMs,cpuMs:ev.cpuMedianMs});
      }
    }
    if(errors.length)process.exitCode=1;
  } else {
  await page.goto(`http://127.0.0.1:5186/river-lineup.html?view=near&time=6.25&clean=1&baseline=${process.argv.includes('--baseline')?'1':'0'}`);
  await page.waitForFunction(()=>window.__KUPA_RIVER_LINEUP_READY__,{},{timeout:120000});
  for (const view of ['near','design','far']) {
    const evidence=await page.evaluate(view=>window.__KUPA_RIVER_LINEUP_CAPTURE__({view,debugMode:'final'}),view);
    await page.screenshot({path:`${out}/${view}.png`});
    writeFileSync(`${out}/${view}.json`,JSON.stringify({...evidence,errors},null,2));
    console.log(view,evidence.performance,evidence.renderer);
  }
  for(const debugMode of ['normal','velocity','reflection','refraction','foam-field']) {
    await page.evaluate(debugMode=>window.__KUPA_RIVER_LINEUP_CAPTURE__({view:'near',debugMode}),debugMode);
    await page.screenshot({path:`${out}/${debugMode}.png`});
  }
  if(errors.length)process.exitCode=1;
  }
} finally {await browser.close();}
