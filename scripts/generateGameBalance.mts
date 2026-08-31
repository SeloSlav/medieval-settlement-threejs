import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MarketplaceTradeBalance } from './generateMarketplaceTradeBalance.mts';
import {
  generateMarketplaceTradeRust,
  generateMarketplaceTradeTypeScript,
} from './generateMarketplaceTradeBalance.mts';
import type {
  MarketCommodityBalance,
  MarketWaterCommodityBalance,
  RegionalMarketBalance,
} from './generateRegionalMarketBalance.mts';
import {
  generateRegionalMarketRust,
  generateRegionalMarketTypeScript,
} from './generateRegionalMarketBalance.mts';

type BuildingBalance = {
  label: string;
  cost: { timber: number; stone: number; ironwork?: number; roofTiles?: number; gold?: number };
  storage: {
    total?: number;
    timber: number;
    firewood: number;
    stone: number;
    water?: number;
    food?: number;
    grain?: number;
    barley?: number;
    malt?: number;
    flax?: number;
    flour?: number;
    ale?: number;
    cider?: number;
    pearCider?: number;
    mead?: number;
    preservedFood?: number;
    honey?: number;
    wax?: number;
    candles?: number;
    wine?: number;
    wool?: number;
    yarn?: number;
    linen?: number;
    cloth?: number;
    pelts?: number;
    hides?: number;
    leather?: number;
    shoes?: number;
    ironwork?: number;
    polearms?: number;
    sidearms?: number;
    shields?: number;
    bows?: number;
    crossbows?: number;
    paddedArmor?: number;
    mailArmor?: number;
    ammunition?: number;
    iron?: number;
    clay?: number;
    salt?: number;
    charcoal?: number;
    pottery?: number;
    roofTiles?: number;
    manure?: number;
    remedies?: number;
    animalFeed?: number;
  };
  workRadius: number;
  pickRadius: number;
  harvestInterval: number;
  regrowRatePerSecond: number;
  maxLabor: number;
  acceptsLabor: boolean;
  requiresRoad: boolean;
  facesRoad: boolean;
  requiresMatureTrees: boolean;
  requiresQuarryStone: boolean;
  requiresGame: boolean;
  requiresBerries: boolean;
  requiresFish?: boolean;
  requiresWaterShore?: boolean;
  requiresHillside?: boolean;
};

type BackyardGardenBalance = {
  label: string;
  cost: { timber: number; stone: number; gold: number };
  foodPerPersonPerSec: number;
  settlementAttractionMultiplier: number;
  hiddenFromPicker?: boolean;
  specializationOf?: string;
  firstHarvestDays?: number;
  gestationDays?: number;
  harvestStartMonth?: number;
  harvestEndMonth?: number;
  productionIntervalDays?: number;
  secondaryFoodPerPersonPerSec?: number;
  secondaryProductionIntervalDays?: number;
  secondaryHarvestStartMonth?: number;
  secondaryHarvestEndMonth?: number;
  hidePerPersonPerSecondaryHarvest?: number;
  hideCapacity?: number;
  waxPerSecondaryHarvest?: number;
  waxCapacity?: number;
  yieldEfficiency?: number;
  jamPerPersonPerSec?: number;
  luxuryUpgradeGoldCost?: number;
};

type FarmCropBalance = {
  id: number;
  label: string;
  produce: 'grain' | 'barley' | 'fibre' | 'none';
  workSeason: 'spring' | 'autumn';
  seedGrainPerSquareMeter: number;
  yieldMultiplier: number;
  moistureIdeal: number;
  moistureTolerance: number;
  soilTextureIdeal: number;
  soilTextureTolerance: number;
  soilDepthDemand: number;
  slopePenaltyMultiplier: number;
  sitePreference: string;
  fertilityDelta: number;
  workStartMonth: number;
  workEndMonth: number;
  growthStartMonth: number;
  growthEndMonth: number;
  harvestMonth: number;
  calendarLabel: string;
};

type LivestockSpeciesBalance = {
  starterHerd: number;
  maxHerd: number;
  minimumBreedingReserve: number;
  defaultBreedingReserve: number;
  purchaseGoldPerHead: number;
  saleGoldPerHead: number;
  areaPerHead: number;
  headsPerWorker: number;
  waterPerHeadPerCycle: number;
  dairyProductiveShare: number;
  foodPerCyclePerHead: number;
  slaughterFoodPerHead: number;
  slaughterPreservedFoodPerHead: number;
  slaughterHidesPerHead: number;
  hayPerUnsupportedHead?: number;
  hayYieldPerReservedCapacityPerCycle?: number;
  grainPerUnsupportedHead: number;
  breedingPerCycle: number;
  healthRecoveryPerCycle: number;
  healthLossPerCycle: number;
  maxSlopeDegrees?: number;
  moistureIdeal?: number;
  moistureTolerance?: number;
  preservedFoodPerCyclePerHead?: number;
  woolPerShearingPerHead?: number;
  shearingStartMonth?: number;
  shearingEndMonth?: number;
  manurePerSuppliedHeadPerCycle?: number;
  manureCollectionSpringMultiplier?: number;
  manureCollectionSummerMultiplier?: number;
  manureCollectionAutumnMultiplier?: number;
  manureCollectionWinterMultiplier?: number;
  maxPloughSupportedFields?: number;
  ploughWorkMultiplier?: number;
  matureTreesPerHead?: number;
};

type TradeResource = 'timber' | 'stone' | 'firewood'
  | 'ryeGrain' | 'oatGrain' | 'maslinGrain'
  | 'ryeFlour' | 'maslinFlour'
  | 'ryeBread' | 'maslinBread'
  | 'barley' | 'ironwork' | 'iron' | 'salt' | 'pottery'
  | 'pelts' | 'hides' | 'leather' | 'shoes'
  | 'wool' | 'yarn' | 'linen' | 'cloth' | 'flax';

type MarketplaceGoldBuyOffer = {
  id: string;
  kind: 'goldBuy';
  resource: TradeResource;
  amount: number;
  goldCost: number;
};

type MarketplaceGoldSellOffer = {
  id: string;
  kind: 'goldSell';
  resource: TradeResource;
  amount: number;
  goldYield: number;
};

type MarketplaceBarterOffer = {
  id: string;
  kind: 'barter';
  give: TradeResource;
  giveAmount: number;
  receive: TradeResource;
  receiveAmount: number;
};

type MarketplaceTradeOffer = MarketplaceGoldBuyOffer | MarketplaceGoldSellOffer | MarketplaceBarterOffer;

export type GameBalance = {
  sim: {
    tickMicros: number;
    tickDt: number;
    baseSpeedNumerator: number;
    baseSpeedDenominator: number;
  };
  calendar: {
    secondsPerDay: number;
    hoursPerDay: number;
    daysPerMonth: number;
    monthsPerYear: number;
    daysPerWeek: number;
    sundayWeekday: number;
    startMonth: number;
    dayStartHour: number;
    workStartHour: number;
    workEndHour: number;
  };
  workforce: {
    averageWalkSpeedMps: number;
    movementSpeedMultiplier: number;
    roadSpeedMultiplier: number;
  };
  combatSteering: {
    cellSizeM: number;
    neighborRadiusM: number;
    separationDistanceM: number;
    predictionSeconds: number;
    maxNeighbors: number;
    goalWeight: number;
    separationWeight: number;
    predictiveWeight: number;
    alignmentWeight: number;
    cohesionWeight: number;
    engagementSlotCount: number;
    engagementRadiusFactor: number;
    engagementMinRadiusM: number;
    rangedLineSpacingM: number;
    rangedDepthSpacingM: number;
    rangedPreferredRangeFactor: number;
    velocityResponsePerSecond: number;
    maxTurnRadiansPerSecond: number;
    exactOverlapEpsilonSq: number;
    hardConstraintIterations: number;
    hardClearanceEpsilonM: number;
  };
  seasons: {
    springRainChance: number;
    springRainCropGrowthMultiplier: number;
    springRainWellRefillMultiplier: number;
    springRainRoadSpeedMultiplier: number;
    springRainWatermillThroughputMultiplier: number;
    springRainCharcoalBurnerThroughputMultiplier: number;
    summerDroughtChance: number;
    summerDroughtDurationDays: number;
    droughtCropGrowthMultiplier: number;
    droughtForageRegrowthMultiplier: number;
    droughtWellRefillMultiplier: number;
    droughtGroundwaterMultiplier: number;
    droughtFishLossFractionPerDay: number;
    droughtWatermillThroughputMultiplier: number;
    droughtCharcoalBurnerThroughputMultiplier: number;
    springFirewoodDemandMultiplier: number;
    summerFirewoodDemandMultiplier: number;
    autumnFirewoodDemandMultiplier: number;
    winterFirewoodDemandMultiplier: number;
    springPastureCapacityMultiplier: number;
    summerPastureCapacityMultiplier: number;
    autumnPastureCapacityMultiplier: number;
    winterPastureCapacityMultiplier: number;
    droughtPastureCapacityMultiplier: number;
    seasonalConceptionMultiplier: number;
    autumnRoadSpeedMultiplier: number;
    winterRoadSpeedMultiplier: number;
    winterWatermillThroughputMultiplier: number;
    winterCharcoalBurnerThroughputMultiplier: number;
    freshFoodSpoilageSpringPerDay: number;
    freshFoodSpoilageSummerPerDay: number;
    freshFoodSpoilageAutumnPerDay: number;
    freshFoodSpoilageWinterPerDay: number;
    freshFoodSpoilageDroughtPerDay: number;
    freshFoodStorageFactors: {
      defaultBuilding: number;
      granary: number;
      smokehouse: number;
      monastery: number;
      marketplace: number;
      residence: number;
      cart: number;
      treasury: number;
    };
    preservedFoodSpoilagePerDay: number;
    preservedFoodSpoilageSpringMultiplier: number;
    preservedFoodSpoilageSummerMultiplier: number;
    preservedFoodSpoilageAutumnMultiplier: number;
    preservedFoodSpoilageWinterMultiplier: number;
    preservedFoodSpoilageDroughtMultiplier: number;
    preservedFoodStorageFactors: {
      defaultBuilding: number;
      granary: number;
      smokehouse: number;
      monastery: number;
      marketplace: number;
      residence: number;
      cart: number;
      treasury: number;
    };
  };
  fires: {
    lightningIgnitionChancePerRainDay: number;
    accidentIgnitionChancePerStructureDay: number;
    defaultBuildingBaseFlammability: number;
    buildingBaseFlammability: Partial<Record<string, number>>;
    droughtRiskMultiplier: number;
    rainRiskMultiplier: number;
    spreadRadius: number;
    spreadChancePerSecond: number;
    initialIntensity: number;
    intensityGrowthPerSecond: number;
    rainIntensityDampingPerSecond: number;
    damagePerIntensitySecond: number;
    bucketWater: number;
    minimumBucketWater: number;
    bucketSpeedMps: number;
    bucketUnloadSeconds: number;
    intensityReductionPerWater: number;
    extinguishIntensityThreshold: number;
    extinguishChanceBase: number;
    extinguishChancePerWater: number;
    resolvedRetentionSeconds: number;
    minimumRepairCostFraction: number;
    damageRepairCostMultiplier: number;
    destroyedRebuildCostFraction: number;
  };
  economy: {
    startingTimber: number;
    startingStone: number;
    startingFirewood: number;
    startingBread: number;
    startingIronwork: number;
    startingGold: number;
    stableOxSlots: number;
    stableOxMaxPerWorkplace: number;
    stableOxPurchaseGold: number;
    kennelDogSlots: number;
    kennelDogPurchaseGold: number;
    kennelDogMaxPerHuntersHall: number;
    kennelDogHuntingRateBonus: number;
    stoneSalvageFraction: number;
    timberSalvageFraction: number;
    goldSalvageFraction: number;
    economicActivityTaxRate: number;
    economicActivityTaxRateMin: number;
    economicActivityTaxRateMax: number;
    lowTaxProductivityBoost: number;
    highTaxProductivityDrag: number;
    foodSaleGoldPerUnit: number;
    smallholdingBackyardProductivityMultiplier: number;
    residenceTimberCost: number;
    residenceStoneCost: number;
    residenceTier2TimberCost: number;
    residenceTier2StoneCost: number;
    residenceTier2GoldCost: number;
    residenceTier3TimberCost: number;
    residenceTier3StoneCost: number;
    residenceTier3GoldCost: number;
    residenceTier4TimberCost: number;
    residenceTier4StoneCost: number;
    residenceTier4GoldCost: number;
    residenceTileRoofTimberCost: number;
    residenceTileRoofTileCost: number;
    residenceTileRoofSalvageFraction: number;
    residenceTileRoofFlammabilityMultiplier: number;
    householdMaxWealth: number;
    householdProjectWealthReserve: number;
    householdInitialWealthPerSettler: number;
    householdDiscretionaryWealthReserve: number;
    householdDiscretionaryBudgetPerPersonDay: number;
    householdDiscretionaryUnitsPerPersonDay: number;
    householdDiscretionaryMinTier: number;
    householdTier4ShortageDiscretionaryMultiplier: number;
    householdLocalPotteryGoldPerUnit: number;
    localMarketFoodGoldPerMeal: number;
    localMarketFirewoodGoldPerUnit: number;
    localMarketPreservedFoodGoldPerMeal: number;
    localMarketAleGoldPerUnit: number;
    localMarketClothGoldPerUnit: number;
    localMarketPriceMultiplierMin: number;
    localMarketPriceMultiplierMax: number;
    townHallPopulationRequired: number;
    townHallUnstaffedTaxCollectionMultiplier: number;
    localMarketTaxCartThreshold: number;
    landLevyRateDefault: number;
    landLevyRateMin: number;
    landLevyRateMax: number;
    importDutyRateDefault: number;
    importDutyRateMin: number;
    importDutyRateMax: number;
    exportDutyRateDefault: number;
    exportDutyRateMin: number;
    exportDutyRateMax: number;
    landLevyTier1AssessedValue: number;
    landLevyTier2AssessedValue: number;
    landLevyTier3AssessedValue: number;
    landLevyReferencePlotArea: number;
    landLevyAreaMultiplierMin: number;
    landLevyAreaMultiplierMax: number;
    landLevyBackyardMultiplier: number;
    privateExportIncomeCartLoad: number;
  };
  frontierEconomy: {
    carpenterTimberPerPolearm: number;
    carpenterIronworkPerPolearm: number;
    guardhouseFoodPerGuardPerDay: number;
    guardhouseWagePerGuardPerDay: number;
    guardhousePayrollTargetDays: number;
    guardhousePayrollReorderDays: number;
    guardhouseTrainingPerDay: number;
    guardhouseReadinessDecayPerDay: number;
    guardhouseFullMusterRoadDistance: number;
    guardhouseLongMusterRoadDistance: number;
    guardhouseLongMusterEfficiency: number;
    guardhouseUnlinkedMusterEfficiency: number;
    palisadedRefugeBreachSeconds: number;
    palisadedRefugeResidentCapacity: number;
    palisadedRefugeRallyThreatThreshold: number;
  };
  population: {
    starting: number;
    perResidence: number;
    residencePopulationNarrow: number;
    residencePopulationWide: number;
    narrowParcelFrontageMax: number;
    wideParcelFrontageMin: number;
    residenceFirewoodCapacity: number;
    residenceFirewoodPerPersonPerSec: number;
    residenceFirewoodUnitsPerMonth: number;
    charcoalHouseholdFuelValue: number;
    marketplaceFuelReserveDays: number;
    marketplaceFoodStallSlots: number;
    marketplaceGoodsStallSlots: number;
    marketplaceHouseholdIssueChecksPerDay: number;
    residenceFirewoodPriorityWinterDays: number;
    residenceWaterCapacity: number;
    residenceWaterReorderFraction: number;
    residenceWaterPerPersonPerSec: number;
    residenceWaterUnitsPerDay: number;
    residenceFoodCapacity: number;
    residenceFoodPerPersonPerSec: number;
    residenceFoodUnitsPerSlotPerMonth: number;
    eveningMealPerPerson: number;
    foodCategoryQualifyingDays: number;
    backyardFoodReserveTier1Days: number;
    backyardFoodReserveTier2Days: number;
    backyardFoodReserveTier3Days: number;
    residenceTier1Capacity: number;
    residenceTier2Capacity: number;
    residenceTier3Capacity: number;
    residenceTier4Capacity: number;
    residencePreservedFoodCapacity: number;
    residencePreservedFoodPerPersonPerSec: number;
    residencePreservedFoodSpringMultiplier: number;
    residencePreservedFoodSummerMultiplier: number;
    residencePreservedFoodAutumnMultiplier: number;
    residencePreservedFoodWinterMultiplier: number;
    residenceAleCapacity: number;
    residenceAlePerPersonPerSec: number;
    residenceAleUnitsPerMonth: number;
    residenceClothCapacity: number;
    residenceClothPerPersonPerSec: number;
    residenceClothMonthsPerUnit: number;
    residenceShoesCapacity: number;
    residenceShoesPerPersonPerSec: number;
    residenceShoesMonthsPerUnit: number;
    residencePotteryCapacity: number;
    residencePotteryPerPersonPerSec: number;
    residencePotteryMonthsPerUnit: number;
    residenceLuxuryCapacity: number;
    residenceLuxuryJamPerPersonPerSec: number;
    residenceLuxuryUnitsPerMonth: number;
    approvalBaseScore: number;
    approvalNeedPressureRampDays: number;
    approvalMaxNeedPenalty: number;
    approvalMaxAcutePenalty: number;
    approvalDeclinePointsPerRealHour: number;
    hungerWarningDays: number;
    malnutritionDays: number;
    starvationDeathStartDays: number;
    starvationDeathChancePerPersonDay: number;
    starvationDeathMaxChancePerPersonDay: number;
    starvationDeathRiskRampDays: number;
    malnutritionRecoveryDays: number;
    residenceServiceWarningDays: number;
    residenceUpgradeServiceBlockDays: number;
    baseIllnessChancePerPersonDay: number;
    malnutritionIllnessMultiplier: number;
    unsafeWaterIllnessMultiplier: number;
    coldExposureIllnessMultiplier: number;
    coldExposureWarningDays: number;
    coldExposureDeathStartDays: number;
    coldExposureDeathChancePerPersonDay: number;
    coldExposureDeathMaxChancePerPersonDay: number;
    coldExposureDeathRiskRampDays: number;
    corpseDiseaseRadius: number;
    corpseIllnessMultiplier: number;
    illnessRecoveryDays: number;
    illnessMortalityChancePerSickDay: number;
    herbRemediesPerPersonDay: number;
    herbRemedyCapacity: number;
    herbTreatmentPerSickDay: number;
    herbRecoveryMultiplier: number;
    herbMortalityMultiplier: number;
    graveyardMinArea: number;
    graveyardMinEdge: number;
    graveyardMaxSlope: number;
    graveyardMaxDistance: number;
    graveAreaPerBurial: number;
    burialCartSpeedMps: number;
    residenceRecoveryFirewoodMin: number;
    residenceRecoveryWaterMin: number;
    residenceRecoveryFoodMin: number;
    residenceSettlementBufferDays: number;
    residenceSettleTicks: number;
    chapelSettlementTicksMultiplier: number;
    chapelTitheGoldPerPersonPerDay: number;
    chapelBaseAttendanceChance: number;
    chapelPriestAttendanceBonus: number;
    chapelCommunityAttendanceBonus: number;
    chapelRecoveryStockMultiplier: number;
    chapelRecoveryNeedsRequired: number;
    chapelCofferCapacity: number;
    chapelTier1CofferCapacity: number;
    chapelTier3CofferCapacity: number;
    chapelTier1TitheMultiplier: number;
    chapelTier2TitheMultiplier: number;
    chapelTier3TitheMultiplier: number;
    chapelTier2UpgradeTimber: number;
    chapelTier2UpgradeStone: number;
    chapelTier2UpgradeIronwork: number;
    chapelTier2UpgradeRoofTiles: number;
    chapelTier3UpgradeTimber: number;
    chapelTier3UpgradeStone: number;
    chapelTier3UpgradeIronwork: number;
    chapelTier3UpgradeRoofTiles: number;
    chapelPriestSalaryGoldPerDay: number;
    chapelUpkeepGoldPerDay: number;
    chapelUnstaffedUpkeepFraction: number;
    chapelCharityGoldPerDay: number;
    chapelCharityMinCofferGold: number;
    chapelPoorReliefGoldPerDispatch: number;
    chapelPoorReliefIntervalDays: number;
    chapelCofferReserveDefault: number;
    chapelCofferReserveMin: number;
    chapelCofferReserveMax: number;
    sabbathObservanceAttendanceBonus: number;
    sabbathObservanceSettlementBonus: number;
    monasterySettlementTicksMultiplier: number;
    monasteryRecoveryStockMultiplier: number;
    monasteryAttendanceBonus: number;
    monasteryMinFootprintSlope: number;
  };
  roads: {
    buildingRoadAccessDistance: number;
    burgageRoadFrontageDistance: number;
    offroadDeliverySpeedMultiplier: number;
    minDeliveryTripSec: number;
    firewoodDeliverySpeedMps: number;
    waterDeliverySpeedMps: number;
    foodDeliverySpeedMps: number;
    remedyDeliverySpeedMps: number;
    firewoodDeliveryUnloadSec: number;
    waterDeliveryUnloadSec: number;
    foodDeliveryUnloadSec: number;
    remedyDeliveryUnloadSec: number;
    timberDeliverySpeedMps: number;
    timberDeliveryUnloadSec: number;
  };
  construction: {
    maxBuilders: number;
    workPerWorkerPerSecond: number;
    haulPerWorker: number;
    deliverySpeedMps: number;
    deliveryUnloadSec: number;
    treasuryTransferPerSecond: number;
  };
  quarries: {
    largeMaxYield: number;
    smallMaxYield: number;
  };
  production: {
    lodgeTimberPerCycle: number;
    lodgeTimberPerDelivery: number;
    lodgeFirewoodPerCycle: number;
    lodgeFirewoodPerDelivery: number;
    stonePerHarvest: number;
    gameAnimalsPerHarvest: number;
    gamePerHarvest: number;
    gamePeltsPerAnimal: number;
    berriesPerHarvest: number;
    mushroomsPerHarvest: number;
    foragerRemediesPerHarvest: number;
    foragerRemedySeasonStartMonth: number;
    foragerRemedySeasonEndMonth: number;
    remediesPerDelivery: number;
    remedyDeliveryTargetDays: number;
    fishPerHarvest: number;
    richGameYieldMultiplier: number;
    richFishYieldMultiplier: number;
    richBerryYieldMultiplier: number;
    richMushroomYieldMultiplier: number;
    foodPerDelivery: number;
    berriesRegrowPerDay: number;
    mushroomsRegrowPerDay: number;
    mushroomAutumnRegrowthMultiplier: number;
    fishReproductionRatePerDay: number;
    gameReproductionRatePerDay: number;
    richGameRegrowthMultiplier: number;
    richFishRegrowthMultiplier: number;
    richBerryRegrowthMultiplier: number;
    richMushroomRegrowthMultiplier: number;
    gameMinBreedingPopulation: number;
    gameHabitatDisruptionRadius: number;
    naturalTreeMaturationDays: number;
    reforesterRegrowPerSec: number;
    reforesterSparseTreeMaturationWorkdays: number;
    treeRegrowthUpdateIntervalSec: number;
    wellBaseRefillPerSec: number;
    wellMinimumRefillHydrology: number;
    wellSurgeChancePerTick: number;
    wellSurgeAmountMin: number;
    wellSurgeAmountMax: number;
    wellSurgeCooldownSec: number;
    wellWaterPerDelivery: number;
    millWaterPerHarvest: number;
    grainPerFieldCycle: number;
    grainTransferPerTrip: number;
    threshingSheavesPerCycle: number;
    threshingGrainPerCycle: number;
    watermillGrainPerCycle: number;
    watermillWaterPerCycle: number;
    watermillRyeFlourPerCycle: number;
    watermillMaslinFlourPerCycle: number;
    bakeryFlourPerCycle: number;
    bakeryWaterPerCycle: number;
    bakeryFirewoodPerCycle: number;
    bakeryRyeBreadPerCycle: number;
    bakeryMaslinBreadPerCycle: number;
    householdFoodReservePerClaim: number;
    householdFoodReserveCapacityFraction: number;
    breweryBarleyPerMaltCycle: number;
    breweryMaltingWaterPerCycle: number;
    breweryMaltingFirewoodPerCycle: number;
    breweryMaltPerCycle: number;
    breweryMaltPerAleCycle: number;
    breweryBrewingWaterPerCycle: number;
    breweryBrewingFirewoodPerCycle: number;
    breweryAlePerCycle: number;
    breweryApplesPerCiderCycle: number;
    breweryCiderPerCycle: number;
    breweryHoneyPerMeadCycle: number;
    breweryMeadPerCycle: number;
    spinningRettingWoolPerCycle: number;
    spinningRettingFlaxPerCycle: number;
    spinningRettingFlaxWaterPerCycle: number;
    spinningRettingYarnPerCycle: number;
    spinningRettingLinenPerCycle: number;
    weaverYarnPerCycle: number;
    weaverLinenPerCycle: number;
    weaverClothPerCycle: number;
    textileTransferPerTrip: number;
    tanneryHidesPerCycle: number;
    tanneryWaterPerCycle: number;
    tanneryFirewoodPerCycle: number;
    tanneryLeatherPerCycle: number;
    cobblerLeatherPerCycle: number;
    cobblerShoesPerCycle: number;
    leatherTransferPerTrip: number;
    chandleryWaxPerCycle: number;
    chandleryFirewoodPerCycle: number;
    chandleryCandlesPerCycle: number;
    candleTransferPerTrip: number;
    smokehouseFoodPerCycle: number;
    smokehouseFirewoodPerCycle: number;
    smokehouseSaltPerCycle: number;
    smokehousePotteryPerCycle: number;
    smokehousePreservedFoodPerCycle: number;
    miningCampClayPerCycle: number;
    largeQuarryTimberSupportPerCycle: number;
    largeQuarryTimberSupportBufferCycles: number;
    mineIronPerCycle: number;
    mineSaltPerCycle: number;
    mineClayPerCycle: number;
    mineTimberSupportPerCycle: number;
    mineTimberSupportBufferCycles: number;
    richMineThroughputMultiplier: number;
    charcoalBurnerFirewoodPerCycle: number;
    charcoalBurnerCharcoalPerCycle: number;
    smithyIronPerCycle: number;
    smithyCharcoalPerCycle: number;
    smithyWaterPerCycle: number;
    smithyIronworkPerCycle: number;
    civilianToolIronworkPerCycle: number;
    civilianToolReorderCycles: number;
    civilianToolThroughputMultiplier: number;
    potterClayPerCycle: number;
    potterFirewoodPerCycle: number;
    potterWaterPerCycle: number;
    potterPotteryPerCycle: number;
    potterRoofTilesPerCycle: number;
    apiaryHoneyPerCycle: number;
    apiaryWaxPerHoneyCycles: number;
    apiaryWaxPerHarvest: number;
    apiarySeasonStartMonth: number;
    apiaryAccumulationEndMonth: number;
    apiaryHarvestStartMonth: number;
    apiarySeasonEndMonth: number;
    apiaryWinterHoneyRequired: number;
    apiaryConservativeHoneyReserve: number;
    apiaryBalancedHoneyReserve: number;
    apiaryExtractiveHoneyReserve: number;
    apiaryConservativeYieldMultiplier: number;
    apiaryBalancedYieldMultiplier: number;
    apiaryExtractiveYieldMultiplier: number;
    apiaryWinterHealthGain: number;
    apiaryWinterHealthLoss: number;
    apiaryPollinationBonusMax: number;
    backyardApiaryPollinationRadius: number;
    backyardApiaryPollinationContribution: number;
    vineyardGrapesPerHarvestCycle: number;
    vineyardGrapesPerFermentationBatch: number;
    vineyardWinePerFermentationBatch: number;
    vineyardFermentationSeconds: number;
    vineyardHarvestStartMonth: number;
    vineyardHarvestEndMonth: number;
    marketSpecialtyExportPerBrokerPerSecond: number;
    monasteryPilgrimageGoldPerDay: number;
    monasteryHospitalityBonusGoldPerDay: number;
    monasteryHospitalityHoneyPerDay: number;
    monasteryHospitalityDrinkPerDay: number;
    monasteryFeastFood: number;
    monasteryFeastDrink: number;
    monasteryFeastHoney: number;
    monasteryUnlinkedProductivity: number;
    monasteryCoverageRadius: number;
    monasteryTitheShareDefault: number;
    monasteryCharityFoodPerDelivery: number;
    specialtyExportGoldPerHoney: number;
    specialtyExportGoldPerAle: number;
    specialtyExportGoldPerCider: number;
    specialtyExportGoldPerWine: number;
    specialtyExportGoldPerCloth: number;
    specialtyExportGoldPerCheese: number;
    specialtyExportGoldPerPottery: number;
    herbRemedySaleGoldPerUnit: number;
    carpenterDeliverySpeedMultiplier: number;
    carpenterTimberCostMultiplier: number;
    carpenterCartServiceTimberPerTrip: number;
    carpenterCartServiceIronworkPerTrip: number;
    carpenterCartServiceTargetTrips: number;
    storehouseOverflowThreshold: number;
    storehouseHaulPerWorker: number;
    storehouseFirewoodPerDelivery: number;
    smithyCharcoalReorderCycles: number;
    smithyCharcoalTargetCycles: number;
  };
  farming: {
    minFieldArea: number;
    fieldSetupWorkPerStage: number;
    fieldBoundaryWorkPerMeterPerStage: number;
    fieldTravelWorkPerMeterPerStage: number;
    sharedLaborMinPriority: number;
    minFieldEdge: number;
    workMetersPerWorkerPerSec: number;
    farmToolIronworkPerWorkerDay: number;
    oxPloughWorkerMultiplier: number;
    oxHarvestWorkerMultiplier: number;
    ploughWorkPerSquareMeter: number;
    sowWorkPerSquareMeter: number;
    harvestWorkPerSquareMeter: number;
    growthSeconds: number;
    baseGrainPerSquareMeter: number;
    regionalPrimeCropsSmall: number;
    regionalPrimeCropsMedium: number;
    regionalPrimeCropsLarge: number;
    regionalYieldFloor: number;
    regionalAffinityFloor: number;
    regionalUnrepresentedCeiling: number;
    regionalCenterRadiusRatio: number;
    regionalCoreRadiusRatio: number;
    regionalAspectRatio: number;
    manurePerSquareMeter: number;
    manureFertilityBonus: number;
    farmsteadStarterSeedGrain: number;
    farmsteadStarterBarleySeed: number;
    earlyHarvestMonth: number;
    earlyHarvestMinimumGrowth: number;
    earlyHarvestRipenessFactor: number;
    crops: Record<string, FarmCropBalance>;
    slopePenaltyPerDegree: number;
    maxAcceptedSlopeDegrees: number;
    fieldSalvageFraction: number;
  };
  livestock: {
    minPastureArea: number;
    minPastureEdge: number;
    pastureSalvageFraction: number;
    autumnCullStartMonth: number;
    autumnCullEndMonth: number;
    winterFodderReserveDays: number;
    haymakingStartMonth: number;
    haymakingEndMonth: number;
    defaultHaymakingPercent: number;
    maximumHaymakingPercent: number;
    minimumBreedingHeads: number;
    pannageSpringCapacityMultiplier: number;
    pannageSummerCapacityMultiplier: number;
    pannageAutumnCapacityMultiplier: number;
    pannageWinterCapacityMultiplier: number;
    pannageDroughtCapacityMultiplier: number;
    feedOatGrainPerCycle: number;
    animalFeedPerCycle: number;
    animalFeedFodderValue: number;
    hayStorageCapacity: number;
    manureTransferPerTrip: number;
    farmsteadPreservationSaltPerOutput: number;
    farmsteadSaltStagingPerCycle: number;
    cattle: LivestockSpeciesBalance;
    sheep: LivestockSpeciesBalance;
    swine: LivestockSpeciesBalance;
  };
  buildings: Record<string, BuildingBalance>;
  backyardGardens: Record<string, BackyardGardenBalance>;
  marketplaceTrade: MarketplaceTradeBalance;
  regionalMarket: RegionalMarketBalance;
  marketCommodities: MarketCommodityBalance[];
  marketWaterCommodities: MarketWaterCommodityBalance[];
};

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(scriptDir, '..');
const balancePath = join(projectRoot, 'balance/gameBalance.json');
const balance = JSON.parse(readFileSync(balancePath, 'utf8')) as GameBalance;

if (
  balance.buildings.reforester.regrowRatePerSecond
  !== balance.production.reforesterRegrowPerSec
) {
  throw new Error('Reforester building and production regrowth capacities must match.');
}

const buildingKinds = Object.keys(balance.buildings);
const backyardGardenKinds = Object.keys(balance.backyardGardens);
const farmCropKinds = Object.keys(balance.farming.crops);
const farmCropIds = new Set<number>();
for (const [index, kind] of farmCropKinds.entries()) {
  const crop = balance.farming.crops[kind];
  if (crop.id !== index) {
    throw new Error(`Farm crop "${kind}" must keep contiguous id ${index}; received ${crop.id}.`);
  }
  if (farmCropIds.has(crop.id)) {
    throw new Error(`Farm crop id ${crop.id} is duplicated.`);
  }
  farmCropIds.add(crop.id);
}
const simKindByKind: Record<string, string | null> = {
  lumber_mill: 'LumberMill',
  reforester: 'Reforester',
  stone_quarry: 'StoneQuarry',
  large_quarry: 'LargeQuarry',
  mine: 'Mine',
  charcoal_burner: 'CharcoalBurner',
  smithy: 'Smithy',
  weaponsmith_armorer: 'WeaponsmithArmorer',
  bowyer_fletcher: 'BowyerFletcher',
  potter_kiln: 'PotterKiln',
  woodcutters_lodge: 'WoodcuttersLodge',
  well: 'Well',
  hunters_hall: 'HuntersHall',
  foragers_shed: 'ForagersShed',
  fishing_camp: 'FishingCamp',
  chapel: null,
  wayside_shrine: null,
  marketplace: null,
  town_hall: null,
  stable: null,
  kennel: null,
  village_storehouse: 'VillageStorehouse',
  watchtower: null,
  guardhouse: 'Guardhouse',
  threshing_barn: 'ThreshingBarn',
  monastery: 'Monastery',
  brewery: 'Brewery',
  smokehouse: 'Smokehouse',
  granary: 'Granary',
  bakery: 'Bakery',
  apiary: 'Apiary',
  watermill: 'Watermill',
  windmill: 'Windmill',
  carpenter: 'Carpenter',
  spinning_retting_house: 'SpinningRettingHouse',
  weaver: 'Weaver',
  tannery: 'Tannery',
  cobbler: 'Cobbler',
  chandlery: 'Chandlery',
  pastoral_farmstead: 'PastoralFarmstead',
  swineherd: 'Swineherd',
};

function rustF64(value: number): string {
  return Number.isInteger(value) ? `${value}.0` : `${value}`;
}

function generateRust(): string {
  const b = balance;
  const lines: string[] = [
    '// Generated by scripts/generateGameBalance.mts — do not edit.',
    '#![allow(dead_code)]',
    '',
    `pub const TICK_MICROS: i64 = ${b.sim.tickMicros};`,
    `pub const TICK_DT: f64 = ${rustF64(b.sim.tickDt)};`,
    `pub const BASE_SPEED_NUMERATOR: u16 = ${b.sim.baseSpeedNumerator};`,
    `pub const BASE_SPEED_DENOMINATOR: u16 = ${b.sim.baseSpeedDenominator};`,
    '',
    `pub const CALENDAR_SECONDS_PER_DAY: f64 = ${rustF64(b.calendar.secondsPerDay)};`,
    `pub const CALENDAR_HOURS_PER_DAY: u32 = ${b.calendar.hoursPerDay};`,
    `pub const CALENDAR_DAYS_PER_MONTH: u32 = ${b.calendar.daysPerMonth};`,
    `pub const CALENDAR_MONTHS_PER_YEAR: u32 = ${b.calendar.monthsPerYear};`,
    `pub const CALENDAR_DAYS_PER_WEEK: u32 = ${b.calendar.daysPerWeek};`,
    `pub const CALENDAR_SUNDAY_WEEKDAY: u32 = ${b.calendar.sundayWeekday};`,
    `pub const CALENDAR_START_MONTH: u32 = ${b.calendar.startMonth};`,
    `pub const CALENDAR_DAY_START_HOUR: u32 = ${b.calendar.dayStartHour};`,
    `pub const CALENDAR_DAY_START_OFFSET_SECONDS: f64 = ${rustF64(b.calendar.secondsPerDay * b.calendar.dayStartHour / b.calendar.hoursPerDay)};`,
    `pub const CALENDAR_WORK_START_HOUR: u32 = ${b.calendar.workStartHour};`,
    `pub const CALENDAR_WORK_END_HOUR: u32 = ${b.calendar.workEndHour};`,
    `pub const WORKFORCE_AVERAGE_WALK_SPEED_MPS: f64 = ${rustF64(b.workforce.averageWalkSpeedMps)};`,
    `pub const WORKFORCE_MOVEMENT_SPEED_MULTIPLIER: f64 = ${rustF64(b.workforce.movementSpeedMultiplier)};`,
    `pub const WORKFORCE_ROAD_SPEED_MULTIPLIER: f64 = ${rustF64(b.workforce.roadSpeedMultiplier)};`,
    '',
    `pub const COMBAT_STEERING_CELL_SIZE_M: f64 = ${rustF64(b.combatSteering.cellSizeM)};`,
    `pub const COMBAT_STEERING_NEIGHBOR_RADIUS_M: f64 = ${rustF64(b.combatSteering.neighborRadiusM)};`,
    `pub const COMBAT_STEERING_SEPARATION_DISTANCE_M: f64 = ${rustF64(b.combatSteering.separationDistanceM)};`,
    `pub const COMBAT_STEERING_PREDICTION_SECONDS: f64 = ${rustF64(b.combatSteering.predictionSeconds)};`,
    `pub const COMBAT_STEERING_MAX_NEIGHBORS: usize = ${Math.max(1, Math.round(b.combatSteering.maxNeighbors))};`,
    `pub const COMBAT_STEERING_GOAL_WEIGHT: f64 = ${rustF64(b.combatSteering.goalWeight)};`,
    `pub const COMBAT_STEERING_SEPARATION_WEIGHT: f64 = ${rustF64(b.combatSteering.separationWeight)};`,
    `pub const COMBAT_STEERING_PREDICTIVE_WEIGHT: f64 = ${rustF64(b.combatSteering.predictiveWeight)};`,
    `pub const COMBAT_STEERING_ALIGNMENT_WEIGHT: f64 = ${rustF64(b.combatSteering.alignmentWeight)};`,
    `pub const COMBAT_STEERING_COHESION_WEIGHT: f64 = ${rustF64(b.combatSteering.cohesionWeight)};`,
    `pub const COMBAT_STEERING_ENGAGEMENT_SLOT_COUNT: usize = ${Math.max(1, Math.round(b.combatSteering.engagementSlotCount))};`,
    `pub const COMBAT_STEERING_ENGAGEMENT_RADIUS_FACTOR: f64 = ${rustF64(b.combatSteering.engagementRadiusFactor)};`,
    `pub const COMBAT_STEERING_ENGAGEMENT_MIN_RADIUS_M: f64 = ${rustF64(b.combatSteering.engagementMinRadiusM)};`,
    `pub const COMBAT_STEERING_RANGED_LINE_SPACING_M: f64 = ${rustF64(b.combatSteering.rangedLineSpacingM)};`,
    `pub const COMBAT_STEERING_RANGED_DEPTH_SPACING_M: f64 = ${rustF64(b.combatSteering.rangedDepthSpacingM)};`,
    `pub const COMBAT_STEERING_RANGED_PREFERRED_RANGE_FACTOR: f64 = ${rustF64(b.combatSteering.rangedPreferredRangeFactor)};`,
    `pub const COMBAT_STEERING_VELOCITY_RESPONSE_PER_SECOND: f64 = ${rustF64(b.combatSteering.velocityResponsePerSecond)};`,
    `pub const COMBAT_STEERING_MAX_TURN_RADIANS_PER_SECOND: f64 = ${rustF64(b.combatSteering.maxTurnRadiansPerSecond)};`,
    `pub const COMBAT_STEERING_EXACT_OVERLAP_EPSILON_SQ: f64 = ${rustF64(b.combatSteering.exactOverlapEpsilonSq)};`,
    `pub const COMBAT_STEERING_HARD_CONSTRAINT_ITERATIONS: usize = ${Math.max(1, Math.round(b.combatSteering.hardConstraintIterations))};`,
    `pub const COMBAT_STEERING_HARD_CLEARANCE_EPSILON_M: f64 = ${rustF64(b.combatSteering.hardClearanceEpsilonM)};`,
    '',
    `pub const SPRING_RAIN_CHANCE: f64 = ${rustF64(b.seasons.springRainChance)};`,
    `pub const SPRING_RAIN_CROP_GROWTH_MULTIPLIER: f64 = ${rustF64(b.seasons.springRainCropGrowthMultiplier)};`,
    `pub const SPRING_RAIN_WELL_REFILL_MULTIPLIER: f64 = ${rustF64(b.seasons.springRainWellRefillMultiplier)};`,
    `pub const SPRING_RAIN_ROAD_SPEED_MULTIPLIER: f64 = ${rustF64(b.seasons.springRainRoadSpeedMultiplier)};`,
    `pub const SPRING_RAIN_WATERMILL_THROUGHPUT_MULTIPLIER: f64 = ${rustF64(b.seasons.springRainWatermillThroughputMultiplier)};`,
    `pub const SPRING_RAIN_CHARCOAL_BURNER_THROUGHPUT_MULTIPLIER: f64 = ${rustF64(b.seasons.springRainCharcoalBurnerThroughputMultiplier)};`,
    `pub const SUMMER_DROUGHT_CHANCE: f64 = ${rustF64(b.seasons.summerDroughtChance)};`,
    `pub const SUMMER_DROUGHT_DURATION_DAYS: u32 = ${b.seasons.summerDroughtDurationDays};`,
    `pub const DROUGHT_CROP_GROWTH_MULTIPLIER: f64 = ${rustF64(b.seasons.droughtCropGrowthMultiplier)};`,
    `pub const DROUGHT_FORAGE_REGROWTH_MULTIPLIER: f64 = ${rustF64(b.seasons.droughtForageRegrowthMultiplier)};`,
    `pub const DROUGHT_WELL_REFILL_MULTIPLIER: f64 = ${rustF64(b.seasons.droughtWellRefillMultiplier)};`,
    `pub const DROUGHT_GROUNDWATER_MULTIPLIER: f64 = ${rustF64(b.seasons.droughtGroundwaterMultiplier)};`,
    `pub const DROUGHT_FISH_LOSS_FRACTION_PER_DAY: f64 = ${rustF64(b.seasons.droughtFishLossFractionPerDay)};`,
    `pub const DROUGHT_WATERMILL_THROUGHPUT_MULTIPLIER: f64 = ${rustF64(b.seasons.droughtWatermillThroughputMultiplier)};`,
    `pub const DROUGHT_CHARCOAL_BURNER_THROUGHPUT_MULTIPLIER: f64 = ${rustF64(b.seasons.droughtCharcoalBurnerThroughputMultiplier)};`,
    `pub const SPRING_FIREWOOD_DEMAND_MULTIPLIER: f64 = ${rustF64(b.seasons.springFirewoodDemandMultiplier)};`,
    `pub const SUMMER_FIREWOOD_DEMAND_MULTIPLIER: f64 = ${rustF64(b.seasons.summerFirewoodDemandMultiplier)};`,
    `pub const AUTUMN_FIREWOOD_DEMAND_MULTIPLIER: f64 = ${rustF64(b.seasons.autumnFirewoodDemandMultiplier)};`,
    `pub const WINTER_FIREWOOD_DEMAND_MULTIPLIER: f64 = ${rustF64(b.seasons.winterFirewoodDemandMultiplier)};`,
    `pub const SPRING_PASTURE_CAPACITY_MULTIPLIER: f64 = ${rustF64(b.seasons.springPastureCapacityMultiplier)};`,
    `pub const SUMMER_PASTURE_CAPACITY_MULTIPLIER: f64 = ${rustF64(b.seasons.summerPastureCapacityMultiplier)};`,
    `pub const AUTUMN_PASTURE_CAPACITY_MULTIPLIER: f64 = ${rustF64(b.seasons.autumnPastureCapacityMultiplier)};`,
    `pub const WINTER_PASTURE_CAPACITY_MULTIPLIER: f64 = ${rustF64(b.seasons.winterPastureCapacityMultiplier)};`,
    `pub const DROUGHT_PASTURE_CAPACITY_MULTIPLIER: f64 = ${rustF64(b.seasons.droughtPastureCapacityMultiplier)};`,
    `pub const LIVESTOCK_SEASONAL_CONCEPTION_MULTIPLIER: f64 = ${rustF64(b.seasons.seasonalConceptionMultiplier)};`,
    `pub const AUTUMN_ROAD_SPEED_MULTIPLIER: f64 = ${rustF64(b.seasons.autumnRoadSpeedMultiplier)};`,
    `pub const WINTER_ROAD_SPEED_MULTIPLIER: f64 = ${rustF64(b.seasons.winterRoadSpeedMultiplier)};`,
    `pub const WINTER_WATERMILL_THROUGHPUT_MULTIPLIER: f64 = ${rustF64(b.seasons.winterWatermillThroughputMultiplier)};`,
    `pub const WINTER_CHARCOAL_BURNER_THROUGHPUT_MULTIPLIER: f64 = ${rustF64(b.seasons.winterCharcoalBurnerThroughputMultiplier)};`,
    `pub const FRESH_FOOD_SPOILAGE_SPRING_PER_DAY: f64 = ${rustF64(b.seasons.freshFoodSpoilageSpringPerDay)};`,
    `pub const FRESH_FOOD_SPOILAGE_SUMMER_PER_DAY: f64 = ${rustF64(b.seasons.freshFoodSpoilageSummerPerDay)};`,
    `pub const FRESH_FOOD_SPOILAGE_AUTUMN_PER_DAY: f64 = ${rustF64(b.seasons.freshFoodSpoilageAutumnPerDay)};`,
    `pub const FRESH_FOOD_SPOILAGE_WINTER_PER_DAY: f64 = ${rustF64(b.seasons.freshFoodSpoilageWinterPerDay)};`,
    `pub const FRESH_FOOD_SPOILAGE_DROUGHT_PER_DAY: f64 = ${rustF64(b.seasons.freshFoodSpoilageDroughtPerDay)};`,
    `pub const FRESH_FOOD_STORAGE_DEFAULT_BUILDING_FACTOR: f64 = ${rustF64(b.seasons.freshFoodStorageFactors.defaultBuilding)};`,
    `pub const FRESH_FOOD_STORAGE_GRANARY_FACTOR: f64 = ${rustF64(b.seasons.freshFoodStorageFactors.granary)};`,
    `pub const FRESH_FOOD_STORAGE_SMOKEHOUSE_FACTOR: f64 = ${rustF64(b.seasons.freshFoodStorageFactors.smokehouse)};`,
    `pub const FRESH_FOOD_STORAGE_MONASTERY_FACTOR: f64 = ${rustF64(b.seasons.freshFoodStorageFactors.monastery)};`,
    `pub const FRESH_FOOD_STORAGE_MARKETPLACE_FACTOR: f64 = ${rustF64(b.seasons.freshFoodStorageFactors.marketplace)};`,
    `pub const FRESH_FOOD_STORAGE_RESIDENCE_FACTOR: f64 = ${rustF64(b.seasons.freshFoodStorageFactors.residence)};`,
    `pub const FRESH_FOOD_STORAGE_CART_FACTOR: f64 = ${rustF64(b.seasons.freshFoodStorageFactors.cart)};`,
    `pub const FRESH_FOOD_STORAGE_TREASURY_FACTOR: f64 = ${rustF64(b.seasons.freshFoodStorageFactors.treasury)};`,
    `pub const PRESERVED_FOOD_SPOILAGE_PER_DAY: f64 = ${rustF64(b.seasons.preservedFoodSpoilagePerDay)};`,
    `pub const PRESERVED_FOOD_SPOILAGE_SPRING_MULTIPLIER: f64 = ${rustF64(b.seasons.preservedFoodSpoilageSpringMultiplier)};`,
    `pub const PRESERVED_FOOD_SPOILAGE_SUMMER_MULTIPLIER: f64 = ${rustF64(b.seasons.preservedFoodSpoilageSummerMultiplier)};`,
    `pub const PRESERVED_FOOD_SPOILAGE_AUTUMN_MULTIPLIER: f64 = ${rustF64(b.seasons.preservedFoodSpoilageAutumnMultiplier)};`,
    `pub const PRESERVED_FOOD_SPOILAGE_WINTER_MULTIPLIER: f64 = ${rustF64(b.seasons.preservedFoodSpoilageWinterMultiplier)};`,
    `pub const PRESERVED_FOOD_SPOILAGE_DROUGHT_MULTIPLIER: f64 = ${rustF64(b.seasons.preservedFoodSpoilageDroughtMultiplier)};`,
    `pub const PRESERVED_FOOD_STORAGE_DEFAULT_BUILDING_FACTOR: f64 = ${rustF64(b.seasons.preservedFoodStorageFactors.defaultBuilding)};`,
    `pub const PRESERVED_FOOD_STORAGE_GRANARY_FACTOR: f64 = ${rustF64(b.seasons.preservedFoodStorageFactors.granary)};`,
    `pub const PRESERVED_FOOD_STORAGE_SMOKEHOUSE_FACTOR: f64 = ${rustF64(b.seasons.preservedFoodStorageFactors.smokehouse)};`,
    `pub const PRESERVED_FOOD_STORAGE_MONASTERY_FACTOR: f64 = ${rustF64(b.seasons.preservedFoodStorageFactors.monastery)};`,
    `pub const PRESERVED_FOOD_STORAGE_MARKETPLACE_FACTOR: f64 = ${rustF64(b.seasons.preservedFoodStorageFactors.marketplace)};`,
    `pub const PRESERVED_FOOD_STORAGE_RESIDENCE_FACTOR: f64 = ${rustF64(b.seasons.preservedFoodStorageFactors.residence)};`,
    `pub const PRESERVED_FOOD_STORAGE_CART_FACTOR: f64 = ${rustF64(b.seasons.preservedFoodStorageFactors.cart)};`,
    `pub const PRESERVED_FOOD_STORAGE_TREASURY_FACTOR: f64 = ${rustF64(b.seasons.preservedFoodStorageFactors.treasury)};`,
    '',
    `pub const FIRE_LIGHTNING_IGNITION_CHANCE_PER_RAIN_DAY: f64 = ${rustF64(b.fires.lightningIgnitionChancePerRainDay)};`,
    `pub const FIRE_ACCIDENT_IGNITION_CHANCE_PER_STRUCTURE_DAY: f64 = ${rustF64(b.fires.accidentIgnitionChancePerStructureDay)};`,
    `pub const FIRE_DEFAULT_BUILDING_BASE_FLAMMABILITY: f64 = ${rustF64(b.fires.defaultBuildingBaseFlammability)};`,
    `pub const FIRE_DROUGHT_RISK_MULTIPLIER: f64 = ${rustF64(b.fires.droughtRiskMultiplier)};`,
    `pub const FIRE_RAIN_RISK_MULTIPLIER: f64 = ${rustF64(b.fires.rainRiskMultiplier)};`,
    `pub const FIRE_SPREAD_RADIUS: f64 = ${rustF64(b.fires.spreadRadius)};`,
    `pub const FIRE_SPREAD_CHANCE_PER_SECOND: f64 = ${rustF64(b.fires.spreadChancePerSecond)};`,
    `pub const FIRE_INITIAL_INTENSITY: f64 = ${rustF64(b.fires.initialIntensity)};`,
    `pub const FIRE_INTENSITY_GROWTH_PER_SECOND: f64 = ${rustF64(b.fires.intensityGrowthPerSecond)};`,
    `pub const FIRE_RAIN_INTENSITY_DAMPING_PER_SECOND: f64 = ${rustF64(b.fires.rainIntensityDampingPerSecond)};`,
    `pub const FIRE_DAMAGE_PER_INTENSITY_SECOND: f64 = ${rustF64(b.fires.damagePerIntensitySecond)};`,
    `pub const FIRE_BUCKET_WATER: f64 = ${rustF64(b.fires.bucketWater)};`,
    `pub const FIRE_MINIMUM_BUCKET_WATER: f64 = ${rustF64(b.fires.minimumBucketWater)};`,
    `pub const FIRE_BUCKET_SPEED_MPS: f64 = ${rustF64(b.fires.bucketSpeedMps)};`,
    `pub const FIRE_BUCKET_UNLOAD_SECONDS: f64 = ${rustF64(b.fires.bucketUnloadSeconds)};`,
    `pub const FIRE_INTENSITY_REDUCTION_PER_WATER: f64 = ${rustF64(b.fires.intensityReductionPerWater)};`,
    `pub const FIRE_EXTINGUISH_INTENSITY_THRESHOLD: f64 = ${rustF64(b.fires.extinguishIntensityThreshold)};`,
    `pub const FIRE_EXTINGUISH_CHANCE_BASE: f64 = ${rustF64(b.fires.extinguishChanceBase)};`,
    `pub const FIRE_EXTINGUISH_CHANCE_PER_WATER: f64 = ${rustF64(b.fires.extinguishChancePerWater)};`,
    `pub const FIRE_RESOLVED_RETENTION_SECONDS: f64 = ${rustF64(b.fires.resolvedRetentionSeconds)};`,
    `pub const FIRE_MINIMUM_REPAIR_COST_FRACTION: f64 = ${rustF64(b.fires.minimumRepairCostFraction)};`,
    `pub const FIRE_DAMAGE_REPAIR_COST_MULTIPLIER: f64 = ${rustF64(b.fires.damageRepairCostMultiplier)};`,
    `pub const FIRE_DESTROYED_REBUILD_COST_FRACTION: f64 = ${rustF64(b.fires.destroyedRebuildCostFraction)};`,
    '',
    `pub const STARTING_TIMBER: f64 = ${rustF64(b.economy.startingTimber)};`,
    `pub const STARTING_STONE: f64 = ${rustF64(b.economy.startingStone)};`,
    `pub const STARTING_FIREWOOD: f64 = ${rustF64(b.economy.startingFirewood)};`,
    `pub const STARTING_BREAD: f64 = ${rustF64(b.economy.startingBread)};`,
    `pub const STARTING_IRONWORK: f64 = ${rustF64(b.economy.startingIronwork)};`,
    `pub const STARTING_GOLD: f64 = ${rustF64(b.economy.startingGold)};`,
    `pub const STABLE_OX_SLOTS: u8 = ${b.economy.stableOxSlots};`,
    `pub const STABLE_OX_MAX_PER_WORKPLACE: u32 = ${b.economy.stableOxMaxPerWorkplace};`,
    `pub const STABLE_OX_PURCHASE_GOLD: f64 = ${rustF64(b.economy.stableOxPurchaseGold)};`,
    `pub const KENNEL_DOG_SLOTS: u8 = ${b.economy.kennelDogSlots};`,
    `pub const KENNEL_DOG_PURCHASE_GOLD: f64 = ${rustF64(b.economy.kennelDogPurchaseGold)};`,
    `pub const KENNEL_DOG_MAX_PER_HUNTERS_HALL: u32 = ${b.economy.kennelDogMaxPerHuntersHall};`,
    `pub const KENNEL_DOG_HUNTING_RATE_BONUS: f64 = ${rustF64(b.economy.kennelDogHuntingRateBonus)};`,
    `pub const STONE_SALVAGE_FRACTION: f64 = ${rustF64(b.economy.stoneSalvageFraction)};`,
    `pub const TIMBER_SALVAGE_FRACTION: f64 = ${rustF64(b.economy.timberSalvageFraction)};`,
    `pub const IRONWORK_SALVAGE_FRACTION: f64 = ${rustF64(b.economy.ironworkSalvageFraction)};`,
    `pub const GOLD_SALVAGE_FRACTION: f64 = ${rustF64(b.economy.goldSalvageFraction)};`,
    `pub const ECONOMIC_ACTIVITY_TAX_RATE: f64 = ${rustF64(b.economy.economicActivityTaxRate)};`,
    `pub const ECONOMIC_ACTIVITY_TAX_RATE_MIN: f64 = ${rustF64(b.economy.economicActivityTaxRateMin)};`,
    `pub const ECONOMIC_ACTIVITY_TAX_RATE_MAX: f64 = ${rustF64(b.economy.economicActivityTaxRateMax)};`,
    `pub const LOW_TAX_PRODUCTIVITY_BOOST: f64 = ${rustF64(b.economy.lowTaxProductivityBoost)};`,
    `pub const HIGH_TAX_PRODUCTIVITY_DRAG: f64 = ${rustF64(b.economy.highTaxProductivityDrag)};`,
    `pub const FOOD_SALE_GOLD_PER_UNIT: f64 = ${rustF64(b.economy.foodSaleGoldPerUnit)};`,
    `pub const SMALLHOLDING_BACKYARD_PRODUCTIVITY_MULTIPLIER: f64 = ${rustF64(b.economy.smallholdingBackyardProductivityMultiplier)};`,
    `pub const RESIDENCE_TIMBER_COST: f64 = ${rustF64(b.economy.residenceTimberCost)};`,
    `pub const RESIDENCE_STONE_COST: f64 = ${rustF64(b.economy.residenceStoneCost)};`,
    `pub const RESIDENCE_TIER2_TIMBER_COST: f64 = ${rustF64(b.economy.residenceTier2TimberCost)};`,
    `pub const RESIDENCE_TIER2_STONE_COST: f64 = ${rustF64(b.economy.residenceTier2StoneCost)};`,
    `pub const RESIDENCE_TIER2_GOLD_COST: f64 = ${rustF64(b.economy.residenceTier2GoldCost)};`,
    `pub const RESIDENCE_TIER3_TIMBER_COST: f64 = ${rustF64(b.economy.residenceTier3TimberCost)};`,
    `pub const RESIDENCE_TIER3_STONE_COST: f64 = ${rustF64(b.economy.residenceTier3StoneCost)};`,
    `pub const RESIDENCE_TIER3_GOLD_COST: f64 = ${rustF64(b.economy.residenceTier3GoldCost)};`,
    `pub const RESIDENCE_TIER4_TIMBER_COST: f64 = ${rustF64(b.economy.residenceTier4TimberCost)};`,
    `pub const RESIDENCE_TIER4_STONE_COST: f64 = ${rustF64(b.economy.residenceTier4StoneCost)};`,
    `pub const RESIDENCE_TIER4_GOLD_COST: f64 = ${rustF64(b.economy.residenceTier4GoldCost)};`,
    `pub const RESIDENCE_TILE_ROOF_TIMBER_COST: f64 = ${rustF64(b.economy.residenceTileRoofTimberCost)};`,
    `pub const RESIDENCE_TILE_ROOF_TILE_COST: f64 = ${rustF64(b.economy.residenceTileRoofTileCost)};`,
    `pub const RESIDENCE_TILE_ROOF_SALVAGE_FRACTION: f64 = ${rustF64(b.economy.residenceTileRoofSalvageFraction)};`,
    `pub const RESIDENCE_TILE_ROOF_FLAMMABILITY_MULTIPLIER: f64 = ${rustF64(b.economy.residenceTileRoofFlammabilityMultiplier)};`,
    `pub const HOUSEHOLD_MAX_WEALTH: f64 = ${rustF64(b.economy.householdMaxWealth)};`,
    `pub const HOUSEHOLD_PROJECT_WEALTH_RESERVE: f64 = ${rustF64(b.economy.householdProjectWealthReserve)};`,
    `pub const HOUSEHOLD_INITIAL_WEALTH_PER_SETTLER: f64 = ${rustF64(b.economy.householdInitialWealthPerSettler)};`,
    `pub const HOUSEHOLD_DISCRETIONARY_WEALTH_RESERVE: f64 = ${rustF64(b.economy.householdDiscretionaryWealthReserve)};`,
    `pub const HOUSEHOLD_DISCRETIONARY_BUDGET_PER_PERSON_DAY: f64 = ${rustF64(b.economy.householdDiscretionaryBudgetPerPersonDay)};`,
    `pub const HOUSEHOLD_DISCRETIONARY_UNITS_PER_PERSON_DAY: f64 = ${rustF64(b.economy.householdDiscretionaryUnitsPerPersonDay)};`,
    `pub const HOUSEHOLD_DISCRETIONARY_MIN_TIER: u8 = ${b.economy.householdDiscretionaryMinTier};`,
    `pub const HOUSEHOLD_TIER4_SHORTAGE_DISCRETIONARY_MULTIPLIER: f64 = ${rustF64(b.economy.householdTier4ShortageDiscretionaryMultiplier)};`,
    `pub const HOUSEHOLD_LOCAL_POTTERY_GOLD_PER_UNIT: f64 = ${rustF64(b.economy.householdLocalPotteryGoldPerUnit)};`,
    `pub const LOCAL_MARKET_FOOD_GOLD_PER_MEAL: f64 = ${rustF64(b.economy.localMarketFoodGoldPerMeal)};`,
    `pub const LOCAL_MARKET_FIREWOOD_GOLD_PER_UNIT: f64 = ${rustF64(b.economy.localMarketFirewoodGoldPerUnit)};`,
    `pub const LOCAL_MARKET_PRESERVED_FOOD_GOLD_PER_MEAL: f64 = ${rustF64(b.economy.localMarketPreservedFoodGoldPerMeal)};`,
    `pub const LOCAL_MARKET_ALE_GOLD_PER_UNIT: f64 = ${rustF64(b.economy.localMarketAleGoldPerUnit)};`,
    `pub const LOCAL_MARKET_CLOTH_GOLD_PER_UNIT: f64 = ${rustF64(b.economy.localMarketClothGoldPerUnit)};`,
    `pub const LOCAL_MARKET_PRICE_MULTIPLIER_MIN: f64 = ${rustF64(b.economy.localMarketPriceMultiplierMin)};`,
    `pub const LOCAL_MARKET_PRICE_MULTIPLIER_MAX: f64 = ${rustF64(b.economy.localMarketPriceMultiplierMax)};`,
    `pub const TOWN_HALL_POPULATION_REQUIRED: u32 = ${b.economy.townHallPopulationRequired};`,
    `pub const TOWN_HALL_UNSTAFFED_TAX_COLLECTION_MULTIPLIER: f64 = ${rustF64(b.economy.townHallUnstaffedTaxCollectionMultiplier)};`,
    `pub const LOCAL_MARKET_TAX_CART_THRESHOLD: f64 = ${rustF64(b.economy.localMarketTaxCartThreshold)};`,
    `pub const LAND_LEVY_RATE_DEFAULT: f64 = ${rustF64(b.economy.landLevyRateDefault)};`,
    `pub const LAND_LEVY_RATE_MIN: f64 = ${rustF64(b.economy.landLevyRateMin)};`,
    `pub const LAND_LEVY_RATE_MAX: f64 = ${rustF64(b.economy.landLevyRateMax)};`,
    `pub const IMPORT_DUTY_RATE_DEFAULT: f64 = ${rustF64(b.economy.importDutyRateDefault)};`,
    `pub const IMPORT_DUTY_RATE_MIN: f64 = ${rustF64(b.economy.importDutyRateMin)};`,
    `pub const IMPORT_DUTY_RATE_MAX: f64 = ${rustF64(b.economy.importDutyRateMax)};`,
    `pub const EXPORT_DUTY_RATE_DEFAULT: f64 = ${rustF64(b.economy.exportDutyRateDefault)};`,
    `pub const EXPORT_DUTY_RATE_MIN: f64 = ${rustF64(b.economy.exportDutyRateMin)};`,
    `pub const EXPORT_DUTY_RATE_MAX: f64 = ${rustF64(b.economy.exportDutyRateMax)};`,
    `pub const LAND_LEVY_TIER1_ASSESSED_VALUE: f64 = ${rustF64(b.economy.landLevyTier1AssessedValue)};`,
    `pub const LAND_LEVY_TIER2_ASSESSED_VALUE: f64 = ${rustF64(b.economy.landLevyTier2AssessedValue)};`,
    `pub const LAND_LEVY_TIER3_ASSESSED_VALUE: f64 = ${rustF64(b.economy.landLevyTier3AssessedValue)};`,
    `pub const LAND_LEVY_REFERENCE_PLOT_AREA: f64 = ${rustF64(b.economy.landLevyReferencePlotArea)};`,
    `pub const LAND_LEVY_AREA_MULTIPLIER_MIN: f64 = ${rustF64(b.economy.landLevyAreaMultiplierMin)};`,
    `pub const LAND_LEVY_AREA_MULTIPLIER_MAX: f64 = ${rustF64(b.economy.landLevyAreaMultiplierMax)};`,
    `pub const LAND_LEVY_BACKYARD_MULTIPLIER: f64 = ${rustF64(b.economy.landLevyBackyardMultiplier)};`,
    `pub const PRIVATE_EXPORT_INCOME_CART_LOAD: f64 = ${rustF64(b.economy.privateExportIncomeCartLoad)};`,
    '',
    `pub const CARPENTER_TIMBER_PER_POLEARM: f64 = ${rustF64(b.frontierEconomy.carpenterTimberPerPolearm)};`,
    `pub const CARPENTER_IRONWORK_PER_POLEARM: f64 = ${rustF64(b.frontierEconomy.carpenterIronworkPerPolearm)};`,
    `pub const GUARDHOUSE_FOOD_PER_GUARD_PER_DAY: f64 = ${rustF64(b.frontierEconomy.guardhouseFoodPerGuardPerDay)};`,
    `pub const GUARDHOUSE_WAGE_PER_GUARD_PER_DAY: f64 = ${rustF64(b.frontierEconomy.guardhouseWagePerGuardPerDay)};`,
    `pub const GUARDHOUSE_PAYROLL_TARGET_DAYS: f64 = ${rustF64(b.frontierEconomy.guardhousePayrollTargetDays)};`,
    `pub const GUARDHOUSE_PAYROLL_REORDER_DAYS: f64 = ${rustF64(b.frontierEconomy.guardhousePayrollReorderDays)};`,
    `pub const GUARDHOUSE_TRAINING_PER_DAY: f64 = ${rustF64(b.frontierEconomy.guardhouseTrainingPerDay)};`,
    `pub const GUARDHOUSE_READINESS_DECAY_PER_DAY: f64 = ${rustF64(b.frontierEconomy.guardhouseReadinessDecayPerDay)};`,
    `pub const GUARDHOUSE_FULL_MUSTER_ROAD_DISTANCE: f64 = ${rustF64(b.frontierEconomy.guardhouseFullMusterRoadDistance)};`,
    `pub const GUARDHOUSE_LONG_MUSTER_ROAD_DISTANCE: f64 = ${rustF64(b.frontierEconomy.guardhouseLongMusterRoadDistance)};`,
    `pub const GUARDHOUSE_LONG_MUSTER_EFFICIENCY: f64 = ${rustF64(b.frontierEconomy.guardhouseLongMusterEfficiency)};`,
    `pub const GUARDHOUSE_UNLINKED_MUSTER_EFFICIENCY: f64 = ${rustF64(b.frontierEconomy.guardhouseUnlinkedMusterEfficiency)};`,
    `pub const PALISADED_REFUGE_BREACH_SECONDS: f64 = ${rustF64(b.frontierEconomy.palisadedRefugeBreachSeconds)};`,
    `pub const PALISADED_REFUGE_RESIDENT_CAPACITY: u32 = ${b.frontierEconomy.palisadedRefugeResidentCapacity};`,
    `pub const PALISADED_REFUGE_RALLY_THREAT_THRESHOLD: f64 = ${rustF64(b.frontierEconomy.palisadedRefugeRallyThreatThreshold)};`,
    '',
    `pub const STARTING_POPULATION: u32 = ${b.population.starting};`,
    `pub const POPULATION_PER_RESIDENCE: u32 = ${b.population.perResidence};`,
    `pub const RESIDENCE_POPULATION_NARROW: u32 = ${b.population.residencePopulationNarrow};`,
    `pub const RESIDENCE_POPULATION_WIDE: u32 = ${b.population.residencePopulationWide};`,
    `pub const NARROW_PARCEL_FRONTAGE_MAX: f64 = ${rustF64(b.population.narrowParcelFrontageMax)};`,
    `pub const WIDE_PARCEL_FRONTAGE_MIN: f64 = ${rustF64(b.population.wideParcelFrontageMin)};`,
    `pub const RESIDENCE_FIREWOOD_CAPACITY: f64 = ${rustF64(b.population.residenceFirewoodCapacity)};`,
    `pub const RESIDENCE_FIREWOOD_PER_PERSON_PER_SEC: f64 = ${rustF64(b.population.residenceFirewoodPerPersonPerSec)};`,
    `pub const RESIDENCE_FIREWOOD_UNITS_PER_MONTH: f64 = ${rustF64(b.population.residenceFirewoodUnitsPerMonth)};`,
    `pub const CHARCOAL_HOUSEHOLD_FUEL_VALUE: f64 = ${rustF64(b.population.charcoalHouseholdFuelValue)};`,
    `pub const MARKETPLACE_FUEL_RESERVE_DAYS: f64 = ${rustF64(b.population.marketplaceFuelReserveDays)};`,
    `pub const MARKETPLACE_FOOD_STALL_SLOTS: u32 = ${b.population.marketplaceFoodStallSlots};`,
    `pub const MARKETPLACE_GOODS_STALL_SLOTS: u32 = ${b.population.marketplaceGoodsStallSlots};`,
    `pub const MARKETPLACE_HOUSEHOLD_ISSUE_CHECKS_PER_DAY: u32 = ${b.population.marketplaceHouseholdIssueChecksPerDay};`,
    `pub const RESIDENCE_FIREWOOD_PRIORITY_WINTER_DAYS: f64 = ${rustF64(b.population.residenceFirewoodPriorityWinterDays)};`,
    `pub const RESIDENCE_WATER_CAPACITY: f64 = ${rustF64(b.population.residenceWaterCapacity)};`,
    `pub const RESIDENCE_WATER_REORDER_FRACTION: f64 = ${rustF64(b.population.residenceWaterReorderFraction)};`,
    `pub const RESIDENCE_WATER_PER_PERSON_PER_SEC: f64 = ${rustF64(b.population.residenceWaterPerPersonPerSec)};`,
    `pub const RESIDENCE_WATER_UNITS_PER_DAY: f64 = ${rustF64(b.population.residenceWaterUnitsPerDay)};`,
    `pub const RESIDENCE_FOOD_CAPACITY: f64 = ${rustF64(b.population.residenceFoodCapacity)};`,
    `pub const RESIDENCE_FOOD_PER_PERSON_PER_SEC: f64 = ${rustF64(b.population.residenceFoodPerPersonPerSec)};`,
    `pub const RESIDENCE_FOOD_UNITS_PER_SLOT_PER_MONTH: f64 = ${rustF64(b.population.residenceFoodUnitsPerSlotPerMonth)};`,
    `pub const EVENING_MEAL_PER_PERSON: f64 = ${rustF64(b.population.eveningMealPerPerson)};`,
    `pub const FOOD_CATEGORY_QUALIFYING_DAYS: f64 = ${rustF64(b.population.foodCategoryQualifyingDays)};`,
    `pub const BACKYARD_FOOD_RESERVE_TIER1_DAYS: f64 = ${rustF64(b.population.backyardFoodReserveTier1Days)};`,
    `pub const BACKYARD_FOOD_RESERVE_TIER2_DAYS: f64 = ${rustF64(b.population.backyardFoodReserveTier2Days)};`,
    `pub const BACKYARD_FOOD_RESERVE_TIER3_DAYS: f64 = ${rustF64(b.population.backyardFoodReserveTier3Days)};`,
    `pub const RESIDENCE_TIER1_CAPACITY: u32 = ${b.population.residenceTier1Capacity};`,
    `pub const RESIDENCE_TIER2_CAPACITY: u32 = ${b.population.residenceTier2Capacity};`,
    `pub const RESIDENCE_TIER3_CAPACITY: u32 = ${b.population.residenceTier3Capacity};`,
    `pub const RESIDENCE_TIER4_CAPACITY: u32 = ${b.population.residenceTier4Capacity};`,
    `pub const RESIDENCE_PRESERVED_FOOD_CAPACITY: f64 = ${rustF64(b.population.residencePreservedFoodCapacity)};`,
    `pub const RESIDENCE_PRESERVED_FOOD_PER_PERSON_PER_SEC: f64 = ${rustF64(b.population.residencePreservedFoodPerPersonPerSec)};`,
    `pub const RESIDENCE_PRESERVED_FOOD_SPRING_MULTIPLIER: f64 = ${rustF64(b.population.residencePreservedFoodSpringMultiplier)};`,
    `pub const RESIDENCE_PRESERVED_FOOD_SUMMER_MULTIPLIER: f64 = ${rustF64(b.population.residencePreservedFoodSummerMultiplier)};`,
    `pub const RESIDENCE_PRESERVED_FOOD_AUTUMN_MULTIPLIER: f64 = ${rustF64(b.population.residencePreservedFoodAutumnMultiplier)};`,
    `pub const RESIDENCE_PRESERVED_FOOD_WINTER_MULTIPLIER: f64 = ${rustF64(b.population.residencePreservedFoodWinterMultiplier)};`,
    `pub const RESIDENCE_ALE_CAPACITY: f64 = ${rustF64(b.population.residenceAleCapacity)};`,
    `pub const RESIDENCE_ALE_PER_PERSON_PER_SEC: f64 = ${rustF64(b.population.residenceAlePerPersonPerSec)};`,
    `pub const RESIDENCE_ALE_UNITS_PER_MONTH: f64 = ${rustF64(b.population.residenceAleUnitsPerMonth)};`,
    `pub const RESIDENCE_CLOTH_CAPACITY: f64 = ${rustF64(b.population.residenceClothCapacity)};`,
    `pub const RESIDENCE_CLOTH_PER_PERSON_PER_SEC: f64 = ${rustF64(b.population.residenceClothPerPersonPerSec)};`,
    `pub const RESIDENCE_CLOTH_MONTHS_PER_UNIT: u32 = ${b.population.residenceClothMonthsPerUnit};`,
    `pub const RESIDENCE_SHOES_CAPACITY: f64 = ${rustF64(b.population.residenceShoesCapacity)};`,
    `pub const RESIDENCE_SHOES_PER_PERSON_PER_SEC: f64 = ${rustF64(b.population.residenceShoesPerPersonPerSec)};`,
    `pub const RESIDENCE_SHOES_MONTHS_PER_UNIT: u32 = ${b.population.residenceShoesMonthsPerUnit};`,
    `pub const RESIDENCE_POTTERY_CAPACITY: f64 = ${rustF64(b.population.residencePotteryCapacity)};`,
    `pub const RESIDENCE_POTTERY_PER_PERSON_PER_SEC: f64 = ${rustF64(b.population.residencePotteryPerPersonPerSec)};`,
    `pub const RESIDENCE_POTTERY_MONTHS_PER_UNIT: u32 = ${b.population.residencePotteryMonthsPerUnit};`,
    `pub const RESIDENCE_LUXURY_CAPACITY: f64 = ${rustF64(b.population.residenceLuxuryCapacity)};`,
    `pub const RESIDENCE_LUXURY_JAM_PER_PERSON_PER_SEC: f64 = ${rustF64(b.population.residenceLuxuryJamPerPersonPerSec)};`,
    `pub const RESIDENCE_LUXURY_UNITS_PER_MONTH: f64 = ${rustF64(b.population.residenceLuxuryUnitsPerMonth)};`,
    `pub const APPROVAL_BASE_SCORE: i32 = ${b.population.approvalBaseScore};`,
    `pub const APPROVAL_NEED_PRESSURE_RAMP_DAYS: f64 = ${rustF64(b.population.approvalNeedPressureRampDays)};`,
    `pub const APPROVAL_MAX_NEED_PENALTY: i32 = ${b.population.approvalMaxNeedPenalty};`,
    `pub const APPROVAL_MAX_ACUTE_PENALTY: i32 = ${b.population.approvalMaxAcutePenalty};`,
    `pub const APPROVAL_DECLINE_POINTS_PER_REAL_HOUR: f64 = ${rustF64(b.population.approvalDeclinePointsPerRealHour)};`,
    `pub const HUNGER_WARNING_DAYS: f64 = ${rustF64(b.population.hungerWarningDays)};`,
    `pub const MALNUTRITION_DAYS: f64 = ${rustF64(b.population.malnutritionDays)};`,
    `pub const STARVATION_DEATH_START_DAYS: f64 = ${rustF64(b.population.starvationDeathStartDays)};`,
    `pub const STARVATION_DEATH_CHANCE_PER_PERSON_DAY: f64 = ${rustF64(b.population.starvationDeathChancePerPersonDay)};`,
    `pub const STARVATION_DEATH_MAX_CHANCE_PER_PERSON_DAY: f64 = ${rustF64(b.population.starvationDeathMaxChancePerPersonDay)};`,
    `pub const STARVATION_DEATH_RISK_RAMP_DAYS: f64 = ${rustF64(b.population.starvationDeathRiskRampDays)};`,
    `pub const MALNUTRITION_RECOVERY_DAYS: f64 = ${rustF64(b.population.malnutritionRecoveryDays)};`,
    `pub const RESIDENCE_SERVICE_WARNING_DAYS: f64 = ${rustF64(b.population.residenceServiceWarningDays)};`,
    `pub const RESIDENCE_UPGRADE_SERVICE_BLOCK_DAYS: f64 = ${rustF64(b.population.residenceUpgradeServiceBlockDays)};`,
    `pub const BASE_ILLNESS_CHANCE_PER_PERSON_DAY: f64 = ${rustF64(b.population.baseIllnessChancePerPersonDay)};`,
    `pub const MALNUTRITION_ILLNESS_MULTIPLIER: f64 = ${rustF64(b.population.malnutritionIllnessMultiplier)};`,
    `pub const UNSAFE_WATER_ILLNESS_MULTIPLIER: f64 = ${rustF64(b.population.unsafeWaterIllnessMultiplier)};`,
    `pub const COLD_EXPOSURE_ILLNESS_MULTIPLIER: f64 = ${rustF64(b.population.coldExposureIllnessMultiplier)};`,
    `pub const COLD_EXPOSURE_WARNING_DAYS: f64 = ${rustF64(b.population.coldExposureWarningDays)};`,
    `pub const COLD_EXPOSURE_DEATH_START_DAYS: f64 = ${rustF64(b.population.coldExposureDeathStartDays)};`,
    `pub const COLD_EXPOSURE_DEATH_CHANCE_PER_PERSON_DAY: f64 = ${rustF64(b.population.coldExposureDeathChancePerPersonDay)};`,
    `pub const COLD_EXPOSURE_DEATH_MAX_CHANCE_PER_PERSON_DAY: f64 = ${rustF64(b.population.coldExposureDeathMaxChancePerPersonDay)};`,
    `pub const COLD_EXPOSURE_DEATH_RISK_RAMP_DAYS: f64 = ${rustF64(b.population.coldExposureDeathRiskRampDays)};`,
    `pub const CORPSE_DISEASE_RADIUS: f64 = ${rustF64(b.population.corpseDiseaseRadius)};`,
    `pub const CORPSE_ILLNESS_MULTIPLIER: f64 = ${rustF64(b.population.corpseIllnessMultiplier)};`,
    `pub const ILLNESS_RECOVERY_DAYS: f64 = ${rustF64(b.population.illnessRecoveryDays)};`,
    `pub const ILLNESS_MORTALITY_CHANCE_PER_SICK_DAY: f64 = ${rustF64(b.population.illnessMortalityChancePerSickDay)};`,
    `pub const HERB_REMEDIES_PER_PERSON_DAY: f64 = ${rustF64(b.population.herbRemediesPerPersonDay)};`,
    `pub const HERB_REMEDY_CAPACITY: f64 = ${rustF64(b.population.herbRemedyCapacity)};`,
    `pub const HERB_TREATMENT_PER_SICK_DAY: f64 = ${rustF64(b.population.herbTreatmentPerSickDay)};`,
    `pub const HERB_RECOVERY_MULTIPLIER: f64 = ${rustF64(b.population.herbRecoveryMultiplier)};`,
    `pub const HERB_MORTALITY_MULTIPLIER: f64 = ${rustF64(b.population.herbMortalityMultiplier)};`,
    `pub const GRAVEYARD_MIN_AREA: f64 = ${rustF64(b.population.graveyardMinArea)};`,
    `pub const GRAVEYARD_MIN_EDGE: f64 = ${rustF64(b.population.graveyardMinEdge)};`,
    `pub const GRAVEYARD_MAX_SLOPE: f64 = ${rustF64(b.population.graveyardMaxSlope)};`,
    `pub const GRAVEYARD_MAX_DISTANCE: f64 = ${rustF64(b.population.graveyardMaxDistance)};`,
    `pub const GRAVE_AREA_PER_BURIAL: f64 = ${rustF64(b.population.graveAreaPerBurial)};`,
    `pub const BURIAL_CART_SPEED_MPS: f64 = ${rustF64(b.population.burialCartSpeedMps)};`,
    `pub const RESIDENCE_RECOVERY_FIREWOOD_MIN: f64 = ${rustF64(b.population.residenceRecoveryFirewoodMin)};`,
    `pub const RESIDENCE_RECOVERY_WATER_MIN: f64 = ${rustF64(b.population.residenceRecoveryWaterMin)};`,
    `pub const RESIDENCE_RECOVERY_FOOD_MIN: f64 = ${rustF64(b.population.residenceRecoveryFoodMin)};`,
    `pub const RESIDENCE_SETTLEMENT_BUFFER_DAYS: f64 = ${rustF64(b.population.residenceSettlementBufferDays)};`,
    `pub const RESIDENCE_SETTLE_TICKS: u32 = ${b.population.residenceSettleTicks};`,
    `pub const CHAPEL_SETTLEMENT_TICKS_MULTIPLIER: f64 = ${rustF64(b.population.chapelSettlementTicksMultiplier)};`,
    `pub const CHAPEL_TITHE_GOLD_PER_PERSON_PER_DAY: f64 = ${rustF64(b.population.chapelTitheGoldPerPersonPerDay)};`,
    `pub const CHAPEL_BASE_ATTENDANCE_CHANCE: f64 = ${rustF64(b.population.chapelBaseAttendanceChance)};`,
    `pub const CHAPEL_PRIEST_ATTENDANCE_BONUS: f64 = ${rustF64(b.population.chapelPriestAttendanceBonus)};`,
    `pub const CHAPEL_COMMUNITY_ATTENDANCE_BONUS: f64 = ${rustF64(b.population.chapelCommunityAttendanceBonus)};`,
    `pub const CHAPEL_RECOVERY_STOCK_MULTIPLIER: f64 = ${rustF64(b.population.chapelRecoveryStockMultiplier)};`,
    `pub const CHAPEL_RECOVERY_NEEDS_REQUIRED: u32 = ${b.population.chapelRecoveryNeedsRequired};`,
    `pub const CHAPEL_COFFER_CAPACITY: f64 = ${rustF64(b.population.chapelCofferCapacity)};`,
    `pub const CHAPEL_TIER1_COFFER_CAPACITY: f64 = ${rustF64(b.population.chapelTier1CofferCapacity)};`,
    `pub const CHAPEL_TIER3_COFFER_CAPACITY: f64 = ${rustF64(b.population.chapelTier3CofferCapacity)};`,
    `pub const CHAPEL_TIER1_TITHE_MULTIPLIER: f64 = ${rustF64(b.population.chapelTier1TitheMultiplier)};`,
    `pub const CHAPEL_TIER2_TITHE_MULTIPLIER: f64 = ${rustF64(b.population.chapelTier2TitheMultiplier)};`,
    `pub const CHAPEL_TIER3_TITHE_MULTIPLIER: f64 = ${rustF64(b.population.chapelTier3TitheMultiplier)};`,
    `pub const CHAPEL_TIER2_UPGRADE_TIMBER: f64 = ${rustF64(b.population.chapelTier2UpgradeTimber)};`,
    `pub const CHAPEL_TIER2_UPGRADE_STONE: f64 = ${rustF64(b.population.chapelTier2UpgradeStone)};`,
    `pub const CHAPEL_TIER2_UPGRADE_IRONWORK: f64 = ${rustF64(b.population.chapelTier2UpgradeIronwork)};`,
    `pub const CHAPEL_TIER2_UPGRADE_ROOF_TILES: f64 = ${rustF64(b.population.chapelTier2UpgradeRoofTiles)};`,
    `pub const CHAPEL_TIER3_UPGRADE_TIMBER: f64 = ${rustF64(b.population.chapelTier3UpgradeTimber)};`,
    `pub const CHAPEL_TIER3_UPGRADE_STONE: f64 = ${rustF64(b.population.chapelTier3UpgradeStone)};`,
    `pub const CHAPEL_TIER3_UPGRADE_IRONWORK: f64 = ${rustF64(b.population.chapelTier3UpgradeIronwork)};`,
    `pub const CHAPEL_TIER3_UPGRADE_ROOF_TILES: f64 = ${rustF64(b.population.chapelTier3UpgradeRoofTiles)};`,
    `pub const CHAPEL_PRIEST_SALARY_GOLD_PER_DAY: f64 = ${rustF64(b.population.chapelPriestSalaryGoldPerDay)};`,
    `pub const CHAPEL_UPKEEP_GOLD_PER_DAY: f64 = ${rustF64(b.population.chapelUpkeepGoldPerDay)};`,
    `pub const CHAPEL_UNSTAFFED_UPKEEP_FRACTION: f64 = ${rustF64(b.population.chapelUnstaffedUpkeepFraction)};`,
    `pub const CHAPEL_CHARITY_GOLD_PER_DAY: f64 = ${rustF64(b.population.chapelCharityGoldPerDay)};`,
    `pub const CHAPEL_CHARITY_MIN_COFFER_GOLD: f64 = ${rustF64(b.population.chapelCharityMinCofferGold)};`,
    `pub const CHAPEL_POOR_RELIEF_GOLD_PER_DISPATCH: f64 = ${rustF64(b.population.chapelPoorReliefGoldPerDispatch)};`,
    `pub const CHAPEL_POOR_RELIEF_INTERVAL_DAYS: u64 = ${b.population.chapelPoorReliefIntervalDays};`,
    `pub const CHAPEL_COFFER_RESERVE_DEFAULT: f64 = ${rustF64(b.population.chapelCofferReserveDefault)};`,
    `pub const CHAPEL_COFFER_RESERVE_MIN: f64 = ${rustF64(b.population.chapelCofferReserveMin)};`,
    `pub const CHAPEL_COFFER_RESERVE_MAX: f64 = ${rustF64(b.population.chapelCofferReserveMax)};`,
    `pub const CHAPEL_SABBATH_OBSERVANCE_ATTENDANCE_BONUS: f64 = ${rustF64(b.population.sabbathObservanceAttendanceBonus)};`,
    `pub const CHAPEL_SABBATH_OBSERVANCE_SETTLEMENT_BONUS: f64 = ${rustF64(b.population.sabbathObservanceSettlementBonus)};`,
    `pub const MONASTERY_SETTLEMENT_TICKS_MULTIPLIER: f64 = ${rustF64(b.population.monasterySettlementTicksMultiplier)};`,
    `pub const MONASTERY_RECOVERY_STOCK_MULTIPLIER: f64 = ${rustF64(b.population.monasteryRecoveryStockMultiplier)};`,
    `pub const MONASTERY_ATTENDANCE_BONUS: f64 = ${rustF64(b.population.monasteryAttendanceBonus)};`,
    `pub const MONASTERY_MIN_FOOTPRINT_SLOPE: f64 = ${rustF64(b.population.monasteryMinFootprintSlope)};`,
    '',
    `pub const BUILDING_ROAD_ACCESS_DISTANCE: f64 = ${rustF64(b.roads.buildingRoadAccessDistance)};`,
    `pub const BURGAGE_ROAD_FRONTAGE_DISTANCE: f64 = ${rustF64(b.roads.burgageRoadFrontageDistance)};`,
    `pub const OFFROAD_DELIVERY_SPEED_MULTIPLIER: f64 = ${rustF64(b.roads.offroadDeliverySpeedMultiplier)};`,
    `pub const MIN_DELIVERY_TRIP_SEC: f64 = ${rustF64(b.roads.minDeliveryTripSec)};`,
    `pub const FIREWOOD_DELIVERY_SPEED_MPS: f64 = ${rustF64(b.roads.firewoodDeliverySpeedMps)};`,
    `pub const WATER_DELIVERY_SPEED_MPS: f64 = ${rustF64(b.roads.waterDeliverySpeedMps)};`,
    `pub const FOOD_DELIVERY_SPEED_MPS: f64 = ${rustF64(b.roads.foodDeliverySpeedMps)};`,
    `pub const REMEDY_DELIVERY_SPEED_MPS: f64 = ${rustF64(b.roads.remedyDeliverySpeedMps)};`,
    `pub const FIREWOOD_DELIVERY_UNLOAD_SEC: f64 = ${rustF64(b.roads.firewoodDeliveryUnloadSec)};`,
    `pub const WATER_DELIVERY_UNLOAD_SEC: f64 = ${rustF64(b.roads.waterDeliveryUnloadSec)};`,
    `pub const FOOD_DELIVERY_UNLOAD_SEC: f64 = ${rustF64(b.roads.foodDeliveryUnloadSec)};`,
    `pub const REMEDY_DELIVERY_UNLOAD_SEC: f64 = ${rustF64(b.roads.remedyDeliveryUnloadSec)};`,
    `pub const TIMBER_DELIVERY_SPEED_MPS: f64 = ${rustF64(b.roads.timberDeliverySpeedMps)};`,
    `pub const TIMBER_DELIVERY_UNLOAD_SEC: f64 = ${rustF64(b.roads.timberDeliveryUnloadSec)};`,
    '',
    `pub const CONSTRUCTION_MAX_BUILDERS: u32 = ${b.construction.maxBuilders};`,
    `pub const CONSTRUCTION_WORK_PER_WORKER_PER_SEC: f64 = ${rustF64(b.construction.workPerWorkerPerSecond)};`,
    `pub const CONSTRUCTION_HAUL_PER_WORKER: f64 = ${rustF64(b.construction.haulPerWorker)};`,
    `pub const CONSTRUCTION_DELIVERY_SPEED_MPS: f64 = ${rustF64(b.construction.deliverySpeedMps)};`,
    `pub const CONSTRUCTION_DELIVERY_UNLOAD_SEC: f64 = ${rustF64(b.construction.deliveryUnloadSec)};`,
    `pub const CONSTRUCTION_TREASURY_TRANSFER_PER_SEC: f64 = ${rustF64(b.construction.treasuryTransferPerSecond)};`,
    '',
    `pub const LARGE_QUARRY_MAX_YIELD: f64 = ${rustF64(b.quarries.largeMaxYield)};`,
    `pub const SMALL_QUARRY_MAX_YIELD: f64 = ${rustF64(b.quarries.smallMaxYield)};`,
    '',
    `pub const LODGE_TIMBER_PER_CYCLE: f64 = ${rustF64(b.production.lodgeTimberPerCycle)};`,
    `pub const LODGE_TIMBER_PER_DELIVERY: f64 = ${rustF64(b.production.lodgeTimberPerDelivery)};`,
    `pub const LODGE_FIREWOOD_PER_CYCLE: f64 = ${rustF64(b.production.lodgeFirewoodPerCycle)};`,
    `pub const LODGE_FIREWOOD_PER_DELIVERY: f64 = ${rustF64(b.production.lodgeFirewoodPerDelivery)};`,
    `pub const STONE_PER_HARVEST: f64 = ${rustF64(b.production.stonePerHarvest)};`,
    `pub const GAME_ANIMALS_PER_HARVEST: f64 = ${rustF64(b.production.gameAnimalsPerHarvest)};`,
    `pub const GAME_PER_HARVEST: f64 = ${rustF64(b.production.gamePerHarvest)};`,
    `pub const GAME_PELTS_PER_ANIMAL: f64 = ${rustF64(b.production.gamePeltsPerAnimal)};`,
    `pub const BERRIES_PER_HARVEST: f64 = ${rustF64(b.production.berriesPerHarvest)};`,
    `pub const MUSHROOMS_PER_HARVEST: f64 = ${rustF64(b.production.mushroomsPerHarvest)};`,
    `pub const FORAGER_REMEDIES_PER_HARVEST: f64 = ${rustF64(b.production.foragerRemediesPerHarvest)};`,
    `pub const FORAGER_REMEDY_SEASON_START_MONTH: u8 = ${b.production.foragerRemedySeasonStartMonth};`,
    `pub const FORAGER_REMEDY_SEASON_END_MONTH: u8 = ${b.production.foragerRemedySeasonEndMonth};`,
    `pub const REMEDIES_PER_DELIVERY: f64 = ${rustF64(b.production.remediesPerDelivery)};`,
    `pub const REMEDY_DELIVERY_TARGET_DAYS: f64 = ${rustF64(b.production.remedyDeliveryTargetDays)};`,
    `pub const FISH_PER_HARVEST: f64 = ${rustF64(b.production.fishPerHarvest)};`,
    `pub const RICH_GAME_YIELD_MULTIPLIER: f64 = ${rustF64(b.production.richGameYieldMultiplier)};`,
    `pub const RICH_FISH_YIELD_MULTIPLIER: f64 = ${rustF64(b.production.richFishYieldMultiplier)};`,
    `pub const RICH_BERRY_YIELD_MULTIPLIER: f64 = ${rustF64(b.production.richBerryYieldMultiplier)};`,
    `pub const RICH_MUSHROOM_YIELD_MULTIPLIER: f64 = ${rustF64(b.production.richMushroomYieldMultiplier)};`,
    `pub const FOOD_PER_DELIVERY: f64 = ${rustF64(b.production.foodPerDelivery)};`,
    `pub const BERRIES_REGROW_PER_DAY: f64 = ${rustF64(b.production.berriesRegrowPerDay)};`,
    `pub const MUSHROOMS_REGROW_PER_DAY: f64 = ${rustF64(b.production.mushroomsRegrowPerDay)};`,
    `pub const MUSHROOM_AUTUMN_REGROWTH_MULTIPLIER: f64 = ${rustF64(b.production.mushroomAutumnRegrowthMultiplier)};`,
    `pub const FISH_REPRODUCTION_RATE_PER_DAY: f64 = ${rustF64(b.production.fishReproductionRatePerDay)};`,
    `pub const GAME_REPRODUCTION_RATE_PER_DAY: f64 = ${rustF64(b.production.gameReproductionRatePerDay)};`,
    `pub const RICH_GAME_REGROWTH_MULTIPLIER: f64 = ${rustF64(b.production.richGameRegrowthMultiplier)};`,
    `pub const RICH_FISH_REGROWTH_MULTIPLIER: f64 = ${rustF64(b.production.richFishRegrowthMultiplier)};`,
    `pub const RICH_BERRY_REGROWTH_MULTIPLIER: f64 = ${rustF64(b.production.richBerryRegrowthMultiplier)};`,
    `pub const RICH_MUSHROOM_REGROWTH_MULTIPLIER: f64 = ${rustF64(b.production.richMushroomRegrowthMultiplier)};`,
    `pub const GAME_MIN_BREEDING_POPULATION: f64 = ${rustF64(b.production.gameMinBreedingPopulation)};`,
    `pub const GAME_HABITAT_DISRUPTION_RADIUS: f64 = ${rustF64(b.production.gameHabitatDisruptionRadius)};`,
    `pub const NATURAL_TREE_MATURATION_DAYS: f64 = ${rustF64(b.production.naturalTreeMaturationDays)};`,
    `pub const REFORESTER_REGROW_PER_SEC: f64 = ${rustF64(b.production.reforesterRegrowPerSec)};`,
    `pub const REFORESTER_SPARSE_TREE_MATURATION_WORKDAYS: f64 = ${rustF64(b.production.reforesterSparseTreeMaturationWorkdays)};`,
    `pub const TREE_REGROWTH_UPDATE_INTERVAL_SEC: f64 = ${rustF64(b.production.treeRegrowthUpdateIntervalSec)};`,
    `pub const WELL_BASE_REFILL_PER_SEC: f64 = ${rustF64(b.production.wellBaseRefillPerSec)};`,
    `pub const WELL_MINIMUM_REFILL_HYDROLOGY: f64 = ${rustF64(b.production.wellMinimumRefillHydrology)};`,
    `pub const WELL_SURGE_CHANCE_PER_TICK: f64 = ${rustF64(b.production.wellSurgeChancePerTick)};`,
    `pub const WELL_SURGE_AMOUNT_MIN: f64 = ${rustF64(b.production.wellSurgeAmountMin)};`,
    `pub const WELL_SURGE_AMOUNT_MAX: f64 = ${rustF64(b.production.wellSurgeAmountMax)};`,
    `pub const WELL_SURGE_COOLDOWN_SEC: f64 = ${rustF64(b.production.wellSurgeCooldownSec)};`,
    `pub const WELL_WATER_PER_DELIVERY: f64 = ${rustF64(b.production.wellWaterPerDelivery)};`,
    `pub const MILL_WATER_PER_HARVEST: f64 = ${rustF64(b.production.millWaterPerHarvest)};`,
    `pub const GRAIN_PER_FIELD_CYCLE: f64 = ${rustF64(b.production.grainPerFieldCycle)};`,
    `pub const GRAIN_TRANSFER_PER_TRIP: f64 = ${rustF64(b.production.grainTransferPerTrip)};`,
    `pub const THRESHING_SHEAVES_PER_CYCLE: f64 = ${rustF64(b.production.threshingSheavesPerCycle)};`,
    `pub const THRESHING_GRAIN_PER_CYCLE: f64 = ${rustF64(b.production.threshingGrainPerCycle)};`,
    `pub const WATERMILL_GRAIN_PER_CYCLE: f64 = ${rustF64(b.production.watermillGrainPerCycle)};`,
    `pub const WATERMILL_WATER_PER_CYCLE: f64 = ${rustF64(b.production.watermillWaterPerCycle)};`,
    `pub const WATERMILL_RYE_FLOUR_PER_CYCLE: f64 = ${rustF64(b.production.watermillRyeFlourPerCycle)};`,
    `pub const WATERMILL_MASLIN_FLOUR_PER_CYCLE: f64 = ${rustF64(b.production.watermillMaslinFlourPerCycle)};`,
    `pub const BAKERY_FLOUR_PER_CYCLE: f64 = ${rustF64(b.production.bakeryFlourPerCycle)};`,
    `pub const BAKERY_WATER_PER_CYCLE: f64 = ${rustF64(b.production.bakeryWaterPerCycle)};`,
    `pub const BAKERY_FIREWOOD_PER_CYCLE: f64 = ${rustF64(b.production.bakeryFirewoodPerCycle)};`,
    `pub const BAKERY_RYE_BREAD_PER_CYCLE: f64 = ${rustF64(b.production.bakeryRyeBreadPerCycle)};`,
    `pub const BAKERY_MASLIN_BREAD_PER_CYCLE: f64 = ${rustF64(b.production.bakeryMaslinBreadPerCycle)};`,
    `pub const HOUSEHOLD_FOOD_RESERVE_PER_CLAIM: f64 = ${rustF64(b.production.householdFoodReservePerClaim)};`,
    `pub const HOUSEHOLD_FOOD_RESERVE_CAPACITY_FRACTION: f64 = ${rustF64(b.production.householdFoodReserveCapacityFraction)};`,
    `pub const BREWERY_BARLEY_PER_MALT_CYCLE: f64 = ${rustF64(b.production.breweryBarleyPerMaltCycle)};`,
    `pub const BREWERY_MALTING_WATER_PER_CYCLE: f64 = ${rustF64(b.production.breweryMaltingWaterPerCycle)};`,
    `pub const BREWERY_MALTING_FIREWOOD_PER_CYCLE: f64 = ${rustF64(b.production.breweryMaltingFirewoodPerCycle)};`,
    `pub const BREWERY_MALT_PER_CYCLE: f64 = ${rustF64(b.production.breweryMaltPerCycle)};`,
    `pub const BREWERY_MALT_PER_ALE_CYCLE: f64 = ${rustF64(b.production.breweryMaltPerAleCycle)};`,
    `pub const BREWERY_BREWING_WATER_PER_CYCLE: f64 = ${rustF64(b.production.breweryBrewingWaterPerCycle)};`,
    `pub const BREWERY_BREWING_FIREWOOD_PER_CYCLE: f64 = ${rustF64(b.production.breweryBrewingFirewoodPerCycle)};`,
    `pub const BREWERY_ALE_PER_CYCLE: f64 = ${rustF64(b.production.breweryAlePerCycle)};`,
    `pub const BREWERY_APPLES_PER_CIDER_CYCLE: f64 = ${rustF64(b.production.breweryApplesPerCiderCycle)};`,
    `pub const BREWERY_CIDER_PER_CYCLE: f64 = ${rustF64(b.production.breweryCiderPerCycle)};`,
    `pub const BREWERY_HONEY_PER_MEAD_CYCLE: f64 = ${rustF64(b.production.breweryHoneyPerMeadCycle)};`,
    `pub const BREWERY_MEAD_PER_CYCLE: f64 = ${rustF64(b.production.breweryMeadPerCycle)};`,
    `pub const SPINNING_RETTING_WOOL_PER_CYCLE: f64 = ${rustF64(b.production.spinningRettingWoolPerCycle)};`,
    `pub const SPINNING_RETTING_FLAX_PER_CYCLE: f64 = ${rustF64(b.production.spinningRettingFlaxPerCycle)};`,
    `pub const SPINNING_RETTING_FLAX_WATER_PER_CYCLE: f64 = ${rustF64(b.production.spinningRettingFlaxWaterPerCycle)};`,
    `pub const SPINNING_RETTING_YARN_PER_CYCLE: f64 = ${rustF64(b.production.spinningRettingYarnPerCycle)};`,
    `pub const SPINNING_RETTING_LINEN_PER_CYCLE: f64 = ${rustF64(b.production.spinningRettingLinenPerCycle)};`,
    `pub const WEAVER_YARN_PER_CYCLE: f64 = ${rustF64(b.production.weaverYarnPerCycle)};`,
    `pub const WEAVER_LINEN_PER_CYCLE: f64 = ${rustF64(b.production.weaverLinenPerCycle)};`,
    `pub const WEAVER_CLOTH_PER_CYCLE: f64 = ${rustF64(b.production.weaverClothPerCycle)};`,
    `pub const TEXTILE_TRANSFER_PER_TRIP: f64 = ${rustF64(b.production.textileTransferPerTrip)};`,
    `pub const TANNERY_HIDES_PER_CYCLE: f64 = ${rustF64(b.production.tanneryHidesPerCycle)};`,
    `pub const TANNERY_WATER_PER_CYCLE: f64 = ${rustF64(b.production.tanneryWaterPerCycle)};`,
    `pub const TANNERY_FIREWOOD_PER_CYCLE: f64 = ${rustF64(b.production.tanneryFirewoodPerCycle)};`,
    `pub const TANNERY_LEATHER_PER_CYCLE: f64 = ${rustF64(b.production.tanneryLeatherPerCycle)};`,
    `pub const COBBLER_LEATHER_PER_CYCLE: f64 = ${rustF64(b.production.cobblerLeatherPerCycle)};`,
    `pub const COBBLER_SHOES_PER_CYCLE: f64 = ${rustF64(b.production.cobblerShoesPerCycle)};`,
    `pub const LEATHER_TRANSFER_PER_TRIP: f64 = ${rustF64(b.production.leatherTransferPerTrip)};`,
    `pub const CHANDLERY_WAX_PER_CYCLE: f64 = ${rustF64(b.production.chandleryWaxPerCycle)};`,
    `pub const CHANDLERY_FIREWOOD_PER_CYCLE: f64 = ${rustF64(b.production.chandleryFirewoodPerCycle)};`,
    `pub const CHANDLERY_CANDLES_PER_CYCLE: f64 = ${rustF64(b.production.chandleryCandlesPerCycle)};`,
    `pub const CANDLE_TRANSFER_PER_TRIP: f64 = ${rustF64(b.production.candleTransferPerTrip)};`,
    `pub const SMOKEHOUSE_FOOD_PER_CYCLE: f64 = ${rustF64(b.production.smokehouseFoodPerCycle)};`,
    `pub const SMOKEHOUSE_FIREWOOD_PER_CYCLE: f64 = ${rustF64(b.production.smokehouseFirewoodPerCycle)};`,
    `pub const SMOKEHOUSE_SALT_PER_CYCLE: f64 = ${rustF64(b.production.smokehouseSaltPerCycle)};`,
    `pub const SMOKEHOUSE_POTTERY_PER_CYCLE: f64 = ${rustF64(b.production.smokehousePotteryPerCycle)};`,
    `pub const SMOKEHOUSE_PRESERVED_FOOD_PER_CYCLE: f64 = ${rustF64(b.production.smokehousePreservedFoodPerCycle)};`,
    `pub const MINING_CAMP_CLAY_PER_CYCLE: f64 = ${rustF64(b.production.miningCampClayPerCycle)};`,
    `pub const LARGE_QUARRY_TIMBER_SUPPORT_PER_CYCLE: f64 = ${rustF64(b.production.largeQuarryTimberSupportPerCycle)};`,
    `pub const LARGE_QUARRY_TIMBER_SUPPORT_BUFFER_CYCLES: f64 = ${rustF64(b.production.largeQuarryTimberSupportBufferCycles)};`,
    `pub const MINE_IRON_PER_CYCLE: f64 = ${rustF64(b.production.mineIronPerCycle)};`,
    `pub const MINE_SALT_PER_CYCLE: f64 = ${rustF64(b.production.mineSaltPerCycle)};`,
    `pub const MINE_CLAY_PER_CYCLE: f64 = ${rustF64(b.production.mineClayPerCycle)};`,
    `pub const MINE_TIMBER_SUPPORT_PER_CYCLE: f64 = ${rustF64(b.production.mineTimberSupportPerCycle)};`,
    `pub const MINE_TIMBER_SUPPORT_BUFFER_CYCLES: f64 = ${rustF64(b.production.mineTimberSupportBufferCycles)};`,
    `pub const RICH_MINE_THROUGHPUT_MULTIPLIER: f64 = ${rustF64(b.production.richMineThroughputMultiplier)};`,
    `pub const CHARCOAL_BURNER_FIREWOOD_PER_CYCLE: f64 = ${rustF64(b.production.charcoalBurnerFirewoodPerCycle)};`,
    `pub const CHARCOAL_BURNER_CHARCOAL_PER_CYCLE: f64 = ${rustF64(b.production.charcoalBurnerCharcoalPerCycle)};`,
    `pub const SMITHY_IRON_PER_CYCLE: f64 = ${rustF64(b.production.smithyIronPerCycle)};`,
    `pub const SMITHY_CHARCOAL_PER_CYCLE: f64 = ${rustF64(b.production.smithyCharcoalPerCycle)};`,
    `pub const SMITHY_WATER_PER_CYCLE: f64 = ${rustF64(b.production.smithyWaterPerCycle)};`,
    `pub const SMITHY_IRONWORK_PER_CYCLE: f64 = ${rustF64(b.production.smithyIronworkPerCycle)};`,
    `pub const CIVILIAN_TOOL_IRONWORK_PER_CYCLE: f64 = ${rustF64(b.production.civilianToolIronworkPerCycle)};`,
    `pub const CIVILIAN_TOOL_REORDER_CYCLES: f64 = ${rustF64(b.production.civilianToolReorderCycles)};`,
    `pub const CIVILIAN_TOOL_THROUGHPUT_MULTIPLIER: f64 = ${rustF64(b.production.civilianToolThroughputMultiplier)};`,
    `pub const POTTER_CLAY_PER_CYCLE: f64 = ${rustF64(b.production.potterClayPerCycle)};`,
    `pub const POTTER_FIREWOOD_PER_CYCLE: f64 = ${rustF64(b.production.potterFirewoodPerCycle)};`,
    `pub const POTTER_WATER_PER_CYCLE: f64 = ${rustF64(b.production.potterWaterPerCycle)};`,
    `pub const POTTER_POTTERY_PER_CYCLE: f64 = ${rustF64(b.production.potterPotteryPerCycle)};`,
    `pub const POTTER_ROOF_TILES_PER_CYCLE: f64 = ${rustF64(b.production.potterRoofTilesPerCycle)};`,
    `pub const APIARY_HONEY_PER_CYCLE: f64 = ${rustF64(b.production.apiaryHoneyPerCycle)};`,
    `pub const APIARY_WAX_PER_HONEY_CYCLES: u8 = ${Math.max(1, Math.round(b.production.apiaryWaxPerHoneyCycles))};`,
    `pub const APIARY_WAX_PER_HARVEST: f64 = ${rustF64(b.production.apiaryWaxPerHarvest)};`,
    `pub const APIARY_SEASON_START_MONTH: u8 = ${b.production.apiarySeasonStartMonth};`,
    `pub const APIARY_ACCUMULATION_END_MONTH: u8 = ${b.production.apiaryAccumulationEndMonth};`,
    `pub const APIARY_HARVEST_START_MONTH: u8 = ${b.production.apiaryHarvestStartMonth};`,
    `pub const APIARY_SEASON_END_MONTH: u8 = ${b.production.apiarySeasonEndMonth};`,
    `pub const APIARY_WINTER_HONEY_REQUIRED: f64 = ${rustF64(b.production.apiaryWinterHoneyRequired)};`,
    `pub const APIARY_CONSERVATIVE_HONEY_RESERVE: f64 = ${rustF64(b.production.apiaryConservativeHoneyReserve)};`,
    `pub const APIARY_BALANCED_HONEY_RESERVE: f64 = ${rustF64(b.production.apiaryBalancedHoneyReserve)};`,
    `pub const APIARY_EXTRACTIVE_HONEY_RESERVE: f64 = ${rustF64(b.production.apiaryExtractiveHoneyReserve)};`,
    `pub const APIARY_CONSERVATIVE_YIELD_MULTIPLIER: f64 = ${rustF64(b.production.apiaryConservativeYieldMultiplier)};`,
    `pub const APIARY_BALANCED_YIELD_MULTIPLIER: f64 = ${rustF64(b.production.apiaryBalancedYieldMultiplier)};`,
    `pub const APIARY_EXTRACTIVE_YIELD_MULTIPLIER: f64 = ${rustF64(b.production.apiaryExtractiveYieldMultiplier)};`,
    `pub const APIARY_WINTER_HEALTH_GAIN: f64 = ${rustF64(b.production.apiaryWinterHealthGain)};`,
    `pub const APIARY_WINTER_HEALTH_LOSS: f64 = ${rustF64(b.production.apiaryWinterHealthLoss)};`,
    `pub const APIARY_POLLINATION_BONUS_MAX: f64 = ${rustF64(b.production.apiaryPollinationBonusMax)};`,
    `pub const BACKYARD_APIARY_POLLINATION_RADIUS: f64 = ${rustF64(b.production.backyardApiaryPollinationRadius)};`,
    `pub const BACKYARD_APIARY_POLLINATION_CONTRIBUTION: f64 = ${rustF64(b.production.backyardApiaryPollinationContribution)};`,
    `pub const VINEYARD_GRAPES_PER_HARVEST_CYCLE: f64 = ${rustF64(b.production.vineyardGrapesPerHarvestCycle)};`,
    `pub const VINEYARD_GRAPES_PER_FERMENTATION_BATCH: f64 = ${rustF64(b.production.vineyardGrapesPerFermentationBatch)};`,
    `pub const VINEYARD_WINE_PER_FERMENTATION_BATCH: f64 = ${rustF64(b.production.vineyardWinePerFermentationBatch)};`,
    `pub const VINEYARD_FERMENTATION_SECONDS: f64 = ${rustF64(b.production.vineyardFermentationSeconds)};`,
    `pub const VINEYARD_HARVEST_START_MONTH: u8 = ${b.production.vineyardHarvestStartMonth};`,
    `pub const VINEYARD_HARVEST_END_MONTH: u8 = ${b.production.vineyardHarvestEndMonth};`,
    `pub const MARKET_SPECIALTY_EXPORT_PER_BROKER_PER_SECOND: f64 = ${rustF64(b.production.marketSpecialtyExportPerBrokerPerSecond)};`,
    `pub const MONASTERY_PILGRIMAGE_GOLD_PER_DAY: f64 = ${rustF64(b.production.monasteryPilgrimageGoldPerDay)};`,
    `pub const MONASTERY_HOSPITALITY_BONUS_GOLD_PER_DAY: f64 = ${rustF64(b.production.monasteryHospitalityBonusGoldPerDay)};`,
    `pub const MONASTERY_HOSPITALITY_HONEY_PER_DAY: f64 = ${rustF64(b.production.monasteryHospitalityHoneyPerDay)};`,
    `pub const MONASTERY_HOSPITALITY_DRINK_PER_DAY: f64 = ${rustF64(b.production.monasteryHospitalityDrinkPerDay)};`,
    `pub const MONASTERY_FEAST_FOOD: f64 = ${rustF64(b.production.monasteryFeastFood)};`,
    `pub const MONASTERY_FEAST_DRINK: f64 = ${rustF64(b.production.monasteryFeastDrink)};`,
    `pub const MONASTERY_FEAST_HONEY: f64 = ${rustF64(b.production.monasteryFeastHoney)};`,
    `pub const MONASTERY_UNLINKED_PRODUCTIVITY: f64 = ${rustF64(b.production.monasteryUnlinkedProductivity)};`,
    `pub const MONASTERY_COVERAGE_RADIUS: f64 = ${rustF64(b.production.monasteryCoverageRadius)};`,
    `pub const MONASTERY_TITHE_SHARE_DEFAULT: f64 = ${rustF64(b.production.monasteryTitheShareDefault)};`,
    `pub const MONASTERY_CHARITY_FOOD_PER_DELIVERY: f64 = ${rustF64(b.production.monasteryCharityFoodPerDelivery)};`,
    `pub const SPECIALTY_EXPORT_GOLD_PER_HONEY: f64 = ${rustF64(b.production.specialtyExportGoldPerHoney)};`,
    `pub const SPECIALTY_EXPORT_GOLD_PER_ALE: f64 = ${rustF64(b.production.specialtyExportGoldPerAle)};`,
    `pub const SPECIALTY_EXPORT_GOLD_PER_CIDER: f64 = ${rustF64(b.production.specialtyExportGoldPerCider)};`,
    `pub const SPECIALTY_EXPORT_GOLD_PER_WINE: f64 = ${rustF64(b.production.specialtyExportGoldPerWine)};`,
    `pub const SPECIALTY_EXPORT_GOLD_PER_CLOTH: f64 = ${rustF64(b.production.specialtyExportGoldPerCloth)};`,
    `pub const SPECIALTY_EXPORT_GOLD_PER_CHEESE: f64 = ${rustF64(b.production.specialtyExportGoldPerCheese)};`,
    `pub const SPECIALTY_EXPORT_GOLD_PER_POTTERY: f64 = ${rustF64(b.production.specialtyExportGoldPerPottery)};`,
    `pub const HERB_REMEDY_SALE_GOLD_PER_UNIT: f64 = ${rustF64(b.production.herbRemedySaleGoldPerUnit)};`,
    `pub const CARPENTER_DELIVERY_SPEED_MULTIPLIER: f64 = ${rustF64(b.production.carpenterDeliverySpeedMultiplier)};`,
    `pub const CARPENTER_TIMBER_COST_MULTIPLIER: f64 = ${rustF64(b.production.carpenterTimberCostMultiplier)};`,
    `pub const CARPENTER_CART_SERVICE_TIMBER_PER_TRIP: f64 = ${rustF64(b.production.carpenterCartServiceTimberPerTrip)};`,
    `pub const CARPENTER_CART_SERVICE_IRONWORK_PER_TRIP: f64 = ${rustF64(b.production.carpenterCartServiceIronworkPerTrip)};`,
    `pub const CARPENTER_CART_SERVICE_TARGET_TRIPS: f64 = ${rustF64(b.production.carpenterCartServiceTargetTrips)};`,
    `pub const STOREHOUSE_OVERFLOW_THRESHOLD: f64 = ${rustF64(b.production.storehouseOverflowThreshold)};`,
    `pub const STOREHOUSE_HAUL_PER_WORKER: f64 = ${rustF64(b.production.storehouseHaulPerWorker)};`,
    `pub const STOREHOUSE_FIREWOOD_PER_DELIVERY: f64 = ${rustF64(b.production.storehouseFirewoodPerDelivery)};`,
    `pub const SMITHY_CHARCOAL_REORDER_CYCLES: f64 = ${rustF64(b.production.smithyCharcoalReorderCycles)};`,
    `pub const SMITHY_CHARCOAL_TARGET_CYCLES: f64 = ${rustF64(b.production.smithyCharcoalTargetCycles)};`,
    '',
    `pub const FARM_MIN_FIELD_AREA: f64 = ${rustF64(b.farming.minFieldArea)};`,
    `pub const FARM_FIELD_SETUP_WORK_PER_STAGE: f64 = ${rustF64(b.farming.fieldSetupWorkPerStage)};`,
    `pub const FARM_FIELD_BOUNDARY_WORK_PER_METER_PER_STAGE: f64 = ${rustF64(b.farming.fieldBoundaryWorkPerMeterPerStage)};`,
    `pub const FARM_FIELD_TRAVEL_WORK_PER_METER_PER_STAGE: f64 = ${rustF64(b.farming.fieldTravelWorkPerMeterPerStage)};`,
    `pub const FARM_SHARED_LABOR_MIN_PRIORITY: u8 = ${b.farming.sharedLaborMinPriority};`,
    `pub const FARM_MIN_FIELD_EDGE: f64 = ${rustF64(b.farming.minFieldEdge)};`,
    `pub const FARM_WORK_METERS_PER_WORKER_PER_SEC: f64 = ${rustF64(b.farming.workMetersPerWorkerPerSec)};`,
    `pub const FARM_TOOL_IRONWORK_PER_WORKER_DAY: f64 = ${rustF64(b.farming.farmToolIronworkPerWorkerDay)};`,
    `pub const FARM_OX_PLOUGH_WORKER_MULTIPLIER: f64 = ${rustF64(b.farming.oxPloughWorkerMultiplier)};`,
    `pub const FARM_OX_HARVEST_WORKER_MULTIPLIER: f64 = ${rustF64(b.farming.oxHarvestWorkerMultiplier)};`,
    `pub const FARM_PLOUGH_WORK_PER_SQUARE_METER: f64 = ${rustF64(b.farming.ploughWorkPerSquareMeter)};`,
    `pub const FARM_SOW_WORK_PER_SQUARE_METER: f64 = ${rustF64(b.farming.sowWorkPerSquareMeter)};`,
    `pub const FARM_HARVEST_WORK_PER_SQUARE_METER: f64 = ${rustF64(b.farming.harvestWorkPerSquareMeter)};`,
    `pub const FARM_GROWTH_SECONDS: f64 = ${rustF64(b.farming.growthSeconds)};`,
    `pub const FARM_BASE_GRAIN_PER_SQUARE_METER: f64 = ${rustF64(b.farming.baseGrainPerSquareMeter)};`,
    `pub const FARM_REGIONAL_PRIME_CROPS_SMALL: u8 = ${b.farming.regionalPrimeCropsSmall};`,
    `pub const FARM_REGIONAL_PRIME_CROPS_MEDIUM: u8 = ${b.farming.regionalPrimeCropsMedium};`,
    `pub const FARM_REGIONAL_PRIME_CROPS_LARGE: u8 = ${b.farming.regionalPrimeCropsLarge};`,
    `pub const FARM_REGIONAL_YIELD_FLOOR: f64 = ${rustF64(b.farming.regionalYieldFloor)};`,
    `pub const FARM_REGIONAL_AFFINITY_FLOOR: f64 = ${rustF64(b.farming.regionalAffinityFloor)};`,
    `pub const FARM_REGIONAL_UNREPRESENTED_CEILING: f64 = ${rustF64(b.farming.regionalUnrepresentedCeiling)};`,
    `pub const FARM_REGIONAL_CENTER_RADIUS_RATIO: f64 = ${rustF64(b.farming.regionalCenterRadiusRatio)};`,
    `pub const FARM_REGIONAL_CORE_RADIUS_RATIO: f64 = ${rustF64(b.farming.regionalCoreRadiusRatio)};`,
    `pub const FARM_REGIONAL_ASPECT_RATIO: f64 = ${rustF64(b.farming.regionalAspectRatio)};`,
    `pub const FARM_MANURE_PER_SQUARE_METER: f64 = ${rustF64(b.farming.manurePerSquareMeter)};`,
    `pub const FARM_MANURE_FERTILITY_BONUS: f64 = ${rustF64(b.farming.manureFertilityBonus)};`,
    `pub const FARMSTEAD_STARTER_SEED_GRAIN: f64 = ${rustF64(b.farming.farmsteadStarterSeedGrain)};`,
    `pub const FARMSTEAD_STARTER_BARLEY_SEED: f64 = ${rustF64(b.farming.farmsteadStarterBarleySeed)};`,
    `pub const FARM_EARLY_HARVEST_MONTH: u32 = ${b.farming.earlyHarvestMonth};`,
    `pub const FARM_EARLY_HARVEST_MINIMUM_GROWTH: f64 = ${rustF64(b.farming.earlyHarvestMinimumGrowth)};`,
    `pub const FARM_EARLY_HARVEST_RIPENESS_FACTOR: f64 = ${rustF64(b.farming.earlyHarvestRipenessFactor)};`,
    `pub const FARM_SLOPE_PENALTY_PER_DEGREE: f64 = ${rustF64(b.farming.slopePenaltyPerDegree)};`,
    `pub const FARM_MAX_ACCEPTED_SLOPE_DEGREES: f64 = ${rustF64(b.farming.maxAcceptedSlopeDegrees)};`,
    `pub const FARM_FIELD_SALVAGE_FRACTION: f64 = ${rustF64(b.farming.fieldSalvageFraction)};`,
    '',
    `pub const LIVESTOCK_MIN_PASTURE_AREA: f64 = ${rustF64(b.livestock.minPastureArea)};`,
    `pub const LIVESTOCK_MIN_PASTURE_EDGE: f64 = ${rustF64(b.livestock.minPastureEdge)};`,
    `pub const LIVESTOCK_PASTURE_SALVAGE_FRACTION: f64 = ${rustF64(b.livestock.pastureSalvageFraction)};`,
    `pub const LIVESTOCK_AUTUMN_CULL_START_MONTH: u32 = ${b.livestock.autumnCullStartMonth};`,
    `pub const LIVESTOCK_AUTUMN_CULL_END_MONTH: u32 = ${b.livestock.autumnCullEndMonth};`,
    `pub const LIVESTOCK_WINTER_FODDER_RESERVE_DAYS: f64 = ${rustF64(b.livestock.winterFodderReserveDays)};`,
    `pub const LIVESTOCK_HAYMAKING_START_MONTH: u32 = ${b.livestock.haymakingStartMonth};`,
    `pub const LIVESTOCK_HAYMAKING_END_MONTH: u32 = ${b.livestock.haymakingEndMonth};`,
    `pub const LIVESTOCK_DEFAULT_HAYMAKING_PERCENT: u8 = ${b.livestock.defaultHaymakingPercent};`,
    `pub const LIVESTOCK_MAXIMUM_HAYMAKING_PERCENT: u8 = ${b.livestock.maximumHaymakingPercent};`,
    `pub const LIVESTOCK_MINIMUM_BREEDING_HEADS: u32 = ${b.livestock.minimumBreedingHeads};`,
    `pub const PANNAGE_SPRING_CAPACITY_MULTIPLIER: f64 = ${rustF64(b.livestock.pannageSpringCapacityMultiplier)};`,
    `pub const PANNAGE_SUMMER_CAPACITY_MULTIPLIER: f64 = ${rustF64(b.livestock.pannageSummerCapacityMultiplier)};`,
    `pub const PANNAGE_AUTUMN_CAPACITY_MULTIPLIER: f64 = ${rustF64(b.livestock.pannageAutumnCapacityMultiplier)};`,
    `pub const PANNAGE_WINTER_CAPACITY_MULTIPLIER: f64 = ${rustF64(b.livestock.pannageWinterCapacityMultiplier)};`,
    `pub const PANNAGE_DROUGHT_CAPACITY_MULTIPLIER: f64 = ${rustF64(b.livestock.pannageDroughtCapacityMultiplier)};`,
    `pub const LIVESTOCK_FEED_OAT_GRAIN_PER_CYCLE: f64 = ${rustF64(b.livestock.feedOatGrainPerCycle)};`,
    `pub const LIVESTOCK_ANIMAL_FEED_PER_CYCLE: f64 = ${rustF64(b.livestock.animalFeedPerCycle)};`,
    `pub const LIVESTOCK_ANIMAL_FEED_FODDER_VALUE: f64 = ${rustF64(b.livestock.animalFeedFodderValue)};`,
    `pub const LIVESTOCK_HAY_STORAGE_CAPACITY: f64 = ${rustF64(b.livestock.hayStorageCapacity)};`,
    `pub const LIVESTOCK_MANURE_TRANSFER_PER_TRIP: f64 = ${rustF64(b.livestock.manureTransferPerTrip)};`,
    `pub const LIVESTOCK_FARMSTEAD_PRESERVATION_SALT_PER_OUTPUT: f64 = ${rustF64(b.livestock.farmsteadPreservationSaltPerOutput)};`,
    `pub const LIVESTOCK_FARMSTEAD_SALT_STAGING_PER_CYCLE: f64 = ${rustF64(b.livestock.farmsteadSaltStagingPerCycle)};`,
    `pub const CATTLE_STARTER_HERD: u32 = ${b.livestock.cattle.starterHerd};`,
    `pub const CATTLE_MAX_HERD: u32 = ${b.livestock.cattle.maxHerd};`,
    `pub const CATTLE_MINIMUM_BREEDING_RESERVE: u32 = ${b.livestock.cattle.minimumBreedingReserve};`,
    `pub const CATTLE_DEFAULT_BREEDING_RESERVE: u32 = ${b.livestock.cattle.defaultBreedingReserve};`,
    `pub const CATTLE_PURCHASE_GOLD_PER_HEAD: f64 = ${rustF64(b.livestock.cattle.purchaseGoldPerHead)};`,
    `pub const CATTLE_SALE_GOLD_PER_HEAD: f64 = ${rustF64(b.livestock.cattle.saleGoldPerHead)};`,
    `pub const CATTLE_AREA_PER_HEAD: f64 = ${rustF64(b.livestock.cattle.areaPerHead)};`,
    `pub const CATTLE_HEADS_PER_WORKER: f64 = ${rustF64(b.livestock.cattle.headsPerWorker)};`,
    `pub const CATTLE_WATER_PER_HEAD_PER_CYCLE: f64 = ${rustF64(b.livestock.cattle.waterPerHeadPerCycle)};`,
    `pub const CATTLE_DAIRY_PRODUCTIVE_SHARE: f64 = ${rustF64(b.livestock.cattle.dairyProductiveShare)};`,
    `pub const CATTLE_MAX_SLOPE_DEGREES: f64 = ${rustF64(b.livestock.cattle.maxSlopeDegrees ?? 0)};`,
    `pub const CATTLE_MOISTURE_IDEAL: f64 = ${rustF64(b.livestock.cattle.moistureIdeal ?? 0)};`,
    `pub const CATTLE_MOISTURE_TOLERANCE: f64 = ${rustF64(b.livestock.cattle.moistureTolerance ?? 1)};`,
    `pub const CATTLE_FOOD_PER_CYCLE_PER_HEAD: f64 = ${rustF64(b.livestock.cattle.foodPerCyclePerHead)};`,
    `pub const CATTLE_PRESERVED_FOOD_PER_CYCLE_PER_HEAD: f64 = ${rustF64(b.livestock.cattle.preservedFoodPerCyclePerHead ?? 0)};`,
    `pub const CATTLE_SLAUGHTER_FOOD_PER_HEAD: f64 = ${rustF64(b.livestock.cattle.slaughterFoodPerHead)};`,
    `pub const CATTLE_SLAUGHTER_PRESERVED_FOOD_PER_HEAD: f64 = ${rustF64(b.livestock.cattle.slaughterPreservedFoodPerHead)};`,
    `pub const CATTLE_SLAUGHTER_HIDES_PER_HEAD: f64 = ${rustF64(b.livestock.cattle.slaughterHidesPerHead)};`,
    `pub const CATTLE_HAY_PER_UNSUPPORTED_HEAD: f64 = ${rustF64(b.livestock.cattle.hayPerUnsupportedHead ?? 0)};`,
    `pub const CATTLE_HAY_YIELD_PER_RESERVED_CAPACITY_PER_CYCLE: f64 = ${rustF64(b.livestock.cattle.hayYieldPerReservedCapacityPerCycle ?? 0)};`,
    `pub const CATTLE_GRAIN_PER_UNSUPPORTED_HEAD: f64 = ${rustF64(b.livestock.cattle.grainPerUnsupportedHead)};`,
    `pub const CATTLE_BREEDING_PER_CYCLE: f64 = ${rustF64(b.livestock.cattle.breedingPerCycle)};`,
    `pub const CATTLE_HEALTH_RECOVERY_PER_CYCLE: f64 = ${rustF64(b.livestock.cattle.healthRecoveryPerCycle)};`,
    `pub const CATTLE_HEALTH_LOSS_PER_CYCLE: f64 = ${rustF64(b.livestock.cattle.healthLossPerCycle)};`,
    `pub const CATTLE_MANURE_PER_SUPPLIED_HEAD_PER_CYCLE: f64 = ${rustF64(b.livestock.cattle.manurePerSuppliedHeadPerCycle ?? 0)};`,
    `pub const CATTLE_MANURE_COLLECTION_SPRING_MULTIPLIER: f64 = ${rustF64(b.livestock.cattle.manureCollectionSpringMultiplier ?? 1)};`,
    `pub const CATTLE_MANURE_COLLECTION_SUMMER_MULTIPLIER: f64 = ${rustF64(b.livestock.cattle.manureCollectionSummerMultiplier ?? 1)};`,
    `pub const CATTLE_MANURE_COLLECTION_AUTUMN_MULTIPLIER: f64 = ${rustF64(b.livestock.cattle.manureCollectionAutumnMultiplier ?? 1)};`,
    `pub const CATTLE_MANURE_COLLECTION_WINTER_MULTIPLIER: f64 = ${rustF64(b.livestock.cattle.manureCollectionWinterMultiplier ?? 1)};`,
    `pub const CATTLE_MAX_PLOUGH_SUPPORTED_FIELDS: usize = ${b.livestock.cattle.maxPloughSupportedFields ?? 0};`,
    `pub const CATTLE_PLOUGH_WORK_MULTIPLIER: f64 = ${rustF64(b.livestock.cattle.ploughWorkMultiplier ?? 1)};`,
    `pub const SHEEP_STARTER_HERD: u32 = ${b.livestock.sheep.starterHerd};`,
    `pub const SHEEP_MAX_HERD: u32 = ${b.livestock.sheep.maxHerd};`,
    `pub const SHEEP_MINIMUM_BREEDING_RESERVE: u32 = ${b.livestock.sheep.minimumBreedingReserve};`,
    `pub const SHEEP_DEFAULT_BREEDING_RESERVE: u32 = ${b.livestock.sheep.defaultBreedingReserve};`,
    `pub const SHEEP_PURCHASE_GOLD_PER_HEAD: f64 = ${rustF64(b.livestock.sheep.purchaseGoldPerHead)};`,
    `pub const SHEEP_SALE_GOLD_PER_HEAD: f64 = ${rustF64(b.livestock.sheep.saleGoldPerHead)};`,
    `pub const SHEEP_AREA_PER_HEAD: f64 = ${rustF64(b.livestock.sheep.areaPerHead)};`,
    `pub const SHEEP_HEADS_PER_WORKER: f64 = ${rustF64(b.livestock.sheep.headsPerWorker)};`,
    `pub const SHEEP_WATER_PER_HEAD_PER_CYCLE: f64 = ${rustF64(b.livestock.sheep.waterPerHeadPerCycle)};`,
    `pub const SHEEP_DAIRY_PRODUCTIVE_SHARE: f64 = ${rustF64(b.livestock.sheep.dairyProductiveShare)};`,
    `pub const SHEEP_MAX_SLOPE_DEGREES: f64 = ${rustF64(b.livestock.sheep.maxSlopeDegrees ?? 0)};`,
    `pub const SHEEP_MOISTURE_IDEAL: f64 = ${rustF64(b.livestock.sheep.moistureIdeal ?? 0)};`,
    `pub const SHEEP_MOISTURE_TOLERANCE: f64 = ${rustF64(b.livestock.sheep.moistureTolerance ?? 1)};`,
    `pub const SHEEP_FOOD_PER_CYCLE_PER_HEAD: f64 = ${rustF64(b.livestock.sheep.foodPerCyclePerHead)};`,
    `pub const SHEEP_PRESERVED_FOOD_PER_CYCLE_PER_HEAD: f64 = ${rustF64(b.livestock.sheep.preservedFoodPerCyclePerHead ?? 0)};`,
    `pub const SHEEP_SLAUGHTER_FOOD_PER_HEAD: f64 = ${rustF64(b.livestock.sheep.slaughterFoodPerHead)};`,
    `pub const SHEEP_SLAUGHTER_PRESERVED_FOOD_PER_HEAD: f64 = ${rustF64(b.livestock.sheep.slaughterPreservedFoodPerHead)};`,
    `pub const SHEEP_SLAUGHTER_HIDES_PER_HEAD: f64 = ${rustF64(b.livestock.sheep.slaughterHidesPerHead)};`,
    `pub const SHEEP_HAY_PER_UNSUPPORTED_HEAD: f64 = ${rustF64(b.livestock.sheep.hayPerUnsupportedHead ?? 0)};`,
    `pub const SHEEP_HAY_YIELD_PER_RESERVED_CAPACITY_PER_CYCLE: f64 = ${rustF64(b.livestock.sheep.hayYieldPerReservedCapacityPerCycle ?? 0)};`,
    `pub const SHEEP_GRAIN_PER_UNSUPPORTED_HEAD: f64 = ${rustF64(b.livestock.sheep.grainPerUnsupportedHead)};`,
    `pub const SHEEP_WOOL_PER_SHEARING_PER_HEAD: f64 = ${rustF64(b.livestock.sheep.woolPerShearingPerHead ?? 0)};`,
    `pub const SHEEP_SHEARING_START_MONTH: u8 = ${b.livestock.sheep.shearingStartMonth ?? 6};`,
    `pub const SHEEP_SHEARING_END_MONTH: u8 = ${b.livestock.sheep.shearingEndMonth ?? 7};`,
    `pub const SHEEP_BREEDING_PER_CYCLE: f64 = ${rustF64(b.livestock.sheep.breedingPerCycle)};`,
    `pub const SHEEP_HEALTH_RECOVERY_PER_CYCLE: f64 = ${rustF64(b.livestock.sheep.healthRecoveryPerCycle)};`,
    `pub const SHEEP_HEALTH_LOSS_PER_CYCLE: f64 = ${rustF64(b.livestock.sheep.healthLossPerCycle)};`,
    `pub const SWINE_STARTER_HERD: u32 = ${b.livestock.swine.starterHerd};`,
    `pub const SWINE_MAX_HERD: u32 = ${b.livestock.swine.maxHerd};`,
    `pub const SWINE_MINIMUM_BREEDING_RESERVE: u32 = ${b.livestock.swine.minimumBreedingReserve};`,
    `pub const SWINE_DEFAULT_BREEDING_RESERVE: u32 = ${b.livestock.swine.defaultBreedingReserve};`,
    `pub const SWINE_PURCHASE_GOLD_PER_HEAD: f64 = ${rustF64(b.livestock.swine.purchaseGoldPerHead)};`,
    `pub const SWINE_SALE_GOLD_PER_HEAD: f64 = ${rustF64(b.livestock.swine.saleGoldPerHead)};`,
    `pub const SWINE_AREA_PER_HEAD: f64 = ${rustF64(b.livestock.swine.areaPerHead)};`,
    `pub const SWINE_HEADS_PER_WORKER: f64 = ${rustF64(b.livestock.swine.headsPerWorker)};`,
    `pub const SWINE_WATER_PER_HEAD_PER_CYCLE: f64 = ${rustF64(b.livestock.swine.waterPerHeadPerCycle)};`,
    `pub const SWINE_DAIRY_PRODUCTIVE_SHARE: f64 = ${rustF64(b.livestock.swine.dairyProductiveShare)};`,
    `pub const SWINE_MAX_SLOPE_DEGREES: f64 = ${rustF64(b.livestock.swine.maxSlopeDegrees ?? 0)};`,
    `pub const SWINE_MATURE_TREES_PER_HEAD: f64 = ${rustF64(b.livestock.swine.matureTreesPerHead ?? 0)};`,
    `pub const SWINE_FOOD_PER_CYCLE_PER_HEAD: f64 = ${rustF64(b.livestock.swine.foodPerCyclePerHead)};`,
    `pub const SWINE_SLAUGHTER_FOOD_PER_HEAD: f64 = ${rustF64(b.livestock.swine.slaughterFoodPerHead)};`,
    `pub const SWINE_SLAUGHTER_PRESERVED_FOOD_PER_HEAD: f64 = ${rustF64(b.livestock.swine.slaughterPreservedFoodPerHead)};`,
    `pub const SWINE_SLAUGHTER_HIDES_PER_HEAD: f64 = ${rustF64(b.livestock.swine.slaughterHidesPerHead)};`,
    `pub const SWINE_GRAIN_PER_UNSUPPORTED_HEAD: f64 = ${rustF64(b.livestock.swine.grainPerUnsupportedHead)};`,
    `pub const SWINE_BREEDING_PER_CYCLE: f64 = ${rustF64(b.livestock.swine.breedingPerCycle)};`,
    `pub const SWINE_HEALTH_RECOVERY_PER_CYCLE: f64 = ${rustF64(b.livestock.swine.healthRecoveryPerCycle)};`,
    `pub const SWINE_HEALTH_LOSS_PER_CYCLE: f64 = ${rustF64(b.livestock.swine.healthLossPerCycle)};`,
    '',
  ];

  lines.push('pub fn fire_building_base_flammability(kind: &str) -> f64 {');
  lines.push('    match kind {');
  for (const [kind, flammability] of Object.entries(b.fires.buildingBaseFlammability)) {
    lines.push(`        ${JSON.stringify(kind)} => ${rustF64(flammability ?? b.fires.defaultBuildingBaseFlammability)},`);
  }
  lines.push('        _ => FIRE_DEFAULT_BUILDING_BASE_FLAMMABILITY,');
  lines.push('    }');
  lines.push('}');
  lines.push('');

  lines.push('#[derive(Clone, Copy, Debug, PartialEq, Eq)]');
  lines.push('pub enum FarmCropProduce {');
  lines.push('    Grain,');
  lines.push('    Barley,');
  lines.push('    Fibre,');
  lines.push('    None,');
  lines.push('}');
  lines.push('');
  lines.push('#[derive(Clone, Copy, Debug, PartialEq, Eq)]');
  lines.push('pub enum FarmWorkSeason {');
  lines.push('    Spring,');
  lines.push('    Autumn,');
  lines.push('}');
  lines.push('');
  lines.push('#[derive(Clone, Copy, Debug)]');
  lines.push('pub struct FarmCropDef {');
  lines.push('    pub id: u8,');
  lines.push('    pub slug: &\'static str,');
  lines.push('    pub label: &\'static str,');
  lines.push('    pub produce: FarmCropProduce,');
  lines.push('    pub work_season: FarmWorkSeason,');
  lines.push('    pub seed_grain_per_square_meter: f64,');
  lines.push('    pub yield_multiplier: f64,');
  lines.push('    pub moisture_ideal: f64,');
  lines.push('    pub moisture_tolerance: f64,');
  lines.push('    pub soil_texture_ideal: f64,');
  lines.push('    pub soil_texture_tolerance: f64,');
  lines.push('    pub soil_depth_demand: f64,');
  lines.push('    pub slope_penalty_multiplier: f64,');
  lines.push('    pub fertility_delta: f64,');
  lines.push('    pub work_start_month: u8,');
  lines.push('    pub work_end_month: u8,');
  lines.push('    pub growth_start_month: u8,');
  lines.push('    pub growth_end_month: u8,');
  lines.push('    pub harvest_month: u8,');
  lines.push('    pub calendar_label: &\'static str,');
  lines.push('}');
  lines.push('');
  for (const kind of farmCropKinds) {
    const crop = b.farming.crops[kind];
    const constName = kind.toUpperCase();
    const produce = crop.produce === 'grain'
      ? 'Grain'
      : crop.produce === 'barley'
        ? 'Barley'
        : crop.produce === 'fibre'
          ? 'Fibre'
          : 'None';
    const workSeason = crop.workSeason === 'spring' ? 'Spring' : 'Autumn';
    lines.push(`pub const FARM_CROP_${constName}_ID: u8 = ${crop.id};`);
    lines.push(`pub const FARM_CROP_${constName}: FarmCropDef = FarmCropDef {`);
    lines.push(`    id: FARM_CROP_${constName}_ID,`);
    lines.push(`    slug: ${JSON.stringify(kind)},`);
    lines.push(`    label: ${JSON.stringify(crop.label)},`);
    lines.push(`    produce: FarmCropProduce::${produce},`);
    lines.push(`    work_season: FarmWorkSeason::${workSeason},`);
    lines.push(`    seed_grain_per_square_meter: ${rustF64(crop.seedGrainPerSquareMeter)},`);
    lines.push(`    yield_multiplier: ${rustF64(crop.yieldMultiplier)},`);
    lines.push(`    moisture_ideal: ${rustF64(crop.moistureIdeal)},`);
    lines.push(`    moisture_tolerance: ${rustF64(crop.moistureTolerance)},`);
    lines.push(`    soil_texture_ideal: ${rustF64(crop.soilTextureIdeal)},`);
    lines.push(`    soil_texture_tolerance: ${rustF64(crop.soilTextureTolerance)},`);
    lines.push(`    soil_depth_demand: ${rustF64(crop.soilDepthDemand)},`);
    lines.push(`    slope_penalty_multiplier: ${rustF64(crop.slopePenaltyMultiplier)},`);
    lines.push(`    fertility_delta: ${rustF64(crop.fertilityDelta)},`);
    lines.push(`    work_start_month: ${crop.workStartMonth},`);
    lines.push(`    work_end_month: ${crop.workEndMonth},`);
    lines.push(`    growth_start_month: ${crop.growthStartMonth},`);
    lines.push(`    growth_end_month: ${crop.growthEndMonth},`);
    lines.push(`    harvest_month: ${crop.harvestMonth},`);
    lines.push(`    calendar_label: ${JSON.stringify(crop.calendarLabel)},`);
    lines.push('};');
    lines.push('');
  }
  lines.push('pub const ALL_FARM_CROPS: &[FarmCropDef] = &[');
  for (const kind of farmCropKinds) {
    lines.push(`    FARM_CROP_${kind.toUpperCase()},`);
  }
  lines.push('];');
  lines.push('');
  lines.push('pub fn farm_crop_def(id: u8) -> Option<&\'static FarmCropDef> {');
  lines.push('    ALL_FARM_CROPS.iter().find(|def| def.id == id)');
  lines.push('}');
  lines.push('');

  lines.push('#[derive(Clone, Copy, Debug, PartialEq, Eq)]');
  lines.push('pub enum BuildingSimKind {');
  lines.push('    LumberMill,');
  lines.push('    Reforester,');
  lines.push('    StoneQuarry,');
  lines.push('    LargeQuarry,');
  lines.push('    Mine,');
  lines.push('    CharcoalBurner,');
  lines.push('    Smithy,');
  lines.push('    WeaponsmithArmorer,');
  lines.push('    BowyerFletcher,');
  lines.push('    PotterKiln,');
  lines.push('    WoodcuttersLodge,');
  lines.push('    Well,');
  lines.push('    HuntersHall,');
  lines.push('    ForagersShed,');
  lines.push('    FishingCamp,');
  lines.push('    ThreshingBarn,');
  lines.push('    Monastery,');
  lines.push('    Brewery,');
  lines.push('    Smokehouse,');
  lines.push('    Granary,');
  lines.push('    Bakery,');
  lines.push('    Apiary,');
  lines.push('    Watermill,');
  lines.push('    Windmill,');
  lines.push('    Carpenter,');
  lines.push('    SpinningRettingHouse,');
  lines.push('    Weaver,');
  lines.push('    Tannery,');
  lines.push('    Cobbler,');
  lines.push('    Chandlery,');
  lines.push('    Guardhouse,');
  lines.push('    PastoralFarmstead,');
  lines.push('    Swineherd,');
  lines.push('    VillageStorehouse,');
  lines.push('}');
  lines.push('');
  lines.push('#[derive(Clone, Copy, Debug)]');
  lines.push('pub struct BuildingDef {');
  lines.push('    pub kind: &\'static str,');
  lines.push('    pub cost_timber: f64,');
  lines.push('    pub cost_stone: f64,');
  lines.push('    pub cost_gold: f64,');
  lines.push('    pub cost_ironwork: f64,');
  lines.push('    pub cost_roof_tiles: f64,');
  lines.push('    pub storage_total: f64,');
  lines.push('    pub storage_timber: f64,');
  lines.push('    pub storage_firewood: f64,');
  lines.push('    pub storage_stone: f64,');
  lines.push('    pub storage_water: f64,');
  lines.push('    pub storage_food: f64,');
  lines.push('    pub storage_grain: f64,');
  lines.push('    pub storage_barley: f64,');
  lines.push('    pub storage_malt: f64,');
  lines.push('    pub storage_flax: f64,');
  lines.push('    pub storage_flour: f64,');
  lines.push('    pub storage_ale: f64,');
  lines.push('    pub storage_cider: f64,');
  lines.push('    pub storage_mead: f64,');
  lines.push('    pub storage_preserved_food: f64,');
  lines.push('    pub storage_honey: f64,');
  lines.push('    pub storage_wax: f64,');
  lines.push('    pub storage_candles: f64,');
  lines.push('    pub storage_wine: f64,');
  lines.push('    pub storage_wool: f64,');
  lines.push('    pub storage_yarn: f64,');
  lines.push('    pub storage_linen: f64,');
  lines.push('    pub storage_cloth: f64,');
  lines.push('    pub storage_pelts: f64,');
  lines.push('    pub storage_hides: f64,');
  lines.push('    pub storage_leather: f64,');
  lines.push('    pub storage_shoes: f64,');
  lines.push('    pub storage_ironwork: f64,');
  lines.push('    pub storage_polearms: f64,');
  lines.push('    pub storage_sidearms: f64,');
  lines.push('    pub storage_shields: f64,');
  lines.push('    pub storage_bows: f64,');
  lines.push('    pub storage_crossbows: f64,');
  lines.push('    pub storage_padded_armor: f64,');
  lines.push('    pub storage_mail_armor: f64,');
  lines.push('    pub storage_ammunition: f64,');
  lines.push('    pub storage_iron: f64,');
  lines.push('    pub storage_clay: f64,');
  lines.push('    pub storage_salt: f64,');
  lines.push('    pub storage_charcoal: f64,');
  lines.push('    pub storage_pottery: f64,');
  lines.push('    pub storage_roof_tiles: f64,');
  lines.push('    pub storage_manure: f64,');
  lines.push('    pub storage_remedies: f64,');
  lines.push('    pub storage_animal_feed: f64,');
  lines.push('    pub accepts_labor: bool,');
  lines.push('    pub max_labor: u32,');
  lines.push('    pub work_radius: f64,');
  lines.push('    pub action_interval: f64,');
  lines.push('    pub pick_radius: f64,');
  lines.push('    pub requires_road: bool,');
  lines.push('    pub faces_road: bool,');
  lines.push('    pub requires_mature_trees: bool,');
  lines.push('    pub requires_quarry_stone: bool,');
  lines.push('    pub requires_game: bool,');
  lines.push('    pub requires_berries: bool,');
  lines.push('    pub requires_fish: bool,');
  lines.push('    pub requires_water_shore: bool,');
  lines.push('    pub requires_hillside: bool,');
  lines.push('    pub sim_kind: Option<BuildingSimKind>,');
  lines.push('}');
  lines.push('');

  for (const [kind, def] of Object.entries(b.buildings)) {
    const constName = kind.toUpperCase();
    const simKind = simKindByKind[kind];
    lines.push(`const ${constName}: BuildingDef = BuildingDef {`);
    lines.push(`    kind: "${kind}",`);
    lines.push(`    cost_timber: ${rustF64(def.cost.timber)},`);
    lines.push(`    cost_stone: ${rustF64(def.cost.stone)},`);
    lines.push(`    cost_gold: ${rustF64(def.cost.gold ?? 0)},`);
    lines.push(`    cost_ironwork: ${rustF64(def.cost.ironwork ?? 0)},`);
    lines.push(`    cost_roof_tiles: ${rustF64(def.cost.roofTiles ?? 0)},`);
    lines.push(`    storage_total: ${rustF64(def.storage.total ?? 0)},`);
    lines.push(`    storage_timber: ${rustF64(def.storage.timber)},`);
    lines.push(`    storage_firewood: ${rustF64(def.storage.firewood)},`);
    lines.push(`    storage_stone: ${rustF64(def.storage.stone)},`);
    lines.push(`    storage_water: ${rustF64(def.storage.water ?? 0)},`);
    lines.push(`    storage_food: ${rustF64(def.storage.food ?? 0)},`);
    lines.push(`    storage_grain: ${rustF64(def.storage.grain ?? 0)},`);
    lines.push(`    storage_barley: ${rustF64(def.storage.barley ?? 0)},`);
    lines.push(`    storage_malt: ${rustF64(def.storage.malt ?? 0)},`);
    lines.push(`    storage_flax: ${rustF64(def.storage.flax ?? 0)},`);
    lines.push(`    storage_flour: ${rustF64(def.storage.flour ?? 0)},`);
    lines.push(`    storage_ale: ${rustF64(def.storage.ale ?? 0)},`);
    lines.push(`    storage_cider: ${rustF64(def.storage.cider ?? 0)},`);
    lines.push(`    storage_mead: ${rustF64(def.storage.mead ?? 0)},`);
    lines.push(`    storage_preserved_food: ${rustF64(def.storage.preservedFood ?? 0)},`);
    lines.push(`    storage_honey: ${rustF64(def.storage.honey ?? 0)},`);
    lines.push(`    storage_wax: ${rustF64(def.storage.wax ?? 0)},`);
    lines.push(`    storage_candles: ${rustF64(def.storage.candles ?? 0)},`);
    lines.push(`    storage_wine: ${rustF64(def.storage.wine ?? 0)},`);
    lines.push(`    storage_wool: ${rustF64(def.storage.wool ?? 0)},`);
    lines.push(`    storage_yarn: ${rustF64(def.storage.yarn ?? 0)},`);
    lines.push(`    storage_linen: ${rustF64(def.storage.linen ?? 0)},`);
    lines.push(`    storage_cloth: ${rustF64(def.storage.cloth ?? 0)},`);
    lines.push(`    storage_pelts: ${rustF64(def.storage.pelts ?? 0)},`);
    lines.push(`    storage_hides: ${rustF64(def.storage.hides ?? 0)},`);
    lines.push(`    storage_leather: ${rustF64(def.storage.leather ?? 0)},`);
    lines.push(`    storage_shoes: ${rustF64(def.storage.shoes ?? 0)},`);
    lines.push(`    storage_ironwork: ${rustF64(def.storage.ironwork ?? 0)},`);
    lines.push(`    storage_polearms: ${rustF64(def.storage.polearms ?? 0)},`);
    lines.push(`    storage_sidearms: ${rustF64(def.storage.sidearms ?? 0)},`);
    lines.push(`    storage_shields: ${rustF64(def.storage.shields ?? 0)},`);
    lines.push(`    storage_bows: ${rustF64(def.storage.bows ?? 0)},`);
    lines.push(`    storage_crossbows: ${rustF64(def.storage.crossbows ?? 0)},`);
    lines.push(`    storage_padded_armor: ${rustF64(def.storage.paddedArmor ?? 0)},`);
    lines.push(`    storage_mail_armor: ${rustF64(def.storage.mailArmor ?? 0)},`);
    lines.push(`    storage_ammunition: ${rustF64(def.storage.ammunition ?? 0)},`);
    lines.push(`    storage_iron: ${rustF64(def.storage.iron ?? 0)},`);
    lines.push(`    storage_clay: ${rustF64(def.storage.clay ?? 0)},`);
    lines.push(`    storage_salt: ${rustF64(def.storage.salt ?? 0)},`);
    lines.push(`    storage_charcoal: ${rustF64(def.storage.charcoal ?? 0)},`);
    lines.push(`    storage_pottery: ${rustF64(def.storage.pottery ?? 0)},`);
    lines.push(`    storage_roof_tiles: ${rustF64(def.storage.roofTiles ?? 0)},`);
    lines.push(`    storage_manure: ${rustF64(def.storage.manure ?? 0)},`);
    lines.push(`    storage_remedies: ${rustF64(def.storage.remedies ?? 0)},`);
    lines.push(`    storage_animal_feed: ${rustF64(def.storage.animalFeed ?? 0)},`);
    lines.push(`    accepts_labor: ${def.acceptsLabor},`);
    lines.push(`    max_labor: ${def.maxLabor},`);
    lines.push(`    work_radius: ${rustF64(def.workRadius)},`);
    lines.push(`    action_interval: ${rustF64(def.harvestInterval)},`);
    lines.push(`    pick_radius: ${rustF64(def.pickRadius)},`);
    lines.push(`    requires_road: ${def.requiresRoad},`);
    lines.push(`    faces_road: ${def.facesRoad},`);
    lines.push(`    requires_mature_trees: ${def.requiresMatureTrees},`);
    lines.push(`    requires_quarry_stone: ${def.requiresQuarryStone},`);
    lines.push(`    requires_game: ${def.requiresGame},`);
    lines.push(`    requires_berries: ${def.requiresBerries},`);
    lines.push(`    requires_fish: ${def.requiresFish ?? false},`);
    lines.push(`    requires_water_shore: ${def.requiresWaterShore ?? false},`);
    lines.push(`    requires_hillside: ${def.requiresHillside ?? false},`);
    lines.push(`    sim_kind: ${simKind ? `Some(BuildingSimKind::${simKind})` : 'None'},`);
    lines.push('};');
    lines.push('');
  }

  lines.push(`const ALL: &[BuildingDef] = &[${buildingKinds.map((kind) => kind.toUpperCase()).join(', ')}];`);
  lines.push('');
  lines.push('pub fn building_def(kind: &str) -> Option<&\'static BuildingDef> {');
  lines.push('    ALL.iter().find(|def| def.kind == kind)');
  lines.push('}');
  lines.push('');
  lines.push('pub fn building_def_or_err(kind: &str) -> Result<&\'static BuildingDef, String> {');
  lines.push('    building_def(kind).ok_or_else(|| format!("Unknown building kind: {kind}"))');
  lines.push('}');
  lines.push('');

  lines.push('#[derive(Clone, Copy, Debug, PartialEq, Eq)]');
  lines.push('#[repr(u8)]');
  lines.push('pub enum BackyardGardenKind {');
  for (let i = 0; i < backyardGardenKinds.length; i++) {
    const kind = backyardGardenKinds[i];
    const variant = kind
      .split('_')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join('');
    lines.push(`    ${variant} = ${i + 1},`);
  }
  lines.push('}');
  lines.push('');
  lines.push('impl BackyardGardenKind {');
  lines.push('    pub fn from_id(id: u8) -> Option<Self> {');
  lines.push('        match id {');
  for (let i = 0; i < backyardGardenKinds.length; i++) {
    const kind = backyardGardenKinds[i];
    const variant = kind
      .split('_')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join('');
    lines.push(`            ${i + 1} => Some(Self::${variant}),`);
  }
  lines.push('            _ => None,');
  lines.push('        }');
  lines.push('    }');
  lines.push('}');
  lines.push('');
  lines.push('#[derive(Clone, Copy, Debug)]');
  lines.push('pub struct BackyardGardenDef {');
  lines.push('    pub kind: BackyardGardenKind,');
  lines.push('    pub slug: &\'static str,');
  lines.push('    #[allow(dead_code)]');
  lines.push('    pub label: &\'static str,');
  lines.push('    pub cost_timber: f64,');
  lines.push('    pub cost_stone: f64,');
  lines.push('    pub cost_gold: f64,');
  lines.push('    pub food_per_person_per_sec: f64,');
  lines.push('    pub settlement_attraction_multiplier: f64,');
  lines.push('    pub hidden_from_picker: bool,');
  lines.push('    pub specialization_of: Option<&\'static str>,');
  lines.push('    pub first_harvest_days: u64,');
  lines.push('    pub gestation_days: u64,');
  lines.push('    pub harvest_start_month: u32,');
  lines.push('    pub harvest_end_month: u32,');
  lines.push('    pub production_interval_days: u64,');
  lines.push('    pub secondary_food_per_person_per_sec: f64,');
  lines.push('    pub secondary_production_interval_days: u64,');
  lines.push('    pub secondary_harvest_start_month: u32,');
  lines.push('    pub secondary_harvest_end_month: u32,');
  lines.push('    pub hide_per_person_per_secondary_harvest: f64,');
  lines.push('    pub hide_capacity: f64,');
  lines.push('    pub wax_per_secondary_harvest: f64,');
  lines.push('    pub wax_capacity: f64,');
  lines.push('    pub yield_efficiency: f64,');
  lines.push('    pub jam_per_person_per_sec: f64,');
  lines.push('    pub luxury_upgrade_gold_cost: f64,');
  lines.push('}');
  lines.push('');

  for (const [kind, def] of Object.entries(b.backyardGardens)) {
    const variant = kind
      .split('_')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join('');
    lines.push(`const BACKYARD_${kind.toUpperCase()}: BackyardGardenDef = BackyardGardenDef {`);
    lines.push(`    kind: BackyardGardenKind::${variant},`);
    lines.push(`    slug: "${kind}",`);
    lines.push(`    label: ${JSON.stringify(def.label)},`);
    lines.push(`    cost_timber: ${rustF64(def.cost.timber)},`);
    lines.push(`    cost_stone: ${rustF64(def.cost.stone)},`);
    lines.push(`    cost_gold: ${rustF64(def.cost.gold)},`);
    lines.push(`    food_per_person_per_sec: ${rustF64(def.foodPerPersonPerSec)},`);
    lines.push(`    settlement_attraction_multiplier: ${rustF64(def.settlementAttractionMultiplier)},`);
    lines.push(`    hidden_from_picker: ${def.hiddenFromPicker === true},`);
    lines.push(`    specialization_of: ${def.specializationOf ? `Some(${JSON.stringify(def.specializationOf)})` : 'None'},`);
    lines.push(`    first_harvest_days: ${Math.max(0, Math.round(def.firstHarvestDays ?? 0))},`);
    lines.push(`    gestation_days: ${Math.max(0, Math.round(def.gestationDays ?? 0))},`);
    lines.push(`    harvest_start_month: ${Math.max(0, Math.round(def.harvestStartMonth ?? 0))},`);
    lines.push(`    harvest_end_month: ${Math.max(0, Math.round(def.harvestEndMonth ?? 0))},`);
    lines.push(`    production_interval_days: ${Math.max(0, Math.round(def.productionIntervalDays ?? 0))},`);
    lines.push(`    secondary_food_per_person_per_sec: ${rustF64(def.secondaryFoodPerPersonPerSec ?? 0)},`);
    lines.push(`    secondary_production_interval_days: ${Math.max(0, Math.round(def.secondaryProductionIntervalDays ?? 0))},`);
    lines.push(`    secondary_harvest_start_month: ${Math.max(0, Math.round(def.secondaryHarvestStartMonth ?? 0))},`);
    lines.push(`    secondary_harvest_end_month: ${Math.max(0, Math.round(def.secondaryHarvestEndMonth ?? 0))},`);
    lines.push(`    hide_per_person_per_secondary_harvest: ${rustF64(def.hidePerPersonPerSecondaryHarvest ?? 0)},`);
    lines.push(`    hide_capacity: ${rustF64(def.hideCapacity ?? 0)},`);
    lines.push(`    wax_per_secondary_harvest: ${rustF64(def.waxPerSecondaryHarvest ?? 0)},`);
    lines.push(`    wax_capacity: ${rustF64(def.waxCapacity ?? 0)},`);
    lines.push(`    yield_efficiency: ${rustF64(def.yieldEfficiency ?? 1)},`);
    lines.push(`    jam_per_person_per_sec: ${rustF64(def.jamPerPersonPerSec ?? 0)},`);
    lines.push(`    luxury_upgrade_gold_cost: ${rustF64(def.luxuryUpgradeGoldCost ?? 0)},`);
    lines.push('};');
    lines.push('');
  }

  lines.push(
    `const ALL_BACKYARD_GARDENS: &[BackyardGardenDef] = &[${backyardGardenKinds.map((kind) => `BACKYARD_${kind.toUpperCase()}`).join(', ')}];`,
  );
  lines.push('');
  lines.push('pub fn backyard_garden_def(kind: BackyardGardenKind) -> &\'static BackyardGardenDef {');
  lines.push('    ALL_BACKYARD_GARDENS');
  lines.push('        .iter()');
  lines.push('        .find(|def| def.kind == kind)');
  lines.push('        .expect("missing backyard garden def")');
  lines.push('}');
  lines.push('');
  lines.push('pub fn backyard_garden_def_by_slug(slug: &str) -> Option<&\'static BackyardGardenDef> {');
  lines.push('    ALL_BACKYARD_GARDENS.iter().find(|def| def.slug == slug)');
  lines.push('}');
  lines.push('');
  lines.push(...generateMarketplaceTradeRust(balance));
  lines.push(...generateRegionalMarketRust(balance));

  return lines.join('\n');
}

function generateTypeScript(): string {
  const b = balance;
  const farmCropDefinitions = Object.fromEntries(
    farmCropKinds.map((kind) => {
      const crop = b.farming.crops[kind];
      return [kind, { kind, ...crop }];
    }),
  );
  const lines: string[] = [
    '// Generated by scripts/generateGameBalance.mts — do not edit.',
    '',
    `export const BUILDING_KINDS = ${JSON.stringify(buildingKinds)} as const;`,
    'export type BuildingKind = (typeof BUILDING_KINDS)[number];',
    '',
    `export const SIM_TICK_SECONDS = ${b.sim.tickDt};`,
    `export const SIM_TICK_INTERVAL_SECONDS = ${b.sim.tickMicros / 1_000_000};`,
    `export const SIM_REALTIME_RATE = ${b.sim.baseSpeedNumerator / b.sim.baseSpeedDenominator};`,
    '',
    `export const CALENDAR_SECONDS_PER_DAY = ${b.calendar.secondsPerDay};`,
    `export const CALENDAR_HOURS_PER_DAY = ${b.calendar.hoursPerDay};`,
    `export const CALENDAR_DAYS_PER_MONTH = ${b.calendar.daysPerMonth};`,
    `export const CALENDAR_MONTHS_PER_YEAR = ${b.calendar.monthsPerYear};`,
    `export const CALENDAR_DAYS_PER_WEEK = ${b.calendar.daysPerWeek};`,
    `export const CALENDAR_SUNDAY_WEEKDAY = ${b.calendar.sundayWeekday};`,
    `export const CALENDAR_START_MONTH = ${b.calendar.startMonth};`,
    `export const CALENDAR_DAY_START_HOUR = ${b.calendar.dayStartHour};`,
    `export const CALENDAR_DAY_START_OFFSET_SECONDS = ${b.calendar.secondsPerDay * b.calendar.dayStartHour / b.calendar.hoursPerDay};`,
    `export const CALENDAR_WORK_START_HOUR = ${b.calendar.workStartHour};`,
    `export const CALENDAR_WORK_END_HOUR = ${b.calendar.workEndHour};`,
    `export const SECONDS_PER_DAY = ${b.calendar.secondsPerDay};`,
    `export const WORKFORCE_AVERAGE_WALK_SPEED_MPS = ${b.workforce.averageWalkSpeedMps};`,
    `export const WORKFORCE_MOVEMENT_SPEED_MULTIPLIER = ${b.workforce.movementSpeedMultiplier};`,
    `export const WORKFORCE_ROAD_SPEED_MULTIPLIER = ${b.workforce.roadSpeedMultiplier};`,
    '',
    `export const COMBAT_STEERING_CELL_SIZE_M = ${b.combatSteering.cellSizeM};`,
    `export const COMBAT_STEERING_NEIGHBOR_RADIUS_M = ${b.combatSteering.neighborRadiusM};`,
    `export const COMBAT_STEERING_SEPARATION_DISTANCE_M = ${b.combatSteering.separationDistanceM};`,
    `export const COMBAT_STEERING_PREDICTION_SECONDS = ${b.combatSteering.predictionSeconds};`,
    `export const COMBAT_STEERING_MAX_NEIGHBORS = ${Math.max(1, Math.round(b.combatSteering.maxNeighbors))};`,
    `export const COMBAT_STEERING_GOAL_WEIGHT = ${b.combatSteering.goalWeight};`,
    `export const COMBAT_STEERING_SEPARATION_WEIGHT = ${b.combatSteering.separationWeight};`,
    `export const COMBAT_STEERING_PREDICTIVE_WEIGHT = ${b.combatSteering.predictiveWeight};`,
    `export const COMBAT_STEERING_ALIGNMENT_WEIGHT = ${b.combatSteering.alignmentWeight};`,
    `export const COMBAT_STEERING_COHESION_WEIGHT = ${b.combatSteering.cohesionWeight};`,
    `export const COMBAT_STEERING_ENGAGEMENT_SLOT_COUNT = ${Math.max(1, Math.round(b.combatSteering.engagementSlotCount))};`,
    `export const COMBAT_STEERING_ENGAGEMENT_RADIUS_FACTOR = ${b.combatSteering.engagementRadiusFactor};`,
    `export const COMBAT_STEERING_ENGAGEMENT_MIN_RADIUS_M = ${b.combatSteering.engagementMinRadiusM};`,
    `export const COMBAT_STEERING_RANGED_LINE_SPACING_M = ${b.combatSteering.rangedLineSpacingM};`,
    `export const COMBAT_STEERING_RANGED_DEPTH_SPACING_M = ${b.combatSteering.rangedDepthSpacingM};`,
    `export const COMBAT_STEERING_RANGED_PREFERRED_RANGE_FACTOR = ${b.combatSteering.rangedPreferredRangeFactor};`,
    `export const COMBAT_STEERING_VELOCITY_RESPONSE_PER_SECOND = ${b.combatSteering.velocityResponsePerSecond};`,
    `export const COMBAT_STEERING_MAX_TURN_RADIANS_PER_SECOND = ${b.combatSteering.maxTurnRadiansPerSecond};`,
    `export const COMBAT_STEERING_EXACT_OVERLAP_EPSILON_SQ = ${b.combatSteering.exactOverlapEpsilonSq};`,
    `export const COMBAT_STEERING_HARD_CONSTRAINT_ITERATIONS = ${Math.max(1, Math.round(b.combatSteering.hardConstraintIterations))};`,
    `export const COMBAT_STEERING_HARD_CLEARANCE_EPSILON_M = ${b.combatSteering.hardClearanceEpsilonM};`,
    '',
    `export const SPRING_RAIN_CHANCE = ${b.seasons.springRainChance};`,
    `export const SPRING_RAIN_CROP_GROWTH_MULTIPLIER = ${b.seasons.springRainCropGrowthMultiplier};`,
    `export const SPRING_RAIN_WELL_REFILL_MULTIPLIER = ${b.seasons.springRainWellRefillMultiplier};`,
    `export const SPRING_RAIN_ROAD_SPEED_MULTIPLIER = ${b.seasons.springRainRoadSpeedMultiplier};`,
    `export const SPRING_RAIN_WATERMILL_THROUGHPUT_MULTIPLIER = ${b.seasons.springRainWatermillThroughputMultiplier};`,
    `export const SPRING_RAIN_CHARCOAL_BURNER_THROUGHPUT_MULTIPLIER = ${b.seasons.springRainCharcoalBurnerThroughputMultiplier};`,
    `export const SUMMER_DROUGHT_CHANCE = ${b.seasons.summerDroughtChance};`,
    `export const SUMMER_DROUGHT_DURATION_DAYS = ${b.seasons.summerDroughtDurationDays};`,
    `export const DROUGHT_CROP_GROWTH_MULTIPLIER = ${b.seasons.droughtCropGrowthMultiplier};`,
    `export const DROUGHT_FORAGE_REGROWTH_MULTIPLIER = ${b.seasons.droughtForageRegrowthMultiplier};`,
    `export const DROUGHT_WELL_REFILL_MULTIPLIER = ${b.seasons.droughtWellRefillMultiplier};`,
    `export const DROUGHT_GROUNDWATER_MULTIPLIER = ${b.seasons.droughtGroundwaterMultiplier};`,
    `export const DROUGHT_FISH_LOSS_FRACTION_PER_DAY = ${b.seasons.droughtFishLossFractionPerDay};`,
    `export const DROUGHT_WATERMILL_THROUGHPUT_MULTIPLIER = ${b.seasons.droughtWatermillThroughputMultiplier};`,
    `export const DROUGHT_CHARCOAL_BURNER_THROUGHPUT_MULTIPLIER = ${b.seasons.droughtCharcoalBurnerThroughputMultiplier};`,
    `export const SPRING_FIREWOOD_DEMAND_MULTIPLIER = ${b.seasons.springFirewoodDemandMultiplier};`,
    `export const SUMMER_FIREWOOD_DEMAND_MULTIPLIER = ${b.seasons.summerFirewoodDemandMultiplier};`,
    `export const AUTUMN_FIREWOOD_DEMAND_MULTIPLIER = ${b.seasons.autumnFirewoodDemandMultiplier};`,
    `export const WINTER_FIREWOOD_DEMAND_MULTIPLIER = ${b.seasons.winterFirewoodDemandMultiplier};`,
    `export const SPRING_PASTURE_CAPACITY_MULTIPLIER = ${b.seasons.springPastureCapacityMultiplier};`,
    `export const SUMMER_PASTURE_CAPACITY_MULTIPLIER = ${b.seasons.summerPastureCapacityMultiplier};`,
    `export const AUTUMN_PASTURE_CAPACITY_MULTIPLIER = ${b.seasons.autumnPastureCapacityMultiplier};`,
    `export const WINTER_PASTURE_CAPACITY_MULTIPLIER = ${b.seasons.winterPastureCapacityMultiplier};`,
    `export const DROUGHT_PASTURE_CAPACITY_MULTIPLIER = ${b.seasons.droughtPastureCapacityMultiplier};`,
    `export const LIVESTOCK_SEASONAL_CONCEPTION_MULTIPLIER = ${b.seasons.seasonalConceptionMultiplier};`,
    `export const AUTUMN_ROAD_SPEED_MULTIPLIER = ${b.seasons.autumnRoadSpeedMultiplier};`,
    `export const WINTER_ROAD_SPEED_MULTIPLIER = ${b.seasons.winterRoadSpeedMultiplier};`,
    `export const WINTER_WATERMILL_THROUGHPUT_MULTIPLIER = ${b.seasons.winterWatermillThroughputMultiplier};`,
    `export const WINTER_CHARCOAL_BURNER_THROUGHPUT_MULTIPLIER = ${b.seasons.winterCharcoalBurnerThroughputMultiplier};`,
    `export const FRESH_FOOD_SPOILAGE_SPRING_PER_DAY = ${b.seasons.freshFoodSpoilageSpringPerDay};`,
    `export const FRESH_FOOD_SPOILAGE_SUMMER_PER_DAY = ${b.seasons.freshFoodSpoilageSummerPerDay};`,
    `export const FRESH_FOOD_SPOILAGE_AUTUMN_PER_DAY = ${b.seasons.freshFoodSpoilageAutumnPerDay};`,
    `export const FRESH_FOOD_SPOILAGE_WINTER_PER_DAY = ${b.seasons.freshFoodSpoilageWinterPerDay};`,
    `export const FRESH_FOOD_SPOILAGE_DROUGHT_PER_DAY = ${b.seasons.freshFoodSpoilageDroughtPerDay};`,
    `export const FRESH_FOOD_STORAGE_DEFAULT_BUILDING_FACTOR = ${b.seasons.freshFoodStorageFactors.defaultBuilding};`,
    `export const FRESH_FOOD_STORAGE_GRANARY_FACTOR = ${b.seasons.freshFoodStorageFactors.granary};`,
    `export const FRESH_FOOD_STORAGE_SMOKEHOUSE_FACTOR = ${b.seasons.freshFoodStorageFactors.smokehouse};`,
    `export const FRESH_FOOD_STORAGE_MONASTERY_FACTOR = ${b.seasons.freshFoodStorageFactors.monastery};`,
    `export const FRESH_FOOD_STORAGE_MARKETPLACE_FACTOR = ${b.seasons.freshFoodStorageFactors.marketplace};`,
    `export const FRESH_FOOD_STORAGE_RESIDENCE_FACTOR = ${b.seasons.freshFoodStorageFactors.residence};`,
    `export const FRESH_FOOD_STORAGE_CART_FACTOR = ${b.seasons.freshFoodStorageFactors.cart};`,
    `export const FRESH_FOOD_STORAGE_TREASURY_FACTOR = ${b.seasons.freshFoodStorageFactors.treasury};`,
    `export const PRESERVED_FOOD_SPOILAGE_PER_DAY = ${b.seasons.preservedFoodSpoilagePerDay};`,
    `export const PRESERVED_FOOD_SPOILAGE_SPRING_MULTIPLIER = ${b.seasons.preservedFoodSpoilageSpringMultiplier};`,
    `export const PRESERVED_FOOD_SPOILAGE_SUMMER_MULTIPLIER = ${b.seasons.preservedFoodSpoilageSummerMultiplier};`,
    `export const PRESERVED_FOOD_SPOILAGE_AUTUMN_MULTIPLIER = ${b.seasons.preservedFoodSpoilageAutumnMultiplier};`,
    `export const PRESERVED_FOOD_SPOILAGE_WINTER_MULTIPLIER = ${b.seasons.preservedFoodSpoilageWinterMultiplier};`,
    `export const PRESERVED_FOOD_SPOILAGE_DROUGHT_MULTIPLIER = ${b.seasons.preservedFoodSpoilageDroughtMultiplier};`,
    `export const PRESERVED_FOOD_STORAGE_DEFAULT_BUILDING_FACTOR = ${b.seasons.preservedFoodStorageFactors.defaultBuilding};`,
    `export const PRESERVED_FOOD_STORAGE_GRANARY_FACTOR = ${b.seasons.preservedFoodStorageFactors.granary};`,
    `export const PRESERVED_FOOD_STORAGE_SMOKEHOUSE_FACTOR = ${b.seasons.preservedFoodStorageFactors.smokehouse};`,
    `export const PRESERVED_FOOD_STORAGE_MONASTERY_FACTOR = ${b.seasons.preservedFoodStorageFactors.monastery};`,
    `export const PRESERVED_FOOD_STORAGE_MARKETPLACE_FACTOR = ${b.seasons.preservedFoodStorageFactors.marketplace};`,
    `export const PRESERVED_FOOD_STORAGE_RESIDENCE_FACTOR = ${b.seasons.preservedFoodStorageFactors.residence};`,
    `export const PRESERVED_FOOD_STORAGE_CART_FACTOR = ${b.seasons.preservedFoodStorageFactors.cart};`,
    `export const PRESERVED_FOOD_STORAGE_TREASURY_FACTOR = ${b.seasons.preservedFoodStorageFactors.treasury};`,
    '',
    `export const FIRE_LIGHTNING_IGNITION_CHANCE_PER_RAIN_DAY = ${b.fires.lightningIgnitionChancePerRainDay};`,
    `export const FIRE_ACCIDENT_IGNITION_CHANCE_PER_STRUCTURE_DAY = ${b.fires.accidentIgnitionChancePerStructureDay};`,
    `export const FIRE_DEFAULT_BUILDING_BASE_FLAMMABILITY = ${b.fires.defaultBuildingBaseFlammability};`,
    `export const FIRE_BUILDING_BASE_FLAMMABILITY = ${JSON.stringify(b.fires.buildingBaseFlammability)} as const satisfies Partial<Record<BuildingKind, number>>;`,
    `export const FIRE_DROUGHT_RISK_MULTIPLIER = ${b.fires.droughtRiskMultiplier};`,
    `export const FIRE_RAIN_RISK_MULTIPLIER = ${b.fires.rainRiskMultiplier};`,
    `export const FIRE_SPREAD_RADIUS = ${b.fires.spreadRadius};`,
    `export const FIRE_SPREAD_CHANCE_PER_SECOND = ${b.fires.spreadChancePerSecond};`,
    `export const FIRE_INITIAL_INTENSITY = ${b.fires.initialIntensity};`,
    `export const FIRE_INTENSITY_GROWTH_PER_SECOND = ${b.fires.intensityGrowthPerSecond};`,
    `export const FIRE_RAIN_INTENSITY_DAMPING_PER_SECOND = ${b.fires.rainIntensityDampingPerSecond};`,
    `export const FIRE_DAMAGE_PER_INTENSITY_SECOND = ${b.fires.damagePerIntensitySecond};`,
    `export const FIRE_BUCKET_WATER = ${b.fires.bucketWater};`,
    `export const FIRE_MINIMUM_BUCKET_WATER = ${b.fires.minimumBucketWater};`,
    `export const FIRE_BUCKET_SPEED_MPS = ${b.fires.bucketSpeedMps};`,
    `export const FIRE_BUCKET_UNLOAD_SECONDS = ${b.fires.bucketUnloadSeconds};`,
    `export const FIRE_INTENSITY_REDUCTION_PER_WATER = ${b.fires.intensityReductionPerWater};`,
    `export const FIRE_EXTINGUISH_INTENSITY_THRESHOLD = ${b.fires.extinguishIntensityThreshold};`,
    `export const FIRE_EXTINGUISH_CHANCE_BASE = ${b.fires.extinguishChanceBase};`,
    `export const FIRE_EXTINGUISH_CHANCE_PER_WATER = ${b.fires.extinguishChancePerWater};`,
    `export const FIRE_RESOLVED_RETENTION_SECONDS = ${b.fires.resolvedRetentionSeconds};`,
    `export const FIRE_MINIMUM_REPAIR_COST_FRACTION = ${b.fires.minimumRepairCostFraction};`,
    `export const FIRE_DAMAGE_REPAIR_COST_MULTIPLIER = ${b.fires.damageRepairCostMultiplier};`,
    `export const FIRE_DESTROYED_REBUILD_COST_FRACTION = ${b.fires.destroyedRebuildCostFraction};`,
    '',
    `export const STARTING_TIMBER = ${b.economy.startingTimber};`,
    `export const STARTING_STONE = ${b.economy.startingStone};`,
    `export const STARTING_FIREWOOD = ${b.economy.startingFirewood};`,
    `export const STARTING_BREAD = ${b.economy.startingBread};`,
    `export const STARTING_IRONWORK = ${b.economy.startingIronwork};`,
    `export const STARTING_GOLD = ${b.economy.startingGold};`,
    `export const STABLE_OX_SLOTS = ${b.economy.stableOxSlots};`,
    `export const STABLE_OX_MAX_PER_WORKPLACE = ${b.economy.stableOxMaxPerWorkplace};`,
    `export const STABLE_OX_PURCHASE_GOLD = ${b.economy.stableOxPurchaseGold};`,
    `export const KENNEL_DOG_SLOTS = ${b.economy.kennelDogSlots};`,
    `export const KENNEL_DOG_PURCHASE_GOLD = ${b.economy.kennelDogPurchaseGold};`,
    `export const KENNEL_DOG_MAX_PER_HUNTERS_HALL = ${b.economy.kennelDogMaxPerHuntersHall};`,
    `export const KENNEL_DOG_HUNTING_RATE_BONUS = ${b.economy.kennelDogHuntingRateBonus};`,
    `export const STONE_SALVAGE_FRACTION = ${b.economy.stoneSalvageFraction};`,
    `export const TIMBER_SALVAGE_FRACTION = ${b.economy.timberSalvageFraction};`,
    `export const IRONWORK_SALVAGE_FRACTION = ${b.economy.ironworkSalvageFraction};`,
    `export const GOLD_SALVAGE_FRACTION = ${b.economy.goldSalvageFraction};`,
    `export const ECONOMIC_ACTIVITY_TAX_RATE = ${b.economy.economicActivityTaxRate};`,
    `export const ECONOMIC_ACTIVITY_TAX_RATE_MIN = ${b.economy.economicActivityTaxRateMin};`,
    `export const ECONOMIC_ACTIVITY_TAX_RATE_MAX = ${b.economy.economicActivityTaxRateMax};`,
    `export const LOW_TAX_PRODUCTIVITY_BOOST = ${b.economy.lowTaxProductivityBoost};`,
    `export const HIGH_TAX_PRODUCTIVITY_DRAG = ${b.economy.highTaxProductivityDrag};`,
    `export const FOOD_SALE_GOLD_PER_UNIT = ${b.economy.foodSaleGoldPerUnit};`,
    `export const SMALLHOLDING_BACKYARD_PRODUCTIVITY_MULTIPLIER = ${b.economy.smallholdingBackyardProductivityMultiplier};`,
    `export const RESIDENCE_TIMBER_COST = ${b.economy.residenceTimberCost};`,
    `export const RESIDENCE_STONE_COST = ${b.economy.residenceStoneCost};`,
    `export const RESIDENCE_TIER2_TIMBER_COST = ${b.economy.residenceTier2TimberCost};`,
    `export const RESIDENCE_TIER2_STONE_COST = ${b.economy.residenceTier2StoneCost};`,
    `export const RESIDENCE_TIER2_GOLD_COST = ${b.economy.residenceTier2GoldCost};`,
    `export const RESIDENCE_TIER3_TIMBER_COST = ${b.economy.residenceTier3TimberCost};`,
    `export const RESIDENCE_TIER3_STONE_COST = ${b.economy.residenceTier3StoneCost};`,
    `export const RESIDENCE_TIER3_GOLD_COST = ${b.economy.residenceTier3GoldCost};`,
    `export const RESIDENCE_TIER4_TIMBER_COST = ${b.economy.residenceTier4TimberCost};`,
    `export const RESIDENCE_TIER4_STONE_COST = ${b.economy.residenceTier4StoneCost};`,
    `export const RESIDENCE_TIER4_GOLD_COST = ${b.economy.residenceTier4GoldCost};`,
    `export const RESIDENCE_TILE_ROOF_TIMBER_COST = ${b.economy.residenceTileRoofTimberCost};`,
    `export const RESIDENCE_TILE_ROOF_TILE_COST = ${b.economy.residenceTileRoofTileCost};`,
    `export const RESIDENCE_TILE_ROOF_SALVAGE_FRACTION = ${b.economy.residenceTileRoofSalvageFraction};`,
    `export const RESIDENCE_TILE_ROOF_FLAMMABILITY_MULTIPLIER = ${b.economy.residenceTileRoofFlammabilityMultiplier};`,
    `export const HOUSEHOLD_MAX_WEALTH = ${b.economy.householdMaxWealth};`,
    `export const HOUSEHOLD_PROJECT_WEALTH_RESERVE = ${b.economy.householdProjectWealthReserve};`,
    `export const HOUSEHOLD_INITIAL_WEALTH_PER_SETTLER = ${b.economy.householdInitialWealthPerSettler};`,
    `export const HOUSEHOLD_DISCRETIONARY_WEALTH_RESERVE = ${b.economy.householdDiscretionaryWealthReserve};`,
    `export const HOUSEHOLD_DISCRETIONARY_BUDGET_PER_PERSON_DAY = ${b.economy.householdDiscretionaryBudgetPerPersonDay};`,
    `export const HOUSEHOLD_DISCRETIONARY_UNITS_PER_PERSON_DAY = ${b.economy.householdDiscretionaryUnitsPerPersonDay};`,
    `export const HOUSEHOLD_DISCRETIONARY_MIN_TIER = ${b.economy.householdDiscretionaryMinTier};`,
    `export const HOUSEHOLD_TIER4_SHORTAGE_DISCRETIONARY_MULTIPLIER = ${b.economy.householdTier4ShortageDiscretionaryMultiplier};`,
    `export const HOUSEHOLD_LOCAL_POTTERY_GOLD_PER_UNIT = ${b.economy.householdLocalPotteryGoldPerUnit};`,
    `export const LOCAL_MARKET_FOOD_GOLD_PER_MEAL = ${b.economy.localMarketFoodGoldPerMeal};`,
    `export const LOCAL_MARKET_FIREWOOD_GOLD_PER_UNIT = ${b.economy.localMarketFirewoodGoldPerUnit};`,
    `export const LOCAL_MARKET_PRESERVED_FOOD_GOLD_PER_MEAL = ${b.economy.localMarketPreservedFoodGoldPerMeal};`,
    `export const LOCAL_MARKET_ALE_GOLD_PER_UNIT = ${b.economy.localMarketAleGoldPerUnit};`,
    `export const LOCAL_MARKET_CLOTH_GOLD_PER_UNIT = ${b.economy.localMarketClothGoldPerUnit};`,
    `export const LOCAL_MARKET_PRICE_MULTIPLIER_MIN = ${b.economy.localMarketPriceMultiplierMin};`,
    `export const LOCAL_MARKET_PRICE_MULTIPLIER_MAX = ${b.economy.localMarketPriceMultiplierMax};`,
    `export const TOWN_HALL_POPULATION_REQUIRED = ${b.economy.townHallPopulationRequired};`,
    `export const TOWN_HALL_UNSTAFFED_TAX_COLLECTION_MULTIPLIER = ${b.economy.townHallUnstaffedTaxCollectionMultiplier};`,
    `export const LOCAL_MARKET_TAX_CART_THRESHOLD = ${b.economy.localMarketTaxCartThreshold};`,
    `export const LAND_LEVY_RATE_DEFAULT = ${b.economy.landLevyRateDefault};`,
    `export const LAND_LEVY_RATE_MIN = ${b.economy.landLevyRateMin};`,
    `export const LAND_LEVY_RATE_MAX = ${b.economy.landLevyRateMax};`,
    `export const IMPORT_DUTY_RATE_DEFAULT = ${b.economy.importDutyRateDefault};`,
    `export const IMPORT_DUTY_RATE_MIN = ${b.economy.importDutyRateMin};`,
    `export const IMPORT_DUTY_RATE_MAX = ${b.economy.importDutyRateMax};`,
    `export const EXPORT_DUTY_RATE_DEFAULT = ${b.economy.exportDutyRateDefault};`,
    `export const EXPORT_DUTY_RATE_MIN = ${b.economy.exportDutyRateMin};`,
    `export const EXPORT_DUTY_RATE_MAX = ${b.economy.exportDutyRateMax};`,
    `export const LAND_LEVY_TIER1_ASSESSED_VALUE = ${b.economy.landLevyTier1AssessedValue};`,
    `export const LAND_LEVY_TIER2_ASSESSED_VALUE = ${b.economy.landLevyTier2AssessedValue};`,
    `export const LAND_LEVY_TIER3_ASSESSED_VALUE = ${b.economy.landLevyTier3AssessedValue};`,
    `export const LAND_LEVY_REFERENCE_PLOT_AREA = ${b.economy.landLevyReferencePlotArea};`,
    `export const LAND_LEVY_AREA_MULTIPLIER_MIN = ${b.economy.landLevyAreaMultiplierMin};`,
    `export const LAND_LEVY_AREA_MULTIPLIER_MAX = ${b.economy.landLevyAreaMultiplierMax};`,
    `export const LAND_LEVY_BACKYARD_MULTIPLIER = ${b.economy.landLevyBackyardMultiplier};`,
    `export const PRIVATE_EXPORT_INCOME_CART_LOAD = ${b.economy.privateExportIncomeCartLoad};`,
    '',
    `export const CARPENTER_TIMBER_PER_POLEARM = ${b.frontierEconomy.carpenterTimberPerPolearm};`,
    `export const CARPENTER_IRONWORK_PER_POLEARM = ${b.frontierEconomy.carpenterIronworkPerPolearm};`,
    `export const GUARDHOUSE_FOOD_PER_GUARD_PER_DAY = ${b.frontierEconomy.guardhouseFoodPerGuardPerDay};`,
    `export const GUARDHOUSE_WAGE_PER_GUARD_PER_DAY = ${b.frontierEconomy.guardhouseWagePerGuardPerDay};`,
    `export const GUARDHOUSE_PAYROLL_TARGET_DAYS = ${b.frontierEconomy.guardhousePayrollTargetDays};`,
    `export const GUARDHOUSE_PAYROLL_REORDER_DAYS = ${b.frontierEconomy.guardhousePayrollReorderDays};`,
    `export const GUARDHOUSE_TRAINING_PER_DAY = ${b.frontierEconomy.guardhouseTrainingPerDay};`,
    `export const GUARDHOUSE_READINESS_DECAY_PER_DAY = ${b.frontierEconomy.guardhouseReadinessDecayPerDay};`,
    `export const GUARDHOUSE_FULL_MUSTER_ROAD_DISTANCE = ${b.frontierEconomy.guardhouseFullMusterRoadDistance};`,
    `export const GUARDHOUSE_LONG_MUSTER_ROAD_DISTANCE = ${b.frontierEconomy.guardhouseLongMusterRoadDistance};`,
    `export const GUARDHOUSE_LONG_MUSTER_EFFICIENCY = ${b.frontierEconomy.guardhouseLongMusterEfficiency};`,
    `export const GUARDHOUSE_UNLINKED_MUSTER_EFFICIENCY = ${b.frontierEconomy.guardhouseUnlinkedMusterEfficiency};`,
    `export const PALISADED_REFUGE_BREACH_SECONDS = ${b.frontierEconomy.palisadedRefugeBreachSeconds};`,
    `export const PALISADED_REFUGE_RESIDENT_CAPACITY = ${b.frontierEconomy.palisadedRefugeResidentCapacity};`,
    `export const PALISADED_REFUGE_RALLY_THREAT_THRESHOLD = ${b.frontierEconomy.palisadedRefugeRallyThreatThreshold};`,
    '',
    `export const STARTING_POPULATION = ${b.population.starting};`,
    `export const POPULATION_PER_RESIDENCE = ${b.population.perResidence};`,
    `export const RESIDENCE_POPULATION_NARROW = ${b.population.residencePopulationNarrow};`,
    `export const RESIDENCE_POPULATION_WIDE = ${b.population.residencePopulationWide};`,
    `export const NARROW_PARCEL_FRONTAGE_MAX = ${b.population.narrowParcelFrontageMax};`,
    `export const WIDE_PARCEL_FRONTAGE_MIN = ${b.population.wideParcelFrontageMin};`,
    `export const RESIDENCE_FIREWOOD_CAPACITY = ${b.population.residenceFirewoodCapacity};`,
    `export const RESIDENCE_FIREWOOD_PER_PERSON_PER_SEC = ${b.population.residenceFirewoodPerPersonPerSec};`,
    `export const RESIDENCE_FIREWOOD_UNITS_PER_MONTH = ${b.population.residenceFirewoodUnitsPerMonth};`,
    `export const CHARCOAL_HOUSEHOLD_FUEL_VALUE = ${b.population.charcoalHouseholdFuelValue};`,
    `export const MARKETPLACE_FUEL_RESERVE_DAYS = ${b.population.marketplaceFuelReserveDays};`,
    `export const MARKETPLACE_FOOD_STALL_SLOTS = ${b.population.marketplaceFoodStallSlots};`,
    `export const MARKETPLACE_GOODS_STALL_SLOTS = ${b.population.marketplaceGoodsStallSlots};`,
    `export const MARKETPLACE_HOUSEHOLD_ISSUE_CHECKS_PER_DAY = ${b.population.marketplaceHouseholdIssueChecksPerDay};`,
    `export const RESIDENCE_FIREWOOD_PRIORITY_WINTER_DAYS = ${b.population.residenceFirewoodPriorityWinterDays};`,
    `export const RESIDENCE_WATER_CAPACITY = ${b.population.residenceWaterCapacity};`,
    `export const RESIDENCE_WATER_REORDER_FRACTION = ${b.population.residenceWaterReorderFraction};`,
    `export const RESIDENCE_WATER_PER_PERSON_PER_SEC = ${b.population.residenceWaterPerPersonPerSec};`,
    `export const RESIDENCE_WATER_UNITS_PER_DAY = ${b.population.residenceWaterUnitsPerDay};`,
    `export const RESIDENCE_FOOD_CAPACITY = ${b.population.residenceFoodCapacity};`,
    `export const RESIDENCE_FOOD_PER_PERSON_PER_SEC = ${b.population.residenceFoodPerPersonPerSec};`,
    `export const RESIDENCE_FOOD_UNITS_PER_SLOT_PER_MONTH = ${b.population.residenceFoodUnitsPerSlotPerMonth};`,
    `export const EVENING_MEAL_PER_PERSON = ${b.population.eveningMealPerPerson};`,
    `export const FOOD_CATEGORY_QUALIFYING_DAYS = ${b.population.foodCategoryQualifyingDays};`,
    `export const BACKYARD_FOOD_RESERVE_TIER1_DAYS = ${b.population.backyardFoodReserveTier1Days};`,
    `export const BACKYARD_FOOD_RESERVE_TIER2_DAYS = ${b.population.backyardFoodReserveTier2Days};`,
    `export const BACKYARD_FOOD_RESERVE_TIER3_DAYS = ${b.population.backyardFoodReserveTier3Days};`,
    `export const RESIDENCE_TIER1_CAPACITY = ${b.population.residenceTier1Capacity};`,
    `export const RESIDENCE_TIER2_CAPACITY = ${b.population.residenceTier2Capacity};`,
    `export const RESIDENCE_TIER3_CAPACITY = ${b.population.residenceTier3Capacity};`,
    `export const RESIDENCE_TIER4_CAPACITY = ${b.population.residenceTier4Capacity};`,
    `export const RESIDENCE_PRESERVED_FOOD_CAPACITY = ${b.population.residencePreservedFoodCapacity};`,
    `export const RESIDENCE_PRESERVED_FOOD_PER_PERSON_PER_SEC = ${b.population.residencePreservedFoodPerPersonPerSec};`,
    `export const RESIDENCE_PRESERVED_FOOD_SPRING_MULTIPLIER = ${b.population.residencePreservedFoodSpringMultiplier};`,
    `export const RESIDENCE_PRESERVED_FOOD_SUMMER_MULTIPLIER = ${b.population.residencePreservedFoodSummerMultiplier};`,
    `export const RESIDENCE_PRESERVED_FOOD_AUTUMN_MULTIPLIER = ${b.population.residencePreservedFoodAutumnMultiplier};`,
    `export const RESIDENCE_PRESERVED_FOOD_WINTER_MULTIPLIER = ${b.population.residencePreservedFoodWinterMultiplier};`,
    `export const RESIDENCE_ALE_CAPACITY = ${b.population.residenceAleCapacity};`,
    `export const RESIDENCE_ALE_PER_PERSON_PER_SEC = ${b.population.residenceAlePerPersonPerSec};`,
    `export const RESIDENCE_ALE_UNITS_PER_MONTH = ${b.population.residenceAleUnitsPerMonth};`,
    `export const RESIDENCE_CLOTH_CAPACITY = ${b.population.residenceClothCapacity};`,
    `export const RESIDENCE_CLOTH_PER_PERSON_PER_SEC = ${b.population.residenceClothPerPersonPerSec};`,
    `export const RESIDENCE_CLOTH_MONTHS_PER_UNIT = ${b.population.residenceClothMonthsPerUnit};`,
    `export const RESIDENCE_SHOES_CAPACITY = ${b.population.residenceShoesCapacity};`,
    `export const RESIDENCE_SHOES_PER_PERSON_PER_SEC = ${b.population.residenceShoesPerPersonPerSec};`,
    `export const RESIDENCE_SHOES_MONTHS_PER_UNIT = ${b.population.residenceShoesMonthsPerUnit};`,
    `export const RESIDENCE_POTTERY_CAPACITY = ${b.population.residencePotteryCapacity};`,
    `export const RESIDENCE_POTTERY_PER_PERSON_PER_SEC = ${b.population.residencePotteryPerPersonPerSec};`,
    `export const RESIDENCE_POTTERY_MONTHS_PER_UNIT = ${b.population.residencePotteryMonthsPerUnit};`,
    `export const RESIDENCE_LUXURY_CAPACITY = ${b.population.residenceLuxuryCapacity};`,
    `export const RESIDENCE_LUXURY_JAM_PER_PERSON_PER_SEC = ${b.population.residenceLuxuryJamPerPersonPerSec};`,
    `export const RESIDENCE_LUXURY_UNITS_PER_MONTH = ${b.population.residenceLuxuryUnitsPerMonth};`,
    `export const APPROVAL_BASE_SCORE = ${b.population.approvalBaseScore};`,
    `export const APPROVAL_NEED_PRESSURE_RAMP_DAYS = ${b.population.approvalNeedPressureRampDays};`,
    `export const APPROVAL_MAX_NEED_PENALTY = ${b.population.approvalMaxNeedPenalty};`,
    `export const APPROVAL_MAX_ACUTE_PENALTY = ${b.population.approvalMaxAcutePenalty};`,
    `export const APPROVAL_DECLINE_POINTS_PER_REAL_HOUR = ${b.population.approvalDeclinePointsPerRealHour};`,
    `export const HUNGER_WARNING_DAYS = ${b.population.hungerWarningDays};`,
    `export const MALNUTRITION_DAYS = ${b.population.malnutritionDays};`,
    `export const STARVATION_DEATH_START_DAYS = ${b.population.starvationDeathStartDays};`,
    `export const STARVATION_DEATH_CHANCE_PER_PERSON_DAY = ${b.population.starvationDeathChancePerPersonDay};`,
    `export const STARVATION_DEATH_MAX_CHANCE_PER_PERSON_DAY = ${b.population.starvationDeathMaxChancePerPersonDay};`,
    `export const STARVATION_DEATH_RISK_RAMP_DAYS = ${b.population.starvationDeathRiskRampDays};`,
    `export const MALNUTRITION_RECOVERY_DAYS = ${b.population.malnutritionRecoveryDays};`,
    `export const RESIDENCE_SERVICE_WARNING_DAYS = ${b.population.residenceServiceWarningDays};`,
    `export const RESIDENCE_UPGRADE_SERVICE_BLOCK_DAYS = ${b.population.residenceUpgradeServiceBlockDays};`,
    `export const BASE_ILLNESS_CHANCE_PER_PERSON_DAY = ${b.population.baseIllnessChancePerPersonDay};`,
    `export const MALNUTRITION_ILLNESS_MULTIPLIER = ${b.population.malnutritionIllnessMultiplier};`,
    `export const UNSAFE_WATER_ILLNESS_MULTIPLIER = ${b.population.unsafeWaterIllnessMultiplier};`,
    `export const COLD_EXPOSURE_ILLNESS_MULTIPLIER = ${b.population.coldExposureIllnessMultiplier};`,
    `export const COLD_EXPOSURE_WARNING_DAYS = ${b.population.coldExposureWarningDays};`,
    `export const COLD_EXPOSURE_DEATH_START_DAYS = ${b.population.coldExposureDeathStartDays};`,
    `export const COLD_EXPOSURE_DEATH_CHANCE_PER_PERSON_DAY = ${b.population.coldExposureDeathChancePerPersonDay};`,
    `export const COLD_EXPOSURE_DEATH_MAX_CHANCE_PER_PERSON_DAY = ${b.population.coldExposureDeathMaxChancePerPersonDay};`,
    `export const COLD_EXPOSURE_DEATH_RISK_RAMP_DAYS = ${b.population.coldExposureDeathRiskRampDays};`,
    `export const CORPSE_DISEASE_RADIUS = ${b.population.corpseDiseaseRadius};`,
    `export const CORPSE_ILLNESS_MULTIPLIER = ${b.population.corpseIllnessMultiplier};`,
    `export const ILLNESS_RECOVERY_DAYS = ${b.population.illnessRecoveryDays};`,
    `export const ILLNESS_MORTALITY_CHANCE_PER_SICK_DAY = ${b.population.illnessMortalityChancePerSickDay};`,
    `export const HERB_REMEDIES_PER_PERSON_DAY = ${b.population.herbRemediesPerPersonDay};`,
    `export const HERB_REMEDY_CAPACITY = ${b.population.herbRemedyCapacity};`,
    `export const HERB_TREATMENT_PER_SICK_DAY = ${b.population.herbTreatmentPerSickDay};`,
    `export const HERB_RECOVERY_MULTIPLIER = ${b.population.herbRecoveryMultiplier};`,
    `export const HERB_MORTALITY_MULTIPLIER = ${b.population.herbMortalityMultiplier};`,
    `export const GRAVEYARD_MIN_AREA = ${b.population.graveyardMinArea};`,
    `export const GRAVEYARD_MIN_EDGE = ${b.population.graveyardMinEdge};`,
    `export const GRAVEYARD_MAX_SLOPE = ${b.population.graveyardMaxSlope};`,
    `export const GRAVEYARD_MAX_DISTANCE = ${b.population.graveyardMaxDistance};`,
    `export const GRAVE_AREA_PER_BURIAL = ${b.population.graveAreaPerBurial};`,
    `export const BURIAL_CART_SPEED_MPS = ${b.population.burialCartSpeedMps};`,
    `export const RESIDENCE_RECOVERY_FIREWOOD_MIN = ${b.population.residenceRecoveryFirewoodMin};`,
    `export const RESIDENCE_RECOVERY_WATER_MIN = ${b.population.residenceRecoveryWaterMin};`,
    `export const RESIDENCE_RECOVERY_FOOD_MIN = ${b.population.residenceRecoveryFoodMin};`,
    `export const RESIDENCE_SETTLEMENT_BUFFER_DAYS = ${b.population.residenceSettlementBufferDays};`,
    `export const RESIDENCE_SETTLE_TICKS = ${b.population.residenceSettleTicks};`,
    `export const CHAPEL_SETTLEMENT_TICKS_MULTIPLIER = ${b.population.chapelSettlementTicksMultiplier};`,
    `export const CHAPEL_TITHE_GOLD_PER_PERSON_PER_DAY = ${b.population.chapelTitheGoldPerPersonPerDay};`,
    `export const CHAPEL_BASE_ATTENDANCE_CHANCE = ${b.population.chapelBaseAttendanceChance};`,
    `export const CHAPEL_PRIEST_ATTENDANCE_BONUS = ${b.population.chapelPriestAttendanceBonus};`,
    `export const CHAPEL_COMMUNITY_ATTENDANCE_BONUS = ${b.population.chapelCommunityAttendanceBonus};`,
    `export const CHAPEL_RECOVERY_STOCK_MULTIPLIER = ${b.population.chapelRecoveryStockMultiplier};`,
    `export const CHAPEL_RECOVERY_NEEDS_REQUIRED = ${b.population.chapelRecoveryNeedsRequired};`,
    `export const CHAPEL_COFFER_CAPACITY = ${b.population.chapelCofferCapacity};`,
    `export const CHAPEL_TIER1_COFFER_CAPACITY = ${b.population.chapelTier1CofferCapacity};`,
    `export const CHAPEL_TIER3_COFFER_CAPACITY = ${b.population.chapelTier3CofferCapacity};`,
    `export const CHAPEL_TIER1_TITHE_MULTIPLIER = ${b.population.chapelTier1TitheMultiplier};`,
    `export const CHAPEL_TIER2_TITHE_MULTIPLIER = ${b.population.chapelTier2TitheMultiplier};`,
    `export const CHAPEL_TIER3_TITHE_MULTIPLIER = ${b.population.chapelTier3TitheMultiplier};`,
    `export const CHAPEL_TIER2_UPGRADE_TIMBER = ${b.population.chapelTier2UpgradeTimber};`,
    `export const CHAPEL_TIER2_UPGRADE_STONE = ${b.population.chapelTier2UpgradeStone};`,
    `export const CHAPEL_TIER2_UPGRADE_IRONWORK = ${b.population.chapelTier2UpgradeIronwork};`,
    `export const CHAPEL_TIER2_UPGRADE_ROOF_TILES = ${b.population.chapelTier2UpgradeRoofTiles};`,
    `export const CHAPEL_TIER3_UPGRADE_TIMBER = ${b.population.chapelTier3UpgradeTimber};`,
    `export const CHAPEL_TIER3_UPGRADE_STONE = ${b.population.chapelTier3UpgradeStone};`,
    `export const CHAPEL_TIER3_UPGRADE_IRONWORK = ${b.population.chapelTier3UpgradeIronwork};`,
    `export const CHAPEL_TIER3_UPGRADE_ROOF_TILES = ${b.population.chapelTier3UpgradeRoofTiles};`,
    `export const CHAPEL_PRIEST_SALARY_GOLD_PER_DAY = ${b.population.chapelPriestSalaryGoldPerDay};`,
    `export const CHAPEL_UPKEEP_GOLD_PER_DAY = ${b.population.chapelUpkeepGoldPerDay};`,
    `export const CHAPEL_UNSTAFFED_UPKEEP_FRACTION = ${b.population.chapelUnstaffedUpkeepFraction};`,
    `export const CHAPEL_CHARITY_GOLD_PER_DAY = ${b.population.chapelCharityGoldPerDay};`,
    `export const CHAPEL_CHARITY_MIN_COFFER_GOLD = ${b.population.chapelCharityMinCofferGold};`,
    `export const CHAPEL_POOR_RELIEF_GOLD_PER_DISPATCH = ${b.population.chapelPoorReliefGoldPerDispatch};`,
    `export const CHAPEL_POOR_RELIEF_INTERVAL_DAYS = ${b.population.chapelPoorReliefIntervalDays};`,
    `export const CHAPEL_COFFER_RESERVE_DEFAULT = ${b.population.chapelCofferReserveDefault};`,
    `export const CHAPEL_COFFER_RESERVE_MIN = ${b.population.chapelCofferReserveMin};`,
    `export const CHAPEL_COFFER_RESERVE_MAX = ${b.population.chapelCofferReserveMax};`,
    `export const CHAPEL_SABBATH_OBSERVANCE_ATTENDANCE_BONUS = ${b.population.sabbathObservanceAttendanceBonus};`,
    `export const CHAPEL_SABBATH_OBSERVANCE_SETTLEMENT_BONUS = ${b.population.sabbathObservanceSettlementBonus};`,
    `export const MONASTERY_SETTLEMENT_TICKS_MULTIPLIER = ${b.population.monasterySettlementTicksMultiplier};`,
    `export const MONASTERY_RECOVERY_STOCK_MULTIPLIER = ${b.population.monasteryRecoveryStockMultiplier};`,
    `export const MONASTERY_ATTENDANCE_BONUS = ${b.population.monasteryAttendanceBonus};`,
    `export const MONASTERY_MIN_FOOTPRINT_SLOPE = ${b.population.monasteryMinFootprintSlope};`,
    '',
    `export const BUILDING_ROAD_ACCESS_DISTANCE = ${b.roads.buildingRoadAccessDistance};`,
    `export const BURGAGE_ROAD_FRONTAGE_DISTANCE = ${b.roads.burgageRoadFrontageDistance};`,
    `export const OFFROAD_DELIVERY_SPEED_MULTIPLIER = ${b.roads.offroadDeliverySpeedMultiplier};`,
    `export const MIN_DELIVERY_TRIP_SEC = ${b.roads.minDeliveryTripSec};`,
    `export const FIREWOOD_DELIVERY_SPEED_MPS = ${b.roads.firewoodDeliverySpeedMps};`,
    `export const WATER_DELIVERY_SPEED_MPS = ${b.roads.waterDeliverySpeedMps};`,
    `export const FOOD_DELIVERY_SPEED_MPS = ${b.roads.foodDeliverySpeedMps};`,
    `export const REMEDY_DELIVERY_SPEED_MPS = ${b.roads.remedyDeliverySpeedMps};`,
    `export const FIREWOOD_DELIVERY_UNLOAD_SEC = ${b.roads.firewoodDeliveryUnloadSec};`,
    `export const WATER_DELIVERY_UNLOAD_SEC = ${b.roads.waterDeliveryUnloadSec};`,
    `export const FOOD_DELIVERY_UNLOAD_SEC = ${b.roads.foodDeliveryUnloadSec};`,
    `export const REMEDY_DELIVERY_UNLOAD_SEC = ${b.roads.remedyDeliveryUnloadSec};`,
    `export const TIMBER_DELIVERY_SPEED_MPS = ${b.roads.timberDeliverySpeedMps};`,
    `export const TIMBER_DELIVERY_UNLOAD_SEC = ${b.roads.timberDeliveryUnloadSec};`,
    '',
    `export const CONSTRUCTION_MAX_BUILDERS = ${b.construction.maxBuilders};`,
    `export const CONSTRUCTION_WORK_PER_WORKER_PER_SEC = ${b.construction.workPerWorkerPerSecond};`,
    `export const CONSTRUCTION_HAUL_PER_WORKER = ${b.construction.haulPerWorker};`,
    `export const CONSTRUCTION_DELIVERY_SPEED_MPS = ${b.construction.deliverySpeedMps};`,
    `export const CONSTRUCTION_DELIVERY_UNLOAD_SEC = ${b.construction.deliveryUnloadSec};`,
    `export const CONSTRUCTION_TREASURY_TRANSFER_PER_SEC = ${b.construction.treasuryTransferPerSecond};`,
    '',
    `export const LARGE_QUARRY_MAX_YIELD = ${b.quarries.largeMaxYield};`,
    `export const SMALL_QUARRY_MAX_YIELD = ${b.quarries.smallMaxYield};`,
    '',
    `export const LODGE_TIMBER_PER_CYCLE = ${b.production.lodgeTimberPerCycle};`,
    `export const LODGE_TIMBER_PER_DELIVERY = ${b.production.lodgeTimberPerDelivery};`,
    `export const LODGE_FIREWOOD_PER_CYCLE = ${b.production.lodgeFirewoodPerCycle};`,
    `export const LODGE_FIREWOOD_PER_DELIVERY = ${b.production.lodgeFirewoodPerDelivery};`,
    `export const STONE_PER_HARVEST = ${b.production.stonePerHarvest};`,
    `export const GAME_ANIMALS_PER_HARVEST = ${b.production.gameAnimalsPerHarvest};`,
    `export const GAME_PER_HARVEST = ${b.production.gamePerHarvest};`,
    `export const GAME_PELTS_PER_ANIMAL = ${b.production.gamePeltsPerAnimal};`,
    `export const BERRIES_PER_HARVEST = ${b.production.berriesPerHarvest};`,
    `export const MUSHROOMS_PER_HARVEST = ${b.production.mushroomsPerHarvest};`,
    `export const FORAGER_REMEDIES_PER_HARVEST = ${b.production.foragerRemediesPerHarvest};`,
    `export const FORAGER_REMEDY_SEASON_START_MONTH = ${b.production.foragerRemedySeasonStartMonth};`,
    `export const FORAGER_REMEDY_SEASON_END_MONTH = ${b.production.foragerRemedySeasonEndMonth};`,
    `export const REMEDIES_PER_DELIVERY = ${b.production.remediesPerDelivery};`,
    `export const REMEDY_DELIVERY_TARGET_DAYS = ${b.production.remedyDeliveryTargetDays};`,
    `export const FISH_PER_HARVEST = ${b.production.fishPerHarvest};`,
    `export const RICH_GAME_YIELD_MULTIPLIER = ${b.production.richGameYieldMultiplier};`,
    `export const RICH_FISH_YIELD_MULTIPLIER = ${b.production.richFishYieldMultiplier};`,
    `export const RICH_BERRY_YIELD_MULTIPLIER = ${b.production.richBerryYieldMultiplier};`,
    `export const RICH_MUSHROOM_YIELD_MULTIPLIER = ${b.production.richMushroomYieldMultiplier};`,
    `export const FOOD_PER_DELIVERY = ${b.production.foodPerDelivery};`,
    `export const BERRIES_REGROW_PER_DAY = ${b.production.berriesRegrowPerDay};`,
    `export const MUSHROOMS_REGROW_PER_DAY = ${b.production.mushroomsRegrowPerDay};`,
    `export const MUSHROOM_AUTUMN_REGROWTH_MULTIPLIER = ${b.production.mushroomAutumnRegrowthMultiplier};`,
    `export const FISH_REPRODUCTION_RATE_PER_DAY = ${b.production.fishReproductionRatePerDay};`,
    `export const GAME_REPRODUCTION_RATE_PER_DAY = ${b.production.gameReproductionRatePerDay};`,
    `export const RICH_GAME_REGROWTH_MULTIPLIER = ${b.production.richGameRegrowthMultiplier};`,
    `export const RICH_FISH_REGROWTH_MULTIPLIER = ${b.production.richFishRegrowthMultiplier};`,
    `export const RICH_BERRY_REGROWTH_MULTIPLIER = ${b.production.richBerryRegrowthMultiplier};`,
    `export const RICH_MUSHROOM_REGROWTH_MULTIPLIER = ${b.production.richMushroomRegrowthMultiplier};`,
    `export const GAME_MIN_BREEDING_POPULATION = ${b.production.gameMinBreedingPopulation};`,
    `export const GAME_HABITAT_DISRUPTION_RADIUS = ${b.production.gameHabitatDisruptionRadius};`,
    `export const NATURAL_TREE_MATURATION_DAYS = ${b.production.naturalTreeMaturationDays};`,
    `export const REFORESTER_REGROW_PER_SEC = ${b.production.reforesterRegrowPerSec};`,
    `export const REFORESTER_SPARSE_TREE_MATURATION_WORKDAYS = ${b.production.reforesterSparseTreeMaturationWorkdays};`,
    `export const TREE_REGROWTH_UPDATE_INTERVAL_SEC = ${b.production.treeRegrowthUpdateIntervalSec};`,
    `export const WELL_BASE_REFILL_PER_SEC = ${b.production.wellBaseRefillPerSec};`,
    `export const WELL_MINIMUM_REFILL_HYDROLOGY = ${b.production.wellMinimumRefillHydrology};`,
    `export const WELL_SURGE_CHANCE_PER_TICK = ${b.production.wellSurgeChancePerTick};`,
    `export const WELL_SURGE_AMOUNT_MIN = ${b.production.wellSurgeAmountMin};`,
    `export const WELL_SURGE_AMOUNT_MAX = ${b.production.wellSurgeAmountMax};`,
    `export const WELL_SURGE_COOLDOWN_SEC = ${b.production.wellSurgeCooldownSec};`,
    `export const WELL_WATER_PER_DELIVERY = ${b.production.wellWaterPerDelivery};`,
    `export const MILL_WATER_PER_HARVEST = ${b.production.millWaterPerHarvest};`,
    `export const GRAIN_PER_FIELD_CYCLE = ${b.production.grainPerFieldCycle};`,
    `export const GRAIN_TRANSFER_PER_TRIP = ${b.production.grainTransferPerTrip};`,
    `export const THRESHING_SHEAVES_PER_CYCLE = ${b.production.threshingSheavesPerCycle};`,
    `export const THRESHING_GRAIN_PER_CYCLE = ${b.production.threshingGrainPerCycle};`,
    `export const WATERMILL_GRAIN_PER_CYCLE = ${b.production.watermillGrainPerCycle};`,
    `export const WATERMILL_WATER_PER_CYCLE = ${b.production.watermillWaterPerCycle};`,
    `export const WATERMILL_RYE_FLOUR_PER_CYCLE = ${b.production.watermillRyeFlourPerCycle};`,
    `export const WATERMILL_MASLIN_FLOUR_PER_CYCLE = ${b.production.watermillMaslinFlourPerCycle};`,
    `export const BAKERY_FLOUR_PER_CYCLE = ${b.production.bakeryFlourPerCycle};`,
    `export const BAKERY_WATER_PER_CYCLE = ${b.production.bakeryWaterPerCycle};`,
    `export const BAKERY_FIREWOOD_PER_CYCLE = ${b.production.bakeryFirewoodPerCycle};`,
    `export const BAKERY_RYE_BREAD_PER_CYCLE = ${b.production.bakeryRyeBreadPerCycle};`,
    `export const BAKERY_MASLIN_BREAD_PER_CYCLE = ${b.production.bakeryMaslinBreadPerCycle};`,
    `export const HOUSEHOLD_FOOD_RESERVE_PER_CLAIM = ${b.production.householdFoodReservePerClaim};`,
    `export const HOUSEHOLD_FOOD_RESERVE_CAPACITY_FRACTION = ${b.production.householdFoodReserveCapacityFraction};`,
    `export const BREWERY_BARLEY_PER_MALT_CYCLE = ${b.production.breweryBarleyPerMaltCycle};`,
    `export const BREWERY_MALTING_WATER_PER_CYCLE = ${b.production.breweryMaltingWaterPerCycle};`,
    `export const BREWERY_MALTING_FIREWOOD_PER_CYCLE = ${b.production.breweryMaltingFirewoodPerCycle};`,
    `export const BREWERY_MALT_PER_CYCLE = ${b.production.breweryMaltPerCycle};`,
    `export const BREWERY_MALT_PER_ALE_CYCLE = ${b.production.breweryMaltPerAleCycle};`,
    `export const BREWERY_BREWING_WATER_PER_CYCLE = ${b.production.breweryBrewingWaterPerCycle};`,
    `export const BREWERY_BREWING_FIREWOOD_PER_CYCLE = ${b.production.breweryBrewingFirewoodPerCycle};`,
    `export const BREWERY_ALE_PER_CYCLE = ${b.production.breweryAlePerCycle};`,
    `export const BREWERY_APPLES_PER_CIDER_CYCLE = ${b.production.breweryApplesPerCiderCycle};`,
    `export const BREWERY_CIDER_PER_CYCLE = ${b.production.breweryCiderPerCycle};`,
    `export const BREWERY_HONEY_PER_MEAD_CYCLE = ${b.production.breweryHoneyPerMeadCycle};`,
    `export const BREWERY_MEAD_PER_CYCLE = ${b.production.breweryMeadPerCycle};`,
    `export const SPINNING_RETTING_WOOL_PER_CYCLE = ${b.production.spinningRettingWoolPerCycle};`,
    `export const SPINNING_RETTING_FLAX_PER_CYCLE = ${b.production.spinningRettingFlaxPerCycle};`,
    `export const SPINNING_RETTING_FLAX_WATER_PER_CYCLE = ${b.production.spinningRettingFlaxWaterPerCycle};`,
    `export const SPINNING_RETTING_YARN_PER_CYCLE = ${b.production.spinningRettingYarnPerCycle};`,
    `export const SPINNING_RETTING_LINEN_PER_CYCLE = ${b.production.spinningRettingLinenPerCycle};`,
    `export const WEAVER_YARN_PER_CYCLE = ${b.production.weaverYarnPerCycle};`,
    `export const WEAVER_LINEN_PER_CYCLE = ${b.production.weaverLinenPerCycle};`,
    `export const WEAVER_CLOTH_PER_CYCLE = ${b.production.weaverClothPerCycle};`,
    `export const TEXTILE_TRANSFER_PER_TRIP = ${b.production.textileTransferPerTrip};`,
    `export const TANNERY_HIDES_PER_CYCLE = ${b.production.tanneryHidesPerCycle};`,
    `export const TANNERY_WATER_PER_CYCLE = ${b.production.tanneryWaterPerCycle};`,
    `export const TANNERY_FIREWOOD_PER_CYCLE = ${b.production.tanneryFirewoodPerCycle};`,
    `export const TANNERY_LEATHER_PER_CYCLE = ${b.production.tanneryLeatherPerCycle};`,
    `export const COBBLER_LEATHER_PER_CYCLE = ${b.production.cobblerLeatherPerCycle};`,
    `export const COBBLER_SHOES_PER_CYCLE = ${b.production.cobblerShoesPerCycle};`,
    `export const LEATHER_TRANSFER_PER_TRIP = ${b.production.leatherTransferPerTrip};`,
    `export const CHANDLERY_WAX_PER_CYCLE = ${b.production.chandleryWaxPerCycle};`,
    `export const CHANDLERY_FIREWOOD_PER_CYCLE = ${b.production.chandleryFirewoodPerCycle};`,
    `export const CHANDLERY_CANDLES_PER_CYCLE = ${b.production.chandleryCandlesPerCycle};`,
    `export const CANDLE_TRANSFER_PER_TRIP = ${b.production.candleTransferPerTrip};`,
    `export const SMOKEHOUSE_FOOD_PER_CYCLE = ${b.production.smokehouseFoodPerCycle};`,
    `export const SMOKEHOUSE_FIREWOOD_PER_CYCLE = ${b.production.smokehouseFirewoodPerCycle};`,
    `export const SMOKEHOUSE_SALT_PER_CYCLE = ${b.production.smokehouseSaltPerCycle};`,
    `export const SMOKEHOUSE_POTTERY_PER_CYCLE = ${b.production.smokehousePotteryPerCycle};`,
    `export const SMOKEHOUSE_PRESERVED_FOOD_PER_CYCLE = ${b.production.smokehousePreservedFoodPerCycle};`,
    `export const MINING_CAMP_CLAY_PER_CYCLE = ${b.production.miningCampClayPerCycle};`,
    `export const LARGE_QUARRY_TIMBER_SUPPORT_PER_CYCLE = ${b.production.largeQuarryTimberSupportPerCycle};`,
    `export const LARGE_QUARRY_TIMBER_SUPPORT_BUFFER_CYCLES = ${b.production.largeQuarryTimberSupportBufferCycles};`,
    `export const MINE_IRON_PER_CYCLE = ${b.production.mineIronPerCycle};`,
    `export const MINE_SALT_PER_CYCLE = ${b.production.mineSaltPerCycle};`,
    `export const MINE_CLAY_PER_CYCLE = ${b.production.mineClayPerCycle};`,
    `export const MINE_TIMBER_SUPPORT_PER_CYCLE = ${b.production.mineTimberSupportPerCycle};`,
    `export const MINE_TIMBER_SUPPORT_BUFFER_CYCLES = ${b.production.mineTimberSupportBufferCycles};`,
    `export const RICH_MINE_THROUGHPUT_MULTIPLIER = ${b.production.richMineThroughputMultiplier};`,
    `export const CHARCOAL_BURNER_FIREWOOD_PER_CYCLE = ${b.production.charcoalBurnerFirewoodPerCycle};`,
    `export const CHARCOAL_BURNER_CHARCOAL_PER_CYCLE = ${b.production.charcoalBurnerCharcoalPerCycle};`,
    `export const SMITHY_IRON_PER_CYCLE = ${b.production.smithyIronPerCycle};`,
    `export const SMITHY_CHARCOAL_PER_CYCLE = ${b.production.smithyCharcoalPerCycle};`,
    `export const SMITHY_WATER_PER_CYCLE = ${b.production.smithyWaterPerCycle};`,
    `export const SMITHY_IRONWORK_PER_CYCLE = ${b.production.smithyIronworkPerCycle};`,
    `export const CIVILIAN_TOOL_IRONWORK_PER_CYCLE = ${b.production.civilianToolIronworkPerCycle};`,
    `export const CIVILIAN_TOOL_REORDER_CYCLES = ${b.production.civilianToolReorderCycles};`,
    `export const CIVILIAN_TOOL_THROUGHPUT_MULTIPLIER = ${b.production.civilianToolThroughputMultiplier};`,
    `export const POTTER_CLAY_PER_CYCLE = ${b.production.potterClayPerCycle};`,
    `export const POTTER_FIREWOOD_PER_CYCLE = ${b.production.potterFirewoodPerCycle};`,
    `export const POTTER_WATER_PER_CYCLE = ${b.production.potterWaterPerCycle};`,
    `export const POTTER_POTTERY_PER_CYCLE = ${b.production.potterPotteryPerCycle};`,
    `export const POTTER_ROOF_TILES_PER_CYCLE = ${b.production.potterRoofTilesPerCycle};`,
    `export const APIARY_HONEY_PER_CYCLE = ${b.production.apiaryHoneyPerCycle};`,
    `export const APIARY_WAX_PER_HONEY_CYCLES = ${Math.max(1, Math.round(b.production.apiaryWaxPerHoneyCycles))};`,
    `export const APIARY_WAX_PER_HARVEST = ${b.production.apiaryWaxPerHarvest};`,
    `export const APIARY_SEASON_START_MONTH = ${b.production.apiarySeasonStartMonth};`,
    `export const APIARY_ACCUMULATION_END_MONTH = ${b.production.apiaryAccumulationEndMonth};`,
    `export const APIARY_HARVEST_START_MONTH = ${b.production.apiaryHarvestStartMonth};`,
    `export const APIARY_SEASON_END_MONTH = ${b.production.apiarySeasonEndMonth};`,
    `export const APIARY_WINTER_HONEY_REQUIRED = ${b.production.apiaryWinterHoneyRequired};`,
    `export const APIARY_CONSERVATIVE_HONEY_RESERVE = ${b.production.apiaryConservativeHoneyReserve};`,
    `export const APIARY_BALANCED_HONEY_RESERVE = ${b.production.apiaryBalancedHoneyReserve};`,
    `export const APIARY_EXTRACTIVE_HONEY_RESERVE = ${b.production.apiaryExtractiveHoneyReserve};`,
    `export const APIARY_CONSERVATIVE_YIELD_MULTIPLIER = ${b.production.apiaryConservativeYieldMultiplier};`,
    `export const APIARY_BALANCED_YIELD_MULTIPLIER = ${b.production.apiaryBalancedYieldMultiplier};`,
    `export const APIARY_EXTRACTIVE_YIELD_MULTIPLIER = ${b.production.apiaryExtractiveYieldMultiplier};`,
    `export const APIARY_WINTER_HEALTH_GAIN = ${b.production.apiaryWinterHealthGain};`,
    `export const APIARY_WINTER_HEALTH_LOSS = ${b.production.apiaryWinterHealthLoss};`,
    `export const APIARY_POLLINATION_BONUS_MAX = ${b.production.apiaryPollinationBonusMax};`,
    `export const BACKYARD_APIARY_POLLINATION_RADIUS = ${b.production.backyardApiaryPollinationRadius};`,
    `export const BACKYARD_APIARY_POLLINATION_CONTRIBUTION = ${b.production.backyardApiaryPollinationContribution};`,
    `export const VINEYARD_GRAPES_PER_HARVEST_CYCLE = ${b.production.vineyardGrapesPerHarvestCycle};`,
    `export const VINEYARD_GRAPES_PER_FERMENTATION_BATCH = ${b.production.vineyardGrapesPerFermentationBatch};`,
    `export const VINEYARD_WINE_PER_FERMENTATION_BATCH = ${b.production.vineyardWinePerFermentationBatch};`,
    `export const VINEYARD_FERMENTATION_SECONDS = ${b.production.vineyardFermentationSeconds};`,
    `export const VINEYARD_HARVEST_START_MONTH = ${b.production.vineyardHarvestStartMonth};`,
    `export const VINEYARD_HARVEST_END_MONTH = ${b.production.vineyardHarvestEndMonth};`,
    `export const MARKET_SPECIALTY_EXPORT_PER_BROKER_PER_SECOND = ${b.production.marketSpecialtyExportPerBrokerPerSecond};`,
    `export const MONASTERY_PILGRIMAGE_GOLD_PER_DAY = ${b.production.monasteryPilgrimageGoldPerDay};`,
    `export const MONASTERY_HOSPITALITY_BONUS_GOLD_PER_DAY = ${b.production.monasteryHospitalityBonusGoldPerDay};`,
    `export const MONASTERY_HOSPITALITY_HONEY_PER_DAY = ${b.production.monasteryHospitalityHoneyPerDay};`,
    `export const MONASTERY_HOSPITALITY_DRINK_PER_DAY = ${b.production.monasteryHospitalityDrinkPerDay};`,
    `export const MONASTERY_FEAST_FOOD = ${b.production.monasteryFeastFood};`,
    `export const MONASTERY_FEAST_DRINK = ${b.production.monasteryFeastDrink};`,
    `export const MONASTERY_FEAST_HONEY = ${b.production.monasteryFeastHoney};`,
    `export const MONASTERY_UNLINKED_PRODUCTIVITY = ${b.production.monasteryUnlinkedProductivity};`,
    `export const MONASTERY_COVERAGE_RADIUS = ${b.production.monasteryCoverageRadius};`,
    `export const MONASTERY_TITHE_SHARE_DEFAULT = ${b.production.monasteryTitheShareDefault};`,
    `export const MONASTERY_CHARITY_FOOD_PER_DELIVERY = ${b.production.monasteryCharityFoodPerDelivery};`,
    `export const SPECIALTY_EXPORT_GOLD_PER_HONEY = ${b.production.specialtyExportGoldPerHoney};`,
    `export const SPECIALTY_EXPORT_GOLD_PER_ALE = ${b.production.specialtyExportGoldPerAle};`,
    `export const SPECIALTY_EXPORT_GOLD_PER_CIDER = ${b.production.specialtyExportGoldPerCider};`,
    `export const SPECIALTY_EXPORT_GOLD_PER_WINE = ${b.production.specialtyExportGoldPerWine};`,
    `export const SPECIALTY_EXPORT_GOLD_PER_CLOTH = ${b.production.specialtyExportGoldPerCloth};`,
    `export const SPECIALTY_EXPORT_GOLD_PER_CHEESE = ${b.production.specialtyExportGoldPerCheese};`,
    `export const SPECIALTY_EXPORT_GOLD_PER_POTTERY = ${b.production.specialtyExportGoldPerPottery};`,
    `export const HERB_REMEDY_SALE_GOLD_PER_UNIT = ${b.production.herbRemedySaleGoldPerUnit};`,
    `export const CARPENTER_DELIVERY_SPEED_MULTIPLIER = ${b.production.carpenterDeliverySpeedMultiplier};`,
    `export const CARPENTER_TIMBER_COST_MULTIPLIER = ${b.production.carpenterTimberCostMultiplier};`,
    `export const CARPENTER_CART_SERVICE_TIMBER_PER_TRIP = ${b.production.carpenterCartServiceTimberPerTrip};`,
    `export const CARPENTER_CART_SERVICE_IRONWORK_PER_TRIP = ${b.production.carpenterCartServiceIronworkPerTrip};`,
    `export const CARPENTER_CART_SERVICE_TARGET_TRIPS = ${b.production.carpenterCartServiceTargetTrips};`,
    `export const STOREHOUSE_OVERFLOW_THRESHOLD = ${b.production.storehouseOverflowThreshold};`,
    `export const STOREHOUSE_HAUL_PER_WORKER = ${b.production.storehouseHaulPerWorker};`,
    `export const STOREHOUSE_FIREWOOD_PER_DELIVERY = ${b.production.storehouseFirewoodPerDelivery};`,
    `export const SMITHY_CHARCOAL_REORDER_CYCLES = ${b.production.smithyCharcoalReorderCycles};`,
    `export const SMITHY_CHARCOAL_TARGET_CYCLES = ${b.production.smithyCharcoalTargetCycles};`,
    '',
    `export const FARM_MIN_FIELD_AREA = ${b.farming.minFieldArea};`,
    `export const FARM_FIELD_SETUP_WORK_PER_STAGE = ${b.farming.fieldSetupWorkPerStage};`,
    `export const FARM_FIELD_BOUNDARY_WORK_PER_METER_PER_STAGE = ${b.farming.fieldBoundaryWorkPerMeterPerStage};`,
    `export const FARM_FIELD_TRAVEL_WORK_PER_METER_PER_STAGE = ${b.farming.fieldTravelWorkPerMeterPerStage};`,
    `export const FARM_SHARED_LABOR_MIN_PRIORITY = ${b.farming.sharedLaborMinPriority};`,
    `export const FARM_MIN_FIELD_EDGE = ${b.farming.minFieldEdge};`,
    `export const FARM_WORK_METERS_PER_WORKER_PER_SEC = ${b.farming.workMetersPerWorkerPerSec};`,
    `export const FARM_TOOL_IRONWORK_PER_WORKER_DAY = ${b.farming.farmToolIronworkPerWorkerDay};`,
    `export const FARM_OX_PLOUGH_WORKER_MULTIPLIER = ${b.farming.oxPloughWorkerMultiplier};`,
    `export const FARM_OX_HARVEST_WORKER_MULTIPLIER = ${b.farming.oxHarvestWorkerMultiplier};`,
    `export const FARM_PLOUGH_WORK_PER_SQUARE_METER = ${b.farming.ploughWorkPerSquareMeter};`,
    `export const FARM_SOW_WORK_PER_SQUARE_METER = ${b.farming.sowWorkPerSquareMeter};`,
    `export const FARM_HARVEST_WORK_PER_SQUARE_METER = ${b.farming.harvestWorkPerSquareMeter};`,
    `export const FARM_GROWTH_SECONDS = ${b.farming.growthSeconds};`,
    `export const FARM_BASE_GRAIN_PER_SQUARE_METER = ${b.farming.baseGrainPerSquareMeter};`,
    `export const FARM_REGIONAL_PRIME_CROPS_SMALL = ${b.farming.regionalPrimeCropsSmall};`,
    `export const FARM_REGIONAL_PRIME_CROPS_MEDIUM = ${b.farming.regionalPrimeCropsMedium};`,
    `export const FARM_REGIONAL_PRIME_CROPS_LARGE = ${b.farming.regionalPrimeCropsLarge};`,
    `export const FARM_REGIONAL_YIELD_FLOOR = ${b.farming.regionalYieldFloor};`,
    `export const FARM_REGIONAL_AFFINITY_FLOOR = ${b.farming.regionalAffinityFloor};`,
    `export const FARM_REGIONAL_UNREPRESENTED_CEILING = ${b.farming.regionalUnrepresentedCeiling};`,
    `export const FARM_REGIONAL_CENTER_RADIUS_RATIO = ${b.farming.regionalCenterRadiusRatio};`,
    `export const FARM_REGIONAL_CORE_RADIUS_RATIO = ${b.farming.regionalCoreRadiusRatio};`,
    `export const FARM_REGIONAL_ASPECT_RATIO = ${b.farming.regionalAspectRatio};`,
    `export const FARM_MANURE_PER_SQUARE_METER = ${b.farming.manurePerSquareMeter};`,
    `export const FARM_MANURE_FERTILITY_BONUS = ${b.farming.manureFertilityBonus};`,
    `export const FARMSTEAD_STARTER_SEED_GRAIN = ${b.farming.farmsteadStarterSeedGrain};`,
    `export const FARMSTEAD_STARTER_BARLEY_SEED = ${b.farming.farmsteadStarterBarleySeed};`,
    `export const FARM_EARLY_HARVEST_MONTH = ${b.farming.earlyHarvestMonth};`,
    `export const FARM_EARLY_HARVEST_MINIMUM_GROWTH = ${b.farming.earlyHarvestMinimumGrowth};`,
    `export const FARM_EARLY_HARVEST_RIPENESS_FACTOR = ${b.farming.earlyHarvestRipenessFactor};`,
    `export const FARM_SLOPE_PENALTY_PER_DEGREE = ${b.farming.slopePenaltyPerDegree};`,
    `export const FARM_MAX_ACCEPTED_SLOPE_DEGREES = ${b.farming.maxAcceptedSlopeDegrees};`,
    `export const FARM_FIELD_SALVAGE_FRACTION = ${b.farming.fieldSalvageFraction};`,
    '',
    `export const FARM_CROP_KINDS = ${JSON.stringify(farmCropKinds)} as const;`,
    'export type FarmCropKind = (typeof FARM_CROP_KINDS)[number];',
    "export type FarmCropProduce = 'grain' | 'barley' | 'fibre' | 'none';",
    "export type FarmWorkSeason = 'spring' | 'autumn';",
    'export type FarmCropDefinition = {',
    '  kind: FarmCropKind;',
    '  id: number;',
    '  label: string;',
    '  produce: FarmCropProduce;',
    '  workSeason: FarmWorkSeason;',
    '  seedGrainPerSquareMeter: number;',
    '  yieldMultiplier: number;',
    '  moistureIdeal: number;',
    '  moistureTolerance: number;',
    '  soilTextureIdeal: number;',
    '  soilTextureTolerance: number;',
    '  soilDepthDemand: number;',
    '  slopePenaltyMultiplier: number;',
    '  sitePreference: string;',
    '  fertilityDelta: number;',
    '  workStartMonth: number;',
    '  workEndMonth: number;',
    '  growthStartMonth: number;',
    '  growthEndMonth: number;',
    '  harvestMonth: number;',
    '  calendarLabel: string;',
    '};',
    `export const FARM_CROP_DEFINITIONS = ${JSON.stringify(farmCropDefinitions, null, 2)} as const satisfies Record<FarmCropKind, FarmCropDefinition>;`,
    '',
    `export const LIVESTOCK_MIN_PASTURE_AREA = ${b.livestock.minPastureArea};`,
    `export const LIVESTOCK_MIN_PASTURE_EDGE = ${b.livestock.minPastureEdge};`,
    `export const LIVESTOCK_PASTURE_SALVAGE_FRACTION = ${b.livestock.pastureSalvageFraction};`,
    `export const LIVESTOCK_AUTUMN_CULL_START_MONTH = ${b.livestock.autumnCullStartMonth};`,
    `export const LIVESTOCK_AUTUMN_CULL_END_MONTH = ${b.livestock.autumnCullEndMonth};`,
    `export const LIVESTOCK_WINTER_FODDER_RESERVE_DAYS = ${b.livestock.winterFodderReserveDays};`,
    `export const LIVESTOCK_HAYMAKING_START_MONTH = ${b.livestock.haymakingStartMonth};`,
    `export const LIVESTOCK_HAYMAKING_END_MONTH = ${b.livestock.haymakingEndMonth};`,
    `export const LIVESTOCK_DEFAULT_HAYMAKING_PERCENT = ${b.livestock.defaultHaymakingPercent};`,
    `export const LIVESTOCK_MAXIMUM_HAYMAKING_PERCENT = ${b.livestock.maximumHaymakingPercent};`,
    `export const LIVESTOCK_MINIMUM_BREEDING_HEADS = ${b.livestock.minimumBreedingHeads};`,
    `export const PANNAGE_SPRING_CAPACITY_MULTIPLIER = ${b.livestock.pannageSpringCapacityMultiplier};`,
    `export const PANNAGE_SUMMER_CAPACITY_MULTIPLIER = ${b.livestock.pannageSummerCapacityMultiplier};`,
    `export const PANNAGE_AUTUMN_CAPACITY_MULTIPLIER = ${b.livestock.pannageAutumnCapacityMultiplier};`,
    `export const PANNAGE_WINTER_CAPACITY_MULTIPLIER = ${b.livestock.pannageWinterCapacityMultiplier};`,
    `export const PANNAGE_DROUGHT_CAPACITY_MULTIPLIER = ${b.livestock.pannageDroughtCapacityMultiplier};`,
    `export const LIVESTOCK_FEED_OAT_GRAIN_PER_CYCLE = ${b.livestock.feedOatGrainPerCycle};`,
    `export const LIVESTOCK_ANIMAL_FEED_PER_CYCLE = ${b.livestock.animalFeedPerCycle};`,
    `export const LIVESTOCK_ANIMAL_FEED_FODDER_VALUE = ${b.livestock.animalFeedFodderValue};`,
    `export const LIVESTOCK_HAY_STORAGE_CAPACITY = ${b.livestock.hayStorageCapacity};`,
    `export const LIVESTOCK_MANURE_TRANSFER_PER_TRIP = ${b.livestock.manureTransferPerTrip};`,
    `export const LIVESTOCK_FARMSTEAD_PRESERVATION_SALT_PER_OUTPUT = ${b.livestock.farmsteadPreservationSaltPerOutput};`,
    `export const LIVESTOCK_FARMSTEAD_SALT_STAGING_PER_CYCLE = ${b.livestock.farmsteadSaltStagingPerCycle};`,
    `export const CATTLE_STARTER_HERD = ${b.livestock.cattle.starterHerd};`,
    `export const CATTLE_MAX_HERD = ${b.livestock.cattle.maxHerd};`,
    `export const CATTLE_MINIMUM_BREEDING_RESERVE = ${b.livestock.cattle.minimumBreedingReserve};`,
    `export const CATTLE_DEFAULT_BREEDING_RESERVE = ${b.livestock.cattle.defaultBreedingReserve};`,
    `export const CATTLE_PURCHASE_GOLD_PER_HEAD = ${b.livestock.cattle.purchaseGoldPerHead};`,
    `export const CATTLE_SALE_GOLD_PER_HEAD = ${b.livestock.cattle.saleGoldPerHead};`,
    `export const CATTLE_AREA_PER_HEAD = ${b.livestock.cattle.areaPerHead};`,
    `export const CATTLE_HEADS_PER_WORKER = ${b.livestock.cattle.headsPerWorker};`,
    `export const CATTLE_WATER_PER_HEAD_PER_CYCLE = ${b.livestock.cattle.waterPerHeadPerCycle};`,
    `export const CATTLE_DAIRY_PRODUCTIVE_SHARE = ${b.livestock.cattle.dairyProductiveShare};`,
    `export const CATTLE_MAX_SLOPE_DEGREES = ${b.livestock.cattle.maxSlopeDegrees ?? 0};`,
    `export const CATTLE_MOISTURE_IDEAL = ${b.livestock.cattle.moistureIdeal ?? 0};`,
    `export const CATTLE_MOISTURE_TOLERANCE = ${b.livestock.cattle.moistureTolerance ?? 1};`,
    `export const CATTLE_FOOD_PER_CYCLE_PER_HEAD = ${b.livestock.cattle.foodPerCyclePerHead};`,
    `export const CATTLE_PRESERVED_FOOD_PER_CYCLE_PER_HEAD = ${b.livestock.cattle.preservedFoodPerCyclePerHead ?? 0};`,
    `export const CATTLE_SLAUGHTER_FOOD_PER_HEAD = ${b.livestock.cattle.slaughterFoodPerHead};`,
    `export const CATTLE_SLAUGHTER_PRESERVED_FOOD_PER_HEAD = ${b.livestock.cattle.slaughterPreservedFoodPerHead};`,
    `export const CATTLE_SLAUGHTER_HIDES_PER_HEAD = ${b.livestock.cattle.slaughterHidesPerHead};`,
    `export const CATTLE_HAY_PER_UNSUPPORTED_HEAD = ${b.livestock.cattle.hayPerUnsupportedHead ?? 0};`,
    `export const CATTLE_HAY_YIELD_PER_RESERVED_CAPACITY_PER_CYCLE = ${b.livestock.cattle.hayYieldPerReservedCapacityPerCycle ?? 0};`,
    `export const CATTLE_GRAIN_PER_UNSUPPORTED_HEAD = ${b.livestock.cattle.grainPerUnsupportedHead};`,
    `export const CATTLE_BREEDING_PER_CYCLE = ${b.livestock.cattle.breedingPerCycle};`,
    `export const CATTLE_HEALTH_RECOVERY_PER_CYCLE = ${b.livestock.cattle.healthRecoveryPerCycle};`,
    `export const CATTLE_HEALTH_LOSS_PER_CYCLE = ${b.livestock.cattle.healthLossPerCycle};`,
    `export const CATTLE_MANURE_PER_SUPPLIED_HEAD_PER_CYCLE = ${b.livestock.cattle.manurePerSuppliedHeadPerCycle ?? 0};`,
    `export const CATTLE_MANURE_COLLECTION_SPRING_MULTIPLIER = ${b.livestock.cattle.manureCollectionSpringMultiplier ?? 1};`,
    `export const CATTLE_MANURE_COLLECTION_SUMMER_MULTIPLIER = ${b.livestock.cattle.manureCollectionSummerMultiplier ?? 1};`,
    `export const CATTLE_MANURE_COLLECTION_AUTUMN_MULTIPLIER = ${b.livestock.cattle.manureCollectionAutumnMultiplier ?? 1};`,
    `export const CATTLE_MANURE_COLLECTION_WINTER_MULTIPLIER = ${b.livestock.cattle.manureCollectionWinterMultiplier ?? 1};`,
    `export const CATTLE_MAX_PLOUGH_SUPPORTED_FIELDS = ${b.livestock.cattle.maxPloughSupportedFields ?? 0};`,
    `export const CATTLE_PLOUGH_WORK_MULTIPLIER = ${b.livestock.cattle.ploughWorkMultiplier ?? 1};`,
    `export const SHEEP_STARTER_HERD = ${b.livestock.sheep.starterHerd};`,
    `export const SHEEP_MAX_HERD = ${b.livestock.sheep.maxHerd};`,
    `export const SHEEP_MINIMUM_BREEDING_RESERVE = ${b.livestock.sheep.minimumBreedingReserve};`,
    `export const SHEEP_DEFAULT_BREEDING_RESERVE = ${b.livestock.sheep.defaultBreedingReserve};`,
    `export const SHEEP_PURCHASE_GOLD_PER_HEAD = ${b.livestock.sheep.purchaseGoldPerHead};`,
    `export const SHEEP_SALE_GOLD_PER_HEAD = ${b.livestock.sheep.saleGoldPerHead};`,
    `export const SHEEP_AREA_PER_HEAD = ${b.livestock.sheep.areaPerHead};`,
    `export const SHEEP_HEADS_PER_WORKER = ${b.livestock.sheep.headsPerWorker};`,
    `export const SHEEP_WATER_PER_HEAD_PER_CYCLE = ${b.livestock.sheep.waterPerHeadPerCycle};`,
    `export const SHEEP_DAIRY_PRODUCTIVE_SHARE = ${b.livestock.sheep.dairyProductiveShare};`,
    `export const SHEEP_MAX_SLOPE_DEGREES = ${b.livestock.sheep.maxSlopeDegrees ?? 0};`,
    `export const SHEEP_MOISTURE_IDEAL = ${b.livestock.sheep.moistureIdeal ?? 0};`,
    `export const SHEEP_MOISTURE_TOLERANCE = ${b.livestock.sheep.moistureTolerance ?? 1};`,
    `export const SHEEP_FOOD_PER_CYCLE_PER_HEAD = ${b.livestock.sheep.foodPerCyclePerHead};`,
    `export const SHEEP_PRESERVED_FOOD_PER_CYCLE_PER_HEAD = ${b.livestock.sheep.preservedFoodPerCyclePerHead ?? 0};`,
    `export const SHEEP_SLAUGHTER_FOOD_PER_HEAD = ${b.livestock.sheep.slaughterFoodPerHead};`,
    `export const SHEEP_SLAUGHTER_PRESERVED_FOOD_PER_HEAD = ${b.livestock.sheep.slaughterPreservedFoodPerHead};`,
    `export const SHEEP_SLAUGHTER_HIDES_PER_HEAD = ${b.livestock.sheep.slaughterHidesPerHead};`,
    `export const SHEEP_HAY_PER_UNSUPPORTED_HEAD = ${b.livestock.sheep.hayPerUnsupportedHead ?? 0};`,
    `export const SHEEP_HAY_YIELD_PER_RESERVED_CAPACITY_PER_CYCLE = ${b.livestock.sheep.hayYieldPerReservedCapacityPerCycle ?? 0};`,
    `export const SHEEP_GRAIN_PER_UNSUPPORTED_HEAD = ${b.livestock.sheep.grainPerUnsupportedHead};`,
    `export const SHEEP_WOOL_PER_SHEARING_PER_HEAD = ${b.livestock.sheep.woolPerShearingPerHead ?? 0};`,
    `export const SHEEP_SHEARING_START_MONTH = ${b.livestock.sheep.shearingStartMonth ?? 6};`,
    `export const SHEEP_SHEARING_END_MONTH = ${b.livestock.sheep.shearingEndMonth ?? 7};`,
    `export const SHEEP_BREEDING_PER_CYCLE = ${b.livestock.sheep.breedingPerCycle};`,
    `export const SHEEP_HEALTH_RECOVERY_PER_CYCLE = ${b.livestock.sheep.healthRecoveryPerCycle};`,
    `export const SHEEP_HEALTH_LOSS_PER_CYCLE = ${b.livestock.sheep.healthLossPerCycle};`,
    `export const SWINE_STARTER_HERD = ${b.livestock.swine.starterHerd};`,
    `export const SWINE_MAX_HERD = ${b.livestock.swine.maxHerd};`,
    `export const SWINE_MINIMUM_BREEDING_RESERVE = ${b.livestock.swine.minimumBreedingReserve};`,
    `export const SWINE_DEFAULT_BREEDING_RESERVE = ${b.livestock.swine.defaultBreedingReserve};`,
    `export const SWINE_PURCHASE_GOLD_PER_HEAD = ${b.livestock.swine.purchaseGoldPerHead};`,
    `export const SWINE_SALE_GOLD_PER_HEAD = ${b.livestock.swine.saleGoldPerHead};`,
    `export const SWINE_AREA_PER_HEAD = ${b.livestock.swine.areaPerHead};`,
    `export const SWINE_HEADS_PER_WORKER = ${b.livestock.swine.headsPerWorker};`,
    `export const SWINE_WATER_PER_HEAD_PER_CYCLE = ${b.livestock.swine.waterPerHeadPerCycle};`,
    `export const SWINE_DAIRY_PRODUCTIVE_SHARE = ${b.livestock.swine.dairyProductiveShare};`,
    `export const SWINE_MAX_SLOPE_DEGREES = ${b.livestock.swine.maxSlopeDegrees ?? 0};`,
    `export const SWINE_MATURE_TREES_PER_HEAD = ${b.livestock.swine.matureTreesPerHead ?? 0};`,
    `export const SWINE_FOOD_PER_CYCLE_PER_HEAD = ${b.livestock.swine.foodPerCyclePerHead};`,
    `export const SWINE_SLAUGHTER_FOOD_PER_HEAD = ${b.livestock.swine.slaughterFoodPerHead};`,
    `export const SWINE_SLAUGHTER_PRESERVED_FOOD_PER_HEAD = ${b.livestock.swine.slaughterPreservedFoodPerHead};`,
    `export const SWINE_SLAUGHTER_HIDES_PER_HEAD = ${b.livestock.swine.slaughterHidesPerHead};`,
    `export const SWINE_GRAIN_PER_UNSUPPORTED_HEAD = ${b.livestock.swine.grainPerUnsupportedHead};`,
    `export const SWINE_BREEDING_PER_CYCLE = ${b.livestock.swine.breedingPerCycle};`,
    `export const SWINE_HEALTH_RECOVERY_PER_CYCLE = ${b.livestock.swine.healthRecoveryPerCycle};`,
    `export const SWINE_HEALTH_LOSS_PER_CYCLE = ${b.livestock.swine.healthLossPerCycle};`,
    '',
    'export type BuildingResourceCost = {',
    '  timber: number;',
    '  stone: number;',
    '  ironwork?: number;',
    '  roofTiles?: number;',
    '  gold?: number;',
    '};',
    '',
    'export type StorageCaps = {',
    '  total?: number;',
    '  timber: number;',
    '  firewood: number;',
    '  stone: number;',
    '  water?: number;',
    '  food?: number;',
    '  grain?: number;',
    '  barley?: number;',
    '  malt?: number;',
    '  flax?: number;',
    '  flour?: number;',
    '  ale?: number;',
    '  cider?: number;',
    '  pearCider?: number;',
    '  mead?: number;',
    '  preservedFood?: number;',
    '  honey?: number;',
    '  wax?: number;',
    '  candles?: number;',
    '  wine?: number;',
    '  wool?: number;',
    '  yarn?: number;',
    '  linen?: number;',
    '  cloth?: number;',
    '  pelts?: number;',
    '  ironwork?: number;',
    '  polearms?: number;',
    '  sidearms?: number;',
    '  shields?: number;',
    '  bows?: number;',
    '  crossbows?: number;',
    '  paddedArmor?: number;',
    '  mailArmor?: number;',
    '  ammunition?: number;',
    '  iron?: number;',
    '  clay?: number;',
    '  salt?: number;',
    '  charcoal?: number;',
    '  pottery?: number;',
    '  hides?: number;',
    '  leather?: number;',
    '  shoes?: number;',
    '  roofTiles?: number;',
    '  manure?: number;',
    '  remedies?: number;',
    '  animalFeed?: number;',
    '};',
    '',
    'export type BuildingDefinition = {',
    '  kind: BuildingKind;',
    '  label: string;',
    '  workRadius: number;',
    '  pickRadius: number;',
    '  harvestInterval: number;',
    '  regrowRatePerSecond: number;',
    '  maxLabor: number;',
    '  acceptsLabor: boolean;',
    '  requiresRoad: boolean;',
    '  facesRoad: boolean;',
    '  requiresMatureTrees: boolean;',
    '  requiresQuarryStone: boolean;',
    '  requiresGame: boolean;',
    '  requiresBerries: boolean;',
    '  requiresFish: boolean;',
    '  requiresWaterShore: boolean;',
    '  requiresHillside: boolean;',
    '};',
    '',
    `export const BUILDING_DEFINITIONS = {`,
  ];

  for (const [kind, def] of Object.entries(b.buildings)) {
    lines.push(`  ${kind}: {`);
    lines.push(`    kind: '${kind}',`);
    lines.push(`    label: ${JSON.stringify(def.label)},`);
    lines.push(`    workRadius: ${def.workRadius},`);
    lines.push(`    pickRadius: ${def.pickRadius},`);
    lines.push(`    harvestInterval: ${def.harvestInterval},`);
    lines.push(`    regrowRatePerSecond: ${def.regrowRatePerSecond},`);
    lines.push(`    maxLabor: ${def.maxLabor},`);
    lines.push(`    acceptsLabor: ${def.acceptsLabor},`);
    lines.push(`    requiresRoad: ${def.requiresRoad},`);
    lines.push(`    facesRoad: ${def.facesRoad},`);
    lines.push(`    requiresMatureTrees: ${def.requiresMatureTrees},`);
    lines.push(`    requiresQuarryStone: ${def.requiresQuarryStone},`);
    lines.push(`    requiresGame: ${def.requiresGame},`);
    lines.push(`    requiresBerries: ${def.requiresBerries},`);
    lines.push(`    requiresFish: ${def.requiresFish ?? false},`);
    lines.push(`    requiresWaterShore: ${def.requiresWaterShore ?? false},`);
    lines.push(`    requiresHillside: ${def.requiresHillside ?? false},`);
    lines.push('  },');
  }

  lines.push('} as const satisfies Record<BuildingKind, BuildingDefinition>;');
  lines.push('');
  lines.push('export const BUILDING_COSTS = {');

  for (const [kind, def] of Object.entries(b.buildings)) {
    const ironwork = def.cost.ironwork
      ? `, ironwork: ${def.cost.ironwork}`
      : '';
    const roofTiles = def.cost.roofTiles
      ? `, roofTiles: ${def.cost.roofTiles}`
      : '';
    const gold = def.cost.gold
      ? `, gold: ${def.cost.gold}`
      : '';
    lines.push(`  ${kind}: { timber: ${def.cost.timber}, stone: ${def.cost.stone}${ironwork}${roofTiles}${gold} },`);
  }

  lines.push('} as const satisfies Record<BuildingKind, BuildingResourceCost>;');
  lines.push('');
  lines.push('export const BUILDING_STORAGE_CAPS = {');

  for (const [kind, def] of Object.entries(b.buildings)) {
    const total = def.storage.total ?? 0;
    const water = def.storage.water ?? 0;
    const food = def.storage.food ?? 0;
    const grain = def.storage.grain ?? 0;
    const barley = def.storage.barley ?? 0;
    const malt = def.storage.malt ?? 0;
    const flour = def.storage.flour ?? 0;
    const ale = def.storage.ale ?? 0;
    const cider = def.storage.cider ?? 0;
    const pearCider = def.storage.pearCider ?? 0;
    const mead = def.storage.mead ?? 0;
    const preservedFood = def.storage.preservedFood ?? 0;
    const honey = def.storage.honey ?? 0;
    const wax = def.storage.wax ?? 0;
    const candles = def.storage.candles ?? 0;
    const wine = def.storage.wine ?? 0;
    const wool = def.storage.wool ?? 0;
    const yarn = def.storage.yarn ?? 0;
    const linen = def.storage.linen ?? 0;
    const flax = def.storage.flax ?? 0;
    const cloth = def.storage.cloth ?? 0;
    const ironwork = def.storage.ironwork ?? 0;
    const polearms = def.storage.polearms ?? 0;
    const sidearms = def.storage.sidearms ?? 0;
    const shields = def.storage.shields ?? 0;
    const bows = def.storage.bows ?? 0;
    const crossbows = def.storage.crossbows ?? 0;
    const paddedArmor = def.storage.paddedArmor ?? 0;
    const mailArmor = def.storage.mailArmor ?? 0;
    const ammunition = def.storage.ammunition ?? 0;
    const iron = def.storage.iron ?? 0;
    const clay = def.storage.clay ?? 0;
    const salt = def.storage.salt ?? 0;
    const charcoal = def.storage.charcoal ?? 0;
    const pottery = def.storage.pottery ?? 0;
    const pelts = def.storage.pelts ?? 0;
    const hides = def.storage.hides ?? 0;
    const leather = def.storage.leather ?? 0;
    const shoes = def.storage.shoes ?? 0;
    const roofTiles = def.storage.roofTiles ?? 0;
    const manure = def.storage.manure ?? 0;
    const remedies = def.storage.remedies ?? 0;
    const animalFeed = def.storage.animalFeed ?? 0;
    const extras: string[] = [];
    if (total > 0) extras.push(`total: ${total}`);
    if (water > 0) extras.push(`water: ${water}`);
    if (food > 0) extras.push(`food: ${food}`);
    if (grain > 0) extras.push(`grain: ${grain}`);
    if (barley > 0) extras.push(`barley: ${barley}`);
    if (malt > 0) extras.push(`malt: ${malt}`);
    if (flour > 0) extras.push(`flour: ${flour}`);
    if (ale > 0) extras.push(`ale: ${ale}`);
    if (cider > 0) extras.push(`cider: ${cider}`);
    if (pearCider > 0) extras.push(`pearCider: ${pearCider}`);
    if (mead > 0) extras.push(`mead: ${mead}`);
    if (preservedFood > 0) extras.push(`preservedFood: ${preservedFood}`);
    if (honey > 0) extras.push(`honey: ${honey}`);
    if (wax > 0) extras.push(`wax: ${wax}`);
    if (candles > 0) extras.push(`candles: ${candles}`);
    if (wine > 0) extras.push(`wine: ${wine}`);
    if (wool > 0) extras.push(`wool: ${wool}`);
    if (yarn > 0) extras.push(`yarn: ${yarn}`);
    if (linen > 0) extras.push(`linen: ${linen}`);
    if (flax > 0) extras.push(`flax: ${flax}`);
    if (cloth > 0) extras.push(`cloth: ${cloth}`);
    if (pelts > 0) extras.push(`pelts: ${pelts}`);
    if (ironwork > 0) extras.push(`ironwork: ${ironwork}`);
    if (polearms > 0) extras.push(`polearms: ${polearms}`);
    if (sidearms > 0) extras.push(`sidearms: ${sidearms}`);
    if (shields > 0) extras.push(`shields: ${shields}`);
    if (bows > 0) extras.push(`bows: ${bows}`);
    if (crossbows > 0) extras.push(`crossbows: ${crossbows}`);
    if (paddedArmor > 0) extras.push(`paddedArmor: ${paddedArmor}`);
    if (mailArmor > 0) extras.push(`mailArmor: ${mailArmor}`);
    if (ammunition > 0) extras.push(`ammunition: ${ammunition}`);
    if (iron > 0) extras.push(`iron: ${iron}`);
    if (clay > 0) extras.push(`clay: ${clay}`);
    if (salt > 0) extras.push(`salt: ${salt}`);
    if (charcoal > 0) extras.push(`charcoal: ${charcoal}`);
    if (pottery > 0) extras.push(`pottery: ${pottery}`);
    if (hides > 0) extras.push(`hides: ${hides}`);
    if (leather > 0) extras.push(`leather: ${leather}`);
    if (shoes > 0) extras.push(`shoes: ${shoes}`);
    if (roofTiles > 0) extras.push(`roofTiles: ${roofTiles}`);
    if (manure > 0) extras.push(`manure: ${manure}`);
    if (remedies > 0) extras.push(`remedies: ${remedies}`);
    if (animalFeed > 0) extras.push(`animalFeed: ${animalFeed}`);
    lines.push(
      `  ${kind}: { timber: ${def.storage.timber}, firewood: ${def.storage.firewood}, stone: ${def.storage.stone}${extras.length > 0 ? `, ${extras.join(', ')}` : ''} },`,
    );
  }

  lines.push('} as const satisfies Record<BuildingKind, StorageCaps>;');
  lines.push('');
  lines.push(`export const BACKYARD_GARDEN_KINDS = ${JSON.stringify(backyardGardenKinds)} as const;`);
  lines.push('export type BackyardGardenKind = (typeof BACKYARD_GARDEN_KINDS)[number];');
  lines.push('');
  lines.push('export type BackyardGardenDefinition = {');
  lines.push('  kind: BackyardGardenKind;');
  lines.push('  label: string;');
  lines.push('  foodPerPersonPerSec: number;');
  lines.push('  settlementAttractionMultiplier: number;');
  lines.push('  hiddenFromPicker: boolean;');
  lines.push('  specializationOf: BackyardGardenKind | null;');
  lines.push('  firstHarvestDays: number;');
  lines.push('  gestationDays: number;');
  lines.push('  harvestStartMonth: number;');
  lines.push('  harvestEndMonth: number;');
  lines.push('  productionIntervalDays: number;');
  lines.push('  secondaryFoodPerPersonPerSec: number;');
  lines.push('  secondaryProductionIntervalDays: number;');
  lines.push('  secondaryHarvestStartMonth: number;');
  lines.push('  secondaryHarvestEndMonth: number;');
  lines.push('  hidePerPersonPerSecondaryHarvest: number;');
  lines.push('  hideCapacity: number;');
  lines.push('  waxPerSecondaryHarvest: number;');
  lines.push('  waxCapacity: number;');
  lines.push('  yieldEfficiency: number;');
  lines.push('  jamPerPersonPerSec: number;');
  lines.push('  luxuryUpgradeGoldCost: number;');
  lines.push('  goldCost: number;');
  lines.push('};');
  lines.push('');
  lines.push('export const BACKYARD_GARDEN_DEFINITIONS = {');
  for (const [kind, def] of Object.entries(b.backyardGardens)) {
    lines.push(`  ${kind}: {`);
    lines.push(`    kind: '${kind}',`);
    lines.push(`    label: ${JSON.stringify(def.label)},`);
    lines.push(`    foodPerPersonPerSec: ${def.foodPerPersonPerSec},`);
    lines.push(`    settlementAttractionMultiplier: ${def.settlementAttractionMultiplier},`);
    lines.push(`    hiddenFromPicker: ${def.hiddenFromPicker === true},`);
    lines.push(`    specializationOf: ${def.specializationOf ? `'${def.specializationOf}'` : 'null'},`);
    lines.push(`    firstHarvestDays: ${Math.max(0, Math.round(def.firstHarvestDays ?? 0))},`);
    lines.push(`    gestationDays: ${Math.max(0, Math.round(def.gestationDays ?? 0))},`);
    lines.push(`    harvestStartMonth: ${Math.max(0, Math.round(def.harvestStartMonth ?? 0))},`);
    lines.push(`    harvestEndMonth: ${Math.max(0, Math.round(def.harvestEndMonth ?? 0))},`);
    lines.push(`    productionIntervalDays: ${Math.max(0, Math.round(def.productionIntervalDays ?? 0))},`);
    lines.push(`    secondaryFoodPerPersonPerSec: ${def.secondaryFoodPerPersonPerSec ?? 0},`);
    lines.push(`    secondaryProductionIntervalDays: ${Math.max(0, Math.round(def.secondaryProductionIntervalDays ?? 0))},`);
    lines.push(`    secondaryHarvestStartMonth: ${Math.max(0, Math.round(def.secondaryHarvestStartMonth ?? 0))},`);
    lines.push(`    secondaryHarvestEndMonth: ${Math.max(0, Math.round(def.secondaryHarvestEndMonth ?? 0))},`);
    lines.push(`    hidePerPersonPerSecondaryHarvest: ${def.hidePerPersonPerSecondaryHarvest ?? 0},`);
    lines.push(`    hideCapacity: ${def.hideCapacity ?? 0},`);
    lines.push(`    waxPerSecondaryHarvest: ${def.waxPerSecondaryHarvest ?? 0},`);
    lines.push(`    waxCapacity: ${def.waxCapacity ?? 0},`);
    lines.push(`    yieldEfficiency: ${def.yieldEfficiency ?? 1},`);
    lines.push(`    jamPerPersonPerSec: ${def.jamPerPersonPerSec ?? 0},`);
    lines.push(`    luxuryUpgradeGoldCost: ${def.luxuryUpgradeGoldCost ?? 0},`);
    lines.push(`    goldCost: ${def.cost.gold},`);
    lines.push('  },');
  }
  lines.push('} as const satisfies Record<BackyardGardenKind, BackyardGardenDefinition>;');
  lines.push('');
  lines.push('export const BACKYARD_GARDEN_COSTS = {');
  for (const [kind, def] of Object.entries(b.backyardGardens)) {
    lines.push(`  ${kind}: { timber: ${def.cost.timber}, stone: ${def.cost.stone}, gold: ${def.cost.gold} },`);
  }
  lines.push('} as const satisfies Record<BackyardGardenKind, BuildingResourceCost>;');
  lines.push('');
  lines.push(...generateMarketplaceTradeTypeScript(balance));
  lines.push(...generateRegionalMarketTypeScript(balance));

  return lines.join('\n');
}

const rustOut = join(projectRoot, 'server/src/balance_generated.rs');
const tsOutDir = join(projectRoot, 'src/generated');
const tsOut = join(tsOutDir, 'gameBalance.ts');

writeFileSync(rustOut, generateRust());
execFileSync('rustfmt', ['--edition', '2021', rustOut], { stdio: 'inherit' });
mkdirSync(tsOutDir, { recursive: true });
writeFileSync(tsOut, generateTypeScript());

console.log(`Wrote ${rustOut}`);
console.log(`Wrote ${tsOut}`);
