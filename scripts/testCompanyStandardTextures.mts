import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  COMPANY_STANDARD_TEXTURE_MEMORY_BUDGET_BYTES,
  COMPANY_STANDARD_TEXTURE_WIDTH,
  createCompanyStandardTextures,
} from '../src/settlement/companyStandardTextures.ts';
import {
  CROATIAN_BANNER_ASPECT_RATIO,
  LORD_BANNER_ASPECT_RATIO,
  OTTOMAN_FIELD_STANDARD_ASPECT_RATIO,
} from '../src/settlement/companyStandardArt.ts';

assert.equal(COMPANY_STANDARD_TEXTURE_WIDTH, 512);
const estimatedBytes = [
  LORD_BANNER_ASPECT_RATIO,
  CROATIAN_BANNER_ASPECT_RATIO,
  OTTOMAN_FIELD_STANDARD_ASPECT_RATIO,
].reduce((total, aspect) => {
  const height = Math.max(256, Math.round(COMPANY_STANDARD_TEXTURE_WIDTH / aspect));
  return total + Math.ceil(COMPANY_STANDARD_TEXTURE_WIDTH * height * 4 * 4 / 3);
}, 0);
assert.ok(estimatedBytes <= COMPANY_STANDARD_TEXTURE_MEMORY_BUDGET_BYTES);
assert.throws(
  () => createCompanyStandardTextures(),
  /browser canvas/,
  'texture compilation should fail explicitly rather than invent a Node canvas',
);

const source = readFileSync(
  new URL('../src/settlement/companyStandardTextures.ts', import.meta.url),
  'utf8',
);
for (const pattern of [
  'solid', 'per-pale', 'per-fess', 'bend', 'bend-sinister', 'quarterly',
  'checky', 'stripes', 'chevron', 'saltire', 'cross', 'lozengy',
]) {
  assert.match(source, new RegExp(`case '${pattern}'`));
}
assert.match(source, /THREE\.SRGBColorSpace/);
assert.match(source, /THREE\.LinearMipmapLinearFilter/);
assert.match(source, /player\.upper\.chargeMaskUrl/);
assert.match(source, /for \(const stroke of art\.emblem\.strokes\)/);
assert.doesNotMatch(source, /crescent|five-pointed-star/i);

console.log(
  `Shared woven standard maps cover all heraldry and both faction flags in ${estimatedBytes} bytes.`,
);
