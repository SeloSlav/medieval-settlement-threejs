import { expect, test } from '@playwright/test';

const views = [
  ['pear-close', 'Pear orchard'],
  ['aronia-close', 'Aronia bushes'],
  ['rosehip-close', 'Rosehip bushes'],
] as const;

for (const [view, label] of views) {
  test(`${label} authored backyard visual`, async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.goto(`/backyard-lineup.html?view=${view}`);
    await page.waitForFunction(() => document.body.dataset.ready === 'true');
    await expect(page.locator('.label')).toHaveText(label);
    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible();
    const box = await canvas.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThan(700);
    expect(box?.height ?? 0).toBeGreaterThan(500);
    expect(pageErrors).toEqual([]);
    await page.screenshot({
      path: `artifacts/backyard-${view}.png`,
      fullPage: true,
    });
  });
}

const animalViews = [
  ['pig-close', ['Pig pen']],
  ['animals-design', ['Animal pen shell', 'Chicken pen', 'Goat pen', 'Pig pen']],
  ['animals-far', ['Animal pen shell', 'Chicken pen', 'Goat pen', 'Pig pen']],
  ['animals-no-post', ['Animal pen shell', 'Chicken pen', 'Goat pen', 'Pig pen']],
] as const;

for (const [view, labels] of animalViews) {
  test(`Animal Pen authored visual — ${view}`, async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.goto(`/backyard-lineup.html?view=${view}`);
    await page.waitForFunction(() => document.body.dataset.ready === 'true');
    await expect(page.locator('.label')).toHaveText([...labels]);
    const diagnostics = await page.evaluate(() => window.__BACKYARD_LINEUP_DIAGNOSTICS__);
    expect(diagnostics?.gardenCount).toBe(labels.length);
    expect(diagnostics?.triangleCount ?? 0).toBeGreaterThan(500);
    expect(diagnostics?.triangleCount ?? Number.POSITIVE_INFINITY).toBeLessThan(75_000);
    expect(diagnostics?.animalPlanKinds).toHaveLength(labels.length);
    expect(pageErrors).toEqual([]);
    await page.screenshot({
      path: `artifacts/backyard-${view}.png`,
      fullPage: true,
    });
  });
}

const vegetableViews = [
  ['beetroot-close', ['Beetroot garden']],
  ['vegetables-design', ['Vegetable garden', 'Cabbage garden', 'Carrot garden', 'Beetroot garden']],
  ['vegetables-far', ['Vegetable garden', 'Cabbage garden', 'Carrot garden', 'Beetroot garden']],
  ['vegetables-no-post', ['Vegetable garden', 'Cabbage garden', 'Carrot garden', 'Beetroot garden']],
  ['vegetables-stress', ['Vegetable garden', 'Cabbage garden', 'Carrot garden', 'Beetroot garden']],
] as const;

for (const [view, labels] of vegetableViews) {
  test(`Vegetable Garden authored visual — ${view}`, async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.goto(`/backyard-lineup.html?view=${view}`);
    await page.waitForFunction(() => document.body.dataset.ready === 'true');
    await expect(page.locator('.label')).toHaveText([...labels]);
    const diagnostics = await page.evaluate(() => window.__BACKYARD_LINEUP_DIAGNOSTICS__);
    expect(diagnostics?.gardenCount).toBe(labels.length);
    expect(diagnostics?.triangleCount ?? 0).toBeGreaterThan(100);
    expect(diagnostics?.triangleCount ?? Number.POSITIVE_INFINITY).toBeLessThan(75_000);
    if (labels.length === 4) {
      expect(diagnostics?.vegetableCropKinds).toEqual([
        [],
        ['cabbage'],
        ['carrot'],
        ['beetroot'],
      ]);
    } else {
      expect(diagnostics?.vegetableCropKinds).toEqual([['beetroot']]);
    }
    expect(pageErrors).toEqual([]);
    await page.screenshot({
      path: `artifacts/backyard-${view}.png`,
      fullPage: true,
    });
  });
}
