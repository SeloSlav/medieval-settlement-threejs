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
  weaverUsesLinen,
} from '../src/economy/weaverInputPolicy.ts';
import {
  BUILDING_STORAGE_CAPS,
  RESIDENCE_CLOTH_CAPACITY,
  RESIDENCE_CLOTH_PER_PERSON_PER_SEC,
  SHEEP_SHEARING_END_MONTH,
  SHEEP_SHEARING_START_MONTH,
  SHEEP_WOOL_PER_SHEARING_PER_HEAD,
  SPECIALTY_EXPORT_GOLD_PER_CLOTH,
  SPINNING_RETTING_FLAX_PER_CYCLE,
  SPINNING_RETTING_FLAX_WATER_PER_CYCLE,
  SPINNING_RETTING_LINEN_PER_CYCLE,
  SPINNING_RETTING_WOOL_PER_CYCLE,
  SPINNING_RETTING_YARN_PER_CYCLE,
  TEXTILE_TRANSFER_PER_TRIP,
  WEAVER_CLOTH_PER_CYCLE,
  WEAVER_LINEN_PER_CYCLE,
  WEAVER_YARN_PER_CYCLE,
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
  INDUSTRY_BUILD_MENU_ENTRIES,
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

function spinningHouse(partial: Partial<BuildingState> = {}): BuildingState {
  return weaver({
    id: 'spinner-1',
    kind: 'spinning_retting_house',
    ...partial,
  });
}

assert.equal(SHEEP_SHEARING_START_MONTH, 6);
assert.equal(SHEEP_SHEARING_END_MONTH, 7);
assert.equal(SHEEP_WOOL_PER_SHEARING_PER_HEAD, 1);
assert.equal(SPINNING_RETTING_WOOL_PER_CYCLE, 3);
assert.equal(SPINNING_RETTING_FLAX_PER_CYCLE, 3);
assert.equal(SPINNING_RETTING_FLAX_WATER_PER_CYCLE, 1);
assert.equal(SPINNING_RETTING_YARN_PER_CYCLE, 2);
assert.equal(SPINNING_RETTING_LINEN_PER_CYCLE, 2);
assert.equal(WEAVER_YARN_PER_CYCLE, 2);
assert.equal(WEAVER_LINEN_PER_CYCLE, 2);
assert.equal(WEAVER_CLOTH_PER_CYCLE, 2);
assert.equal(TEXTILE_TRANSFER_PER_TRIP, 12);
assert.equal(SPECIALTY_EXPORT_GOLD_PER_CLOTH, 1.5);
assert.equal(RESIDENCE_CLOTH_CAPACITY, 8);
assert.equal(RESIDENCE_CLOTH_PER_PERSON_PER_SEC, 0.00018);
assert.equal(BUILDING_STORAGE_CAPS.pastoral_farmstead.wool, 80);
assert.equal(BUILDING_STORAGE_CAPS.spinning_retting_house.wool, 48);
assert.equal(BUILDING_STORAGE_CAPS.spinning_retting_house.flax, 48);
assert.equal(BUILDING_STORAGE_CAPS.spinning_retting_house.water, 18);
assert.equal(BUILDING_STORAGE_CAPS.spinning_retting_house.yarn, 48);
assert.equal(BUILDING_STORAGE_CAPS.spinning_retting_house.linen, 48);
assert.equal(BUILDING_STORAGE_CAPS.weaver.yarn, 36);
assert.equal(BUILDING_STORAGE_CAPS.weaver.linen, 36);
assert.equal(BUILDING_STORAGE_CAPS.weaver.wool ?? 0, 0);
assert.equal(BUILDING_STORAGE_CAPS.weaver.flax ?? 0, 0);
assert.equal(BUILDING_STORAGE_CAPS.weaver.water ?? 0, 0);
assert.equal(BUILDING_STORAGE_CAPS.threshing_barn.flax, 90);
assert.equal(BUILDING_STORAGE_CAPS.weaver.cloth, 48);
assert.equal(BUILDING_STORAGE_CAPS.marketplace.cloth, 120);
assert.equal(sheepFleeceOutput(4.5), 4.5);
assert.equal(
  projectedSheepFleece({
    headCount: 6,
    suppliedCapacity: 5,
    health: 0.8,
  }),
  4,
);
assert.equal(canStoreFullSheepClip(18, 18), true);
assert.equal(canStoreFullSheepClip(18, 17.99), false);

const definition = getBuildingDefinition('weaver');
assert.equal(definition.maxLabor, 2);
assert.equal(definition.requiresRoad, true);
assert.equal(definition.facesRoad, true);
assert.ok(INDUSTRY_BUILD_MENU_ENTRIES.some((entry) => entry.artKey === 'weaver'));
assert.ok(BUILD_MENU_ENTRIES.some((entry) => entry.artKey === 'weaver'));
assert.match(renderBuildMenuCards(), /weaver\.webp/);
const spinnerDefinition = getBuildingDefinition('spinning_retting_house');
assert.equal(spinnerDefinition.maxLabor, 2);
assert.equal(spinnerDefinition.requiresRoad, true);
assert.equal(spinnerDefinition.facesRoad, true);
assert.ok(
  INDUSTRY_BUILD_MENU_ENTRIES.some(
    (entry) => entry.artKey === 'spinning_retting_house',
  ),
);
assert.match(renderBuildMenuCards(), /spinning-retting-house\.webp/);

assert.equal(cargoKindFromId(13), 'wool');
assert.equal(cargoKindFromId(14), 'cloth');
assert.equal(cargoKindFromId(18), 'flax');
assert.equal(cargoKindFromId(67), 'yarn');
assert.equal(cargoKindFromId(68), 'linen');
assert.equal(cargoKindLabel('wool'), 'Wool fleece');
assert.equal(cargoKindLabel('flax'), 'Flax fibre');
assert.equal(cargoKindLabel('cloth'), 'Clothing');
assert.equal(cargoKindLabel('yarn'), 'Yarn');
assert.equal(cargoKindLabel('linen'), 'Linen');
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
  'Yarn match',
);
assert.equal(
  weaverFibreDeliveryPreferenceLabel(WEAVER_INPUT_POLICY_WOOL_FIRST, 'flax'),
  'Stored alternate',
);
assert.equal(
  weaverUsesFlax(weaver({
    wool: SPINNING_RETTING_WOOL_PER_CYCLE,
    flax: SPINNING_RETTING_FLAX_PER_CYCLE * 2,
    water: SPINNING_RETTING_FLAX_WATER_PER_CYCLE * 2,
    weaverInputPolicy: WEAVER_INPUT_POLICY_WOOL_FIRST,
  })),
  false,
);
assert.equal(
  weaverUsesFlax(weaver({
    wool: SPINNING_RETTING_WOOL_PER_CYCLE * 2,
    flax: SPINNING_RETTING_FLAX_PER_CYCLE,
    water: SPINNING_RETTING_FLAX_WATER_PER_CYCLE,
    weaverInputPolicy: WEAVER_INPUT_POLICY_FLAX_FIRST,
  })),
  true,
);
assert.equal(
  weaverUsesFlax(weaver({
    wool: SPINNING_RETTING_WOOL_PER_CYCLE,
    flax: SPINNING_RETTING_FLAX_PER_CYCLE,
    water: 0,
    weaverInputPolicy: WEAVER_INPUT_POLICY_FLAX_FIRST,
  })),
  true,
  'an explicit linen recipe must wait for water instead of producing yarn',
);
assert.equal(
  weaverUsesLinen(weaver({
    yarn: WEAVER_YARN_PER_CYCLE,
    linen: WEAVER_LINEN_PER_CYCLE * 2,
    weaverInputPolicy: WEAVER_INPUT_POLICY_FLAX_FIRST,
  })),
  true,
);
assert.equal(
  weaverUsesLinen(weaver({
    yarn: WEAVER_YARN_PER_CYCLE,
    linen: 0,
    weaverInputPolicy: WEAVER_INPUT_POLICY_FLAX_FIRST,
  })),
  true,
  'an explicit linen-clothing recipe must not consume stored yarn',
);

const worldQueries = {} as WorldQueries;
assert.match(
  getBuildingProcessorStatus(spinningHouse(), worldQueries)?.statusText ?? '',
  /Waiting for wool/,
);
assert.equal(
  getBuildingProcessorStatus(
    spinningHouse({ wool: SPINNING_RETTING_WOOL_PER_CYCLE }),
    worldQueries,
  )?.statusText,
  'Spinning wool into yarn',
);
assert.equal(
  getBuildingProcessorStatus(
    spinningHouse({
      wool: SPINNING_RETTING_WOOL_PER_CYCLE,
      yarn: BUILDING_STORAGE_CAPS.spinning_retting_house.yarn,
    }),
    worldQueries,
  )?.statusText,
  'Yarn target reached - fibre preparation paused',
);
const flaxWorldQueries = {
  getRoadConnectedWells: () => [weaver({ id: 'well-1', kind: 'well', water: 8 })],
  getInboundSupplyTrip: () => null,
  getRoadPathDistance: () => 20,
} as unknown as WorldQueries;
assert.equal(
  getBuildingProcessorStatus(
    spinningHouse({
      flax: SPINNING_RETTING_FLAX_PER_CYCLE,
      water: SPINNING_RETTING_FLAX_WATER_PER_CYCLE,
    }),
    flaxWorldQueries,
  )?.statusText,
  'Retting flax and dressing linen fibre',
);
const policyStatus = getBuildingProcessorStatus(
  spinningHouse({
    wool: SPINNING_RETTING_WOOL_PER_CYCLE,
    flax: SPINNING_RETTING_FLAX_PER_CYCLE,
    water: SPINNING_RETTING_FLAX_WATER_PER_CYCLE,
    weaverInputPolicy: WEAVER_INPUT_POLICY_FLAX_FIRST,
  }),
  flaxWorldQueries,
);
assert.equal(policyStatus?.statusText, 'Retting flax and dressing linen fibre');
assert.match(policyStatus?.waterDetailHtml ?? '', /Active recipe<\/span><span>Linen/);
assert.match(policyStatus?.waterDetailHtml ?? '', /Selected textile route<\/span><span>Ret flax with hauled water/);
assert.equal(
  getBuildingProcessorStatus(
    weaver({ yarn: WEAVER_YARN_PER_CYCLE }),
    worldQueries,
  )?.statusText,
  'Weaving yarn into clothing',
);
assert.equal(
  getBuildingProcessorStatus(
    weaver({
      yarn: WEAVER_YARN_PER_CYCLE,
      linen: WEAVER_LINEN_PER_CYCLE,
      weaverInputPolicy: WEAVER_INPUT_POLICY_FLAX_FIRST,
    }),
    worldQueries,
  )?.statusText,
  'Weaving linen into clothing',
);
assert.equal(
  getBuildingProcessorStatus(
    weaver({
      yarn: WEAVER_YARN_PER_CYCLE,
      cloth: BUILDING_STORAGE_CAPS.weaver.cloth,
    }),
    worldQueries,
  )?.statusText,
  'Clothing target reached - weaving paused',
);
const policyPanel = renderProcessorOutputTargetPanel(weaver());
assert.match(policyPanel ?? '', /data-weaver-input-policy="0"[^>]*disabled/);
assert.match(policyPanel ?? '', /data-weaver-input-policy="1"/);
assert.match(policyPanel ?? '', /data-weaver-input-policy="2"/);
assert.match(policyPanel ?? '', /resource-action-button--icon/);
assert.match(policyPanel ?? '', /data-tooltip="2 yarn → 2 clothing"/);
assert.match(policyPanel ?? '', /data-tooltip="2 linen → 2 clothing"/);
const spinnerPolicyPanel = renderProcessorOutputTargetPanel(spinningHouse());
assert.match(spinnerPolicyPanel ?? '', /data-tooltip="3 wool → 2 yarn"/);
assert.match(spinnerPolicyPanel ?? '', /data-tooltip="3 flax \+ 1 water → 2 linen"/);
assert.match(spinnerPolicyPanel ?? '', /data-resource-cost="yarn"/);
assert.match(spinnerPolicyPanel ?? '', /data-resource-cost="linen"/);

const emptyWeaverVisual = buildingMarkerSignatures(
  new Map([['weaver-1', weaver()]]),
).visual;
const firstYarnBundle = buildingMarkerSignatures(
  new Map([['weaver-1', weaver({ yarn: 1 })]]),
).visual;
const sameYarnBundle = buildingMarkerSignatures(
  new Map([['weaver-1', weaver({ yarn: 2 })]]),
).visual;
const firstClothBundle = buildingMarkerSignatures(
  new Map([['weaver-1', weaver({ yarn: 2, cloth: 1 })]]),
).visual;
const firstLinenBundle = buildingMarkerSignatures(
  new Map([['weaver-1', weaver({ linen: 1 })]]),
).visual;
const legacyRawWeaverVisual = buildingMarkerSignatures(
  new Map([['weaver-1', weaver({ wool: 1, flax: 1 })]]),
).visual;
assert.notEqual(firstYarnBundle, emptyWeaverVisual);
assert.equal(
  sameYarnBundle,
  firstYarnBundle,
  'small textile stock changes inside one bundle must not rebuild the workshop mesh',
);
assert.notEqual(firstClothBundle, sameYarnBundle);
assert.notEqual(firstLinenBundle, emptyWeaverVisual);
assert.equal(
  legacyRawWeaverVisual,
  emptyWeaverVisual,
  'raw Wool and Flax must no longer drive Weaver stock props',
);

const spinner = (partial: Partial<BuildingState> = {}): BuildingState => weaver({
  id: 'spinner-1',
  kind: 'spinning_retting_house',
  ...partial,
});
const emptySpinnerVisual = buildingMarkerSignatures(
  new Map([['spinner-1', spinner()]]),
).visual;
const firstSpinnerWoolBundle = buildingMarkerSignatures(
  new Map([['spinner-1', spinner({ wool: 1 })]]),
).visual;
const sameSpinnerWoolBundle = buildingMarkerSignatures(
  new Map([['spinner-1', spinner({ wool: 2 })]]),
).visual;
assert.equal(
  firstSpinnerWoolBundle,
  sameSpinnerWoolBundle,
  'small raw-fibre changes inside one bundle must not rebuild the Spinning & Retting House mesh',
);
for (const [resource, visual] of [
  ['wool', firstSpinnerWoolBundle],
  ['flax', buildingMarkerSignatures(new Map([['spinner-1', spinner({ flax: 1 })]])).visual],
  ['yarn', buildingMarkerSignatures(new Map([['spinner-1', spinner({ yarn: 1 })]])).visual],
  ['linen', buildingMarkerSignatures(new Map([['spinner-1', spinner({ linen: 1 })]])).visual],
] as const) {
  assert.notEqual(
    visual,
    emptySpinnerVisual,
    `${resource} must drive a distinct Spinning & Retting House stock prop signature`,
  );
}

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
  wool: 115,
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
const staffedSpinner = spinningHouse({ id: 'staffed-spinner', wool: 4 });
const staffedWeaver = weaver({ cloth: 5 });
textileState.buildings.set(storageBlockedHolding.id, storageBlockedHolding);
textileState.buildings.set(readyHolding.id, readyHolding);
textileState.buildings.set(unstaffedHolding.id, unstaffedHolding);
textileState.buildings.set(staffedSpinner.id, staffedSpinner);
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
    spinnerIntermediateCapacityPerDay: 2 / 3,
    weaverClothCapacityPerDay: 2 / 3,
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
assert.equal(annualTextiles.projectedAnnualWool, 27);
assert.equal(annualTextiles.securedAnnualWool, 15);
assert.equal(annualTextiles.annualWoolAtRisk, 12);
assert.equal(annualTextiles.firstAttentionBuildingId, storageBlockedHolding.id);
assert.equal(annualTextiles.firstAttentionKind, 'storage');
assert.equal(annualTextiles.woolInTransit, 6);
assert.equal(annualTextiles.woolStock, 127);
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
    spinnerIntermediateCapacityPerDay: 2 / 3,
    weaverClothCapacityPerDay: 2 / 3,
    clothOutputPerDay: 2 / 3,
    clothDemandPerDay: 0.05,
  },
});
assert.equal(physicalTextiles.woolStock, 125);
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
assert.equal(annualTextiles.annualClothPotential, 18);
assert.equal(annualTextiles.annualHouseholdClothDemand, 18);
assert.equal(annualTextiles.annualClothBalance, 0);
assert.equal(annualTextiles.roadPlan, null);
assert.match(textileChainBalanceLabel(annualTextiles), /covered/);
const annualTextileRows = renderSettlementTextileRows(annualTextiles);
assert.match(annualTextileRows, /1 waiting for full-clip room/);
assert.match(annualTextileRows, /first holding waiting for full-clip room/);
assert.match(annualTextileRows, /12\.0 wool not yet secured by current shearing readiness/);
assert.doesNotMatch(annualTextileRows, /\d+ storage-blocked|lost excess fleece/i);

const missedTextiles = computeSettlementTextilePlan({
  state: textileState,
  clock: { month: 8, year: 2 },
  production: {
    clothWoolPerDay: 1,
    spinnerIntermediateCapacityPerDay: 2 / 3,
    weaverClothCapacityPerDay: 2 / 3,
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
    textileIntermediateOutputPerDay: 8 / 120,
    clothOutputPerDay: 8 / 120,
    firstResidenceId: westHome.id,
  }],
  [textileRoadKey(2), {
    currentResidents: 1,
    fullResidents: 1,
    preservedFoodOutputPerDay: 0,
    aleOutputPerDay: 0,
    textileIntermediateOutputPerDay: 0,
    clothOutputPerDay: 0,
    firstResidenceId: eastHome.id,
  }],
  [textileRoadKey(3), {
    currentResidents: 0,
    fullResidents: 0,
    preservedFoodOutputPerDay: 0,
    aleOutputPerDay: 0,
    textileIntermediateOutputPerDay: 8 / 120,
    clothOutputPerDay: 8 / 120,
    firstResidenceId: null,
  }],
]);
const splitRoadTextiles = computeSettlementTextilePlan({
  state: roadTextileState,
  clock: { month: 6, year: 2 },
  production: {
    clothWoolPerDay: 24 / 120,
    spinnerIntermediateCapacityPerDay: 16 / 120,
    weaverClothCapacityPerDay: 16 / 120,
    clothOutputPerDay: 16 / 120,
    clothDemandPerDay: 8 / 120,
    tierTwoPlusResidents: 2,
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
assert.equal(splitRoadTextiles.roadPlan?.annualHouseholdClothDemand, 24);
assert.equal(splitRoadTextiles.roadPlan?.coveredHouseholdClothDemand, 8);
assert.equal(splitRoadTextiles.roadPlan?.annualHouseholdClothShortfall, 16);
assert.equal(splitRoadTextiles.roadPlan?.annualExportableClothSurplus, 0);
assert.equal(splitRoadTextiles.roadPlan?.exposedHouseholdBranches, 2);
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
assert.match(splitTextileRows, /8\.0 \/ 16\.0 clothing\/year physically paired/);
assert.match(splitTextileRows, /8\.0 clothing\/year stranded/);
assert.match(splitTextileRows, /16\.0 local shortfall/);
assert.match(splitTextileRows, /data-inspect-residence="east-home"/);
assert.match(splitTextileRows, /1 \/ 2 current household branches/);
assert.match(splitTextileRows, /9 clothing in local cupboards/);
assert.match(splitTextileRows, /weakest reserve 90 days/);
assert.match(
  splitTextileRows,
  /11 in treasury, export, fire quarantine, idle, or disconnected stores/,
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
    spinnerIntermediateCapacityPerDay: 8 / 120,
    weaverClothCapacityPerDay: 8 / 120,
    clothOutputPerDay: 8 / 120,
    clothDemandPerDay: 4 / 120,
    tierTwoPlusResidents: 1,
    prosperityRoadBranches: new Map([
      [textileRoadKey(1), {
        currentResidents: 1,
        fullResidents: 1,
        preservedFoodOutputPerDay: 0,
        aleOutputPerDay: 0,
        textileIntermediateOutputPerDay: 0,
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
assert.match(renderSettlementTextileRows(fireAwareTextiles), /Clothing fire outages/);
assert.match(renderSettlementTextileRows(fireAwareTextiles), /7 clothing/);
assert.match(renderSettlementTextileRows(fireAwareTextiles), /first fire-disabled sheep holding/);

const joinedRoadTextiles = computeSettlementTextilePlan({
  state: roadTextileState,
  clock: { month: 6, year: 2 },
  production: {
    clothWoolPerDay: 24 / 120,
    spinnerIntermediateCapacityPerDay: 16 / 120,
    weaverClothCapacityPerDay: 16 / 120,
    clothOutputPerDay: 16 / 120,
    clothDemandPerDay: 8 / 120,
    tierTwoPlusResidents: 2,
    prosperityRoadBranches: new Map([
      [textileRoadKey(1), {
        currentResidents: 2,
        fullResidents: 2,
        preservedFoodOutputPerDay: 0,
        aleOutputPerDay: 0,
        textileIntermediateOutputPerDay: 16 / 120,
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
assert.equal(joinedRoadTextiles.roadPlan?.coveredHouseholdClothDemand, 16);
assert.equal(joinedRoadTextiles.roadPlan?.annualHouseholdClothShortfall, 8);
assert.equal(joinedRoadTextiles.roadPlan?.annualExportableClothSurplus, 0);
assert.equal(joinedRoadTextiles.serviceableHouseholdClothStock, 15);
assert.equal(joinedRoadTextiles.unavailableHouseholdClothStock, 5);
assert.equal(joinedRoadTextiles.roadPlan?.stockedSupplierBranches, 1);
assert.equal(joinedRoadTextiles.roadPlan?.unservedHouseholdBranches, 0);
assert.equal(joinedRoadTextiles.roadPlan?.worstHouseholdClothRunwayDays, 225);
assert.match(
  renderSettlementTextileRows(joinedRoadTextiles),
  /no clothing capacity stranded by topology/,
);

const satelliteRoadTextiles = computeSettlementTextilePlan({
  state: roadTextileState,
  clock: { month: 6, year: 2 },
  production: {
    clothWoolPerDay: 24 / 120,
    spinnerIntermediateCapacityPerDay: 16 / 120,
    weaverClothCapacityPerDay: 16 / 120,
    clothOutputPerDay: 16 / 120,
    clothDemandPerDay: 8 / 120,
    tierTwoPlusResidents: 2,
    prosperityRoadBranches: new Map([
      [textileRoadKey(1), {
        currentResidents: 1,
        fullResidents: 1,
        preservedFoodOutputPerDay: 0,
        aleOutputPerDay: 0,
        textileIntermediateOutputPerDay: 8 / 120,
        clothOutputPerDay: 8 / 120,
        firstResidenceId: westHome.id,
      }],
      [textileRoadKey(2), {
        currentResidents: 1,
        fullResidents: 1,
        preservedFoodOutputPerDay: 0,
        aleOutputPerDay: 0,
        textileIntermediateOutputPerDay: 8 / 120,
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
assert.equal(satelliteRoadTextiles.roadPlan?.annualHouseholdClothShortfall, 8);
assert.equal(satelliteRoadTextiles.roadPlan?.annualExportableClothSurplus, 0);
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
      wool: index % 2 === 0 ? 0 : 115,
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
    spinnerIntermediateCapacityPerDay: 200_000 / 3,
    weaverClothCapacityPerDay: 200_000 / 3,
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
    textileIntermediateOutputPerDay: 50,
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
    spinnerIntermediateCapacityPerDay: 10_000,
    weaverClothCapacityPerDay: 10_000,
    clothOutputPerDay: 10_000,
    clothDemandPerDay: 0,
    tierTwoPlusResidents: 0,
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
  400_000,
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
const marketplaceTrade = readFileSync(
  'server/src/economy/marketplace_trade.rs',
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
const shearingContractStart = livestockSimulation.indexOf('// A flock is shorn once');
const shearingContractEnd = livestockSimulation.indexOf(
  'match livestock_breeding_phase',
  shearingContractStart,
);
assert.ok(shearingContractStart >= 0, 'livestock simulation must retain the annual shearing block');
assert.ok(
  shearingContractEnd > shearingContractStart,
  'annual shearing must remain a local step before breeding',
);
const shearingContract = livestockSimulation.slice(shearingContractStart, shearingContractEnd);
assert.match(livestockSimulation, /herd\.last_shearing_year != clock\.year/);
assert.match(
  shearingContract,
  /let wool_room = whole_units\(building_commodity_room\(building, CommodityKind::Wool\)\)/,
  'shearing must measure whole-unit room for the full annual clip',
);
assert.match(
  shearingContract,
  /if fleece >= 1\.0 && wool_room \+ 1e-9 >= fleece \{[\s\S]*deposit_building_commodity\(building, CommodityKind::Wool, fleece\)[\s\S]*herd\.last_shearing_year = clock\.year/,
  'the flock must only be marked shorn after the full clip fits and is stored',
);
assert.doesNotMatch(
  shearingContract,
  /storable_whole_output|fleece_to_store/,
  'shearing must defer instead of storing a partial clip and losing the remainder',
);
assert.doesNotMatch(
  shearingContract,
  /return false/,
  'insufficient wool room must defer only shearing, not roll back feeding, health, or other husbandry',
);
assert.match(
  livestockSimulation,
  /CommodityKind::Wool,[\s\S]{0,160}&\["spinning_retting_house", "village_storehouse"\]/,
);
assert.doesNotMatch(livestockSimulation, /credit_treasury_gold/);
assert.match(expandedEconomy, /pub fn step_spinning_retting_house/);
assert.match(expandedEconomy, /pub fn step_weaver/);
assert.match(
  expandedEconomy,
  /step_spinning_retting_house[\s\S]*CommodityKind::Flax, SPINNING_RETTING_FLAX_PER_CYCLE[\s\S]*CommodityKind::Water[\s\S]*SPINNING_RETTING_FLAX_WATER_PER_CYCLE[\s\S]*CommodityKind::Linen, SPINNING_RETTING_LINEN_PER_CYCLE/,
);
assert.match(
  expandedEconomy,
  /step_spinning_retting_house[\s\S]*CommodityKind::Wool, SPINNING_RETTING_WOOL_PER_CYCLE[\s\S]*CommodityKind::Yarn, SPINNING_RETTING_YARN_PER_CYCLE/,
);
assert.match(
  expandedEconomy,
  /step_spinning_retting_house[\s\S]*weaver_uses_flax\([\s\S]*building\.weaver_input_policy[\s\S]*SPINNING_RETTING_FLAX_WATER_PER_CYCLE/,
);
assert.match(
  expandedEconomy,
  /step_weaver[\s\S]*weaver_uses_linen\([\s\S]*CommodityKind::Linen, WEAVER_LINEN_PER_CYCLE[\s\S]*CommodityKind::Yarn, WEAVER_YARN_PER_CYCLE[\s\S]*CommodityKind::Cloth, WEAVER_CLOTH_PER_CYCLE/,
);
assert.match(
  expandedEconomy,
  /weaver_fibre_delivery_preference_rank\([\s\S]*target\.weaver_input_policy/,
);
assert.match(
  expandedEconomy,
  /fn processor_requests_input[\s\S]*textile_recipe_requests_route\(building\.weaver_input_policy, false\)[\s\S]*textile_recipe_requests_route\(building\.weaver_input_policy, true\)/,
  'focused textile recipes must request only their selected raw and prepared fibre routes',
);
assert.match(
  expandedEconomy,
  /FarmCropProduce::Fibre => Some\(CommodityKind::Flax\)/,
);
assert.match(
  expandedEconomy,
  /step_weaver[\s\S]*CommodityKind::Cloth,[\s\S]{0,120}&\["village_storehouse"\][\s\S]*CommodityKind::Cloth,[\s\S]{0,120}&\["trading_post"\]/,
  'weavers must stage household cloth through a storehouse before considering regional export',
);
assert.match(
  expandedEconomy,
  /step_weaver[\s\S]*&\["village_storehouse"\]/,
  'storehouse workers must collect woven cloth for their household-goods stalls',
);
assert.doesNotMatch(
  expandedEconomy,
  /dispatch_need\([\s\S]*ResidenceNeedKind::Cloth|invalidate_specialty_claims[\s\S]*ResidenceNeedKind::Cloth/,
  'weavers must stay at production instead of serving residences directly',
);
assert.match(
  marketplaceTrade,
  /CommodityKind::Cloth => Some\(SPECIALTY_EXPORT_GOLD_PER_CLOTH\)/,
  'regional cloth exports must retain their specialty price in the authoritative trade settlement',
);
assert.match(commodities, /Self::Wool => 13/);
assert.match(commodities, /Self::Cloth => 14/);
assert.match(commodities, /Self::Flax => 18/);
assert.match(commodities, /Self::Pelts => 66/);
assert.match(commodities, /Self::Yarn => 67/);
assert.match(commodities, /Self::Linen => 68/);
assert.match(
  residenceNeedState,
  /missing_progression_rows && legacy_tier >= 2[\s\S]*RESIDENCE_CLOTH_CAPACITY/,
  'established tier-2+ homes should receive the one-time textile transition buffer when progression rows migrate',
);
assert.match(
  buildingReducers,
  /set_weaver_input_policy[\s\S]*is_valid_weaver_input_policy[\s\S]*spinning_retting_house" \| "weaver[\s\S]*weaver_input_policy = input_policy/,
);
assert.match(buildingTable, /#\[default\(0u8\)\][\s\S]*pub weaver_input_policy: u8/);
assert.match(generatedBuildingTable, /weaverInputPolicy:[\s\S]*weaver_input_policy/);
assert.match(generatedWeaverPolicyReducer, /buildingId:[\s\S]*inputPolicy:/);

const townHallRenderer = readFileSync(
  'src/resources/inspector/townHallRenderer.ts',
  'utf8',
);
const livestockBuildingRenderer = readFileSync(
  'src/resources/inspector/livestockBuildingRenderer.ts',
  'utf8',
);
assert.match(townHallRenderer, /Annual wool clip/);
assert.match(townHallRenderer, /Shearing readiness/);
assert.match(townHallRenderer, /Textile stores/);
assert.match(townHallRenderer, /Clothing chain/);
assert.match(townHallRenderer, /Clothing roads/);
assert.match(townHallRenderer, /Fibre preparation/);
assert.match(townHallRenderer, /clothing\/year physically paired/);
assert.match(townHallRenderer, /first holding waiting for full-clip room/);
assert.match(townHallRenderer, /waiting for full-clip room/);
assert.match(livestockBuildingRenderer, /Annual June–July clip/);
assert.match(livestockBuildingRenderer, /totalLastWool/);
assert.doesNotMatch(livestockBuildingRenderer, /lost excess fleece/i);

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
