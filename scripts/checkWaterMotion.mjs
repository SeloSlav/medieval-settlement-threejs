import {chromium} from '@playwright/test';
import {mkdirSync,writeFileSync} from 'node:fs';
const out=`water-gauntlet-evidence/${process.argv[2] ?? 'motion-final'}`;
mkdirSync(out,{recursive:true});
const origin=process.env.WATER_GAUNTLET_ORIGIN??'http://127.0.0.1:5186';
const browser=await chromium.launch({channel:'msedge',headless:true,args:['--enable-unsafe-webgpu']});
try{
 const page=await browser.newPage({viewport:{width:1280,height:720}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 page.on('console',m=>{if(m.type()==='error'&&!m.location().url.endsWith('/favicon.ico'))errors.push(m.text());});
 const selected=process.argv.find(a=>a.startsWith('--profile='))?.split('=')[1];
 for(const profile of (selected?[selected]:['river','inland','coastal'])){
  await page.goto(`${origin}/water-gauntlet.html?profile=${profile}&production=1&clean=1&play=0`);
  await page.waitForFunction(()=>window.__WATER_GAUNTLET__,{},{timeout:120000});
  for(const [label,time] of [['before',6.2166667],['wrap-left',6.2333333],['wrap',6.25],['wrap-right',6.2666667],['after',6.2833333],['later',8.25]]){
   await page.evaluate(time=>window.__WATER_GAUNTLET__.capture({time,debug:'final',view:'near'}),time);
   if(errors.length)throw new Error(errors.join('\n'));
   await page.screenshot({path:`${out}/${profile}-${label}.png`});
  }
  for(const debug of ['normal','reflection','refraction','caustics','velocity','foam-field','shore']){
   await page.evaluate(debug=>window.__WATER_GAUNTLET__.capture({time:6.25,debug}),debug);
   await page.screenshot({path:`${out}/${profile}-${debug}.png`});
  }
  await page.evaluate(()=>window.__WATER_GAUNTLET__.capture({time:6.25,debug:'final',rain:1}));
  await page.screenshot({path:`${out}/${profile}-rain.png`});
  await page.evaluate(()=>window.__WATER_GAUNTLET__.capture({time:6.25,night:1}));
  await page.screenshot({path:`${out}/${profile}-night.png`});
  if(process.argv.includes('--video')){
   await page.evaluate(()=>window.__WATER_GAUNTLET__.capture({time:5.5,night:0,rain:0}));
   await page.evaluate(()=>window.__WATER_GAUNTLET__.play(true));
   const bytes=await page.evaluate(async()=>{
    const canvas=document.querySelector('canvas'),stream=canvas.captureStream(30);
    const recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp9',videoBitsPerSecond:8_000_000}),chunks=[];
    recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
    const stopped=new Promise(resolve=>{recorder.onstop=resolve;});recorder.start();
    await new Promise(resolve=>setTimeout(resolve,5000));recorder.stop();await stopped;
    stream.getTracks().forEach(track=>track.stop());
    return Array.from(new Uint8Array(await new Blob(chunks,{type:'video/webm'}).arrayBuffer()));
   });
   writeFileSync(`${out}/${profile}.webm`,Buffer.from(bytes));
  }
  const evidence=await page.evaluate(()=>window.__WATER_GAUNTLET__.evidence());
  writeFileSync(`${out}/${profile}.json`,JSON.stringify({...evidence,errors,performanceValid:false,reason:'Screenshots and video recording are visual evidence only.'},null,2));
  console.log(profile,'motion, optical passes, rain and night captured');
 }
 if(errors.length)throw new Error(errors.join('\n'));
}finally{await browser.close();}
