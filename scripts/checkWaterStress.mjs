import {chromium} from '@playwright/test';
import {mkdirSync,writeFileSync} from 'node:fs';

const origin=process.env.WATER_GAUNTLET_ORIGIN??'http://127.0.0.1:5201';
const out='water-gauntlet-evidence/stress-release';
mkdirSync(out,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true,args:['--enable-unsafe-webgpu']});
try{
  const page=await browser.newPage({viewport:{width:1280,height:720}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error'&&!m.location().url.endsWith('/favicon.ico'))errors.push(m.text());});
  for(const [profile,seed,dpr] of [['river',42,1.5],['inland',8021,2],['coastal',42,2]]){
    await page.goto(`${origin}/water-gauntlet.html?profile=${profile}&seed=${seed}&dpr=${dpr}&clean=1&play=0`);
    await page.waitForFunction(()=>window.__WATER_GAUNTLET__,{},{timeout:120000});
    const views=[];
    for(const view of ['near','far']){
      await page.evaluate(view=>window.__WATER_GAUNTLET__.capture({view,time:12.5}),view);
      const evidence=await page.evaluate(()=>window.__WATER_GAUNTLET__.benchmark());
      if(errors.length)throw new Error(errors.join('\n'));
      if(evidence.framebufferCopies.color!==1||evidence.framebufferCopies.depth!==1)throw new Error('Framebuffer copy budget changed.');
      const png=await page.screenshot({path:`${out}/${profile}-${view}.png`});
      if(png.length<80000)throw new Error('Suspiciously empty water view.');
      views.push(evidence);
    }
    writeFileSync(`${out}/${profile}.json`,JSON.stringify({profile,seed,dpr,views,errors,
      performanceValid:false,reason:'Stress/compilation evidence, no matched baseline.'},null,2));
    console.log(profile,'seed',seed,'DPR',dpr,'near/far passed');
  }
}finally{await browser.close();}
