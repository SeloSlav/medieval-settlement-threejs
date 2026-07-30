import { ForagingMapIcons } from '../map/ForagingMapIcons.ts';
import { QuarryMapIcons } from '../map/QuarryMapIcons.ts';
import { TerrainMinimapOverlay } from '../map/TerrainMinimapOverlay.ts';
import type { MinimapFocus } from '../map/TerrainMinimapOverlay.ts';
import {
  buildLayoutWorldMapMarkers,
  filterWorldMapForagingMarkers,
  filterWorldMapMarkersByKind,
} from '../map/worldMapMarkers.ts';
import type { CameraController } from '../camera/CameraController.ts';
import type { FirstPersonController } from '../camera/FirstPersonController.ts';
import type { PlacementInteractionGate } from '../input/PlacementInteractionGate.ts';
import {
  isOverlayBlocked,
  isWorldInspectionBlocked,
  isWorldResourceIconVisibilityBlocked,
} from '../input/PlacementInteractionGate.ts';
import type { GameState } from '../resources/types.ts';
import type { WorldLayoutRegistry } from '../resources/WorldLayoutRegistry.ts';
import type { RiverField } from '../rivers/RiverField.ts';
import type { PerspectiveCamera } from 'three';
import type { Terrain } from '../terrain/Terrain.ts';
import type { ClayDepositSite } from '../clay/ClayDepositLayout.ts';

export type WorldMapUiBundle = {
  quarry: QuarryMapIcons;
  foraging: ForagingMapIcons;
  minimap: TerrainMinimapOverlay;
};

export function createWorldMapUi(options: {
  uiRoot: HTMLElement;
  domElement: HTMLElement;
  terrain: Terrain;
  riverField: RiverField;
  registry: WorldLayoutRegistry;
  clayDepositSites?: readonly ClayDepositSite[];
  getCamera: () => PerspectiveCamera | null;
  getZoomPercent: () => number;
  getGameState: () => GameState;
  getFocus: () => MinimapFocus;
  placementGate: PlacementInteractionGate;
  onQuarrySelect: (quarryId: string) => void;
  onForagingSelect: (nodeId: string) => void;
  onClaySelect?: (x: number, z: number) => void;
}): WorldMapUiBundle {
  const {
    uiRoot,
    domElement,
    terrain,
    riverField,
    registry,
    clayDepositSites,
    getCamera,
    getZoomPercent,
    getGameState,
    getFocus,
    placementGate,
    onQuarrySelect,
    onForagingSelect,
    onClaySelect,
  } = options;

  const layoutMarkers = buildLayoutWorldMapMarkers(registry, clayDepositSites);
  const quarryMarkers = filterWorldMapMarkersByKind(layoutMarkers, 'quarry');
  const foragingMarkers = filterWorldMapForagingMarkers(layoutMarkers);

  const quarry = new QuarryMapIcons({
    uiRoot,
    domElement,
    terrain,
    markers: quarryMarkers,
    getCamera,
    getZoomPercent,
    onQuarrySelect,
    isBlocked: () => isWorldInspectionBlocked(placementGate),
    isVisibilityBlocked: () => isWorldResourceIconVisibilityBlocked(placementGate),
  });

  const foraging = new ForagingMapIcons({
    uiRoot,
    domElement,
    terrain,
    markers: foragingMarkers,
    getCamera,
    getZoomPercent,
    getForagingNodes: () => getGameState().foragingNodes,
    onForagingSelect,
    onClaySelect,
    isBlocked: () => isWorldInspectionBlocked(placementGate),
    isVisibilityBlocked: () => isWorldResourceIconVisibilityBlocked(placementGate),
  });

  const minimap = TerrainMinimapOverlay.create({
    uiRoot,
    riverField,
    layoutMarkers,
    getGameState,
    getFocus,
    isBlocked: () => isOverlayBlocked(placementGate),
  });

  return { quarry, foraging, minimap };
}

export function resolveWorldMapFocus(
  cameraController: CameraController,
  firstPersonController: FirstPersonController,
): MinimapFocus {
  if (firstPersonController.isActive()) {
    const position = firstPersonController.getPosition();
    const yaw = firstPersonController.getBodyYaw();
    return {
      x: position.x,
      z: position.z,
      forwardX: -Math.sin(yaw),
      forwardZ: -Math.cos(yaw),
    };
  }

  const target = cameraController.getTargetPosition();
  const yaw = cameraController.getYaw();
  return {
    x: target.x,
    z: target.z,
    forwardX: -Math.cos(yaw),
    forwardZ: -Math.sin(yaw),
  };
}
