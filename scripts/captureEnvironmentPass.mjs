import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const label = process.argv[2] ?? 'baseline';
const baseUrl = process.env.ENVIRONMENT_REVIEW_URL ?? 'http://127.0.0.1:5186';
const out = `artifacts/environment-pass/${label}`;
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--enable-unsafe-webgpu'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const assetOverrides = {};
  if (process.env.ENVIRONMENT_GRASS_ASSET) {
    const grassAsset = readFileSync(process.env.ENVIRONMENT_GRASS_ASSET);
    assetOverrides.grass = { path: process.env.ENVIRONMENT_GRASS_ASSET, sha256: createHash('sha256').update(grassAsset).digest('hex') };
    await page.route('**/assets/textures/vegetation/grass/close-meadow-tuft-greener.png', route => route.fulfill({ body: grassAsset, contentType: 'image/png' }));
  }
  const errors = [];
  page.on('pageerror', error => { errors.push(error.message); console.log('ERROR', error.message); });
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  if (!process.argv.includes('--hamlet')) {
    const url = `${baseUrl}/environment-lineup.html${process.env.ENVIRONMENT_REVIEW_QUERY ?? ''}`;
    console.log('Loading', url);
    const cohortResponse = await fetch(`${baseUrl}/__environment_cohort`);
    if (cohortResponse.headers.get('content-type')?.includes('application/json')) {
      writeFileSync(`${out}/source-cohort.json`, await cohortResponse.text());
    }
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await Promise.race([
      page.waitForFunction(() => window.__ENVIRONMENT_GAUNTLET__, {}, { timeout: 300000 }),
      new Promise((_, reject) => page.once('pageerror', reject)),
    ]);
    writeFileSync(`${out}/survey.json`, JSON.stringify(await page.evaluate(() => window.__ENVIRONMENT_GAUNTLET__.survey), null, 2));
    if (process.env.ENVIRONMENT_GRASS_PAIR) {
      const original = readFileSync('public/assets/textures/vegetation/grass/close-meadow-tuft-greener.png');
      const candidate = readFileSync(process.env.ENVIRONMENT_GRASS_PAIR);
      const pair = { original, candidate };
      const pairViews = (process.env.ENVIRONMENT_VIEWS ?? 'meadow,ground').split(',');
      for (const view of pairViews) for (const [index, arm] of ['original', 'candidate', 'candidate', 'original', 'candidate', 'original'].entries()) {
        await page.evaluate(dataUrl => window.__ENVIRONMENT_GAUNTLET__.setGrassImage(dataUrl), `data:image/png;base64,${pair[arm].toString('base64')}`);
        const { png, ...evidence } = await page.evaluate(view => window.__ENVIRONMENT_GAUNTLET__.capture({ view, sampleCount: 480 }), view);
        const name = `${view}-${index}-${arm}`;
        writeFileSync(`${out}/${name}.json`, JSON.stringify({ ...evidence, textureSha256: createHash('sha256').update(pair[arm]).digest('hex') }, null, 2));
        if (index < 2) writeFileSync(`${out}/${name}.png`, Buffer.from(png.split(',')[1], 'base64'));
        console.log(name, { gpuMs: evidence.gpuMs, frameMs: evidence.frameMs });
      }
      writeFileSync(`${out}/runtime.json`, JSON.stringify({ url, errors }, null, 2));
      if (errors.length) throw new Error(errors.join('\n'));
      await browser.close();
      process.exit(0);
    }
    const captureViews = (process.env.ENVIRONMENT_VIEWS ?? 'strategic,design,edge,ground').split(',');
    const diagnostics = (process.env.ENVIRONMENT_DIAGNOSTICS ?? 'final').split(',');
    for (const diagnostic of diagnostics) for (const view of captureViews) {
      const { png, ...evidence } = await page.evaluate(({ view, diagnostic }) => window.__ENVIRONMENT_GAUNTLET__.capture({ view, diagnostic, sampleCount: 480 }), { view, diagnostic });
      const name = diagnostic === 'final' ? view : `${view}-${diagnostic}`;
      writeFileSync(`${out}/${name}.png`, Buffer.from(png.split(',')[1], 'base64'));
      writeFileSync(`${out}/${name}.json`, JSON.stringify({ ...evidence, assetOverrides }, null, 2));
      console.log(name, { frameMs: evidence.frameMs, gpuMs: evidence.gpuMs, draws: evidence.renderer.calls, triangles: evidence.renderer.triangles });
    }
    writeFileSync(`${out}/runtime.json`, JSON.stringify({ url, errors }, null, 2));
    if (errors.length) throw new Error(errors.join('\n'));
  } else {
  const url = `${baseUrl}/hamlet-fixture.html?clean=1&view=strategic&environmentReview=1`;
  console.log('Loading', url);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => window.__HAMLET_FIXTURE_READY__ || window.__HAMLET_FIXTURE_FAILED__, {}, { timeout: 240000 });
  const boot = await page.evaluate(() => ({ state: window.__HAMLET_FIXTURE_BOOT_STATE__, error: window.__HAMLET_FIXTURE_ERROR__ }));
  writeFileSync(`${out}/boot.json`, JSON.stringify(boot, null, 2));
  if (boot.error) throw new Error(boot.error);
  if (!boot.state.fullVisualSystemsReady) throw new Error(`Incomplete environment: ${JSON.stringify(boot.state.warnings)}`);
  for (const view of ['strategic', 'settlement', 'postcard', 'road-eye', 'forest']) {
    await page.evaluate(view => window.__HAMLET_FIXTURE_SET_VIEW__(view), view);
    await page.waitForTimeout(1800);
    const metrics = await page.evaluate(() => window.__HAMLET_FIXTURE_METRICS__);
    await page.screenshot({ path: `${out}/${view}.png` });
    writeFileSync(`${out}/${view}.json`, JSON.stringify(metrics, null, 2));
    console.log('Captured', view);
  }
  writeFileSync(`${out}/runtime.json`, JSON.stringify({ url, errors }, null, 2));
  if (errors.length) console.log('Runtime errors', errors);
  }
} finally {
  await browser.close();
}
