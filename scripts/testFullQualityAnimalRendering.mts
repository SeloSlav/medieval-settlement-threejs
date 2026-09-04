import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

console.log('full-quality animal rendering contract passed (population-scaled exact GLBs, no visual LOD)');
