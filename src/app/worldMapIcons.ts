import { ForagingMapIcons } from '../map/ForagingMapIcons.ts';
import { QuarryMapIcons } from '../map/QuarryMapIcons.ts';
import { TerrainMinimapOverlay } from '../map/TerrainMinimapOverlay.ts';
import type {
  MinimapFocus,
  TerrainMinimapLayerImage,
} from '../map/TerrainMinimapOverlay.ts';
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
import type { ForestCore } from '../props/forestField.ts';
import type { RoadNetwork } from '../roads/RoadNetwork.ts';

export type WorldMapUiBundle = {
  quarry: QuarryMapIcons;
  foraging: ForagingMapIcons;
  minimap: TerrainMinimapOverlay;
  update(): void;
};

export function createWorldMapUi(options: {
  uiRoot: HTMLElement;
  domElement: HTMLElement;
  terrain: Terrain;
  riverField: RiverField;
  forestCores: readonly ForestCore[];
  worldSeed: number;
  registry: WorldLayoutRegistry;
  clayDepositSites?: readonly ClayDepositSite[];
  getCamera: () => PerspectiveCamera | null;
  getZoomPercent: () => number;
  isIllustratedMapActive: () => boolean;
  getGameState: () => GameState;
  getRoadNetwork: () => RoadNetwork;
  getFocus: () => MinimapFocus;
  placementGate: PlacementInteractionGate;
  onTerrainImageReady?: (image: TerrainMinimapLayerImage) => void;
  onTerrainImageUpdated?: () => void;
  onQuarrySelect: (quarryId: string) => void;
  onForagingSelect: (nodeId: string) => void;
  onClaySelect?: (x: number, z: number) => void;
}): WorldMapUiBundle {
  const {
    uiRoot,
    domElement,
    terrain,
    riverField,
    forestCores,
    worldSeed,
    registry,
    clayDepositSites,
    getCamera,
    getZoomPercent,
    isIllustratedMapActive,
    getGameState,
    getRoadNetwork,
    getFocus,
    placementGate,
    onTerrainImageReady,
    onTerrainImageUpdated,
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
    getGeologicalNodes: () => getGameState().quarries,
    getCamera,
    getZoomPercent,
    onQuarrySelect,
    isBlocked: () => isWorldInspectionBlocked(placementGate),
    isVisibilityBlocked: () => isIllustratedMapActive()
      || isWorldResourceIconVisibilityBlocked(placementGate),
  });

  const foraging = new ForagingMapIcons({
    uiRoot,
    domElement,
    terrain,
    markers: foragingMarkers,
    getCamera,
    getZoomPercent,
    getForagingNodes: () => getGameState().foragingNodes,
    getGeologicalNodes: () => getGameState().quarries,
    onForagingSelect,
    onClaySelect,
    isBlocked: () => isWorldInspectionBlocked(placementGate),
    isVisibilityBlocked: () => isIllustratedMapActive()
      || isWorldResourceIconVisibilityBlocked(placementGate),
  });

  const minimap = TerrainMinimapOverlay.create({
    uiRoot,
    riverField,
    terrain,
    forestCores,
    worldSeed,
    layoutMarkers,
    getRoadNetwork,
    getGameState,
    getFocus,
    isBlocked: () => isOverlayBlocked(placementGate),
    onTerrainImageReady,
    onTerrainImageUpdated,
  });
  let sharedFrameRect: DOMRect | null = null;
  const getFrameRect = (): DOMRect => {
    sharedFrameRect ??= domElement.getBoundingClientRect();
    return sharedFrameRect;
  };

  return {
    quarry,
    foraging,
    minimap,
    update(): void {
      sharedFrameRect = null;
      quarry.update(getFrameRect);
      foraging.update(getFrameRect);
    },
  };
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
