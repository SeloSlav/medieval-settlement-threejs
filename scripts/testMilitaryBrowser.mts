import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import {
  renderMilitaryCompanyRoster,
  renderMilitaryRecruitmentPanels,
} from '../src/resources/inspector/militaryCompanyRenderer.ts';
import type {
  MilitaryCompanyKind,
  MilitaryCompanyState,
} from '../src/security/militaryProgression.ts';

const kinds: readonly MilitaryCompanyKind[] = [
  'spearmen', 'men-at-arms', 'footmen', 'polearms', 'bowmen', 'crossbows',
  'uskok-border-infantry',
];
const renderedKinds: readonly MilitaryCompanyKind[] = [...kinds, 'mercenary-spears'];
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.setContent(`<main>${renderMilitaryRecruitmentPanels(renderedKinds, false)}</main>`);
  await page.addStyleTag({ path: 'src/ui/inspectorSupplemental.css' });
  assert.equal(await page.locator('.military-recruitment-card').count(), renderedKinds.length);
  const copy = await page.locator('main').innerText();
  for (const phrase of [
    'breaks ordinary spear lines',
    'armored sword-and-large-shield professionals',
    'armor breakers',
    'crossbows remain the better armored-target answer',
    'braced spears stop them',
    'seven quiet days',
    'one Treasury gold per surviving man each day',
  ]) assert.ok(copy.includes(phrase), `missing counter guidance: ${phrase}`);
  const backgrounds = await page.locator('.inspector-action-icon').evaluateAll((icons) => (
    icons.map((icon) => getComputedStyle(icon).backgroundImage)
  ));
  for (const icon of ['men-at-arms', 'footmen', 'polearms', 'bowmen', 'uskoks']) {
    assert.ok(backgrounds.some((value) => value.includes(`${icon}.png`)), `${icon} icon missing`);
  }
  const leavingCompany: MilitaryCompanyState = {
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
  };
  await page.setContent(`<main>${renderMilitaryCompanyRoster([leavingCompany])}</main>`);
  const retainer = page.locator('[data-renew-mercenary-contract="91"]');
  await retainer.waitFor();
  assert.equal((await retainer.innerText()).trim(), 'Pay 12 gold to retain company');
  assert.ok((await page.locator('main').innerText()).includes('ignores all movement and attack orders'));
  assert.equal(await page.locator('[data-disband-military-company]').count(), 0);
  console.log(`Military browser UI passed: ${renderedKinds.length} recruitment cards, the finite mercenary term, reversible edge departure, and all new woodcut icons rendered.`);
} finally {
  await browser.close();
}
