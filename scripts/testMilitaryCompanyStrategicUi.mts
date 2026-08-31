import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  STRATEGIC_COMPANY_ICON_HIDE_ZOOM_PERCENT,
  STRATEGIC_COMPANY_ICON_REVEAL_ZOOM_PERCENT,
  resolveStrategicCompanyIconVisibility,
  strategicCompanyIconOpacity,
} from '../src/security/MilitaryCompanyStrategicOverlay.ts';
import {
  MILITARY_COMPANY_STRATEGIC_ICON_ART,
  militaryCompanyKindForFaction,
} from '../src/security/militaryCompanyPresentation.ts';
import { CombatPlaytestSimulation } from '../src/app/combatPlaytest.ts';
import { renderSelectedMilitaryCompanyInspector } from '../src/resources/inspector/militaryCompanyRenderer.ts';

assert.ok(
  STRATEGIC_COMPANY_ICON_REVEAL_ZOOM_PERCENT
    < STRATEGIC_COMPANY_ICON_HIDE_ZOOM_PERCENT,
  'strategic icons need distinct reveal/hide thresholds for zoom hysteresis',
);
assert.equal(resolveStrategicCompanyIconVisibility(false, 80), false);
assert.equal(resolveStrategicCompanyIconVisibility(false, 72), true);
assert.equal(resolveStrategicCompanyIconVisibility(true, 80), true);
assert.equal(resolveStrategicCompanyIconVisibility(true, 88), false);
assert.equal(resolveStrategicCompanyIconVisibility(true, 50, true), false);
assert.equal(strategicCompanyIconOpacity(72), 1);
assert.ok(strategicCompanyIconOpacity(80) > 0.45);
assert.ok(strategicCompanyIconOpacity(80) < 0.55);
assert.equal(strategicCompanyIconOpacity(88), 0);

assert.deepEqual([
  militaryCompanyKindForFaction('militia'),
  militaryCompanyKindForFaction('spearman'),
  militaryCompanyKindForFaction('man-at-arms'),
  militaryCompanyKindForFaction('crossbow'),
  militaryCompanyKindForFaction('mercenary-spear'),
  militaryCompanyKindForFaction('footman'),
  militaryCompanyKindForFaction('polearm'),
  militaryCompanyKindForFaction('bowman'),
  militaryCompanyKindForFaction('uskok'),
], [
  'militia',
  'spearmen',
  'men-at-arms',
  'crossbows',
  'mercenary-spears',
  'footmen',
  'polearms',
  'bowmen',
  'uskok-border-infantry',
]);
assert.equal(militaryCompanyKindForFaction('raider'), null);
for (const art of Object.values(MILITARY_COMPANY_STRATEGIC_ICON_ART)) {
  assert.ok(existsSync(join(process.cwd(), 'public', art.slice(1))), `missing woodcut ${art}`);
}

const playtest = new CombatPlaytestSimulation({
  site: { x: 0, z: 0, axisX: 1, axisZ: 0 },
  playableHalf: 248,
  preset: 'field',
  seed: 0x431a2e0d,
});
const agents = playtest.snapshot();
const companies = playtest.companyStates();
assert.equal(companies.size, 9, 'field sandbox should expose all nine friendly companies');
for (const company of companies.values()) {
  assert.equal(company.targetSize, 8);
  assert.equal(company.livingMembers, 8);
  assert.equal(company.status, 'active');
  const card = renderSelectedMilitaryCompanyInspector(company, agents.values(), {
    readOnlyPlaytest: true,
  });
  assert.match(card.detailsHtml, /Strength/);
  assert.match(card.detailsHtml, /Formation/);
  assert.match(card.detailsHtml, /Morale/);
  assert.match(card.supplementalPanelHtml, /data-combat-playtest-company-card/);
  assert.match(card.supplementalPanelHtml, /right-click the terrain to move/i);
  assert.doesNotMatch(card.supplementalPanelHtml, /data-disband-military-company/);
}

const controllerSource = readFileSync('src/security/MilitiaCommandController.ts', 'utf8');
const appSource = readFileSync('src/app/App.ts', 'utf8');
const bootstrapSource = readFileSync('src/app/appBootstrap.ts', 'utf8');
assert.match(controllerSource, /strategicIcons\.sync/);
assert.match(controllerSource, /strategicIcons\.update/);
assert.match(controllerSource, /onSelect: this\.selectCompany/);
assert.match(appSource, /getMilitaryCompanyOverride: \(\) => this\.combatPlaytest\?\.companyStates\(\)\.values\(\)/);
assert.match(appSource, /this\.resourceInspector\?\.refreshSelection\(\)/);
assert.match(bootstrapSource, /getMilitaryCompanyOverride\?\.\(\)/);

console.log('Military company strategic icons and playtest unit-card contracts passed.');
