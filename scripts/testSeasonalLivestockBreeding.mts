import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  livestockBreedingPhaseForMonth,
  livestockMatingSeason,
  livestockPendingOffspring,
} from '../src/economy/livestockPolicy.ts';
import {
  BUILDING_DEFINITIONS,
  CALENDAR_SECONDS_PER_DAY,
  CATTLE_BREEDING_PER_CYCLE,
  CATTLE_MAX_HERD,
  CATTLE_STARTER_HERD,
  LIVESTOCK_SEASONAL_CONCEPTION_MULTIPLIER,
  SHEEP_BREEDING_PER_CYCLE,
  SHEEP_MAX_HERD,
  SHEEP_STARTER_HERD,
  SWINE_BREEDING_PER_CYCLE,
  SWINE_MAX_HERD,
  SWINE_STARTER_HERD,
} from '../src/generated/gameBalance.ts';

assert.equal(livestockMatingSeason('cattle'), 'summer');
assert.equal(livestockMatingSeason('sheep'), 'autumn');
assert.equal(livestockMatingSeason('swine'), 'autumn');
for (const species of ['cattle', 'sheep', 'swine'] as const) {
  assert.equal(livestockBreedingPhaseForMonth(species, 4), 'spring-births');
  assert.equal(livestockBreedingPhaseForMonth(species, 1), 'waiting');
}
assert.equal(livestockBreedingPhaseForMonth('cattle', 7), 'conception');
assert.equal(livestockBreedingPhaseForMonth('cattle', 10), 'waiting');
assert.equal(livestockBreedingPhaseForMonth('sheep', 7), 'waiting');
assert.equal(livestockBreedingPhaseForMonth('sheep', 10), 'conception');
assert.equal(livestockPendingOffspring(3.75), 3);

function headsAfterMatingAndFollowingSpring(
  startingHeads: number,
  maximumHeads: number,
  breedingPerCycle: number,
  cyclesPerDay: number,
): number {
  const matingDays = 90;
  const expectedOffspring = startingHeads
    * breedingPerCycle
    * cyclesPerDay
    * matingDays
    * LIVESTOCK_SEASONAL_CONCEPTION_MULTIPLIER;
  return startingHeads + Math.min(
    maximumHeads - startingHeads,
    Math.floor(expectedOffspring),
  );
}

const pastoralCyclesPerDay = CALENDAR_SECONDS_PER_DAY
  / BUILDING_DEFINITIONS.pastoral_farmstead.harvestInterval;
const swineCyclesPerDay = CALENDAR_SECONDS_PER_DAY
  / BUILDING_DEFINITIONS.swineherd.harvestInterval;
assert.deepEqual(
  [
    headsAfterMatingAndFollowingSpring(
      CATTLE_STARTER_HERD,
      CATTLE_MAX_HERD,
      CATTLE_BREEDING_PER_CYCLE,
      pastoralCyclesPerDay,
    ),
    headsAfterMatingAndFollowingSpring(
      SHEEP_STARTER_HERD,
      SHEEP_MAX_HERD,
      SHEEP_BREEDING_PER_CYCLE,
      pastoralCyclesPerDay,
    ),
    headsAfterMatingAndFollowingSpring(
      SWINE_STARTER_HERD,
      SWINE_MAX_HERD,
      SWINE_BREEDING_PER_CYCLE,
      swineCyclesPerDay,
    ),
  ],
  [8, 30, 22],
  'newborns must arrive the following spring without breeding in their birth year',
);
assert.equal(
  headsAfterMatingAndFollowingSpring(2, CATTLE_MAX_HERD, CATTLE_BREEDING_PER_CYCLE, pastoralCyclesPerDay),
  3,
  'a patient two-cattle breeding herd must grow without another purchase',
);
assert.equal(
  headsAfterMatingAndFollowingSpring(2, SHEEP_MAX_HERD, SHEEP_BREEDING_PER_CYCLE, pastoralCyclesPerDay),
  4,
  'a patient two-sheep breeding flock must grow without another purchase',
);

const policy = readFileSync('server/src/livestock_policy.rs', 'utf8');
const simulation = readFileSync('server/src/simulation/livestock.rs', 'utf8');
const reducer = readFileSync('server/src/reducers/livestock.rs', 'utf8');
const pastureInspector = readFileSync('src/resources/inspector/pastureRenderer.ts', 'utf8');
const backyardSimulation = readFileSync('server/src/simulation/backyard_garden.rs', 'utf8');

assert.match(
  policy,
  /\(SPECIES_CATTLE, Season::Summer\)[\s\S]{0,120}\(SPECIES_SHEEP, Season::Autumn\)/,
);
assert.match(policy, /season == Season::Spring[\s\S]{0,100}SpringBirths/);
assert.match(policy, /livestock_spring_births[\s\S]{0,500}breeding_limit\.saturating_sub\(head_count\)/);
assert.match(
  simulation,
  /LivestockBreedingPhase::SpringBirths[\s\S]{0,220}livestock_spring_births/,
);
assert.match(
  simulation,
  /LivestockBreedingPhase::Conception[\s\S]{0,260}support_ratio >= 0\.9[\s\S]{0,160}herd\.health >= 0\.72/,
);
assert.match(simulation, /retained_livestock_breeding_progress/);
assert.match(
  reducer,
  /previous_heads = herd\.head_count[\s\S]{0,220}retained_livestock_breeding_progress/,
  'selling animals must remove their proportional share of pending offspring',
);
assert.match(pastureInspector, /Cattle mate in summer/);
assert.match(pastureInspector, /Sheep mate in autumn/);
assert.match(pastureInspector, /confirmed offspring arrive in spring/);
assert.doesNotMatch(backyardSimulation, /livestock_breeding_phase|breeding_progress/);

console.log('seasonal pasture breeding contracts passed');
