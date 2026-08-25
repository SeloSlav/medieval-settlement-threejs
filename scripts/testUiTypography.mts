import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const rootStyles = readFileSync('src/style.css', 'utf8');
const readability = readFileSync('src/ui/readability.css', 'utf8');

assert.match(
  rootStyles,
  /@import url\('\.\/ui\/tutorialOverlay\.css'\);\s*@import url\('\/src\/ui\/readability\.css'\);/,
  'the readability layer must load last so compact skins cannot shrink text afterward',
);

assert.match(readability, /\.noble-hud__report-copy > strong\s*\{[^}]*font-size:\s*13px;/s);
assert.match(readability, /\.noble-hud__report-detail\s*\{[^}]*font-size:\s*12px;/s);
assert.match(readability, /\.noble-hud__report-time\s*\{[^}]*font-size:\s*11px;/s);
assert.match(readability, /\.ui-tooltip\s*\{[^}]*font-size:\s*14px;/s);
assert.match(
  readability,
  /\.ui-tooltip__season-introduction,\s*\.ui-tooltip__season-description\s*\{[^}]*font-size:\s*14px;/s,
);
assert.match(
  readability,
  /\.resource-inspector-status,[\s\S]*?font-size:\s*var\(--ui-readable-secondary\);/,
);
assert.match(
  readability,
  /\.construction-menu__header > span,[\s\S]*?font-size:\s*var\(--ui-readable-secondary\);/,
);

const undersizedLiteral = /font-size\s*:\s*([0-9]+(?:\.[0-9]+)?)px/g;
for (const match of readability.matchAll(undersizedLiteral)) {
  assert.ok(
    Number(match[1]) >= 11,
    `readability layer introduced undersized text: ${match[0]}`,
  );
}

console.log('UI typography readability contract passed');
