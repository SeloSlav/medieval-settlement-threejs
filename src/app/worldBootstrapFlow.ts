import { clearStoredSpacetimeToken } from '../network/identityPersistence.ts';
import { probeServerWorldConfig } from '../network/serverWorldProbe.ts';
import { resetWorld } from '../data/spacetimeReducers.ts';
import { WorldSetupPanel } from '../ui/WorldSetupPanel.ts';
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
    return WorldSetupPanel.prompt(root);
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
  return WorldSetupPanel.prompt(root);
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
