import { clearStoredSpacetimeToken } from '../network/identityPersistence.ts';
import { getConnection } from '../network/spacetimedbClient.ts';
import { probeServerWorldConfig } from '../network/serverWorldProbe.ts';
import { resetWorld } from '../data/spacetimeReducers.ts';
import { NobleSetupPanel, type NobleSetupStep } from '../ui/NobleSetupPanel.ts';
import { WorldSetupPanel } from '../ui/WorldSetupPanel.ts';
import type { NobleProfile } from '../ui/nobleProfile.ts';
import { resolveWorldGenerationAuthority } from '../world/worldConfigAuthority.ts';
import {
  clearStoredWorldGenerationSettings,
  loadStoredWorldGenerationSettings,
  type WorldGenerationSettings,
} from '../world/worldGenerationSettings.ts';

export type WorldBootstrapProgress = {
  label: string;
  detail: string;
};

export async function resolveWorldGenerationSettings(
  root: HTMLElement,
  onProgress?: (progress: WorldBootstrapProgress) => void,
): Promise<WorldGenerationSettings> {
  const explicitNewWorld = new URLSearchParams(window.location.search).has('new');
  if (explicitNewWorld) {
    return promptNewWorldSetup(root);
  }

  const local = loadStoredWorldGenerationSettings();
  onProgress?.({
    label: 'Checking world…',
    detail: 'Verifying server state',
  });

  const probe = await probeServerWorldConfig();
  const resolution = resolveWorldGenerationAuthority(
    probe?.generation ?? null,
    local,
  );
  if (resolution.kind === 'adopt-server') {
    onProgress?.({
      label: 'Loading settlement',
      detail: `Using the server's ${resolution.settings.mapSize} ${resolution.settings.conflictMode} world`,
    });
    return resolution.settings;
  }
  if (resolution.kind === 'use-local') {
    return resolution.settings;
  }

  if (probe) {
    clearStoredWorldGenerationSettings();
    onProgress?.({
      label: 'New settlement',
      detail: 'Choose map size, landscape, and seed',
    });
  }
  return promptNewWorldSetup(root);
}

async function promptNewWorldSetup(root: HTMLElement): Promise<WorldGenerationSettings> {
  let nobleStep: NobleSetupStep = 'house';
  let nobleDraft: NobleProfile | undefined;
  let worldDraft: WorldGenerationSettings | undefined;

  while (true) {
    nobleDraft = await NobleSetupPanel.prompt(root, {
      initialStep: nobleStep,
      initialProfile: nobleDraft,
    });
    const result = await WorldSetupPanel.prompt(root, {
      initialSettings: worldDraft,
    });
    worldDraft = result.settings;
    if (result.action === 'start') return result.settings;
    nobleStep = 'heraldry';
  }
}

export async function beginNewWorld(isReady: () => boolean): Promise<void> {
  if (!isReady()) {
    window.alert('SpacetimeDB is not connected. Start the local server and try again.');
    return;
  }

  const confirmed = window.confirm(
    'Start a new world? This clears your saved world settings and local player identity, then reloads the page.',
  );
  if (!confirmed) return;

  try {
    await resetWorld();
    await waitForWorldResetReplication();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not reset the server database.';
    window.alert(`New world failed: ${message}\n\nThe page was not reloaded.`);
    return;
  }

  clearStoredWorldGenerationSettings();
  clearStoredSpacetimeToken('city-builder');
  const url = new URL(window.location.href);
  url.searchParams.set('new', '1');
  window.location.assign(url.toString());
}

const WORLD_RESET_POLL_MS = 50;
const WORLD_RESET_MAX_ATTEMPTS = 80;

/**
 * Do not replace the identity and reload against a stale pre-reset world row.
 * Reducer completion and table replication are separate client events when
 * unconfirmed reads are enabled, so startup must observe the reset boundary
 * before it is allowed to choose and publish the next world contract.
 */
async function waitForWorldResetReplication(): Promise<void> {
  for (let attempt = 0; attempt < WORLD_RESET_MAX_ATTEMPTS; attempt += 1) {
    const connection = getConnection();
    const rows = connection?.db.world_config
      ? [...connection.db.world_config.iter()]
      : [];
    const row = rows[0];
    if (row && !row.configured && Number(row.simTick) === 0) {
      return;
    }
    await new Promise<void>((resolve) => window.setTimeout(resolve, WORLD_RESET_POLL_MS));
  }
  throw new Error('Timed out waiting for the server to confirm the world reset.');
}
