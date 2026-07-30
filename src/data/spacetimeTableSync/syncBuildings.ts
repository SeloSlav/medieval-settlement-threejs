import type { Building } from '../../generated/types.ts';
import { buildingClientId } from '../spacetimeIds.ts';
import type { BuildingState } from '../../resources/types.ts';
import { isBuildingKind } from '../../resources/types.ts';

export function syncBuildings(
  rows: Iterable<Building>,
  identityHex: string | null,
): Map<string, BuildingState> {
  const buildings = new Map<string, BuildingState>();
  for (const row of rows) {
    upsertBuildingRow(buildings, row, identityHex);
  }
  return buildings;
}

export function upsertBuildingRow(
  buildings: Map<string, BuildingState>,
  row: Building,
  identityHex: string | null,
): void {
  const building = buildingStateFromRow(row, identityHex);
  if (building) buildings.set(building.id, building);
}

export function removeBuildingRow(
  buildings: Map<string, BuildingState>,
  row: Building,
  identityHex: string | null,
): void {
  if (!identityHex || row.owner.toHexString() !== identityHex) return;
  buildings.delete(buildingClientId(row.id));
}

function buildingStateFromRow(
  row: Building,
  identityHex: string | null,
): BuildingState | null {
  if (!identityHex || row.owner.toHexString() !== identityHex) return null;
  if (!isBuildingKind(row.kind)) return null;
  const id = buildingClientId(row.id);
  return {
    id,
    kind: row.kind,
    x: row.x,
    z: row.z,
    workRadius: row.workRadius,
    actionCooldown: row.actionCooldown,
    timber: row.timber,
    firewood: row.firewood,
    stone: row.stone,
    water: row.water,
    food: row.food,
    grain: row.grain,
    barley: row.barley,
    malt: row.malt,
    flax: row.flax,
    flour: row.flour,
    ale: row.ale,
    preservedFood: row.preservedFood,
    honey: row.honey,
    wine: row.wine,
    wool: row.wool,
    cloth: row.cloth,
    ironwork: row.ironwork,
    polearms: row.polearms,
    iron: row.iron,
    clay: row.clay,
    salt: row.salt,
    charcoal: row.charcoal,
    pottery: row.pottery,
    manure: row.manure,
    remedies: row.remedies,
    gold: row.gold,
    waterCapacity: row.waterCapacity,
    assignedLabor: Number(row.assignedLabor),
    constructionComplete: row.constructionComplete,
    constructionProgress: row.constructionProgress,
    constructionRequiredTimber: row.constructionRequiredTimber,
    constructionRequiredStone: row.constructionRequiredStone,
    constructionRequiredIronwork: row.constructionRequiredIronwork,
    constructionDeliveredTimber: row.constructionDeliveredTimber,
    constructionDeliveredStone: row.constructionDeliveredStone,
    constructionDeliveredIronwork: row.constructionDeliveredIronwork,
    constructionReservedTimber: row.constructionReservedTimber,
    constructionReservedStone: row.constructionReservedStone,
    constructionReservedIronwork: row.constructionReservedIronwork,
    constructionTreasuryTimber: row.constructionTreasuryTimber,
    constructionTreasuryStone: row.constructionTreasuryStone,
    constructionTreasuryIronwork: row.constructionTreasuryIronwork,
    storehouseAcceptsTimber: row.storehouseAcceptsTimber,
    storehouseAcceptsStone: row.storehouseAcceptsStone,
    storehouseAcceptsFirewood: row.storehouseAcceptsFirewood,
    storehouseAcceptsIron: row.storehouseAcceptsIron,
    storehouseAcceptsClay: row.storehouseAcceptsClay,
    storehouseAcceptsSalt: row.storehouseAcceptsSalt,
    storehouseTimberTargetPercent: row.storehouseTimberTargetPercent,
    storehouseStoneTargetPercent: row.storehouseStoneTargetPercent,
    storehouseFirewoodTargetPercent: row.storehouseFirewoodTargetPercent,
    storehouseIronTargetPercent: row.storehouseIronTargetPercent,
    storehouseClayTargetPercent: row.storehouseClayTargetPercent,
    storehouseSaltTargetPercent: row.storehouseSaltTargetPercent,
    processorOutputTargetPercent: row.processorOutputTargetPercent,
    weaverInputPolicy: row.weaverInputPolicy,
    potteryDispatchPolicy: row.potteryDispatchPolicy,
    granaryAcceptsFreshFood: row.granaryAcceptsFreshFood,
    granaryHouseholdsFirst: row.granaryHouseholdsFirst,
    granaryGrainReserve: row.granaryGrainReserve,
    granaryFreshFoodTargetPercent: row.granaryFreshFoodTargetPercent,
    constructionPriority: row.constructionPriority,
    woodcutterTimberReserve: row.woodcutterTimberReserve,
    harvestReservePercent: row.harvestReservePercent,
    carpenterPolearmReserve: row.carpenterPolearmReserve,
    carpenterCartServiceTargetTrips: row.carpenterCartServiceTargetTrips,
    guardhousePayPriority: row.guardhousePayPriority,
    guardhouseFoodReserve: row.guardhouseFoodReserve,
    guardhouseMusterWatchtowerId: row.guardhouseMusterWatchtowerId == null
      || row.guardhouseMusterWatchtowerId === 0n
      ? undefined
      : row.guardhouseMusterWatchtowerId.toString(),
    marketplaceIronworkTarget: row.marketplaceIronworkTarget,
    marketplaceIronTarget: row.marketplaceIronTarget,
    marketplaceSaltTarget: row.marketplaceSaltTarget,
    marketplaceGoldReserveTarget: row.marketplaceGoldReserveTarget,
    marketplaceSpecialtyExportPolicy: row.marketplaceSpecialtyExportPolicy,
    marketplaceSeedGrainTarget: row.marketplaceSeedGrainTarget,
    marketplacePendingTradeCode: row.marketplacePendingTradeCode,
    foundingShelterActive: row.foundingShelterActive,
    chapelMonasteryTitheDue: row.chapelMonasteryTitheDue,
    civicReceiptsGold: row.civicReceiptsGold,
  };
}
