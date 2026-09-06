import {edit,convert,cloneStatements,rustRoofStatement} from './dressedStoneEditHelpers.mjs';
edit('scripts/generateMarketplaceTradeBalance.mts',s=>s.replace("'remedies', 'roofTiles',", "'remedies', 'roofTiles', 'dressedStone',"));
edit('server/src/economy/storage.rs',s=>{
  s=s.replace(/(    let roof_tiles_from_treasury = [\s\S]*?\))\r?\n(    let dressed_stone_from_treasury = [\s\S]*?\))\r?\n(\s*\.clamp\(0\.0, available_unreserved_treasury_roof_tiles\(ctx, owner\)\);)/g,(_,a,b,c)=>a+c+'\n'+b+convert(c));
  s=s.replace(/(    let building_roof_tiles: f64 = ctx)\r?\n    let building_dressed_stone: f64 = ctx([\s\S]*?\.sum\(\);)/,(_,a,b)=>a+b+'\n'+convert(a+b));
  return s;
});
edit('server/src/simulation/construction.rs',s=>s.replace(/(    let roof_tiles = transfer_budget)\r?\n    let dressed_stone = transfer_budget([\s\S]*?\.min\(whole_units\(treasury.roof_tiles\)\);)/,(_,a,b)=>a+b).replace(/    if dressed_stone > 1e-6/, '    let dressed_stone = transfer_budget.min(whole_units(site.construction_treasury_dressed_stone)).min(whole_units(treasury.dressed_stone));\n    if dressed_stone > 1e-6'));
edit('server/src/simulation/founding_site.rs',s=>s.replace(/(\s+CommodityKind::RoofTiles => \(building.construction_reserved_roof_tiles\s*- building.construction_treasury_roof_tiles\))/, '$1.max(0.0),'));
edit('server/src/chapel_upgrade_policy.rs',s=>s.replace(/(roof_tiles: CHAPEL_TIER([234])_UPGRADE_ROOF_TILES), CHAPEL_TIER\2_UPGRADE_DRESSED_STONE,/g,'$1,'));
for(const p of ['server/src/economy/chapel_coffer.rs','server/src/security_policy.rs','server/src/economy/regional_market.rs','server/src/simulation/trading_post_trade.rs']) edit(p,s=>cloneStatements(s,rustRoofStatement));
edit('server/src/simulation/reclamation.rs',s=>s.replace('[CommodityKind; 71]','[CommodityKind; 72]'));
edit('server/src/simulation/settlement_security.rs',s=>s.replaceAll('Some(CommodityKind::RoofTiles)', 'Some(CommodityKind::RoofTiles | CommodityKind::DressedStone)'));
edit('server/src/simulation/delivery_trips.rs',s=>{
  s=cloneStatements(s,l=>/^\s*CommodityKind::RoofTiles =>/.test(l),c=>/residence/.test(c)?'':convert(c));
  s=s.replace(/(\s+site\.construction_treasury_roof_tiles,)/g,'$1\n        site.construction_required_dressed_stone, site.construction_delivered_dressed_stone, site.construction_treasury_dressed_stone,');
  s=s.replace(/\| CommodityKind::RoofTiles/g,'| CommodityKind::RoofTiles | CommodityKind::DressedStone');
  return s;
});
