import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  disposeBuildingMaterialLibrary,
  sharedBuildingDetailMaterial,
  sharedBuildingMaterial,
  type BuildingDetailMaterialKey,
  type BuildingMaterialKey,
} from '../src/buildings/buildingMaterials.ts';
import {
  BUILDING_MATERIAL_ATLAS_ROOT,
  BUILDING_MATERIAL_ATLAS_TILES,
  getBuildingMaterialAtlasTextures,
} from '../src/buildings/buildingMaterialAtlas.ts';
import { BRIDGE_DECK_ATLAS_TILE_ID } from '../src/roads/RoadSurfaceMaterial.ts';

const atlasRoot = resolve('public/assets/textures/buildings/gorski_building_atlas_v1');
const manifestPath = resolve(atlasRoot, 'manifest.json');
assert.ok(existsSync(manifestPath), 'the packed building atlas manifest must exist');

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
  id: string;
  generator: string;
  dimensions: { width: number; height: number };
  grid: { columns: number; rows: number; cellSize: number; gutter: number; contentSize: number };
  files: Record<string, { bytes: number; sha256: string }>;
  tiles: Array<{ id: string; index: number; column: number; rowTopToBottom: number }>;
};

assert.equal(manifest.id, 'gorski-building-atlas-v1');
assert.equal(manifest.generator, 'fal-ai/patina/material');
assert.deepEqual(manifest.dimensions, { width: 2560, height: 2048 });
assert.deepEqual(manifest.grid, {
  columns: 5,
  rows: 4,
  cellSize: 512,
  gutter: 32,
  contentSize: 448,
});
assert.deepEqual(
  manifest.tiles.map((tile) => tile.id),
  BUILDING_MATERIAL_ATLAS_TILES,
  'runtime tile order must exactly match the packed top-to-bottom manifest',
);
assert.equal(
  BUILDING_MATERIAL_ATLAS_ROOT,
  '/assets/textures/buildings/gorski_building_atlas_v1',
  'bridge decks should load the shared packed building atlas',
);
assert.equal(
  getBuildingMaterialAtlasTextures(),
  getBuildingMaterialAtlasTextures(),
  'roads and buildings must receive the same stable atlas texture handles',
);

const roadFactorySource = readFileSync(
  resolve('src/roads/RoadMaterialFactory.ts'),
  'utf8',
);
const roadBuilderSource = readFileSync(
  resolve('src/roads/RoadMeshBuilder.ts'),
  'utf8',
);
const roadSurfaceSource = readFileSync(
  resolve('src/roads/RoadSurfaceMaterial.ts'),
  'utf8',
);
const roadLoaderSource = readFileSync(
  resolve('src/roads/RoadTextureLoader.ts'),
  'utf8',
);
assert.match(
  roadFactorySource,
  /bridgeDeckAtlasTextures = getBuildingMaterialAtlasTextures\(\)/,
  'bridge materials should reuse the building library atlas handles',
);
assert.match(
  roadBuilderSource,
  /hasBridge \? this\.materials\.bridgeRoad : this\.materials\.road/,
  'ordinary roads must stay on the atlas-free road material',
);
assert.doesNotMatch(
  roadLoaderSource,
  /gorski_building_atlas_v1/,
  'the road loader must not create a second copy of the building atlas',
);
assert.match(
  roadFactorySource,
  /const bridgeRailing = timberMaterial\('mid'\)/,
  'bridge railings should use the standard timberMid building material',
);
assert.match(
  roadFactorySource,
  /const bridgeSupport = bridgeRailing/,
  'bridge supports and railings should share the standard timberMid material',
);
assert.match(
  roadFactorySource,
  /const bridgeCable = sharedBuildingDetailMaterial\('wicker'\)/,
  'bridge suspension ropes should reuse the shared woven-fibre material',
);
assert.doesNotMatch(
  roadFactorySource,
  /textureLoader\.loadBridgeTextures\(\)/,
  'the superseded dark bridge-log texture set should not be loaded',
);
assert.match(
  roadBuilderSource,
  /this\.materials\.bridgeRailing/,
  'bridge railings must not fall back to the support/log material',
);
assert.match(
  roadSurfaceSource,
  /const bridgeMask = step\(/,
  'bridge planks should meet the dirt road at a hard material cut',
);
assert.equal(
  BRIDGE_DECK_ATLAS_TILE_ID,
  'rough-hewn-timber',
  'bridge decks should match the timberMid atlas surface used by doors and posts',
);

for (const [fileName, expected] of Object.entries(manifest.files)) {
  const path = resolve(atlasRoot, fileName);
  assert.ok(existsSync(path), `${fileName} must exist`);
  const bytes = readFileSync(path);
  assert.equal(bytes.byteLength, expected.bytes, `${fileName} byte count changed without repacking the manifest`);
  assert.equal(
    createHash('sha256').update(bytes).digest('hex'),
    expected.sha256,
    `${fileName} hash changed without repacking the manifest`,
  );
}

const constructionKeys: readonly BuildingMaterialKey[] = [
  'plasterWhite', 'plasterYellow', 'plasterGrey', 'plasterOrange',
  'masonryLight', 'masonryMid', 'masonryDark',
  'timberDark', 'timberMid', 'timberLight', 'timberWeathered', 'stackedTimber',
  'clayRed', 'clayDark', 'shingle', 'thatch', 'slate', 'metalIron',
  'moss', 'grassRoof', 'interiorDark',
];
const specialConstructionKeys: readonly BuildingMaterialKey[] = ['glass'];
const detailKeys: readonly BuildingDetailMaterialKey[] = [
  'brass', 'firedClay', 'wicker', 'paintRed', 'paintBlue', 'paintOchre',
  'earth', 'canvas',
];
const specialDetailKeys: readonly BuildingDetailMaterialKey[] = [
  'water', 'smoke', 'foliage', 'crop',
];

const usedTiles = new Set<string>();
for (const key of constructionKeys) {
  const material = sharedBuildingMaterial(key);
  assert.equal(material.isMeshStandardNodeMaterial, true, `${key} must use MeshStandardNodeMaterial`);
  assert.equal(material.userData.buildingMaterialAtlas, 'gorski-building-atlas-v1');
  assert.equal(typeof material.userData.metricUvMeters, 'number', `${key} must use metric UV scale`);
  usedTiles.add(String(material.userData.buildingMaterialAtlasTile));
}
for (const key of detailKeys) {
  const material = sharedBuildingDetailMaterial(key);
  assert.equal(material.isMeshStandardNodeMaterial, true, `${key} must use MeshStandardNodeMaterial`);
  assert.equal(material.userData.buildingMaterialAtlas, 'gorski-building-atlas-v1');
  assert.equal(typeof material.userData.metricUvMeters, 'number', `${key} must use metric UV scale`);
  usedTiles.add(String(material.userData.buildingMaterialAtlasTile));
}
for (const key of specialConstructionKeys) {
  assert.equal(
    sharedBuildingMaterial(key).userData.buildingMaterialAtlas,
    undefined,
    `${key} must retain its specialized non-atlas surface`,
  );
}
for (const key of specialDetailKeys) {
  assert.equal(
    sharedBuildingDetailMaterial(key).userData.buildingMaterialAtlas,
    undefined,
    `${key} must retain its specialized non-atlas surface`,
  );
}

assert.deepEqual(
  [...usedTiles].sort(),
  [...BUILDING_MATERIAL_ATLAS_TILES].sort(),
  'every packed tile must be reachable from a shared semantic building material',
);

disposeBuildingMaterialLibrary();
console.log(`building material atlas tests passed (${manifest.tiles.length} Patina tiles, 3 packed GPU textures)`);
