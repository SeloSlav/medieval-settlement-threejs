const RELOAD_MARKER_KEY = 'city-builder:spacetime-protocol-reload';

export const SPACETIME_PROTOCOL_RELOAD_COOLDOWN_MS = 30_000;
export const SPACETIME_PROTOCOL_RELOAD_DELAY_MS = 750;

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export type UnhandledRejectionLike = {
  reason: unknown;
  preventDefault: () => void;
};

export type SpacetimeProtocolRecoveryEnvironment = {
  addUnhandledRejectionListener: (listener: (event: UnhandledRejectionLike) => void) => void;
  removeUnhandledRejectionListener: (listener: (event: UnhandledRejectionLike) => void) => void;
  storage: StorageLike | null;
  now: () => number;
  schedule: (callback: () => void, delayMs: number) => number;
  cancel: (timerId: number) => void;
  reload: () => void;
  warn: (message: string, error: unknown) => void;
  error: (message: string, error: unknown) => void;
};

function errorDetails(reason: unknown): { name: string; message: string; stack: string } {
  if (reason instanceof Error) {
    return {
      name: reason.name,
      message: reason.message,
      stack: reason.stack ?? '',
    };
  }
  if (typeof reason !== 'object' || reason === null) {
    return { name: '', message: String(reason), stack: '' };
  }
  const candidate = reason as { name?: unknown; message?: unknown; stack?: unknown };
  return {
    name: typeof candidate.name === 'string' ? candidate.name : '',
    message: typeof candidate.message === 'string' ? candidate.message : '',
    stack: typeof candidate.stack === 'string' ? candidate.stack : '',
  };
}

/**
 * A clean SpacetimeDB publish can replace the module while an older generated
 * client is still alive in the page. The 2.x SDK currently surfaces that
 * schema mismatch as an unhandled BinaryReader/DataView rejection rather than
 * a subscription error, so reconnecting the same page cannot repair it.
 */
export function isSpacetimeProtocolDecodeError(reason: unknown): boolean {
  const { name, message, stack } = errorDetails(reason);
  if (name !== 'RangeError' || !message.includes('outside the bounds of the DataView')) {
    return false;
  }
  return stack.includes('BinaryReader')
    && (
      stack.includes('parseRowList')
      || stack.includes('queryRowsToTableUpdates')
      || stack.includes('spacetimedb')
    );
}

function readLastReload(storage: StorageLike | null): number | null {
  if (!storage) return null;
  try {
    const value = Number(storage.getItem(RELOAD_MARKER_KEY));
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

function writeLastReload(storage: StorageLike | null, timestamp: number): void {
  if (!storage) return;
  try {
    storage.setItem(RELOAD_MARKER_KEY, String(timestamp));
  } catch {
    // Storage can be unavailable in privacy-restricted browser contexts.
  }
}

function browserStorage(): StorageLike | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function browserEnvironment(): SpacetimeProtocolRecoveryEnvironment {
  return {
    addUnhandledRejectionListener: (listener) => {
      window.addEventListener('unhandledrejection', listener as (event: PromiseRejectionEvent) => void);
    },
    removeUnhandledRejectionListener: (listener) => {
      window.removeEventListener('unhandledrejection', listener as (event: PromiseRejectionEvent) => void);
    },
    storage: browserStorage(),
    now: () => Date.now(),
    schedule: (callback, delayMs) => window.setTimeout(callback, delayMs),
    cancel: (timerId) => window.clearTimeout(timerId),
    reload: () => window.location.reload(),
    warn: (message, error) => console.warn(message, error),
    error: (message, error) => console.error(message, error),
  };
}

/** Installs a one-shot reload for an in-memory client/server schema mismatch. */
export function installSpacetimeProtocolRecovery(
  environment: SpacetimeProtocolRecoveryEnvironment = browserEnvironment(),
): () => void {
  let handled = false;
  let reloadTimer: number | null = null;

  const onUnhandledRejection = (event: UnhandledRejectionLike): void => {
    if (!isSpacetimeProtocolDecodeError(event.reason)) return;
    event.preventDefault();
    if (handled) return;
    handled = true;

    const now = environment.now();
    const lastReload = readLastReload(environment.storage);
    if (lastReload !== null && now - lastReload < SPACETIME_PROTOCOL_RELOAD_COOLDOWN_MS) {
      environment.error(
        '[SpacetimeDB] Subscription decoding still failed after automatic recovery.',
        event.reason,
      );
      return;
    }

    writeLastReload(environment.storage, now);
    environment.warn(
      '[SpacetimeDB] Server schema changed while this page was open; reloading the updated client.',
      event.reason,
    );
    reloadTimer = environment.schedule(() => {
      reloadTimer = null;
      environment.reload();
    }, SPACETIME_PROTOCOL_RELOAD_DELAY_MS);
  };

  environment.addUnhandledRejectionListener(onUnhandledRejection);
  return () => {
    environment.removeUnhandledRejectionListener(onUnhandledRejection);
    if (reloadTimer !== null) {
      environment.cancel(reloadTimer);
      reloadTimer = null;
    }
  };
}

/** A fully hydrated subscription proves the current generated bindings work. */
export function markSpacetimeProtocolHealthy(storage: StorageLike | null = browserStorage()): void {
  if (!storage) return;
  try {
    storage.removeItem(RELOAD_MARKER_KEY);
  } catch {
    // Best-effort marker cleanup only.
  }
}
