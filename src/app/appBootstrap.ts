import { AmbientAudioController } from '../audio/AmbientAudioController.ts';
import { CameraController } from '../camera/CameraController.ts';
import { FirstPersonController } from '../camera/FirstPersonController.ts';
import { FpCollisionWorld } from '../camera/fp/fpCollisionWorld.ts';
import { BuildingMarkers } from '../buildings/BuildingMarkers.ts';
import { BuildingTool } from '../buildings/BuildingTool.ts';
import type { FarmFieldMarkers } from '../farming/FarmFieldMarkers.ts';
import {
  FarmFieldTool,
  type FarmFieldPlacementFailureReason,
  type LandParcelMode,
} from '../farming/FarmFieldTool.ts';
import type { PastureMarkers } from '../farming/PastureMarkers.ts';
import type { LivestockVisuals } from '../farming/LivestockVisuals.ts';
import { BurgageTool } from '../residences/BurgageTool.ts';
import { MAX_ZONE_DEPTH, MIN_ZONE_DEPTH } from '../residences/burgageLayout.ts';
import type { ResidenceMarkers } from '../residences/ResidenceMarkers.ts';
import { BurialMarkers } from '../residences/BurialMarkers.ts';
import type { BackyardGardenMarkers } from '../residences/BackyardGardenMarkers.ts';
import type { BurgageFencing } from '../residences/BurgageFencing.ts';
import { SpacetimeGameStore } from '../data/spacetimeGameStore.ts';
import { InputManager } from '../input/InputManager.ts';
import {
  isBurgagePlacementBlocked,
  isBuildingPlacementBlocked,
  isFarmFieldPlacementBlocked,
  isRoadPlacementBlocked,
  isWorldInspectionBlocked,
  type PlacementInteractionGate,
} from '../input/PlacementInteractionGate.ts';
import { SessionConnectionGate } from '../network/SessionConnectionGate.ts';
import { createInitialGameState } from '../resources/GameState.ts';
import type { GameState } from '../resources/types.ts';
import { countTreesNearBuilding } from '../resources/ForestVisualSync.ts';
import type { ResourceInspector } from '../resources/ResourceInspector.ts';
import {
  formatLocatedResourceAmount,
  locatePhysicalResource,
  resourceDisplayLabel,
} from '../resources/resourceLocator.ts';
import {
  computeInTransitResourceTotals,
  computeGoldAwaitingCollection,
  computeGuardhousePayrollGold,
  computePopulationStats,
  computeResourceTotals,
  computeStoredResourceTotals,
  type HudResourceKind,
} from '../resources/resourceTotals.ts';
import { WorldLayoutRegistry } from '../resources/WorldLayoutRegistry.ts';
import type { TreeRegistry } from '../resources/TreeRegistry.ts';
import { WorldQueries } from '../resources/WorldQueries.ts';
import { RoadMaterialFactory } from '../roads/RoadMaterialFactory.ts';
import { RoadNetwork } from '../roads/RoadNetwork.ts';
import { encodeCombatRiverNavigation } from '../security/combatRiverNavigation.ts';
import { RoadSelection } from '../roads/RoadSelection.ts';
import { RoadTool } from '../roads/RoadTool.ts';
import { isOnRoadSurface } from '../roads/roadConnectivity.ts';
import { SceneManager } from '../scene/SceneManager.ts';
import { createInspectorSpacetimeActions } from './inspectorSpacetimeActions.ts';
import { createWorldMapUi, resolveWorldMapFocus, type WorldMapUiBundle } from './worldMapIcons.ts';
import { buildBuildingWorldMapMarkers } from '../map/worldMapMarkers.ts';
import type { DeliveryAgentRenderer } from '../logistics/DeliveryAgentRenderer.ts';
import type { FireEffectsRenderer } from '../fires/FireEffectsRenderer.ts';
import type { VillagerRenderer } from '../settlement/VillagerRenderer.ts';
import { beginProgressiveStartupTextureLoad } from '../scene/startupTextures.ts';
import {
  markDetailedWorldTexturesReady,
  markSettlementPresentationReady,
  markStartupCheckpoint,
} from './startupDiagnostics.ts';
import { sampleNaturalTerrainHeight } from '../terrain/TerrainHeight.ts';
import { BuildToolbar } from '../ui/BuildToolbar.ts';
import type { BuildingKind } from '../generated/gameBalance.ts';
import { ECONOMIC_ACTIVITY_TAX_RATE_DEFAULT } from '../economy/villageEconomy.ts';
import { DEFAULT_PARISH_POLICY } from '../economy/chapelParish.ts';
import { DEFAULT_MONASTERY_POLICY } from '../economy/monasteryPolicy.ts';
import { beginNewWorld, resolveWorldGenerationSettings } from './worldBootstrapFlow.ts';
import { LoadingScreen } from '../ui/LoadingScreen.ts';
import { ToastManager } from '../ui/ToastManager.ts';
import { VillagerInspector } from '../ui/VillagerInspector.ts';
import { saveWorldGenerationSettings } from '../world/worldGenerationSettings.ts';
import { getDraftWorldGeneration, setDraftWorldGeneration } from '../world/worldGenerationContext.ts';
import { mountTooltips } from '../ui/tooltips.ts';
import { setHydrologyOverlayEnabled, isHydrologyOverlayEnabled } from '../scene/hydrologyOverlayPreference.ts';
import { describeBuildingPlacementBlocker } from '../ui/buildToolbarStatus.ts';
import {
  roadPlacementReasonToToastId,
  buildingPlacementReasonToToastId,
  burgagePlacementReasonToToastId,
} from '../ui/toastMessages.ts';

export type AppBootstrapBridge = {
  syncToolbar: () => void;
};

export type SessionLiveContext = {
  gameState: GameState;
  treeRegistry: TreeRegistry | null;
};

export type BootstrappedSession = {
  loadingScreen: ReturnType<typeof LoadingScreen.tryCreate>;
  liveContext: SessionLiveContext;
  sceneManager: SceneManager;
  layoutRegistry: WorldLayoutRegistry;
  gameState: GameState;
  input: InputManager;
  roadNetwork: RoadNetwork;
  cameraController: CameraController;
  firstPersonController: FirstPersonController;
  roadTool: RoadTool;
  roadSelection: RoadSelection;
  buildingTool: BuildingTool;
  burgageTool: BurgageTool;
  farmFieldTool: FarmFieldTool;
  buildingMarkers: BuildingMarkers;
  deliveryAgents: DeliveryAgentRenderer;
  fireEffects: FireEffectsRenderer;
  villagers: VillagerRenderer;
  residenceMarkers: ResidenceMarkers;
  backyardGardenMarkers: BackyardGardenMarkers;
  burgageFencing: BurgageFencing;
  farmFieldMarkers: FarmFieldMarkers;
  pastureMarkers: PastureMarkers;
  burialMarkers: BurialMarkers;
  livestockVisuals: LivestockVisuals;
  toolbar: BuildToolbar;
  toastManager: ToastManager;
  disposeTooltips: () => void;
  resourceInspector: ResourceInspector;
  villagerInspector: VillagerInspector;
  worldMapUi: WorldMapUiBundle;
  ambientAudio: AmbientAudioController;
  spacetimeStore: SpacetimeGameStore;
  sessionGate: SessionConnectionGate;
  placementGate: PlacementInteractionGate;
  uiRoot: HTMLElement;
};

function mustElement(root: HTMLElement, selector: string): HTMLElement {
  const element = root.querySelector<HTMLElement>(selector);
  if (!element) throw new Error(`Missing app element ${selector}`);
  return element;
}

export async function bootstrapAppSession(
  root: HTMLElement,
  bridge: AppBootstrapBridge,
): Promise<BootstrappedSession> {
  const loadingScreen = LoadingScreen.tryCreate();
  const settlementPresentationPromise = import('./deferredSettlementPresentation.ts');
  const materials = RoadMaterialFactory.createProgressive(8);
  void materials.whenTexturesReady().catch((error) => {
    console.warn('Detailed road and terrain textures are still unavailable:', error);
  });
  const materialsPromise = Promise.resolve(materials);
  const startupTexturesPromise = beginProgressiveStartupTextureLoad();
  void startupTexturesPromise.then((textures) => textures.ready?.catch((error) => {
    console.warn('Detailed rock and sky textures are still unavailable:', error);
  }));
  void Promise.all([
    materials.whenTexturesReady(),
    startupTexturesPromise.then((textures) => textures.ready),
  ]).then(() => markDetailedWorldTexturesReady()).catch(() => undefined);

  root.innerHTML = `
      <div class="app-shell">
        <div class="scene-root" data-scene-root></div>
        <div data-ui-root></div>
      </div>
    `;

  if (new URLSearchParams(window.location.search).has('new')) {
    loadingScreen?.setProgress({
      label: 'New settlement',
      detail: 'Choose map size, landscape, and seed',
      phase: 'worldSetup',
      fraction: 0,
    });
  }
  const worldSettings = await resolveWorldGenerationSettings(root, (progress) => {
    loadingScreen?.setProgress({
      ...progress,
      phase: 'worldSetup',
      fraction: progress.label === 'Checking world…' ? 0.35 : 0.7,
    });
  });
  setDraftWorldGeneration(worldSettings);
  saveWorldGenerationSettings(worldSettings);

  loadingScreen?.setProgress({
    label: 'Starting world…',
    detail: 'Setting up scene shell',
    phase: 'worldSetup',
    fraction: 1,
  });
  loadingScreen?.setProgress({
    label: 'Starting world…',
    detail: 'Setting up scene shell',
    phase: 'sceneShell',
    fraction: 0,
  });

  const sceneRoot = mustElement(root, '[data-scene-root]');
  const uiRoot = mustElement(root, '[data-ui-root]');

  const sceneManager = await SceneManager.create(sceneRoot, worldSettings, (progress) => {
    loadingScreen?.setProgress(progress);
  }, materialsPromise, startupTexturesPromise);
  markStartupCheckpoint('scene bootstrap returned');
  const layoutRegistry = WorldLayoutRegistry.fromWorldLayout(sceneManager.worldLayout);
  const gameState = createInitialGameState(layoutRegistry, getDraftWorldGeneration().seed);
  const liveContext: SessionLiveContext = { gameState, treeRegistry: null };
  const isSettlementFounded = (): boolean => (
    liveContext.gameState.physicalFoundingSiteEnabled === true
    || liveContext.gameState.buildings.size > 0
    || liveContext.gameState.residences.size > 0
    || liveContext.gameState.burgageZones.size > 0
  );
  const input = new InputManager(sceneManager.renderer.domElement);
  const spacetimeStore = new SpacetimeGameStore();
  const sessionGate = new SessionConnectionGate();
  const roadNetwork = new RoadNetwork();
  roadNetwork.setRiverNavigation(
    encodeCombatRiverNavigation(sceneManager.riverField),
  );
  const firstPersonCollisionWorld = new FpCollisionWorld({
    getStaticRoots: () => sceneManager.getFirstPersonCollisionRoots(),
    getHeightAt: (x, z) => sceneManager.terrain.getHeightAt(x, z),
    getRockObstaclesNear: (x, z, radius) => sceneManager.getRockObstaclesNear(x, z, radius),
    getTreeRegistry: () => liveContext.treeRegistry,
    getTreeState: (treeId) => liveContext.gameState.trees.get(treeId),
    isTreeLayoutActive: (layoutIndex) =>
      sceneManager.getForestManager()?.isTreeLayoutActiveForCollision(layoutIndex) ?? false,
  });

  const requireSessionReady = (): void => {
    if (!sessionGate.isReady()) {
      throw new Error('SpacetimeDB is not connected. Start the local server and refresh.');
    }
  };

  let cameraController: CameraController;
  let firstPersonController: FirstPersonController;
  let roadTool: RoadTool;
  let buildingTool: BuildingTool;
  let burgageTool: BurgageTool;
  let farmFieldTool: FarmFieldTool;
  let toolbar: BuildToolbar;
  let toastManager: ToastManager;
  let resourceInspector: ResourceInspector;
  let villagerInspector: VillagerInspector;

  const ambientAudio = new AmbientAudioController({
    unlockElement: sceneManager.renderer.domElement,
    camera: sceneManager.camera,
    audioParent: sceneManager.scene,
    riverLayout: sceneManager.riverField.layout,
    getRiverWaterSurfaceY: sceneManager.getBridgeSamplingContext().getWaterSurfaceY,
    getCameraTarget: () => {
      const target = sceneManager.cameraTarget;
      return { x: target.x, z: target.z };
    },
    getOrbitDistance: () => {
      if (firstPersonController?.isActive()) return 12;
      return cameraController?.getOrbitDistance() ?? 240;
    },
    getBuildings: () => liveContext.gameState.buildings.values(),
    getBurgageZones: () => liveContext.gameState.burgageZones.values(),
    getFireIncidents: () => liveContext.gameState.fireIncidents.values(),
  });

  const worldQueries = new WorldQueries({
    terrain: sceneManager.terrain,
    riverField: sceneManager.riverField,
    registry: layoutRegistry,
    getGameState: () => liveContext.gameState,
    getRoadNetwork: () => roadNetwork,
    getTreeRegistry: () => liveContext.treeRegistry,
    getWorldHydrology: () => spacetimeStore.snapshot.worldGeneration?.hydrology ?? 50,
    getMonasteryHospitalityEnabled: () =>
      (spacetimeStore.snapshot.monasteryPolicy ?? DEFAULT_MONASTERY_POLICY).feastsEnabled,
  });
  const buildingMarkers = new BuildingMarkers({
    terrain: sceneManager.terrain,
    parent: sceneManager.selectionGroup,
    getRoadNetwork: () => roadNetwork,
    getRoadConditionSpeedMultiplier: () => worldQueries.getRoadConditionSpeedMultiplier(),
  });
  const {
    DeliveryAgentRenderer,
    FireEffectsRenderer,
    VillagerRenderer,
    ResidenceMarkers,
    BackyardGardenMarkers,
    BurgageFencing,
    FarmFieldMarkers,
    PastureMarkers,
    LivestockVisuals,
    ResourceInspector,
  } = await settlementPresentationPromise;
  markSettlementPresentationReady();
  const deliveryAgents = new DeliveryAgentRenderer({
    terrain: sceneManager.terrain,
    parent: sceneManager.selectionGroup,
    getGameSpeed: () => spacetimeStore.snapshot.gameSpeed,
    getRoadDeckY: (x, z) => sceneManager.sampleRoadDeckY(x, z),
    isOnRoadSurface: (x, z) => (
      roadNetwork ? isOnRoadSurface(x, z, roadNetwork) : false
    ),
  });
  const fireEffects = new FireEffectsRenderer(
    sceneManager.terrain,
    sceneManager.selectionGroup,
  );
  const villagers = new VillagerRenderer({
    parent: sceneManager.selectionGroup,
    getGameSpeed: () => spacetimeStore.snapshot.gameSpeed,
    getHeightAt: (x, z) => sceneManager.terrain.getHeightAt(x, z),
    getRoadDeckY: (x, z) => sceneManager.sampleRoadDeckY(x, z),
    isWaterAt: (x, z) => sceneManager.riverField.isRenderedWetAt(x, z),
    routePathAroundObstacles: (path) => firstPersonCollisionWorld.routeAgentPath(path),
  });
  const placementGate: PlacementInteractionGate = {
    isSessionReady: () => sessionGate.isReady(),
    isSettlementFounded,
    isRoadToolEnabled: () => false,
    isBuildingToolEnabled: () => false,
    isStarterCampPlacementActive: () => false,
    isBurgageToolEnabled: () => false,
    isFarmFieldToolEnabled: () => false,
    isFirstPersonActive: () => false,
    isMenuOpen: () => false,
  };

  cameraController = new CameraController({
    camera: sceneManager.camera,
    target: sceneManager.cameraTarget,
    domElement: sceneManager.renderer.domElement,
    bounds: sceneManager.terrain.bounds,
    getHeightAt: (x, z) => sceneManager.terrain.getHeightAt(x, z),
    getCursorOverride: () => {
      if (firstPersonController?.isActive()) return 'default';
      return burgageTool?.getCursor()
        ?? farmFieldTool?.getCursor()
        ?? roadTool?.getCursor()
        ?? null;
    },
    shouldIgnoreInput: (event) =>
      (roadTool?.shouldBlockCameraInput(event) ?? false)
      || (buildingTool?.shouldBlockCameraInput(event) ?? false)
      || (burgageTool?.shouldBlockCameraInput(event) ?? false)
      || (farmFieldTool?.shouldBlockCameraInput(event) ?? false),
    onViewChanged: () => {
      if (firstPersonController?.isActive()) return;
      sceneManager.render(0, cameraController.getOrbitDistance());
    },
  });

  const roadSelection = new RoadSelection({
    camera: sceneManager.camera,
    domElement: sceneManager.renderer.domElement,
    network: roadNetwork,
    sceneManager,
    onChange: () => bridge.syncToolbar(),
  });

  const toggleRoadTool = (): void => {
    if (!sessionGate.isReady()) {
      toastManager?.show('SpacetimeDB is not connected.', { variant: 'error' });
      return;
    }
    roadTool.setEnabled(!roadTool.isEnabled());
    if (roadTool.isEnabled()) {
      buildingTool.setMode('off');
      burgageTool.setEnabled(false);
      farmFieldTool.setEnabled(false);
      resourceInspector?.clearSelection();
      villagerInspector?.clearSelection();
    }
    bridge.syncToolbar();
  };

  roadTool = new RoadTool({
    domElement: sceneManager.renderer.domElement,
    network: roadNetwork,
    sceneManager,
    selection: roadSelection,
    terrainProjector: sceneManager.terrainProjector,
    onToggle: toggleRoadTool,
    onNetworkChanged: () => {
      sceneManager.syncRoadNetwork(roadNetwork);
      roadSelection.refresh();
      bridge.syncToolbar();
      spacetimeStore.queueRoadSync(roadNetwork.snapshot());
      ambientAudio.playUiSound('road_place');
    },
    onStateChanged: () => bridge.syncToolbar(),
    isBlocked: () => isRoadPlacementBlocked(placementGate),
    onDeleteRequested: (request) => {
      if (!toolbar) return;
      if (!request) {
        toolbar.hideDeletePopup();
        return;
      }
      toolbar.showDeletePopup({
        clientX: request.clientX,
        clientY: request.clientY,
        onRemove: () => roadTool.confirmDelete(request.edgeId),
        onCancel: () => roadSelection.setSelected(null),
      });
    },
    onPlacementRejected: (event) => {
      ambientAudio.playUiSound('error');
      const messageId = roadPlacementReasonToToastId(event.reason);
      if (messageId) toastManager?.showMessageId(messageId, { variant: 'error' });
    },
  });

  buildingTool = new BuildingTool({
    domElement: sceneManager.renderer.domElement,
    terrainProjector: sceneManager.terrainProjector,
    markers: buildingMarkers,
    getState: () => liveContext.gameState,
    onPlaceBuilding: async (kind, x, z) => {
      requireSessionReady();
      await spacetimeStore.placeBuilding(kind, x, z);
      ambientAudio.playUiSound('building_place');
    },
    onDemolishBuilding: async (buildingId) => {
      requireSessionReady();
      await spacetimeStore.demolishBuilding(buildingId);
    },
    isWaterAt: (x, z) => sceneManager.riverField.isRenderedWetAt(x, z),
    isQuarryPitAt: (x, z) => sceneManager.worldLayout.quarryLayout.isBlockedForProps(x, z),
    getNaturalHeightAt: (x, z) => sampleNaturalTerrainHeight(x, z),
    countMatureTreesInRadius: (x, z, radius) => {
      const registry = liveContext.treeRegistry;
      if (!registry) return null;
      return countTreesNearBuilding(liveContext.gameState, registry, x, z, radius).matureTrees;
    },
    getRoadNetwork: () => roadNetwork,
    getDeliveryTravelSpeedMultiplier: (origin) =>
      worldQueries.getDeliveryTravelSpeedMultiplier(origin),
    onModeChanged: () => bridge.syncToolbar(),
    onPlacementPreviewChanged: () => bridge.syncToolbar(),
    describePlacementFailure: describeBuildingPlacementBlocker,
    onPlacementRejected: (reason) => {
      ambientAudio.playUiSound('error');
      toastManager?.showMessageId(buildingPlacementReasonToToastId(reason), { variant: 'error' });
    },
    onPlacementFailed: (message) => {
      ambientAudio.playUiSound('error');
      toastManager?.show(message, { variant: 'error' });
    },
    onUndoFailed: (message) => {
      toastManager?.show(message, { variant: 'error' });
    },
    onRedoFailed: (message) => {
      toastManager?.show(message, { variant: 'error' });
    },
    isBlocked: () => isBuildingPlacementBlocked(placementGate),
  });

  burgageTool = new BurgageTool({
    domElement: sceneManager.renderer.domElement,
    camera: sceneManager.camera,
    terrainProjector: sceneManager.terrainProjector,
    roadNetwork,
    getState: () => liveContext.gameState,
    getHeightAt: (x, z) => sceneManager.terrain.getHeightAt(x, z),
    getNaturalHeightAt: (x, z) => sampleNaturalTerrainHeight(x, z),
    isWaterAt: (x, z) => sceneManager.riverField.isRenderedWetAt(x, z),
    isQuarryPitAt: (x, z) => sceneManager.worldLayout.quarryLayout.isBlockedForProps(x, z),
    onCommit: async (commit) => {
      requireSessionReady();
      await spacetimeStore.placeBurgageZone({
        corners: commit.corners.map((corner) => ({ x: corner.x, z: corner.z })),
        frontageEdge: commit.frontageEdge,
        plotCount: commit.plotCount,
      });
      ambientAudio.playUiSound('building_place');
    },
    onDemolishBurgageZone: async (zoneId) => {
      requireSessionReady();
      await spacetimeStore.demolishBurgageZone(zoneId);
    },
    onModeChanged: () => bridge.syncToolbar(),
    onPlacementRejected: (reason) => {
      ambientAudio.playUiSound('error');
      toastManager?.showMessageId(burgagePlacementReasonToToastId(reason), { variant: 'error' });
    },
    onPlacementFailed: (message) => {
      toastManager?.show(message, { variant: 'error' });
    },
    onUndoFailed: (message) => {
      toastManager?.show(message, { variant: 'error' });
    },
    onRedoFailed: (message) => {
      toastManager?.show(message, { variant: 'error' });
    },
    onPickRejected: (reason) => {
      if (reason === 'missed_terrain') {
        toastManager?.show('Click on terrain to place a point.', { variant: 'info', durationMs: 2200 });
        return;
      }
      if (reason === 'off_road') {
        toastManager?.show('Click beside a road for the frontage edge.', { variant: 'info', durationMs: 2400 });
        return;
      }
      if (reason === 'invalid_depth') {
        toastManager?.show(
          `Set depth between ~${Math.round(MIN_ZONE_DEPTH)}m and ~${Math.round(MAX_ZONE_DEPTH)}m behind the road.`,
          { variant: 'info', durationMs: 2600 },
        );
        return;
      }
      toastManager?.show('Move farther from the last corner.', { variant: 'info', durationMs: 2200 });
    },
    isBlocked: () => isBurgagePlacementBlocked(placementGate),
  });
  burgageTool.attachTo(sceneManager.previewGroup);

  const fieldFailureMessage = (mode: LandParcelMode, reason: FarmFieldPlacementFailureReason): string => {
    const parcel = mode === 'pasture' ? 'pasture' : mode === 'graveyard' ? 'burial ground' : 'field';
    switch (reason) {
      case 'too_small': return `Draw a larger ${parcel}.`;
      case 'edge_too_short': return `Each ${parcel} edge must be longer.`;
      case 'invalid_shape': return `Trace a simple convex four-corner ${parcel} boundary.`;
      case 'too_steep': return `This ground is too steep for the ${parcel}.`;
      case 'no_farmstead': return `Keep the entire ${parcel} inside the selected holding’s work extent.`;
      case 'water': return `${parcel} cannot cover open water.`;
      case 'quarry': return `${parcel} cannot cover a quarry pit.`;
      case 'building': return `${parcel} overlaps a building.`;
      case 'residence': return `${parcel} overlaps a residence plot.`;
      case 'field': return `${parcel} overlaps existing farmland.`;
      case 'pasture': return `This ${parcel} overlaps an existing pasture.`;
      case 'graveyard': return `This ${parcel} overlaps an existing burial ground.`;
    }
  };

  farmFieldTool = new FarmFieldTool({
    domElement: sceneManager.renderer.domElement,
    camera: sceneManager.camera,
    terrainProjector: sceneManager.terrainProjector,
    getState: () => liveContext.gameState,
    getHeightAt: (x, z) => sceneManager.terrain.getHeightAt(x, z),
    isWaterAt: (x, z) => sceneManager.riverField.isRenderedWetAt(x, z),
    isQuarryPitAt: (x, z) => sceneManager.worldLayout.quarryLayout.isBlockedForProps(x, z),
    onCommit: async (input) => {
      requireSessionReady();
      await spacetimeStore.placeFarmField(input);
      ambientAudio.playUiSound('confirm');
    },
    onCommitPasture: async (input) => {
      requireSessionReady();
      await spacetimeStore.placePasture(input);
      ambientAudio.playUiSound('confirm');
    },
    onCommitGraveyard: async (input) => {
      requireSessionReady();
      await spacetimeStore.placeGraveyard(input);
      ambientAudio.playUiSound('confirm');
    },
    onModeChanged: () => bridge.syncToolbar(),
    onPlacementRejected: (reason) => {
      ambientAudio.playUiSound('error');
      toastManager?.show(
        fieldFailureMessage(farmFieldTool.getMode(), reason),
        { variant: 'error' },
      );
    },
    onPlacementFailed: (message) => toastManager?.show(message, { variant: 'error' }),
    onCropChanged: (crop, recommendation) => toastManager?.show(
      `${crop[0].toUpperCase()}${crop.slice(1)} selected · ${recommendation}.`,
      { variant: 'info', durationMs: 2400 },
    ),
    isBlocked: () => isFarmFieldPlacementBlocked(placementGate),
  });
  farmFieldTool.attachTo(sceneManager.previewGroup);

  const residenceMarkers = new ResidenceMarkers(sceneManager.selectionGroup);
  const backyardGardenMarkers = new BackyardGardenMarkers(sceneManager.selectionGroup, {
    maxAnisotropy: sceneManager.textureAnisotropy,
    useSeedThree: sceneManager.rendererBackend === 'webgpu',
  });
  const burgageFencing = new BurgageFencing(sceneManager.selectionGroup);
  const farmFieldMarkers = new FarmFieldMarkers(
    sceneManager.selectionGroup,
    (x, z) => sceneManager.terrain.getHeightAt(x, z),
  );
  const pastureMarkers = new PastureMarkers(
    sceneManager.selectionGroup,
    (x, z) => sceneManager.terrain.getHeightAt(x, z),
  );
  const livestockVisuals = new LivestockVisuals(
    sceneManager.selectionGroup,
    (x, z) => sceneManager.terrain.getHeightAt(x, z),
  );

  const beginLinkedLandParcelPlacement = (mode: LandParcelMode, farmsteadId: string): void => {
    if (!sessionGate.isReady()) {
      toastManager?.show('SpacetimeDB is not connected.', { variant: 'error' });
      return;
    }
    const farmstead = liveContext.gameState.buildings.get(farmsteadId);
    const eligible = farmstead && (mode === 'field'
      ? farmstead.kind === 'threshing_barn'
      : mode === 'graveyard'
        ? farmstead.kind === 'chapel' && farmstead.constructionComplete !== false
        : farmstead.kind === 'pastoral_farmstead' || farmstead.kind === 'swineherd');
    if (!farmstead || !eligible) {
      toastManager?.show('That holding can no longer manage this type of land.', { variant: 'error' });
      return;
    }

    const wasEnabled = farmFieldTool.isEnabled()
      && farmFieldTool.getMode() === mode
      && farmFieldTool.getFarmsteadId() === farmsteadId;
    farmFieldTool.setMode(mode, farmsteadId);
    if (!farmFieldTool.isEnabled()) return;

    roadTool.setEnabled(false);
    buildingTool.setMode('off');
    burgageTool.setEnabled(false);
    buildingMarkers.setBuildingExtentOverlay(farmstead);
    if (!wasEnabled) {
      toastManager?.show(
        mode === 'field'
          ? 'Lay out a field entirely inside this farmstead’s work extent. Press C to change the crop.'
          : mode === 'graveyard'
            ? 'Lay consecrated burial ground directly beside this chapel.'
            : 'Fence a parcel entirely inside this holding’s work extent.',
        { variant: 'info', durationMs: 6000 },
      );
    }
    bridge.syncToolbar();
  };

  toolbar = new BuildToolbar(uiRoot, {
    onOpenRoads: toggleRoadTool,
    onBuildRoad: () => {
      if (farmFieldTool.isEnabled()) {
        farmFieldTool.commitDraft();
        return;
      }
      if (burgageTool.isEnabled()) {
        burgageTool.commitDraft();
        return;
      }
      roadTool.commitDraft();
    },
    onPlaceStarterCamp: () => {
      if (!sessionGate.isReady()) {
        toastManager?.show('SpacetimeDB is not connected.', { variant: 'error' });
        return;
      }
      const wasActive = buildingTool.getMode() === 'founders_camp';
      buildingTool.setMode('founders_camp');
      if (buildingTool.getMode() !== 'founders_camp') return;
      roadTool.setEnabled(false);
      burgageTool.setEnabled(false);
      farmFieldTool.setEnabled(false);
      resourceInspector?.clearSelection();
      villagerInspector?.clearSelection();
      if (!wasActive) {
        toastManager?.show(
          'Choose clear, dry ground for your founders. This will become the heart of your settlement.',
          { variant: 'info', durationMs: 6000 },
        );
      }
      bridge.syncToolbar();
    },
    onSelectBuilding: (kind: BuildingKind) => {
      if (!sessionGate.isReady()) {
        toastManager?.show('SpacetimeDB is not connected.', { variant: 'error' });
        return;
      }
      buildingTool.setMode(kind);
      if (buildingTool.getMode() === kind) {
        roadTool.setEnabled(false);
        burgageTool.setEnabled(false);
        farmFieldTool.setEnabled(false);
        resourceInspector?.clearSelection();
        villagerInspector?.clearSelection();
      }
      bridge.syncToolbar();
    },
    onSelectResidences: () => {
      if (!sessionGate.isReady()) {
        toastManager?.show('SpacetimeDB is not connected.', { variant: 'error' });
        return;
      }
      const wasEnabled = burgageTool.isEnabled();
      burgageTool.setEnabled(true);
      if (burgageTool.isEnabled()) {
        roadTool.setEnabled(false);
        buildingTool.setMode('off');
        farmFieldTool.setEnabled(false);
        resourceInspector?.clearSelection();
        villagerInspector?.clearSelection();
        if (!wasEnabled) {
          toastManager?.show(
            'Draw the rectangle along the road, then use the on-screen plot controls to choose how many homes fit.',
            { variant: 'info', durationMs: 6500 },
          );
        }
      }
      bridge.syncToolbar();
    },
    onToggleCityAdministration: () => {
      const townHall = [...liveContext.gameState.buildings.values()]
        .find((building) => building.kind === 'town_hall');
      if (!townHall) {
        toastManager?.show('Build a Town Hall to open settlement administration.', { variant: 'info' });
        return;
      }
      resourceInspector.selectBuilding(townHall.id);
    },
    onBurgagePlotDecrease: () => {
      burgageTool.adjustPlotCount(-1);
      bridge.syncToolbar();
    },
    onBurgagePlotIncrease: () => {
      burgageTool.adjustPlotCount(1);
      bridge.syncToolbar();
    },
    onBurgageRotateFrontage: () => {
      burgageTool.rotateFrontageEdge();
      bridge.syncToolbar();
    },
    onSetWaterOverlay: (active) => {
      setHydrologyOverlayEnabled(active);
      sceneManager.setHydrologyOverlayVisible(active);
      toolbar.setWaterOverlayActive(active);
    },
    onSetGameSpeed: (speed) => {
      void spacetimeStore.setGameSpeed(speed).catch((error) => {
        const message = error instanceof Error ? error.message : 'Could not change game speed.';
        toastManager?.show(message, { variant: 'error', durationMs: 4500 });
      });
    },
    onMenuOpenChange: (open) => {
      cameraController.setInputEnabled(!open && !firstPersonController.isActive());
    },
    onAudioEnabledChange: (enabled) => {
      ambientAudio.setEnabled(enabled);
    },
    onAmbienceVolumeChange: (volume) => {
      ambientAudio.setAmbienceVolume(volume);
    },
    onMusicEnabledChange: (enabled) => {
      ambientAudio.setMusicEnabled(enabled);
    },
    onMusicVolumeChange: (volume) => {
      ambientAudio.setMusicVolume(volume);
    },
    onShadowPreferenceChange: () => {
      sceneManager.applyShadowPreferences();
    },
    canOpenMenuFromKeyboard: () =>
      !firstPersonController.isActive()
      && !roadTool.isEnabled()
      && !buildingTool.isEnabled()
      && !burgageTool.isEnabled()
      && !farmFieldTool.isEnabled(),
    onNewWorld: () => {
      void beginNewWorld(() => sessionGate.isReady());
    },
    onGrantCheatResources: async (amount) => {
      requireSessionReady();
      await spacetimeStore.grantCheatResources(amount);
      toastManager?.show(
        `Cheat mode active: ${amount.toLocaleString()} of every resource.`,
        { variant: 'info', durationMs: 4200 },
      );
    },
  });
  toolbar.setConflictEnabled(worldSettings.conflictMode === 'frontier');

  const disposeTooltips = mountTooltips(uiRoot);
  toastManager = new ToastManager(uiRoot);
  spacetimeStore.setRoadSyncFailedListener((error) => {
    const message = error instanceof Error ? error.message : 'Road sync failed.';
    toastManager?.show(`Road sync failed: ${message}`, { variant: 'error', durationMs: 6000 });
  });
  const inspectorActions = createInspectorSpacetimeActions(
    () => spacetimeStore,
    () => liveContext.gameState,
    () => sessionGate.isReady(),
    toastManager,
  );
  villagerInspector = new VillagerInspector({
    domElement: sceneManager.renderer.domElement,
    uiRoot,
    camera: sceneManager.camera,
    villagers,
    deliveryAgents,
    getState: () => liveContext.gameState,
    selectionParent: sceneManager.selectionGroup,
    isBlocked: () => isWorldInspectionBlocked(placementGate),
    onSelectionChange: (selected) => {
      if (selected) resourceInspector?.clearSelection();
    },
  });
  resourceInspector = new ResourceInspector({
    domElement: sceneManager.renderer.domElement,
    uiRoot,
    sceneManager,
    terrainProjector: sceneManager.terrainProjector,
    worldQueries,
    getState: () => liveContext.gameState,
    getEconomicActivityTaxRate: () =>
      spacetimeStore.snapshot.economicActivityTaxRate ?? ECONOMIC_ACTIVITY_TAX_RATE_DEFAULT,
    getSeasonalLaborStewardEnabled: () =>
      spacetimeStore.snapshot.seasonalLaborStewardEnabled,
    getConstructionLaborStewardEnabled: () =>
      spacetimeStore.snapshot.constructionLaborStewardEnabled,
    getProductionLaborStewardEnabled: () =>
      spacetimeStore.snapshot.productionLaborStewardEnabled,
    getLaborStewardReserve: () =>
      spacetimeStore.snapshot.laborStewardReserve,
    getParishPolicy: () =>
      spacetimeStore.snapshot.parishPolicy ?? DEFAULT_PARISH_POLICY,
    getMonasteryPolicy: () =>
      spacetimeStore.snapshot.monasteryPolicy ?? DEFAULT_MONASTERY_POLICY,
    getNightPolicy: () => spacetimeStore.snapshot.nightPolicy,
    getMarketState: () => spacetimeStore.snapshot.marketState,
    getSettlementSecurity: () => spacetimeStore.snapshot.settlementSecurity,
    getCombatAgents: () => spacetimeStore.snapshot.combatAgents.values(),
    getConflictEnabled: () =>
      spacetimeStore.snapshot.worldGeneration?.configured === true
      && spacetimeStore.snapshot.worldGeneration.conflictMode === 'frontier',
    getEnemyPressure: () => spacetimeStore.snapshot.worldGeneration?.enemyPressure ?? 0,
    getWorldHydrology: () => spacetimeStore.snapshot.worldGeneration?.hydrology ?? 50,
    getWorldResourceAbundance: () =>
      spacetimeStore.snapshot.worldGeneration?.resourceAbundance ?? 50,
    ...inspectorActions,
    onBeginFarmFieldPlacement: (farmsteadId) => beginLinkedLandParcelPlacement('field', farmsteadId),
    onBeginPasturePlacement: (farmsteadId) => beginLinkedLandParcelPlacement('pasture', farmsteadId),
    onBeginGraveyardPlacement: (chapelId) => beginLinkedLandParcelPlacement('graveyard', chapelId),
    onInspectDeliveryTrip: (tripId) => {
      const trip = liveContext.gameState.deliveryTrips.get(tripId);
      if (!trip || !villagerInspector.selectDeliveryTrip(tripId)) return;
      if (!firstPersonController?.isActive()) {
        cameraController.focusWorldPosition(trip.x, trip.z);
      }
    },
    onFocusWorldPosition: (x, z) => {
      if (!firstPersonController?.isActive()) {
        cameraController.focusWorldPosition(x, z);
      }
    },
    onServiceCoverageChange: (residenceIds, kind) => {
      residenceMarkers.setServiceCoverageHighlights(residenceIds, kind);
    },
    onSelectionChange: (target) => {
      if (target) villagerInspector.clearSelection();
      toolbar.setCityAdministrationOpen(target?.kind === 'building' && target.building.kind === 'town_hall');
      if (target?.kind === 'building') {
        buildingMarkers.setBuildingExtentOverlay(target.building, liveContext.gameState);
        return;
      }
      buildingMarkers.setBuildingExtentOverlay(null);
    },
    isBlocked: () => isWorldInspectionBlocked(placementGate),
  });
  resourceInspector.setHud(
    computeResourceTotals(gameState),
    computeStoredResourceTotals(gameState),
    computePopulationStats(gameState),
    computeInTransitResourceTotals(gameState.deliveryTrips.values()),
    computeGoldAwaitingCollection(gameState.buildings.values()),
    computeGuardhousePayrollGold(gameState.buildings.values()),
  );
  const burialMarkers = new BurialMarkers(sceneManager.selectionGroup);
  let lastLocatedResource: HudResourceKind | null = null;
  let locatedResourceIndex = 0;
  toolbar.settlementHud.setResourceLocator((resource) => {
    if (isWorldInspectionBlocked(placementGate)) {
      toastManager.show(
        sessionGate.isReady()
          ? 'Finish or cancel the active tool before locating settlement stock.'
          : 'Connect to the settlement before locating physical stock.',
        { variant: 'info', durationMs: 3200 },
      );
      return;
    }

    const locations = locatePhysicalResource(liveContext.gameState, resource);
    if (locations.length === 0) {
      lastLocatedResource = null;
      locatedResourceIndex = 0;
      toastManager.show(
        `No physical ${resourceDisplayLabel(resource).toLowerCase()} is currently stored or loaded on a cart.`,
        { variant: 'info', durationMs: 3200 },
      );
      return;
    }

    locatedResourceIndex = lastLocatedResource === resource
      ? (locatedResourceIndex + 1) % locations.length
      : 0;
    lastLocatedResource = resource;
    const location = locations[locatedResourceIndex];

    if (location.kind === 'legacy-ledger') {
      resourceInspector.clearSelection();
      villagerInspector.clearSelection();
    } else if (location.kind === 'delivery') {
      resourceInspector.clearSelection();
      villagerInspector.selectDeliveryTrip(location.id);
      cameraController.focusWorldPosition(location.x, location.z);
    } else {
      villagerInspector.clearSelection();
      if (location.kind === 'building') {
        resourceInspector.selectBuilding(location.id);
      } else {
        resourceInspector.selectResidence(location.id);
      }
      cameraController.focusWorldPosition(location.x, location.z);
    }

    toastManager.show(
      `${resourceDisplayLabel(resource)} ${formatLocatedResourceAmount(location.amount)}`
        + ` · ${location.label} · ${location.detail}`
        + ` · ${locatedResourceIndex + 1}/${locations.length}`,
      { variant: 'info', durationMs: 4000 },
    );
  });

  firstPersonController = new FirstPersonController({
    camera: sceneManager.camera,
    domElement: sceneManager.renderer.domElement,
    bounds: sceneManager.terrain.bounds,
    getHeightAt: (x, z) => sceneManager.terrain.getHeightAt(x, z),
    getRoadDeckY: (x, z) => sceneManager.sampleRoadDeckY(x, z),
    collisionWorld: firstPersonCollisionWorld,
    getOrbitSpawn: () => {
      const target = cameraController.getTargetPosition();
      return { x: target.x, z: target.z, yaw: cameraController.getYaw() };
    },
    isMenuOpen: () => toolbar.isGameMenuOpen(),
    isSessionReady: () => sessionGate.isReady() && isSettlementFounded(),
    onModeChange: (active) => {
      cameraController.setInputEnabled(!active && !toolbar.isGameMenuOpen());
      toolbar.setFirstPersonMode(active);
      if (active) {
        if (roadTool.isEnabled()) roadTool.setEnabled(false);
        if (buildingTool.isEnabled()) buildingTool.setMode('off');
        if (burgageTool.isEnabled()) burgageTool.setEnabled(false);
        if (farmFieldTool.isEnabled()) farmFieldTool.setEnabled(false);
        return;
      }
      const pos = firstPersonController.getPosition();
      cameraController.syncFromFirstPerson(pos.x, pos.z, firstPersonController.getBodyYaw());
    },
  });

  placementGate.isRoadToolEnabled = () => roadTool.isEnabled();
  placementGate.isBuildingToolEnabled = () => buildingTool.isEnabled();
  placementGate.isStarterCampPlacementActive = () => (
    buildingTool.getMode() === 'founders_camp'
  );
  placementGate.isBurgageToolEnabled = () => burgageTool.isEnabled();
  placementGate.isFarmFieldToolEnabled = () => farmFieldTool.isEnabled();
  placementGate.isFirstPersonActive = () => firstPersonController.isActive();
  placementGate.isMenuOpen = () => toolbar.isGameMenuOpen();

  const worldMapUi = createWorldMapUi({
    uiRoot,
    domElement: sceneManager.renderer.domElement,
    terrain: sceneManager.terrain,
    riverField: sceneManager.riverField,
    registry: layoutRegistry,
    getCamera: () => sceneManager.camera,
    getZoomPercent: () => cameraController.getZoomPercent(),
    getGameState: () => liveContext.gameState,
    getFocus: () => resolveWorldMapFocus(cameraController, firstPersonController),
    placementGate,
    onQuarrySelect: (quarryId) => resourceInspector.selectQuarry(quarryId),
    onForagingSelect: (nodeId) => resourceInspector.selectForaging(nodeId),
  });
  worldMapUi.minimap.syncBuildings(buildBuildingWorldMapMarkers(liveContext.gameState.buildings.values()));

  toolbar.setWaterOverlayActive(isHydrologyOverlayEnabled());
  toolbar.setGameplayEnabled(false);
  loadingScreen?.setProgress({
    label: 'Connecting…',
    detail: 'Syncing with SpacetimeDB',
    phase: 'connecting',
    fraction: 0,
  });

  markStartupCheckpoint('application services ready');
  return {
    loadingScreen,
    liveContext,
    sceneManager,
    layoutRegistry,
    gameState,
    input,
    roadNetwork,
    cameraController,
    firstPersonController,
    roadTool,
    roadSelection,
    buildingTool,
    burgageTool,
    farmFieldTool,
    buildingMarkers,
    deliveryAgents,
    fireEffects,
    villagers,
    residenceMarkers,
    backyardGardenMarkers,
    burgageFencing,
    farmFieldMarkers,
    pastureMarkers,
    burialMarkers,
    livestockVisuals,
    toolbar,
    toastManager,
    disposeTooltips,
    resourceInspector,
    villagerInspector,
    worldMapUi,
    ambientAudio,
    spacetimeStore,
    sessionGate,
    placementGate,
    uiRoot,
  };
}
