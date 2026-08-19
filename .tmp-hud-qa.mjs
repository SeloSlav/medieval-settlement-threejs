import { chromium } from '@playwright/test';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });

await page.goto('http://127.0.0.1:5173/?new', { waitUntil: 'domcontentloaded', timeout: 60_000 });
const continueToMap = page.getByRole('button', { name: /Continue to Map Setup/ });
if (await continueToMap.isVisible().catch(() => false)) {
  await continueToMap.click();
}
const startWorld = page.getByRole('button', { name: 'Start world' });
await startWorld.waitFor({ state: 'visible', timeout: 60_000 });
await startWorld.click();
await page.locator('[data-settlement-hud]').waitFor({ state: 'visible', timeout: 120_000 });
await page.locator('#app-loading.is-dismissed').waitFor({ state: 'attached', timeout: 120_000 }).catch(() => {});
await page.waitForTimeout(4_000);

const layout = await page.evaluate(() => {
  const box = (selector) => {
    const element = document.querySelector(selector);
    if (!(element instanceof HTMLElement)) return null;
    const rect = element.getBoundingClientRect();
    return {
      left: Math.round(rect.left),
      top: Math.round(rect.top),
      right: Math.round(rect.right),
      bottom: Math.round(rect.bottom),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
  };
  return {
    hud: box('[data-settlement-hud]'),
    vitals: box('[data-settlement-vitals]'),
    clock: box('[data-settlement-clock]'),
    speeds: box('.settlement-hud__speed'),
    dock: box('[data-construction-dock]'),
    noble: box('[data-noble-hud]'),
    walkBadgeCount: document.querySelectorAll('[data-fp-mode-panel]').length,
  };
});

console.log(JSON.stringify(layout, null, 2));
await page.screenshot({ path: '.tmp-hud-qa.png', fullPage: true });
await browser.close();
