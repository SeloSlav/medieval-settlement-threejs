import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const label = process.argv[2] ?? 'baseline';
const baseUrl = process.env.ENVIRONMENT_REVIEW_URL ?? 'http://127.0.0.1:5186';
const out = `artifacts/environment-pass/${label}`;
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--enable-unsafe-webgpu'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', error => { errors.push(error.message); console.log('ERROR', error.message); });
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  if (!process.argv.includes('--hamlet')) {
    const url = `${baseUrl}/environment-lineup.html${process.env.ENVIRONMENT_REVIEW_QUERY ?? ''}`;
    console.log('Loading', url);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await Promise.race([
      page.waitForFunction(() => window.__ENVIRONMENT_GAUNTLET__, {}, { timeout: 300000 }),
      new Promise((_, reject) => page.once('pageerror', reject)),
    ]);
    writeFileSync(`${out}/survey.json`, JSON.stringify(await page.evaluate(() => window.__ENVIRONMENT_GAUNTLET__.survey), null, 2));
    for (const view of ['strategic', 'design', 'edge', 'ground']) {
      const { png, ...evidence } = await page.evaluate(view => window.__ENVIRONMENT_GAUNTLET__.capture({ view }), view);
      writeFileSync(`${out}/${view}.png`, Buffer.from(png.split(',')[1], 'base64'));
      writeFileSync(`${out}/${view}.json`, JSON.stringify(evidence, null, 2));
      console.log(view, { frameMs: evidence.frameMs, gpuMs: evidence.gpuMs, draws: evidence.renderer.calls, triangles: evidence.renderer.triangles });
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
