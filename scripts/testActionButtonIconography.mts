import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import {
  BACKYARD_GARDEN_DEFINITIONS,
  BACKYARD_GARDEN_KINDS,
  FARM_CROP_KINDS,
} from '../src/generated/gameBalance.ts';
import {
  MONASTERY_EXTENSIONS,
} from '../src/buildings/monasteryEstate.ts';
import { BUILD_MENU_CATEGORIES } from '../src/ui/buildMenuCards.ts';

const backyardCss = readFileSync('src/ui/polishedGameUi.css', 'utf8');
const actionCss = readFileSync('src/ui/inspectorSupplemental.css', 'utf8');
const backyardRenderer = readFileSync('src/resources/inspector/backyardRenderer.ts', 'utf8');
const residenceRenderer = readFileSync('src/resources/inspector/residenceRenderer.ts', 'utf8');
const chapelRenderer = readFileSync('src/resources/inspector/chapelRenderer.ts', 'utf8');
const campRenderer = readFileSync('src/resources/inspector/remoteWorkCampRenderer.ts', 'utf8');
const expandedBuildingRenderer = readFileSync('src/resources/inspector/expandedBuildingRenderer.ts', 'utf8');
const farmFieldRenderer = readFileSync('src/resources/inspector/farmFieldRenderer.ts', 'utf8');
const livestockBuildingRenderer = readFileSync('src/resources/inspector/livestockBuildingRenderer.ts', 'utf8');
const inspectorResourceTokens = readFileSync('src/resources/inspector/inspectorResourceTokens.ts', 'utf8');
const supplementalPanel = readFileSync('src/resources/inspector/supplementalPanel.ts', 'utf8');
const resourceInspector = readFileSync('src/resources/ResourceInspector.ts', 'utf8');
const alertDialog = readFileSync('src/ui/AlertDialog.ts', 'utf8');
const alertDialogCss = readFileSync('src/ui/alertDialog.css', 'utf8');
const farmFieldTool = readFileSync('src/farming/FarmFieldTool.ts', 'utf8');
const appBootstrap = readFileSync('src/app/appBootstrap.ts', 'utf8');
const toolbar = readFileSync('src/ui/BuildToolbar.ts', 'utf8');
const iconography = readFileSync('src/ui/iconography.css', 'utf8');
const constructionDock = readFileSync('src/ui/constructionDock.css', 'utf8');

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
  'materials/roof-tiles.png',
  'materials/manure.png',
  'materials/remedies.png',
  'actions/graveyard.png',
  'actions/demolish.png',
  'actions/cattle-herd.png',
  'actions/sheep-flock.png',
  'actions/fallow-field.png',
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
  ['graveyard', 'actions/graveyard.png'],
  ['cattle-herd', 'actions/cattle-herd.png'],
  ['sheep-flock', 'actions/sheep-flock.png'],
] as const) {
  assert.match(
    actionCss,
    new RegExp(`data-action-icon='${icon}'[\\s\\S]{0,180}${escapeRegex(asset)}`),
    `${icon} should map to ${asset}`,
  );
}

assert.match(backyardRenderer, /data-action="upgrade-flower-luxury"[\s\S]*data-action-icon="luxury-flowers"/);
assert.match(residenceRenderer, /data-action="upgrade-residence" data-upgrade-tier="\$\{plan\.nextTier\}"[\s\S]*data-action-icon="residence-tier-\$\{plan\.nextTier\}"/);
assert.match(residenceRenderer, /data-residence-summary/);
assert.match(
  residenceRenderer,
  /data-residence-summary data-inspector-primary data-inspector-resource-strip data-inspector-section="Materials"[\s\S]{0,240}renderInspectorResourceStrip\(worksiteTokens/,
  'residence worksites should summarize materials as an icon strip',
);
assert.match(
  residenceRenderer,
  /data-residence-summary data-inspector-primary data-inspector-resource-strip data-inspector-section="Stores"[\s\S]{0,240}renderInspectorResourceStrip\(householdTokens/,
  'occupied residences should summarize household stores as an icon strip',
);
assert.match(inspectorResourceTokens, /tabindex="0" data-resource-token="\$\{options\.kind\}"/);
assert.match(inspectorResourceTokens, /data-tooltip-title="\$\{escapeHtml\(title\)\}" data-tooltip="\$\{escapeHtml\(detail\)\}"/);
assert.match(inspectorResourceTokens, /data-tooltip-amount="\$\{escapeHtml\(formattedAmount\)\}" data-tooltip-amount-label="\$\{escapeHtml\(amountLabel\)\}"/);
assert.match(inspectorResourceTokens, /data-tooltip-resources="\$\{escapeHtml\(tooltipResources\)\}"/);
assert.match(inspectorResourceTokens, /resource-cost__item" data-resource-cost="\$\{options\.kind\}"[\s\S]{0,120}resource-cost__icon/);
assert.match(inspectorResourceTokens, /inspector-resource-strip[\s\S]{0,520}role="group" aria-label=/);
assert.match(chapelRenderer, /data-action="upgrade-chapel" data-upgrade-tier="\$\{upgrade\.targetTier\}"[\s\S]*data-action-icon="church-tier-\$\{upgrade\.targetTier\}"/);
assert.match(campRenderer, /data-begin-remote-work-camp[\s\S]*data-action-icon="overnight-work-camp"|data-action-icon="overnight-work-camp"[\s\S]*data-begin-remote-work-camp/);
assert.match(campRenderer, /data-work-camp-action[\s\S]*Inspect overnight camp/);

for (const [resource, asset] of [
  ['roofTiles', 'materials/roof-tiles.png'],
  ['manure', 'materials/manure.png'],
  ['remedies', 'materials/remedies.png'],
] as const) {
  assert.match(
    iconography,
    new RegExp(`data-resource(?:-cost)?='${resource}'[\\s\\S]{0,260}${escapeRegex(asset)}`),
    `${resource} should use generated raster artwork`,
  );
}
assert.doesNotMatch(iconography, /\.svg(?:['")])/i, 'active commodity mappings must not use SVG artwork');
assert.match(iconography, /\.resource-cost--unaffordable\s*\{[\s\S]{0,120}color:\s*#f09a82/);

assert.match(resourceInspector, /data-fire-recovery[\s\S]{0,520}data-action-icon="fire-recovery"|data-action-icon="fire-recovery"[\s\S]{0,520}data-fire-recovery/);
assert.match(resourceInspector, /recoveryBlocked \? 'aria-disabled="true"' : ''/);
assert.match(resourceInspector, /if \(fireRecoveryButton\.getAttribute\('aria-disabled'\) === 'true'\) return/);
assert.match(resourceInspector, /<span>\$\{recoveryLabel\}\$\{coolingSeconds/);
assert.match(supplementalPanel, /if \(upgradeButton\.getAttribute\('aria-disabled'\) === 'true'\) return true/);
assert.match(
  resourceInspector,
  /row\.hasAttribute\('data-residence-summary'\)[\s\S]{0,260}this\.panel\.dataset\.inspectorTarget === 'residence'[\s\S]{0,180}replaceChildren/,
  'the residence inspector should display only explicitly compact summary rows',
);
assert.match(resourceInspector, /const BUILDING_SUMMARY_LIMIT = 4/);
assert.match(
  resourceInspector,
  /this\.panel\.dataset\.inspectorTarget === 'building'[\s\S]{0,1200}\.slice\(0, BUILDING_SUMMARY_LIMIT\);[\s\S]{0,1800}replaceChildren/,
  'every building inspector should have a hard four-card summary cap',
);
assert.match(
  resourceInspector,
  /omittedPrimaryDetails[\s\S]{0,900}appendFocusableInspectorTooltip/,
  'primary details beyond the visible cap should remain keyboard-accessible',
);
assert.match(
  resourceInspector,
  /const compactDemolition = target\.kind === 'building' \|\| target\.kind === 'residence'[\s\S]{0,220}this\.demolishHint\.hidden = compactDemolition/,
  'building and residence salvage prose should move off the default card',
);
assert.match(resourceInspector, /this\.laborHint\.hidden = target\.kind === 'building'/);
assert.match(
  resourceInspector,
  /compactBuildingSupplementalPanels[\s\S]{0,2200}controls\.length === 0[\s\S]{0,520}panel\.remove\(\)/,
  'read-only supplemental essays should not occupy building cards',
);
assert.match(
  resourceInspector,
  /:scope > \.inspector-action-panel__hint, :scope > \.resource-inspector-note, \.trading-post-ledger__intro[\s\S]{0,240}nextElementSibling\?\.matches\('\.resource-action-row'\)/,
  'building compaction should preserve nested labels inside expanded controls',
);
assert.match(resourceInspector, /compactChildren\.length > 1 && compactChildren\.every/);
assert.match(resourceInspector, /function syncFocusableInspectorTooltip/);
assert.match(resourceInspector, /this\.laborLabel,[\s\S]{0,120}target\.kind === 'building' \? view\.labor\.hint/);
assert.match(
  resourceInspector,
  /const shouldOrganize = compactBuilding[\s\S]{0,220}inspectorControlCount/,
  'multi-control building policies should be compact disclosures closed by default',
);
assert.match(resourceInspector, /: !compactBuilding && index === 0/);
assert.match(backyardCss, /\.resource-inspector-demolish\[hidden\]\s*\{\s*display:\s*none/);
assert.match(
  resourceInspector,
  /onDemolishSecondaryClick[\s\S]{0,420}confirmDestructiveAction\([\s\S]{0,260}onDemolishBurgageZone/,
  'plot removal must use the shared destructive-action confirmation path',
);
assert.match(
  resourceInspector,
  /const confirmed = await this\.deleteDialog\.confirm\([\s\S]{0,320}if \(!confirmed\) return;[\s\S]{0,80}await action\(\)/,
  'destructive reducers must run only after explicit confirmation',
);
assert.match(resourceInspector, /\$\{targetLabel\} · irreversible\. \$\{detail\}/);
assert.match(resourceInspector, /this\.deleteDialog = new AlertDialog\(options\.uiRoot\)/);
assert.match(resourceInspector, /this\.deleteDialog\.dispose\(\)/);
assert.match(alertDialog, /export class AlertDialog/);
assert.match(alertDialog, /role="alertdialog"[\s\S]{0,180}aria-modal="true"[\s\S]{0,180}aria-labelledby=/);
assert.match(alertDialog, /this\.cancelButton\.focus\(\{ preventScroll: true \}\)/);
assert.match(alertDialog, /event\.key === 'Escape'[\s\S]{0,120}this\.settle\(false\)/);
assert.match(alertDialog, /event\.key === 'Tab'\) this\.trapFocus\(event\)/);
assert.match(alertDialogCss, /\.alert-dialog-backdrop\s*\{/);
assert.match(alertDialogCss, /\.alert-dialog\s*\{/);
assert.match(expandedBuildingRenderer, /FARM_CROPS\.map\(\(crop\)[\s\S]{0,520}data-land-parcel="field"[\s\S]{0,260}data-field-layout-crop="\$\{crop\}"[\s\S]{0,620}data-field-crop-icon="\$\{crop\}"/);
assert.match(expandedBuildingRenderer, /data-land-parcel="field"[^>]*data-tooltip-cost="\$\{FREE_CONSTRUCTION_COST_TOOLTIP\}"/);
assert.match(expandedBuildingRenderer, /data-land-parcel="vineyard"[^>]*data-tooltip-cost="\$\{FREE_CONSTRUCTION_COST_TOOLTIP\}"/);
assert.match(resourceInspector, /data-field-layout-crop[\s\S]{0,420}onBeginFarmFieldPlacement\?\.\(building\.id, crop\)/);
assert.match(farmFieldTool, /setCrop\(crop: FarmCrop\)[\s\S]{0,420}this\.crop = crop/);
assert.match(appBootstrap, /onBeginFarmFieldPlacement: \(farmsteadId, crop\)[\s\S]{0,240}farmFieldTool\.setCrop\(crop\)[\s\S]{0,240}beginLinkedLandParcelPlacement\('field', farmsteadId\)/);
assert.match(chapelRenderer, /data-land-parcel="graveyard"[\s\S]{0,760}data-action-icon="graveyard"|data-action-icon="graveyard"[\s\S]{0,760}data-land-parcel="graveyard"/);
assert.match(chapelRenderer, /data-land-parcel="graveyard"[^>]*data-tooltip-cost="\$\{FREE_CONSTRUCTION_COST_TOOLTIP\}"/);
assert.match(livestockBuildingRenderer, /data-livestock-species="cattle"[\s\S]{0,260}data-action-icon="cattle-herd"|data-action-icon="cattle-herd"[\s\S]{0,260}data-livestock-species="cattle"/);
assert.match(livestockBuildingRenderer, /data-livestock-species="sheep"[\s\S]{0,260}data-action-icon="sheep-flock"|data-action-icon="sheep-flock"[\s\S]{0,260}data-livestock-species="sheep"/);
assert.match(livestockBuildingRenderer, /data-land-parcel="pasture"[\s\S]{0,760}data-action-icon="pasture-parcel"|data-action-icon="pasture-parcel"[\s\S]{0,760}data-land-parcel="pasture"/);
assert.match(livestockBuildingRenderer, /data-land-parcel="pasture"[^>]*data-tooltip-cost="\$\{FREE_CONSTRUCTION_COST_TOOLTIP\}"/);
assert.match(farmFieldRenderer, /data-field-early-harvest[\s\S]{0,260}data-action-icon="early-harvest"|data-action-icon="early-harvest"[\s\S]{0,260}data-field-early-harvest/);
assert.match(backyardCss, /resource-inspector-demolish::before[\s\S]{0,240}actions\/demolish\.png/);

for (const icon of ['fire-recovery', 'early-harvest'] as const) {
  assert.match(
    actionCss,
    new RegExp(`data-action-icon='${icon}'[\\s\\S]{0,260}construction-actions\\.png|construction-actions\\.png[\\s\\S]{0,260}data-action-icon='${icon}'`),
    `${icon} should reuse the construction-action atlas`,
  );
}
assert.match(actionCss, /data-action-icon='pasture-parcel'[\s\S]{0,180}build-menu\/cards\/pasture\.webp/);

const cropArtwork: Record<(typeof FARM_CROP_KINDS)[number], string> = {
  rye: 'provisions/rye-sheaves.png',
  oats: 'provisions/oat-sheaves.png',
  fallow: 'icons/actions/fallow-field.png',
  barley: 'provisions/barley-sheaves.png',
  flax: 'hud-resources-goods-b.png',
  wheat: 'provisions/maslin-sheaves.png',
};
assert.deepEqual(Object.keys(cropArtwork).sort(), [...FARM_CROP_KINDS].sort());
assert.match(farmFieldRenderer, /data-field-crop-icon="\$\{crop\}"/);
for (const [crop, asset] of Object.entries(cropArtwork)) {
  assert.match(
    actionCss,
    new RegExp(`data-field-crop-icon='${crop}'[\\s\\S]{0,220}${escapeRegex(asset)}`),
    `${crop} choice should use ${asset}`,
  );
}

const buildCategoryArtwork = new Map([
  ['civic', 'town-hall.webp'],
  ['trade', 'trading-post.webp'],
  ['gathering', 'foragers-hut.webp'],
  ['agriculture', 'grain-field.webp'],
  ['food', 'bakery.webp'],
  ['industry', 'watermill.webp'],
  ['faith', 'chapel.webp'],
  ['decorations', 'wayside-shrine.webp'],
  ['military', 'watchtower.webp'],
] as const);
assert.deepEqual(
  [...buildCategoryArtwork.keys()].sort(),
  BUILD_MENU_CATEGORIES.map((category) => category.icon).sort(),
  'every build-menu category must have a raster-art contract',
);
assert.match(toolbar, /data-build-category-icon="\$\{category\}"/);
assert.doesNotMatch(toolbar, /renderBuildMenuCategoryIcon[\s\S]{0,1800}<svg/);
for (const [category, asset] of buildCategoryArtwork) {
  assert.match(
    backyardCss,
    new RegExp(`data-build-category-icon='${category}'[\\s\\S]{0,220}build-menu/cards/${escapeRegex(asset)}`),
    `${category} category should use ${asset}`,
  );
  assert.ok(existsSync(`public/assets/ui/build-menu/cards/${asset}`));
}

const mapOverlayArtwork = new Map([
  ['water', 'water-well.webp'],
  ['wind', 'windmill.webp'],
  ['fertility', 'grain-field.webp'],
] as const);
for (const [overlay, asset] of mapOverlayArtwork) {
  assert.match(
    toolbar,
    new RegExp(`data-map-overlay-icon="${overlay}"`),
    `${overlay} overlay should render a decorative woodcut-art slot`,
  );
  assert.match(
    constructionDock,
    new RegExp(`data-map-overlay-icon='${overlay}'[\\s\\S]{0,220}build-menu/cards/${escapeRegex(asset)}`),
    `${overlay} overlay should use ${asset}`,
  );
  assert.ok(existsSync(`public/assets/ui/build-menu/cards/${asset}`));
}
assert.doesNotMatch(toolbar, /map-overlay-option__icon--(?:water|wind|fertility)/);
assert.doesNotMatch(
  constructionDock,
  /map-overlay-option__icon--(?:water|wind|fertility)/,
  'map overlay choices should not fall back to generic CSS line drawings',
);

assert.match(toolbar, /gk-icon--construction gk-icon--camp/);
assert.match(iconography, /gk-icon--construction[\s\S]*construction-actions\.png/);
assert.match(iconography, /gk-icon--camp \{ background-position: 100% 100%; \}/);

const monasteryExtensionArtwork = new Map([
  [1, 'infirmary-wing.png'],
  [2, 'scriptorium-archive.png'],
  [4, 'guesthouse.png'],
  [8, 'estate-workshop.png'],
] as const);
assert.deepEqual(
  [...monasteryExtensionArtwork.keys()].sort((a, b) => a - b),
  MONASTERY_EXTENSIONS.map((extension) => extension.value).sort((a, b) => a - b),
  'every monastery extension must have an icon-card contract',
);
for (const [value, asset] of monasteryExtensionArtwork) {
  const path = `public/assets/ui/icons/monastery/${asset}`;
  assert.ok(existsSync(path), `${asset} must exist for monastery extension ${value}`);
  assert.ok(statSync(path).size > 80_000, `${asset} must be substantive custom woodcut artwork`);
  assert.match(
    actionCss,
    new RegExp(`data-monastery-extension-icon='${value}'[\\s\\S]{0,180}icons/monastery/${escapeRegex(asset)}`),
    `monastery extension ${value} should use ${asset}`,
  );
}
assert.match(expandedBuildingRenderer, /class="monastery-extension-grid"[\s\S]*data-monastery-extension-choice="\$\{extension\.value\}"/);
assert.doesNotMatch(expandedBuildingRenderer, /id="monastery-next-extension" data-monastery-next-extension/);
assert.match(resourceInspector, /data-monastery-extension-choice[\s\S]{0,500}onSetMonasteryNextExtension/);

assert.doesNotMatch(expandedBuildingRenderer, /monastery-planting-grid|data-monastery-(?:orchard|croft)-choice/);
assert.doesNotMatch(resourceInspector, /data-monastery-croft-choice/);
assert.match(expandedBuildingRenderer, /Mixed orchard and kitchen gardens/);
assert.match(expandedBuildingRenderer, /no apple-versus-pear or cabbage-versus-carrot choices/i);

console.log('Complete backyard, upgrade, monastery, commodity, crop, livestock, land-project, demolition, recovery, build-category, and map-overlay icon contracts passed.');

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
