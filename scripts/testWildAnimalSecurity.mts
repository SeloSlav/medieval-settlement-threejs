import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

import {
  BUILDING_DEFINITIONS,
  KENNEL_DOG_PURCHASE_GOLD,
  KENNEL_DOG_SLOTS,
  KENNEL_DOG_MAX_PER_HUNTERS_HALL,
  KENNEL_DOG_HUNTING_RATE_BONUS,
} from '../src/generated/gameBalance.ts';
import { WORLD_DIFFICULTY_PRESETS } from '../src/world/worldDifficulty.ts';

const read = (path: string): string => readFileSync(path, 'utf8');

assert.equal(KENNEL_DOG_SLOTS, 4);
assert.equal(KENNEL_DOG_PURCHASE_GOLD, 18);
assert.equal(KENNEL_DOG_MAX_PER_HUNTERS_HALL, 3);
assert.equal(KENNEL_DOG_HUNTING_RATE_BONUS, 0.2);
assert.equal(BUILDING_DEFINITIONS.stable.maxLabor, 1, 'stables require a rostered stable hand');
assert.equal(BUILDING_DEFINITIONS.stable.acceptsLabor, true);
assert.equal(BUILDING_DEFINITIONS.kennel.maxLabor, 1);
assert.equal(BUILDING_DEFINITIONS.kennel.acceptsLabor, true);

const kennelReducer = read('server/src/reducers/kennel_dogs.rs');
assert.match(kennelReducer, /assigned_labor == 0/);
assert.match(kennelReducer, /KENNEL_DOG_SLOTS/);
assert.match(kennelReducer, /faction: GUARD_DOG_FACTION/);
assert.match(kennelReducer, /spend_treasury_gold\(ctx, owner, KENNEL_DOG_PURCHASE_GOLD\)/);
assert.match(kennelReducer, /pub fn set_building_dogs/);
assert.match(kennelReducer, /building\.kind != "hunters_hall"/);
assert.match(kennelReducer, /assigned_dogs > KENNEL_DOG_MAX_PER_HUNTERS_HALL/);
assert.match(kennelReducer, /agent\.assigned_building_id == 0/);

const stableReducer = read('server/src/reducers/stable_oxen.rs');
assert.match(stableReducer, /stable\.assigned_labor == 0/);
assert.match(stableReducer, /Assign at least one stable hand/);

const buildingReducers = read('server/src/reducers/buildings.rs');
assert.match(buildingReducers, /building\.kind == "kennel"/);
assert.match(buildingReducers, /GUARD_DOG_FACTION[\s\S]{0,160}source_building_id == building_id/);
assert.match(buildingReducers, /combat_agent\(\)[\s\S]{0,120}assigned_building_id\(\)[\s\S]{0,220}dog\.assigned_building_id = 0/);

const foodSupplier = read('server/src/simulation/food_supplier.rs');
assert.match(foodSupplier, /assigned_building_id\(\)[\s\S]{0,420}KENNEL_DOG_HUNTING_RATE_BONUS/);
assert.match(foodSupplier, /wild_harvest_multiplier \* hunting_dog_multiplier/);

const wildlife = read('server/src/simulation/wild_animals.rs');
assert.match(wildlife, /const FOX: u8 = 13/);
assert.match(wildlife, /const WOLF: u8 = 14/);
assert.match(wildlife, /day_ticks \* 9/);
assert.match(wildlife, /day_ticks \* 14/);
assert.match(wildlife, /recurring_phase_crossed/);
assert.match(wildlife, /4 \+ \(pack_roll % 4\)/);
assert.match(wildlife, /nearest_hostile\(ctx, &dog, 52\.0\)/);
assert.match(wildlife, /wolf_pack_offset/);
assert.match(wildlife, /loot_progress >= 15\.0/);
assert.match(wildlife, /down_guard_dog\([\s\S]{0,360}source_building_id = 0/);
assert.match(wildlife, /dog\.assigned_building_id > 0/);
assert.match(wildlife, /dog\.assigned_building_id = 0/);
assert.match(wildlife, /kill_stable_ox\([\s\S]{0,700}trip\.ox_id = 0[\s\S]{0,240}stable_ox\(\)\.id\(\)\.delete/);
assert.match(wildlife, /head_count = herd\.head_count\.saturating_sub\(1\)/);
assert.match(wildlife, /clear_backyard_garden_for_residence/);
assert.match(wildlife, /withdraw_building_edible_food/);
assert.match(wildlife, /withdraw_residence_commodity/);

const military = read('server/src/simulation/military.rs');
assert.match(military, /RAIDER \| BANDIT \| FOX \| WOLF/);

const combatTypes = read('src/security/combatAgents.ts');
assert.match(combatTypes, /\| 'dog'[\s\S]{0,60}\| 'fox'[\s\S]{0,60}\| 'wolf'/);
assert.match(combatTypes, /value === 12[\s\S]{0,120}value === 13[\s\S]{0,120}value === 14/);
assert.match(combatTypes, /case 8: return 'stable-ox'/);
assert.match(combatTypes, /assignedBuildingId\?: string \| null/);

const harvestInspector = read('src/resources/inspector/harvestBuildingRenderer.ts');
assert.match(harvestInspector, /data-hunting-dog-team/);
assert.match(harvestInspector, /meat and pelt rate/);
const animalsHud = read('src/ui/SettlementHud.ts');
assert.match(animalsHud, /<strong>Guard dogs<\/strong>/);
assert.match(animalsHud, /Free patrol/);
assert.match(read('src/ui/settlementAnimals.ts'), /Wandering and protecting the settlement/);
assert.ok(existsSync('src/generated/set_building_dogs_reducer.ts'));

const renderer = read('src/settlement/AnimalCombatRenderer.ts');
for (const animal of ['husky', 'fox', 'wolf']) {
  assert.match(renderer, new RegExp(`quaternius-${animal}\\.gltf`));
  assert.ok(existsSync(`public/assets/models/wild-animals/quaternius-${animal}.gltf`));
}
assert.match(renderer, /status === 'fighting'\) return 'Attack'/);
assert.match(renderer, /status === 'looting'\) return 'Eating'/);
assert.match(read('src/settlement/VillagerRenderer.ts'), /route: this\.combatInspectionRoute\(visual\)/);

const easy = WORLD_DIFFICULTY_PRESETS.find((preset) => preset.id === 'easy')!;
const normal = WORLD_DIFFICULTY_PRESETS.find((preset) => preset.id === 'normal')!;
const hardcore = WORLD_DIFFICULTY_PRESETS.find((preset) => preset.id === 'hardcore')!;
assert.equal(easy.settings.wildAnimalAttacksEnabled, false);
assert.equal(normal.settings.wildAnimalAttacksEnabled, true);
assert.equal(hardcore.settings.wildAnimalAttacksEnabled, true);
assert.ok(existsSync('public/assets/ui/icons/world-setup/wild-animal-attacks-atlas.png'));
assert.ok(existsSync('public/assets/ui/build-menu/cards/kennel.webp'));

console.log('wild animal security tests passed (kennel, hunting assignments, patrols, foxes, wolves, and world rule)');
