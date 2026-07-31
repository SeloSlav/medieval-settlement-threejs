import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import * as THREE from 'three';
import { createBuildingMesh } from '../src/buildings/BuildingMeshes.ts';
import {
  bulkStockpileVisualSignature,
  syncBulkStockpileVisuals,
} from '../src/buildings/bulkStockpileVisuals.ts';
import { clayDepositNodeId } from '../src/clay/ClayDepositLayout.ts';
import type { DeliveryTripState } from '../src/logistics/deliveryTrips.ts';
import {
  createMineralDepositRoster,
  mineralDepositLabel,
  mineralDepositMaxYield,
  mineralDepositNodeId,
} from '../src/minerals/MineralDepositLayout.ts';
import { createMineralDepositSystem } from '../src/minerals/MineralDepositSystem.ts';
import {
  BUILDING_STORAGE_CAPS,
  LARGE_QUARRY_TIMBER_SUPPORT_PER_CYCLE,
  MINE_IRON_PER_CYCLE,
  MINE_SALT_PER_CYCLE,
  MINE_TIMBER_SUPPORT_BUFFER_CYCLES,
  MINE_TIMBER_SUPPORT_PER_CYCLE,
  RICH_MINE_THROUGHPUT_MULTIPLIER,
} from '../src/generated/gameBalance.ts';
import {
  LARGE_QUARRY_SUPPORT_TARGET,
} from '../src/economy/largeQuarrySupportPolicy.ts';
import {
  RICH_MINE_SUPPORT_TARGET,
  richMineSupportRunwayCycles,
  richMineSupportsReady,
} from '../src/economy/mineSupportPolicy.ts';
import {
  IRON_ICON_HTML,
  SALT_ICON_HTML,
} from '../src/map/resourceMapIconArt.ts';
import {
  describeGeologicalMapMarker,
  geologicalNodeForMapMarker,
  LOW_GEOLOGICAL_RESERVE_SHARE,
} from '../src/map/geologicalMapMarkerState.ts';
import { buildLayoutWorldMapMarkers } from '../src/map/worldMapMarkers.ts';
import { renderMineralMineInspector } from '../src/resources/inspector/mineralMineRenderer.ts';
import { renderLargeQuarryInspector } from '../src/resources/inspector/largeQuarryRenderer.ts';
import { renderStoneQuarryInspector } from '../src/resources/inspector/stoneQuarryRenderer.ts';
import type { InspectorRenderContext } from '../src/resources/inspector/renderInspectableTarget.ts';
import {
  computePopulationStats,
  computeResourceTotals,
} from '../src/resources/resourceTotals.ts';
import { findNearestResourceNodeWithRemaining } from '../src/resources/depletableNodes.ts';
import { createWorldLayout } from '../src/resources/WorldLayout.ts';
import { WorldLayoutRegistry } from '../src/resources/WorldLayoutRegistry.ts';
import { getBuildingDefinition } from '../src/resources/buildings.ts';
import {
  createEmptyStockpile,
  type BuildingState,
  type GameState,
  type ResourceNodeState,
} from '../src/resources/types.ts';
import type { WorldQueries } from '../src/resources/WorldQueries.ts';
import { createRegionalResourcePlan } from '../src/world/regionalResourceDistribution.ts';
import {
  DEFAULT_WORLD_GENERATION_SETTINGS,
  deriveSubSeed,
  resolveWorldDimensions,
  type WorldGenerationSettings,
  type WorldMapSize,
} from '../src/world/worldGenerationSettings.ts';
import { computeWorldBootstrapDataFromLayout } from '../src/world/worldBootstrapData.ts';

const mapSizes: WorldMapSize[] = ['small', 'medium', 'large'];
for (const mapSize of mapSizes) {
  for (const seed of [1, 7, 31]) {
    const settings = worldSettings({ mapSize, seed });
    const layout = createWorldLayout(settings);
    const expectedRich = layout.resourcePlan.richMineralDepositCount;
    const expectedTotal = expectedRich + layout.resourcePlan.ordinaryMineralDepositCount;
    const dims = resolveWorldDimensions(mapSize);

    assert.equal(
      layout.mineralDepositLayout.sites.length,
      expectedTotal,
      `${mapSize}/seed-${seed} must place its full underground-resource budget`,
    );
    assert.equal(
      layout.mineralDepositLayout.sites.filter((site) => site.grade === 'rich').length,
      expectedRich,
      `${mapSize}/seed-${seed} must preserve its seeded rich-deposit count`,
    );
    assert.deepEqual(
      new Set(layout.mineralDepositLayout.sites.map((site) => site.resource)),
      new Set(['iron', 'salt']),
      `${mapSize}/seed-${seed} must expose physical deposits of both materials`,
    );
    for (const site of layout.mineralDepositLayout.sites) {
      assert.ok(site.resource === 'iron' || site.resource === 'salt');
      assert.equal(
        layout.riverLayout.isWaterAt(site.x, site.z),
        false,
        `${mineralDepositLabel(site)} cannot spawn in open water`,
      );
      assert.ok(Math.abs(site.x) < dims.playableHalf);
      assert.ok(Math.abs(site.z) < dims.playableHalf);
    }
  }
}

const mineralVisualLayout = createWorldLayout(DEFAULT_WORLD_GENERATION_SETTINGS);
const mineralVisualSystem = createMineralDepositSystem(
  { getHeightAt: () => 0 } as Parameters<typeof createMineralDepositSystem>[0],
  mineralVisualLayout.mineralDepositLayout,
);
for (const resource of ['iron', 'salt'] as const) {
  const outcrops: THREE.Mesh[] = [];
  mineralVisualSystem.group.traverse((object) => {
    if (object instanceof THREE.Mesh && object.name.startsWith(`${resource} outcrop`)) {
      outcrops.push(object);
    }
  });
  assert.ok(
    outcrops.length >= 10,
    `${resource} deposits must include a readable cluster of close-range 3D outcrops`,
  );
  assert.ok(
    outcrops.every(
      (outcrop) => outcrop.position.y > 0 && outcrop.castShadow && outcrop.receiveShadow,
    ),
    `${resource} outcrops must rise above the terrain and receive and cast scene shadows`,
  );
  assert.ok(
    outcrops.every((outcrop) => {
      const material = outcrop.material as THREE.MeshStandardMaterial;
      return material.map instanceof THREE.DataTexture
        && material.normalMap instanceof THREE.DataTexture
        && material.roughnessMap instanceof THREE.DataTexture
        && material.map.magFilter === THREE.LinearFilter
        && material.map.minFilter === THREE.LinearMipmapLinearFilter
        && material.map.generateMipmaps
        && material.normalMap.magFilter === THREE.LinearFilter
        && material.normalMap.minFilter === THREE.LinearMipmapLinearFilter
        && material.normalMap.generateMipmaps
        && material.roughnessMap.magFilter === THREE.LinearFilter
        && material.roughnessMap.minFilter === THREE.LinearMipmapLinearFilter
        && material.roughnessMap.generateMipmaps
        && material.roughness >= 0.9
        && material.metalness <= 0.07
        && material.userData.weatheredMineralSurface?.static === true;
    }),
    `${resource} outcrops must use static weathered albedo, normal, and roughness breakup`,
  );
  assert.equal(
    new Set(outcrops.map((outcrop) => (outcrop.material as THREE.MeshStandardMaterial).map)).size,
    1,
    `${resource} outcrops must share one bounded weathering texture rather than allocate per stone`,
  );
  assert.ok(
    outcrops.every((outcrop) => {
      outcrop.geometry.computeBoundingBox();
      const bottom = outcrop.geometry.boundingBox?.min.y ?? 0;
      return outcrop.position.y + bottom * outcrop.scale.y <= 0.08
        && outcrop.userData.mineralSurface?.grounded === true;
    }),
    `${resource} outcrops must bury their broadened base into the terrain instead of floating`,
  );
}
const mineralOutcrops: THREE.Mesh[] = [];
mineralVisualSystem.group.traverse((object) => {
  if (object instanceof THREE.Mesh && object.name.includes('outcrop')) mineralOutcrops.push(object);
});
assert.equal(
  new Set(mineralOutcrops.map((outcrop) => outcrop.geometry)).size,
  3,
  'all mineral sites must reuse exactly three bounded irregular geometry variants',
);
assert.ok(
  mineralOutcrops.every(
    (outcrop) => (outcrop.geometry.getAttribute('position')?.count ?? 0) > 100
      && outcrop.geometry.getAttribute('uv') !== undefined,
  ),
  'weathered outcrops need enough static silhouette breakup and UVs for their surface maps',
);
mineralVisualSystem.dispose();

// The setup panel promises physical ordinary deposits, not merely a regional
// budget. Exercise the dry/wet and lean/plentiful extremes because competing
// river, quarry, clay-bank, forage, and mineral clearances are where a
// deterministic placement fallback is most likely to silently drop a node.
const extremePlacementFailures: string[] = [];
let extremeWorldCount = 0;
for (const mapSize of mapSizes) {
  for (const hydrology of [0, 100]) {
    for (const resourceAbundance of [0, 100]) {
      for (const resourceVariety of [0, 100]) {
        for (let seed = 1; seed <= 16; seed++) {
          const settings = worldSettings({
            mapSize,
            seed,
            hydrology,
            resourceAbundance,
            resourceVariety,
          });
          const layout = createWorldLayout(settings);
          const stoneSites = layout.quarryLayout.sites;
          const claySites = layout.clayDepositLayout.sites;
          const mineralSites = layout.mineralDepositLayout.sites;
          const expectedStone =
            layout.resourcePlan.ordinaryQuarryCount
            + layout.resourcePlan.richStoneDepositCount;
          const expectedClay =
            layout.resourcePlan.ordinaryClayDepositCount
            + layout.resourcePlan.richClayDepositCount;
          const expectedMinerals =
            layout.resourcePlan.ordinaryMineralDepositCount
            + layout.resourcePlan.richMineralDepositCount;
          const ordinaryStone = stoneSites.filter((site) => site.kind === 'small').length;
          const richStone = stoneSites.filter((site) => site.kind === 'large').length;
          const ordinaryClay = claySites.filter((site) => site.kind === 'ordinary').length;
          const richClay = claySites.filter((site) => site.kind === 'rich').length;
          const ordinaryMinerals = mineralSites.filter(
            (site) => site.grade === 'ordinary',
          ).length;
          const richMinerals = mineralSites.filter((site) => site.grade === 'rich').length;
          const ironSites = mineralSites.filter((site) => site.resource === 'iron').length;
          const saltSites = mineralSites.filter((site) => site.resource === 'salt').length;

          extremeWorldCount++;
          if (
            stoneSites.length !== expectedStone
            || claySites.length !== expectedClay
            || mineralSites.length !== expectedMinerals
            || ordinaryStone !== layout.resourcePlan.ordinaryQuarryCount
            || richStone !== layout.resourcePlan.richStoneDepositCount
            || ordinaryClay !== layout.resourcePlan.ordinaryClayDepositCount
            || richClay !== layout.resourcePlan.richClayDepositCount
            || ordinaryMinerals !== layout.resourcePlan.ordinaryMineralDepositCount
            || richMinerals !== layout.resourcePlan.richMineralDepositCount
            || ironSites === 0
            || saltSites === 0
          ) {
            extremePlacementFailures.push(JSON.stringify({
              mapSize,
              seed,
              hydrology,
              resourceAbundance,
              resourceVariety,
              expected: {
                stone: expectedStone,
                clay: expectedClay,
                minerals: expectedMinerals,
                ordinaryStone: layout.resourcePlan.ordinaryQuarryCount,
                richStone: layout.resourcePlan.richStoneDepositCount,
                ordinaryClay: layout.resourcePlan.ordinaryClayDepositCount,
                richClay: layout.resourcePlan.richClayDepositCount,
                ordinaryMinerals: layout.resourcePlan.ordinaryMineralDepositCount,
                richMinerals: layout.resourcePlan.richMineralDepositCount,
              },
              actual: {
                stone: stoneSites.length,
                clay: claySites.length,
                minerals: mineralSites.length,
                ordinaryStone,
                richStone,
                ordinaryClay,
                richClay,
                ordinaryMinerals,
                richMinerals,
                iron: ironSites,
                salt: saltSites,
              },
            }));
          }
        }
      }
    }
  }
}
assert.deepEqual(
  extremePlacementFailures,
  [],
  `every setup must place its complete physical deposit budget; checked ${
    extremeWorldCount
  } extreme worlds, first failures:\n${extremePlacementFailures.slice(0, 8).join('\n')}`,
);

const nonDefaultLayout = createWorldLayout(worldSettings({
  seed: 13,
  mapSize: 'small',
  hydrology: 100,
  resourceAbundance: 100,
  resourceVariety: 0,
}));
const nonDefaultRegistry = WorldLayoutRegistry.fromWorldLayout(nonDefaultLayout);
const nonDefaultBootstrap = computeWorldBootstrapDataFromLayout(nonDefaultLayout);
const expectedQuarryIds = nonDefaultRegistry.definitionList
  .filter((definition) => definition.kind === 'quarry')
  .map((definition) => definition.id);
const expectedClayIds = nonDefaultLayout.clayDepositLayout.sites
  .map((site, index) => clayDepositNodeId(site, index));
assert.deepEqual(
  nonDefaultBootstrap.quarries.map((quarry) => quarry.quarryId),
  expectedQuarryIds,
  'an arbitrary setup must send every stone, iron, and salt node to bootstrap_quarries',
);
assert.deepEqual(
  nonDefaultBootstrap.foragingNodes
    .filter((node) => node.nodeKind === 'clay')
    .map((node) => node.nodeId),
  expectedClayIds,
  'an arbitrary setup must send every clay node to bootstrap_foraging',
);
assert.deepEqual(
  new Set(
    nonDefaultBootstrap.quarries
      .filter((quarry) => quarry.quarryId.startsWith('deposit-'))
      .map((quarry) => quarry.quarryId.split('-')[1]),
  ),
  new Set(['iron', 'salt']),
  'authoritative bootstrap payloads must retain both physical mineral families',
);

let sawIron = false;
let sawSalt = false;
let sawLargeWithBoth = false;
let sawRichMineral = false;
const largeRichCounts = new Set<number>();
for (let seed = 1; seed <= 256; seed++) {
  const settings = worldSettings({
    seed,
    mapSize: 'large',
    resourceAbundance: 50,
    resourceVariety: 50,
  });
  const plan = createRegionalResourcePlan(settings);
  const roster = createMineralDepositRoster({
    seed: deriveSubSeed(seed, 'iron-salt-deposits'),
    mapSize: settings.mapSize,
    richSiteCount: plan.richMineralDepositCount,
    ordinarySiteCount: plan.ordinaryMineralDepositCount,
    resourceVariety: settings.resourceVariety,
  });
  const resources = new Set(roster.map((site) => site.resource));
  sawIron ||= resources.has('iron');
  sawSalt ||= resources.has('salt');
  sawLargeWithBoth ||= resources.size === 2;
  sawRichMineral ||= roster.some((site) => site.grade === 'rich');
  largeRichCounts.add(roster.filter((site) => site.grade === 'rich').length);
}
assert.ok(sawIron && sawSalt, 'different seeds must support either raw resource');
assert.ok(sawLargeWithBoth, 'every region should physically support both iron and salt');
assert.ok(sawRichMineral && largeRichCounts.size > 1, 'large-map rich mineral counts must vary by seed');

const defaultLayout = createWorldLayout(DEFAULT_WORLD_GENERATION_SETTINGS);
const registry = WorldLayoutRegistry.fromWorldLayout(defaultLayout);
const mineralDefinitions = registry.definitionList.filter(
  (definition) =>
    definition.kind === 'quarry'
    && (definition.resource === 'iron' || definition.resource === 'salt'),
);
assert.equal(
  mineralDefinitions.length,
  defaultLayout.mineralDepositLayout.sites.length,
);
for (let index = 0; index < defaultLayout.mineralDepositLayout.sites.length; index++) {
  const site = defaultLayout.mineralDepositLayout.sites[index];
  const definition = mineralDefinitions.find(
    (candidate) => candidate.id === mineralDepositNodeId(site, index),
  );
  assert.ok(definition, `missing registry row for ${mineralDepositLabel(site)}`);
  assert.equal(definition.label, mineralDepositLabel(site));
  assert.equal(definition.maxYield, mineralDepositMaxYield(site));
  assert.equal(definition.isRich, site.grade === 'rich');
}

const markers = buildLayoutWorldMapMarkers(
  registry,
  defaultLayout.clayDepositLayout.sites,
);
assert.equal(
  markers.filter((marker) => marker.resource === 'iron' || marker.resource === 'salt').length,
  mineralDefinitions.length,
  'iron and salt deposits must reach the far-zoom resource map',
);
assert.ok(IRON_ICON_HTML.includes('map-resource-icon-glyph--iron'));
assert.ok(SALT_ICON_HTML.includes('map-resource-icon-glyph--salt'));

const ordinaryIronMarker = markers.find(
  (marker) => marker.resource === 'iron' && marker.label === 'Iron deposit',
);
assert.ok(ordinaryIronMarker, 'the default seed must expose an ordinary iron marker');
const ordinaryIronNode = mineralNode(
  ordinaryIronMarker.id,
  'iron',
  ordinaryIronMarker.x,
  ordinaryIronMarker.z,
  60,
  300,
  false,
);
const geologicalNodes = new Map([[ordinaryIronNode.nodeId, ordinaryIronNode]]);
assert.equal(
  geologicalNodeForMapMarker(ordinaryIronMarker, geologicalNodes),
  ordinaryIronNode,
  'projected and minimap quarry markers must resolve from the geological node table',
);
assert.equal(
  geologicalNodeForMapMarker(
    { id: ordinaryIronMarker.id, kind: 'game' },
    geologicalNodes,
  ),
  undefined,
  'wild-resource markers must not masquerade as geological nodes',
);
assert.equal(LOW_GEOLOGICAL_RESERVE_SHARE, 0.2);
assert.deepEqual(
  describeGeologicalMapMarker(ordinaryIronMarker, ordinaryIronNode),
  {
    label: 'Iron deposit · 60 / 300 finite iron remaining',
    level: 'low',
  },
);
assert.equal(
  describeGeologicalMapMarker(
    ordinaryIronMarker,
    { ...ordinaryIronNode, remaining: 61 },
  ).level,
  'stable',
  'the low-reserve badge must begin only at the final fifth of a finite seam',
);
assert.equal(
  describeGeologicalMapMarker(
    ordinaryIronMarker,
    { ...ordinaryIronNode, remaining: 0 },
  ).level,
  'depleted',
);
assert.deepEqual(
  describeGeologicalMapMarker(
    { label: 'Rich salt deposit' },
    mineralNode('rich-salt', 'salt', 0, 0, 1_080, 1_080, true),
  ),
  {
    label: 'Rich salt deposit · rich deep salt source · does not deplete',
    level: 'deep',
  },
);
assert.deepEqual(
  describeGeologicalMapMarker(
    { label: 'Rich stone deposit' },
    {
      ...ordinaryIronNode,
      nodeId: 'rich-stone',
      resource: 'stone',
      remaining: 120,
      maxYield: 600,
      isRich: true,
    },
  ),
  {
    label: 'Rich stone deposit · 120 / 600 surface stone remaining · supports a non-depleting Large Quarry',
    level: 'deep',
  },
  'rich stone must distinguish its finite visible outcrop from its deep quarry source',
);
assert.deepEqual(
  describeGeologicalMapMarker(
    { label: 'Rich clay deposit' },
    {
      ...ordinaryIronNode,
      nodeId: 'rich-clay',
      resource: 'clay',
      remaining: 720,
      maxYield: 720,
      isRich: true,
    },
  ),
  {
    label: 'Rich clay deposit · rich deep clay source · does not deplete',
    level: 'deep',
  },
);
const geologicalMarkerProfileStarted = performance.now();
for (let index = 0; index < 100_000; index++) {
  describeGeologicalMapMarker(
    ordinaryIronMarker,
    {
      ...ordinaryIronNode,
      remaining: index % 301,
    },
  );
}
const geologicalMarkerProfileMs =
  performance.now() - geologicalMarkerProfileStarted;
assert.ok(
  geologicalMarkerProfileMs < 250,
  `100k live geological marker projections took ${geologicalMarkerProfileMs.toFixed(1)} ms`,
);

const generated = JSON.parse(
  readFileSync('server/generated/world_quarries.json', 'utf8'),
) as {
  quarries: Array<{
    quarryId: string;
    maxYield: number;
    isRich: boolean;
  }>;
};
const generatedMinerals = generated.quarries.filter(
  (quarry) => quarry.quarryId.startsWith('deposit-'),
);
assert.deepEqual(
  generatedMinerals.map((quarry) => quarry.quarryId),
  mineralDefinitions.map((definition) => definition.id),
  'generated authority rows must use the same deterministic deposit IDs as the client',
);
assert.ok(
  generatedMinerals.every((quarry) =>
    quarry.quarryId.startsWith('deposit-iron-')
    || quarry.quarryId.startsWith('deposit-salt-')
  ),
);

const mine = getBuildingDefinition('mine');
assert.equal(mine.acceptsLabor, true);
assert.equal(mine.requiresRoad, true);
assert.equal(mine.maxLabor, 4);
assert.equal(BUILDING_STORAGE_CAPS.mine.iron, 240);
assert.equal(BUILDING_STORAGE_CAPS.mine.salt, 240);
assert.equal(BUILDING_STORAGE_CAPS.mine.ironwork, 3);
assert.equal(BUILDING_STORAGE_CAPS.mine.timber, 12);
assert.ok(MINE_IRON_PER_CYCLE > 0);
assert.ok(MINE_SALT_PER_CYCLE > MINE_IRON_PER_CYCLE);
assert.equal(MINE_TIMBER_SUPPORT_PER_CYCLE, 0.5);
assert.equal(MINE_TIMBER_SUPPORT_BUFFER_CYCLES, 3);
assert.equal(RICH_MINE_SUPPORT_TARGET, 1.5);
assert.equal(richMineSupportRunwayCycles(1.5), 3);
assert.equal(richMineSupportsReady(0.49), false);
assert.equal(richMineSupportsReady(0.5), true);
assert.ok(RICH_MINE_THROUGHPUT_MULTIPLIER > 1);

const mineMesh = createBuildingMesh('mine');
assert.equal(mineMesh.name, 'Mineral Mine');
assert.ok(mineMesh.getObjectByName('Mineral mine sorting floor'));
const ironStockpile = mineMesh.getObjectByName('IronMineStockpile');
const saltStockpile = mineMesh.getObjectByName('SaltMineStockpile');
const toolStockpile = mineMesh.getObjectByName('CivilianToolStockpile');
const supportStockpile = mineMesh.getObjectByName('MineSupportStockpile');
assert.ok(ironStockpile, 'the mine needs a physical iron stockpile');
assert.ok(saltStockpile, 'the mine needs a physical salt stockpile');
assert.ok(toolStockpile, 'the mine needs a physical replacement-tool rack');
assert.ok(supportStockpile, 'the mine needs a physical prepared shaft-timber pile');
assert.equal(
  ironStockpile.children.filter((child) => child.name === 'IronMineOreSegment').length,
  6,
  'iron inventory must visibly rise and fall in discrete ore piles',
);
assert.equal(
  saltStockpile.children.filter((child) => child.name === 'SaltMineSaltSegment').length,
  6,
  'salt inventory must visibly rise and fall in discrete rock-salt piles',
);
assert.equal(
  supportStockpile.children.filter(
    (child) => child.name === 'MineSupportTimberSegment',
  ).length,
  4,
  'deep-mine support runway must visibly rise and fall in four beam bundles',
);
const emptySupportSignature = bulkStockpileVisualSignature(
  mineBuilding({ timber: 0 }),
);
const oneCycleSupportSignature = bulkStockpileVisualSignature(
  mineBuilding({ timber: MINE_TIMBER_SUPPORT_PER_CYCLE }),
);
assert.notEqual(
  emptySupportSignature,
  oneCycleSupportSignature,
  'mine presentation must refresh as support timber is delivered or consumed',
);
syncBulkStockpileVisuals(
  mineMesh,
  mineBuilding({ timber: MINE_TIMBER_SUPPORT_PER_CYCLE }),
);
assert.equal(
  supportStockpile.children.filter((child) => child.visible).length,
  1,
  'one support batch should make one prepared-beam bundle visible',
);
syncBulkStockpileVisuals(
  mineMesh,
  mineBuilding({ timber: RICH_MINE_SUPPORT_TARGET }),
);
assert.equal(
  supportStockpile.children.filter((child) => child.visible).length,
  3,
  'the requested three-cycle support buffer must show three discrete beam bundles',
);
mineMesh.traverse((object) => {
  if (object instanceof THREE.Mesh) object.geometry.dispose();
});

const authority = readFileSync(
  'server/src/simulation/expanded_economy.rs',
  'utf8',
);
const mineStart = authority.indexOf('pub fn step_mine');
const mineEnd = authority.indexOf('pub fn step_granary', mineStart);
assert.ok(mineStart >= 0 && mineEnd > mineStart);
const mineStep = authority.slice(mineStart, mineEnd);
assert.match(mineStep, /deposit-iron-/);
assert.match(mineStep, /deposit-salt-/);
assert.match(mineStep, /RICH_MINE_THROUGHPUT_MULTIPLIER/);
assert.match(
  mineStep,
  /deposit\.is_rich[\s\S]*request_connected_commodity[\s\S]*CommodityKind::Timber[\s\S]*lumber_mill[\s\S]*village_storehouse[\s\S]*rich_mine_support_target/,
  'rich mines must physically request support timber from connected timber stores',
);
assert.match(
  mineStep,
  /deposit\.is_rich && !rich_mine_supports_ready\(building\.timber\)[\s\S]*return;/,
  'rich extraction must stop safely before advancing without a complete timber crib batch',
);
assert.match(
  mineStep,
  /produced > 1e-6 && deposit\.is_rich[\s\S]*CommodityKind::Timber[\s\S]*MINE_TIMBER_SUPPORT_PER_CYCLE/,
  'support timber must wear only after a completed deep extraction batch',
);
assert.match(mineStep, /civilian_tool_throughput_multiplier\(building\.ironwork\)/);
assert.match(
  mineStep,
  /tools_maintained && produced > 1e-6[\s\S]*CommodityKind::Ironwork[\s\S]*CIVILIAN_TOOL_IRONWORK_PER_CYCLE/,
  'mine tools must wear only after a completed physical extraction batch',
);
assert.match(
  mineStep,
  /if produced > 1e-6 && !deposit\.is_rich[\s\S]*remaining:/,
  'ordinary deposits must deplete while rich deposits remain a deep source',
);
assert.match(
  authority,
  /pub fn step_local_material_dispatch[\s\S]*try_start_building_supply_trip[\s\S]*commodity/,
  'local extracted materials must move through physical building supply trips',
);
assert.match(
  authority,
  /\("mine", CommodityKind::Iron\)[\s\S]*smithy[\s\S]*marketplace[\s\S]*\("mine", CommodityKind::Salt\)[\s\S]*smokehouse[\s\S]*pastoral_farmstead[\s\S]*marketplace/,
  'mines must physically dispatch their extracted commodity to matching processors',
);

const ordinaryIronDeposit = mineralNode(
  'deposit-iron-ordinary-inspector',
  'iron',
  0,
  0,
  75,
  300,
  false,
);
const inspectorMine = mineBuilding({ assignedLabor: 2, iron: 12 });
let inspectorState = inspectorGameState(inspectorMine, [ordinaryIronDeposit]);
let mineInspector = renderMineralMineInspector(
  buildingTarget(inspectorMine),
  inspectorContext(inspectorState),
);
assert.equal(mineInspector.eyebrow, 'Ordinary iron mine');
assert.match(mineInspector.statusText, /Extracting finite iron seam - 75 reserve remains/);
assert.match(mineInspector.detailsHtml, /Ordinary iron-bearing ore seam - finite/);
assert.match(mineInspector.detailsHtml, /75 \/ 300 iron-bearing ore/);
assert.match(mineInspector.detailsHtml, /Mine carts serve road-linked smithies/);
assert.match(mineInspector.detailsHtml, /Baseline hand tools/);
assert.match(mineInspector.detailsHtml, /smithy handcart restores a 3-cycle buffer/);

const richSaltDeposit = mineralNode(
  'deposit-salt-rich-inspector',
  'salt',
  0,
  0,
  0,
  1_080,
  true,
);
inspectorState = inspectorGameState(inspectorMine, [richSaltDeposit]);
mineInspector = renderMineralMineInspector(
  buildingTarget(inspectorMine),
  inspectorContext(inspectorState),
);
assert.equal(mineInspector.eyebrow, 'Rich salt mine');
assert.match(mineInspector.statusText, /awaits timber supports/);
assert.match(mineInspector.detailsHtml, /0.0 onsite \/ 1.5 timber target/);
const recalledUnsupportedMine = {
  ...inspectorMine,
  id: 'mine-recalled-without-supports',
  assignedLabor: 0,
};
mineInspector = renderMineralMineInspector(
  buildingTarget(recalledUnsupportedMine),
  inspectorContext(inspectorGameState(recalledUnsupportedMine, [richSaltDeposit])),
);
assert.match(
  mineInspector.statusText,
  /awaits timber supports/,
  'missing deep-shaft supports must remain visible after the labor steward releases miners',
);
const recalledHeldMine = {
  ...recalledUnsupportedMine,
  id: 'mine-recalled-at-target',
  processorOutputTargetPercent: 25,
  salt: 60,
};
mineInspector = renderMineralMineInspector(
  buildingTarget(recalledHeldMine),
  inspectorContext(inspectorGameState(recalledHeldMine, [richSaltDeposit])),
);
assert.match(mineInspector.statusText, /salt yard target reached/);
assert.equal(mineInspector.statusState, 'idle');
assert.match(mineInspector.detailsHtml, /Production interval<\/span><span>paused/);
const inboundSupportTrip: DeliveryTripState = {
  id: 'support-inbound',
  buildingId: 'lumber-mill',
  residenceId: null,
  destinationKind: 'building',
  targetBuildingId: inspectorMine.id,
  cargoKind: 'timber',
  amount: MINE_TIMBER_SUPPORT_PER_CYCLE,
  phase: 'outbound',
  x: 0,
  z: 0,
  progress: 0,
  speedMps: 1,
  unloadSeconds: 1,
  unloadRemaining: 1,
  deliveryWorkers: 1,
  freeHaulerWorkers: 0,
  pathDistance: 1,
  travelSpeedMultiplier: 1,
  routePolylineJson: '[]',
};
mineInspector = renderMineralMineInspector(
  buildingTarget(inspectorMine),
  inspectorContext(inspectorState, inboundSupportTrip),
);
assert.match(mineInspector.statusText, /timber supports are approaching/);
assert.equal(mineInspector.statusState, 'idle');
const supportedInspectorMine = {
  ...inspectorMine,
  timber: RICH_MINE_SUPPORT_TARGET,
};
inspectorState = inspectorGameState(supportedInspectorMine, [richSaltDeposit]);
mineInspector = renderMineralMineInspector(
  buildingTarget(supportedInspectorMine),
  inspectorContext(inspectorState),
);
assert.match(mineInspector.statusText, /Extracting rich deep salt - source does not deplete/);
assert.match(mineInspector.detailsHtml, /50% faster deep working/);
assert.match(mineInspector.detailsHtml, /3.0 cycles/);
assert.match(mineInspector.detailsHtml, /0.5 timber per completed deep batch/);

const exhaustedIron = { ...ordinaryIronDeposit, remaining: 0 };
inspectorState = inspectorGameState(inspectorMine, [exhaustedIron]);
mineInspector = renderMineralMineInspector(
  buildingTarget(inspectorMine),
  inspectorContext(inspectorState),
);
assert.equal(mineInspector.statusState, 'warning');
assert.match(mineInspector.statusText, /Exhausted - finite iron seam is spent/);
assert.match(mineInspector.detailsHtml, /Production interval<\/span><span>paused/);

const richSaltNearQuarry = {
  ...richSaltDeposit,
  x: 100,
  nodeId: 'deposit-salt-rich-near-large-quarry',
};
const largeQuarryBuilding = mineBuilding({
  id: 'large-quarry-inspector',
  kind: 'large_quarry',
  x: 100,
  assignedLabor: 2,
});
const largeQuarryState = inspectorGameState(
  largeQuarryBuilding,
  [richSaltNearQuarry],
);
const largeQuarryInspector = renderLargeQuarryInspector(
  buildingTarget(largeQuarryBuilding),
  inspectorContext(largeQuarryState),
);
assert.match(
  largeQuarryInspector.statusText,
  /no rich underground source beneath the shaft/,
  'a rich mineral deposit must not masquerade as a rich stone source in the inspector',
);
const richStoneAtQuarry: ResourceNodeState = {
  ...richSaltNearQuarry,
  nodeId: 'quarry-rich-stone-inspector',
  resource: 'stone',
};
const unsupportedLargeQuarryState = inspectorGameState(
  largeQuarryBuilding,
  [richStoneAtQuarry],
);
let supportedLargeQuarryInspector = renderLargeQuarryInspector(
  buildingTarget(largeQuarryBuilding),
  inspectorContext(unsupportedLargeQuarryState),
);
assert.match(
  supportedLargeQuarryInspector.statusText,
  /await prepared timber supports/,
);
assert.match(
  supportedLargeQuarryInspector.detailsHtml,
  /0.00 onsite \/ 1.50 timber target/,
);
const quarrySupportTrip: DeliveryTripState = {
  ...inboundSupportTrip,
  id: 'quarry-support-inbound',
  targetBuildingId: largeQuarryBuilding.id,
  amount: LARGE_QUARRY_TIMBER_SUPPORT_PER_CYCLE,
};
supportedLargeQuarryInspector = renderLargeQuarryInspector(
  buildingTarget(largeQuarryBuilding),
  inspectorContext(unsupportedLargeQuarryState, quarrySupportTrip),
);
assert.match(
  supportedLargeQuarryInspector.statusText,
  /prepared chamber supports are approaching/,
);
const supportedLargeQuarryBuilding = {
  ...largeQuarryBuilding,
  timber: LARGE_QUARRY_SUPPORT_TARGET,
};
supportedLargeQuarryInspector = renderLargeQuarryInspector(
  buildingTarget(supportedLargeQuarryBuilding),
  inspectorContext(
    inspectorGameState(supportedLargeQuarryBuilding, [richStoneAtQuarry]),
  ),
);
assert.match(
  supportedLargeQuarryInspector.statusText,
  /Extracting from the non-depleting underground source/,
);
assert.match(
  supportedLargeQuarryInspector.detailsHtml,
  /0.25 timber per completed stone batch/,
);
const recalledUnsupportedLargeQuarry = {
  ...largeQuarryBuilding,
  id: 'large-quarry-recalled-without-supports',
  assignedLabor: 0,
};
supportedLargeQuarryInspector = renderLargeQuarryInspector(
  buildingTarget(recalledUnsupportedLargeQuarry),
  inspectorContext(
    inspectorGameState(recalledUnsupportedLargeQuarry, [richStoneAtQuarry]),
  ),
);
assert.match(
  supportedLargeQuarryInspector.statusText,
  /await prepared timber supports/,
);
const recalledHeldLargeQuarry = {
  ...recalledUnsupportedLargeQuarry,
  id: 'large-quarry-recalled-at-target',
  processorOutputTargetPercent: 25,
  stone: 90,
};
supportedLargeQuarryInspector = renderLargeQuarryInspector(
  buildingTarget(recalledHeldLargeQuarry),
  inspectorContext(
    inspectorGameState(recalledHeldLargeQuarry, [richStoneAtQuarry]),
  ),
);
assert.match(supportedLargeQuarryInspector.statusText, /stone yard target reached/);
assert.equal(supportedLargeQuarryInspector.statusState, 'idle');
assert.match(
  supportedLargeQuarryInspector.detailsHtml,
  /Production interval<\/span><span>paused/,
);

const surfaceStone: ResourceNodeState = {
  ...richStoneAtQuarry,
  nodeId: 'quarry-ordinary-stone-inspector',
  x: 0,
  z: 0,
  remaining: 100,
  maxYield: 100,
  isRich: false,
};
const recalledHeldStoneCamp = mineBuilding({
  id: 'stone-camp-recalled-at-target',
  kind: 'stone_quarry',
  assignedLabor: 0,
  workRadius: 40,
  processorOutputTargetPercent: 25,
  stone: 45,
});
let stoneCampInspector = renderStoneQuarryInspector(
  buildingTarget(recalledHeldStoneCamp),
  inspectorContext(inspectorGameState(recalledHeldStoneCamp, [surfaceStone])),
);
assert.match(stoneCampInspector.statusText, /stone yard target reached/);
assert.equal(stoneCampInspector.statusState, 'idle');
assert.match(stoneCampInspector.detailsHtml, /Harvest interval<\/span><span>paused/);
const recalledSourceLessStoneCamp = {
  ...recalledHeldStoneCamp,
  id: 'stone-camp-recalled-without-source',
  processorOutputTargetPercent: 100,
  stone: 0,
};
stoneCampInspector = renderStoneQuarryInspector(
  buildingTarget(recalledSourceLessStoneCamp),
  inspectorContext(inspectorGameState(recalledSourceLessStoneCamp, [])),
);
assert.match(stoneCampInspector.statusText, /no unexhausted surface stone in range/);
assert.equal(stoneCampInspector.statusState, 'warning');

const nearbySalt = mineralNode('deposit-salt-nearby', 'salt', 0, 0, 90, 90, false);
const fartherStone: ResourceNodeState = {
  ...nearbySalt,
  nodeId: 'quarry-stone-farther',
  resource: 'stone',
  x: 12,
};
assert.equal(
  findNearestResourceNodeWithRemaining(
    [nearbySalt, fartherStone],
    0,
    0,
    20,
    'quarry',
    'stone',
  )?.nodeId,
  fartherStone.nodeId,
  'stone queries must ignore a closer mineral landmark',
);

const sync = readFileSync(
  'src/data/spacetimeTableSync/syncQuarries.ts',
  'utf8',
);
assert.match(sync, /deposit-iron-/);
assert.match(sync, /deposit-salt-/);

const uiSurfaces = [
  'index.html',
  'src/ui/WorldSetupPanel.ts',
  'src/ui/SettlementHud.ts',
  'src/ui/buildMenuCards.ts',
  'src/resources/inspector/quarryRenderer.ts',
  'src/resources/inspector/mineralMineRenderer.ts',
].map((path) => readFileSync(path, 'utf8')).join('\n');
const buildingInspectorSource = readFileSync(
  'src/resources/inspector/buildingRenderer.ts',
  'utf8',
);
const quarryMapIconSource = readFileSync(
  'src/map/QuarryMapIcons.ts',
  'utf8',
);
const minimapSource = readFileSync(
  'src/map/TerrainMinimapOverlay.ts',
  'utf8',
);
const worldMapUiSource = readFileSync(
  'src/app/worldMapIcons.ts',
  'utf8',
);
assert.match(
  quarryMapIconSource,
  /getGeologicalNodes[\s\S]*describeGeologicalMapMarker[\s\S]*reserveLevel/,
  'stone, iron, and salt projected icons must refresh from live geological rows',
);
assert.match(
  minimapSource,
  /geologicalNodeForMapMarker\([\s\S]*state\.quarries[\s\S]*describeGeologicalMapMarker/,
  'the minimap must resolve quarry and clay markers from geological rows rather than the foraging table',
);
assert.match(
  worldMapUiSource,
  /getGeologicalNodes:\s*\(\)\s*=>\s*getGameState\(\)\.quarries/,
  'the projected quarry layer must receive the authoritative live deposit map',
);
assert.match(
  buildingInspectorSource,
  /case 'mine':[\s\S]*renderMineralMineInspector/,
  'mine selection must route through the deposit-aware inspector',
);
assert.doesNotMatch(
  uiSurfaces,
  /Gorski[\s-]?Kotar/i,
  'the background reference region must not be surfaced in player-facing UI',
);
assert.match(
  uiSurfaces,
  /iron or salt deposit/i,
  'player-facing UI must explain that both mineral resources have real deposits',
);
assert.match(
  uiSurfaces,
  /Stone, clay, iron, and salt are all physical local deposits/,
  'world setup must state the four guaranteed physical deposit families directly',
);
assert.match(
  uiSurfaces,
  /Rich stone and clay roll independently; iron and salt share up to one rich-mineral opportunity on small or medium maps and two on large maps/,
  'world setup must explain the shared regional rich-mineral budget',
);
assert.match(
  uiSurfaces,
  /This seed's physical deposits/,
  'world setup must present the seed result as physical geology rather than a trade forecast',
);
assert.match(
  uiSurfaces,
  /No rich roll/,
  'world setup must distinguish an absent rich grade from an absent local deposit',
);
for (const resource of ['stone', 'clay', 'iron', 'salt']) {
  assert.match(
    uiSurfaces,
    new RegExp(`data-resource=["']${resource}["']`),
    `world setup must give ${resource} its own readable survey card`,
  );
}
assert.match(
  uiSurfaces,
  /trade supplements physical geology rather than replacing it/,
  'Adriatic salt guidance must not imply that trade replaces local deposits',
);
assert.match(
  uiSurfaces,
  /Every region has finite physical iron seams/,
  'the HUD must teach the guaranteed physical iron source',
);
assert.match(
  uiSurfaces,
  /Every region has finite physical salt deposits/,
  'the HUD must teach the guaranteed physical salt source',
);
assert.match(
  uiSurfaces,
  /Rich deep workings are faster and inexhaustible, but consume road-hauled shaft supports/,
  'the mine card must expose the recurring forestry and road-logistics cost of rich deposits',
);
assert.doesNotMatch(
  uiSurfaces,
  /Some regions have local deposits; others must import/,
  'legacy import-only mineral guidance must not return',
);
assert.match(
  uiSurfaces,
  /\/assets\/ui\/build-menu\/cards\/iron-mine\.webp/,
  'the mine card must use its distinct generated artwork',
);

console.log(
  `iron and salt deposit system tests passed (${geologicalMarkerProfileMs.toFixed(1)} ms / 100k marker reads)`,
);

function worldSettings(
  overrides: Partial<WorldGenerationSettings>,
): WorldGenerationSettings {
  return {
    ...DEFAULT_WORLD_GENERATION_SETTINGS,
    ...overrides,
  };
}

function mineBuilding(
  overrides: Partial<BuildingState> = {},
): BuildingState {
  return {
    id: 'mine-inspector',
    kind: 'mine',
    x: 0,
    z: 0,
    workRadius: 0,
    actionCooldown: 0,
    timber: 0,
    firewood: 0,
    stone: 0,
    water: 0,
    food: 0,
    grain: 0,
    flour: 0,
    ale: 0,
    preservedFood: 0,
    honey: 0,
    wine: 0,
    wool: 0,
    flax: 0,
    cloth: 0,
    ironwork: 0,
    polearms: 0,
    iron: 0,
    clay: 0,
    salt: 0,
    charcoal: 0,
    pottery: 0,
    gold: 0,
    waterCapacity: 0,
    assignedLabor: 0,
    constructionComplete: true,
    constructionProgress: 1,
    constructionRequiredTimber: 0,
    constructionRequiredStone: 0,
    constructionDeliveredTimber: 0,
    constructionDeliveredStone: 0,
    constructionReservedTimber: 0,
    constructionReservedStone: 0,
    constructionTreasuryTimber: 0,
    constructionTreasuryStone: 0,
    storehouseAcceptsTimber: false,
    storehouseAcceptsStone: false,
    storehouseAcceptsFirewood: false,
    constructionPriority: 2,
    ...overrides,
  };
}

function mineralNode(
  nodeId: string,
  resource: 'iron' | 'salt',
  x: number,
  z: number,
  remaining: number,
  maxYield: number,
  isRich: boolean,
): ResourceNodeState {
  return {
    nodeId,
    kind: 'quarry',
    resource,
    x,
    z,
    remaining,
    maxYield,
    isRich,
  };
}

function inspectorGameState(
  building: BuildingState,
  deposits: ResourceNodeState[],
): GameState {
  return {
    seed: 1,
    tick: 0,
    stockpile: createEmptyStockpile(),
    quarries: new Map(deposits.map((deposit) => [deposit.nodeId, deposit])),
    foragingNodes: new Map(),
    trees: new Map(),
    buildings: new Map([[building.id, building]]),
    farmFields: new Map(),
    pastures: new Map(),
    livestockHerds: new Map(),
    burgageZones: new Map(),
    residences: new Map(),
    backyardGardens: new Map(),
    deliveryTrips: new Map(),
    fireIncidents: new Map(),
    nextBuildingId: 1,
  };
}

function buildingTarget(building: BuildingState) {
  return {
    kind: 'building' as const,
    building,
    matureTrees: 0,
    stumpTrees: 0,
    growingTrees: 0,
  };
}

function inspectorContext(
  state: GameState,
  inboundSupply: DeliveryTripState | null = null,
): InspectorRenderContext {
  const worldQueries = {
    getActiveDeliveryTrip: () => null,
    getInboundSupplyTrip: () => inboundSupply,
    getBuildingLabel: (kind: BuildingState['kind']) =>
      getBuildingDefinition(kind).label,
    getRoadAccessLabel: () => 'Road connected',
    findNearestQuarryWithRemaining: (
      x: number,
      z: number,
      radius: number,
    ) => [...state.quarries.values()]
      .filter(
        (deposit) =>
          deposit.resource === 'stone'
          && deposit.remaining > 1e-6
          && Math.hypot(deposit.x - x, deposit.z - z) <= radius,
      )
      .sort(
        (a, b) =>
          Math.hypot(a.x - x, a.z - z)
          - Math.hypot(b.x - x, b.z - z),
      )[0] ?? null,
  } as unknown as WorldQueries;
  return {
    gameState: state,
    worldQueries,
    populationStats: computePopulationStats(state),
    resourceTotals: computeResourceTotals(state),
    worldHydrology: 0.5,
  };
}
