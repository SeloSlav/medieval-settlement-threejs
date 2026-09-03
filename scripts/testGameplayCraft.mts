import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import postcss from 'postcss';

const source = readFileSync('src/ui/gameplayCraft.css', 'utf8');
const root = postcss.parse(source);
// Do not let finishing work acquire ownership of layout, cropping, icon masks,
// visibility, interaction, type metrics, transitions, or responsive breakpoints.
const paint = /^(--(?:estate-|ui-(?:edge|brass)|accent$)|background(?:-|$)|border-(?:color|radius|image(?:-[a-z]+)?|(?:top|bottom|left|right|inline|block)-color)$|box-shadow$|text-shadow$|color$|accent-color$|outline(?:-|$)|filter$|backdrop-filter$|scrollbar-color$|stroke$)/;
const playerScope = /\.(?:noble-hud|settlement-hud|settlement-vitals|construction-|map-overlay-|road-tools|road-controls-|road-tool-button|burgage-layout-|builder-status-|starter-camp-|floating-build-|hud-menu-|resource-inspector-|resource-action-|inspector-|villager-inspector-|city-admin-|town-report-|game-menu-|game-controls-|development-|military-|crop-suitability-|alert-dialog|town-name-dialog|tutorial-dialog|delete-popup|toast|ui-tooltip|trading-post-|marketplace-trade-|farm-|backyard-picker-|monastery-extension-|build-menu-|compass-hud|fp-placement-|session-connection-)/;
let count = 0;
root.walkRules(rule => {
  count++;
  assert.match(rule.selector, playerScope, `Missing player scope: ${rule.selector}`);
  assert.doesNotMatch(rule.selector, /:root|\b(?:html|body)\b|debug-|fps-panel|combat-playtest|\[data-ui-root\]/,
    'Do not recolor the application root or developer tools');
  rule.walkDecls(decl => assert.match(decl.prop, paint,
    `Not paint-only: ${rule.selector} { ${decl.prop}: ${decl.value} }`));
});
assert.ok(count > 60, 'Cover the full player-facing surface family');
assert.doesNotMatch(source, /!important|@media|@keyframes|animation:|content:|mask:/);
for (const name of ['noble-hud', 'settlement-vitals', 'development-menu', 'game-menu-dialog',
  'construction-dock', 'construction-menu', 'resource-inspector-panel', 'villager-inspector-panel',
  'town-report-panel', 'city-admin-panel', 'military-menu__rail', 'alert-dialog', 'ui-tooltip']) {
  assert.ok(source.includes(`.${name}`), `Missing surface: ${name}`);
}
for (const state of [':focus-visible', ':disabled', 'aria-pressed', "data-status='learned'", 'toast--error']) {
  assert.ok(source.includes(state), `Missing state treatment: ${state}`);
}
assert.match(source, /ui-tooltip:not\(\.ui-tooltip--noble-setup\):not\(\.ui-tooltip--world-setup\)/,
  'Keep the approved startup tooltip styles untouched');
const assets = [...source.matchAll(/url\('([^']+)'\)/g)].map(match => match[1]);
assert.equal(assets.length, 4, 'Reuse the four approved material assets; do not add a second texture set');
for (const asset of assets) {
  assert.ok(asset.startsWith('/assets/ui/startup-craft/'));
  assert.ok(existsSync(`public${asset}`));
  assert.ok(statSync(`public${asset}`).size < 1_000_000);
}
const main = readFileSync('src/main.ts', 'utf8');
assert.ok(main.indexOf("import './ui/gameplayCraft.css'") > main.indexOf("import './ui/startupCraft.css'"));
console.log(`Gameplay finish: ${count} paint-only rules, four shared assets, explicit player scope and state coverage passed.`);
