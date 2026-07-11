import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MarketplaceTradeBalance } from './generateMarketplaceTradeBalance.mts';
import {
  generateMarketplaceTradeRust,
  generateMarketplaceTradeTypeScript,
} from './generateMarketplaceTradeBalance.mts';

type BuildingBalance = {
  label: string;
  cost: { timber: number; stone: number };
  storage: { timber: number; firewood: number; stone: number; water?: number; food?: number };
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
};

type BackyardGardenBalance = {
  label: string;
  cost: { timber: number; stone: number };
  foodSelfShare: number;
  foodPerPersonPerSec: number;
  goldPerPersonPerSec: number;
};

type MarketplaceGoldBuyOffer = {
  id: string;
  kind: 'goldBuy';
  resource: 'timber' | 'stone' | 'firewood' | 'food';
  amount: number;
  goldCost: number;
};

type MarketplaceGoldSellOffer = {
  id: string;
  kind: 'goldSell';
  resource: 'timber' | 'stone' | 'firewood' | 'food';
  amount: number;
  goldYield: number;
};

type MarketplaceBarterOffer = {
  id: string;
  kind: 'barter';
  give: 'timber' | 'stone' | 'firewood' | 'food';
  giveAmount: number;
  receive: 'timber' | 'stone' | 'firewood' | 'food';
  receiveAmount: number;
};

type MarketplaceTradeOffer = MarketplaceGoldBuyOffer | MarketplaceGoldSellOffer | MarketplaceBarterOffer;

export type GameBalance = {
  sim: { tickMicros: number; tickDt: number };
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
    householdMaxWealth: number;
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
    abandonAfterDeficitTicks: number;
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
    chapelAutoSweepIntervalTicks: number;
    chapelAutoSweepFraction: number;
    chapelCofferReserveDefault: number;
    chapelCofferReserveMin: number;
    chapelCofferReserveMax: number;
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
  };
  production: {
    lodgeTimberPerCycle: number;
    lodgeFirewoodPerCycle: number;
    lodgeFirewoodPerDelivery: number;
    stonePerHarvest: number;
    gamePerHarvest: number;
    berriesPerHarvest: number;
    foodPerDelivery: number;
    gameRespawnSec: number;
    berriesRespawnSec: number;
    berriesRespawnRadius: number;
    reforesterRegrowPerSec: number;
    wellBaseRefillPerSec: number;
    wellSurgeChancePerTick: number;
    wellSurgeAmountMin: number;
    wellSurgeAmountMax: number;
    wellSurgeCooldownSec: number;
    wellWaterPerDelivery: number;
    millWaterPerHarvest: number;
  };
  buildings: Record<string, BuildingBalance>;
  backyardGardens: Record<string, BackyardGardenBalance>;
  marketplaceTrade: MarketplaceTradeBalance;
};

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(scriptDir, '..');
const balancePath = join(projectRoot, 'balance/gameBalance.json');
const balance = JSON.parse(readFileSync(balancePath, 'utf8')) as GameBalance;

const buildingKinds = Object.keys(balance.buildings);
const backyardGardenKinds = Object.keys(balance.backyardGardens);
const simKindByKind: Record<string, string | null> = {
  lumber_mill: 'LumberMill',
  reforester: 'Reforester',
  stone_quarry: 'StoneQuarry',
  woodcutters_lodge: 'WoodcuttersLodge',
  well: 'Well',
  hunters_hall: 'HuntersHall',
  foragers_shed: 'ForagersShed',
  chapel: null,
  marketplace: null,
};

function rustF64(value: number): string {
  return Number.isInteger(value) ? `${value}.0` : `${value}`;
}

function generateRust(): string {
  const b = balance;
  const lines: string[] = [
    '// Generated by scripts/generateGameBalance.mts — do not edit.',
    '',
    `pub const TICK_MICROS: i64 = ${b.sim.tickMicros};`,
    `pub const TICK_DT: f64 = ${rustF64(b.sim.tickDt)};`,
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
    `pub const HOUSEHOLD_MAX_WEALTH: f64 = ${rustF64(b.economy.householdMaxWealth)};`,
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
    `pub const ABANDON_AFTER_DEFICIT_TICKS: u32 = ${b.population.abandonAfterDeficitTicks};`,
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
    `pub const CHAPEL_AUTO_SWEEP_INTERVAL_TICKS: u64 = ${b.population.chapelAutoSweepIntervalTicks};`,
    `pub const CHAPEL_AUTO_SWEEP_FRACTION: f64 = ${rustF64(b.population.chapelAutoSweepFraction)};`,
    `pub const CHAPEL_COFFER_RESERVE_DEFAULT: f64 = ${rustF64(b.population.chapelCofferReserveDefault)};`,
    `pub const CHAPEL_COFFER_RESERVE_MIN: f64 = ${rustF64(b.population.chapelCofferReserveMin)};`,
    `pub const CHAPEL_COFFER_RESERVE_MAX: f64 = ${rustF64(b.population.chapelCofferReserveMax)};`,
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
    '',
    `pub const LODGE_TIMBER_PER_CYCLE: f64 = ${rustF64(b.production.lodgeTimberPerCycle)};`,
    `pub const LODGE_FIREWOOD_PER_CYCLE: f64 = ${rustF64(b.production.lodgeFirewoodPerCycle)};`,
    `pub const LODGE_FIREWOOD_PER_DELIVERY: f64 = ${rustF64(b.production.lodgeFirewoodPerDelivery)};`,
    `pub const STONE_PER_HARVEST: f64 = ${rustF64(b.production.stonePerHarvest)};`,
    `pub const GAME_PER_HARVEST: f64 = ${rustF64(b.production.gamePerHarvest)};`,
    `pub const BERRIES_PER_HARVEST: f64 = ${rustF64(b.production.berriesPerHarvest)};`,
    `pub const FOOD_PER_DELIVERY: f64 = ${rustF64(b.production.foodPerDelivery)};`,
    `pub const GAME_RESPAWN_SEC: f64 = ${rustF64(b.production.gameRespawnSec)};`,
    `pub const BERRIES_RESPAWN_SEC: f64 = ${rustF64(b.production.berriesRespawnSec)};`,
    `pub const BERRIES_RESPAWN_RADIUS: f64 = ${rustF64(b.production.berriesRespawnRadius)};`,
    `pub const REFORESTER_REGROW_PER_SEC: f64 = ${rustF64(b.production.reforesterRegrowPerSec)};`,
    `pub const WELL_BASE_REFILL_PER_SEC: f64 = ${rustF64(b.production.wellBaseRefillPerSec)};`,
    `pub const WELL_SURGE_CHANCE_PER_TICK: f64 = ${rustF64(b.production.wellSurgeChancePerTick)};`,
    `pub const WELL_SURGE_AMOUNT_MIN: f64 = ${rustF64(b.production.wellSurgeAmountMin)};`,
    `pub const WELL_SURGE_AMOUNT_MAX: f64 = ${rustF64(b.production.wellSurgeAmountMax)};`,
    `pub const WELL_SURGE_COOLDOWN_SEC: f64 = ${rustF64(b.production.wellSurgeCooldownSec)};`,
    `pub const WELL_WATER_PER_DELIVERY: f64 = ${rustF64(b.production.wellWaterPerDelivery)};`,
    `pub const MILL_WATER_PER_HARVEST: f64 = ${rustF64(b.production.millWaterPerHarvest)};`,
    '',
  ];

  lines.push('#[derive(Clone, Copy, Debug, PartialEq, Eq)]');
  lines.push('pub enum BuildingSimKind {');
  lines.push('    LumberMill,');
  lines.push('    Reforester,');
  lines.push('    StoneQuarry,');
  lines.push('    WoodcuttersLodge,');
  lines.push('    Well,');
  lines.push('    HuntersHall,');
  lines.push('    ForagersShed,');
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
  lines.push('');
  lines.push('    pub fn slug(self) -> &\'static str {');
  lines.push('        match self {');
  for (const kind of backyardGardenKinds) {
    const variant = kind
      .split('_')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join('');
    lines.push(`            Self::${variant} => "${kind}",`);
  }
  lines.push('        }');
  lines.push('    }');
  lines.push('}');
  lines.push('');
  lines.push('#[derive(Clone, Copy, Debug)]');
  lines.push('pub struct BackyardGardenDef {');
  lines.push('    pub kind: BackyardGardenKind,');
  lines.push('    pub slug: &\'static str,');
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

  return lines.join('\n');
}

function generateTypeScript(): string {
  const b = balance;
  const lines: string[] = [
    '// Generated by scripts/generateGameBalance.mts — do not edit.',
    '',
    `export const BUILDING_KINDS = ${JSON.stringify(buildingKinds)} as const;`,
    'export type BuildingKind = (typeof BUILDING_KINDS)[number];',
    '',
    `export const SIM_TICK_SECONDS = ${b.sim.tickDt};`,
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
    `export const HOUSEHOLD_MAX_WEALTH = ${b.economy.householdMaxWealth};`,
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
    `export const ABANDON_AFTER_DEFICIT_TICKS = ${b.population.abandonAfterDeficitTicks};`,
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
    `export const CHAPEL_AUTO_SWEEP_INTERVAL_TICKS = ${b.population.chapelAutoSweepIntervalTicks};`,
    `export const CHAPEL_AUTO_SWEEP_FRACTION = ${b.population.chapelAutoSweepFraction};`,
    `export const CHAPEL_COFFER_RESERVE_DEFAULT = ${b.population.chapelCofferReserveDefault};`,
    `export const CHAPEL_COFFER_RESERVE_MIN = ${b.population.chapelCofferReserveMin};`,
    `export const CHAPEL_COFFER_RESERVE_MAX = ${b.population.chapelCofferReserveMax};`,
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
    '',
    `export const LODGE_TIMBER_PER_CYCLE = ${b.production.lodgeTimberPerCycle};`,
    `export const LODGE_FIREWOOD_PER_CYCLE = ${b.production.lodgeFirewoodPerCycle};`,
    `export const LODGE_FIREWOOD_PER_DELIVERY = ${b.production.lodgeFirewoodPerDelivery};`,
    `export const STONE_PER_HARVEST = ${b.production.stonePerHarvest};`,
    `export const GAME_PER_HARVEST = ${b.production.gamePerHarvest};`,
    `export const BERRIES_PER_HARVEST = ${b.production.berriesPerHarvest};`,
    `export const FOOD_PER_DELIVERY = ${b.production.foodPerDelivery};`,
    `export const WELL_BASE_REFILL_PER_SEC = ${b.production.wellBaseRefillPerSec};`,
    `export const WELL_SURGE_CHANCE_PER_TICK = ${b.production.wellSurgeChancePerTick};`,
    `export const WELL_SURGE_AMOUNT_MIN = ${b.production.wellSurgeAmountMin};`,
    `export const WELL_SURGE_AMOUNT_MAX = ${b.production.wellSurgeAmountMax};`,
    `export const WELL_SURGE_COOLDOWN_SEC = ${b.production.wellSurgeCooldownSec};`,
    `export const WELL_WATER_PER_DELIVERY = ${b.production.wellWaterPerDelivery};`,
    `export const MILL_WATER_PER_HARVEST = ${b.production.millWaterPerHarvest};`,
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
    const extras: string[] = [];
    if (water > 0) extras.push(`water: ${water}`);
    if (food > 0) extras.push(`food: ${food}`);
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
