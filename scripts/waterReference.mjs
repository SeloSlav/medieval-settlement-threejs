import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { createReadStream, statSync, mkdirSync, writeFileSync } from 'node:fs';
const video = 'C:/Users/Asus/Downloads/ssstwitter.com_1788618161209.mp4';
const out = 'water-gauntlet-evidence';
mkdirSync(out, { recursive: true });
const server = createServer((req, res) => {
  if (req.url !== '/reference.mp4') { res.setHeader('Content-Type','text/html'); res.end('<video muted src="/reference.mp4"></video>'); return; }
  const size = statSync(video).size;
  const range = req.headers.range;
  if (range) {
    const [a, b] = range.replace('bytes=', '').split('-');
    const start = Number(a), end = b ? Number(b) : size - 1;
    res.writeHead(206, { 'Content-Type': 'video/mp4', 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes' });
    createReadStream(video, { start, end }).pipe(res);
  } else { res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': size }); createReadStream(video).pipe(res); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--enable-unsafe-webgpu'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => document.querySelector('video').readyState >= 2);
  const meta = await page.evaluate(() => { const v=document.querySelector('video'); return { duration: v.duration, width:v.videoWidth, height:v.videoHeight }; });
  writeFileSync(`${out}/reference.json`, JSON.stringify(meta,null,2));
  console.log(meta);
  for (let i=0;i<9;i++) {
    const t = 0.5 + i*(meta.duration-1)/8;
    const data = await page.evaluate(async t => {
      const v=document.querySelector('video'); v.currentTime=t;
      await new Promise(r=>v.addEventListener('seeked',r,{once:true}));
      const c=document.createElement('canvas'); c.width=960; c.height=Math.round(v.videoHeight*960/v.videoWidth);
      c.getContext('2d').drawImage(v,0,0,c.width,c.height);return c.toDataURL('image/png').split(',')[1];
    },t);
    writeFileSync(`${out}/reference-${i}.png`,Buffer.from(data,'base64'));
  }
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:5186/river-lineup.html?view=near&time=6.25&clean=1');
  await page.waitForFunction(()=>window.__KUPA_RIVER_LINEUP_READY__,{},{timeout:120000});
  for(const view of ['near','design','far']) {
    const evidence=await page.evaluate(view=>window.__KUPA_RIVER_LINEUP_CAPTURE__({view}),view);
    await page.screenshot({path:`${out}/baseline-${view}.png`});
    writeFileSync(`${out}/baseline-${view}.json`, JSON.stringify({ ...evidence,errors },null,2));
    console.log(view,evidence.renderer,evidence.performance);
  }
} finally { await browser.close(); server.close(); }
