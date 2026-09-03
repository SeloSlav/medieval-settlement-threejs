import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import postcss from 'postcss';

// A surface pass must never become a second owner of onboarding geometry.
const source = readFileSync('src/ui/startupCraft.css', 'utf8');
const root = postcss.parse(source);
const paintProperties = /^(--craft-|background(?:-|$)|border-(?:color|radius|image|(?:top|bottom|left|right|inline|block)(?:-(?:start|end))?-color)$|box-shadow$|text-shadow$|color$|accent-color$|outline(?:-|$)|filter$|backdrop-filter$|scrollbar-color$|isolation$)/;
let rules = 0;
root.walkRules((rule) => {
  rules++;
  const selectors = rule.selectors;
  for (const selector of selectors) {
    assert.match(selector, /(?:noble-setup|world-setup|new-game-setup-steps)/, `Unscoped selector: ${selector}`);
  }
  const decorative = selectors.every((selector) => /::(?:before|after)/.test(selector));
  rule.walkDecls((decl) => {
    if (paintProperties.test(decl.prop)) return;
    if (decl.prop === 'position' && decl.value === 'relative') return;
    if (decorative && /^(position|inset|z-index|content|border|pointer-events|height|bottom)$/.test(decl.prop)) return;
    // Existing selection outlines use a higher layer without moving the item.
    assert.fail(`Layout-affecting declaration in paint-only skin: ${rule.selector} { ${decl.prop}: ${decl.value} }`);
  });
  if (decorative && rule.nodes.some((node) => node.type === 'decl' && node.prop === 'content')) {
    assert.ok(rule.nodes.some((node) => node.type === 'decl' && node.prop === 'position' && node.value === 'absolute'));
    assert.ok(rule.nodes.some((node) => node.type === 'decl' && node.prop === 'pointer-events' && node.value === 'none'));
  }
});
assert.ok(rules > 40);
assert.match(source, /isolation: isolate/, 'Portrait frames must not paint over the adjacent shield.');
assert.match(source, /:focus-visible/, 'Decorative wear must not replace keyboard focus.');
assert.doesNotMatch(source, /!important|@media|@keyframes|animation:/);

for (const match of source.matchAll(/url\('([^']+)'\)/g)) {
  const asset = `public${match[1]}`;
  assert.ok(existsSync(asset), `Missing startup asset: ${asset}`);
  assert.ok(statSync(asset).size < 1_000_000, `Startup asset exceeds 1 MB: ${asset}`);
}
const frame = readFileSync('public/assets/ui/startup-craft/iron-frame.svg', 'utf8');
assert.match(frame, /viewBox="0 0 96 96"/);
assert.doesNotMatch(frame, /<script|<foreignObject|https?:\/\/(?!www\.w3\.org)/);
const main = readFileSync('src/main.ts', 'utf8');
assert.ok(main.indexOf("import './ui/startupCraft.css'") > main.indexOf("import './ui/iconography.css'"));
console.log(`startup craft: ${rules} paint-only rules, scoped assets and geometry ownership passed`);
