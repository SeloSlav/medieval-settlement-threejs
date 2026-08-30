import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import {
  classifyForestRockSurface,
  FOREST_MOSSY_ROCK_DENSITY_MIN,
} from '../src/props/forestRockAppearance.ts';
import { unwrapTriangleUvSeams } from '../src/utils/boulderUv.ts';

type ApprovedMaterialManifest = {
  slug: string;
  target: string;
  albedoSource: string;
  normalProcessing: {
    greenChannelFlipped: boolean;
    meanTiltRemoved: boolean;
    xyStrength: number;
    runtimeMeanRgb: [number, number, number];
    runtimeRangeRgb: [[number, number], [number, number], [number, number]];
  };
};

type NaturalSurfaceManifest = {
  rawCandidatesPreserved: boolean;
  runtimeRockOverride: {
    changedOn: string;
    base: string;
    roles: string[];
    roleOverridesChangedOn: string;
    roleOverrides: Record<string, string>;
    retainedInactiveCandidates: string[];
  };
  deferred: string[];
  materials: ApprovedMaterialManifest[];
  terrainAtlases: {
    albedo: string;
    hrao: string;
    hraoChannels: string;
    cellOrderTopToBottom: string;
    cellPaddingModesTopToBottom: string;
  };
  files: Record<string, string>;
};

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const readSource = (relativePath: string): string =>
  readFileSync(`${projectRoot}${relativePath}`, 'utf8');
const readAsset = (relativePath: string): Buffer =>
  readFileSync(`${projectRoot}${relativePath}`);
const sha256 = (contents: Buffer): string =>
  createHash('sha256').update(contents).digest('hex');
const pngDimensions = (contents: Buffer): { width: number; height: number } => {
  assert.equal(contents.subarray(1, 4).toString('ascii'), 'PNG');
  return {
    width: contents.readUInt32BE(16),
    height: contents.readUInt32BE(20),
  };
};

type SharpDecodeResult = {
  data: Uint8Array;
  info: { width: number; height: number; channels: number };
};
type SharpImage = {
  raw(): {
    toBuffer(options: { resolveWithObject: true }): Promise<SharpDecodeResult>;
  };
};
const vendorRequire = createRequire(resolve('vendor/seedthree/package.json'));
const sharp = vendorRequire('sharp') as (input: Buffer) => SharpImage;

const ATLAS_CELL_SIZE = 1024;
const ATLAS_GUTTER = 64;
const ATLAS_CONTENT_SIZE = ATLAS_CELL_SIZE - ATLAS_GUTTER * 2;
const ATLAS_PADDING_MODES = ['mirror', 'mirror', 'mirror', 'repeat'] as const;

function paddedSourceIndex(
  index: number,
  mode: (typeof ATLAS_PADDING_MODES)[number],
): number {
  if (index < ATLAS_GUTTER) {
    return mode === 'mirror'
      ? ATLAS_GUTTER * 2 - 1 - index
      : index + ATLAS_CONTENT_SIZE;
  }
  if (index >= ATLAS_CELL_SIZE - ATLAS_GUTTER) {
    return mode === 'mirror'
      ? (ATLAS_CELL_SIZE - ATLAS_GUTTER) * 2 - 1 - index
      : index - ATLAS_CONTENT_SIZE;
  }
  return index;
}

async function assertAtlasPadding(relativePath: string): Promise<void> {
  const decoded = await sharp(readAsset(relativePath)).raw().toBuffer({ resolveWithObject: true });
  assert.deepEqual(
    { width: decoded.info.width, height: decoded.info.height },
    { width: ATLAS_CELL_SIZE, height: ATLAS_CELL_SIZE * ATLAS_PADDING_MODES.length },
  );
  assert.ok(decoded.info.channels >= 3);

  for (let cellIndex = 0; cellIndex < ATLAS_PADDING_MODES.length; cellIndex += 1) {
    const mode = ATLAS_PADDING_MODES[cellIndex]!;
    const cellStartY = cellIndex * ATLAS_CELL_SIZE;
    for (let localY = 0; localY < ATLAS_CELL_SIZE; localY += 1) {
      const sourceLocalY = paddedSourceIndex(localY, mode);
      for (let x = 0; x < ATLAS_CELL_SIZE; x += 1) {
        const sourceX = paddedSourceIndex(x, mode);
        if (sourceX === x && sourceLocalY === localY) continue;
        const targetOffset = ((cellStartY + localY) * ATLAS_CELL_SIZE + x)
          * decoded.info.channels;
        const sourceOffset = ((cellStartY + sourceLocalY) * ATLAS_CELL_SIZE + sourceX)
          * decoded.info.channels;
        for (let channel = 0; channel < decoded.info.channels; channel += 1) {
          if (decoded.data[targetOffset + channel] !== decoded.data[sourceOffset + channel]) {
            assert.fail(
              `${relativePath} cell ${cellIndex} ${mode} padding mismatch at (${x}, ${localY})`,
            );
          }
        }
      }
    }
  }
}

const manifest = JSON.parse(
  readSource('public/assets/textures/approved-natural-surface-pbr.json'),
) as NaturalSurfaceManifest;

const expectedMaterials = new Map([
  ['rts-groundcover-meadow-v3', 'public/assets/textures/terrain/gorski_meadow_grass_v1'],
  ['rts-groundcover-dense-v2', 'public/assets/textures/terrain/gorski_dense_grass_v1'],
  ['rts-groundcover-dry-v4', 'public/assets/textures/terrain/gorski_dry_grass_v1'],
  ['forest-leaf-litter-primary', 'public/assets/textures/terrain/gorski_forest_litter_primary_v1'],
  ['forest-leaf-litter-secondary', 'public/assets/textures/terrain/gorski_forest_litter_secondary_v1'],
  ['forest-mossy-karst-rock-v3', 'public/assets/textures/props/gorski_forest_mossy_rock_v1'],
  ['clean-river-stone', 'public/assets/textures/props/gorski_river_stone_v1'],
  ['clean-quarry-limestone-v2', 'public/assets/textures/props/gorski_quarry_limestone_v1'],
]);
const expectedAlbedoSources = new Map([
  ['rts-groundcover-meadow-v3', 'basecolor-runtime.png'],
]);

assert.equal(manifest.rawCandidatesPreserved, true);
assert.equal(manifest.runtimeRockOverride.changedOn, '2026-08-24');
assert.equal(
  manifest.runtimeRockOverride.base,
  'public/assets/textures/props/mossy_rock',
);
assert.deepEqual(
  manifest.runtimeRockOverride.roles,
  ['forest', 'meadow', 'quarry'],
);
assert.equal(manifest.runtimeRockOverride.roleOverridesChangedOn, '2026-08-30');
assert.deepEqual(
  manifest.runtimeRockOverride.roleOverrides,
  { river: 'public/assets/textures/props/gorski_river_stone_v1' },
);
assert.deepEqual(
  manifest.runtimeRockOverride.retainedInactiveCandidates,
  [
    'public/assets/textures/props/gorski_forest_mossy_rock_v1',
    'public/assets/textures/props/gorski_quarry_limestone_v1',
  ],
);
assert.deepEqual(
  new Set(manifest.deferred),
  new Set(['medieval compacted dirt road', 'backyard garden-bed soil']),
);
assert.equal(manifest.materials.length, expectedMaterials.size);
assert.equal(Object.keys(manifest.files).length, 66);

for (const material of manifest.materials) {
  assert.equal(expectedMaterials.get(material.slug), material.target);
  assert.equal(
    material.albedoSource,
    expectedAlbedoSources.get(material.slug) ?? 'basecolor.png',
  );
  assert.equal(material.normalProcessing.greenChannelFlipped, true);
  assert.equal(material.normalProcessing.meanTiltRemoved, true);
  assert.ok(material.normalProcessing.xyStrength > 0 && material.normalProcessing.xyStrength <= 0.7);
  const [meanX, meanY, meanZ] = material.normalProcessing.runtimeMeanRgb;
  const [[minX, maxX], [minY, maxY], [minZ, maxZ]] =
    material.normalProcessing.runtimeRangeRgb;
  assert.ok(Math.abs(meanX - 127.5) <= 4);
  assert.ok(Math.abs(meanY - 127.5) <= 4);
  assert.ok(meanZ >= 244);
  assert.ok(minX >= 45 && maxX <= 210);
  assert.ok(minY >= 45 && maxY <= 210);
  assert.ok(minZ >= 210 && maxZ <= 255);

  for (const name of ['albedo', 'normal', 'roughness', 'ao', 'height', 'metalness']) {
    const path = `${material.target}/${name}.png`;
    const contents = readAsset(path);
    assert.deepEqual(pngDimensions(contents), { width: 1024, height: 1024 });
  }
}

for (const [relativePath, expectedHash] of Object.entries(manifest.files)) {
  assert.equal(existsSync(`${projectRoot}${relativePath}`), true, `missing ${relativePath}`);
  assert.equal(sha256(readAsset(relativePath)), expectedHash, `hash mismatch for ${relativePath}`);
}

assert.equal(manifest.terrainAtlases.hraoChannels, 'R=height, G=roughness, B=ambient occlusion');
assert.equal(
  manifest.terrainAtlases.cellOrderTopToBottom,
  'dry, snow, primary forest litter, secondary forest litter',
);
assert.equal(
  manifest.terrainAtlases.cellPaddingModesTopToBottom,
  'mirror, mirror, mirror, repeat',
);
for (const atlasPath of [manifest.terrainAtlases.albedo, manifest.terrainAtlases.hrao]) {
  assert.deepEqual(pngDimensions(readAsset(atlasPath)), { width: 1024, height: 4096 });
  await assertAtlasPadding(atlasPath);
}

assert.equal(classifyForestRockSurface(0), 'neutralMeadow');
assert.equal(
  classifyForestRockSurface(FOREST_MOSSY_ROCK_DENSITY_MIN - Number.EPSILON),
  'neutralMeadow',
);
assert.equal(classifyForestRockSurface(FOREST_MOSSY_ROCK_DENSITY_MIN), 'mossyForest');
assert.equal(classifyForestRockSurface(1), 'mossyForest');

const roadLoaderSource = readSource('src/roads/RoadTextureLoader.ts');
const gardenSource = readSource('src/residences/backyardGardenMesh.ts');
const propLoaderSource = readSource('src/utils/propTextureLoad.ts');
const startupSource = readSource('src/scene/startupTextures.ts');
const sceneManagerSource = readSource('src/scene/SceneManager.ts');
const forestPropsSource = readSource('src/props/ForestProps.ts');
const riverSource = readSource('src/rivers/RiverSystem.ts');
const riverStoneSource = readSource('src/rivers/RiverShoreStones.ts');
const quarrySource = readSource('src/quarries/QuarrySystem.ts');
const disposeSource = readSource('src/utils/dispose.ts');

assert.match(roadLoaderSource, /const base = '\/assets\/textures\/roads\/medieval_dirt'/);
assert.match(roadLoaderSource, /gorski_meadow_grass_v1/);
assert.match(roadLoaderSource, /gorski_dense_grass_v1/);
assert.match(gardenSource, /\/assets\/textures\/terrain\/mammoth_terrain_dirt\/albedo\.png/);
assert.match(gardenSource, /\/assets\/textures\/terrain\/mammoth_terrain_dirt\/normal\.png/);
assert.match(gardenSource, /\/assets\/textures\/terrain\/mammoth_terrain_dirt\/roughness\.png/);

for (const retainedCandidate of [
  'gorski_forest_mossy_rock_v1',
  'gorski_quarry_limestone_v1',
]) {
  assert.doesNotMatch(
    propLoaderSource,
    new RegExp(retainedCandidate),
    `${retainedCandidate} must remain inactive at runtime`,
  );
}
assert.match(
  propLoaderSource,
  /const MOSSY_ROCK_TEXTURE_BASE = '\/assets\/textures\/props\/mossy_rock'/,
);
for (const role of ['forest', 'meadow', 'quarry']) {
  assert.match(
    propLoaderSource,
    new RegExp(`'${role}',\\s*MOSSY_ROCK_TEXTURE_BASE`),
    `${role} rocks must use the shared mossy material`,
  );
}
assert.match(
  propLoaderSource,
  /const RIVER_CARBONATE_TEXTURE_BASE = '\/assets\/textures\/props\/gorski_river_stone_v1'/,
);
assert.match(
  propLoaderSource,
  /'river',\s*RIVER_CARBONATE_TEXTURE_BASE,\s*maxAnisotropy,\s*true/,
);
assert.match(propLoaderSource, /if \(aoMap\) aoMap\.channel = 1/);
assert.match(startupSource, /loadRiverRockTextures/);
assert.match(startupSource, /loadQuarryRockTextures/);
assert.doesNotMatch(startupSource, /quarryRock:\s*riverRock/);
assert.match(
  startupSource,
  /const anisotropy = target\.anisotropy;[\s\S]*?target\.copy\(source\);[\s\S]*?target\.anisotropy = anisotropy;/,
);
assert.match(disposeSource, /const geometries = new Set<THREE\.BufferGeometry>\(\)/);
assert.match(sceneManagerSource, /createQuarrySystem\([\s\S]*?startupTextures\.quarryRock/);
assert.match(sceneManagerSource, /createRiverSystem\([\s\S]*?startupTextures\.riverRock/);

assert.match(forestPropsSource, /classifyForestRockSurface\(forestDensity\)/);
assert.match(forestPropsSource, /materials\.forestRock\.dispose\(\)/);
assert.match(forestPropsSource, /materials\.meadowRock\.dispose\(\)/);
assert.match(forestPropsSource, /materials\.textures\.forEach\(\(texture\) => texture\.dispose\(\)\)/);
assert.match(riverSource, /disposeRockTextureSet\(rockTextures\)/);
assert.match(quarrySource, /disposeRockTextureSet\(rockTextures\)/);
for (const [name, source] of [
  ['river', riverSource],
  ['quarry', quarrySource],
] as const) {
  assert.match(source, /if \(disposed\) return Promise\.resolve\(\);/, `${name} details must not start after disposal`);
  assert.match(source, /const dispose = \(\) => \{\s*if \(disposed\) return;\s*disposed = true;/, `${name} disposal must be idempotent`);
}
assert.match(riverStoneSource, /computeShoreStoneMoss/);
assert.match(startupSource, /placeholderRockTextureSet\('river', \[196, 197, 187, 255\]\)/);
assert.match(startupSource, /placeholderRockTextureSet\('quarry', \[95, 102, 91, 255\]\)/);
assert.ok(
  forestPropsSource.indexOf('transformBuckets.forEach')
    < forestPropsSource.indexOf('renderBuckets.forEach'),
  'forest rock transforms must retain legacy variant-major RNG order before material grouping',
);

for (const [name, source] of [
  ['forest rocks', forestPropsSource],
  ['river stones', riverStoneSource],
  ['quarry boulders', quarrySource],
] as const) {
  assert.match(source, /setAttribute\('uv1',/, `${name} must provide the AO UV channel`);
  assert.match(source, /unwrapTriangleUvSeams\(geometry\)/, `${name} must unwrap the spherical U seam`);
}

for (const legacyFolder of [
  'public/assets/textures/terrain/manor_grass_meadow',
  'public/assets/textures/terrain/manor_grass_dense',
  'public/assets/textures/terrain/manor_grass_dry',
  'public/assets/textures/terrain/forest_leaf_litter',
  'public/assets/textures/terrain/forest_leaf_litter_secondary',
]) {
  assert.equal(existsSync(`${projectRoot}${legacyFolder}`), true, `preserved source missing: ${legacyFolder}`);
}

const seamGeometry = new THREE.BufferGeometry();
seamGeometry.setAttribute(
  'uv',
  new THREE.Float32BufferAttribute([0.96, 0.4, 0.04, 0.5, 0.08, 0.6], 2),
);
unwrapTriangleUvSeams(seamGeometry);
const seamUv = seamGeometry.getAttribute('uv') as THREE.BufferAttribute;
const seamValues = [seamUv.getX(0), seamUv.getX(1), seamUv.getX(2)];
assert.ok(Math.max(...seamValues) - Math.min(...seamValues) < 0.2);
assert.ok(seamValues[1] > 1 && seamValues[2] > 1);
seamGeometry.dispose();

console.log(
  'Approved natural-surface tests passed: the Kupa uses its pale carbonate PBR set while retained alternatives and deferred surfaces remain preserved.',
);
