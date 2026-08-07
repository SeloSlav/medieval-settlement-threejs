import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  formatBootstrapFailure,
  formatConnectionUnavailable,
  formatWorldGenerationMismatch,
} from '../src/app/connectionRecoveryHints.ts';
import { SessionLifecycleController } from '../src/app/SessionLifecycleController.ts';
import { SessionConnectionGate } from '../src/network/SessionConnectionGate.ts';
import { isUnauthorizedConnectError } from '../src/network/connectionErrorPolicy.ts';
import {
  installSpacetimeProtocolRecovery,
  isSpacetimeProtocolDecodeError,
  SPACETIME_PROTOCOL_RELOAD_COOLDOWN_MS,
  type SpacetimeProtocolRecoveryEnvironment,
  type UnhandledRejectionLike,
} from '../src/network/spacetimeProtocolRecovery.ts';

for (const staleCredentialError of [
  new Error('401 Unauthorized'),
  new Error('Failed to verify token: signature mismatch'),
  new Error('Invalid token'),
  new Error('Token expired'),
]) {
  assert.equal(
    isUnauthorizedConnectError(staleCredentialError),
    true,
    `${staleCredentialError.message} must trigger one anonymous reconnect`,
  );
}
assert.equal(
  isUnauthorizedConnectError(new Error('Connection refused')),
  false,
  'ordinary server outages must retain their actionable connection error',
);

const protocolDecodeError = new RangeError('Offset is outside the bounds of the DataView');
protocolDecodeError.stack = [
  protocolDecodeError.toString(),
  'at BinaryReader.readBool (spacetimedb.js:432:27)',
  'at #parseRowList (spacetimedb.js:4511:16)',
].join('\n');
assert.equal(isSpacetimeProtocolDecodeError(protocolDecodeError), true);
assert.equal(
  isSpacetimeProtocolDecodeError(new RangeError('Ordinary range failure')),
  false,
);
assert.equal(
  isSpacetimeProtocolDecodeError(new Error('Offset is outside the bounds of the DataView')),
  false,
);

function createProtocolRecoveryHarness(now = 10_000) {
  const listeners = new Set<(event: UnhandledRejectionLike) => void>();
  const storageValues = new Map<string, string>();
  const scheduled = new Map<number, () => void>();
  let nextTimerId = 1;
  let reloadCount = 0;
  const environment: SpacetimeProtocolRecoveryEnvironment = {
    addUnhandledRejectionListener: (listener) => listeners.add(listener),
    removeUnhandledRejectionListener: (listener) => listeners.delete(listener),
    storage: {
      getItem: (key) => storageValues.get(key) ?? null,
      setItem: (key, value) => storageValues.set(key, value),
      removeItem: (key) => {
        storageValues.delete(key);
      },
    },
    now: () => now,
    schedule: (callback) => {
      const timerId = nextTimerId;
      nextTimerId += 1;
      scheduled.set(timerId, callback);
      return timerId;
    },
    cancel: (timerId) => {
      scheduled.delete(timerId);
    },
    reload: () => {
      reloadCount += 1;
    },
    warn: () => undefined,
    error: () => undefined,
  };
  return {
    environment,
    emit(reason: unknown) {
      let prevented = false;
      for (const listener of listeners) {
        listener({
          reason,
          preventDefault: () => {
            prevented = true;
          },
        });
      }
      return prevented;
    },
    runScheduled() {
      for (const callback of [...scheduled.values()]) callback();
      scheduled.clear();
    },
    setNow(value: number) {
      now = value;
    },
    get reloadCount() {
      return reloadCount;
    },
  };
}

const firstProtocolRecovery = createProtocolRecoveryHarness();
const disposeProtocolRecovery = installSpacetimeProtocolRecovery(
  firstProtocolRecovery.environment,
);
assert.equal(firstProtocolRecovery.emit(new Error('unrelated')), false);
assert.equal(firstProtocolRecovery.emit(protocolDecodeError), true);
firstProtocolRecovery.runScheduled();
assert.equal(firstProtocolRecovery.reloadCount, 1, 'decoder mismatch should reload once');
assert.equal(firstProtocolRecovery.emit(protocolDecodeError), true);
firstProtocolRecovery.runScheduled();
assert.equal(firstProtocolRecovery.reloadCount, 1, 'repeated SDK rejections must not reload-loop');
disposeProtocolRecovery();

const sharedRecovery = createProtocolRecoveryHarness();
installSpacetimeProtocolRecovery(sharedRecovery.environment);
sharedRecovery.emit(protocolDecodeError);
sharedRecovery.runScheduled();
assert.equal(sharedRecovery.reloadCount, 1);
installSpacetimeProtocolRecovery(sharedRecovery.environment);
sharedRecovery.emit(protocolDecodeError);
sharedRecovery.runScheduled();
assert.equal(sharedRecovery.reloadCount, 1, 'recent reload marker must survive page reconstruction');
sharedRecovery.setNow(10_000 + SPACETIME_PROTOCOL_RELOAD_COOLDOWN_MS + 1);
installSpacetimeProtocolRecovery(sharedRecovery.environment);
sharedRecovery.emit(protocolDecodeError);
sharedRecovery.runScheduled();
assert.equal(sharedRecovery.reloadCount, 2, 'expired reload marker may recover a later deployment');

const generationLock = formatBootstrapFailure(
  new Error('Cannot change world generation after the simulation has started.'),
);
assert.equal(generationLock.showNewWorldAction, false);
assert.match(generationLock.recoveryHint, /reload/i);
assert.match(generationLock.recoveryHint, /without resetting/i);

const setupLock = formatBootstrapFailure(
  new Error('Cannot change world setup after the simulation has started.'),
);
assert.equal(setupLock.showNewWorldAction, false);
assert.match(setupLock.recoveryHint, /reload/i);

const timeout = formatBootstrapFailure(new Error('Timed out waiting for world_config subscription.'));
assert.equal(timeout.showNewWorldAction, false);
assert.match(timeout.recoveryHint, /world configuration/i);

const generic = formatBootstrapFailure(new Error('Reducer failed'));
assert.equal(generic.showNewWorldAction, true);
assert.match(generic.recoveryHint, /retry/i);

const mismatch = formatWorldGenerationMismatch('Settings differ.');
assert.equal(mismatch.showNewWorldAction, false);
assert.match(mismatch.recoveryHint, /reload/i);
assert.match(mismatch.recoveryHint, /saved map settings/i);

const offline = formatConnectionUnavailable();
assert.equal(offline.showNewWorldAction, false);
assert.match(offline.recoveryHint, /retry/i);

function createLifecycleHarness() {
  const gate = new SessionConnectionGate();
  let dismissCount = 0;
  const controller = new SessionLifecycleController({
    sessionGate: gate,
    loadingScreen: {
      setProgress: () => undefined,
      setErrorState: () => undefined,
      clearErrorState: () => undefined,
      dismiss: () => {
        dismissCount += 1;
      },
    },
    connectionOverlay: {
      show: () => undefined,
      hide: () => undefined,
    },
    spacetimeStore: {
      subscribe: () => () => undefined,
      get isConnected() {
        return false;
      },
      snapshot: {
        connected: false,
        identityHex: null,
      },
      connect: () => undefined,
    },
    toolbar: null,
    roadTool: null,
    buildingTool: null,
    burgageTool: null,
    farmFieldTool: null,
    firstPersonController: null,
  } as never);
  return {
    controller,
    get dismissCount() {
      return dismissCount;
    },
  };
}

const terrainFirst = createLifecycleHarness();
terrainFirst.controller.onPresentationReady();
assert.equal(
  terrainFirst.dismissCount,
  0,
  'terrain readiness must not reveal a disconnected, non-interactive world',
);
terrainFirst.controller.onReady();
assert.equal(terrainFirst.dismissCount, 1);
terrainFirst.controller.dispose();

const sessionFirst = createLifecycleHarness();
sessionFirst.controller.onReady();
assert.equal(
  sessionFirst.dismissCount,
  0,
  'session readiness must still wait for the first terrain frame',
);
sessionFirst.controller.onPresentationReady();
assert.equal(sessionFirst.dismissCount, 1);
sessionFirst.controller.dispose();

const overlaySource = readFileSync(
  new URL('../src/ui/SessionConnectionOverlay.ts', import.meta.url),
  'utf8',
);
assert.match(overlaySource, /data-session-retry/);
assert.match(overlaySource, /this\.retryHandler\?\.\(\)/);

const recoverySource = readFileSync(
  new URL('../src/app/connectionRecoveryHints.ts', import.meta.url),
  'utf8',
);
assert.doesNotMatch(
  recoverySource,
  /deploy:local-clean/,
  'connection recovery must not suggest deleting the development database',
);

const loadingScreenSource = readFileSync(
  new URL('../src/ui/LoadingScreen.ts', import.meta.url),
  'utf8',
);
assert.match(
  loadingScreenSource,
  /this\.dismissed \|\| this\.retryHandler !== null/,
  'late asset progress must preserve an actionable bootstrap error',
);

const gameStoreSource = readFileSync(
  new URL('../src/data/spacetimeGameStore.ts', import.meta.url),
  'utf8',
);
assert.match(
  gameStoreSource,
  /subscribe\(GAME_TABLE_SUBSCRIPTIONS\.map/,
  'initial tables should share one subscription lifecycle',
);
assert.match(
  gameStoreSource,
  /onApplied\(\(\) =>/,
  'the initial cache must be synchronized only after subscription application',
);

console.log('connection recovery hint tests passed');
