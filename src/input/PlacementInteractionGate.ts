export type PlacementInteractionGate = {
  isSessionReady: () => boolean;
  isSettlementFounded: () => boolean;
  isRoadToolEnabled: () => boolean;
  isBuildingToolEnabled: () => boolean;
  isStarterCampPlacementActive: () => boolean;
  isBurgageToolEnabled: () => boolean;
  isFarmFieldToolEnabled: () => boolean;
  isFirstPersonActive: () => boolean;
  isMenuOpen: () => boolean;
  isTutorialOpen?: () => boolean;
};

export function isSessionGameplayBlocked(gate: PlacementInteractionGate): boolean {
  return !gate.isSessionReady();
}

export function isBuildingPlacementBlocked(gate: PlacementInteractionGate): boolean {
  return isSessionGameplayBlocked(gate)
    || gate.isRoadToolEnabled()
    || gate.isBurgageToolEnabled()
    || gate.isFarmFieldToolEnabled()
    || gate.isFirstPersonActive()
    || gate.isMenuOpen()
    || (gate.isTutorialOpen?.() ?? false);
}

export function isBurgagePlacementBlocked(gate: PlacementInteractionGate): boolean {
  return isSessionGameplayBlocked(gate)
    || !gate.isSettlementFounded()
    || gate.isRoadToolEnabled()
    || gate.isBuildingToolEnabled()
    || gate.isFarmFieldToolEnabled()
    || gate.isFirstPersonActive()
    || gate.isMenuOpen()
    || (gate.isTutorialOpen?.() ?? false);
}

export function isRoadPlacementBlocked(gate: PlacementInteractionGate): boolean {
  return isSessionGameplayBlocked(gate)
    || !gate.isSettlementFounded()
    || gate.isBuildingToolEnabled()
    || gate.isBurgageToolEnabled()
    || gate.isFarmFieldToolEnabled()
    || gate.isFirstPersonActive()
    || gate.isMenuOpen()
    || (gate.isTutorialOpen?.() ?? false);
}

export function isFarmFieldPlacementBlocked(gate: PlacementInteractionGate): boolean {
  return isSessionGameplayBlocked(gate)
    || !gate.isSettlementFounded()
    || gate.isRoadToolEnabled()
    || gate.isBuildingToolEnabled()
    || gate.isBurgageToolEnabled()
    || gate.isFirstPersonActive()
    || gate.isMenuOpen()
    || (gate.isTutorialOpen?.() ?? false);
}

export function isWorldInspectionBlocked(gate: PlacementInteractionGate): boolean {
  return isSessionGameplayBlocked(gate)
    || gate.isRoadToolEnabled()
    || gate.isBuildingToolEnabled()
    || gate.isBurgageToolEnabled()
    || gate.isFarmFieldToolEnabled()
    || gate.isFirstPersonActive()
    || gate.isMenuOpen()
    || (gate.isTutorialOpen?.() ?? false);
}

export function isWorldResourceIconVisibilityBlocked(
  gate: PlacementInteractionGate,
): boolean {
  return isSessionGameplayBlocked(gate)
    || (gate.isBuildingToolEnabled() && !gate.isStarterCampPlacementActive())
    || gate.isBurgageToolEnabled()
    || gate.isFarmFieldToolEnabled()
    || gate.isFirstPersonActive()
    || gate.isMenuOpen()
    || (gate.isTutorialOpen?.() ?? false);
}

export function isOverlayBlocked(gate: PlacementInteractionGate): boolean {
  return isSessionGameplayBlocked(gate)
    || gate.isMenuOpen()
    || (gate.isTutorialOpen?.() ?? false);
}
