import assert from 'node:assert/strict';
import { createWorldLayout } from '../src/resources/WorldLayout.ts';
import { WorldLayoutRegistry } from '../src/resources/WorldLayoutRegistry.ts';
import {
  CLAY_BANK_RICH_YIELD_THRESHOLD,
  clayBankYieldAt,
  setActiveClayDepositLayout,
} from '../src/economy/clayBankPolicy.ts';
import {
  createRegionalDepositSurvey,
  createRegionalResourcePlan,
  type RegionalResourcePlan,
} from '../src/world/regionalResourceDistribution.ts';
import {
  DEFAULT_WORLD_GENERATION_SETTINGS,
  type WorldGenerationSettings,
  type WorldMapSize,
} from '../src/world/worldGenerationSettings.ts';
import { applyTerrainPreset } from '../src/world/worldTerrainPresets.ts';

const mapSizes: WorldMapSize[] = ['small', 'medium', 'large'];
const balancedPlans = mapSizes.map((mapSize) => createRegionalResourcePlan(settings({ mapSize })));
const representativeClayBank = { x: 4.252, z: -131.811 };

assert.ok(
  clayBankYieldAt(representativeClayBank.x, representativeClayBank.z, 0)
    < clayBankYieldAt(representativeClayBank.x, representativeClayBank.z, 50),
);
assert.ok(
  clayBankYieldAt(representativeClayBank.x, representativeClayBank.z, 50)
    < clayBankYieldAt(representativeClayBank.x, representativeClayBank.z, 100),
  'the world abundance choice must affect the same physical clay bank',
);

assert.deepEqual(
  balancedPlans.map((plan) => plan.totalResourceNodes),
  [5, 20, 40],
  'map sizes must own exact 1x/4x/8x resource-node budgets',
);
assert.deepEqual(
  balancedPlans.map((plan) => plan.richResourceNodeCount),
  [2, 8, 16],
  'rich-node budgets must scale with the same area multipliers',
);
assert.deepEqual(
  balancedPlans.map((plan) => plan.minimumFoodNodeCount),
  [1, 4, 8],
  'each size must reserve the requested game, berry, or mushroom floor',
);
assert.ok(
  balancedPlans.every((plan) => plan.foragingNodeCounts.game >= 1),
  'every regional profile should retain a winter-available game habitat',
);
for (const plan of balancedPlans) {
  assertPlanBudgets(plan);
}

const delniceSettings = applyTerrainPreset(settings({
  resourceAbundance: 100,
  resourceVariety: 100,
}), 'delnice_meadow');
const delnicePlan = createRegionalResourcePlan(delniceSettings);
assert.ok(delnicePlan.foragingNodeCounts.fish >= 1);
assert.ok(delnicePlan.presentForagingKinds.includes('fish'));
assert.ok(
  Object.values(delnicePlan.foragingNodeCounts)
    .reduce((sum, count) => sum + count, 0) === delnicePlan.totalForagingNodes,
  'Delnice should include its pond fishery inside the regional forage budget',
);

for (const mapSize of mapSizes) {
  for (const resourceAbundance of [0, 50, 100]) {
    for (const resourceVariety of [0, 50, 100]) {
      for (const seed of [1, 7, 31]) {
        const worldSettings = settings({
          seed,
          mapSize,
          resourceAbundance,
          resourceVariety,
        });
        const survey = createRegionalDepositSurvey(worldSettings);
        assert.deepEqual(
          survey.map((entry) => entry.resource),
          ['stone', 'clay', 'iron', 'salt'],
          'the planning survey must always expose the four physical deposit families',
        );
        assert.ok(survey.every((entry) => entry.total === entry.ordinary + entry.rich));
        assert.equal(
          survey.reduce((sum, entry) => sum + entry.total, 0)
            + createRegionalResourcePlan(worldSettings).totalForagingNodes,
          createRegionalResourcePlan(worldSettings).totalResourceNodes,
          `${mapSize}/${resourceAbundance}/${resourceVariety}/seed-${seed} survey must account for the complete roll`,
        );
      }
    }
  }
}

for (const mapSize of mapSizes) {
  const lean = createRegionalResourcePlan(settings({
    mapSize,
    resourceAbundance: 0,
    resourceVariety: 0,
  }));
  const balanced = createRegionalResourcePlan(settings({ mapSize }));
  const plentiful = createRegionalResourcePlan(settings({
    mapSize,
    resourceAbundance: 100,
    resourceVariety: 100,
  }));

  assert.ok(lean.presentForagingKinds.length <= plentiful.presentForagingKinds.length);
  assert.equal(lean.totalResourceNodes, balanced.totalResourceNodes);
  assert.equal(balanced.totalResourceNodes, plentiful.totalResourceNodes);
  assert.equal(lean.richResourceNodeCount, balanced.richResourceNodeCount);
  assert.equal(balanced.richResourceNodeCount, plentiful.richResourceNodeCount);
  assertPlanBudgets(lean);
  assertPlanBudgets(balanced);
  assertPlanBudgets(plentiful);
}

const richnessSamples = Array.from({ length: 256 }, (_, index) => index + 1)
  .flatMap((seed) => mapSizes.map((mapSize) =>
    createRegionalResourcePlan(settings({ seed, mapSize }))
  ));
assert.ok(
  new Set(richnessSamples.map((plan) => [
    plan.richStoneDepositCount,
    plan.richClayDepositCount,
    plan.richMineralDepositCount,
    ...Object.values(plan.foragingRichNodeCounts),
  ].join('/'))).size > 3,
  'seeds must vary which geological and wild-food families receive the fixed rich rolls',
);

for (const mapSize of mapSizes) {
  const foodRolls = Array.from({ length: 512 }, (_, index) =>
    createRegionalResourcePlan(settings({
      seed: index + 1,
      mapSize,
      resourceAbundance: 50,
      resourceVariety: 100,
    }))
  );
  const namedFoodCounts = foodRolls.map((plan) =>
    plan.foragingNodeCounts.game
      + plan.foragingNodeCounts.berries
      + plan.foragingNodeCounts.mushrooms
  );
  assert.ok(
    namedFoodCounts.every((count) => count >= foodRolls[0].minimumFoodNodeCount),
    `${mapSize} rolls must always retain their named wild-food floor`,
  );
  assert.ok(
    new Set(namedFoodCounts).size > 1,
    `${mapSize} food counts should vary above their minimum instead of being fixed to it`,
  );
  assert.ok(
    namedFoodCounts.some((count) => count > foodRolls[0].minimumFoodNodeCount),
    `${mapSize} must be able to roll more than its minimum food count`,
  );
}

for (const kind of ['game', 'berries', 'mushrooms', 'fish'] as const) {
  assert.ok(
    Array.from({ length: 512 }, (_, index) => createRegionalResourcePlan(settings({
      seed: index + 1,
      mapSize: 'large',
      resourceAbundance: 100,
      resourceVariety: 100,
    }))).some((plan) => plan.foragingRichNodeCounts[kind] > 0),
    `${kind} nodes must be eligible for rich rolls`,
  );
}

for (const mapSize of mapSizes) {
  for (const resourceAbundance of [0, 50, 100]) {
    for (const resourceVariety of [0, 50, 100]) {
      for (const seed of [1, 7, 31]) {
        const layout = createWorldLayout(settings({
          seed,
          mapSize,
          resourceAbundance,
          resourceVariety,
        }));
        const nodes = WorldLayoutRegistry.fromWorldLayout(layout).definitionList;
        const stoneQuarries = nodes.filter((node) =>
          node.kind === 'quarry' && node.resource === 'stone'
        );
        const mineralDeposits = nodes.filter((node) =>
          node.kind === 'quarry'
          && (node.resource === 'iron' || node.resource === 'salt')
        );
        const claySites = layout.clayDepositLayout.sites;
        const variant = `${mapSize}/${resourceAbundance}/${resourceVariety}/seed-${seed}`;
        const actualTotalNodes = nodes.length + claySites.length;
        const actualRichNodes = nodes.filter((node) => node.isRich === true).length
          + claySites.filter((site) => site.kind === 'rich').length;
        const actualGuaranteedFoodNodes = nodes.filter((node) =>
          node.kind === 'game' || node.kind === 'berries' || node.kind === 'mushrooms'
        ).length;

        assert.equal(
          actualTotalNodes,
          layout.resourcePlan.totalResourceNodes,
          `${variant} did not place its exact resource-node budget`,
        );
        assert.equal(
          actualRichNodes,
          layout.resourcePlan.richResourceNodeCount,
          `${variant} did not place its exact rich-node budget`,
        );
        assert.ok(
          actualGuaranteedFoodNodes >= layout.resourcePlan.minimumFoodNodeCount,
          `${variant} missed its game, berry, or mushroom floor`,
        );

        assert.equal(
          stoneQuarries.filter((node) => node.isRich).length,
          layout.resourcePlan.richStoneDepositCount,
          `${variant} did not honor its rich-stone roll`,
        );
        assert.equal(
          stoneQuarries.length,
          layout.resourcePlan.ordinaryQuarryCount
            + layout.resourcePlan.richStoneDepositCount,
          `${variant} missed a stone quarry site`,
        );
        assert.equal(
          mineralDeposits.length,
          layout.resourcePlan.richMineralDepositCount
            + layout.resourcePlan.ordinaryMineralDepositCount,
          `${variant} missed an iron or salt deposit`,
        );
        assert.equal(
          mineralDeposits.filter((node) => node.isRich).length,
          layout.resourcePlan.richMineralDepositCount,
          `${variant} missed a rich iron or salt deposit`,
        );
        if (mineralDeposits.length >= 2) {
          assert.deepEqual(
            new Set(mineralDeposits.map((node) => node.resource)),
            new Set(['iron', 'salt']),
            `${variant} must expose both mineral families when it has two mineral slots`,
          );
        }
        assert.equal(
          claySites.length,
          layout.resourcePlan.ordinaryClayDepositCount
            + layout.resourcePlan.richClayDepositCount,
          `${variant} missed a clay deposit`,
        );
        assert.equal(
          claySites.filter((site) => site.kind === 'rich').length,
          layout.resourcePlan.richClayDepositCount,
          `${variant} did not honor its rich-clay roll`,
        );
        setActiveClayDepositLayout(layout.clayDepositLayout);
        for (const claySite of claySites) {
          assert.equal(
            layout.riverLayout.isWaterAt(claySite.x, claySite.z),
            false,
            `${variant} put a clay deposit in open water`,
          );
          assert.ok(
            hasWaterWithin(layout, claySite.x, claySite.z, 24),
            `${variant} put a clay deposit away from its riverbank`,
          );
          if (claySite.kind === 'rich') {
            assert.ok(
              clayBankYieldAt(claySite.x, claySite.z, resourceAbundance)
                >= CLAY_BANK_RICH_YIELD_THRESHOLD,
              `${variant} rich clay deposit did not receive rich output`,
            );
          }
        }
        for (const kind of ['game', 'berries', 'mushrooms', 'fish'] as const) {
          assert.equal(
            nodes.filter((node) => node.kind === kind).length,
            layout.resourcePlan.foragingNodeCounts[kind],
            `${variant} missed ${kind} sites`,
          );
          assert.equal(
            nodes.filter((node) => node.kind === kind && node.isRich === true).length,
            layout.resourcePlan.foragingRichNodeCounts[kind],
            `${variant} did not honor its rich-${kind} roll`,
          );
        }
      }
    }
  }
}
setActiveClayDepositLayout(null);

console.log('regional resource distribution tests passed');

function settings(
  overrides: Partial<WorldGenerationSettings>,
): WorldGenerationSettings {
  return {
    ...DEFAULT_WORLD_GENERATION_SETTINGS,
    ...overrides,
  };
}

function assertPlanBudgets(plan: RegionalResourcePlan): void {
  const geologicalNodes = plan.ordinaryQuarryCount
    + plan.richStoneDepositCount
    + plan.ordinaryClayDepositCount
    + plan.richClayDepositCount
    + plan.ordinaryMineralDepositCount
    + plan.richMineralDepositCount;
  const richForagingNodes = Object.values(plan.foragingRichNodeCounts)
    .reduce((sum, count) => sum + count, 0);
  const guaranteedFoodNodes = plan.foragingNodeCounts.game
    + plan.foragingNodeCounts.berries
    + plan.foragingNodeCounts.mushrooms;
  assert.equal(geologicalNodes + plan.totalForagingNodes, plan.totalResourceNodes);
  assert.equal(
    plan.richStoneDepositCount
      + plan.richClayDepositCount
      + plan.richMineralDepositCount
      + richForagingNodes,
    plan.richResourceNodeCount,
  );
  assert.ok(guaranteedFoodNodes >= plan.minimumFoodNodeCount);
  for (const kind of ['game', 'berries', 'mushrooms', 'fish'] as const) {
    assert.ok(plan.foragingRichNodeCounts[kind] <= plan.foragingNodeCounts[kind]);
  }
}

function hasWaterWithin(
  layout: ReturnType<typeof createWorldLayout>,
  x: number,
  z: number,
  radius: number,
): boolean {
  for (let ring = 2; ring <= radius; ring += 2) {
    for (let index = 0; index < 24; index++) {
      const angle = index / 24 * Math.PI * 2;
      if (layout.riverLayout.isWaterAt(
        x + Math.cos(angle) * ring,
        z + Math.sin(angle) * ring,
      )) {
        return true;
      }
    }
  }
  return false;
}
