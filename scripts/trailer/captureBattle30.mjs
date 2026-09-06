import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const output = path.resolve('artifacts/trailer/battle-30s');
await mkdir(output, { recursive: true });
const shot = process.argv.find(arg => arg.startsWith('--shot='))?.slice(7);
const context = await chromium.launchPersistentContext(path.resolve('.tmp/battle30-chrome'), {
  headless: true, channel: 'chrome', viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1,
  args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--remote-debugging-port=9226'],
});
const page = context.pages()[0];
const errors = [];
page.on('pageerror', e => { errors.push(e.message); console.error('PAGE ERROR:', e.message); });
await page.addInitScript(() => localStorage.setItem('selo-empire.skip-tutorials.v1', '1'));
// Keep source edits for the editor from interrupting a recording already underway.
await page.routeWebSocket(url => url.pathname === '/' && url.search.includes('token='), ws => ws.close());
await page.goto(`http://localhost:5176/?trailer=1&produce=battle30${shot ? '&shot=' + shot : ''}`, { waitUntil: 'domcontentloaded' });
console.log('Loading the current game and director…');
let previous = '';
const started = Date.now();
try {
  while (Date.now() - started < 60 * 60 * 1000) {
    const status = await page.locator('#trailer-status').textContent({ timeout: 1000 }).catch(() => 'Loading renderer…');
    if (status !== previous) { console.log(status); previous = status; }
    if (status?.includes('30-second battle footage complete')) break;
    if (status?.startsWith('Error:')) throw new Error(status);
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
  await page.screenshot({ path: path.join(output, 'studio-last-frame.png') });
  await writeFile(path.join(output, 'browser-errors.json'), JSON.stringify(errors, null, 2));
  if (!previous?.includes('30-second battle footage complete')) throw new Error('The recording did not complete');
} finally {
  await writeFile(path.join(output, 'capture-run.json'), JSON.stringify({
    capturedAt: new Date().toISOString(), requestedShots: shot ?? 'all',
    completed: previous?.includes('30-second battle footage complete') ?? false,
    lastStatus: previous, errors,
  }, null, 2));
  await context.close();
}
