import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  HOSTILE_COMPANY_COMPACT_MARKER_HEIGHT_PX,
  HOSTILE_COMPANY_COMPACT_MARKER_SCALE,
  HOSTILE_COMPANY_FULL_MARKER_MAX_HEIGHT_PX,
  HOSTILE_COMPANY_READABLE_HEIGHT_PX,
  STRATEGIC_COMPANY_ICON_HIDE_ZOOM_PERCENT,
  STRATEGIC_COMPANY_ICON_REVEAL_ZOOM_PERCENT,
  STRATEGIC_COMPANY_POSITION_SNAP_DISTANCE,
  STRATEGIC_COMPANY_STATIONARY_DEAD_ZONE,
  hostileCompanyMarkerPresentation,
  projectedCompanyBodyHeightPx,
  resolveStrategicCompanyIconVisibility,
  strategicCompanyIconOpacity,
  strategicCompanyIconWorldY,
  strategicCompanyPositionBlend,
} from '../src/security/MilitaryCompanyStrategicOverlay.ts';
import * as THREE from 'three';
import {
  HOSTILE_COMPANY_STRATEGIC_ICON_ART,
  MILITARY_COMPANY_STRATEGIC_ICON_ART,
  hostileCompanyStrategicLabel,
  militaryCompanyKindForFaction,
} from '../src/security/militaryCompanyPresentation.ts';
import { CombatPlaytestSimulation } from '../src/app/combatPlaytest.ts';
import { renderSelectedMilitaryCompanyInspector } from '../src/resources/inspector/militaryCompanyRenderer.ts';
import {
  MILITARY_KINDS,
  militaryCompanyGainsExperience,
} from '../src/security/militaryProgression.ts';

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
assert.equal(
  resolveStrategicCompanyIconVisibility(false, 100, false, true),
  true,
  'the illustrated overworld map must force strategic company icons visible',
);
assert.equal(resolveStrategicCompanyIconVisibility(true, 50, true, true), false);
assert.equal(strategicCompanyIconOpacity(72), 1);
assert.ok(strategicCompanyIconOpacity(80) > 0.45);
assert.ok(strategicCompanyIconOpacity(80) < 0.55);
assert.equal(strategicCompanyIconOpacity(88), 0);
assert.equal(strategicCompanyIconOpacity(100, true), 1);
assert.equal(strategicCompanyIconWorldY(14, false, 80), 17.15);
assert.equal(
  strategicCompanyIconWorldY(14, true, 80.12),
  80.12,
  'illustrated-map icons must project against the flat map plane, not live terrain',
);
assert.deepEqual(
  hostileCompanyMarkerPresentation(HOSTILE_COMPANY_READABLE_HEIGHT_PX, false),
  { opacity: 1, scale: 1, compact: false },
  'a culled hostile company must retain its full marker at every zoom',
);
assert.deepEqual(
  hostileCompanyMarkerPresentation(HOSTILE_COMPANY_FULL_MARKER_MAX_HEIGHT_PX, true),
  { opacity: 1, scale: 1, compact: false },
);
const compactHostile = hostileCompanyMarkerPresentation(
  HOSTILE_COMPANY_COMPACT_MARKER_HEIGHT_PX,
  true,
);
assert.equal(compactHostile.opacity, 1);
assert.equal(compactHostile.scale, HOSTILE_COMPANY_COMPACT_MARKER_SCALE);
assert.equal(compactHostile.compact, true);
const fadingHostile = hostileCompanyMarkerPresentation(
  (HOSTILE_COMPANY_COMPACT_MARKER_HEIGHT_PX + HOSTILE_COMPANY_READABLE_HEIGHT_PX) / 2,
  true,
);
assert.ok(fadingHostile.opacity > 0.45 && fadingHostile.opacity < 0.55);
assert.equal(fadingHostile.compact, true);
assert.equal(
  hostileCompanyMarkerPresentation(HOSTILE_COMPANY_READABLE_HEIGHT_PX, true).opacity,
  0,
  'the hostile marker may disappear only once submitted bodies are readable',
);
assert.equal(
  projectedCompanyBodyHeightPx(
    new THREE.Vector3(0, 0.1, 0),
    new THREE.Vector3(0, 0.2, 0),
    1280,
    720,
  ),
  36,
);
assert.equal(
  strategicCompanyPositionBlend(STRATEGIC_COMPANY_STATIONARY_DEAD_ZONE, false, 1 / 60),
  0,
  'stationary formation jitter should stay inside the marker dead zone',
);
const movingBlend = strategicCompanyPositionBlend(2, true, 1 / 60);
const stationaryBlend = strategicCompanyPositionBlend(2, false, 1 / 60);
assert.ok(movingBlend > stationaryBlend && stationaryBlend > 0);
assert.equal(
  strategicCompanyPositionBlend(STRATEGIC_COMPANY_POSITION_SNAP_DISTANCE, true, 1 / 60),
  1,
  'large corrections should snap instead of dragging a stale marker across the map',
);
const oneThirtyFpsStep = strategicCompanyPositionBlend(2, true, 1 / 30);
const twoSixtyFpsSteps = 1 - (1 - movingBlend) ** 2;
assert.ok(Math.abs(oneThirtyFpsStep - twoSixtyFpsSteps) < 1e-9);

assert.deepEqual([
  militaryCompanyKindForFaction('militia'),
  militaryCompanyKindForFaction('spearman'),
  militaryCompanyKindForFaction('man-at-arms'),
  militaryCompanyKindForFaction('crossbow'),
  militaryCompanyKindForFaction('mercenary-spear'),
  militaryCompanyKindForFaction('footman'),
  militaryCompanyKindForFaction('polearm'),
  militaryCompanyKindForFaction('bowman'),
], [
  'militia',
  'spearmen',
  'men-at-arms',
  'crossbows',
  'mercenary-spears',
  'footmen',
  'polearms',
  'bowmen',
]);
assert.equal(militaryCompanyKindForFaction('raider'), null);
for (const art of Object.values(MILITARY_COMPANY_STRATEGIC_ICON_ART)) {
  const assetPath = join(process.cwd(), 'public', art.slice(1));
  assert.ok(existsSync(assetPath), `missing map symbol ${art}`);
  assert.match(art, /\/military-map\/.+\.png$/);
  const png = readFileSync(assetPath);
  assert.equal(png.subarray(1, 4).toString('ascii'), 'PNG');
  assert.equal(png.readUInt32BE(16), 256);
  assert.equal(png.readUInt32BE(20), 256);
}
assert.equal(
  new Set(Object.values(MILITARY_COMPANY_STRATEGIC_ICON_ART)).size,
  MILITARY_KINDS.length,
  'every military company kind needs its own strategic-map silhouette',
);
for (const art of Object.values(HOSTILE_COMPANY_STRATEGIC_ICON_ART)) {
  const assetPath = join(process.cwd(), 'public', art.slice(1));
  assert.ok(existsSync(assetPath), `missing hostile map symbol ${art}`);
  assert.match(art, /\/military-map\/.+\.png$/);
  const png = readFileSync(assetPath);
  assert.equal(png.subarray(1, 4).toString('ascii'), 'PNG');
  assert.equal(png.readUInt32BE(16), 256);
  assert.equal(png.readUInt32BE(20), 256);
}
assert.equal(new Set(Object.values(HOSTILE_COMPANY_STRATEGIC_ICON_ART)).size, 2);
assert.equal(hostileCompanyStrategicLabel('raiders'), 'Enemy raiders');
assert.equal(hostileCompanyStrategicLabel('bandits'), 'Bandit company');

const playtest = new CombatPlaytestSimulation({
  site: { x: 0, z: 0, axisX: 1, axisZ: 0 },
  playableHalf: 248,
  preset: 'field',
  seed: 0x431a2e0d,
});
const companies = playtest.companyStates();
assert.equal(companies.size, 8, 'field sandbox should expose all eight friendly companies');
for (const company of companies.values()) {
  assert.equal(company.targetSize, 8);
  assert.equal(company.livingMembers, 8);
  assert.equal(company.status, 'active');
  const card = renderSelectedMilitaryCompanyInspector(company, {
    readOnlyPlaytest: true,
  });
  assert.equal(card.detailsHtml, '');
  if (militaryCompanyGainsExperience(company.kind)) {
    assert.match(
      card.statusText,
      /^(Unproven|Seasoned|Veteran|Hardened|Household elite) · Active$/,
    );
  } else {
    assert.equal(card.statusText, 'Active');
  }
  assert.match(card.supplementalPanelHtml, /data-combat-playtest-company-card/);
  assert.match(card.supplementalPanelHtml, /right-click the terrain to move/i);
  assert.doesNotMatch(card.supplementalPanelHtml, /data-disband-military-company/);
}

const controllerSource = readFileSync('src/security/MilitiaCommandController.ts', 'utf8');
const appSource = readFileSync('src/app/App.ts', 'utf8');
const bootstrapSource = readFileSync('src/app/appBootstrap.ts', 'utf8');
assert.match(controllerSource, /strategicIcons\.sync/);
assert.match(controllerSource, /strategicIcons\.update/);
assert.match(controllerSource, /member\.status === 'advancing'[\s\S]*?member\.routeProgress/);
assert.match(controllerSource, /moving: company\.moving/);
assert.match(controllerSource, /onSelect: this\.selectCompany/);
assert.match(controllerSource, /isVisibilityBlocked: options\.isVisibilityBlocked/);
assert.match(controllerSource, /getIllustratedMapY: options\.getIllustratedMapY/);
assert.match(controllerSource, /hostileGrouped/);
assert.match(controllerSource, /hostile:\s*true/);
assert.match(controllerSource, /members\[0\]!\.faction === 'bandit' \? 'bandits'/);
assert.match(
  appSource,
  /cameraController\?\.update\(dt\)[\s\S]*?worldMapUi\?\.update\(\)[\s\S]*?militiaCommands\?\.update\(time, crowdView\)/,
  'strategic companies must project from the same settled camera frame as resource icons',
);
assert.match(appSource, /getMilitaryCompanyOverride: \(\) => this\.combatPlaytest\?\.companyStates\(\)\.values\(\)/);
assert.match(appSource, /this\.resourceInspector\?\.refreshSelection\(\)/);
assert.match(bootstrapSource, /getMilitaryCompanyOverride\?\.\(\)/);
assert.match(bootstrapSource, /onHostileFocus:[\s\S]*?focusWorldPositionAtZoom/);
assert.match(
  bootstrapSource,
  /isVisibilityBlocked:[\s\S]*?isIllustratedMapActive\(\)[\s\S]*?isOverlayBlocked/,
  'the charcoal overworld map must not count as a military-icon visibility blocker',
);

console.log('Military company strategic icons and playtest unit-card contracts passed.');
