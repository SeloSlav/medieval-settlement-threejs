import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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
import {
  DEFAULT_WORLD_GENERATION_SETTINGS,
  normalizeWorldGenerationSettings,
} from '../src/world/worldGenerationSettings.ts';

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
  banditCampsEnabled: true,
  severeWeatherEnabled: true,
  wellAquiferNetworksEnabled: true,
  approvalDeclineRate: 50,
  foodSpoilageRate: 150,
  initialGoodsMultiplier: 2,
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
assert.equal(generation.banditCampsEnabled, true);
assert.equal(generation.severeWeatherEnabled, true);
assert.equal(generation.wellAquiferNetworksEnabled, true);
assert.equal(generation.approvalDeclineRate, 50);
assert.equal(generation.foodSpoilageRate, 150);
assert.equal(generation.initialGoodsMultiplier, 2);
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
assert.equal(payload.banditCampsEnabled, true);
assert.equal(payload.severeWeatherEnabled, false);
assert.equal(payload.wellAquiferNetworksEnabled, false);
assert.equal(payload.approvalDeclineRate, 100);
assert.equal(payload.foodSpoilageRate, 100);
assert.equal(payload.initialGoodsMultiplier, 1);

const frontierPayload = settingsToConfigurePayload({
  ...DEFAULT_WORLD_GENERATION_SETTINGS,
  conflictMode: 'frontier',
  enemyPressure: 65,
});
assert.equal(frontierPayload.conflictEnabled, true);
assert.equal(frontierPayload.enemyPressure, 65);
assert.equal(frontierPayload.severeWeatherEnabled, false);
assert.equal(frontierPayload.wellAquiferNetworksEnabled, false);

const severeWeatherPayload = settingsToConfigurePayload({
  ...DEFAULT_WORLD_GENERATION_SETTINGS,
  severeWeatherEnabled: true,
});
assert.equal(severeWeatherPayload.severeWeatherEnabled, true);
assert.equal(severeWeatherPayload.wellAquiferNetworksEnabled, false);

const aquiferPayload = settingsToConfigurePayload({
  ...DEFAULT_WORLD_GENERATION_SETTINGS,
  wellAquiferNetworksEnabled: true,
});
assert.equal(aquiferPayload.wellAquiferNetworksEnabled, true);
assert.equal(
  normalizeWorldGenerationSettings({}).wellAquiferNetworksEnabled,
  false,
  'legacy browser settings without the appended rule must keep even well groundwater',
);

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
      banditCampsEnabled: generation.banditCampsEnabled,
      severeWeatherEnabled: generation.severeWeatherEnabled,
      wellAquiferNetworksEnabled: generation.wellAquiferNetworksEnabled,
      approvalDeclineRate: generation.approvalDeclineRate,
      foodSpoilageRate: generation.foodSpoilageRate,
      initialGoodsMultiplier: generation.initialGoodsMultiplier,
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
  generationMatchesServer(matchingGeneration, {
    ...DEFAULT_WORLD_GENERATION_SETTINGS,
    wellAquiferNetworksEnabled: true,
  }),
  false,
  'a well-aquifer rule mismatch must not reuse stale local world semantics',
);
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
await testStartupAlwaysReconfirmsWorldConfiguration();
await testSevereWeatherSetupContract();
await testAquiferSetupContract();
await testDifficultySetupContract();

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

async function testStartupAlwaysReconfirmsWorldConfiguration(): Promise<void> {
  const storeSource = await readFile(
    new URL('../src/data/spacetimeGameStore.ts', import.meta.url),
    'utf8',
  );
  const configureMethod = storeSource.match(
    /async configureWorld\(settings: WorldGenerationSettings\): Promise<void> \{([\s\S]*?)\n  \}/,
  )?.[1] ?? '';
  assert.match(
    configureMethod,
    /await spacetimeReducers\.configureWorld\(settings\)/,
    'every startup must reconfirm the idempotent server world contract',
  );
  assert.doesNotMatch(
    configureMethod,
    /generationMatchesServer|server\?\.configured[\s\S]*?return/,
    'a stale matching pre-reset row must never suppress configure_world',
  );

  const bootstrapFlowSource = await readFile(
    new URL('../src/app/worldBootstrapFlow.ts', import.meta.url),
    'utf8',
  );
  assert.match(
    bootstrapFlowSource,
    /await resetWorld\(\);\s*await waitForWorldResetReplication\(\);/,
    'new-world reload must wait until configured=false and sim_tick=0 are replicated',
  );
}

async function testSevereWeatherSetupContract(): Promise<void> {
  const setupSource = await readFile(
    new URL('../src/ui/WorldSetupPanel.ts', import.meta.url),
    'utf8',
  );
  const settingsSource = await readFile(
    new URL('../src/world/worldGenerationSettings.ts', import.meta.url),
    'utf8',
  );
  const serverConfigSource = await readFile(
    new URL('../server/src/reducers/world_configuration.rs', import.meta.url),
    'utf8',
  );
  assert.match(setupSource, /data-world-selector="severe-weather"/);
  assert.match(setupSource, /Normal rain and frost only/);
  assert.match(setupSource, /Droughts, lightning, and fire/);
  assert.match(settingsSource, /severeWeatherEnabled:\s*false/);
  assert.match(serverConfigSource, /severe_weather_enabled:\s*false/);
}

async function testDifficultySetupContract(): Promise<void> {
  const setupSource = await readFile(
    new URL('../src/ui/WorldSetupPanel.ts', import.meta.url),
    'utf8',
  );
  const difficultySource = await readFile(
    new URL('../src/world/worldDifficulty.ts', import.meta.url),
    'utf8',
  );
  const settingsSource = await readFile(
    new URL('../src/world/worldGenerationSettings.ts', import.meta.url),
    'utf8',
  );
  const serverConfigSource = await readFile(
    new URL('../server/src/reducers/world_configuration.rs', import.meta.url),
    'utf8',
  );
  assert.match(setupSource, /data-world-selector="difficulty-preset"/);
  assert.match(difficultySource, /id: 'easy'[\s\S]*approvalDeclineRate: 0[\s\S]*foodSpoilageRate: 0[\s\S]*initialGoodsMultiplier: 2/);
  assert.match(difficultySource, /id: 'normal'[\s\S]*approvalDeclineRate: 100[\s\S]*foodSpoilageRate: 100[\s\S]*initialGoodsMultiplier: 1/);
  assert.match(difficultySource, /id: 'hardcore'[\s\S]*enemyPressure: 100[\s\S]*severeWeatherEnabled: true[\s\S]*approvalDeclineRate: 150[\s\S]*foodSpoilageRate: 150/);
  assert.match(setupSource, /difficultyPresetValue\.textContent = preset\?\.name \?\? 'Custom'/);
  assert.match(setupSource, /data-world-selector="approval-decline"/);
  assert.match(setupSource, /0: \['Disabled', 'No passive approval loss\.'\][\s\S]*150: \['Demanding'/);
  assert.match(setupSource, /data-world-selector="food-spoilage"[\s\S]*Food never spoils/);
  assert.match(setupSource, /data-world-selector="initial-goods"[\s\S]*Twice the goods in the original camp/);
  assert.match(settingsSource, /approvalDeclineRate:\s*100/);
  assert.match(settingsSource, /foodSpoilageRate:\s*100/);
  assert.match(settingsSource, /initialGoodsMultiplier:\s*1/);
  assert.match(serverConfigSource, /validate_difficulty_rate\(approval_decline_rate/);
  assert.match(serverConfigSource, /validate_difficulty_rate\(food_spoilage_rate/);
  assert.match(serverConfigSource, /validate_initial_goods_multiplier\(initial_goods_multiplier\)/);
}

async function testAquiferSetupContract(): Promise<void> {
  const setupSource = await readFile(
    new URL('../src/ui/WorldSetupPanel.ts', import.meta.url),
    'utf8',
  );
  const settingsSource = await readFile(
    new URL('../src/world/worldGenerationSettings.ts', import.meta.url),
    'utf8',
  );
  const serverConfigSource = await readFile(
    new URL('../server/src/reducers/world_configuration.rs', import.meta.url),
    'utf8',
  );
  assert.match(setupSource, /data-world-selector="groundwater"/);
  assert.match(setupSource, /Every well has reliable yield/);
  assert.match(setupSource, /Well yield varies by location/);
  assert.match(settingsSource, /wellAquiferNetworksEnabled:\s*false/);
  assert.match(serverConfigSource, /well_aquifer_networks_enabled:\s*false/);
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
