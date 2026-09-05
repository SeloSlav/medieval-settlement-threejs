import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from '@playwright/test';
const browser=await chromium.launch({headless:true,channel:'chrome',args:['--enable-unsafe-webgpu','--ignore-gpu-blocklist']});
const live=process.argv.includes('--live');
try{
 const page=await browser.newPage({viewport:{width:1280,height:1000},deviceScaleFactor:1});
 const errors:string[]=[],models:string[]=[];
 page.on('pageerror',e=>errors.push(e.message));
 page.on('response',r=>{if(r.url().endsWith('.glb'))models.push(r.url());});
 await page.goto(`http://127.0.0.1:5175/artifacts/${live?'weapon-review':'elbow-alignment-review'}.html?weapon=crossbow&mode=walk&view=left-front&play=1`);
 await page.waitForFunction(()=>Boolean((window as any).weaponReview?.stats().ready),null,{timeout:60000});
 assert.ok(models.some(url=>url.endsWith('/worker-male-common-01-v002.glb')),'Review must load the live model');
 assert.ok(await page.evaluate(()=>Boolean((window as any).weaponReview.rig().combatRig.armBones.leftHand.userData.militaryGripOrigin)),'Live model must contain the reviewed left-arm correction');
 const motion=[];
 for(const [weapon,mode] of [['crossbow','walk'],['crossbow','attack'],['bow','walk'],['bow','attack'],['sidearm-shield','walk'],['sidearm-shield','attack']]){
  const first=await page.evaluate(s=>(window as any).weaponReview.set({...s,variant:'man',view:'left-front',phase:0,paused:false}),{weapon,mode});
  await page.waitForTimeout(3500);
  const last=await page.evaluate(()=>(window as any).weaponReview.stats());
  assert.ok(last.frame>first.frame+10,`${weapon}/${mode}: animation must progress`);
  assert.deepEqual(last.errors,[]);
  await page.screenshot({path:`artifacts/weapon-qa/alignment-review-${weapon}-${mode}.png`});
  motion.push({weapon,mode,frames:last.frame-first.frame,errors:last.errors});
  console.log(`${weapon}/${mode}: ${last.frame-first.frame} frames, ${last.errors.length} errors`);
 }
 assert.deepEqual(errors,[]);
 await fs.writeFile('artifacts/weapon-qa/alignment-review-motion.json',JSON.stringify({models,errors,motion},null,2));
}finally{await browser.close();}
