import type { Building } from '../../generated/types.ts';
import { buildingClientId, settlementClientId } from '../spacetimeIds.ts';
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
    pearCider: number;
    mead: number;
    breweryRecipePolicy: number;
    monasteryOrchardPlanting: number;
    monasteryCroftPlanting: number;
    monasteryExtensions: number;
    monasteryNextExtension: number;
    monasteryOrchardPlantedYear: number;
    monasteryOrchardMaturity: number;
    monasteryCroftChoiceYear: number;
    monasteryServiceFunding: number;
    monasteryLastServiceDay: bigint;
    hides: number;
    leather: number;
    shoes: number;
    pears: number;
    aronia: number;
    rosehips: number;
    cabbage: number;
    carrots: number;
    beetroot: number;
    aroniaJam: number;
    rosehipJam: number;
    treeWorkAreaX: number;
    treeWorkAreaZ: number;
    treeWorkAreaRadius: number;
    settlementId: bigint;
    animalFeed: number;
  }>;
  const treeWorkAreaX = Number(materialRow.treeWorkAreaX ?? 0);
  const treeWorkAreaZ = Number(materialRow.treeWorkAreaZ ?? 0);
  const treeWorkAreaRadius = Number(materialRow.treeWorkAreaRadius ?? 0);
  const treeWorkArea = treeWorkAreaRadius > 0
    && Number.isFinite(treeWorkAreaX)
    && Number.isFinite(treeWorkAreaZ)
    && Number.isFinite(treeWorkAreaRadius)
    ? { x: treeWorkAreaX, z: treeWorkAreaZ, radius: treeWorkAreaRadius }
    : undefined;
  return {
    id,
    settlementId: materialRow.settlementId == null || materialRow.settlementId === 0n
      ? undefined
      : settlementClientId(materialRow.settlementId),
    kind: row.kind,
    x: row.x,
    z: row.z,
    workRadius: row.workRadius,
    treeWorkArea,
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
    animalFeed: wholeResourceUnits(materialRow.animalFeed),
    maslinGrain: wholeResourceUnits(row.maslinGrain),
    barley: wholeResourceUnits(row.barley),
    malt: wholeResourceUnits(row.malt),
    flax: wholeResourceUnits(row.flax),
    ryeFlour: wholeResourceUnits(row.ryeFlour),
    maslinFlour: wholeResourceUnits(row.maslinFlour),
    ale: wholeResourceUnits(row.ale),
    cider: wholeResourceUnits(materialRow.cider),
    pearCider: wholeResourceUnits(materialRow.pearCider),
    mead: wholeResourceUnits(materialRow.mead),
    preservedFood: wholeResourceUnits(row.preservedFood),
    honey: wholeResourceUnits(row.honey),
    wine: wholeResourceUnits(row.wine),
    wool: wholeResourceUnits(row.wool),
    cloth: wholeResourceUnits(row.cloth),
    hides: wholeResourceUnits(materialRow.hides),
    leather: wholeResourceUnits(materialRow.leather),
    shoes: wholeResourceUnits(materialRow.shoes),
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
    pears: wholeResourceUnits(materialRow.pears),
    cherries: wholeResourceUnits(row.cherries),
    aronia: wholeResourceUnits(materialRow.aronia),
    rosehips: wholeResourceUnits(materialRow.rosehips),
    vegetables: wholeResourceUnits(row.vegetables),
    cabbage: wholeResourceUnits(materialRow.cabbage),
    carrots: wholeResourceUnits(materialRow.carrots),
    beetroot: wholeResourceUnits(materialRow.beetroot),
    eggs: wholeResourceUnits(row.eggs),
    grapes: wholeResourceUnits(row.grapes),
    curedMeat: wholeResourceUnits(row.curedMeat),
    smokedFish: wholeResourceUnits(row.smokedFish),
    cheese: wholeResourceUnits(row.cheese),
    aroniaJam: wholeResourceUnits(materialRow.aroniaJam),
    rosehipJam: wholeResourceUnits(materialRow.rosehipJam),
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
    storageAcceptanceMask: row.storageAcceptanceMask.toString(),
    constructionPriority: row.constructionPriority,
    woodcutterTimberReserve: wholeResourceUnits(row.woodcutterTimberReserve),
    harvestReservePercent: row.harvestReservePercent,
    carpenterPolearmReserve: wholeResourceUnits(row.carpenterPolearmReserve),
    carpenterCartServiceTargetTrips: row.carpenterCartServiceTargetTrips,
    guardhousePayPriority: row.guardhousePayPriority,
    guardhouseFoodReserve: wholeResourceUnits(row.guardhouseFoodReserve),
    guardhouseMusterWatchtowerId: row.guardhouseMusterWatchtowerId == null
      || row.guardhouseMusterWatchtowerId === 0n
      ? undefined
      : row.guardhouseMusterWatchtowerId.toString(),
    marketplaceIronworkTarget: wholeResourceUnits(row.marketplaceIronworkTarget),
    marketplaceIronTarget: wholeResourceUnits(row.marketplaceIronTarget),
    marketplaceSaltTarget: wholeResourceUnits(row.marketplaceSaltTarget),
    marketplaceGoldReserveTarget: wholeResourceUnits(row.marketplaceGoldReserveTarget),
    marketplaceSpecialtyExportPolicy: row.marketplaceSpecialtyExportPolicy,
    marketplaceDrinkExportPolicy: row.marketplaceDrinkExportPolicy,
    marketplaceProvisionExportPolicy: row.marketplaceProvisionExportPolicy,
    marketplaceWaresExportPolicy: row.marketplaceWaresExportPolicy,
    marketplaceSeedGrainTarget: wholeResourceUnits(row.marketplaceSeedGrainTarget),
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
    vineyardFermentingGrapes: wholeResourceUnits(row.vineyardFermentingGrapes),
    vineyardFermentationProgress: row.vineyardFermentationProgress,
    apiaryHarvestPolicy: row.apiaryHarvestPolicy,
    apiaryColonyHealth: row.apiaryColonyHealth,
    apiaryLastWinterYear: row.apiaryLastWinterYear,
    apiaryForageScore: row.apiaryForageScore,
    monasteryOrchardPlanting: (materialRow.monasteryOrchardPlanting === 1 ? 1 : 0),
    monasteryCroftPlanting: (materialRow.monasteryCroftPlanting === 1 ? 1 : 0),
    monasteryExtensions: Number(materialRow.monasteryExtensions ?? 0),
    monasteryNextExtension: Number(materialRow.monasteryNextExtension ?? 0),
    monasteryOrchardPlantedYear: Number(materialRow.monasteryOrchardPlantedYear ?? 0),
    monasteryOrchardMaturity: Math.max(
      0,
      Math.min(2, Number(materialRow.monasteryOrchardMaturity ?? 2)),
    ) as 0 | 1 | 2,
    monasteryCroftChoiceYear: Number(materialRow.monasteryCroftChoiceYear ?? 0),
    monasteryServiceFunding: Math.max(
      0,
      Math.min(1, Number(materialRow.monasteryServiceFunding ?? 1)),
    ),
    monasteryLastServiceDay: materialRow.monasteryLastServiceDay ?? 0n,
  };
}
