import type { AmbientAudioController } from '../audio/AmbientAudioController.ts';
import { CameraController } from '../camera/CameraController.ts';
import {
  STARTUP_MUSIC_TRACK_ID,
  StartupMusicController,
} from '../audio/StartupMusicController.ts';
import { FirstPersonController } from '../camera/FirstPersonController.ts';
import type { BuildingMarkers } from '../buildings/BuildingMarkers.ts';
import type { BuildingTool } from '../buildings/BuildingTool.ts';
import { initializeBuildingMaterialLibrary } from '../buildings/buildingMaterials.ts';
import { initializeVineyardVineResources } from '../vegetation/seedthree/vineyardVines.ts';
import type { FarmFieldMarkers } from '../farming/FarmFieldMarkers.ts';
import { FarmFieldTool } from '../farming/FarmFieldTool.ts';
import type { PastureMarkers } from '../farming/PastureMarkers.ts';
import type { LivestockVisuals } from '../farming/LivestockVisuals.ts';
import type { VineyardParcelMarkers } from '../vineyards/VineyardParcelMarkers.ts';
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
import type { ForestryWorkAreaTool } from '../resources/ForestryWorkAreaTool.ts';
import {
  computeInTransitResourceTotals,
  computeGoldAwaitingCollection,
  computeGuardhousePayrollGold,
  computePrivateHouseholdWealth,
  computePopulationStats,
  computeResourceTotals,
  computeStoredResourceTotals,
} from '../resources/resourceTotals.ts';
import { computeSettlementProvisioning } from '../economy/settlementProvisioning.ts';
import { computeSettlementApproval } from '../economy/settlementApproval.ts';
import { SettlementApprovalPacer } from '../economy/settlementApprovalPacing.ts';
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
import { setRendererAnimationLoop } from '../scene/RendererBackend.ts';
import type { WorldMapUiBundle } from './worldMapIcons.ts';
import { buildBuildingWorldMapMarkers } from '../map/worldMapMarkers.ts';
import type { DeliveryAgentRenderer } from '../logistics/DeliveryAgentRenderer.ts';
import type { FireEffectsRenderer } from '../fires/FireEffectsRenderer.ts';
import type { BanditCampRenderer } from '../security/BanditCampRenderer.ts';
import { formatBanditGoodsSummary } from '../security/banditState.ts';
import type { MilitiaCommandController } from '../security/MilitiaCommandController.ts';
import {
  militaryCompanyDisplayName,
  type MilitaryCompanyState,
} from '../security/militaryProgression.ts';
import { fireDisabledBuildingIds } from '../fires/fireIncident.ts';
import type { VillagerRenderer } from '../settlement/VillagerRenderer.ts';
import type { AuthoredCrowdDiagnostic } from '../settlement/SettlementCrowdRenderer.ts';
import { raidWithdrawingCartCount } from '../logistics/deliveryTrips.ts';
import { BuildToolbar, type ToolbarStats } from '../ui/BuildToolbar.ts';
import type { DebugMenu } from '../ui/DebugMenu.ts';
import { ToastManager } from '../ui/ToastManager.ts';
import type { VillagerInspector } from '../ui/VillagerInspector.ts';
import {
  buildingResourceCostAmounts,
  isResourceCostAffordable,
} from '../ui/resourceCost.ts';
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
import { formatSettlementClock, gameClock } from '../world/gameCalendar.ts';
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
import { markSpacetimeProtocolHealthy } from '../network/spacetimeProtocolRecovery.ts';
import { beginNewWorld } from './worldBootstrapFlow.ts';
import {
  clearAuthoritativeWorldGeneration,
  getActiveWorldGeneration,
} from '../world/worldGenerationContext.ts';
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
import { ThreatApproachTracker } from '../security/threatApproachAlerts.ts';
import { settlementHasStaffedChapel } from '../logistics/landmarkAccess.ts';
import { sampleNaturalTerrainHeight } from '../terrain/TerrainHeight.ts';
import { resolveWorldDimensions } from '../world/worldGenerationSettings.ts';
import {
  markFirstPlayable,
  markFirstPlayableAssetsReady,
  markVegetationReady,
} from './startupDiagnostics.ts';
import { deriveLordReportTransitions } from '../ui/lordReports.ts';
import { buildSettlementAnimalsView } from '../ui/settlementAnimals.ts';
import { buildSettlementPeopleView } from '../ui/settlementPeople.ts';
import { deriveSettlementSchedule } from '../world/settlementSchedule.ts';
import { Vector3 } from 'three';
import {
  BATTLE_SHOWCASE_DURATION_SECONDS,
  battleShowcaseCamera,
  battleShowcasePhaseAt,
  battleShowcaseWorldInput,
  createBattleShowcase,
  mergeBattleShowcaseAgents,
  parseBattleShowcaseRequest,
  selectBattleShowcaseSite,
  type BattleShowcase,
  type BattleShowcasePhase,
} from './battleShowcase.ts';
import {
  isLiveBattleCaptureRequested,
  startLiveBattleCapture,
} from './liveBattleCapture.ts';

const FIRST_PLAYABLE_GPU_STAGE_TIMEOUT_MS = 12_000;
import {
  CombatPlaytestOverlay,
  CombatPlaytestSimulation,
  combatPlaytestCamera,
  combatPlaytestWorldSettings,
  parseCombatPlaytestRequest,
  type CombatPlaytestPreset,
  type CombatPlaytestRequest,
  type CombatPlaytestSummary,
} from './combatPlaytest.ts';

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
  private forestryWorkAreaTool: ForestryWorkAreaTool | null = null;
  private buildingMarkers: BuildingMarkers | null = null;
  private residenceMarkers: ResidenceMarkers | null = null;
  private backyardGardenMarkers: BackyardGardenMarkers | null = null;
  private burgageFencing: BurgageFencing | null = null;
  private farmFieldMarkers: FarmFieldMarkers | null = null;
  private pastureMarkers: PastureMarkers | null = null;
  private vineyardParcelMarkers: VineyardParcelMarkers | null = null;
  private burialMarkers: BurialMarkers | null = null;
  private livestockVisuals: LivestockVisuals | null = null;
  private toolbar: BuildToolbar | null = null;
  private debugMenu: DebugMenu | null = null;
  private toastManager: ToastManager | null = null;
  private tutorialOverlay: BootstrappedSession['tutorialOverlay'] | null = null;
  private disposeTooltips: (() => void) | null = null;
  private resourceInspector: ResourceInspector | null = null;
  private villagerInspector: VillagerInspector | null = null;
  private worldMapUi: WorldMapUiBundle | null = null;
  private deliveryAgents: DeliveryAgentRenderer | null = null;
  private fireEffects: FireEffectsRenderer | null = null;
  private banditCamps: BanditCampRenderer | null = null;
  private militiaCommands: MilitiaCommandController | null = null;
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
  private startupMusic: StartupMusicController | null = null;
  private readonly combatPlaytestRequest: CombatPlaytestRequest | null = import.meta.env.DEV
    ? parseCombatPlaytestRequest(window.location.search)
    : null;
  private combatPlaytest: CombatPlaytestSimulation | null = null;
  private combatPlaytestOverlay: CombatPlaytestOverlay | null = null;
  private combatPlaytestNextSyncAtMs = 0;
  private readonly battleShowcaseRequest = import.meta.env.DEV
    ? parseBattleShowcaseRequest(window.location.search)
    : null;
  private battleShowcase: BattleShowcase | null = null;
  private battleShowcaseStartedAtMs = 0;
  private battleShowcaseNextSyncAtMs = 0;
  private battleShowcaseAuthoritativeAgents = new Map<string, CombatAgentState>();
  private liveBattleCaptureStarted = false;
  private readonly visualQaConditions = import.meta.env.DEV
    ? parseVisualQaConditions(window.location.search)
    : null;
  private readonly settlementPresentation = new SettlementPresentationController(
    () => performance.now(),
    this.visualQaConditions,
  );
  private readonly settlementApprovalPacer = new SettlementApprovalPacer();
  private readonly threatApproachTracker = new ThreatApproachTracker();
  private visualQaFoundersCampFixture: BuildingState | null = null;
  private showcaseViewApplied = false;
  private visualQaFoundersCampViewApplied = false;
  private lastSeenRaidTick: number | null = null;
  private lastSeenRaidWarningTick: number | null = null;
  private lastSeenActiveRaidId: string | null | undefined;
  private lastSeenBanditIncidentId: string | null = null;
  private lastSeenMilitaryCompanies: Map<string, MilitaryCompanyState> | null = null;
  private raidProjectionSignature = '';
  private combatInspectorSignature = '';
  private constructionResourceSignature = '';
  private projectedRaidTargets: ProjectedRaidTarget[] = [];
  private visualFrameProfiler: AppFrameProfiler | null = null;
  private disposed = false;

  constructor(root: HTMLElement) {
    this.root = root;
  }

  async start(): Promise<void> {
    if (
      import.meta.env.VITE_E2E_TEST !== '1'
      && !this.visualQaConditions
      && !isShowcaseMode()
    ) {
      this.startupMusic = new StartupMusicController({
        onAudibilityChange: (audible) => {
          this.ambientAudio?.setExternalScoreActive(audible);
        },
      });
      this.startupMusic.start();
    }

    let session: BootstrappedSession;
    try {
      session = await bootstrapAppSession(this.root, {
        syncToolbar: () => this.syncToolbar(),
        ...(this.combatPlaytestRequest
          ? { worldSettingsOverride: combatPlaytestWorldSettings(this.combatPlaytestRequest.seed) }
          : {}),
        deferGameplayMusic: this.startupMusic !== null,
        onGameAudioEnabledChange: (enabled) => {
          this.startupMusic?.setGameAudioEnabled(enabled);
        },
        onMusicEnabledChange: (enabled) => {
          this.startupMusic?.setMusicEnabled(enabled);
        },
        onMusicVolumeChange: (volume) => {
          this.startupMusic?.setMusicVolume(volume);
        },
        getCombatAgentOverride: () => this.combatPlaytest?.snapshot().values(),
        getMilitaryCompanyOverride: () => this.combatPlaytest?.companyStates().values(),
      });
    } catch (error) {
      this.startupMusic?.dispose();
      this.startupMusic = null;
      throw error;
    }
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
    this.forestryWorkAreaTool = session.forestryWorkAreaTool;
    this.buildingMarkers = session.buildingMarkers;
    this.buildingMarkers.setEnvironment(weatherPreview);
    this.deliveryAgents = session.deliveryAgents;
    this.fireEffects = session.fireEffects;
    this.banditCamps = session.banditCamps;
    this.militiaCommands = session.militiaCommands;
    this.villagers = session.villagers;
    this.residenceMarkers = session.residenceMarkers;
    this.backyardGardenMarkers = session.backyardGardenMarkers;
    this.burgageFencing = session.burgageFencing;
    this.farmFieldMarkers = session.farmFieldMarkers;
    this.pastureMarkers = session.pastureMarkers;
    this.vineyardParcelMarkers = session.vineyardParcelMarkers;
    this.burialMarkers = session.burialMarkers;
    this.livestockVisuals = session.livestockVisuals;
    this.toolbar = session.toolbar;
    this.debugMenu = session.debugMenu;
    this.toastManager = session.toastManager;
    this.tutorialOverlay = session.tutorialOverlay;
    this.disposeTooltips = session.disposeTooltips;
    this.resourceInspector = session.resourceInspector;
    this.villagerInspector = session.villagerInspector;
    this.worldMapUi = session.worldMapUi;
    this.ambientAudio = session.ambientAudio;
    this.ambientAudio.setExternalScoreActive(
      this.startupMusic?.isAudible() ?? false,
    );
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
          this.worldMapUi?.minimap.syncRoads();
          syncPlacedBuildingTerrain({
            sceneManager: this.sceneManager,
            gameState: this.gameState,
            buildingMarkers: this.buildingMarkers,
            forceMeshUpdate: true,
          });
          const hydratedState = this.gameState;
          if (hydratedState) {
            this.burgageFencing?.syncZones(
              hydratedState.burgageZones.values(),
              hydratedState.residences.values(),
              (x, z) => this.sceneManager?.terrain.getHeightAt(x, z) ?? 0,
            );
          }
          this.buildingMarkers?.refreshRoadFacingOrientations();
          if (this.sceneManager && this.buildingMarkers) {
            this.sceneManager.syncBuildingAccessRoads(
              this.buildingMarkers.getRoadConnectionSources(),
            );
          }
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
              vineyardParcels: this.gameState.vineyardParcels?.values() ?? [],
              graveyards: this.gameState.graveyards?.values() ?? [],
              corpses: this.gameState.corpses?.values() ?? [],
              deliveryTrips: this.gameState.deliveryTrips.values(),
              cavalryHorses: this.gameState.cavalryHorses.values(),
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
        onSessionReady: () => {
          markSpacetimeProtocolHealthy();
          this.sessionLifecycle?.onReady();
        },
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
      forestryWorkAreaTool: session.forestryWorkAreaTool,
      firstPersonController: session.firstPersonController,
      recoverSession: () => this.gameRuntime?.recoverSession(),
      beginNewWorld: () => {
        void beginNewWorld(
          () => this.spacetimeStore?.isConnected === true
            && this.spacetimeStore?.snapshot.identityHex !== null,
        );
      },
      onFirstPlayable: () => this.handoffStartupMusic(),
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
        vineyardParcelMarkers: this.vineyardParcelMarkers,
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

    if (this.visualQaConditions || this.combatPlaytestRequest) {
      // Deterministic capture and playtest pages are intentionally offline:
      // marking the local presentation ready prevents lifecycle retries
      // without opening a connection or changing the ordinary runtime path.
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
    session.sceneManager.syncBuildingAccessRoads(
      session.buildingMarkers.getRoadConnectionSources(),
    );
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
      this.applyVisualQaFoundersCampView(this.gameState);
    }
    session.cameraController.update(0);
    this.toolbar?.setZoomPercent(session.cameraController.getHudZoomPercent());
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
    const villagerPrewarm = session.villagers.beginFirstPlayableGpuPrewarm();
    const foundersCampPrewarm = session.buildingMarkers.beginFoundersCampGpuPrewarm();
    const targetedPrewarmObjects = [
      ...villagerPrewarm.objects,
      ...foundersCampPrewarm.objects,
    ];
    let gpuCoveredSubmissionCount = 0;
    let prewarmObjectsRestored = false;
    const restorePrewarmObjects = (): void => {
      if (prewarmObjectsRestored) return;
      prewarmObjectsRestored = true;
      foundersCampPrewarm.restore();
      villagerPrewarm.restore();
      // The covered warmup may have populated the cached directional shadow
      // atlas with temporary casters. The first live frame must rebuild it.
      session.sceneManager.invalidateStaticShadows();
    };
    try {
      try {
        await waitForStartupStage(
          session.sceneManager.precompileFirstPlayableObjects(targetedPrewarmObjects),
          FIRST_PLAYABLE_GPU_STAGE_TIMEOUT_MS,
          'targeted first-interaction shader compilation',
        );
      } catch (error) {
        // A targeted compile failure must not skip the live post/shadow warmup.
        console.warn('Targeted first-playable shader compile is unavailable:', error);
      }
      // The one covered submission warms the exact offscreen post and shadow
      // path. Do not follow it with a second blocking full-scene submission:
      // restoring/invalidation makes the first live frame the clean frame.
      session.sceneManager.invalidateStaticShadows();
      session.sceneManager.render(0, session.cameraController.getOrbitDistance());
      gpuCoveredSubmissionCount += 1;
      await waitForStartupStage(
        session.sceneManager.waitForFirstPlayableGpuWork(),
        FIRST_PLAYABLE_GPU_STAGE_TIMEOUT_MS,
        'first covered GPU submission',
      );
      restorePrewarmObjects();
    } catch (error) {
      gpuReady = false;
      console.warn('Live first-playable GPU prewarm is unavailable:', error);
    } finally {
      restorePrewarmObjects();
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
      gpuTargetedObjectCount: targetedPrewarmObjects.length,
      gpuCoveredSubmissionCount,
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
    if (this.disposed) return;
    session.loadingScreen?.setProgress({
      label: 'Entering world…',
      detail: 'Terrain and woodland ready',
      phase: 'vegetation',
      fraction: 1,
    });
    markFirstPlayable();
    this.sessionLifecycle?.onPresentationReady();
    if (!this.combatPlaytestRequest) {
      this.tutorialOverlay?.notifyWorldReady(
        [...(this.gameState?.buildings.values() ?? [])]
          .some((building) => building.kind === 'founders_camp'),
      );
    }
    this.startCombatPlaytest(session);
    this.startBattleShowcase(session);
    if (import.meta.env.VITE_E2E_TEST !== '1') {
      // Run scene-owner handoffs inside Three's renderer lifecycle. Its common
      // animation loop advances the NodeFrame immediately before this callback,
      // keeping WebGPU PassNode updates and the visible submission in one frame.
      setRendererAnimationLoop(session.sceneManager.renderer, this.tick);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.sceneManager) setRendererAnimationLoop(this.sceneManager.renderer, null);
    window.removeEventListener('resize', this.onResize);
    const startupMusic = this.startupMusic;
    this.startupMusic = null;
    startupMusic?.dispose();
    this.roadTool?.dispose();
    this.roadSelection?.dispose();
    this.buildingTool?.dispose();
    this.burgageTool?.dispose();
    this.farmFieldTool?.dispose();
    this.forestryWorkAreaTool?.dispose();
    this.buildingMarkers?.dispose();
    this.banditCamps?.dispose();
    this.combatPlaytestOverlay?.dispose();
    this.combatPlaytestOverlay = null;
    document.documentElement.removeAttribute('data-combat-playtest-ready');
    const playtestWindow = window as typeof window & { __combatPlaytest?: unknown };
    delete playtestWindow.__combatPlaytest;
    this.militiaCommands?.dispose();
    this.frontierRiskMarkers?.dispose();
    this.villagerInspector?.dispose();
    disposeSettlementWorld({
      residenceMarkers: this.residenceMarkers,
      farmFieldMarkers: this.farmFieldMarkers,
      pastureMarkers: this.pastureMarkers,
      vineyardParcelMarkers: this.vineyardParcelMarkers,
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
    this.worldMapUi?.dispose();
    this.toastManager?.dispose();
    this.tutorialOverlay?.dispose();
    this.disposeTooltips?.();
    this.disposeTooltips = null;
    this.firstPersonController?.dispose();
    this.cameraController?.dispose();
    this.debugMenu?.dispose();
    this.toolbar?.dispose();
    this.input?.dispose();
    this.ambientAudio?.dispose();
    this.visualFrameProfiler?.dispose();
    this.visualFrameProfiler = null;
    this.sceneManager?.dispose();
  }

  private handoffStartupMusic(): void {
    const startupMusic = this.startupMusic;
    if (!startupMusic) {
      this.ambientAudio?.setGameplayMusicActive(true);
      return;
    }

    const startupTrackPlayed = startupMusic.isAudible();
    void startupMusic.fadeOut().then(() => {
      if (this.disposed || this.startupMusic !== startupMusic) return;
      startupMusic.dispose();
      this.startupMusic = null;
      this.ambientAudio?.setExternalScoreActive(false);
      if (startupTrackPlayed) {
        this.ambientAudio?.markMusicTrackPlayed(STARTUP_MUSIC_TRACK_ID);
      }
      this.ambientAudio?.setGameplayMusicActive(true);
    });
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
    const gameSpeed = this.spacetimeStore?.snapshot.gameSpeed ?? 1;
    const worldDt = worldAnimationDelta(dt, gameSpeed);
    this.syncCombatPlaytest(time, dt);
    this.syncBattleShowcase(time);
    this.syncBuildInteractionPerf();
    this.frontierRiskMarkers?.tick(worldDt);
    if (this.settlementPresentationTargets) {
      this.settlementPresentation.tick(this.settlementPresentationTargets);
    }
    this.buildingMarkers?.tick(worldDt);
    this.minimapTickState.keyHeld = this.input?.isDown('g') ?? false;
    this.worldMapUi?.minimap.tick(this.minimapTickState);
    let renderOrbitDistance = 12;
    let renderFirstPersonCrouching = false;
    let renderCameraInteractionActive = false;
    if (firstPersonActive) {
      this.firstPersonController?.update(dt);
      this.toolbar?.setFirstPersonMode(true);
      this.roadTool?.update(dt);
      this.buildingTool?.update();
      this.burgageTool?.update();
      this.farmFieldTool?.update();
      this.forestryWorkAreaTool?.update();
      this.updateBuildButtonPosition();
      this.worldMapUi?.update();
      renderFirstPersonCrouching = this.firstPersonController?.isCrouching() ?? false;
      renderCameraInteractionActive =
        this.firstPersonController?.isCameraNavigationActive() ?? false;
    } else {
      this.cameraController?.update(dt);
      this.firstPersonController?.updatePlacement();
      this.toolbar?.setFirstPersonMode(false);
      this.toolbar?.setZoomPercent(this.cameraController?.getHudZoomPercent() ?? 100);
      this.roadTool?.update(dt);
      this.buildingTool?.update();
      this.burgageTool?.update();
      this.farmFieldTool?.update();
      this.forestryWorkAreaTool?.update();
      this.updateBuildButtonPosition();
      this.worldMapUi?.update();
      renderOrbitDistance = this.cameraController?.getOrbitDistance() ?? 240;
      renderCameraInteractionActive = this.cameraController?.isNavigationActive() ?? false;
    }
    const crowdView = this.buildCrowdViewState();
    // Project company markers after the active camera has settled and use the
    // exact crowd visibility envelope that owns authored soldier submission.
    this.militiaCommands?.update(time, crowdView);
    if (this.snapshotApplierDeps) {
      tickSettlementWorld(
        this.snapshotApplierDeps.settlementWorld,
        worldDt,
        crowdView,
      );
      this.sceneManager?.setGameHabitatLoggingDisturbances(
        this.villagers?.getActiveLoggingDisturbances(),
      );
    }
    // Render only after every agent renderer has committed its interpolated
    // transform and skinning palette. The directional shadow pass consumes the
    // same frame state as the color pass instead of trailing by one update.
    this.sceneManager?.render(
      worldDt,
      renderOrbitDistance,
      firstPersonActive,
      renderFirstPersonCrouching,
      renderCameraInteractionActive,
    );
    this.startBattleCaptureIfRequested();
    this.updateFps(time, rawDt);
    this.villagerInspector?.tick();
    this.ambientAudio?.setWorldPaused(gameSpeed === 0);
    this.ambientAudio?.tick(dt);
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
    // Terrain sync rebases authoritative markers. Restore the presentation-only
    // fallback afterwards when visual QA has no server camp.
    this.syncVisualQaFoundersCampFixture();
    this.sceneManager?.syncBuildingAccessRoads(
      this.buildingMarkers?.getRoadConnectionSources() ?? [],
    );
    if (this.snapshotApplierDeps) {
      syncSettlementWorld(this.snapshotApplierDeps.settlementWorld, presentationState);
    }
    this.burgageFencing?.syncZones(
      this.gameState.burgageZones.values(),
      this.gameState.residences.values(),
      (x, z) => this.sceneManager?.terrain.getHeightAt(x, z) ?? 0,
      // SeedThree temporarily retargets the renderer while baking vegetation.
      // Re-upload saved fence instances even when their layout signature did
      // not change; a later residence placement must not be what revives them.
      { forceInstanceUpload: true },
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
    const forestryWorkAreaEnabled = this.forestryWorkAreaTool?.isEnabled() ?? false;
    const fieldPlacementEnabled = farmFieldEnabled
      && this.farmFieldTool.getMode() === 'field';
    const vineyardPlacementEnabled = farmFieldEnabled
      && this.farmFieldTool.getMode() === 'vineyard';
    const farmCrop = fieldPlacementEnabled ? this.farmFieldTool.getCrop() : null;
    const availableResources = this.gameState
      ? computeResourceTotals(this.gameState)
      : undefined;
    const constructionResourceSignature = availableResources
      ? [
          availableResources.timber,
          availableResources.stone,
          availableResources.ironwork,
          availableResources.roofTiles,
          availableResources.gold,
        ].join('|')
      : '';
    if (constructionResourceSignature !== this.constructionResourceSignature) {
      this.constructionResourceSignature = constructionResourceSignature;
      this.buildingTool.revalidatePreview();
      this.burgageTool.revalidatePreview();
    }
    const placementCost = burgageEnabled
      ? this.burgageTool.getPlacementCost() ?? undefined
      : placementEconomy?.cost;
    const placementResourceShortfall = burgageEnabled
      ? this.burgageTool.isPlacementResourceShortfall()
      : buildingMode !== 'off'
        && this.buildingTool.isPlacementResourceShortfall();
    const placementCostAffordable = placementCost
      ? placementResourceShortfall
        ? false
        : availableResources
          ? isResourceCostAffordable(
              availableResources,
              buildingResourceCostAmounts(placementCost),
            )
          : undefined
      : undefined;
    const stats: ToolbarStats = {
      canBuild: farmFieldEnabled ? this.farmFieldTool.isDraftBuildable() : burgageEnabled ? this.burgageTool.isDraftBuildable() : this.roadTool.isDraftBuildable(),
      hasDraft: farmFieldEnabled ? this.farmFieldTool.hasDraft() : burgageEnabled ? this.burgageTool.hasDraft() : this.roadTool.hasDraft(),
      mode: farmFieldEnabled
        ? this.farmFieldTool.getMode() === 'pasture'
          ? 'pastures'
          : this.farmFieldTool.getMode() === 'graveyard'
            ? 'burial-grounds'
            : this.farmFieldTool.getMode() === 'vineyard'
              ? 'vineyards'
              : 'farm-fields'
        : burgageEnabled
        ? 'residences'
        : this.roadTool.isEnabled()
          ? this.roadTool.getMode() === 'dry-stone-wall'
            ? 'dry-stone-wall'
            : 'road'
          : buildingMode === 'off'
            ? 'idle'
            : buildingMode,
      statusDetail: forestryWorkAreaEnabled
        ? this.forestryWorkAreaTool!.getStatusDetail()
        : farmFieldEnabled
        ? this.farmFieldTool.getStatusDetail()
        : burgageEnabled
          ? this.burgageTool.getStatusDetail()
          : this.buildingTool.getStatusDetail(),
      placementBlocked: buildingMode !== 'off'
        && this.buildingTool.isPlacementBlocked(),
      placementReady: buildingMode !== 'off'
        && this.buildingTool.isPlacementReady(),
      farmCrop: farmCrop ?? undefined,
      vineyardSuitability: vineyardPlacementEnabled,
      buildingCost: placementEconomy?.cost,
      placementCost: burgageEnabled ? placementCost : undefined,
      placementCostAffordable,
      placementResourceShortfall,
      availableResources,
      carpenterSupported: placementEconomy?.carpenterSupported,
      carpenterCartServiceEnabled:
        placementEconomy?.carpenterCartServiceEnabled,
      carpenterCartServiceReady: placementEconomy?.carpenterCartServiceReady,
      wellAquiferNetworksEnabled:
        this.spacetimeStore?.snapshot.worldGeneration?.wellAquiferNetworksEnabled
        ?? getActiveWorldGeneration().wellAquiferNetworksEnabled,
    };
    this.sceneManager?.setCropSuitabilityOverlayCrop(farmCrop);
    this.sceneManager?.setVineyardSuitabilityOverlayVisible(vineyardPlacementEnabled);
    this.toolbar.setStats(stats);
    this.updateBuildButtonPosition();
  }

  private syncBuildInteractionPerf(): void {
    const splineDraft = Boolean(this.roadTool?.isEnabled() && this.roadTool.hasDraft());
    const roadActive = Boolean(
      this.roadTool?.isEnabled()
      && this.roadTool.getMode() === 'road',
    );
    const roadDraft = Boolean(
      splineDraft && roadActive,
    );
    const burgageDraft = Boolean(this.burgageTool?.isEnabled() && this.burgageTool.hasDraft());
    const farmFieldDraft = Boolean(this.farmFieldTool?.isEnabled() && this.farmFieldTool.hasDraft());
    const buildingActive = Boolean(this.buildingTool?.isEnabled());
    const forestryWorkAreaActive = Boolean(this.forestryWorkAreaTool?.isEnabled());
    this.sceneManager?.setBuildInteractionActive(
      splineDraft || burgageDraft || farmFieldDraft || buildingActive || forestryWorkAreaActive,
    );
    this.sceneManager?.setTerrainTopographyVisible(
      Boolean(this.toolbar?.isBuildMenuOpen()) || buildingActive || roadActive,
    );
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
    const performanceStats = { fps, ...this.sceneManager?.getPerformanceStats() };
    (window as typeof window & { __medievalRoadStats?: { backend?: string; fps: number; calls?: number; renderPasses?: number; triangles?: number; pixelRatio?: number } })
      .__medievalRoadStats = performanceStats;
    if (this.combatPlaytest) {
      const root = document.documentElement;
      const crowd = this.villagers?.authoredCrowdDiagnostics();
      const forest = this.sceneManager?.getForestManager()
        ?.getSeedThreeStructuralStats() ?? null;
      root.dataset.combatPlaytestFps = fps.toFixed(1);
      root.dataset.combatPlaytestDrawCalls = String(performanceStats.calls ?? 0);
      root.dataset.combatPlaytestRenderPasses = String(
        performanceStats.renderPasses ?? 0,
      );
      root.dataset.combatPlaytestTriangles = String(performanceStats.triangles ?? 0);
      root.dataset.combatPlaytestPixelRatio = String(performanceStats.pixelRatio ?? 0);
      if (forest) {
        root.dataset.combatPlaytestForestDrawCalls = String(forest.draws);
        root.dataset.combatPlaytestForestTriangles = String(forest.triangles);
        root.dataset.combatPlaytestVisibleTrees = String(forest.trees.visibleTrees);
      }
      root.dataset.combatPlaytestShadowRefreshed = String(
        performanceStats.directionalShadow?.refreshedThisFrame ?? false,
      );
      root.dataset.combatPlaytestShadowRefreshes = String(
        performanceStats.directionalShadow?.refreshes ?? 0,
      );
      root.dataset.combatPlaytestShadowCachedFrames = String(
        performanceStats.directionalShadow?.cachedFrames ?? 0,
      );
      root.dataset.combatPlaytestShadowReasons =
        performanceStats.directionalShadow?.reasons.join(',') ?? '';
      root.dataset.combatPlaytestShadowReasonCounts = performanceStats.directionalShadow
        ? Object.entries(performanceStats.directionalShadow.reasonCounts)
            .map(([reason, count]) => `${reason}:${count}`)
            .join(',')
        : '';
      if (crowd) {
        const submittedBodyTriangles = Object.values(crowd.batches).reduce(
          (total, batch) => total + batch.submittedTriangles,
          0,
        );
        root.dataset.combatPlaytestVisibleModels = String(crowd.visibleAgents);
        root.dataset.combatPlaytestEvaluatedRigs = String(crowd.evaluatedRigs);
        root.dataset.combatPlaytestSubmittedModels = String(crowd.submittedInstances);
        root.dataset.combatPlaytestProxyModels = String(crowd.proxyAgents);
        root.dataset.combatPlaytestBodyTriangles = String(submittedBodyTriangles);
        root.dataset.combatPlaytestAttachmentDrawCalls = String(
          crowd.attachments.activeDrawCalls,
        );
        root.dataset.combatPlaytestAttachmentInstances = String(
          crowd.attachments.visibleMeshInstances,
        );
        root.dataset.combatPlaytestAttachmentTriangles = String(
          crowd.attachments.submittedMeshTriangles,
        );
        root.dataset.combatPlaytestCrowdCpuMs = crowd.performance.syncCpuMs.toFixed(2);
        root.dataset.combatPlaytestVisibilityCpuMs = crowd.performance.visibilityCpuMs.toFixed(2);
        root.dataset.combatPlaytestRigCpuMs = crowd.performance.rigCpuMs.toFixed(2);
        root.dataset.combatPlaytestBodyBatchCpuMs = crowd.performance.bodyBatchCpuMs.toFixed(2);
        root.dataset.combatPlaytestAttachmentCpuMs = crowd.performance.attachmentCpuMs.toFixed(2);
        root.dataset.combatPlaytestDroppedWeaponCpuMs = crowd.performance.droppedWeaponCpuMs.toFixed(2);
        root.dataset.combatPlaytestStandardCpuMs = crowd.performance.standardCpuMs.toFixed(2);
        root.dataset.combatPlaytestMixerUpdates = String(crowd.performance.mixerUpdates);
        root.dataset.combatPlaytestStandards = String(crowd.standards.standards);
        root.dataset.combatPlaytestStandardTriangles = String(crowd.standards.triangles);
        root.dataset.combatPlaytestFlagOwnershipReach = crowd.standards.maxOwnershipReachRatio
          .toFixed(4);
        root.dataset.combatPlaytestFlagOwnershipResets = String(
          crowd.standards.ownershipResets,
        );
      }
    }
    this.resetFpsSample(time);
  }

  private resetFpsSample(time: number): void {
    this.fpsSampleStart = time;
    this.fpsFrameCount = 0;
    this.fpsAccumulatedSeconds = 0;
  }

  private startCombatPlaytest(session: BootstrappedSession): void {
    const request = this.combatPlaytestRequest;
    if (!request || this.combatPlaytest || !this.gameState) return;
    const settings = session.sceneManager.worldLayout.settings;
    const dimensions = resolveWorldDimensions(settings.mapSize);
    const site = selectBattleShowcaseSite(battleShowcaseWorldInput(
      this.gameState,
      {
        playableHalf: dimensions.playableHalf,
        getTerrainHeight: (x, z) => session.sceneManager.terrain.getHeightAt(x, z),
        isWaterAt: (x, z) => session.sceneManager.riverField.isRenderedWetAt(x, z),
        treeRegistry: this.treeRegistry,
        terrainPreset: settings.terrainPreset,
        rendererBackend: session.sceneManager.rendererBackend,
        connectedServer: false,
      },
    ));
    this.combatPlaytest = new CombatPlaytestSimulation({
      site,
      playableHalf: dimensions.playableHalf,
      preset: request.preset,
      seed: settings.seed,
    });
    this.combatPlaytestNextSyncAtMs = 0;
    session.uiRoot.classList.add('combat-playtest-mode');
    session.militiaCommands.setCommandHandler((ids, x, z) => {
      if (!this.combatPlaytest) return;
      this.combatPlaytest.issueOrder(ids, x, z);
      this.combatPlaytestNextSyncAtMs = 0;
      this.publishCombatPlaytestFrame();
    });
    this.combatPlaytestOverlay = new CombatPlaytestOverlay(session.uiRoot, {
      request: { ...request, seed: settings.seed },
      onReset: () => this.resetCombatPlaytest(),
      onPreset: (preset) => this.resetCombatPlaytest(preset),
    });

    const camera = combatPlaytestCamera(site);
    session.cameraController.applyShowcaseView(
      camera.targetX,
      camera.targetZ,
      camera.yaw,
      camera.pitch,
      camera.distance,
    );
    session.cameraController.setInputEnabled(true);
    this.publishCombatPlaytestFrame();

    const playtestWindow = window as typeof window & {
      __combatPlaytest?: CombatPlaytestDevHandle;
    };
    playtestWindow.__combatPlaytest = {
      ready: true,
      isolated: true,
      reset: () => this.resetCombatPlaytest(),
      spawnPreset: (preset) => this.resetCombatPlaytest(preset),
      summary: () => this.combatPlaytest?.summary() ?? null,
      crowdDiagnostics: () => this.villagers?.authoredCrowdDiagnostics() ?? null,
    };
    const root = document.documentElement;
    root.dataset.combatPlaytestReady = 'true';
    root.dataset.combatPlaytestServerConnected = 'false';
    root.dataset.combatPlaytestSeedThree = String(
      Boolean(this.treeRegistry && this.treeRegistry.entries.length > 0),
    );
    root.dataset.combatPlaytestWorldSeed = String(settings.seed >>> 0);
  }

  private syncCombatPlaytest(timeMs: number, deltaSeconds: number): void {
    const playtest = this.combatPlaytest;
    if (!playtest) return;
    playtest.tick(deltaSeconds);
    if (timeMs + 0.01 < this.combatPlaytestNextSyncAtMs) return;
    this.combatPlaytestNextSyncAtMs = timeMs + 1_000 / 15;
    this.publishCombatPlaytestFrame();
  }

  private resetCombatPlaytest(preset?: CombatPlaytestPreset): void {
    const playtest = this.combatPlaytest;
    if (!playtest) return;
    playtest.reset(preset ?? playtest.getPreset());
    this.militiaCommands?.clearSelection();
    this.combatPlaytestNextSyncAtMs = 0;
    this.publishCombatPlaytestFrame();
  }

  private publishCombatPlaytestFrame(): void {
    const playtest = this.combatPlaytest;
    if (!playtest || !this.villagers || !this.militiaCommands) return;
    const agents = playtest.snapshot();
    this.villagers.setCombatAgents(agents);
    this.militiaCommands.sync(agents, new Map());
    this.resourceInspector?.refreshSelection();
    const summary = playtest.summary();
    this.combatPlaytestOverlay?.update(summary);
    const root = document.documentElement;
    root.dataset.combatPlaytestPreset = summary.preset;
    root.dataset.combatPlaytestFriendly = String(summary.friendlyAlive);
    root.dataset.combatPlaytestEnemy = String(summary.enemyAlive);
    root.dataset.combatPlaytestOutcome = summary.outcome;
  }

  /**
   * Starts the opt-in live battle over the connected production world. The
   * showcase owns presentation only: authoritative server rows and the save
   * remain untouched while terrain, SeedThree, lighting, rigs, equipment,
   * animation, audio, and camera all stay on the ordinary game path.
   */
  private startBattleShowcase(session: BootstrappedSession): void {
    if (
      this.combatPlaytestRequest
      || !this.battleShowcaseRequest
      || this.battleShowcase
      || !this.gameState
    ) return;
    const settings = session.sceneManager.worldLayout.settings;
    const dimensions = resolveWorldDimensions(settings.mapSize);
    this.battleShowcase = createBattleShowcase(battleShowcaseWorldInput(
      this.gameState,
      {
        playableHalf: dimensions.playableHalf,
        getTerrainHeight: (x, z) => session.sceneManager.terrain.getHeightAt(x, z),
        isWaterAt: (x, z) => session.sceneManager.riverField.isRenderedWetAt(x, z),
        treeRegistry: this.treeRegistry,
        terrainPreset: settings.terrainPreset,
        rendererBackend: session.sceneManager.rendererBackend,
        connectedServer: session.spacetimeStore.snapshot.connected,
      },
    ));
    this.battleShowcaseStartedAtMs = performance.now();
    this.battleShowcaseNextSyncAtMs = 0;
    this.showcaseViewApplied = true;

    const view = battleShowcaseCamera(
      this.battleShowcase.site,
      this.battleShowcaseRequest.shot,
    );
    session.cameraController.applyShowcaseView(
      view.targetX,
      view.targetZ,
      view.yaw,
      view.pitch,
      view.distance,
    );
    session.cameraController.setInputEnabled(false);
    this.syncBattleShowcase(this.battleShowcaseStartedAtMs);

    const diagnostics = this.battleShowcase.diagnostics;
    const root = document.documentElement;
    root.dataset.battleShowcaseReady = 'true';
    root.dataset.battleShowcasePhase = 'charge';
    root.dataset.battleShowcaseServerConnected = String(diagnostics.connectedServer);
    root.dataset.battleShowcaseProductionTerrain = String(diagnostics.productionTerrain);
    root.dataset.battleShowcaseSeedThree = String(diagnostics.seedThreeForestReady);
    root.dataset.battleShowcaseTreeCount = String(diagnostics.treeRegistryEntries);
    root.dataset.battleShowcaseWorldSeed = String(diagnostics.worldSeed);
    root.dataset.battleShowcaseTerrainPreset = diagnostics.terrainPreset;
    root.dataset.battleShowcaseRenderer = diagnostics.rendererBackend;
  }

  private syncBattleShowcase(timeMs: number): void {
    const showcase = this.battleShowcase;
    const request = this.battleShowcaseRequest;
    if (!showcase || !request || !this.villagers) return;
    const elapsedSeconds = Math.max(0, (timeMs - this.battleShowcaseStartedAtMs) / 1_000);
    const timelineSeconds = request.loop
      ? elapsedSeconds % BATTLE_SHOWCASE_DURATION_SECONDS
      : Math.min(elapsedSeconds, BATTLE_SHOWCASE_DURATION_SECONDS);
    const camera = battleShowcaseCamera(showcase.site, request.shot, timelineSeconds);
    this.cameraController?.applyShowcaseView(
      camera.targetX,
      camera.targetZ,
      camera.yaw,
      camera.pitch,
      camera.distance,
    );

    // Keep camera motion at render cadence while limiting the heavier rig-map
    // reconciliation. This preserves a smooth 60 fps capture without asking
    // every actor to rebuild its animation state on every display frame.
    if (timeMs + 0.01 < this.battleShowcaseNextSyncAtMs) return;
    this.battleShowcaseNextSyncAtMs = timeMs + 1_000 / 15;

    const phase = battleShowcasePhaseAt(timelineSeconds);
    const agents = mergeBattleShowcaseAgents(
      this.battleShowcaseAuthoritativeAgents,
      showcase.sample(timelineSeconds),
    );
    this.villagers.setCombatAgents(agents);
    publishBattleShowcaseFrame(showcase, phase, timelineSeconds, agents.size);
  }

  private startBattleCaptureIfRequested(): void {
    if (
      this.liveBattleCaptureStarted
      || !this.battleShowcase
      || !isLiveBattleCaptureRequested(window.location.search)
      || this.spacetimeStore?.isConnected !== true
      || !this.sceneManager
    ) {
      return;
    }
    const canvas = this.sceneManager.renderer.domElement;
    if (!(canvas instanceof HTMLCanvasElement)) return;

    // Align the authored thirty-second combat timeline with the first encoded
    // video frame instead of charging during the loading-cover handoff.
    this.liveBattleCaptureStarted = true;
    this.battleShowcaseStartedAtMs = performance.now();
    this.battleShowcaseNextSyncAtMs = 0;
    this.syncBattleShowcase(this.battleShowcaseStartedAtMs);
    void startLiveBattleCapture(canvas, {
      filename: 'selo-empire-live-battle-30s-cinematic.webm',
    }).catch((error: unknown) => {
      console.error('[Live battle capture]', error);
    });
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
      this.battleShowcaseAuthoritativeAgents.clear();
      if (!this.battleShowcase && !this.combatPlaytest) {
        this.villagers?.setCombatAgents(new Map());
      }
      this.toolbar?.settlementHud.setSecurityState(
        snapshot.settlementSecurity,
        null,
        snapshot.simTick,
      );
      this.toolbar?.settlementHud.clearProvisioningState();
      this.toolbar?.settlementHud.clearPeopleState();
      this.toolbar?.settlementHud.clearAnimalsState();
      this.syncVisualQaFoundersCampFixture();
      this.syncToolbar();
      return;
    }

    const previous = this.gameState;
    this.gameState = state;
    this.toolbar?.setCommunitySettlements(state.settlements.values());
    const nextCombatInspectorSignature = combatInspectorSignature(
      snapshot.combatAgents.values(),
      snapshot.simTick,
    );
    const combatInspectorChanged =
      nextCombatInspectorSignature !== this.combatInspectorSignature;
    this.combatInspectorSignature = nextCombatInspectorSignature;
    this.battleShowcaseAuthoritativeAgents = new Map(snapshot.combatAgents);
    if (!this.battleShowcase && !this.combatPlaytest) {
      this.villagers?.setCombatAgents(snapshot.combatAgents);
    }
    this.banditCamps?.sync(snapshot.banditCamps.values());
    if (!this.combatPlaytest) {
      this.militiaCommands?.sync(snapshot.combatAgents, snapshot.banditCamps);
    }
    const raidThreatActive = hasActiveRaiderThreat(snapshot.combatAgents.values());
    const withdrawingCarts = raidWithdrawingCartCount(
      snapshot.deliveryTrips.values(),
      raidThreatActive,
    );
    if (this.liveContext) {
      this.liveContext.gameState = state;
    }
    const laborPauseLabel = raidThreatActive
      ? 'Raid response'
      : deriveSettlementSchedule(snapshot, state).laborPauseLabel;
    this.toolbar?.settlementHud.setPeopleState(buildSettlementPeopleView(
      state,
      state.physicalFoundingSiteEnabled === true,
    ));
    this.toolbar?.settlementHud.setAnimalsState(buildSettlementAnimalsView(
      state.stableOxen.values(),
      state.buildings,
      state.deliveryTrips.values(),
      fireDisabledBuildingIds(state.fireIncidents.values()),
      {
        herds: state.livestockHerds.values(),
        pastures: state.pastures.values(),
        backyardGardens: state.backyardGardens.values(),
        combatAgents: snapshot.combatAgents.values(),
        laborPauseLabel,
      },
    ));

    if (!this.snapshotApplierDeps) return;

    this.spacetimeSnapshotApplier.apply(
      this.snapshotApplierDeps,
      state,
      previous,
      snapshot.combatAgents.values(),
    );
    this.syncVisualQaFoundersCampFixture();
    this.notifySecurityChanges(snapshot);
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
      snapshot.worldGeneration?.severeWeatherEnabled ?? false,
    );
    const environmentOutlook = nextDayEnvironmentOutlook(
      state.seed,
      snapshot.worldGeneration?.hydrology ?? 50,
      clock,
      snapshot.worldGeneration?.severeWeatherEnabled ?? false,
    );
    const sabbathObserved = snapshot.parishPolicy.sabbathObservanceEnabled
      && settlementHasStaffedChapel(state);
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
      roadDistance: (ax, az, bx, bz) =>
        this.roadNetwork!.getPathfinder().roadPathDistance(ax, az, bx, bz),
    });
    this.toolbar?.settlementHud.setProvisioningState(provisioning, clock.month);
    this.notifyLordReportChanges(
      state,
      previous,
      snapshot.parishPolicy.sabbathObservanceEnabled,
    );
    const conflictEnabled = snapshot.worldGeneration?.conflictMode === 'frontier';
    let activeFires = 0;
    for (const incident of state.fireIncidents.values()) {
      if (incident.status === 'burning') activeFires += 1;
    }
    const approvalTarget = computeSettlementApproval({
      provisioning,
      security: snapshot.settlementSecurity,
      conflictEnabled,
      activeFires,
      month: clock.month,
    });
    this.toolbar?.settlementHud.setApprovalState(this.settlementApprovalPacer.update(
      approvalTarget,
      {
        identityHex: snapshot.identityHex,
        worldSeed: state.seed,
        simTick: snapshot.simTick,
        active: snapshot.gameSpeed > 0,
        approvalDeclineRate: snapshot.worldGeneration?.approvalDeclineRate ?? 100,
      },
    ));
    this.toolbar?.setMapSize(
      snapshot.worldGeneration?.mapSize ?? getActiveWorldGeneration().mapSize,
    );
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
      snapshot.worldGeneration?.severeWeatherEnabled ?? false,
    );
    this.sceneManager?.setEnvironment(presentationEnvironment);
    this.buildingMarkers?.setEnvironment(presentationEnvironment);
    this.backyardGardenMarkers?.setDeciduousFoliage(presentationEnvironment.deciduousFoliage);
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

  private notifyLordReportChanges(
    state: GameState,
    previous: GameState | null,
    sabbathObservanceEnabled: boolean,
  ): void {
    const newlyReportedFire = [...state.fireIncidents.values()].some((incident) => (
      incident.status === 'burning'
      && (!previous || !previous.fireIncidents.has(incident.id))
    ));
    if (newlyReportedFire) this.tutorialOverlay?.notifyFireStarted();
    this.toolbar?.settlementHud.addLordReports(
      deriveLordReportTransitions(state, previous, {
        sabbathObservanceEnabled,
      }),
    );
  }

  private notifySecurityChanges(snapshot: SpacetimeGameSnapshot): void {
    this.notifyThreatApproaches(snapshot);
    this.notifyBanditChanges(snapshot);
    this.notifyMilitaryCompanyChanges(snapshot);
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
        snapshot.worldGeneration?.severeWeatherEnabled ?? false,
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

  private notifyBanditChanges(snapshot: SpacetimeGameSnapshot): void {
    const latest = [...snapshot.banditIncidents.values()].sort((left, right) => (
      right.occurredTick - left.occurredTick || Number(right.id) - Number(left.id)
    ))[0];
    if (!latest) {
      this.lastSeenBanditIncidentId = null;
      return;
    }
    if (this.lastSeenBanditIncidentId === null) {
      this.lastSeenBanditIncidentId = latest.id;
      return;
    }
    if (latest.id === this.lastSeenBanditIncidentId) return;
    this.lastSeenBanditIncidentId = latest.id;
    const recoveredAmount = latest.recoveredGoods.reduce((sum, good) => sum + good.amount, 0);
    const amount = Math.round(recoveredAmount || latest.goodsTotal);
    const goodsSummary = formatBanditGoodsSummary(latest.recoveredGoods);
    const copy = latest.kind === 'theft'
      ? {
          title: 'Bandits stole from the settlement',
          detail: `${amount} surplus ${amount === 1 ? 'item was' : 'items were'} physically taken from a granary or storehouse. Intercept the carrier or clear its camp to recover the goods.`,
          tone: 'danger' as const,
          toast: `Bandits escaped a store with ${amount} ${amount === 1 ? 'item' : 'items'}.`,
        }
      : latest.kind === 'carrier-intercepted'
        ? {
            title: 'Bandit carrier intercepted',
            detail: `${amount} stolen ${amount === 1 ? 'item is' : 'items are'} recoverable where the bandit fell.`,
            tone: 'notice' as const,
            toast: `Bandit carrier intercepted; ${amount} stolen ${amount === 1 ? 'item is' : 'items are'} recoverable.`,
          }
        : {
            title: 'Bandit camp destroyed',
            detail: amount > 0
              ? `${goodsSummary} credited directly to settlement stores from the Crown bounty, seized camp provisions, and any stolen goods recovered there. No collection expedition is needed.`
              : 'The camp was destroyed, but no stolen goods remained to recover.',
            tone: 'settled' as const,
            toast: amount > 0
              ? `Bandit camp destroyed — ${goodsSummary} credited to settlement stores.`
              : 'Bandit camp destroyed; no stolen goods remained.',
          };
    this.toolbar?.settlementHud.addLordReport({
      id: `bandit:${latest.id}`,
      kind: 'bandit',
      tone: copy.tone,
      title: copy.title,
      detail: copy.detail,
      timeLabel: formatSettlementClock(latest.occurredTick),
      target: latest.buildingId ? { kind: 'building', id: latest.buildingId, x: latest.x, z: latest.z } : undefined,
      targetLabel: latest.buildingId ? 'Inspect theft site' : undefined,
    });
    this.toastManager?.show(copy.toast, {
      variant: latest.kind === 'theft' ? 'error' : 'info',
      durationMs: 7_000,
    });
  }

  private notifyThreatApproaches(snapshot: SpacetimeGameSnapshot): void {
    const seed = snapshot.worldGeneration?.seed ?? 0;
    const worldKey = `${snapshot.identityHex ?? 'unowned'}:${seed}`;
    const alerts = this.threatApproachTracker.update(
      snapshot.combatAgents.values(),
      snapshot.simTick,
      worldKey,
      snapshot.banditCamps.values(),
      [
        ...snapshot.buildings.values(),
        ...snapshot.residences.values(),
      ],
    );
    if (alerts.length === 0) return;

    for (const alert of alerts) {
      this.toolbar?.settlementHud.addLordReport({
        id: alert.id,
        kind: alert.kind === 'ottoman' ? 'military' : alert.kind,
        tone: 'danger',
        title: alert.title,
        detail: alert.detail,
        timeLabel: formatSettlementClock(snapshot.simTick),
        target: {
          kind: 'world',
          id: alert.id,
          x: alert.x,
          z: alert.z,
        },
        targetLabel: alert.targetLabel,
      });
      this.ambientAudio?.playThreatAlert(alert.sound);
    }

    if (snapshot.gameSpeed === 1 || !this.spacetimeStore) return;
    void this.spacetimeStore.setGameSpeed(1).catch((error) => {
      const message = error instanceof Error
        ? error.message
        : 'The threat was reported, but the game could not be slowed to 1×.';
      this.toastManager?.show(message, { variant: 'error', durationMs: 5_000 });
    });
  }

  private notifyMilitaryCompanyChanges(snapshot: SpacetimeGameSnapshot): void {
    const current = new Map(snapshot.militaryCompanies);
    if (this.lastSeenMilitaryCompanies === null) {
      this.lastSeenMilitaryCompanies = current;
      return;
    }
    for (const company of snapshot.militaryCompanies.values()) {
      if (company.kind !== 'mercenary-spears') continue;
      const previous = this.lastSeenMilitaryCompanies.get(company.id);
      const companyName = militaryCompanyDisplayName(company);
      if (!previous) {
        this.toolbar?.settlementHud.addLordReport({
          id: `military-arrival:${company.id}:${company.formedTick}`,
          kind: 'military',
          tone: 'notice',
          title: `${companyName} have arrived`,
          detail: `${company.livingMembers} hired spearmen of ${companyName} have entered at a safe edge of the region, away from the town and known bandit camps. They await company orders there.`,
          timeLabel: formatSettlementClock(company.formedTick),
        });
        this.toastManager?.show('Mercenaries have arrived at the edge of the region.', {
          variant: 'info',
          durationMs: 7_000,
        });
        continue;
      }
      if (company.status === 'leaving' && previous.status !== 'leaving') {
        const source = this.gameState?.buildings.get(company.sourceBuildingId);
        this.toolbar?.settlementHud.addLordReport({
          id: `military-leaving:${company.id}:${snapshot.simTick}`,
          kind: 'military',
          tone: 'warning',
          title: `${companyName} are leaving`,
          detail: `${companyName} are marching to their original map edge and no longer accept orders. Select the Town Hall roster and pay a two-day retainer before the last survivor exits if you need them to stay.`,
          timeLabel: formatSettlementClock(snapshot.simTick),
          target: source ? { kind: 'building', id: source.id, x: source.x, z: source.z } : undefined,
          targetLabel: source ? 'Review mercenary contract' : undefined,
        });
        this.toastManager?.show('Mercenaries are leaving. Pay their retainer at the Town Hall to stop them.', {
          variant: 'error',
          durationMs: 9_000,
        });
      }
    }
    for (const company of this.lastSeenMilitaryCompanies.values()) {
      if (
        company.kind !== 'mercenary-spears'
        || company.status !== 'leaving'
        || current.has(company.id)
      ) continue;
      this.toolbar?.settlementHud.addLordReport({
        id: `military-departure:${company.id}:${snapshot.simTick}`,
        kind: 'military',
        tone: 'notice',
        title: `${militaryCompanyDisplayName(company)} have departed`,
        detail: `The final surviving contractor of ${militaryCompanyDisplayName(company)} has crossed the map edge. The company no longer draws daily civic treasury pay.`,
        timeLabel: formatSettlementClock(snapshot.simTick),
      });
      this.toastManager?.show('A mercenary company has left the region.', {
        variant: 'info',
        durationMs: 7_000,
      });
    }
    this.lastSeenMilitaryCompanies = current;
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

  /** Keep deterministic visual-QA captures framed on their synthetic camp. */
  private applyVisualQaFoundersCampView(state: GameState): void {
    if (
      !this.visualQaConditions
      || isShowcaseMode()
      || this.visualQaFoundersCampViewApplied
      || !this.cameraController
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
    this.visualQaFoundersCampViewApplied = true;
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
    this.sceneManager?.syncBuildingAccessRoads(
      this.buildingMarkers.getRoadConnectionSources(),
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
      presentationState.physicalFoundingSiteEnabled === true,
      computeInTransitResourceTotals(this.gameState.deliveryTrips.values()),
      computeGoldAwaitingCollection(presentationState.buildings.values()),
      computeGuardhousePayrollGold(presentationState.buildings.values()),
      computePrivateHouseholdWealth(presentationState.residences.values()),
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

    void import('../e2e/smokeTestHooks.ts').then(({
      createSmokeTestHooks,
      installSmokeTestHooks,
    }) => {
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
    });
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

type CombatPlaytestDevHandle = {
  ready: true;
  isolated: true;
  reset: () => void;
  spawnPreset: (preset: CombatPlaytestPreset) => void;
  summary: () => CombatPlaytestSummary | null;
  crowdDiagnostics: () => AuthoredCrowdDiagnostic | null;
};

function publishBattleShowcaseFrame(
  showcase: BattleShowcase,
  phase: BattleShowcasePhase,
  elapsedSeconds: number,
  visibleAgentCount: number,
): void {
  const root = document.documentElement;
  root.dataset.battleShowcasePhase = phase;
  root.dataset.battleShowcaseElapsed = elapsedSeconds.toFixed(3);
  root.dataset.battleShowcaseVisibleAgents = String(visibleAgentCount);
  (window as typeof window & {
    __battleShowcase?: {
      ready: true;
      phase: BattleShowcasePhase;
      elapsedSeconds: number;
      visibleAgentCount: number;
      diagnostics: BattleShowcase['diagnostics'];
    };
  }).__battleShowcase = {
    ready: true,
    phase,
    elapsedSeconds,
    visibleAgentCount,
    diagnostics: showcase.diagnostics,
  };
}

function isShowcaseMode(): boolean {
  return new URLSearchParams(window.location.search).get('showcase') === '1';
}

async function waitForStartupStage<T>(
  work: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${label} exceeded ${timeoutMs} ms`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

function resourceUiNeedsSync(current: GameState, previous: GameState | null): boolean {
  return !previous
    || current.physicalFoundingSiteEnabled !== previous.physicalFoundingSiteEnabled
    || current.legacyUnhousedPopulationBonusEnabled !== previous.legacyUnhousedPopulationBonusEnabled
    || current.stockpile !== previous.stockpile
    || current.settlements !== previous.settlements
    || current.quarries !== previous.quarries
    || current.foragingNodes !== previous.foragingNodes
    || current.trees !== previous.trees
    || current.buildings !== previous.buildings
    || current.farmFields !== previous.farmFields
    || current.pastures !== previous.pastures
    || current.graveyards !== previous.graveyards
    || current.corpses !== previous.corpses
    || current.livestockHerds !== previous.livestockHerds
    || current.stableOxen !== previous.stableOxen
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
