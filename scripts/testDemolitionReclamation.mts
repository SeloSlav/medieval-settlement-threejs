import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { createBuildingMesh } from '../src/buildings/BuildingMeshes.ts';
import {
  SALVAGE_GOODS_VISUAL_SEGMENTS,
  SALVAGE_STONE_VISUAL_SEGMENTS,
  SALVAGE_TIMBER_VISUAL_SEGMENTS,
} from '../src/buildings/buildingStockpileVisuals.ts';
import {
  cargoKindFromId,
  cargoKindLabel,
} from '../src/logistics/deliveryTrips.ts';
import { constructionSourcePriority } from '../src/logistics/constructionLogistics.ts';
import {
  BUILDING_COSTS,
  BUILDING_DEFINITIONS,
  BUILDING_STORAGE_CAPS,
} from '../src/generated/gameBalance.ts';
import { BUILD_MENU_ENTRIES } from '../src/ui/buildMenuCards.ts';

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), 'utf8');

assert.equal(BUILDING_DEFINITIONS.salvage_pile.acceptsLabor, false);
assert.equal(BUILDING_DEFINITIONS.salvage_pile.requiresRoad, true);
assert.equal(BUILDING_COSTS.salvage_pile.timber, 0);
assert.equal(BUILDING_COSTS.salvage_pile.stone, 0);
assert.ok(BUILDING_STORAGE_CAPS.salvage_pile.timber >= 1000);
assert.ok(BUILDING_STORAGE_CAPS.salvage_pile.stone >= 1000);
assert.equal(
  BUILD_MENU_ENTRIES.some(
    (entry) => entry.kind === 'placement' && entry.artKey === 'salvage_pile',
  ),
  false,
  'reclamation piles are generated only by dismantling',
);
assert.equal(
  constructionSourcePriority({
    id: 'salvage',
    kind: 'salvage_pile',
    assignedLabor: 0,
  }),
  4,
  'reclaimed structural material should share the central-stock source class',
);

const pile = createBuildingMesh('salvage_pile');
assert.equal(pile.name, 'Physical reclamation pile');
const timber = pile.getObjectByName('SalvageTimberStockpile');
const stone = pile.getObjectByName('SalvageStoneStockpile');
const goods = pile.getObjectByName('SalvageCratedGoods');
const chest = pile.getObjectByName('SalvageTreasuryChest');
assert.ok(timber instanceof THREE.Group);
assert.ok(stone instanceof THREE.Group);
assert.ok(goods instanceof THREE.Group);
assert.ok(chest instanceof THREE.Group);
assert.equal(
  timber.children.filter((child) => child.name === 'SalvageTimberSegment').length,
  SALVAGE_TIMBER_VISUAL_SEGMENTS,
);
assert.equal(
  stone.children.filter((child) => child.name === 'SalvageStoneSegment').length,
  SALVAGE_STONE_VISUAL_SEGMENTS,
);
assert.equal(
  goods.children.filter((child) => child.name === 'SalvageGoodsSegment').length,
  SALVAGE_GOODS_VISUAL_SEGMENTS,
);

assert.equal(cargoKindFromId(15), 'gold');
assert.equal(cargoKindLabel('gold'), 'Gold');

const buildingReducer = read('server/src/reducers/buildings.rs');
assert.match(buildingReducer, /physical_reclamation/);
assert.match(
  buildingReducer,
  /if physical_reclamation \{[\s\S]*kind: "salvage_pile"\.into\(\)[\s\S]*return Ok\(\(\)\);[\s\S]*let trip_cargo = drain_trips_for_building/,
  'physical saves must retain the building row and its live trips before the legacy refund path',
);
assert.match(
  buildingReducer,
  /timber: refund\.timber \+ building\.timber \* recoverable/,
);
assert.match(
  buildingReducer,
  /marketplace_pending_trade_code: 0/,
  'dismantling a market must cancel its pending order without deleting staged stock',
);

const reclamation = read('server/src/simulation/reclamation.rs');
assert.match(reclamation, /available_free_haulers/);
assert.match(reclamation, /road_path_distance/);
assert.match(reclamation, /try_start_building_supply_trip/);
assert.match(reclamation, /free_haulers_by_owner/);
assert.match(reclamation, /destination_ids_by_owner/);
assert.match(reclamation, /CommodityKind::Gold/);
assert.match(reclamation, /"town_hall" => Some\(0\)/);
assert.match(reclamation, /ctx\.db\.building\(\)\.id\(\)\.delete\(pile\.id\)/);
assert.match(
  reclamation,
  /pub fn insert_reclamation_pile[\s\S]*physical_founding_site_enabled[\s\S]*kind: "salvage_pile"/,
  'non-building demolition should use the same physical reclamation row and legacy gate',
);
assert.match(
  reclamation,
  /next_building_id: building_id[\s\S]*checked_add\(1\)/,
  'inserted piles must advance the save-persistent global building ID',
);

const residenceReducers = read('server/src/reducers/residences.rs');
assert.match(
  residenceReducers,
  /demolish_residence[\s\S]*insert_reclamation_pile[\s\S]*residence\.x[\s\S]*residence\.z/,
  'a removed cottage must leave salvage at its own footprint',
);
assert.match(
  residenceReducers,
  /demolish_burgage_zone[\s\S]*for residence in &residences[\s\S]*insert_reclamation_pile/,
  'whole-plot demolition must leave separate piles at intact cottages',
);
assert.match(
  residenceReducers,
  /residence_fire_state\(ctx, residence\.id\)\.is_some\(\)[\s\S]*continue/,
  'fire-damaged cottages must not create reusable structural salvage',
);

const backyardReducers = read('server/src/reducers/backyards.rs');
assert.match(backyardReducers, /backyard_reclamation_position/);
assert.match(
  backyardReducers,
  /demolish_backyard_garden[\s\S]*insert_reclamation_pile/,
  'removed backyard improvements must leave their refund in the yard',
);
assert.match(
  backyardReducers,
  /Clear the reclaimed materials from this backyard before rebuilding/,
  'backyard rebuilding must wait until its physical pile clears',
);
const backyardInspector = read('src/resources/inspector/backyardRenderer.ts');
assert.match(backyardInspector, /Reclamation pile blocks rebuilding/);
assert.match(backyardInspector, /A free hauler must cart it to connected storage/);
const residenceInspector = read('src/resources/inspector/residenceRenderer.ts');
assert.match(residenceInspector, /separate reclamation/);
assert.match(residenceInspector, /active fire-recovery sites recover only material already delivered/);
assert.match(residenceInspector, /every salvage-bearing footprint remains occupied/);

const commodities = read('server/src/economy/commodities.rs');
assert.match(commodities, /Self::Gold => 15/);
assert.match(commodities, /building\.kind != "salvage_pile"/);
assert.match(
  commodities,
  /"founders_camp"[\s\S]*?"salvage_pile"[\s\S]*?"chapel"[\s\S]*?"monastery"[\s\S]*?"town_hall"/,
  'gold storage must cover every physical treasury, coffer, and salvage lockbox',
);
const storage = read('server/src/economy/storage.rs');
assert.match(
  storage,
  /"founders_camp"[\s\S]*?"salvage_pile"[\s\S]*?"town_hall"/,
  'a demolished Town Hall lockbox must remain the physical treasury until replacement',
);

const simulation = read('server/src/reducers/simulation.rs');
assert.match(simulation, /"salvage_pile" => reclamation_pile_ids\.push/);
assert.match(simulation, /step_reclamation_piles\(ctx, &tick, &clock, reclamation_pile_ids\)/);

console.log('Physical building, cottage, backyard, haulage, treasury, and visual reclamation checks passed.');
