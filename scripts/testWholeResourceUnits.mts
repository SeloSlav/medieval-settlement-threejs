import assert from 'node:assert/strict';

import { syncBackyardGardens } from '../src/data/spacetimeTableSync/syncBackyardGardens.ts';
import { syncBuildings } from '../src/data/spacetimeTableSync/syncBuildings.ts';
import { syncBurgageZones } from '../src/data/spacetimeTableSync/syncBurgageZones.ts';
import { syncDeliveryTrips } from '../src/data/spacetimeTableSync/syncDeliveryTrips.ts';
import { syncFarmFields } from '../src/data/spacetimeTableSync/syncFarmFields.ts';
import { syncFireIncidents } from '../src/data/spacetimeTableSync/syncFireIncidents.ts';
import { syncForagingNodes } from '../src/data/spacetimeTableSync/syncForagingNodes.ts';
import { syncLivestockHerds } from '../src/data/spacetimeTableSync/syncLivestock.ts';
import { syncPlayerResources } from '../src/data/spacetimeTableSync/syncPlayerResources.ts';
import { syncQuarries } from '../src/data/spacetimeTableSync/syncQuarries.ts';
import { syncResidences } from '../src/data/spacetimeTableSync/syncResidences.ts';
import { syncSettlements } from '../src/data/spacetimeTableSync/syncSettlements.ts';
import { syncSettlementSecurity } from '../src/data/spacetimeTableSync/syncSettlementSecurity.ts';
import { syncTradingPostTradeRules } from '../src/data/spacetimeTableSync/syncTradingPostTradeRules.ts';
import {
  RESIDENCE_NEED_KIND_IDS,
  RESIDENCE_NEED_KINDS,
} from '../src/residences/residenceNeedState.ts';
import {
  formatResourceUnits,
  isWholeResourceUnits,
  wholeResourceUnits,
  wholeSignedResourceUnits,
} from '../src/resources/resourceUnits.ts';
import { RESOURCE_KINDS } from '../src/resources/types.ts';
import { syncActiveRaid } from '../src/security/activeRaid.ts';

const identityHex = 'whole-unit-test-owner';
const owner = { toHexString: () => identityHex };

assert.equal(wholeResourceUnits(-4.2), 0);
assert.equal(wholeResourceUnits(Number.NaN), 0);
assert.equal(wholeResourceUnits(Number.POSITIVE_INFINITY), 0);
assert.equal(wholeResourceUnits(0.99), 0);
assert.equal(wholeResourceUnits(7.75), 7);
assert.equal(wholeResourceUnits(7.9999999), 8);
assert.equal(wholeResourceUnits(8.0000001), 8);
assert.equal(wholeSignedResourceUnits(-7.75), -7);
assert.equal(wholeSignedResourceUnits(7.75), 7);
assert.equal(Object.is(wholeSignedResourceUnits(-0.75), -0), false);
assert.equal(formatResourceUnits(12.9), '12');
assert.equal(isWholeResourceUnits(12), true);
assert.equal(isWholeResourceUnits(12.5), false);
assert.equal(isWholeResourceUnits(12.0000001), false);
assert.equal(isWholeResourceUnits(-1), false);

function rowWithDefaults<T extends object>(values: T): T {
  return new Proxy(values, {
    get(target, property, receiver) {
      if (Reflect.has(target, property)) return Reflect.get(target, property, receiver);
      return 0;
    },
  });
}

function assertWholeRecord(
  record: Record<string, unknown>,
  fields: readonly string[],
  label: string,
): void {
  for (const field of fields) {
    const value = record[field];
    assert.equal(
      typeof value === 'number' && isWholeResourceUnits(value),
      true,
      `${label}.${field} must be a nonnegative whole unit; received ${String(value)}`,
    );
  }
}

const buildingStockFields = RESOURCE_KINDS.filter((kind) => kind !== 'game');
const buildingStockInput = Object.fromEntries(
  buildingStockFields.map((field, index) => [field, index + 1.875]),
);
const buildingMaterialLedgerFields = [
  'constructionRequiredTimber',
  'constructionRequiredStone',
  'constructionRequiredIronwork',
  'constructionRequiredRoofTiles',
  'constructionDeliveredTimber',
  'constructionDeliveredStone',
  'constructionDeliveredIronwork',
  'constructionDeliveredRoofTiles',
  'constructionReservedTimber',
  'constructionReservedStone',
  'constructionReservedIronwork',
  'constructionReservedRoofTiles',
  'constructionTreasuryTimber',
  'constructionTreasuryStone',
  'constructionTreasuryIronwork',
  'constructionTreasuryRoofTiles',
] as const;
const buildingMaterialLedgerInput = Object.fromEntries(
  buildingMaterialLedgerFields.map((field, index) => [field, index + 2.8]),
);
const buildingRow = rowWithDefaults({
  ...buildingStockInput,
  ...buildingMaterialLedgerInput,
  id: 1n,
  settlementId: 41n,
  owner,
  kind: 'granary',
  guardhouseMusterWatchtowerId: 0n,
  linkedWorksiteId: 0n,
  actionCooldown: 0.375,
  constructionProgress: 0.625,
  commuteEfficiency: 0.45,
  apiaryColonyHealth: 0.73,
  civicReceiptsGold: 1.9,
  granaryGrainReserve: 17.8,
  woodcutterTimberReserve: 18.8,
  carpenterPolearmReserve: 19.8,
  guardhouseFoodReserve: 20.8,
  marketplaceIronworkTarget: 21.8,
  marketplaceIronTarget: 22.8,
  marketplaceSaltTarget: 23.8,
  marketplaceGoldReserveTarget: 24.8,
  marketplaceSeedGrainTarget: 25.8,
});
const building = syncBuildings([buildingRow as never], identityHex).get('building-1');
assert.ok(building);
assert.equal(building.settlementId, 'settlement-41');
assertWholeRecord(building as unknown as Record<string, unknown>, buildingStockFields, 'building');
for (const field of buildingStockFields) {
  assert.equal(
    (building as unknown as Record<string, number>)[field],
    wholeResourceUnits(buildingStockInput[field]),
    `building.${field} should normalize its authoritative row`,
  );
}
assertWholeRecord(building as unknown as Record<string, unknown>, [
  ...buildingMaterialLedgerFields,
  'civicReceiptsGold',
  'granaryGrainReserve',
  'woodcutterTimberReserve',
  'carpenterPolearmReserve',
  'guardhouseFoodReserve',
  'marketplaceIronworkTarget',
  'marketplaceIronTarget',
  'marketplaceSaltTarget',
  'marketplaceGoldReserveTarget',
  'marketplaceSeedGrainTarget',
], 'building');
for (const field of buildingMaterialLedgerFields) {
  assert.equal(
    (building as unknown as Record<string, number>)[field],
    wholeResourceUnits(buildingMaterialLedgerInput[field]),
    `building.${field} should normalize its authoritative ledger row`,
  );
}
assert.equal(building.actionCooldown, 0.375);
assert.equal(building.constructionProgress, 0.625);
assert.equal(building.commuteEfficiency, 0.45);
assert.equal(building.apiaryColonyHealth, 0.73);

const tripRow = rowWithDefaults({
  id: 2n,
  owner,
  buildingId: 1n,
  laborBuildingId: 0n,
  residenceId: 0n,
  destinationKind: 0,
  targetBuildingId: 1n,
  cargoKind: 3,
  amount: 6.8,
  phase: 0,
  progress: 0.375,
  speedMps: 2.25,
  unloadSeconds: 1.75,
  unloadRemaining: 0.625,
});
const trip = syncDeliveryTrips([tripRow as never], identityHex).get('trip-2');
assert.ok(trip);
assert.equal(trip.amount, 6);
assert.equal(isWholeResourceUnits(trip.amount), true);
assert.equal(trip.progress, 0.375);
assert.equal(trip.speedMps, 2.25);
assert.equal(trip.unloadSeconds, 1.75);
assert.equal(trip.unloadRemaining, 0.625);

const forage = syncForagingNodes([rowWithDefaults({
  nodeId: 'berries-1',
  nodeKind: 'berries',
  remaining: 27.95,
  maxYield: 64.8,
  x: 12.75,
  z: -8.25,
}) as never]).get('berries-1');
assert.ok(forage);
assert.equal(forage.remaining, 27);
assert.equal(forage.maxYield, 64);
assert.equal(forage.x, 12.75);
assert.equal(forage.z, -8.25);

const quarry = syncQuarries([rowWithDefaults({
  quarryId: 'deposit-stone-1',
  remaining: -4.5,
  maxYield: 92.8,
  x: 31.25,
  z: 44.75,
}) as never]).get('deposit-stone-1');
assert.ok(quarry);
assert.equal(quarry.remaining, 0);
assert.equal(quarry.maxYield, 92);
assert.equal(quarry.x, 31.25);
assert.equal(quarry.z, 44.75);

const field = syncFarmFields([rowWithDefaults({
  id: 8n,
  owner,
  farmsteadId: 1n,
  crop: 0,
  nextCrop: 1,
  followingCrop: 2,
  stage: 2,
  lastYield: 31.8,
  currentYield: 22.8,
  manureApplied: 5.8,
  moisture: 0.725,
  fertility: 0.615,
  stageProgress: 0.375,
  harvestYieldMultiplier: 0.825,
}) as never], identityHex).get('farm-field-8');
assert.ok(field);
assert.equal(field.lastYield, 31);
assert.equal(field.currentYield, 22);
assert.equal(field.manureApplied, 5);
assert.equal(field.moisture, 0.725);
assert.equal(field.fertility, 0.615);
assert.equal(field.stageProgress, 0.375);
assert.equal(field.harvestYieldMultiplier, 0.825);

const playerState = { identityHex } as never;
syncPlayerResources([rowWithDefaults({
  owner,
  ...Object.fromEntries(RESOURCE_KINDS.map((kind, index) => [kind, index + 1.9])),
  landLevyCollectedTotal: 31.8,
  parishCharityPaidTotal: 4.9,
  chapelCofferReserveGold: 12.9,
  monasteryFoodCharityTotal: 12.1,
  lastNightTheftGold: 2.75,
  lastNightLightingFuelUsed: 3.75,
  lastNightLightingFuelShortfall: 4.75,
  economicActivityTaxRate: 0.1375,
  monasteryTitheShare: 0.275,
  nightCommunityCohesion: 0.825,
}) as never], playerState);
assertWholeRecord(
  (playerState as { stockpile: Record<string, unknown> }).stockpile,
  RESOURCE_KINDS,
  'player stockpile',
);
assert.equal((playerState as { stockpile: { timber: number } }).stockpile.timber, 1);
assert.equal((playerState as { fiscalPolicy: { landLevyCollectedTotal: number } })
  .fiscalPolicy.landLevyCollectedTotal, 31);
assert.equal((playerState as { parishPolicy: { cofferReserveGold: number } })
  .parishPolicy.cofferReserveGold, 12);
assert.equal((playerState as { parishPolicy: { charityPaidTotal: number } })
  .parishPolicy.charityPaidTotal, 4);
assert.equal((playerState as { nightPolicy: { lastTheftGold: number } })
  .nightPolicy.lastTheftGold, 2);
assert.equal((playerState as { economicActivityTaxRate: number }).economicActivityTaxRate, 0.1375);
assert.equal((playerState as { monasteryPolicy: { titheShare: number } })
  .monasteryPolicy.titheShare, 0.275);
assert.equal((playerState as { nightPolicy: { communityCohesion: number } })
  .nightPolicy.communityCohesion, 0.825);

const residencePantryFields = [
  'food',
  'preservedFood',
  'honey',
  'oatGrain',
  'ryeBread',
  'maslinBread',
  'meat',
  'fish',
  'berries',
  'mushrooms',
  'milk',
  'apples',
  'pears',
  'cherries',
  'aronia',
  'rosehips',
  'vegetables',
  'cabbage',
  'carrots',
  'beetroot',
  'eggs',
  'grapes',
  'curedMeat',
  'smokedFish',
  'cheese',
  'aroniaJam',
  'rosehipJam',
] as const;
const residencePantryInput = Object.fromEntries(
  residencePantryFields.map((field, index) => [field, index === 0 ? -3.25 : index + 1.875]),
);
const residence = syncResidences(
  [rowWithDefaults({
    ...residencePantryInput,
    id: 3n,
    settlementId: 41n,
    owner,
    zoneId: 4n,
    x: 5.25,
    z: -6.75,
    yaw: 0.325,
    householdWealth: 14.5,
    remedyStock: 2.2,
    upgradeDeliveredTimber: 11.75,
    upgradeProgress: 0.625,
    malnutrition: 0.375,
  }) as never],
  RESIDENCE_NEED_KINDS.map((kind, index) => rowWithDefaults({
    residenceId: 3n,
    needKind: RESIDENCE_NEED_KIND_IDS[kind],
    stock: index === 0 ? -2.5 : index + 0.625,
    deficitTicks: index + 0.75,
  }) as never),
  identityHex,
).get('residence-3');
assert.ok(residence);
assert.equal(residence.settlementId, 'settlement-41');
assertWholeRecord(
  residence as unknown as Record<string, unknown>,
  residencePantryFields,
  'residence pantry',
);
for (const field of residencePantryFields) {
  assert.equal(
    (residence as unknown as Record<string, number>)[field],
    wholeResourceUnits(residencePantryInput[field]),
    `residence.${field} should normalize its authoritative pantry row`,
  );
}
for (const kind of RESIDENCE_NEED_KINDS) {
  assert.equal(
    isWholeResourceUnits(residence.needs[kind].stock),
    true,
    `residence.needs.${kind}.stock must be a nonnegative whole unit`,
  );
}
assert.equal(residence.needs.food.stock, 0);
assert.equal(residence.needs.firewood.stock, 1);
assert.equal(residence.householdWealth, 14);
assert.equal(residence.remedyStock, 2);
assert.equal(residence.upgradeDeliveredTimber, 11);
assert.equal(residence.x, 5.25);
assert.equal(residence.z, -6.75);
assert.equal(residence.yaw, 0.325);
assert.equal(residence.upgradeProgress, 0.625);
assert.equal(residence.malnutrition, 0.375);

const burgage = syncBurgageZones([rowWithDefaults({
  id: 4n,
  owner,
  settlementId: 41n,
  cornerAx: 0,
  cornerAz: 0,
  cornerBx: 10,
  cornerBz: 0,
  cornerCx: 10,
  cornerCz: 20,
  cornerDx: 0,
  cornerDz: 20,
  frontageEdge: 1,
  plotCount: 3n,
}) as never], identityHex).get('zone-4');
assert.ok(burgage);
assert.equal(burgage.settlementId, 'settlement-41');

const settlement = syncSettlements([rowWithDefaults({
  id: 41n,
  owner,
  name: ' East Mere ',
  anchorX: 125.5,
  anchorZ: -82.25,
  foundingCampId: 1n,
  founderPopulation: 5n,
  unhousedFounders: 2n,
  active: true,
  townHallId: 2n,
  createdTick: 990n,
  economicActivityTaxRate: 0.1375,
  pantrySafeguardPolicy: 2,
  landLevyRate: 0.0825,
  importDutyRate: 0.045,
  exportDutyRate: 0.025,
  seasonalLaborStewardEnabled: true,
  constructionLaborStewardEnabled: false,
  productionLaborStewardEnabled: true,
  laborStewardReserve: 4n,
  nightWatchPolicy: 2,
  nightGatheringPolicy: 1,
  nightWorkPolicy: 0,
  nightLightingPolicy: 2,
  nightCurfewPolicy: 1,
  landLevyAssessedTotal: 11.9,
  landLevyCollectedTotal: 10.9,
  importDutyCollectedTotal: 3.9,
  exportDutyCollectedTotal: 4.9,
  lastNightTheftGold: 2.9,
  lastNightLightingFuelUsed: 5.9,
  lastNightLightingFuelShortfall: 1.9,
  nightCommunityCohesion: 0.825,
  nightLaborFatigue: 0.175,
}) as never], identityHex).get('settlement-41');
assert.ok(settlement);
assert.equal(settlement.name, 'East Mere');
assert.equal(settlement.foundingCampId, 'building-1');
assert.equal(settlement.townHallId, 'building-2');
assert.equal(settlement.unhousedFounders, 2);
assert.equal(settlement.landLevyAssessedTotal, 11);
assert.equal(settlement.landLevyCollectedTotal, 10);
assert.equal(settlement.importDutyCollectedTotal, 3);
assert.equal(settlement.exportDutyCollectedTotal, 4);
assert.equal(settlement.lastNightTheftGold, 2);
assert.equal(settlement.lastNightLightingFuelUsed, 5);
assert.equal(settlement.lastNightLightingFuelShortfall, 1);
assert.equal(settlement.economicActivityTaxRate, 0.1375);
assert.equal(settlement.nightCommunityCohesion, 0.825);

const backyard = syncBackyardGardens([rowWithDefaults({
  id: 5n,
  owner,
  residenceId: 3n,
  kind: 1,
  hideStock: 7.9,
}) as never], identityHex).get('residence-3');
assert.ok(backyard);
assert.equal(backyard.hideStock, 7);

const herd = syncLivestockHerds([rowWithDefaults({
  owner,
  pastureId: 7n,
  farmsteadId: 1n,
  species: 0,
  headCount: 9.9,
  health: 0.825,
  breedingProgress: 0.375,
  pastureCapacity: 12.75,
  suppliedCapacity: 8.5,
  lastFoodOutput: 6.9,
  lastPreservedOutput: 5.9,
  lastWoolGold: 4.9,
  lastWoolOutput: 3.9,
  breedingReserve: 2.9,
  lastCulled: 1.9,
  hayStock: 18.9,
  lastHayOutput: 7.9,
}) as never], identityHex).get('pasture-7');
assert.ok(herd);
assert.equal(herd.pastureId, 'pasture-7');
assert.equal(herd.buildingId, 'building-1');
assert.equal(herd.headCount, 9);
assert.equal(herd.breedingReserve, 2);
assert.equal(herd.lastCulled, 1);
assert.equal(herd.hayStock, 18);
assert.equal(herd.health, 0.825);
assert.equal(herd.breedingProgress, 0.375);
assert.equal(herd.pastureCapacity, 12.75);
assert.equal(herd.suppliedCapacity, 8.5);

const tradeRule = syncTradingPostTradeRules([rowWithDefaults({
  id: 'trade-rule-1',
  owner,
  buildingId: 1n,
  commodityKind: 3,
  mode: 1,
  targetSurplus: 21.9,
  lastSettledMonth: 17n,
  lastTradeAmount: 8.9,
  lastTradeGold: -6.9,
}) as never], identityHex).get('building-1:3');
assert.ok(tradeRule);
assert.equal(tradeRule.targetSurplus, 21);
assert.equal(tradeRule.lastTradeAmount, 8);
assert.equal(tradeRule.lastTradeGold, -6);

const fire = syncFireIncidents([rowWithDefaults({
  id: 6n,
  owner,
  targetKind: 0,
  targetId: 1n,
  ignitionSource: 1,
  state: 0,
  waterDelivered: 9.9,
  requiredWater: 14.9,
  intensity: 0.75,
  damage: 0.25,
  extinguishChance: 0.375,
}) as never], identityHex).get('fire-6');
assert.ok(fire);
assert.equal(fire.waterDelivered, 9);
assert.equal(fire.requiredWater, 14);
assert.equal(fire.intensity, 0.75);
assert.equal(fire.damage, 0.25);
assert.equal(fire.extinguishChance, 0.375);

const securityState = { identityHex } as never;
syncSettlementSecurity([rowWithDefaults({
  owner,
  lastGoodsLost: 11.9,
  lastWealthLost: 7.9,
  threat: 0.625,
  coverage: 0.375,
  protectedValue: 14.5,
  totalValue: 21.5,
}) as never], securityState);
assert.equal((securityState as { settlementSecurity: { lastGoodsLost: number } })
  .settlementSecurity.lastGoodsLost, 11);
assert.equal((securityState as { settlementSecurity: { lastWealthLost: number } })
  .settlementSecurity.lastWealthLost, 7);
assert.equal((securityState as { settlementSecurity: { threat: number } })
  .settlementSecurity.threat, 0.625);
assert.equal((securityState as { settlementSecurity: { protectedValue: number } })
  .settlementSecurity.protectedValue, 14.5);

const activeRaid = syncActiveRaid([rowWithDefaults({
  owner,
  raidId: 7n,
  goodsLost: 5.9,
  wealthLost: 3.9,
  enemyPressure: 42.5,
}) as never], identityHex);
assert.ok(activeRaid);
assert.equal(activeRaid.goodsLost, 5);
assert.equal(activeRaid.wealthLost, 3);
assert.equal(activeRaid.enemyPressure, 42.5);

console.log('Strict whole-resource client sync tests passed.');
