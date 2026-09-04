import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { describeWorldDifficulty } from '../src/world/worldDifficulty.ts';
import { DEFAULT_WORLD_GENERATION_SETTINGS } from '../src/world/worldGenerationSettings.ts';

const noblePanel = readFileSync('src/ui/NobleSetupPanel.ts', 'utf8');
const setupUiAudio = readFileSync('src/audio/SetupUiAudio.ts', 'utf8');
const audioCatalog = readFileSync('src/audio/audioCatalog.ts', 'utf8');
const nobleProfile = readFileSync('src/ui/nobleProfile.ts', 'utf8');
const worldPanel = readFileSync('src/ui/WorldSetupPanel.ts', 'utf8');
const worldDifficulty = readFileSync('src/world/worldDifficulty.ts', 'utf8');
const settlementHud = readFileSync('src/ui/SettlementHud.ts', 'utf8');
const bootstrapFlow = readFileSync('src/app/worldBootstrapFlow.ts', 'utf8');
const nobleCss = readFileSync('src/ui/nobleSetup.css', 'utf8');
const worldCss = readFileSync('src/ui/worldSetup.css', 'utf8');
const appShell = readFileSync('index.html', 'utf8');
const browserCoverage = readFileSync('e2e/onboarding-navigation.spec.ts', 'utf8');

assert.match(noblePanel, /export type NobleSetupStep = 'house' \| 'heraldry'/);
assert.match(noblePanel, /data-setup-step="house"/);
assert.match(noblePanel, /data-setup-step="heraldry"/);
assert.match(noblePanel, /Choose Your Legacy/);
assert.match(noblePanel, /setup_portrait_select/);
assert.match(noblePanel, /setup_advance/);
assert.match(noblePanel, /setup_back/);
assert.match(worldPanel, /setup_commit/);
assert.match(worldPanel, /playDirectionalAdjustment/);
assert.match(setupUiAudio, /ADJUSTMENT_SOUND_INTERVAL_MS = 42/);
assert.match(setupUiAudio, /0\.92 \+ normalized \* 0\.16/);
for (const sound of [
  'setup_portrait_select',
  'setup_choice',
  'setup_preset',
  'setup_adjust',
  'setup_back',
  'setup_advance',
  'setup_commit',
]) {
  assert.match(audioCatalog, new RegExp(`${sound}:`));
}
assert.doesNotMatch(noblePanel, /Choose Your Noble House/);
assert.match(noblePanel, /Continue to Heraldry/);
assert.match(noblePanel, /Continue to Map Generation/);
assert.match(noblePanel, /HERALDRY_PRESETS\.findIndex/);
assert.match(noblePanel, /aria-modal="true"/);
assert.match(noblePanel, /this\.syncStep\(true\)/);
assert.match(
  noblePanel,
  /classList\.add\('is-leaving'\);[\s\S]*?this\.resolve\(profile\);[\s\S]*?window\.setTimeout/,
);
assert.match(noblePanel, /mountTooltips\(this\.backdrop\)/);
assert.match(noblePanel, /data-noble-description/);
assert.match(noblePanel, /button\.dataset\.tooltipTitle = noble\.name/);
assert.match(noblePanel, /button\.dataset\.tooltip = `\$\{noble\.title\}\\n\\n\$\{noble\.years\}`/);
assert.match(noblePanel, /class="noble-setup-heraldry-profile"/);
assert.match(noblePanel, /data-heraldry-preview-portrait/);
assert.match(noblePanel, /class="noble-setup-heraldry-shield" data-main-shield/);
assert.match(noblePanel, /class="noble-setup-heraldry-editor"/);
assert.match(
  nobleCss,
  /\.heraldry-shield--pattern \.heraldry-shield__pattern\s*\{\s*--pattern-size: 32cqw;\s*\}/,
  'pattern picker tiles must scale with the icon, independently of the live shield tiling',
);
assert.match(
  nobleCss,
  /\.heraldry-shield--pattern \.heraldry-shield__charges\s*\{\s*display: none;\s*\}/,
  'pattern icons must not be obscured by charges',
);
assert.match(
  nobleCss,
  /\.heraldry-shield__field::after\s*\{[\s\S]*?radial-gradient[\s\S]*?repeating-linear-gradient\(0deg[\s\S]*?repeating-linear-gradient\(90deg[\s\S]*?mix-blend-mode: soft-light/,
  'the shared lord shield must layer deterministic age marks and woven grain over the full painted face',
);
assert.match(
  nobleCss,
  /\.heraldry-shield\[data-surface-debug='flat'\] \.heraldry-shield__field::after\s*\{\s*display: none;/,
  'visual QA must retain an inspectable flat heraldry baseline',
);
assert.doesNotMatch(noblePanel, /chargeScale: 0\.01/, 'do not use a clamped charge scale to hide picker charges');
assert.doesNotMatch(noblePanel, /<h2[^>]*>Your Noble<\/h2>/);
assert.doesNotMatch(noblePanel, /<p class="noble-setup-eyebrow">Coat of Arms<\/p>/);
assert.doesNotMatch(noblePanel, /Heraldry of Your House/);
assert.doesNotMatch(noblePanel, /Choose the founder of your house/);
assert.doesNotMatch(noblePanel, /noble\.name\.replace/);
assert.doesNotMatch(nobleCss, /\.noble-setup-noble span/);
assert.doesNotMatch(nobleProfile, /mila-gojsalic/);
assert.match(
  nobleProfile,
  /id: 'frane-petric'[\s\S]*?portrait: '\/assets\/ui\/noble-setup\/portraits\/frane-petric\.webp'/,
);
assert.match(
  nobleProfile,
  /id: 'daniciceva-udovica'[\s\S]*?title: 'Senj Uskok expedition leader and organizer'[\s\S]*?portrait: '\/assets\/ui\/noble-setup\/portraits\/daniciceva-udovica\.webp'/,
);
assert.match(
  nobleProfile,
  /id: 'filipa-lacea'[\s\S]*?title: 'Pula-born Neo-Latin poet and Renaissance humanist'[\s\S]*?portrait: '\/assets\/ui\/noble-setup\/portraits\/filipa-lacea\.webp'/,
);
assert.doesNotMatch(nobleProfile, /juraj-julije-klovic|stjepan-konzul-istranin/);
assert.doesNotMatch(
  nobleProfile,
  /catharina-van-hemessen|gaspara-stampa|milica-koriolanovic-cipiko|nada-bunic/,
);
assert.match(
  nobleProfile,
  /id: 'matija-vlacic-ilirik'[\s\S]*?portrait: '\/assets\/ui\/noble-setup\/portraits\/matija-vlacic-ilirik\.webp'/,
);
assert.match(
  nobleProfile,
  /id: 'simun-kozicic-benja'[\s\S]*?portrait: '\/assets\/ui\/noble-setup\/portraits\/simun-kozicic-benja\.webp'/,
);
assert.match(
  nobleProfile,
  /id: 'magdalena-budrisic'[\s\S]*?portrait: '\/assets\/ui\/noble-setup\/portraits\/magdalena-budrisic\.webp'/,
);
assert.match(noblePanel, /noble-setup-noble__portrait-placeholder/);
assert.match(noblePanel, /image\.removeAttribute\('src'\)/);
assert.match(nobleCss, /\.noble-setup-noble\s*\{[\s\S]*?width: 100%;[\s\S]*?aspect-ratio: 19 \/ 25;/);
assert.match(nobleCss, /\.noble-setup-portrait-frame\s*\{[\s\S]*?aspect-ratio: 19 \/ 25;/);
assert.match(nobleCss, /\.noble-setup-heraldry-portrait-frame\s*\{[\s\S]*?aspect-ratio: 19 \/ 25;/);
assert.match(
  nobleCss,
  /\.noble-setup-house-content\s*\{[\s\S]*?--noble-profile-width: clamp\(250px, 24vw, 300px\);[\s\S]*?grid-template-columns: var\(--noble-profile-width\) minmax\(0, 1fr\);/,
);
assert.match(
  nobleCss,
  /\.noble-setup-house-profile\s*\{[\s\S]*?width: 100%;[\s\S]*?max-width: var\(--noble-profile-width\);[\s\S]*?min-width: 0;/,
);
assert.match(noblePanel, /data-noble-preview-portrait[^>]*width="560" height="737"/);
assert.match(noblePanel, /data-heraldry-preview-portrait[^>]*width="560" height="737"/);
assert.match(nobleCss, /\.noble-setup-noble img\s*\{[\s\S]*?position: absolute;[\s\S]*?inset: 0;/);
assert.match(
  nobleCss,
  /\.noble-setup-noble__portrait-placeholder\s*\{[\s\S]*?position: absolute;[\s\S]*?inset: 0;/,
);
assert.match(
  noblePanel,
  /this\.backButton\.addEventListener\('click',[\s\S]*?this\.step = 'house'[\s\S]*?this\.syncStep/,
);
assert.match(
  noblePanel,
  /if \(this\.step === 'house'\) \{[\s\S]*?this\.step = 'heraldry'[\s\S]*?return;/,
);
assert.match(nobleCss, /\[data-setup-step\]\[hidden\][\s\S]*?display: none/);
assert.match(nobleCss, /\.ui-tooltip\.ui-tooltip--noble-setup[\s\S]*?z-index: 10005/);
assert.match(nobleCss, /\.noble-setup-heraldry-layout[\s\S]*?grid-template-columns:/);
assert.match(nobleCss, /\.noble-setup-heraldry-shield[\s\S]*?position: absolute/);
assert.match(
  nobleCss,
  /\.noble-setup-heraldry-shield\s*\{[\s\S]*?right: -26px;[\s\S]*?bottom: -10px;/,
);
assert.match(
  nobleCss,
  /\.noble-setup-heraldry-shield\s*\{[\s\S]*?border: 0;[\s\S]*?background: transparent;[\s\S]*?box-shadow: none;/,
);

assert.match(worldPanel, /action: 'back' \| 'start'/);
assert.match(worldPanel, /initialSettings\?: WorldGenerationSettings/);
assert.match(worldPanel, /mountTooltips\(this\.backdrop, 'ui-tooltip--world-setup'\)/);
assert.match(worldPanel, /element\.scrollWidth > element\.clientWidth \+ 1/);
assert.match(worldPanel, /if \(!isTruncated\)[\s\S]*?delete tooltipAnchor\.dataset\.tooltip/);
assert.match(worldPanel, /if \(!isTruncated\)[\s\S]*?tooltipAnchor\.removeAttribute\('tabindex'\)/);
assert.match(worldPanel, /if \(!isTruncated\)[\s\S]*?tooltipAnchor\.removeAttribute\('aria-label'\)/);
assert.match(worldPanel, /this\.selectorResizeObserver = new ResizeObserver/);
assert.match(worldPanel, /this\.selectorResizeObserver\.observe\(anchor\)/);
assert.match(worldPanel, /this\.selectorResizeObserver\.disconnect\(\);[\s\S]*?this\.disposeTooltips\(\)/);
assert.match(worldPanel, /this\.disposeTooltips\(\);[\s\S]*?this\.backdrop\.remove\(\)/);
assert.match(worldPanel, /data-setup-back[^>]*>[\s\S]*?Back to Heraldry/);
assert.match(worldPanel, /data-map-seed-section/);
assert.match(worldPanel, /data-randomize-seed>Randomize seed/);
assert.match(worldPanel, /<nav class="world-setup-actions__navigation" aria-label="Setup navigation">/);
assert.match(worldPanel, /world-setup-column world-setup-column--terrain/);
assert.match(worldPanel, /world-setup-column world-setup-column--rules/);
assert.doesNotMatch(worldPanel, /data-landscape-note|keeps this landform/);
assert.match(worldPanel, /data-world-selector="map-size"/);
assert.match(worldPanel, /data-map-size-value/);
assert.match(
  worldPanel,
  /\.\.\.DEFAULT_WORLD_GENERATION_SETTINGS,[\s\S]*?\.\.\.DEFAULT_WORLD_SETUP_DIFFICULTY\.settings,[\s\S]*?mapSize: 'small'/,
  'new map creation should default to the small map size',
);
assert.match(
  worldPanel,
  /const DEFAULT_WORLD_SETUP_DIFFICULTY = WORLD_DIFFICULTY_PRESETS\.find\([\s\S]*?preset\.id === 'easy'/,
  'new map creation should default to Pampered Page',
);
assert.match(worldPanel, /data-setup-heading/);
assert.match(worldPanel, /data-world-selector="difficulty-preset"/);
assert.match(worldDifficulty, /Pampered Page \(Easy\)/);
assert.match(worldDifficulty, /Steadfast Castellan \(Normal\)/);
assert.match(worldDifficulty, /Marcher Lord \(Hardcore\)/);
assert.match(worldDifficulty, /No losses or raids; double supplies/);
assert.match(worldPanel, /data-world-selector="approval-decline"/);
assert.match(worldPanel, /data-world-selector="military-demands"/);
assert.match(worldPanel, /data-rule-icon="settlement"[^>]*aria-label="Settlement mode"/);
assert.match(worldPanel, /data-rule-icon="bandits"[^>]*aria-label="Bandit presence"/);
assert.match(worldPanel, /data-rule-icon="approval"[^>]*aria-label="Approval decline"/);
assert.match(worldPanel, /data-rule-icon="military-demands"[^>]*aria-label="Military demands"/);
assert.match(worldPanel, /data-rule-icon="food"[^>]*aria-label="Food spoilage"/);
assert.match(worldPanel, /data-rule-icon="supplies"[^>]*aria-label="First camp supplies"/);
assert.match(worldPanel, /data-rule-icon="weather"[^>]*aria-label="Severe weather"/);
assert.match(worldPanel, /data-rule-icon="groundwater"[^>]*aria-label="Groundwater"/);
assert.match(worldPanel, /conflictModeIcon\.dataset\.state = this\.draft\.conflictMode/);
assert.match(worldPanel, /banditCampsIcon\.dataset\.state = this\.draft\.banditCampsEnabled \? 'on' : 'off'/);
assert.match(worldPanel, /approvalDeclineIcon\.dataset\.state = String\(this\.draft\.approvalDeclineRate\)/);
assert.match(worldPanel, /foodSpoilageIcon\.dataset\.state = String\(this\.draft\.foodSpoilageRate\)/);
assert.match(worldPanel, /initialGoodsIcon\.dataset\.state = String\(this\.draft\.initialGoodsMultiplier\)/);
assert.match(worldPanel, /militaryDemandsIcon\.dataset\.state = String\(this\.draft\.militaryDemands\)/);
assert.match(worldPanel, /severeWeatherIcon\.dataset\.state = this\.draft\.severeWeatherEnabled \? 'on' : 'off'/);
assert.match(worldPanel, /aquiferNetworksIcon\.dataset\.state = this\.draft\.wellAquiferNetworksEnabled \? 'aquifers' : 'even'/);
assert.doesNotMatch(worldPanel, /world-setup-setting-row__label/);
assert.match(worldPanel, /data-world-selector="food-spoilage"[\s\S]*Food never spoils/);
assert.match(worldPanel, /data-world-selector="initial-goods"[\s\S]*Twice the goods in the original camp/);
assert.match(worldPanel, /aria-label="Landscape"[\s\S]*aria-label="Gameplay rules"/);
assert.doesNotMatch(worldPanel, /Regional resources|This seed's resource roll|resource-abundance|resource-variety/);
assert.doesNotMatch(worldPanel, /Current rates?|Current starting stock/);
assert.match(worldPanel, /class="world-setup-sr-title">Map Generation<\/h1>/);
assert.match(worldPanel, /class="world-setup-section world-setup-map-size"/);
assert.doesNotMatch(worldPanel, /<p>New World<\/p>/);
assert.match(
  worldPanel,
  /backButton\.addEventListener\('click',[\s\S]*?this\.resolve\(\{ action: 'back', settings \}\)/,
);
assert.match(worldPanel, /this\.resolve\(\{ action: 'start', settings \}\)/);
assert.match(worldCss, /\.world-setup-actions\s*\{[\s\S]*?grid-template-rows: auto auto/);
assert.match(worldCss, /\.world-setup-actions__navigation\s*\{[\s\S]*?justify-content: space-between/);
assert.match(worldCss, /\.world-setup-back\s*\{[\s\S]*?min-width: 210px/);
assert.match(worldCss, /\.world-setup-start\s*\{[\s\S]*?height: 38px;[\s\S]*?min-height: 38px/);
assert.match(worldCss, /\.world-setup-column\s*\{[\s\S]*?overflow-y: auto/);
assert.match(worldCss, /\.world-setup-map-size\s*\{[\s\S]*?position: sticky;[\s\S]*?top: 0/);
assert.match(worldCss, /\.world-setup-setting-list\s*\{[\s\S]*?grid-template-columns: minmax\(0, 1fr\)/);
assert.match(worldCss, /\.world-setup-column--rules\s*\{[\s\S]*?overflow: hidden/);
assert.match(worldCss, /\.world-setup-game-rules\s*\{[\s\S]*?grid-template-rows: auto auto minmax\(0, 1fr\)/);
assert.match(worldCss, /\.world-setup-setting-list\s*\{[\s\S]*?overflow-y: auto/);
assert.match(worldCss, /\.world-setup-back\s*\{[\s\S]*?margin: 9px 0 9px 22px/);
assert.match(worldCss, /\.world-setup-footer-seed\s*\{[\s\S]*?grid-template-columns: auto auto;[\s\S]*?justify-self: center/);
assert.match(worldCss, /\.world-setup-footer-seed\s*\{[\s\S]*?grid-column: 2;[\s\S]*?grid-row: 1/);
assert.match(worldCss, /\.world-setup-footer-seed \.world-setup-seed-row\s*\{[\s\S]*?grid-template-columns: 140px auto/);
assert.match(worldCss, /\.world-setup-footer-seed__label small,[\s\S]*?\.world-setup-randomize\s*\{[\s\S]*?white-space: nowrap/);
assert.match(worldCss, /\.world-setup-back\s*\{[\s\S]*?grid-column: 1;[\s\S]*?grid-row: 1/);
assert.match(worldCss, /\.world-setup-start\s*\{[\s\S]*?grid-column: 3;[\s\S]*?grid-row: 1/);
assert.match(worldCss, /\.world-setup-section__title\s*\{[\s\S]*?font-size: 17px/);
assert.match(worldCss, /\.world-setup-arrow-select__value span\s*\{[\s\S]*?font-size: 15px/);
assert.match(worldCss, /\.world-setup-difficulty-preset \.world-setup-arrow-select\s*\{[\s\S]*?min-height: 64px/);
assert.match(worldCss, /\.world-setup-setting-row__icon\s*\{[\s\S]*?background-size: contain/);
assert.match(worldCss, /world-setup\/settlement-mode\.png/);
assert.match(worldCss, /world-setup\/groundwater\.png/);
// Each state owns a complete, antialiased icon, not a crop of a noisy atlas.
assert.doesNotMatch(worldCss, /(?:bandit-presence|military-demands)-atlas\.png/);
for (const [rule, state, icon] of [
  ['bandits', 'off', 'bandits-none'],
  ['bandits', 'on', 'bandits-roaming'],
  ['military-demands', '0', 'military-muster-only'],
  ['military-demands', '1', 'military-light-rations'],
  ['military-demands', '2', 'military-full-upkeep'],
]) {
  const selector = `.world-setup-setting-row__icon[data-rule-icon='${rule}'][data-state='${state}']`;
  const ruleBody = worldCss.split(`${selector} {`)[1]?.split('}')[0];
  assert.ok(ruleBody, `${rule}/${state} must have its own icon rule`);
  assert.ok(ruleBody.includes(`/world-setup/${icon}.png`), `${rule}/${state} must map to ${icon}`);
  assert.doesNotMatch(ruleBody, /background-(?:size|position):/, `${icon} must inherit centered contain sizing`);
  const path = `public/assets/ui/icons/world-setup/${icon}.png`;
  assert.ok(existsSync(path), `${path} must exist`);
  const png = readFileSync(path);
  assert.ok(png.length > 10_000, `${path} must retain authored woodcut art`);
  assert.equal(png.toString('hex', 0, 8), '89504e470d0a1a0a', `${path} must be a PNG`);
  assert.equal(png[25], 6, `${path} must retain true RGBA transparency`);
  assert.equal(png.readUInt32BE(16), png.readUInt32BE(20), `${path} must be square`);
  assert.ok(png.readUInt32BE(16) >= 256, `${path} must support high-DPI display`);
}
assert.match(worldCss, /data-rule-icon='wild-animals'\]\[data-state='off'[\s\S]*?wildlife-quiet\.png/);
assert.match(worldCss, /data-rule-icon='wild-animals'\]\[data-state='on'[\s\S]*?wildlife-attacks\.png/);
for (const icon of [
  'wildlife-quiet.png',
  'wildlife-attacks.png',
]) {
  const path = `public/assets/ui/icons/world-setup/${icon}`;
  assert.ok(existsSync(path), `${path} must exist`);
  assert.ok(statSync(path).size > 10_000, `${path} must retain detailed authored art`);
  assert.equal(readFileSync(path)[25], 6, `${path} must retain true RGBA transparency`);
}
assert.match(worldCss, /data-rule-icon='settlement'\]\[data-state='frontier'[\s\S]*?settlement-frontier\.png/);
assert.match(worldCss, /data-rule-icon='approval'\]\[data-state='0'[\s\S]*?approval-disabled\.png/);
assert.match(worldCss, /data-rule-icon='approval'\]\[data-state='150'[\s\S]*?approval-demanding\.png/);
assert.match(worldCss, /data-rule-icon='food'\]\[data-state='0'[\s\S]*?food-none\.png/);
assert.match(worldCss, /data-rule-icon='food'\]\[data-state='100'[\s\S]*?food-normal\.png/);
assert.match(worldCss, /data-rule-icon='supplies'\]\[data-state='1'[\s\S]*?supplies-normal\.png/);
assert.match(worldCss, /data-rule-icon='weather'\]\[data-state='off'[\s\S]*?weather-normal\.png/);
assert.match(worldCss, /data-rule-icon='groundwater'\]\[data-state='aquifers'[\s\S]*?groundwater-aquifers\.png/);
assert.match(
  worldCss,
  /\.world-setup-backdrop\s*\{[\s\S]*?padding: clamp\(12px, 2\.4vw, 34px\);/,
);
assert.match(
  worldCss,
  /\.world-setup-shell\s*\{[\s\S]*?grid-template-rows: minmax\(0, 1fr\);[\s\S]*?gap: 0;/,
);
assert.match(
  worldCss,
  /@media \(min-width: 1240px\)[\s\S]*?\.world-setup-scroll\s*\{[\s\S]*?overflow: hidden;[\s\S]*?\.world-setup-column\s*\{[\s\S]*?overflow-y: auto/,
);
assert.doesNotMatch(worldPanel, /world-setup-logo/);
assert.doesNotMatch(worldCss, /\.world-setup-logo/);
assert.match(worldCss, /\.ui-tooltip\.ui-tooltip--world-setup[\s\S]*?z-index: 10005/);
assert.match(settlementHud, /data-world-difficulty-badge/);
assert.match(settlementHud, /describeWorldDifficulty\(getActiveWorldGeneration\(\)\)/);
assert.match(settlementHud, /difficultyBadge\.dataset\.tooltipTitle = difficulty\.title/);
assert.match(settlementHud, /difficultyBadge\.dataset\.tooltip = difficulty\.summary/);
assert.match(nobleCss, /\.noble-hud__title-row\s*\{[\s\S]*?display: flex/);
assert.match(nobleCss, /\.noble-hud__difficulty\s*\{[\s\S]*?cursor: help/);
assert.match(appShell, /selo-empire-pauline-monastery-study\.png/);

assert.match(bootstrapFlow, /while \(true\)/);
assert.match(bootstrapFlow, /initialStep: nobleStep/);
assert.match(bootstrapFlow, /initialProfile: nobleDraft/);
assert.match(bootstrapFlow, /initialSettings: worldDraft/);
assert.match(bootstrapFlow, /if \(result\.action === 'start'\) return result\.settings/);
assert.match(bootstrapFlow, /nobleStep = 'heraldry'/);

assert.match(browserCoverage, /Back to Heraldry/);
assert.match(browserCoverage, /Back to Legacy/);
assert.match(browserCoverage, /Choose Your Legacy/);
assert.match(browserCoverage, /House of the Silver Pine/);
assert.match(browserCoverage, /data-map-size-value/);
assert.match(browserCoverage, /data-difficulty-preset-value/);
assert.match(browserCoverage, /data-aquifer-networks-value/);
assert.match(browserCoverage, /Lord of Bosiljevo, Ribnik, and Novigrad/);
assert.match(browserCoverage, /noble-setup-heraldry-profile/);
assert.match(browserCoverage, /data-heraldry-preview-portrait/);

const normalDifficulty = describeWorldDifficulty(DEFAULT_WORLD_GENERATION_SETTINGS);
assert.equal(normalDifficulty.id, 'normal');
assert.equal(normalDifficulty.badgeLabel, 'Normal');
assert.match(normalDifficulty.summary, /Settlement: Peaceful/);
assert.match(normalDifficulty.summary, /Bandit presence: Roaming camps/);
assert.match(normalDifficulty.summary, /Approval decline: Normal/);
assert.match(normalDifficulty.summary, /Military demands: Light rations/);

const customDifficulty = describeWorldDifficulty({
  ...DEFAULT_WORLD_GENERATION_SETTINGS,
  severeWeatherEnabled: true,
  foodSpoilageRate: 150,
});
assert.equal(customDifficulty.id, 'custom');
assert.equal(customDifficulty.badgeLabel, 'Custom');
assert.equal(customDifficulty.title, 'Custom Difficulty');
assert.match(customDifficulty.summary, /Food spoilage: Harsh/);
assert.match(customDifficulty.summary, /Weather: Severe/);

console.log('new-world setup flow tests passed');
