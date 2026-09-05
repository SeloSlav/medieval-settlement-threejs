import {expect,test} from '@playwright/test';
import {createHash} from 'node:crypto';

const checksum=(image:Buffer)=>createHash('sha256').update(image).digest('hex');

for(const profile of ['river','inland','coastal'])test(`${profile}: optics compile, paused waves stop, and framebuffer copies stay bounded`,async({page})=>{
  const errors:string[]=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error'&&!m.location().url.endsWith('/favicon.ico'))errors.push(m.text());});
  await page.goto(`/water-gauntlet.html?profile=${profile}&clean=1&play=0`);
  await page.waitForFunction(()=>Boolean((window as any).__WATER_GAUNTLET__));
  const final=await page.evaluate(async()=>((window as any).__WATER_GAUNTLET__).capture({time:6.25,debug:'final'}));
  expect(final.framebufferCopies).toEqual({color:1,depth:1});
  expect(final.renderer.compute.frameCalls).toBe(0);
  expect(final.renderer.render.drawCalls).toBeGreaterThan(0);
  const original=await page.screenshot();
  expect(original.length).toBeGreaterThan(80000);
  await page.evaluate(async()=>((window as any).__WATER_GAUNTLET__).capture({time:6.25,debug:'normal'}));
  expect(checksum(await page.screenshot())).not.toEqual(checksum(original));
  await page.evaluate(async()=>((window as any).__WATER_GAUNTLET__).capture({time:6.25,debug:'final'}));
  const restored=await page.screenshot();
  const difference=await page.evaluate(async([a,b])=>{
    const decode=async(base64:string)=>{
      const bitmap=await createImageBitmap(await(await fetch(`data:image/png;base64,${base64}`)).blob());
      const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;
      const ctx=canvas.getContext('2d')!;ctx.drawImage(bitmap,0,0);bitmap.close();
      return ctx.getImageData(0,0,canvas.width,canvas.height).data;
    };
    const x=await decode(a),y=await decode(b);let sum=0,peak=0;
    for(let i=0;i<x.length;i++){const d=Math.abs(x[i]!-y[i]!);sum+=d;peak=Math.max(peak,d);}
    return {mean:sum/x.length,peak};
  },[original.toString('base64'),restored.toString('base64')]);
  // Recompiling a diagnostic variant may round an isolated channel by 1 LSB.
  // A changed field, stale framebuffer, or drifting wave pose exceeds this.
  expect(difference.mean).toBeLessThan(0.001);
  expect(difference.peak).toBeLessThanOrEqual(1);
  await page.evaluate(async()=>((window as any).__WATER_GAUNTLET__).capture({time:6.25,rain:1}));
  expect(checksum(await page.screenshot())).not.toEqual(checksum(original));
  await page.evaluate(async()=>((window as any).__WATER_GAUNTLET__).capture({time:6.25,night:1}));
  expect(checksum(await page.screenshot())).not.toEqual(checksum(original));
  expect(errors).toEqual([]);
});
