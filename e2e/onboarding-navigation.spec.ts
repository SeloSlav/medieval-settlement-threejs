import { expect, test, type Page } from '@playwright/test';

async function expectActiveStep(page: Page, step: 'house' | 'heraldry' | 'map'): Promise<void> {
  const active = page.locator('.new-game-setup-steps [aria-current="step"]');
  await expect(active).toHaveCount(1);
  await expect(active).toHaveAttribute('data-setup-progress', step);
}

test('new-world setup moves backward and forward without losing choices', async ({ page }) => {
  await page.goto('/?new');

  await expect(page.getByRole('heading', { name: 'Choose Your Noble House' })).toBeVisible();
  await expect(page.locator('[data-setup-step="house"]')).toBeVisible();
  await expect(page.locator('[data-setup-step="heraldry"]')).toBeHidden();
  await expect(page.locator('[data-setup-back]')).toBeHidden();
  await expectActiveStep(page, 'house');

  const noble = page.locator('[data-noble-id="vuk-frankapan"]');
  await noble.click();
  await page.locator('[data-noble-name]').fill('House of the Silver Pine');
  await page.getByRole('button', { name: /Continue to Heraldry/ }).click();

  await expect(page.getByRole('heading', { name: 'Design Your Heraldry' })).toBeVisible();
  await expect(page.locator('[data-setup-step="house"]')).toBeHidden();
  await expect(page.locator('[data-setup-step="heraldry"]')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Back to Noble House' })).toBeVisible();
  await expectActiveStep(page, 'heraldry');

  const pattern = page.locator('[data-pattern-choice="solid"]');
  const charge = page.locator('[data-charge-choice="tower"]');
  await pattern.click();
  await charge.click();
  await page.getByRole('button', { name: /Continue to Map Generation/ }).click();

  await expect(page.getByRole('heading', { name: 'Map Generation' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Back to Heraldry' })).toBeVisible();
  await expectActiveStep(page, 'map');

  const smallMap = page.locator('[data-map-size="small"]');
  await smallMap.click();
  await page.locator('[data-aquifer-networks]').click();

  await page.getByRole('button', { name: 'Back to Heraldry' }).click();
  await expect(page.getByRole('heading', { name: 'Design Your Heraldry' })).toBeVisible();
  await expect(pattern).toHaveAttribute('aria-pressed', 'true');
  await expect(charge).toHaveAttribute('aria-pressed', 'true');
  await expectActiveStep(page, 'heraldry');

  await page.getByRole('button', { name: 'Back to Noble House' }).click();
  await expect(page.getByRole('heading', { name: 'Choose Your Noble House' })).toBeVisible();
  await expect(noble).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-noble-name]')).toHaveValue('House of the Silver Pine');
  await expectActiveStep(page, 'house');

  await page.getByRole('button', { name: /Continue to Heraldry/ }).click();
  await page.getByRole('button', { name: /Continue to Map Generation/ }).click();
  await expect(page.getByRole('heading', { name: 'Map Generation' })).toBeVisible();
  await expect(page.locator('[data-map-size="small"]')).toHaveClass(/is-selected/);
  await expect(page.locator('[data-aquifer-networks]')).toHaveAttribute('aria-pressed', 'true');
  await expectActiveStep(page, 'map');
});
