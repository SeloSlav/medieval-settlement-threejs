import { expect, test } from '@playwright/test';

const STARTING_TIMBER = 160;
const REFORESTER_TIMBER_COST = 35;
const STARTUP_TIMEOUT_MS = 90_000;
const SYNC_TIMEOUT_MS = 45_000;

test('keeps at least three specialty digits visible before truncation', async ({ page }) => {
  await page.setContent(`
    <div class="settlement-hud">
      <div
        class="settlement-hud__stores-grid"
        style="position: static; grid-template-columns: 70px; width: max-content"
      >
        <div
          class="settlement-hud__stat settlement-hud__stat--store"
          data-resource="ironwork"
        >
          <strong class="settlement-hud__value" data-stockpile="ironwork">999</strong>
        </div>
      </div>
    </div>
  `);
  await page.addStyleTag({ path: 'src/ui/settlementHud.css' });
  await page.addStyleTag({ path: 'src/ui/polishedGameUi.css' });
  await page.addStyleTag({ path: 'src/ui/iconography.css' });

  const ironworkValue = page.locator('[data-stockpile="ironwork"]');
  await expect(ironworkValue).toHaveText('999');
  await expect.poll(() => ironworkValue.evaluate((element) => (
    element.scrollWidth > element.clientWidth
  ))).toBe(false);
  await ironworkValue.evaluate((element) => {
    element.textContent = '999999';
  });
  await expect.poll(() => ironworkValue.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      clipped: element.scrollWidth > element.clientWidth,
      overflowX: style.overflowX,
      textOverflow: style.textOverflow,
      whiteSpace: style.whiteSpace,
    };
  })).toEqual({
    clipped: true,
    overflowX: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  });
});

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
  const foundingPopulationStats = page.locator('[data-founding-population-stat]');
  await expect(foundingPopulationStats).toHaveCount(3);
  for (const stat of await foundingPopulationStats.all()) {
    await expect(stat).toBeHidden();
  }
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
  for (const stat of await foundingPopulationStats.all()) {
    await expect(stat).toBeVisible();
  }
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
  const foodStores = page.locator('[data-food-stores]');
  const foodSummary = foodStores.locator('> summary');
  await foodSummary.hover();
  await expect(foodStores).toHaveAttribute('open', '');
  await expect(page.locator('#ui-tooltip')).toBeHidden();
  const foodGrid = foodStores.locator('[data-food-breakdown]');
  const foodSummaryBox = await foodSummary.boundingBox();
  const foodGridBox = await foodGrid.boundingBox();
  expect(foodSummaryBox).not.toBeNull();
  expect(foodGridBox).not.toBeNull();
  await page.mouse.move(
    Math.min(foodSummaryBox!.x + foodSummaryBox!.width / 2, foodGridBox!.x + foodGridBox!.width - 1),
    (foodSummaryBox!.y + foodSummaryBox!.height + foodGridBox!.y) / 2,
  );
  await page.waitForTimeout(250);
  await expect(foodStores).toHaveAttribute('open', '');
  await page.locator('[data-food-resource="ryeBread"]').hover();
  await expect(page.locator('#ui-tooltip .ui-tooltip__title')).toHaveText('Rye bread');
  await timberHud.hover();
  await expect(foodStores).not.toHaveAttribute('open', '');
  await totalsMode.hover();
  const tooltip = page.locator('#ui-tooltip');
  await expect(tooltip.locator('.ui-tooltip__title')).toHaveText('Surplus goods (default)');
  await expect(tooltip.locator('.ui-tooltip__label')).toHaveCount(0);
  const specialtyStores = page.locator('[data-specialty-stores]');
  const specialtySummary = specialtyStores.locator('> summary');
  await specialtySummary.hover();
  await expect(specialtyStores).toHaveAttribute('open', '');
  const specialtyGrid = specialtyStores.locator('> .settlement-hud__stores-grid');
  const specialtySummaryBox = await specialtySummary.boundingBox();
  const specialtyGridBox = await specialtyGrid.boundingBox();
  expect(specialtySummaryBox).not.toBeNull();
  expect(specialtyGridBox).not.toBeNull();
  await page.mouse.move(
    Math.min(
      specialtySummaryBox!.x + specialtySummaryBox!.width / 2,
      specialtyGridBox!.x + specialtyGridBox!.width - 1,
    ),
    (specialtySummaryBox!.y + specialtySummaryBox!.height + specialtyGridBox!.y) / 2,
  );
  await page.waitForTimeout(250);
  await expect(specialtyStores).toHaveAttribute('open', '');
  const ironworkValue = page.locator('[data-stockpile="ironwork"]');
  await expect(ironworkValue).toHaveText('9000');
  await ironworkValue.hover();
  await expect(tooltip.locator('.ui-tooltip__title')).toHaveText('Ironwork');
  await expect(tooltip.locator('.ui-tooltip__amount-label')).toHaveText('Available surplus');
  await expect(tooltip.locator('.ui-tooltip__amount-value')).toHaveText('9,000');
  const ironworkTooltipParagraphs = tooltip.locator('.ui-tooltip__paragraph');
  await expect(ironworkTooltipParagraphs).toHaveCount(1);
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
  await ironworkValue.hover();
  await expect(tooltip.locator('.ui-tooltip__amount-label')).toHaveText('Total stored');
  await expect(tooltip.locator('.ui-tooltip__amount-value')).toHaveText('9,000');
  await expect(ironworkTooltipParagraphs).toHaveCount(1);
  await totalsMode.click();
  await expect(timberHud).toHaveText(String(timberBefore - REFORESTER_TIMBER_COST));
  await expect(tooltip.locator('.ui-tooltip__title')).toHaveText('Surplus goods (default)');
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
