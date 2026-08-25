import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const noblePanel = readFileSync('src/ui/NobleSetupPanel.ts', 'utf8');
const worldPanel = readFileSync('src/ui/WorldSetupPanel.ts', 'utf8');
const bootstrapFlow = readFileSync('src/app/worldBootstrapFlow.ts', 'utf8');
const nobleCss = readFileSync('src/ui/nobleSetup.css', 'utf8');
const browserCoverage = readFileSync('e2e/onboarding-navigation.spec.ts', 'utf8');

assert.match(noblePanel, /export type NobleSetupStep = 'house' \| 'heraldry'/);
assert.match(noblePanel, /data-setup-step="house"/);
assert.match(noblePanel, /data-setup-step="heraldry"/);
assert.match(noblePanel, /Continue to Heraldry/);
assert.match(noblePanel, /Continue to Map Generation/);
assert.match(
  noblePanel,
  /this\.backButton\.addEventListener\('click',[\s\S]*?this\.step = 'house'[\s\S]*?this\.syncStep/,
);
assert.match(
  noblePanel,
  /if \(this\.step === 'house'\) \{[\s\S]*?this\.step = 'heraldry'[\s\S]*?return;/,
);
assert.match(nobleCss, /\[data-setup-step\]\[hidden\][\s\S]*?display: none/);

assert.match(worldPanel, /action: 'back' \| 'start'/);
assert.match(worldPanel, /initialSettings\?: WorldGenerationSettings/);
assert.match(worldPanel, /data-setup-back>Back to Heraldry/);
assert.match(
  worldPanel,
  /backButton\.addEventListener\('click',[\s\S]*?this\.resolve\(\{ action: 'back', settings \}\)/,
);
assert.match(worldPanel, /this\.resolve\(\{ action: 'start', settings \}\)/);

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

console.log('new-world setup flow tests passed');
