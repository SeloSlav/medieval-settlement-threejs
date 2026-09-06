import fs from 'node:fs';
const read = p => fs.readFileSync(p, 'utf8');
const write = (p,s) => fs.writeFileSync(p,s);
const edit = (p,fn) => write(p,fn(read(p)));
const convert = s => s.replaceAll('ROOF_TILES','DRESSED_STONE').replaceAll('RoofTiles','DressedStone').replaceAll('roofTiles','dressedStone').replaceAll('roof_tiles','dressed_stone').replaceAll('fired roof tiles','dressed stone').replaceAll('Fired roof tiles','Dressed stone').replaceAll('roof tiles','dressed stone').replaceAll('Roof tiles','Dressed stone');
// Preserve the balance source's layout while inserting authored entries.
edit('balance/gameBalance.json', s => {
  s=s.replace('"potter_kiln": 1.8,','"potter_kiln": 1.8,\n      "stone_mason": 2.0,');
  for (const [tier,stone,dressed] of [[2,96,0],[3,144,64],[4,432,240]]) {
    s=s.replace(new RegExp(`("chapelTier${tier}UpgradeStone": )\\d+`), `$1${stone}`);
    s=s.replace(new RegExp(`("chapelTier${tier}UpgradeRoofTiles": \\d+,)`), `$1\n    "chapelTier${tier}UpgradeDressedStone": ${dressed},`);
  }
  s=s.replace('"potterRoofTilesPerCycle": 4,','"potterRoofTilesPerCycle": 4,\n    "masonStonePerCycle": 8,\n    "masonDressedStonePerCycle": 4,');
  s=s.replace('    "potter_kiln": {', `    "stone_mason": {
      "label": "Stonemason's Yard",
      "cost": { "timber": 40, "stone": 24, "ironwork": 4 },
      "storage": { "total": 160, "timber": 0, "firewood": 0, "stone": 96, "water": 0, "dressedStone": 64 },
      "workRadius": 0, "pickRadius": 8, "harvestInterval": 900, "regrowRate": 0,
      "maxLabor": 2, "acceptsLabor": true, "requiresRoad": true, "facesRoad": true,
      "requiresMatureTrees": false, "requiresQuarryStone": false, "requiresGame": false,
      "requiresBerries": false, "requiresWaterShore": false, "requiresHillside": false
    },
    "potter_kiln": {`);
  // Storage, trade, and foundation recovery holders carry finished masonry.
  s=s.replace(/"roofTiles": (80|500|120)(,)/g, '$& "dressedStone": $1,');
  s=s.replace('"roofTiles": "marketAccessible",','"roofTiles": "marketAccessible",\n        "dressedStone": "marketAccessible",');
  s=s.replace('      { "id": "buy_roof_tiles"', '      { "id": "buy_dressed_stone", "kind": "goldBuy", "resource": "dressedStone", "amount": 12, "goldCost": 48 },\n      { "id": "sell_dressed_stone", "kind": "goldSell", "resource": "dressedStone", "amount": 12, "goldYield": 30 },\n      { "id": "buy_roof_tiles"');
  // These are masonry institutions; keep their foundations in rough stone.
  for (const [kind,stone,dressed] of [['town_hall',72,32],['monastery',102,48]]) {
    const re=new RegExp(`("${kind}": \\{[\\s\\S]*?"cost": \\{[^}]*?"stone": )\\d+`);
    s=s.replace(re, `$1${stone}, "dressedStone": ${dressed}`);
  }
  JSON.parse(s);
  return s;
});
edit('scripts/generateGameBalance.mts', s => {
  s=s.replaceAll('roofTiles?: number;', 'roofTiles?: number; dressedStone?: number;');
  s=s.replaceAll("potter_kiln: 'PotterKiln',", "potter_kiln: 'PotterKiln',\n  stone_mason: 'StoneMason',");
  s=s.replace("lines.push('    PotterKiln,');", "lines.push('    PotterKiln,');\n  lines.push('    StoneMason,');");
  s=s.split('\n').flatMap(l => /chapelTier\dUpgradeRoofTiles: number|CHAPEL_TIER\d_UPGRADE_ROOF_TILES|pub (cost|storage)_roof_tiles|lines.push\(`    (cost|storage)_roof_tiles/.test(l) ? [l,convert(l)] : [l]).join('\n');
  s=s.replace('potterRoofTilesPerCycle: number;', 'potterRoofTilesPerCycle: number;\n    masonStonePerCycle: number;\n    masonDressedStonePerCycle: number;');
  s=s.replace(/^(.*POTTER_ROOF_TILES_PER_CYCLE.*)$/gm, l => l+'\n'+l.replaceAll('POTTER_ROOF_TILES_PER_CYCLE','MASON_STONE_PER_CYCLE').replaceAll('potterRoofTilesPerCycle','masonStonePerCycle')+'\n'+l.replaceAll('POTTER_ROOF_TILES_PER_CYCLE','MASON_DRESSED_STONE_PER_CYCLE').replaceAll('potterRoofTilesPerCycle','masonDressedStonePerCycle'));
  s=s.replace('    const roofTiles = def.cost.roofTiles', '    const dressedStone = def.cost.dressedStone ? `, dressedStone: ${def.cost.dressedStone}` : \"\";\n    const roofTiles = def.cost.roofTiles');
  s=s.replace('${ironwork}${roofTiles}${gold}', '${ironwork}${roofTiles}${dressedStone}${gold}');
  s=s.replace('    const roofTiles = def.storage.roofTiles ?? 0;', '    const roofTiles = def.storage.roofTiles ?? 0;\n    const dressedStone = def.storage.dressedStone ?? 0;');
  s=s.replace('    if (roofTiles > 0) extras.push(`roofTiles: ${roofTiles}`);', '    if (roofTiles > 0) extras.push(`roofTiles: ${roofTiles}`);\n    if (dressedStone > 0) extras.push(`dressedStone: ${dressedStone}`);');
  return s;
});
// Physical inventory and construction fields, serialized on both sides.
for (const p of ['server/src/tables.rs','src/resources/types.ts','src/data/spacetimeTableSync/syncBuildings.ts','src/data/spacetimeTableSync/syncPlayerResources.ts']) edit(p,s => s.split('\n').flatMap(l => /roofTiles|RoofTiles|roof_tiles/.test(l) && !/upgrade_|upgrade[A-Z]/.test(l) ? [l,convert(l)] : [l]).join('\n'));
