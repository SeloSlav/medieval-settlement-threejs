import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  BUILDING_KINDS,
  BUILDING_STORAGE_CAPS,
} from '../src/generated/gameBalance.ts';

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

assert.equal(
  BUILDING_KINDS.includes('vineyard' as never),
  false,
  'a vineyard must not exist as a standalone building kind',
);
assert.equal(BUILDING_STORAGE_CAPS.granary.wine, 2500);
assert.equal(BUILDING_STORAGE_CAPS.marketplace.wine, 72);

const placement = source('server/src/reducers/vineyards.rs');
assert.match(placement, /pub fn place_vineyard\([\s\S]*monastery_id: u64/);
assert.match(placement, /monastery\.kind != "monastery"/);
assert.doesNotMatch(placement, /already has a vineyard extension/);
assert.match(placement, /VINEYARD_MONASTERY_MAX_DISTANCE/);
assert.doesNotMatch(placement, /VINEYARD_MONASTERY_ADJACENCY_DISTANCE/);
assert.match(placement, /id: 0/);
assert.match(placement, /building_id: monastery_id/);
assert.doesNotMatch(placement, /place_building_internal/);

const tables = source('server/src/tables.rs');
assert.match(tables, /accessor = vineyard_parcel[\s\S]*index\(accessor = building_id[\s\S]*#\[auto_inc\][\s\S]*pub id: u64/);

const economy = source('server/src/simulation/expanded_economy.rs');
assert.match(economy, /fn advance_monastery_vineyard_fermentation/);
assert.match(economy, /vineyard_parcel\(\)[\s\S]{0,100}\.building_id\(\)[\s\S]{0,60}\.filter\(&monastery\.id\)/);
assert.match(economy, /let \(vineyard_area, vineyard_site, vineyard_shape, vineyard_pollination\)[\s\S]*\.fold\(/);
assert.match(economy, /production_multiplier\([\s\S]*vineyard_area[\s\S]*vineyard_site \/ vineyard_area/);
assert.match(economy, /onsite_building_labor\(ctx, monastery\)/);
assert.match(economy, /fn dispatch_monastery_vineyard_wine/);
assert.match(economy, /&\["granary"\]/);
assert.match(economy, /try_start_origin_rostered_building_supply_trip/);
assert.match(economy, /CommodityKind::Wine/);
assert.doesNotMatch(
  economy.match(/let export_candidates = \[[\s\S]*?\];/)?.[0] ?? '',
  /CommodityKind::Wine/,
  'monastery wine must enter the town rather than disappear into regional exports',
);

const trips = source('server/src/simulation/delivery_trips.rs');
assert.match(trips, /pub fn try_start_origin_rostered_building_supply_trip/);
assert.match(trips, /LaborSource::Building\(origin\.id\)/);

const cargo = source('server/src/simulation/delivery_cargo.rs');
const tavernCargo = cargo.match(/for beverage in \[[\s\S]*?\] \{/)?.[0] ?? '';
assert.match(tavernCargo, /CommodityKind::Cider[\s\S]*CommodityKind::PearCider[\s\S]*CommodityKind::Ale/);
assert.doesNotMatch(tavernCargo, /CommodityKind::Wine/);
assert.match(cargo, /ResidenceNeedKind::Luxury => building\.candles \+ building\.wine \+ building\.honey/);
assert.match(
  cargo,
  /ResidenceNeedKind::Luxury => \{[\s\S]*CommodityKind::Wine[\s\S]*CommodityKind::Honey/,
);

const householdDistribution = source('server/src/simulation/household_distribution.rs');
assert.match(householdDistribution, /MARKET_NEEDS[\s\S]*ResidenceNeedKind::Luxury/);
const tickContext = source('server/src/simulation/tick_context.rs');
assert.match(tickContext, /CommodityKind::Wine => Some\(ResidenceNeedKind::Luxury\)/);
const needKinds = source('server/src/simulation/residence_needs/kinds.rs');
assert.match(needKinds, /Self::PreservedFood \| Self::Pottery \| Self::Luxury => tier >= 4/);

const buildMenu = source('src/ui/buildMenuCards.ts');
assert.doesNotMatch(buildMenu, /entry\('vineyard'\)/);
const inspector = source('src/resources/inspector/expandedBuildingRenderer.ts');
assert.match(inspector, /data-land-parcel="vineyard"/);
assert.match(inspector, /Add vineyard parcel/);
assert.match(inspector, /Monks harvest vineyard grapes in September and October/);
assert.match(inspector, /press and ferment them into wine for hospitality and sale/);
assert.doesNotMatch(inspector, /data-vineyard-production-policy/);
assert.doesNotMatch(inspector, /data-monastery-croft-choice|apple-versus-pear[^<]*button/);
const app = source('src/app/appBootstrap.ts');
assert.match(app, /beginLinkedLandParcelPlacement\('vineyard', monasteryId\)/);

const workers = source('src/settlement/workerPaths.ts');
assert.match(workers, /vineyardParcels\?: Iterable<VineyardParcelState>/);
assert.match(workers, /parcel\.monasteryId === building\.id/);
assert.match(workers, /:monastery:vineyard:\$\{parcel\.id\}:center/);
assert.match(workers, /id: 'mead-brewhouse'/);
assert.match(workers, /id: 'vintner'[\s\S]*requiresVineyard: true/);

console.log('monastery vineyard extension, monk cart, market wine, and Tier 4 luxury checks passed');
