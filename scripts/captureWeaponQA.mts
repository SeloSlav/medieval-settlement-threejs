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
 const modelFlag=process.argv.indexOf('--male-model');
 if(modelFlag>=0){
  const body=await fs.readFile(process.argv[modelFlag+1]!);
  await page.route('**/worker-male-common-01-v002.glb',route=>route.fulfill({contentType:'model/gltf-binary',body}));
 }
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
  const sequence=process.argv.includes('--melee')
   ? [...new Map(options.map(({name,phase,view,...state}:any)=>[JSON.stringify([state.unit,state.variant,state.weapon,state.mode]),state])).values()].map((state:any)=>({state,seconds:state.mode==='defend'?2:4}))
   : [['bow',5],['spear',4],['sidearm',4],['halberd',4],['crossbow',7]].map(([weapon,seconds])=>({state:{unit:'on-foot',weapon,variant:'man',mode:'attack'},seconds}));
  for(const {state,seconds} of sequence){
   const label=[state.unit,state.variant,state.weapon,state.mode].join('-');
   await page.evaluate(state=>(window as any).weaponReview.set({...state,view:'front',phase:.56,standard:false,paused:false}),state);
   const first=await page.evaluate(()=>(window as any).weaponReview.stats());
   await page.waitForTimeout(seconds*1000);
   const last=await page.evaluate(()=>(window as any).weaponReview.stats());
   await page.screenshot({path:path.join(output,`${caseName}-motion-${label}.png`)});
   motion.push({state,seconds,frames:last.frame-first.frame,firstPhase:first.state.phase,lastPhase:last.state.phase,errors:last.errors});
   console.log(`Motion: ${label}, ${last.frame-first.frame} frames / ${seconds}s`);
  }
  await fs.writeFile(path.join(output,`${caseName}-motion-report.json`),JSON.stringify(motion,null,2));
  const video=page.video();await page.close();await video?.saveAs(path.join(output,`${caseName}.webm`));
 }
 if(process.argv.includes('--sheet')){
  const sheetPage=await browser.newPage({viewport:{width:1440,height:790}});
  for(let start=0;start<reports.length;start+=6){
   const tiles=await Promise.all(reports.slice(start,start+6).map(async r=>`<figure><img src="data:image/png;base64,${(await fs.readFile(path.join(output,r.file))).toString('base64')}"><figcaption>${r.file}</figcaption></figure>`));
   await sheetPage.setContent(`<style>body{margin:0;background:#bbc5cc;display:grid;grid-template-columns:repeat(3,1fr);font:12px sans-serif}figure{margin:0}img{width:480px;height:375px}figcaption{height:20px;text-align:center}</style>${tiles.join('')}`);
   await sheetPage.screenshot({path:path.join(output,`${caseName}-sheet-${Math.floor(start/6)+1}.png`)});
  }
 }
 if(errors.length)throw new Error(errors.join('\n'));
}finally{await browser.close();}
