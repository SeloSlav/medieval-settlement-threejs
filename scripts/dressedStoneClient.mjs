import fs from 'node:fs';
import ts from 'typescript';
import {edit,convert} from './dressedStoneEditHelpers.mjs';
const files=['resources/resourceTotals.ts','resources/buildingEconomy.ts','ui/resourceCost.ts','ui/hudResourceCards.ts','ui/resourceDescriptions.ts','economy/chapelUpgrade.ts','economy/marketplaceTrade.ts','economy/regionalMarket.ts','economy/tradingPostTrade.ts','economy/settlementConstruction.ts','economy/constructionLabor.ts','logistics/constructionLogistics.ts','logistics/foundingStockyardLogistics.ts','logistics/deliveryTrips.ts','resources/settlementResourceReport.ts','buildings/BuildingPlacementValidation.ts','ui/buildToolbarStatus.ts','resources/inspector/constructionRenderer.ts','resources/inspector/chapelRenderer.ts','resources/inspector/foundersCampRenderer.ts','resources/inspector/townHallRenderer.ts','resources/inspector/buildingCommon.ts','app/App.ts','fires/fireRecovery.ts'];
const roof=/roofTiles|RoofTiles|ROOF_TILES/;
for(const p of files) edit('src/'+p,s=>{
  const source=ts.createSourceFile(p,s,ts.ScriptTarget.Latest,true), inserts=[];
  const add=(n,separator='\n')=>inserts.push([n.end,separator+convert(n.getText(source)).replaceAll('RESIDENCE_TILE_ROOF_SALVAGE_FRACTION','STONE_SALVAGE_FRACTION')]);
  const visit=n=>{
    const name=n.name?.getText(source)??'';
    if((ts.isPropertyAssignment(n)||ts.isShorthandPropertyAssignment(n)) && roof.test(name)) {add(n,',\n');return;}
    if(ts.isPropertySignature(n)&&roof.test(name)) {add(n);return;}
    if(ts.isImportSpecifier(n)&&/CHAPEL_TIER/.test(name)&&roof.test(name)) {add(n,', ');return;}
    if(ts.isVariableStatement(n)&&n.declarationList.declarations.length===1&&roof.test(n.declarationList.declarations[0].name.getText(source))) {add(n);return;}
    if(ts.isExpressionStatement(n)&&roof.test(n.getText(source))&&!/upgrade.*RoofTiles|upgrades.*RoofTiles/.test(n.getText(source))&&!/\b(?:timber|stone|ironwork)\b/.test(n.getText(source))) {add(n);return;}
    if(ts.isIfStatement(n)&&roof.test(n.expression.getText(source))&&!/\b(?:timber|stone|ironwork)\b/.test(n.expression.getText(source))&&!n.elseStatement) {add(n);return;}
    if(ts.isCaseClause(n)&&roof.test(n.expression.getText(source))) {add(n);return;}
    if(ts.isStringLiteral(n)&&roof.test(n.text)) {
      if(ts.isUnionTypeNode(n.parent.parent)&&ts.isLiteralTypeNode(n.parent)) add(n,' | ');
      else if(ts.isArrayLiteralExpression(n.parent))add(n,', ');
      return;
    }
    ts.forEachChild(n,visit);
  };
  visit(source);
  for(const [pos,text] of inserts.sort((a,b)=>b[0]-a[0]))s=s.slice(0,pos)+text+s.slice(pos);
  // Separate amounts contribute independently to readiness and affordability.
  s=s.replace(/(\+ (?:nonnegative\()?building\.construction(?:Required|Delivered|Treasury)RoofTiles\)?)/g,x=>x+' '+convert(x));
  s=s.replace(/(&& totals\.roofTiles >= \(cost\.roofTiles \?\? 0\))/g,x=>x+'\n    '+convert(x));
  // Household roof projects do not consume masonry; their reservations stay unchanged.
  s=s.replace(/^.*(?:residence|home)\.upgrade(?:Reserved|Required|Delivered)DressedStone.*\r?\n/gm,'');
  return s;
});
