import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  BUILDING_STORAGE_CAPS,
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
  monasteryHospitalityPlan,
  monasteryHospitalityStatusLabel,
} from '../src/economy/monasteryHospitality.ts';

const full = monasteryHospitalityPlan({ honey: 80, wine: 50 }, true);
assert.equal(full.supplyRatio, 1);
assert.equal(full.pilgrimageGoldPerDay, 3.5);
assert.equal(full.honeyRunwayDays, 100);
assert.equal(full.wineRunwayDays, 100);
assert.equal(full.honeyPerYear, 116);
assert.equal(full.winePerYear, 75);
assert.equal(monasteryHospitalityStatusLabel(full), 'Fully provisioned');

const honeyOnly = monasteryHospitalityPlan({ honey: 8, wine: 0 }, true);
assert.equal(honeyOnly.supplyRatio, 0.5);
assert.equal(honeyOnly.pilgrimageGoldPerDay, 2.75);
assert.match(monasteryHospitalityStatusLabel(honeyOnly), /Partly provisioned/);

const disabled = monasteryHospitalityPlan({ honey: 80, wine: 50 }, false);
assert.equal(disabled.supplyRatio, 0);
assert.equal(disabled.pilgrimageGoldPerDay, MONASTERY_PILGRIMAGE_GOLD_PER_DAY);
assert.equal(disabled.honeyPerDay, 0);
assert.equal(disabled.winePerDay, 0);
assert.equal(disabled.honeyPerYear, 0);
assert.equal(disabled.winePerYear, 0);
assert.match(monasteryHospitalityStatusLabel(disabled), /remain exportable/);

assert.equal(MONASTERY_HOSPITALITY_HONEY_PER_DAY, 0.8);
assert.equal(MONASTERY_HOSPITALITY_WINE_PER_DAY, 0.5);
assert.equal(MONASTERY_FEAST_HONEY, 4);
assert.equal(MONASTERY_FEAST_WINE, 3);
assert.equal(BUILDING_STORAGE_CAPS.monastery.honey, 160);
assert.equal(BUILDING_STORAGE_CAPS.monastery.wine, 120);
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
  server,
  /withdraw_building_commodity\(monastery, CommodityKind::Honey, MONASTERY_FEAST_HONEY\)[\s\S]*?withdraw_building_commodity\(monastery, CommodityKind::Wine, MONASTERY_FEAST_WINE\)/,
  'fixed feast days must create visible seasonal reserve draws',
);
assert.match(
  fs.readFileSync('server/src/simulation/tick_context.rs', 'utf8'),
  /monastery_hospitality_by_owner[\s\S]*?pub fn monastery_hospitality_enabled/,
  'one policy read per owner and simulation substep must serve all specialist buildings',
);
assert.match(
  fs.readFileSync('src/resources/WorldQueries.ts', 'utf8'),
  /getNextMonasteryHospitalityTarget[\s\S]*?isMonasteryLinkedToChapel[\s\S]*?getInboundSupplyTrip/,
  'client logistics must mirror linked-target and in-flight-cart eligibility',
);
assert.match(
  fs.readFileSync('src/resources/inspector/expandedBuildingRenderer.ts', 'utf8'),
  /Annual hospitality[\s\S]*?Pilgrimage income[\s\S]*?Provision hospitality and feast days/,
  'the monastery inspector must expose annual stock targets, income, and the export tradeoff',
);
assert.match(
  fs.readFileSync('src/resources/inspector/townHallRenderer.ts', 'utf8'),
  /Monastery hospitality[\s\S]*?annual target/,
  'the settlement ledger must expose aggregate hospitality planning',
);

const performanceStarted = performance.now();
let checksum = 0;
for (let index = 0; index < 100_000; index += 1) {
  checksum += monasteryHospitalityPlan(
    { honey: index % 160, wine: index % 120 },
    true,
  ).pilgrimageGoldPerDay;
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
