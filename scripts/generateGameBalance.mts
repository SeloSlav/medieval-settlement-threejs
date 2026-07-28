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
  cost: { timber: number; stone: number };
  storage: {
    timber: number;
    firewood: number;
    stone: number;
    water?: number;
    food?: number;
    grain?: number;
    barley?: number;
    malt?: number;
    flour?: number;
    ale?: number;
    preservedFood?: number;
    honey?: number;
    wine?: number;
    wool?: number;
    cloth?: number;
    ironwork?: number;
    polearms?: number;
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
  cost: { timber: number; stone: number };
  foodSelfShare: number;
  foodPerPersonPerSec: number;
  goldPerPersonPerSec: number;
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
  fertilityDelta: number;
  workStartMonth: number;
  workEndMonth: number;
  growthStartMonth: number;
  growthEndMonth: number;
  calendarLabel: string;
};

type LivestockSpeciesBalance = {
  starterHerd: number;
  maxHerd: number;
  minimumBreedingReserve: number;
  defaultBreedingReserve: number;
  areaPerHead: number;
  foodPerCyclePerHead: number;
  slaughterFoodPerHead: number;
  slaughterPreservedFoodPerHead: number;
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
  fertilityBonus?: number;
  maxFertilizedFields?: number;
  ploughWorkMultiplier?: number;
  matureTreesPerHead?: number;
};

type MarketplaceGoldBuyOffer = {
  id: string;
  kind: 'goldBuy';
  resource: 'timber' | 'stone' | 'firewood' | 'food' | 'ironwork';
  amount: number;
  goldCost: number;
};

type MarketplaceGoldSellOffer = {
  id: string;
  kind: 'goldSell';
  resource: 'timber' | 'stone' | 'firewood' | 'food' | 'ironwork';
  amount: number;
  goldYield: number;
};

type MarketplaceBarterOffer = {
  id: string;
  kind: 'barter';
  give: 'timber' | 'stone' | 'firewood' | 'food' | 'ironwork';
  giveAmount: number;
  receive: 'timber' | 'stone' | 'firewood' | 'food' | 'ironwork';
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
  seasons: {
    springRainChance: number;
    springRainCropGrowthMultiplier: number;
    springRainWellRefillMultiplier: number;
    springRainRoadSpeedMultiplier: number;
    springRainWatermillThroughputMultiplier: number;
    summerDroughtChance: number;
    summerDroughtDurationDays: number;
    droughtCropGrowthMultiplier: number;
    droughtForageRegrowthMultiplier: number;
    droughtWellRefillMultiplier: number;
    droughtFishLossFractionPerDay: number;
    droughtWatermillThroughputMultiplier: number;
    springFirewoodDemandMultiplier: number;
    summerFirewoodDemandMultiplier: number;
    autumnFirewoodDemandMultiplier: number;
    winterFirewoodDemandMultiplier: number;
    springPastureCapacityMultiplier: number;
    summerPastureCapacityMultiplier: number;
    autumnPastureCapacityMultiplier: number;
    winterPastureCapacityMultiplier: number;
    droughtPastureCapacityMultiplier: number;
    springBreedingMultiplier: number;
    winterBreedingMultiplier: number;
    autumnRoadSpeedMultiplier: number;
    winterRoadSpeedMultiplier: number;
    winterWatermillThroughputMultiplier: number;
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
  };
  fires: {
    lightningIgnitionChancePerRainDay: number;
    accidentIgnitionChancePerStructureDay: number;
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
    startingGold: number;
    stoneSalvageFraction: number;
    timberSalvageFraction: number;
    goldSalvageFraction: number;
    economicActivityTaxRate: number;
    economicActivityTaxRateMin: number;
    economicActivityTaxRateMax: number;
    lowTaxProductivityBoost: number;
    highTaxProductivityDrag: number;
    foodSaleGoldPerUnit: number;
    residenceTimberCost: number;
    residenceStoneCost: number;
    residenceTier2TimberCost: number;
    residenceTier2StoneCost: number;
    residenceTier2GoldCost: number;
    residenceTier3TimberCost: number;
    residenceTier3StoneCost: number;
    residenceTier3GoldCost: number;
    householdMaxWealth: number;
    townHallPopulationRequired: number;
    townHallUnstaffedTaxCollectionMultiplier: number;
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
    residenceWaterCapacity: number;
    residenceWaterPerPersonPerSec: number;
    residenceFoodCapacity: number;
    residenceFoodPerPersonPerSec: number;
    residenceTier1Capacity: number;
    residenceTier2Capacity: number;
    residenceTier3Capacity: number;
    residencePreservedFoodCapacity: number;
    residencePreservedFoodPerPersonPerSec: number;
    residenceAleCapacity: number;
    residenceAlePerPersonPerSec: number;
    residenceClothCapacity: number;
    residenceClothPerPersonPerSec: number;
    abandonAfterDeficitTicks: number;
    residenceTier1AbandonmentGraceMultiplier: number;
    residenceTier2AbandonmentGraceMultiplier: number;
    residenceTier3AbandonmentGraceMultiplier: number;
    residenceRecoveryFirewoodMin: number;
    residenceRecoveryWaterMin: number;
    residenceRecoveryFoodMin: number;
    residenceSettleTicks: number;
    chapelSettlementTicksMultiplier: number;
    chapelAbandonmentDeficitMultiplier: number;
    chapelTitheGoldPerPersonPerDay: number;
    chapelBaseAttendanceChance: number;
    chapelPriestAttendanceBonus: number;
    chapelCommunityAttendanceBonus: number;
    chapelRecoveryStockMultiplier: number;
    chapelRecoveryNeedsRequired: number;
    chapelCofferCapacity: number;
    chapelPriestSalaryGoldPerDay: number;
    chapelUpkeepGoldPerDay: number;
    chapelUnstaffedUpkeepFraction: number;
    chapelCharityGoldPerDay: number;
    chapelCharityMinCofferGold: number;
    chapelPoorReliefGoldPerDispatch: number;
    chapelPoorReliefIntervalDays: number;
    chapelAutoSweepIntervalTicks: number;
    chapelAutoSweepFraction: number;
    chapelCofferReserveDefault: number;
    chapelCofferReserveMin: number;
    chapelCofferReserveMax: number;
    sabbathObservanceAttendanceBonus: number;
    sabbathObservanceSettlementBonus: number;
    monasterySettlementTicksMultiplier: number;
    monasteryAbandonmentDeficitMultiplier: number;
    monasteryRecoveryStockMultiplier: number;
    monasteryAttendanceBonus: number;
    monasteryMinFootprintSlope: number;
  };
  roads: {
    buildingRoadAccessDistance: number;
    burgageRoadFrontageDistance: number;
    minDeliveryTripSec: number;
    firewoodDeliverySpeedMps: number;
    waterDeliverySpeedMps: number;
    foodDeliverySpeedMps: number;
    firewoodDeliveryUnloadSec: number;
    waterDeliveryUnloadSec: number;
    foodDeliveryUnloadSec: number;
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
    berriesPerHarvest: number;
    mushroomsPerHarvest: number;
    fishPerHarvest: number;
    richFishYieldMultiplier: number;
    foodPerDelivery: number;
    berriesRegrowPerDay: number;
    mushroomsRegrowPerDay: number;
    fishReproductionRatePerDay: number;
    gameReproductionRatePerDay: number;
    gameMinBreedingPopulation: number;
    gameHabitatDisruptionRadius: number;
    reforesterRegrowPerSec: number;
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
    watermillGrainPerCycle: number;
    watermillWaterPerCycle: number;
    watermillFlourPerCycle: number;
    granaryFlourPerCycle: number;
    granaryWaterPerCycle: number;
    granaryFirewoodPerCycle: number;
    granaryFoodPerCycle: number;
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
    weaverWoolPerCycle: number;
    weaverClothPerCycle: number;
    textileTransferPerTrip: number;
    smokehouseFoodPerCycle: number;
    smokehouseFirewoodPerCycle: number;
    smokehousePreservedFoodPerCycle: number;
    apiaryHoneyPerCycle: number;
    apiaryFoodPerCycle: number;
    apiarySeasonStartMonth: number;
    apiarySeasonEndMonth: number;
    vineyardWinePerCycle: number;
    vineyardFoodPerCycle: number;
    vineyardHarvestStartMonth: number;
    vineyardHarvestEndMonth: number;
    marketSpecialtyExportPerBrokerPerSecond: number;
    monasteryGrainPerCycle: number;
    monasteryFoodPerCycle: number;
    monasteryPilgrimageGoldPerDay: number;
    monasteryHospitalityBonusGoldPerDay: number;
    monasteryHospitalityHoneyPerDay: number;
    monasteryHospitalityWinePerDay: number;
    monasteryFeastFood: number;
    monasteryFeastAle: number;
    monasteryFeastHoney: number;
    monasteryFeastWine: number;
    monasteryUnlinkedProductivity: number;
    monasteryCoverageRadius: number;
    monasteryTitheShareDefault: number;
    monasteryCharityFoodPerDelivery: number;
    specialtyExportGoldPerHoney: number;
    specialtyExportGoldPerAle: number;
    specialtyExportGoldPerWine: number;
    specialtyExportGoldPerCloth: number;
    ferryGoldPerDay: number;
    carpenterDeliverySpeedMultiplier: number;
    carpenterTimberCostMultiplier: number;
    storehouseOverflowThreshold: number;
    storehouseHaulPerWorker: number;
    storehouseFirewoodPerDelivery: number;
  };
  farming: {
    minFieldArea: number;
    optimalFieldArea: number;
    largeFieldEfficiencyExponent: number;
    largeFieldEfficiencyFloor: number;
    minFieldEdge: number;
    workMetersPerWorkerPerSec: number;
    ploughWorkPerSquareMeter: number;
    sowWorkPerSquareMeter: number;
    harvestWorkPerSquareMeter: number;
    growthSeconds: number;
    baseGrainPerSquareMeter: number;
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
    hayStorageCapacity: number;
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
  woodcutters_lodge: 'WoodcuttersLodge',
  well: 'Well',
  hunters_hall: 'HuntersHall',
  foragers_shed: 'ForagersShed',
  fishing_camp: 'FishingCamp',
  chapel: null,
  marketplace: null,
  town_hall: null,
  village_storehouse: 'VillageStorehouse',
  watchtower: null,
  guardhouse: 'Guardhouse',
  threshing_barn: 'ThreshingBarn',
  monastery: 'Monastery',
  brewery: 'Brewery',
  smokehouse: 'Smokehouse',
  granary: 'Granary',
  apiary: 'Apiary',
  watermill: 'Watermill',
  carpenter: 'Carpenter',
  weaver: 'Weaver',
  ferry_landing: 'FerryLanding',
  vineyard: 'Vineyard',
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
    '',
    `pub const SPRING_RAIN_CHANCE: f64 = ${rustF64(b.seasons.springRainChance)};`,
    `pub const SPRING_RAIN_CROP_GROWTH_MULTIPLIER: f64 = ${rustF64(b.seasons.springRainCropGrowthMultiplier)};`,
    `pub const SPRING_RAIN_WELL_REFILL_MULTIPLIER: f64 = ${rustF64(b.seasons.springRainWellRefillMultiplier)};`,
    `pub const SPRING_RAIN_ROAD_SPEED_MULTIPLIER: f64 = ${rustF64(b.seasons.springRainRoadSpeedMultiplier)};`,
    `pub const SPRING_RAIN_WATERMILL_THROUGHPUT_MULTIPLIER: f64 = ${rustF64(b.seasons.springRainWatermillThroughputMultiplier)};`,
    `pub const SUMMER_DROUGHT_CHANCE: f64 = ${rustF64(b.seasons.summerDroughtChance)};`,
    `pub const SUMMER_DROUGHT_DURATION_DAYS: u32 = ${b.seasons.summerDroughtDurationDays};`,
    `pub const DROUGHT_CROP_GROWTH_MULTIPLIER: f64 = ${rustF64(b.seasons.droughtCropGrowthMultiplier)};`,
    `pub const DROUGHT_FORAGE_REGROWTH_MULTIPLIER: f64 = ${rustF64(b.seasons.droughtForageRegrowthMultiplier)};`,
    `pub const DROUGHT_WELL_REFILL_MULTIPLIER: f64 = ${rustF64(b.seasons.droughtWellRefillMultiplier)};`,
    `pub const DROUGHT_FISH_LOSS_FRACTION_PER_DAY: f64 = ${rustF64(b.seasons.droughtFishLossFractionPerDay)};`,
    `pub const DROUGHT_WATERMILL_THROUGHPUT_MULTIPLIER: f64 = ${rustF64(b.seasons.droughtWatermillThroughputMultiplier)};`,
    `pub const SPRING_FIREWOOD_DEMAND_MULTIPLIER: f64 = ${rustF64(b.seasons.springFirewoodDemandMultiplier)};`,
    `pub const SUMMER_FIREWOOD_DEMAND_MULTIPLIER: f64 = ${rustF64(b.seasons.summerFirewoodDemandMultiplier)};`,
    `pub const AUTUMN_FIREWOOD_DEMAND_MULTIPLIER: f64 = ${rustF64(b.seasons.autumnFirewoodDemandMultiplier)};`,
    `pub const WINTER_FIREWOOD_DEMAND_MULTIPLIER: f64 = ${rustF64(b.seasons.winterFirewoodDemandMultiplier)};`,
    `pub const SPRING_PASTURE_CAPACITY_MULTIPLIER: f64 = ${rustF64(b.seasons.springPastureCapacityMultiplier)};`,
    `pub const SUMMER_PASTURE_CAPACITY_MULTIPLIER: f64 = ${rustF64(b.seasons.summerPastureCapacityMultiplier)};`,
    `pub const AUTUMN_PASTURE_CAPACITY_MULTIPLIER: f64 = ${rustF64(b.seasons.autumnPastureCapacityMultiplier)};`,
    `pub const WINTER_PASTURE_CAPACITY_MULTIPLIER: f64 = ${rustF64(b.seasons.winterPastureCapacityMultiplier)};`,
    `pub const DROUGHT_PASTURE_CAPACITY_MULTIPLIER: f64 = ${rustF64(b.seasons.droughtPastureCapacityMultiplier)};`,
    `pub const SPRING_BREEDING_MULTIPLIER: f64 = ${rustF64(b.seasons.springBreedingMultiplier)};`,
    `pub const WINTER_BREEDING_MULTIPLIER: f64 = ${rustF64(b.seasons.winterBreedingMultiplier)};`,
    `pub const AUTUMN_ROAD_SPEED_MULTIPLIER: f64 = ${rustF64(b.seasons.autumnRoadSpeedMultiplier)};`,
    `pub const WINTER_ROAD_SPEED_MULTIPLIER: f64 = ${rustF64(b.seasons.winterRoadSpeedMultiplier)};`,
    `pub const WINTER_WATERMILL_THROUGHPUT_MULTIPLIER: f64 = ${rustF64(b.seasons.winterWatermillThroughputMultiplier)};`,
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
    '',
    `pub const FIRE_LIGHTNING_IGNITION_CHANCE_PER_RAIN_DAY: f64 = ${rustF64(b.fires.lightningIgnitionChancePerRainDay)};`,
    `pub const FIRE_ACCIDENT_IGNITION_CHANCE_PER_STRUCTURE_DAY: f64 = ${rustF64(b.fires.accidentIgnitionChancePerStructureDay)};`,
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
    `pub const STARTING_GOLD: f64 = ${rustF64(b.economy.startingGold)};`,
    `pub const STONE_SALVAGE_FRACTION: f64 = ${rustF64(b.economy.stoneSalvageFraction)};`,
    `pub const TIMBER_SALVAGE_FRACTION: f64 = ${rustF64(b.economy.timberSalvageFraction)};`,
    `pub const GOLD_SALVAGE_FRACTION: f64 = ${rustF64(b.economy.goldSalvageFraction)};`,
    `pub const ECONOMIC_ACTIVITY_TAX_RATE: f64 = ${rustF64(b.economy.economicActivityTaxRate)};`,
    `pub const ECONOMIC_ACTIVITY_TAX_RATE_MIN: f64 = ${rustF64(b.economy.economicActivityTaxRateMin)};`,
    `pub const ECONOMIC_ACTIVITY_TAX_RATE_MAX: f64 = ${rustF64(b.economy.economicActivityTaxRateMax)};`,
    `pub const LOW_TAX_PRODUCTIVITY_BOOST: f64 = ${rustF64(b.economy.lowTaxProductivityBoost)};`,
    `pub const HIGH_TAX_PRODUCTIVITY_DRAG: f64 = ${rustF64(b.economy.highTaxProductivityDrag)};`,
    `pub const FOOD_SALE_GOLD_PER_UNIT: f64 = ${rustF64(b.economy.foodSaleGoldPerUnit)};`,
    `pub const RESIDENCE_TIMBER_COST: f64 = ${rustF64(b.economy.residenceTimberCost)};`,
    `pub const RESIDENCE_STONE_COST: f64 = ${rustF64(b.economy.residenceStoneCost)};`,
    `pub const RESIDENCE_TIER2_TIMBER_COST: f64 = ${rustF64(b.economy.residenceTier2TimberCost)};`,
    `pub const RESIDENCE_TIER2_STONE_COST: f64 = ${rustF64(b.economy.residenceTier2StoneCost)};`,
    `pub const RESIDENCE_TIER2_GOLD_COST: f64 = ${rustF64(b.economy.residenceTier2GoldCost)};`,
    `pub const RESIDENCE_TIER3_TIMBER_COST: f64 = ${rustF64(b.economy.residenceTier3TimberCost)};`,
    `pub const RESIDENCE_TIER3_STONE_COST: f64 = ${rustF64(b.economy.residenceTier3StoneCost)};`,
    `pub const RESIDENCE_TIER3_GOLD_COST: f64 = ${rustF64(b.economy.residenceTier3GoldCost)};`,
    `pub const HOUSEHOLD_MAX_WEALTH: f64 = ${rustF64(b.economy.householdMaxWealth)};`,
    `pub const TOWN_HALL_POPULATION_REQUIRED: u32 = ${b.economy.townHallPopulationRequired};`,
    `pub const TOWN_HALL_UNSTAFFED_TAX_COLLECTION_MULTIPLIER: f64 = ${rustF64(b.economy.townHallUnstaffedTaxCollectionMultiplier)};`,
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
    '',
    `pub const STARTING_POPULATION: u32 = ${b.population.starting};`,
    `pub const POPULATION_PER_RESIDENCE: u32 = ${b.population.perResidence};`,
    `pub const RESIDENCE_POPULATION_NARROW: u32 = ${b.population.residencePopulationNarrow};`,
    `pub const RESIDENCE_POPULATION_WIDE: u32 = ${b.population.residencePopulationWide};`,
    `pub const NARROW_PARCEL_FRONTAGE_MAX: f64 = ${rustF64(b.population.narrowParcelFrontageMax)};`,
    `pub const WIDE_PARCEL_FRONTAGE_MIN: f64 = ${rustF64(b.population.wideParcelFrontageMin)};`,
    `pub const RESIDENCE_FIREWOOD_CAPACITY: f64 = ${rustF64(b.population.residenceFirewoodCapacity)};`,
    `pub const RESIDENCE_FIREWOOD_PER_PERSON_PER_SEC: f64 = ${rustF64(b.population.residenceFirewoodPerPersonPerSec)};`,
    `pub const RESIDENCE_WATER_CAPACITY: f64 = ${rustF64(b.population.residenceWaterCapacity)};`,
    `pub const RESIDENCE_WATER_PER_PERSON_PER_SEC: f64 = ${rustF64(b.population.residenceWaterPerPersonPerSec)};`,
    `pub const RESIDENCE_FOOD_CAPACITY: f64 = ${rustF64(b.population.residenceFoodCapacity)};`,
    `pub const RESIDENCE_FOOD_PER_PERSON_PER_SEC: f64 = ${rustF64(b.population.residenceFoodPerPersonPerSec)};`,
    `pub const RESIDENCE_TIER1_CAPACITY: u32 = ${b.population.residenceTier1Capacity};`,
    `pub const RESIDENCE_TIER2_CAPACITY: u32 = ${b.population.residenceTier2Capacity};`,
    `pub const RESIDENCE_TIER3_CAPACITY: u32 = ${b.population.residenceTier3Capacity};`,
    `pub const RESIDENCE_PRESERVED_FOOD_CAPACITY: f64 = ${rustF64(b.population.residencePreservedFoodCapacity)};`,
    `pub const RESIDENCE_PRESERVED_FOOD_PER_PERSON_PER_SEC: f64 = ${rustF64(b.population.residencePreservedFoodPerPersonPerSec)};`,
    `pub const RESIDENCE_ALE_CAPACITY: f64 = ${rustF64(b.population.residenceAleCapacity)};`,
    `pub const RESIDENCE_ALE_PER_PERSON_PER_SEC: f64 = ${rustF64(b.population.residenceAlePerPersonPerSec)};`,
    `pub const RESIDENCE_CLOTH_CAPACITY: f64 = ${rustF64(b.population.residenceClothCapacity)};`,
    `pub const RESIDENCE_CLOTH_PER_PERSON_PER_SEC: f64 = ${rustF64(b.population.residenceClothPerPersonPerSec)};`,
    `pub const ABANDON_AFTER_DEFICIT_TICKS: u32 = ${b.population.abandonAfterDeficitTicks};`,
    `pub const RESIDENCE_TIER1_ABANDONMENT_GRACE_MULTIPLIER: f64 = ${rustF64(b.population.residenceTier1AbandonmentGraceMultiplier)};`,
    `pub const RESIDENCE_TIER2_ABANDONMENT_GRACE_MULTIPLIER: f64 = ${rustF64(b.population.residenceTier2AbandonmentGraceMultiplier)};`,
    `pub const RESIDENCE_TIER3_ABANDONMENT_GRACE_MULTIPLIER: f64 = ${rustF64(b.population.residenceTier3AbandonmentGraceMultiplier)};`,
    `pub const RESIDENCE_RECOVERY_FIREWOOD_MIN: f64 = ${rustF64(b.population.residenceRecoveryFirewoodMin)};`,
    `pub const RESIDENCE_RECOVERY_WATER_MIN: f64 = ${rustF64(b.population.residenceRecoveryWaterMin)};`,
    `pub const RESIDENCE_RECOVERY_FOOD_MIN: f64 = ${rustF64(b.population.residenceRecoveryFoodMin)};`,
    `pub const RESIDENCE_SETTLE_TICKS: u32 = ${b.population.residenceSettleTicks};`,
    `pub const CHAPEL_SETTLEMENT_TICKS_MULTIPLIER: f64 = ${rustF64(b.population.chapelSettlementTicksMultiplier)};`,
    `pub const CHAPEL_ABANDONMENT_DEFICIT_MULTIPLIER: f64 = ${rustF64(b.population.chapelAbandonmentDeficitMultiplier)};`,
    `pub const CHAPEL_TITHE_GOLD_PER_PERSON_PER_DAY: f64 = ${rustF64(b.population.chapelTitheGoldPerPersonPerDay)};`,
    `pub const CHAPEL_BASE_ATTENDANCE_CHANCE: f64 = ${rustF64(b.population.chapelBaseAttendanceChance)};`,
    `pub const CHAPEL_PRIEST_ATTENDANCE_BONUS: f64 = ${rustF64(b.population.chapelPriestAttendanceBonus)};`,
    `pub const CHAPEL_COMMUNITY_ATTENDANCE_BONUS: f64 = ${rustF64(b.population.chapelCommunityAttendanceBonus)};`,
    `pub const CHAPEL_RECOVERY_STOCK_MULTIPLIER: f64 = ${rustF64(b.population.chapelRecoveryStockMultiplier)};`,
    `pub const CHAPEL_RECOVERY_NEEDS_REQUIRED: u32 = ${b.population.chapelRecoveryNeedsRequired};`,
    `pub const CHAPEL_COFFER_CAPACITY: f64 = ${rustF64(b.population.chapelCofferCapacity)};`,
    `pub const CHAPEL_PRIEST_SALARY_GOLD_PER_DAY: f64 = ${rustF64(b.population.chapelPriestSalaryGoldPerDay)};`,
    `pub const CHAPEL_UPKEEP_GOLD_PER_DAY: f64 = ${rustF64(b.population.chapelUpkeepGoldPerDay)};`,
    `pub const CHAPEL_UNSTAFFED_UPKEEP_FRACTION: f64 = ${rustF64(b.population.chapelUnstaffedUpkeepFraction)};`,
    `pub const CHAPEL_CHARITY_GOLD_PER_DAY: f64 = ${rustF64(b.population.chapelCharityGoldPerDay)};`,
    `pub const CHAPEL_CHARITY_MIN_COFFER_GOLD: f64 = ${rustF64(b.population.chapelCharityMinCofferGold)};`,
    `pub const CHAPEL_POOR_RELIEF_GOLD_PER_DISPATCH: f64 = ${rustF64(b.population.chapelPoorReliefGoldPerDispatch)};`,
    `pub const CHAPEL_POOR_RELIEF_INTERVAL_DAYS: u64 = ${b.population.chapelPoorReliefIntervalDays};`,
    `pub const CHAPEL_AUTO_SWEEP_INTERVAL_TICKS: u64 = ${b.population.chapelAutoSweepIntervalTicks};`,
    `pub const CHAPEL_AUTO_SWEEP_FRACTION: f64 = ${rustF64(b.population.chapelAutoSweepFraction)};`,
    `pub const CHAPEL_COFFER_RESERVE_DEFAULT: f64 = ${rustF64(b.population.chapelCofferReserveDefault)};`,
    `pub const CHAPEL_COFFER_RESERVE_MIN: f64 = ${rustF64(b.population.chapelCofferReserveMin)};`,
    `pub const CHAPEL_COFFER_RESERVE_MAX: f64 = ${rustF64(b.population.chapelCofferReserveMax)};`,
    `pub const CHAPEL_SABBATH_OBSERVANCE_ATTENDANCE_BONUS: f64 = ${rustF64(b.population.sabbathObservanceAttendanceBonus)};`,
    `pub const CHAPEL_SABBATH_OBSERVANCE_SETTLEMENT_BONUS: f64 = ${rustF64(b.population.sabbathObservanceSettlementBonus)};`,
    `pub const MONASTERY_SETTLEMENT_TICKS_MULTIPLIER: f64 = ${rustF64(b.population.monasterySettlementTicksMultiplier)};`,
    `pub const MONASTERY_ABANDONMENT_DEFICIT_MULTIPLIER: f64 = ${rustF64(b.population.monasteryAbandonmentDeficitMultiplier)};`,
    `pub const MONASTERY_RECOVERY_STOCK_MULTIPLIER: f64 = ${rustF64(b.population.monasteryRecoveryStockMultiplier)};`,
    `pub const MONASTERY_ATTENDANCE_BONUS: f64 = ${rustF64(b.population.monasteryAttendanceBonus)};`,
    `pub const MONASTERY_MIN_FOOTPRINT_SLOPE: f64 = ${rustF64(b.population.monasteryMinFootprintSlope)};`,
    '',
    `pub const BUILDING_ROAD_ACCESS_DISTANCE: f64 = ${rustF64(b.roads.buildingRoadAccessDistance)};`,
    `pub const BURGAGE_ROAD_FRONTAGE_DISTANCE: f64 = ${rustF64(b.roads.burgageRoadFrontageDistance)};`,
    `pub const MIN_DELIVERY_TRIP_SEC: f64 = ${rustF64(b.roads.minDeliveryTripSec)};`,
    `pub const FIREWOOD_DELIVERY_SPEED_MPS: f64 = ${rustF64(b.roads.firewoodDeliverySpeedMps)};`,
    `pub const WATER_DELIVERY_SPEED_MPS: f64 = ${rustF64(b.roads.waterDeliverySpeedMps)};`,
    `pub const FOOD_DELIVERY_SPEED_MPS: f64 = ${rustF64(b.roads.foodDeliverySpeedMps)};`,
    `pub const FIREWOOD_DELIVERY_UNLOAD_SEC: f64 = ${rustF64(b.roads.firewoodDeliveryUnloadSec)};`,
    `pub const WATER_DELIVERY_UNLOAD_SEC: f64 = ${rustF64(b.roads.waterDeliveryUnloadSec)};`,
    `pub const FOOD_DELIVERY_UNLOAD_SEC: f64 = ${rustF64(b.roads.foodDeliveryUnloadSec)};`,
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
    `pub const BERRIES_PER_HARVEST: f64 = ${rustF64(b.production.berriesPerHarvest)};`,
    `pub const MUSHROOMS_PER_HARVEST: f64 = ${rustF64(b.production.mushroomsPerHarvest)};`,
    `pub const FISH_PER_HARVEST: f64 = ${rustF64(b.production.fishPerHarvest)};`,
    `pub const RICH_FISH_YIELD_MULTIPLIER: f64 = ${rustF64(b.production.richFishYieldMultiplier)};`,
    `pub const FOOD_PER_DELIVERY: f64 = ${rustF64(b.production.foodPerDelivery)};`,
    `pub const BERRIES_REGROW_PER_DAY: f64 = ${rustF64(b.production.berriesRegrowPerDay)};`,
    `pub const MUSHROOMS_REGROW_PER_DAY: f64 = ${rustF64(b.production.mushroomsRegrowPerDay)};`,
    `pub const FISH_REPRODUCTION_RATE_PER_DAY: f64 = ${rustF64(b.production.fishReproductionRatePerDay)};`,
    `pub const GAME_REPRODUCTION_RATE_PER_DAY: f64 = ${rustF64(b.production.gameReproductionRatePerDay)};`,
    `pub const GAME_MIN_BREEDING_POPULATION: f64 = ${rustF64(b.production.gameMinBreedingPopulation)};`,
    `pub const GAME_HABITAT_DISRUPTION_RADIUS: f64 = ${rustF64(b.production.gameHabitatDisruptionRadius)};`,
    `pub const REFORESTER_REGROW_PER_SEC: f64 = ${rustF64(b.production.reforesterRegrowPerSec)};`,
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
    `pub const WATERMILL_GRAIN_PER_CYCLE: f64 = ${rustF64(b.production.watermillGrainPerCycle)};`,
    `pub const WATERMILL_WATER_PER_CYCLE: f64 = ${rustF64(b.production.watermillWaterPerCycle)};`,
    `pub const WATERMILL_FLOUR_PER_CYCLE: f64 = ${rustF64(b.production.watermillFlourPerCycle)};`,
    `pub const GRANARY_FLOUR_PER_CYCLE: f64 = ${rustF64(b.production.granaryFlourPerCycle)};`,
    `pub const GRANARY_WATER_PER_CYCLE: f64 = ${rustF64(b.production.granaryWaterPerCycle)};`,
    `pub const GRANARY_FIREWOOD_PER_CYCLE: f64 = ${rustF64(b.production.granaryFirewoodPerCycle)};`,
    `pub const GRANARY_FOOD_PER_CYCLE: f64 = ${rustF64(b.production.granaryFoodPerCycle)};`,
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
    `pub const WEAVER_WOOL_PER_CYCLE: f64 = ${rustF64(b.production.weaverWoolPerCycle)};`,
    `pub const WEAVER_CLOTH_PER_CYCLE: f64 = ${rustF64(b.production.weaverClothPerCycle)};`,
    `pub const TEXTILE_TRANSFER_PER_TRIP: f64 = ${rustF64(b.production.textileTransferPerTrip)};`,
    `pub const SMOKEHOUSE_FOOD_PER_CYCLE: f64 = ${rustF64(b.production.smokehouseFoodPerCycle)};`,
    `pub const SMOKEHOUSE_FIREWOOD_PER_CYCLE: f64 = ${rustF64(b.production.smokehouseFirewoodPerCycle)};`,
    `pub const SMOKEHOUSE_PRESERVED_FOOD_PER_CYCLE: f64 = ${rustF64(b.production.smokehousePreservedFoodPerCycle)};`,
    `pub const APIARY_HONEY_PER_CYCLE: f64 = ${rustF64(b.production.apiaryHoneyPerCycle)};`,
    `pub const APIARY_FOOD_PER_CYCLE: f64 = ${rustF64(b.production.apiaryFoodPerCycle)};`,
    `pub const APIARY_SEASON_START_MONTH: u8 = ${b.production.apiarySeasonStartMonth};`,
    `pub const APIARY_SEASON_END_MONTH: u8 = ${b.production.apiarySeasonEndMonth};`,
    `pub const VINEYARD_WINE_PER_CYCLE: f64 = ${rustF64(b.production.vineyardWinePerCycle)};`,
    `pub const VINEYARD_FOOD_PER_CYCLE: f64 = ${rustF64(b.production.vineyardFoodPerCycle)};`,
    `pub const VINEYARD_HARVEST_START_MONTH: u8 = ${b.production.vineyardHarvestStartMonth};`,
    `pub const VINEYARD_HARVEST_END_MONTH: u8 = ${b.production.vineyardHarvestEndMonth};`,
    `pub const MARKET_SPECIALTY_EXPORT_PER_BROKER_PER_SECOND: f64 = ${rustF64(b.production.marketSpecialtyExportPerBrokerPerSecond)};`,
    `pub const MONASTERY_GRAIN_PER_CYCLE: f64 = ${rustF64(b.production.monasteryGrainPerCycle)};`,
    `pub const MONASTERY_FOOD_PER_CYCLE: f64 = ${rustF64(b.production.monasteryFoodPerCycle)};`,
    `pub const MONASTERY_PILGRIMAGE_GOLD_PER_DAY: f64 = ${rustF64(b.production.monasteryPilgrimageGoldPerDay)};`,
    `pub const MONASTERY_HOSPITALITY_BONUS_GOLD_PER_DAY: f64 = ${rustF64(b.production.monasteryHospitalityBonusGoldPerDay)};`,
    `pub const MONASTERY_HOSPITALITY_HONEY_PER_DAY: f64 = ${rustF64(b.production.monasteryHospitalityHoneyPerDay)};`,
    `pub const MONASTERY_HOSPITALITY_WINE_PER_DAY: f64 = ${rustF64(b.production.monasteryHospitalityWinePerDay)};`,
    `pub const MONASTERY_FEAST_FOOD: f64 = ${rustF64(b.production.monasteryFeastFood)};`,
    `pub const MONASTERY_FEAST_ALE: f64 = ${rustF64(b.production.monasteryFeastAle)};`,
    `pub const MONASTERY_FEAST_HONEY: f64 = ${rustF64(b.production.monasteryFeastHoney)};`,
    `pub const MONASTERY_FEAST_WINE: f64 = ${rustF64(b.production.monasteryFeastWine)};`,
    `pub const MONASTERY_UNLINKED_PRODUCTIVITY: f64 = ${rustF64(b.production.monasteryUnlinkedProductivity)};`,
    `pub const MONASTERY_COVERAGE_RADIUS: f64 = ${rustF64(b.production.monasteryCoverageRadius)};`,
    `pub const MONASTERY_TITHE_SHARE_DEFAULT: f64 = ${rustF64(b.production.monasteryTitheShareDefault)};`,
    `pub const MONASTERY_CHARITY_FOOD_PER_DELIVERY: f64 = ${rustF64(b.production.monasteryCharityFoodPerDelivery)};`,
    `pub const SPECIALTY_EXPORT_GOLD_PER_HONEY: f64 = ${rustF64(b.production.specialtyExportGoldPerHoney)};`,
    `pub const SPECIALTY_EXPORT_GOLD_PER_ALE: f64 = ${rustF64(b.production.specialtyExportGoldPerAle)};`,
    `pub const SPECIALTY_EXPORT_GOLD_PER_WINE: f64 = ${rustF64(b.production.specialtyExportGoldPerWine)};`,
    `pub const SPECIALTY_EXPORT_GOLD_PER_CLOTH: f64 = ${rustF64(b.production.specialtyExportGoldPerCloth)};`,
    `pub const FERRY_GOLD_PER_DAY: f64 = ${rustF64(b.production.ferryGoldPerDay)};`,
    `pub const CARPENTER_DELIVERY_SPEED_MULTIPLIER: f64 = ${rustF64(b.production.carpenterDeliverySpeedMultiplier)};`,
    `pub const CARPENTER_TIMBER_COST_MULTIPLIER: f64 = ${rustF64(b.production.carpenterTimberCostMultiplier)};`,
    `pub const STOREHOUSE_OVERFLOW_THRESHOLD: f64 = ${rustF64(b.production.storehouseOverflowThreshold)};`,
    `pub const STOREHOUSE_HAUL_PER_WORKER: f64 = ${rustF64(b.production.storehouseHaulPerWorker)};`,
    `pub const STOREHOUSE_FIREWOOD_PER_DELIVERY: f64 = ${rustF64(b.production.storehouseFirewoodPerDelivery)};`,
    '',
    `pub const FARM_MIN_FIELD_AREA: f64 = ${rustF64(b.farming.minFieldArea)};`,
    `pub const FARM_OPTIMAL_FIELD_AREA: f64 = ${rustF64(b.farming.optimalFieldArea)};`,
    `pub const FARM_LARGE_FIELD_EFFICIENCY_EXPONENT: f64 = ${rustF64(b.farming.largeFieldEfficiencyExponent)};`,
    `pub const FARM_LARGE_FIELD_EFFICIENCY_FLOOR: f64 = ${rustF64(b.farming.largeFieldEfficiencyFloor)};`,
    `pub const FARM_MIN_FIELD_EDGE: f64 = ${rustF64(b.farming.minFieldEdge)};`,
    `pub const FARM_WORK_METERS_PER_WORKER_PER_SEC: f64 = ${rustF64(b.farming.workMetersPerWorkerPerSec)};`,
    `pub const FARM_PLOUGH_WORK_PER_SQUARE_METER: f64 = ${rustF64(b.farming.ploughWorkPerSquareMeter)};`,
    `pub const FARM_SOW_WORK_PER_SQUARE_METER: f64 = ${rustF64(b.farming.sowWorkPerSquareMeter)};`,
    `pub const FARM_HARVEST_WORK_PER_SQUARE_METER: f64 = ${rustF64(b.farming.harvestWorkPerSquareMeter)};`,
    `pub const FARM_GROWTH_SECONDS: f64 = ${rustF64(b.farming.growthSeconds)};`,
    `pub const FARM_BASE_GRAIN_PER_SQUARE_METER: f64 = ${rustF64(b.farming.baseGrainPerSquareMeter)};`,
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
    `pub const LIVESTOCK_HAY_STORAGE_CAPACITY: f64 = ${rustF64(b.livestock.hayStorageCapacity)};`,
    `pub const CATTLE_STARTER_HERD: u32 = ${b.livestock.cattle.starterHerd};`,
    `pub const CATTLE_MAX_HERD: u32 = ${b.livestock.cattle.maxHerd};`,
    `pub const CATTLE_MINIMUM_BREEDING_RESERVE: u32 = ${b.livestock.cattle.minimumBreedingReserve};`,
    `pub const CATTLE_DEFAULT_BREEDING_RESERVE: u32 = ${b.livestock.cattle.defaultBreedingReserve};`,
    `pub const CATTLE_AREA_PER_HEAD: f64 = ${rustF64(b.livestock.cattle.areaPerHead)};`,
    `pub const CATTLE_MAX_SLOPE_DEGREES: f64 = ${rustF64(b.livestock.cattle.maxSlopeDegrees ?? 0)};`,
    `pub const CATTLE_MOISTURE_IDEAL: f64 = ${rustF64(b.livestock.cattle.moistureIdeal ?? 0)};`,
    `pub const CATTLE_MOISTURE_TOLERANCE: f64 = ${rustF64(b.livestock.cattle.moistureTolerance ?? 1)};`,
    `pub const CATTLE_FOOD_PER_CYCLE_PER_HEAD: f64 = ${rustF64(b.livestock.cattle.foodPerCyclePerHead)};`,
    `pub const CATTLE_PRESERVED_FOOD_PER_CYCLE_PER_HEAD: f64 = ${rustF64(b.livestock.cattle.preservedFoodPerCyclePerHead ?? 0)};`,
    `pub const CATTLE_SLAUGHTER_FOOD_PER_HEAD: f64 = ${rustF64(b.livestock.cattle.slaughterFoodPerHead)};`,
    `pub const CATTLE_SLAUGHTER_PRESERVED_FOOD_PER_HEAD: f64 = ${rustF64(b.livestock.cattle.slaughterPreservedFoodPerHead)};`,
    `pub const CATTLE_HAY_PER_UNSUPPORTED_HEAD: f64 = ${rustF64(b.livestock.cattle.hayPerUnsupportedHead ?? 0)};`,
    `pub const CATTLE_HAY_YIELD_PER_RESERVED_CAPACITY_PER_CYCLE: f64 = ${rustF64(b.livestock.cattle.hayYieldPerReservedCapacityPerCycle ?? 0)};`,
    `pub const CATTLE_GRAIN_PER_UNSUPPORTED_HEAD: f64 = ${rustF64(b.livestock.cattle.grainPerUnsupportedHead)};`,
    `pub const CATTLE_BREEDING_PER_CYCLE: f64 = ${rustF64(b.livestock.cattle.breedingPerCycle)};`,
    `pub const CATTLE_HEALTH_RECOVERY_PER_CYCLE: f64 = ${rustF64(b.livestock.cattle.healthRecoveryPerCycle)};`,
    `pub const CATTLE_HEALTH_LOSS_PER_CYCLE: f64 = ${rustF64(b.livestock.cattle.healthLossPerCycle)};`,
    `pub const CATTLE_FERTILITY_BONUS: f64 = ${rustF64(b.livestock.cattle.fertilityBonus ?? 0)};`,
    `pub const CATTLE_MAX_FERTILIZED_FIELDS: usize = ${b.livestock.cattle.maxFertilizedFields ?? 0};`,
    `pub const CATTLE_PLOUGH_WORK_MULTIPLIER: f64 = ${rustF64(b.livestock.cattle.ploughWorkMultiplier ?? 1)};`,
    `pub const SHEEP_STARTER_HERD: u32 = ${b.livestock.sheep.starterHerd};`,
    `pub const SHEEP_MAX_HERD: u32 = ${b.livestock.sheep.maxHerd};`,
    `pub const SHEEP_MINIMUM_BREEDING_RESERVE: u32 = ${b.livestock.sheep.minimumBreedingReserve};`,
    `pub const SHEEP_DEFAULT_BREEDING_RESERVE: u32 = ${b.livestock.sheep.defaultBreedingReserve};`,
    `pub const SHEEP_AREA_PER_HEAD: f64 = ${rustF64(b.livestock.sheep.areaPerHead)};`,
    `pub const SHEEP_MAX_SLOPE_DEGREES: f64 = ${rustF64(b.livestock.sheep.maxSlopeDegrees ?? 0)};`,
    `pub const SHEEP_MOISTURE_IDEAL: f64 = ${rustF64(b.livestock.sheep.moistureIdeal ?? 0)};`,
    `pub const SHEEP_MOISTURE_TOLERANCE: f64 = ${rustF64(b.livestock.sheep.moistureTolerance ?? 1)};`,
    `pub const SHEEP_FOOD_PER_CYCLE_PER_HEAD: f64 = ${rustF64(b.livestock.sheep.foodPerCyclePerHead)};`,
    `pub const SHEEP_PRESERVED_FOOD_PER_CYCLE_PER_HEAD: f64 = ${rustF64(b.livestock.sheep.preservedFoodPerCyclePerHead ?? 0)};`,
    `pub const SHEEP_SLAUGHTER_FOOD_PER_HEAD: f64 = ${rustF64(b.livestock.sheep.slaughterFoodPerHead)};`,
    `pub const SHEEP_SLAUGHTER_PRESERVED_FOOD_PER_HEAD: f64 = ${rustF64(b.livestock.sheep.slaughterPreservedFoodPerHead)};`,
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
    `pub const SWINE_AREA_PER_HEAD: f64 = ${rustF64(b.livestock.swine.areaPerHead)};`,
    `pub const SWINE_MATURE_TREES_PER_HEAD: f64 = ${rustF64(b.livestock.swine.matureTreesPerHead ?? 0)};`,
    `pub const SWINE_FOOD_PER_CYCLE_PER_HEAD: f64 = ${rustF64(b.livestock.swine.foodPerCyclePerHead)};`,
    `pub const SWINE_SLAUGHTER_FOOD_PER_HEAD: f64 = ${rustF64(b.livestock.swine.slaughterFoodPerHead)};`,
    `pub const SWINE_SLAUGHTER_PRESERVED_FOOD_PER_HEAD: f64 = ${rustF64(b.livestock.swine.slaughterPreservedFoodPerHead)};`,
    `pub const SWINE_GRAIN_PER_UNSUPPORTED_HEAD: f64 = ${rustF64(b.livestock.swine.grainPerUnsupportedHead)};`,
    `pub const SWINE_BREEDING_PER_CYCLE: f64 = ${rustF64(b.livestock.swine.breedingPerCycle)};`,
    `pub const SWINE_HEALTH_RECOVERY_PER_CYCLE: f64 = ${rustF64(b.livestock.swine.healthRecoveryPerCycle)};`,
    `pub const SWINE_HEALTH_LOSS_PER_CYCLE: f64 = ${rustF64(b.livestock.swine.healthLossPerCycle)};`,
    '',
  ];

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
  lines.push('    pub fertility_delta: f64,');
  lines.push('    pub work_start_month: u8,');
  lines.push('    pub work_end_month: u8,');
  lines.push('    pub growth_start_month: u8,');
  lines.push('    pub growth_end_month: u8,');
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
    lines.push(`    fertility_delta: ${rustF64(crop.fertilityDelta)},`);
    lines.push(`    work_start_month: ${crop.workStartMonth},`);
    lines.push(`    work_end_month: ${crop.workEndMonth},`);
    lines.push(`    growth_start_month: ${crop.growthStartMonth},`);
    lines.push(`    growth_end_month: ${crop.growthEndMonth},`);
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
  lines.push('    Apiary,');
  lines.push('    Watermill,');
  lines.push('    Carpenter,');
  lines.push('    Weaver,');
  lines.push('    Guardhouse,');
  lines.push('    FerryLanding,');
  lines.push('    Vineyard,');
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
  lines.push('    pub storage_timber: f64,');
  lines.push('    pub storage_firewood: f64,');
  lines.push('    pub storage_stone: f64,');
  lines.push('    pub storage_water: f64,');
  lines.push('    pub storage_food: f64,');
  lines.push('    pub storage_grain: f64,');
  lines.push('    pub storage_barley: f64,');
  lines.push('    pub storage_malt: f64,');
  lines.push('    pub storage_flour: f64,');
  lines.push('    pub storage_ale: f64,');
  lines.push('    pub storage_preserved_food: f64,');
  lines.push('    pub storage_honey: f64,');
  lines.push('    pub storage_wine: f64,');
  lines.push('    pub storage_wool: f64,');
  lines.push('    pub storage_cloth: f64,');
  lines.push('    pub storage_ironwork: f64,');
  lines.push('    pub storage_polearms: f64,');
  lines.push('    pub accepts_labor: bool,');
  lines.push('    pub max_labor: u32,');
  lines.push('    pub work_radius: f64,');
  lines.push('    pub action_interval: f64,');
  lines.push('    pub pick_radius: f64,');
  lines.push('    pub requires_road: bool,');
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
    lines.push(`    storage_timber: ${rustF64(def.storage.timber)},`);
    lines.push(`    storage_firewood: ${rustF64(def.storage.firewood)},`);
    lines.push(`    storage_stone: ${rustF64(def.storage.stone)},`);
    lines.push(`    storage_water: ${rustF64(def.storage.water ?? 0)},`);
    lines.push(`    storage_food: ${rustF64(def.storage.food ?? 0)},`);
    lines.push(`    storage_grain: ${rustF64(def.storage.grain ?? 0)},`);
    lines.push(`    storage_barley: ${rustF64(def.storage.barley ?? 0)},`);
    lines.push(`    storage_malt: ${rustF64(def.storage.malt ?? 0)},`);
    lines.push(`    storage_flour: ${rustF64(def.storage.flour ?? 0)},`);
    lines.push(`    storage_ale: ${rustF64(def.storage.ale ?? 0)},`);
    lines.push(`    storage_preserved_food: ${rustF64(def.storage.preservedFood ?? 0)},`);
    lines.push(`    storage_honey: ${rustF64(def.storage.honey ?? 0)},`);
    lines.push(`    storage_wine: ${rustF64(def.storage.wine ?? 0)},`);
    lines.push(`    storage_wool: ${rustF64(def.storage.wool ?? 0)},`);
    lines.push(`    storage_cloth: ${rustF64(def.storage.cloth ?? 0)},`);
    lines.push(`    storage_ironwork: ${rustF64(def.storage.ironwork ?? 0)},`);
    lines.push(`    storage_polearms: ${rustF64(def.storage.polearms ?? 0)},`);
    lines.push(`    accepts_labor: ${def.acceptsLabor},`);
    lines.push(`    max_labor: ${def.maxLabor},`);
    lines.push(`    work_radius: ${rustF64(def.workRadius)},`);
    lines.push(`    action_interval: ${rustF64(def.harvestInterval)},`);
    lines.push(`    pick_radius: ${rustF64(def.pickRadius)},`);
    lines.push(`    requires_road: ${def.requiresRoad},`);
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
  lines.push('    pub food_self_share: f64,');
  lines.push('    pub food_per_person_per_sec: f64,');
  lines.push('    pub gold_per_person_per_sec: f64,');
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
    lines.push(`    food_self_share: ${rustF64(def.foodSelfShare)},`);
    lines.push(`    food_per_person_per_sec: ${rustF64(def.foodPerPersonPerSec)},`);
    lines.push(`    gold_per_person_per_sec: ${rustF64(def.goldPerPersonPerSec)},`);
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
    '',
    `export const SPRING_RAIN_CHANCE = ${b.seasons.springRainChance};`,
    `export const SPRING_RAIN_CROP_GROWTH_MULTIPLIER = ${b.seasons.springRainCropGrowthMultiplier};`,
    `export const SPRING_RAIN_WELL_REFILL_MULTIPLIER = ${b.seasons.springRainWellRefillMultiplier};`,
    `export const SPRING_RAIN_ROAD_SPEED_MULTIPLIER = ${b.seasons.springRainRoadSpeedMultiplier};`,
    `export const SPRING_RAIN_WATERMILL_THROUGHPUT_MULTIPLIER = ${b.seasons.springRainWatermillThroughputMultiplier};`,
    `export const SUMMER_DROUGHT_CHANCE = ${b.seasons.summerDroughtChance};`,
    `export const SUMMER_DROUGHT_DURATION_DAYS = ${b.seasons.summerDroughtDurationDays};`,
    `export const DROUGHT_CROP_GROWTH_MULTIPLIER = ${b.seasons.droughtCropGrowthMultiplier};`,
    `export const DROUGHT_FORAGE_REGROWTH_MULTIPLIER = ${b.seasons.droughtForageRegrowthMultiplier};`,
    `export const DROUGHT_WELL_REFILL_MULTIPLIER = ${b.seasons.droughtWellRefillMultiplier};`,
    `export const DROUGHT_FISH_LOSS_FRACTION_PER_DAY = ${b.seasons.droughtFishLossFractionPerDay};`,
    `export const DROUGHT_WATERMILL_THROUGHPUT_MULTIPLIER = ${b.seasons.droughtWatermillThroughputMultiplier};`,
    `export const SPRING_FIREWOOD_DEMAND_MULTIPLIER = ${b.seasons.springFirewoodDemandMultiplier};`,
    `export const SUMMER_FIREWOOD_DEMAND_MULTIPLIER = ${b.seasons.summerFirewoodDemandMultiplier};`,
    `export const AUTUMN_FIREWOOD_DEMAND_MULTIPLIER = ${b.seasons.autumnFirewoodDemandMultiplier};`,
    `export const WINTER_FIREWOOD_DEMAND_MULTIPLIER = ${b.seasons.winterFirewoodDemandMultiplier};`,
    `export const SPRING_PASTURE_CAPACITY_MULTIPLIER = ${b.seasons.springPastureCapacityMultiplier};`,
    `export const SUMMER_PASTURE_CAPACITY_MULTIPLIER = ${b.seasons.summerPastureCapacityMultiplier};`,
    `export const AUTUMN_PASTURE_CAPACITY_MULTIPLIER = ${b.seasons.autumnPastureCapacityMultiplier};`,
    `export const WINTER_PASTURE_CAPACITY_MULTIPLIER = ${b.seasons.winterPastureCapacityMultiplier};`,
    `export const DROUGHT_PASTURE_CAPACITY_MULTIPLIER = ${b.seasons.droughtPastureCapacityMultiplier};`,
    `export const SPRING_BREEDING_MULTIPLIER = ${b.seasons.springBreedingMultiplier};`,
    `export const WINTER_BREEDING_MULTIPLIER = ${b.seasons.winterBreedingMultiplier};`,
    `export const AUTUMN_ROAD_SPEED_MULTIPLIER = ${b.seasons.autumnRoadSpeedMultiplier};`,
    `export const WINTER_ROAD_SPEED_MULTIPLIER = ${b.seasons.winterRoadSpeedMultiplier};`,
    `export const WINTER_WATERMILL_THROUGHPUT_MULTIPLIER = ${b.seasons.winterWatermillThroughputMultiplier};`,
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
    '',
    `export const FIRE_LIGHTNING_IGNITION_CHANCE_PER_RAIN_DAY = ${b.fires.lightningIgnitionChancePerRainDay};`,
    `export const FIRE_ACCIDENT_IGNITION_CHANCE_PER_STRUCTURE_DAY = ${b.fires.accidentIgnitionChancePerStructureDay};`,
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
    `export const STARTING_GOLD = ${b.economy.startingGold};`,
    `export const STONE_SALVAGE_FRACTION = ${b.economy.stoneSalvageFraction};`,
    `export const TIMBER_SALVAGE_FRACTION = ${b.economy.timberSalvageFraction};`,
    `export const GOLD_SALVAGE_FRACTION = ${b.economy.goldSalvageFraction};`,
    `export const ECONOMIC_ACTIVITY_TAX_RATE = ${b.economy.economicActivityTaxRate};`,
    `export const ECONOMIC_ACTIVITY_TAX_RATE_MIN = ${b.economy.economicActivityTaxRateMin};`,
    `export const ECONOMIC_ACTIVITY_TAX_RATE_MAX = ${b.economy.economicActivityTaxRateMax};`,
    `export const LOW_TAX_PRODUCTIVITY_BOOST = ${b.economy.lowTaxProductivityBoost};`,
    `export const HIGH_TAX_PRODUCTIVITY_DRAG = ${b.economy.highTaxProductivityDrag};`,
    `export const FOOD_SALE_GOLD_PER_UNIT = ${b.economy.foodSaleGoldPerUnit};`,
    `export const RESIDENCE_TIMBER_COST = ${b.economy.residenceTimberCost};`,
    `export const RESIDENCE_STONE_COST = ${b.economy.residenceStoneCost};`,
    `export const RESIDENCE_TIER2_TIMBER_COST = ${b.economy.residenceTier2TimberCost};`,
    `export const RESIDENCE_TIER2_STONE_COST = ${b.economy.residenceTier2StoneCost};`,
    `export const RESIDENCE_TIER2_GOLD_COST = ${b.economy.residenceTier2GoldCost};`,
    `export const RESIDENCE_TIER3_TIMBER_COST = ${b.economy.residenceTier3TimberCost};`,
    `export const RESIDENCE_TIER3_STONE_COST = ${b.economy.residenceTier3StoneCost};`,
    `export const RESIDENCE_TIER3_GOLD_COST = ${b.economy.residenceTier3GoldCost};`,
    `export const HOUSEHOLD_MAX_WEALTH = ${b.economy.householdMaxWealth};`,
    `export const TOWN_HALL_POPULATION_REQUIRED = ${b.economy.townHallPopulationRequired};`,
    `export const TOWN_HALL_UNSTAFFED_TAX_COLLECTION_MULTIPLIER = ${b.economy.townHallUnstaffedTaxCollectionMultiplier};`,
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
    '',
    `export const STARTING_POPULATION = ${b.population.starting};`,
    `export const POPULATION_PER_RESIDENCE = ${b.population.perResidence};`,
    `export const RESIDENCE_POPULATION_NARROW = ${b.population.residencePopulationNarrow};`,
    `export const RESIDENCE_POPULATION_WIDE = ${b.population.residencePopulationWide};`,
    `export const NARROW_PARCEL_FRONTAGE_MAX = ${b.population.narrowParcelFrontageMax};`,
    `export const WIDE_PARCEL_FRONTAGE_MIN = ${b.population.wideParcelFrontageMin};`,
    `export const RESIDENCE_FIREWOOD_CAPACITY = ${b.population.residenceFirewoodCapacity};`,
    `export const RESIDENCE_FIREWOOD_PER_PERSON_PER_SEC = ${b.population.residenceFirewoodPerPersonPerSec};`,
    `export const RESIDENCE_WATER_CAPACITY = ${b.population.residenceWaterCapacity};`,
    `export const RESIDENCE_WATER_PER_PERSON_PER_SEC = ${b.population.residenceWaterPerPersonPerSec};`,
    `export const RESIDENCE_FOOD_CAPACITY = ${b.population.residenceFoodCapacity};`,
    `export const RESIDENCE_FOOD_PER_PERSON_PER_SEC = ${b.population.residenceFoodPerPersonPerSec};`,
    `export const RESIDENCE_TIER1_CAPACITY = ${b.population.residenceTier1Capacity};`,
    `export const RESIDENCE_TIER2_CAPACITY = ${b.population.residenceTier2Capacity};`,
    `export const RESIDENCE_TIER3_CAPACITY = ${b.population.residenceTier3Capacity};`,
    `export const RESIDENCE_PRESERVED_FOOD_CAPACITY = ${b.population.residencePreservedFoodCapacity};`,
    `export const RESIDENCE_PRESERVED_FOOD_PER_PERSON_PER_SEC = ${b.population.residencePreservedFoodPerPersonPerSec};`,
    `export const RESIDENCE_ALE_CAPACITY = ${b.population.residenceAleCapacity};`,
    `export const RESIDENCE_ALE_PER_PERSON_PER_SEC = ${b.population.residenceAlePerPersonPerSec};`,
    `export const RESIDENCE_CLOTH_CAPACITY = ${b.population.residenceClothCapacity};`,
    `export const RESIDENCE_CLOTH_PER_PERSON_PER_SEC = ${b.population.residenceClothPerPersonPerSec};`,
    `export const ABANDON_AFTER_DEFICIT_TICKS = ${b.population.abandonAfterDeficitTicks};`,
    `export const RESIDENCE_TIER1_ABANDONMENT_GRACE_MULTIPLIER = ${b.population.residenceTier1AbandonmentGraceMultiplier};`,
    `export const RESIDENCE_TIER2_ABANDONMENT_GRACE_MULTIPLIER = ${b.population.residenceTier2AbandonmentGraceMultiplier};`,
    `export const RESIDENCE_TIER3_ABANDONMENT_GRACE_MULTIPLIER = ${b.population.residenceTier3AbandonmentGraceMultiplier};`,
    `export const RESIDENCE_RECOVERY_FIREWOOD_MIN = ${b.population.residenceRecoveryFirewoodMin};`,
    `export const RESIDENCE_RECOVERY_WATER_MIN = ${b.population.residenceRecoveryWaterMin};`,
    `export const RESIDENCE_RECOVERY_FOOD_MIN = ${b.population.residenceRecoveryFoodMin};`,
    `export const RESIDENCE_SETTLE_TICKS = ${b.population.residenceSettleTicks};`,
    `export const CHAPEL_SETTLEMENT_TICKS_MULTIPLIER = ${b.population.chapelSettlementTicksMultiplier};`,
    `export const CHAPEL_ABANDONMENT_DEFICIT_MULTIPLIER = ${b.population.chapelAbandonmentDeficitMultiplier};`,
    `export const CHAPEL_TITHE_GOLD_PER_PERSON_PER_DAY = ${b.population.chapelTitheGoldPerPersonPerDay};`,
    `export const CHAPEL_BASE_ATTENDANCE_CHANCE = ${b.population.chapelBaseAttendanceChance};`,
    `export const CHAPEL_PRIEST_ATTENDANCE_BONUS = ${b.population.chapelPriestAttendanceBonus};`,
    `export const CHAPEL_COMMUNITY_ATTENDANCE_BONUS = ${b.population.chapelCommunityAttendanceBonus};`,
    `export const CHAPEL_RECOVERY_STOCK_MULTIPLIER = ${b.population.chapelRecoveryStockMultiplier};`,
    `export const CHAPEL_RECOVERY_NEEDS_REQUIRED = ${b.population.chapelRecoveryNeedsRequired};`,
    `export const CHAPEL_COFFER_CAPACITY = ${b.population.chapelCofferCapacity};`,
    `export const CHAPEL_PRIEST_SALARY_GOLD_PER_DAY = ${b.population.chapelPriestSalaryGoldPerDay};`,
    `export const CHAPEL_UPKEEP_GOLD_PER_DAY = ${b.population.chapelUpkeepGoldPerDay};`,
    `export const CHAPEL_UNSTAFFED_UPKEEP_FRACTION = ${b.population.chapelUnstaffedUpkeepFraction};`,
    `export const CHAPEL_CHARITY_GOLD_PER_DAY = ${b.population.chapelCharityGoldPerDay};`,
    `export const CHAPEL_CHARITY_MIN_COFFER_GOLD = ${b.population.chapelCharityMinCofferGold};`,
    `export const CHAPEL_POOR_RELIEF_GOLD_PER_DISPATCH = ${b.population.chapelPoorReliefGoldPerDispatch};`,
    `export const CHAPEL_POOR_RELIEF_INTERVAL_DAYS = ${b.population.chapelPoorReliefIntervalDays};`,
    `export const CHAPEL_AUTO_SWEEP_INTERVAL_TICKS = ${b.population.chapelAutoSweepIntervalTicks};`,
    `export const CHAPEL_AUTO_SWEEP_FRACTION = ${b.population.chapelAutoSweepFraction};`,
    `export const CHAPEL_COFFER_RESERVE_DEFAULT = ${b.population.chapelCofferReserveDefault};`,
    `export const CHAPEL_COFFER_RESERVE_MIN = ${b.population.chapelCofferReserveMin};`,
    `export const CHAPEL_COFFER_RESERVE_MAX = ${b.population.chapelCofferReserveMax};`,
    `export const CHAPEL_SABBATH_OBSERVANCE_ATTENDANCE_BONUS = ${b.population.sabbathObservanceAttendanceBonus};`,
    `export const CHAPEL_SABBATH_OBSERVANCE_SETTLEMENT_BONUS = ${b.population.sabbathObservanceSettlementBonus};`,
    `export const MONASTERY_SETTLEMENT_TICKS_MULTIPLIER = ${b.population.monasterySettlementTicksMultiplier};`,
    `export const MONASTERY_ABANDONMENT_DEFICIT_MULTIPLIER = ${b.population.monasteryAbandonmentDeficitMultiplier};`,
    `export const MONASTERY_RECOVERY_STOCK_MULTIPLIER = ${b.population.monasteryRecoveryStockMultiplier};`,
    `export const MONASTERY_ATTENDANCE_BONUS = ${b.population.monasteryAttendanceBonus};`,
    `export const MONASTERY_MIN_FOOTPRINT_SLOPE = ${b.population.monasteryMinFootprintSlope};`,
    '',
    `export const BUILDING_ROAD_ACCESS_DISTANCE = ${b.roads.buildingRoadAccessDistance};`,
    `export const BURGAGE_ROAD_FRONTAGE_DISTANCE = ${b.roads.burgageRoadFrontageDistance};`,
    `export const MIN_DELIVERY_TRIP_SEC = ${b.roads.minDeliveryTripSec};`,
    `export const FIREWOOD_DELIVERY_SPEED_MPS = ${b.roads.firewoodDeliverySpeedMps};`,
    `export const WATER_DELIVERY_SPEED_MPS = ${b.roads.waterDeliverySpeedMps};`,
    `export const FOOD_DELIVERY_SPEED_MPS = ${b.roads.foodDeliverySpeedMps};`,
    `export const FIREWOOD_DELIVERY_UNLOAD_SEC = ${b.roads.firewoodDeliveryUnloadSec};`,
    `export const WATER_DELIVERY_UNLOAD_SEC = ${b.roads.waterDeliveryUnloadSec};`,
    `export const FOOD_DELIVERY_UNLOAD_SEC = ${b.roads.foodDeliveryUnloadSec};`,
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
    `export const BERRIES_PER_HARVEST = ${b.production.berriesPerHarvest};`,
    `export const MUSHROOMS_PER_HARVEST = ${b.production.mushroomsPerHarvest};`,
    `export const FISH_PER_HARVEST = ${b.production.fishPerHarvest};`,
    `export const RICH_FISH_YIELD_MULTIPLIER = ${b.production.richFishYieldMultiplier};`,
    `export const FOOD_PER_DELIVERY = ${b.production.foodPerDelivery};`,
    `export const BERRIES_REGROW_PER_DAY = ${b.production.berriesRegrowPerDay};`,
    `export const MUSHROOMS_REGROW_PER_DAY = ${b.production.mushroomsRegrowPerDay};`,
    `export const FISH_REPRODUCTION_RATE_PER_DAY = ${b.production.fishReproductionRatePerDay};`,
    `export const GAME_REPRODUCTION_RATE_PER_DAY = ${b.production.gameReproductionRatePerDay};`,
    `export const GAME_MIN_BREEDING_POPULATION = ${b.production.gameMinBreedingPopulation};`,
    `export const GAME_HABITAT_DISRUPTION_RADIUS = ${b.production.gameHabitatDisruptionRadius};`,
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
    `export const WATERMILL_GRAIN_PER_CYCLE = ${b.production.watermillGrainPerCycle};`,
    `export const WATERMILL_WATER_PER_CYCLE = ${b.production.watermillWaterPerCycle};`,
    `export const WATERMILL_FLOUR_PER_CYCLE = ${b.production.watermillFlourPerCycle};`,
    `export const GRANARY_FLOUR_PER_CYCLE = ${b.production.granaryFlourPerCycle};`,
    `export const GRANARY_WATER_PER_CYCLE = ${b.production.granaryWaterPerCycle};`,
    `export const GRANARY_FIREWOOD_PER_CYCLE = ${b.production.granaryFirewoodPerCycle};`,
    `export const GRANARY_FOOD_PER_CYCLE = ${b.production.granaryFoodPerCycle};`,
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
    `export const WEAVER_WOOL_PER_CYCLE = ${b.production.weaverWoolPerCycle};`,
    `export const WEAVER_CLOTH_PER_CYCLE = ${b.production.weaverClothPerCycle};`,
    `export const TEXTILE_TRANSFER_PER_TRIP = ${b.production.textileTransferPerTrip};`,
    `export const SMOKEHOUSE_FOOD_PER_CYCLE = ${b.production.smokehouseFoodPerCycle};`,
    `export const SMOKEHOUSE_FIREWOOD_PER_CYCLE = ${b.production.smokehouseFirewoodPerCycle};`,
    `export const SMOKEHOUSE_PRESERVED_FOOD_PER_CYCLE = ${b.production.smokehousePreservedFoodPerCycle};`,
    `export const APIARY_HONEY_PER_CYCLE = ${b.production.apiaryHoneyPerCycle};`,
    `export const APIARY_FOOD_PER_CYCLE = ${b.production.apiaryFoodPerCycle};`,
    `export const APIARY_SEASON_START_MONTH = ${b.production.apiarySeasonStartMonth};`,
    `export const APIARY_SEASON_END_MONTH = ${b.production.apiarySeasonEndMonth};`,
    `export const VINEYARD_WINE_PER_CYCLE = ${b.production.vineyardWinePerCycle};`,
    `export const VINEYARD_FOOD_PER_CYCLE = ${b.production.vineyardFoodPerCycle};`,
    `export const VINEYARD_HARVEST_START_MONTH = ${b.production.vineyardHarvestStartMonth};`,
    `export const VINEYARD_HARVEST_END_MONTH = ${b.production.vineyardHarvestEndMonth};`,
    `export const MARKET_SPECIALTY_EXPORT_PER_BROKER_PER_SECOND = ${b.production.marketSpecialtyExportPerBrokerPerSecond};`,
    `export const MONASTERY_GRAIN_PER_CYCLE = ${b.production.monasteryGrainPerCycle};`,
    `export const MONASTERY_FOOD_PER_CYCLE = ${b.production.monasteryFoodPerCycle};`,
    `export const MONASTERY_PILGRIMAGE_GOLD_PER_DAY = ${b.production.monasteryPilgrimageGoldPerDay};`,
    `export const MONASTERY_HOSPITALITY_BONUS_GOLD_PER_DAY = ${b.production.monasteryHospitalityBonusGoldPerDay};`,
    `export const MONASTERY_HOSPITALITY_HONEY_PER_DAY = ${b.production.monasteryHospitalityHoneyPerDay};`,
    `export const MONASTERY_HOSPITALITY_WINE_PER_DAY = ${b.production.monasteryHospitalityWinePerDay};`,
    `export const MONASTERY_FEAST_FOOD = ${b.production.monasteryFeastFood};`,
    `export const MONASTERY_FEAST_ALE = ${b.production.monasteryFeastAle};`,
    `export const MONASTERY_FEAST_HONEY = ${b.production.monasteryFeastHoney};`,
    `export const MONASTERY_FEAST_WINE = ${b.production.monasteryFeastWine};`,
    `export const MONASTERY_UNLINKED_PRODUCTIVITY = ${b.production.monasteryUnlinkedProductivity};`,
    `export const MONASTERY_COVERAGE_RADIUS = ${b.production.monasteryCoverageRadius};`,
    `export const MONASTERY_TITHE_SHARE_DEFAULT = ${b.production.monasteryTitheShareDefault};`,
    `export const MONASTERY_CHARITY_FOOD_PER_DELIVERY = ${b.production.monasteryCharityFoodPerDelivery};`,
    `export const SPECIALTY_EXPORT_GOLD_PER_HONEY = ${b.production.specialtyExportGoldPerHoney};`,
    `export const SPECIALTY_EXPORT_GOLD_PER_ALE = ${b.production.specialtyExportGoldPerAle};`,
    `export const SPECIALTY_EXPORT_GOLD_PER_WINE = ${b.production.specialtyExportGoldPerWine};`,
    `export const SPECIALTY_EXPORT_GOLD_PER_CLOTH = ${b.production.specialtyExportGoldPerCloth};`,
    `export const FERRY_GOLD_PER_DAY = ${b.production.ferryGoldPerDay};`,
    `export const CARPENTER_DELIVERY_SPEED_MULTIPLIER = ${b.production.carpenterDeliverySpeedMultiplier};`,
    `export const CARPENTER_TIMBER_COST_MULTIPLIER = ${b.production.carpenterTimberCostMultiplier};`,
    `export const STOREHOUSE_OVERFLOW_THRESHOLD = ${b.production.storehouseOverflowThreshold};`,
    `export const STOREHOUSE_HAUL_PER_WORKER = ${b.production.storehouseHaulPerWorker};`,
    `export const STOREHOUSE_FIREWOOD_PER_DELIVERY = ${b.production.storehouseFirewoodPerDelivery};`,
    '',
    `export const FARM_MIN_FIELD_AREA = ${b.farming.minFieldArea};`,
    `export const FARM_OPTIMAL_FIELD_AREA = ${b.farming.optimalFieldArea};`,
    `export const FARM_LARGE_FIELD_EFFICIENCY_EXPONENT = ${b.farming.largeFieldEfficiencyExponent};`,
    `export const FARM_LARGE_FIELD_EFFICIENCY_FLOOR = ${b.farming.largeFieldEfficiencyFloor};`,
    `export const FARM_MIN_FIELD_EDGE = ${b.farming.minFieldEdge};`,
    `export const FARM_WORK_METERS_PER_WORKER_PER_SEC = ${b.farming.workMetersPerWorkerPerSec};`,
    `export const FARM_PLOUGH_WORK_PER_SQUARE_METER = ${b.farming.ploughWorkPerSquareMeter};`,
    `export const FARM_SOW_WORK_PER_SQUARE_METER = ${b.farming.sowWorkPerSquareMeter};`,
    `export const FARM_HARVEST_WORK_PER_SQUARE_METER = ${b.farming.harvestWorkPerSquareMeter};`,
    `export const FARM_GROWTH_SECONDS = ${b.farming.growthSeconds};`,
    `export const FARM_BASE_GRAIN_PER_SQUARE_METER = ${b.farming.baseGrainPerSquareMeter};`,
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
    '  fertilityDelta: number;',
    '  workStartMonth: number;',
    '  workEndMonth: number;',
    '  growthStartMonth: number;',
    '  growthEndMonth: number;',
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
    `export const LIVESTOCK_HAY_STORAGE_CAPACITY = ${b.livestock.hayStorageCapacity};`,
    `export const CATTLE_STARTER_HERD = ${b.livestock.cattle.starterHerd};`,
    `export const CATTLE_MAX_HERD = ${b.livestock.cattle.maxHerd};`,
    `export const CATTLE_MINIMUM_BREEDING_RESERVE = ${b.livestock.cattle.minimumBreedingReserve};`,
    `export const CATTLE_DEFAULT_BREEDING_RESERVE = ${b.livestock.cattle.defaultBreedingReserve};`,
    `export const CATTLE_AREA_PER_HEAD = ${b.livestock.cattle.areaPerHead};`,
    `export const CATTLE_MAX_SLOPE_DEGREES = ${b.livestock.cattle.maxSlopeDegrees ?? 0};`,
    `export const CATTLE_MOISTURE_IDEAL = ${b.livestock.cattle.moistureIdeal ?? 0};`,
    `export const CATTLE_MOISTURE_TOLERANCE = ${b.livestock.cattle.moistureTolerance ?? 1};`,
    `export const CATTLE_FOOD_PER_CYCLE_PER_HEAD = ${b.livestock.cattle.foodPerCyclePerHead};`,
    `export const CATTLE_PRESERVED_FOOD_PER_CYCLE_PER_HEAD = ${b.livestock.cattle.preservedFoodPerCyclePerHead ?? 0};`,
    `export const CATTLE_SLAUGHTER_FOOD_PER_HEAD = ${b.livestock.cattle.slaughterFoodPerHead};`,
    `export const CATTLE_SLAUGHTER_PRESERVED_FOOD_PER_HEAD = ${b.livestock.cattle.slaughterPreservedFoodPerHead};`,
    `export const CATTLE_HAY_PER_UNSUPPORTED_HEAD = ${b.livestock.cattle.hayPerUnsupportedHead ?? 0};`,
    `export const CATTLE_HAY_YIELD_PER_RESERVED_CAPACITY_PER_CYCLE = ${b.livestock.cattle.hayYieldPerReservedCapacityPerCycle ?? 0};`,
    `export const CATTLE_GRAIN_PER_UNSUPPORTED_HEAD = ${b.livestock.cattle.grainPerUnsupportedHead};`,
    `export const CATTLE_BREEDING_PER_CYCLE = ${b.livestock.cattle.breedingPerCycle};`,
    `export const CATTLE_HEALTH_RECOVERY_PER_CYCLE = ${b.livestock.cattle.healthRecoveryPerCycle};`,
    `export const CATTLE_HEALTH_LOSS_PER_CYCLE = ${b.livestock.cattle.healthLossPerCycle};`,
    `export const CATTLE_FERTILITY_BONUS = ${b.livestock.cattle.fertilityBonus ?? 0};`,
    `export const CATTLE_MAX_FERTILIZED_FIELDS = ${b.livestock.cattle.maxFertilizedFields ?? 0};`,
    `export const CATTLE_PLOUGH_WORK_MULTIPLIER = ${b.livestock.cattle.ploughWorkMultiplier ?? 1};`,
    `export const SHEEP_STARTER_HERD = ${b.livestock.sheep.starterHerd};`,
    `export const SHEEP_MAX_HERD = ${b.livestock.sheep.maxHerd};`,
    `export const SHEEP_MINIMUM_BREEDING_RESERVE = ${b.livestock.sheep.minimumBreedingReserve};`,
    `export const SHEEP_DEFAULT_BREEDING_RESERVE = ${b.livestock.sheep.defaultBreedingReserve};`,
    `export const SHEEP_AREA_PER_HEAD = ${b.livestock.sheep.areaPerHead};`,
    `export const SHEEP_MAX_SLOPE_DEGREES = ${b.livestock.sheep.maxSlopeDegrees ?? 0};`,
    `export const SHEEP_MOISTURE_IDEAL = ${b.livestock.sheep.moistureIdeal ?? 0};`,
    `export const SHEEP_MOISTURE_TOLERANCE = ${b.livestock.sheep.moistureTolerance ?? 1};`,
    `export const SHEEP_FOOD_PER_CYCLE_PER_HEAD = ${b.livestock.sheep.foodPerCyclePerHead};`,
    `export const SHEEP_PRESERVED_FOOD_PER_CYCLE_PER_HEAD = ${b.livestock.sheep.preservedFoodPerCyclePerHead ?? 0};`,
    `export const SHEEP_SLAUGHTER_FOOD_PER_HEAD = ${b.livestock.sheep.slaughterFoodPerHead};`,
    `export const SHEEP_SLAUGHTER_PRESERVED_FOOD_PER_HEAD = ${b.livestock.sheep.slaughterPreservedFoodPerHead};`,
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
    `export const SWINE_AREA_PER_HEAD = ${b.livestock.swine.areaPerHead};`,
    `export const SWINE_MATURE_TREES_PER_HEAD = ${b.livestock.swine.matureTreesPerHead ?? 0};`,
    `export const SWINE_FOOD_PER_CYCLE_PER_HEAD = ${b.livestock.swine.foodPerCyclePerHead};`,
    `export const SWINE_SLAUGHTER_FOOD_PER_HEAD = ${b.livestock.swine.slaughterFoodPerHead};`,
    `export const SWINE_SLAUGHTER_PRESERVED_FOOD_PER_HEAD = ${b.livestock.swine.slaughterPreservedFoodPerHead};`,
    `export const SWINE_GRAIN_PER_UNSUPPORTED_HEAD = ${b.livestock.swine.grainPerUnsupportedHead};`,
    `export const SWINE_BREEDING_PER_CYCLE = ${b.livestock.swine.breedingPerCycle};`,
    `export const SWINE_HEALTH_RECOVERY_PER_CYCLE = ${b.livestock.swine.healthRecoveryPerCycle};`,
    `export const SWINE_HEALTH_LOSS_PER_CYCLE = ${b.livestock.swine.healthLossPerCycle};`,
    '',
    'export type BuildingResourceCost = {',
    '  timber: number;',
    '  stone: number;',
    '};',
    '',
    'export type StorageCaps = {',
    '  timber: number;',
    '  firewood: number;',
    '  stone: number;',
    '  water?: number;',
    '  food?: number;',
    '  grain?: number;',
    '  barley?: number;',
    '  malt?: number;',
    '  flour?: number;',
    '  ale?: number;',
    '  preservedFood?: number;',
    '  honey?: number;',
    '  wine?: number;',
    '  wool?: number;',
    '  cloth?: number;',
    '  ironwork?: number;',
    '  polearms?: number;',
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
    lines.push(`  ${kind}: { timber: ${def.cost.timber}, stone: ${def.cost.stone} },`);
  }

  lines.push('} as const satisfies Record<BuildingKind, BuildingResourceCost>;');
  lines.push('');
  lines.push('export const BUILDING_STORAGE_CAPS = {');

  for (const [kind, def] of Object.entries(b.buildings)) {
    const water = def.storage.water ?? 0;
    const food = def.storage.food ?? 0;
    const grain = def.storage.grain ?? 0;
    const barley = def.storage.barley ?? 0;
    const malt = def.storage.malt ?? 0;
    const flour = def.storage.flour ?? 0;
    const ale = def.storage.ale ?? 0;
    const preservedFood = def.storage.preservedFood ?? 0;
    const honey = def.storage.honey ?? 0;
    const wine = def.storage.wine ?? 0;
    const wool = def.storage.wool ?? 0;
    const cloth = def.storage.cloth ?? 0;
    const ironwork = def.storage.ironwork ?? 0;
    const polearms = def.storage.polearms ?? 0;
    const extras: string[] = [];
    if (water > 0) extras.push(`water: ${water}`);
    if (food > 0) extras.push(`food: ${food}`);
    if (grain > 0) extras.push(`grain: ${grain}`);
    if (barley > 0) extras.push(`barley: ${barley}`);
    if (malt > 0) extras.push(`malt: ${malt}`);
    if (flour > 0) extras.push(`flour: ${flour}`);
    if (ale > 0) extras.push(`ale: ${ale}`);
    if (preservedFood > 0) extras.push(`preservedFood: ${preservedFood}`);
    if (honey > 0) extras.push(`honey: ${honey}`);
    if (wine > 0) extras.push(`wine: ${wine}`);
    if (wool > 0) extras.push(`wool: ${wool}`);
    if (cloth > 0) extras.push(`cloth: ${cloth}`);
    if (ironwork > 0) extras.push(`ironwork: ${ironwork}`);
    if (polearms > 0) extras.push(`polearms: ${polearms}`);
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
  lines.push('  foodSelfShare: number;');
  lines.push('  foodPerPersonPerSec: number;');
  lines.push('  goldPerPersonPerSec: number;');
  lines.push('};');
  lines.push('');
  lines.push('export const BACKYARD_GARDEN_DEFINITIONS = {');
  for (const [kind, def] of Object.entries(b.backyardGardens)) {
    lines.push(`  ${kind}: {`);
    lines.push(`    kind: '${kind}',`);
    lines.push(`    label: ${JSON.stringify(def.label)},`);
    lines.push(`    foodSelfShare: ${def.foodSelfShare},`);
    lines.push(`    foodPerPersonPerSec: ${def.foodPerPersonPerSec},`);
    lines.push(`    goldPerPersonPerSec: ${def.goldPerPersonPerSec},`);
    lines.push('  },');
  }
  lines.push('} as const satisfies Record<BackyardGardenKind, BackyardGardenDefinition>;');
  lines.push('');
  lines.push('export const BACKYARD_GARDEN_COSTS = {');
  for (const [kind, def] of Object.entries(b.backyardGardens)) {
    lines.push(`  ${kind}: { timber: ${def.cost.timber}, stone: ${def.cost.stone} },`);
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
mkdirSync(tsOutDir, { recursive: true });
writeFileSync(tsOut, generateTypeScript());

console.log(`Wrote ${rustOut}`);
console.log(`Wrote ${tsOut}`);
