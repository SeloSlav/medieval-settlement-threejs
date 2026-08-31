import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

import {
  BUILDING_DEFINITIONS,
  KENNEL_DOG_PURCHASE_GOLD,
  KENNEL_DOG_SLOTS,
} from '../src/generated/gameBalance.ts';
import { WORLD_DIFFICULTY_PRESETS } from '../src/world/worldDifficulty.ts';

const read = (path: string): string => readFileSync(path, 'utf8');

assert.equal(KENNEL_DOG_SLOTS, 4);
assert.equal(KENNEL_DOG_PURCHASE_GOLD, 18);
assert.equal(BUILDING_DEFINITIONS.stable.maxLabor, 1, 'stables require a rostered stable hand');
assert.equal(BUILDING_DEFINITIONS.stable.acceptsLabor, true);
assert.equal(BUILDING_DEFINITIONS.kennel.maxLabor, 1);
assert.equal(BUILDING_DEFINITIONS.kennel.acceptsLabor, true);

const kennelReducer = read('server/src/reducers/kennel_dogs.rs');
assert.match(kennelReducer, /assigned_labor == 0/);
assert.match(kennelReducer, /KENNEL_DOG_SLOTS/);
assert.match(kennelReducer, /faction: GUARD_DOG_FACTION/);
assert.match(kennelReducer, /spend_treasury_gold\(ctx, owner, KENNEL_DOG_PURCHASE_GOLD\)/);

const stableReducer = read('server/src/reducers/stable_oxen.rs');
assert.match(stableReducer, /stable\.assigned_labor == 0/);
assert.match(stableReducer, /Assign at least one stable hand/);

const wildlife = read('server/src/simulation/wild_animals.rs');
assert.match(wildlife, /const FOX: u8 = 13/);
assert.match(wildlife, /const WOLF: u8 = 14/);
assert.match(wildlife, /day_ticks \* 9/);
assert.match(wildlife, /day_ticks \* 14/);
assert.match(wildlife, /4 \+ \(pack_roll % 4\)/);
assert.match(wildlife, /nearest_hostile\(ctx, &dog, 52\.0\)/);
assert.match(wildlife, /wolf_pack_offset/);
assert.match(wildlife, /loot_progress >= 15\.0/);
assert.match(wildlife, /stable_ox\(\)\.id\(\)\.delete/);
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
assert.ok(existsSync('public/assets/ui/build-menu/cards/kennel.png'));

console.log('wild animal security tests passed (kennel, staffing, patrols, foxes, wolves, and world rule)');
