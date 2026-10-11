import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { DbConnection } from '../src/generated/index.ts';

const uri = process.env.REALM_TEST_URI || 'http://127.0.0.1:3100';
const database = process.env.REALM_TEST_DB || 'city-builder-realm-loadtest';
assert(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(uri).hostname), 'Computer clients are restricted to loopback servers');
const count = Number(process.env.REALM_TEST_PLAYERS || 50);
assert(Number.isInteger(count) && count > 0 && count <= 50);
const tokenPath = '.tmp-realm-test-clients.json';
const saved = existsSync(tokenPath) ? JSON.parse(readFileSync(tokenPath, 'utf8')) as { database: string; tokens: string[] } : null;
const tokens: string[] = saved?.database === database ? saved.tokens : [];
const connections: DbConnection[] = [];
const queries = ['world_config', 'visible_building', 'visible_player_resources', 'visible_tree_entity', 'visible_road_network_state', 'my_realm_member', 'my_realm_fog'];
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate: () => boolean, message: string, timeout = 15_000) {
  const start = performance.now();
  while (!predicate()) { assert(performance.now() - start < timeout, message); await delay(25); }
}
function connect(token?: string): Promise<{ connection: DbConnection; token: string }> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Local realm connection timeout')), 15_000);
    const builder = DbConnection.builder().withUri(uri).withDatabaseName(database)
      .onConnect((connection, _identity, token) => {
        connection.subscriptionBuilder().onApplied(() => { clearTimeout(timeout); resolve({ connection, token }); })
          .onError(ctx => { clearTimeout(timeout); reject(ctx.event); })
          .subscribe(queries.map(table => `SELECT * FROM ${table}`));
      }).onConnectError((_ctx, error) => { clearTimeout(timeout); reject(error); });
    if (token) builder.withToken(token);
    builder.build();
  });
}
const report = { players: count, joinsMs: [] as number[], streamedTrees: [] as number[],
  ownershipIsolated: false, capacityEnforced: false, reconnectStable: false, offlineTimeContinues: false,
  privateTablesDenied: false, globalMutationsDenied: false, terrainUploadsDiscarded: false };
try {
  for (let i = 0; i < count; i++) {
    const start = performance.now();
    const client = await connect(tokens[i]); tokens[i] = client.token; connections.push(client.connection);
    // Persist reconnect credentials after each admission so interrupted tests resume their slots.
    writeFileSync(tokenPath, JSON.stringify({ database, tokens }));
    await client.connection.reducers.enterWorld();
    await until(() => [...client.connection.db.my_realm_member.iter()].length === 1, 'Missing automatic camp assignment');
    await until(() => [...client.connection.db.visible_building.iter()].length > 0, 'Camp not replicated');
    assert([...client.connection.db.visible_building.iter()].every(b => b.owner.toHexString() === client.connection.identity!.toHexString()));
    assert.equal([...client.connection.db.visible_player_resources.iter()].length, 1);
    assert([...client.connection.db.my_realm_fog.iter()].some(f => f.explored !== 0n));
    report.joinsMs.push(performance.now() - start);
    report.streamedTrees.push([...client.connection.db.visible_tree_entity.iter()].length);
    if ((i + 1) % 10 === 0) console.log(`Admitted ${i + 1}/${count} independent local computer clients`);
  }
  report.ownershipIsolated = true;
  const first = connections[0];
  const camp = [...first.db.my_realm_member.iter()][0];
  if ([...first.db.visible_road_network_state.iter()].length===0) {
    await first.reducers.syncRoadNetwork({snapshotJson:JSON.stringify({nodes:[],edges:[],nextNodeId:0,nextEdgeId:0,
      riverNavigation:{resolution:16,startX:-6144,startZ:-6144,spanX:12288,spanZ:12288,wetCellsHex:'00'.repeat(32),heights:Array(256).fill(0)}})});
    await until(()=>[...first.db.visible_road_network_state.iter()].length===1,'Geometry-only road echo missing');
  }
  assert([...first.db.visible_road_network_state.iter()].every(r=>!('riverNavigation' in JSON.parse(r.snapshotJson))),
    'The realm must not store or replicate client-owned terrain');
  report.terrainUploadsDiscarded=true;
  // The running production fixture has moving carts and surveyors, which may
  // legitimately reveal nearby cells while this request is in flight. Check
  // the remote camera destination instead of freezing all unit exploration.
  const remoteExplored = () => [...first.db.my_realm_fog.iter()].find(f => f.chunk === 0)?.explored ?? 0n;
  const fogBefore = remoteExplored();
  await first.reducers.setRealmInterest({ x: -6100, z: -6100 });
  await delay(250);
  assert.equal(remoteExplored(), fogBefore, 'Camera must not explore its remote destination');
  await assert.rejects(first.reducers.resetWorld());
  for (const speed of [0, 1, 4, 8]) await assert.rejects(first.reducers.setGameSpeed({ speed }));
  assert(!('tickSim' in first.reducers),'The scheduled tick must be absent from the public client API');
  const tickAttempt=await fetch(`${uri}/v1/database/${database}/call/tick_sim`,{
    method:'POST',headers:{Authorization:`Bearer ${tokens[0]}`,'Content-Type':'application/json'},
    body:JSON.stringify([{schedule_id:0,scheduled_at:{Time:{__timestamp_micros_since_unix_epoch__:Date.now()*1000}}}]),
  });
  assert([401,403,404].includes(tickAttempt.status),`Direct scheduled tick call was not denied: ${tickAttempt.status} ${await tickAttempt.text()}`);
  await assert.rejects(first.reducers.setDebugDate({ year: 2, month: 6, monthDay: 1 }));
  await assert.rejects(first.reducers.grantCheatResources({ amount: 1_000_000 }));
  await assert.rejects(first.reducers.bootstrapTrees({ trees: [] }));
  report.globalMutationsDenied = true;
  report.privateTablesDenied = await new Promise<boolean>(resolve => {
    first.subscriptionBuilder().onApplied(() => resolve(false)).onError(() => resolve(true)).subscribe('SELECT * FROM building');
  });
  assert(report.privateTablesDenied, 'Raw gameplay tables must not be publicly queryable');
  if (count === 50) {
    const extra = await connect();
    try { await assert.rejects(extra.connection.reducers.enterWorld(), /capacity/); report.capacityEnforced = true; }
    finally { extra.connection.disconnect(); }
  }
  await first.reducers.enterWorld();
  assert.equal([...first.db.my_realm_member.iter()][0].slot, camp.slot);
  const tick = [...first.db.world_config.iter()][0].simTick;
  for (const connection of connections) connection.disconnect();
  connections.length = 0;
  await delay(1_500);
  const returning = await connect(tokens[0]); connections.push(returning.connection);
  await returning.connection.reducers.enterWorld();
  const restored = [...returning.connection.db.my_realm_member.iter()][0];
  assert.equal(restored.slot, camp.slot); assert.equal(restored.campX, camp.campX); assert.equal(restored.campZ, camp.campZ);
  report.reconnectStable = true;
  assert([...returning.connection.db.world_config.iter()][0].simTick > tick, 'Realm must advance with no connected players');
  report.offlineTimeContinues = true;
  mkdirSync('artifacts', { recursive: true });
  writeFileSync('artifacts/realm-network-report.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, joinsMs: { max: Math.max(...report.joinsMs), mean: report.joinsMs.reduce((a, b) => a + b, 0) / count },
    streamedTrees: { max: Math.max(...report.streamedTrees) } }, null, 2));
} finally { for (const connection of connections) connection.disconnect(); }
