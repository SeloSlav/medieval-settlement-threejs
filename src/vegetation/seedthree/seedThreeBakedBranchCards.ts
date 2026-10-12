import type { CacheRecord, CachedTextureChannels } from './seedThreeBranchCardCache.ts';
import { BAKED_BRANCH_CARD_ASSETS } from './seedThreeBakedBranchCardCatalog.ts';
import { seedThreePersistentBranchCardCacheKey } from './seedThreeBranchCardPolicy.ts';

export type BakedBranchCardArray = { offset: number; byteLength: number; type: 'f32' | 'u16' | 'u32' };
type BakedBranchCardManifest = {
  format: number;
  key: string;
  geometryByteLength: number;
  sets: Array<{
    key: string; foliageOnly: boolean; noFlutter: boolean;
    variants: Array<{
      attributes: Record<string,{ values: BakedBranchCardArray; itemSize: number; normalized: boolean; instanced: boolean }>;
      indices: BakedBranchCardArray;
      chordLen: number;
      textures: Record<keyof CachedTextureChannels,string>;
    }>;
  }>;
};

/** Views preserve every geometry bit, including 32-bit indices and float padding. */
export function readBakedBranchCardArray(
  descriptor: BakedBranchCardArray,
  geometry: ArrayBuffer,
): Float32Array | Uint16Array | Uint32Array {
  const { offset, byteLength, type } = descriptor;
  const stride = type === 'u16' ? 2 : 4;
  if (!['f32','u16','u32'].includes(type) || !Number.isSafeInteger(offset) || !Number.isSafeInteger(byteLength)
    || offset < 0 || byteLength < 0 || offset % stride || byteLength % stride
    || offset+byteLength > geometry.byteLength) throw Error('Invalid baked branch-card geometry range');
  if (type === 'f32') return new Float32Array(geometry,offset,byteLength/stride);
  if (type === 'u16') return new Uint16Array(geometry,offset,byteLength/stride);
  return new Uint32Array(geometry,offset,byteLength/stride);
}

export async function readBakedSeedThreeBranchCardRecord(cacheKey: string): Promise<CacheRecord | null> {
  const key = seedThreePersistentBranchCardCacheKey(cacheKey);
  const directory = BAKED_BRANCH_CARD_ASSETS[key];
  if (!directory) return null;
  try {
    const [manifestResponse,geometryResponse] = await Promise.all([
      fetch(`${directory}/manifest.json`), fetch(`${directory}/geometry.bin`),
    ]);
    if (!manifestResponse.ok || !geometryResponse.ok) throw Error('Baked branch-card asset unavailable');
    const manifest: BakedBranchCardManifest = await manifestResponse.json();
    const geometry = await geometryResponse.arrayBuffer();
    if (manifest.format !== 1 || manifest.key !== key || geometry.byteLength !== manifest.geometryByteLength)
      throw Error('Baked branch-card asset does not match the current preset');
    const sets = await Promise.all(manifest.sets.map(async set => ({
      key: set.key, foliageOnly: set.foliageOnly, noFlutter: set.noFlutter,
      variants: await Promise.all(set.variants.map(async variant => {
        const attributes = Object.fromEntries(Object.entries(variant.attributes).map(([name,attribute]) => {
          const values = readBakedBranchCardArray(attribute.values,geometry);
          if (!(values instanceof Float32Array)) throw Error('Invalid baked branch-card attribute type');
          return [name,{ ...attribute, values }];
        }));
        const indices = readBakedBranchCardArray(variant.indices,geometry);
        if (indices instanceof Float32Array) throw Error('Invalid baked branch-card index type');
        const textures = Object.fromEntries(await Promise.all(
          (['albedo','normal','rough','trans'] as const).map(async channel => {
            const filename = variant.textures[channel];
            if (!/^\d+-\d+-(albedo|normal|rough|trans)\.png$/.test(filename)) throw Error('Invalid baked texture name');
            const response = await fetch(`${directory}/${filename}`);
            if (!response.ok) throw Error('Baked branch-card texture unavailable');
            return [channel,await response.blob()];
          }),
        )) as CachedTextureChannels;
        return { attributes, indices, chordLen: variant.chordLen, textures };
      })),
    })));
    return { key,sets };
  } catch (error) {
    console.warn('[SeedThree] baked branch-card assets could not be restored:',error);
    return null;
  }
}
