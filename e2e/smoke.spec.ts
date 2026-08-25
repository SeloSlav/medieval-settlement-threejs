import { expect, test, type Page } from '@playwright/test';
import {
  HUD_RESOURCE_KINDS,
  type HudResourceKind,
} from '../src/resources/resourceTotals.ts';
import { RESOURCE_COST_KINDS } from '../src/ui/resourceCost.ts';

const STARTING_TIMBER = 160;
const REFORESTER_TIMBER_COST = 35;
const STARTING_POPULATION = 10;
const STARTUP_TIMEOUT_MS = 90_000;
const SYNC_TIMEOUT_MS = 45_000;
const CORE_HUD_RESOURCE_KINDS = new Set<HudResourceKind>([
  'timber',
  'stone',
  'firewood',
  'water',
  'food',
  'gold',
  'charcoal',
]);
const EXPECTED_PROVISION_RESOURCE_KINDS = HUD_RESOURCE_KINDS.filter(
  (resource) => !CORE_HUD_RESOURCE_KINDS.has(resource),
);

type ProvisionValueSnapshot = {
  resource: string;
  displayedAmount: string;
  tooltipAmount: string;
  tooltipAmountLabel: string;
  isEmpty: boolean;
};

async function advanceToMapGeneration(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { name: 'Choose Your Legacy' })).toBeVisible();
  await page.getByRole('button', { name: /Continue to Heraldry/ }).click();
  await expect(page.getByRole('heading', { name: 'Design Your Heraldry' })).toBeVisible();
  await page.getByRole('button', { name: /Continue to Map Generation/ }).click();
  await expect(page.locator('[data-setup-progress="map"]')).toBeVisible();
}

async function expectProvisionValuesToMatchTooltips(
  page: Page,
  expectedAmountLabel: string,
): Promise<ProvisionValueSnapshot[]> {
  const snapshots = await page
    .locator('[data-specialty-stores] [data-resource]')
    .evaluateAll((rows) => rows.map((row) => {
      const stat = row as HTMLElement;
      const value = stat.querySelector<HTMLElement>('[data-stockpile]');
      return {
        resource: stat.dataset.resource ?? '',
        displayedAmount: value?.textContent?.trim() ?? '',
        tooltipAmount: stat.dataset.tooltipAmount ?? '',
        tooltipAmountLabel: stat.dataset.tooltipAmountLabel ?? '',
        isEmpty: stat.classList.contains('is-empty'),
      };
  }));

  const numericAmount = (amount: string): number => Number(amount.replace(/[^\d.-]/g, ''));
  expect(snapshots.map(({ resource }) => resource).sort()).toEqual(
    [...EXPECTED_PROVISION_RESOURCE_KINDS].sort(),
  );
  expect(
    snapshots.filter(({ tooltipAmountLabel }) => tooltipAmountLabel !== expectedAmountLabel),
  ).toEqual([]);
  expect(
    snapshots.filter(({ displayedAmount, tooltipAmount }) => (
      numericAmount(displayedAmount) !== numericAmount(tooltipAmount)
    )),
  ).toEqual([]);
  const activeRowCount = snapshots.filter(({ isEmpty }) => !isEmpty).length;
  await expect(page.locator('[data-specialty-stores-status]')).toHaveText(
    activeRowCount.toString(),
  );
  return snapshots;
}

test('gives rye, oat, and maslin bread distinct provision icons', async ({ page }) => {
  await page.setContent(`
    <div class="settlement-hud">
      <div class="settlement-hud__food-card" data-food-resource="ryeBread"></div>
      <div class="settlement-hud__food-card" data-food-resource="maslinBread"></div>
    </div>
    <div class="resource-cost__item" data-resource-cost="ryeBread"><span class="resource-cost__icon"></span></div>
    <div class="resource-cost__item" data-resource-cost="maslinBread"><span class="resource-cost__icon"></span></div>
  `);
  await page.addStyleTag({ path: 'src/ui/iconography.css' });

  const expectedIcons = {
    ryeBread: 'rye-bread.png',
    maslinBread: 'maslin-bread.png',
  } as const;

  const foodCardIcons: string[] = [];
  for (const [resource, filename] of Object.entries(expectedIcons)) {
    const cardIcon = await page.locator(`[data-food-resource="${resource}"]`).evaluate((element) => (
      getComputedStyle(element, '::before').backgroundImage
    ));
    const costIcon = await page.locator(`[data-resource-cost="${resource}"] .resource-cost__icon`).evaluate((element) => (
      getComputedStyle(element).backgroundImage
    ));
    expect(cardIcon).toContain(filename);
    expect(costIcon).toContain(filename);
    foodCardIcons.push(cardIcon);
  }

  expect(new Set(foodCardIcons).size).toBe(3);
});

test('gives every stored item an icon and keeps the four crop sheaves distinct', async ({ page }) => {
  await page.setContent(RESOURCE_COST_KINDS.map((resource) => `
    <div class="resource-cost__item" data-resource-cost="${resource}">
      <span class="resource-cost__icon"></span>
    </div>
  `).join(''));
  await page.addStyleTag({ path: 'src/ui/iconography.css' });

  const iconImages = await page.locator('.resource-cost__item').evaluateAll((elements) => (
    Object.fromEntries(elements.map((element) => {
      const resource = (element as HTMLElement).dataset.resourceCost!;
      const icon = element.querySelector<HTMLElement>('.resource-cost__icon')!;
      return [resource, getComputedStyle(icon).backgroundImage];
    }))
  ));

  expect(
    Object.entries(iconImages)
      .filter(([, backgroundImage]) => backgroundImage === 'none')
      .map(([resource]) => resource),
  ).toEqual([]);

  const expectedSheafIcons = {
    ryeSheaves: 'rye-sheaves.png',
    oatSheaves: 'oat-sheaves.png',
    barleySheaves: 'barley-sheaves.png',
    maslinSheaves: 'maslin-sheaves.png',
  } as const;
  const sheafImages = Object.entries(expectedSheafIcons).map(([resource, filename]) => {
    expect(iconImages[resource]).toContain(filename);
    return iconImages[resource];
  });
  expect(new Set(sheafImages).size).toBe(4);
});

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

test('keeps the camera zoom percentage visible beside settlement time', async ({ page }) => {
  await page.setContent(`
    <div class="settlement-hud">
      <div class="settlement-vitals" data-settlement-vitals>
        <div class="settlement-vitals__zoom" data-stat-row="zoom">
          <svg class="settlement-vitals__zoom-icon" viewBox="0 0 18 18" aria-hidden="true">
            <circle cx="7.5" cy="7.5" r="4.75"></circle>
            <path d="m11 11 4 4"></path>
          </svg>
          <span class="settlement-vitals__zoom-label">Zoom</span>
          <strong class="settlement-vitals__zoom-value" data-stat="zoom">37%</strong>
        </div>
        <div class="settlement-hud__clock" data-settlement-clock>
          <span class="settlement-hud__clock-date">27 March, Year 1</span>
          <span class="settlement-hud__clock-time">11:16</span>
          <span class="settlement-hud__season">Spring rain</span>
        </div>
      </div>
    </div>
  `);
  await page.addStyleTag({ path: 'src/ui/settlementHud.css' });
  await page.addStyleTag({ path: 'src/ui/polishedGameUi.css' });

  const zoom = page.locator('[data-stat-row="zoom"]');
  const zoomValue = page.locator('[data-stat="zoom"]');
  const clock = page.locator('[data-settlement-clock]');
  await expect(zoom).toBeVisible();
  await expect(zoomValue).toHaveText('37%');
  const layout = await page.locator('[data-settlement-vitals]').evaluate((vitals) => {
    const zoomBox = vitals.querySelector<HTMLElement>('[data-stat-row="zoom"]')!.getBoundingClientRect();
    const clockBox = vitals.querySelector<HTMLElement>('[data-settlement-clock]')!.getBoundingClientRect();
    return {
      zoomWidth: zoomBox.width,
      separated: zoomBox.right <= clockBox.left,
    };
  });
  expect(layout.zoomWidth).toBeGreaterThanOrEqual(56);
  expect(layout.separated).toBe(true);
  await expect(clock).toBeVisible();
});

test('connects, places a reforester, and updates settlement HUD timber', async ({ page }) => {
  await page.goto('/?new');
  await advanceToMapGeneration(page);

  const aquiferState = page.locator('[data-aquifer-networks-value]');
  const aquiferNext = page.locator('[data-world-selector="groundwater"] [data-selector-step="1"]');
  const aquiferPrevious = page.locator('[data-world-selector="groundwater"] [data-selector-step="-1"]');
  await expect(aquiferState).toHaveAttribute('data-value', 'even');
  await expect(aquiferState).toHaveText('Even');
  await aquiferNext.click();
  await expect(aquiferState).toHaveAttribute('data-value', 'aquifers');
  await expect(aquiferState).toHaveText('Aquifers');
  await aquiferPrevious.click();
  await expect(aquiferState).toHaveAttribute('data-value', 'even');

  const timberHud = page.locator('[data-stockpile="timber"]');
  const startWorld = page.getByRole('button', { name: 'Start world' });
  await startWorld.click();
  await expect.poll(
    () => page.evaluate(() => (window.__medievalE2e?.getRendererStats().frames ?? 0) > 0),
    { timeout: STARTUP_TIMEOUT_MS },
  ).toBe(true);
  const rendererStats = await page.evaluate(() => window.__medievalE2e!.getRendererStats());
  expect(rendererStats.backend).toBe('webgpu');
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
  const foundingPopulationValues = page.locator(
    '[data-stockpile="labor"], [data-stockpile="population"], [data-stockpile="housing"]',
  );
  await expect(foundingPopulationValues).toHaveCount(3);
  for (const value of await foundingPopulationValues.all()) {
    await expect(value).toHaveText('0');
  }
  const welcomeTutorial = page.getByRole('dialog', { name: 'The Frontier Awaits' });
  await expect(welcomeTutorial).toBeVisible({ timeout: SYNC_TIMEOUT_MS });
  await expect(welcomeTutorial).toContainText('You are Nikola IV. Zrinski');
  await welcomeTutorial.getByRole('button', { name: 'Take up your charge' }).click();
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
  for (const value of await foundingPopulationValues.all()) {
    await expect(value).toHaveText(String(STARTING_POPULATION));
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
  const tooltip = page.locator('#ui-tooltip');
  await expect(page.locator('[data-resource="timber"]')).toHaveAttribute(
    'data-tooltip-title',
    'Timber',
  );
  await expect(page.locator('[data-resource="stone"]')).toHaveAttribute(
    'data-tooltip-title',
    'Stone',
  );
  await expect(page.locator('[data-resource="water"]')).toHaveAttribute(
    'data-tooltip-title',
    'Water',
  );
  await expect(page.locator('[data-resource="gold"]')).toHaveAttribute(
    'data-tooltip-title',
    'Gold',
  );
  const seasonStatus = page.locator('[data-season-status]');
  await expect(seasonStatus).toHaveCSS('background-image', /woodcut-sundial\.webp/);
  await expect(seasonStatus).toHaveAttribute('aria-label', /^Season almanac: /);
  await seasonStatus.hover();
  await expect(tooltip).toHaveClass(/ui-tooltip--season-almanac/);
  await expect(tooltip.locator('.ui-tooltip__season-header .ui-tooltip__title')).toHaveText(
    /^(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday), \d{1,2} (January|February|March|April|May|June|July|August|September|October|November|December), Year \d+$/,
  );
  await expect(tooltip.locator('.ui-tooltip__season-header-icon')).toBeVisible();
  await expect(tooltip.locator('.ui-tooltip__season-introduction')).toHaveText(
    'Seasons shape harvests, livestock, travel, stores, and household needs.',
  );
  await expect(tooltip.locator('.ui-tooltip__season-list > li')).toHaveCount(4);
  await expect(tooltip.locator('.ui-tooltip__season-list > li.is-current')).toHaveCount(1);
  await expect(tooltip.locator('.ui-tooltip__season-current')).toHaveText('Current');
  await expect(tooltip.locator('.ui-tooltip__season-months')).toHaveText([
    '(March–May)',
    '(June–August)',
    '(September–November)',
    '(December–February)',
  ]);
  await expect(tooltip.locator('.ui-tooltip__season-description')).toHaveText([
    /Spring oats are sown/,
    /cattle and sheep graze, holdings cut local winter hay/,
    /Finish the late harvest/,
    /cattle and sheep use local hay before direct oats/,
  ]);
  await expect(tooltip.locator('.ui-tooltip__season-description').nth(1)).not.toContainText(/drought/i);
  const tooltipLifecycleFixture = page.locator('[data-e2e-tooltip-lifecycle]');
  await page.locator('[data-ui-root]').evaluate((uiRoot) => {
    const host = document.createElement('div');
    host.dataset.e2eTooltipLifecycle = '';
    host.style.cssText = 'position: fixed; left: 20px; bottom: 20px; z-index: 10000;';
    host.innerHTML = '<button type="button" data-tooltip-title="Lifecycle" data-tooltip="Temporary building detail">Hover detail</button>';
    uiRoot.appendChild(host);
  });
  await tooltipLifecycleFixture.getByRole('button').hover();
  await expect(tooltip.locator('.ui-tooltip__title')).toHaveText('Lifecycle');
  await expect(tooltip).toHaveClass(/is-visible/);
  await tooltip.evaluate((element) => {
    const target = element as HTMLElement & { e2eVisibilityObserver?: MutationObserver };
    target.dataset.e2eVisibilityDrops = '0';
    target.e2eVisibilityObserver = new MutationObserver((records) => {
      const hiddenDrops = records.filter(
        (record) => record.attributeName === 'hidden' && record.oldValue === null,
      ).length;
      const classRecords = records.filter((record) => record.attributeName === 'class');
      let classDrops = 0;
      for (const [index, record] of classRecords.entries()) {
        const before = new Set((record.oldValue ?? '').split(/\s+/).filter(Boolean));
        const afterValue = classRecords[index + 1]?.oldValue ?? target.className;
        const after = new Set(afterValue.split(/\s+/).filter(Boolean));
        if (before.has('is-visible') && !after.has('is-visible')) classDrops += 1;
      }
      const current = Number(target.dataset.e2eVisibilityDrops ?? '0');
      target.dataset.e2eVisibilityDrops = String(current + hiddenDrops + classDrops);
    });
    target.e2eVisibilityObserver.observe(target, {
      attributes: true,
      attributeFilter: ['hidden', 'class'],
      attributeOldValue: true,
    });
  });
  for (let replacement = 0; replacement < 8; replacement += 1) {
    await tooltipLifecycleFixture.evaluate((host, index) => {
      host.innerHTML = `<button type="button" data-tooltip-title="Lifecycle" data-tooltip="Temporary building detail ${index}">Hover detail</button>`;
    }, replacement);
    await page.waitForTimeout(50);
  }
  await expect(tooltip).toHaveClass(/is-visible/);
  await expect(tooltip).not.toHaveAttribute('hidden', '');
  await expect(tooltip).toHaveAttribute('data-e2e-visibility-drops', '0');
  await expect(tooltip.locator('.ui-tooltip__body')).toContainText('Temporary building detail 7');
  await tooltipLifecycleFixture.evaluate((host) => { host.hidden = true; });
  await expect(tooltip).toBeHidden();
  await tooltipLifecycleFixture.evaluate((host) => { host.hidden = false; });
  await tooltipLifecycleFixture.getByRole('button').hover();
  await expect(tooltip).toBeVisible();
  await tooltipLifecycleFixture.evaluate((host) => host.remove());
  await expect(tooltip).toBeHidden();
  await tooltip.evaluate((element) => {
    const target = element as HTMLElement & { e2eVisibilityObserver?: MutationObserver };
    target.e2eVisibilityObserver?.disconnect();
    delete target.e2eVisibilityObserver;
    delete target.dataset.e2eVisibilityDrops;
  });
  await expect(totalsMode).toHaveAttribute(
    'aria-label',
    'Showing surplus goods. Show total goods stored.',
  );
  const foodStores = page.locator('[data-food-stores]');
  const foodSummary = foodStores.locator('> summary');
  await foodSummary.hover();
  await expect(foodStores).toHaveAttribute('open', '');
  await expect(foodStores.getByRole('heading', { name: 'Food supply' })).toBeVisible();
  await expect(foodStores.locator('[data-food-stores-mode-label]')).toHaveText(
    'Available surplus',
  );
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
  await expect(page.locator('#ui-tooltip .ui-tooltip__amount-label')).toHaveText(
    'Available surplus',
  );
  await timberHud.hover();
  await expect(tooltip.locator('.ui-tooltip__title')).toHaveText('Timber');
  await expect(tooltip.locator('.ui-tooltip__amount-label')).toHaveText('Available surplus');
  await expect(foodStores).not.toHaveAttribute('open', '');
  await totalsMode.hover();
  await expect(tooltip.locator('.ui-tooltip__title')).toHaveText('Surplus goods (default)');
  await expect(tooltip.locator('.ui-tooltip__label')).toHaveCount(0);
  const specialtyStores = page.locator('[data-specialty-stores]');
  await expect(page.locator('[data-geology-alert]')).toHaveCount(0);
  await expect(specialtyStores).not.toHaveClass(/has-geology-alert/);
  await expect(specialtyStores.locator('[data-specialty-stores-status]')).toBeVisible();
  const specialtySummary = specialtyStores.locator('> summary');
  await specialtySummary.hover();
  await expect(specialtyStores).toHaveAttribute('open', '');
  await expect(specialtyStores.getByRole('heading', { name: 'Provisions' })).toBeVisible();
  await expect(specialtyStores.locator('[data-specialty-stores-mode-label]')).toHaveText(
    'Available surplus',
  );
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
  const surplusProvisionValues = await expectProvisionValuesToMatchTooltips(
    page,
    'Available surplus',
  );
  const hidesSurplus = surplusProvisionValues.find(({ resource }) => resource === 'hides');
  expect(Number(hidesSurplus?.tooltipAmount.replace(/[^\d.-]/g, '') ?? 0)).toBeGreaterThan(0);
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
  await timberHud.hover();
  await expect(tooltip.locator('.ui-tooltip__title')).toHaveText('Timber');
  await expect(tooltip.locator('.ui-tooltip__amount-label')).toHaveText('Total stored');
  await expect(specialtyStores.locator('[data-specialty-stores-mode-label]')).toHaveText(
    'Total stored',
  );
  await expectProvisionValuesToMatchTooltips(page, 'Total stored');
  await ironworkValue.hover();
  await expect(tooltip.locator('.ui-tooltip__amount-label')).toHaveText('Total stored');
  await expect(tooltip.locator('.ui-tooltip__amount-value')).toHaveText('9,000');
  await expect(ironworkTooltipParagraphs).toHaveCount(1);
  await foodSummary.hover();
  await page.locator('[data-food-resource="ryeBread"]').hover();
  await expect(tooltip.locator('.ui-tooltip__amount-label')).toHaveText('Total stored');
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
