import { expect, test } from '@playwright/test';
import {
  renderMilitaryCompanyRoster,
  renderMilitaryRecruitmentPanels,
  renderSelectedMilitaryCompanyInspector,
} from '../src/resources/inspector/militaryCompanyRenderer.ts';
import type {
  MilitaryCompanyKind,
  MilitaryCompanyState,
} from '../src/security/militaryProgression.ts';

const GUARDHOUSE_KINDS: readonly MilitaryCompanyKind[] = [
  'spearmen', 'men-at-arms', 'footmen', 'polearms', 'bowmen', 'crossbows',
];

test('renders the complete counter roster with loaded woodcut icons', async ({ page }) => {
  await page.setContent(`<main>${renderMilitaryRecruitmentPanels(GUARDHOUSE_KINDS, false)}</main>`);
  await page.addStyleTag({ path: 'src/ui/resourceInspector.css' });
  await page.addStyleTag({ path: 'src/ui/inspectorSupplemental.css' });

  const cards = page.locator('.military-recruitment-card');
  await expect(cards).toHaveCount(GUARDHOUSE_KINDS.length);
  const iconUrls = await cards.locator('.inspector-action-icon').evaluateAll((icons) => (
    icons.map((icon) => getComputedStyle(icon).backgroundImage)
  ));
  expect(iconUrls.every((url) => url !== 'none' && url.includes('.png'))).toBe(true);
  expect(iconUrls.some((url) => url.includes('footmen.png'))).toBe(true);
  expect(iconUrls.some((url) => url.includes('polearms.png'))).toBe(true);
  expect(iconUrls.some((url) => url.includes('bowmen.png'))).toBe(true);
});

test('communicates the intended tactical counter relationships', async ({ page }) => {
  await page.setContent(`<main>${renderMilitaryRecruitmentPanels(GUARDHOUSE_KINDS, false)}</main>`);
  const copy = await page.locator('main').innerText();
  expect(copy).toContain('breaks ordinary spear lines');
  expect(copy).toContain('armor breakers');
  expect(copy).toContain('crossbows remain the better armored-target answer');
  expect(copy).toContain('polearms punish their armor');
});

test('offers a survivor-priced last-minute retainer to leaving mercenaries', async ({ page }) => {
  const company: MilitaryCompanyState = {
    id: '91',
    kind: 'mercenary-spears',
    sourceBuildingId: 'town-hall-1',
    status: 'leaving',
    formation: 'line',
    targetSize: 8,
    livingMembers: 6,
    morale: 0.6,
    cohesion: 0.55,
    fatigue: 0.25,
    provisionDays: 0,
    ammunition: 0,
    ammunitionCapacity: 0,
    formedTick: 1,
    experience: 0,
    level: 1,
  };
  await page.setContent(`<main>${renderMilitaryCompanyRoster([company])}</main>`);
  const retainer = page.locator('[data-renew-mercenary-contract="91"]');
  await expect(retainer).toHaveText('Pay 12 gold to retain company');
  await expect(page.locator('main')).toContainText('ignores all movement and attack orders');
  await expect(page.locator('[data-disband-military-company]')).toHaveCount(0);
});

test('selected professional company shows its level without aggregate or hidden combat stats', async ({ page }) => {
  const company: MilitaryCompanyState = {
    id: '24',
    kind: 'spearmen',
    sourceBuildingId: 'guardhouse-1',
    status: 'active',
    formation: 'shield-wall',
    targetSize: 8,
    livingMembers: 8,
    morale: 0.73,
    cohesion: 0.81,
    fatigue: 0.18,
    provisionDays: 2,
    ammunition: 0,
    ammunitionCapacity: 0,
    formedTick: 1,
    experience: 155,
    level: 2,
  };
  const view = renderSelectedMilitaryCompanyInspector(company);
  await page.setContent(`<main class="resource-inspector-panel" data-inspector-target="military-company">
    <h2>${view.statusText}</h2>
    <section class="resource-inspector-details"><ul data-inspector-details>${view.detailsHtml}</ul></section>
    <section class="resource-inspector-supplemental">${view.supplementalPanelHtml}</section>
  </main>`);
  await page.addStyleTag({ path: 'src/ui/resourceInspector.css' });
  await page.addStyleTag({ path: 'src/ui/polishedGameUi.css' });
  await page.addStyleTag({ path: 'src/ui/inspectorSupplemental.css' });
  expect(await page.locator('main').innerText()).toContain('Level 2');
  await expect(page.locator('[data-inspector-details] > li')).toHaveCount(0);
  await expect(page.locator('[role="progressbar"]')).toHaveCount(0);
  await expect(page.locator('[data-formation-kind="shield-wall"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-resupply-military-company]')).toContainText('Resupply');
  await expect(page.locator('[data-disband-military-company]')).toContainText('Disband company');
  await expect(page.locator('main')).not.toContainText('Surviving a battle');
  await expect(page.locator('main')).not.toContainText('Health');
  await expect(page.locator('main')).not.toContainText('Experience');
  await expect(page.locator('main')).not.toContainText('Strength');
  await expect(page.locator('main')).not.toContainText('Morale');
  await expect(page.locator('main')).not.toContainText('Cohesion');
  await expect(page.locator('main')).not.toContainText('Fatigue');
});
