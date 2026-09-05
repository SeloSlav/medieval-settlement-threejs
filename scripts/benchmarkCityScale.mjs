import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
const label = process.argv[2] ?? 'baseline';
const out = `artifacts/city-performance/${label}`;
mkdirSync(out, { recursive: true });
const server = await createServer({ server: { host: '127.0.0.1', port: 0, hmr: false } });
await server.listen();
let browser;
try {
  browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--enable-unsafe-webgpu'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', e => { if (e.type() === 'error') errors.push(e.text()); });
  await page.route('**/city-scale-probe', r => r.fulfill({ contentType: 'text/html', body: '<html><body></body></html>' }));
  await page.goto(new URL('city-scale-probe', server.resolvedUrls.local[0]).href);
  await page.evaluate(async () => { window.fixture = await (await import('/src/e2e/cityScaleFixture.ts')).createCityScaleFixture(); });
  const results = [];
  for (const counts of (process.argv.includes('--profile') ? [[0,0,500,100]] : [[6,5,0,0], [6,5,60,12], [100,100,0,0], [100,100,200,40], [0,0,500,100], [100,100,500,100]])) {
    console.log('cohort', counts);
    const cdp = process.argv.includes('--profile') ? await page.context().newCDPSession(page) : null;
    if (cdp) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.start'); }
    const result = await page.evaluate(async ({ counts, gpu }) => {
      const f = window.fixture;
      f.configure(...counts);
      const samples = [];
      let last;
      for (let i = 0; i < 160; i++) {
        const time = await new Promise(requestAnimationFrame);
        const start = performance.now();
        const update = f.update(1/60);
        const renderStart = performance.now();
        const gpuHandle = gpu ? f.gpuProfiler.beginFrame(time) : null;
        f.render();
        if (gpuHandle) f.gpuProfiler.endFrame(gpuHandle);
        if (i >= 40) samples.push({ ...update, cpuMs: performance.now() - start, renderMs: performance.now() - renderStart, intervalMs: time - last, timestamp: time });
        last = time;
      }
      return { counts, samples, stats: f.stats(), gpuEvidence: gpu ? f.gpuProfiler.getEvidence() : null,
        gpuTimings: gpu ? samples.map(s=>f.gpuProfiler.getFrameTiming(s.timestamp)) : [] };
    }, { counts, gpu: process.argv.includes('--gpu') });
    results.push(result);
    assert.equal(result.stats.crowd.submittedInstances, counts[2], 'Every requested civilian must remain submitted');
    if (cdp) {
      const { profile } = await cdp.send('Profiler.stop');
      writeFileSync(`${out}/cpu-profile.json`, JSON.stringify(profile));
      const nodes = new Map(profile.nodes.map(n=>[n.id,n]));
      const weights = new Map();
      profile.samples.forEach((id,i) => { const n=nodes.get(id); const key=`${n.callFrame.functionName} ${n.callFrame.url}:${n.callFrame.lineNumber}`; weights.set(key,(weights.get(key)??0)+profile.timeDeltas[i]); });
      console.log('cpu-top', JSON.stringify([...weights].sort((a,b)=>b[1]-a[1]).slice(0,30)));
    }
    await page.screenshot({ path: `${out}/${counts.join('-')}.png` });
    writeFileSync(`${out}/results.json`, JSON.stringify({ results, errors }, null, 2));
    console.log('result', JSON.stringify({ counts, average: Object.fromEntries(Object.keys(result.samples[0]).map(k => [k, result.samples.reduce((s,x) => s+x[k],0)/result.samples.length])), render: result.stats.render, errors }));
  }
  assert.deepEqual(errors, [], 'City fixture must render without browser errors');
} finally { await browser?.close(); await server.close(); }
