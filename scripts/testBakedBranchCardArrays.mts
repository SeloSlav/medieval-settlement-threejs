import assert from 'node:assert/strict';
import { packSeedThreeBranchCards } from './packSeedThreeBranchCards.mjs';
import { readBakedBranchCardArray } from '../src/vegetation/seedthree/seedThreeBakedBranchCards.ts';

const words = new Uint32Array([0x80000000,0x7fc00123,0x3f800000,0xdeadbeef,0x00000001]);
const floatBytes = Buffer.from(words.buffer);
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
const encode = (view: ArrayBufferView) => Buffer.from(view.buffer,view.byteOffset,view.byteLength).toString('base64');
const record = {
  key: 'test-preset', sets: [{ key: '0:fol', foliageOnly: true, noFlutter: false,
    variants: [new Uint16Array([0,65535,17]),new Uint32Array([0,65536,0xffffffff])].map(indices=>({
      attributes: {
        position: { values: floatBytes.toString('base64'), itemSize: 1, normalized: false, instanced: false },
        aThickness: { values: encode(new Float32Array([0.2,0.5,1])), itemSize: 1, normalized: true, instanced: true },
      },
      indices: { values: encode(indices), type: indices instanceof Uint16Array ? 'u16' : 'u32' },
      chordLen: 3.5, textures: { albedo: png, normal: png, rough: png, trans: png },
    })),
  }],
};
const packed = packSeedThreeBranchCards(record);
const manifest = JSON.parse(packed.files.find(file=>file.name==='manifest.json')!.bytes.toString());
const binary = packed.files.find(file=>file.name==='geometry.bin')!.bytes;
const geometry = binary.buffer.slice(binary.byteOffset,binary.byteOffset+binary.byteLength);
for (const [i,variant] of manifest.sets[0].variants.entries()) {
  const values = readBakedBranchCardArray(variant.attributes.position.values,geometry);
  assert(values instanceof Float32Array);
  assert.deepEqual(Buffer.from(values.buffer,values.byteOffset,values.byteLength),floatBytes,
    'geometry must preserve raw float bits, signed zero and padding');
  const indices = readBakedBranchCardArray(variant.indices,geometry);
  assert.equal(indices.constructor,i === 0 ? Uint16Array : Uint32Array);
  assert.equal(indices[1],i === 0 ? 65535 : 65536);
  assert.equal(indices[2],i === 0 ? 17 : 0xffffffff);
  assert.equal(variant.attributes.aThickness.instanced,true);
  assert.equal(variant.attributes.aThickness.normalized,true);
  for (const filename of Object.values(variant.textures)) {
    assert.deepEqual(packed.files.find(file=>file.name===filename)!.bytes,Buffer.from(png,'base64'));
  }
}
for (const descriptor of [
  { type: 'f32', offset: -4, byteLength: 4 },
  { type: 'f32', offset: 1, byteLength: 4 },
  { type: 'f32', offset: 0, byteLength: 5 },
  { type: 'u32', offset: 0, byteLength: geometry.byteLength+4 },
  { type: 'u16', offset: 0.5, byteLength: 2 },
  { type: 'bad', offset: 0, byteLength: 4 },
]) assert.throws(()=>readBakedBranchCardArray(descriptor as never,geometry));
assert.equal(packSeedThreeBranchCards(record).digest,packed.digest,'identical records have identical asset URLs');
record.sets[0].variants[0].chordLen++;
assert.notEqual(packSeedThreeBranchCards(record).digest,packed.digest,'changed content gets a new asset URL');
console.log('test:baked-branch-card-arrays passed (float bits, mixed index widths, PNG bytes, invalid ranges)');
