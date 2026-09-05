import { ForagingMapIcons } from '../map/ForagingMapIcons.ts';
import { QuarryMapIcons } from '../map/QuarryMapIcons.ts';
import { ConstructionMapIcons } from '../map/ConstructionMapIcons.ts';
import { SettlementMapIcons } from '../map/SettlementMapIcons.ts';
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
import type { ForestTreeLayout } from '../props/ForestManager.ts';
import type { RoadNetwork } from '../roads/RoadNetwork.ts';
import { ILLUSTRATED_MAP_STAMP_LIFT } from '../map/IllustratedMapPlane.ts';
import { IllustratedMapResourceHover } from '../map/IllustratedMapResourceHover.ts';
import { TownReportPanel } from '../ui/TownReportPanel.ts';
import { TownNameDialog } from '../ui/TownNameDialog.ts';

export type WorldMapUiBundle = {
  quarry: QuarryMapIcons;
  foraging: ForagingMapIcons;
  settlement: SettlementMapIcons;
  townReport: TownReportPanel;
  minimap: TerrainMinimapOverlay;
  update(): void;
  dispose(): void;
};

export function createWorldMapUi(options: {
  uiRoot: HTMLElement;
  domElement: HTMLElement;
  terrain: Terrain;
  riverField: RiverField;
  treePlacements: Promise<readonly ForestTreeLayout[]>;
  worldSeed: number;
  registry: WorldLayoutRegistry;
  clayDepositSites?: readonly ClayDepositSite[];
  getCamera: () => PerspectiveCamera | null;
  getZoomPercent: () => number;
  isIllustratedMapActive: () => boolean;
  getIllustratedMapElevation: () => number;
  getGameState: () => GameState;
  getRoadNetwork: () => RoadNetwork;
  getFocus: () => MinimapFocus;
  placementGate: PlacementInteractionGate;
  onTerrainImageReady?: (image: TerrainMinimapLayerImage) => void;
  onTerrainImageUpdated?: () => void;
  onQuarrySelect: (quarryId: string) => void;
  onForagingSelect: (nodeId: string) => void;
  onClaySelect?: (nodeId: string) => void;
  onSettlementSelect?: (settlementId: string) => void;
  onSettlementFocus?: (x: number, z: number) => void;
  onTownHallSelect?: (buildingId: string) => void;
  onSettlementRename?: (settlementId: string, name: string) => Promise<void>;
}): WorldMapUiBundle {
  const {
    uiRoot,
    domElement,
    terrain,
    riverField,
    treePlacements,
    worldSeed,
    registry,
    clayDepositSites,
    getCamera,
    getZoomPercent,
    isIllustratedMapActive,
    getIllustratedMapElevation,
    getGameState,
    getRoadNetwork,
    getFocus,
    placementGate,
    onTerrainImageReady,
    onTerrainImageUpdated,
    onQuarrySelect,
    onForagingSelect,
    onClaySelect,
    onSettlementSelect,
    onSettlementFocus,
    onTownHallSelect,
    onSettlementRename,
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
    isIllustratedMapActive,
    getIllustratedMapY: () => getIllustratedMapElevation() + ILLUSTRATED_MAP_STAMP_LIFT,
    isVisibilityBlocked: () => isIllustratedMapActive()
      ? isOverlayBlocked(placementGate)
      : isWorldResourceIconVisibilityBlocked(placementGate),
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
    isIllustratedMapActive,
    getIllustratedMapY: () => getIllustratedMapElevation() + ILLUSTRATED_MAP_STAMP_LIFT,
    isVisibilityBlocked: () => isIllustratedMapActive()
      ? isOverlayBlocked(placementGate)
      : isWorldResourceIconVisibilityBlocked(placementGate),
  });

  const townNameDialog = new TownNameDialog(uiRoot);
  const construction = new ConstructionMapIcons({
    uiRoot, domElement, terrain, getState: getGameState, getCamera,
    isBlocked: () => isWorldResourceIconVisibilityBlocked(placementGate),
  });
  const requestSettlementRename = async (settlementId: string): Promise<void> => {
    const settlement = getGameState().settlements.get(settlementId);
    if (!settlement || !onSettlementRename) return;
    const name = await townNameDialog.prompt(settlement.name);
    if (name !== null) await onSettlementRename(settlementId, name);
  };
  const townReport = new TownReportPanel({
    uiRoot,
    getState: getGameState,
    onFocus: onSettlementFocus,
    onInspectTownHall: onTownHallSelect,
    onRename: (settlementId) => void requestSettlementRename(settlementId),
  });
  const settlement = new SettlementMapIcons({
    uiRoot,
    domElement,
    terrain,
    getState: getGameState,
    getCamera,
    getZoomPercent,
    onSettlementSelect: (settlementId) => {
      townReport.open(settlementId);
      onSettlementSelect?.(settlementId);
    },
    onSettlementRename: (settlementId) => void requestSettlementRename(settlementId),
    isBlocked: () => isWorldInspectionBlocked(placementGate),
    isVisibilityBlocked: () => isOverlayBlocked(placementGate),
  });

  const minimap = TerrainMinimapOverlay.create({
    uiRoot,
    riverField,
    terrain,
    treePlacements,
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
  const illustratedResourceHover = new IllustratedMapResourceHover({
    uiRoot,
    domElement,
    isActive: isIllustratedMapActive,
    isBlocked: () => isOverlayBlocked(placementGate),
  });

  return {
    quarry,
    foraging,
    settlement,
    townReport,
    minimap,
    update(): void {
      sharedFrameRect = null;
      quarry.update(getFrameRect);
      foraging.update(getFrameRect);
      construction.update(getFrameRect);
      settlement.update(getFrameRect);
      townReport.refresh();
      illustratedResourceHover.update();
    },
    dispose(): void {
      illustratedResourceHover.dispose();
      quarry.dispose();
      construction.dispose();
      foraging.dispose();
      settlement.dispose();
      townReport.dispose();
      townNameDialog.dispose();
      minimap.dispose();
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
