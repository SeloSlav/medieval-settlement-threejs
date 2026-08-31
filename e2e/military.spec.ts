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
  'uskok-border-infantry',
];

test('renders the complete counter roster with loaded woodcut icons', async ({ page }) => {
  await page.setContent(`<main>${renderMilitaryRecruitmentPanels(GUARDHOUSE_KINDS, false)}</main>`);
  await page.addStyleTag({ path: 'src/ui/resourceInspector.css' });
  await page.addStyleTag({ path: 'src/ui/inspectorSupplemental.css' });

  const cards = page.locator('.military-recruitment-card');
  await expect(cards).toHaveCount(GUARDHOUSE_KINDS.length);
  expect(await page.locator('main').innerText()).toContain('Uskok');

  const iconUrls = await cards.locator('.inspector-action-icon').evaluateAll((icons) => (
    icons.map((icon) => getComputedStyle(icon).backgroundImage)
  ));
  expect(iconUrls.every((url) => url !== 'none' && url.includes('.png'))).toBe(true);
  expect(iconUrls.some((url) => url.includes('footmen.png'))).toBe(true);
  expect(iconUrls.some((url) => url.includes('polearms.png'))).toBe(true);
  expect(iconUrls.some((url) => url.includes('bowmen.png'))).toBe(true);
  expect(iconUrls.some((url) => url.includes('uskoks.png'))).toBe(true);
});

test('communicates the intended tactical counter relationships', async ({ page }) => {
  await page.setContent(`<main>${renderMilitaryRecruitmentPanels(GUARDHOUSE_KINDS, false)}</main>`);
  const copy = await page.locator('main').innerText();
  expect(copy).toContain('breaks ordinary spear lines');
  expect(copy).toContain('armor breakers');
  expect(copy).toContain('crossbows remain the better armored-target answer');
  expect(copy).toContain('braced spears stop them');
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

test('selected professional company shows only health plus level and XP progression', async ({ page }) => {
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
  const view = renderSelectedMilitaryCompanyInspector(company, [{
    id: '101', raidId: '24', faction: 'spearman', sourceBuildingId: 'guardhouse-1',
    sourceSlot: 0, targetKind: 'ground', targetId: '0', x: 0, z: 0, homeX: 0, homeZ: 0,
    health: 61, maxHealth: 80, readiness: 0.8, status: 'holding', attackCooldown: 0,
    lootProgress: 0, carryingLoot: false, issuedPolearms: 1, raidAnchorBuildingId: null,
    banditCampId: null, companyId: '24', homeResidenceId: 'residence-1',
    personIdentity: 'residence-1:person:0', stateChangedTick: 1,
  }]);
  await page.setContent(`<main><h2>${view.statusText}</h2><ul data-inspector-details>${view.detailsHtml}</ul></main>`);
  expect(await page.locator('main').innerText()).toContain('Level 2');
  await expect(page.locator('[data-company-health]')).toContainText('61 / 80');
  await expect(page.locator('[data-company-level="2"] [role="progressbar"]')).toHaveAttribute('aria-valuenow', '55');
  await expect(page.locator('main')).not.toContainText('Morale');
  await expect(page.locator('main')).not.toContainText('Cohesion');
  await expect(page.locator('main')).not.toContainText('Fatigue');
});
