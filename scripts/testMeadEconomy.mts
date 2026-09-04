import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import {
  BREWERY_RECIPE_AUTO,
  BREWERY_RECIPE_MEAD,
  breweryPolicyOutput,
  selectedBreweryRecipePolicy,
} from '../src/economy/breweryRecipePolicy.ts';
import {
  BREWERY_HONEY_PER_MEAD_CYCLE,
  BREWERY_MEAD_PER_CYCLE,
  BUILDING_STORAGE_CAPS,
} from '../src/generated/gameBalance.ts';

assert.equal(BREWERY_HONEY_PER_MEAD_CYCLE, 1);
assert.equal(BREWERY_MEAD_PER_CYCLE, 1);
assert.equal(breweryPolicyOutput(BREWERY_RECIPE_MEAD), 'mead');
assert.equal(
  selectedBreweryRecipePolicy(BREWERY_RECIPE_AUTO, {
    barley: 0,
    malt: 0,
    apples: 0,
    pears: 0,
    honey: 3,
    ale: 0,
    cider: 0,
    mead: 0,
  }),
  BREWERY_RECIPE_MEAD,
);
assert.ok((BUILDING_STORAGE_CAPS.brewery.honey ?? 0) > 0);
assert.ok((BUILDING_STORAGE_CAPS.brewery.mead ?? 0) > 0);
assert.ok((BUILDING_STORAGE_CAPS.tavern.mead ?? 0) > 0);
assert.ok((BUILDING_STORAGE_CAPS.marketplace.honey ?? 0) > 0);
assert.ok((BUILDING_STORAGE_CAPS.granary.honey ?? 0) > 0);

const backyard = readFileSync('server/src/simulation/backyard_garden.rs', 'utf8');
assert.match(backyard, /BackyardApiary => Some\(CommodityKind::Honey\)/);
assert.match(
  backyard,
  /distribute_backyard_food[\s\S]*deposit_backyard_depot_commodity[\s\S]*ResidenceNeedKind::Food/,
  'backyard-apiary surplus must enter its assigned Granary before market stocking',
);
assert.match(
  backyard,
  /fn deposit_backyard_depot_commodity[\s\S]*marketplace_stall_workplace_id_for_deposit[\s\S]*storage_accepts_commodity[\s\S]*deposit_building_commodity\(&mut depot/,
);
assert.doesNotMatch(backyard, /deposit_building_commodity\(&mut marketplace/);

const economy = readFileSync('server/src/simulation/expanded_economy.rs', 'utf8');
assert.match(
  economy,
  /BREWERY_RECIPE_MEAD[\s\S]*CommodityKind::Honey, BREWERY_HONEY_PER_MEAD_CYCLE[\s\S]*CommodityKind::Mead, BREWERY_MEAD_PER_CYCLE/,
);
assert.match(
  economy,
  /request_brewery_recipe_inputs[\s\S]*CommodityKind::Honey[\s\S]*&\["apiary", "granary", "trading_post"\]/,
  'Mead-selected Brewhouses must retrieve both specialist- and backyard-apiary honey',
);
assert.match(
  economy,
  /step_apiary[\s\S]*CommodityKind::Honey[\s\S]*&\["brewery"\][\s\S]*&\["granary"\]/,
  'large apiaries must offer reserve-safe honey to a Brewhouse, then a Granary, before market stocking',
);
const apiaryStep = economy.slice(
  economy.indexOf('pub fn step_apiary'),
  economy.indexOf('fn advance_monastery_vineyard_fermentation'),
);
assert.doesNotMatch(apiaryStep, /&\["marketplace"\]/);
assert.match(
  economy,
  /GranaryDispatchDuty::Households[\s\S]*CommodityKind::Honey,[\s\S]*&\["marketplace"\]/,
  'only the Granary household-stall duty should move ordinary Honey into a Marketplace',
);
assert.match(
  economy,
  /for beverage in \[[\s\S]*CommodityKind::Mead[\s\S]*&\["tavern"\][\s\S]*target\.assigned_labor > 0/,
  'finished Mead must travel physically to a staffed Tavern',
);

const cargo = readFileSync('server/src/simulation/delivery_cargo.rs', 'utf8');
assert.match(
  cargo,
  /ResidenceNeedKind::Ale => \{[\s\S]*CommodityKind::Cider[\s\S]*CommodityKind::Ale[\s\S]*CommodityKind::Mead/,
  'Tavern service must count and withdraw Mead as a Beverage',
);
assert.match(
  cargo,
  /ResidenceNeedKind::Luxury => building\.candles \+ building\.wine \+ building\.honey/,
  'Marketplace Honey must also satisfy Tier-4 Luxury comfort',
);
assert.match(
  cargo,
  /ResidenceNeedKind::Luxury => \{[\s\S]*CommodityKind::Wine[\s\S]*CommodityKind::Honey[\s\S]*wine_used \+ honey_used/,
  'Luxury service should spend dedicated Wine before flexible Honey',
);

const inspector = readFileSync('src/resources/inspector/expandedBuildingRenderer.ts', 'utf8');
assert.match(inspector, /data-brewery-recipe-policy/);
assert.match(
  inspector,
  /BREWERY_HONEY_PER_MEAD_CYCLE.*honey.*BREWERY_MEAD_PER_CYCLE.*mead/,
  'the compact Mead recipe button must expose its conversion in the tooltip',
);
assert.match(inspector, /staffed Tavern/);
const buildCards = readFileSync('src/ui/buildMenuCards.ts', 'utf8');
assert.match(buildCards, /Malts barley for ale, presses apples or pears into cider, and ferments honey into mead/);
assert.match(buildCards, /harvests honey and beeswax in autumn/);
const settlementHud = readFileSync('src/ui/SettlementHud.ts', 'utf8');
assert.match(settlementHud, /RESOURCE_DESCRIPTIONS\.honey/);
const resourceDescriptions = readFileSync('src/ui/resourceDescriptions.ts', 'utf8');
assert.match(resourceDescriptions, /honey: 'Honey from apiaries, eaten at the table or fermented into mead at a Brewhouse\.'/);

const iconPath = 'public/assets/ui/icons/resource-mead.png';
assert.ok(existsSync(iconPath));
assert.ok(statSync(iconPath).size > 1_000, 'Mead needs a non-placeholder custom raster icon');
const iconography = readFileSync('src/ui/iconography.css', 'utf8');
assert.match(
  iconography,
  /data-resource='mead'[\s\S]*background-image: url\('\/assets\/ui\/icons\/resource-mead\.png'\)/,
);
assert.match(
  iconography,
  /data-resource-cost='mead'[\s\S]*background-image: url\('\/assets\/ui\/icons\/resource-mead\.png'\)/,
);

console.log('Physical honey-to-mead production, luxury competition, Tavern service, storage, recipe, and icon contracts passed.');
