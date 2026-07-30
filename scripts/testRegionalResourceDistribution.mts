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
} from '../src/world/regionalResourceDistribution.ts';
import {
  DEFAULT_WORLD_GENERATION_SETTINGS,
  type WorldGenerationSettings,
  type WorldMapSize,
} from '../src/world/worldGenerationSettings.ts';

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
  balancedPlans.map((plan) => plan.ordinaryQuarryCount),
  [1, 2, 3],
  'ordinary stone deposits should scale with map size',
);
assert.deepEqual(
  balancedPlans.map((plan) => plan.ordinaryClayDepositCount),
  [1, 2, 3],
  'ordinary clay deposits should scale with map size',
);
assert.deepEqual(
  balancedPlans.map((plan) => plan.ordinaryMineralDepositCount),
  [2, 2, 3],
  'both iron and salt need finite physical deposits, with extra sites on large maps',
);
assert.ok(balancedPlans.every((plan) => plan.richStoneDepositCount >= 0));
assert.ok(balancedPlans.every((plan) => plan.richClayDepositCount >= 0));
assert.ok(balancedPlans.every((plan) => plan.richMineralDepositCount >= 0));
assert.deepEqual(
  balancedPlans.map((plan) => plan.totalForagingNodes),
  [8, 8, 8],
  'neutral settings should preserve the prior eight wild-resource sites',
);
assert.ok(
  balancedPlans.every((plan) =>
    plan.presentForagingKinds.length === 4
    && Object.values(plan.foragingNodeCounts).every((count) => count === 2)
  ),
  'neutral settings should preserve two sites in every legacy wild-resource family',
);
assert.ok(
  balancedPlans.every((plan) => plan.foragingNodeCounts.game >= 1),
  'every regional profile should retain a winter-available game habitat',
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
        assert.ok(
          survey.every((entry) =>
            entry.ordinary >= 1
            && entry.total === entry.ordinary + entry.rich
          ),
          `${mapSize}/${resourceAbundance}/${resourceVariety}/seed-${seed} must show at least one finite ordinary source for every material`,
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

  assert.equal(lean.presentForagingKinds.length, 2);
  assert.equal(plentiful.presentForagingKinds.length, 4);
  assert.ok(lean.totalForagingNodes <= balanced.totalForagingNodes);
  assert.ok(balanced.totalForagingNodes <= plentiful.totalForagingNodes);
  assert.ok(lean.ordinaryQuarryCount <= balanced.ordinaryQuarryCount);
  assert.ok(balanced.ordinaryQuarryCount <= plentiful.ordinaryQuarryCount);
  assert.ok(lean.ordinaryClayDepositCount <= balanced.ordinaryClayDepositCount);
  assert.ok(balanced.ordinaryClayDepositCount <= plentiful.ordinaryClayDepositCount);
  assert.ok(lean.richStoneDepositCount <= plentiful.richStoneDepositCount);
  assert.ok(lean.richClayDepositCount <= plentiful.richClayDepositCount);
  assert.ok(lean.richMineralDepositCount <= plentiful.richMineralDepositCount);
  assert.ok(
    lean.ordinaryMineralDepositCount <= balanced.ordinaryMineralDepositCount,
  );
  assert.ok(
    balanced.ordinaryMineralDepositCount <= plentiful.ordinaryMineralDepositCount,
  );
  assert.ok(lean.ordinaryQuarryCount >= 1);
  assert.ok(lean.ordinaryClayDepositCount >= 1);
  assert.ok(lean.ordinaryMineralDepositCount >= 2);
}

const richnessSamples = Array.from({ length: 256 }, (_, index) => index + 1)
  .flatMap((seed) => mapSizes.map((mapSize) =>
    createRegionalResourcePlan(settings({ seed, mapSize }))
  ));
assert.ok(
  richnessSamples.some((plan) => plan.richStoneDepositCount === 0)
    && richnessSamples.some((plan) => plan.richStoneDepositCount > 0),
  'stone richness must vary by seed',
);
assert.ok(
  richnessSamples.some((plan) => plan.richClayDepositCount === 0)
    && richnessSamples.some((plan) => plan.richClayDepositCount > 0),
  'clay richness must vary by seed',
);
assert.ok(
  richnessSamples.some((plan) => plan.richMineralDepositCount === 0)
    && richnessSamples.some((plan) => plan.richMineralDepositCount > 0),
  'iron/salt richness must vary by seed',
);

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
        assert.ok(
          stoneQuarries.some((node) => !node.isRich),
          `${variant} must retain an ordinary stone deposit`,
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
        assert.deepEqual(
          new Set(mineralDeposits.map((node) => node.resource)),
          new Set(['iron', 'salt']),
          `${variant} must expose physical iron and salt deposits`,
        );
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
        assert.ok(
          claySites.some((site) => site.kind === 'ordinary'),
          `${variant} must retain an ordinary clay deposit`,
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
