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
    flour: row.flour,
    ale: row.ale,
    preservedFood: row.preservedFood,
    honey: row.honey,
    wine: row.wine,
    wool: row.wool,
    cloth: row.cloth,
    ironwork: row.ironwork,
    polearms: row.polearms,
    gold: row.gold,
    waterCapacity: row.waterCapacity,
    assignedLabor: Number(row.assignedLabor),
    constructionComplete: row.constructionComplete,
    constructionProgress: row.constructionProgress,
    constructionRequiredTimber: row.constructionRequiredTimber,
    constructionRequiredStone: row.constructionRequiredStone,
    constructionDeliveredTimber: row.constructionDeliveredTimber,
    constructionDeliveredStone: row.constructionDeliveredStone,
    constructionReservedTimber: row.constructionReservedTimber,
    constructionReservedStone: row.constructionReservedStone,
    constructionTreasuryTimber: row.constructionTreasuryTimber,
    constructionTreasuryStone: row.constructionTreasuryStone,
    storehouseAcceptsTimber: row.storehouseAcceptsTimber,
    storehouseAcceptsStone: row.storehouseAcceptsStone,
    storehouseAcceptsFirewood: row.storehouseAcceptsFirewood,
    storehouseTimberTargetPercent: row.storehouseTimberTargetPercent,
    storehouseStoneTargetPercent: row.storehouseStoneTargetPercent,
    storehouseFirewoodTargetPercent: row.storehouseFirewoodTargetPercent,
    processorOutputTargetPercent: row.processorOutputTargetPercent,
    granaryAcceptsFreshFood: row.granaryAcceptsFreshFood,
    granaryHouseholdsFirst: row.granaryHouseholdsFirst,
    granaryGrainReserve: row.granaryGrainReserve,
    granaryFreshFoodTargetPercent: row.granaryFreshFoodTargetPercent,
    constructionPriority: row.constructionPriority,
    woodcutterTimberReserve: row.woodcutterTimberReserve,
    harvestReservePercent: row.harvestReservePercent,
    carpenterPolearmReserve: row.carpenterPolearmReserve,
    guardhousePayPriority: row.guardhousePayPriority,
    guardhouseFoodReserve: row.guardhouseFoodReserve,
    marketplaceIronworkTarget: row.marketplaceIronworkTarget,
    marketplaceSpecialtyExportPolicy: row.marketplaceSpecialtyExportPolicy,
    marketplaceSeedGrainTarget: row.marketplaceSeedGrainTarget,
  };
}
