import type { AmbientAudioController } from '../audio/AmbientAudioController.ts';
import { CameraController } from '../camera/CameraController.ts';
import { FirstPersonController } from '../camera/FirstPersonController.ts';
import { BuildingMarkers } from '../buildings/BuildingMarkers.ts';
import { BuildingTool } from '../buildings/BuildingTool.ts';
import { initializeBuildingMaterialLibrary } from '../buildings/buildingMaterials.ts';
import { initializeVineyardVineResources } from '../vegetation/seedthree/vineyardVines.ts';
import type { FarmFieldMarkers } from '../farming/FarmFieldMarkers.ts';
import { FarmFieldTool } from '../farming/FarmFieldTool.ts';
import type { PastureMarkers } from '../farming/PastureMarkers.ts';
import type { LivestockVisuals } from '../farming/LivestockVisuals.ts';
import { BurgageTool, type BurgageLayoutHudState } from '../residences/BurgageTool.ts';
import type { ResidenceMarkers } from '../residences/ResidenceMarkers.ts';
import type { BurialMarkers } from '../residences/BurialMarkers.ts';
import type { BackyardGardenMarkers } from '../residences/BackyardGardenMarkers.ts';
import type { BurgageFencing } from '../residences/BurgageFencing.ts';
import { SpacetimeGameStore } from '../data/spacetimeGameStore.ts';
import { InputManager } from '../input/InputManager.ts';
import type { SpacetimeGameSnapshot } from '../data/spacetimeGameStore.ts';
import type { BuildingState, GameState } from '../resources/types.ts';
import { ForestVisualSync } from '../resources/ForestVisualSync.ts';
import type { ResourceInspector } from '../resources/ResourceInspector.ts';
import {
  computeInTransitResourceTotals,
  computeGoldAwaitingCollection,
  computeGuardhousePayrollGold,
  computePopulationStats,
  computeResourceTotals,
  computeStoredResourceTotals,
} from '../resources/resourceTotals.ts';
import { computeSettlementProvisioning } from '../economy/settlementProvisioning.ts';
import { computeSettlementApproval } from '../economy/settlementApproval.ts';
import { computeSettlementGeologyPlan } from '../economy/settlementGeology.ts';
import { TreeRegistry } from '../resources/TreeRegistry.ts';
import { WorldLayoutRegistry } from '../resources/WorldLayoutRegistry.ts';
import {
  createPhysicalDepositFootprints,
  isPhysicalDepositAt,
} from '../resources/physicalDepositProtection.ts';
import { RoadNetwork } from '../roads/RoadNetwork.ts';
import { RoadSelection } from '../roads/RoadSelection.ts';
import { RoadTool } from '../roads/RoadTool.ts';
import { GameRuntime } from '../runtime/GameRuntime.ts';
import { SceneManager } from '../scene/SceneManager.ts';
import type { WorldMapUiBundle } from './worldMapIcons.ts';
import { buildBuildingWorldMapMarkers } from '../map/worldMapMarkers.ts';
import type { DeliveryAgentRenderer } from '../logistics/DeliveryAgentRenderer.ts';
import type { FireEffectsRenderer } from '../fires/FireEffectsRenderer.ts';
import type { VillagerRenderer } from '../settlement/VillagerRenderer.ts';
import { raidWithdrawingCartCount } from '../logistics/deliveryTrips.ts';
import { BuildToolbar, type ToolbarStats } from '../ui/BuildToolbar.ts';
import { ToastManager } from '../ui/ToastManager.ts';
import type { VillagerInspector } from '../ui/VillagerInspector.ts';
import {
  SettlementPresentationController,
  type SettlementPresentationTargets,
} from './settlementSchedulePresentation.ts';
import {
  applyVisualQaEnvironment,
  parseVisualQaConditions,
  standaloneVisualQaEnvironment,
} from './visualQaConditions.ts';
import {
  createVisualQaFoundersCampFixture,
  withVisualQaFoundersCamp,
  withVisualQaFoundersCampState,
} from './visualQaFoundersCampFixture.ts';
import { SpacetimeSnapshotApplier, type SpacetimeSnapshotApplierDeps } from './spacetimeSnapshotApplier.ts';
import { bootstrapAppSession, type BootstrappedSession, type SessionLiveContext } from './appBootstrap.ts';
import { WorldGenerationMismatchError } from '../world/worldConfigAuthority.ts';
import { gameClock } from '../world/gameCalendar.ts';
import { worldAnimationDelta } from '../world/gameSpeed.ts';
import {
  environmentFor,
  nextDayEnvironmentOutlook,
} from '../world/seasonPolicy.ts';
import {
  precipitationPreviewEnvironment,
  standalonePrecipitationPreview,
} from '../weather/precipitationPolicy.ts';
import { SessionConnectionGate } from '../network/SessionConnectionGate.ts';
import { SessionConnectionOverlay } from '../ui/SessionConnectionOverlay.ts';
import {
  disposeSettlementWorld,
  syncSettlementWorld,
  tickSettlementWorld,
} from './settlementWorldSync.ts';
import { buildCrowdViewState, type CrowdViewState } from '../settlement/crowdView.ts';
import { syncPlacedBuildingTerrain } from './placedBuildingTerrainSync.ts';
import { SessionLifecycleController } from './SessionLifecycleController.ts';
import { beginNewWorld } from './worldBootstrapFlow.ts';
import { clearAuthoritativeWorldGeneration } from '../world/worldGenerationContext.ts';
import {
  computeGuardhouseMusterPlan,
  computeRefugeShelterPlan,
  FRONTIER_SECURITY_UPDATE_INTERVAL_TICKS,
  frontierDefenseFireSignature,
  formatIncomingRaidWarning,
  formatProjectedRaidTargets,
  formatRaidReport,
  projectRaidTargets,
  type ProjectedRaidTarget,
} from '../security/frontierSecurity.ts';
import { FrontierRiskMarkers } from '../security/FrontierRiskMarkers.ts';
import {
  formatLiveCombatSummary,
  hasActiveRaiderThreat,
  type CombatAgentState,
} from '../security/combatAgents.ts';
import { settlementHasStaffedChapel } from '../logistics/landmarkAccess.ts';
import { createSmokeTestHooks, installSmokeTestHooks } from '../e2e/smokeTestHooks.ts';
import { sampleNaturalTerrainHeight } from '../terrain/TerrainHeight.ts';
import { resolveWorldDimensions } from '../world/worldGenerationSettings.ts';
import {
  markFirstPlayable,
  markFirstPlayableAssetsReady,
  markVegetationReady,
} from './startupDiagnostics.ts';
import { formatDawnReport } from '../economy/nightPolicy.ts';
import { Vector3 } from 'three';

export type AppFrameProfilePhase = 'strategic' | 'settlement' | 'road-eye';

export type AppFrameProfiler = {
  beginFrame(rafTimestampMs: number, callbackEntryTimestampMs: number): void;
  completeFrame(
    callbackCompletedAtMs: number,
    phase: AppFrameProfilePhase,
  ): void;
  dispose(): void;
};

function roundStartupDuration(durationMs: number): number {
  return Math.round(durationMs * 10) / 10;
}

export class App {
  private readonly root: HTMLElement;
  private liveContext: SessionLiveContext | null = null;
  private sceneManager: SceneManager | null = null;
  private cameraController: CameraController | null = null;
  private firstPersonController: FirstPersonController | null = null;
  private input: InputManager | null = null;
  private roadNetwork: RoadNetwork | null = null;
  private roadTool: RoadTool | null = null;
  private roadSelection: RoadSelection | null = null;
  private buildingTool: BuildingTool | null = null;
  private burgageTool: BurgageTool | null = null;
  private farmFieldTool: FarmFieldTool | null = null;
  private buildingMarkers: BuildingMarkers | null = null;
  private residenceMarkers: ResidenceMarkers | null = null;
  private backyardGardenMarkers: BackyardGardenMarkers | null = null;
  private burgageFencing: BurgageFencing | null = null;
  private farmFieldMarkers: FarmFieldMarkers | null = null;
  private pastureMarkers: PastureMarkers | null = null;
  private burialMarkers: BurialMarkers | null = null;
  private livestockVisuals: LivestockVisuals | null = null;
  private toolbar: BuildToolbar | null = null;
  private toastManager: ToastManager | null = null;
  private tutorialOverlay: BootstrappedSession['tutorialOverlay'] | null = null;
  private disposeTooltips: (() => void) | null = null;
  private resourceInspector: ResourceInspector | null = null;
  private villagerInspector: VillagerInspector | null = null;
  private worldMapUi: WorldMapUiBundle | null = null;
  private deliveryAgents: DeliveryAgentRenderer | null = null;
  private fireEffects: FireEffectsRenderer | null = null;
  private frontierRiskMarkers: FrontierRiskMarkers | null = null;
  private villagers: VillagerRenderer | null = null;
  private gameState: GameState | null = null;
  private layoutRegistry: WorldLayoutRegistry | null = null;
  private treeRegistry: TreeRegistry | null = null;
  private forestVisualSync: ForestVisualSync | null = null;
  private spacetimeStore: SpacetimeGameStore | null = null;
  private sessionGate: SessionConnectionGate | null = null;
  private connectionOverlay: SessionConnectionOverlay | null = null;
  private sessionLifecycle: SessionLifecycleController | null = null;
  private gameRuntime: GameRuntime | null = null;
  private snapshotApplierDeps: SpacetimeSnapshotApplierDeps | null = null;
  private readonly spacetimeSnapshotApplier = new SpacetimeSnapshotApplier();
  private animationId = 0;
  private lastTime = 0;
  private fpsSampleStart = 0;
  private fpsFrameCount = 0;
  private fpsAccumulatedSeconds = 0;
  private readonly crowdViewScratch = new Vector3();
  private readonly crowdViewState: CrowdViewState = buildCrowdViewState(0, 0, 240);
  private readonly minimapTickState = { keyHeld: false };
  private readonly burgageLayoutHudStateScratch: BurgageLayoutHudState = {
    plotCount: 0,
    residenceCount: null,
    maxPlotCount: 0,
    canDecrease: false,
    canIncrease: false,
    canRotateFrontage: false,
    frontageLabel: null,
    valid: false,
  };
  private readonly burgageLayoutHudPositionScratch = { clientX: 0, clientY: 0 };
  private settlementPresentationTargets: SettlementPresentationTargets | null = null;
  private ambientAudio: AmbientAudioController | null = null;
  private readonly visualQaConditions = import.meta.env.DEV
    ? parseVisualQaConditions(window.location.search)
    : null;
  private readonly settlementPresentation = new SettlementPresentationController(
    () => performance.now(),
    this.visualQaConditions,
  );
  private visualQaFoundersCampFixture: BuildingState | null = null;
  private showcaseViewApplied = false;
  private initialSettlementViewApplied = false;
  private lastSeenRaidTick: number | null = null;
  private lastSeenRaidWarningTick: number | null = null;
  private lastSeenActiveRaidId: string | null | undefined;
  private lastSeenNightReportDay: number | null = null;
  private raidProjectionSignature = '';
  private combatInspectorSignature = '';
  private projectedRaidTargets: ProjectedRaidTarget[] = [];
  private visualFrameProfiler: AppFrameProfiler | null = null;
  private disposed = false;

  constructor(root: HTMLElement) {
    this.root = root;
  }

  async start(): Promise<void> {
    const session = await bootstrapAppSession(this.root, {
      syncToolbar: () => this.syncToolbar(),
    });
    const weatherPreview = import.meta.env.DEV
      ? this.visualQaConditions
        ? standaloneVisualQaEnvironment(this.visualQaConditions)
        : standalonePrecipitationPreview(window.location.search)
      : null;

    if (isShowcaseMode()) {
      session.uiRoot.hidden = true;
    }
    if (this.visualQaConditions) {
      document.documentElement.dataset.visualQa = this.visualQaConditions.preset;
      console.info(
        `[Visual QA] ${this.visualQaConditions.label} `
        + `(${String(this.visualQaConditions.hour).padStart(2, '0')}:00)`,
      );
    }

    this.liveContext = session.liveContext;
    this.sceneManager = session.sceneManager;
    this.frontierRiskMarkers = new FrontierRiskMarkers({
      terrain: session.sceneManager.terrain,
      parent: session.sceneManager.selectionGroup,
    });
    if (weatherPreview) this.sceneManager.setEnvironment(weatherPreview);
    this.layoutRegistry = session.layoutRegistry;
    this.gameState = session.gameState;
    this.input = session.input;
    this.roadNetwork = session.roadNetwork;
    this.cameraController = session.cameraController;
    this.firstPersonController = session.firstPersonController;
    this.roadTool = session.roadTool;
    this.roadSelection = session.roadSelection;
    this.buildingTool = session.buildingTool;
    this.burgageTool = session.burgageTool;
    this.farmFieldTool = session.farmFieldTool;
    this.buildingMarkers = session.buildingMarkers;
    this.buildingMarkers.setEnvironment(weatherPreview);
    this.deliveryAgents = session.deliveryAgents;
    this.fireEffects = session.fireEffects;
    this.villagers = session.villagers;
    this.residenceMarkers = session.residenceMarkers;
    this.backyardGardenMarkers = session.backyardGardenMarkers;
    this.burgageFencing = session.burgageFencing;
    this.farmFieldMarkers = session.farmFieldMarkers;
    this.pastureMarkers = session.pastureMarkers;
    this.burialMarkers = session.burialMarkers;
    this.livestockVisuals = session.livestockVisuals;
    this.toolbar = session.toolbar;
    this.toastManager = session.toastManager;
    this.tutorialOverlay = session.tutorialOverlay;
    this.disposeTooltips = session.disposeTooltips;
    this.resourceInspector = session.resourceInspector;
    this.villagerInspector = session.villagerInspector;
    this.worldMapUi = session.worldMapUi;
    this.ambientAudio = session.ambientAudio;
    this.ambientAudio.syncEnvironment(weatherPreview);
    this.spacetimeStore = session.spacetimeStore;
    this.sessionGate = session.sessionGate;

    this.connectionOverlay = new SessionConnectionOverlay(session.uiRoot);
    this.gameRuntime = new GameRuntime(
      session.spacetimeStore,
      session.layoutRegistry,
      session.sceneManager.worldLayout,
      {
        getTerrainHeight: (x, z) => session.sceneManager.terrain.getHeightAt(x, z),
        getRoadSnapshot: () => this.roadNetwork?.snapshot() ?? session.roadNetwork.snapshot(),
        onSnapshot: (snapshot, state) => this.applySpacetimeSnapshot(snapshot, state),
        onRoadsHydrated: (roads) => {
          this.roadNetwork?.restore(roads);
          this.sceneManager?.syncRoadNetwork(this.roadNetwork!);
          this.roadSelection?.refresh();
          this.syncToolbar();
          if (this.gameState && this.villagers && this.roadNetwork) {
            this.villagers.sync({
              residences: this.gameState.residences.values(),
              buildings: this.gameState.buildings.values(),
              quarries: this.gameState.quarries.values(),
              foragingNodes: this.gameState.foragingNodes.values(),
              trees: this.gameState.trees,
              treeRegistry: this.treeRegistry,
              farmFields: this.gameState.farmFields.values(),
              pastures: this.gameState.pastures.values(),
              deliveryTrips: this.gameState.deliveryTrips.values(),
              fireIncidents: this.gameState.fireIncidents.values(),
              roadNetwork: this.roadNetwork,
              foragingMonth: gameClock(this.gameState.tick).month,
            });
          }
          this.resourceInspector?.refreshSelection();
        },
        onConnectError: (error) => {
          console.warn('SpacetimeDB unavailable — game simulation requires the server.', error);
          clearAuthoritativeWorldGeneration();
          this.sessionLifecycle?.onBootConnectionFailure();
        },
        onBootstrapFailed: (error) => {
          if (error instanceof WorldGenerationMismatchError) {
            this.sessionLifecycle?.onWorldGenerationMismatch(
              error.message,
              () => window.location.reload(),
            );
            return;
          }
          this.sessionLifecycle?.onBootstrapFailed(
            error,
            () => this.sessionLifecycle?.retryConnection(),
          );
        },
        onSessionReady: () => this.sessionLifecycle?.onReady(),
      },
    );
    this.sessionLifecycle = new SessionLifecycleController({
      sessionGate: session.sessionGate,
      loadingScreen: session.loadingScreen,
      connectionOverlay: this.connectionOverlay,
      spacetimeStore: session.spacetimeStore,
      toolbar: session.toolbar,
      roadTool: session.roadTool,
      buildingTool: session.buildingTool,
      burgageTool: session.burgageTool,
      farmFieldTool: session.farmFieldTool,
      firstPersonController: session.firstPersonController,
      recoverSession: () => this.gameRuntime?.recoverSession(),
      beginNewWorld: () => {
        void beginNewWorld(
          () => this.spacetimeStore?.isConnected === true
            && this.spacetimeStore?.snapshot.identityHex !== null,
        );
      },
    });

    if (!this.visualQaConditions) {
      session.spacetimeStore.setConnectErrorListener((error) => {
        console.warn('SpacetimeDB connection error:', error);
        if (!session.spacetimeStore.isConnected) {
          clearAuthoritativeWorldGeneration();
        }
        this.sessionLifecycle?.onBootConnectionFailure();
      });
    }

    this.snapshotApplierDeps = {
      sceneManager: this.sceneManager,
      buildingMarkers: this.buildingMarkers,
      terrainMinimap: this.worldMapUi?.minimap ?? null,
      burgageFencing: this.burgageFencing,
      forestVisualSync: this.forestVisualSync,
      settlementWorld: {
        residenceMarkers: this.residenceMarkers,
        farmFieldMarkers: this.farmFieldMarkers,
        pastureMarkers: this.pastureMarkers,
        burialMarkers: this.burialMarkers,
        livestockVisuals: this.livestockVisuals,
        backyardGardenMarkers: this.backyardGardenMarkers,
        deliveryAgents: this.deliveryAgents,
        fireEffects: this.fireEffects,
        villagers: this.villagers,
        getHeightAt: (x, z) => this.sceneManager?.terrain.getHeightAt(x, z) ?? 0,
        getRoadNetwork: () => this.roadNetwork,
        getTreeRegistry: () => this.treeRegistry,
      },
      onForestClearanceChanged: () => this.syncForestClearance(),
      onFirstPersonCollisionChanged: () => {
        this.firstPersonController?.invalidateCollisionWorld();
        this.villagers?.invalidateNavigation();
      },
    };
    this.settlementPresentationTargets = {
      settlementHud: this.toolbar?.settlementHud ?? null,
      sceneManager: this.sceneManager,
      buildingMarkers: this.buildingMarkers,
      residenceMarkers: this.residenceMarkers,
      villagers: this.villagers,
      ambientAudio: this.ambientAudio,
    };

    if (this.visualQaConditions) {
      // Deterministic capture pages are intentionally offline: marking the
      // local presentation ready prevents lifecycle retries without opening a
      // SpacetimeDB connection or changing the ordinary runtime path.
      this.sessionLifecycle.onReady();
    } else {
      this.gameRuntime.start();
    }

    this.exposeDevHandles();
    this.exposeE2eHandles(session);

    session.sceneManager.syncRoadNetwork(session.roadNetwork);
    this.syncToolbar();
    window.addEventListener('resize', this.onResize);
    this.onResize();
    session.cameraController.applyRtsOrbitView();
    this.syncVisualQaFoundersCampFixture();
    if (this.visualQaConditions && this.gameState) {
      const offlineSnapshot = {
        ...session.spacetimeStore.snapshot,
        connected: true,
      };
      this.settlementPresentation.sync(
        this.settlementPresentationTargets,
        offlineSnapshot,
        this.getVisualQaPresentationState(this.gameState),
        true,
      );
      this.syncResourceUi();
      this.applyInitialSettlementView(this.gameState);
    }
    session.cameraController.update(0);
    this.toolbar?.setZoomPercent(session.cameraController.getZoomPercent());
    this.lastTime = performance.now();
    this.fpsSampleStart = this.lastTime;
    if (!this.visualQaConditions) {
      session.loadingScreen?.setProgress({
        label: 'Connecting…',
        detail: 'Syncing world with SpacetimeDB',
        phase: 'connecting',
        fraction: 0.35,
      });
    }
    session.sceneManager.render(0, session.cameraController.getOrbitDistance());
    if (import.meta.env.VITE_E2E_TEST !== '1') {
      session.loadingScreen?.setProgress({
        label: 'Growing forest…',
        detail: 'Preparing the complete woodland canopy',
        phase: 'vegetation',
        fraction: 0.72,
      });
      try {
        await session.sceneManager.finishVegetation();
        if (this.disposed) return;
        if (this.roadNetwork) session.sceneManager.syncRoadNetwork(this.roadNetwork);
        this.onForestReady();
        markVegetationReady();
      } catch (error) {
        console.error('Vegetation build failed:', error);
        this.toastManager?.show('Forest vegetation failed to load. Try refreshing the page.', { variant: 'error' });
      }
    }
    const firstPlayableAssetStartedAt = performance.now();
    let celestialSkyHydrationMs = 0;
    let buildingMaterialHydrationMs = 0;
    let vineyardHydrationMs = 0;
    let villagerVisualHydrationMs = 0;
    let villagerVisualsReady = false;
    session.loadingScreen?.setProgress({
      label: 'Finishing world…',
      detail: 'Hydrating sky and material textures',
      phase: 'vegetation',
      fraction: 0.86,
    });
    const firstPlayableAssetResults = await Promise.allSettled([
      (async () => {
        const startedAt = performance.now();
        try {
          await session.sceneManager.loadCelestialSky();
        } finally {
          celestialSkyHydrationMs = performance.now() - startedAt;
        }
      })(),
      ...(import.meta.env.VITE_E2E_TEST !== '1'
        ? [
            (async () => {
              const startedAt = performance.now();
              try {
                await initializeBuildingMaterialLibrary(
                  session.sceneManager.textureAnisotropy,
                  (texture) => session.sceneManager.preloadTexture(texture),
                );
              } finally {
                buildingMaterialHydrationMs = performance.now() - startedAt;
              }
            })(),
            (async () => {
              const startedAt = performance.now();
              try {
                await initializeVineyardVineResources(
                  session.sceneManager.textureAnisotropy,
                  session.sceneManager.rendererBackend,
                  (texture) => session.sceneManager.preloadTexture(texture),
                );
              } finally {
                vineyardHydrationMs = performance.now() - startedAt;
              }
            })(),
            (async () => {
              const startedAt = performance.now();
              try {
                villagerVisualsReady = await session.villagers.visualAssetsReady;
              } finally {
                villagerVisualHydrationMs = performance.now() - startedAt;
              }
            })(),
          ]
        : []),
    ]);
    if (this.disposed) return;
    if (firstPlayableAssetResults[0]?.status === 'rejected') {
      console.warn(
        'Historical star catalogue is unavailable:',
        firstPlayableAssetResults[0].reason,
      );
    }
    if (firstPlayableAssetResults[1]?.status === 'rejected') {
      console.warn(
        'Detailed building textures are unavailable:',
        firstPlayableAssetResults[1].reason,
      );
    }
    if (firstPlayableAssetResults[2]?.status === 'rejected') {
      console.warn(
        'Detailed vineyard foliage is unavailable:',
        firstPlayableAssetResults[2].reason,
      );
    }
    if (
      firstPlayableAssetResults[3]?.status === 'rejected'
      || (import.meta.env.VITE_E2E_TEST !== '1' && !villagerVisualsReady)
    ) {
      console.warn(
        'Authored villager visuals are unavailable:',
        firstPlayableAssetResults[3]?.status === 'rejected'
          ? firstPlayableAssetResults[3].reason
          : 'source model or batch construction failed',
      );
    }
    session.loadingScreen?.setProgress({
      label: 'Finishing world…',
      detail: 'Uploading textures and compiling shaders',
      phase: 'vegetation',
      fraction: 0.94,
    });
    const gpuPrecompileStartedAt = performance.now();
    let gpuReady = true;
    const restoreVillagerPrewarm = session.villagers.beginFirstPlayableGpuPrewarm();
    const restoreFoundersCampPrewarm = session.buildingMarkers.beginFoundersCampGpuPrewarm();
    try {
      await session.sceneManager.precompileFirstPlayableScene();
      session.sceneManager.render(0, session.cameraController.getOrbitDistance());
      await session.sceneManager.waitForFirstPlayableGpuWork();
    } catch (error) {
      gpuReady = false;
      console.warn('First-playable GPU prewarm is unavailable:', error);
    } finally {
      restoreFoundersCampPrewarm();
      restoreVillagerPrewarm();
    }
    if (this.disposed) return;
    const gpuPrecompileMs = performance.now() - gpuPrecompileStartedAt;
    markFirstPlayableAssetsReady({
      celestialSkyHydrationMs: roundStartupDuration(celestialSkyHydrationMs),
      celestialGenerationMs: session.sceneManager.celestialGenerationMs,
      buildingMaterialHydrationMs: roundStartupDuration(buildingMaterialHydrationMs),
      vineyardHydrationMs: roundStartupDuration(vineyardHydrationMs),
      villagerVisualHydrationMs: roundStartupDuration(villagerVisualHydrationMs),
      gpuPrecompileMs: roundStartupDuration(gpuPrecompileMs),
      totalMs: roundStartupDuration(performance.now() - firstPlayableAssetStartedAt),
      celestialReady: firstPlayableAssetResults[0]?.status === 'fulfilled',
      buildingMaterialsReady: import.meta.env.VITE_E2E_TEST === '1'
        || firstPlayableAssetResults[1]?.status === 'fulfilled',
      vineyardReady: import.meta.env.VITE_E2E_TEST === '1'
        || firstPlayableAssetResults[2]?.status === 'fulfilled',
      villagerVisualsReady: import.meta.env.VITE_E2E_TEST === '1'
        || (
          firstPlayableAssetResults[3]?.status === 'fulfilled'
          && villagerVisualsReady
        ),
      gpuReady,
    });
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    session.loadingScreen?.setProgress({
      label: 'Entering world…',
      detail: 'Terrain and woodland ready',
      phase: 'vegetation',
      fraction: 1,
    });
    markFirstPlayable();
    this.sessionLifecycle?.onPresentationReady();
    this.tutorialOverlay?.notifyWorldReady(
      [...(this.gameState?.buildings.values() ?? [])]
        .some((building) => building.kind === 'founders_camp'),
    );
    if (import.meta.env.VITE_E2E_TEST !== '1') {
      this.animationId = requestAnimationFrame(this.tick);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.animationId);
    window.removeEventListener('resize', this.onResize);
    this.roadTool?.dispose();
    this.roadSelection?.dispose();
    this.buildingTool?.dispose();
    this.burgageTool?.dispose();
    this.farmFieldTool?.dispose();
    this.buildingMarkers?.dispose();
    this.frontierRiskMarkers?.dispose();
    this.villagerInspector?.dispose();
    disposeSettlementWorld({
      residenceMarkers: this.residenceMarkers,
      farmFieldMarkers: this.farmFieldMarkers,
      pastureMarkers: this.pastureMarkers,
      burialMarkers: this.burialMarkers,
      livestockVisuals: this.livestockVisuals,
      backyardGardenMarkers: this.backyardGardenMarkers,
      deliveryAgents: this.deliveryAgents,
      fireEffects: this.fireEffects,
      villagers: this.villagers,
      getHeightAt: () => 0,
      getRoadNetwork: () => null,
      getTreeRegistry: () => null,
    });
    this.burgageFencing?.dispose();
    this.gameRuntime?.dispose();
    this.sessionLifecycle?.dispose();
    this.connectionOverlay?.dispose();
    this.resourceInspector?.dispose();
    this.worldMapUi?.quarry.dispose();
    this.worldMapUi?.foraging.dispose();
    this.worldMapUi?.minimap.dispose();
    this.toastManager?.dispose();
    this.tutorialOverlay?.dispose();
    this.disposeTooltips?.();
    this.disposeTooltips = null;
    this.firstPersonController?.dispose();
    this.cameraController?.dispose();
    this.toolbar?.dispose();
    this.input?.dispose();
    this.ambientAudio?.dispose();
    this.visualFrameProfiler?.dispose();
    this.visualFrameProfiler = null;
    this.sceneManager?.dispose();
  }

  /** Installs the dynamically loaded, query-only frame attribution adapter. */
  setVisualFrameProfiler(profiler: AppFrameProfiler | null): void {
    if (this.visualFrameProfiler === profiler) return;
    this.visualFrameProfiler?.dispose();
    this.visualFrameProfiler = profiler;
  }

  private readonly tick = (time: number): void => {
    if (this.disposed) return;
    const frameProfiler = this.visualFrameProfiler;
    frameProfiler?.beginFrame(time, performance.now());
    const rawDt = (time - this.lastTime) / 1000;
    if (rawDt > 0.25) this.resetFpsSample(time);
    const dt = Math.min(0.05, Math.max(0.001, rawDt));
    this.lastTime = time;

    const firstPersonActive = this.firstPersonController?.isActive() ?? false;
    const worldDt = worldAnimationDelta(
      dt,
      this.spacetimeStore?.snapshot.gameSpeed ?? 1,
    );
    this.syncBuildInteractionPerf();
    this.frontierRiskMarkers?.tick(worldDt);
    if (this.settlementPresentationTargets) {
      this.settlementPresentation.tick(this.settlementPresentationTargets);
    }
    this.buildingMarkers?.tick(worldDt);
    this.minimapTickState.keyHeld = this.input?.isDown('g') ?? false;
    this.worldMapUi?.minimap.tick(this.minimapTickState);
    if (firstPersonActive) {
      this.firstPersonController?.update(dt);
      this.toolbar?.setFirstPersonMode(true);
      this.roadTool?.update(dt);
      this.buildingTool?.update();
      this.burgageTool?.update();
      this.farmFieldTool?.update();
      this.updateBuildButtonPosition();
      this.worldMapUi?.update();
      this.sceneManager?.render(
        worldDt,
        12,
        true,
        this.firstPersonController?.isCrouching() ?? false,
        this.firstPersonController?.isCameraNavigationActive() ?? false,
      );
    } else {
      this.cameraController?.update(dt);
      this.toolbar?.setFirstPersonMode(false);
      this.toolbar?.setZoomPercent(this.cameraController?.getZoomPercent() ?? 100);
      this.roadTool?.update(dt);
      this.buildingTool?.update();
      this.burgageTool?.update();
      this.farmFieldTool?.update();
      this.updateBuildButtonPosition();
      this.worldMapUi?.update();
      this.sceneManager?.render(
        worldDt,
        this.cameraController?.getOrbitDistance(),
        false,
        false,
        this.cameraController?.isNavigationActive() ?? false,
      );
    }
    this.updateFps(time, rawDt);
    const crowdView = this.buildCrowdViewState();
    if (this.snapshotApplierDeps) {
      tickSettlementWorld(
        this.snapshotApplierDeps.settlementWorld,
        worldDt,
        crowdView,
      );
    }
    this.villagerInspector?.tick();
    this.ambientAudio?.tick(dt);
    this.animationId = requestAnimationFrame(this.tick);
    if (frameProfiler) {
      const phase = firstPersonActive
        ? 'road-eye'
        : (this.cameraController?.getOrbitDistance() ?? 240) > 120
          ? 'strategic'
          : 'settlement';
      frameProfiler.completeFrame(performance.now(), phase);
    }
  };

  private onForestReady(): void {
    const forestManager = this.sceneManager?.getForestManager();
    if (!forestManager || !this.gameState || !this.liveContext) return;

    this.treeRegistry = TreeRegistry.fromForestManager(forestManager);
    this.liveContext.treeRegistry = this.treeRegistry;
    this.forestVisualSync = new ForestVisualSync(forestManager);
    // A newly created server world can finish the visual forest before its tree
    // table bootstrap reaches the client. An empty table is not a valid
    // "everything was harvested" state (harvested trees persist as stumps), so
    // preserve generated trees until the first authoritative rows arrive.
    if (this.gameState.trees.size > 0) {
      this.forestVisualSync.syncAll(this.gameState.trees);
    }
    if (this.snapshotApplierDeps) {
      this.snapshotApplierDeps.forestVisualSync = this.forestVisualSync;
    }
    const presentationState = this.getVisualQaPresentationState(this.gameState);
    this.buildingMarkers?.syncBuildings(
      presentationState.buildings.values(),
      presentationState.livestockHerds,
    );
    this.worldMapUi?.minimap.syncBuildings(
      buildBuildingWorldMapMarkers(presentationState.buildings.values()),
    );
    syncPlacedBuildingTerrain({
      sceneManager: this.sceneManager,
      gameState: presentationState,
      buildingMarkers: this.buildingMarkers,
      forceMeshUpdate: true,
    });
    // Terrain sync intentionally replays authoritative markers. Restore the
    // presentation-only fallback afterwards when visual QA has no server camp.
    this.syncVisualQaFoundersCampFixture();
    if (this.snapshotApplierDeps) {
      syncSettlementWorld(this.snapshotApplierDeps.settlementWorld, presentationState);
    }
    this.burgageFencing?.syncZones(
      this.gameState.burgageZones.values(),
      this.gameState.residences.values(),
      (x, z) => this.sceneManager?.terrain.getHeightAt(x, z) ?? 0,
    );
    this.syncForestClearance();
    this.buildingTool?.invalidatePreview();
    this.firstPersonController?.invalidateCollisionWorld();
    this.syncResourceUi();
    this.exposeDevHandles();
  }

  private readonly onResize = (): void => {
    this.sceneManager?.resize();
  };

  private syncToolbar(): void {
    if (!this.toolbar || !this.roadNetwork || !this.roadTool || !this.roadSelection || !this.buildingTool || !this.burgageTool || !this.farmFieldTool) return;
    const starterCampRequired = !this.visualQaConditions
      && this.gameState?.physicalFoundingSiteEnabled !== true
      && (this.gameState?.buildings.size ?? 0) === 0
      && (this.gameState?.residences.size ?? 0) === 0
      && (this.gameState?.burgageZones.size ?? 0) === 0;
    this.toolbar.setStarterCampRequired(starterCampRequired);
    const buildingMode = this.buildingTool.getMode();
    const placementEconomy = this.buildingTool.getPlacementEconomy();
    const burgageEnabled = this.burgageTool.isEnabled();
    const farmFieldEnabled = this.farmFieldTool.isEnabled();
    const fieldPlacementEnabled = farmFieldEnabled
      && this.farmFieldTool.getMode() === 'field';
    const farmCrop = fieldPlacementEnabled ? this.farmFieldTool.getCrop() : null;
    const stats: ToolbarStats = {
      canBuild: farmFieldEnabled ? this.farmFieldTool.isDraftBuildable() : burgageEnabled ? this.burgageTool.isDraftBuildable() : this.roadTool.isDraftBuildable(),
      hasDraft: farmFieldEnabled ? this.farmFieldTool.hasDraft() : burgageEnabled ? this.burgageTool.hasDraft() : this.roadTool.hasDraft(),
      mode: farmFieldEnabled
        ? this.farmFieldTool.getMode() === 'pasture'
          ? 'pastures'
          : this.farmFieldTool.getMode() === 'graveyard'
            ? 'burial-grounds'
            : 'farm-fields'
        : burgageEnabled
        ? 'residences'
        : this.roadTool.isEnabled()
          ? 'road'
          : buildingMode === 'off'
            ? 'idle'
            : buildingMode,
      statusDetail: farmFieldEnabled
        ? this.farmFieldTool.getStatusDetail()
        : burgageEnabled
          ? this.burgageTool.getStatusDetail()
          : this.buildingTool.getStatusDetail(),
      placementBlocked: buildingMode !== 'off'
        && this.buildingTool.isPlacementBlocked(),
      placementReady: buildingMode !== 'off'
        && this.buildingTool.isPlacementReady(),
      farmCrop: farmCrop ?? undefined,
      buildingCost: placementEconomy?.cost,
      carpenterSupported: placementEconomy?.carpenterSupported,
      carpenterCartServiceEnabled:
        placementEconomy?.carpenterCartServiceEnabled,
      carpenterCartServiceReady: placementEconomy?.carpenterCartServiceReady,
    };
    this.sceneManager?.setCropSuitabilityOverlayCrop(farmCrop);
    this.toolbar.setStats(stats);
    this.updateBuildButtonPosition();
  }

  private syncBuildInteractionPerf(): void {
    const roadDraft = Boolean(this.roadTool?.isEnabled() && this.roadTool.hasDraft());
    const burgageDraft = Boolean(this.burgageTool?.isEnabled() && this.burgageTool.hasDraft());
    const farmFieldDraft = Boolean(this.farmFieldTool?.isEnabled() && this.farmFieldTool.hasDraft());
    const buildingActive = Boolean(this.buildingTool?.isEnabled());
    this.sceneManager?.setBuildInteractionActive(roadDraft || burgageDraft || farmFieldDraft || buildingActive);
    this.sceneManager?.setRoadDraftActive(roadDraft);
  }

  private updateBuildButtonPosition(): void {
    const roadTool = this.roadTool;
    const burgageTool = this.burgageTool;
    const farmFieldTool = this.farmFieldTool;
    if (!this.toolbar || !roadTool || !burgageTool || !farmFieldTool) return;
    const farmFieldEnabled = farmFieldTool.isEnabled();
    const burgageEnabled = burgageTool.isEnabled();
    const layoutHudState = burgageEnabled
      ? burgageTool.getLayoutHudState(this.burgageLayoutHudStateScratch)
      : null;
    const layoutHudPosition = layoutHudState
      ? burgageTool.getLayoutHudPosition(this.burgageLayoutHudPositionScratch)
      : null;
    this.toolbar.setBurgageLayoutHud(layoutHudPosition, layoutHudState);

    const visible = farmFieldEnabled
      ? farmFieldTool.isDraftBuildable()
      : burgageEnabled
      ? burgageTool.isDraftBuildable()
      : roadTool.isDraftBuildable();
    if (!visible) {
      this.toolbar.setBuildButtonPosition(null, false);
      return;
    }
    const position = farmFieldEnabled
      ? farmFieldTool.getBuildButtonPosition()
      : burgageEnabled
      ? burgageTool.getBuildButtonPosition()
      : roadTool.getBuildButtonPosition();
    this.toolbar.setBuildButtonPosition(position, true);
  }

  private updateFps(time: number, rawDt: number): void {
    this.fpsFrameCount++;
    this.fpsAccumulatedSeconds += rawDt;
    const sampleMs = time - this.fpsSampleStart;
    if (sampleMs < 400) return;
    const fps = this.fpsFrameCount / Math.max(this.fpsAccumulatedSeconds, 0.001);
    this.toolbar?.setFps(fps);
    (window as typeof window & { __medievalRoadStats?: { backend?: string; fps: number; calls?: number; renderPasses?: number; triangles?: number; pixelRatio?: number } })
      .__medievalRoadStats = { fps, ...this.sceneManager?.getPerformanceStats() };
    this.resetFpsSample(time);
  }

  private resetFpsSample(time: number): void {
    this.fpsSampleStart = time;
    this.fpsFrameCount = 0;
    this.fpsAccumulatedSeconds = 0;
  }

  private applySpacetimeSnapshot(snapshot: SpacetimeGameSnapshot, state: GameState): void {
    if (!snapshot.connected) {
      clearAuthoritativeWorldGeneration();
      this.spacetimeSnapshotApplier.reset();
      this.settlementPresentation.reset();
      this.ambientAudio?.syncEnvironment(null);
      if (!this.visualQaConditions) this.buildingMarkers?.setEnvironment(null);
      this.toolbar?.setConflictEnabled(false);
      this.clearFrontierRiskFeedback();
      this.combatInspectorSignature = '';
      this.villagers?.setCombatAgents(new Map());
      this.toolbar?.settlementHud.setSecurityState(
        snapshot.settlementSecurity,
        null,
        snapshot.simTick,
      );
      this.toolbar?.settlementHud.clearProvisioningState();
      this.toolbar?.settlementHud.clearGeologyState();
      this.syncVisualQaFoundersCampFixture();
      this.syncToolbar();
      return;
    }

    const previous = this.gameState;
    this.gameState = state;
    const nextCombatInspectorSignature = combatInspectorSignature(
      snapshot.combatAgents.values(),
      snapshot.simTick,
    );
    const combatInspectorChanged =
      nextCombatInspectorSignature !== this.combatInspectorSignature;
    this.combatInspectorSignature = nextCombatInspectorSignature;
    this.villagers?.setCombatAgents(snapshot.combatAgents);
    const raidThreatActive = hasActiveRaiderThreat(snapshot.combatAgents.values());
    const withdrawingCarts = raidWithdrawingCartCount(
      snapshot.deliveryTrips.values(),
      raidThreatActive,
    );
    if (this.liveContext) {
      this.liveContext.gameState = state;
    }

    if (!this.snapshotApplierDeps) return;

    this.spacetimeSnapshotApplier.apply(
      this.snapshotApplierDeps,
      state,
      previous,
      snapshot.combatAgents.values(),
    );
    this.syncVisualQaFoundersCampFixture();
    this.notifyFireChanges(state, previous);
    this.notifySecurityChanges(snapshot);
    this.notifyNightReport(snapshot);
    const projectedTargets = this.syncFrontierRiskFeedback(
      snapshot,
      state,
      raidThreatActive,
    );
    const liveCombat = formatLiveCombatSummary(
      snapshot.combatAgents.values(),
      snapshot.simTick,
      snapshot.activeRaid?.routStarted ?? false,
    );
    const frontierDetail = [liveCombat, projectedTargets]
      .filter((detail): detail is string => Boolean(detail))
      .join(' ');
    this.frontierRiskMarkers?.trackDeliveryTrips(state.deliveryTrips);

    this.applyShowcaseView(state);
    this.applyInitialSettlementView(state);

    if (resourceUiNeedsSync(state, previous)) {
      this.syncResourceUi();
    } else if (combatInspectorChanged) {
      this.resourceInspector?.refreshSelection();
    }
    this.syncToolbar();
    const clock = gameClock(snapshot.simTick);
    const environment = environmentFor(
      state.seed,
      snapshot.worldGeneration?.hydrology ?? 50,
      clock,
    );
    const environmentOutlook = nextDayEnvironmentOutlook(
      state.seed,
      snapshot.worldGeneration?.hydrology ?? 50,
      clock,
    );
    const sabbathObserved = snapshot.parishPolicy.sabbathObservanceEnabled
      && settlementHasStaffedChapel(state);
    this.toolbar?.settlementHud.setGeologyState(
      computeSettlementGeologyPlan(
        state,
        sabbathObserved,
        {
          clayPitThroughputMultiplier: environment.clayPitThroughputMultiplier,
          resourceAbundance:
            snapshot.worldGeneration?.resourceAbundance ?? 50,
        },
      ),
    );
    const provisioning = computeSettlementProvisioning({
      state,
      totals: computeResourceTotals(state),
      currentFirewoodDemandMultiplier: environment.firewoodDemandMultiplier,
      freshFoodSpoilageFractionPerDay: environment.freshFoodSpoilageFractionPerDay,
      preservedFoodSpoilageFractionPerDay:
        environment.preservedFoodSpoilageFractionPerDay,
      currentPreservedFoodDemandMultiplier:
        environment.preservedFoodDemandMultiplier,
      sabbathObserved,
      roadComponentFor: (entity) =>
        this.roadNetwork!.getPathfinder().roadComponentAt(entity.x, entity.z),
    });
    this.toolbar?.settlementHud.setProvisioningState(provisioning, clock.month);
    const conflictEnabled = snapshot.worldGeneration?.conflictMode === 'frontier';
    let activeFires = 0;
    for (const incident of state.fireIncidents.values()) {
      if (incident.status === 'burning') activeFires += 1;
    }
    this.toolbar?.settlementHud.setApprovalState(computeSettlementApproval({
      provisioning,
      nightPolicy: snapshot.nightPolicy,
      security: snapshot.settlementSecurity,
      conflictEnabled,
      activeFires,
      month: clock.month,
    }));
    this.toolbar?.setConflictEnabled(conflictEnabled);
    const presentationEnvironment = import.meta.env.DEV
      ? this.visualQaConditions
        ? applyVisualQaEnvironment(environment, this.visualQaConditions)
        : precipitationPreviewEnvironment(environment, window.location.search)
      : environment;
    this.toolbar?.setSimulationState(
      snapshot.gameSpeed,
      presentationEnvironment,
      this.visualQaConditions ? undefined : environmentOutlook,
    );
    this.sceneManager?.setEnvironment(presentationEnvironment);
    this.buildingMarkers?.setEnvironment(presentationEnvironment);
    this.ambientAudio?.syncEnvironment(presentationEnvironment);
    this.toolbar?.settlementHud.setFireState(
      state.fireIncidents.values(),
      state.deliveryTrips.values(),
    );
    this.toolbar?.settlementHud.setSecurityState(
      snapshot.settlementSecurity,
      snapshot.worldGeneration,
      snapshot.simTick,
      frontierDetail || undefined,
      this.projectedRaidTargets,
      snapshot.activeRaid,
      raidThreatActive,
      withdrawingCarts,
    );
    if (this.settlementPresentationTargets) {
      this.settlementPresentation.sync(
        this.settlementPresentationTargets,
        snapshot,
        state,
        this.spacetimeStore?.isConnected ?? false,
      );
    }
  }

  private syncForestClearance(): void {
    if (!this.gameState || !this.snapshotApplierDeps) return;
    this.spacetimeSnapshotApplier.syncForestClearance(this.snapshotApplierDeps, this.gameState);
  }

  private notifyFireChanges(state: GameState, previous: GameState | null): void {
    const newlyReportedFire = [...state.fireIncidents.values()].some((incident) => (
      incident.status === 'burning'
      && (!previous || !previous.fireIncidents.has(incident.id))
    ));
    if (newlyReportedFire) this.tutorialOverlay?.notifyFireStarted();
    if (!previous) return;
    for (const incident of state.fireIncidents.values()) {
      const prior = previous.fireIncidents.get(incident.id);
      if (!prior && incident.status === 'burning') {
        this.toastManager?.show(
          'Structure fire reported. A completed well can respond when it has water and an unassigned hauler is available.',
          { variant: 'error', durationMs: 7000 },
        );
        continue;
      }
      if (!prior && incident.status === 'destroyed') {
        this.toastManager?.show(
          'A structure fire went undiscovered until the building was lost. Recoverable remnants, if any, were left beside the ruin.',
          { variant: 'error', durationMs: 7000 },
        );
        continue;
      }
      if (!prior || prior.status === incident.status) continue;
      if (incident.status === 'extinguished') {
        this.toastManager?.show(
          `Fire extinguished after ${incident.waterDelivered.toFixed(1)} water. Damage: ${Math.round(incident.damage * 100)}%.`,
          { variant: 'info', durationMs: 5200 },
        );
      } else if (incident.status === 'destroyed') {
        this.toastManager?.show(
          'A structure has been destroyed by fire. Most stores were lost; free haulers can recover any durable remnants from a nearby salvage pile.',
          { variant: 'error', durationMs: 7000 },
        );
      }
    }
  }

  private notifySecurityChanges(snapshot: SpacetimeGameSnapshot): void {
    const activeRaidId = snapshot.activeRaid?.raidId ?? null;
    if (this.lastSeenActiveRaidId === undefined) {
      this.lastSeenActiveRaidId = activeRaidId;
    } else if (activeRaidId !== null && activeRaidId !== this.lastSeenActiveRaidId) {
      const approach = snapshot.settlementSecurity.raidApproach === 'unknown'
        ? 'an unreported side'
        : `the ${snapshot.settlementSecurity.raidApproach}`;
      this.toastManager?.show(
        `Raiders have crossed the frontier from ${approach}. Civilian work and new ordinary-cart departures are halted.`,
        { variant: 'error', durationMs: 9_000 },
      );
      this.lastSeenActiveRaidId = activeRaidId;
    } else {
      this.lastSeenActiveRaidId = activeRaidId;
    }

    const warningTick = snapshot.settlementSecurity.warningStartedTick;
    if (
      this.lastSeenRaidWarningTick === null
      || warningTick < this.lastSeenRaidWarningTick
    ) {
      this.lastSeenRaidWarningTick = warningTick;
    } else if (
      warningTick > 0
      && warningTick !== this.lastSeenRaidWarningTick
    ) {
      this.lastSeenRaidWarningTick = warningTick;
      if (activeRaidId === null && snapshot.worldGeneration) {
        const clock = gameClock(snapshot.simTick);
        this.toastManager?.show(
          formatIncomingRaidWarning(
            snapshot.settlementSecurity,
            snapshot.worldGeneration.enemyPressure,
            snapshot.simTick,
            clock.month,
          ),
          { variant: 'error', durationMs: 9_000 },
        );
      }
    }

    const raidTick = snapshot.settlementSecurity.lastRaidTick;
    if (this.lastSeenRaidTick === null || raidTick < this.lastSeenRaidTick) {
      this.lastSeenRaidTick = raidTick;
      return;
    }
    if (raidTick <= 0 || raidTick === this.lastSeenRaidTick) return;
    this.lastSeenRaidTick = raidTick;
    this.toastManager?.show(formatRaidReport(snapshot.settlementSecurity), {
      variant: snapshot.settlementSecurity.lastOutcome === 'plundered'
        || snapshot.settlementSecurity.lastOutcome === 'arson'
        ? 'error'
        : 'info',
      durationMs: 8_000,
    });
  }

  private syncFrontierRiskFeedback(
    snapshot: SpacetimeGameSnapshot,
    state: GameState,
    raidThreatActive: boolean,
  ): string | undefined {
    const enabled = snapshot.worldGeneration?.configured === true
      && snapshot.worldGeneration.conflictMode === 'frontier';
    const security = snapshot.settlementSecurity;
    const signature = [
      enabled ? 1 : 0,
      security.lastRaidTick,
      security.nextRaidTick,
      security.warningStartedTick,
      security.warningSourceTowerId ?? 'scouts',
      security.raidApproach,
      security.targetsAtRisk,
      security.threat.toFixed(6),
      security.coverage.toFixed(6),
      security.readyGuards.toFixed(6),
      raidThreatActive ? 'incursion' : 'all-clear',
      Math.floor(state.tick / FRONTIER_SECURITY_UPDATE_INTERVAL_TICKS),
      frontierDefenseFireSignature(state),
    ].join('|');
    if (signature !== this.raidProjectionSignature) {
      this.raidProjectionSignature = signature;
      const clock = gameClock(snapshot.simTick);
      const roadSpeedMultiplier = environmentFor(
        state.seed,
        snapshot.worldGeneration?.hydrology ?? 50,
        clock,
      ).roadTravelSpeedMultiplier;
      const refugePlan = enabled
        ? computeRefugeShelterPlan(state)
        : null;
      const guardhouseMusterPlan = enabled && this.roadNetwork
        ? computeGuardhouseMusterPlan(
            state,
            this.roadNetwork,
            roadSpeedMultiplier,
          )
        : null;
      this.projectedRaidTargets = enabled
        ? projectRaidTargets(
            state,
            security.targetsAtRisk,
            this.roadNetwork
              ? {
                  enemyPressure: snapshot.worldGeneration?.enemyPressure ?? 0,
                  roadNetwork: this.roadNetwork,
                  roadSpeedMultiplier,
                  refugeShelterPlan: refugePlan ?? undefined,
                  guardhouseMusterPlan: guardhouseMusterPlan ?? undefined,
                }
              : undefined,
          )
        : [];
      this.villagers?.setFrontierAlert(
        enabled && raidThreatActive,
        refugePlan?.refugeByResidence,
        guardhouseMusterPlan?.assignmentsByGuardhouse,
      );
      this.frontierRiskMarkers?.sync(
        this.projectedRaidTargets,
        raidThreatActive
          ? 1
          : security.warningStartedTick > 0
            ? 0.85
            : 0,
        enabled,
      );
    }
    return enabled && security.targetsAtRisk > 0
      ? formatProjectedRaidTargets(this.projectedRaidTargets)
      : undefined;
  }

  private clearFrontierRiskFeedback(): void {
    this.raidProjectionSignature = '';
    this.projectedRaidTargets = [];
    this.villagers?.setFrontierAlert(false);
    this.frontierRiskMarkers?.sync([], 0, false);
  }

  private notifyNightReport(snapshot: SpacetimeGameSnapshot): void {
    const reportDay = snapshot.nightPolicy.lastReportDay;
    if (
      this.lastSeenNightReportDay === null
      || reportDay < this.lastSeenNightReportDay
    ) {
      this.lastSeenNightReportDay = reportDay;
      return;
    }
    if (reportDay <= 0 || reportDay === this.lastSeenNightReportDay) return;
    this.lastSeenNightReportDay = reportDay;
    const troubled =
      snapshot.nightPolicy.lastColdHouseholds > 0
      || snapshot.nightPolicy.lastIncidents > 0
      || snapshot.nightPolicy.lastLightingFuelShortfall > 0.005;
    this.toastManager?.show(
      `Dawn report: ${formatDawnReport(snapshot.nightPolicy)}`,
      { variant: troubled ? 'error' : 'info', durationMs: 9_000 },
    );
    this.resourceInspector?.refreshSelection();
  }

  private applyShowcaseView(state: GameState): void {
    if (!isShowcaseMode() || this.showcaseViewApplied || !this.cameraController) return;

    const points = [...state.residences.values()].map((residence) => ({
      x: residence.x,
      z: residence.z,
    }));
    if (points.length < 4) return;

    const center = points.reduce(
      (sum, point) => ({ x: sum.x + point.x, z: sum.z + point.z }),
      { x: 0, z: 0 },
    );
    center.x /= points.length;
    center.z /= points.length;

    const chapel = [...state.buildings.values()].find((building) => building.kind === 'chapel');
    if (chapel) {
      center.x = center.x * 0.72 + chapel.x * 0.28;
      center.z = center.z * 0.72 + chapel.z * 0.28;
    }

    this.cameraController.applyShowcaseView(center.x, center.z);
    this.showcaseViewApplied = true;
  }

  /**
   * A new settlement should open on its people and shelter, not on an anonymous
   * map coordinate. Established towns retain the player's strategic camera.
   */
  private applyInitialSettlementView(state: GameState): void {
    if (
      isShowcaseMode()
      || this.initialSettlementViewApplied
      || !this.cameraController
      || (!this.visualQaConditions && state.residences.size > 0)
    ) {
      return;
    }

    const foundersCamp = [
      ...(this.getVisualQaPresentedBuildings(state) ?? state.buildings.values()),
    ]
      .find((building) => building.kind === 'founders_camp');
    if (!foundersCamp) return;

    this.cameraController.applyShowcaseView(
      foundersCamp.x - 7,
      foundersCamp.z + 6.3,
      (-42 * Math.PI) / 180,
      (40 * Math.PI) / 180,
      42,
    );
    this.initialSettlementViewApplied = true;
  }

  private getVisualQaPresentedBuildings(
    state: GameState,
  ): readonly BuildingState[] | null {
    if (!this.visualQaConditions || !this.sceneManager) return null;
    this.visualQaFoundersCampFixture ??= createVisualQaFoundersCampFixture(
      this.sceneManager.worldLayout,
      (x, z) => this.sceneManager?.terrain.getHeightAt(x, z) ?? 0,
    );
    return withVisualQaFoundersCamp(
      state.buildings.values(),
      this.visualQaFoundersCampFixture,
    );
  }

  private syncVisualQaFoundersCampFixture(): void {
    if (!this.gameState || !this.buildingMarkers) return;
    const buildings = this.getVisualQaPresentedBuildings(this.gameState);
    if (!buildings) return;
    this.buildingMarkers.syncBuildings(
      buildings,
      this.gameState.livestockHerds,
    );
  }

  private getVisualQaPresentationState(state: GameState): GameState {
    this.getVisualQaPresentedBuildings(state);
    return this.visualQaConditions && this.visualQaFoundersCampFixture
      ? withVisualQaFoundersCampState(state, this.visualQaFoundersCampFixture)
      : state;
  }

  private syncResourceUi(): void {
    if (!this.gameState || !this.resourceInspector) return;
    const presentationState = this.getVisualQaPresentationState(this.gameState);
    this.resourceInspector.setHud(
      computeResourceTotals(presentationState),
      computeStoredResourceTotals(presentationState),
      computePopulationStats(presentationState),
      computeInTransitResourceTotals(this.gameState.deliveryTrips.values()),
      computeGoldAwaitingCollection(presentationState.buildings.values()),
      computeGuardhousePayrollGold(presentationState.buildings.values()),
    );
    this.resourceInspector.refreshSelection();
  }

  private exposeDevHandles(): void {
    if (!this.gameState || !this.layoutRegistry) return;
    (window as typeof window & {
      __medievalGameState?: {
        getState: () => GameState;
        registry: WorldLayoutRegistry;
        treeRegistry: TreeRegistry | null;
      };
    }).__medievalGameState = {
      getState: () => this.gameState!,
      registry: this.layoutRegistry,
      treeRegistry: this.treeRegistry,
    };
  }

  private exposeE2eHandles(session: BootstrappedSession): void {
    if (import.meta.env.VITE_E2E_TEST !== '1') return;
    if (!this.spacetimeStore || !this.buildingTool || !this.sceneManager) return;

    const worldSettings = session.sceneManager.worldLayout.settings;
    const playableHalf = resolveWorldDimensions(worldSettings.mapSize).playableHalf;
    const physicalDeposits = createPhysicalDepositFootprints(
      session.sceneManager.worldLayout,
    );

    installSmokeTestHooks(createSmokeTestHooks({
      getState: () => this.gameState!,
      getBuildingMode: () => this.buildingTool!.getMode(),
      isConnected: () => this.sessionGate?.isReady() ?? false,
      getRendererStats: () => this.sceneManager!.getPerformanceStats(),
      placeBuilding: async (kind, x, z) => {
        await this.spacetimeStore!.placeBuilding(kind, x, z);
      },
      isWaterAt: (x, z) => this.sceneManager!.riverField.isRenderedWetAt(x, z),
      isResourceDepositAt: (x, z) =>
        isPhysicalDepositAt(physicalDeposits, x, z),
      getNaturalHeightAt: sampleNaturalTerrainHeight,
      getRoadNetwork: () => this.roadNetwork,
      playableHalf,
    }));
  }

  private buildCrowdViewState() {
    const camera = this.sceneManager?.camera.position;
    if (this.firstPersonController?.isActive()) {
      const pos = this.firstPersonController.getPosition(this.crowdViewScratch);
      return buildCrowdViewState(
        pos.x,
        pos.z,
        12,
        camera?.x ?? pos.x,
        camera?.z ?? pos.z,
        this.crowdViewState,
      );
    }
    const target = this.cameraController
      ? this.cameraController.getTargetPosition(this.crowdViewScratch)
      : null;
    const orbit = this.cameraController?.getOrbitDistance() ?? 240;
    if (!target) {
      return buildCrowdViewState(
        0,
        0,
        orbit,
        camera?.x ?? 0,
        camera?.z ?? 0,
        this.crowdViewState,
      );
    }
    return buildCrowdViewState(
      target.x,
      target.z,
      orbit,
      camera?.x ?? target.x,
      camera?.z ?? target.z,
      this.crowdViewState,
    );
  }
}

function isShowcaseMode(): boolean {
  return new URLSearchParams(window.location.search).get('showcase') === '1';
}

function resourceUiNeedsSync(current: GameState, previous: GameState | null): boolean {
  return !previous
    || current.stockpile !== previous.stockpile
    || current.quarries !== previous.quarries
    || current.foragingNodes !== previous.foragingNodes
    || current.trees !== previous.trees
    || current.buildings !== previous.buildings
    || current.farmFields !== previous.farmFields
    || current.pastures !== previous.pastures
    || current.graveyards !== previous.graveyards
    || current.corpses !== previous.corpses
    || current.livestockHerds !== previous.livestockHerds
    || current.burgageZones !== previous.burgageZones
    || current.residences !== previous.residences
    || current.backyardGardens !== previous.backyardGardens
    || current.deliveryTrips !== previous.deliveryTrips
    || current.fireIncidents !== previous.fireIncidents;
}

function combatInspectorSignature(
  agents: Iterable<CombatAgentState>,
  simTick: number,
): string {
  let hasRecoveringGuard = false;
  const entries = [...agents].map((agent) => {
    hasRecoveringGuard ||= agent.status === 'recovering';
    return `${agent.id}:${agent.sourceBuildingId ?? ''}:${agent.status}:${agent.stateChangedTick}`;
  });
  entries.sort();
  return `${entries.join('|')}${hasRecoveringGuard ? `@${simTick}` : ''}`;
}
