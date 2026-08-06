import { expect, test } from '@playwright/test';

const STARTING_TIMBER = 160;
const REFORESTER_TIMBER_COST = 35;
const STARTUP_TIMEOUT_MS = 90_000;
const SYNC_TIMEOUT_MS = 45_000;

test('connects, places a reforester, and updates settlement HUD timber', async ({ page }) => {
  await page.goto('/?new');

  const timberHud = page.locator('[data-stockpile="timber"]');
  const startWorld = page.getByRole('button', { name: 'Start world' });
  await startWorld.click();
  await expect.poll(
    () => page.evaluate(() => (window.__medievalE2e?.getRendererStats().frames ?? 0) > 0),
    { timeout: STARTUP_TIMEOUT_MS },
  ).toBe(true);
  const rendererStats = await page.evaluate(() => window.__medievalE2e!.getRendererStats());
  expect(rendererStats.backend).toBe('webgl2-node');
  await expect.poll(
    () => page.evaluate(() => window.__medievalE2e?.isConnected() === true),
    { timeout: STARTUP_TIMEOUT_MS },
  ).toBe(true);
  await expect(timberHud).toHaveText(String(STARTING_TIMBER), { timeout: STARTUP_TIMEOUT_MS });
  await expect(page.locator('#app-loading:not(.is-dismissed)')).toHaveCount(0, {
    timeout: STARTUP_TIMEOUT_MS,
  });
  const starterCamp = page.getByRole('button', { name: /Place starter camp/ });
  await expect(starterCamp).toBeVisible({ timeout: SYNC_TIMEOUT_MS });
  const welcomeTutorial = page.getByRole('dialog', { name: 'Begin Your Settlement' });
  await expect(welcomeTutorial).toBeVisible({ timeout: SYNC_TIMEOUT_MS });
  await welcomeTutorial.getByRole('button', { name: 'Got it' }).click();
  await starterCamp.click();
  await expect.poll(
    () => page.evaluate(() => window.__medievalE2e?.getBuildingMode()),
    { timeout: SYNC_TIMEOUT_MS },
  ).toBe('founders_camp');
  await page.evaluate(async () => {
    await window.__medievalE2e!.placeFoundersCampAtFirstValidSpot();
  });
  await expect.poll(
    () => page.evaluate(() => window.__medievalE2e?.getBuildingCount() ?? 0),
    { timeout: SYNC_TIMEOUT_MS },
  ).toBeGreaterThanOrEqual(1);
  await expect(starterCamp).toBeHidden({ timeout: SYNC_TIMEOUT_MS });
  const startup = await page.evaluate(() => window.__medievalRoadStartup);
  expect(startup?.settlementPresentationReadyMs).toBeGreaterThan(0);
  expect(startup?.firstPlayableMs).toBeGreaterThanOrEqual(
    startup?.settlementPresentationReadyMs ?? Number.POSITIVE_INFINITY,
  );
  console.log(
    `startup: presentation ${startup?.settlementPresentationReadyMs} ms, `
      + `first playable ${startup?.firstPlayableMs} ms`,
  );

  await page.keyboard.press('v');
  await page.keyboard.press('f');
  await expect.poll(
    () => page.evaluate(() => window.__medievalE2e?.getBuildingMode()),
    { timeout: STARTUP_TIMEOUT_MS },
  ).toBe('reforester');

  const timberBefore = Number(await timberHud.textContent());
  expect(timberBefore).toBe(STARTING_TIMBER);

  await page.evaluate(async () => {
    await window.__medievalE2e!.placeRforesterAtFirstValidSpot();
  });

  await expect(timberHud).toHaveText(String(timberBefore - REFORESTER_TIMBER_COST), { timeout: SYNC_TIMEOUT_MS });
  const totalsMode = page.locator('button[data-resource-totals-mode]');
  await expect(totalsMode).toHaveAttribute(
    'aria-label',
    'Showing surplus goods. Show total goods stored.',
  );
  await totalsMode.hover();
  const tooltip = page.locator('#ui-tooltip');
  await expect(tooltip.locator('.ui-tooltip__title')).toHaveText('Surplus goods');
  await expect(tooltip.locator('.ui-tooltip__label')).toHaveCount(0);
  await totalsMode.click();
  await expect(timberHud).toHaveText(String(timberBefore));
  await expect(totalsMode).toHaveAttribute(
    'aria-label',
    'Showing total goods stored. Show surplus goods.',
  );
  await expect(tooltip.locator('.ui-tooltip__title')).toHaveText('Total goods');
  await expect(tooltip.locator('.ui-tooltip__body')).toContainText(
    'All stored goods',
  );
  await totalsMode.click();
  await expect(timberHud).toHaveText(String(timberBefore - REFORESTER_TIMBER_COST));
  await expect(tooltip.locator('.ui-tooltip__title')).toHaveText('Surplus goods');
  await expect(tooltip.locator('.ui-tooltip__body')).toContainText(
    'Stored goods available for use',
  );
  await expect.poll(
    () => page.evaluate(() => window.__medievalE2e?.getBuildingCount() ?? 0),
    { timeout: SYNC_TIMEOUT_MS },
  ).toBeGreaterThanOrEqual(1);
});

declare global {
  interface Window {
    __medievalRoadStartup?: {
      firstPlayableMs?: number;
      settlementPresentationReadyMs?: number;
    };
    __medievalE2e?: {
      isConnected: () => boolean;
      getRendererStats: () => { backend: string; frames: number; calls: number; triangles: number };
      getBuildingMode: () => string;
      getHudTimber: () => string;
      getBuildingCount: () => number;
      placeFoundersCampAtFirstValidSpot: () => Promise<{ x: number; z: number }>;
      placeRforesterAtFirstValidSpot: () => Promise<{ x: number; z: number }>;
    };
  }
}
