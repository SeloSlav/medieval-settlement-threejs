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
