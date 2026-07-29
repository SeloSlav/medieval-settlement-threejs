import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import type { FireIncidentState } from '../src/fires/fireIncident.ts';
import { buildingMarkerSignatures } from '../src/buildings/buildingMarkerSignature.ts';
import {
  canStoreFullSheepClip,
  projectedSheepFleece,
  sheepFleeceOutput,
} from '../src/economy/livestockPolicy.ts';
import {
  computeSettlementTextilePlan,
  textileChainBalanceLabel,
} from '../src/economy/settlementTextiles.ts';
import {
  productionRoadBranchKey,
  type ProsperityRoadBranch,
} from '../src/economy/settlementProduction.ts';
import {
  normalizeWeaverInputPolicy,
  WEAVER_INPUT_POLICY_AUTO,
  WEAVER_INPUT_POLICY_FLAX_FIRST,
  WEAVER_INPUT_POLICY_WOOL_FIRST,
  weaverFibreDeliveryPreferenceLabel,
  weaverFibreDeliveryPreferenceRank,
  weaverUsesFlax,
} from '../src/economy/weaverInputPolicy.ts';
import {
  BUILDING_STORAGE_CAPS,
  RESIDENCE_CLOTH_CAPACITY,
  RESIDENCE_CLOTH_PER_PERSON_PER_SEC,
  SHEEP_SHEARING_END_MONTH,
  SHEEP_SHEARING_START_MONTH,
  SHEEP_WOOL_PER_SHEARING_PER_HEAD,
  SPECIALTY_EXPORT_GOLD_PER_CLOTH,
  TEXTILE_TRANSFER_PER_TRIP,
  WEAVER_CLOTH_PER_CYCLE,
  WEAVER_FLAX_PER_CYCLE,
  WEAVER_FLAX_WATER_PER_CYCLE,
  WEAVER_WOOL_PER_CYCLE,
} from '../src/generated/gameBalance.ts';
import {
  cargoKindFromId,
  cargoKindLabel,
} from '../src/logistics/deliveryTrips.ts';
import {
  createDefaultNeeds,
  needKindFromId,
} from '../src/residences/residenceNeedState.ts';
import { getBuildingDefinition } from '../src/resources/buildings.ts';
import { getBuildingProcessorStatus } from '../src/resources/inspector/buildingProcessorStatus.ts';
import { renderProcessorOutputTargetPanel } from '../src/resources/inspector/expandedBuildingRenderer.ts';
import { renderSettlementTextileRows } from '../src/resources/inspector/townHallRenderer.ts';
import {
  createEmptyStockpile,
  type BuildingState,
  type LivestockHerdState,
  type ResidenceState,
} from '../src/resources/types.ts';
import type { WorldQueries } from '../src/resources/WorldQueries.ts';
import {
  BUILD_MENU_ENTRIES,
  RURAL_INDUSTRY_BUILD_MENU_ENTRIES,
  renderBuildMenuCards,
} from '../src/ui/buildMenuCards.ts';

function weaver(partial: Partial<BuildingState> = {}): BuildingState {
  return {
    id: 'weaver-1',
    kind: 'weaver',
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
    cloth: 0,
    gold: 0,
    waterCapacity: 0,
    assignedLabor: 1,
    constructionComplete: true,
    ...partial,
  };
}

assert.equal(SHEEP_SHEARING_START_MONTH, 6);
assert.equal(SHEEP_SHEARING_END_MONTH, 7);
assert.equal(SHEEP_WOOL_PER_SHEARING_PER_HEAD, 3);
assert.equal(WEAVER_WOOL_PER_CYCLE, 3);
assert.equal(WEAVER_FLAX_PER_CYCLE, 3);
assert.equal(WEAVER_FLAX_WATER_PER_CYCLE, 1);
assert.equal(WEAVER_CLOTH_PER_CYCLE, 2);
assert.equal(TEXTILE_TRANSFER_PER_TRIP, 12);
assert.equal(SPECIALTY_EXPORT_GOLD_PER_CLOTH, 1.5);
assert.equal(RESIDENCE_CLOTH_CAPACITY, 8);
assert.equal(RESIDENCE_CLOTH_PER_PERSON_PER_SEC, 0.00018);
assert.equal(BUILDING_STORAGE_CAPS.pastoral_farmstead.wool, 120);
assert.equal(BUILDING_STORAGE_CAPS.weaver.wool, 90);
assert.equal(BUILDING_STORAGE_CAPS.weaver.flax, 90);
assert.equal(BUILDING_STORAGE_CAPS.weaver.water, 24);
assert.equal(BUILDING_STORAGE_CAPS.threshing_barn.flax, 180);
assert.equal(BUILDING_STORAGE_CAPS.weaver.cloth, 90);
assert.equal(BUILDING_STORAGE_CAPS.marketplace.cloth, 120);
assert.equal(sheepFleeceOutput(4.5), 13.5);
assert.equal(
  projectedSheepFleece({
    headCount: 6,
    suppliedCapacity: 5,
    health: 0.8,
  }),
  12,
);
assert.equal(canStoreFullSheepClip(18, 18), true);
assert.equal(canStoreFullSheepClip(18, 17.99), false);

const definition = getBuildingDefinition('weaver');
assert.equal(definition.maxLabor, 2);
assert.equal(definition.requiresRoad, true);
assert.equal(definition.facesRoad, true);
assert.ok(RURAL_INDUSTRY_BUILD_MENU_ENTRIES.some((entry) => entry.artKey === 'weaver'));
assert.ok(BUILD_MENU_ENTRIES.some((entry) => entry.artKey === 'weaver'));
assert.match(renderBuildMenuCards(), /weaver\.webp/);

assert.equal(cargoKindFromId(13), 'wool');
assert.equal(cargoKindFromId(14), 'cloth');
assert.equal(cargoKindFromId(18), 'flax');
assert.equal(cargoKindLabel('wool'), 'Wool fleece');
assert.equal(cargoKindLabel('flax'), 'Flax fibre');
assert.equal(cargoKindLabel('cloth'), 'Cloth');
assert.equal(needKindFromId(14), 'cloth');
assert.equal(createDefaultNeeds().cloth.stock, 0);
assert.equal(normalizeWeaverInputPolicy(undefined), WEAVER_INPUT_POLICY_AUTO);
assert.equal(normalizeWeaverInputPolicy(99), WEAVER_INPUT_POLICY_AUTO);
assert.equal(
  weaverFibreDeliveryPreferenceRank(WEAVER_INPUT_POLICY_WOOL_FIRST, 'wool'),
  0,
);
assert.equal(
  weaverFibreDeliveryPreferenceRank(WEAVER_INPUT_POLICY_FLAX_FIRST, 'flax'),
  0,
);
assert.equal(
  weaverFibreDeliveryPreferenceRank(WEAVER_INPUT_POLICY_AUTO, 'wool'),
  1,
);
assert.equal(
  weaverFibreDeliveryPreferenceRank(WEAVER_INPUT_POLICY_WOOL_FIRST, 'flax'),
  2,
);
assert.equal(weaverFibreDeliveryPreferenceRank(99, 'flax'), 1);
assert.equal(
  weaverFibreDeliveryPreferenceLabel(WEAVER_INPUT_POLICY_WOOL_FIRST, 'wool'),
  'Wool first match',
);
assert.equal(
  weaverFibreDeliveryPreferenceLabel(WEAVER_INPUT_POLICY_WOOL_FIRST, 'flax'),
  'Fallback route',
);
assert.equal(
  weaverUsesFlax(weaver({
    wool: WEAVER_WOOL_PER_CYCLE,
    flax: WEAVER_FLAX_PER_CYCLE * 2,
    water: WEAVER_FLAX_WATER_PER_CYCLE * 2,
    weaverInputPolicy: WEAVER_INPUT_POLICY_WOOL_FIRST,
  })),
  false,
);
assert.equal(
  weaverUsesFlax(weaver({
    wool: WEAVER_WOOL_PER_CYCLE * 2,
    flax: WEAVER_FLAX_PER_CYCLE,
    water: WEAVER_FLAX_WATER_PER_CYCLE,
    weaverInputPolicy: WEAVER_INPUT_POLICY_FLAX_FIRST,
  })),
  true,
);
assert.equal(
  weaverUsesFlax(weaver({
    wool: WEAVER_WOOL_PER_CYCLE,
    flax: WEAVER_FLAX_PER_CYCLE,
    water: 0,
    weaverInputPolicy: WEAVER_INPUT_POLICY_FLAX_FIRST,
  })),
  false,
  'flax-first should fall back to a complete wool cycle instead of idling',
);

const worldQueries = {} as WorldQueries;
assert.match(
  getBuildingProcessorStatus(weaver(), worldQueries)?.statusText ?? '',
  /Waiting for wool/,
);
assert.equal(
  getBuildingProcessorStatus(
    weaver({ wool: WEAVER_WOOL_PER_CYCLE }),
    worldQueries,
  )?.statusText,
  'Weaving wool into cloth',
);
assert.equal(
  getBuildingProcessorStatus(
    weaver({ wool: WEAVER_WOOL_PER_CYCLE, cloth: BUILDING_STORAGE_CAPS.weaver.cloth }),
    worldQueries,
  )?.statusText,
  'Cloth target reached - weaving paused',
);
const flaxWorldQueries = {
  getRoadConnectedWells: () => [weaver({ id: 'well-1', kind: 'well', water: 8 })],
  getInboundSupplyTrip: () => null,
  getRoadPathDistance: () => 20,
} as unknown as WorldQueries;
assert.equal(
  getBuildingProcessorStatus(
    weaver({ flax: WEAVER_FLAX_PER_CYCLE, water: WEAVER_FLAX_WATER_PER_CYCLE }),
    flaxWorldQueries,
  )?.statusText,
  'Preparing flax and weaving linen cloth',
);
const policyStatus = getBuildingProcessorStatus(
  weaver({
    wool: WEAVER_WOOL_PER_CYCLE,
    flax: WEAVER_FLAX_PER_CYCLE,
    water: WEAVER_FLAX_WATER_PER_CYCLE,
    weaverInputPolicy: WEAVER_INPUT_POLICY_FLAX_FIRST,
  }),
  flaxWorldQueries,
);
assert.equal(policyStatus?.statusText, 'Preparing flax and weaving linen cloth');
assert.match(policyStatus?.waterDetailHtml ?? '', /Input policy<\/span><span>Flax first/);
assert.match(policyStatus?.waterDetailHtml ?? '', /Selected textile route<\/span><span>Flax \+ hauled water/);
const policyPanel = renderProcessorOutputTargetPanel(weaver());
assert.match(policyPanel ?? '', /data-weaver-input-policy="0"[^>]*disabled/);
assert.match(policyPanel ?? '', /data-weaver-input-policy="1"/);
assert.match(policyPanel ?? '', /data-weaver-input-policy="2"/);
assert.match(policyPanel ?? '', /Matching specialization then wins a contested working-buffer cart/);
assert.match(policyPanel ?? '', /Covered buffers and ready alternate recipes remain fallbacks/);

const emptyVisual = buildingMarkerSignatures(
  new Map([['weaver-1', weaver()]]),
).visual;
const firstBundle = buildingMarkerSignatures(
  new Map([['weaver-1', weaver({ wool: 1 })]]),
).visual;
const sameBundle = buildingMarkerSignatures(
  new Map([['weaver-1', weaver({ wool: 2 })]]),
).visual;
const firstClothBundle = buildingMarkerSignatures(
  new Map([['weaver-1', weaver({ wool: 2, cloth: 1 })]]),
).visual;
const firstFlaxBundle = buildingMarkerSignatures(
  new Map([['weaver-1', weaver({ flax: 1 })]]),
).visual;
assert.notEqual(firstBundle, emptyVisual);
assert.equal(
  sameBundle,
  firstBundle,
  'small textile stock changes inside one bundle must not rebuild the workshop mesh',
);
assert.notEqual(firstClothBundle, sameBundle);
assert.notEqual(firstFlaxBundle, emptyVisual);

const textileState = {
  stockpile: createEmptyStockpile(),
  buildings: new Map<string, BuildingState>(),
  livestockHerds: new Map<string, LivestockHerdState>(),
  residences: new Map<string, ResidenceState>(),
  deliveryTrips: new Map<string, import('../src/logistics/deliveryTrips.ts').DeliveryTripState>(),
};
textileState.stockpile.wool = 2;
textileState.stockpile.cloth = 1;
const storageBlockedHolding = weaver({
  id: 'sheep-storage-blocked',
  kind: 'pastoral_farmstead',
  assignedLabor: 1,
  wool: 110,
});
const readyHolding = weaver({
  id: 'sheep-ready',
  kind: 'pastoral_farmstead',
  assignedLabor: 1,
  wool: 0,
});
const unstaffedHolding = weaver({
  id: 'sheep-unstaffed',
  kind: 'pastoral_farmstead',
  assignedLabor: 0,
  wool: 0,
});
const staffedWeaver = weaver({ wool: 4, cloth: 5 });
textileState.buildings.set(storageBlockedHolding.id, storageBlockedHolding);
textileState.buildings.set(readyHolding.id, readyHolding);
textileState.buildings.set(unstaffedHolding.id, unstaffedHolding);
textileState.buildings.set(staffedWeaver.id, staffedWeaver);
textileState.livestockHerds.set(
  storageBlockedHolding.id,
  sheepHerd(storageBlockedHolding.id),
);
textileState.livestockHerds.set(
  readyHolding.id,
  sheepHerd(readyHolding.id, { lastShearingYear: 2, lastWoolOutput: 15 }),
);
textileState.livestockHerds.set(
  unstaffedHolding.id,
  sheepHerd(unstaffedHolding.id),
);
const prosperousHome = textileResidence('prosperous-home', 5, 3);
prosperousHome.needs.cloth = { stock: 3, deficitTicks: 0 };
textileState.residences.set(prosperousHome.id, prosperousHome);
textileState.deliveryTrips.set(
  'wool-cart',
  textileTrip('wool-cart', 'wool', 6, 'outbound'),
);
textileState.deliveryTrips.set(
  'cloth-cart',
  textileTrip('cloth-cart', 'cloth', 2, 'unloading'),
);
textileState.deliveryTrips.set(
  'returning-cloth-cart',
  textileTrip('returning-cloth-cart', 'cloth', 99, 'inbound'),
);

const annualTextiles = computeSettlementTextilePlan({
  state: textileState,
  clock: { month: 6, year: 2 },
  production: {
    clothWoolPerDay: 1,
    clothOutputPerDay: 2 / 3,
    clothDemandPerDay: 0.05,
  },
});
assert.equal(annualTextiles.sheepHoldings, 3);
assert.equal(annualTextiles.staffedSheepHoldings, 2);
assert.equal(annualTextiles.fireDisabledSheepHoldings, 0);
assert.equal(annualTextiles.sheepHeadCount, 18);
assert.equal(annualTextiles.shornHoldings, 1);
assert.equal(annualTextiles.pendingHoldings, 2);
assert.equal(annualTextiles.readyPendingHoldings, 0);
assert.equal(annualTextiles.storageBlockedHoldings, 1);
assert.equal(annualTextiles.staffingBlockedHoldings, 1);
assert.equal(annualTextiles.projectedAnnualWool, 51);
assert.equal(annualTextiles.securedAnnualWool, 15);
assert.equal(annualTextiles.annualWoolAtRisk, 36);
assert.equal(annualTextiles.firstAttentionBuildingId, storageBlockedHolding.id);
assert.equal(annualTextiles.firstAttentionKind, 'storage');
assert.equal(annualTextiles.woolInTransit, 6);
assert.equal(annualTextiles.woolStock, 122);
assert.equal(annualTextiles.clothInTransit, 2);
assert.equal(annualTextiles.clothStock, 11);
const physicalTextiles = computeSettlementTextilePlan({
  state: {
    ...textileState,
    physicalFoundingSiteEnabled: true,
  },
  clock: { month: 6, year: 2 },
  production: {
    clothWoolPerDay: 1,
    clothOutputPerDay: 2 / 3,
    clothDemandPerDay: 0.05,
  },
});
assert.equal(physicalTextiles.woolStock, 120);
assert.equal(physicalTextiles.clothStock, 10);
assert.equal(annualTextiles.householdClothStock, 3);
assert.equal(annualTextiles.supplierClothStock, 5);
assert.equal(annualTextiles.householdClothInTransit, 0);
assert.equal(annualTextiles.fireDisabledWeavers, 0);
assert.equal(annualTextiles.fireDisabledProsperousHomes, 0);
assert.equal(annualTextiles.fireQuarantinedClothStock, 0);
assert.equal(annualTextiles.serviceableHouseholdClothStock, 8);
assert.equal(annualTextiles.unavailableHouseholdClothStock, 3);
assert.equal(annualTextiles.clothReserveRunwayDays, 160);
assert.equal(annualTextiles.annualClothPotential, 34);
assert.equal(annualTextiles.annualHouseholdClothDemand, 6);
assert.equal(annualTextiles.annualClothBalance, 28);
assert.equal(annualTextiles.roadPlan, null);
assert.match(textileChainBalanceLabel(annualTextiles), /covered/);

const missedTextiles = computeSettlementTextilePlan({
  state: textileState,
  clock: { month: 8, year: 2 },
  production: {
    clothWoolPerDay: 1,
    clothOutputPerDay: 2 / 3,
    clothDemandPerDay: 0.5,
  },
});
assert.equal(missedTextiles.missedHoldings, 2);
assert.equal(missedTextiles.pendingHoldings, 0);
assert.equal(missedTextiles.securedAnnualWool, 15);
assert.match(textileChainBalanceLabel(missedTextiles), /Raw-fibre-limited/);

const textileRoadKey = (component: number): string =>
  productionRoadBranchKey(component, 'building', `branch-${component}`);
const roadTextileState = {
  stockpile: createEmptyStockpile(),
  buildings: new Map<string, BuildingState>(),
  livestockHerds: new Map<string, LivestockHerdState>(),
  residences: new Map<string, ResidenceState>(),
  deliveryTrips: new Map<string, import('../src/logistics/deliveryTrips.ts').DeliveryTripState>(),
};
const westSheep = weaver({
  id: 'west-sheep',
  kind: 'pastoral_farmstead',
  x: 0,
});
const eastSheep = weaver({
  id: 'east-sheep',
  kind: 'pastoral_farmstead',
  x: 100,
});
roadTextileState.buildings.set(westSheep.id, westSheep);
roadTextileState.buildings.set(eastSheep.id, eastSheep);
roadTextileState.livestockHerds.set(
  westSheep.id,
  sheepHerd(westSheep.id, { lastShearingYear: 2, lastWoolOutput: 12 }),
);
roadTextileState.livestockHerds.set(
  eastSheep.id,
  sheepHerd(eastSheep.id, { lastShearingYear: 2, lastWoolOutput: 12 }),
);
const westHome = textileResidence('west-home', 1, 3);
westHome.x = 0;
westHome.needs.cloth = { stock: 2, deficitTicks: 0 };
const eastHome = textileResidence('east-home', 1, 3);
eastHome.x = 100;
eastHome.needs.cloth = { stock: 1, deficitTicks: 0 };
roadTextileState.residences.set(westHome.id, westHome);
roadTextileState.residences.set(eastHome.id, eastHome);
const westClothWeaver = weaver({
  id: 'west-cloth-weaver',
  x: 0,
  cloth: 4,
});
const remoteClothWeaver = weaver({
  id: 'remote-cloth-weaver',
  x: 200,
  cloth: 6,
});
const idleEastClothWeaver = weaver({
  id: 'idle-east-cloth-weaver',
  x: 100,
  assignedLabor: 0,
  cloth: 5,
});
roadTextileState.buildings.set(westClothWeaver.id, westClothWeaver);
roadTextileState.buildings.set(remoteClothWeaver.id, remoteClothWeaver);
roadTextileState.buildings.set(idleEastClothWeaver.id, idleEastClothWeaver);
const approachingEastCloth = textileTrip(
  'approaching-east-cloth',
  'cloth',
  2,
  'outbound',
);
approachingEastCloth.destinationKind = 'residence';
approachingEastCloth.targetBuildingId = null;
approachingEastCloth.residenceId = eastHome.id;
roadTextileState.deliveryTrips.set(
  approachingEastCloth.id,
  approachingEastCloth,
);

const splitTextileBranches = new Map<string, ProsperityRoadBranch>([
  [textileRoadKey(1), {
    currentResidents: 1,
    fullResidents: 1,
    preservedFoodOutputPerDay: 0,
    aleOutputPerDay: 0,
    clothOutputPerDay: 8 / 120,
    firstResidenceId: westHome.id,
  }],
  [textileRoadKey(2), {
    currentResidents: 1,
    fullResidents: 1,
    preservedFoodOutputPerDay: 0,
    aleOutputPerDay: 0,
    clothOutputPerDay: 0,
    firstResidenceId: eastHome.id,
  }],
  [textileRoadKey(3), {
    currentResidents: 0,
    fullResidents: 0,
    preservedFoodOutputPerDay: 0,
    aleOutputPerDay: 0,
    clothOutputPerDay: 8 / 120,
    firstResidenceId: null,
  }],
]);
const splitRoadTextiles = computeSettlementTextilePlan({
  state: roadTextileState,
  clock: { month: 6, year: 2 },
  production: {
    clothWoolPerDay: 24 / 120,
    clothOutputPerDay: 16 / 120,
    clothDemandPerDay: 8 / 120,
    tierThreeResidents: 2,
    prosperityRoadBranches: splitTextileBranches,
  },
  roadComponentFor: (candidate) =>
    candidate.x < 50 ? 1 : candidate.x < 150 ? 2 : 3,
});
assert.equal(splitRoadTextiles.annualClothPotential, 16);
assert.equal(splitRoadTextiles.roadPlan?.activeBranches, 3);
assert.equal(splitRoadTextiles.roadPlan?.fleeceBranches, 2);
assert.equal(splitRoadTextiles.roadPlan?.loomBranches, 2);
assert.equal(splitRoadTextiles.roadPlan?.matchedBranches, 1);
assert.equal(splitRoadTextiles.roadPlan?.projectedAnnualWool, 24);
assert.equal(splitRoadTextiles.roadPlan?.roadMatchedAnnualClothPotential, 8);
assert.equal(splitRoadTextiles.roadPlan?.fragmentationClothPotential, 8);
assert.equal(splitRoadTextiles.roadPlan?.annualHouseholdClothDemand, 8);
assert.equal(splitRoadTextiles.roadPlan?.coveredHouseholdClothDemand, 4);
assert.equal(splitRoadTextiles.roadPlan?.annualHouseholdClothShortfall, 4);
assert.equal(splitRoadTextiles.roadPlan?.annualExportableClothSurplus, 4);
assert.equal(splitRoadTextiles.roadPlan?.exposedHouseholdBranches, 1);
assert.equal(splitRoadTextiles.householdClothStock, 3);
assert.equal(splitRoadTextiles.supplierClothStock, 10);
assert.equal(splitRoadTextiles.householdClothInTransit, 2);
assert.equal(splitRoadTextiles.serviceableHouseholdClothStock, 9);
assert.equal(splitRoadTextiles.unavailableHouseholdClothStock, 11);
assert.equal(splitRoadTextiles.clothReserveRunwayDays, 90);
assert.equal(splitRoadTextiles.roadPlan?.householdBranches, 2);
assert.equal(splitRoadTextiles.roadPlan?.stockedSupplierBranches, 1);
assert.equal(splitRoadTextiles.roadPlan?.unservedHouseholdBranches, 1);
assert.equal(splitRoadTextiles.roadPlan?.reserveWarningBranches, 0);
assert.equal(splitRoadTextiles.roadPlan?.serviceableClothStock, 9);
assert.equal(
  splitRoadTextiles.roadPlan?.worstHouseholdClothRunwayDays,
  90,
);
assert.equal(
  splitRoadTextiles.roadPlan?.firstReserveExposedResidenceId,
  eastHome.id,
);
assert.equal(splitRoadTextiles.roadPlan?.firstExposedResidenceId, eastHome.id);
assert.equal(
  splitRoadTextiles.roadPlan?.firstImbalancedBuildingId,
  eastSheep.id,
);
assert.match(textileChainBalanceLabel(splitRoadTextiles), /Road-limited/);
const splitTextileRows = renderSettlementTextileRows(splitRoadTextiles);
assert.match(splitTextileRows, /1 \/ 3 active branches/);
assert.match(splitTextileRows, /8\.0 \/ 16\.0 cloth\/year physically paired/);
assert.match(splitTextileRows, /8\.0 cloth\/year stranded/);
assert.match(splitTextileRows, /4\.0 local shortfall/);
assert.match(splitTextileRows, /data-inspect-residence="east-home"/);
assert.match(splitTextileRows, /1 \/ 2 current household branches/);
assert.match(splitTextileRows, /9\.0 cloth in local cupboards/);
assert.match(splitTextileRows, /weakest reserve 90 days/);
assert.match(
  splitTextileRows,
  /11\.0 in treasury, export, fire quarantine, idle, or disconnected stores/,
);

const fireAwareTextiles = computeSettlementTextilePlan({
  state: {
    ...roadTextileState,
    fireIncidents: new Map([
      ['west-sheep-fire', {
        id: 'west-sheep-fire',
        targetKind: 'building',
        targetId: westSheep.id,
      } as FireIncidentState],
      ['west-weaver-fire', {
        id: 'west-weaver-fire',
        targetKind: 'building',
        targetId: westClothWeaver.id,
      } as FireIncidentState],
      ['east-home-fire', {
        id: 'east-home-fire',
        targetKind: 'residence',
        targetId: eastHome.id,
      } as FireIncidentState],
    ]),
  },
  clock: { month: 6, year: 2 },
  production: {
    clothWoolPerDay: 12 / 120,
    clothOutputPerDay: 8 / 120,
    clothDemandPerDay: 4 / 120,
    tierThreeResidents: 1,
    prosperityRoadBranches: new Map([
      [textileRoadKey(1), {
        currentResidents: 1,
        fullResidents: 1,
        preservedFoodOutputPerDay: 0,
        aleOutputPerDay: 0,
        clothOutputPerDay: 0,
        firstResidenceId: westHome.id,
      }],
    ]),
  },
  roadComponentFor: (candidate) =>
    candidate.x < 50 ? 1 : candidate.x < 150 ? 2 : 3,
});
assert.equal(fireAwareTextiles.fireDisabledSheepHoldings, 1);
assert.equal(fireAwareTextiles.staffedSheepHoldings, 1);
assert.equal(fireAwareTextiles.securedAnnualWool, 12);
assert.equal(fireAwareTextiles.firstAttentionKind, 'fire');
assert.equal(fireAwareTextiles.firstAttentionBuildingId, westSheep.id);
assert.equal(fireAwareTextiles.fireDisabledWeavers, 1);
assert.equal(fireAwareTextiles.fireDisabledProsperousHomes, 1);
assert.equal(fireAwareTextiles.fireQuarantinedClothStock, 7);
assert.equal(fireAwareTextiles.householdClothStock, 2);
assert.equal(fireAwareTextiles.householdClothInTransit, 0);
assert.equal(fireAwareTextiles.roadPlan?.householdBranches, 1);
assert.match(renderSettlementTextileRows(fireAwareTextiles), /Textile fire outages/);
assert.match(renderSettlementTextileRows(fireAwareTextiles), /7\.0 cloth/);
assert.match(renderSettlementTextileRows(fireAwareTextiles), /first fire-disabled sheep holding/);

const joinedRoadTextiles = computeSettlementTextilePlan({
  state: roadTextileState,
  clock: { month: 6, year: 2 },
  production: {
    clothWoolPerDay: 24 / 120,
    clothOutputPerDay: 16 / 120,
    clothDemandPerDay: 8 / 120,
    tierThreeResidents: 2,
    prosperityRoadBranches: new Map([
      [textileRoadKey(1), {
        currentResidents: 2,
        fullResidents: 2,
        preservedFoodOutputPerDay: 0,
        aleOutputPerDay: 0,
        clothOutputPerDay: 16 / 120,
        firstResidenceId: westHome.id,
      }],
    ]),
  },
  roadComponentFor: () => 1,
});
assert.equal(joinedRoadTextiles.roadPlan?.activeBranches, 1);
assert.equal(joinedRoadTextiles.roadPlan?.matchedBranches, 1);
assert.equal(joinedRoadTextiles.roadPlan?.roadMatchedAnnualClothPotential, 16);
assert.equal(joinedRoadTextiles.roadPlan?.fragmentationClothPotential, 0);
assert.equal(joinedRoadTextiles.roadPlan?.coveredHouseholdClothDemand, 8);
assert.equal(joinedRoadTextiles.roadPlan?.annualHouseholdClothShortfall, 0);
assert.equal(joinedRoadTextiles.roadPlan?.annualExportableClothSurplus, 8);
assert.equal(joinedRoadTextiles.serviceableHouseholdClothStock, 15);
assert.equal(joinedRoadTextiles.unavailableHouseholdClothStock, 5);
assert.equal(joinedRoadTextiles.roadPlan?.stockedSupplierBranches, 1);
assert.equal(joinedRoadTextiles.roadPlan?.unservedHouseholdBranches, 0);
assert.equal(joinedRoadTextiles.roadPlan?.worstHouseholdClothRunwayDays, 225);
assert.match(
  renderSettlementTextileRows(joinedRoadTextiles),
  /no cloth capacity stranded by topology/,
);

const satelliteRoadTextiles = computeSettlementTextilePlan({
  state: roadTextileState,
  clock: { month: 6, year: 2 },
  production: {
    clothWoolPerDay: 24 / 120,
    clothOutputPerDay: 16 / 120,
    clothDemandPerDay: 8 / 120,
    tierThreeResidents: 2,
    prosperityRoadBranches: new Map([
      [textileRoadKey(1), {
        currentResidents: 1,
        fullResidents: 1,
        preservedFoodOutputPerDay: 0,
        aleOutputPerDay: 0,
        clothOutputPerDay: 8 / 120,
        firstResidenceId: westHome.id,
      }],
      [textileRoadKey(2), {
        currentResidents: 1,
        fullResidents: 1,
        preservedFoodOutputPerDay: 0,
        aleOutputPerDay: 0,
        clothOutputPerDay: 8 / 120,
        firstResidenceId: eastHome.id,
      }],
    ]),
  },
  roadComponentFor: (candidate) => candidate.x < 50 ? 1 : 2,
});
assert.equal(satelliteRoadTextiles.roadPlan?.activeBranches, 2);
assert.equal(satelliteRoadTextiles.roadPlan?.matchedBranches, 2);
assert.equal(satelliteRoadTextiles.roadPlan?.roadMatchedAnnualClothPotential, 16);
assert.equal(satelliteRoadTextiles.roadPlan?.fragmentationClothPotential, 0);
assert.equal(satelliteRoadTextiles.roadPlan?.annualHouseholdClothShortfall, 0);
assert.equal(satelliteRoadTextiles.roadPlan?.annualExportableClothSurplus, 8);
assert.equal(satelliteRoadTextiles.serviceableHouseholdClothStock, 15);
assert.equal(satelliteRoadTextiles.unavailableHouseholdClothStock, 5);
assert.equal(satelliteRoadTextiles.roadPlan?.stockedSupplierBranches, 2);
assert.equal(satelliteRoadTextiles.roadPlan?.unservedHouseholdBranches, 0);

const perfTextiles = {
  stockpile: createEmptyStockpile(),
  buildings: new Map<string, BuildingState>(),
  livestockHerds: new Map<string, LivestockHerdState>(),
  residences: new Map<string, ResidenceState>(),
  deliveryTrips: new Map<string, import('../src/logistics/deliveryTrips.ts').DeliveryTripState>(),
};
for (let index = 0; index < 100_000; index += 1) {
  const id = `sheep-${index}`;
  perfTextiles.buildings.set(
    id,
    weaver({
      id,
      kind: 'pastoral_farmstead',
      x: index % 200,
      wool: index % 2 === 0 ? 0 : 110,
    }),
  );
  perfTextiles.livestockHerds.set(id, sheepHerd(id));
}
const textilePerfStarted = performance.now();
const largeTextilePlan = computeSettlementTextilePlan({
  state: perfTextiles,
  clock: { month: 6, year: 2 },
  production: {
    clothWoolPerDay: 100_000,
    clothOutputPerDay: 200_000 / 3,
    clothDemandPerDay: 1,
  },
});
const textilePerfElapsedMs = performance.now() - textilePerfStarted;
assert.equal(largeTextilePlan.sheepHoldings, 100_000);
assert.equal(largeTextilePlan.storageBlockedHoldings, 50_000);
assert.equal(largeTextilePlan.readyPendingHoldings, 50_000);
assert.equal(largeTextilePlan.roadPlan, null);
assert.ok(
  textilePerfElapsedMs < 350,
  `100,000-holding textile plan took ${textilePerfElapsedMs.toFixed(1)} ms`,
);

const perfRoadBranches = new Map<string, ProsperityRoadBranch>();
for (let component = 0; component < 200; component += 1) {
  perfRoadBranches.set(textileRoadKey(component), {
    currentResidents: 0,
    fullResidents: 0,
    preservedFoodOutputPerDay: 0,
    aleOutputPerDay: 0,
    clothOutputPerDay: 50,
    firstResidenceId: null,
  });
}
const roadTextilePerfStarted = performance.now();
const largeRoadTextilePlan = computeSettlementTextilePlan({
  state: perfTextiles,
  clock: { month: 6, year: 2 },
  production: {
    clothWoolPerDay: 15_000,
    clothOutputPerDay: 10_000,
    clothDemandPerDay: 0,
    tierThreeResidents: 0,
    prosperityRoadBranches: perfRoadBranches,
  },
  roadComponentFor: (candidate) => candidate.x,
});
const roadTextilePerfElapsedMs = performance.now() - roadTextilePerfStarted;
assert.equal(largeRoadTextilePlan.roadPlan?.activeBranches, 200);
assert.equal(largeRoadTextilePlan.roadPlan?.matchedBranches, 200);
assert.equal(largeRoadTextilePlan.roadPlan?.householdBranches, 0);
assert.equal(
  largeRoadTextilePlan.roadPlan?.roadMatchedAnnualClothPotential,
  1_200_000,
);
assert.equal(largeRoadTextilePlan.roadPlan?.fragmentationClothPotential, 0);
assert.ok(
  roadTextilePerfElapsedMs < 450,
  `100,000-holding / 200-branch textile plan took ${roadTextilePerfElapsedMs.toFixed(1)} ms`,
);

const livestockSimulation = readFileSync('server/src/simulation/livestock.rs', 'utf8');
const expandedEconomy = readFileSync('server/src/simulation/expanded_economy.rs', 'utf8');
const marketplaceCaravan = readFileSync(
  'server/src/simulation/marketplace_caravan.rs',
  'utf8',
);
const commodities = readFileSync('server/src/economy/commodities.rs', 'utf8');
const residenceNeedState = readFileSync(
  'server/src/simulation/residence_needs/state.rs',
  'utf8',
);
const buildingReducers = readFileSync('server/src/reducers/buildings.rs', 'utf8');
const buildingTable = readFileSync('server/src/tables.rs', 'utf8');
const generatedBuildingTable = readFileSync('src/generated/building_table.ts', 'utf8');
const generatedWeaverPolicyReducer = readFileSync(
  'src/generated/set_weaver_input_policy_reducer.ts',
  'utf8',
);
assert.match(livestockSimulation, /herd\.last_shearing_year != clock\.year/);
assert.match(livestockSimulation, /can_store_full_sheep_clip/);
assert.match(livestockSimulation, /deposit_building_commodity\(building, CommodityKind::Wool/);
assert.match(livestockSimulation, /CommodityKind::Wool,[\s\S]{0,120}&\["weaver"\]/);
assert.doesNotMatch(livestockSimulation, /credit_treasury_gold/);
assert.match(expandedEconomy, /pub fn step_weaver/);
assert.match(
  expandedEconomy,
  /CommodityKind::Flax, WEAVER_FLAX_PER_CYCLE[\s\S]*CommodityKind::Water[\s\S]*WEAVER_FLAX_WATER_PER_CYCLE[\s\S]*CommodityKind::Cloth, WEAVER_CLOTH_PER_CYCLE/,
);
assert.match(expandedEconomy, /CommodityKind::Wool, WEAVER_WOOL_PER_CYCLE/);
assert.match(
  expandedEconomy,
  /weaver_uses_flax\([\s\S]*building\.weaver_input_policy[\s\S]*WEAVER_FLAX_WATER_PER_CYCLE/,
);
assert.match(
  expandedEconomy,
  /weaver_fibre_delivery_preference_rank\([\s\S]*target\.weaver_input_policy/,
);
assert.match(
  expandedEconomy,
  /FarmCropProduce::Fibre => Some\(CommodityKind::Flax\)/,
);
assert.match(expandedEconomy, /CommodityKind::Cloth,[\s\S]{0,120}&\["marketplace"\]/);
assert.match(
  expandedEconomy,
  /step_weaver[\s\S]*dispatch_need\([\s\S]*ResidenceNeedKind::Cloth[\s\S]*dispatch_to_building\(/,
  'weavers must dispatch to claimed homes before exporting remaining cloth',
);
assert.match(
  expandedEconomy,
  /starting_cloth <= 1e-6[\s\S]*ctx\.db\.building\(\)\.id\(\)\.update\(weaver\.clone\(\)\)[\s\S]*invalidate_specialty_claims[\s\S]*ResidenceNeedKind::Cloth/,
  'the first woven batch must be visible when household territory claims are built',
);
assert.match(marketplaceCaravan, /CommodityKind::Cloth, SPECIALTY_EXPORT_GOLD_PER_CLOTH/);
assert.match(commodities, /Self::Wool => 13/);
assert.match(commodities, /Self::Cloth => 14/);
assert.match(commodities, /Self::Flax => 18/);
assert.match(
  residenceNeedState,
  /missing_cloth[\s\S]*legacy_tier >= 3[\s\S]*RESIDENCE_CLOTH_CAPACITY/,
  'only legacy tier-3 homes should receive the one-time textile transition buffer',
);
assert.match(
  buildingReducers,
  /set_weaver_input_policy[\s\S]*is_valid_weaver_input_policy[\s\S]*building\.kind != "weaver"[\s\S]*weaver_input_policy = input_policy/,
);
assert.match(buildingTable, /#\[default\(0u8\)\][\s\S]*pub weaver_input_policy: u8/);
assert.match(generatedBuildingTable, /weaverInputPolicy:[\s\S]*weaver_input_policy/);
assert.match(generatedWeaverPolicyReducer, /buildingId:[\s\S]*inputPolicy:/);

const townHallRenderer = readFileSync(
  'src/resources/inspector/townHallRenderer.ts',
  'utf8',
);
assert.match(townHallRenderer, /Annual wool clip/);
assert.match(townHallRenderer, /Shearing readiness/);
assert.match(townHallRenderer, /Textile stores/);
assert.match(townHallRenderer, /Textile chain/);
assert.match(townHallRenderer, /Textile roads/);
assert.match(townHallRenderer, /cloth\/year physically paired/);
assert.match(townHallRenderer, /first loft without full-clip room/);

console.log(
  `textile economy tests passed (${textilePerfElapsedMs.toFixed(1)} ms aggregate; ${roadTextilePerfElapsedMs.toFixed(1)} ms road-matched for 100,000 holdings)`,
);

function sheepHerd(
  buildingId: string,
  partial: Partial<LivestockHerdState> = {},
): LivestockHerdState {
  return {
    buildingId,
    species: 'sheep',
    headCount: 6,
    health: 1,
    breedingProgress: 0,
    pastureCapacity: 6,
    suppliedCapacity: 6,
    lastFoodOutput: 0,
    lastPreservedOutput: 0,
    lastWoolGold: 0,
    lastWoolOutput: 0,
    lastShearingYear: 1,
    breedingReserve: 12,
    lastCulled: 0,
    hayStock: 0,
    lastHayOutput: 0,
    haymakingPercent: 0,
    ...partial,
  };
}

function textileResidence(
  id: string,
  population: number,
  tier: number,
): ResidenceState {
  return {
    id,
    zoneId: `zone-${id}`,
    parcelIndex: 0,
    x: 0,
    z: 0,
    yaw: 0,
    population,
    populationCapacity: population,
    tier,
    settlementTicks: 0,
    needs: createDefaultNeeds(),
    abandoned: false,
    householdWealth: 0,
  };
}

function textileTrip(
  id: string,
  cargoKind: 'wool' | 'flax' | 'cloth',
  amount: number,
  phase: 'outbound' | 'unloading' | 'inbound',
): import('../src/logistics/deliveryTrips.ts').DeliveryTripState {
  return {
    id,
    buildingId: 'origin',
    residenceId: null,
    destinationKind: 'building',
    targetBuildingId: 'target',
    cargoKind,
    amount,
    phase,
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
}
