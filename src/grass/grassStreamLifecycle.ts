export type GrassStreamMode = 'active' | 'priming-frozen' | 'frozen';

export type GrassStreamViewTransition = {
  preserveFrozenState: boolean;
  invalidateForFirstPersonEntry: boolean;
  clearInactiveStream: boolean;
};

/**
 * Keeps the fixture's fully primed frozen buffers settled while still allowing
 * the rendered meshes to follow the real camera's close-ground visibility.
 */
export function resolveGrassStreamViewTransition(input: {
  mode: GrassStreamMode;
  firstPersonActive: boolean;
  wasFirstPersonActive: boolean;
  grassVisible: boolean;
  hasFrozenPrime: boolean;
}): GrassStreamViewTransition {
  const preserveFrozenState = input.mode === 'frozen';
  return {
    preserveFrozenState,
    invalidateForFirstPersonEntry:
      !preserveFrozenState
      && input.firstPersonActive
      && !input.wasFirstPersonActive,
    clearInactiveStream:
      !preserveFrozenState
      && !input.grassVisible
      && !input.hasFrozenPrime,
  };
}
