import {edit,convert,cloneStatements,rustRoofStatement,imports} from './dressedStoneEditHelpers.mjs';
const rustFiles=['economy/commodities.rs','economy/aggregate_spend.rs','economy/storage.rs','economy/trade_resources.rs','simulation/delivery_cargo.rs','simulation/tick_context.rs','simulation/construction.rs','reducers/buildings.rs','reducers/bootstrap.rs','lifecycle.rs','chapel_upgrade_policy.rs','simulation/reclamation.rs','simulation/founding_site.rs','simulation/fires.rs','simulation/raid_agents.rs','simulation/settlement_security.rs','simulation/removed_content.rs','reducers/cheats.rs'];
for(const f of rustFiles.slice(rustFiles.indexOf('chapel_upgrade_policy.rs'))) edit('server/src/'+f,s=>{
  s=cloneStatements(s,rustRoofStatement,chunk=>convert(chunk).replaceAll('RESIDENCE_TILE_ROOF_SALVAGE_FRACTION','STONE_SALVAGE_FRACTION').replaceAll('26 => Some(Self::DressedStone)','76 => Some(Self::DressedStone)').replaceAll('Self::DressedStone => 26','Self::DressedStone => 76'));
  s=imports(s);
  // Extend repeated field arguments, but keep the roof arguments next to their new counterpart.
  s=s.replace(/^(\s+)(\w+\.construction_\w+_roof_tiles|cost\.roof_tiles|roof_tiles_from_treasury),\r?$/gm,(all,space,x)=>all+'\n'+space+convert(x)+',');
  s=s.replaceAll('treasury_ironwork, treasury_roof_tiles)', 'treasury_ironwork, treasury_roof_tiles, treasury_dressed_stone)');
  s=s.replaceAll('[timber, stone, ironwork, roof_tiles]', '[timber, stone, ironwork, roof_tiles, dressed_stone]');
  s=s.replace(/(\+ (?:nonnegative\()?\w+\.construction_(?:required|delivered|treasury)_roof_tiles\)?)(;?)/g,(all,x,semi)=>x+'\n        '+convert(x)+semi);
  s=s.replace(/(\s+&& roof_tiles_ready)/g,'$1\n        && dressed_stone_ready');
  s=s.replace(/^(.*dispatch_reserved_stock.*CommodityKind::RoofTiles.*)$/gm,l=>l+'\n'+convert(l));
  s=s.replace(/^(.*spend_aggregate_roof_tiles\(.*\?;).*$/gm,l=>l+'\n'+convert(l));
  s=s.replace(/^(\s+owner_index\.construction_roof_tiles\.sort_unstable\(\);)\r?$/gm,l=>l+'\n'+convert(l));
  return s;
});
edit('server/src/economy/commodities.rs',s=>s.replace('[CommodityKind; 71]','[CommodityKind; 72]'));
edit('server/src/economy/storage.rs',s=>s.replaceAll('-> (f64, f64, f64, f64)', '-> (f64, f64, f64, f64, f64)').replace(/\s*\+ reserved_residence_upgrade_total\(ctx, owner, \|residence\| \{\s*residence.upgrade_reserved_dressed_stone\s*\}\)/g,'').replace(/\s*- reserved_residence_upgrade_total\(ctx, owner, \|residence\| \{\s*residence.upgrade_reserved_dressed_stone\s*\}\)/g,''));
edit('server/src/economy/mod.rs',imports);
edit('server/src/simulation/construction.rs',s=>s.replace('site.construction_delivered_roof_tiles += roof_tiles;','site.construction_delivered_roof_tiles += roof_tiles;\n        transfer_budget -= roof_tiles;'));
edit('server/src/construction_priority.rs',s=>s.replaceAll('treasury_roof_tiles: f64,','treasury_roof_tiles: f64,\n    required_dressed_stone: f64, delivered_dressed_stone: f64, treasury_dressed_stone: f64,').replace(/nonnegative\((required|delivered|treasury)_roof_tiles\)/g,(all,p)=>all+' + nonnegative('+p+'_dressed_stone)'));
// The readiness API groups the three new values last; normalize call sites accordingly.
for(const f of ['simulation/construction.rs','reducers/buildings.rs','simulation/delivery_trips.rs']) edit('server/src/'+f,s=>s.replace(/(\w+)\.construction_required_roof_tiles,\s*\1\.construction_required_dressed_stone,\s*\1\.construction_delivered_roof_tiles,\s*\1\.construction_delivered_dressed_stone,\s*\1\.construction_treasury_roof_tiles,\s*\1\.construction_treasury_dressed_stone,/g,(_,x)=>`${x}.construction_required_roof_tiles, ${x}.construction_delivered_roof_tiles, ${x}.construction_treasury_roof_tiles,\n ${x}.construction_required_dressed_stone, ${x}.construction_delivered_dressed_stone, ${x}.construction_treasury_dressed_stone,`));
