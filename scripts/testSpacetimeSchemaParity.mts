import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

type Field = {
  name: string;
  type: string;
};

type RustTable = {
  accessor: string;
  structName: string;
  fields: Field[];
};

const workspaceRoot = fileURLToPath(new URL('../', import.meta.url));
const rustTablesPath = fileURLToPath(new URL('../server/src/tables.rs', import.meta.url));
const subscriptionsPath = fileURLToPath(
  new URL('../src/data/gameTableSubscriptions.ts', import.meta.url),
);
const generatedDirectory = fileURLToPath(new URL('../src/generated/', import.meta.url));

const rustTypeToGeneratedType = new Map<string, string>([
  ['bool', 'bool'],
  ['f32', 'f32'],
  ['f64', 'f64'],
  ['i8', 'i8'],
  ['i16', 'i16'],
  ['i32', 'i32'],
  ['i64', 'i64'],
  ['u8', 'u8'],
  ['u16', 'u16'],
  ['u32', 'u32'],
  ['u64', 'u64'],
  ['String', 'string'],
  ['Identity', 'identity'],
]);

function parseSubscribedTableNames(source: string): string[] {
  const declaration = source.match(
    /GAME_TABLE_SUBSCRIPTIONS\s*=\s*\[([\s\S]*?)\]\s*as const/,
  );
  assert.ok(declaration, 'GAME_TABLE_SUBSCRIPTIONS declaration was not found');
  return [...declaration[1].matchAll(/'([a-z0-9_]+)'/g)].map((match) => match[1]);
}

function parseRustTables(source: string): Map<string, RustTable> {
  const tables = new Map<string, RustTable>();
  const tablePattern = /#\[spacetimedb::table\(([\s\S]*?)\)\]\s*(?:#\[[^\n]*\]\s*)*pub struct\s+(\w+)\s*\{([\s\S]*?)\n\}/g;

  for (const match of source.matchAll(tablePattern)) {
    const [, tableOptions, structName, body] = match;
    if (!/(?:^|,)\s*public\s*(?:,|$)/m.test(tableOptions)) {
      continue;
    }
    const accessorMatch = tableOptions.match(/\baccessor\s*=\s*([a-z0-9_]+)/);
    assert.ok(accessorMatch, `public Rust table ${structName} has no accessor`);
    const accessor = accessorMatch[1];
    const fields = [...body.matchAll(/^\s*pub\s+([a-zA-Z0-9_]+)\s*:\s*([^,\n]+),/gm)].map(
      (fieldMatch): Field => {
        const rustType = fieldMatch[2].trim();
        const generatedType = rustTypeToGeneratedType.get(rustType);
        assert.ok(
          generatedType,
          `Rust table ${structName}.${fieldMatch[1]} uses unsupported parity-test type ${rustType}`,
        );
        return { name: fieldMatch[1], type: generatedType };
      },
    );
    assert.ok(fields.length > 0, `Rust table ${structName} has no parsed public fields`);
    tables.set(accessor, { accessor, structName, fields });
  }

  return tables;
}

function camelToSnake(value: string): string {
  return value.replace(/[A-Z]/g, (character) => `_${character.toLowerCase()}`);
}

function parseGeneratedFields(tableName: string, source: string): Field[] {
  const rowMatch = source.match(/export default __t\.row\(\{([\s\S]*?)\n\}\);/);
  assert.ok(rowMatch, `${tableName}_table.ts has no generated row declaration`);

  const fields = [...rowMatch[1].matchAll(/^\s*([a-zA-Z0-9_]+):\s*__t\.([a-zA-Z0-9_]+)\(\)([^,]*),/gm)].map(
    (fieldMatch): Field => {
      const explicitName = fieldMatch[3].match(/\.name\("([a-zA-Z0-9_]+)"\)/)?.[1];
      return {
        name: explicitName ?? camelToSnake(fieldMatch[1]),
        type: fieldMatch[2],
      };
    },
  );
  assert.ok(fields.length > 0, `${tableName}_table.ts has no parsed fields`);
  return fields;
}

const subscriptions = parseSubscribedTableNames(readFileSync(subscriptionsPath, 'utf8'));
const rustTables = parseRustTables(readFileSync(rustTablesPath, 'utf8'));

assert.ok(
  subscriptions.includes('settlement'),
  'the durable town/community table must be part of the authoritative game subscription',
);

for (const tableName of subscriptions) {
  const rustTable = rustTables.get(tableName);
  assert.ok(rustTable, `subscribed table ${tableName} has no public Rust table definition`);

  const generatedPath = `${generatedDirectory}${tableName}_table.ts`;
  assert.ok(
    existsSync(generatedPath),
    `subscribed table ${tableName} has no generated TypeScript binding at ${generatedPath}`,
  );
  const generatedFields = parseGeneratedFields(tableName, readFileSync(generatedPath, 'utf8'));
  assert.deepEqual(
    generatedFields,
    rustTable.fields,
    `${tableName} generated field order/types differ from Rust ${rustTable.structName}; run canonical SpacetimeDB binding generation`,
  );
}

const building = rustTables.get('building');
assert.ok(building, 'building table must be subscribed and public');
assert.deepEqual(
  building.fields.slice(-19),
  [
    { name: 'tree_work_area_x', type: 'f64' },
    { name: 'tree_work_area_z', type: 'f64' },
    { name: 'tree_work_area_radius', type: 'f64' },
    { name: 'settlement_id', type: 'u64' },
    { name: 'animal_feed', type: 'f64' },
    { name: 'storage_acceptance_mask_high', type: 'u64' },
    { name: 'wax', type: 'f64' },
    { name: 'candles', type: 'f64' },
    { name: 'apiary_wax_cycle_progress', type: 'u8' },
    { name: 'pelts', type: 'f64' },
    { name: 'yarn', type: 'f64' },
    { name: 'linen', type: 'f64' },
    { name: 'milk_use_policy', type: 'u8' },
    { name: 'smokehouse_recipe_policy', type: 'u8' },
    { name: 'production_rate_percent', type: 'u8' },
    { name: 'production_maintenance_progress', type: 'f64' },
    { name: 'placement_yaw', type: 'f64' },
    { name: 'placement_yaw_locked', type: 'bool' },
    { name: 'apiary_accumulated_honey', type: 'f64' },
  ],
  'new Building fields must append without reordering saved fields',
);

const playerResources = rustTables.get('player_resources');
assert.ok(playerResources, 'player_resources table must be subscribed and public');
assert.deepEqual(
  playerResources.fields.slice(-5),
  [
    { name: 'wax', type: 'f64' },
    { name: 'candles', type: 'f64' },
    { name: 'pelts', type: 'f64' },
    { name: 'yarn', type: 'f64' },
    { name: 'linen', type: 'f64' },
  ],
  'new commodity treasury fields must remain additive',
);

const backyardGarden = rustTables.get('backyard_garden');
assert.ok(backyardGarden, 'backyard_garden table must be subscribed and public');
assert.deepEqual(
  backyardGarden.fields.at(-1),
  { name: 'wax_stock', type: 'f64' },
  'backyard wax stock must remain an additive compatibility field',
);

for (const tableName of ['burgage_zone', 'residence'] as const) {
  const table = rustTables.get(tableName);
  assert.ok(table, `${tableName} table must be subscribed and public`);
  assert.deepEqual(
    table.fields.at(-1),
    { name: 'settlement_id', type: 'u64' },
    `${tableName}.settlement_id must remain the final additive compatibility field`,
  );
}

const settlement = rustTables.get('settlement');
assert.ok(settlement, 'settlement must be a public subscribed table');
for (const requiredField of [
  'id',
  'owner',
  'name',
  'anchor_x',
  'anchor_z',
  'founding_camp_id',
  'town_hall_id',
  'founder_population',
  'unhoused_founders',
] as const) {
  assert.ok(
    settlement.fields.some((field) => field.name === requiredField),
    `Settlement.${requiredField} is required for durable community and founding-cohort authority`,
  );
}
for (const forbiddenResourceField of [
  'timber',
  'stone',
  'firewood',
  'food',
  'gold',
] as const) {
  assert.ok(
    !settlement.fields.some((field) => field.name === forbiddenResourceField),
    `Settlement must not create a separate ${forbiddenResourceField} wallet; resources stay physical and realm-integrated`,
  );
}

console.log(
  `Spacetime schema parity passed for ${subscriptions.length} subscribed tables (${workspaceRoot}).`,
);
