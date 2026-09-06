import {edit,convert,cloneStatements} from './dressedStoneEditHelpers.mjs';
const files=['resources/resourceTotals.ts','resources/buildingEconomy.ts','ui/resourceCost.ts','ui/hudResourceCards.ts','ui/resourceDescriptions.ts','economy/chapelUpgrade.ts','economy/marketplaceTrade.ts','economy/regionalMarket.ts','economy/tradingPostTrade.ts','economy/settlementConstruction.ts','economy/constructionLabor.ts','logistics/constructionLogistics.ts','logistics/foundingStockyardLogistics.ts','logistics/deliveryTrips.ts','resources/settlementResourceReport.ts','buildings/BuildingPlacementValidation.ts','ui/buildToolbarStatus.ts','resources/inspector/constructionRenderer.ts','resources/inspector/chapelRenderer.ts','resources/inspector/foundersCampRenderer.ts','resources/inspector/townHallRenderer.ts','resources/inspector/buildingCommon.ts','app/App.ts','fires/fireRecovery.ts'];
for(const p of files) edit('src/'+p,s=>{
  s=cloneStatements(s,l=>/^\s*(?:(?:let|const) \w*(?:roofTiles|RoofTiles)\w*\b|\w*(?:roofTiles|RoofTiles)\w*\??\s*:|(?:\w+\.)?\w*(?:roofTiles|RoofTiles)\w*\s*[-+]?=|CHAPEL_TIER\d_UPGRADE_ROOF_TILES,|if \([^\n]*\broofTiles\b)/.test(l) && !/\b(?:timber|stone|ironwork)\b|(?:upgrade|Upgrade)(?:Reserved|Required|Delivered)RoofTiles/.test(l), chunk=>convert(chunk).replaceAll('RESIDENCE_TILE_ROOF_SALVAGE_FRACTION','STONE_SALVAGE_FRACTION'));
  s=s.replace(/('(?:\w*RoofTiles|roofTiles)')(?=\s*\|)/g,x=>x+' | '+convert(x));
  s=s.replace(/^(\s*\| '(?:\w*RoofTiles|roofTiles)')/gm,x=>x+'\n'+convert(x));
  s=s.replace(/^(\s*'roofTiles',)/gm,x=>x+'\n'+convert(x));
  s=s.replace(/(\+ (?:nonnegative\()?building\.construction(?:Required|Delivered|Treasury)RoofTiles\)?)/g,x=>x+' '+convert(x));
  s=s.replace(/(&& totals\.roofTiles >= \(cost\.roofTiles \?\? 0\))/g,x=>x+'\n    '+convert(x));
  return s;
});
