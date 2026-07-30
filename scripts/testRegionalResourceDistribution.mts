import assert from 'node:assert/strict';
import { createWorldLayout } from '../src/resources/WorldLayout.ts';
import { WorldLayoutRegistry } from '../src/resources/WorldLayoutRegistry.ts';
import { clayBankYieldAt } from '../src/economy/clayBankPolicy.ts';
import { createRegionalResourcePlan } from '../src/world/regionalResourceDistribution.ts';
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
  balancedPlans.map((plan) => plan.ordinaryQuarryCount + 1),
  [3, 3, 3],
  'neutral settings should preserve the prior three-site stone layout',
);
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
        const quarries = nodes.filter((node) => node.kind === 'quarry');
        const variant = `${mapSize}/${resourceAbundance}/${resourceVariety}/seed-${seed}`;

        assert.equal(
          quarries.filter((node) => node.isRich).length,
          1,
          `${variant} must have one rich mine`,
        );
        assert.equal(
          quarries.length,
          layout.resourcePlan.ordinaryQuarryCount + 1,
          `${variant} missed a quarry site`,
        );
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

console.log('regional resource distribution tests passed');

function settings(
  overrides: Partial<WorldGenerationSettings>,
): WorldGenerationSettings {
  return {
    ...DEFAULT_WORLD_GENERATION_SETTINGS,
    ...overrides,
  };
}
