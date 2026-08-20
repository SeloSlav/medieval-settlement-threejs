import type { Building } from '../../generated/types.ts';
import { buildingClientId } from '../spacetimeIds.ts';
import type { BuildingState } from '../../resources/types.ts';
import { isBuildingKind } from '../../resources/types.ts';
import { wholeResourceUnits } from '../../resources/resourceUnits.ts';

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
  const materialRow = row as Building & Partial<{
    roofTiles: number;
    potterFiringPolicy: number;
    linkedWorksiteId: bigint;
    commuteEfficiency: number;
    chapelTier: number;
    fireRepairActive: boolean;
    constructionRequiredRoofTiles: number;
    constructionDeliveredRoofTiles: number;
    constructionReservedRoofTiles: number;
    constructionTreasuryRoofTiles: number;
    cider: number;
    mead: number;
    breweryRecipePolicy: number;
    monasteryOrchardPlanting: number;
    monasteryCroftPlanting: number;
  }>;
  return {
    id,
    kind: row.kind,
    x: row.x,
    z: row.z,
    workRadius: row.workRadius,
    actionCooldown: row.actionCooldown,
    timber: wholeResourceUnits(row.timber),
    firewood: wholeResourceUnits(row.firewood),
    stone: wholeResourceUnits(row.stone),
    water: wholeResourceUnits(row.water),
    food: wholeResourceUnits(row.food),
    ryeSheaves: wholeResourceUnits(row.ryeSheaves),
    oatSheaves: wholeResourceUnits(row.oatSheaves),
    barleySheaves: wholeResourceUnits(row.barleySheaves),
    maslinSheaves: wholeResourceUnits(row.maslinSheaves),
    ryeGrain: wholeResourceUnits(row.ryeGrain),
    oatGrain: wholeResourceUnits(row.oatGrain),
    maslinGrain: wholeResourceUnits(row.maslinGrain),
    barley: wholeResourceUnits(row.barley),
    malt: wholeResourceUnits(row.malt),
    flax: wholeResourceUnits(row.flax),
    ryeFlour: wholeResourceUnits(row.ryeFlour),
    maslinFlour: wholeResourceUnits(row.maslinFlour),
    ale: wholeResourceUnits(row.ale),
    cider: wholeResourceUnits(materialRow.cider),
    mead: wholeResourceUnits(materialRow.mead),
    preservedFood: wholeResourceUnits(row.preservedFood),
    honey: wholeResourceUnits(row.honey),
    wine: wholeResourceUnits(row.wine),
    wool: wholeResourceUnits(row.wool),
    cloth: wholeResourceUnits(row.cloth),
    ironwork: wholeResourceUnits(row.ironwork),
    polearms: wholeResourceUnits(row.polearms),
    iron: wholeResourceUnits(row.iron),
    clay: wholeResourceUnits(row.clay),
    salt: wholeResourceUnits(row.salt),
    charcoal: wholeResourceUnits(row.charcoal),
    pottery: wholeResourceUnits(row.pottery),
    roofTiles: wholeResourceUnits(materialRow.roofTiles),
    manure: wholeResourceUnits(row.manure),
    remedies: wholeResourceUnits(row.remedies),
    ryeBread: wholeResourceUnits(row.ryeBread),
    maslinBread: wholeResourceUnits(row.maslinBread),
    meat: wholeResourceUnits(row.meat),
    fish: wholeResourceUnits(row.fish),
    berries: wholeResourceUnits(row.berries),
    mushrooms: wholeResourceUnits(row.mushrooms),
    milk: wholeResourceUnits(row.milk),
    apples: wholeResourceUnits(row.apples),
    cherries: wholeResourceUnits(row.cherries),
    vegetables: wholeResourceUnits(row.vegetables),
    eggs: wholeResourceUnits(row.eggs),
    grapes: wholeResourceUnits(row.grapes),
    curedMeat: wholeResourceUnits(row.curedMeat),
    smokedFish: wholeResourceUnits(row.smokedFish),
    cheese: wholeResourceUnits(row.cheese),
    gold: wholeResourceUnits(row.gold),
    waterCapacity: wholeResourceUnits(row.waterCapacity),
    assignedLabor: Number(row.assignedLabor),
    constructionComplete: row.constructionComplete,
    fireRepairActive: materialRow.fireRepairActive === true,
    constructionProgress: row.constructionProgress,
    constructionRequiredTimber: wholeResourceUnits(row.constructionRequiredTimber),
    constructionRequiredStone: wholeResourceUnits(row.constructionRequiredStone),
    constructionRequiredIronwork: wholeResourceUnits(row.constructionRequiredIronwork),
    constructionRequiredRoofTiles: wholeResourceUnits(materialRow.constructionRequiredRoofTiles),
    constructionDeliveredTimber: wholeResourceUnits(row.constructionDeliveredTimber),
    constructionDeliveredStone: wholeResourceUnits(row.constructionDeliveredStone),
    constructionDeliveredIronwork: wholeResourceUnits(row.constructionDeliveredIronwork),
    constructionDeliveredRoofTiles: wholeResourceUnits(materialRow.constructionDeliveredRoofTiles),
    constructionReservedTimber: wholeResourceUnits(row.constructionReservedTimber),
    constructionReservedStone: wholeResourceUnits(row.constructionReservedStone),
    constructionReservedIronwork: wholeResourceUnits(row.constructionReservedIronwork),
    constructionReservedRoofTiles: wholeResourceUnits(materialRow.constructionReservedRoofTiles),
    constructionTreasuryTimber: wholeResourceUnits(row.constructionTreasuryTimber),
    constructionTreasuryStone: wholeResourceUnits(row.constructionTreasuryStone),
    constructionTreasuryIronwork: wholeResourceUnits(row.constructionTreasuryIronwork),
    constructionTreasuryRoofTiles: wholeResourceUnits(materialRow.constructionTreasuryRoofTiles),
    storehouseAcceptsTimber: row.storehouseAcceptsTimber,
    storehouseAcceptsStone: row.storehouseAcceptsStone,
    storehouseAcceptsFirewood: row.storehouseAcceptsFirewood,
    storehouseAcceptsCharcoal: row.storehouseAcceptsCharcoal,
    storehouseAcceptsIron: row.storehouseAcceptsIron,
    storehouseAcceptsClay: row.storehouseAcceptsClay,
    storehouseAcceptsSalt: row.storehouseAcceptsSalt,
    storehouseTimberTargetPercent: row.storehouseTimberTargetPercent,
    storehouseStoneTargetPercent: row.storehouseStoneTargetPercent,
    storehouseFirewoodTargetPercent: row.storehouseFirewoodTargetPercent,
    storehouseCharcoalTargetPercent: row.storehouseCharcoalTargetPercent,
    storehouseIronTargetPercent: row.storehouseIronTargetPercent,
    storehouseClayTargetPercent: row.storehouseClayTargetPercent,
    storehouseSaltTargetPercent: row.storehouseSaltTargetPercent,
    processorOutputTargetPercent: row.processorOutputTargetPercent,
    breweryRecipePolicy: Number(materialRow.breweryRecipePolicy ?? 0),
    threshingPriority: row.threshingPriority,
    weaverInputPolicy: row.weaverInputPolicy,
    potteryDispatchPolicy: row.potteryDispatchPolicy,
    potterFiringPolicy: Number(materialRow.potterFiringPolicy ?? 0),
    granaryAcceptsFreshFood: row.granaryAcceptsFreshFood,
    granaryHouseholdsFirst: row.granaryHouseholdsFirst,
    granaryGrainReserve: wholeResourceUnits(row.granaryGrainReserve),
    granaryFreshFoodTargetPercent: row.granaryFreshFoodTargetPercent,
    constructionPriority: row.constructionPriority,
    woodcutterTimberReserve: wholeResourceUnits(row.woodcutterTimberReserve),
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
    marketplaceDrinkExportPolicy: row.marketplaceDrinkExportPolicy,
    marketplaceProvisionExportPolicy: row.marketplaceProvisionExportPolicy,
    marketplaceWaresExportPolicy: row.marketplaceWaresExportPolicy,
    marketplaceSeedGrainTarget: row.marketplaceSeedGrainTarget,
    marketplacePendingTradeCode: row.marketplacePendingTradeCode,
    foundingShelterActive: row.foundingShelterActive,
    linkedWorksiteId: materialRow.linkedWorksiteId == null
      || materialRow.linkedWorksiteId === 0n
      ? undefined
      : buildingClientId(materialRow.linkedWorksiteId),
    commuteEfficiency: Math.max(0, Math.min(1, Number(materialRow.commuteEfficiency ?? 1))),
    chapelMonasteryTitheDue: wholeResourceUnits(row.chapelMonasteryTitheDue),
    chapelTier: Math.max(1, Math.min(3, Number(materialRow.chapelTier ?? 3))) as 1 | 2 | 3,
    civicReceiptsGold: wholeResourceUnits(row.civicReceiptsGold),
    privateExportProceedsGold: wholeResourceUnits(row.privateExportProceedsGold),
    vineyardProductionPolicy: row.vineyardProductionPolicy,
    vineyardFermentingGrapes: wholeResourceUnits(row.vineyardFermentingGrapes),
    vineyardFermentationProgress: row.vineyardFermentationProgress,
    apiaryHarvestPolicy: row.apiaryHarvestPolicy,
    apiaryColonyHealth: row.apiaryColonyHealth,
    apiaryLastWinterYear: row.apiaryLastWinterYear,
    apiaryForageScore: row.apiaryForageScore,
    monasteryOrchardPlanting: (materialRow.monasteryOrchardPlanting === 1 ? 1 : 0),
    monasteryCroftPlanting: (materialRow.monasteryCroftPlanting === 1 ? 1 : 0),
  };
}
