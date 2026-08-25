import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const noblePanel = readFileSync('src/ui/NobleSetupPanel.ts', 'utf8');
const worldPanel = readFileSync('src/ui/WorldSetupPanel.ts', 'utf8');
const bootstrapFlow = readFileSync('src/app/worldBootstrapFlow.ts', 'utf8');
const nobleCss = readFileSync('src/ui/nobleSetup.css', 'utf8');
const worldCss = readFileSync('src/ui/worldSetup.css', 'utf8');
const appShell = readFileSync('index.html', 'utf8');
const browserCoverage = readFileSync('e2e/onboarding-navigation.spec.ts', 'utf8');

assert.match(noblePanel, /export type NobleSetupStep = 'house' \| 'heraldry'/);
assert.match(noblePanel, /data-setup-step="house"/);
assert.match(noblePanel, /data-setup-step="heraldry"/);
assert.match(noblePanel, /Continue to Heraldry/);
assert.match(noblePanel, /Continue to Map Generation/);
assert.match(noblePanel, /HERALDRY_PRESETS\.findIndex/);
assert.match(noblePanel, /aria-modal="true"/);
assert.match(noblePanel, /this\.syncStep\(true\)/);
assert.match(noblePanel, /mountTooltips\(this\.backdrop\)/);
assert.match(noblePanel, /data-noble-description/);
assert.match(noblePanel, /button\.dataset\.tooltipTitle = noble\.name/);
assert.match(noblePanel, /button\.dataset\.tooltip = `\$\{noble\.title\}\\n\\n\$\{noble\.years\}`/);
assert.match(noblePanel, /class="noble-setup-heraldry-profile"/);
assert.match(noblePanel, /data-heraldry-preview-portrait/);
assert.match(noblePanel, /class="noble-setup-heraldry-shield" data-main-shield/);
assert.match(noblePanel, /class="noble-setup-heraldry-editor"/);
assert.doesNotMatch(noblePanel, /<h2[^>]*>Your Noble<\/h2>/);
assert.doesNotMatch(noblePanel, /<p class="noble-setup-eyebrow">Coat of Arms<\/p>/);
assert.doesNotMatch(noblePanel, /Heraldry of Your House/);
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

assert.match(worldPanel, /action: 'back' \| 'start'/);
assert.match(worldPanel, /initialSettings\?: WorldGenerationSettings/);
assert.match(worldPanel, /data-setup-back[^>]*>[\s\S]*?Back to Heraldry/);
assert.match(worldPanel, /data-map-seed-section/);
assert.match(worldPanel, /data-randomize-seed>Randomize map/);
assert.match(worldPanel, /<nav class="world-setup-actions__navigation" aria-label="Setup navigation">/);
assert.match(worldPanel, /aria-pressed="\$\{size === this\.draft\.mapSize\}"/);
assert.match(worldPanel, /data-setup-heading/);
assert.match(worldPanel, /class="world-setup-sr-title">Map Generation<\/h1>/);
assert.doesNotMatch(worldPanel, /<p>New World<\/p>/);
assert.match(
  worldPanel,
  /backButton\.addEventListener\('click',[\s\S]*?this\.resolve\(\{ action: 'back', settings \}\)/,
);
assert.match(worldPanel, /this\.resolve\(\{ action: 'start', settings \}\)/);
assert.match(worldCss, /\.world-setup-actions\s*\{[\s\S]*?grid-template-rows: auto auto/);
assert.match(worldCss, /\.world-setup-actions__navigation\s*\{[\s\S]*?justify-content: space-between/);
assert.match(worldCss, /\.world-setup-back\s*\{[\s\S]*?min-width: 210px/);
assert.match(appShell, /class="app-loading-kicker">Medieval Croatia · 1550</);
assert.doesNotMatch(appShell, /class="app-loading-kicker">[^<]*Gorski Kotar/i);

assert.match(bootstrapFlow, /while \(true\)/);
assert.match(bootstrapFlow, /initialStep: nobleStep/);
assert.match(bootstrapFlow, /initialProfile: nobleDraft/);
assert.match(bootstrapFlow, /initialSettings: worldDraft/);
assert.match(bootstrapFlow, /if \(result\.action === 'start'\) return result\.settings/);
assert.match(bootstrapFlow, /nobleStep = 'heraldry'/);

assert.match(browserCoverage, /Back to Heraldry/);
assert.match(browserCoverage, /Back to Noble House/);
assert.match(browserCoverage, /House of the Silver Pine/);
assert.match(browserCoverage, /data-map-size="small"/);
assert.match(browserCoverage, /data-aquifer-networks/);
assert.match(browserCoverage, /Lord of Bosiljevo, Ribnik, and Novigrad/);
assert.match(browserCoverage, /noble-setup-heraldry-profile/);
assert.match(browserCoverage, /data-heraldry-preview-portrait/);

console.log('new-world setup flow tests passed');
