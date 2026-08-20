import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { GameRuntime } from '../src/runtime/GameRuntime.ts';
import { DEFAULT_WORLD_GENERATION_SETTINGS } from '../src/world/worldGenerationSettings.ts';

// GameRuntime uses the browser timer surface only when a subscribed world row
// is late. Point it at Node's compatible timer globals for this focused test.
(globalThis as unknown as { window: typeof globalThis }).window = globalThis;

await testReadinessWaitsForGameplayRegistration();
await testDisconnectInvalidatesAStaleRegistration();
await testAuthorityAndProbeContracts();

console.log('active gameplay session tests passed');

async function testReadinessWaitsForGameplayRegistration(): Promise<void> {
  const entry = deferred<void>();
  const harness = createRuntimeHarness([entry.promise]);

  harness.runtime.start();
  await flushAsyncWork();

  assert.equal(harness.enterCalls, 1);
  assert.equal(
    harness.readyCalls,
    0,
    'controls must remain blocked until enter_world commits on the authority',
  );

  for (let index = 0; index < 20; index += 1) {
    harness.emit({ simTick: index + 1 });
  }
  await flushAsyncWork();
  assert.equal(
    harness.enterCalls,
    1,
    'replicated ticks must not duplicate an in-flight gameplay registration',
  );

  entry.resolve();
  await flushAsyncWork();
  assert.equal(harness.readyCalls, 1);

  harness.emit({ simTick: 100 });
  await flushAsyncWork();
  assert.equal(harness.enterCalls, 1);
  assert.equal(harness.readyCalls, 1, 'one connection may become ready only once');
  harness.runtime.dispose();
}

async function testDisconnectInvalidatesAStaleRegistration(): Promise<void> {
  const firstEntry = deferred<void>();
  const secondEntry = deferred<void>();
  const harness = createRuntimeHarness([firstEntry.promise, secondEntry.promise]);

  harness.runtime.start();
  await flushAsyncWork();
  assert.equal(harness.enterCalls, 1);

  harness.emit({
    connected: false,
    identityHex: null,
    roads: null,
  });
  firstEntry.resolve();
  await flushAsyncWork();
  assert.equal(
    harness.readyCalls,
    0,
    'a reducer completion from a dead connection must not re-enable gameplay',
  );

  harness.emit({
    connected: true,
    identityHex: 'owner',
    roads: { reconnect: true },
  });
  await flushAsyncWork();
  assert.equal(
    harness.enterCalls,
    2,
    'a reconnected transport must register its new ConnectionId',
  );
  assert.equal(harness.readyCalls, 0);

  secondEntry.resolve();
  await flushAsyncWork();
  assert.equal(harness.readyCalls, 1);
  harness.runtime.dispose();
}

async function testAuthorityAndProbeContracts(): Promise<void> {
  const [tablesSource, lifecycleSource, simulationSource, probeSource] = await Promise.all([
    readFile(new URL('../server/src/tables.rs', import.meta.url), 'utf8'),
    readFile(new URL('../server/src/lifecycle.rs', import.meta.url), 'utf8'),
    readFile(new URL('../server/src/reducers/simulation.rs', import.meta.url), 'utf8'),
    readFile(new URL('../src/network/serverWorldProbe.ts', import.meta.url), 'utf8'),
  ]);

  const sessionTable = tablesSource.match(
    /#\[spacetimedb::table\(([\s\S]*?)\)\]\s*pub struct ActiveGameSession \{([\s\S]*?)\n\}/,
  );
  assert.ok(sessionTable, 'the authority must define an active gameplay session table');
  assert.doesNotMatch(sessionTable[1], /\bpublic\b/, 'gameplay sessions must stay private');
  assert.match(sessionTable[2], /#\[primary_key\]\s*pub connection_id: ConnectionId/);
  assert.match(sessionTable[2], /pub identity: Identity/);

  const enterWorld = lifecycleSource.match(
    /#\[reducer\]\s*pub fn enter_world\([\s\S]*?\n\}/,
  )?.[0] ?? '';
  assert.match(enterWorld, /ctx\s*\.connection_id\(\)/);
  assert.match(enterWorld, /active_game_session\(\)/);
  assert.match(enterWorld, /find\(&connection_id\)/, 'enter_world must be idempotent per connection');

  const disconnect = lifecycleSource.match(
    /#\[reducer\(client_disconnected\)\]\s*pub fn client_disconnected\([\s\S]*?\n\}/,
  )?.[0] ?? '';
  assert.match(disconnect, /connection_id\(\)/);
  assert.match(disconnect, /delete\(&connection_id\)/);

  const activeGuard = simulationSource.indexOf(
    'if ctx.db.active_game_session().iter().next().is_none()',
  );
  const firstMutation = simulationSource.indexOf('retire_removed_buildings(ctx)');
  const selectedSpeedGuard = simulationSource.indexOf('if config.game_speed == 0');
  assert.ok(activeGuard >= 0, 'the simulation must require an active gameplay session');
  assert.ok(
    activeGuard < firstMutation,
    'an unattended world must return before any simulation mutation or repair work',
  );
  assert.ok(
    selectedSpeedGuard > activeGuard,
    'manual Pause must remain a separate selected-speed gate',
  );
  assert.doesNotMatch(
    disconnect,
    /world_config|game_speed/,
    'disconnect must not overwrite the player\'s selected speed',
  );

  assert.doesNotMatch(
    probeSource,
    /enterWorld|enter_world/,
    'the isolated world-config probe must never wake the simulation',
  );
}

type FakeSnapshot = {
  connected: boolean;
  identityHex: string | null;
  simTick: number;
  roads: object | null;
};

function createRuntimeHarness(entryPromises: Promise<void>[]) {
  let snapshot: FakeSnapshot = {
    connected: true,
    identityHex: 'owner',
    simTick: 0,
    roads: { initial: true },
  };
  const subscribers = new Set<(snapshot: FakeSnapshot) => void>();
  let enterCalls = 0;
  let readyCalls = 0;

  const generation = {
    ...DEFAULT_WORLD_GENERATION_SETTINGS,
    configured: true,
  };
  const store = {
    get snapshot() {
      return snapshot;
    },
    get isConnected() {
      return snapshot.connected;
    },
    connect: () => undefined,
    subscribe: (listener: (value: FakeSnapshot) => void) => {
      subscribers.add(listener);
      listener(snapshot);
      return () => subscribers.delete(listener);
    },
    toGameState: () => ({}),
    getAuthoritativeWorldGeneration: () => generation,
    configureWorld: async () => undefined,
    bootstrapWorld: async () => undefined,
    enterWorld: () => {
      const promise = entryPromises[enterCalls];
      enterCalls += 1;
      return promise ?? Promise.resolve();
    },
  };

  const runtime = new GameRuntime(
    store as never,
    {} as never,
    { settings: DEFAULT_WORLD_GENERATION_SETTINGS } as never,
    {
      onSnapshot: () => undefined,
      onRoadsHydrated: () => undefined,
      onConnectError: () => undefined,
      onSessionReady: () => {
        readyCalls += 1;
      },
    },
  );

  return {
    runtime,
    get enterCalls() {
      return enterCalls;
    },
    get readyCalls() {
      return readyCalls;
    },
    emit(patch: Partial<FakeSnapshot>) {
      snapshot = { ...snapshot, ...patch };
      for (const subscriber of subscribers) subscriber(snapshot);
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function flushAsyncWork(): Promise<void> {
  for (let pass = 0; pass < 4; pass += 1) {
    await Promise.resolve();
  }
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  await Promise.resolve();
}
