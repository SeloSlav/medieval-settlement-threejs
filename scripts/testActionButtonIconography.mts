import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  BACKYARD_GARDEN_DEFINITIONS,
  BACKYARD_GARDEN_KINDS,
  BUILDING_KINDS,
  FARM_CROP_KINDS,
} from '../src/generated/gameBalance.ts';
import {
  MONASTERY_EXTENSIONS,
} from '../src/buildings/monasteryEstate.ts';
import { BUILD_MENU_CATEGORIES } from '../src/ui/buildMenuCards.ts';
import {
  forestryWorkAreaDetailRow,
  renderForestryWorkAreaPanel,
} from '../src/resources/inspector/treeWorkAreaRenderer.ts';
import { renderInspectorResourceToken } from '../src/resources/inspector/inspectorResourceTokens.ts';

type SharpDecodeResult = {
  data: Uint8Array;
  info: { width: number; height: number; channels: number };
};
type SharpImage = {
  raw(): {
    toBuffer(options: { resolveWithObject: true }): Promise<SharpDecodeResult>;
  };
};
const vendorRequire = createRequire(resolve('vendor/seedthree/package.json'));
const sharp = vendorRequire('sharp') as (input: string) => SharpImage;

async function assertRasterDecodes(path: string, label: string): Promise<void> {
  const decoded = await sharp(path).raw().toBuffer({ resolveWithObject: true });
  assert.ok(decoded.info.width > 0 && decoded.info.height > 0, `${label} must decode at nonzero dimensions`);
  assert.ok(decoded.info.channels >= 3, `${label} must decode as RGB or RGBA`);
  assert.equal(
    decoded.data.byteLength,
    decoded.info.width * decoded.info.height * decoded.info.channels,
    `${label} must decode every raster pixel`,
  );
}

const backyardCss = readFileSync('src/ui/polishedGameUi.css', 'utf8');
const actionCss = readFileSync('src/ui/inspectorSupplemental.css', 'utf8');
const backyardRenderer = readFileSync('src/resources/inspector/backyardRenderer.ts', 'utf8');
const residenceRenderer = readFileSync('src/resources/inspector/residenceRenderer.ts', 'utf8');
const chapelRenderer = readFileSync('src/resources/inspector/chapelRenderer.ts', 'utf8');
const campRenderer = readFileSync('src/resources/inspector/remoteWorkCampRenderer.ts', 'utf8');
const expandedBuildingRenderer = readFileSync('src/resources/inspector/expandedBuildingRenderer.ts', 'utf8');
const farmFieldRenderer = readFileSync('src/resources/inspector/farmFieldRenderer.ts', 'utf8');
const livestockBuildingRenderer = readFileSync('src/resources/inspector/livestockBuildingRenderer.ts', 'utf8');
const townHallRenderer = readFileSync('src/resources/inspector/townHallRenderer.ts', 'utf8');
const marketplaceTradeRenderer = readFileSync('src/resources/inspector/marketplaceTradeRenderer.ts', 'utf8');
const storageAcceptancePolicy = readFileSync('src/economy/storageAcceptancePolicy.ts', 'utf8');
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
const lumberMillRenderer = readFileSync('src/resources/inspector/lumberMillRenderer.ts', 'utf8');
const reforesterRenderer = readFileSync('src/resources/inspector/reforesterRenderer.ts', 'utf8');
const harvestBuildingRenderer = readFileSync('src/resources/inspector/harvestBuildingRenderer.ts', 'utf8');

const inspectorArtBlock = resourceInspector.match(
  /const BUILDING_INSPECTOR_ART = \{([\s\S]*?)\}\s+satisfies Record<BuildingKind, string>;/,
)?.[1] ?? '';
const inspectorArtwork = new Map(
  [...inspectorArtBlock.matchAll(/^\s{2}([a-z0-9_]+): '([^']+)',?$/gm)]
    .map((match) => [match[1], match[2]] as const),
);
assert.deepEqual(
  [...inspectorArtwork.keys()].sort(),
  [...BUILDING_KINDS].sort(),
  'every authoritative building kind must have explicit inspector artwork',
);
for (const [kind, url] of inspectorArtwork) {
  const path = `public${url}`;
  assert.ok(existsSync(path), `${kind} inspector art must resolve: ${url}`);
  assert.ok(statSync(path).size > 20_000, `${kind} inspector art must be nonblank: ${url}`);
  await assertRasterDecodes(path, `${kind} inspector art`);
}
for (const [kind, expectedUrl] of Object.entries({
  remote_work_camp: '/assets/ui/icons/actions/overnight-work-camp.png',
  mine: '/assets/ui/build-menu/cards/iron-mine.webp',
  clay_pit: '/assets/ui/build-menu/cards/clay-pit.webp',
  charcoal_burner: '/assets/ui/build-menu/cards/charcoal-burner.webp',
  smithy: '/assets/ui/build-menu/cards/smithy-bloomery.webp',
  potter_kiln: '/assets/ui/build-menu/cards/potter-kiln.webp',
  wayside_shrine: '/assets/ui/build-menu/cards/wayside-shrine.webp',
  trading_post: '/assets/ui/build-menu/cards/trading-post.webp',
  palisaded_refuge: '/assets/ui/build-menu/cards/palisaded-refuge.webp',
  tavern: '/assets/ui/build-menu/cards/tavern.webp',
  bakery: '/assets/ui/build-menu/cards/bakery.webp',
})) {
  assert.equal(inspectorArtwork.get(kind), expectedUrl, `${kind} must use the intended inspector art`);
}
assert.match(resourceInspector, /data-inspector-hero-image alt="" decoding="async"/);
assert.match(resourceInspector, /this\.heroImage\.onerror = markArtUnavailable/);
assert.match(resourceInspector, /this\.heroImage\.decode\(\)\.then\(markArtAvailable\)\.catch\(markArtUnavailable\)/);
assert.match(
  resourceInspector,
  /DEFAULT_TOTAL_RESOURCE_TOOLTIP[\s\S]{0,260}household reserves and goods committed to active projects/,
  'total-mode resource tooltips must describe committed and household stock instead of retaining surplus-only copy',
);
assert.match(
  resourceInspector,
  /TOTAL_RESOURCE_TOOLTIPS\[resource\][\s\S]{0,100}\?\? DEFAULT_TOTAL_RESOURCE_TOOLTIP/,
  'every HUD resource without a tailored total tooltip must receive the truthful total-mode fallback',
);
assert.match(backyardCss, /\.resource-inspector-hero-image\[hidden\]\s*\{\s*display:\s*none/);
assert.match(backyardCss, /\.resource-inspector-hero-art\.is-art-unavailable\s*\{/);

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
  await assertRasterDecodes(path, asset);
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
assert.match(inspectorResourceTokens, /const INSPECTOR_RESOURCE_TOOLTIP_MAX_LENGTH = 120/);
assert.match(
  inspectorResourceTokens,
  /const detail = compactTooltipDetail\(options\.detail\?\.trim\(\) \|\| 'Current amount'\)/,
  'resource-token details must use the concise tooltip path',
);
assert.match(
  inspectorResourceTokens,
  /function compactTooltipDetail\([\s\S]{0,700}INSPECTOR_RESOURCE_TOOLTIP_MAX_LENGTH[\s\S]{0,360}\.slice\(/,
  'resource-token tooltip compaction must enforce its hard cap',
);
const verboseResourceToken = renderInspectorResourceToken({
  kind: 'timber',
  amount: 12,
  detail: 'Timber is held across this worksite while carts, builders, household projects, road access, and several competing construction claims all wait for their next dispatch cycle',
});
const compactResourceTooltip = verboseResourceToken.match(/data-tooltip="([^"]*)"/)?.[1] ?? '';
assert.ok(compactResourceTooltip.length > 0);
assert.ok(compactResourceTooltip.length <= 120, 'rendered resource-token tooltips must stay within 120 characters');
assert.match(compactResourceTooltip, /…$/);
assert.match(
  chapelRenderer,
  /<button(?=[^>]*data-action="upgrade-chapel")(?=[^>]*class="[^"]*\bresource-action-button\b)[^>]*>[\s\S]*?data-action-icon="church-tier-\$\{upgrade\.targetTier\}"/,
  'chapel upgrades must use the shared building-card action button',
);
assert.match(campRenderer, /data-begin-remote-work-camp[\s\S]*data-action-icon="overnight-work-camp"|data-action-icon="overnight-work-camp"[\s\S]*data-begin-remote-work-camp/);
assert.match(campRenderer, /data-work-camp-action[\s\S]*Inspect overnight camp/);
assert.match(
  campRenderer,
  /<button(?=[^>]*data-work-camp-action)(?=[^>]*class="[^"]*\bresource-action-button\b)[^>]*>/,
  'overnight-camp actions must use the shared building-card action button',
);
assert.doesNotMatch(chapelRenderer, /inspector-action-panel__button/);
assert.doesNotMatch(campRenderer, /inspector-action-panel__button/);

const forestryBuilding = {
  id: 'lumber-1',
  kind: 'lumber_mill' as const,
  x: 10,
  z: 20,
  workRadius: 210,
};
const defaultWorkAreaPanel = renderForestryWorkAreaPanel(forestryBuilding);
assert.match(defaultWorkAreaPanel, /data-inspector-pinned-action/);
assert.match(defaultWorkAreaPanel, /data-tree-work-area-action/);
assert.match(defaultWorkAreaPanel, /data-action-icon="tree-work-area"/);
assert.match(defaultWorkAreaPanel, /aria-pressed="false"/);
assert.match(defaultWorkAreaPanel, /Hold Ctrl and use the mouse wheel/);
assert.match(forestryWorkAreaDetailRow(forestryBuilding), /Default extent · 210 m/);

const activeWorkAreaBuilding = {
  ...forestryBuilding,
  treeWorkArea: { x: 40, z: 60, radius: 48 },
};
const activeWorkAreaPanel = renderForestryWorkAreaPanel(activeWorkAreaBuilding);
assert.match(activeWorkAreaPanel, /data-tree-work-area-state="active"/);
assert.match(activeWorkAreaPanel, /aria-pressed="true"/);
assert.match(activeWorkAreaPanel, /Limited work area · 48 m/);
assert.match(activeWorkAreaPanel, /Click to remove the limit/);
assert.doesNotMatch(activeWorkAreaPanel, / disabled(?:[\s>])/);
assert.match(forestryWorkAreaDetailRow(activeWorkAreaBuilding), /Limited circle · 48 m/);

const pendingWorkAreaPanel = renderForestryWorkAreaPanel(forestryBuilding, { pending: true });
assert.match(pendingWorkAreaPanel, /data-tree-work-area-state="pending"/);
assert.match(pendingWorkAreaPanel, /resource-action-button--toggle is-pending/);
assert.match(pendingWorkAreaPanel, /Press Escape to cancel/);
for (const renderer of [lumberMillRenderer, reforesterRenderer]) {
  assert.match(renderer, /renderForestryWorkAreaPanel\(building/);
  assert.match(renderer, /pendingTreeWorkAreaBuildingId === building\.id/);
  assert.match(renderer, /forestryWorkAreaDetailRow\(building\)/);
}
assert.match(resourceInspector, /onBeginTreeWorkAreaPlacement\?:/);
assert.match(resourceInspector, /onClearTreeWorkArea\?:/);
assert.match(
  resourceInspector,
  /hasCustomTreeWorkArea\(building\)[\s\S]{0,180}onClearTreeWorkArea\?\.[\s\S]{0,180}onBeginTreeWorkAreaPlacement\?\./,
);
assert.doesNotMatch(
  resourceInspector,
  /hasAttribute\('data-inspector-pinned-action'\)/,
  'pinned work-area panels should pass through the same concise central standardization',
);
assert.match(actionCss, /data-action-icon='tree-work-area'[\s\S]{0,520}linear-gradient/);
assert.match(actionCss, /background-size:\s*6px 6px, 6px 6px, 100% 100%/);
assert.match(backyardCss, /resource-action-button--toggle\[aria-pressed='true'\]/);
assert.match(backyardCss, /resource-action-button--toggle\.is-pending/);

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
for (const [markerKind, artFamily] of [
  ['quarry', 'stone'],
  ['game', 'game'],
  ['berries', 'berries'],
  ['mushrooms', 'mushrooms'],
  ['fish', 'fish'],
  ['clay', 'clay'],
  ['iron', 'iron'],
  ['salt', 'salt'],
] as const) {
  for (const variant of ['normal', 'rich'] as const) {
    const asset = `${artFamily}-${variant}.png`;
    assert.match(
      iconography,
      new RegExp(`map-resource-icon-glyph--${markerKind}[\\s\\S]{0,260}${escapeRegex(asset)}`),
      `${markerKind} map markers must use the ${variant} inspector/map-stamp portrait`,
    );
    assert.ok(statSync(`public/assets/ui/map-stamps/${asset}`).size > 20_000);
  }
}
assert.match(
  iconography,
  /\.map-resource-icon-glyph\s*\{[\s\S]{0,260}background-position:\s*center;[\s\S]{0,120}background-size:\s*contain;/,
  'resource portraits must stay centered on the shared world-space marker anchor',
);
assert.match(
  iconography,
  /\.resource-node-marker--rich \.map-resource-icon-glyph\s*\{[\s\S]{0,180}background-image:\s*var\(--map-resource-art-rich\)/,
  'rich nodes must swap to the matching rich resource portrait',
);
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
const compactDemolitionBlock = resourceInspector.match(
  /const compactDemolition =[\s\S]*?;/,
)?.[0] ?? '';
for (const targetKind of ['building', 'residence', 'backyard', 'farm-field', 'pasture'] as const) {
  assert.match(
    compactDemolitionBlock,
    new RegExp(`target\\.kind === '${escapeRegex(targetKind)}'`),
    `${targetKind} demolition guidance should move into the shared concise tooltip`,
  );
}
assert.match(resourceInspector, /this\.demolishHint\.hidden = compactDemolition/);
assert.match(resourceInspector, /this\.demolishSecondaryHint\.hidden = compactDemolition/);
assert.match(
  resourceInspector,
  /syncInspectorTooltip\([\s\S]{0,180}compactDemolition \? view\.demolish\.hint : ''/,
  'primary demolition guidance should remain available through the concise tooltip path',
);
assert.match(resourceInspector, /this\.laborHint\.hidden = target\.kind === 'building'/);
assert.match(
  resourceInspector,
  /standardizeSupplementalPanels[\s\S]{0,2600}controls\.length === 0[\s\S]{0,520}panel\.remove\(\)/,
  'read-only supplemental essays should not occupy building cards',
);
assert.match(
  resourceInspector,
  /const subgroupNodes = \[\.\.\.panel\.querySelectorAll<HTMLElement>/,
  'long action notes should collapse to concise subgroup labels instead of remaining as visible essays',
);
assert.match(resourceInspector, /nextElementSibling\?\.matches\('\.resource-action-row'\)/);
assert.match(resourceInspector, /node\.className = 'inspector-action-panel__subheading'/);
assert.match(resourceInspector, /syncFocusableInspectorTooltip\(node, subgroupLabel, detail\)/);
assert.match(resourceInspector, /compactChildren\.length > 1 && compactChildren\.every/);
assert.match(resourceInspector, /function syncFocusableInspectorTooltip/);
assert.match(resourceInspector, /this\.laborLabel,[\s\S]{0,120}target\.kind === 'building' \? view\.labor\.hint/);
assert.match(
  resourceInspector,
  /standardizeSupplementalPanels[\s\S]{0,5200}\w+\.classList\.add\('resource-action-button'\)/,
  'supplemental building-card buttons should be normalized to the shared action control',
);
assert.match(resourceInspector, /dataset\.inspectorActionGroup/);
assert.doesNotMatch(
  resourceInspector,
  /document\.createElement\(['"](?:details|summary)['"]\)/,
  'resource inspector controls must remain flat instead of creating accordions',
);
assert.doesNotMatch(resourceInspector, /inspector-policy-card/);
assert.match(resourceInspector, /const INSPECTOR_TOOLTIP_MAX_LENGTH = 120/);
assert.match(
  resourceInspector,
  /function compactInspectorDetail\([\s\S]{0,900}INSPECTOR_TOOLTIP_MAX_LENGTH[\s\S]{0,500}\.slice\(/,
  'all inspector tooltip detail must pass through a hard concise-length cap',
);
assert.match(resourceInspector, /function compactActionTooltip\(/);
assert.match(
  resourceInspector,
  /function syncInspectorTooltip\([\s\S]{0,420}compactInspectorDetail\(detail\)/,
  'the common tooltip writer must enforce the concise cap',
);
assert.match(
  resourceInspector,
  /standardizeSupplementalPanels[\s\S]{0,5200}compactActionTooltip\(/,
  'supplemental action guidance must be compacted before becoming a tooltip',
);
assert.match(townHallRenderer, /<option[^>]*title=/, 'Town Hall policies should retain native option guidance');
assert.match(
  resourceInspector,
  /querySelectorAll<HTMLElement>\([\s\S]{0,80}'\[title\], \[data-tooltip\]'[\s\S]{0,180}instanceof HTMLButtonElement[\s\S]{0,120}compactNonButtonTooltip\(tooltipTarget\)/,
  'native and data tooltip text on non-button policy controls must use the shared compact path',
);
const compactNonButtonTooltipBlock = resourceInspector.match(
  /function compactNonButtonTooltip\([\s\S]*?\n}/,
)?.[0] ?? '';
assert.match(
  compactNonButtonTooltipBlock,
  /const detail = compactInspectorDetail\(element\.dataset\.tooltip\?\.trim\(\) \|\| nativeTitle\)/,
  'non-button tooltip details must be capped before any native or custom presentation',
);
assert.match(
  compactNonButtonTooltipBlock,
  /element instanceof HTMLOptionElement[\s\S]{0,100}element\.title = detail[\s\S]{0,60}return/,
  'native option tooltips should preserve only their capped detail',
);
assert.match(
  compactNonButtonTooltipBlock,
  /element\.removeAttribute\('title'\)[\s\S]{0,100}syncInspectorTooltip\(element, title, detail\)/,
  'other non-button controls should move capped native titles into the shared tooltip',
);
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

for (const [source, selector, label] of [
  [resourceInspector, 'data-action="demolish-primary"', 'primary demolition'],
  [resourceInspector, 'data-action="demolish-secondary"', 'secondary demolition'],
  [resourceInspector, 'data-fire-recovery', 'repair'],
  [residenceRenderer, 'data-action="upgrade-residence"', 'residence upgrade'],
  [chapelRenderer, 'data-land-parcel="graveyard"', 'burial-ground layout'],
  [chapelRenderer, 'data-demolish-graveyard=', 'empty burial-ground removal'],
  [farmFieldRenderer, 'data-field-early-harvest', 'early harvest'],
  [backyardRenderer, 'data-inspector-action="place-garden"', 'backyard extension choice'],
  [backyardRenderer, 'data-inspector-action="specialize-orchard"', 'orchard specialization'],
  [backyardRenderer, 'data-inspector-action="specialize-animal-pen"', 'animal-pen specialization'],
  [backyardRenderer, 'data-inspector-action="specialize-vegetable-garden"', 'vegetable-garden specialization'],
  [expandedBuildingRenderer, 'data-monastery-extension-choice=', 'monastery extension'],
  [marketplaceTradeRenderer, 'data-trade-rule-mode=', 'Trading Post mode'],
  [marketplaceTradeRenderer, 'data-trade-surplus-delta=', 'Trading Post target stepper'],
  [storageAcceptancePolicy, 'data-storage-accept-all=', 'storage bulk acceptance'],
  [storageAcceptancePolicy, 'data-storage-commodity=', 'storage commodity toggle'],
] as const) {
  assert.match(
    source,
    new RegExp(`<button(?=[^>]*${escapeRegex(selector)})(?=[^>]*class="[^"]*\\bresource-action-button\\b)[^>]*>`),
    `${label} must use the shared building-card action button`,
  );
}

for (const [source, selector, modifier, label] of [
  [chapelRenderer, 'data-demolish-graveyard=', 'resource-action-button--danger', 'empty burial-ground removal'],
  [expandedBuildingRenderer, 'data-monastery-extension-choice=', 'resource-action-button--toggle', 'monastery extension'],
  [marketplaceTradeRenderer, 'data-trade-rule-mode=', 'resource-action-button--toggle', 'Trading Post mode'],
  [storageAcceptancePolicy, 'data-storage-commodity=', 'resource-action-button--toggle', 'storage commodity'],
] as const) {
  assert.match(
    source,
    new RegExp(`<button(?=[^>]*${escapeRegex(selector)})(?=[^>]*class="[^"]*\\b${escapeRegex(modifier)}\\b)[^>]*>`),
    `${label} must retain its shared ${modifier} semantics`,
  );
}

const buildingCardButtonSources = [
  ...readdirSync('src/resources/inspector')
    .filter((file) => file.endsWith('.ts'))
    .map((file) => [`src/resources/inspector/${file}`, readFileSync(`src/resources/inspector/${file}`, 'utf8')] as const),
  ['src/economy/storageAcceptancePolicy.ts', storageAcceptancePolicy] as const,
];
for (const [file, source] of buildingCardButtonSources) {
  assert.doesNotMatch(
    source,
    /<(?:details|summary)\b|createElement\(['"](?:details|summary)['"]\)/,
    `${file} must not add an accordion to a building card`,
  );
  for (const match of source.matchAll(/<button\b[\s\S]*?>/g)) {
    const button = match[0];
    assert.ok(
      /\bresource-action-button\b/.test(button) || /\binspector-jump-button\b/.test(button),
      `${file} building-card buttons must use the shared action family (inline Inspect navigation is exempt): ${button.replace(/\s+/g, ' ').slice(0, 180)}`,
    );
  }
}
for (const match of resourceInspector.matchAll(/<button\b[\s\S]*?>/g)) {
  const button = match[0];
  assert.ok(
    /\bresource-action-button\b/.test(button) || /\bresource-inspector-close\b/.test(button),
    `ResourceInspector building-card controls must use the shared action family (panel close is exempt): ${button.replace(/\s+/g, ' ').slice(0, 180)}`,
  );
}

assert.match(harvestBuildingRenderer, /building\.kind === 'hunters_hall'[\s\S]{0,80}'Hunt'/);
assert.match(harvestBuildingRenderer, /building\.kind === 'fishing_camp'[\s\S]{0,80}'Fish'/);
assert.match(harvestBuildingRenderer, /:\s*'Gather'/);
assert.match(
  harvestBuildingRenderer,
  /data-inspector-panel-title="\$\{reserveActionVerb\} until \$\{reserveSliderValue\} \$\{stockUnit\} remain"/,
  'harvest control groups must use the same verb-until-population label shape',
);
assert.match(
  harvestBuildingRenderer,
  /<span>\$\{reserveActionVerb\} until<\/span>[\s\S]{0,160}<strong data-harvest-reserve-value>\$\{reserveSliderValue\} \$\{stockUnit\}<\/strong>[\s\S]{0,100}<span>remain<\/span>/,
  'the visible harvest control must mirror its standardized action label',
);
assert.match(harvestBuildingRenderer, /data-harvest-reserve-share>\$\{reservePercent\}% of capacity/);
assert.doesNotMatch(harvestBuildingRenderer, /Stop harvesting at/);
assert.doesNotMatch(
  harvestBuildingRenderer,
  /Set the quantity this camp|same proportional floor adapts|Rich shoals hold|Every habitat keeps|Berry thickets and mushroom beds regrow/,
  'harvest controls should not retain essay-length descriptions',
);
const harvestLiveStart = resourceInspector.indexOf(
  "} else if (input.matches('[data-harvest-reserve-slider]'))",
);
const harvestLiveEnd = resourceInspector.indexOf(
  'private readonly onSupplementalChange',
  harvestLiveStart,
);
assert.ok(harvestLiveStart >= 0 && harvestLiveEnd > harvestLiveStart);
const harvestLiveBlock = resourceInspector.slice(harvestLiveStart, harvestLiveEnd);
assert.match(harvestLiveBlock, /const liveTitle = `\$\{verb\} until \$\{reserve\} \$\{unit\} remain`/);
assert.match(harvestLiveBlock, /input\.closest<HTMLElement>\('\.inspector-action-panel'\)/);
assert.match(
  harvestLiveBlock,
  /panel\.dataset\.inspectorPanelTitle = liveTitle/,
  'harvest slider input must keep the action-group title synchronized with its live reserve',
);
assert.match(
  harvestLiveBlock,
  /heading\.textContent = liveTitle[\s\S]{0,180}syncFocusableInspectorTooltip\(heading, liveTitle, liveDetail\)/,
  'harvest slider input must update both the visible group heading and its concise detail',
);

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
