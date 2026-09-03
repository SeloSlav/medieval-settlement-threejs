import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { BanditCampRenderer } from '../src/security/BanditCampRenderer.ts';
import { timberMaterial } from '../src/buildings/buildingMaterials.ts';
import { FOUNDERS_CAMPFIRE_NAME } from '../src/buildings/meshes/foundersCampMesh.ts';
import { fireEffectFromRoot } from '../src/fires/FireEffect.ts';
import {
  formatBanditGoodsSummary,
  parseBanditGoods,
  type BanditCampState,
} from '../src/security/banditState.ts';
import type { Terrain } from '../src/terrain/Terrain.ts';

const parent = new THREE.Group();
const terrain = { getHeightAt: () => 2.5 } as unknown as Terrain;
const renderer = new BanditCampRenderer(terrain, parent);
const physicalRoot = parent.getObjectByName('Physical bandit camps') as THREE.Group;
assert.ok(physicalRoot, 'bandit-camp renderer should attach its physical root');

const active = banditCamp({ active: true, health: 180, destroyedTick: 0 });
renderer.sync([active]);
assert.equal(physicalRoot.children.length, 1, 'an active camp should have one physical visual');
assert.equal(physicalRoot.children[0]!.position.y, 2.53, 'camp should follow terrain height');

const tents: THREE.Mesh[] = [];
physicalRoot.traverse((object) => {
  if (object instanceof THREE.Mesh && object.name === 'Weathered tent canvas shell') {
    tents.push(object);
  }
});
assert.equal(tents.length, 2, 'the active camp should retain both weathered canvas shelters');
for (const tent of tents) {
  const material = tent.material as THREE.MeshStandardMaterial;
  assert.ok(material.map, 'bandit tents must use the founders-camp woven canvas texture');
  assert.match(material.map.name, /founding canvas/i);
  assert.notEqual(tent.geometry.type, 'ConeGeometry', 'shelters must be the full open A-frame assembly');
  assert.ok(tent.parent!.getObjectByName('Open tent interior'));
  assert.ok(tent.parent!.getObjectByName('Taut tent guy rope'));
  assert.ok(tent.parent!.getObjectByName('Rolled wool blanket'));
}
const stumps: THREE.Mesh[] = [];
physicalRoot.traverse((object) => {
  if (object instanceof THREE.Mesh && object.name === 'Camp fireside stump seat') stumps.push(object);
});
assert.equal(stumps.length, 3, 'the red ember disc is replaced by founders log seats');
for (const stump of stumps) {
  assert.ok((stump.material as THREE.MeshStandardMaterial).map);
  assert.equal(stump.material, timberMaterial('dark'), 'stumps reuse the actual founders wood material');
}
renderer.tick(1 / 30);
const campfire = physicalRoot.getObjectByName(FOUNDERS_CAMPFIRE_NAME);
assert.ok(campfire instanceof THREE.Group, 'bandits share the complete founders campfire model');
assert.ok(campfire.getObjectByName('Founding campfire hearth stone'));
assert.ok(campfire.getObjectByName('Founding campfire crossed log'));
assert.ok(campfire.getObjectByName('Campfire cooking tripod'));
assert.ok(campfire.getObjectByName('Hanging camp cookpot'));
const fire = fireEffectFromRoot(campfire)!;
assert.ok(fire?.active, 'an active bandit camp is occupied by design');
assert.equal(fire.flames.length, 5);
assert.equal(fire.smoke.length, 7);
const elapsed = fire.elapsedSeconds;
const smokePosition = fire.smoke[0]!.sprite.position.clone();
renderer.tick(0.25);
assert.equal(fire.elapsedSeconds, elapsed + 0.25);
assert.ok(fire.smoke[0]!.sprite.position.distanceTo(smokePosition) > 0, 'bandit smoke must animate');
const daylightIntensity = fire.light.intensity;
renderer.setCampfireNightLighting(1);
renderer.tick(0);
assert.ok(fire.light.intensity > daylightIntensity, 'bandit firelight follows the night cycle');
renderer.sync([banditCamp({ stolenGoods: 0 })]);
assert.equal(physicalRoot.getObjectByName(FOUNDERS_CAMPFIRE_NAME), campfire);
assert.equal(fire.active, true, 'empty supplies do not extinguish an occupied outlaw camp');
assert.equal(renderer.standardDiagnostics()?.standards, 1);
assert.equal(renderer.standardDiagnostics()?.panels, 1);
assert.equal(renderer.standardDiagnostics()?.simulationNodes, 60);
const texturedTimber = physicalRoot.getObjectByName('Bandit textured perimeter stake') as THREE.Mesh;
assert.ok(texturedTimber, 'the camp should retain physical timber and prop meshes');
assert.ok(
  (texturedTimber.material as THREE.MeshStandardMaterial).map,
  'bandit timber should reuse the building wood texture map',
);

renderer.sync([banditCamp({ active: false, health: 0, destroyedTick: 42 })]);
assert.equal(
  physicalRoot.children.length,
  0,
  'an inactive destroyed camp must disappear instead of swapping to a ruin mesh',
);
assert.equal(renderer.standardDiagnostics()?.standards, 0, 'destroying a camp removes its flag and cloth state');
assert.equal(fireEffectFromRoot(campfire), null, 'destroying a camp disposes its fire effect');

renderer.sync([active]);
assert.equal(physicalRoot.children.length, 1, 'a later authoritative respawn should recreate the camp');
const respawnedFireRoot = physicalRoot.getObjectByName(FOUNDERS_CAMPFIRE_NAME) as THREE.Group;
assert.equal(fireEffectFromRoot(respawnedFireRoot)?.active, true);
assert.equal(fireEffectFromRoot(respawnedFireRoot)?.nightLighting, 1);
renderer.dispose();
assert.equal(fireEffectFromRoot(respawnedFireRoot), null);
assert.equal(parent.children.length, 0, 'dispose should remove the physical camp root');

const recoveredGoods = parseBanditGoods(JSON.stringify([
  { timber: 5, rye_grain: 2, gold: 1 },
  { timber: 3, rye_grain: 0, cloth: 4 },
]));
assert.deepEqual(recoveredGoods, [
  { kind: 'timber', amount: 8 },
  { kind: 'cloth', amount: 4 },
  { kind: 'rye_grain', amount: 2 },
  { kind: 'gold', amount: 1 },
]);
assert.equal(
  formatBanditGoodsSummary(recoveredGoods),
  '1 gold, 8 timber and 4 cloth, plus 1 more kind',
  'the lord report should identify recovered materials instead of showing only an opaque total',
);

const serverBandits = readFileSync('server/src/simulation/bandits.rs', 'utf8');
assert.match(serverBandits, /CAMP_CLEAR_GOLD_MIN: u32 = 8/);
assert.match(serverBandits, /CAMP_CLEAR_GOLD_MAX: u32 = 16/);
assert.match(
  serverBandits,
  /fn camp_clear_reward[\s\S]*spawned_tick[\s\S]*camp_clear_reward_from_entropy/,
  'camp loot should be deterministic from the camp spawn rather than rerolled on destruction',
);
assert.match(serverBandits, /reward\.apples[\s\S]*reward\.preserved_food[\s\S]*reward\.rye_bread/);
assert.match(serverBandits, /reward\.firewood[\s\S]*reward\.cloth[\s\S]*reward\.ammunition/);
const destroyCampSource = serverBandits.slice(
  serverBandits.indexOf('pub(super) fn destroy_camp'),
  serverBandits.indexOf('\nfn cleanup_downed'),
);
assert.match(destroyCampSource, /credit_remote_recovery_to_settlement\(ctx, camp\.owner, recovered\)/);
assert.match(
  destroyCampSource,
  /reward_bundles\.push\(camp_clear_reward\(camp\)\)/,
  'every cleared camp should add its own bounty and provisions to stolen inventory',
);
assert.doesNotMatch(
  destroyCampSource,
  /recover_stock_at/,
  'destroying a distant camp must not leave its reward at the camp coordinates',
);
const serverReclamation = readFileSync('server/src/simulation/reclamation.rs', 'utf8');
assert.match(
  serverReclamation,
  /pub fn credit_remote_recovery_to_settlement[\s\S]*physical_treasury_seat[\s\S]*deposit_building_commodity/,
  'remote recovery should fill usable storage and retain overflow at the civic treasury seat',
);
const app = readFileSync('src/app/App.ts', 'utf8');
assert.match(
  app,
  /Crown bounty, seized camp provisions, and any stolen goods recovered there/,
  'the lord report should explain the three sources of a camp-clear reward',
);

console.log('Bandit camps are textured, disappear when destroyed, and report recovered goods.');

function banditCamp(
  overrides: Partial<BanditCampState>,
): BanditCampState {
  return {
    id: 'bandit-camp-7',
    x: 12,
    z: -9,
    health: 180,
    maxHealth: 180,
    active: true,
    stolenGoods: 0,
    spawnedTick: 1,
    nextTheftTick: 10,
    lastTheftTick: 0,
    destroyedTick: 0,
    ...overrides,
  };
}
