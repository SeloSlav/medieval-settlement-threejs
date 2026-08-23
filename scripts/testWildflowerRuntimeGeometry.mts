import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type * as THREE from 'three';
import {
  createSeedThreeWildflowerGeometry,
  createSeedThreeWildflowerFootprintGeometries,
  createSeedThreeWildflowerVariantGeometries,
  SEEDTHREE_WILDFLOWER_HEAD_SCALE,
  SEEDTHREE_WILDFLOWER_VARIANTS,
} from '../src/vegetation/seedthree/seedThreeWildflowers.ts';
import {
  estimateWildflowerSubmittedTriangles,
  resolveWildflowerGeometryLod,
  resolveWildflowerLodSubmission,
  WILDFLOWER_SLOT_CAPACITIES,
} from '../src/grass/wildflowerStreamBudget.ts';

function geometrySignature(geometry: THREE.BufferGeometry): string {
  const hash = createHash('sha256');
  hash.update(Buffer.from(geometry.index!.array.buffer));
  for (const name of Object.keys(geometry.attributes).sort()) {
    const attribute = geometry.getAttribute(name);
    hash.update(name);
    hash.update(Buffer.from(attribute.array.buffer));
  }
  return hash.digest('hex');
}

function geometryBytes(geometry: THREE.BufferGeometry): number {
  let total = geometry.index?.array.byteLength ?? 0;
  for (const attribute of Object.values(geometry.attributes)) {
    total += attribute.array.byteLength;
  }
  return total;
}

const combined = createSeedThreeWildflowerGeometry(SEEDTHREE_WILDFLOWER_HEAD_SCALE);
const first = createSeedThreeWildflowerVariantGeometries(SEEDTHREE_WILDFLOWER_HEAD_SCALE);
const repeat = createSeedThreeWildflowerVariantGeometries(SEEDTHREE_WILDFLOWER_HEAD_SCALE);
const footprint = createSeedThreeWildflowerFootprintGeometries(
  SEEDTHREE_WILDFLOWER_HEAD_SCALE,
);
const footprintRepeat = createSeedThreeWildflowerFootprintGeometries(
  SEEDTHREE_WILDFLOWER_HEAD_SCALE,
);

assert.equal(first.length, SEEDTHREE_WILDFLOWER_VARIANTS.length);
assert.equal(first.length, WILDFLOWER_SLOT_CAPACITIES.length);
assert.ok(combined.index && combined.index.count > 0);

const combinedTriangles = combined.index.count / 3;
const combinedBytes = geometryBytes(combined);
const trianglesPerSpecies = first.map((geometry, variantIndex) => {
  assert.ok(geometry.index && geometry.index.count > 0);
  assert.equal(
    geometry.userData.wildflowerVariant,
    SEEDTHREE_WILDFLOWER_VARIANTS[variantIndex]!.id,
  );
  assert.equal(geometrySignature(geometry), geometrySignature(repeat[variantIndex]!));

  const packedMask = geometry.getAttribute('flowerMask');
  const structureLow = (variantIndex + 1) * 2 - 0.5;
  const structureHigh = (variantIndex + 1) * 2 + 1.5;
  for (let index = 0; index < packedMask.count; index++) {
    const mask = packedMask.getX(index);
    assert.ok(
      mask < 1.5 || (mask >= structureLow && mask < structureHigh),
      `${SEEDTHREE_WILDFLOWER_VARIANTS[variantIndex]!.id} leaked packed mask ${mask}`,
    );
  }

  const triangles = geometry.index.count / 3;
  assert.ok(
    triangles < combinedTriangles * 0.72,
    'one species must never execute most of the merged botanical kit',
  );
  return triangles;
});

const splitGeometryBytes = first.reduce(
  (total, geometry) => total + geometryBytes(geometry),
  0,
);
assert.ok(
  splitGeometryBytes < combinedBytes * 1.75,
  'species splitting may duplicate the shared stem but must keep geometry memory bounded',
);

const footprintTrianglesPerSpecies = footprint.map((geometry, variantIndex) => {
  assert.equal(geometry.userData.geometryLod, 'footprint');
  assert.equal(
    geometry.userData.wildflowerVariant,
    SEEDTHREE_WILDFLOWER_VARIANTS[variantIndex]!.id,
  );
  assert.equal(
    geometrySignature(geometry),
    geometrySignature(footprintRepeat[variantIndex]!),
    'the footprint LOD must be deterministic for a fixed authored seed/configuration',
  );
  const triangles = (geometry.index?.count ?? 0) / 3;
  assert.ok(triangles >= 16 && triangles <= 48);
  assert.ok(triangles < trianglesPerSpecies[variantIndex]! * 0.12);
  const wind = geometry.getAttribute('windWeight');
  assert.ok(wind && wind.getX(0) === 0);
  assert.ok(
    Array.from({ length: wind.count }, (_, index) => wind.getX(index))
      .some((weight) => weight === 1),
    'the footprint LOD must retain rooted-to-tip wind weighting',
  );
  return triangles;
});

assert.equal(resolveWildflowerGeometryLod('footprint', 4, true), 'detail');
assert.equal(resolveWildflowerGeometryLod('detail', 20, true), 'footprint');
assert.equal(resolveWildflowerGeometryLod('detail', 13.9, false), 'detail');
assert.equal(resolveWildflowerGeometryLod('detail', 14.1, false), 'footprint');
assert.equal(resolveWildflowerGeometryLod('footprint', 10.1, false), 'footprint');
assert.equal(resolveWildflowerGeometryLod('footprint', 9.9, false), 'detail');
assert.equal(resolveWildflowerGeometryLod('detail', Number.NaN, false), 'footprint');

// A deterministic near/design stream cohort representative of the canonical
// settlement view; the far camera uses the same live data but submits none.
const designLiveBySpecies = [4_150, 2_310, 4_080, 640, 480] as const;
const designLive = designLiveBySpecies.reduce((total, count) => total + count, 0);
const designLod = resolveWildflowerLodSubmission(designLive, true);
const farLod = resolveWildflowerLodSubmission(designLive, false);
assert.equal(designLod.submittedInstances, designLive);
assert.equal(designLod.culledInstances, 0);
assert.equal(farLod.submittedInstances, 0);
assert.equal(farLod.culledInstances, designLive);

const splitDesignTriangles = estimateWildflowerSubmittedTriangles(
  designLiveBySpecies,
  trianglesPerSpecies,
);
const mergedDesignTriangles = designLive * combinedTriangles;
assert.ok(
  splitDesignTriangles < mergedDesignTriangles * 0.35,
  'the fixed design camera must remove at least 65% of merged-kit triangle submissions',
);
const footprintDesignTriangles = estimateWildflowerSubmittedTriangles(
  designLiveBySpecies,
  footprintTrianglesPerSpecies,
);
assert.ok(
  footprintDesignTriangles < 400_000,
  'the fixed settlement/strategic footprint must leave ample room below the immutable 1,798,621-triangle Round57 renderer budget',
);

const oneChunkWorstCase = estimateWildflowerSubmittedTriangles(
  WILDFLOWER_SLOT_CAPACITIES,
  trianglesPerSpecies,
);
assert.ok(Number.isFinite(oneChunkWorstCase) && oneChunkWorstCase > 0);

console.log(JSON.stringify({
  combinedTriangles,
  trianglesPerSpecies,
  combinedBytes,
  splitGeometryBytes,
  designLive,
  splitDesignTriangles,
  footprintTrianglesPerSpecies,
  footprintDesignTriangles,
  mergedDesignTriangles,
  reductionPercent: (1 - splitDesignTriangles / mergedDesignTriangles) * 100,
  oneChunkWorstCase,
}));

combined.dispose();
for (const geometry of [
  ...first,
  ...repeat,
  ...footprint,
  ...footprintRepeat,
]) geometry.dispose();
