import type { AmbientAudioController } from '../audio/AmbientAudioController.ts';
import { CameraController } from '../camera/CameraController.ts';
import { FirstPersonController } from '../camera/FirstPersonController.ts';
import { FpCollisionWorld } from '../camera/fp/fpCollisionWorld.ts';
import type { BuildingMarkers } from '../buildings/BuildingMarkers.ts';
import type { BuildingTool } from '../buildings/BuildingTool.ts';
import type { FarmFieldMarkers } from '../farming/FarmFieldMarkers.ts';
import {
  FarmFieldTool,
  type FarmFieldPlacementFailureReason,
  type LandParcelMode,
} from '../farming/FarmFieldTool.ts';
import { cropLabel } from '../farming/farmFieldMath.ts';
import type { PastureMarkers } from '../farming/PastureMarkers.ts';
import type { LivestockVisuals } from '../farming/LivestockVisuals.ts';
import type { VineyardParcelMarkers } from '../vineyards/VineyardParcelMarkers.ts';
import { BurgageTool } from '../residences/BurgageTool.ts';
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
  isForestryWorkAreaPlacementBlocked,
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
  ForestryWorkAreaTool,
  FORESTRY_WORK_AREA_INITIAL_RADIUS,
} from '../resources/ForestryWorkAreaTool.ts';
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
import {
  createPhysicalDepositFootprints,
  isPhysicalDepositAt,
} from '../resources/physicalDepositProtection.ts';
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
import { syncPlacedBuildingTerrain } from './placedBuildingTerrainSync.ts';
import { createWorldMapUi, resolveWorldMapFocus, type WorldMapUiBundle } from './worldMapIcons.ts';
import { buildBuildingWorldMapMarkers } from '../map/worldMapMarkers.ts';
import type { DeliveryAgentRenderer } from '../logistics/DeliveryAgentRenderer.ts';
import { createAgentWaterObstacleTest } from '../settlement/agentNavigation.ts';
import type { FireEffectsRenderer } from '../fires/FireEffectsRenderer.ts';
import { BanditCampRenderer } from '../security/BanditCampRenderer.ts';
import { MilitiaCommandController } from '../security/MilitiaCommandController.ts';
import type { CombatAgentState } from '../security/combatAgents.ts';
import type { MilitaryCompanyState } from '../security/militaryProgression.ts';
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
import { DEFAULT_FISCAL_POLICY } from '../economy/fiscalPolicy.ts';
import { DEFAULT_LABOR_STEWARD_RESERVE } from '../economy/laborSteward.ts';
import { DEFAULT_PANTRY_SAFEGUARD_POLICY } from '../economy/pantrySafeguardPolicy.ts';
import { DEFAULT_PARISH_POLICY } from '../economy/chapelParish.ts';
import { settlementHasStaffedChapel } from '../logistics/landmarkAccess.ts';
import { DEFAULT_MONASTERY_POLICY } from '../economy/monasteryPolicy.ts';
import { beginNewWorld, resolveWorldGenerationSettings } from './worldBootstrapFlow.ts';
import { LoadingScreen } from '../ui/LoadingScreen.ts';
import { ToastManager } from '../ui/ToastManager.ts';
import { TutorialOverlay } from '../ui/TutorialOverlay.ts';
import type { VillagerInspector } from '../ui/VillagerInspector.ts';
import {
  saveWorldGenerationSettings,
  type WorldGenerationSettings,
} from '../world/worldGenerationSettings.ts';
import { getDraftWorldGeneration, setDraftWorldGeneration } from '../world/worldGenerationContext.ts';
import { mountTooltips } from '../ui/tooltips.ts';
import {
  getMapOverlaySelection,
  setMapOverlaySelection,
} from '../scene/mapOverlayPreference.ts';
import { describeBuildingPlacementBlocker } from '../ui/buildToolbarStatus.ts';
import {
  roadPlacementReasonToToastId,
  buildingPlacementReasonToToastId,
  burgagePlacementReasonToToastId,
  isConstructionResourceShortfallMessage,
} from '../ui/toastMessages.ts';
import { renameSettlement } from '../data/spacetimeReducers.ts';
import type { GameSpeed } from '../world/gameSpeed.ts';

const REPORT_FOCUS_ZOOM_PERCENT = 50;

export type AppBootstrapBridge = {
  syncToolbar: () => void;
  /** Fixed offline worlds, such as the combat sandbox, bypass save probing. */
  worldSettingsOverride?: WorldGenerationSettings;
  deferGameplayMusic?: boolean;
  onGameAudioEnabledChange?: (enabled: boolean) => void;
  onMusicEnabledChange?: (enabled: boolean) => void;
  onMusicVolumeChange?: (volume: number) => void;
  /** Client-only combat sandboxes can surface their transient formations in
   * the ordinary company inspector without writing fake server rows. */
  getCombatAgentOverride?: () => Iterable<CombatAgentState> | undefined;
  getMilitaryCompanyOverride?: () => Iterable<MilitaryCompanyState> | undefined;
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
  forestryWorkAreaTool: ForestryWorkAreaTool;
  buildingMarkers: BuildingMarkers;
  deliveryAgents: DeliveryAgentRenderer;
  fireEffects: FireEffectsRenderer;
  banditCamps: BanditCampRenderer;
  militiaCommands: MilitiaCommandController;
  villagers: VillagerRenderer;
  residenceMarkers: ResidenceMarkers;
  backyardGardenMarkers: BackyardGardenMarkers;
  burgageFencing: BurgageFencing;
  farmFieldMarkers: FarmFieldMarkers;
  pastureMarkers: PastureMarkers;
  vineyardParcelMarkers: VineyardParcelMarkers;
  burialMarkers: BurialMarkers;
  livestockVisuals: LivestockVisuals;
  toolbar: BuildToolbar;
  toastManager: ToastManager;
  tutorialOverlay: TutorialOverlay;
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
  const worldSettings = bridge.worldSettingsOverride
    ?? await resolveWorldGenerationSettings(root, (progress) => {
      loadingScreen?.setProgress({
        ...progress,
        phase: 'worldSetup',
        fraction: progress.label === 'Checking world…' ? 0.35 : 0.7,
      });
    });
  setDraftWorldGeneration(worldSettings);
  if (!bridge.worldSettingsOverride) saveWorldGenerationSettings(worldSettings);

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
  sceneManager.riverField.prepareNavigationWaterIndex();
  const isAgentNavigationBlockedByWater = createAgentWaterObstacleTest(
    (x, z) => sceneManager.riverField.isRenderedWetAt(x, z),
    (x, z) => isOnRoadSurface(x, z, roadNetwork),
    (x, z, radius) => sceneManager.riverField.renderedWaterTouchesDisk(x, z, radius),
  );
  const firstPersonCollisionWorld = new FpCollisionWorld({
    getStaticRoots: () => sceneManager.getFirstPersonCollisionRoots(),
    getHeightAt: (x, z) => sceneManager.terrain.getHeightAt(x, z),
    getRockObstaclesNearInto: (x, z, radius, results) =>
      sceneManager.getRockObstaclesNearInto(x, z, radius, results),
    getRockStateVersion: () => sceneManager.getRockCollisionVersion(),
    getTreeRegistry: () => liveContext.treeRegistry,
    getTreeState: (treeId) => liveContext.gameState.trees.get(treeId),
    getTreeStateVersion: () => liveContext.gameState.trees,
    getTreeActivityVersion: () => sceneManager.getForestCollisionVersion(),
    isTreeLayoutActive: (layoutIndex) =>
      sceneManager.getForestManager()?.isTreeLayoutActiveForCollision(layoutIndex) ?? false,
    // Rendered water remains impassable to civilian agents. A road surface
    // over the same XZ is the generated bridge deck and is the sole opening.
    isAgentNavigationBlocked: isAgentNavigationBlockedByWater,
    mayAgentNavigationPathBeBlocked: (path, radius) =>
      sceneManager.riverField.renderedWaterMayTouchPolyline(path, radius),
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
  let forestryWorkAreaTool: ForestryWorkAreaTool;
  let toolbar: BuildToolbar;
  let toastManager: ToastManager;
  let tutorialOverlay: TutorialOverlay;
  let resourceInspector: ResourceInspector;
  let villagerInspector: VillagerInspector;

  const { AmbientAudioController } = await import('../audio/AmbientAudioController.ts');
  const ambientAudio = new AmbientAudioController({
    unlockElement: sceneManager.renderer.domElement,
    camera: sceneManager.camera,
    audioParent: sceneManager.scene,
    riverLayout: sceneManager.riverField.layout,
    getRiverWaterSurfaceY: sceneManager.getBridgeSamplingContext().getWaterSurfaceY,
    gameplayMusicInitiallyActive: !bridge.deferGameplayMusic,
    getCameraTarget: () => (
      firstPersonController?.isActive()
        ? sceneManager.camera.position
        : sceneManager.cameraTarget
    ),
    getOrbitDistance: () => {
      if (firstPersonController?.isActive()) return 12;
      return cameraController?.getOrbitDistance() ?? 240;
    },
    isFirstPersonActive: () => firstPersonController?.isActive() ?? false,
    getForestCanopyCover: (x, z) => (
      sceneManager.getForestManager()?.sampleAudioCanopyCover(x, z) ?? 0
    ),
    getBuildings: () => liveContext.gameState.buildings,
    getBurgageZones: () => liveContext.gameState.burgageZones.values(),
    getResidences: () => liveContext.gameState.residences,
    getFireIncidents: () => liveContext.gameState.fireIncidents.values(),
    getDeliveryTrips: () => liveContext.gameState.deliveryTrips.values(),
    getLivestockHerds: () => liveContext.gameState.livestockHerds.values(),
    getPastures: () => liveContext.gameState.pastures,
    getBackyardGardens: () => liveContext.gameState.backyardGardens.values(),
    getForagingNodes: () => liveContext.gameState.foragingNodes.values(),
    getGraveyards: () => liveContext.gameState.graveyards?.values() ?? [],
    getCombatAgents: () => spacetimeStore.snapshot.combatAgents.values(),
  });

  const worldQueries = new WorldQueries({
    terrain: sceneManager.terrain,
    riverField: sceneManager.riverField,
    registry: layoutRegistry,
    clayDepositSites: sceneManager.worldLayout.clayDepositLayout.sites,
    getGameState: () => liveContext.gameState,
    getRoadNetwork: () => roadNetwork,
    getTreeRegistry: () => liveContext.treeRegistry,
    getWorldHydrology: () => spacetimeStore.snapshot.worldGeneration?.hydrology ?? 50,
    getSevereWeatherEnabled: () =>
      spacetimeStore.snapshot.worldGeneration?.severeWeatherEnabled ?? false,
  });
  const {
    BuildingMarkers: DeferredBuildingMarkers,
    BuildingTool: DeferredBuildingTool,
    DeliveryAgentRenderer,
    FireEffectsRenderer,
    VillagerRenderer,
    ResidenceMarkers,
    BackyardGardenMarkers,
    BurgageFencing,
    FarmFieldMarkers,
    PastureMarkers,
    VineyardParcelMarkers,
    LivestockVisuals,
    ResourceInspector,
  } = await settlementPresentationPromise;
  markSettlementPresentationReady();
  const buildingMarkers = new DeferredBuildingMarkers({
    terrain: sceneManager.terrain,
    parent: sceneManager.selectionGroup,
    getRoadNetwork: () => roadNetwork,
    getRoadConditionSpeedMultiplier: () => worldQueries.getRoadConditionSpeedMultiplier(),
    onShadowCastersChanged: () => sceneManager.invalidateStaticShadows(),
  });
  // Build the one-time founding landmark while the loading presentation is
  // already covering startup, never in response to the player's click.
  buildingMarkers.prewarmFoundersCampPlacement();
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
    getDeliveryOxPose: (tripId) => deliveryAgents.getOxFollowPose(tripId),
    getDeliveryOxRoute: (tripId) => deliveryAgents.getRemainingRoute(tripId),
  });
  const placementGate: PlacementInteractionGate = {
    isSessionReady: () => sessionGate.isReady(),
    isSettlementFounded,
    isRoadToolEnabled: () => false,
    isBuildingToolEnabled: () => false,
    isStarterCampPlacementActive: () => false,
    isBurgageToolEnabled: () => false,
    isFarmFieldToolEnabled: () => false,
    isForestryWorkAreaToolEnabled: () => false,
    isFirstPersonActive: () => false,
    isIllustratedMapActive: () => cameraController?.isIllustratedMapActive() ?? false,
    isMenuOpen: () => false,
    isTutorialOpen: () => tutorialOverlay?.isGameplayBlocking() ?? false,
  };

  cameraController = new CameraController({
    camera: sceneManager.camera,
    target: sceneManager.cameraTarget,
    domElement: sceneManager.renderer.domElement,
    bounds: sceneManager.terrain.bounds,
    getHeightAt: (x, z) => sceneManager.terrain.getHeightAt(x, z),
    getCursorOverride: () => {
      if (firstPersonController?.isPlacementActive()) {
        return firstPersonController.hasLockedPlacement() ? 'default' : 'none';
      }
      if (firstPersonController?.isActive()) return 'default';
      return burgageTool?.getCursor()
        ?? farmFieldTool?.getCursor()
        ?? forestryWorkAreaTool?.getCursor()
        ?? roadTool?.getCursor()
        ?? null;
    },
    shouldIgnoreInput: (event) =>
      (roadTool?.shouldBlockCameraInput(event) ?? false)
      || (buildingTool?.shouldBlockCameraInput(event) ?? false)
      || (burgageTool?.shouldBlockCameraInput(event) ?? false)
      || (farmFieldTool?.shouldBlockCameraInput(event) ?? false)
      || (forestryWorkAreaTool?.shouldBlockCameraInput(event) ?? false),
    isIllustratedMapReady: () => sceneManager.isIllustratedMapReady(),
    onIllustratedMapModeTransition: import.meta.env.VITE_E2E_TEST === '1'
      ? undefined
      : (_active, commit) => sceneManager.playIllustratedMapOpacityTransition(commit),
    continuousRenderLoop: import.meta.env.VITE_E2E_TEST !== '1',
    onViewChanged: () => {
      if (firstPersonController?.isActive()) return;
      sceneManager.render(0, cameraController.getOrbitDistance());
    },
    onIllustratedMapModeChanged: (active) => {
      sceneManager.setIllustratedMapActive(active);
      document.documentElement.dataset.cameraView = active
        ? 'illustrated-map'
        : 'world';
      toolbar?.setZoomPercent(cameraController.getHudZoomPercent());
    },
  });

  tutorialOverlay = new TutorialOverlay(uiRoot, {
    onOpenChange: () => {
      cameraController.setInputEnabled(
        !(tutorialOverlay?.isGameplayBlocking() ?? false)
        && !(firstPersonController?.isActive() ?? false)
        && !(toolbar?.isGameMenuOpen() ?? false),
      );
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
    const enableRoad = !roadTool.isEnabled() || roadTool.getMode() !== 'road';
    if (enableRoad) forestryWorkAreaTool?.setEnabled(false);
    roadTool.setEnabled(enableRoad);
    if (roadTool.isEnabled()) {
      buildingTool.setMode('off');
      burgageTool.setEnabled(false);
      farmFieldTool.setEnabled(false);
      resourceInspector?.clearSelection();
      villagerInspector?.clearSelection();
      tutorialOverlay.notifyRoadToolOpened(roadNetwork.edges.size);
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
      worldMapUi.minimap.syncRoads();
      syncPlacedBuildingTerrain({
        sceneManager,
        gameState: liveContext.gameState,
        buildingMarkers,
        forceMeshUpdate: true,
      });
      buildingMarkers.refreshRoadFacingOrientations();
      sceneManager.syncBuildingAccessRoads(buildingMarkers.getRoadConnectionSources());
      roadSelection.refresh();
      bridge.syncToolbar();
      spacetimeStore.queueRoadSync(roadNetwork.snapshot());
      ambientAudio.playUiSound('road_place');
    },
    onStateChanged: () => bridge.syncToolbar(),
    getBuildings: () => buildingMarkers.getRoadConnectionSources(),
    getBurgageZones: () => liveContext.gameState.burgageZones.values(),
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
        onRemove: () => {
          if (request.kind === 'dry-stone-wall') {
            roadTool.confirmDryStoneWallDelete(request.wallId);
          } else {
            roadTool.confirmDelete(request.edgeId);
          }
        },
        onCancel: () => roadSelection.setSelected(null),
      });
    },
    onPlacementRejected: (event) => {
      ambientAudio.playUiSound('error');
      const messageId = roadPlacementReasonToToastId(event.reason);
      if (messageId) toastManager?.showMessageId(messageId, { variant: 'error' });
    },
    onDryStoneWallStartRejected: () => {
      ambientAudio.playUiSound('error');
      toastManager?.show(
        'Start the wall beside an existing dirt road; the first span snaps parallel to its shoulder.',
        { variant: 'info', durationMs: 3600 },
      );
    },
  });

  const physicalDeposits = createPhysicalDepositFootprints(sceneManager.worldLayout);
  const isResourceDepositAt = (x: number, z: number): boolean =>
    isPhysicalDepositAt(physicalDeposits, x, z);

  buildingTool = new DeferredBuildingTool({
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
    isResourceDepositAt,
    getNaturalHeightAt: (x, z) => sampleNaturalTerrainHeight(x, z),
    countMatureTreesInRadius: (x, z, radius) => {
      const registry = liveContext.treeRegistry;
      if (!registry) return null;
      return countTreesNearBuilding(liveContext.gameState, registry, x, z, radius).matureTrees;
    },
    getRoadNetwork: () => roadNetwork,
    getMapSize: () => sceneManager.worldLayout.settings.mapSize,
    mapBounds: sceneManager.terrain.bounds,
    getDeliveryTravelSpeedMultiplier: (origin) =>
      worldQueries.getDeliveryTravelSpeedMultiplier(origin),
    onModeChanged: () => bridge.syncToolbar(),
    onPlacementPreviewChanged: () => bridge.syncToolbar(),
    describePlacementFailure: describeBuildingPlacementBlocker,
    onPlacementRejected: (reason) => {
      if (reason === 'insufficient_resources') return;
      ambientAudio.playUiSound('error');
      toastManager?.showMessageId(buildingPlacementReasonToToastId(reason), { variant: 'error' });
    },
    onPlacementFailed: (message, kind) => {
      if (isConstructionResourceShortfallMessage(message)) {
        buildingTool.markPlacementResourceShortfall(kind);
        bridge.syncToolbar();
        return;
      }
      ambientAudio.playUiSound('error');
      toastManager?.show(message, { variant: 'error' });
    },
    onBuildingPlaced: (kind) => {
      tutorialOverlay.notifyBuildingPlaced(
        kind,
        [...liveContext.gameState.buildings.values()].map((building) => building.kind),
      );
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
    isResourceDepositAt,
    physicalDeposits,
    onCommit: async (commit) => {
      requireSessionReady();
      await spacetimeStore.placeBurgageZone({
        corners: commit.corners.map((corner) => ({ x: corner.x, z: corner.z })),
        frontageEdge: commit.frontageEdge,
        plotCount: commit.plotCount,
      });
      ambientAudio.playUiSound('building_place');
    },
    onBurgageZonePlaced: () => {
      tutorialOverlay.notifyBurgageZonePlaced(liveContext.gameState.burgageZones.size);
    },
    onDemolishBurgageZone: async (zoneId) => {
      requireSessionReady();
      await spacetimeStore.demolishBurgageZone(zoneId);
    },
    onModeChanged: () => bridge.syncToolbar(),
    onPlacementRejected: (reason) => {
      if (reason === 'insufficient_resources') return;
      ambientAudio.playUiSound('error');
      toastManager?.showMessageId(burgagePlacementReasonToToastId(reason), { variant: 'error' });
    },
    onPlacementFailed: (message) => {
      if (isConstructionResourceShortfallMessage(message)) {
        burgageTool.markPlacementResourceShortfall();
        bridge.syncToolbar();
        return;
      }
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
      toastManager?.show('Move farther from the last corner.', { variant: 'info', durationMs: 2200 });
    },
    isBlocked: () => isBurgagePlacementBlocked(placementGate),
  });
  burgageTool.attachTo(sceneManager.previewGroup);

  const fieldFailureMessage = (mode: LandParcelMode, reason: FarmFieldPlacementFailureReason): string => {
    const parcel = mode === 'pasture' ? 'pasture' : mode === 'graveyard' ? 'burial ground' : mode === 'vineyard' ? 'vineyard' : 'field';
    switch (reason) {
      case 'too_small': return `Draw a larger ${parcel}.`;
      case 'too_large': return `Draw a smaller ${parcel}.`;
      case 'edge_too_short': return `Each ${parcel} edge must be longer.`;
      case 'invalid_shape': return `Trace a simple convex four-corner ${parcel} boundary.`;
      case 'too_steep': return `This ground is too steep for the ${parcel}.`;
      case 'no_farmstead': return `Keep the entire ${parcel} inside the selected holding’s work extent.`;
      case 'water': return `${parcel} cannot cover open water.`;
      case 'resource_deposit': return `${parcel} cannot cover a physical resource deposit.`;
      case 'building': return `${parcel} overlaps a building.`;
      case 'residence': return `${parcel} overlaps a residence plot.`;
      case 'field': return `${parcel} overlaps existing farmland.`;
      case 'pasture': return `This ${parcel} overlaps an existing pasture.`;
      case 'graveyard': return `This ${parcel} overlaps an existing burial ground.`;
      case 'vineyard': return `This ${parcel} overlaps an existing vineyard.`;
    }
  };

  farmFieldTool = new FarmFieldTool({
    domElement: sceneManager.renderer.domElement,
    camera: sceneManager.camera,
    terrainProjector: sceneManager.terrainProjector,
    getState: () => liveContext.gameState,
    getHeightAt: (x, z) => sceneManager.terrain.getHeightAt(x, z),
    isWaterAt: (x, z) => sceneManager.riverField.isRenderedWetAt(x, z),
    isResourceDepositAt,
    physicalDeposits,
    getRoadNetwork: () => roadNetwork,
    getTreeRegistry: () => liveContext.treeRegistry,
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
    onCommitVineyard: async (input) => {
      requireSessionReady();
      await spacetimeStore.placeVineyard(input);
      ambientAudio.playUiSound('building_place');
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
    isSabbathObserved: () => Boolean(
      (spacetimeStore.snapshot.parishPolicy ?? DEFAULT_PARISH_POLICY)
        .sabbathObservanceEnabled
      && settlementHasStaffedChapel(liveContext.gameState),
    ),
    isBlocked: () => isFarmFieldPlacementBlocked(placementGate),
  });
  farmFieldTool.attachTo(sceneManager.previewGroup);

  forestryWorkAreaTool = new ForestryWorkAreaTool({
    domElement: sceneManager.renderer.domElement,
    terrainProjector: sceneManager.terrainProjector,
    getHeightAt: (x, z) => sceneManager.terrain.getHeightAt(x, z),
    onCommit: async ({ buildingId, x, z, radius }) => {
      requireSessionReady();
      await spacetimeStore.setTreeWorkArea(buildingId, x, z, radius);
      ambientAudio.playUiSound('confirm');
      toastManager?.show(
        `Forestry work area set · ${Math.round(radius)} m radius.`,
        { variant: 'info', durationMs: 2600 },
      );
    },
    onModeChanged: () => {
      resourceInspector?.refreshSelection();
      bridge.syncToolbar();
    },
    onCommitFailed: (message) => {
      ambientAudio.playUiSound('error');
      toastManager?.show(message, { variant: 'error' });
    },
    isBlocked: () => isForestryWorkAreaPlacementBlocked(placementGate),
  });
  forestryWorkAreaTool.attachTo(sceneManager.previewGroup);

  const residenceMarkers = new ResidenceMarkers(
    sceneManager.selectionGroup,
    () => sceneManager.invalidateStaticShadows(),
  );
  const banditCamps = new BanditCampRenderer(
    sceneManager.terrain,
    sceneManager.selectionGroup,
  );
  const backyardGardenMarkers = new BackyardGardenMarkers(sceneManager.selectionGroup, {
    maxAnisotropy: sceneManager.textureAnisotropy,
    useSeedThree: sceneManager.rendererBackend === 'webgpu',
  });
  const burgageFencing = new BurgageFencing(sceneManager.selectionGroup);
  const farmFieldMarkers = new FarmFieldMarkers(
    sceneManager.selectionGroup,
    (x, z) => sceneManager.terrain.getHeightAt(x, z),
    {
      maxAnisotropy: sceneManager.textureAnisotropy,
      rendererBackend: sceneManager.rendererBackend,
      useSeedThreePerimeterShrubs: true,
      useSeedThreeCrops: true,
    },
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
        : mode === 'vineyard'
          ? farmstead.kind === 'monastery' && farmstead.constructionComplete !== false
          : farmstead.kind === 'pastoral_farmstead' || farmstead.kind === 'swineherd');
    if (!farmstead || !eligible) {
      toastManager?.show('That holding can no longer manage this type of land.', { variant: 'error' });
      return;
    }

    forestryWorkAreaTool.setEnabled(false);
    const wasEnabled = farmFieldTool.isEnabled()
      && farmFieldTool.getMode() === mode
      && farmFieldTool.getFarmsteadId() === farmsteadId;
    farmFieldTool.setMode(mode, farmsteadId);
    if (!farmFieldTool.isEnabled()) return;

    roadTool.setEnabled(false);
    buildingTool.setMode('off');
    burgageTool.setEnabled(false);
    buildingMarkers.setBuildingSelectionOverlays(farmstead);
    if (!wasEnabled) {
      toastManager?.show(
        mode === 'field'
          ? `Lay out ${cropLabel(farmFieldTool.getCrop()).toLowerCase()} parcels inside this farmstead’s work extent. Nearby linked boundaries snap together. Press C to change the crop.`
          : mode === 'graveyard'
            ? 'Lay consecrated burial parcels anywhere inside this chapel’s work extent. Nearby linked boundaries snap together.'
            : mode === 'vineyard'
              ? 'Lay out vineyard parcels anywhere inside the monastery’s work extent. Nearby linked boundaries snap together; sunny, well-drained slopes produce the strongest harvests.'
              : 'Fence parcels entirely inside this holding’s work extent. Nearby linked boundaries snap together.',
        { variant: 'info', durationMs: 6000 },
      );
    }
    bridge.syncToolbar();
  };

  const beginTreeWorkAreaPlacement = (buildingId: string): void => {
    if (!sessionGate.isReady()) {
      toastManager?.show('SpacetimeDB is not connected.', { variant: 'error' });
      return;
    }
    const building = liveContext.gameState.buildings.get(buildingId);
    if (
      !building
      || (
        building.kind !== 'lumber_mill'
        && building.kind !== 'woodcutters_lodge'
        && building.kind !== 'reforester'
      )
      || building.constructionComplete === false
    ) {
      toastManager?.show('That forestry building can no longer set a work area.', { variant: 'error' });
      return;
    }
    if (
      forestryWorkAreaTool.isEnabled()
      && forestryWorkAreaTool.getBuildingId() === buildingId
    ) {
      forestryWorkAreaTool.setEnabled(false);
      return;
    }

    roadTool.setEnabled(false);
    buildingTool.setMode('off');
    burgageTool.setEnabled(false);
    farmFieldTool.setEnabled(false);
    forestryWorkAreaTool.begin(
      buildingId,
      { x: building.x, z: building.z },
      FORESTRY_WORK_AREA_INITIAL_RADIUS,
    );
    if (!forestryWorkAreaTool.isEnabled()) return;
    villagerInspector?.clearSelection();
    toastManager?.show(
      'Move the forestry circle anywhere on the map. Hold Ctrl and scroll to resize, then click to set it. Right-click or press Esc to cancel.',
      { variant: 'info', durationMs: 7000 },
    );
    bridge.syncToolbar();
  };

  const clearTreeWorkArea = async (buildingId: string): Promise<void> => {
    forestryWorkAreaTool.setEnabled(false);
    try {
      requireSessionReady();
      await spacetimeStore.clearTreeWorkArea(buildingId);
      ambientAudio.playUiSound('confirm');
      toastManager?.show(
        'Limited forestry area cleared · default building extent restored.',
        { variant: 'info', durationMs: 3000 },
      );
    } catch (error) {
      ambientAudio.playUiSound('error');
      toastManager?.show(
        error instanceof Error ? error.message : 'Could not restore the default forestry extent.',
        { variant: 'error' },
      );
    }
  };

  const requestGameSpeed = (speed: GameSpeed): void => {
    void spacetimeStore.setGameSpeed(speed).catch((error) => {
      const message = error instanceof Error ? error.message : 'Could not change game speed.';
      toastManager?.show(message, { variant: 'error', durationMs: 4500 });
    });
  };

  toolbar = new BuildToolbar(uiRoot, {
    onOpenRoads: toggleRoadTool,
    onSetRoadSnap: (enabled) => buildingTool.setRoadSnapEnabled(enabled),
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
    onCancelPlacement: () => {
      roadTool.setEnabled(false);
      buildingTool.setMode('off');
      burgageTool.setEnabled(false);
      farmFieldTool.setEnabled(false);
      forestryWorkAreaTool.setEnabled(false);
    },
    onPlaceStarterCamp: () => {
      if (!sessionGate.isReady()) {
        toastManager?.show('SpacetimeDB is not connected.', { variant: 'error' });
        return;
      }
      forestryWorkAreaTool.setEnabled(false);
      buildingTool.setMode('founders_camp');
      if (buildingTool.getMode() !== 'founders_camp') return;
      roadTool.setEnabled(false);
      burgageTool.setEnabled(false);
      farmFieldTool.setEnabled(false);
      resourceInspector?.clearSelection();
      villagerInspector?.clearSelection();
      bridge.syncToolbar();
    },
    onSelectBuilding: (kind: BuildingKind) => {
      if (!sessionGate.isReady()) {
        toastManager?.show('SpacetimeDB is not connected.', { variant: 'error' });
        return;
      }
      forestryWorkAreaTool.setEnabled(false);
      buildingTool.setMode(kind);
      if (buildingTool.getMode() === kind) {
        roadTool.setEnabled(false);
        burgageTool.setEnabled(false);
        farmFieldTool.setEnabled(false);
        resourceInspector?.clearSelection();
        villagerInspector?.clearSelection();
        tutorialOverlay.notifyBuildingToolOpened(
          kind,
          [...liveContext.gameState.buildings.values()].map((building) => building.kind),
        );
      }
      bridge.syncToolbar();
    },
    onSelectDryStoneWall: () => {
      if (!sessionGate.isReady()) {
        toastManager?.show('SpacetimeDB is not connected.', { variant: 'error' });
        return;
      }
      const wasEnabled = roadTool.getMode() === 'dry-stone-wall';
      forestryWorkAreaTool.setEnabled(false);
      buildingTool.setMode('off');
      burgageTool.setEnabled(false);
      farmFieldTool.setEnabled(false);
      roadTool.setMode('dry-stone-wall');
      if (roadTool.getMode() === 'dry-stone-wall') {
        resourceInspector?.clearSelection();
        villagerInspector?.clearSelection();
        if (!wasEnabled) {
          toastManager?.show(
            'Start beside a dirt road, then trace the wall. Roadside points hug either shoulder; Ctrl + wheel bends a span. Walls are free and build instantly.',
            { variant: 'info', durationMs: 6500 },
          );
        }
      }
      bridge.syncToolbar();
    },
    onSelectResidences: () => {
      if (!sessionGate.isReady()) {
        toastManager?.show('SpacetimeDB is not connected.', { variant: 'error' });
        return;
      }
      const wasEnabled = burgageTool.isEnabled();
      forestryWorkAreaTool.setEnabled(false);
      burgageTool.setEnabled(true);
      if (burgageTool.isEnabled()) {
        roadTool.setEnabled(false);
        buildingTool.setMode('off');
        farmFieldTool.setEnabled(false);
        resourceInspector?.clearSelection();
        villagerInspector?.clearSelection();
        const tutorialShown = tutorialOverlay.notifyResidenceToolOpened(
          liveContext.gameState.burgageZones.size,
        );
        if (!wasEnabled && !tutorialShown) {
          toastManager?.show(
            'Draw the parcel along the road. Nearby residence-plot ends and boundaries snap together; then choose how many homes fit.',
            { variant: 'info', durationMs: 6500 },
          );
        }
      }
      bridge.syncToolbar();
    },
    onToggleCityAdministration: () => {
      const communities = [...liveContext.gameState.settlements.values()]
        .filter((settlement) => settlement.active);
      if (communities.length > 0) {
        const focus = cameraController.getTargetPosition();
        communities.sort((a, b) => (
          Math.hypot(a.anchorX - focus.x, a.anchorZ - focus.z)
          - Math.hypot(b.anchorX - focus.x, b.anchorZ - focus.z)
          || a.id.localeCompare(b.id)
        ));
        resourceInspector.clearSelection();
        villagerInspector.clearSelection();
        worldMapUi.townReport.open(communities[0].id);
        return;
      }
      const legacyTownHall = [...liveContext.gameState.buildings.values()]
        .find((building) => building.kind === 'town_hall');
      if (legacyTownHall) {
        resourceInspector.selectBuilding(legacyTownHall.id);
      } else {
        toastManager?.show('Found a community to open local administration.', { variant: 'info' });
      }
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
    onSetMapOverlay: (selection) => {
      setMapOverlaySelection(selection);
      sceneManager.setMapOverlaySelection(selection);
      toolbar.setMapOverlaySelection(selection);
    },
    onSetGameSpeed: requestGameSpeed,
    onMenuOpenChange: (open) => {
      firstPersonController.onMenuOpenChange(open);
      cameraController.setInputEnabled(
        !open
        && !firstPersonController.isActive()
        && !tutorialOverlay.isGameplayBlocking(),
      );
    },
    onAudioEnabledChange: (enabled) => {
      ambientAudio.setEnabled(enabled);
      bridge.onGameAudioEnabledChange?.(enabled);
    },
    onAmbienceVolumeChange: (volume) => {
      ambientAudio.setAmbienceVolume(volume);
    },
    onForestWindEnabledChange: (enabled) => {
      ambientAudio.setForestWindEnabled(enabled);
    },
    onSoundEffectsVolumeChange: (volume) => {
      ambientAudio.setSoundEffectsVolume(volume);
    },
    onMusicEnabledChange: (enabled) => {
      ambientAudio.setMusicEnabled(enabled);
      bridge.onMusicEnabledChange?.(enabled);
    },
    onMusicVolumeChange: (volume) => {
      ambientAudio.setMusicVolume(volume);
      bridge.onMusicVolumeChange?.(volume);
    },
    onShadowPreferenceChange: () => {
      sceneManager.applyShadowPreferences();
    },
    onDistantCanopyCardsChange: (enabled) => {
      sceneManager.setDistantCanopyCardsEnabled(enabled);
    },
    canOpenMenuFromKeyboard: () =>
      !roadTool.isEnabled()
      && !buildingTool.isEnabled()
      && !burgageTool.isEnabled()
      && !farmFieldTool.isEnabled()
      && !forestryWorkAreaTool.isEnabled()
      && !uiRoot.querySelector('.alert-dialog-backdrop:not([hidden])')
      && !tutorialOverlay.isGameplayBlocking(),
    onNewWorld: () => {
      void beginNewWorld(() => sessionGate.isReady());
    },
    onReplayTutorials: () => tutorialOverlay.replayAll(),
    onGrantCheatResources: async (amount) => {
      requireSessionReady();
      await spacetimeStore.grantCheatResources(amount);
      toastManager?.show(
        `Cheat mode active: ${amount.toLocaleString()} of every resource.`,
        { variant: 'info', durationMs: 4200 },
      );
    },
  });
  toolbar.setMapSize(worldSettings.mapSize);
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
  const { VillagerInspector } = await import('../ui/VillagerInspector.ts');
  villagerInspector = new VillagerInspector({
    domElement: sceneManager.renderer.domElement,
    uiRoot,
    camera: sceneManager.camera,
    villagers,
    deliveryAgents,
    getState: () => liveContext.gameState,
    selectionParent: sceneManager.selectionGroup,
    isBlocked: () => isWorldInspectionBlocked(placementGate),
    onDirectAgentClick: (kind) => ambientAudio.playAgentSelection(kind),
    onSelectionChange: (selected) => {
      if (selected) resourceInspector?.clearSelection();
    },
  });
  const inspectorSettlement = (settlementId?: string) =>
    settlementId ? liveContext.gameState.settlements.get(settlementId) : undefined;
  const legacyRealmPolicy = (settlementId?: string): boolean =>
    settlementId === 'settlement-0';
  resourceInspector = new ResourceInspector({
    domElement: sceneManager.renderer.domElement,
    uiRoot,
    sceneManager,
    terrainProjector: sceneManager.terrainProjector,
    worldQueries,
    getState: () => liveContext.gameState,
    getEconomicActivityTaxRate: (settlementId) =>
      inspectorSettlement(settlementId)?.economicActivityTaxRate
      ?? (legacyRealmPolicy(settlementId)
        ? spacetimeStore.snapshot.economicActivityTaxRate
        : ECONOMIC_ACTIVITY_TAX_RATE_DEFAULT),
    getPantrySafeguardPolicy: (settlementId) =>
      inspectorSettlement(settlementId)?.pantrySafeguardPolicy
      ?? (legacyRealmPolicy(settlementId)
        ? spacetimeStore.snapshot.pantrySafeguardPolicy
        : DEFAULT_PANTRY_SAFEGUARD_POLICY),
    getFiscalPolicy: (settlementId) => {
      const settlement = inspectorSettlement(settlementId);
      if (settlement) {
        return {
          ...DEFAULT_FISCAL_POLICY,
          landLevyRate: settlement.landLevyRate,
          importDutyRate: settlement.importDutyRate,
          exportDutyRate: settlement.exportDutyRate,
          landLevyAssessedTotal: settlement.landLevyAssessedTotal,
          landLevyCollectedTotal: settlement.landLevyCollectedTotal,
          importDutyCollectedTotal: settlement.importDutyCollectedTotal,
          exportDutyCollectedTotal: settlement.exportDutyCollectedTotal,
        };
      }
      return legacyRealmPolicy(settlementId)
        ? spacetimeStore.snapshot.fiscalPolicy
        : DEFAULT_FISCAL_POLICY;
    },
    getSeasonalLaborStewardEnabled: (settlementId) =>
      inspectorSettlement(settlementId)?.seasonalLaborStewardEnabled
      ?? (legacyRealmPolicy(settlementId)
        ? spacetimeStore.snapshot.seasonalLaborStewardEnabled
        : false),
    getConstructionLaborStewardEnabled: (settlementId) =>
      inspectorSettlement(settlementId)?.constructionLaborStewardEnabled
      ?? (legacyRealmPolicy(settlementId)
        ? spacetimeStore.snapshot.constructionLaborStewardEnabled
        : false),
    getProductionLaborStewardEnabled: (settlementId) =>
      inspectorSettlement(settlementId)?.productionLaborStewardEnabled
      ?? (legacyRealmPolicy(settlementId)
        ? spacetimeStore.snapshot.productionLaborStewardEnabled
        : false),
    getLaborStewardReserve: (settlementId) =>
      inspectorSettlement(settlementId)?.laborStewardReserve
      ?? (legacyRealmPolicy(settlementId)
        ? spacetimeStore.snapshot.laborStewardReserve
        : DEFAULT_LABOR_STEWARD_RESERVE),
    getParishPolicy: () =>
      spacetimeStore.snapshot.parishPolicy ?? DEFAULT_PARISH_POLICY,
    getMonasteryPolicy: () =>
      spacetimeStore.snapshot.monasteryPolicy ?? DEFAULT_MONASTERY_POLICY,
    getMarketState: () => spacetimeStore.snapshot.marketState,
    getSettlementSecurity: () => spacetimeStore.snapshot.settlementSecurity,
    getCombatAgents: () => bridge.getCombatAgentOverride?.()
      ?? spacetimeStore.snapshot.combatAgents.values(),
    getMilitaryCompanies: () => bridge.getMilitaryCompanyOverride?.()
      ?? spacetimeStore.snapshot.militaryCompanies.values(),
    getConflictEnabled: () =>
      spacetimeStore.snapshot.worldGeneration?.configured === true
      && spacetimeStore.snapshot.worldGeneration.conflictMode === 'frontier',
    getEnemyPressure: () => spacetimeStore.snapshot.worldGeneration?.enemyPressure ?? 0,
    getWorldHydrology: () => spacetimeStore.snapshot.worldGeneration?.hydrology ?? 50,
    getSevereWeatherEnabled: () =>
      spacetimeStore.snapshot.worldGeneration?.severeWeatherEnabled ?? false,
    getWellAquiferNetworksEnabled: () =>
      spacetimeStore.snapshot.worldGeneration?.wellAquiferNetworksEnabled
      ?? getDraftWorldGeneration().wellAquiferNetworksEnabled,
    getWorldResourceAbundance: () =>
      spacetimeStore.snapshot.worldGeneration?.resourceAbundance ?? 50,
    ...inspectorActions,
    getPendingTreeWorkAreaBuildingId: () => forestryWorkAreaTool.getBuildingId(),
    onBeginTreeWorkAreaPlacement: beginTreeWorkAreaPlacement,
    onClearTreeWorkArea: (buildingId) => clearTreeWorkArea(buildingId),
    onBeginFarmFieldPlacement: (farmsteadId, crops, autoManage) => {
      farmFieldTool.setCropPlan(crops, autoManage);
      beginLinkedLandParcelPlacement('field', farmsteadId);
    },
    onBeginPasturePlacement: (farmsteadId) => beginLinkedLandParcelPlacement('pasture', farmsteadId),
    onBeginGraveyardPlacement: (chapelId) => beginLinkedLandParcelPlacement('graveyard', chapelId),
    onBeginVineyardPlacement: (monasteryId) => beginLinkedLandParcelPlacement('vineyard', monasteryId),
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
    onServiceCoverageChange: (
      residenceIds,
      kind,
      marketplaceFulfillment,
      serviceBuildingId,
    ) => {
      residenceMarkers.setServiceCoverageHighlights(
        residenceIds,
        kind,
        marketplaceFulfillment,
      );
      buildingMarkers.setMarketplaceServiceCoverage(
        kind === 'marketplace' ? serviceBuildingId : null,
        residenceIds,
        liveContext.gameState,
      );
    },
    onTargetSelected: (target) => {
      if (
        target.kind === 'building'
        && target.building.constructionComplete !== false
      ) {
        const building = target.building;
        if (building.kind === 'chapel') {
          ambientAudio.playChapelSelection(
            building.chapelTier ?? 3,
            `building:${building.id}`,
          );
        } else if (building.kind !== 'wayside_shrine') {
          ambientAudio.playBuildingSelection(
            building.kind,
            `building:${building.id}`,
          );
        }
      } else if (
        target.kind === 'residence'
        && target.residence.tier > 0
        && !target.residence.abandoned
        && target.residence.population > 0
      ) {
        ambientAudio.playBuildingSelection(
          'residence',
          `residence:${target.residence.id}`,
        );
      }
    },
    onSelectionChange: (target) => {
      if (target) villagerInspector.clearSelection();
      if (target) worldMapUi.townReport.close();
      toolbar.setCityAdministrationOpen(target?.kind === 'building' && target.building.kind === 'town_hall');
      if (target?.kind === 'building') {
        tutorialOverlay.notifyBuildingSelected(target.building.kind);
        buildingMarkers.setBuildingSelectionOverlays(target.building, liveContext.gameState);
        return;
      }
      buildingMarkers.setBuildingSelectionOverlays(null);
    },
    isBlocked: () => isWorldInspectionBlocked(placementGate),
  });
  resourceInspector.setHud(
    computeResourceTotals(gameState),
    computeStoredResourceTotals(gameState),
    computePopulationStats(gameState),
    gameState.physicalFoundingSiteEnabled === true,
    computeInTransitResourceTotals(gameState.deliveryTrips.values()),
    computeGoldAwaitingCollection(gameState.buildings.values()),
    computeGuardhousePayrollGold(gameState.buildings.values()),
  );
  const militiaCommands = new MilitiaCommandController({
    domElement: sceneManager.renderer.domElement,
    uiRoot,
    camera: sceneManager.camera,
    terrainProjector: sceneManager.terrainProjector,
    parent: sceneManager.selectionGroup,
    getHeightAt: (x, z) => sceneManager.terrain.getHeightAt(x, z),
    getZoomPercent: () => cameraController.getZoomPercent(),
    isBlocked: () => isWorldInspectionBlocked(placementGate),
    onCommand: (ids, x, z, campId) => {
      void spacetimeStore.commandMilitia(ids, x, z, campId).catch((error) => {
        toastManager?.show(
          error instanceof Error ? error.message : 'Could not issue military company order.',
          { variant: 'error' },
        );
      });
    },
    onCompanySelected: (companyId) => {
      if (!companyId) {
        resourceInspector.clearSelection();
        return;
      }
      villagerInspector.clearSelection();
      worldMapUi.townReport.close();
      resourceInspector.selectMilitaryCompany(companyId);
    },
  });
  const vineyardParcelMarkers = new VineyardParcelMarkers(
    sceneManager.selectionGroup,
    (x, z) => sceneManager.terrain.getHeightAt(x, z),
  );
  const burialMarkers = new BurialMarkers(sceneManager.selectionGroup);
  let lastLocatedResource: HudResourceKind | null = null;
  let locatedResourceIndex = 0;
  toolbar.settlementHud.setAnimalBuildingHandler((buildingId) => {
    if (isWorldInspectionBlocked(placementGate)) {
      toastManager.show(
        sessionGate.isReady()
          ? 'Finish or cancel the active tool before inspecting the animal roster.'
          : 'Connect to the settlement before inspecting the animal roster.',
        { variant: 'info', durationMs: 3200 },
      );
      return;
    }
    const building = liveContext.gameState.buildings.get(buildingId);
    if (!building) {
      toastManager.show(
        'That animal-roster building is no longer present.',
        { variant: 'info', durationMs: 3200 },
      );
      return;
    }
    villagerInspector.clearSelection();
    resourceInspector.selectBuilding(building.id);
    resourceInspector.focusPanel();
    cameraController.focusWorldPositionAtZoom(building.x, building.z, 25);
  });
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
  toolbar.settlementHud.setLordReportTargetHandler((target) => {
    if (isWorldInspectionBlocked(placementGate)) {
      toastManager.show(
        sessionGate.isReady()
          ? 'Finish or cancel the active tool before opening a reported location.'
          : 'Connect to the settlement before opening a reported location.',
        { variant: 'info', durationMs: 3200 },
      );
      return;
    }

    const state = liveContext.gameState;
    let focusX = target.x;
    let focusZ = target.z;
    let targetPresent = false;
    if (target.kind === 'building') {
      const building = state.buildings.get(target.id);
      if (building) {
        villagerInspector.clearSelection();
        resourceInspector.selectBuilding(target.id);
        focusX = building.x;
        focusZ = building.z;
        targetPresent = true;
      }
    } else if (target.kind === 'residence') {
      const residence = state.residences.get(target.id);
      if (residence) {
        villagerInspector.clearSelection();
        resourceInspector.selectResidence(target.id);
        focusX = residence.x;
        focusZ = residence.z;
        targetPresent = true;
      }
    } else {
      resourceInspector.clearSelection();
      villagerInspector.clearSelection();
      targetPresent = true;
    }

    if (!targetPresent) {
      resourceInspector.clearSelection();
      villagerInspector.clearSelection();
      toastManager.show(
        'That holding is no longer present. Showing its last reported location.',
        { variant: 'info', durationMs: 3600 },
      );
    }
    cameraController.focusWorldPositionAtZoom(
      focusX,
      focusZ,
      REPORT_FOCUS_ZOOM_PERCENT,
    );
  });
  toolbar.settlementHud.setSecurityAttentionHandler((target, index, count) => {
    if (isWorldInspectionBlocked(placementGate)) {
      toastManager.show(
        sessionGate.isReady()
          ? 'Finish or cancel the active tool before inspecting a threatened holding.'
          : 'Connect to the settlement before inspecting a threatened holding.',
        { variant: 'info', durationMs: 3200 },
      );
      return;
    }

    const state = liveContext.gameState;
    let focusX = target.x;
    let focusZ = target.z;
    let targetPresent = false;
    if (target.kind === 'cart') {
      const trip = state.deliveryTrips.get(target.id);
      if (trip) {
        resourceInspector.clearSelection();
        villagerInspector.clearSelection();
        villagerInspector.selectDeliveryTrip(target.id);
        focusX = trip.x;
        focusZ = trip.z;
        targetPresent = true;
      }
    } else if (target.kind === 'building') {
      const building = state.buildings.get(target.id);
      if (building) {
        villagerInspector.clearSelection();
        resourceInspector.selectBuilding(target.id);
        focusX = building.x;
        focusZ = building.z;
        targetPresent = true;
      }
    } else if (target.kind === 'residence') {
      const residence = state.residences.get(target.id);
      if (residence) {
        villagerInspector.clearSelection();
        resourceInspector.selectResidence(target.id);
        // A rallied household is attacked at its refuge, not its empty home.
        // Retain the projection coordinates in that case.
        if (!target.sheltered) {
          focusX = residence.x;
          focusZ = residence.z;
        }
        targetPresent = true;
      }
    } else {
      // Compatibility worlds anchor their positionless legacy treasury to a
      // real holding. Physical-economy worlds never generate this target.
      const building = state.buildings.get(target.id);
      const residence = state.residences.get(target.id);
      if (building) {
        villagerInspector.clearSelection();
        resourceInspector.selectBuilding(target.id);
        focusX = building.x;
        focusZ = building.z;
        targetPresent = true;
      } else if (residence) {
        villagerInspector.clearSelection();
        resourceInspector.selectResidence(target.id);
        focusX = residence.x;
        focusZ = residence.z;
        targetPresent = true;
      }
    }

    if (!targetPresent) {
      toastManager.show(
        'That projected raid target has moved or is no longer present. The next watch report will refresh the forecast.',
        { variant: 'info', durationMs: 3600 },
      );
      return;
    }

    cameraController.focusWorldPosition(focusX, focusZ);
    const loss = target.estimatedLossFraction === null
      ? ''
      : ` · up to ${Math.round(target.estimatedLossFraction * 100)}% projected loss`;
    toastManager.show(
      `Threatened holding ${index + 1}/${count}: ${target.label}`
        + ` · ${target.protected ? 'watched' : 'exposed'}`
        + `${target.sheltered ? ' · rallied behind palisade' : ''}`
        + `${loss} · ${target.portableSummary}`,
      { variant: 'info', durationMs: 4600 },
    );
  });

  firstPersonController = new FirstPersonController({
    camera: sceneManager.camera,
    domElement: sceneManager.renderer.domElement,
    bounds: sceneManager.terrain.bounds,
    getHeightAt: (x, z) => sceneManager.terrain.getHeightAt(x, z),
    getRoadDeckY: (x, z) => sceneManager.sampleRoadDeckY(x, z),
    getFootstepSurface: (x, y, z) => {
      const terrainY = sceneManager.terrain.getHeightAt(x, z);
      const roadDeckY = sceneManager.sampleRoadDeckY(x, z);
      const waterY = sceneManager.getBridgeSamplingContext().getWaterSurfaceY(x, z);
      if (
        sceneManager.riverField.isRenderedWetAt(x, z)
        && y <= waterY + 0.32
      ) {
        return 'water';
      }
      if (roadDeckY != null && roadDeckY > terrainY + 0.12) return 'timber';
      if (y > Math.max(terrainY, roadDeckY ?? terrainY) + 0.18) return 'stone';
      if (isOnRoadSurface(x, z, roadNetwork)) return 'dirt';
      if (
        (sceneManager.getForestManager()?.sampleAudioCanopyCover(x, z) ?? 0)
          >= 0.34
      ) {
        return 'forest';
      }
      return 'grass';
    },
    onFootstep: (event) => ambientAudio.playFootstep(event),
    collisionWorld: firstPersonCollisionWorld,
    placementParent: sceneManager.scene,
    pickPlacementGround: (clientX, clientY) => (
      sceneManager.terrainProjector.pick(clientX, clientY)
    ),
    getOrbitSpawn: () => {
      const target = cameraController.getTargetPosition();
      return { x: target.x, z: target.z, yaw: cameraController.getYaw() };
    },
    isMenuOpen: () => toolbar.isGameMenuOpen(),
    isSessionReady: () => sessionGate.isReady(),
    onPlacementChange: (active) => {
      toolbar.setFirstPersonPlacementMode(active);
      if (active) {
        if (roadTool.isEnabled()) roadTool.setEnabled(false);
        if (buildingTool.isEnabled()) buildingTool.setMode('off');
        if (burgageTool.isEnabled()) burgageTool.setEnabled(false);
        if (farmFieldTool.isEnabled()) farmFieldTool.setEnabled(false);
        if (forestryWorkAreaTool.isEnabled()) forestryWorkAreaTool.setEnabled(false);
      }
    },
    onModeChange: (active) => {
      if (active && cameraController.isIllustratedMapActive()) {
        cameraController.applyRtsOrbitView();
      }
      if (active && spacetimeStore.snapshot.gameSpeed !== 1) {
        requestGameSpeed(1);
      }
      cameraController.setInputEnabled(
        !active
        && !toolbar.isGameMenuOpen()
        && !tutorialOverlay.isGameplayBlocking(),
      );
      toolbar.setFirstPersonMode(active);
      if (active) {
        if (roadTool.isEnabled()) roadTool.setEnabled(false);
        if (buildingTool.isEnabled()) buildingTool.setMode('off');
        if (burgageTool.isEnabled()) burgageTool.setEnabled(false);
        if (farmFieldTool.isEnabled()) farmFieldTool.setEnabled(false);
        if (forestryWorkAreaTool.isEnabled()) forestryWorkAreaTool.setEnabled(false);
        return;
      }
      const pos = firstPersonController.getPosition();
      cameraController.syncFromFirstPerson(pos.x, pos.z, firstPersonController.getBodyYaw());
    },
  });
  toolbar.setFirstPersonToggle(() => {
    if (!sessionGate.isReady()) {
      toastManager?.show('Wait for the world to connect before entering first-person view.', {
        variant: 'info',
        durationMs: 3200,
      });
      return;
    }
    firstPersonController.toggle();
  });

  placementGate.isRoadToolEnabled = () => roadTool.isEnabled();
  placementGate.isBuildingToolEnabled = () => buildingTool.isEnabled();
  placementGate.isStarterCampPlacementActive = () => (
    buildingTool.getMode() === 'founders_camp'
  );
  placementGate.isBurgageToolEnabled = () => burgageTool.isEnabled();
  placementGate.isFarmFieldToolEnabled = () => farmFieldTool.isEnabled();
  placementGate.isForestryWorkAreaToolEnabled = () => forestryWorkAreaTool.isEnabled();
  placementGate.isFirstPersonActive = () => firstPersonController.isInteractionActive();
  placementGate.isMenuOpen = () => toolbar.isGameMenuOpen();

  const worldMapUi = createWorldMapUi({
    uiRoot,
    domElement: sceneManager.renderer.domElement,
    terrain: sceneManager.terrain,
    riverField: sceneManager.riverField,
    treePlacements: sceneManager.whenForestTreePlacementsReady(),
    worldSeed: sceneManager.worldLayout.seed,
    registry: layoutRegistry,
    clayDepositSites: sceneManager.worldLayout.clayDepositLayout.sites,
    getCamera: () => sceneManager.camera,
    getZoomPercent: () => cameraController.getZoomPercent(),
    isIllustratedMapActive: () => cameraController.isIllustratedMapActive(),
    getIllustratedMapElevation: () => cameraController.getTargetPosition().y,
    getGameState: () => liveContext.gameState,
    getRoadNetwork: () => roadNetwork,
    getFocus: () => resolveWorldMapFocus(cameraController, firstPersonController),
    placementGate,
    onTerrainImageReady: ({ canvas, stampCanvas, bounds }) => {
      sceneManager.setIllustratedMapImage(canvas, stampCanvas, bounds);
    },
    onTerrainImageUpdated: () => sceneManager.invalidateIllustratedMapImage(),
    onQuarrySelect: (quarryId) => resourceInspector.selectQuarry(quarryId),
    onForagingSelect: (nodeId) => resourceInspector.selectForaging(nodeId),
    onClaySelect: (nodeId) => resourceInspector.selectQuarry(nodeId),
    onSettlementSelect: (settlementId) => {
      resourceInspector.clearSelection();
      villagerInspector.clearSelection();
      buildingMarkers.setBuildingSelectionOverlays(null);
      const settlement = liveContext.gameState.settlements.get(settlementId);
      if (settlement && !firstPersonController.isActive()) {
        cameraController.focusWorldPositionAtZoom(
          settlement.anchorX,
          settlement.anchorZ,
          REPORT_FOCUS_ZOOM_PERCENT,
        );
      }
    },
    onSettlementFocus: (x, z) => {
      if (!firstPersonController.isActive()) {
        cameraController.focusWorldPositionAtZoom(x, z, REPORT_FOCUS_ZOOM_PERCENT);
      }
    },
    onTownHallSelect: (buildingId) => {
      worldMapUi.townReport.close();
      villagerInspector.clearSelection();
      resourceInspector.selectBuilding(buildingId);
    },
    onSettlementRename: async (settlementId, name) => {
      try {
        await renameSettlement(settlementId, name);
        toastManager.show(`Town renamed to ${name}.`, { variant: 'success', durationMs: 2600 });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Could not rename this town.';
        toastManager.show(message, { variant: 'error' });
      }
    },
  });
  worldMapUi.minimap.syncBuildings(buildBuildingWorldMapMarkers(liveContext.gameState.buildings.values()));

  toolbar.setMapOverlaySelection(getMapOverlaySelection());
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
    forestryWorkAreaTool,
    buildingMarkers,
    deliveryAgents,
    fireEffects,
    banditCamps,
    militiaCommands,
    villagers,
    residenceMarkers,
    backyardGardenMarkers,
    burgageFencing,
    farmFieldMarkers,
    pastureMarkers,
    vineyardParcelMarkers,
    burialMarkers,
    livestockVisuals,
    toolbar,
    toastManager,
    tutorialOverlay,
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
