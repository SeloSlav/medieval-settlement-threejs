import assert from 'node:assert/strict';
import { DbConnection } from '../src/generated/index.ts';

const databaseName = process.argv[2]?.trim()
  || process.env.SPACETIME_ACTIVE_SESSION_TEST_DB?.trim();
if (!databaseName) {
  throw new Error(
    'Pass a disposable database name or set SPACETIME_ACTIVE_SESSION_TEST_DB.',
  );
}

const uri = process.env.SPACETIME_ACTIVE_SESSION_TEST_URI?.trim()
  || 'http://127.0.0.1:3000';
const clients: DbConnection[] = [];

try {
  const first = await connectAndSubscribe();
  clients.push(first);
  await callReducer(first, 'configureWorld', 'configure_world', {
    seed: 42n,
    mapSize: 1,
    topography: 50,
    hydrology: 50,
    forestDensity: 50,
    resourceAbundance: 50,
    resourceVariety: 50,
    conflictEnabled: false,
    enemyPressure: 0,
  });
  // A far, finite coordinate avoids the small generated resource cluster. The
  // fresh-world founding reducer intentionally trusts the already validated
  // client terrain after checking physical resource deposits.
  await callReducer(first, 'placeBuilding', 'place_building', {
    kind: 'founders_camp',
    x: 9_000,
    z: 9_000,
  });
  await waitUntil(() => first.db.building.count() > 0, 'founders camp replication');

  const idleTick = currentTick(first);
  await wait(1_000);
  assert.equal(
    currentTick(first),
    idleTick,
    'a subscribed transport that has not entered gameplay must not advance time',
  );

  await callReducer(first, 'enterWorld', 'enter_world', {});
  const enteredTick = currentTick(first);
  await waitUntil(() => currentTick(first) > enteredTick, 'tick after enter_world');
  assert.equal(currentSpeed(first), 1, 'entering must not rewrite selected speed');

  const second = await connectAndSubscribe();
  clients.push(second);
  await callReducer(second, 'enterWorld', 'enter_world', {});
  first.disconnect();
  clients.splice(clients.indexOf(first), 1);
  const remainingClientTick = currentTick(second);
  await waitUntil(
    () => currentTick(second) > remainingClientTick,
    'tick while a second gameplay connection remains',
  );
  assert.equal(currentSpeed(second), 1, 'disconnecting one tab must preserve selected speed');

  second.disconnect();
  clients.splice(clients.indexOf(second), 1);
  await wait(600);

  const observer = await connectAndSubscribe();
  clients.push(observer);
  const disconnectedTick = currentTick(observer);
  await wait(1_000);
  assert.equal(
    currentTick(observer),
    disconnectedTick,
    'the world must freeze after its last gameplay connection disconnects',
  );
  assert.equal(currentSpeed(observer), 1, 'automatic disconnect pause must preserve selected speed');

  console.log(
    `active gameplay integration passed (idle=${idleTick}, final=${disconnectedTick}, speed=1x)`,
  );
} finally {
  for (const client of clients) {
    try {
      client.disconnect();
    } catch {
      // Best-effort cleanup for a disposable integration database.
    }
  }
}

async function connectAndSubscribe(): Promise<DbConnection> {
  const connection = await new Promise<DbConnection>((resolve, reject) => {
    DbConnection.builder()
      .withUri(uri)
      .withDatabaseName(databaseName)
      .withConfirmedReads(false)
      .onConnect((connected) => resolve(connected))
      .onConnectError((_context, error) => reject(error))
      .build();
  });

  await new Promise<void>((resolve, reject) => {
    connection.subscriptionBuilder()
      .onApplied(() => resolve())
      .onError((context) => reject(new Error(String(context.event))))
      .subscribe([
        'SELECT * FROM world_config',
        'SELECT * FROM building',
      ]);
  });
  return connection;
}

async function callReducer(
  connection: DbConnection,
  camelName: string,
  snakeName: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const reducers = connection.reducers as unknown as Record<
    string,
    ((args: Record<string, unknown>) => Promise<void>) | undefined
  >;
  const reducer = reducers[camelName] ?? reducers[snakeName];
  if (!reducer) throw new Error(`Missing reducer ${camelName}`);
  await reducer(payload);
}

function currentTick(connection: DbConnection): number {
  const row = [...connection.db.world_config.iter()][0];
  if (!row) throw new Error('world_config is not subscribed');
  return Number(row.simTick);
}

function currentSpeed(connection: DbConnection): number {
  const row = [...connection.db.world_config.iter()][0];
  if (!row) throw new Error('world_config is not subscribed');
  return row.gameSpeed;
}

async function waitUntil(
  predicate: () => boolean,
  label: string,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await wait(50);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
