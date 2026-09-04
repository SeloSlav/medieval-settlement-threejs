import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { sampleTerrainMeshHeight, sampleTerrainMeshSurfaceHeight } from '../src/terrain/TerrainMeshHeight.ts';
import { resolveRoadAwareGroundY } from '../src/roads/RoadSurfaceSampling.ts';
import { livestockVisualHeadCount } from '../src/farming/LivestockVisuals.ts';
import { displayedFishSchoolCount } from '../src/foraging/FishWildlifeVisuals.ts';
import {
  FISH_SHOAL_MAX_YIELD,
  RICH_FISH_SHOAL_MAX_YIELD,
  RICH_FISH_SHOAL_VISUAL_CAPACITY,
} from '../src/foraging/foragingYields.ts';
import {
  buildCrowdViewState,
  isAgentAnimalRenderingEnabled,
  isWithinAnimalCrowdView,
} from '../src/settlement/crowdView.ts';

const read = (path: string): string => readFileSync(path, 'utf8');

// Non-planar cells must ground actors on the visible triangles. Bilinear
// interpolation cuts through this ridge and can bury an entire small animal.
const terrainCell = new THREE.BufferGeometry();
terrainCell.setAttribute('position', new THREE.Float32BufferAttribute([
  -1, 0, -1, 1, 4, -1, -1, 4, 1, 1, 0, 1,
], 3));
terrainCell.setIndex([0, 2, 1, 1, 2, 3]);
const surfaceY = sampleTerrainMeshSurfaceHeight(terrainCell, 0, 0, 2, 2);
assert.equal(surfaceY, 4);
assert.equal(sampleTerrainMeshHeight(terrainCell, 0, 0, 2, 2), 2);
const terrainMesh = new THREE.Mesh(terrainCell, new THREE.MeshBasicMaterial());
const ray = new THREE.Raycaster(new THREE.Vector3(0, 10, 0), new THREE.Vector3(0, -1, 0));
assert.equal(ray.intersectObject(terrainMesh)[0]?.point.y, surfaceY);
assert.equal(resolveRoadAwareGroundY(surfaceY, 5), 5, 'bridge decks still lift agents');
assert.equal(resolveRoadAwareGroundY(surfaceY, 1), surfaceY, 'roads cannot sink actors under terrain');
terrainCell.dispose();
terrainMesh.material.dispose();
assert.match(
  read('src/app/appBootstrap.ts'),
  /new VillagerRenderer\(\{[\s\S]*?getHeightAt: \(x, z\) => sceneManager\.terrain\.getSurfaceHeightAt\(x, z\)/,
  'live villagers and hostile animals must use the rendered terrain surface',
);

assert.equal(livestockVisualHeadCount('cattle', 500), 500);
assert.equal(livestockVisualHeadCount('sheep', 1_024), 1_024);
assert.equal(livestockVisualHeadCount('swine', 0.99), 0);
assert.equal(
  displayedFishSchoolCount(481, RICH_FISH_SHOAL_MAX_YIELD),
  RICH_FISH_SHOAL_VISUAL_CAPACITY,
);
assert.ok(displayedFishSchoolCount(17.9, FISH_SHOAL_MAX_YIELD) < 17);

const extremeStrategicView = buildCrowdViewState(0, 0, 25_000);
assert.equal(isAgentAnimalRenderingEnabled(extremeStrategicView), true);
assert.equal(isWithinAnimalCrowdView(0, 0, extremeStrategicView), true);

for (const path of [
  'src/farming/LivestockVisuals.ts',
  'src/foraging/FishWildlifeVisuals.ts',
  'src/foraging/DeerWildlifeVisuals.ts',
  'src/settlement/AnimalCombatRenderer.ts',
  'src/settlement/OxenRenderer.ts',
  'src/residences/BackyardGardenMarkers.ts',
]) {
  const source = read(path);
  assert.match(
    source,
    /AuthoredAnimalInstanceBatch/,
    `${path} should submit exact authored rigs through the GPU palette batch`,
  );
  assert.doesNotMatch(
    source,
    /AGENT_ANIMAL_RENDER_MAX_ORBIT_DISTANCE|CapsuleGeometry|Impostor|SpriteMaterial/,
    `${path} must contain no distance LOD or proxy-agent implementation`,
  );
}

const fishSource = read('src/foraging/FishWildlifeVisuals.ts');
assert.match(fishSource, /while \(school\.fish\.length < visibleCount\) addFishToSchool\(school\)/);
assert.match(fishSource, /fishShoalVisualCapacity/);
assert.doesNotMatch(fishSource, /CLOSE_WORLD_MAX_CAMERA_DISTANCE/);

const livestockSource = read('src/farming/LivestockVisuals.ts');
assert.doesNotMatch(livestockSource, /VISUAL_HEAD_CAP_BY_SPECIES/);
assert.match(livestockSource, /batch\.beginFrame\(visible\.length\)/);

const gardenMesh = read('src/residences/backyardGardenMesh.ts');
const gardenMarkers = read('src/residences/BackyardGardenMarkers.ts');
for (const source of [gardenMesh, gardenMarkers]) {
  assert.doesNotMatch(source, /HenFallback|GoatFallback|PigFallback|fallbackAnimalCount/);
}

const adapter = read('src/scene/AuthoredAnimalInstanceBatch.ts');
assert.match(adapter, /setFromCloneAt\(slot, model\)/);
assert.doesNotMatch(adapter, /CapsuleGeometry|SphereGeometry|BoxGeometry|CylinderGeometry/);

const villagerRenderer = read('src/settlement/VillagerRenderer.ts');
assert.match(
  villagerRenderer,
  /getCombatAgentPosition[\s\S]*?combatAgentVisuals\.get\(id\)\?\.renderPosition/,
  'wildlife must expose its interpolated render position to map icons and report focus',
);
assert.match(
  villagerRenderer,
  /visual\.renderPosition\.x = visual\.displayX;[\s\S]*?visual\.renderPosition\.z = visual\.displayZ;/,
);

console.log('full-quality animal rendering contract passed (population-scaled exact GLBs, no visual LOD)');
