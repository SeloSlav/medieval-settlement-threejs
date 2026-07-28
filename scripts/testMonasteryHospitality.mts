import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  BUILDING_STORAGE_CAPS,
  CALENDAR_DAYS_PER_MONTH,
  MONASTERY_FEAST_ALE,
  MONASTERY_FEAST_FOOD,
  MONASTERY_FEAST_HONEY,
  MONASTERY_FEAST_WINE,
  MONASTERY_HOSPITALITY_BONUS_GOLD_PER_DAY,
  MONASTERY_HOSPITALITY_HONEY_PER_DAY,
  MONASTERY_HOSPITALITY_WINE_PER_DAY,
  MONASTERY_PILGRIMAGE_GOLD_PER_DAY,
  SPECIALTY_EXPORT_GOLD_PER_HONEY,
  SPECIALTY_EXPORT_GOLD_PER_WINE,
} from '../src/generated/gameBalance.ts';
import {
  MONASTERY_FEASTS,
  monasteryFeastRefillShortfall,
  monasteryFeastReadiness,
  monasteryFeastSurplus,
  monasteryHospitalityPlan,
  monasteryHospitalityStatusLabel,
  nextMonasteryFeast,
} from '../src/economy/monasteryHospitality.ts';

const full = monasteryHospitalityPlan({ honey: 80, wine: 50 }, true);
assert.equal(full.supplyRatio, 1);
assert.equal(full.pilgrimageGoldPerDay, 3.5);
assert.equal(full.honeyRunwayDays, 95);
assert.equal(full.wineRunwayDays, 94);
assert.equal(full.honeyPerYear, 116);
assert.equal(full.winePerYear, 75);
assert.equal(full.feastFoodPerYear, 90);
assert.equal(full.feastAlePerYear, 50);
assert.equal(monasteryHospitalityStatusLabel(full), 'Fully provisioned');

const honeyOnly = monasteryHospitalityPlan({ honey: 8, wine: 0 }, true);
assert.equal(honeyOnly.supplyRatio, 0.5);
assert.equal(honeyOnly.pilgrimageGoldPerDay, 2.75);
assert.match(monasteryHospitalityStatusLabel(honeyOnly), /Partly provisioned/);

const protectedBatch = monasteryHospitalityPlan({
  honey: MONASTERY_FEAST_HONEY,
  wine: MONASTERY_FEAST_WINE,
}, true);
assert.equal(protectedBatch.supplyRatio, 0);
assert.equal(protectedBatch.honeyRunwayDays, 0);
assert.equal(protectedBatch.wineRunwayDays, 0);
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
assert.equal(
  monasteryFeastRefillShortfall(4, 2, MONASTERY_FEAST_ALE, true),
  4,
);
assert.equal(
  monasteryFeastRefillShortfall(4, 2, MONASTERY_FEAST_ALE, false),
  0,
);

const disabled = monasteryHospitalityPlan({ honey: 80, wine: 50 }, false);
assert.equal(disabled.supplyRatio, 0);
assert.equal(disabled.pilgrimageGoldPerDay, MONASTERY_PILGRIMAGE_GOLD_PER_DAY);
assert.equal(disabled.honeyPerDay, 0);
assert.equal(disabled.winePerDay, 0);
assert.equal(disabled.honeyPerYear, 0);
assert.equal(disabled.winePerYear, 0);
assert.equal(disabled.feastFoodPerYear, 0);
assert.equal(disabled.feastAlePerYear, 0);
assert.match(monasteryHospitalityStatusLabel(disabled), /remain exportable/);

assert.equal(MONASTERY_FEAST_FOOD, 18);
assert.equal(MONASTERY_FEAST_ALE, 10);
assert.equal(MONASTERY_HOSPITALITY_HONEY_PER_DAY, 0.8);
assert.equal(MONASTERY_HOSPITALITY_WINE_PER_DAY, 0.5);
assert.equal(MONASTERY_FEAST_HONEY, 4);
assert.equal(MONASTERY_FEAST_WINE, 3);
assert.equal(BUILDING_STORAGE_CAPS.monastery.honey, 160);
assert.equal(BUILDING_STORAGE_CAPS.monastery.wine, 120);
assert.deepEqual(
  MONASTERY_FEASTS.map(({ month, monthDay }) => [month, monthDay]),
  [[1, 2], [6, 10], [8, 5], [9, 5], [12, 9]],
  'all five observances must map onto reachable dates in the ten-day calendar',
);
assert.ok(
  MONASTERY_FEASTS.every(({ monthDay }) =>
    monthDay >= 1 && monthDay <= CALENDAR_DAYS_PER_MONTH
  ),
);

const readyFeast = monasteryFeastReadiness({
  food: MONASTERY_FEAST_FOOD,
  ale: MONASTERY_FEAST_ALE,
  honey: MONASTERY_FEAST_HONEY,
  wine: MONASTERY_FEAST_WINE,
});
assert.equal(readyFeast.ready, true);
const shortFeast = monasteryFeastReadiness({
  food: 17,
  ale: 8,
  honey: 1.5,
  wine: 0,
});
assert.deepEqual(shortFeast, {
  ready: false,
  missingFood: 1,
  missingAle: 2,
  missingHoney: 2.5,
  missingWine: 3,
});

const beforeSaintsPeterAndPaul = nextMonasteryFeast({
  month: 6,
  monthDay: 10,
  hour: 11,
  minute: 0,
});
assert.equal(beforeSaintsPeterAndPaul.name, 'Saints Peter and Paul');
assert.ok(Math.abs(beforeSaintsPeterAndPaul.daysUntil - 1 / 24) < 1e-9);
const afterSaintsPeterAndPaul = nextMonasteryFeast({
  month: 6,
  monthDay: 10,
  hour: 12,
  minute: 0,
});
assert.equal(afterSaintsPeterAndPaul.name, 'Assumption');
assert.equal(afterSaintsPeterAndPaul.daysUntil, 15);
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
assert.match(
  server,
  /dispatch_need\([\s\S]*?ResidenceNeedKind::Food[\s\S]*?dispatch_monastery_hospitality\([\s\S]*?CommodityKind::Honey[\s\S]*?dispatch_to_building\([\s\S]*?CommodityKind::Honey[\s\S]*?&\["marketplace"\]/,
  'apiaries must serve household food, then monastery hospitality, then export',
);
assert.match(
  server,
  /dispatch_monastery_hospitality\([\s\S]*?CommodityKind::Wine[\s\S]*?dispatch_to_building\([\s\S]*?CommodityKind::Wine[\s\S]*?&\["marketplace"\]/,
  'vineyards must supply monastery hospitality before export',
);
assert.match(
  server,
  /monastery_hospitality_use\([\s\S]*?withdraw_building_commodity\([\s\S]*?CommodityKind::Honey[\s\S]*?CommodityKind::Wine[\s\S]*?monastery_pilgrimage_gold/,
  'pilgrimage income must consume authoritative physical hospitality stores',
);
assert.match(
  rustHospitalityPolicy,
  /monastery_hospitality_use[\s\S]*?monastery_feast_surplus\([\s\S]*?MONASTERY_FEAST_HONEY[\s\S]*?monastery_feast_surplus\([\s\S]*?MONASTERY_FEAST_WINE/,
  'daily hospitality must consume only specialty stock above the protected feast batch',
);
assert.match(
  server,
  /step_brewery[\s\S]*?dispatch_monastery_feast_ale[\s\S]*?dispatch_need\([\s\S]*?ResidenceNeedKind::Ale[\s\S]*?dispatch_to_building\([\s\S]*?CommodityKind::Ale[\s\S]*?&\["marketplace"\]/,
  'brewery ale must refill the bounded feast floor before household delivery and export',
);
assert.match(
  server,
  /fn dispatch_monastery_feast_ale[\s\S]*?monastery_hospitality_enabled[\s\S]*?monastery_has_parish_link[\s\S]*?building_has_inbound_supply_trip[\s\S]*?monastery_feast_refill_shortfall[\s\S]*?MONASTERY_FEAST_ALE/,
  'feast staging must require the policy, a parish link, no duplicate inbound cart, and an exact one-batch shortfall',
);
assert.match(
  server,
  /fn dispatch_monastery_covered_need[\s\S]*?CommodityKind::Food => MONASTERY_FEAST_FOOD[\s\S]*?CommodityKind::Ale => MONASTERY_FEAST_ALE[\s\S]*?monastery_feast_surplus[\s\S]*?per_delivery\.min\(available\)/,
  'routine monastery food and ale carts must not withdraw the protected batch',
);
assert.match(
  server,
  /is_monastery_feast_day[\s\S]*?distance <= MONASTERY_COVERAGE_RADIUS[\s\S]*?if residences\.is_empty\(\)[\s\S]*?monastery_feast_batch[\s\S]*?if !batch\.ready[\s\S]*?MONASTERY_FEAST_FOOD[\s\S]*?MONASTERY_FEAST_ALE[\s\S]*?MONASTERY_FEAST_HONEY[\s\S]*?MONASTERY_FEAST_WINE/,
  'reachable feast days must require eligible nearby homes and a complete physical batch before any withdrawal',
);
assert.match(
  server,
  /let prosperous_homes[\s\S]*?MONASTERY_FEAST_ALE \/ prosperous_homes as f64[\s\S]*?home\.tier >= 3[\s\S]*?ResidenceNeedKind::Ale/,
  'feast ale must be divided only among the homes that can receive it',
);
assert.match(
  fs.readFileSync('server/src/simulation/tick_context.rs', 'utf8'),
  /monastery_hospitality_by_owner[\s\S]*?pub fn monastery_hospitality_enabled/,
  'one policy read per owner and simulation substep must serve all specialist buildings',
);
assert.match(
  fs.readFileSync('server/src/simulation/tick_context.rs', 'utf8'),
  /build_specialty_claims[\s\S]*?monastery_feast_surplus\([\s\S]*?MONASTERY_FEAST_ALE[\s\S]*?build_food_claims[\s\S]*?monastery_feast_surplus\([\s\S]*?MONASTERY_FEAST_FOOD/,
  'authoritative household claims must ignore monastery stock held by the feast floor',
);
assert.match(
  fs.readFileSync('src/resources/WorldQueries.ts', 'utf8'),
  /getNextMonasteryHospitalityTarget[\s\S]*?isMonasteryLinkedToChapel[\s\S]*?getInboundSupplyTrip/,
  'client logistics must mirror linked-target and in-flight-cart eligibility',
);
assert.match(
  fs.readFileSync('src/resources/WorldQueries.ts', 'utf8'),
  /getNextMonasteryFeastAleTarget[\s\S]*?monasteryFeastRefillShortfall[\s\S]*?getInboundSupplyTrip/,
  'client brewery forecasts must mirror the bounded authoritative feast target',
);
assert.match(
  fs.readFileSync('src/resources/inspector/expandedBuildingRenderer.ts', 'utf8'),
  /Next feast[\s\S]*?Feast pantry[\s\S]*?one complete batch protected[\s\S]*?Annual hospitality[\s\S]*?Pilgrimage income[\s\S]*?Provision hospitality and feast days/,
  'the monastery inspector must expose the next deadline, reserve readiness, annual targets, income, and export tradeoff',
);
assert.match(
  fs.readFileSync('src/resources/inspector/townHallRenderer.ts', 'utf8'),
  /Monastery hospitality[\s\S]*?annual target[\s\S]*?Next feast reserve/,
  'the settlement ledger must expose aggregate hospitality and feast-reserve planning',
);

const performanceStarted = performance.now();
let checksum = 0;
for (let index = 0; index < 100_000; index += 1) {
  checksum += monasteryHospitalityPlan(
    { honey: index % 160, wine: index % 120 },
    true,
  ).pilgrimageGoldPerDay;
  checksum += monasteryFeastReadiness({
    food: index % 320,
    ale: index % 160,
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
