export type GrassStreamMode = 'active' | 'priming-frozen' | 'frozen';

export type GrassStreamViewTransition = {
  preserveFrozenState: boolean;
  invalidateForFirstPersonEntry: boolean;
  clearInactiveStream: boolean;
};

/**
 * Assign a world chunk to a stable slot in the camera-relative ring buffer.
 *
 * Slot identity must not depend on the chunk's temporary local position in the
 * moving stream grid. A local-grid index remaps every retained chunk whenever
 * the camera crosses a chunk boundary, which makes nearby grass disappear and
 * regenerate even though its world chunk never left the stream.
 */
export function resolveGrassStreamSlotIndex(
  worldChunkX: number,
  worldChunkZ: number,
  gridSide: number,
): number {
  const wrappedX = ((worldChunkX % gridSide) + gridSide) % gridSide;
  const wrappedZ = ((worldChunkZ % gridSide) + gridSide) % gridSide;
  return wrappedZ * gridSide + wrappedX;
}

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
