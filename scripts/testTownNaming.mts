import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  MAX_TOWN_NAME_CHARACTERS,
  normalizeTownName,
} from '../src/ui/TownNameDialog.ts';

const source = (path: string): string => readFileSync(path, 'utf8');

const settlementAuthority = source('server/src/settlements.rs');
const poolMatch = /CANONICAL_SETTLEMENT_NAMES:\s*\[&str;\s*50\]\s*=\s*\[([\s\S]*?)\];/.exec(
  settlementAuthority,
);
assert.ok(poolMatch, 'town creation needs an explicit 50-name regional pool');
const canonicalNames = [...poolMatch[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
assert.equal(canonicalNames.length, 50);
assert.equal(new Set(canonicalNames.map((name) => name.toLocaleLowerCase())).size, 50);
assert.doesNotMatch(
  settlementAuthority,
  /format!\("Town \{ordinal\}"\)/,
  'new communities must not use ordinal placeholder names',
);
assert.match(settlementAuthority, /settlement_name_entropy[\s\S]*world_config[\s\S]*config\.seed/);
assert.match(settlementAuthority, /used\.contains[\s\S]*candidate\.to_lowercase/);
assert.match(settlementAuthority, /is_legacy_ordinal_name[\s\S]*name_customized/);

const settlementTable = source('server/src/tables.rs');
assert.match(settlementTable, /pub name_customized: bool/);

const villageAdmin = source('server/src/reducers/village_admin.rs');
assert.match(
  villageAdmin,
  /pub fn rename_settlement\([\s\S]*settlement_id: u64[\s\S]*name: String[\s\S]*settlement\.owner != owner[\s\S]*normalize_settlement_name[\s\S]*name_customized = true/,
);

const generatedReducer = source('src/generated/rename_settlement_reducer.ts');
assert.match(generatedReducer, /settlementId: __t\.u64\(\)/);
assert.match(generatedReducer, /name: __t\.string\(\)/);
assert.match(source('src/generated/index.ts'), /__reducerSchema\("rename_settlement"/);

const clientReducers = source('src/data/spacetimeReducers.ts');
assert.match(
  clientReducers,
  /function renameSettlement\([\s\S]*parseSettlementServerId[\s\S]*rename_settlement[\s\S]*settlementId: serverId/,
);

const mapIcons = source('src/map/SettlementMapIcons.ts');
assert.match(mapIcons, /data-settlement-map-rename/);
assert.match(mapIcons, /onSettlementRename/);
const townReport = source('src/ui/TownReportPanel.ts');
assert.match(townReport, /data-town-report-rename/);
assert.match(townReport, /onRename/);
const worldMapUi = source('src/app/worldMapIcons.ts');
assert.match(worldMapUi, /TownNameDialog/);
assert.match(worldMapUi, /await townNameDialog\.prompt/);
assert.match(worldMapUi, /await onSettlementRename/);

assert.equal(normalizeTownName('  Novi   Vinodol  '), 'Novi Vinodol');
assert.equal(normalizeTownName('\tBrinje\n'), 'Brinje');
assert.equal(MAX_TOWN_NAME_CHARACTERS, 48);

console.log('Canonical town naming and confirmed rename contracts passed.');
