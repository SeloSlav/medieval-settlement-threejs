import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import {
  BACKYARD_GARDEN_DEFINITIONS,
  BACKYARD_GARDEN_KINDS,
} from '../src/generated/gameBalance.ts';

const backyardCss = readFileSync('src/ui/polishedGameUi.css', 'utf8');
const actionCss = readFileSync('src/ui/inspectorSupplemental.css', 'utf8');
const backyardRenderer = readFileSync('src/resources/inspector/backyardRenderer.ts', 'utf8');
const residenceRenderer = readFileSync('src/resources/inspector/residenceRenderer.ts', 'utf8');
const chapelRenderer = readFileSync('src/resources/inspector/chapelRenderer.ts', 'utf8');
const campRenderer = readFileSync('src/resources/inspector/remoteWorkCampRenderer.ts', 'utf8');
const toolbar = readFileSync('src/ui/BuildToolbar.ts', 'utf8');
const iconography = readFileSync('src/ui/iconography.css', 'utf8');

const backyardArtwork: Record<string, string> = {
  orchard: 'backyards/orchard.png',
  apple_orchard: 'hud-resources-foods.png',
  cherry_orchard: 'hud-resources-foods.png',
  pear_orchard: 'provisions/pears.png',
  aronia_orchard: 'provisions/aronia.png',
  rosehip_orchard: 'provisions/rosehips.png',
  vegetable_garden: 'backyards/vegetable-garden.png',
  cabbage_garden: 'provisions/cabbage.png',
  carrot_garden: 'provisions/carrots.png',
  beetroot_garden: 'provisions/beetroot.png',
  flower_garden: 'backyards/flower-garden.png',
  herb_garden: 'backyards/herb-garden.png',
  animal_pen: 'backyards/animal-pen.png',
  chicken_pen: 'backyards/chicken-pen.png',
  goat_pen: 'backyards/goat-pen.png',
  pig_pen: 'backyards/pig-pen.png',
  backyard_apiary: 'backyards/backyard-apiary.png',
};

assert.deepEqual(
  Object.keys(backyardArtwork).sort(),
  [...BACKYARD_GARDEN_KINDS].sort(),
  'every backyard shell and specialization must have an explicit button-art contract',
);
assert.equal(BACKYARD_GARDEN_DEFINITIONS.backyard_apiary.hiddenFromPicker, false);
for (const [kind, artwork] of Object.entries(backyardArtwork)) {
  assert.match(
    backyardCss,
    new RegExp(`data-garden-kind='${kind}'[\\s\\S]{0,520}background-image: url\\('/assets/ui/icons/${escapeRegex(artwork)}'\\)`),
    `${kind} should use ${artwork}`,
  );
}
assert.doesNotMatch(backyardCss, /data-garden-kind='herb_garden'[\s\S]{0,300}\.svg/);
assert.doesNotMatch(backyardCss, /data-garden-kind='(?:flower_garden|goat_pen|pig_pen)'[\s\S]{0,300}noble-setup/);

const generatedAssets = [
  'backyards/flower-garden.png',
  'backyards/herb-garden.png',
  'backyards/backyard-apiary.png',
  'backyards/chicken-pen.png',
  'backyards/goat-pen.png',
  'backyards/pig-pen.png',
  'actions/overnight-work-camp.png',
  'actions/luxury-flowers.png',
  'upgrades/residence-tier-2.png',
  'upgrades/residence-tier-3.png',
  'upgrades/residence-tier-4.png',
  'upgrades/church-tier-2.png',
  'upgrades/church-tier-3.png',
] as const;
for (const asset of generatedAssets) {
  const path = `public/assets/ui/icons/${asset}`;
  assert.ok(existsSync(path), `${asset} must exist`);
  assert.ok(statSync(path).size > 20_000, `${asset} must be a substantive generated raster asset`);
  const png = readFileSync(path);
  assert.equal(png.readUInt32BE(16), 256, `${asset} must be 256 pixels wide`);
  assert.equal(png.readUInt32BE(20), 256, `${asset} must be 256 pixels tall`);
  assert.equal(png[25], 6, `${asset} must retain a true RGBA transparency channel`);
}

for (const [icon, asset] of [
  ['overnight-work-camp', 'actions/overnight-work-camp.png'],
  ['luxury-flowers', 'actions/luxury-flowers.png'],
  ['residence-tier-2', 'upgrades/residence-tier-2.png'],
  ['residence-tier-3', 'upgrades/residence-tier-3.png'],
  ['residence-tier-4', 'upgrades/residence-tier-4.png'],
  ['church-tier-2', 'upgrades/church-tier-2.png'],
  ['church-tier-3', 'upgrades/church-tier-3.png'],
] as const) {
  assert.match(
    actionCss,
    new RegExp(`data-action-icon='${icon}'[\\s\\S]{0,180}${escapeRegex(asset)}`),
    `${icon} should map to ${asset}`,
  );
}

assert.match(backyardRenderer, /data-action="upgrade-flower-luxury"[\s\S]*data-action-icon="luxury-flowers"/);
assert.match(residenceRenderer, /data-action="upgrade-residence" data-upgrade-tier="\$\{plan\.nextTier\}"[\s\S]*data-action-icon="residence-tier-\$\{plan\.nextTier\}"/);
assert.match(chapelRenderer, /data-action="upgrade-chapel" data-upgrade-tier="\$\{upgrade\.targetTier\}"[\s\S]*data-action-icon="church-tier-\$\{upgrade\.targetTier\}"/);
assert.match(campRenderer, /data-begin-remote-work-camp[\s\S]*data-action-icon="overnight-work-camp"|data-action-icon="overnight-work-camp"[\s\S]*data-begin-remote-work-camp/);
assert.match(campRenderer, /data-work-camp-action[\s\S]*Inspect overnight camp/);

assert.match(toolbar, /gk-icon--construction gk-icon--camp/);
assert.match(iconography, /gk-icon--construction[\s\S]*construction-actions\.png/);
assert.match(iconography, /gk-icon--camp \{ background-position: 100% 100%; \}/);

console.log('Complete backyard, workers-camp, residence-tier, church-tier, and flower-upgrade raster icon contracts passed.');

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
