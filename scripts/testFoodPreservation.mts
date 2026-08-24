import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  FRESH_FOOD_STORAGE_CART_FACTOR,
  FRESH_FOOD_STORAGE_GRANARY_FACTOR,
  FRESH_FOOD_STORAGE_MARKETPLACE_FACTOR,
  FRESH_FOOD_STORAGE_RESIDENCE_FACTOR,
  FRESH_FOOD_STORAGE_SMOKEHOUSE_FACTOR,
  FRESH_FOOD_STORAGE_TREASURY_FACTOR,
  PRESERVED_FOOD_SPOILAGE_PER_DAY,
  PRESERVED_FOOD_STORAGE_CART_FACTOR,
  PRESERVED_FOOD_STORAGE_DEFAULT_BUILDING_FACTOR,
  PRESERVED_FOOD_STORAGE_GRANARY_FACTOR,
  PRESERVED_FOOD_STORAGE_MARKETPLACE_FACTOR,
  PRESERVED_FOOD_STORAGE_RESIDENCE_FACTOR,
  PRESERVED_FOOD_STORAGE_SMOKEHOUSE_FACTOR,
  PRESERVED_FOOD_STORAGE_TREASURY_FACTOR,
} from '../src/generated/gameBalance.ts';
import {
  analyzeFreshFoodPreservation,
  buildingFreshFoodStorageFactor,
  buildingPreservedFoodStorageFactor,
  formatPreservedFoodLoss,
  spoilageAdjustedRunwayDays,
} from '../src/economy/foodPreservation.ts';
import { freshFoodRunwayWithPreservedRotation } from '../src/economy/preservedFoodPolicy.ts';
import { foodSpoilageMultiplier } from '../src/economy/foodInventory.ts';
import type { DeliveryTripState } from '../src/logistics/deliveryTrips.ts';
import { renderFreshFoodPreservationRows } from '../src/resources/inspector/townHallRenderer.ts';
import type {
  BuildingState,
  GameState,
  ResidenceState,
} from '../src/resources/types.ts';

const state = emptyGameState();
state.stockpile.food = 10;
state.buildings.set('granary', building('granary', 'granary', 20));
state.buildings.set('market', building('market', 'marketplace', 10));
state.buildings.set('smokehouse', building('smokehouse', 'smokehouse', 10));
state.buildings.set('hunter', building('hunter', 'hunters_hall', 10));
state.residences.set('home', residence('home', 10));

const ambientSpoilage = 0.01;
const preservation = analyzeFreshFoodPreservation(state, ambientSpoilage);
const expectedWeightedStock = 10 * FRESH_FOOD_STORAGE_TREASURY_FACTOR
  + 20 * FRESH_FOOD_STORAGE_GRANARY_FACTOR
  + 10 * FRESH_FOOD_STORAGE_MARKETPLACE_FACTOR
  + 10 * FRESH_FOOD_STORAGE_SMOKEHOUSE_FACTOR
  + 10
  + 10 * FRESH_FOOD_STORAGE_RESIDENCE_FACTOR;

assert.equal(preservation.totalStock, 70);
assert.equal(preservation.protectedStock, 40);
assert.ok(Math.abs(preservation.protectedShare - 4 / 7) < 1e-9);
assert.ok(Math.abs(preservation.effectiveStorageFactor - expectedWeightedStock / 70) < 1e-9);
assert.ok(Math.abs(preservation.spoilagePerDay - expectedWeightedStock * ambientSpoilage) < 1e-9);
assert.equal(preservation.largestLossSite?.source, 'treasury');
assert.ok(Math.abs((preservation.largestLossSite?.spoilagePerDay ?? 0) - 0.12) < 1e-9);
assert.deepEqual(preservation.granaryNetwork, {
  completedGranaries: 1,
  fireDisabledGranaries: 0,
  collectingGranaries: 1,
  staffedCollectingGranaries: 1,
  targetStock: 255,
  stockTowardTarget: 20,
  targetShortfall: 235,
  stockAboveTarget: 0,
});
assert.equal(buildingFreshFoodStorageFactor('granary'), FRESH_FOOD_STORAGE_GRANARY_FACTOR);
assert.equal(buildingFreshFoodStorageFactor('founders_camp'), 0);
assert.ok(
  buildingFreshFoodStorageFactor('granary') < buildingFreshFoodStorageFactor('hunters_hall'),
  'granary storage should materially slow fresh-food spoilage',
);

const curedState = emptyGameState();
curedState.stockpile.preservedFood = 10;
const curedGranary = building('cured-granary', 'granary', 0);
curedGranary.preservedFood = 20;
curedState.buildings.set(curedGranary.id, curedGranary);
const curedSmokehouse = building('cured-smokehouse', 'smokehouse', 0);
curedSmokehouse.preservedFood = 10;
curedState.buildings.set(curedSmokehouse.id, curedSmokehouse);
const curedMarket = building('cured-market', 'marketplace', 0);
curedMarket.preservedFood = 10;
curedState.buildings.set(curedMarket.id, curedMarket);
const curedHolding = building('cured-holding', 'pastoral_farmstead', 0);
curedHolding.preservedFood = 10;
curedState.buildings.set(curedHolding.id, curedHolding);
const curedHome = residence('cured-home', 0);
curedHome.tier = 3;
curedHome.needs.preservedFood.stock = 10;
curedHome.preservedFood = 10;
curedState.residences.set(curedHome.id, curedHome);
curedState.deliveryTrips.set(
  'cured-cart',
  deliveryTrip('cured-cart', 'preservedFood', 10, 'outbound'),
);
const curedPreservation = analyzeFreshFoodPreservation(
  curedState,
  ambientSpoilage,
).preservedFood;
const expectedCuredWeightedStock =
  10 * PRESERVED_FOOD_STORAGE_TREASURY_FACTOR
  + 20 * PRESERVED_FOOD_STORAGE_GRANARY_FACTOR
  + 10 * PRESERVED_FOOD_STORAGE_SMOKEHOUSE_FACTOR
  + 10 * PRESERVED_FOOD_STORAGE_MARKETPLACE_FACTOR
  + 10 * PRESERVED_FOOD_STORAGE_DEFAULT_BUILDING_FACTOR
  + 10 * PRESERVED_FOOD_STORAGE_RESIDENCE_FACTOR
  + 10 * PRESERVED_FOOD_STORAGE_CART_FACTOR;
assert.equal(curedPreservation.totalStock, 80);
assert.equal(curedPreservation.usableStock, 70);
assert.equal(curedPreservation.transitStock, 10);
assert.equal(curedPreservation.protectedStock, 40);
assert.ok(
  Math.abs(
    curedPreservation.spoilagePerDay
    - expectedCuredWeightedStock
      * foodSpoilageMultiplier('preservedFood')
      * PRESERVED_FOOD_SPOILAGE_PER_DAY,
  ) < 1e-9,
);
assert.equal(curedPreservation.largestLossSite?.id, 'cured-cart');
assert.equal(
  buildingPreservedFoodStorageFactor('granary'),
  PRESERVED_FOOD_STORAGE_GRANARY_FACTOR,
);
assert.equal(buildingPreservedFoodStorageFactor('founders_camp'), 0);
assert.ok(
  buildingPreservedFoodStorageFactor('smokehouse')
  < buildingPreservedFoodStorageFactor('granary'),
  'the smokehouse drying loft should preserve cured stock better than a granary',
);
assert.ok(
  buildingPreservedFoodStorageFactor('granary')
  < buildingPreservedFoodStorageFactor('pastoral_farmstead'),
  'central dry storage should preserve cured stock better than an ordinary holding',
);
assert.match(formatPreservedFoodLoss(curedPreservation.spoilagePerDay), /provisions/);
const winterCuredRate = PRESERVED_FOOD_SPOILAGE_PER_DAY * 0.5;
const winterCuredPreservation = analyzeFreshFoodPreservation(
  curedState,
  ambientSpoilage,
  { preservedFoodSpoilageFractionPerDay: winterCuredRate },
).preservedFood;
assert.ok(
  Math.abs(
    winterCuredPreservation.spoilagePerDay
    - expectedCuredWeightedStock
      * foodSpoilageMultiplier('preservedFood')
      * winterCuredRate,
  ) < 1e-9,
  'current climate must scale every physical cured-food store through the shared diagnostic pass',
);
assert.ok(
  winterCuredPreservation.spoilagePerDay
  < curedPreservation.spoilagePerDay,
);

const physicalLedgerState = emptyGameState();
physicalLedgerState.physicalFoundingSiteEnabled = true;
physicalLedgerState.stockpile.food = 50;
assert.equal(
  analyzeFreshFoodPreservation(physicalLedgerState, ambientSpoilage).totalStock,
  0,
  'physical food planning must ignore compatibility-ledger stock',
);

const foundingWeatherState = emptyGameState();
const weatherproofCamp = building('weatherproof-camp', 'founders_camp', 30);
weatherproofCamp.preservedFood = 20;
foundingWeatherState.buildings.set(weatherproofCamp.id, weatherproofCamp);
const foundingFoodCart = deliveryTrip('founding-food-cart', 'food', 12, 'outbound');
foundingFoodCart.buildingId = weatherproofCamp.id;
foundingWeatherState.deliveryTrips.set(foundingFoodCart.id, foundingFoodCart);
const foundingCuredCart = deliveryTrip(
  'founding-cured-cart',
  'preservedFood',
  8,
  'outbound',
);
foundingCuredCart.buildingId = weatherproofCamp.id;
foundingWeatherState.deliveryTrips.set(foundingCuredCart.id, foundingCuredCart);
const foundingWeather = analyzeFreshFoodPreservation(
  foundingWeatherState,
  ambientSpoilage,
);
assert.equal(foundingWeather.totalStock, 42);
assert.equal(foundingWeather.protectedStock, 42);
assert.equal(foundingWeather.spoilagePerDay, 0);
assert.equal(foundingWeather.preservedFood.totalStock, 28);
assert.equal(foundingWeather.preservedFood.protectedStock, 28);
assert.equal(foundingWeather.preservedFood.spoilagePerDay, 0);

const cartState = emptyGameState();
cartState.deliveryTrips.set('outbound-food', deliveryTrip('outbound-food', 'food', 24, 'outbound'));
cartState.deliveryTrips.set('returning-food', deliveryTrip('returning-food', 'food', 6, 'inbound'));
cartState.deliveryTrips.set(
  'preserved-food',
  deliveryTrip('preserved-food', 'preservedFood', 40, 'outbound'),
);
const cartPreservation = analyzeFreshFoodPreservation(cartState, ambientSpoilage);
assert.equal(cartPreservation.totalStock, 30);
assert.equal(cartPreservation.usableStock, 0);
assert.equal(cartPreservation.transitStock, 30);
assert.ok(
  Math.abs(
    cartPreservation.transitSpoilagePerDay
    - 30 * FRESH_FOOD_STORAGE_CART_FACTOR * ambientSpoilage
  ) < 1e-9,
);
assert.equal(cartPreservation.largestLossSite?.source, 'trip');
assert.equal(cartPreservation.largestLossSite?.id, 'outbound-food');
const cartRows = renderFreshFoodPreservationRows(
  cartPreservation,
  (kind) => kind,
  () => null,
);
assert.match(cartRows, /Food on carts/);
assert.match(cartRows, /30 exposed in loaded or returning handcarts/);
assert.match(cartRows, /unavailable until unloaded/);
assert.match(cartRows, /Loaded handcart · 24 food/);

const adjustedRunway = spoilageAdjustedRunwayDays(
  preservation.totalStock,
  7,
  preservation.spoilageFractionPerDay,
);
assert.ok(adjustedRunway < 10, 'spoilage must shorten the naive ten-day food runway');
assert.ok(adjustedRunway > 9, 'the configured storage mix should not erase more than a day of runway');
assert.equal(spoilageAdjustedRunwayDays(70, 7, 0), 10);
assert.equal(spoilageAdjustedRunwayDays(0, 7, 0.01), 0);
assert.equal(spoilageAdjustedRunwayDays(70, 0, 0.01), Number.POSITIVE_INFINITY);
const noCuredAgingRunway = freshFoodRunwayWithPreservedRotation({
  freshStock: 100,
  grossFoodDemandPerDay: 10,
  preservedStock: 30,
  preservedRotationPerDay: 3,
  freshFoodSpoilageFractionPerDay: 0.01,
});
const curedAgingRunway = freshFoodRunwayWithPreservedRotation({
  freshStock: 100,
  grossFoodDemandPerDay: 10,
  preservedStock: 30,
  preservedRotationPerDay: 3,
  freshFoodSpoilageFractionPerDay: 0.01,
  preservedFoodSpoilageFractionPerDay:
    PRESERVED_FOOD_SPOILAGE_PER_DAY * PRESERVED_FOOD_STORAGE_GRANARY_FACTOR,
});
assert.ok(
  curedAgingRunway < noCuredAgingRunway,
  'slow cured-food aging must shorten a no-production reserve forecast',
);
assert.ok(
  curedAgingRunway > noCuredAgingRunway - 0.1,
  'the configured aging rate must create planning pressure without erasing months-long storage',
);

const hotspotState = emptyGameState();
hotspotState.buildings.set('hunter-hotspot', building('hunter-hotspot', 'hunters_hall', 80));
hotspotState.buildings.set('granary-buffer', building('granary-buffer', 'granary', 20));
const hotspot = analyzeFreshFoodPreservation(hotspotState, 0.01);
assert.equal(hotspot.largestLossSite?.source, 'building');
assert.equal(hotspot.largestLossSite?.id, 'hunter-hotspot');
assert.equal(hotspot.largestLossSite?.buildingKind, 'hunters_hall');
assert.ok(Math.abs((hotspot.largestLossSite?.spoilagePerDay ?? 0) - 0.8) < 1e-9);
const hotspotRows = renderFreshFoodPreservationRows(
  hotspot,
  (kind) => kind === 'hunters_hall' ? "Hunter's hall" : kind,
  () => null,
);
assert.match(hotspotRows, /Largest fresh-food loss/);
assert.match(hotspotRows, /Hunter's hall · 80 food · 0\.8 food \/ day/);
assert.match(hotspotRows, /data-inspect-building="hunter-hotspot"/);
assert.match(hotspotRows, /Granary intake network/);
assert.match(hotspotRows, /20 \/ 255 sheltered toward selected targets/);
assert.match(hotspotRows, /235 collection headroom/);
assert.match(hotspotRows, /1 \/ 1 collectors staffed/);

const householdHotspotState = emptyGameState();
householdHotspotState.residences.set(
  'household-hotspot',
  residence('household-hotspot', 40),
);
const householdHotspotRows = renderFreshFoodPreservationRows(
  analyzeFreshFoodPreservation(householdHotspotState, 0.01),
  (kind) => kind,
  () => 6,
);
assert.match(householdHotspotRows, /Residence parcel #7/);
assert.match(householdHotspotRows, /data-inspect-residence="household-hotspot"/);

const disabledGranaryState = emptyGameState();
const disabledGranary = building('disabled-granary', 'granary', 20);
disabledGranary.granaryAcceptsFreshFood = false;
disabledGranaryState.buildings.set(disabledGranary.id, disabledGranary);
const disabledGranaryRows = renderFreshFoodPreservationRows(
  analyzeFreshFoodPreservation(disabledGranaryState, 0.01),
  (kind) => kind,
  () => null,
);
assert.match(disabledGranaryRows, /1 completed · fresh-food collection disabled at every granary/);

const deepGranaryState = emptyGameState();
const deepGranary = building('deep-granary', 'granary', 310);
deepGranary.granaryFreshFoodTargetPercent = 90;
deepGranaryState.buildings.set(deepGranary.id, deepGranary);
const deepGranaryRows = renderFreshFoodPreservationRows(
  analyzeFreshFoodPreservation(deepGranaryState, 0.01),
  (kind) => kind,
  () => null,
);
assert.match(deepGranaryRows, /306 \/ 306 sheltered toward selected targets/);
assert.match(deepGranaryRows, /4 above targets from baking or earlier stock/);

const fireQuarantineState = emptyGameState();
fireQuarantineState.stockpile.food = 10;
fireQuarantineState.buildings.set(
  'fire-granary',
  building('fire-granary', 'granary', 20),
);
fireQuarantineState.buildings.set(
  'fire-hunter',
  building('fire-hunter', 'hunters_hall', 30),
);
fireQuarantineState.buildings.set(
  'healthy-market',
  building('healthy-market', 'marketplace', 10),
);
fireQuarantineState.residences.set(
  'fire-home',
  residence('fire-home', 40),
);
fireQuarantineState.stockpile.preservedFood = 10;
fireQuarantineState.buildings.get('fire-granary')!.preservedFood = 20;
fireQuarantineState.buildings.get('fire-hunter')!.preservedFood = 30;
fireQuarantineState.buildings.get('healthy-market')!.preservedFood = 10;
fireQuarantineState.residences.get('fire-home')!.needs.preservedFood.stock = 40;
fireQuarantineState.residences.get('fire-home')!.preservedFood = 40;
const fireQuarantine = analyzeFreshFoodPreservation(
  fireQuarantineState,
  ambientSpoilage,
  {
    fireDisabledBuildingIds: new Set(['fire-granary', 'fire-hunter']),
    fireDisabledResidenceIds: new Set(['fire-home']),
  },
);
assert.equal(fireQuarantine.totalStock, 110);
assert.equal(fireQuarantine.usableStock, 20);
assert.equal(fireQuarantine.quarantinedStock, 90);
assert.equal(fireQuarantine.granaryNetwork.completedGranaries, 1);
assert.equal(fireQuarantine.granaryNetwork.fireDisabledGranaries, 1);
assert.equal(fireQuarantine.granaryNetwork.collectingGranaries, 0);
assert.equal(fireQuarantine.largestLossSite?.id, 'fire-hunter');
assert.equal(fireQuarantine.preservedFood.totalStock, 110);
assert.equal(fireQuarantine.preservedFood.usableStock, 20);
assert.equal(fireQuarantine.preservedFood.quarantinedStock, 90);
assert.ok(
  Math.abs(
    fireQuarantine.preservedFood.quarantinedSpoilagePerDay
    - PRESERVED_FOOD_SPOILAGE_PER_DAY
      * foodSpoilageMultiplier('preservedFood') * (
      20 * PRESERVED_FOOD_STORAGE_GRANARY_FACTOR
      + 30 * PRESERVED_FOOD_STORAGE_DEFAULT_BUILDING_FACTOR
      + 40 * PRESERVED_FOOD_STORAGE_RESIDENCE_FACTOR
    ),
  ) < 1e-9,
);
assert.ok(
  Math.abs(
    fireQuarantine.quarantinedSpoilagePerDay
    - ambientSpoilage * (
      20 * FRESH_FOOD_STORAGE_GRANARY_FACTOR
      + 30
    ),
  ) < 1e-9,
  'food in damaged buildings must remain in authoritative spoilage',
);
assert.ok(
  Math.abs(
    fireQuarantine.usableSpoilageFractionPerDay
    - ambientSpoilage * (
      (
        10 * FRESH_FOOD_STORAGE_TREASURY_FACTOR
        + 10 * FRESH_FOOD_STORAGE_MARKETPLACE_FACTOR
      ) / 20
    ),
  ) < 1e-9,
);
const fireQuarantineRows = renderFreshFoodPreservationRows(
  fireQuarantine,
  (kind) => kind,
  () => null,
);
assert.match(fireQuarantineRows, /Fire-quarantined food/);
assert.match(fireQuarantineRows, /90 inaccessible until recovery/);
assert.match(fireQuarantineRows, /every completed granary is fire-disabled/);
assert.match(fireQuarantineRows, /Fire-quarantined provisions/);
assert.match(fireQuarantineRows, /90 inaccessible until recovery/);

const residenceNeeds = readFileSync(
  new URL('../server/src/simulation/residence_needs/mod.rs', import.meta.url),
  'utf8',
);
const residenceFood = readFileSync(
  new URL('../server/src/simulation/residence_needs/food.rs', import.meta.url),
  'utf8',
);
const residenceProvisions = readFileSync(
  new URL('../server/src/simulation/residence_needs/provisions.rs', import.meta.url),
  'utf8',
);
const expandedEconomy = readFileSync(
  new URL('../server/src/simulation/expanded_economy.rs', import.meta.url),
  'utf8',
);
const buildingTable = readFileSync(
  new URL('../server/src/tables.rs', import.meta.url),
  'utf8',
);
const buildingReducers = readFileSync(
  new URL('../server/src/reducers/buildings.rs', import.meta.url),
  'utf8',
);
const generatedBuilding = readFileSync(
  new URL('../src/generated/building_table.ts', import.meta.url),
  'utf8',
);
const clientReducers = readFileSync(
  new URL('../src/data/spacetimeReducers.ts', import.meta.url),
  'utf8',
);
const granaryInspector = readFileSync(
  new URL('../src/resources/inspector/expandedBuildingRenderer.ts', import.meta.url),
  'utf8',
);
const townHallInspector = readFileSync(
  new URL('../src/resources/inspector/townHallRenderer.ts', import.meta.url),
  'utf8',
);
const serverFoodSpoilage = readFileSync(
  new URL('../server/src/simulation/food_spoilage.rs', import.meta.url),
  'utf8',
);
const deliveryTrips = readFileSync(
  new URL('../server/src/simulation/delivery_trips.rs', import.meta.url),
  'utf8',
);

assert.match(residenceFood, /pub fn spoil\(/);
assert.match(
  residenceNeeds,
  /general_consumption_paused[\s\S]*spoil_residence_food_inventory\(/,
  'household stores must keep spoiling outside consumption hours',
);
assert.match(
  expandedEconomy,
  /destination's logistics[\s\S]*producers never lose production labor to hauling[\s\S]*pub fn step_institutional_food_dispatch[\s\S]*try_start_building_supply_trip/,
  'food producers must centralize output without losing production labor or directly serving households',
);
assert.match(
  deliveryTrips,
  /fn ordinary_supply_labor_source[\s\S]*is_logistics_workplace\(&target\.kind\)[\s\S]*DeliveryLaborSource::Building\(target\.id\)/,
  'a staffed granary must supply the collection worker when it receives producer output',
);
assert.match(
  expandedEconomy,
  /target\.assigned_labor == 0[\s\S]*building_has_inbound_supply_trip/,
  'unstaffed processors must not request input carts',
);
assert.match(
  expandedEconomy,
  /"granary" if storage_accepts_commodity\(target, commodity\)[\s\S]*granary_fresh_food_target/,
  'granaries accepting the concrete fresh-food commodity must expose their selected intake target to producer-owned carts',
);
assert.match(buildingTable, /#\[default\(true\)\][\s\S]*pub granary_accepts_fresh_food: bool/);
assert.match(buildingReducers, /pub fn set_granary_policy\(/);
assert.match(generatedBuilding, /granaryAcceptsFreshFood:[\s\S]*granary_accepts_fresh_food/);
assert.match(clientReducers, /callReducer\('setGranaryPolicy', 'set_granary_policy'/);
assert.match(
  granaryInspector,
  /renderStorageAcceptanceControls\(building, GRANARY_STORAGE_GROUPS\)/,
  'granary fresh-food intake must use the granular accepted-goods controls rather than the removed all-or-nothing toggle',
);
assert.match(
  townHallInspector,
  /const freshFoodPreservationRows = renderFreshFoodPreservationRows\([\s\S]*\$\{freshFoodPreservationRows\}/,
  'the Town Hall must render the shared preservation diagnostic rows',
);
assert.match(townHallInspector, /data-inspect-building=/);
assert.match(townHallInspector, /data-inspect-residence=/);
assert.match(
  serverFoodSpoilage,
  /for mut building in ctx\.db\.building\(\)\.iter\(\)[\s\S]*building_fresh_food_stock[\s\S]*FRESH_FOOD_COMMODITIES[\s\S]*withdraw_building_commodity[\s\S]*building\(\)\.id\(\)\.update/,
  'damaged building stores remain in the server-wide fresh-food spoilage pass',
);
assert.match(
  serverFoodSpoilage,
  /weather_immune_building_ids[\s\S]*building\.kind == "founders_camp"[\s\S]*weather_immune_building_ids\.contains\(&building\.id\)[\s\S]*weather_immune_building_ids\.contains\(&trip\.building_id\)/,
  'the founding camp and its dispatched provisions must be immune to authoritative weather spoilage',
);
assert.match(
  serverFoodSpoilage,
  /delivery_trip\(\)[\s\S]*CommodityKind::from_u8[\s\S]*is_fresh_food\(\) \|\| kind\.is_preserved_food\(\)[\s\S]*PRESERVED_FOOD_STORAGE_CART_FACTOR[\s\S]*delivery_trip\(\)\.id\(\)\.update/,
  'loaded fresh and cured food must keep aging in the authoritative delivery row',
);
assert.match(
  serverFoodSpoilage,
  /preserved_food_spoilage_fraction_per_second\(\)[\s\S]*PRESERVED_FOOD_COMMODITIES[\s\S]*building_commodity_stock[\s\S]*preserved_rate[\s\S]*withdraw_building_commodity/,
  'every ordinary physical building store must lose cured provisions according to its storage quality',
);
assert.match(
  serverFoodSpoilage,
  /macro_rules! spoil_preserved[\s\S]*PRESERVED_FOOD_STORAGE_TREASURY_FACTOR[\s\S]*spoil_preserved!\(preserved_food,\s*CommodityKind::PreservedFood\)[\s\S]*spoil_preserved!\(cheese,\s*CommodityKind::Cheese\)/,
  'legacy compatibility stock must not become an immortal cured reserve',
);
assert.doesNotMatch(
  residenceProvisions,
  /pub fn spoil_preserved_food\(/,
  'typed household cured food must age through the unified residence inventory pass',
);
assert.match(
  residenceNeeds,
  /fn spoil_residence_food_inventory[\s\S]*preserved_food_spoilage_fraction_per_second[\s\S]*PRESERVED_FOOD_COMMODITIES[\s\S]*withdraw_residence_commodity[\s\S]*preserved_fraction/,
  'household cupboard stock must age even while ordinary consumption is paused',
);
assert.match(townHallInspector, /Cured-food aging/);
assert.match(townHallInspector, /Largest cured-food loss/);
assert.match(granaryInspector, /Cured-store aging/);

const perfState = emptyGameState();
for (let index = 0; index < 10_000; index += 1) {
  perfState.residences.set(`home-${index}`, residence(`home-${index}`, 12));
}
const started = performance.now();
const perfResult = analyzeFreshFoodPreservation(perfState, 0.018);
const elapsedMs = performance.now() - started;
assert.equal(perfResult.totalStock, 120_000);
assert.ok(elapsedMs < 250, `10,000-home preservation analysis took ${elapsedMs.toFixed(1)} ms`);

const granaryPerfState = emptyGameState();
const fireDisabledGranaries = new Set<string>();
for (let index = 0; index < 100_000; index += 1) {
  const granary = building(`granary-${index}`, 'granary', index % 341);
  granary.preservedFood = index % 181;
  granary.granaryFreshFoodTargetPercent = [25, 50, 75, 90][index % 4];
  granaryPerfState.buildings.set(granary.id, granary);
  if (index % 2 === 0) fireDisabledGranaries.add(granary.id);
}
const granaryStarted = performance.now();
const granaryPerfResult = analyzeFreshFoodPreservation(
  granaryPerfState,
  0.018,
  { fireDisabledBuildingIds: fireDisabledGranaries },
);
const granaryElapsedMs = performance.now() - granaryStarted;
assert.equal(granaryPerfResult.granaryNetwork.completedGranaries, 100_000);
assert.equal(granaryPerfResult.granaryNetwork.fireDisabledGranaries, 50_000);
assert.equal(granaryPerfResult.granaryNetwork.collectingGranaries, 50_000);
assert.ok(granaryPerfResult.preservedFood.totalStock > 0);
assert.ok(
  granaryElapsedMs < 500,
  `100,000-granary preservation diagnostics took ${granaryElapsedMs.toFixed(1)} ms`,
);

const cartPerfState = emptyGameState();
for (let index = 0; index < 100_000; index += 1) {
  const id = `food-cart-${index}`;
  cartPerfState.deliveryTrips.set(id, deliveryTrip(id, 'food', 6, 'outbound'));
}
const cartStarted = performance.now();
const cartPerfResult = analyzeFreshFoodPreservation(cartPerfState, 0.018);
const cartElapsedMs = performance.now() - cartStarted;
assert.equal(cartPerfResult.transitStock, 600_000);
assert.ok(
  cartElapsedMs < 500,
  `100,000-cart preservation diagnostics took ${cartElapsedMs.toFixed(1)} ms`,
);

console.log(
  `food preservation tests passed (${elapsedMs.toFixed(1)} ms for 10,000 homes; `
  + `${granaryElapsedMs.toFixed(1)} ms for 100,000 granaries; `
  + `${cartElapsedMs.toFixed(1)} ms for 100,000 carts)`,
);

function building(
  id: string,
  kind: BuildingState['kind'],
  food: number,
): BuildingState {
  return {
    id,
    kind,
    x: 0,
    z: 0,
    workRadius: 0,
    actionCooldown: 0,
    timber: 0,
    firewood: 0,
    stone: 0,
    water: 0,
    food,
    grain: 0,
    flour: 0,
    ale: 0,
    preservedFood: 0,
    honey: 0,
    wine: 0,
    polearms: 0,
    gold: 0,
    waterCapacity: 0,
    assignedLabor: 1,
    constructionComplete: true,
    constructionProgress: 1,
    constructionRequiredTimber: 0,
    constructionRequiredStone: 0,
    constructionDeliveredTimber: 0,
    constructionDeliveredStone: 0,
    constructionReservedTimber: 0,
    constructionReservedStone: 0,
    constructionTreasuryTimber: 0,
    constructionTreasuryStone: 0,
    storehouseAcceptsTimber: true,
    storehouseAcceptsStone: true,
    storehouseAcceptsFirewood: true,
    granaryAcceptsFreshFood: true,
  };
}

function residence(id: string, food: number): ResidenceState {
  return {
    id,
    zoneId: `zone-${id}`,
    parcelIndex: 0,
    x: 0,
    z: 0,
    yaw: 0,
    population: 1,
    populationCapacity: 1,
    tier: 1,
    settlementTicks: 0,
    food,
    preservedFood: 0,
    needs: {
      firewood: { stock: 0, deficitSeconds: 0 },
      water: { stock: 0, deficitSeconds: 0 },
      food: { stock: food, deficitSeconds: 0 },
      preservedFood: { stock: 0, deficitSeconds: 0 },
      ale: { stock: 0, deficitSeconds: 0 },
    },
    abandoned: false,
    householdWealth: 0,
  };
}

function deliveryTrip(
  id: string,
  cargoKind: DeliveryTripState['cargoKind'],
  amount: number,
  phase: DeliveryTripState['phase'],
): DeliveryTripState {
  return {
    id,
    buildingId: `origin-${id}`,
    residenceId: `destination-${id}`,
    destinationKind: 'residence',
    targetBuildingId: null,
    cargoKind,
    amount,
    phase,
    x: 0,
    z: 0,
    progress: 0,
    speedMps: 1.6,
    unloadSeconds: 2,
    unloadRemaining: 0,
    deliveryWorkers: 1,
    freeHaulerWorkers: 0,
    pathDistance: 100,
    travelSpeedMultiplier: 1,
    routePolylineJson: '[[0,0],[100,0]]',
  };
}

function emptyGameState(): GameState {
  return {
    seed: 1,
    tick: 0,
    stockpile: {
      timber: 0,
      stone: 0,
      firewood: 0,
      water: 0,
      game: 0,
      berries: 0,
      mushrooms: 0,
      fish: 0,
      food: 0,
      grain: 0,
      flour: 0,
      ale: 0,
      preservedFood: 0,
      honey: 0,
      wine: 0,
      polearms: 0,
      gold: 0,
    },
    quarries: new Map(),
    foragingNodes: new Map(),
    trees: new Map(),
    buildings: new Map(),
    farmFields: new Map(),
    pastures: new Map(),
    livestockHerds: new Map(),
    burgageZones: new Map(),
    residences: new Map(),
    backyardGardens: new Map(),
    deliveryTrips: new Map(),
    fireIncidents: new Map(),
    nextBuildingId: 1,
  };
}
