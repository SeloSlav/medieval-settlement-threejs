import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import * as THREE from 'three';
import { createBuildingMesh } from '../src/buildings/BuildingMeshes.ts';
import { buildingMarkerSignatures } from '../src/buildings/buildingMarkerSignature.ts';
import {
  CHARCOAL_CLAMP_SMOKE_NAME,
  setCharcoalClampSmokeThroughput,
} from '../src/buildings/meshes/materialChainBuildingMeshes.ts';
import {
  bulkStockpileVisualSignature,
  CHARCOAL_BURNER_CHARCOAL_VISUAL_SEGMENTS,
  CHARCOAL_BURNER_FIREWOOD_VISUAL_SEGMENTS,
  CLAY_PIT_CLAY_VISUAL_SEGMENTS,
  LARGE_QUARRY_STONE_VISUAL_SEGMENTS,
  MINE_CLAY_VISUAL_SEGMENTS,
  MINE_IRON_VISUAL_SEGMENTS,
  MINE_SALT_VISUAL_SEGMENTS,
  MINING_PIT_CLAY_VISUAL_SEGMENTS,
  MINING_PIT_IRON_VISUAL_SEGMENTS,
  MINING_PIT_SALT_VISUAL_SEGMENTS,
  POTTER_CLAY_VISUAL_SEGMENTS,
  POTTER_FIREWOOD_VISUAL_SEGMENTS,
  POTTER_POTTERY_VISUAL_SEGMENTS,
  POTTER_ROOF_TILE_VISUAL_SEGMENTS,
  POTTER_WATER_VISUAL_SEGMENTS,
  SMITHY_CHARCOAL_VISUAL_SEGMENTS,
  SMITHY_IRON_VISUAL_SEGMENTS,
  SMITHY_IRONWORK_VISUAL_SEGMENTS,
  SMITHY_WATER_VISUAL_SEGMENTS,
  STONE_QUARRY_STONE_VISUAL_SEGMENTS,
  syncBulkStockpileVisuals,
} from '../src/buildings/bulkStockpileVisuals.ts';
import {
  CHARCOAL_BURNER_CHARCOAL_PER_CYCLE,
  CHARCOAL_BURNER_FIREWOOD_PER_CYCLE,
  CLAY_PIT_CLAY_PER_CYCLE,
  LIVESTOCK_FARMSTEAD_SALT_STAGING_PER_CYCLE,
  MARKETPLACE_TRADE_OFFERS,
  POTTER_CLAY_PER_CYCLE,
  POTTER_FIREWOOD_PER_CYCLE,
  POTTER_POTTERY_PER_CYCLE,
  POTTER_ROOF_TILES_PER_CYCLE,
  POTTER_WATER_PER_CYCLE,
  SMITHY_CHARCOAL_PER_CYCLE,
  SMITHY_CHARCOAL_TARGET_CYCLES,
  SMITHY_IRON_PER_CYCLE,
  SMITHY_IRONWORK_PER_CYCLE,
  SMITHY_WATER_PER_CYCLE,
  SMOKEHOUSE_POTTERY_PER_CYCLE,
  SMOKEHOUSE_SALT_PER_CYCLE,
} from '../src/generated/gameBalance.ts';
import { createDeliveryCartMesh } from '../src/logistics/deliveryCartMesh.ts';
import type { DeliveryCargoKind } from '../src/logistics/deliveryTrips.ts';
import {
  assignLocalMaterialInputTargets,
  assignMarketplaceMaterialInputTargets,
  directlyDispatchedProcessorInputPerCycle,
  LOCAL_MATERIAL_SOURCE_KINDS,
  localMaterialInputCommodities,
  localMaterialInputCommodity,
  selectDirectProcessorInputTarget,
  selectMarketplaceMaterialInputTarget,
} from '../src/logistics/processorInputLogistics.ts';
import {
  processorAcceptsInput,
  processorOutputCommodityForBuilding,
} from '../src/economy/processorOutputPolicy.ts';
import type { BuildingKind, BuildingState } from '../src/resources/types.ts';
import {
  normalizePotterFiringPolicy,
  POTTER_FIRE_ROOF_TILES,
  POTTER_FIRE_VESSELS,
  POTTER_FIRING_POLICY_PRESETS,
  potterFiringPolicyLabel,
} from '../src/economy/potterFiringPolicy.ts';
import {
  CLAY_BANK_ORDINARY_YIELD_MAX,
  CLAY_BANK_RICH_YIELD_MIN,
  CLAY_BANK_SITE_YIELD_MAX,
  CLAY_BANK_SITE_YIELD_MIN,
  CLAY_BANK_STRATA_VISUAL_SEGMENTS,
  CLAY_BANK_TOTAL_YIELD_MAX,
  CLAY_BANK_TOTAL_YIELD_MIN,
  clayBankRegionalYieldMultiplier,
  clayBankSiteYieldAt,
  clayBankSiteYieldMultiplier,
  clayBankStrataVisualLevel,
  clayBankYieldAt,
  clayBankYieldGrade,
  clayBankYieldMultiplier,
} from '../src/economy/clayBankPolicy.ts';
import { renderProcessorOutputTargetPanel } from '../src/resources/inspector/expandedBuildingRenderer.ts';
import { renderBuildMenuCards } from '../src/ui/buildMenuCards.ts';

const leanClayBank = { x: -360, z: 260 };
const richClayBank = { x: 280, z: 220 };
assert.equal(clayBankRegionalYieldMultiplier(50), 1);
assert.equal(clayBankRegionalYieldMultiplier(Number.NaN), 1);
assert.equal(clayBankSiteYieldMultiplier(Number.NEGATIVE_INFINITY), CLAY_BANK_SITE_YIELD_MIN);
assert.equal(clayBankSiteYieldMultiplier(1), CLAY_BANK_SITE_YIELD_MAX);
assert.ok(clayBankYieldMultiplier(-10, -10) >= CLAY_BANK_TOTAL_YIELD_MIN);
assert.ok(clayBankYieldMultiplier(10, 110) <= CLAY_BANK_ORDINARY_YIELD_MAX);
const explicitRichClayYield = clayBankYieldMultiplier(0.3, 50, 1);
assert.ok(explicitRichClayYield >= CLAY_BANK_RICH_YIELD_MIN);
assert.ok(explicitRichClayYield <= CLAY_BANK_TOTAL_YIELD_MAX);
assert.match(clayBankYieldGrade(explicitRichClayYield), /Rich clay deposit/);
assert.ok(
  clayBankYieldAt(richClayBank.x, richClayBank.z)
    > clayBankYieldAt(leanClayBank.x, leanClayBank.z),
  'groundwater-rich clay ground must outperform dry clay margins',
);
assert.ok(
  clayBankYieldAt(richClayBank.x, richClayBank.z, 100)
    > clayBankYieldAt(richClayBank.x, richClayBank.z, 0),
  'world resource abundance must modestly shift a fixed bank',
);
assert.match(clayBankYieldGrade(clayBankYieldAt(richClayBank.x, richClayBank.z)), /Good|Rich/);
assert.equal(
  clayBankStrataVisualLevel(explicitRichClayYield),
  CLAY_BANK_STRATA_VISUAL_SEGMENTS,
);

assert.equal(CLAY_PIT_CLAY_PER_CYCLE, 4);
assert.deepEqual(
  [CHARCOAL_BURNER_FIREWOOD_PER_CYCLE, CHARCOAL_BURNER_CHARCOAL_PER_CYCLE],
  [3, 2],
  'charcoal must impose a meaningful net firewood cost',
);
assert.deepEqual(
  [
    SMITHY_IRON_PER_CYCLE,
    SMITHY_CHARCOAL_PER_CYCLE,
    SMITHY_WATER_PER_CYCLE,
    SMITHY_IRONWORK_PER_CYCLE,
  ],
  [2, 1, 1, 2],
);
assert.deepEqual(
  [
    POTTER_CLAY_PER_CYCLE,
    POTTER_FIREWOOD_PER_CYCLE,
    POTTER_WATER_PER_CYCLE,
    POTTER_POTTERY_PER_CYCLE,
  ],
  [3, 1, 1, 3],
);
assert.equal(POTTER_ROOF_TILES_PER_CYCLE, 4);
assert.equal(normalizePotterFiringPolicy(99), POTTER_FIRE_VESSELS);
assert.equal(potterFiringPolicyLabel(POTTER_FIRE_VESSELS), 'Household vessels');
assert.equal(potterFiringPolicyLabel(POTTER_FIRE_ROOF_TILES), 'Fired roof tiles');
assert.deepEqual(
  POTTER_FIRING_POLICY_PRESETS.map((preset) => preset.policy),
  [POTTER_FIRE_VESSELS, POTTER_FIRE_ROOF_TILES],
);
assert.equal(
  processorOutputCommodityForBuilding(
    building('potter_kiln', { potterFiringPolicy: POTTER_FIRE_VESSELS }),
  ),
  'pottery',
);
assert.equal(
  processorOutputCommodityForBuilding(
    building('potter_kiln', { potterFiringPolicy: POTTER_FIRE_ROOF_TILES }),
  ),
  'roofTiles',
  'tile firing must replace rather than supplement vessel output',
);
assert.ok(SMOKEHOUSE_SALT_PER_CYCLE > 0);
assert.equal(
  SMOKEHOUSE_POTTERY_PER_CYCLE,
  0,
  'whole-unit smokehouse recipes must not restore fractional pottery consumption',
);
assert.equal(
  directlyDispatchedProcessorInputPerCycle('potter_kiln', 'clay'),
  POTTER_CLAY_PER_CYCLE,
);
assert.equal(
  directlyDispatchedProcessorInputPerCycle('smithy', 'charcoal'),
  SMITHY_CHARCOAL_PER_CYCLE,
);
assert.equal(
  directlyDispatchedProcessorInputPerCycle('smokehouse', 'pottery'),
  SMOKEHOUSE_POTTERY_PER_CYCLE,
);
assert.equal(
  directlyDispatchedProcessorInputPerCycle('smithy', 'iron'),
  SMITHY_IRON_PER_CYCLE,
);
assert.equal(
  directlyDispatchedProcessorInputPerCycle('smokehouse', 'salt'),
  SMOKEHOUSE_SALT_PER_CYCLE,
);
assert.equal(
  directlyDispatchedProcessorInputPerCycle('pastoral_farmstead', 'salt'),
  LIVESTOCK_FARMSTEAD_SALT_STAGING_PER_CYCLE,
);
assert.equal(
  directlyDispatchedProcessorInputPerCycle('trading_post', 'pottery'),
  0,
  'the Trading Post is export overflow, not a pottery processor',
);
const vesselPotterPanel = renderProcessorOutputTargetPanel(building('potter_kiln'));
assert.doesNotMatch(vesselPotterPanel ?? '', /data-pottery-dispatch-policy/);
assert.match(vesselPotterPanel ?? '', /data-potter-firing-policy="0"[^>]*disabled/);
assert.match(vesselPotterPanel ?? '', /data-tooltip="3 clay \+ 1 firewood \+ 1 water → 3 pottery"/);
assert.match(vesselPotterPanel ?? '', /data-resource-cost="pottery"/);
const tileFiringPotterPanel = renderProcessorOutputTargetPanel(
  building('potter_kiln', { potterFiringPolicy: POTTER_FIRE_ROOF_TILES }),
);
assert.match(tileFiringPotterPanel ?? '', /data-potter-firing-policy="1"[^>]*disabled/);
assert.match(
  tileFiringPotterPanel ?? '',
  /data-tooltip="3 clay \+ 1 firewood \+ 1 water → 4 roof tiles"/,
);

const nearbyMarket = building('trading_post', {
  id: 'near-market',
  x: 5,
  assignedLabor: 2,
});
const distantSmokehouse = building('smokehouse', {
  id: 'distant-smokehouse',
  x: 80,
  assignedLabor: 2,
  constructionPriority: 3,
  processorOutputTargetPercent: 75,
  pottery: 0,
});
const potteryOverflowTarget = selectDirectProcessorInputTarget(
  [nearbyMarket, distantSmokehouse],
  'potter',
  'pottery',
  (candidate) => candidate.x,
);
assert.equal(
  potteryOverflowTarget?.target.id,
  nearbyMarket.id,
  'without a whole-unit preservation recipe, pottery should follow the nearest overflow route',
);
assert.equal(potteryOverflowTarget?.duty, 'workshop-overflow');

const lowPriorityNearSmithy = building('smithy', {
  id: 'near-smithy',
  x: 5,
  assignedLabor: 2,
  constructionPriority: 1,
  charcoal: 0,
});
const highPriorityFarSmithy = building('smithy', {
  id: 'far-smithy',
  x: 75,
  assignedLabor: 2,
  constructionPriority: 3,
  charcoal: 0,
});
const charcoalTarget = selectDirectProcessorInputTarget(
  [lowPriorityNearSmithy, highPriorityFarSmithy],
  'burner',
  'charcoal',
  (candidate) => candidate.x,
);
assert.equal(
  charcoalTarget?.target.id,
  lowPriorityNearSmithy.id,
  'forge-fuel carts must ignore legacy completed-building priority and use route order after runway',
);
assert.equal(
  charcoalTarget?.desiredStock,
  SMITHY_CHARCOAL_PER_CYCLE * SMITHY_CHARCOAL_TARGET_CYCLES,
  'forge-fuel staging must follow the generated balance authority',
);

const materialMarket = building('trading_post', {
  id: 'material-market',
  iron: 12,
  salt: 12,
  pottery: 12,
});
const pastoralSaltTarget = building('pastoral_farmstead', {
  id: 'pastoral-salt-target',
  x: 32,
  assignedLabor: 2,
  constructionPriority: 3,
  salt: 0,
});
const pastoralSaltDispatch = selectMarketplaceMaterialInputTarget(
  [pastoralSaltTarget],
  materialMarket,
  (candidate) => candidate.x,
);
assert.equal(pastoralSaltDispatch?.target.id, pastoralSaltTarget.id);
assert.equal(pastoralSaltDispatch?.commodity, 'salt');
assert.equal(
  pastoralSaltDispatch?.desiredStock,
  LIVESTOCK_FARMSTEAD_SALT_STAGING_PER_CYCLE * 3,
  'pastoral holdings need a bounded cheese-and-cull salt buffer',
);
assert.equal(processorAcceptsInput(pastoralSaltTarget, 'salt'), true);
assert.equal(
  processorAcceptsInput(building('pastoral_farmstead', {
    preservedFood: 70,
  }), 'salt'),
  false,
  'a full cured store must not attract another imported salt cart',
);
const lowPriorityIronTarget = building('smithy', {
  id: 'older-near-smithy',
  x: 5,
  assignedLabor: 2,
  constructionPriority: 1,
  iron: 0,
});
const highPrioritySaltTarget = building('smokehouse', {
  id: 'later-far-smokehouse',
  x: 80,
  assignedLabor: 2,
  constructionPriority: 3,
  salt: 0,
});
let materialRouteSolves = 0;
let marketMaterialTarget = selectMarketplaceMaterialInputTarget(
  [lowPriorityIronTarget, highPrioritySaltTarget],
  materialMarket,
  (candidate) => {
    materialRouteSolves += 1;
    return candidate.x;
  },
);
assert.equal(
  marketMaterialTarget?.target.id,
  lowPriorityIronTarget.id,
  'completed-workplace legacy priority must not beat the shorter route at equal runway',
);
assert.equal(marketMaterialTarget?.commodity, 'iron');
assert.equal(marketMaterialTarget?.duty, 'working-buffer');
assert.equal(
  materialRouteSolves,
  2,
  'salt and pottery candidates for one smokehouse must share one road solve',
);

lowPriorityIronTarget.constructionPriority = 2;
lowPriorityIronTarget.iron = SMITHY_IRON_PER_CYCLE;
highPrioritySaltTarget.constructionPriority = 2;
marketMaterialTarget = selectMarketplaceMaterialInputTarget(
  [lowPriorityIronTarget, highPrioritySaltTarget],
  materialMarket,
  (candidate) => candidate.x,
);
assert.equal(
  marketMaterialTarget?.commodity,
  'salt',
  'imported inputs must serve the lower cycle runway before the shorter road',
);

highPrioritySaltTarget.salt = SMOKEHOUSE_SALT_PER_CYCLE * 3;
marketMaterialTarget = selectMarketplaceMaterialInputTarget(
  [lowPriorityIronTarget, highPrioritySaltTarget],
  materialMarket,
  (candidate) => candidate.x,
);
assert.equal(
  marketMaterialTarget?.commodity,
  'iron',
  'covered salt demand must release the market cart to the smithy when preservation uses no pottery',
);

highPrioritySaltTarget.salt = 0;
highPrioritySaltTarget.assignedLabor = 0;
marketMaterialTarget = selectMarketplaceMaterialInputTarget(
  [lowPriorityIronTarget, highPrioritySaltTarget],
  materialMarket,
  (candidate) => candidate.x,
);
assert.equal(
  marketMaterialTarget?.commodity,
  'iron',
  'unstaffed workshops must not reserve scarce imported inputs',
);

highPrioritySaltTarget.assignedLabor = 2;
highPrioritySaltTarget.salt = SMOKEHOUSE_SALT_PER_CYCLE * 3;
highPrioritySaltTarget.pottery = 0;
const reservedExportPotteryTarget = selectMarketplaceMaterialInputTarget(
  [highPrioritySaltTarget],
  { ...materialMarket, iron: 0, salt: 0 },
  (candidate) => candidate.x,
  () => false,
  () => true,
  (commodity) => commodity === 'pottery',
);
assert.equal(
  reservedExportPotteryTarget,
  null,
  'pottery reserved by a monthly export rule must not be recalled to a smokehouse',
);

const olderRemoteMarket = building('trading_post', {
  id: 'older-remote-market',
  x: 0,
  iron: 12,
});
const newerNearMarket = building('trading_post', {
  id: 'newer-near-market',
  x: 90,
  iron: 12,
});
const urgentSmithy = building('smithy', {
  id: 'urgent-smithy',
  x: 100,
  assignedLabor: 2,
  constructionPriority: 3,
  iron: 0,
});
const routineSmithy = building('smithy', {
  id: 'routine-smithy',
  x: 10,
  assignedLabor: 2,
  constructionPriority: 2,
  iron: 0,
});
const materialAssignments = assignMarketplaceMaterialInputTargets(
  [olderRemoteMarket, newerNearMarket],
  [routineSmithy, urgentSmithy],
  (source, target) => Math.abs(source.x - target.x),
);
assert.equal(
  materialAssignments.get(newerNearMarket.id)?.target.id,
  urgentSmithy.id,
  'the nearest free market must serve an equally urgent workshop regardless of market age',
);
assert.equal(
  materialAssignments.get(olderRemoteMarket.id)?.target.id,
  routineSmithy.id,
  'the remaining market cart should cover the next workshop instead of duplicating an inbound trip',
);

const mixedMaterialMarket = building('trading_post', {
  id: 'mixed-material-market',
  salt: 12,
  pottery: 12,
});
const emptySmokehouse = building('smokehouse', {
  id: 'empty-smokehouse',
  assignedLabor: 2,
  constructionPriority: 2,
  salt: 0,
  pottery: 0,
});
let mixedAssignmentRouteSolves = 0;
const mixedAssignments = assignMarketplaceMaterialInputTargets(
  [mixedMaterialMarket],
  [emptySmokehouse],
  () => {
    mixedAssignmentRouteSolves += 1;
    return 20;
  },
);
assert.equal(
  mixedAssignments.get(mixedMaterialMarket.id)?.commodity,
  'salt',
  'an exact salt/pottery tie must resolve deterministically while reserving one inbound cart slot',
);
assert.equal(
  mixedAssignmentRouteSolves,
  1,
  'salt and pottery candidates for one market/workshop pair must share one road solve',
);

assert.deepEqual(
  LOCAL_MATERIAL_SOURCE_KINDS,
  [
    'stone_quarry',
    'mine',
    'clay_pit',
    'charcoal_burner',
    'smithy',
    'potter_kiln',
    'granary',
    'spinning_retting_house',
    'village_storehouse',
  ],
);
assert.deepEqual(
  LOCAL_MATERIAL_SOURCE_KINDS.map((kind) =>
    localMaterialInputCommodity(
      kind,
      kind === 'stone_quarry'
        ? { iron: 12, salt: 0 }
        : kind === 'mine'
          ? { iron: 0, salt: 0, clay: 12 }
        : kind === 'granary'
          ? { flax: 12 }
        : kind === 'spinning_retting_house'
          ? { yarn: 12, linen: 0 }
        : kind === 'village_storehouse'
          ? { iron: 12, clay: 0, salt: 0 }
          : undefined,
    )
  ),
  ['iron', 'clay', 'clay', 'charcoal', 'ironwork', 'pottery', 'flax', 'yarn', 'iron'],
);
assert.deepEqual(
  localMaterialInputCommodities('stone_quarry', {
    iron: 12,
    salt: 12,
    clay: 12,
  }),
  ['iron', 'salt', 'clay'],
  'Mining Camp carts must route every non-stone surface material to its processor',
);
assert.deepEqual(
  localMaterialInputCommodities('mine', {
    iron: 12,
    salt: 12,
    clay: 12,
  }),
  ['iron', 'salt', 'clay'],
  'Mineworks carts must route each supported rich mineral output',
);
assert.equal(
  localMaterialInputCommodity('mine', { iron: 0, salt: 12 }),
  'salt',
  'a legacy salt-deposit row must remain routable without inheriting the iron route',
);
assert.deepEqual(
  localMaterialInputCommodities('village_storehouse', {
    iron: 12,
    clay: 12,
    salt: 12,
    storehouseAcceptsIron: true,
    storehouseAcceptsClay: false,
    storehouseAcceptsSalt: true,
  }),
  ['iron', 'clay', 'salt'],
  'an intake gate must stop new deliveries without stranding material already stored',
);
const olderRemoteClayPit = building('clay_pit', {
  id: 'older-remote-clay-pit',
  x: 0,
  clay: 12,
});
const newerNearClayPit = building('clay_pit', {
  id: 'newer-near-clay-pit',
  x: 90,
  clay: 12,
});
const urgentPotter = building('potter_kiln', {
  id: 'urgent-potter',
  x: 100,
  assignedLabor: 2,
  constructionPriority: 3,
  clay: 0,
});
const routinePotter = building('potter_kiln', {
  id: 'routine-potter',
  x: 10,
  assignedLabor: 2,
  constructionPriority: 2,
  clay: 0,
});
const localMaterialAssignments = assignLocalMaterialInputTargets(
  [olderRemoteClayPit, newerNearClayPit],
  [routinePotter, urgentPotter],
  (source, target) => Math.abs(source.x - target.x),
);
assert.equal(
  localMaterialAssignments.get(newerNearClayPit.id)?.target.id,
  urgentPotter.id,
  'the nearest clay cart must cover an equally urgent kiln regardless of producer age',
);
assert.equal(
  localMaterialAssignments.get(olderRemoteClayPit.id)?.target.id,
  routinePotter.id,
  'the remaining clay cart must cover the next kiln without duplicating its inbound slot',
);
const localMineAssignments = assignLocalMaterialInputTargets(
  [
    building('mine', { id: 'iron-mine', iron: 12 }),
    building('mine', { id: 'salt-mine', salt: 12 }),
  ],
  [
    building('smithy', { id: 'local-iron-smithy', iron: 0 }),
    building('smokehouse', { id: 'local-salt-smokehouse', salt: 0 }),
  ],
  () => 20,
);
assert.equal(localMineAssignments.get('iron-mine')?.commodity, 'iron');
assert.equal(localMineAssignments.get('iron-mine')?.target.id, 'local-iron-smithy');
assert.equal(localMineAssignments.get('salt-mine')?.commodity, 'salt');
assert.equal(localMineAssignments.get('salt-mine')?.target.id, 'local-salt-smokehouse');
const mixedMaterialDepot = building('village_storehouse', {
  id: 'mixed-material-depot',
  iron: 12,
  clay: 12,
  salt: 12,
  storehouseAcceptsIron: true,
  storehouseAcceptsClay: true,
  storehouseAcceptsSalt: true,
});
const depotAssignments = assignLocalMaterialInputTargets(
  [mixedMaterialDepot],
  [
    building('smithy', {
      id: 'depot-smithy',
      assignedLabor: 2,
      constructionPriority: 2,
      iron: 0,
    }),
    building('potter_kiln', {
      id: 'urgent-depot-potter',
      assignedLabor: 2,
      constructionPriority: 3,
      clay: 0,
    }),
    building('smokehouse', {
      id: 'depot-smokehouse',
      assignedLabor: 2,
      constructionPriority: 2,
      salt: 0,
    }),
  ],
  () => 20,
);
assert.equal(depotAssignments.size, 1, 'one staffed depot has one physical cart per pass');
assert.equal(depotAssignments.get(mixedMaterialDepot.id)?.commodity, 'iron');
assert.equal(
  depotAssignments.get(mixedMaterialDepot.id)?.target.id,
  'depot-smithy',
  'a mixed depot must ignore legacy workplace priority and resolve equal starved claims deterministically',
);
const reserveIronMine = building('mine', {
  id: 'reserve-iron-mine',
  x: 0,
  iron: 24,
});
const hungryReserveSmithy = building('smithy', {
  id: 'hungry-reserve-smithy',
  x: 100,
  assignedLabor: 2,
  iron: 0,
});
const localIronReserveMarket = building('trading_post', {
  id: 'local-iron-reserve-market',
  x: 5,
  assignedLabor: 2,
  iron: 0,
  marketplaceIronTarget: 24,
});
let localIronReserveAssignments = assignLocalMaterialInputTargets(
  [reserveIronMine],
  [localIronReserveMarket, hungryReserveSmithy],
  (source, target) => Math.abs(source.x - target.x),
);
assert.equal(
  localIronReserveAssignments.get(reserveIronMine.id)?.target.id,
  hungryReserveSmithy.id,
  'a staffed forge working buffer must beat a much nearer central ore reserve',
);
assert.equal(
  localIronReserveAssignments.get(reserveIronMine.id)?.desiredStock,
  SMITHY_IRON_PER_CYCLE * 3,
);
hungryReserveSmithy.iron = SMITHY_IRON_PER_CYCLE * 3;
localIronReserveAssignments = assignLocalMaterialInputTargets(
  [reserveIronMine],
  [localIronReserveMarket, hungryReserveSmithy],
  (source, target) => Math.abs(source.x - target.x),
);
assert.equal(
  localIronReserveAssignments.get(reserveIronMine.id)?.target.id,
  localIronReserveMarket.id,
  'mine carts should centralize surplus ore after every reachable forge buffer is covered',
);
assert.equal(
  localIronReserveAssignments.get(reserveIronMine.id)?.desiredStock,
  24,
  'local carts must stop at the selected iron reserve instead of filling market capacity',
);
assert.equal(
  localIronReserveAssignments.get(reserveIronMine.id)?.duty,
  'workshop-overflow',
);
localIronReserveMarket.iron = 24;
assert.equal(
  assignLocalMaterialInputTargets(
    [reserveIronMine],
    [localIronReserveMarket, hungryReserveSmithy],
    (source, target) => Math.abs(source.x - target.x),
  ).get(reserveIronMine.id),
  undefined,
  'covered forge buffers and a full selected reserve must leave ore physically at the mine',
);
localIronReserveMarket.iron = 0;
localIronReserveMarket.marketplaceIronTarget = 0;
assert.equal(
  assignLocalMaterialInputTargets(
    [reserveIronMine],
    [localIronReserveMarket, hungryReserveSmithy],
    (source, target) => Math.abs(source.x - target.x),
  ).get(reserveIronMine.id),
  undefined,
  'no-reserve markets must not become disembodied default warehouses',
);
const localSaltReserveAssignment = assignLocalMaterialInputTargets(
  [building('mine', { id: 'reserve-salt-mine', salt: 24 })],
  [
    building('smokehouse', {
      id: 'covered-reserve-smokehouse',
      assignedLabor: 2,
      salt: SMOKEHOUSE_SALT_PER_CYCLE * 3,
    }),
    building('trading_post', {
      id: 'local-salt-reserve-market',
      assignedLabor: 2,
      salt: 12,
      marketplaceSaltTarget: 48,
    }),
  ],
  () => 20,
).get('reserve-salt-mine');
assert.equal(localSaltReserveAssignment?.target.id, 'local-salt-reserve-market');
assert.equal(localSaltReserveAssignment?.desiredStock, 48);
const mineToolAssignment = assignLocalMaterialInputTargets(
  [
    building('smithy', {
      id: 'mine-tool-smithy',
      ironwork: 3,
      assignedLabor: 2,
    }),
  ],
  [
    building('mine', {
      id: 'tool-starved-mine',
      assignedLabor: 4,
      ironwork: 0,
    }),
  ],
  () => 25,
);
assert.equal(mineToolAssignment.get('mine-tool-smithy')?.commodity, 'ironwork');
assert.equal(mineToolAssignment.get('mine-tool-smithy')?.target.id, 'tool-starved-mine');
assert.equal(mineToolAssignment.get('mine-tool-smithy')?.desiredStock, 3);

for (const offerId of ['buy_iron', 'buy_salt', 'sell_pottery']) {
  assert.ok(
    MARKETPLACE_TRADE_OFFERS.some((offer) => offer.id === offerId),
    `missing material-chain trade offer ${offerId}`,
  );
}

const bloomerySmithy = createBuildingMesh('smithy');
assert.equal(bloomerySmithy.name, 'Forest bloomery and smithy');
for (const objectName of [
  'Direct-process bloomery',
  'Clay-lined bloomery shaft',
  'Bloomery charging mouth',
  'Bloomery tapping arch',
  'Bloomery clay tuyere',
  'Bloomery leather bellows',
  'Bloomery slag heap',
  'Smithy forge hearth',
  'Smithy anvil',
  'Smithy quench tub',
]) {
  assert.ok(
    bloomerySmithy.getObjectByName(objectName),
    `the integrated ironworking yard must visibly model ${objectName}`,
  );
}
const bloomeryIronStock = bloomerySmithy.getObjectByName('SmithyIronStockpile');
assert.ok(bloomeryIronStock instanceof THREE.Group);
assert.equal(
  bloomeryIronStock.children.filter((child) => child.name === 'SmithyIronSegment').length,
  SMITHY_IRON_VISUAL_SEGMENTS,
);
syncBulkStockpileVisuals(
  bloomerySmithy,
  building('smithy', { iron: 24 }),
);
const visibleIronCharge = bloomeryIronStock.children.filter(
  (child) => child.name === 'SmithyIronSegment' && child.visible,
);
assert.equal(visibleIronCharge.length, 4);
assert.ok(
  visibleIronCharge[0]?.getObjectByName('Iron ore basket'),
  'the first visible iron charge must read as locally mined ore',
);
assert.ok(
  visibleIronCharge[1]?.getObjectByName('Imported or consolidated iron bar'),
  'a deeper iron charge must also show the bloom/bar form accepted from trade or prior consolidation',
);

const buildingVisuals = [
  {
    kind: 'stone_quarry',
    container: 'StoneQuarryStockpile',
    segment: 'StoneQuarryStockSegment',
    resource: 'stone',
    segments: STONE_QUARRY_STONE_VISUAL_SEGMENTS,
  },
  {
    kind: 'stone_quarry',
    container: 'MiningPitIronStockpile',
    segment: 'MiningPitIronSegment',
    resource: 'iron',
    segments: MINING_PIT_IRON_VISUAL_SEGMENTS,
  },
  {
    kind: 'stone_quarry',
    container: 'MiningPitSaltStockpile',
    segment: 'MiningPitSaltSegment',
    resource: 'salt',
    segments: MINING_PIT_SALT_VISUAL_SEGMENTS,
  },
  {
    kind: 'stone_quarry',
    container: 'MiningPitClayStockpile',
    segment: 'MiningPitClaySegment',
    resource: 'clay',
    segments: MINING_PIT_CLAY_VISUAL_SEGMENTS,
  },
  {
    kind: 'large_quarry',
    container: 'LargeQuarryStockpile',
    segment: 'LargeQuarryStockSegment',
    resource: 'stone',
    segments: LARGE_QUARRY_STONE_VISUAL_SEGMENTS,
  },
  {
    kind: 'mine',
    container: 'IronMineStockpile',
    segment: 'IronMineOreSegment',
    resource: 'iron',
    segments: MINE_IRON_VISUAL_SEGMENTS,
  },
  {
    kind: 'mine',
    container: 'SaltMineStockpile',
    segment: 'SaltMineSaltSegment',
    resource: 'salt',
    segments: MINE_SALT_VISUAL_SEGMENTS,
  },
  {
    kind: 'mine',
    container: 'ClayMineStockpile',
    segment: 'ClayMineClaySegment',
    resource: 'clay',
    segments: MINE_CLAY_VISUAL_SEGMENTS,
  },
  {
    kind: 'clay_pit',
    container: 'ClayPitStockpile',
    segment: 'ClayPitClaySegment',
    resource: 'clay',
    segments: CLAY_PIT_CLAY_VISUAL_SEGMENTS,
  },
  {
    kind: 'charcoal_burner',
    container: 'CharcoalBurnerFirewoodStockpile',
    segment: 'CharcoalBurnerFirewoodSegment',
    resource: 'firewood',
    segments: CHARCOAL_BURNER_FIREWOOD_VISUAL_SEGMENTS,
  },
  {
    kind: 'charcoal_burner',
    container: 'CharcoalBurnerStockpile',
    segment: 'CharcoalBurnerCharcoalSegment',
    resource: 'charcoal',
    segments: CHARCOAL_BURNER_CHARCOAL_VISUAL_SEGMENTS,
  },
  {
    kind: 'smithy',
    container: 'SmithyIronStockpile',
    segment: 'SmithyIronSegment',
    resource: 'iron',
    segments: SMITHY_IRON_VISUAL_SEGMENTS,
  },
  {
    kind: 'smithy',
    container: 'SmithyCharcoalStockpile',
    segment: 'SmithyCharcoalSegment',
    resource: 'charcoal',
    segments: SMITHY_CHARCOAL_VISUAL_SEGMENTS,
  },
  {
    kind: 'smithy',
    container: 'SmithyIronworkStockpile',
    segment: 'SmithyIronworkSegment',
    resource: 'ironwork',
    segments: SMITHY_IRONWORK_VISUAL_SEGMENTS,
  },
  {
    kind: 'smithy',
    container: 'SmithyQuenchWaterStockpile',
    segment: 'SmithyQuenchWaterSegment',
    resource: 'water',
    segments: SMITHY_WATER_VISUAL_SEGMENTS,
  },
  {
    kind: 'potter_kiln',
    container: 'PotterClayStockpile',
    segment: 'PotterClaySegment',
    resource: 'clay',
    segments: POTTER_CLAY_VISUAL_SEGMENTS,
  },
  {
    kind: 'potter_kiln',
    container: 'PotterFirewoodStockpile',
    segment: 'PotterFirewoodSegment',
    resource: 'firewood',
    segments: POTTER_FIREWOOD_VISUAL_SEGMENTS,
  },
  {
    kind: 'potter_kiln',
    container: 'PotterPotteryStockpile',
    segment: 'PotterPotterySegment',
    resource: 'pottery',
    segments: POTTER_POTTERY_VISUAL_SEGMENTS,
  },
  {
    kind: 'potter_kiln',
    container: 'PotterRoofTileStockpile',
    segment: 'PotterRoofTileSegment',
    resource: 'roofTiles',
    segments: POTTER_ROOF_TILE_VISUAL_SEGMENTS,
  },
  {
    kind: 'potter_kiln',
    container: 'PotterPuddlingWaterStockpile',
    segment: 'PotterPuddlingWaterSegment',
    resource: 'water',
    segments: POTTER_WATER_VISUAL_SEGMENTS,
  },
] as const;

for (const spec of buildingVisuals) {
  const marker = createBuildingMesh(spec.kind);
  const stockpile = marker.getObjectByName(spec.container);
  assert.ok(stockpile instanceof THREE.Group, `${spec.kind} must expose ${spec.container}`);
  const segments = stockpile.children.filter((child) => child.name === spec.segment);
  assert.equal(
    segments.length,
    spec.segments,
    `${spec.container} must have its configured fill ladder`,
  );
  assert.equal(stockpile.visible, false, `${spec.container} must begin empty`);
  assert.ok(segments.every((segment) => !segment.visible));
  const state = building(spec.kind);
  state[spec.resource] = 999;
  syncBulkStockpileVisuals(marker, state);
  assert.equal(stockpile.visible, true);
  assert.ok(segments.every((segment) => segment.visible));
  state[spec.resource] = 0;
  syncBulkStockpileVisuals(marker, state);
  assert.equal(stockpile.visible, false);
  assert.ok(segments.every((segment) => !segment.visible));
}

const charcoalClampMesh = createBuildingMesh('charcoal_burner');
const charcoalClampSmoke = charcoalClampMesh.getObjectByName(
  CHARCOAL_CLAMP_SMOKE_NAME,
);
assert.ok(
  charcoalClampSmoke instanceof THREE.Group,
  'the physical clamp must expose a bounded climate-readable smoke group',
);
assert.equal(
  charcoalClampSmoke.visible,
  false,
  'an unstaffed or starved clamp must not imply active production',
);
setCharcoalClampSmokeThroughput(charcoalClampMesh, 0.8);
const wetClampSmokeHeight = charcoalClampSmoke.scale.y;
setCharcoalClampSmokeThroughput(charcoalClampMesh, 1.1);
assert.ok(
  charcoalClampSmoke.scale.y > wetClampSmokeHeight,
  'dry-weather clamp smoke must read more strongly than a damp charge',
);

const leanClayPitMesh = createBuildingMesh('clay_pit');
const leanClayStrata = leanClayPitMesh.getObjectByName('ClayBankStrata');
assert.ok(leanClayStrata instanceof THREE.Group);
assert.equal(
  leanClayStrata.children.filter((child) => child.name === 'ClayBankStratum').length,
  CLAY_BANK_STRATA_VISUAL_SEGMENTS,
);
const leanClayPitState = building('clay_pit', {
  x: leanClayBank.x,
  z: leanClayBank.z,
});
syncBulkStockpileVisuals(leanClayPitMesh, leanClayPitState);
const leanVisibleStrata = leanClayStrata.children.filter((child) => child.visible).length;
assert.equal(
  leanVisibleStrata,
  clayBankStrataVisualLevel(
    clayBankSiteYieldAt(leanClayPitState.x, leanClayPitState.z),
  ),
);
const richClayPitMesh = createBuildingMesh('clay_pit');
const richClayStrata = richClayPitMesh.getObjectByName('ClayBankStrata');
assert.ok(richClayStrata instanceof THREE.Group);
const richClayPitState = building('clay_pit', {
  x: richClayBank.x,
  z: richClayBank.z,
});
syncBulkStockpileVisuals(richClayPitMesh, richClayPitState);
assert.ok(
  richClayStrata.children.filter((child) => child.visible).length > leanVisibleStrata,
  'the physical excavation must expose more clay strata at a richer bank',
);
assert.notEqual(
  bulkStockpileVisualSignature(richClayPitState),
  bulkStockpileVisualSignature(leanClayPitState),
  'bank strata changes must invalidate only the bounded visual signature',
);

const cargoProof: ReadonlyArray<
  readonly [DeliveryCargoKind, string]
> = [
  ['iron', 'Local iron ore chunk 1'],
  ['clay', 'Clay basket 1'],
  ['salt', 'Mined rock salt chunk 1'],
  ['charcoal', 'Charcoal sack 1'],
  ['pottery', 'Fired pottery vessel 1'],
  ['roofTiles', 'Fired roof tile stack 1 layer 1'],
];
for (const [kind, objectName] of cargoProof) {
  const cart = createDeliveryCartMesh(kind);
  assert.ok(cart.getObjectByName(objectName), `${kind} cart must visibly carry ${objectName}`);
}
assert.ok(
  createDeliveryCartMesh('iron', { regionalImport: true })
    .getObjectByName('Imported iron bar 1'),
  'a regional iron caravan must remain visually distinct from a local ore cart',
);
assert.ok(
  createDeliveryCartMesh('salt', { regionalImport: true })
    .getObjectByName('Adriatic salt sack 1'),
  'a regional salt caravan must remain visually distinct from a local rock-salt cart',
);

const renderedCards = renderBuildMenuCards();
assert.match(
  renderedCards,
  /Smithy[\s\S]*Forges ironwork, tools, fittings, and weapons from iron and charcoal/i,
  'the smithy build card must describe its craft in one short sentence',
);
assert.match(
  renderedCards,
  /Potter's kiln[\s\S]*Fires clay into household pottery or sturdy roof tiles/i,
  'the potter build card must describe its craft in one short sentence',
);
const smithyCard = renderedCards.match(/<button[^>]*data-action="smithy"[^>]*>/)?.[0] ?? '';
const smithyFlow = smithyCard.match(/data-tooltip-flow="([^"]+)"/)?.[1];
assert.ok(smithyFlow, 'the smithy card must expose an icon flow');
assert.deepEqual(JSON.parse(decodeURIComponent(smithyFlow)), {
  inputs: ['iron', 'charcoal', 'water'],
  outputs: ['ironwork'],
});
for (const slug of ['charcoal-burner', 'smithy-bloomery', 'potter-kiln']) {
  assert.match(renderedCards, new RegExp(`/assets/ui/build-menu/cards/${slug}\\.webp`));
  assert.ok(
    existsSync(`public/assets/ui/build-menu/cards/${slug}.webp`),
    `missing generated ${slug} card`,
  );
}
assert.ok(
  readFileSync('public/assets/ui/build-menu/cards/smithy-bloomery.webp').byteLength > 40_000,
  'the bloomery-smithy card must retain a detailed authored image rather than a placeholder',
);
for (const resource of ['iron', 'clay', 'salt', 'charcoal', 'pottery']) {
  assert.ok(
    existsSync(`public/assets/ui/icons/materials/${resource}.png`),
    `missing generated ${resource} icon`,
  );
}

assert.notEqual(
  bulkStockpileVisualSignature(building('smithy', { charcoal: 1 })),
  bulkStockpileVisualSignature(building('smithy')),
  'the first charcoal sack at a smithy must invalidate its visual signature',
);
assert.notEqual(
  bulkStockpileVisualSignature(building('smithy', { water: 1 })),
  bulkStockpileVisualSignature(building('smithy')),
  'the first staged quench-water unit must raise the visible tub surface',
);
assert.notEqual(
  bulkStockpileVisualSignature(building('potter_kiln', { firewood: 1 })),
  bulkStockpileVisualSignature(building('potter_kiln')),
  'the first kiln fuel bundle must invalidate its visual signature',
);
assert.notEqual(
  bulkStockpileVisualSignature(building('potter_kiln', { water: 1 })),
  bulkStockpileVisualSignature(building('potter_kiln')),
  'the first staged puddling-water unit must raise the visible pit surface',
);
const emptySmithy = building('smithy');
const stockedSmithy = building('smithy', { charcoal: 1 });
const emptySmithySignatures = buildingMarkerSignatures(
  new Map([[emptySmithy.id, emptySmithy]]),
);
const stockedSmithySignatures = buildingMarkerSignatures(
  new Map([[stockedSmithy.id, stockedSmithy]]),
);
assert.notEqual(stockedSmithySignatures.visual, emptySmithySignatures.visual);
assert.equal(
  stockedSmithySignatures.collider,
  emptySmithySignatures.collider,
  'changing forge supplies must not rebuild building colliders',
);

const expandedEconomySource = readFileSync(
  'server/src/simulation/expanded_economy.rs',
  'utf8',
);
const simulationReducerSource = readFileSync(
  'server/src/reducers/simulation.rs',
  'utf8',
);
const rustFunctionSection = (name: string, nextName: string): string => {
  const start = expandedEconomySource.indexOf(`pub fn ${name}`);
  const end = expandedEconomySource.indexOf(`pub fn ${nextName}`, start + 1);
  assert.ok(start >= 0 && end > start, `${name} source section should exist`);
  return expandedEconomySource.slice(start, end);
};
const marketplaceMaterialDispatchStep = rustFunctionSection(
  'step_marketplace_material_dispatch',
  'step_local_material_dispatch',
);
const localMaterialDispatchStep = rustFunctionSection(
  'step_local_material_dispatch',
  'step_granary',
);
const smokehouseStep = rustFunctionSection('step_smokehouse', 'step_clay_pit');
const clayPitStep = rustFunctionSection('step_clay_pit', 'step_charcoal_burner');
const charcoalBurnerStep = rustFunctionSection('step_charcoal_burner', 'step_smithy');
const smithyStep = rustFunctionSection('step_smithy', 'step_potter_kiln');
const potterKilnStep = rustFunctionSection('step_potter_kiln', 'step_apiary');
assert.match(
  marketplaceMaterialDispatchStep,
  /compare_processor_input_dispatch_candidates/,
);
assert.match(marketplaceMaterialDispatchStep, /MARKETPLACE_MATERIAL_TARGET_KINDS/);
assert.match(
  marketplaceMaterialDispatchStep,
  /used_sources[\s\S]*used_targets[\s\S]*source_id/,
  'the authoritative pass must reserve each market cart and workshop at most once',
);
assert.match(
  marketplaceMaterialDispatchStep,
  /DISPATCHABLE_INPUTS[\s\S]*CommodityKind::RyeGrain[\s\S]*CommodityKind::Iron[\s\S]*CommodityKind::Salt[\s\S]*CommodityKind::Manure[\s\S]*CommodityKind::Polearms[\s\S]*CommodityKind::Wine/,
  'the Trading Post must route imported provisions, workshop inputs, and civic supplies',
);
assert.match(
  marketplaceMaterialDispatchStep,
  /trading_post_exports_commodity\(ctx, marketplace\.id, candidate\.commodity\)/,
  'a monthly export rule must reserve its physically staged commodity',
);
assert.doesNotMatch(
  smokehouseStep,
  /request_connected_commodity\(\s*ctx,\s*tick,\s*clock,\s*&smokehouse,\s*CommodityKind::Salt/,
  'smokehouses must not pull salt in database update order',
);
assert.doesNotMatch(
  smithyStep,
  /request_connected_commodity\(\s*ctx,\s*tick,\s*clock,\s*&building,\s*CommodityKind::Iron/,
  'smithies must not pull iron in database update order',
);
assert.doesNotMatch(
  smokehouseStep,
  /request_connected_commodity\(\s*ctx,\s*tick,\s*clock,\s*&smokehouse,\s*CommodityKind::Pottery/,
  'smokehouses must not pull pottery in database update order',
);
assert.doesNotMatch(
  smithyStep,
  /request_connected_commodity\(\s*ctx,\s*tick,\s*clock,\s*&building,\s*CommodityKind::Charcoal/,
  'smithies must not pull charcoal in database update order',
);
assert.match(
  smithyStep,
  /CommodityKind::Water,\s*SMITHY_WATER_PER_CYCLE/,
  'forging must consume water from the physical on-site quench tub',
);
assert.match(
  potterKilnStep,
  /CommodityKind::Water,\s*POTTER_WATER_PER_CYCLE/,
  'pottery must consume water from the physical on-site puddling pit',
);
assert.match(
  potterKilnStep,
  /potter_fires_roof_tiles[\s\S]*CommodityKind::RoofTiles, POTTER_ROOF_TILES_PER_CYCLE[\s\S]*step_processor/,
  'tile firing must manufacture a distinct physical output at the kiln',
);
assert.doesNotMatch(
  potterKilnStep,
  /invalidate_specialty_claims|dispatch_need/,
  'pottery production must not directly claim or deliver to households',
);
assert.doesNotMatch(
  potterKilnStep,
  /request_connected_commodity\(\s*ctx,\s*tick,\s*clock,\s*&building,\s*CommodityKind::Clay/,
  'potter kilns must not pull clay in database update order',
);
for (const [section, label] of [
  [clayPitStep, 'clay pits'],
  [charcoalBurnerStep, 'charcoal burners'],
  [smithyStep, 'smithies'],
  [potterKilnStep, 'potters'],
] as const) {
  assert.doesNotMatch(
    section,
    /dispatch_to_building\(/,
    `${label} must not reserve workshop routes one source at a time`,
  );
}
assert.match(
  localMaterialDispatchStep,
  /LOCAL_MATERIAL_SOURCE_KINDS[\s\S]*used_sources[\s\S]*used_targets/,
  'local material dispatch must reserve every producer cart and target once',
);
assert.match(
  localMaterialDispatchStep,
  /LOCAL_MATERIAL_COMMODITIES[\s\S]*CommodityKind::Iron[\s\S]*CommodityKind::Salt[\s\S]*CommodityKind::Clay[\s\S]*CommodityKind::Charcoal[\s\S]*CommodityKind::Ironwork[\s\S]*CommodityKind::Pottery/,
);
assert.match(
  localMaterialDispatchStep,
  /\("stone_quarry" \| "mine", CommodityKind::Iron\)[\s\S]*\["smithy", "trading_post"\][\s\S]*\("stone_quarry" \| "mine", CommodityKind::Salt\)[\s\S]*"pastoral_farmstead", "trading_post"/,
  'local mine carts must include selected physical market reserves after workshop buffers',
);
assert.match(
  localMaterialDispatchStep,
  /"village_storehouse", CommodityKind::Iron[\s\S]*"village_storehouse", CommodityKind::Clay[\s\S]*"village_storehouse", CommodityKind::Salt/,
  'staffed depots must re-dispatch every supported raw material already in physical storage',
);
assert.doesNotMatch(
  localMaterialDispatchStep,
  /"village_storehouse", CommodityKind::Iron[\s\S]{0,200}storehouse_accepts_iron|"village_storehouse", CommodityKind::Clay[\s\S]{0,200}storehouse_accepts_clay|"village_storehouse", CommodityKind::Salt[\s\S]{0,200}storehouse_accepts_salt/,
  'intake policy must not strand existing depot stock',
);
assert.match(
  localMaterialDispatchStep,
  /local_material_target_plan[\s\S]*normalize_marketplace_iron_target[\s\S]*normalize_marketplace_salt_target[\s\S]*local_material_dispatch_target/,
  'authoritative local routes must share the bounded workshop/reserve target policy',
);
assert.match(
  localMaterialDispatchStep,
  /CommodityKind::Ironwork[\s\S]*"stone_quarry"[\s\S]*"large_quarry"[\s\S]*"mine"[\s\S]*"clay_pit"/,
  'smithy carts must include mineral mines in the same physical replacement-tool route as other extraction sites',
);
assert.match(
  localMaterialDispatchStep,
  /\("potter_kiln", CommodityKind::Pottery\)[\s\S]*\["village_storehouse", "trading_post"\]/,
  'kiln pottery must follow the automatic local-storage-then-export route',
);
assert.doesNotMatch(localMaterialDispatchStep, /deferred_pottery|pottery_households_first/);
const generatedBuildingTable = readFileSync('src/generated/building_table.ts', 'utf8');
assert.match(
  generatedBuildingTable,
  /potteryDispatchPolicy:[\s\S]*pottery_dispatch_policy/,
);
assert.equal(existsSync('src/generated/set_pottery_dispatch_policy_reducer.ts'), false);
assert.match(
  clayPitStep,
  /let Some\(mut deposit\) = clay_deposit_beneath[\s\S]*environment\.clay_pit_throughput_multiplier\(\)\s*\*\s*clay_bank_yield_multiplier_at_deposit\(\s*building\.x,\s*building\.z,\s*world_seed,\s*world_hydrology,\s*resource_abundance,\s*&deposit/,
  'authoritative clay digging must multiply weather by the map-specific geological bank yield',
);
assert.match(
  simulationReducerSource,
  /step_clay_pit\(\s*ctx,\s*&tick,\s*&clock,\s*environment,\s*world_seed,\s*world_hydrology,\s*world_resource_abundance,\s*building/,
  'weather, map hydrology, and world resource abundance must reach every clay-pit production step',
);
assert.match(
  charcoalBurnerStep,
  /environment:\s*EnvironmentState/,
  'the authoritative charcoal step must consume the shared environment policy',
);
assert.match(
  charcoalBurnerStep,
  /step_processor_at_rate[\s\S]*environment\.charcoal_burner_throughput_multiplier\(\)/,
  'charcoal output and billet consumption must share the weather-adjusted cycle rate',
);
assert.match(
  simulationReducerSource,
  /step_charcoal_burner\(\s*ctx,\s*&tick,\s*&clock,\s*environment,\s*building/,
  'the reducer must pass current weather into every charcoal-clamp production step',
);
const clayBankPolicySource = readFileSync('src/economy/clayBankPolicy.ts', 'utf8');
const hydrologySamplerSource = readFileSync(
  'src/hydrology/sampleAuthoritativeHydrology.ts',
  'utf8',
);
const hydrologySource = readFileSync('server/src/hydrology/mod.rs', 'utf8');
const buildingToolSource = readFileSync('src/buildings/BuildingTool.ts', 'utf8');
const expandedInspectorSource = readFileSync(
  'src/resources/inspector/expandedBuildingRenderer.ts',
  'utf8',
);
const townHallSource = readFileSync('src/resources/inspector/townHallRenderer.ts', 'utf8');
assert.match(clayBankPolicySource, /sampleAuthoritativeGroundwaterScore/);
assert.doesNotMatch(
  hydrologySamplerSource,
  /import[^\n]*(?:RiverField|rivers)|hydrology_grid\.json/,
  'authoritative groundwater must not depend on surface-water representations',
);
assert.match(hydrologySamplerSource, /sampleWorldGroundwaterScore/);
assert.match(hydrologySource, /sample_world_groundwater_score/);
assert.match(clayPitStep, /fn clay_bank_yield_multiplier_at_deposit/);
assert.doesNotMatch(
  buildingToolSource,
  /geological clay yield before weather and iron tools|clay reserve remaining/,
  'clay quality and reserve forecasts should not be exposed by the placement cursor',
);
assert.match(expandedInspectorSource, /Clay seam[\s\S]*Current digging pace/);
assert.match(
  expandedInspectorSource,
  /Stopped - no physical clay deposit beneath this pit/,
  'a missing clay source must remain visible even after its crew is released',
);
assert.match(townHallSource, /average geological yield across active pits/);
assert.match(
  expandedInspectorSource,
  /Small direct-process bloomery reduces local ore or reheats imported blooms and bars/,
  'the workshop inspector must explain why mine ore and Adriatic worked iron share one normalized charge',
);
assert.match(
  townHallSource,
  /integrated bloomery-smithies reduce or reheat[\s\S]*local ore \/ imported iron charge/,
  'the settlement ledger must expose the smelting stage instead of implying ore becomes fittings directly',
);
const caravanIndex = simulationReducerSource.indexOf('step_marketplace_caravans(');
const seedDistributionIndex = simulationReducerSource.indexOf(
  'step_seed_grain_distribution(',
  caravanIndex,
);
const materialDispatchIndex = simulationReducerSource.indexOf(
  'step_marketplace_material_dispatch(',
  seedDistributionIndex,
);
const workshopStepIndex = simulationReducerSource.indexOf(
  'for (sim_kind, building_id) in expanded_ids',
  materialDispatchIndex,
);
const localMaterialDispatchIndex = simulationReducerSource.indexOf(
  'step_local_material_dispatch(',
  workshopStepIndex,
);
assert.ok(
  caravanIndex >= 0
    && seedDistributionIndex > caravanIndex
    && materialDispatchIndex > seedDistributionIndex
    && workshopStepIndex > materialDispatchIndex
    && localMaterialDispatchIndex > workshopStepIndex,
  'regional/household market work and seed recovery must retain cart precedence before workshop inputs',
);

const materialDispatchTargets = Array.from({ length: 100_000 }, (_, index) =>
  building(index % 2 === 0 ? 'smithy' : 'smokehouse', {
    id: `material-target-${index}`,
    x: 100_000 - index,
    assignedLabor: 1,
    constructionPriority: 2,
    iron: index % 2 === 0 ? SMITHY_IRON_PER_CYCLE : 0,
    salt: index % 2 === 0 ? 0 : SMOKEHOUSE_SALT_PER_CYCLE,
  }));
materialDispatchTargets.push(building('smokehouse', {
  id: 'urgent-material-target',
  x: 100_001,
  assignedLabor: 1,
  constructionPriority: 3,
  salt: 0,
}));
const materialDispatchStartedAt = performance.now();
const largeSettlementMaterialTarget = selectMarketplaceMaterialInputTarget(
  materialDispatchTargets,
  materialMarket,
  (candidate) => candidate.x,
);
const materialDispatchElapsedMs = performance.now() - materialDispatchStartedAt;
assert.equal(
  largeSettlementMaterialTarget?.target.id,
  'urgent-material-target',
  'urgent working-buffer demand must outrank an equal-runway normal-priority claim',
);
assert.ok(
  materialDispatchElapsedMs < 250,
  `100,001 imported-material dispatch candidates took ${materialDispatchElapsedMs.toFixed(1)} ms`,
);

const assignmentSources = Array.from({ length: 100 }, (_, index) =>
  building('trading_post', {
    id: `assignment-market-${index}`,
    x: index * 8,
    iron: 12,
  }));
const assignmentTargets = Array.from({ length: 1_000 }, (_, index) =>
  building('smithy', {
    id: `assignment-smithy-${index}`,
    x: index * 3,
    assignedLabor: 1,
    constructionPriority: index % 3 + 1,
    iron: index % 4,
  }));
let assignmentRouteSolves = 0;
const assignmentStartedAt = performance.now();
const largeAssignments = assignMarketplaceMaterialInputTargets(
  assignmentSources,
  assignmentTargets,
  (source, target) => {
    assignmentRouteSolves += 1;
    return Math.abs(source.x - target.x);
  },
);
const assignmentElapsedMs = performance.now() - assignmentStartedAt;
assert.equal(largeAssignments.size, assignmentSources.length);
assert.equal(
  assignmentRouteSolves,
  assignmentSources.length * assignmentTargets.length,
  'each market/workshop pair must share one route solve across candidate commodities',
);
assert.ok(
  assignmentElapsedMs < 500,
  `100,000 settlement-wide market/workshop pairs took ${assignmentElapsedMs.toFixed(1)} ms`,
);

const localAssignmentSources = Array.from({ length: 100 }, (_, index) =>
  building('clay_pit', {
    id: `local-assignment-clay-${index}`,
    x: index * 8,
    clay: 12,
  }));
const localAssignmentTargets = Array.from({ length: 1_000 }, (_, index) =>
  building('potter_kiln', {
    id: `local-assignment-potter-${index}`,
    x: index * 3,
    assignedLabor: 1,
    constructionPriority: index % 3 + 1,
    clay: index % 4,
  }));
let localAssignmentRouteSolves = 0;
const localAssignmentStartedAt = performance.now();
const largeLocalAssignments = assignLocalMaterialInputTargets(
  localAssignmentSources,
  localAssignmentTargets,
  (source, target) => {
    localAssignmentRouteSolves += 1;
    return Math.abs(source.x - target.x);
  },
);
const localAssignmentElapsedMs = performance.now() - localAssignmentStartedAt;
assert.equal(largeLocalAssignments.size, localAssignmentSources.length);
assert.equal(
  localAssignmentRouteSolves,
  localAssignmentSources.length * localAssignmentTargets.length,
);
assert.ok(
  localAssignmentElapsedMs < 500,
  `100,000 local material source/workshop pairs took ${localAssignmentElapsedMs.toFixed(1)} ms`,
);

const signatureBuildings = Array.from({ length: 100_000 }, (_, index) => {
  const kinds = [
    'clay_pit',
    'charcoal_burner',
    'smithy',
    'potter_kiln',
  ] as const;
  return building(kinds[index % kinds.length], {
    firewood: index % 55,
    ironwork: index % 73,
    iron: index % 49,
    clay: index % 73,
    charcoal: index % 73,
    pottery: index % 121,
  });
});
const signatureStartedAt = performance.now();
let signatureLength = 0;
for (const signatureBuilding of signatureBuildings) {
  signatureLength += bulkStockpileVisualSignature(signatureBuilding).length;
}
const signatureElapsedMs = performance.now() - signatureStartedAt;
assert.ok(signatureLength > 0);
assert.ok(
  signatureElapsedMs < 250,
  `100,000 material-chain visual signatures took ${signatureElapsedMs.toFixed(1)} ms`,
);

console.log(
  `Iron, clay, salt, charcoal, pottery, and roof-tile chain tests passed (${materialDispatchElapsedMs.toFixed(1)} ms / 100k target candidates; ${assignmentElapsedMs.toFixed(1)} ms / 100k market pairs; ${localAssignmentElapsedMs.toFixed(1)} ms / 100k local pairs; ${signatureElapsedMs.toFixed(1)} ms / 100k visual signatures).`,
);

function building(
  kind: BuildingKind,
  patch: Partial<BuildingState> = {},
): BuildingState {
  return {
    id: `${kind}-test`,
    kind,
    x: 0,
    z: 0,
    constructionComplete: true,
    timber: 0,
    stone: 0,
    firewood: 0,
    water: 0,
    food: 0,
    grain: 0,
    flour: 0,
    ale: 0,
    preservedFood: 0,
    honey: 0,
    wine: 0,
    ironwork: 0,
    polearms: 0,
    wool: 0,
    flax: 0,
    cloth: 0,
    iron: 0,
    clay: 0,
    salt: 0,
    charcoal: 0,
    pottery: 0,
    assignedLabor: 2,
    constructionPriority: 2,
    processorOutputTargetPercent: 100,
    ...patch,
  } as BuildingState;
}
