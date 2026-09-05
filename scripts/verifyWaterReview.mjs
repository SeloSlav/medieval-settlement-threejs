import {chromium} from '@playwright/test';
import {writeFileSync} from 'node:fs';
const origin=process.env.WATER_GAUNTLET_ORIGIN??'http://127.0.0.1:5204';
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],videos=[];
 page.on('pageerror',e=>errors.push(e.message));
 page.on('response',r=>{if(r.status()>=400)errors.push(`${r.status()} ${r.url()}`);});
 await page.goto(`${origin}/water-gauntlet-evidence/review.html`);
 for(const profile of ['river','inland','coastal']){
  await page.locator(`[data-profile="${profile}"]`).click();
  await page.evaluate(()=>{for(const image of document.querySelectorAll('img'))image.loading='eager';});
  await page.waitForFunction(()=>[...document.images].every(i=>i.complete&&i.naturalWidth>0));
  await page.waitForFunction(()=>document.querySelector('#current').readyState>=1);
  await page.evaluate(()=>document.querySelector('#current').play());
  await page.waitForFunction(()=>document.querySelector('#current').currentTime>0.1);
  videos.push(await page.evaluate(profile=>{
   const v=document.querySelector('#current');v.pause();
   return {profile,width:v.videoWidth,height:v.videoHeight,duration:Number.isFinite(v.duration)?v.duration:'unknown',decodedFrames:v.getVideoPlaybackQuality().totalVideoFrames};
  },profile));
 }
 await page.locator('[data-profile="river"]').click();
 await page.waitForFunction(()=>document.querySelector('#current').currentSrc.endsWith('/river.webm')&&document.querySelector('#current').readyState>=2);
 await page.waitForFunction(()=>[...document.images].every(i=>i.complete&&i.naturalWidth>0));
 await page.evaluate(()=>document.querySelector('video').play());
 await page.waitForFunction(()=>document.querySelector('video').currentTime>0.1);
 await page.evaluate(()=>document.querySelector('video').pause());
 await page.evaluate(()=>document.querySelector('#current').play());
 await page.waitForFunction(()=>document.querySelector('#current').currentTime>0.1);
 await page.evaluate(()=>document.querySelector('#current').pause());
 await page.screenshot({path:'water-gauntlet-evidence/review.png'});
 if(errors.length)throw new Error(errors.join('\n'));
 writeFileSync('water-gauntlet-evidence/review-check.json',JSON.stringify({videos,errors},null,2));
 console.log(JSON.stringify({videos,errors}));
}finally{await browser.close();}
