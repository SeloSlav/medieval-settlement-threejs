import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

const output=path.resolve('artifacts/weapon-qa');await fs.mkdir(output,{recursive:true});
const caseName=path.basename(process.argv[2]??'latest.json','.json');
const browser=await chromium.launch({headless:true,channel:'chrome',args:['--enable-unsafe-webgpu','--ignore-gpu-blocklist']});
try{
 const page=await browser.newPage({viewport:{width:1280,height:1000},deviceScaleFactor:1,
  ...(process.argv.includes('--video')?{recordVideo:{dir:output,size:{width:1280,height:1000}}}:{})});
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:5175/artifacts/weapon-review.html');
 await page.waitForFunction(()=>Boolean((window as any).weaponReview?.stats().ready),null,{timeout:60000});
 const options=process.argv[2]?JSON.parse(await fs.readFile(process.argv[2],'utf8')):[{}];
 const reports=[];
 for(let i=0;i<options.length;i++){
  const {name,...state}=options[i];
  const report=await page.evaluate(s=>(window as any).weaponReview.set({...s,paused:true}),state);
  await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
  const file=`${name??[state.weapon,state.mode,state.phase,state.view,state.variant].filter(v=>v!==undefined).join('-')}.png`;
  await page.screenshot({path:path.join(output,file)});
  reports.push({file,...report});
  console.log(file);
 }
 await fs.writeFile(path.join(output,`${caseName}-report.json`),JSON.stringify({errors,captures:reports},null,2));
 if(process.argv.includes('--video')){
  const motion=[];
  for(const [weapon,seconds] of [['bow',5],['spear',4],['sidearm',4],['halberd',4],['crossbow',7]] as const){
   await page.evaluate(weapon=>(window as any).weaponReview.set({weapon,variant:'man',mode:'attack',view:'side',phase:0,standard:false,paused:false}),weapon);
   const first=await page.evaluate(()=>(window as any).weaponReview.stats());
   await page.waitForTimeout(seconds*1000);
   const last=await page.evaluate(()=>(window as any).weaponReview.stats());
   await page.screenshot({path:path.join(output,`${caseName}-motion-${weapon}.png`)});
   motion.push({weapon,seconds,frames:last.frame-first.frame,errors:last.errors});
   console.log(`Motion: ${weapon}, ${last.frame-first.frame} frames / ${seconds}s`);
  }
  await fs.writeFile(path.join(output,`${caseName}-motion-report.json`),JSON.stringify(motion,null,2));
  const video=page.video();await page.close();await video?.saveAs(path.join(output,`${caseName}.webm`));
 }
 if(process.argv.includes('--sheet')){
  await page.goto('about:blank');
  await page.setViewportSize({width:1440,height:790});
  for(let start=0;start<reports.length;start+=6){
   const tiles=await Promise.all(reports.slice(start,start+6).map(async r=>`<figure><img src="data:image/png;base64,${(await fs.readFile(path.join(output,r.file))).toString('base64')}"><figcaption>${r.file}</figcaption></figure>`));
   await page.setContent(`<style>body{margin:0;background:#bbc5cc;display:grid;grid-template-columns:repeat(3,1fr);font:12px sans-serif}figure{margin:0}img{width:480px;height:375px}figcaption{height:20px;text-align:center}</style>${tiles.join('')}`);
   await page.screenshot({path:path.join(output,`sheet-${Math.floor(start/6)+1}.png`)});
  }
 }
 if(errors.length)throw new Error(errors.join('\n'));
}finally{await browser.close();}
