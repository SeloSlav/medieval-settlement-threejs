import { expect, test, type Page } from '@playwright/test';

async function expectActiveStep(page: Page, step: 'house' | 'heraldry' | 'map'): Promise<void> {
  const active = page.locator('.new-game-setup-steps [aria-current="step"]');
  await expect(active).toHaveCount(1);
  await expect(active).toHaveAttribute('data-setup-progress', step);
}

test('new-world setup moves backward and forward without losing choices', async ({ page }) => {
  await page.goto('/?new');

  const houseHeading = page.getByRole('heading', { name: 'Choose Your Noble House' });
  await expect(houseHeading).toBeVisible();
  await expect(houseHeading).toBeFocused();
  await expect(page.locator('[data-setup-step="house"]')).toBeVisible();
  await expect(page.locator('[data-setup-step="heraldry"]')).toBeHidden();
  await expect(page.locator('[data-setup-back]')).toBeHidden();
  await expectActiveStep(page, 'house');
  const magdalenaFigure = page.locator('[data-noble-id="magdalena-budrisic"]');
  await expect(magdalenaFigure).toBeVisible();
  await expect(magdalenaFigure.locator('img')).toHaveAttribute(
    'src',
    '/assets/ui/noble-setup/portraits/magdalena-budrisic.webp',
  );
  await expect(magdalenaFigure.locator('.noble-setup-noble__portrait-placeholder')).toHaveCount(0);

  const noble = page.locator('[data-noble-id="vuk-frankapan"]');
  await noble.click();
  await expect(noble).not.toHaveAttribute('title', /./);
  await expect(noble).toHaveAttribute('data-tooltip', /Lord of Bosiljevo, Ribnik, and Novigrad/);
  const description = page.locator('[data-noble-description]');
  await description.hover();
  const tooltip = page.locator('#ui-tooltip');
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toContainText('Vuk I. Frankapan');
  await expect(tooltip).toContainText('Lord of Bosiljevo, Ribnik, and Novigrad');
  await expect(tooltip).toContainText('before 1521–1546');
  await expect(tooltip).toContainText('legacy');
  await page.locator('[data-noble-name]').fill('House of the Silver Pine');
  await page.getByRole('button', { name: /Continue to Heraldry/ }).click();

  const heraldryHeading = page.getByRole('heading', { name: 'Design Your Heraldry' });
  await expect(heraldryHeading).toBeVisible();
  await expect(heraldryHeading).toBeFocused();
  await expect(page.locator('[data-setup-step="house"]')).toBeHidden();
  await expect(page.locator('[data-setup-step="heraldry"]')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Back to Noble House' })).toBeVisible();
  await expectActiveStep(page, 'heraldry');

  const heraldryProfile = page.locator('.noble-setup-heraldry-profile');
  const heraldryEditor = page.locator('.noble-setup-heraldry-editor');
  const heraldryPortrait = page.locator('[data-heraldry-preview-portrait]');
  const heraldryShieldMount = page.locator('.noble-setup-heraldry-shield');
  const liveShield = heraldryShieldMount.locator('.heraldry-shield');
  await expect(heraldryProfile).toBeVisible();
  await expect(heraldryEditor).toBeVisible();
  await expect(heraldryPortrait).toHaveAttribute('src', /vuk-frankapan\.webp/);
  await expect(heraldryPortrait).toHaveAttribute('alt', 'Portrait of Vuk I. Frankapan');
  const [profileBox, editorBox, portraitBox, shieldBox] = await Promise.all([
    heraldryProfile.boundingBox(),
    heraldryEditor.boundingBox(),
    page.locator('.noble-setup-heraldry-portrait-frame').boundingBox(),
    heraldryShieldMount.boundingBox(),
  ]);
  expect(profileBox).not.toBeNull();
  expect(editorBox).not.toBeNull();
  expect(portraitBox).not.toBeNull();
  expect(shieldBox).not.toBeNull();
  expect(profileBox!.x + profileBox!.width).toBeLessThanOrEqual(editorBox!.x);
  expect(shieldBox!.x).toBeGreaterThan(portraitBox!.x + portraitBox!.width * 0.5);
  expect(shieldBox!.y + shieldBox!.height).toBeGreaterThan(portraitBox!.y + portraitBox!.height * 0.9);

  const preset = page.getByRole('button', { name: 'Coat of arms preset 6' });
  await preset.click();
  await expect(preset).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: /Continue to Map Generation/ }).click();

  const mapStep = page.locator('[data-setup-progress="map"]');
  await expect(mapStep).toBeVisible();
  await expect(mapStep).toBeFocused();
  const mapBack = page.getByRole('button', { name: 'Back to Heraldry' });
  const mapStart = page.getByRole('button', { name: 'Start world' });
  const mapRandomize = page.getByRole('button', { name: 'Randomize map' });
  const mapNavigation = page.locator('.world-setup-actions__navigation');
  await expect(mapBack).toBeVisible();
  await expect(mapStart).toBeVisible();
  await expect(mapRandomize).toBeVisible();
  await expect(mapNavigation.locator('button')).toHaveCount(2);
  await expect(page.locator('[data-map-seed-section]')).not.toContainText('Back to Heraldry');
  const [mapBackBox, mapStartBox, mapRandomizeBox] = await Promise.all([
    mapBack.boundingBox(),
    mapStart.boundingBox(),
    mapRandomize.boundingBox(),
  ]);
  expect(mapBackBox).not.toBeNull();
  expect(mapStartBox).not.toBeNull();
  expect(mapRandomizeBox).not.toBeNull();
  expect(mapBackBox!.x).toBeLessThan(mapStartBox!.x);
  expect(Math.abs(mapBackBox!.y - mapStartBox!.y)).toBeLessThan(2);
  expect(mapRandomizeBox!.y + mapRandomizeBox!.height).toBeLessThan(mapBackBox!.y);
  await expectActiveStep(page, 'map');

  const smallMap = page.locator('[data-map-size="small"]');
  await smallMap.click();
  await page.locator('[data-aquifer-networks]').click();

  await page.getByRole('button', { name: 'Back to Heraldry' }).click();
  await expect(heraldryHeading).toBeVisible();
  await expect(heraldryHeading).toBeFocused();
  await expect(preset).toHaveAttribute('aria-pressed', 'true');

  const pattern = page.locator('[data-pattern-choice="solid"]');
  const charge = page.locator('[data-charge-choice="tower"]');
  await pattern.click();
  await expect(liveShield).toHaveAttribute('data-pattern', 'solid');
  await charge.click();
  await expect(liveShield).toHaveCSS('--charge-mask', /tower\.png/);
  await page.getByRole('button', { name: /Continue to Map Generation/ }).click();
  await expect(mapStep).toBeVisible();
  await expect(page.locator('[data-map-size="small"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-aquifer-networks]')).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Back to Heraldry' }).click();
  await expect(heraldryHeading).toBeFocused();
  await expect(pattern).toHaveAttribute('aria-pressed', 'true');
  await expect(charge).toHaveAttribute('aria-pressed', 'true');
  await expectActiveStep(page, 'heraldry');

  await page.getByRole('button', { name: 'Back to Noble House' }).click();
  await expect(houseHeading).toBeVisible();
  await expect(houseHeading).toBeFocused();
  await expect(noble).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-noble-name]')).toHaveValue('House of the Silver Pine');
  await expectActiveStep(page, 'house');

  await page.getByRole('button', { name: /Continue to Heraldry/ }).click();
  await expect(heraldryHeading).toBeFocused();
  await page.getByRole('button', { name: /Continue to Map Generation/ }).click();
  await expect(mapStep).toBeVisible();
  await expect(mapStep).toBeFocused();
  await expect(page.locator('[data-map-size="small"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-aquifer-networks]')).toHaveAttribute('aria-pressed', 'true');
  await expectActiveStep(page, 'map');
});
