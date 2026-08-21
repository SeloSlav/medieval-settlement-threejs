import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  BUILDING_STORAGE_CAPS,
  CALENDAR_DAYS_PER_MONTH,
  MONASTERY_FEAST_ALE,
  MONASTERY_FEAST_FOOD,
  MONASTERY_FEAST_HONEY,
  MONASTERY_HOSPITALITY_BONUS_GOLD_PER_DAY,
  MONASTERY_HOSPITALITY_HONEY_PER_DAY,
  MONASTERY_HOSPITALITY_WINE_PER_DAY,
  MONASTERY_PILGRIMAGE_GOLD_PER_DAY,
  SPECIALTY_EXPORT_GOLD_PER_HONEY,
  SPECIALTY_EXPORT_GOLD_PER_WINE,
} from '../src/generated/gameBalance.ts';
import {
  MONASTERY_FEASTS,
  monasteryFeastReadiness,
  monasteryFeastSurplus,
  monasteryHospitalityPlan,
  monasteryHospitalityStatusLabel,
  nextMonasteryFeast,
} from '../src/economy/monasteryHospitality.ts';
import {
  isMonasteryFeastGatheringTime,
  monasteryFeastGatheringPoint,
  operationalFeastMonasteries,
} from '../src/settlement/monasteryFeast.ts';
import type { BuildingState } from '../src/resources/types.ts';
import { MONASTERY_EXTENSION_GUESTHOUSE } from '../src/buildings/monasteryEstate.ts';

const full = monasteryHospitalityPlan({ honey: 80, ale: 50, cider: 0, wine: 0 }, true);
assert.equal(full.supplyRatio, 1);
assert.equal(full.pilgrimageGoldPerDay, 3.5);
assert.equal(full.honeyRunwayDays, 95);
assert.equal(full.drinkRunwayDays, 80);
assert.equal(full.honeyPerYear, 308);
assert.equal(full.drinkPerYear, 230);
assert.equal(full.feastFoodPerYear, 90);
assert.equal(full.feastDrinkPerYear, 50);
assert.equal(full.commonTableMultiplier, 1.25);
assert.equal(monasteryHospitalityStatusLabel(full), 'Fully provisioned');

const wineHospitality = monasteryHospitalityPlan({ honey: 80, ale: 0, cider: 0, wine: 50 }, true);
assert.equal(wineHospitality.prestigeMultiplier, 1.25);
assert.equal(wineHospitality.pilgrimageGoldPerDay, 3.875);

const fundedGuesthouse = monasteryHospitalityPlan({
  honey: 80,
  ale: 50,
  cider: 0,
  wine: 0,
  monasteryExtensions: MONASTERY_EXTENSION_GUESTHOUSE,
  monasteryServiceFunding: 1,
}, true);
assert.ok(Math.abs(fundedGuesthouse.pilgrimageGoldPerDay - 4.725) < 1e-9);
const underfundedGuesthouse = monasteryHospitalityPlan({
  honey: 80,
  ale: 50,
  cider: 0,
  wine: 0,
  monasteryExtensions: MONASTERY_EXTENSION_GUESTHOUSE,
  monasteryServiceFunding: 0.5,
}, true);
assert.ok(Math.abs(underfundedGuesthouse.pilgrimageGoldPerDay - 3.23125) < 1e-9);
assert.equal(underfundedGuesthouse.supplyRatio, 0.5);
assert.equal(underfundedGuesthouse.honeyPerDay, 0.4);
assert.equal(underfundedGuesthouse.drinkPerDay, 0.25);

const mixedCellar = monasteryHospitalityPlan({ honey: 80, ale: 25, cider: 25, wine: 0 }, true);
assert.equal(mixedCellar.mixedCellar, true);
assert.equal(mixedCellar.prestigeMultiplier, 1.1);

const honeyOnly = monasteryHospitalityPlan({ honey: 8, ale: 0, cider: 0, wine: 0 }, true);
assert.equal(honeyOnly.supplyRatio, 0.5);
assert.equal(honeyOnly.pilgrimageGoldPerDay, 2.75);
assert.match(monasteryHospitalityStatusLabel(honeyOnly), /Partly provisioned/);

const protectedBatch = monasteryHospitalityPlan({
  honey: MONASTERY_FEAST_HONEY,
  ale: 0,
  cider: MONASTERY_FEAST_ALE,
  wine: 0,
}, true);
assert.equal(protectedBatch.supplyRatio, 0);
assert.equal(protectedBatch.honeyRunwayDays, 0);
assert.equal(protectedBatch.drinkRunwayDays, 0);
assert.equal(
  monasteryFeastSurplus(MONASTERY_FEAST_ALE + 2.5, MONASTERY_FEAST_ALE, true),
  2.5,
);
assert.equal(
  monasteryFeastSurplus(MONASTERY_FEAST_ALE, MONASTERY_FEAST_ALE, true),
  0,
);
assert.equal(
  monasteryFeastSurplus(MONASTERY_FEAST_ALE, MONASTERY_FEAST_ALE, false),
  MONASTERY_FEAST_ALE,
);

const disabled = monasteryHospitalityPlan({ honey: 80, ale: 0, cider: 0, wine: 50 }, false);
assert.equal(disabled.supplyRatio, 0);
assert.equal(disabled.pilgrimageGoldPerDay, MONASTERY_PILGRIMAGE_GOLD_PER_DAY);
assert.equal(disabled.honeyPerDay, 0);
assert.equal(disabled.drinkPerDay, 0);
assert.equal(disabled.honeyPerYear, 0);
assert.equal(disabled.drinkPerYear, 0);
assert.equal(disabled.feastFoodPerYear, 0);
assert.equal(disabled.feastDrinkPerYear, 0);
assert.match(monasteryHospitalityStatusLabel(disabled), /remain exportable/);

assert.equal(MONASTERY_FEAST_FOOD, 18);
assert.equal(MONASTERY_FEAST_ALE, 10);
assert.equal(MONASTERY_HOSPITALITY_HONEY_PER_DAY, 0.8);
assert.equal(MONASTERY_HOSPITALITY_WINE_PER_DAY, 0.5);
assert.equal(MONASTERY_FEAST_HONEY, 4);
assert.equal(BUILDING_STORAGE_CAPS.monastery.honey, 160);
assert.equal(BUILDING_STORAGE_CAPS.monastery.wine, 120);
assert.deepEqual(
  MONASTERY_FEASTS.map(({ month, monthDay }) => [month, monthDay]),
  [[1, 6], [6, 29], [8, 15], [9, 14], [12, 25]],
  'all five observances must map onto their familiar dates in the 30-day calendar',
);
assert.ok(
  MONASTERY_FEASTS.every(({ monthDay }) =>
    monthDay >= 1 && monthDay <= CALENDAR_DAYS_PER_MONTH
  ),
);

const readyFeast = monasteryFeastReadiness({
  food: MONASTERY_FEAST_FOOD,
  ale: 0,
  cider: MONASTERY_FEAST_ALE,
  honey: MONASTERY_FEAST_HONEY,
  wine: 0,
});
assert.equal(readyFeast.ready, true);
const shortFeast = monasteryFeastReadiness({
  food: 17,
  ale: 8,
  cider: 0,
  honey: 1.5,
  wine: 0,
});
assert.deepEqual(shortFeast, {
  ready: false,
  missingFood: 1,
  missingHoney: 2.5,
  missingDrink: 2,
  drinkMix: 'ale',
});

const beforeSaintsPeterAndPaul = nextMonasteryFeast({
  month: 6,
  monthDay: 29,
  hour: 11,
  minute: 0,
});
assert.equal(beforeSaintsPeterAndPaul.name, 'Saints Peter and Paul');
assert.ok(Math.abs(beforeSaintsPeterAndPaul.daysUntil - 1 / 24) < 1e-9);
const afterSaintsPeterAndPaul = nextMonasteryFeast({
  month: 6,
  monthDay: 29,
  hour: 12,
  minute: 0,
});
assert.equal(afterSaintsPeterAndPaul.name, 'Assumption');
assert.equal(afterSaintsPeterAndPaul.daysUntil, 46);
assert.equal(
  isMonasteryFeastGatheringTime(
    {
      month: 6,
      monthDay: 29,
      hour: 12,
      minute: 0,
    },
    true,
    true,
  ),
  true,
  'an enabled policy and a reachable monastery should open the visible feast gathering',
);
assert.equal(
  isMonasteryFeastGatheringTime(
    {
      month: 6,
      monthDay: 29,
      hour: 12,
      minute: 0,
    },
    false,
    true,
  ),
  false,
  'disabling monastery feasts must also cancel the civilian gathering',
);
const feastHouse = {
  id: 'feast-house',
  kind: 'monastery',
  constructionComplete: true,
  assignedLabor: 1,
} as BuildingState;
assert.equal(operationalFeastMonasteries([feastHouse]).length, 1);
assert.equal(
  operationalFeastMonasteries([{ ...feastHouse, assignedLabor: 0 }]).length,
  0,
  'a monastery without monks must not summon a visible feast gathering',
);
const feastGatheringA = monasteryFeastGatheringPoint(
  { x: 40, z: -12 },
  'feast-guest:a',
);
const feastGatheringB = monasteryFeastGatheringPoint(
  { x: 40, z: -12 },
  'feast-guest:b',
);
assert.notDeepEqual(feastGatheringA, feastGatheringB);
for (const point of [feastGatheringA, feastGatheringB]) {
  const distance = Math.hypot(point.x - 40, point.z + 12);
  assert.ok(
    distance >= 10.7 && distance <= 13.3,
    'feast guests must gather outside the monastery footprint rather than inside its mesh',
  );
}
assert.equal(
  MONASTERY_PILGRIMAGE_GOLD_PER_DAY + MONASTERY_HOSPITALITY_BONUS_GOLD_PER_DAY,
  3.5,
  'full hospitality must preserve the previous pilgrimage yield',
);
const exportOpportunityCost =
  MONASTERY_HOSPITALITY_HONEY_PER_DAY * SPECIALTY_EXPORT_GOLD_PER_HONEY
  + MONASTERY_HOSPITALITY_WINE_PER_DAY * SPECIALTY_EXPORT_GOLD_PER_WINE;
assert.ok(
  Math.abs(exportOpportunityCost - 1.44) < 1e-9
  && MONASTERY_HOSPITALITY_BONUS_GOLD_PER_DAY > exportOpportunityCost,
  'hospitality should narrowly beat direct export before cart and staffing costs',
);

const server = fs.readFileSync('server/src/simulation/expanded_economy.rs', 'utf8');
const residenceNeedsServer = fs.readFileSync(
  'server/src/simulation/residence_needs/mod.rs',
  'utf8',
);
const tickContext = fs.readFileSync(
  'server/src/simulation/tick_context.rs',
  'utf8',
);
const landmarkAccess = fs.readFileSync(
  'server/src/simulation/landmark_access.rs',
  'utf8',
);
const rustHospitalityPolicy = fs.readFileSync(
  'server/src/monastery_hospitality_policy.rs',
  'utf8',
);
const rustFeastSchedule = rustHospitalityPolicy
  .match(/MONASTERY_FEAST_DATES[\s\S]*?=\s*\[([\s\S]*?)\];/)?.[1]
  ?.matchAll(/\((\d+),\s*(\d+)\)/g);
assert.ok(rustFeastSchedule, 'the authoritative Rust feast schedule must remain readable');
assert.deepEqual(
  [...rustFeastSchedule].map((match) => [Number(match[1]), Number(match[2])]),
  MONASTERY_FEASTS.map(({ month, monthDay }) => [month, monthDay]),
  'client deadlines must exactly mirror the authoritative feast schedule',
);
assert.doesNotMatch(
  server,
  /dispatch_monastery_hospitality|dispatch_monastery_feast_ale/,
  'monastery hospitality must be provisioned by the enclosed estate, not town producers',
);
assert.match(
  server,
  /step_apiary[\s\S]*?apiary_honey_reserve[\s\S]*?&\["brewery"\][\s\S]*?&\["marketplace"\][\s\S]*?&\["trading_post"\]/,
  'apiaries must protect their hive reserve, then serve the ordinary town economy',
);
assert.match(
  server,
  /fn advance_monastery_vineyard_fermentation[\s\S]*?deposit_building_commodity\([\s\S]*?CommodityKind::Wine/,
  'the monastery vineyard must ferment physical grapes into physical wine',
);
assert.match(
  server,
  /fn dispatch_monastery_vineyard_wine[\s\S]*?&\["granary"\][\s\S]*?storage_accepts_commodity\(granary, CommodityKind::Wine\)/,
  'estate wine must enter only granaries that the player allows to store wine',
);
assert.match(
  server,
  /step_institutional_food_dispatch[\s\S]*?INSTITUTIONAL_FOOD_SOURCE_KINDS[\s\S]*?&\["guardhouse", "smokehouse", "granary"\]/,
  'apiary honey and vineyard wine must enter staffed storage or institutional supply instead of going directly to homes',
);
assert.match(
  server,
  /monastery_hospitality_use\([\s\S]*?withdraw_building_commodity\([\s\S]*?CommodityKind::Honey[\s\S]*?CommodityKind::Wine[\s\S]*?monastery_pilgrimage_gold/,
  'pilgrimage income must consume authoritative physical hospitality stores',
);
assert.match(
  rustHospitalityPolicy,
  /monastery_hospitality_use[\s\S]*?monastery_feast_surplus\([\s\S]*?MONASTERY_FEAST_HONEY[\s\S]*?monastery_feast_surplus\([\s\S]*?MONASTERY_FEAST_ALE[\s\S]*?draw_estate_drink/,
  'daily hospitality must consume honey and aggregate estate drink only above the protected feast batch',
);
assert.match(
  server,
  /step_brewery[\s\S]*?for beverage in \[[\s\S]*?CommodityKind::Cider,[\s\S]*?CommodityKind::PearCider,[\s\S]*?CommodityKind::Ale,[\s\S]*?CommodityKind::Mead,[\s\S]*?&\["tavern"\][\s\S]*?CommodityKind::Ale,[\s\S]*?&\["trading_post"\]/,
  'town breweries must serve taverns and external trade without refilling monastery stores',
);
assert.doesNotMatch(
  server,
  /fn dispatch_monastery_covered_need/,
  'monasteries must not bypass depot-owned stalls with routine household deliveries',
);
assert.match(
  server,
  /is_monastery_feast_day[\s\S]*?tick\.monastery_for_residence\([\s\S]*?== Some\(monastery\.id\)[\s\S]*?if residences\.is_empty\(\)[\s\S]*?monastery_feast_batch[\s\S]*?monastery\.ale[\s\S]*?monastery\.cider[\s\S]*?monastery\.honey[\s\S]*?monastery\.wine[\s\S]*?if !batch\.ready/,
  'reachable feast days must serve only this monastery territory and require food, honey, and one complete aggregate drink batch before any withdrawal',
);
const feastSource = server.slice(
  server.indexOf('fn run_monastery_feast'),
  server.indexOf('fn owner_has_connected_marketplace'),
);
assert.doesNotMatch(
  feastSource,
  /road_path_distance/,
  'feast recipients must reuse the cached monastery territory rather than solving every household route again',
);
assert.match(
  server,
  /fn monastery_has_parish_link[\s\S]*?building_disabled_by_fire\(ctx, building\.id\)[\s\S]*?monastery_linked_to_chapel/,
  'a fire-disabled chapel must not keep monastery production or hospitality linked',
);
assert.doesNotMatch(
  feastSource,
  /apply_need_delivery/,
  'a communal meal at the monastery must never teleport pantry stock into homes',
);
assert.match(
  feastSource,
  /apply_need_consumed_at_source[\s\S]*?ResidenceNeedKind::Food[\s\S]*?home\.tier >= 2[\s\S]*?ResidenceNeedKind::Ale/,
  'covered homes must receive immediate meal relief while prosperous households share feast ale onsite',
);
assert.match(
  feastSource,
  /owner_has_active_raider_threat[\s\S]*?monastery_feast_batch[\s\S]*?withdraw_building_commodity/,
  'a live hostile incursion must preserve the feast pantry instead of consuming it during combat',
);
assert.match(
  residenceNeedsServer,
  /apply_need_consumed_at_source[\s\S]*?need_relief_without_delivery[\s\S]*?deficit_ticks:\s*0[\s\S]*?\.\.\*need/,
  'onsite consumption must clear the deficit while preserving existing household stock exactly',
);
assert.match(
  tickContext,
  /monastery_hospitality_by_owner[\s\S]*?pub fn monastery_hospitality_enabled/,
  'one policy read per owner and simulation substep must serve all specialist buildings',
);
const foodClaimsSource = tickContext.slice(
  tickContext.indexOf('fn build_food_claims'),
  tickContext.indexOf('pub(crate) fn marketplace_has_stall_workers'),
);
assert.doesNotMatch(
  foodClaimsSource,
  /monastery|monastery_feast_surplus|MONASTERY_FEAST_FOOD/,
  'ordinary household food claims must never treat a monastery pantry as a supplier',
);
assert.match(
  foodClaimsSource,
  /is_food_supplier_operational[\s\S]*?marketplace_has_stall_workers[\s\S]*?building_edible_food_stock/,
  'ordinary household food claims must remain limited to operational stocked Marketplace routes',
);
assert.match(
  tickContext,
  /monastery_claims[\s\S]*?pub fn monastery_for_residence[\s\S]*?build_monastery_claims[\s\S]*?building_disabled_by_fire[\s\S]*?claim_residences_by_nearest_supplier[\s\S]*?MONASTERY_COVERAGE_RADIUS/,
  'one fire-safe, batched nearest-monastery territory must serve the whole authoritative substep',
);
assert.match(
  landmarkAccess,
  /monastery_for_residence\(ctx, owner, residence\.id\)/,
  'community coverage must delegate to the shared authoritative monastery claim',
);
assert.doesNotMatch(
  fs.readFileSync('src/resources/WorldQueries.ts', 'utf8'),
  /getNextMonasteryHospitalityTarget|getNextMonasteryFeastAleTarget|monasteryFeastRefillShortfall/,
  'client forecasts must not advertise town-to-monastery hospitality routes removed by the server',
);
assert.match(
  fs.readFileSync('src/resources/inspector/expandedBuildingRenderer.ts', 'utf8'),
  /Next feast[\s\S]*?Feast pantry[\s\S]*?one complete batch protected[\s\S]*?Annual hospitality[\s\S]*?Pilgrimage offerings[\s\S]*?Provision hospitality and feast days/,
  'the monastery inspector must expose the next deadline, reserve readiness, annual targets, income, and export tradeoff',
);
assert.match(
  fs.readFileSync('src/resources/inspector/townHallRenderer.ts', 'utf8'),
  /getResidenceCommunityLandmarkClaims[\s\S]*?communityForResidence[\s\S]*?growthCommunityClaims\.monasteries\.has[\s\S]*?Monastery hospitality[\s\S]*?annual target[\s\S]*?Next feast reserve/,
  'the settlement ledger must use bulk community claims and expose aggregate hospitality and feast-reserve planning',
);

const performanceStarted = performance.now();
let checksum = 0;
for (let index = 0; index < 100_000; index += 1) {
  checksum += monasteryHospitalityPlan(
    { honey: index % 160, ale: index % 80, cider: index % 40, wine: index % 120 },
    true,
  ).pilgrimageGoldPerDay;
  checksum += monasteryFeastReadiness({
    food: index % 320,
    ale: index % 160,
    cider: index % 80,
    honey: index % 160,
    wine: index % 120,
  }).missingFood;
}
const performanceElapsed = performance.now() - performanceStarted;
assert.ok(checksum > 0);
assert.ok(
  performanceElapsed < 250,
  `100k monastery hospitality projections regressed (${performanceElapsed.toFixed(1)} ms)`,
);

console.log(
  `monastery hospitality tests passed (${performanceElapsed.toFixed(1)} ms for 100k projections)`,
);
