import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import {
  BUILDING_COSTS,
  BUILDING_DEFINITIONS,
  BUILDING_STORAGE_CAPS,
} from '../src/generated/gameBalance.ts';
import {
  createWaysideShrineMesh,
  createWaysideShrinePlan,
} from '../src/buildings/meshes/waysideShrineMesh.ts';
import {
  BUILD_MENU_CATEGORIES,
  renderBuildMenuCards,
} from '../src/ui/buildMenuCards.ts';
import {
  BUILDING_KIND_TO_MENU_ACTION,
  MENU_ACTION_TO_BUILDING_KIND,
} from '../src/ui/buildMenuMapping.ts';

const definition = BUILDING_DEFINITIONS.wayside_shrine;
assert.deepEqual(BUILDING_COSTS.wayside_shrine, {
  timber: 4,
  stone: 8,
  ironwork: 1,
});
assert.equal(definition.acceptsLabor, false);
assert.equal(definition.maxLabor, 0);
assert.equal(definition.workRadius, 0);
assert.equal(definition.harvestInterval, 0);
assert.equal(definition.regrowRatePerSecond, 0);
assert.equal(definition.requiresRoad, true);
assert.equal(definition.facesRoad, true);
assert.ok(
  Object.values(BUILDING_STORAGE_CAPS.wayside_shrine).every((capacity) => capacity === 0),
  'decorative shrine must not store resources',
);

assert.equal(BUILDING_KIND_TO_MENU_ACTION.wayside_shrine, 'wayside-shrine');
assert.equal(MENU_ACTION_TO_BUILDING_KIND['wayside-shrine'], 'wayside_shrine');
const decorationEntries = BUILD_MENU_CATEGORIES.find((category) => category.id === 'decorations')?.entries ?? [];
assert.ok(decorationEntries.some((entry) => entry.artKey === 'wayside_shrine'), 'wayside shrine must appear in Decorations');

const cards = renderBuildMenuCards(decorationEntries);
assert.match(cards, /data-action="wayside-shrine"/);
assert.match(cards, /data-src="\/assets\/ui\/build-menu\/cards\/wayside-shrine\.webp"/);
assert.match(cards, />Wayside shrine</);
assert.match(cards, /Marks the roadside with a small place of prayer and devotion/);
assert.match(cards, /Wayside shrine\.[^>]*Cost: 4 timber, 8 stone, 1 ironwork/);
assert.doesNotMatch(cards, /data-hotkey=/);
assert.ok(fs.existsSync('public/assets/ui/build-menu/cards/wayside-shrine.webp'));

const plan = createWaysideShrinePlan();
assert.equal(plan.seed, 1733);
assert.equal(plan.diagnostics.hiddenFacadeModules, 0);
assert.equal(plan.diagnostics.overlappingModules, 0);
assert.ok(plan.modules.some((module) => module.id === 'marian-devotional-niche'));
assert.ok(plan.modules.some((module) => module.id === 'forged-iron-ridge-cross'));

const finalMesh = createWaysideShrineMesh();
const meshNames: string[] = [];
let meshCount = 0;
finalMesh.traverse((object) => {
  if (!(object instanceof THREE.Mesh)) return;
  meshCount += 1;
  meshNames.push(object.name);
  const materials = Array.isArray(object.material) ? object.material : [object.material];
  for (const material of materials) {
    assert.equal(
      material.userData.sharedBuildingMaterial,
      true,
      `${object.name} must use a shared building material`,
    );
  }
});
assert.ok(meshCount >= 20, 'final shrine should retain authored close-view detail');
assert.ok(meshNames.some((name) => name.includes('Marian icon')));
assert.ok(meshNames.some((name) => name.includes('forged-iron cross')));
assert.ok(meshNames.some((name) => name.includes('split-shingle roof')));
assert.ok(finalMesh.userData.architectureDiagnostics.triangleCount > 0);

const bounds = new THREE.Box3().setFromObject(finalMesh);
const size = bounds.getSize(new THREE.Vector3());
assert.ok(size.x > 2 && size.x < 3, `unexpected shrine width ${size.x}`);
assert.ok(size.z > 1.5 && size.z < 3, `unexpected shrine depth ${size.z}`);
assert.ok(size.y > 5 && size.y < 6, `unexpected shrine height ${size.y}`);

const massingMesh = createWaysideShrineMesh('massing');
const massingNames: string[] = [];
massingMesh.traverse((object) => massingNames.push(object.name));
assert.equal(massingNames.some((name) => name.includes('Marian icon')), false);
assert.ok(massingNames.some((name) => name.includes('split-shingle roof')));

const inspectorSource = fs.readFileSync(
  'src/resources/inspector/waysideShrineRenderer.ts',
  'utf8',
);
assert.match(inspectorSource, /Decoration only/);
assert.match(inspectorSource, /Settlement effect<\/span><span>None/);
assert.match(inspectorSource, /labor: hiddenLabor\(\)/);

console.log('Wayside shrine tests passed.');
