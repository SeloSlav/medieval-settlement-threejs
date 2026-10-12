import { createHash } from 'node:crypto';

/** Packs exact cached geometry bytes and the native baker's existing PNGs. */
export function packSeedThreeBranchCards(record) {
  const files = [], chunks = [];
  let byteLength = 0;
  const append = (value, type) => {
    const bytes = Buffer.from(value, 'base64');
    const alignment = type === 'u16' ? 2 : 4;
    if (bytes.length % alignment) throw Error('Invalid branch-card geometry alignment');
    const padding = (4-byteLength%4)%4;
    if (padding) { chunks.push(Buffer.alloc(padding)); byteLength += padding; }
    const descriptor = { offset: byteLength, byteLength: bytes.length, type };
    chunks.push(bytes); byteLength += bytes.length;
    return descriptor;
  };
  const sets = record.sets.map((set, setIndex) => ({
    key: set.key, foliageOnly: set.foliageOnly, noFlutter: set.noFlutter,
    variants: set.variants.map((variant, variantIndex) => {
      const attributes = Object.fromEntries(Object.entries(variant.attributes).map(([name,attribute]) => [name, {
        values: append(attribute.values, 'f32'), itemSize: attribute.itemSize,
        normalized: attribute.normalized, instanced: attribute.instanced,
      }]));
      const indices = append(variant.indices.values, variant.indices.type);
      const textures = Object.fromEntries(['albedo','normal','rough','trans'].map(channel => {
        const name = `${setIndex}-${variantIndex}-${channel}.png`;
        const bytes = Buffer.from(variant.textures[channel], 'base64');
        if (bytes.readUInt32BE(0) !== 0x89504e47) throw Error('Branch-card channel is not a PNG');
        files.push({ name, bytes }); return [channel,name];
      }));
      return { attributes, indices, chordLen: variant.chordLen, textures };
    }),
  }));
  files.push({ name: 'geometry.bin', bytes: Buffer.concat(chunks) });
  files.push({ name: 'manifest.json', bytes: Buffer.from(JSON.stringify({ format: 1,
    key: record.key, geometryByteLength: byteLength, sets })) });
  const digest = createHash('sha256');
  for (const file of files) digest.update(file.name).update(file.bytes);
  return { digest: digest.digest('hex'), files, key: record.key,
    byteLength: files.reduce((total,file)=>total+file.bytes.length,0) };
}
