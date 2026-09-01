import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  COMPANY_STANDARD_ART_VERSION,
  CROATIAN_BANNER_ASPECT_RATIO,
  CROATIAN_CHECKER_COLORS,
  CROATIAN_CHECKER_COLUMNS,
  CROATIAN_CHECKER_ROWS,
  HERALDRY_PATTERN_CODES,
  LORD_BANNER_ASPECT_RATIO,
  MERCENARY_FIELD_STANDARD_ASPECT_RATIO,
  MERCENARY_FIELD_STANDARD_COLORS,
  OTTOMAN_FIELD_STANDARD_ASPECT_RATIO,
  OTTOMAN_FIELD_STANDARD_COLORS,
  getCurrentPlayerCompanyStandardArt,
  resolveCompanyStandardArt,
  resolveMercenaryCompanyStandardArt,
  resolveOttomanCompanyStandardArt,
  resolvePlayerCompanyStandardArt,
  sampleCroatianCheckerboard,
  sampleHeraldryPattern,
  sampleOttomanFieldStandard,
} from '../src/settlement/companyStandardArt.ts';
import {
  HERALDRY_PATTERNS,
  getCurrentNobleProfile,
  type HeraldryPattern,
  type NobleProfile,
} from '../src/ui/nobleProfile.ts';

const customProfile: NobleProfile = {
  nobleId: 'ivan-lenkovic',
  displayName: 'House Lenković',
  heraldry: {
    pattern: 'saltire',
    fieldColor: '#17395f',
    patternColor: '#d6c79c',
    patternTiling: 3,
    patternAngle: 15,
    charge: 'double-headed-eagle',
    chargeColor: '#b68b38',
    chargeCount: 5,
    chargeScale: 0.58,
  },
};

const art = resolvePlayerCompanyStandardArt(customProfile);
assert.equal(art.version, COMPANY_STANDARD_ART_VERSION);
assert.equal(art.faction, 'player');
assert.equal(art.source, 'current-lord-heraldry');
assert.equal(art.nobleId, customProfile.nobleId);
assert.equal(art.lordName, customProfile.displayName);
assert.equal(art.upper.aspectRatio, LORD_BANNER_ASPECT_RATIO);
assert.equal(art.upper.pattern, customProfile.heraldry.pattern);
assert.equal(art.upper.patternCode, HERALDRY_PATTERN_CODES.saltire);
assert.equal(art.upper.fieldColor, customProfile.heraldry.fieldColor);
assert.equal(art.upper.patternColor, customProfile.heraldry.patternColor);
assert.equal(art.upper.patternTiling, customProfile.heraldry.patternTiling);
assert.equal(art.upper.patternAngleDegrees, customProfile.heraldry.patternAngle);
assert.equal(art.upper.charge, customProfile.heraldry.charge);
assert.equal(art.upper.chargeColor, customProfile.heraldry.chargeColor);
assert.equal(
  art.upper.chargeMaskUrl,
  '/assets/ui/noble-setup/charges/double-headed-eagle.png',
  'the 3D standard must reuse the exact charge chosen in character creation',
);
assert.equal(art.upper.chargePlacements.length, customProfile.heraldry.chargeCount);
assert.deepEqual(
  art.upper.chargePlacements.map(({ u, v }) => [u, v]),
  [[0.31, 0.3], [0.69, 0.3], [0.31, 0.69], [0.69, 0.69], [0.5, 0.5]],
);
assert.ok(
  art.upper.chargePlacements.every((placement) => placement.scale === 0.58 * 0.68),
  'multi-charge heraldry should preserve the editor scale convention',
);

assert.equal(art.lower.panel, 'croatian-checkerboard');
assert.equal(art.lower.aspectRatio, CROATIAN_BANNER_ASPECT_RATIO);
assert.equal(art.lower.columns, CROATIAN_CHECKER_COLUMNS);
assert.equal(art.lower.rows, CROATIAN_CHECKER_ROWS);
assert.equal(art.lower.red, CROATIAN_CHECKER_COLORS.red);
assert.equal(art.lower.white, CROATIAN_CHECKER_COLORS.white);
assert.notEqual(art.upper, art.lower, 'the heraldry and Croatian flag must remain two cloth panels');

for (let row = 0; row < art.lower.rows; row += 1) {
  for (let column = 0; column < art.lower.columns; column += 1) {
    const sampled = sampleCroatianCheckerboard(
      art.lower,
      (column + 0.5) / art.lower.columns,
      (row + 0.5) / art.lower.rows,
    );
    assert.equal(sampled, ((column + row) & 1) === 0 ? 'red' : 'white');
  }
}
assert.equal(sampleCroatianCheckerboard(art.lower, 0, 0), 'red');
assert.equal(sampleCroatianCheckerboard(art.lower, 1, 1), 'red');

assert.equal(Object.isFrozen(art), true);
assert.equal(Object.isFrozen(art.upper), true);
assert.equal(Object.isFrozen(art.lower), true);
assert.equal(Object.isFrozen(art.upper.chargePlacements), true);
assert.equal(Object.isFrozen(art.upper.chargePlacements[0]), true);

const sameArt = resolvePlayerCompanyStandardArt({
  ...customProfile,
  heraldry: { ...customProfile.heraldry },
});
assert.equal(sameArt.cacheKey, art.cacheKey, 'equivalent heraldry must share cached artwork');
for (const [label, changed] of [
  ['lord name', { ...customProfile, displayName: 'Another house' }],
  ['field color', { ...customProfile, heraldry: { ...customProfile.heraldry, fieldColor: '#813126' } }],
  ['charge', { ...customProfile, heraldry: { ...customProfile.heraldry, charge: 'falcon' as const } }],
] as const) {
  assert.notEqual(resolvePlayerCompanyStandardArt(changed).cacheKey, art.cacheKey, `${label} must invalidate artwork`);
}

for (const { id } of HERALDRY_PATTERNS) {
  const patternArt = resolvePlayerCompanyStandardArt({
    ...customProfile,
    heraldry: { ...customProfile.heraldry, pattern: id },
  }).upper;
  const samples = new Set<number>();
  for (let y = 0; y < 31; y += 1) {
    for (let x = 0; x < 37; x += 1) {
      samples.add(sampleHeraldryPattern(patternArt, (x + 0.5) / 37, (y + 0.5) / 31));
    }
  }
  assert.deepEqual(
    [...samples].sort(),
    id === 'solid' ? [0] : [0, 1],
    `${id satisfies HeraldryPattern} must produce a legible deterministic two-tincture field`,
  );
}

const currentProfile = getCurrentNobleProfile();
const currentArt = getCurrentPlayerCompanyStandardArt();
assert.equal(currentArt.nobleId, currentProfile.nobleId);
assert.equal(currentArt.lordName, currentProfile.displayName);
assert.equal(currentArt.upper.charge, currentProfile.heraldry.charge);
assert.equal(currentArt.upper.fieldColor, currentProfile.heraldry.fieldColor);

const ottoman = resolveOttomanCompanyStandardArt();
assert.equal(ottoman.faction, 'ottoman');
assert.equal(ottoman.source, 'mid-sixteenth-century-field-standard');
assert.equal(ottoman.explicitlyNotModernNationalFlag, true);
assert.equal(ottoman.panel.aspectRatio, OTTOMAN_FIELD_STANDARD_ASPECT_RATIO);
assert.equal(ottoman.panel.flyProfile, 'single-pointed');
assert.equal(ottoman.panel.emblem.kind, 'forked-blade-and-knot-flourish');
assert.equal(ottoman.panel.emblem.inspiration, 'dhu-l-fiqar-and-tughra-ornament');
assert.equal(ottoman.panel.emblem.usesTextOrCalligraphy, false);
assert.ok(ottoman.panel.emblem.strokes.length >= 7);
assert.equal(Object.isFrozen(ottoman), true);
assert.equal(Object.isFrozen(ottoman.panel), true);
assert.equal(Object.isFrozen(ottoman.panel.emblem.strokes), true);
assert.equal(resolveOttomanCompanyStandardArt().cacheKey, ottoman.cacheKey);
assert.match(ottoman.cacheKey, /^ottoman-field-standard-v1-[0-9a-f]{8}$/);
assert.equal(resolveCompanyStandardArt('ottoman').cacheKey, ottoman.cacheKey);
assert.equal(resolveCompanyStandardArt('player', customProfile).cacheKey, art.cacheKey);

const mercenary = resolveMercenaryCompanyStandardArt();
assert.equal(mercenary.faction, 'mercenary');
assert.equal(mercenary.source, 'kupa-border-company-field-sign');
assert.equal(mercenary.panel.aspectRatio, MERCENARY_FIELD_STANDARD_ASPECT_RATIO);
assert.equal(mercenary.panel.flyProfile, 'swallowtail');
assert.equal(mercenary.panel.emblem, 'croaking-frog');
assert.equal(mercenary.panel.fieldColor, MERCENARY_FIELD_STANDARD_COLORS.riverGreen);
assert.equal(Object.isFrozen(mercenary), true);
assert.equal(Object.isFrozen(mercenary.panel), true);
assert.equal(resolveCompanyStandardArt('mercenary').cacheKey, mercenary.cacheKey);
assert.match(mercenary.cacheKey, /^mercenary-field-standard-v1-[0-9a-f]{8}$/);

const redField = sampleOttomanFieldStandard(ottoman.panel, 0.55, 0.2);
const saffronField = sampleOttomanFieldStandard(ottoman.panel, 0.55, 0.48);
const greenField = sampleOttomanFieldStandard(ottoman.panel, 0.55, 0.82);
assert.deepEqual(redField, { insideCloth: true, region: 'crimson', color: OTTOMAN_FIELD_STANDARD_COLORS.crimson });
assert.deepEqual(saffronField, { insideCloth: true, region: 'saffron', color: OTTOMAN_FIELD_STANDARD_COLORS.saffron });
assert.deepEqual(greenField, { insideCloth: true, region: 'green', color: OTTOMAN_FIELD_STANDARD_COLORS.green });
assert.equal(sampleOttomanFieldStandard(ottoman.panel, 0.99, 0.04).insideCloth, false);
assert.equal(sampleOttomanFieldStandard(ottoman.panel, 0.99, 0.5).insideCloth, true);
assert.equal(sampleOttomanFieldStandard(ottoman.panel, 0.005, 0.5).region, 'gold-trim');
assert.equal(sampleOttomanFieldStandard(ottoman.panel, 0.5, 0.52).region, 'gold-emblem');

const ottomanSignature = JSON.stringify(ottoman);
assert.doesNotMatch(ottomanSignature, /crescent|five-pointed-star/i);
assert.doesNotMatch(ottomanSignature, /arabic-text|inscription/i);

const sourceText = readFileSync(
  new URL('../src/settlement/companyStandardArt.ts', import.meta.url),
  'utf8',
);
for (const forbidden of [
  /new THREE\./,
  /document\./,
  /CanvasTexture/,
  /TextureLoader/,
  /requestAnimationFrame/,
]) {
  assert.equal(
    forbidden.test(sourceText),
    false,
    `standard artwork must stay reusable and independent of mesh/cloth ownership (${forbidden})`,
  );
}

console.log(
  `test:company-standard-art passed (${HERALDRY_PATTERNS.length} heraldry patterns, `
  + `${CROATIAN_CHECKER_COLUMNS * CROATIAN_CHECKER_ROWS} Croatian checks, `
  + `live lord charge ${currentArt.upper.charge}, pointed Ottoman field standard)`,
);
