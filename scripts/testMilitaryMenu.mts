import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CombatPlaytestSimulation } from '../src/app/combatPlaytest.ts';
import {
  militaryCompanyFocusZoom, militaryCompanyVitals, militaryOrderAvailable, renderMilitaryOrders,
} from '../src/ui/militaryMenuPresentation.ts';

const simulation = new CombatPlaytestSimulation({
  site: { x: 0, z: 0, axisX: 1, axisZ: 0 }, playableHalf: 248, preset: 'field', seed: 0x431a2e0d,
});
const companies = [...simulation.companyStates().values()];
const spear = { ...companies.find(c => c.kind === 'spearmen')!, id: '1' };
const bow = { ...companies.find(c => c.kind === 'bowmen')!, id: '2' };
const first = [...simulation.snapshot().values()].find(a => a.companyId)!;
const vitals = militaryCompanyVitals([
  { ...first, companyId: '1', health: 50, maxHealth: 100, x: 10, z: 20 },
  { ...first, companyId: '1', health: 100, maxHealth: 100, x: 20, z: 20 },
  { ...first, companyId: '1', health: 0, maxHealth: 100, x: 1000, z: 1000, status: 'downed' },
  { ...first, companyId: '2', health: 25, maxHealth: 100, x: -50, z: -50 },
]);
assert.deepEqual(vitals.get('1'), { health: .75, x: 15, z: 20, radius: 5 });
assert.equal(vitals.get('2')?.health, .25);
assert.equal(militaryCompanyVitals([]).size, 0);
assert.ok(militaryCompanyFocusZoom(5) > militaryCompanyFocusZoom(35), 'spread-out companies need a wider camera');
assert.ok(militaryCompanyFocusZoom(1000) >= 35, 'focus must stay in the live world');
assert.ok(militaryCompanyFocusZoom(0) <= 170, 'do not drop into the close ground camera');

const orders = renderMilitaryOrders([spear]);
assert.match(orders, /data-formation-kind="brace"/);
assert.match(orders, /aria-label="Line" data-tooltip="Spreads the company across a broad front for a direct engagement\."/);
assert.match(orders, /data-military-order="running"/);
assert.match(orders, /class="military-order military-order--danger" data-military-order="disband"/);
assert.match(orders, /class="military-order__disband-icon"/);
assert.doesNotMatch(orders, /data-military-order="disband"[^>]*>[\s\S]*?data-action-icon="disband-company"/);
assert.doesNotMatch(orders, /data-military-order="fire-at-will"/);
assert.match(renderMilitaryOrders([bow]), /data-military-order="fire-at-will"/);
assert.equal(militaryOrderAvailable({ ...spear, fatigue: 1 }, { kind: 'running', value: 1 }), false);
assert.equal(militaryOrderAvailable({ ...spear, morale: 0.2 }, { kind: 'stance', value: 2 }), false);
assert.doesNotMatch(orders, /__label|formation-button__label|<small>/);
assert.doesNotMatch(renderMilitaryOrders([spear, bow]), /data-formation-kind="brace"/);
assert.equal(renderMilitaryOrders([]), '', 'there should be no command row or selection prompt before selecting a company');
assert.equal(militaryOrderAvailable(spear, { kind: 'formation', value: 1 }), true);
assert.equal(militaryOrderAvailable({ ...spear, status: 'leaving' }, { kind: 'formation', value: 1 }), false);
assert.equal(militaryOrderAvailable({ ...spear, livingMembers: 4 }, { kind: 'reinforce' }), true);
assert.equal(militaryOrderAvailable({ ...spear, kind: 'militia', livingMembers: 4 }, { kind: 'reinforce' }), false);
assert.equal(militaryOrderAvailable({ ...spear, kind: 'mercenary-spears', status: 'leaving' }, { kind: 'retain' }), true);
assert.equal(militaryOrderAvailable({ ...spear, status: 'destroyed' }, { kind: 'disband' }), false);
assert.equal(militaryOrderAvailable(companies[0]!, { kind: 'formation', value: 1 }), false, 'sandbox orders must never reach server reducers');

const bootstrap = readFileSync('src/app/appBootstrap.ts', 'utf8');
const menuSource = readFileSync('src/ui/MilitaryMenu.ts', 'utf8');
const toolbarSource = readFileSync('src/ui/BuildToolbar.ts', 'utf8');
assert.doesNotMatch(menuSource, /data-close-military|military-menu__close|onClose/, 'the military tray uses outside-click dismissal instead of a close button');
for (const handler of ['onBuildMenuOutsideMouseDown', 'onBuildMenuOutsideSecondaryClick']) {
  assert.match(toolbarSource, new RegExp(`${handler} = \\(event: MouseEvent\\): void => \\{\\s*if \\(!this\\.isAnyBuildMenuOpen\\(\\) && !this\\.militaryMenu\\.isOpen\\) return;`), 'both primary and secondary outside clicks must dismiss the military tray');
}
assert.match(toolbarSource, /onBuildMenuOutsideMouseDown[\s\S]*?this\.militaryMenu\.element\.contains\(target\)/, 'clicking company cards or orders must keep the tray open');
assert.match(toolbarSource, /onBuildMenuOutsideMouseDown[\s\S]*?querySelector\('\.alert-dialog-backdrop:not\(\[hidden\]\)'\)\) return;/, 'confirmation dialogs must not count as outside clicks');
assert.match(toolbarSource, /setMilitaryMenuOpen\(open: boolean\): void \{\s*const allowed[^\n]*\n\s*if \(!allowed\) this\.buildMenuOutsideSecondaryClick\.cancel\(\);/, 'closing the military tray must cancel pending secondary-click gestures');
assert.doesNotMatch(menuSource, /data-health|data-fatigue|role="meter"|aria-valuenow/, 'combat conditions remain implicit rather than numerical meters');
assert.doesNotMatch(bootstrap, /resourceInspector\.selectMilitaryCompany/);
assert.match(bootstrap, /onCompanySelected:[\s\S]*toolbar\.selectMilitaryCompanies\(\[companyId\]\)/);
assert.match(bootstrap, /onSelectMilitaryCompany:[\s\S]*militiaCommands\.selectCompany\(companyId\)[\s\S]*focusWorldPositionAtZoom/);
console.log('Military tray: compact stat-free controls, casualty-safe focus, tactical toggles, lifecycle orders, and world-selection wiring passed.');
