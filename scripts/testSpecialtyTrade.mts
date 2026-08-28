import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  apiaryIsAccumulating,
  apiaryIsActive,
  apiaryIsHarvesting,
  specialtySeasonStatus,
  vineyardIsHarvesting,
} from '../src/economy/specialtyTrade.ts';
import { BUILDING_KINDS, BUILDING_STORAGE_CAPS } from '../src/generated/gameBalance.ts';
import { getBuildingDefinition } from '../src/resources/buildings.ts';

assert.equal(apiaryIsActive(2), false);
assert.equal(apiaryIsActive(3), true);
assert.equal(apiaryIsActive(11), true);
assert.equal(apiaryIsActive(12), false);
assert.equal(apiaryIsAccumulating(3), true);
assert.equal(apiaryIsAccumulating(8), true);
assert.equal(apiaryIsAccumulating(9), false);
assert.equal(apiaryIsHarvesting(8), false);
assert.equal(apiaryIsHarvesting(9), true);
assert.equal(apiaryIsHarvesting(11), true);
assert.equal(apiaryIsHarvesting(12), false);
assert.equal(vineyardIsHarvesting(8), false);
assert.equal(vineyardIsHarvesting(9), true);
assert.equal(vineyardIsHarvesting(10), true);
assert.equal(vineyardIsHarvesting(11), false);
assert.match(specialtySeasonStatus('apiary', 1)?.label ?? '', /resumes in March/);
assert.match(specialtySeasonStatus('apiary', 4)?.label ?? '', /yield accumulating/);
assert.match(specialtySeasonStatus('apiary', 10)?.label ?? '', /Autumn honey harvest/);

const apiary = getBuildingDefinition('apiary');
assert.equal(apiary.requiresMatureTrees, true);
assert.equal(apiary.workRadius, 48);
assert.equal(BUILDING_KINDS.includes('vineyard' as never), false);
assert.equal(BUILDING_STORAGE_CAPS.marketplace.ale, 120);
assert.equal(BUILDING_STORAGE_CAPS.marketplace.cloth, 120);
assert.equal(BUILDING_STORAGE_CAPS.marketplace.honey, 48);
assert.equal(BUILDING_STORAGE_CAPS.marketplace.wine, 72);
assert.equal(BUILDING_STORAGE_CAPS.granary.honey, 2500);
assert.equal(BUILDING_STORAGE_CAPS.granary.wine, 2500);
assert.equal(BUILDING_STORAGE_CAPS.trading_post.ale, 180);
assert.equal(BUILDING_STORAGE_CAPS.trading_post.honey, 140);
assert.equal(BUILDING_STORAGE_CAPS.trading_post.wine, 160);
assert.equal(BUILDING_STORAGE_CAPS.trading_post.cloth, 160);

const expandedEconomy = readFileSync(
  new URL('../server/src/simulation/expanded_economy.rs', import.meta.url),
  'utf8',
);
const tradingPostTrade = readFileSync(
  new URL('../server/src/simulation/trading_post_trade.rs', import.meta.url),
  'utf8',
);
assert.doesNotMatch(expandedEconomy, /fn export_specialty/);
assert.match(expandedEconomy, /apiary_is_accumulating/);
assert.match(expandedEconomy, /apiary_is_harvesting/);
assert.match(expandedEconomy, /vineyard_is_harvesting/);
assert.match(expandedEconomy, /CommodityKind::Ale/);
assert.match(expandedEconomy, /CommodityKind::Honey/);
assert.match(expandedEconomy, /CommodityKind::Wine/);
assert.match(expandedEconomy, /CommodityKind::Cloth/);
assert.match(tradingPostTrade, /marketplace_trade_offer_for_resource/);
assert.match(tradingPostTrade, /TRADE_MODE_EXPORT/);
assert.match(tradingPostTrade, /settle_export/);
assert.doesNotMatch(tradingPostTrade, /specialty_export_capacity|manual_trade_cooldown/);

console.log('seasonal specialty production and bounded Trading Post exchange checks passed');
