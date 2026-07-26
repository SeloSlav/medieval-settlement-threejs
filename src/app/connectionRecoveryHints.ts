export type RecoveryErrorPresentation = {
  label: string;
  detail: string;
  recoveryHint: string;
  showNewWorldAction: boolean;
};

function isDevEnvironment(): boolean {
  if (typeof window !== 'undefined' && window.location.hostname === 'localhost') {
    return true;
  }
  return import.meta.env?.DEV === true;
}

function devServerHint(): string {
  if (!isDevEnvironment()) return '';
  return ' Developers: redeploy with `npm run deploy:local`, or wipe the database with `npm run deploy:local-clean`.';
}

function stuckHint(includeNewWorld: boolean): string {
  const steps = [
    'If retry does not help, clear this site\'s stored data in your browser (local storage) and reload the page.',
  ];
  if (includeNewWorld) {
    steps.push('You can also start a new world to reset your settlement on the server.');
  }
  return steps.join(' ');
}

export function formatBootstrapFailure(error: unknown): RecoveryErrorPresentation {
  const message = error instanceof Error ? error.message : 'World bootstrap failed.';
  const lower = message.toLowerCase();

  if (
    message.includes('Cannot change world generation')
    || message.includes('Cannot change world setup')
  ) {
    return {
      label: 'World bootstrap failed',
      detail: message,
      recoveryHint: `The server world changed after terrain setup. Reload to adopt its saved map settings without resetting the settlement.${devServerHint()}`,
      showNewWorldAction: false,
    };
  }

  if (lower.includes('timed out waiting for world_config')) {
    return {
      label: 'World bootstrap failed',
      detail: message,
      recoveryHint: `The server never published world configuration. Ensure SpacetimeDB is running and the game module is deployed.${devServerHint()} Then retry.`,
      showNewWorldAction: false,
    };
  }

  return {
    label: 'World bootstrap failed',
    detail: message,
    recoveryHint: `${stuckHint(true)}${devServerHint()}`,
    showNewWorldAction: true,
  };
}

export function formatWorldGenerationMismatch(message: string): RecoveryErrorPresentation {
  return {
    label: 'World settings mismatch',
    detail: message,
    recoveryHint: `The server world changed after terrain setup. Use Retry to reload and adopt its saved map settings without resetting the settlement.${devServerHint()}`,
    showNewWorldAction: false,
  };
}

export function formatConnectionUnavailable(): RecoveryErrorPresentation {
  return {
    label: 'SpacetimeDB unavailable',
    detail: 'Could not connect to the game server.',
    recoveryHint: isDevEnvironment()
      ? 'Run `spacetime start` and `npm run deploy:local`, then retry.'
      : 'Check your network connection and retry. If the problem continues, try again later or clear this site\'s stored data and reload.',
    showNewWorldAction: false,
  };
}
