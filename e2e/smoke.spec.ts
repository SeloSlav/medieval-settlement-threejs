import { expect, test, type Page } from '@playwright/test';
import { HUD_FOOD_GROUPS } from '../src/ui/hudFoodCards.ts';
import { HUD_PROVISION_RESOURCE_KINDS } from '../src/ui/hudProvisionCards.ts';
import { RESOURCE_COST_KINDS } from '../src/ui/resourceCost.ts';

const STARTING_TIMBER = 160;
const REFORESTER_TIMBER_COST = 35;
const STARTING_POPULATION = 10;
const STARTUP_TIMEOUT_MS = 90_000;
const SYNC_TIMEOUT_MS = 45_000;
const EXPECTED_PROVISION_RESOURCE_KINDS = HUD_PROVISION_RESOURCE_KINDS;

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
  await expect(page.locator('[data-setup-progress="map"][aria-current="step"]')).toBeVisible();
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

test('keeps cereal resources aligned by crop and production chain', async ({ page }) => {
  const cereals = HUD_FOOD_GROUPS.find(({ id }) => id === 'cereals');
  expect(cereals).toBeDefined();

  await page.setContent(`
    <style>* { box-sizing: border-box; }</style>
    <div class="settlement-hud__stores-grid settlement-hud__food-grid" style="position: static">
      <div class="settlement-hud__stores-scroll">
        <section class="settlement-hud__stores-section" data-food-category="cereals">
          <div class="settlement-hud__stores-grid-header"><strong>Cereals &amp; bread</strong></div>
          ${cereals!.kinds.map((kind) => `
            <div class="settlement-hud__stat settlement-hud__stat--store settlement-hud__food-card" data-food-resource="${kind}">
              <strong class="settlement-hud__value">0</strong>
            </div>
          `).join('')}
        </section>
      </div>
    </div>
  `);
  await page.addStyleTag({ path: 'src/ui/settlementHud.css' });
  await page.addStyleTag({ path: 'src/ui/polishedGameUi.css' });

  const positions = await page.locator('[data-food-resource]').evaluateAll((cards) => Object.fromEntries(
    cards.map((card) => {
      const box = card.getBoundingClientRect();
      return [card.getAttribute('data-food-resource')!, { left: box.left, top: box.top }];
    }),
  ));
  const sameColumn = (upper: string, lower: string) => (
    Math.abs(positions[upper].left - positions[lower].left) < 1
  );
  const sameRow = (left: string, right: string) => (
    Math.abs(positions[left].top - positions[right].top) < 1
  );

  expect(sameRow('ryeGrain', 'oatGrain')).toBe(true);
  expect(sameRow('oatGrain', 'barley')).toBe(true);
  expect(sameRow('barley', 'maslinGrain')).toBe(true);
  expect(positions.barley.left).toBeLessThan(positions.maslinGrain.left);
  expect(sameColumn('ryeGrain', 'ryeFlour')).toBe(true);
  expect(sameColumn('ryeFlour', 'ryeBread')).toBe(true);
  expect(sameColumn('barley', 'malt')).toBe(true);
  expect(sameColumn('maslinGrain', 'maslinFlour')).toBe(true);
  expect(sameColumn('maslinFlour', 'maslinBread')).toBe(true);
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

test('centers Development between civic status and right-aligned resource controls', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 720 });
  await page.setContent(`
    <style>* { box-sizing: border-box; }</style>
    <div class="settlement-hud">
      <div class="settlement-hud__ribbon-side settlement-hud__ribbon-side--civic" data-settlement-civic-strip>
        <div class="settlement-hud__approval-shell">
          <button class="settlement-hud__approval-button">
            <span class="settlement-hud__approval-icon">✓</span>
            <span class="settlement-hud__approval-copy"><strong>60%</strong></span>
          </button>
        </div>
        <div class="settlement-hud__body settlement-hud__body--civic">
          ${['labor', 'population', 'housing'].map((resource) => `
            <div class="settlement-hud__stat" data-resource="${resource}"><strong class="settlement-hud__value">10</strong></div>
          `).join('')}
          <details class="settlement-hud__animals">
            <summary class="settlement-hud__animals-summary" aria-label="Animals">
              <span class="settlement-hud__animals-label">Animals</span>
              <strong class="settlement-hud__animals-status">12</strong>
            </summary>
          </details>
        </div>
      </div>
      <button class="development-launcher" aria-label="Developments"></button>
      <div class="settlement-hud__ribbon-side settlement-hud__ribbon-side--resources" data-settlement-resource-strip>
        <div class="settlement-hud__body settlement-hud__body--resources">
          <div class="settlement-hud__people-card settlement-hud__resource-card settlement-hud__construction-card">
            <div class="settlement-hud__stat" data-resource-group="construction">
              <span class="settlement-hud__label">Construction</span>
            </div>
          </div>
          <details class="settlement-hud__food-stores settlement-hud__fuel-stores">
            <summary class="settlement-hud__stat" data-resource="firewood">
              <strong class="settlement-hud__value settlement-hud__supply-value">12 months</strong>
            </summary>
          </details>
          <details class="settlement-hud__food-stores">
            <summary class="settlement-hud__stat" data-resource="food">
              <strong class="settlement-hud__value settlement-hud__supply-value">8 months</strong>
            </summary>
          </details>
        </div>
        <details class="settlement-hud__stores" data-specialty-stores>
          <summary class="settlement-hud__stores-summary"><strong class="settlement-hud__stores-status">1</strong></summary>
        </details>
        <details class="settlement-hud__stores settlement-hud__military-stores" data-military-stores>
          <summary class="settlement-hud__stores-summary"><strong class="settlement-hud__stores-status">1</strong></summary>
          <div>
            ${[
              'polearms',
              'sidearms',
              'shields',
              'bows',
              'crossbows',
              'paddedArmor',
              'mailArmor',
              'ammunition',
            ].map((resource) => `<span class="settlement-hud__stat" data-resource="${resource}"></span>`).join('')}
          </div>
        </details>
        <button class="settlement-hud__totals-mode"><span class="settlement-hud__totals-mode-icon">⇄</span></button>
      </div>
    </div>
  `);
  await page.addStyleTag({ path: 'src/ui/settlementHud.css' });
  await page.addStyleTag({ path: 'src/ui/polishedGameUi.css' });
  await page.addStyleTag({ path: 'src/ui/nobleSetup.css' });
  await page.addStyleTag({ path: 'src/ui/iconography.css' });
  await page.addStyleTag({ path: 'src/ui/developmentMenu.css' });

  const layout = await page.locator('.settlement-hud').evaluate((hud) => {
    const rootBox = hud.getBoundingClientRect();
    const civicBox = hud.querySelector<HTMLElement>('[data-settlement-civic-strip]')!.getBoundingClientRect();
    const developmentBox = hud.querySelector<HTMLElement>('.development-launcher')!.getBoundingClientRect();
    const resourcesBox = hud.querySelector<HTMLElement>('[data-settlement-resource-strip]')!.getBoundingClientRect();
    const civicCategoryWidths = Array.from(
      hud.querySelectorAll<HTMLElement>('.settlement-hud__body--civic > *'),
      (category) => category.getBoundingClientRect().width,
    );
    const goodsBox = hud.querySelector<HTMLElement>('[data-specialty-stores]')!.getBoundingClientRect();
    const armsBox = hud.querySelector<HTMLElement>('[data-military-stores]')!.getBoundingClientRect();
    const totalsBox = hud.querySelector<HTMLElement>('.settlement-hud__totals-mode')!.getBoundingClientRect();
    return {
      width: rootBox.width,
      height: rootBox.height,
      sameRow: Math.abs(goodsBox.top - armsBox.top) < 1,
      adjacent: Math.abs(goodsBox.right - armsBox.left) < 1,
      developmentCenterOffset: Math.abs(
        (developmentBox.left + developmentBox.right) / 2
          - (rootBox.left + rootBox.right) / 2,
      ),
      civicMeetsDevelopment: Math.abs(civicBox.right - developmentBox.left) < 1,
      resourcesMeetDevelopment: Math.abs(resourcesBox.left - developmentBox.right) < 1,
      totalsAtFarRight: Math.abs(totalsBox.right - resourcesBox.right) < 1,
      civicCategoryWidths,
    };
  });
  expect(layout.width).toBe(900);
  expect(layout.height).toBeLessThan(80);
  expect(layout.sameRow).toBe(true);
  expect(layout.adjacent).toBe(true);
  expect(layout.developmentCenterOffset).toBeLessThan(1);
  expect(layout.civicMeetsDevelopment).toBe(true);
  expect(layout.resourcesMeetDevelopment).toBe(true);
  expect(layout.totalsAtFarRight).toBe(true);
  expect(Math.max(...layout.civicCategoryWidths) - Math.min(...layout.civicCategoryWidths)).toBeLessThan(1);
  await expect(page.locator('[data-resource="water"]')).toHaveCount(0);

  const animalsCategory = page.locator('.settlement-hud__animals-summary');
  await expect(animalsCategory).toHaveAttribute('aria-label', 'Animals');
  await expect(animalsCategory.locator('.settlement-hud__animals-status')).toBeVisible();
  const animalsIconAlignment = await animalsCategory.evaluate((summary) => {
    const style = getComputedStyle(summary, '::before');
    return {
      gridColumn: style.gridColumnStart,
      justifySelf: style.justifySelf,
    };
  });
  expect(animalsIconAlignment).toEqual({ gridColumn: '1', justifySelf: 'center' });

  const categorySelector = [
    '.settlement-hud__body--resources > .settlement-hud__construction-card',
    '.settlement-hud__body--resources > .settlement-hud__fuel-stores',
    '.settlement-hud__body--resources > .settlement-hud__food-stores:not(.settlement-hud__fuel-stores)',
    '[data-specialty-stores]',
    '[data-military-stores]',
    '.settlement-hud__totals-mode',
  ].join(', ');
  const categoryWidths = await page.locator(categorySelector).evaluateAll((categories) => (
    categories.map((category) => category.getBoundingClientRect().width)
  ));
  expect(Math.max(...categoryWidths) - Math.min(...categoryWidths)).toBeLessThan(1);

  const constructionCategory = await page.locator('[data-resource-group="construction"]').evaluate((button) => {
    const style = getComputedStyle(button, '::before');
    return {
      iconDisplay: style.display,
      iconImage: style.backgroundImage,
      iconWidth: Number.parseFloat(style.width),
      justifySelf: style.justifySelf,
      visibleText: button.textContent?.trim() ?? '',
    };
  });
  expect(constructionCategory.iconDisplay).toBe('block');
  expect(constructionCategory.iconImage).toContain('construction-actions.png');
  expect(constructionCategory.iconWidth).toBe(24);
  expect(constructionCategory.justifySelf).toBe('center');
  expect(constructionCategory.visibleText).toBe('Construction');
  await expect(page.locator('[data-resource-group="construction"] strong')).toHaveCount(0);
  const topLevelSupplyValues = page.locator(
    '.settlement-hud__body--resources .settlement-hud__supply-value',
  );
  await expect(topLevelSupplyValues).toHaveCount(2);
  for (const value of await topLevelSupplyValues.all()) await expect(value).toBeHidden();
  await expect(page.locator('[data-specialty-stores] > summary .settlement-hud__stores-status')).toBeHidden();
  await expect(page.locator('[data-military-stores] > summary .settlement-hud__stores-status')).toBeHidden();

  await page.setViewportSize({ width: 400, height: 720 });
  const compactCategoryWidths = await page.locator(categorySelector).evaluateAll((categories) => (
    categories
      .filter((category) => getComputedStyle(category).display !== 'none')
      .map((category) => category.getBoundingClientRect().width)
  ));
  expect(compactCategoryWidths).toHaveLength(4);
  expect(Math.max(...compactCategoryWidths) - Math.min(...compactCategoryWidths)).toBeLessThan(1);

  const armsTriggerIcon = await page.locator('[data-military-stores] > summary').evaluate((element) => (
    getComputedStyle(element, '::before').backgroundImage
  ));
  expect(armsTriggerIcon).toContain('hud-resources-goods-b.png');

  const expectedEquipmentIcons = {
    polearms: 'hud-resources-goods-b.png',
    sidearms: 'materials/sidearms.png',
    shields: 'materials/shields.png',
    bows: 'materials/bows.png',
    crossbows: 'materials/crossbows.png',
    paddedArmor: 'materials/padded-armor.png',
    mailArmor: 'materials/mail-armor.png',
    ammunition: 'materials/ammunition.png',
  } as const;
  for (const [resource, filename] of Object.entries(expectedEquipmentIcons)) {
    const backgroundImage = await page.locator(`[data-military-stores] [data-resource="${resource}"]`).evaluate((element) => (
      getComputedStyle(element, '::before').backgroundImage
    ));
    expect(backgroundImage).toContain(filename);
  }
});

test('keeps the camera zoom visible beside compact calendar controls', async ({ page }) => {
  await page.setContent(`
    <style>* { box-sizing: border-box; }</style>
    <div class="settlement-hud">
      <div class="settlement-vitals" data-settlement-vitals>
        <div class="settlement-vitals__zoom" data-stat-row="zoom">
          <svg class="settlement-vitals__zoom-icon" viewBox="0 0 18 18" aria-hidden="true">
            <circle cx="7.5" cy="7.5" r="4.75"></circle>
            <path d="m11 11 4 4"></path>
          </svg>
          <strong class="settlement-vitals__zoom-value" data-stat="zoom">37%</strong>
        </div>
        <div class="settlement-hud__clock" data-settlement-clock>
          <span class="settlement-hud__clock-date">28 September, Year 999</span>
          <span class="settlement-hud__season">Spring rain</span>
          <div class="settlement-hud__speed" role="group" aria-label="Simulation speed">
            <button class="settlement-hud__speed-button settlement-hud__speed-button--pause"><span class="settlement-hud__speed-value">&#x23F8;</span></button>
            <button class="settlement-hud__speed-button is-active"><span class="settlement-hud__speed-value">&#x25B6;</span></button>
            <button class="settlement-hud__speed-button"><span class="settlement-hud__speed-value">&#x25B6;&#x25B6;</span></button>
            <button class="settlement-hud__speed-button"><span class="settlement-hud__speed-value">&#x25B6;&#x25B6;&#x25B6;</span></button>
          </div>
        </div>
      </div>
    </div>
  `);
  await page.addStyleTag({ path: 'src/ui/settlementHud.css' });
  await page.addStyleTag({ path: 'src/ui/polishedGameUi.css' });
  await page.addStyleTag({ path: 'src/ui/readability.css' });

  const zoom = page.locator('[data-stat-row="zoom"]');
  const zoomValue = page.locator('[data-stat="zoom"]');
  const clock = page.locator('[data-settlement-clock]');
  await expect(zoom).toBeVisible();
  await expect(zoomValue).toHaveText('37%');
  await expect(page.locator('.settlement-hud__clock-time')).toHaveCount(0);
  const layout = await page.locator('[data-settlement-vitals]').evaluate((vitals) => {
    const zoomBox = vitals.querySelector<HTMLElement>('[data-stat-row="zoom"]')!.getBoundingClientRect();
    const clockBox = vitals.querySelector<HTMLElement>('[data-settlement-clock]')!.getBoundingClientRect();
    const date = vitals.querySelector<HTMLElement>('.settlement-hud__clock-date')!;
    const dateRange = document.createRange();
    dateRange.selectNodeContents(date);
    const dateTextBox = dateRange.getBoundingClientRect();
    const speedBox = vitals.querySelector<HTMLElement>('.settlement-hud__speed')!.getBoundingClientRect();
    return {
      width: vitals.getBoundingClientRect().width,
      height: vitals.getBoundingClientRect().height,
      zoomWidth: zoomBox.width,
      separated: zoomBox.right <= clockBox.left,
      dateControlCenterOffset: Math.abs(
        (dateTextBox.left + dateTextBox.right) / 2 - (speedBox.left + speedBox.right) / 2,
      ),
      overflowing: [...vitals.querySelectorAll<HTMLElement>('*')]
        .filter((element) => (
          element.scrollWidth > element.clientWidth + 1
          || element.scrollHeight > element.clientHeight + 1
        ))
        .map((element) => element.className),
    };
  });
  expect(layout.width).toBeLessThanOrEqual(320);
  expect(layout.height).toBeLessThanOrEqual(50);
  expect(layout.zoomWidth).toBeGreaterThanOrEqual(50);
  expect(layout.separated).toBe(true);
  expect(layout.dateControlCenterOffset).toBeLessThan(1);
  expect(layout.overflowing).toEqual([]);
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

  const timberHud = page.locator('[data-resource-card-amount="timber"]');
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
  const residentsCard = page.locator('[data-resident-card]');
  const constructionCard = page.locator('[data-resource-card="construction"]');
  const constructionSummary = constructionCard.locator('[data-resource-group="construction"]');
  const constructionPanel = constructionCard.locator('.settlement-hud__construction-panel');
  await expect(constructionSummary.locator('strong')).toHaveCount(0);
  await expect(page.locator('[data-settlement-hud] [data-resource="water"]')).toHaveCount(0);
  await expect(page.locator('[data-settlement-hud] [data-resource-card="water"]')).toHaveCount(0);
  const goldSummary = page.locator('[data-resource-card="gold"] > [data-resource="gold"]');
  await expect(goldSummary).not.toHaveAttribute('data-tooltip');
  await expect(goldSummary).not.toHaveAttribute('data-tooltip-title');
  for (const resource of ['timber', 'stone', 'ironwork', 'roofTiles']) {
    const material = constructionPanel.locator(`[data-resource="${resource}"]`);
    await expect(material).not.toHaveAttribute('data-tooltip');
    await expect(material).not.toHaveAttribute('data-tooltip-title');
  }
  await residentsCard.locator('[data-resource="population"]').hover();
  await expect(residentsCard.locator('.settlement-hud__residents-panel')).toBeVisible();
  await expect(residentsCard.locator('[data-resident-card-total]')).toHaveText(
    String(STARTING_POPULATION),
  );
  await expect(tooltip).toBeHidden();
  await residentsCard.locator('[data-resource="population"]').click();
  await page.mouse.move(12, 180);
  await expect(residentsCard.locator('.settlement-hud__residents-panel')).toBeHidden();
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
    /Sow spring oats/,
    /Harvest maturing crops and cut winter hay/,
    /Finish crops and collect apiary honey/,
    /Stock hay, Animal Feed, and firewood/,
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
  await expect(foodSummary.locator('.settlement-hud__supply-value')).toBeHidden();
  await foodSummary.hover();
  await expect(foodStores).toHaveAttribute('open', '');
  await expect(foodStores.getByRole('heading', { name: 'Food supply' })).toBeVisible();
  await expect(foodStores.locator('[data-food-stores-mode-label]')).toHaveText(
    'Available surplus',
  );
  await expect(page.locator('#ui-tooltip')).toBeHidden();
  const fuelStores = page.locator('[data-fuel-stores]');
  const fuelSummary = fuelStores.locator('> summary');
  await expect(fuelSummary.locator('.settlement-hud__supply-value')).toBeHidden();
  await fuelSummary.hover();
  await expect(fuelStores).toHaveAttribute('open', '');
  await expect(fuelStores.getByRole('heading', { name: 'Fuel supply' })).toBeVisible();
  await expect(page.locator('#ui-tooltip')).toBeHidden();
  await fuelStores.locator('[data-fuel-resource="firewood"]').hover();
  await expect(tooltip.locator('.ui-tooltip__title')).toHaveText('Firewood');
  await expect(tooltip.locator('.ui-tooltip__amount')).toHaveCount(0);
  await fuelStores.locator('[data-fuel-resource="charcoal"]').hover();
  await expect(tooltip.locator('.ui-tooltip__title')).toHaveText('Charcoal');
  await expect(tooltip.locator('.ui-tooltip__amount')).toHaveCount(0);
  const supplyCardPresentation = await page.locator('[data-settlement-hud]').evaluate((hud) => {
    const foodGrid = hud.querySelector<HTMLElement>('[data-food-breakdown]')!;
    const fuelGrid = hud.querySelector<HTMLElement>('[data-fuel-breakdown]')!;
    const provisionsGrid = hud.querySelector<HTMLElement>(
      '[data-specialty-stores] > .settlement-hud__stores-grid',
    )!;
    const constructionPanel = hud.querySelector<HTMLElement>(
      '[data-resource-card="construction"] .settlement-hud__construction-panel',
    )!;
    const headerMetrics = [foodGrid, fuelGrid, provisionsGrid, constructionPanel].map((panel) => {
      const title = panel.querySelector<HTMLElement>('.settlement-hud__people-header strong')!;
      const meta = panel.querySelector<HTMLElement>('.settlement-hud__people-header span')!;
      return {
        titleSize: Number.parseFloat(getComputedStyle(title).fontSize),
        metaSize: Number.parseFloat(getComputedStyle(meta).fontSize),
        metaTransform: getComputedStyle(meta).textTransform,
      };
    });
    const smallCopy = [
      ...foodGrid.querySelectorAll<HTMLElement>('.settlement-hud__supply-line'),
      ...fuelGrid.querySelectorAll<HTMLElement>('.settlement-hud__supply-line'),
    ].map((element) => Number.parseFloat(getComputedStyle(element).fontSize));
    return {
      foodWidth: Number.parseFloat(getComputedStyle(foodGrid).width),
      fuelWidth: Number.parseFloat(getComputedStyle(fuelGrid).width),
      provisionsWidth: Number.parseFloat(getComputedStyle(provisionsGrid).width),
      headerMetrics,
      minimumCopySize: Math.min(...smallCopy),
    };
  });
  expect(supplyCardPresentation.foodWidth).toBeGreaterThanOrEqual(350);
  expect(supplyCardPresentation.fuelWidth).toBeGreaterThanOrEqual(300);
  expect(supplyCardPresentation.provisionsWidth).toBeGreaterThanOrEqual(420);
  expect(new Set(supplyCardPresentation.headerMetrics.map(({ titleSize }) => titleSize)).size).toBe(1);
  expect(new Set(supplyCardPresentation.headerMetrics.map(({ metaSize }) => metaSize)).size).toBe(1);
  expect(supplyCardPresentation.headerMetrics.map(({ metaTransform }) => metaTransform)).toEqual([
    'none',
    'none',
    'none',
    'none',
  ]);
  expect(supplyCardPresentation.minimumCopySize).toBeGreaterThanOrEqual(12);
  await foodSummary.hover();
  await expect(foodStores).toHaveAttribute('open', '');
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
  await expect(page.locator('#ui-tooltip .ui-tooltip__body')).toHaveText('Slow spoilage');
  await constructionSummary.hover();
  await expect(constructionPanel).toBeVisible();
  await expect(constructionCard.locator('[data-resource-card-mode-label="construction"]')).toHaveText(
    'Available surplus',
  );
  await expect(constructionCard.locator('[data-resource-card-amount="timber"]')).toHaveText(
    String(timberBefore - REFORESTER_TIMBER_COST),
  );
  await expect(constructionCard.locator('[data-resource-card-amount="ironwork"]')).toHaveText('9000');
  await expect(constructionCard.locator('[data-resource-card-amount="roofTiles"]')).toHaveText(/^\d+$/);
  await expect(constructionPanel.locator('.settlement-hud__resource-detail')).toHaveCount(0);
  await expect(constructionPanel.locator('.settlement-hud__resource-note')).toHaveCount(0);
  await expect(tooltip).toBeHidden();
  await expect(foodStores).not.toHaveAttribute('open', '');
  await totalsMode.hover();
  await expect(tooltip.locator('.ui-tooltip__title')).toHaveText('Surplus goods (default)');
  await expect(tooltip.locator('.ui-tooltip__label')).toHaveCount(0);
  const specialtyStores = page.locator('[data-specialty-stores]');
  await expect(page.locator('[data-geology-alert]')).toHaveCount(0);
  await expect(specialtyStores).not.toHaveClass(/has-geology-alert/);
  await expect(specialtyStores.locator('[data-specialty-stores-status]')).toBeHidden();
  await expect(specialtyStores.locator('[data-resource="ironwork"], [data-resource="roofTiles"]')).toHaveCount(0);
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
  await constructionSummary.hover();
  await expect(constructionPanel).toBeVisible();
  await expect(constructionCard.locator('[data-resource-card-mode-label="construction"]')).toHaveText(
    'Total stored',
  );
  await expect(constructionCard.locator('[data-resource-card-amount="timber"]')).toHaveText(
    String(timberBefore),
  );
  await expect(constructionCard.locator('[data-resource-card-amount="ironwork"]')).toHaveText('9000');
  await expect(tooltip).toBeHidden();
  await expect(specialtyStores.locator('[data-specialty-stores-mode-label]')).toHaveText(
    'Total stored',
  );
  await fuelSummary.hover();
  await expect(fuelStores).toHaveAttribute('open', '');
  await expect(page.locator('#ui-tooltip')).toBeHidden();
  await specialtySummary.hover();
  await expect(specialtyStores).toHaveAttribute('open', '');
  await expectProvisionValuesToMatchTooltips(page, 'Total stored');
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
