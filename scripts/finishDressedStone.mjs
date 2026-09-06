import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {edit,convert,cloneStatements,rustRoofStatement,imports} from './dressedStoneEditHelpers.mjs';
edit('scripts/generateMarketplaceTradeBalance.mts',s=>s.replace("'dressedStone', 'dressedStone',", "'dressedStone',"));
edit('src/data/spacetimeTableSync/syncPlayerResources.ts',s=>s.replace(/      roofTiles: wholeResourceUnits\([\s\S]*?      \),/, '      roofTiles: wholeResourceUnits(row.roofTiles),\n      dressedStone: wholeResourceUnits(row.dressedStone),'));
// Reapply once to the two unmodified-at-task-start files hit by a sandbox retry.
for(const p of ['resources/resourceTotals.ts','resources/buildingEconomy.ts']) edit('src/'+p,()=>{
  let s=execFileSync('git',['show','HEAD:src/'+p],{encoding:'utf8'});
  s=cloneStatements(s,l=>/^\s*(?:(?:let|const) \w*(?:roofTiles|RoofTiles)\w*\b|\w*(?:roofTiles|RoofTiles)\w*\??\s*:|(?:\w+\.)?\w*(?:roofTiles|RoofTiles)\w*\s*[-+]?=|if \([^\n]*\broofTiles\b)/.test(l)&&!/\b(?:timber|stone|ironwork)\b/.test(l),c=>convert(c).replaceAll('RESIDENCE_TILE_ROOF_SALVAGE_FRACTION','STONE_SALVAGE_FRACTION'));
  s=s.replaceAll("'roofTiles'", "'roofTiles', 'dressedStone'").replace("'ironwork' | 'roofTiles', 'dressedStone' | 'gold'", "'ironwork' | 'roofTiles' | 'dressedStone' | 'gold'");
  s=s.replace(/(&& totals\.roofTiles >= \(cost\.roofTiles \?\? 0\))/g,x=>x+'\n    '+convert(x));
  s=s.replace(/^(\s+roofTiles,)\r?$/gm,x=>x+'\n'+convert(x));
  s=s.replace(/^.*reservedDressedStone \+= residence.*\r?\n/gm,'').replace(/^.*reservedBuildingDressedStone \+= residence.*\r?\n/gm,'');
  return s;
});
edit('server/src/economy/mod.rs',s=>cloneStatements(s,rustRoofStatement,c=>convert(c).replaceAll('RESIDENCE_TILE_ROOF_SALVAGE_FRACTION','STONE_SALVAGE_FRACTION')));
edit('server/src/fire_recovery_policy.rs',s=>cloneStatements(s,rustRoofStatement));
edit('server/src/reducers/fire_recovery.rs',s=>{
  const start=s.indexOf('pub fn repair_residence');
  // Inventory/cost fields belong to buildings; household repair continues to use basic stone.
  s=cloneStatements(s,l=>rustRoofStatement(l)&&!/^\s*let roof_tiles = if/.test(l),c=>/residence|RESIDENCE/.test(c)?'':convert(c));
  s=imports(s);
  s=s.replaceAll('base.roof_tiles,','base.roof_tiles,\n        base.dressed_stone,');
  s=s.replaceAll('        base_roof_tiles,','        base_roof_tiles,\n        0.0,');
  s=s.replaceAll('treasury_ironwork, treasury_roof_tiles)', 'treasury_ironwork, treasury_roof_tiles, treasury_dressed_stone)');
  s=s.replaceAll('            remaining_roof_tiles,','            remaining_roof_tiles,\n            remaining_dressed_stone,');
  s=s.replace('if timber + stone + ironwork + roof_tiles <=', 'if timber + stone + ironwork + roof_tiles + dressed_stone <=');
  return s;
});
edit('server/src/processor_output_policy.rs',s=>s.replace('    Pottery,','    Pottery,\n    DressedStone,').replace('    Clay,','    Clay,\n    Stone,').replace('        "potter_kiln" => Some(ProcessorOutputKind::Pottery),','        "potter_kiln" => Some(ProcessorOutputKind::Pottery),\n        "stone_mason" => Some(ProcessorOutputKind::DressedStone),').replace('        "potter_kiln" => &[Clay, Firewood, Water],','        "potter_kiln" => &[Clay, Firewood, Water],\n        "stone_mason" => &[Stone],'));
edit('server/src/simulation/expanded_economy.rs',s=>{
  s=s.replace('pub fn step_potter_kiln(',`pub fn step_stone_mason(ctx: &ReducerContext, tick: &SimTickContext, clock: &GameClock, building: Building) {
    let mason = step_processor(ctx, tick, clock, building,
        &[(CommodityKind::Stone, crate::balance_generated::MASON_STONE_PER_CYCLE)],
        &[(CommodityKind::DressedStone, crate::balance_generated::MASON_DRESSED_STONE_PER_CYCLE)]);
    ctx.db.building().id().update(mason);
}

pub fn step_potter_kiln(`);
  s=s.replace('        ProcessorOutputKind::Pottery => Some(CommodityKind::Pottery),','        ProcessorOutputKind::Pottery => Some(CommodityKind::Pottery),\n        ProcessorOutputKind::DressedStone => Some(CommodityKind::DressedStone),');
  s=s.replace('        ("stone_quarry" | "mine", CommodityKind::Clay)', '        ("stone_quarry" | "large_quarry" | "mine" | "village_storehouse" | "trading_post", CommodityKind::Stone) => Some(&["stone_mason"]),\n        ("stone_mason", CommodityKind::DressedStone) => Some(&["village_storehouse", "trading_post"]),\n        ("stone_quarry" | "mine", CommodityKind::Clay)');
  s=s.replace('        "potter_kiln" => matches!(', '        "stone_mason" => commodity == CommodityKind::Stone,\n        "potter_kiln" => matches!(');
  return s;
});
for(const p of ['server/src/simulation/mod.rs','server/src/reducers/simulation.rs'])edit(p,s=>s.replace('step_potter_kiln,','step_potter_kiln, step_stone_mason,').replace('| crate::building_defs::BuildingSimKind::PotterKiln','| crate::building_defs::BuildingSimKind::PotterKiln\n            | crate::building_defs::BuildingSimKind::StoneMason').replace('            crate::building_defs::BuildingSimKind::PotterKiln => {','            crate::building_defs::BuildingSimKind::StoneMason => { step_stone_mason(ctx, &tick, &clock, building) },\n            crate::building_defs::BuildingSimKind::PotterKiln => {'));
edit('src/resources/types.ts',s=>s.replace(/^(export const RESOURCE_KINDS[^\n]+)\r?\nexport const RESOURCE_KINDS[^\n]+/,(_,a)=>a.replace("'roofTiles'","'roofTiles', 'dressedStone'")));
edit('src/economy/chapelUpgrade.ts',s=>s.replace('ironwork: CHAPEL_TIER4_UPGRADE_IRONWORK, roofTiles: CHAPEL_TIER4_UPGRADE_ROOF_TILES,','ironwork: CHAPEL_TIER4_UPGRADE_IRONWORK, roofTiles: CHAPEL_TIER4_UPGRADE_ROOF_TILES,\n    dressedStone: CHAPEL_TIER4_UPGRADE_DRESSED_STONE,'));
edit('src/economy/monasteryPolicy.ts',s=>cloneStatements(s,l=>/scriptoriumRoofTilesSavedTotal\??:/.test(l)));
edit('src/resources/resourceTotals.ts',s=>s.replace(/\s*reservedDressedStone \+= Math\.max\(0, residence\.upgradeReservedDressedStone \?\? 0\);/g,'').replace(/\s*reservedBuildingDressedStone \+= Math\.max\(0, residence\.upgradeReservedDressedStone \?\? 0\);/g,'').replace("kind === 'roofTiles', 'dressedStone'", "kind === 'roofTiles' || kind === 'dressedStone'"));
edit('server/src/security_policy.rs',s=>s.replace(/\s*dressed_stone: 6\.0,\s*\.\.RaidPortableStores::default\(\)/,'').replace('roof_tiles: self.roof_tiles * factor,','roof_tiles: self.roof_tiles * factor,\n            dressed_stone: self.dressed_stone * factor,'));
edit('server/src/simulation/founding_site.rs',s=>s.replace('.max(0.0),.max(0.0),','.max(0.0),'));
edit('server/src/simulation/construction.rs',s=>s.replace(/(    let dressed_stone = [^\n]+)\r?\n\1/,'$1'));
edit('server/src/reducers/fire_recovery.rs',s=>s.replace('            CommodityKind::RoofTiles,\n            CommodityKind::DressedStone,','            CommodityKind::RoofTiles,').replace('spend_aggregate_roof_tiles, spend_aggregate_dressed_stone,','spend_aggregate_roof_tiles,'));
edit('server/src/reducers/residences.rs',s=>s.replace('roof_tiles: 0.0,','roof_tiles: 0.0,\n        dressed_stone: 0.0,'));
edit('server/src/simulation/reclamation.rs',s=>s.replaceAll('[0.0; 71]','[0.0; 72]').replaceAll('[f64; 71]','[f64; 72]'));
edit('server/src/economy/regional_market.rs',s=>s.replaceAll('| TradeResource::RoofTiles','| TradeResource::DressedStone | TradeResource::RoofTiles'));
edit('server/src/simulation/trading_post_trade.rs',imports);
edit('server/src/reducers/buildings.rs',s=>s.replace('ProcessorOutputKind::Pottery =>', 'ProcessorOutputKind::DressedStone => Ok(CommodityKind::DressedStone),\n        ProcessorOutputKind::Pottery =>').replace('ProcessorInputKind::Clay =>','ProcessorInputKind::Stone => CommodityKind::Stone,\n        ProcessorInputKind::Clay =>'));
// Commodity identity and broad storehouse acceptance use the second 64-bit mask.
edit('src/economy/tradingPostTrade.ts',s=>s.replace('roofTiles: 26,','roofTiles: 26, dressedStone: 76,').replace("roofTiles: 'Roof tiles',","roofTiles: 'Roof tiles', dressedStone: 'Dressed stone',").replace("'timber', 'stone',", "'timber', 'stone', 'dressedStone',"));
edit('src/logistics/deliveryTrips.ts',s=>s.replace("'roofTiles'", "'roofTiles' | 'dressedStone'").replace("26: 'roofTiles' | 'dressedStone'", "26: 'roofTiles', 76: 'dressedStone'").replace("case 'roofTiles' | 'dressedStone':", "case 'roofTiles':\n    case 'dressedStone':"));
for(const p of ['src/economy/regionalMarket.ts','src/resources/yields.ts'])edit(p,s=>s.replace("case 'roofTiles':", "case 'dressedStone':\n    case 'roofTiles':"));
edit('src/ui/lordReports.ts',s=>s.replace("roofTiles: 'Roof tiles',","roofTiles: 'Roof tiles', dressedStone: 'Dressed stone',"));
edit('src/economy/storageAcceptancePolicy.ts',s=>s.replace('  stone: 10,','  stone: 10,\n  dressedStone: 76,').replace("  stone: 'Stone',","  stone: 'Stone',\n  dressedStone: 'Dressed stone',").replace("['timber', 'stone']", "['timber', 'stone', 'dressedStone']"));
edit('server/src/storage_acceptance_policy.rs',s=>s.replace('high_bit(75)', 'high_bit(75) | high_bit(76)'));
edit('src/economy/processorOutputPolicy.ts',s=>s.replace("  'potter_kiln',", "  'potter_kiln',\n  'stone_mason',").replace("  | 'roofTiles'", "  | 'roofTiles'\n  | 'dressedStone'").replace("  | 'clay'", "  | 'clay'\n  | 'stone'").replace("  potter_kiln: 'pottery',", "  potter_kiln: 'pottery',\n  stone_mason: 'dressedStone',").replace("  potter_kiln: ['clay', 'firewood', 'water'],", "  potter_kiln: ['clay', 'firewood', 'water'],\n  stone_mason: ['stone'],"));
// Standard building registries.
const registrations=[
 ['src/audio/audioCatalog.ts',"  potter_kiln:","  stone_mason: { path: '/assets/audio/buildings/stone-quarry.ogg', volume: 0.45 },\n  potter_kiln:"],
 ['src/buildings/BuildingFootprint.ts',"  potter_kiln:","  stone_mason: { radiusX: 7.8, radiusZ: 6.5, innerFade: 0.9, outerFade: 1.22 },\n  potter_kiln:"],
 ['src/buildings/BuildingVisualBounds.ts',"  potter_kiln:","  stone_mason: { minX: -6.5, maxX: 6.5, minZ: -5.45, maxZ: 5.45 },\n  potter_kiln:"],
 ['src/buildings/proceduralArchitecture/catalog.ts',"  potter_kiln:","  stone_mason: { ...commonWorkshop, family: 'craft', status: 'standard', roof: 'open-workyard', massing: ['roofed-banker-bays', 'open-stone-apron'], modules: ['braced-post-frame', 'banker-benches', 'lifting-shear', 'dressed-ashlar-stacks'], materials: ['rough-timber', 'split-shingles', 'fieldstone', 'limestone-ashlar', 'wrought-iron'], dynamicSlots: ['mason-raw-stone', 'mason-dressed-stone'], triangleTarget: 3500, triangleCeiling: 8000, historicalNote: 'Roofed stone bankers and an open delivery apron for chiselled ashlar masonry.' },\n  potter_kiln:"],
 ['src/resources/buildingCardArt.ts',"  potter_kiln:","  stone_mason: '/assets/ui/build-menu/cards/stone-mason.webp',\n  potter_kiln:"],
 ['src/economy/settlementLabor.ts',"  potter_kiln:","  stone_mason: 'materials',\n  potter_kiln:"],
 ['src/settlement/villagerIdentity.ts',"  potter_kiln:","  stone_mason: 'Stonemason',\n  potter_kiln:"],
 ['src/ui/buildMenuMapping.ts',"  potter_kiln:","  stone_mason: 'stone-mason',\n  potter_kiln:"],
];
for(const [p,a,b] of registrations)edit(p,s=>s.replace(a,b));
edit('src/ui/buildMenuMapping.ts',s=>s.replace("  'potter-kiln':", "  'stone-mason': 'stone_mason',\n  'potter-kiln':"));
edit('src/ui/buildMenuCards.ts',s=>s.replace("| 'potter-kiln'", "| 'potter-kiln' | 'stone-mason'").replace('  potter_kiln:', `  stone_mason: ["Stonemason's Yard", 'Dresses 8 rough stone into 4 precisely cut blocks for grand churches and civic masonry.', flow(['stone'], ['dressedStone'])],\n  potter_kiln:`).replaceAll("entry('potter_kiln'),", "entry('potter_kiln'), entry('stone_mason'),"));
edit('server/src/placement_validation.rs',s=>s.replace('        "potter_kiln" =>', '        "stone_mason" => BuildingPadParams { radius_x: 7.8, radius_z: 6.5, inner_fade: 0.9, outer_fade: 1.22 },\n        "potter_kiln" =>'));
edit('balance/gameBalance.json',s=>s.replace('"harvestInterval": 900, "regrowRate": 0,','"harvestInterval": 900, "regrowRatePerSecond": 0,'));
edit('server/src/reducers/buildings.rs',s=>s.replace('ProcessorOutputKind::DressedStone => Ok(', 'ProcessorOutputKind::DressedStone => Some('));
edit('server/src/reducers/residences.rs',s=>s.replace(/\n\s*dressed_stone: 0\.0,/g,'').replace('    let salvage = ResourceAmount {','    let salvage = ResourceAmount {\n        dressed_stone: 0.0,'));
edit('server/src/simulation/reclamation.rs',s=>s.replace('-> [CommodityKind; 71]', '-> [CommodityKind; 72]'));
edit('src/buildings/BuildingMeshes.ts',s=>"import { createStoneMasonMesh } from './meshes/stoneMasonMesh.ts';\n"+s.replace('  potter_kiln: () =>', '  stone_mason: () => createStoneMasonMesh(),\n  potter_kiln: () =>'));
edit('src/logistics/deliveryTrips.ts',s=>s.replace("  'roofTiles' | 'dressedStone',", "  'roofTiles',").replace("    case 'roofTiles':\n      return 'Fired roof tiles';", "    case 'dressedStone': return 'Dressed stone';\n    case 'roofTiles':\n      return 'Fired roof tiles';").replace('    case 26:', "    case 76: return 'dressedStone';\n    case 26:").replace("    case 'roofTiles':\n      return 0xb75e3b;", "    case 'dressedStone': return 0xc8bfa4;\n    case 'roofTiles':\n      return 0xb75e3b;"));
// Handle CRLF sources as well as native LF.
edit('src/logistics/deliveryTrips.ts',s=>s.replace(/    case 'roofTiles':\r?\n      return 'Fired roof tiles';/, "    case 'dressedStone': return 'Dressed stone';\n    case 'roofTiles':\n      return 'Fired roof tiles';").replace(/    case 'roofTiles':\r?\n      return 0xb75e3b;/, "    case 'dressedStone': return 0xc8bfa4;\n    case 'roofTiles':\n      return 0xb75e3b;"));
edit('src/resources/resourceTotals.ts',s=>s.replace(/^.*reservedResidenceDressedStone.*\r?\n/gm,l=>l.includes('allBuilding')?l.replace(' - reservedResidenceDressedStone',''):'').replace("resource === 'roofTiles', 'dressedStone'", "resource === 'roofTiles' || resource === 'dressedStone'"));
for(const p of ['src/logistics/constructionLogistics.ts','src/economy/settlementConstruction.ts']) edit(p,s=>s.replace("| 'roofTiles';", "| 'roofTiles' | 'dressedStone';"));
edit('src/economy/settlementConstruction.ts',s=>{
  s=s.replace('ironwork: 0, roofTiles: 0 }','ironwork: 0, roofTiles: 0, dressedStone: 0 }');
  s=s.replace(/:\s*nonnegative\(building\.construction(Required|Delivered|Reserved|Treasury)RoofTiles\)/g,(_,field)=>`: material === 'dressedStone' ? nonnegative(building.construction${field}DressedStone) : nonnegative(building.construction${field}RoofTiles)`);
  s=s.replace(/^(\s+)(roofTiles|fireBlockedRoofTilesStock),\r?$/gm,(l,space,x)=>l+'\n'+space+convert(x)+',');
  s=s.replace(/(\+ (?:branch\.)?\w*[Rr]oofTiles\w*(?:\.\w+)?)/g,x=>x+' '+convert(x));
  s=s.replace("          'roofTiles',\n          'dressedStone',", "          'roofTiles',");
  s=cloneStatements(s,l=>/^\s*recordRoadClaim\(/.test(l),c=>c.includes("'roofTiles'")?convert(c):'');
  s=s.replace(/(    let candidate = timberCandidate;)/, '$1\n    if (dressedStoneCandidate) candidate = dressedStoneCandidate;');
  s=s.replace("|| trip.cargoKind === 'roofTiles'", "|| trip.cargoKind === 'roofTiles' || trip.cargoKind === 'dressedStone'");
  return s;
});
edit('src/ui/lordReports.ts',s=>s.replace("roofTiles: 'Roof-tile stack',", "roofTiles: 'Roof-tile stack',\n  dressedStone: 'Dressed stone',"));
edit('src/resources/inspector/buildingCommon.ts',s=>s.replace('${roofTiles}${gold}', '${roofTiles}${dressedStone}${gold}'));
edit('src/resources/inspector/constructionRenderer.ts',s=>s.replace('|| roofTilesPending > 1e-6;', '|| roofTilesPending > 1e-6 || dressedStonePending > 1e-6;').replace("? 'roofTiles'\n        : null", "? 'roofTiles'\n        : dressedStonePending > 1e-6 ? 'dressedStone' : null").replace(': roofTilesPending;', ": pendingMaterial === 'dressedStone' ? dressedStonePending : roofTilesPending;"));
edit('src/resources/inspector/townHallRenderer.ts',s=>s.replace(/(\+ (?:roofTiles\.\w+|fragmentedRoofTiles|scarceRoofTiles))/g,x=>x+' '+convert(x)).replace(/(\$\{roofTiles\.delivered.toFixed\(0\)\} \/ \$\{roofTiles\.required.toFixed\(0\)\} roof tiles delivered)/g,'$1 · ${dressedStone.delivered.toFixed(0)} / ${dressedStone.required.toFixed(0)} dressed stone delivered'));
for(const p of ['src/logistics/foundingStockyardLogistics.ts','src/resources/inspector/foundersCampRenderer.ts'])edit(p,s=>s.replace("    case 'roofTiles':", "    case 'dressedStone':\n    case 'roofTiles':"));
edit('src/resources/inspector/buildingRenderer.ts',s=>s.replace("    case 'potter_kiln':", "    case 'stone_mason':\n    case 'potter_kiln':"));
edit('src/resources/inspector/expandedBuildingRenderer.ts',s=>s.replace("  potter_kiln:","  stone_mason: 'Quarried stone → dressed ashlar blocks for large churches, cathedrals, and civic stonework',\n  potter_kiln:").replace("  'potter_kiln',", "  'potter_kiln',\n  'stone_mason',"));
edit('src/resources/inspector/buildingProcessorStatus.ts',s=>{
  s="import { MASON_STONE_PER_CYCLE, MASON_DRESSED_STONE_PER_CYCLE } from '../../generated/gameBalance.ts';\n"+s;
  s=s.replace("  | 'pottery'", "  | 'pottery'\n  | 'dressedStone'").replace("  | 'clay'", "  | 'clay'\n  | 'stone'");
  return s.replace('  potter_kiln: {', `  stone_mason: {
    requiresLabor: true, waterPerCycle: 0,
    inputs: [{ key: 'stone', label: 'rough stone', required: MASON_STONE_PER_CYCLE, deliveryHint: 'road-linked quarry and storehouse carts supply stone' }],
    output: 'dressedStone', outputPerCycle: MASON_DRESSED_STONE_PER_CYCLE,
    operatingLabel: 'Squaring and dressing ashlar blocks', idleNoWorkersLabel: 'Idle - assign stonemasons',
  },
  potter_kiln: {`);
});
edit('src/ui/iconography.css',s=>s+`\n.settlement-hud__stat[data-resource='dressedStone']::before,
.resource-cost__item[data-resource-cost='dressedStone'] .resource-cost__icon {
  background-image: url('/assets/ui/icons/materials/dressed-stone.svg');
}\n`);
edit('src/ui/resourceDescriptions.ts',s=>s.replace(/dressedStone: '[^']*'/, "dressedStone: 'Precisely cut ashlar blocks. Stonemasons dress two rough stone per block for grand churches and civic masonry.'"));
edit('src/economy/settlementConstruction.ts',s=>s.replaceAll('ironwork: 0, roofTiles: 0 }','ironwork: 0, roofTiles: 0, dressedStone: 0 }'));
edit('src/resources/inspector/constructionRenderer.ts',s=>s.replace("| 'roofTiles';", "| 'roofTiles' | 'dressedStone';").replace("      kind: 'roofTiles',", "      kind: 'dressedStone',\n      required: finiteConstructionAmount(building.constructionRequiredDressedStone),\n      delivered: finiteConstructionAmount(building.constructionDeliveredDressedStone),\n    },\n    {\n      kind: 'roofTiles',"));
edit('src/ui/SettlementHud.ts',s=>s.replace(/(            <div class="settlement-hud__stat[^\n]*data-resource="roofTiles">[\s\S]*?<\/div>)/,x=>x+'\n'+convert(x)));
edit('src/resources/settlementResourceReport.ts',s=>s.replace(/^(.*add\(rows, 'roofTiles', 'committed', building.*)$/gm,x=>x+'\n'+convert(x)));
edit('src/logistics/deliveryCartMesh.ts',s=>s.replace("  timberMaterial,", "  timberMaterial,\n  stoneMaterial,").replace("    case 'roofTiles':", `    case 'dressedStone':
      for (let i = 0; i < 6; i++) {
        const block = addMesh(group, new THREE.BoxGeometry(.48, .27, .38), stoneMaterial('light'), new THREE.Vector3((i % 2 - .5) * .51, .88 + Math.floor(i / 4) * .28, -.36 + (Math.floor(i / 2) % 2) * .4));
        block.name = 'Cart dressed ashlar block';
      }
      break;
    case 'roofTiles':`));
edit('server/src/supply_policy.rs',s=>s.replace('pub const LOCAL_MATERIAL_SOURCE_KINDS: &[&str] = &[','pub const LOCAL_MATERIAL_SOURCE_KINDS: &[&str] = &[\n    "stone_mason", "large_quarry",').replace('        ("potter_kiln", "clay")', '        ("stone_mason", "stone") => crate::balance_generated::MASON_STONE_PER_CYCLE,\n        ("potter_kiln", "clay")'));
edit('server/src/simulation/expanded_economy.rs',s=>s.replace('const LOCAL_MATERIAL_COMMODITIES: &[CommodityKind] = &[','const LOCAL_MATERIAL_COMMODITIES: &[CommodityKind] = &[\n    CommodityKind::Stone, CommodityKind::DressedStone,').replace('        CommodityKind::Clay => "clay",','        CommodityKind::Clay => "clay",\n        CommodityKind::Stone => "stone",\n        CommodityKind::DressedStone => "dressedStone",').replace('        CommodityKind::Clay => Some("clay"),','        CommodityKind::Clay => Some("clay"),\n        CommodityKind::Stone => Some("stone"),\n        CommodityKind::DressedStone => Some("dressedStone"),').replace('    let mason = step_processor(ctx, tick, clock, building,','    if crate::economy::total_stone(ctx, building.owner) < crate::balance_generated::MASON_STONE_PER_CYCLE { return; }\n    let mason = step_processor(ctx, tick, clock, building,'));
edit('src/logistics/processorInputLogistics.ts',s=>{
  s="import { MASON_STONE_PER_CYCLE } from '../generated/gameBalance.ts';\n"+s;
  s=s.replaceAll("  | 'clay'", "  | 'clay'\n  | 'stone'\n  | 'dressedStone'");
  s=s.replace("  clay: ['potter_kiln'],", "  clay: ['potter_kiln'],\n  stone: ['stone_mason'],\n  dressedStone: ['village_storehouse', 'trading_post'],");
  s=s.replace("    case 'clay':", "    case 'stone': return targetKind === 'stone_mason' ? MASON_STONE_PER_CYCLE : 0;\n    case 'dressedStone': return 0;\n    case 'clay':");
  // Priority rank has a different context from recipe selection.
  s=s.replace("case 'stone': return targetKind === 'stone_mason' ? MASON_STONE_PER_CYCLE : 0;\n    case 'dressedStone': return 0;\n    case 'clay': return 3;", "case 'stone': return 3;\n    case 'dressedStone': return 4;\n    case 'clay': return 3;");
  s=s.replace("export const LOCAL_MATERIAL_SOURCE_KINDS = [", "export const LOCAL_MATERIAL_SOURCE_KINDS = [\n  'stone_mason', 'large_quarry', 'trading_post',");
  s=s.replace("    case 'stone_quarry':", "    case 'large_quarry': return ['stone'];\n    case 'stone_mason': return ['dressedStone'];\n    case 'stone_quarry':");
  s=s.replaceAll("(['iron', 'salt', 'clay'] as const)", "(['stone', 'iron', 'salt', 'clay'] as const)");
  s=s.replace("    case 'village_storehouse':\n      return [", "    case 'trading_post':\n    case 'village_storehouse':\n      return [\n        ...((source?.stone ?? 0) > 1e-6 ? ['stone'] as const : []),");
  s=s.replace(/    case 'village_storehouse':\r?\n      return \[/, "    case 'trading_post':\n    case 'village_storehouse':\n      return [\n        ...((source?.stone ?? 0) > 1e-6 ? ['stone'] as const : []),");
  return s;
});
edit('src/buildings/bulkStockpileVisuals.ts',s=>{
  s=s.replace("  switch (building.kind) {", "  if (building.kind === 'stone_mason') return `:mason:${stockpileVisualLevel(building.stone, 96, 8)}:${stockpileVisualLevel(building.dressedStone ?? 0, 64, 8)}`;\n  switch (building.kind) {");
  // The second switch is a void synchronizer, not a signature producer.
  const start=s.indexOf('export function syncBulkStockpileVisuals');
  const a=s.slice(0,start), b=s.slice(start).replace(/  if \(building.kind === 'stone_mason'\) return `[^`]+`;/, `  if (building.kind === 'stone_mason') {
    const raw = stockpileVisualLevel(building.stone, 96, 8);
    const dressed = stockpileVisualLevel(building.dressedStone ?? 0, 64, 8);
    for (let i = 0; i < 8; i++) {
      const rawPart = marker.getObjectByName('MasonRawStone' + i);
      const dressedPart = marker.getObjectByName('MasonDressedStone' + i);
      if (rawPart) rawPart.visible = i < raw;
      if (dressedPart) dressedPart.visible = i < dressed;
    }
    return;
  }`);
  return a+b;
});
edit('src/settlement/workerPaths.ts',s=>s.replace("  'potter_kiln',", "  'potter_kiln',\n  'stone_mason',").replace("  potter_kiln: 'tend',", "  potter_kiln: 'tend',\n  stone_mason: 'hammer',"));
edit('src/settlement/VillagerRenderer.ts',s=>s.replace("case 'potter_kiln': return", "case 'stone_mason': return `Dressing ashlar blocks at ${workplaceLabel}`;\n          case 'potter_kiln': return"));
// Sound reuses the established stone-working selection cue.
edit('src/audio/audioCatalog.ts',s=>{const stone=s.match(/stone_quarry:\s*\{([^}]+)\}/);return stone?s.replace(/stone_mason:\s*\{[^}]+\}/,`stone_mason: {${stone[1]}}`):s;});
edit('.gitignore',s=>s+'\n/output/dressed-stone/\n');
edit('balance/gameBalance.json',s=>s.replace('"pottery": 2500,','"pottery": 2500,\n        "dressedStone": 2500,'));
edit('src/logistics/processorInputLogistics.ts',s=>s.replace("    case 'clay': return 3;", "    case 'stone': return 3;\n    case 'dressedStone': return 4;\n    case 'clay': return 3;"));
edit('src/economy/processorOutputPolicy.ts',s=>s.replace("export type ProcessorInputCommodity =", "export type ProcessorInputCommodity =\n  | 'dressedStone'"));
edit('src/settlement/workerPaths.ts',s=>s.replace("stone_mason: 'hammer'", "stone_mason: 'build'"));
edit('src/buildings/bulkStockpileVisuals.ts',s=>s.replace('  const firewoodContract = industrialFirewoodContract(building.kind);', `  if (building.kind === 'stone_mason') {
    const rawCount = stockpileVisualLevel(building.stone, 96, 8);
    const blockCount = stockpileVisualLevel(building.dressedStone ?? 0, 64, 8);
    for (let i = 0; i < 8; i++) {
      const raw = marker.getObjectByName('MasonRawStone' + i);
      const block = marker.getObjectByName('MasonDressedStone' + i);
      if (raw) raw.visible = i < rawCount;
      if (block) block.visible = i < blockCount;
    }
    return;
  }
  const firewoodContract = industrialFirewoodContract(building.kind);`));
for(const p of ['server/src/simulation/reclamation.rs','server/src/security_policy.rs'])edit(p,s=>s.replace(/^(\s+roof_tiles,)\r?$/gm,x=>x+'\n'+convert(x)).replaceAll('+ positive_store(self.roof_tiles)', '+ positive_store(self.roof_tiles) + positive_store(self.dressed_stone)').replace('plunder_good!(roof_tiles);','plunder_good!(roof_tiles);\n        plunder_good!(dressed_stone);'));
edit('server/src/simulation/settlement_security.rs',s=>s.replace('Some(CommodityKind::RoofTiles | CommodityKind::DressedStone) => stores.roof_tiles = amount,','Some(CommodityKind::RoofTiles) => stores.roof_tiles = amount,\n        Some(CommodityKind::DressedStone) => stores.dressed_stone = amount,').replace('Some(CommodityKind::RoofTiles | CommodityKind::DressedStone) => stores.roof_tiles,','Some(CommodityKind::RoofTiles) => stores.roof_tiles,\n        Some(CommodityKind::DressedStone) => stores.dressed_stone,').replace('subtract_loss!(roof_tiles);','subtract_loss!(roof_tiles);\n    subtract_loss!(dressed_stone);'));
edit('server/src/simulation/reclamation.rs',s=>s.replace('|| building.construction_treasury_roof_tiles > EPSILON)', '|| building.construction_treasury_roof_tiles > EPSILON || building.construction_treasury_dressed_stone > EPSILON)'));
edit('server/src/simulation/delivery_trips.rs',s=>s.replaceAll('| CommodityKind::RoofTiles | CommodityKind::DressedStone','| CommodityKind::RoofTiles'));
edit('src/buildings/BuildingPlacementValidation.ts',s=>s.replace('|| context.stockpile.roofTiles + 1e-6 < (cost.roofTiles ?? 0)','|| context.stockpile.roofTiles + 1e-6 < (cost.roofTiles ?? 0)\n      || context.stockpile.dressedStone + 1e-6 < (cost.dressedStone ?? 0)'));
edit('src/ui/buildToolbarStatus.ts',s=>s.replace('|| (cost.roofTiles ?? 0) > 0','|| (cost.roofTiles ?? 0) > 0 || (cost.dressedStone ?? 0) > 0'));
edit('src/resources/inspector/chapelRenderer.ts',s=>s.replace('            : resources.roofTiles + 1e-6 < upgrade.roofTiles', "            : resources.dressedStone + 1e-6 < upgrade.dressedStone\n              ? `Need ${renderResourceAmount('dressedStone', Math.ceil(upgrade.dressedStone - resources.dressedStone), { compact: true })} more.`\n            : resources.roofTiles + 1e-6 < upgrade.roofTiles"));
edit('src/economy/settlementConstruction.ts',s=>s.replace(/: branch\.(\w*[Rr]oofTiles\w*)/g,(_,field)=>`: material === 'dressedStone' ? branch.${convert(field)} : branch.${field}`));
edit('src/resources/inspector/expandedBuildingRenderer.ts',s=>s.replace("  if (building.kind === 'potter_kiln') {", "  if (building.kind === 'stone_mason') return context.worldQueries.getNextDirectProcessorInputDispatch(building, 'dressedStone')?.target ?? null;\n  if (building.kind === 'potter_kiln') {").replace("    case 'potter_kiln':\r\n      return (building.pottery ?? 0) > 0;", "    case 'stone_mason': return (building.dressedStone ?? 0) > 0;\n    case 'potter_kiln':\r\n      return (building.pottery ?? 0) > 0;"));
edit('src/buildings/ConstructionSiteMesh.ts',s=>{
  s=s.replaceAll('  roofTilesRatio = 0,','  roofTilesRatio = 0,\n  dressedStoneRatio = 0,');
  s=s.replace('${fittings}:${roofTiles}`', '${fittings}:${roofTiles}:${Math.ceil(constructionMaterialPileRatio(clampedProgress, dressedStoneRatio) * 3)}`');
  s=s.replace('    roofTiles: remainingRoofTilesRatio,','    roofTiles: remainingRoofTilesRatio,\n    dressedStone: constructionMaterialPileRatio(clampedProgress, dressedStoneRatio),');
  s=s.replace('  addStakeLine(root, halfWidth, halfDepth);', `  const blockLayers = Math.ceil(constructionMaterialPileRatio(clampedProgress, dressedStoneRatio) * 3);
  for (let i = 0; i < blockLayers * 3; i++) {
    const block = constructionMesh(new THREE.BoxGeometry(.62, .32, .46), PALE_STONE);
    block.name = 'Construction dressed stone block';
    block.position.set(-halfWidth * .6 + (i % 3) * .66, .17 + Math.floor(i / 3) * .34, halfDepth + .8);
    root.add(block);
  }
  addStakeLine(root, halfWidth, halfDepth);`);
  return s;
});
edit('src/buildings/BuildingMarkers.ts',s=>s.replace('    const roofTilesRatio = constructionDeliveredRatio(', '    const dressedStoneRatio = constructionDeliveredRatio(building.constructionDeliveredDressedStone ?? 0, building.constructionRequiredDressedStone ?? 0);\n    const roofTilesRatio = constructionDeliveredRatio(').replace('            roofTilesRatio,','            roofTilesRatio,\n            dressedStoneRatio,').replace('+ (building.roofTiles ?? 0)','+ (building.roofTiles ?? 0) + (building.dressedStone ?? 0)'));
edit('src/buildings/buildingMarkerSignature.ts',s=>s.replace('      building.constructionRequiredRoofTiles ?? 0,','      building.constructionRequiredRoofTiles ?? 0,').replace(/(constructionDeliveredRatio\(\s*building.constructionDeliveredRoofTiles \?\? 0,\s*building.constructionRequiredRoofTiles \?\? 0,\s*\),)/,x=>x+'\n'+convert(x)));
for(const p of ['src/buildings/meshes/stoneMasonMesh.ts','src/buildings/bulkStockpileVisuals.ts'])edit(p,s=>s.replaceAll('MasonRawStone','MasonRawStoneStock').replaceAll('MasonDressedStone','MasonDressedStoneStock'));
edit('server/src/fire_recovery_policy.rs',s=>s.replace(/fire_recovery_cost\(([^()\n]+)\)/g,(all,args)=>{const a=args.split(',').map(x=>x.trim());if(a.length!==8)return all;a.splice(4,0,'0.0');return `fire_recovery_cost(${a.join(', ')})`;}));
edit('server/src/construction_priority.rs',s=>s.replace(/construction_labor_ready\(\s*([\d.,\s]+)\)/g,(all,args)=>{const a=args.split(',').map(x=>x.trim()).filter(Boolean);if(a.length!==13)return all;return `construction_labor_ready(${a.join(', ')}, 0.0, 0.0, 0.0)`;}));
edit('scripts/testCathedralProgression.mts',s=>s.replace('stone:720,ironwork:80,roofTiles:320','stone:432,ironwork:80,roofTiles:320,dressedStone:240'));
edit('scripts/testChapelUpgrade.mts',s=>s.replace('stone: 240,','stone: 144,').replace('roofTiles: 48,','roofTiles: 48, dressedStone: 0,').replace('roofTiles: 112,','roofTiles: 112, dressedStone: 64,'));
edit('server/src/chapel_upgrade_policy.rs',s=>s.replace('assert!(cathedral.stone >= large_upgrade.stone * 3.0);','assert!(cathedral.stone >= large_upgrade.stone * 3.0);\n        assert_eq!(stone_upgrade.dressed_stone, 0.0);\n        assert_eq!(large_upgrade.dressed_stone, 64.0);\n        assert_eq!(cathedral.dressed_stone, 240.0);'));
// Keep generated art reproducible without discarding the source image.
fs.mkdirSync('art-source/build-menu',{recursive:true});
const art='C:/Users/Asus/.codex/generated_images/01a0772d-065c-7dd0-a577-48c6c1dd9a62/exec-fec7a98b-532a-40a8-8d6c-8d547936c438.png';
if(!fs.existsSync('art-source/build-menu/stone-mason.png'))fs.copyFileSync(art,'art-source/build-menu/stone-mason.png');
const {default:sharp}=await import('file:///C:/Users/Asus/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp/dist/index.mjs');
await sharp(art).resize(320,480).webp({quality:86}).toFile('public/assets/ui/build-menu/cards/stone-mason.webp');
edit('src/economy/settlementConstruction.ts',s=>s.replace('    addMaterialQueue(materials.roofTiles, roofTiles);','    addMaterialQueue(materials.roofTiles, roofTiles);\n    addMaterialQueue(materials.dressedStone, dressedStone);').replace("&& trip.cargoKind !== 'roofTiles'", "&& trip.cargoKind !== 'roofTiles' && trip.cargoKind !== 'dressedStone'").replaceAll('|| roofTilesStock > EPSILON','|| roofTilesStock > EPSILON || dressedStoneStock > EPSILON'));
edit('server/src/construction_priority.rs',s=>s.replace(/construction_labor_ready\(\s*([\w:.,\s]+)\)/g,(all,args)=>{const a=args.split(',').map(x=>x.trim()).filter(Boolean);return a.length===13?`construction_labor_ready(${a.join(', ')}, 0.0, 0.0, 0.0)`:all;}));
edit('src/buildings/proceduralArchitecture/materialRoles.ts',s=>s.replace('if (!permittedStatus && !explicitlyRestrictedToTrim)', "// Mason yards hold dressed blocks as merchandise; their building is timber-framed.\n    const masonryStockyard = plan.kind === 'stone_mason' && containsVocabulary(plan, /ashlar-stacks/);\n    if (!permittedStatus && !explicitlyRestrictedToTrim && !masonryStockyard)"));
edit('src/ui/iconography.css',s=>s.replace("  background-image: url('/assets/ui/icons/materials/dressed-stone.svg');", "  background-image: url('/assets/ui/icons/materials/dressed-stone.svg');\n  background-position: center;\n  background-size: contain;\n  background-repeat: no-repeat;"));
