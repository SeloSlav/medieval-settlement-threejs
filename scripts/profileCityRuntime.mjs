import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const output = 'artifacts/city-performance';
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--enable-unsafe-webgpu'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', e => { errors.push(e.message); console.log('pageerror', e.message); });
page.on('console', e => { if (e.type() === 'error') errors.push(e.text()); });
await page.route('**/src/main.ts*', async route => {
  const response = await route.fetch();
  const body = (await response.text()).replace('const app = new App(root);', 'const app = new App(root); window.__cityApp = app;');
  await route.fulfill({ response, body });
});
try {
  await page.goto('http://127.0.0.1:5173/?visualQa=daylight&visualProfile=1', { timeout: 120000 });
  await page.getByRole('button', { name: /Continue to Heraldry/ }).click();
  await page.getByRole('button', { name: /Continue to Map Generation/ }).click();
  await page.getByRole('button', { name: 'Start world', exact: true }).click();
  for (let i = 0; i < 90; i++) {
    const state = await page.evaluate(() => ({ ready: !!window.__visualPerf, loading: document.querySelector('[data-loading-label]')?.textContent }));
    if (state.ready) break;
    if (i % 5 === 0) console.log('loading', JSON.stringify(state));
    await page.waitForTimeout(2000);
  }
  const state = await page.evaluate(() => {
    const app = window.__cityApp;
    return {
      appKeys: Object.keys(app),
      stats: app.sceneManager?.getPerformanceStats(),
      adapter: app.sceneManager?.getRendererAdapterEvidence(),
      buildings: [...(app.gameState?.buildings.values() ?? [])],
      residences: [...(app.gameState?.residences.values() ?? [])],
      villagersKeys: app.villagers && Object.keys(app.villagers),
      cameraKeys: Object.keys(app.cameraController ?? {}),
      sceneKeys: Object.keys(app.sceneManager ?? {}),
      report: window.__visualPerf?.getReport(),
    };
  });
  writeFileSync(`${output}/initial-runtime.json`, JSON.stringify({ ...state, errors }, null, 2));
  await page.screenshot({ path: `${output}/initial-runtime.png` });
  console.log('ready', JSON.stringify({ stats: state.stats, buildings: state.buildings.length, residences: state.residences.length, errors }));
} finally {
  await browser.close();
}
