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

console.log('connection recovery hint tests passed');
