import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createBuildingMesh } from '../src/buildings/BuildingMeshes.ts';
import { FOUNDING_STONE_VISUAL_SEGMENTS } from '../src/buildings/buildingStockpileVisuals.ts';
import { FOUNDERS_CAMPFIRE_NAME } from '../src/buildings/meshes/foundersCampMesh.ts';

const mesh = createBuildingMesh('founders_camp');
const stockpile = mesh.getObjectByName('FoundingStoneStockpile');
const campfire = mesh.getObjectByName(FOUNDERS_CAMPFIRE_NAME);

assert.ok(stockpile instanceof THREE.Group);
assert.ok(campfire instanceof THREE.Group);

const stockpileRocks = stockpile.children.filter(
  (child): child is THREE.Mesh => child instanceof THREE.Mesh
    && child.name === 'FoundingStoneSegment',
);
assert.equal(stockpileRocks.length, FOUNDING_STONE_VISUAL_SEGMENTS);
assert.equal(stockpileRocks.length, 5, 'the main rock pile should contain one five-rock layer');
assert.ok(
  stockpileRocks.every((rock) => rock.position.y < 0.6),
  'the main rock pile must not retain raised top rocks',
);

const hearthRocks = campfire.getObjectsByProperty(
  'name',
  'Founding campfire hearth stone',
) as THREE.Mesh[];
assert.equal(hearthRocks.length, 10);

for (const rock of [...stockpileRocks, ...hearthRocks]) {
  assert.equal(
    (rock.material as THREE.Material).userData.buildingMaterialAtlasTile,
    'quarry-stone',
    'loose camp rocks must use the raw quarry-stone atlas surface',
  );
}

console.log('Founders camp rock presentation checks passed.');
