import assert from 'node:assert/strict';
import type { WorldConfig } from '../src/generated/types.ts';
import { GameRuntime } from '../src/runtime/GameRuntime.ts';
import {
  assertWorldGenerationCompatible,
  decodeMapSize,
  encodeMapSize,
  generationMatchesServer,
  MAP_SIZE_BY_CODE,
  MAP_SIZE_CODES,
  resolveWorldGenerationAuthority,
  settingsToConfigurePayload,
  WorldGenerationMismatchError,
  worldConfigRowToGeneration,
} from '../src/world/worldConfigAuthority.ts';
import { DEFAULT_WORLD_GENERATION_SETTINGS } from '../src/world/worldGenerationSettings.ts';

assert.equal(encodeMapSize('medium'), MAP_SIZE_CODES.medium);
assert.equal(decodeMapSize(2), MAP_SIZE_BY_CODE[2]);
assert.equal(MAP_SIZE_CODES.small, 0);
assert.equal(MAP_SIZE_CODES.large, 2);

const row = {
  id: 0,
  seed: BigInt(0xdeadbeef),
  nextBuildingId: BigInt(1),
  simTick: BigInt(0),
  gameSpeed: 1,
  mapSize: 1,
  topography: 42,
  hydrology: 55,
  forestDensity: 66,
  resourceAbundance: 35,
  resourceVariety: 80,
  conflictEnabled: true,
  enemyPressure: 70,
  configured: true,
} satisfies WorldConfig;

const generation = worldConfigRowToGeneration(row);
assert.equal(generation.seed, 0xdeadbeef);
assert.equal(generation.mapSize, 'medium');
assert.equal(generation.topography, 42);
assert.equal(generation.resourceAbundance, 35);
assert.equal(generation.resourceVariety, 80);
assert.equal(generation.conflictMode, 'frontier');
assert.equal(generation.enemyPressure, 70);
assert.equal(generation.configured, true);

assert.equal(
  generationMatchesServer(generation, DEFAULT_WORLD_GENERATION_SETTINGS),
  false,
);

const payload = settingsToConfigurePayload(DEFAULT_WORLD_GENERATION_SETTINGS);
assert.equal(payload.mapSize, MAP_SIZE_CODES.medium);
assert.equal(payload.seed, BigInt(DEFAULT_WORLD_GENERATION_SETTINGS.seed));
assert.equal(payload.resourceAbundance, 50);
assert.equal(payload.resourceVariety, 50);
assert.equal(payload.conflictEnabled, false);
assert.equal(payload.enemyPressure, 0);

const frontierPayload = settingsToConfigurePayload({
  ...DEFAULT_WORLD_GENERATION_SETTINGS,
  conflictMode: 'frontier',
  enemyPressure: 65,
});
assert.equal(frontierPayload.conflictEnabled, true);
assert.equal(frontierPayload.enemyPressure, 65);

assert.throws(
  () => assertWorldGenerationCompatible(
    DEFAULT_WORLD_GENERATION_SETTINGS,
    generation,
    42,
  ),
  WorldGenerationMismatchError,
);

assert.doesNotThrow(
  () => assertWorldGenerationCompatible(
    DEFAULT_WORLD_GENERATION_SETTINGS,
    { ...generation, configured: false },
    42,
  ),
);

assert.doesNotThrow(
  () => assertWorldGenerationCompatible(
    DEFAULT_WORLD_GENERATION_SETTINGS,
    generation,
    0,
  ),
);

const unconfigured = { ...generation, configured: false };
assert.deepEqual(
  resolveWorldGenerationAuthority(unconfigured, DEFAULT_WORLD_GENERATION_SETTINGS),
  { kind: 'prompt' },
);

const smallWorld = { ...DEFAULT_WORLD_GENERATION_SETTINGS, mapSize: 'small' as const };
assert.deepEqual(
  resolveWorldGenerationAuthority(generation, smallWorld),
  {
    kind: 'adopt-server',
    settings: {
      seed: generation.seed,
      terrainPreset: generation.terrainPreset,
      mapSize: generation.mapSize,
      topography: generation.topography,
      hydrology: generation.hydrology,
      forestDensity: generation.forestDensity,
      resourceAbundance: generation.resourceAbundance,
      resourceVariety: generation.resourceVariety,
      conflictMode: generation.conflictMode,
      enemyPressure: generation.enemyPressure,
    },
  },
);

assert.equal(
  resolveWorldGenerationAuthority(generation, null).kind,
  'adopt-server',
  'a new browser must join the configured server world instead of prompting for incompatible terrain',
);

const matchingGeneration = {
  ...DEFAULT_WORLD_GENERATION_SETTINGS,
  configured: true,
};
const matchingResolution = resolveWorldGenerationAuthority(
  matchingGeneration,
  DEFAULT_WORLD_GENERATION_SETTINGS,
);
assert.equal(matchingResolution.kind, 'use-local');
assert.equal(
  matchingResolution.kind === 'use-local'
    ? matchingResolution.settings
    : null,
  DEFAULT_WORLD_GENERATION_SETTINGS,
  'matching cached settings can be reused without replacing their stable object',
);

assert.deepEqual(
  resolveWorldGenerationAuthority(null, smallWorld),
  { kind: 'use-local', settings: smallWorld },
  'cached settings remain the fallback when the server probe is unavailable',
);

assert.deepEqual(
  resolveWorldGenerationAuthority(null, null),
  { kind: 'prompt' },
);

await testTerminalMismatchDoesNotRetryOnEverySnapshot();
await testReducerLockBecomesTerminalMismatch();

console.log('world config authority tests passed');

async function testTerminalMismatchDoesNotRetryOnEverySnapshot(): Promise<void> {
  let subscriber: ((snapshot: FakeSnapshot) => void) | null = null;
  let bootstrapFailures = 0;
  let configureCalls = 0;
  const serverGeneration = {
    ...DEFAULT_WORLD_GENERATION_SETTINGS,
    mapSize: 'large' as const,
    configured: true,
  };
  const snapshot: FakeSnapshot = {
    connected: true,
    identityHex: 'owner',
    simTick: 42,
    roads: null,
  };
  const store = {
    snapshot,
    isConnected: true,
    connect: () => {},
    subscribe: (callback: (value: FakeSnapshot) => void) => {
      subscriber = callback;
      callback(snapshot);
      return () => {};
    },
    toGameState: () => ({}),
    getAuthoritativeWorldGeneration: () => serverGeneration,
    configureWorld: async () => {
      configureCalls += 1;
    },
    bootstrapWorld: async () => {},
  };
  const previousWarn = console.warn;
  console.warn = () => {};
  try {
    const runtime = new GameRuntime(
      store as never,
      {} as never,
      { settings: DEFAULT_WORLD_GENERATION_SETTINGS } as never,
      {
        onSnapshot: () => {},
        onRoadsHydrated: () => {},
        onConnectError: () => {},
        onBootstrapFailed: () => {
          bootstrapFailures += 1;
        },
      },
    );
    runtime.start();
    await flushAsyncWork();
    assert.equal(bootstrapFailures, 1);
    assert.equal(configureCalls, 0, 'a late mismatch must be caught before reducer mutation');

    for (let index = 0; index < 100; index++) {
      subscriber?.(snapshot);
      runtime.recoverSession();
    }
    await flushAsyncWork();
    assert.equal(
      bootstrapFailures,
      1,
      'replicated ticks and reconnect polling must not repeat a terminal mismatch',
    );
    runtime.dispose();
  } finally {
    console.warn = previousWarn;
  }
}

async function testReducerLockBecomesTerminalMismatch(): Promise<void> {
  let subscriber: ((snapshot: FakeSnapshot) => void) | null = null;
  let bootstrapFailures = 0;
  let lastFailure: unknown;
  let serverGeneration = {
    ...DEFAULT_WORLD_GENERATION_SETTINGS,
    configured: true,
  };
  const snapshot: FakeSnapshot = {
    connected: true,
    identityHex: 'owner',
    simTick: 42,
    roads: null,
  };
  const store = {
    snapshot,
    isConnected: true,
    connect: () => {},
    subscribe: (callback: (value: FakeSnapshot) => void) => {
      subscriber = callback;
      callback(snapshot);
      return () => {};
    },
    toGameState: () => ({}),
    getAuthoritativeWorldGeneration: () => serverGeneration,
    configureWorld: async () => {
      serverGeneration = {
        ...serverGeneration,
        mapSize: 'large',
      };
      throw new Error('Cannot change world setup after the simulation has started.');
    },
    bootstrapWorld: async () => {},
  };
  const previousWarn = console.warn;
  console.warn = () => {};
  try {
    const runtime = new GameRuntime(
      store as never,
      {} as never,
      { settings: DEFAULT_WORLD_GENERATION_SETTINGS } as never,
      {
        onSnapshot: () => {},
        onRoadsHydrated: () => {},
        onConnectError: () => {},
        onBootstrapFailed: (error) => {
          bootstrapFailures += 1;
          lastFailure = error;
        },
      },
    );
    runtime.start();
    await flushAsyncWork();
    assert.equal(bootstrapFailures, 1);
    assert.ok(
      lastFailure instanceof WorldGenerationMismatchError,
      'a reducer-side authority race must use the reload recovery path',
    );

    for (let index = 0; index < 100; index++) {
      subscriber?.(snapshot);
      runtime.recoverSession();
    }
    await flushAsyncWork();
    assert.equal(
      bootstrapFailures,
      1,
      'a reducer-side world lock must not be retried on replicated ticks',
    );
    runtime.dispose();
  } finally {
    console.warn = previousWarn;
  }
}

type FakeSnapshot = {
  connected: boolean;
  identityHex: string;
  simTick: number;
  roads: null;
};

async function flushAsyncWork(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  await Promise.resolve();
}
