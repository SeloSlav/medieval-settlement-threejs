import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

const output=path.resolve('artifacts/weapon-qa');await fs.mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,channel:'chrome',args:['--enable-unsafe-webgpu','--ignore-gpu-blocklist']});
try{
 const page=await browser.newPage({viewport:{width:1280,height:1000},deviceScaleFactor:1});
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
 await fs.writeFile(path.join(output,'latest-report.json'),JSON.stringify({errors,captures:reports},null,2));
 if(errors.length)throw new Error(errors.join('\n'));
}finally{await browser.close();}
