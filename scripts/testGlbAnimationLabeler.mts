import assert from 'node:assert/strict';
import {
  normalizeAnimationLabel,
  readGlbAnimationNames,
  rewriteGlbAnimationNames,
  validateAnimationLabels,
} from '../src/tools/glb-animation-labeler/glbBinary.ts';
import {
  countUnassignedAnimationLabels,
  getAvailableAnimationLabels,
  selectAnimationLabelCatalog,
} from '../src/tools/glb-animation-labeler/labelChoices.ts';

const source = createFixtureGlb(['NlaTrack', 'NlaTrack.001']);
assert.deepEqual(readGlbAnimationNames(source), ['NlaTrack', 'NlaTrack.001']);

assert.equal(normalizeAnimationLabel(' Hit To Body-01 '), 'hit_to_body_01');
assert.equal(normalizeAnimationLabel('Standing   Relax'), 'standing_relax');

const knownLabels = ['agree', 'bow', 'cheer', 'chop'] as const;
const nearlyComplete = ['agree', 'bow', '', ''];
assert.deepEqual(getAvailableAnimationLabels(knownLabels, nearlyComplete, 2), ['cheer', 'chop']);
assert.deepEqual(getAvailableAnimationLabels(knownLabels, nearlyComplete, 3), ['cheer', 'chop']);
assert.equal(countUnassignedAnimationLabels(knownLabels, nearlyComplete), 2);

const revisitingAssigned = ['agree', 'bow', 'cheer', ''];
assert.deepEqual(getAvailableAnimationLabels(knownLabels, revisitingAssigned, 1), ['bow', 'chop']);
assert.equal(countUnassignedAnimationLabels(knownLabels, revisitingAssigned), 1);

const correctedAssignments = [...revisitingAssigned];
correctedAssignments[1] = '';
assert.deepEqual(
  getAvailableAnimationLabels(knownLabels, correctedAssignments, 1),
  ['bow', 'chop'],
  'unbinding must return the released one-to-one label to the dropdown',
);
assert.equal(countUnassignedAnimationLabels(knownLabels, correctedAssignments), 2);

const fullCatalog = [
  'agree',
  'bow',
  'cheer',
  'chop',
  'clap',
  'cry',
  'dig',
  'fall',
  'flee_01',
  'greet_01',
  'hit_to_body_01',
  'idle',
  'laugh_01',
  'lift_heavy',
  'look_around',
  'run',
  'shovel',
  'sit',
  'slash',
  'standing_relax',
  'wait',
  'walk',
] as const;
const socialLabels = new Set([
  'agree',
  'bow',
  'cheer',
  'clap',
  'cry',
  'greet_01',
  'laugh_01',
]);
const reducedCatalog = selectAnimationLabelCatalog(fullCatalog, socialLabels, 15);
assert.equal(reducedCatalog.length, 15);
assert.ok(reducedCatalog.includes('idle'));
assert.ok(!reducedCatalog.includes('greet_01'));
assert.deepEqual(
  selectAnimationLabelCatalog(fullCatalog, socialLabels, 22),
  fullCatalog,
  'the original 22-clip export must retain the full catalog',
);

const incomplete = validateAnimationLabels(['idle', '']);
assert.equal(incomplete.complete, false);
assert.deepEqual(incomplete.missingIndices, [1]);

const duplicates = validateAnimationLabels(['walk', 'walk']);
assert.equal(duplicates.complete, false);
assert.deepEqual(duplicates.duplicateLabels, ['walk']);

const renamed = rewriteGlbAnimationNames(source, ['idle', 'walk']);
assert.deepEqual(readGlbAnimationNames(renamed), ['idle', 'walk']);
assert.equal(new DataView(renamed).getUint32(8, true), renamed.byteLength);
assert.deepEqual(readBinChunk(renamed), [1, 2, 3, 4]);

assert.throws(
  () => rewriteGlbAnimationNames(source, ['idle']),
  /contains 2 animations but 1 labels/,
);
assert.throws(
  () => rewriteGlbAnimationNames(source, ['idle', 'idle']),
  /unique lowercase semantic name/,
);

console.log('GLB animation labeler tests passed');

function createFixtureGlb(names: readonly string[]): ArrayBuffer {
  const document = {
    asset: { version: '2.0' },
    animations: names.map((name) => ({ name, channels: [], samplers: [] })),
    buffers: [{ byteLength: 4 }],
  };
  const jsonSource = new TextEncoder().encode(JSON.stringify(document));
  const json = new Uint8Array(Math.ceil(jsonSource.length / 4) * 4);
  json.fill(0x20);
  json.set(jsonSource);
  const bin = new Uint8Array([1, 2, 3, 4]);
  const length = 12 + 8 + json.byteLength + 8 + bin.byteLength;
  const output = new ArrayBuffer(length);
  const view = new DataView(output);
  const bytes = new Uint8Array(output);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, length, true);
  view.setUint32(12, json.byteLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  bytes.set(json, 20);
  const binHeader = 20 + json.byteLength;
  view.setUint32(binHeader, bin.byteLength, true);
  view.setUint32(binHeader + 4, 0x004e4942, true);
  bytes.set(bin, binHeader + 8);
  return output;
}

function readBinChunk(source: ArrayBuffer): number[] {
  const view = new DataView(source);
  let offset = 12;
  while (offset < source.byteLength) {
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    if (type === 0x004e4942) {
      return [...new Uint8Array(source.slice(offset + 8, offset + 8 + length))];
    }
    offset += 8 + length;
  }
  return [];
}
