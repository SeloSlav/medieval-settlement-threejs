import * as THREE from 'three';
import type { BuildingTerrainSource } from '../buildings/BuildingTerrainLayout.ts';
import { buildingPlacementYaw } from '../buildings/buildingPlacement.ts';
import { createForestProps } from '../props/ForestProps.ts';
import type { ForestManager, ForestTreeLayout } from '../props/ForestManager.ts';
import { computeForestTreePlacements } from '../props/forestPlacements.ts';
import {
  createGrassBladeField,
  GRASS_BLADES_ENABLED,
  type GrassBladeField,
} from '../grass/GrassBladeField.ts';
import { updateTerrainZoomBlend } from '../grass/GrassLodConfig.ts';
import { createRiverSystem, type RiverSystem } from '../rivers/RiverSystem.ts';
import { updateTerrainRoadWear } from '../terrain/TerrainRoadWear.ts';
import { RiverField } from '../rivers/RiverField.ts';
import { setActiveRiverLayout, setActiveQuarryLayout, getActivePlacedBuildingLayout } from '../terrain/TerrainHeight.ts';
import { loadTerrainStartupData } from '../terrain/loadTerrainStartupData.ts';
import { createQuarrySystem, type QuarrySystem } from '../quarries/QuarrySystem.ts';
import { createClayDepositSystem, type ClayDepositSystem } from '../clay/ClayDepositSystem.ts';
import {
  createMineralDepositSystem,
  type MineralDepositSystem,
} from '../minerals/MineralDepositSystem.ts';
import { setActiveClayDepositLayout } from '../economy/clayBankPolicy.ts';
import { createWorldLayout, type WorldLayout } from '../resources/WorldLayout.ts';
import type {
  BuildingState,
  FarmCrop,
  ForagingNodeState,
  ResidenceState,
  ResourceNodeState,
  SettlementState,
} from '../resources/types.ts';
import type { WorldGenerationSettings } from '../world/worldGenerationSettings.ts';
import { resolveWorldDimensions } from '../world/worldGenerationSettings.ts';
import { forestDensityScale } from '../world/worldGenerationSettings.ts';
import type { RoadEdge } from '../roads/RoadEdge.ts';
import { BuildingAccessSpurs } from '../roads/BuildingAccessSpurs.ts';
import type { BuildingRoadConnectionSource } from '../roads/BuildingRoadConnections.ts';
import { RoadJunctionBuilder } from '../roads/RoadJunctionBuilder.ts';
import { RoadMaterialFactory } from '../roads/RoadMaterialFactory.ts';
import { RoadMeshBuilder } from '../roads/RoadMeshBuilder.ts';
import { sampleRoadSurfaceY } from '../roads/RoadSurfaceSampling.ts';
import type { RoadNetwork } from '../roads/RoadNetwork.ts';
import { DryStoneWallRenderer } from '../decorations/DryStoneWallRenderer.ts';
import type { Point2 } from '../utils/polygonGeometry.ts';
import type { BridgeSamplingContext } from '../roads/RiverBridgeSpans.ts';
import { getStillWaterSurfaceY } from '../rivers/RiverWaterLevel.ts';
import { SkyCloudMesh } from '../sky/SkyCloudMesh.ts';
import { SKY_DEPTH_OCCLUSION_RADIUS } from '../sky/skyDepthOcclusionPolicy.ts';
import {
  FAIR_DAY_FOG_COLOR,
  type DayNightGrade,
  type DayNightLightingState,
} from '../world/dayNightPresentation.ts';
import { Terrain, type TerrainBounds } from '../terrain/Terrain.ts';
import { TerrainProjector } from '../terrain/TerrainProjector.ts';
import { disposeObject3D } from '../utils/dispose.ts';
import type { RockObstacle } from '../utils/pathGeometry.ts';
import { RockSpatialIndex } from '../utils/rockSpatialIndex.ts';
import { yieldToMain } from '../utils/yieldToMain.ts';
import { createPostProcessor, type ScenePostProcessor } from './PostProcessing.ts';
import { fitDirectionalLightShadow, computeViewShadowBounds, intersectTerrainBounds } from './fitDirectionalShadow.ts';
import {
  createPreferredRenderer,
  type RendererAdapterEvidence,
  type RendererBackend,
  type RendererBackendKind,
  type SupportedRenderer,
} from './RendererBackend.ts';
import { applyShadowPreferences as syncShadowCasters } from './applyShadowPreferences.ts';
import { TREE_SHADOW_CAST_LAYER } from './SceneLayers.ts';
import { subscribeShadowPreferences } from './shadowPreference.ts';
import { areDistantCanopyCardsEnabled } from './distantCanopyCardPreference.ts';
import { applyMaxAnisotropy, beginProgressiveStartupTextureLoad, type SceneStartupTextures } from './startupTextures.ts';
import { HydrologyOverlay } from '../hydrology/HydrologyOverlay.ts';
import { CropSuitabilityOverlay } from '../farming/CropSuitabilityOverlay.ts';
import {
  getMapOverlaySelection,
  subscribeMapOverlayPreference,
  type MapOverlaySelection,
} from './mapOverlayPreference.ts';
import { WindOverlay } from '../wind/WindOverlay.ts';
import { CommunityReachOverlay } from '../settlement/CommunityReachOverlay.ts';
import {
  areConstellationGuidesEnabled,
  subscribeConstellationPreference,
} from './constellationPreference.ts';
import type { LoadingPhase } from '../ui/loadingProgress.ts';
import { createBerryPatchVisuals, type BerryPatchVisuals } from '../foraging/BerryPatchVisuals.ts';
import type { DeerWildlifeVisuals } from '../foraging/DeerWildlifeVisuals.ts';
import type { GameHabitatDisturbanceSource } from '../foraging/gameHabitatDisturbance.ts';
import type { FishWildlifeVisuals } from '../foraging/FishWildlifeVisuals.ts';
import {
  createMushroomPatchVisuals,
  type MushroomPatchVisuals,
} from '../foraging/MushroomPatchVisuals.ts';
import { gameClock } from '../world/gameCalendar.ts';
import {
  disposeBuildingMaterialLibrary,
  setBuildingIndirectLightIntensity,
} from '../buildings/buildingMaterials.ts';
import {
  disposeVineyardVineResources,
} from '../vegetation/seedthree/vineyardVines.ts';
import { PrecipitationRenderer } from '../weather/PrecipitationRenderer.ts';
import {
  precipitationProfile,
  type PrecipitationProfile,
  weatherPresentationBlend,
} from '../weather/precipitationPolicy.ts';
import type { EnvironmentState } from '../world/seasonPolicy.ts';
import { markStartupCheckpoint } from '../app/startupDiagnostics.ts';
import { setWorldAnimationTime } from './worldAnimationTime.ts';
import {
  shouldRefreshDirectionalShadow,
  shouldRefreshDirectionalShadowAtlas,
  shouldRefreshDynamicDirectionalShadow,
} from './directionalShadowRefreshPolicy.ts';
import {
  beginRendererFrame,
  configureRendererFrameStats,
  readRendererFrameStats,
  type RendererFrameStats,
  type RendererInfoLike,
} from './rendererFrameStats.ts';
import {
  IllustratedMapPlane,
  type IllustratedMapDebugMode,
} from '../map/IllustratedMapPlane.ts';
import {
  resolveSceneRenderOwner,
  type SceneRenderOwner,
} from './sceneRenderOwnership.ts';

export type SceneLoadProgress = {
  label: string;
  detail?: string;
  phase: LoadingPhase;
  fraction: number;
};

export type VegetationStartupTiming = {
  totalMs: number;
  stages: Record<string, number>;
};

type StartupPrecompilableRenderer = SupportedRenderer & {
  initTexture(texture: THREE.Texture): void;
  compileAsync(
    scene: THREE.Object3D,
    camera: THREE.Camera,
    targetScene?: THREE.Scene | null,
  ): Promise<unknown>;
};

const MOON_KEY_DIRECTION = new THREE.Vector3(-0.38, 0.82, 0.42).normalize();
const MOON_FILL_DIRECTION = new THREE.Vector3(0.52, 0.48, -0.71).normalize();
// These implementations were formerly part of the synchronous game-entry
// parse. Fetch them immediately but evaluate them as parallel vegetation
// chunks; the later build reuses these exact promises before loading the GLBs.
const deerVisualModulePromise = import('../foraging/DeerWildlifeVisuals.ts');
const fishVisualModulePromise = import('../foraging/FishWildlifeVisuals.ts');

export class SceneManager {
  private readonly container: HTMLElement;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: SupportedRenderer;
  readonly rendererBackend: RendererBackendKind;
  private readonly rendererAdapterEvidence: RendererAdapterEvidence;
  private readonly waitForSubmittedWork: () => Promise<void>;
  readonly postProcessor: ScenePostProcessor;
  private readonly illustratedMap: IllustratedMapPlane;
  private illustratedMapActive = false;
  private readonly maxAnisotropy: number;
  readonly cameraTarget = new THREE.Vector3();
  readonly terrain: Terrain;
  private readonly fairTerrainMaterial: THREE.Material;
  readonly terrainProjector: TerrainProjector;
  readonly materials: RoadMaterialFactory;
  readonly roadMeshBuilder: RoadMeshBuilder;
  readonly dryStoneWallRenderer: DryStoneWallRenderer;
  private readonly buildingAccessSpurs: BuildingAccessSpurs;
  readonly previewGroup = new THREE.Group();
  readonly selectionGroup = new THREE.Group();
  private readonly sky: SkyCloudMesh;
  private readonly precipitation: PrecipitationRenderer;
  private readonly sunDirection = new THREE.Vector3();
  private readonly shadowKeyDirection = new THREE.Vector3();
  private readonly skyFillDirection = new THREE.Vector3();
  private readonly lastShadowKeyDirection = new THREE.Vector3(Number.NaN, Number.NaN, Number.NaN);
  private sunLight!: THREE.DirectionalLight;
  private hemiLight!: THREE.HemisphereLight;
  private ambientLight!: THREE.AmbientLight;
  private skyFillLight!: THREE.DirectionalLight;
  private skyAnimationTime = 0;
  private worldAnimationElapsedSeconds = 0;
  private forestManager: ForestManager | null = null;
  private forestTreeLayouts: readonly ForestTreeLayout[] | null = null;
  private resolveForestTreeLayoutsReady: (
    (layouts: readonly ForestTreeLayout[]) => void
  ) | null = null;
  private readonly forestTreeLayoutsReady = new Promise<readonly ForestTreeLayout[]>((resolve) => {
    this.resolveForestTreeLayoutsReady = resolve;
  });
  private grassField: GrassBladeField | null = null;
  private berryPatchVisuals: BerryPatchVisuals | null = null;
  private mushroomPatchVisuals: MushroomPatchVisuals | null = null;
  private deerWildlifeVisuals: DeerWildlifeVisuals | null = null;
  private gameHabitatLoggingDisturbances: readonly GameHabitatDisturbanceSource[] = [];
  private fishWildlifeVisuals: FishWildlifeVisuals | null = null;
  private latestForagingNodes: ForagingNodeState[] = [];
  private latestForagingMonth = 1;
  private vegetationBuilt = false;
  private vegetationBuildActive = false;
  private roadNetworkRef: RoadNetwork | null = null;
  private buildingAccessSpurSources: BuildingRoadConnectionSource[] = [];
  private forestClearanceBuildings: BuildingTerrainSource[] = [];
  private forestClearanceBurgageParcelPolygons: Point2[][] = [];
  private forestClearanceFarmFieldPolygons: Point2[][] = [];
  private forestClearanceBackyardGardenPolygons: Point2[][] = [];
  private lastForestClearanceSourceSignature = '';
  private readonly riverSystem: RiverSystem;
  private readonly quarrySystem: QuarrySystem;
  private readonly clayDepositSystem: ClayDepositSystem;
  private readonly mineralDepositSystem: MineralDepositSystem;
  private hydrologyOverlay: HydrologyOverlay | null = null;
  private windOverlay: WindOverlay | null = null;
  private cropSuitabilityOverlay: CropSuitabilityOverlay | null = null;
  private communityReachOverlay: CommunityReachOverlay | null = null;
  private communitySettlements: ReadonlyMap<string, SettlementState> = new Map();
  private communityBuildings: ReadonlyMap<string, BuildingState> = new Map();
  private communityResidences: ReadonlyMap<string, ResidenceState> = new Map();
  private cropSuitabilityCrop: FarmCrop | null = null;
  private vineyardSuitabilityActive = false;
  private mapOverlaySelection: MapOverlaySelection = getMapOverlaySelection();
  readonly worldLayout: WorldLayout;

  get riverField() {
    return this.riverSystem.field;
  }

  get textureAnisotropy(): number {
    return this.maxAnisotropy;
  }
  private readonly roadGroup = new THREE.Group();
  private readonly junctionGroup = new THREE.Group();
  private readonly edgeVisuals = new Map<string, {
    revision: number;
    topologyKey: string;
    group: THREE.Group;
  }>();
  private rockSpatialIndex: RockSpatialIndex | null = null;
  private rockCollisionVersion = 0;
  private buildInteractionActive = false;
  private renderFrame = 0;
  private completedRenderFrames = 0;
  private lastRendererFrameStats: RendererFrameStats = {
    drawCalls: 0,
    renderPasses: 0,
    triangles: 0,
  };
  private readonly viewShadowBounds = { minX: 0, maxX: 0, minZ: 0, maxZ: 0 };
  private readonly shadowBounds = { minX: 0, maxX: 0, minZ: 0, maxZ: 0 };
  private readonly firstPersonViewFocus = new THREE.Vector3();
  private readonly firstPersonDeerObserver = { x: 0, z: 0, crouching: false };
  private lastShadowTargetX = Number.NaN;
  private lastShadowTargetZ = Number.NaN;
  private lastShadowDistance = Number.NaN;
  private lastDirectionalShadowRefreshMs = Number.NEGATIVE_INFINITY;
  private lastDynamicShadowRefreshMs = Number.NEGATIVE_INFINITY;
  private dynamicShadowCastersChanged = false;
  private unsubscribeShadowPreferences: (() => void) | null = null;
  private unsubscribeMapOverlayPreference: (() => void) | null = null;
  private unsubscribeConstellationPreference: (() => void) | null = null;
  private environment: EnvironmentState | null = null;
  private lastDayNightState: DayNightLightingState | null = null;
  private readonly weatherPresentation = createWeatherPresentationState(null);
  private weatherPresentationTarget = createWeatherPresentationState(null);
  private readonly dayNightGrade: DayNightGrade = {
    saturation: 0,
    contrast: 0,
    warmth: 0,
    nightBlue: 0,
    vignette: 0,
  };
  private constructor(
    container: HTMLElement,
    backend: RendererBackend,
    materials: RoadMaterialFactory,
    startupTextures: SceneStartupTextures,
    terrain: Terrain,
    riverSystem: RiverSystem,
    quarrySystem: QuarrySystem,
    clayDepositSystem: ClayDepositSystem,
    mineralDepositSystem: MineralDepositSystem,
    worldLayout: WorldLayout,
  ) {
    this.container = container;
    this.renderer = backend.renderer;
    configureRendererFrameStats(this.renderer.info as unknown as RendererInfoLike);
    this.rendererBackend = backend.kind;
    this.rendererAdapterEvidence = {
      ...backend.adapterEvidence,
      limitations: [...backend.adapterEvidence.limitations],
    };
    this.waitForSubmittedWork = backend.waitForSubmittedWork;
    this.maxAnisotropy = backend.maxAnisotropy;
    this.illustratedMap = new IllustratedMapPlane(this.maxAnisotropy);
    this.materials = materials;
    this.scene = new THREE.Scene();
    this.scene.background = null;
    this.scene.fog = new THREE.FogExp2(FAIR_DAY_FOG_COLOR, 0.00072);
    // A slightly longer lens keeps the broad settlement readable while making
    // the layered Dinaric landscape feel less miniaturised.
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 2600);
    this.camera.layers.disable(TREE_SHADOW_CAST_LAYER);
    this.sunDirection.setFromSphericalCoords(1, THREE.MathUtils.degToRad(43), THREE.MathUtils.degToRad(225));
    this.shadowKeyDirection.copy(this.sunDirection);
    this.terrain = terrain;
    this.fairTerrainMaterial = terrain.mesh.material as THREE.Material;
    this.terrainProjector = new TerrainProjector(this.terrain, this.camera, this.renderer.domElement);
    this.sky = new SkyCloudMesh({
      sunDirection: this.sunDirection,
      cloudCoverage: 0.34,
      cloudHeight: 210,
      cloudThickness: 68,
      cloudAbsorption: 0.46,
      hazeStrength: 0.095,
      maxCloudDistance: 6200,
      mieCoefficient: 0.0032,
      mieDirectionalG: 0.6,
      radius: SKY_DEPTH_OCCLUSION_RADIUS,
      rayleigh: 0.7,
      turbidity: 1.45,
      windSpeedX: 0.085,
      windSpeedZ: 0.045,
      widthSegments: 56,
      heightSegments: 28,
      rendererBackend: backend.kind,
      perlinTexture: startupTextures.skyPerlin,
      constellationVisibility: areConstellationGuidesEnabled() ? 1 : 0,
    });
    this.riverSystem = riverSystem;
    this.quarrySystem = quarrySystem;
    this.clayDepositSystem = clayDepositSystem;
    this.mineralDepositSystem = mineralDepositSystem;
    this.worldLayout = worldLayout;
    this.unsubscribeMapOverlayPreference = subscribeMapOverlayPreference(() => {
      this.applyMapOverlayPreference();
    });
    this.applyMapOverlayPreference();
    this.unsubscribeConstellationPreference = subscribeConstellationPreference(() => {
      this.sky.updateConstellationVisibility(areConstellationGuidesEnabled() ? 1 : 0);
    });
    this.roadMeshBuilder = new RoadMeshBuilder(this.terrain, materials, this.getBridgeSamplingContext());
    this.dryStoneWallRenderer = new DryStoneWallRenderer({
      terrain: this.terrain,
      parent: this.roadGroup,
      previewParent: this.previewGroup,
    });

    this.roadGroup.name = 'Road network visuals';
    this.junctionGroup.name = 'Road junction visuals';
    this.previewGroup.name = 'Road preview root';
    this.selectionGroup.name = 'Road selection root';
    this.buildingAccessSpurs = new BuildingAccessSpurs({
      parent: this.roadGroup,
      terrain: this.terrain,
      meshBuilder: this.roadMeshBuilder,
    });

    this.scene.add(
      this.sky,
      this.terrain.mesh,
      this.riverSystem.group,
      this.quarrySystem.group,
      this.clayDepositSystem.group,
      this.mineralDepositSystem.group,
      this.roadGroup,
      this.junctionGroup,
      this.previewGroup,
      this.selectionGroup,
    );
    this.precipitation = new PrecipitationRenderer(this.camera, this.scene);
    this.addLighting();
    this.postProcessor = createPostProcessor(
      backend,
      this.scene,
      this.camera,
      this.illustratedMap.scene,
    );
    this.unsubscribeShadowPreferences = subscribeShadowPreferences(() => this.applyShadowPreferences());
    this.applyShadowPreferences();
  }

  static async create(
    container: HTMLElement,
    settings: WorldGenerationSettings,
    onProgress?: (progress: SceneLoadProgress) => void,
    materialsPromise?: Promise<RoadMaterialFactory>,
    startupTexturesPromise?: Promise<SceneStartupTextures>,
  ): Promise<SceneManager> {
    onProgress?.({
      label: 'Loading graphics',
      detail: 'Renderer, roads, sky, and river textures',
      phase: 'graphics',
      fraction: 0,
    });
    const backendPromise = createPreferredRenderer();
    // Start the immutable forest cache/network path as soon as the renderer
    // reports its anisotropy limit. Road and river startup textures may still
    // be decoding at this point, so this creates more useful overlap than
    // waiting for the entire graphics Promise.all barrier below.
    void backendPromise
      .then((backend) => {
        if (backend.kind !== 'webgpu') return;
        return import('../vegetation/seedthree/seedThreeForestBuilder.ts')
          .then(({ preloadSeedThreeForestAssets }) => (
            preloadSeedThreeForestAssets(backend.maxAnisotropy)
          ));
      })
      .catch(() => undefined);
    const [backend, materials, startupTextures] = await Promise.all([
      backendPromise,
      materialsPromise ?? Promise.resolve(RoadMaterialFactory.createProgressive(8)),
      startupTexturesPromise ?? beginProgressiveStartupTextureLoad(),
    ]);
    applyMaxAnisotropy(startupTextures, backend.maxAnisotropy);
    markStartupCheckpoint('renderer ready');
    container.appendChild(backend.renderer.domElement);
    onProgress?.({
      label: 'Loading graphics',
      detail: 'Renderer, roads, sky, and river textures',
      phase: 'graphics',
      fraction: 1,
    });

    onProgress?.({
      label: 'Building world',
      detail: 'River layout, stone, clay, iron, salt, and terrain',
      phase: 'worldFeatures',
      fraction: 0,
    });
    const dimensions = resolveWorldDimensions(settings.mapSize);
    const worldLayout = createWorldLayout(settings);
    const {
      clayDepositLayout,
      mineralDepositLayout,
      quarryLayout,
      riverLayout,
    } = worldLayout;
    setActiveRiverLayout(riverLayout);
    setActiveQuarryLayout(quarryLayout);
    setActiveClayDepositLayout(clayDepositLayout);
    const startupData = await loadTerrainStartupData(
      settings,
      dimensions,
      worldLayout,
      (completedRows, totalRows, source) => {
        onProgress?.({
          label: 'Building world',
          detail: source === 'cache'
            ? 'Restoring generated terrain'
            : `Shaping terrain (${completedRows}/${totalRows})`,
          phase: 'terrain',
          fraction: completedRows / totalRows,
        });
      },
    );
    const riverField = RiverField.fromSerialized(startupData.riverField, riverLayout);
    const terrain = Terrain.fromGeometryData(
      materials.createTerrainMaterialWithRiverShore(dimensions.terrainSize),
      startupData.terrain,
      dimensions,
    );
    await yieldToMain();
    markStartupCheckpoint('terrain mesh ready');

    onProgress?.({
      label: 'Building world',
      detail: 'River water and mineral deposits',
      phase: 'worldFeatures',
      fraction: 0.55,
    });
    await yieldToMain();
    const riverSystem = await createRiverSystem(
      terrain,
      riverField,
      materials.riverBank,
      startupTextures.riverRock,
      backend.maxAnisotropy,
      backend.kind,
    );
    const quarrySystem = createQuarrySystem(terrain, quarryLayout, startupTextures.quarryRock);
    const clayDepositSystem = createClayDepositSystem(terrain, clayDepositLayout);
    const mineralDepositSystem = createMineralDepositSystem(terrain, mineralDepositLayout);
    await yieldToMain();
    markStartupCheckpoint('river and quarry systems ready');

    onProgress?.({
      label: 'Building world',
      detail: 'Sky and scene lighting',
      phase: 'worldFeatures',
      fraction: 1,
    });
    const manager = new SceneManager(
      container,
      backend,
      materials,
      startupTextures,
      terrain,
      riverSystem,
      quarrySystem,
      clayDepositSystem,
      mineralDepositSystem,
      worldLayout,
    );
    markStartupCheckpoint('scene manager ready');
    void manager.sky.ready.catch((error) => {
      console.warn('Sky volumetric shader still compiling:', error);
    });
    return manager;
  }

  loadCelestialSky(): Promise<void> {
    return this.sky.loadCelestialSky();
  }

  preloadTexture(texture: THREE.Texture): void {
    (this.renderer as StartupPrecompilableRenderer).initTexture(texture);
  }

  get celestialGenerationMs(): number | null {
    return this.sky.celestialGenerationMs;
  }

  /**
   * Makes hydrated startup textures resident and compiles the exact live scene
   * material variants before gameplay can schedule its first animation frame.
   */
  async precompileFirstPlayableScene(): Promise<void> {
    const renderer = this.renderer as StartupPrecompilableRenderer;
    this.sky.preloadCelestialTexture(renderer);
    await renderer.compileAsync(this.scene, this.camera);
  }

  waitForFirstPlayableGpuWork(): Promise<void> {
    return this.waitForSubmittedWork();
  }

  /** Builds forest and grass after the first frame — same bundle, no dynamic import. */
  async finishVegetation(): Promise<void> {
    if (this.vegetationBuilt) return;
    this.vegetationBuilt = true;
    this.vegetationBuildActive = true;

    try {
      await this.buildVegetation();
    } finally {
      // SeedThree temporarily retargets the renderer while baking foliage
      // atlases. Never interleave the normal screen pipeline with that work.
      this.vegetationBuildActive = false;
    }
  }

  private async buildVegetation(): Promise<void> {
    const startedAt = performance.now();
    const stages: Record<string, number> = {};
    const startStage = <T>(name: string, factory: () => T | Promise<T>): Promise<T> => {
      const stageStartedAt = performance.now();
      return Promise.resolve(factory())
        .finally(() => {
          stages[name] = performance.now() - stageStartedAt;
        });
    };
    const isForagingSiteBlocked = (x: number, z: number) =>
      this.riverSystem.isBlockedAt(x, z)
      || this.quarrySystem.isBlockedAt(x, z)
      || this.clayDepositSystem.isBlockedAt(x, z)
      || this.mineralDepositSystem.isBlockedAt(x, z);
    const deerVisualsPromise = startStage('deer', () => deerVisualModulePromise.then(({
      createDeerWildlifeVisuals,
    }) => createDeerWildlifeVisuals(
        this.terrain,
        this.worldLayout.foragingLayout.sites,
        this.worldLayout.foragingLayout.seed,
        {
          isSpawnBlockedAt: isForagingSiteBlocked,
          isMovementBlockedAt: (x, z) => this.quarrySystem.isBlockedAt(x, z),
        },
      ))).catch((error: unknown) => {
      console.warn('Animated deer model could not be loaded:', error);
      return null;
    });
    const fishVisualsPromise = startStage('fish', () => fishVisualModulePromise.then(({
      createFishWildlifeVisuals,
    }) => createFishWildlifeVisuals(
        this.terrain,
        this.worldLayout.foragingLayout.sites,
        this.worldLayout.foragingLayout.seed,
        {
          isWaterAt: (x, z) => this.riverSystem.field.isRenderedWetAt(x, z),
          getWaterSurfaceY: (x, z) =>
            getStillWaterSurfaceY(this.terrain, this.riverSystem.field, x, z),
        },
      ))).catch((error: unknown) => {
      console.warn('Animated fish model could not be loaded:', error);
      return null;
    });
    const berryPatchPromise = startStage('berry', () => createBerryPatchVisuals(
        this.terrain,
        this.worldLayout.foragingLayout.sites,
        this.maxAnisotropy,
        this.rendererBackend,
        this.worldLayout.foragingLayout.seed,
        isForagingSiteBlocked,
      ));
    const grassFieldPromise = GRASS_BLADES_ENABLED
      ? startStage('grass', () => createGrassBladeField(this.terrain, {
          isBlockedAt: (x, z) =>
            this.riverSystem.isGrassBlockedAt(x, z)
            || this.quarrySystem.isGrassBlockedAt(x, z)
            || this.clayDepositSystem.isGrassBlockedAt(x, z)
            || this.mineralDepositSystem.isGrassBlockedAt(x, z)
            || (getActivePlacedBuildingLayout()?.isBlockedForGrass(x, z) ?? false),
          maxAnisotropy: this.maxAnisotropy,
          rendererBackend: this.rendererBackend,
        }))
      : Promise.resolve(null);
    const worldDetailsPromise = startStage('details', () => Promise.all([
      this.riverSystem.finishDetails(),
      this.quarrySystem.finishDetails(),
    ]));
    const forestPromise = startStage('forest', () => createForestProps(
      this.terrain,
      this.maxAnisotropy,
      {
        isBlockedAt: (x, z) =>
          this.riverSystem.isBlockedAt(x, z)
          || this.quarrySystem.isBlockedAt(x, z)
          || this.clayDepositSystem.isBlockedAt(x, z)
          || this.mineralDepositSystem.isBlockedAt(x, z),
        rendererBackend: this.rendererBackend,
        webgpuRenderer: this.rendererBackend === 'webgpu' ? this.renderer : undefined,
        treeSeed: this.worldLayout.treeSeed,
        densityScale: forestDensityScale(this.worldLayout.settings.forestDensity),
        forestCores: this.worldLayout.forestCores,
        treePlacements: this.resolveForestTreePlacements(),
      },
    ));
    const mushroomPatchPromise = startStage('mushrooms', () => (
      createMushroomPatchVisuals(
        this.terrain,
        this.worldLayout.foragingLayout.sites,
        this.worldLayout.foragingLayout.seed,
        isForagingSiteBlocked,
        this.maxAnisotropy,
      )
    ));

    const [forestManager] = await Promise.all([forestPromise, worldDetailsPromise]);
    this.forestManager = forestManager;
    this.forestManager.setDistantCanopyCardsEnabled(
      areDistantCanopyCardsEnabled(),
    );
    // Environment sync can precede deferred vegetation creation. Seed the new
    // forest from the retained presentation state before its first scene frame.
    if (this.environment) {
      this.forestManager.setDeciduousFoliage(this.environment.deciduousFoliage);
      this.forestManager.setSnowCoverage(this.environment.snowCoverage);
    }
    this.berryPatchVisuals = await berryPatchPromise;
    this.scene.add(this.berryPatchVisuals.group);
    this.mushroomPatchVisuals = await mushroomPatchPromise;
    this.scene.add(this.mushroomPatchVisuals.group);
    this.deerWildlifeVisuals = await deerVisualsPromise;
    if (this.deerWildlifeVisuals) this.scene.add(this.deerWildlifeVisuals.group);
    this.fishWildlifeVisuals = await fishVisualsPromise;
    if (this.fishWildlifeVisuals) this.scene.add(this.fishWildlifeVisuals.group);
    this.applyForagingVisualState();
    if (GRASS_BLADES_ENABLED) {
      this.grassField = await grassFieldPromise;
      if (this.grassField) this.scene.add(this.grassField.group);
      // Keep reeds at the scene root; their explicit render order lets the
      // water film veil submerged stems while the grass-blocked shore band
      // prevents competing ground blades around their rooted bases.
      this.scene.attach(this.riverSystem.reedsGroup);
    }

    this.scene.add(this.forestManager.group);
    if (this.roadNetworkRef) {
      this.forestManager.syncRoadClearance(this.roadNetworkRef);
    }
    this.refreshForestClearance();
    this.grassField?.syncPlacementClearance([
      ...this.forestClearanceFarmFieldPolygons,
      ...this.forestClearanceBackyardGardenPolygons,
    ]);

    if (this.roadNetworkRef) {
      this.grassField?.syncRoadClearance(this.roadNetworkRef);
      this.refreshShadowMap();
    }

    this.applyShadowPreferences();
    (window as typeof window & {
      __medievalRoadStartup: { vegetation?: VegetationStartupTiming };
    }).__medievalRoadStartup.vegetation = {
      totalMs: performance.now() - startedAt,
      stages,
    };
  }

  applyShadowPreferences(): void {
    if (!this.sunLight) return;
    syncShadowCasters({
      sunLight: this.sunLight,
      forestManager: this.forestManager,
      propGroups: [
        this.riverSystem.group,
        this.quarrySystem.group,
        this.clayDepositSystem.group,
        this.mineralDepositSystem.group,
      ],
      buildingRoot: this.selectionGroup,
    });
    this.refreshShadowMap();
  }

  setDistantCanopyCardsEnabled(enabled: boolean): void {
    this.forestManager?.setDistantCanopyCardsEnabled(enabled);
  }

  invalidateStaticShadows(): void {
    this.refreshShadowMap();
  }

  /** Queue a paced atlas redraw after an animated caster changes pose. */
  invalidateDynamicShadows(): void {
    this.dynamicShadowCastersChanged = true;
  }

  applyMapOverlayPreference(): void {
    this.setMapOverlaySelection(getMapOverlaySelection());
  }

  isHydrologyOverlayVisible(): boolean {
    return this.hydrologyOverlay?.isVisible() ?? false;
  }

  /** Compatibility hook for callers that only know about the legacy water layer. */
  setHydrologyOverlayVisible(visible: boolean): void {
    this.setMapOverlaySelection({
      ...this.mapOverlaySelection,
      mode: visible ? 'water' : 'none',
    });
  }

  setMapOverlaySelection(selection: MapOverlaySelection): void {
    this.mapOverlaySelection = selection;
    this.applyMapOverlayVisibility();
  }

  setCropSuitabilityOverlayCrop(crop: FarmCrop | null): void {
    if (crop === this.cropSuitabilityCrop) return;
    this.cropSuitabilityCrop = crop;
    this.applyMapOverlayVisibility();
  }

  syncCommunityReach(
    settlements: ReadonlyMap<string, SettlementState>,
    buildings: ReadonlyMap<string, BuildingState>,
    residences: ReadonlyMap<string, ResidenceState>,
  ): void {
    this.communitySettlements = settlements;
    this.communityBuildings = buildings;
    this.communityResidences = residences;
    this.communityReachOverlay?.setState(
      this.communitySettlements.values(),
      this.communityBuildings.values(),
      this.communityResidences.values(),
    );
  }

  setVineyardSuitabilityOverlayVisible(visible: boolean): void {
    if (visible === this.vineyardSuitabilityActive) return;
    this.vineyardSuitabilityActive = visible;
    this.applyMapOverlayVisibility();
  }

  private applyMapOverlayVisibility(): void {
    const fieldCrop = this.cropSuitabilityCrop;
    const placementSuitabilityActive = fieldCrop !== null || this.vineyardSuitabilityActive;
    const mode = placementSuitabilityActive ? 'fertility' : this.mapOverlaySelection.mode;
    const crop = fieldCrop ?? this.mapOverlaySelection.crop;

    if (mode === 'water' && !this.hydrologyOverlay) {
      this.hydrologyOverlay = new HydrologyOverlay({
        terrain: this.terrain,
        riverField: this.riverSystem.field,
        parent: this.scene,
      });
    }
    if (mode === 'wind' && !this.windOverlay) {
      this.windOverlay = new WindOverlay({
        terrain: this.terrain,
        parent: this.scene,
      });
    }
    if (mode === 'fertility') {
      if (!this.cropSuitabilityOverlay) {
        this.cropSuitabilityOverlay = new CropSuitabilityOverlay({
          terrain: this.terrain,
          parent: this.scene,
          regionContext: {
            worldSeed: this.worldLayout.seed,
            mapSize: this.worldLayout.settings.mapSize,
          },
        });
      }
      if (this.vineyardSuitabilityActive && fieldCrop === null) {
        this.cropSuitabilityOverlay.setVineyard();
      } else {
        this.cropSuitabilityOverlay.setCrop(crop);
      }
    }
    if (mode === 'communities' && !this.communityReachOverlay) {
      this.communityReachOverlay = new CommunityReachOverlay({
        terrain: this.terrain,
        parent: this.scene,
      });
      this.communityReachOverlay.setState(
        this.communitySettlements.values(),
        this.communityBuildings.values(),
        this.communityResidences.values(),
      );
    }

    this.hydrologyOverlay?.setVisible(mode === 'water');
    this.windOverlay?.setVisible(mode === 'wind');
    this.cropSuitabilityOverlay?.setVisible(mode === 'fertility');
    this.communityReachOverlay?.setVisible(mode === 'communities');
  }

  resize(): void {
    const rect = this.container.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    this.terrainProjector.setViewportRect(rect);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    // One device pixel per CSS pixel is the quality/performance sweet spot for
    // the dense ground-cover and close camera. Supersampling here turned the
    // most detailed playable view into a sub-30 FPS presentation.
    const pixelRatio = Math.min(window.devicePixelRatio, 1);
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(width, height, false);
    this.postProcessor.setPixelRatio(pixelRatio);
    this.postProcessor.setSize(width, height);
    this.sky.updateResolution(width * pixelRatio, height * pixelRatio);
  }

  setIllustratedMapImage(
    canvas: HTMLCanvasElement,
    stampCanvas: HTMLCanvasElement,
    bounds: TerrainBounds,
  ): void {
    this.illustratedMap.setCanvases(canvas, stampCanvas, bounds);
  }

  invalidateIllustratedMapImage(): void {
    this.illustratedMap.invalidateTextures();
  }

  setIllustratedMapActive(active: boolean): void {
    this.illustratedMapActive = active;
  }

  isIllustratedMapActive(): boolean {
    return this.illustratedMapActive;
  }

  getRenderOwner(): SceneRenderOwner {
    return resolveSceneRenderOwner(
      this.illustratedMapActive,
      this.illustratedMap.ready,
    );
  }

  isIllustratedMapReady(): boolean {
    return this.illustratedMap.ready;
  }

  setIllustratedMapDebugMode(mode: IllustratedMapDebugMode): void {
    this.illustratedMap.setDebugMode(mode);
  }

  setBuildInteractionActive(active: boolean): void {
    if (this.buildInteractionActive === active) {
      this.grassField?.setBuildInteractionActive(active);
      return;
    }
    this.buildInteractionActive = active;
    this.grassField?.setBuildInteractionActive(active);
    if (!active) {
      this.refreshShadowMap();
    }
  }

  setRoadDraftActive(active: boolean): void {
    this.grassField?.setRoadDraftActive(active);
  }

  private rebuildRockSpatialIndex(): void {
    const rocks = [
      ...(this.forestManager?.rockPlacements ?? []),
      ...this.riverSystem.getShoreRockPlacements(),
      ...this.quarrySystem.rockPlacements,
    ];
    this.rockSpatialIndex = rocks.length > 0 ? new RockSpatialIndex(rocks) : null;
    this.rockCollisionVersion += 1;
  }

  render(
    dt: number,
    orbitDistance?: number,
    firstPersonActive = false,
    firstPersonCrouching = false,
    cameraInteractionActive = false,
  ): void {
    const rendererInfo = this.renderer.info as unknown as RendererInfoLike;
    const rendererFrameBoundary = beginRendererFrame(rendererInfo);
    if (this.vegetationBuildActive) {
      this.lastRendererFrameStats = readRendererFrameStats(
        rendererInfo,
        rendererFrameBoundary,
      );
      return;
    }
    this.worldAnimationElapsedSeconds += Math.max(0, dt);
    setWorldAnimationTime(this.worldAnimationElapsedSeconds);
    if (this.getRenderOwner() === 'illustrated-map') {
      // The plane follows only the target's elevation. Its X/Z transform stays
      // fixed to world coordinates, preserving pan and orbit semantics.
      this.illustratedMap.setElevation(this.cameraTarget.y);
      this.postProcessor.renderIllustratedMap();
      this.completedRenderFrames++;
      this.lastRendererFrameStats = readRendererFrameStats(
        rendererInfo,
        rendererFrameBoundary,
      );
      return;
    }
    const cameraDistance = orbitDistance ?? this.camera.position.distanceTo(this.cameraTarget);
    // The RTS target is intentionally frozen while first-person mode is active.
    // Center streaming and fitted shadows on the player instead, otherwise the
    // resident forest envelope is left behind as the player walks away.
    const viewFocus = firstPersonActive
      ? this.firstPersonViewFocus.copy(this.camera.position)
      : this.cameraTarget;
    const viewShadowBounds = computeViewShadowBounds(
      this.camera,
      viewFocus,
      cameraDistance,
      1.24,
      this.viewShadowBounds,
    );
    const shadowBounds = intersectTerrainBounds(
      viewShadowBounds,
      this.terrain.bounds,
      this.shadowBounds,
    );
    this.materials.updateWeather(dt);
    this.updateWeatherPresentation(dt);
    updateTerrainZoomBlend(this.terrain, cameraDistance, firstPersonActive);
    this.grassField?.updateCameraState(
      this.camera.position,
      this.cameraTarget,
      cameraDistance,
      firstPersonActive,
    );
    const forestShadowCastersChanged = this.forestManager?.updateCameraState(
      this.camera,
      cameraDistance,
      firstPersonActive,
      shadowBounds,
      cameraInteractionActive,
      dt,
    ) ?? false;
    this.riverSystem.updateCameraState(
      this.camera.position,
      this.cameraTarget,
      cameraDistance,
      firstPersonActive,
    );
    this.sky.updateCamera(this.camera);
    this.sky.updateSun(this.sunDirection);
    this.sky.updateTime(this.skyAnimationTime);
    if (this.lastDayNightState) {
      this.sky.updateSiderealAngle(this.lastDayNightState.siderealAngle);
    }
    this.precipitation.update(dt, cameraDistance, firstPersonActive);
    this.riverSystem.tick(dt, this.worldAnimationElapsedSeconds);
    if (firstPersonActive) {
      this.firstPersonDeerObserver.x = this.camera.position.x;
      this.firstPersonDeerObserver.z = this.camera.position.z;
      this.firstPersonDeerObserver.crouching = firstPersonCrouching;
    }
    const deerShadowCastersChanged = this.deerWildlifeVisuals?.update(
      dt,
      firstPersonActive ? this.firstPersonDeerObserver : null,
      cameraDistance,
      this.gameHabitatLoggingDisturbances,
    ) ?? false;
    if (deerShadowCastersChanged) this.dynamicShadowCastersChanged = true;
    this.fishWildlifeVisuals?.update(dt, cameraDistance, firstPersonActive);
    this.mushroomPatchVisuals?.updateCameraState(cameraDistance, firstPersonActive);
    this.renderFrame++;
    const shadowRefreshNowMs = performance.now();
    const shadowCameraNeedsRefit = this.shouldRefitShadowMap(
      cameraDistance,
      shadowRefreshNowMs,
      viewFocus,
    );
    if (shadowCameraNeedsRefit) {
      fitDirectionalLightShadow(this.sunLight, {
        bounds: shadowBounds,
        sunOffsetDir: this.shadowKeyDirection,
      });
      this.lastShadowTargetX = viewFocus.x;
      this.lastShadowTargetZ = viewFocus.z;
      this.lastShadowDistance = cameraDistance;
      this.lastShadowKeyDirection.copy(this.shadowKeyDirection);
      this.lastDirectionalShadowRefreshMs = shadowRefreshNowMs;
    }
    const dynamicShadowRefreshDue = shouldRefreshDynamicDirectionalShadow(
      this.dynamicShadowCastersChanged,
      shadowRefreshNowMs - this.lastDynamicShadowRefreshMs,
    );
    if (shouldRefreshDirectionalShadowAtlas(
      shadowCameraNeedsRefit,
      forestShadowCastersChanged,
      dynamicShadowRefreshDue,
      firstPersonActive,
      cameraInteractionActive,
    )) {
      this.refreshShadowMap();
      // Any atlas redraw captures the latest animated poses too. Clear the
      // pending invalidation and pace the next dynamic-only refresh from here.
      this.dynamicShadowCastersChanged = false;
      this.lastDynamicShadowRefreshMs = shadowRefreshNowMs;
    }
    if (import.meta.env.VITE_E2E_TEST === '1') {
      // The smoke test exercises the real node-material terrain through the
      // required WebGPU backend. It does not need to spend minutes raymarching
      // the sky and bloom pipeline to prove startup and gameplay compatibility.
      const skyVisible = this.sky.visible;
      const precipitationVisible = this.precipitation.group.visible;
      this.sky.visible = false;
      this.precipitation.group.visible = false;
      this.renderer.render(this.scene, this.camera);
      this.sky.visible = skyVisible;
      this.precipitation.group.visible = precipitationVisible;
      this.completedRenderFrames++;
      this.lastRendererFrameStats = readRendererFrameStats(
        rendererInfo,
        rendererFrameBoundary,
      );
      return;
    }
    this.postProcessor.render(dt);
    this.completedRenderFrames++;
    this.lastRendererFrameStats = readRendererFrameStats(
      rendererInfo,
      rendererFrameBoundary,
    );
  }

  private shouldRefitShadowMap(
    cameraDistance: number,
    nowMs: number,
    viewFocus: THREE.Vector3,
  ): boolean {
    if (!Number.isFinite(this.lastShadowTargetX)) return true;
    if (shouldRefreshDirectionalShadow(
      this.lastShadowKeyDirection.dot(this.shadowKeyDirection),
      nowMs - this.lastDirectionalShadowRefreshMs,
    )) return true;
    // The fitted bounds carry 24% overscan, so the shadow camera can trail a
    // moving view briefly without exposing an unshadowed edge. First-person
    // motion refreshes the atlas separately without needlessly refitting this
    // projection on every frame.
    const interval = this.buildInteractionActive ? 8 : 5;
    if (this.renderFrame % interval !== 0) return false;
    const dx = viewFocus.x - this.lastShadowTargetX;
    const dz = viewFocus.z - this.lastShadowTargetZ;
    if (Math.hypot(dx, dz) > 14) return true;
    return Math.abs(cameraDistance - this.lastShadowDistance) > 12;
  }

  applyDayNight(state: DayNightLightingState): void {
    this.lastDayNightState = state;
    const weather = this.weatherPresentation;
    const atmosphericBlend = weather.atmosphericBlend;
    const weatherFogTint = weather.fogTint.getHex();
    const goldenHour = Math.max(state.dawnAmount, state.duskAmount);
    this.skyAnimationTime = state.skyAnimationTime;
    this.sunDirection.copy(state.sunDirection);
    const moonBlend = THREE.MathUtils.smoothstep(state.nightAmount, 0.08, 0.92);
    this.shadowKeyDirection
      .copy(state.sunDirection)
      .multiplyScalar(1 - moonBlend)
      .addScaledVector(MOON_KEY_DIRECTION, moonBlend)
      .normalize();
    this.sky.updateAtmosphere(state.dawnAmount, state.duskAmount);
    this.sky.updateSiderealAngle(state.siderealAngle);
    this.sunLight.color.setHex(blendColorHex(
      blendColorHex(state.sunColor, 0xb4cee8, moonBlend),
      weatherFogTint,
      atmosphericBlend * 0.28,
    ));
    const daylightKey = state.sunIntensity
      * weather.sunlightMultiplier
      * (1 - moonBlend);
    const moonKey = 0.68
      * moonBlend
      * THREE.MathUtils.lerp(1, 0.72, atmosphericBlend);
    this.sunLight.intensity = daylightKey + moonKey;
    // Keep the sun parallel to the fitted shadow target — not world origin — so panning
    // does not skew directional shadows between shadow-map refits.
    this.sunLight.position
      .copy(this.sunLight.target.position)
      .addScaledVector(this.shadowKeyDirection, 180);
    this.sunLight.updateMatrixWorld();
    this.sunLight.target.updateMatrixWorld();
    this.hemiLight.color.setHex(blendColorHex(state.hemiSkyColor, weatherFogTint, atmosphericBlend * 0.48));
    this.hemiLight.groundColor.setHex(blendColorHex(state.hemiGroundColor, weatherFogTint, atmosphericBlend * 0.2));
    // Night hierarchy comes from a cool directional key and practical lights,
    // not a global gray wash. Keep just enough hemispheric bounce to read the
    // terrain while preserving true material shadows.
    this.hemiLight.intensity = state.hemiIntensity
      * THREE.MathUtils.lerp(1, 0.56, state.nightAmount)
      * THREE.MathUtils.lerp(1, 0.82, atmosphericBlend);
    this.ambientLight.color.setHex(blendColorHex(state.ambientColor, weatherFogTint, atmosphericBlend * 0.34));
    this.ambientLight.intensity = state.ambientIntensity
      * THREE.MathUtils.lerp(1, 0.28, state.nightAmount)
      * THREE.MathUtils.lerp(1, 0.9, atmosphericBlend);
    setBuildingIndirectLightIntensity(
      state.buildingIndirectIntensity
        * THREE.MathUtils.lerp(1, 0.72, state.nightAmount)
        * THREE.MathUtils.lerp(1, 0.84, atmosphericBlend),
    );
    this.skyFillLight.color.setHex(blendColorHex(state.fillColor, weatherFogTint, atmosphericBlend * 0.4));
    this.skyFillLight.intensity = state.fillIntensity
      * THREE.MathUtils.lerp(1, 0.5, state.nightAmount)
      * THREE.MathUtils.lerp(1, 0.86, atmosphericBlend);
    // At night the real sun is below the horizon, so its inverse does not
    // provide a stable photographic fill. Blend to a fixed side/back direction
    // that separates moonlit slopes without adding another light or shadow map.
    this.skyFillDirection
      .copy(this.sunDirection)
      .multiplyScalar(-1)
      .lerp(MOON_FILL_DIRECTION, moonBlend)
      .normalize();
    this.skyFillLight.position.copy(this.skyFillDirection).multiplyScalar(90);
    this.skyFillLight.position.y += 65;
    // Gentle photographic adaptation preserves night legibility without
    // flattening noon or washing out the warm low sun.
    this.renderer.toneMappingExposure = THREE.MathUtils.clamp(
      THREE.MathUtils.lerp(1.08, 1.28, state.nightAmount)
        + goldenHour * 0.075
        + atmosphericBlend * 0.012
        - weather.wetness * 0.025,
      1.03,
      1.34,
    );
    if (this.scene.fog instanceof THREE.FogExp2) {
      this.scene.fog.color.setHex(blendColorHex(state.fogColor, weatherFogTint, atmosphericBlend));
      this.scene.fog.density = state.fogDensity * weather.fogDensityMultiplier;
      this.scene.fog.density = THREE.MathUtils.clamp(
        this.scene.fog.density
          * THREE.MathUtils.lerp(1, 1.06, state.nightAmount),
        0.00042,
        0.001,
      );
    }
    this.dayNightGrade.saturation =
      state.grade.saturation * weather.saturationMultiplier;
    this.dayNightGrade.contrast =
      state.grade.contrast * THREE.MathUtils.lerp(1, 0.95, atmosphericBlend);
    this.dayNightGrade.warmth = Math.max(
      0,
      state.grade.warmth + weather.warmthOffset,
    );
    this.dayNightGrade.nightBlue = state.grade.nightBlue;
    this.dayNightGrade.vignette = state.grade.vignette + atmosphericBlend * 0.025;
    this.postProcessor.setDayNightGrade(this.dayNightGrade);
    this.postProcessor.setWeatherWetness(weather.wetness);
  }

  setEnvironment(environment: EnvironmentState): void {
    this.environment = environment;
    this.weatherPresentationTarget = createWeatherPresentationState(environment);
    // Keep the authored zoom-responsive terrain material in rain. The old
    // conventional rain fallback flattened every close view into a plain green
    // field and discarded the layered dirt system entirely.
    this.terrain.setRainColorMode(false);
    this.terrain.mesh.material = this.fairTerrainMaterial;
    // Keep the complete authored tree/building shadow atlas in every weather
    // state. Rain softens the directional key through its lighting profile,
    // but must not erase contact shadows from the terrain.
    this.terrain.mesh.receiveShadow = true;
    this.materials.setEnvironment(environment);
    this.precipitation.setEnvironment(environment);
    this.forestManager?.setDeciduousFoliage(environment.deciduousFoliage);
    this.forestManager?.setSnowCoverage(environment.snowCoverage);
    if (this.lastDayNightState) this.applyDayNight(this.lastDayNightState);
  }

  private updateWeatherPresentation(dt: number): void {
    const blend = weatherPresentationBlend(dt);
    if (blend <= 0) return;

    const current = this.weatherPresentation;
    const target = this.weatherPresentationTarget;
    current.atmosphericBlend += (target.atmosphericBlend - current.atmosphericBlend) * blend;
    current.sunlightMultiplier += (target.sunlightMultiplier - current.sunlightMultiplier) * blend;
    current.fogDensityMultiplier += (
      target.fogDensityMultiplier - current.fogDensityMultiplier
    ) * blend;
    current.fogTint.lerp(target.fogTint, blend);
    current.saturationMultiplier += (
      target.saturationMultiplier - current.saturationMultiplier
    ) * blend;
    current.warmthOffset += (target.warmthOffset - current.warmthOffset) * blend;
    current.wetness += (target.wetness - current.wetness) * blend;

    if (this.lastDayNightState) this.applyDayNight(this.lastDayNightState);
  }

  getPerformanceStats(): {
    backend: RendererBackendKind;
    frames: number;
    calls: number;
    renderPasses: number;
    triangles: number;
    pixelRatio: number;
  } {
    return {
      backend: this.rendererBackend,
      frames: this.completedRenderFrames,
      calls: this.lastRendererFrameStats.drawCalls,
      renderPasses: this.lastRendererFrameStats.renderPasses,
      triangles: this.lastRendererFrameStats.triangles,
      pixelRatio: this.renderer.getPixelRatio(),
    };
  }

  getRendererAdapterEvidence(): RendererAdapterEvidence {
    return {
      ...this.rendererAdapterEvidence,
      limitations: [...this.rendererAdapterEvidence.limitations],
    };
  }

  getForestManager(): ForestManager | null {
    return this.forestManager;
  }

  /**
   * The one accepted forest layout shared by SeedThree and the illustrated
   * map. No downstream renderer is allowed to regenerate approximate trees.
   */
  whenForestTreePlacementsReady(): Promise<readonly ForestTreeLayout[]> {
    return this.forestTreeLayouts
      ? Promise.resolve(this.forestTreeLayouts)
      : this.forestTreeLayoutsReady;
  }

  private resolveForestTreePlacements(): readonly ForestTreeLayout[] {
    if (this.forestTreeLayouts) return this.forestTreeLayouts;
    const placements = computeForestTreePlacements(
      this.terrain.generationSize,
      this.terrain.size,
      (x, z) =>
        this.riverSystem.isBlockedAt(x, z)
        || this.quarrySystem.isBlockedAt(x, z)
        || this.clayDepositSystem.isBlockedAt(x, z)
        || this.mineralDepositSystem.isBlockedAt(x, z),
      {
        treeSeed: this.worldLayout.treeSeed,
        densityScale: forestDensityScale(this.worldLayout.settings.forestDensity),
        forestCores: this.worldLayout.forestCores,
      },
    );
    this.forestTreeLayouts = placements.map((placement, layoutIndex) => ({
      layoutIndex,
      ...placement,
    }));
    this.resolveForestTreeLayoutsReady?.(this.forestTreeLayouts);
    this.resolveForestTreeLayoutsReady = null;
    return this.forestTreeLayouts;
  }

  syncForagingNodes(nodes: Iterable<ForagingNodeState>, simTick: number): void {
    this.latestForagingNodes = [...nodes];
    this.latestForagingMonth = gameClock(simTick).month;
    this.applyForagingVisualState();
  }

  private applyForagingVisualState(): void {
    this.berryPatchVisuals?.sync(this.latestForagingNodes, this.latestForagingMonth);
    this.mushroomPatchVisuals?.sync(this.latestForagingNodes, this.latestForagingMonth);
    this.deerWildlifeVisuals?.sync(this.latestForagingNodes);
    this.fishWildlifeVisuals?.sync(this.latestForagingNodes);
  }

  getFirstPersonCollisionRoots(): readonly THREE.Object3D[] {
    const solidRootNames = new Set([
      'Building markers',
      'Residences',
      'Backyard gardens',
      'Burgage fencing',
      'Fenced pastures',
    ]);
    return [
      ...this.selectionGroup.children.filter((child) => solidRootNames.has(child.name)),
      this.roadGroup,
    ];
  }

  getRockObstaclesNear(x: number, z: number, radius: number): readonly import('../utils/pathGeometry.ts').RockObstacle[] {
    return this.rockSpatialIndex?.rocksInRadius(x, z, radius) ?? [];
  }

  getRockObstaclesNearInto(
    x: number,
    z: number,
    radius: number,
    results: RockObstacle[],
  ): readonly RockObstacle[] {
    if (!this.rockSpatialIndex) {
      results.length = 0;
      return results;
    }
    return this.rockSpatialIndex.rocksInRadiusInto(x, z, radius, results);
  }

  getRockCollisionVersion(): number {
    return this.rockCollisionVersion;
  }

  getForestCollisionVersion(): number {
    return this.forestManager?.getCollisionVersion() ?? 0;
  }

  setForestClearanceSources(
    buildings: Iterable<BuildingTerrainSource>,
    burgageParcelPolygons: Iterable<Point2[]>,
    farmFieldPolygons: Iterable<Point2[]>,
    backyardGardenPolygons: Iterable<Point2[]> = [],
  ): void {
    const nextBuildings = [...buildings];
    const nextParcelPolygons = [...burgageParcelPolygons];
    const nextFarmFieldPolygons = [...farmFieldPolygons];
    const nextBackyardGardenPolygons = [...backyardGardenPolygons];
    const signature = forestClearanceSourceSignature(
      nextBuildings,
      nextParcelPolygons,
      nextFarmFieldPolygons,
      nextBackyardGardenPolygons,
    );
    if (signature === this.lastForestClearanceSourceSignature) return;
    this.lastForestClearanceSourceSignature = signature;
    this.forestClearanceBuildings = nextBuildings;
    this.forestClearanceBurgageParcelPolygons = nextParcelPolygons;
    this.forestClearanceFarmFieldPolygons = nextFarmFieldPolygons;
    this.forestClearanceBackyardGardenPolygons = nextBackyardGardenPolygons;
    this.refreshForestClearance();
    this.grassField?.syncPlacementClearance([
      ...nextFarmFieldPolygons,
      ...nextBackyardGardenPolygons,
    ]);
  }

  getBridgeSamplingContext(): BridgeSamplingContext {
    const { terrain, riverSystem } = this;
    const riverField = riverSystem.field;
    return {
      isWaterAt: (x, z) => riverField.isRenderedWetAt(x, z),
      getTerrainY: (x, z) => terrain.getHeightAt(x, z),
      getWaterSurfaceY: (x, z) => getStillWaterSurfaceY(terrain, riverField, x, z),
    };
  }

  sampleRoadDeckY(x: number, z: number): number | null {
    const network = this.roadNetworkRef;
    if (!network) return null;
    return sampleRoadSurfaceY(network.edges.values(), x, z);
  }

  setGameHabitatLoggingDisturbances(
    sources: readonly GameHabitatDisturbanceSource[] | undefined,
  ): void {
    this.gameHabitatLoggingDisturbances = sources ?? [];
  }

  getRoadNetwork(): RoadNetwork | null {
    return this.roadNetworkRef;
  }

  syncBuildingAccessRoads(buildings: Iterable<BuildingRoadConnectionSource>): void {
    this.buildingAccessSpurSources = [...buildings].map((building) => ({ ...building }));
    this.buildingAccessSpurs.sync(this.buildingAccessSpurSources, this.roadNetworkRef);
  }

  syncRoadNetwork(network: RoadNetwork): void {
    this.roadNetworkRef = network;
    this.dryStoneWallRenderer.sync(network.dryStoneWalls.values(), network);
    for (const [edgeId, visual] of this.edgeVisuals) {
      if (!network.edges.has(edgeId)) {
        this.roadGroup.remove(visual.group);
        disposeObject3D(visual.group);
        this.edgeVisuals.delete(edgeId);
      }
    }

    for (const edge of network.edges.values()) {
      this.upsertEdge(edge, network);
    }

    this.rebuildJunctions(network);
    this.buildingAccessSpurs.sync(this.buildingAccessSpurSources, network);
    let buildingClearanceYawChanged = false;
    const roadFacingClearanceBuildings = this.forestClearanceBuildings.map((building) => {
      const yaw = buildingPlacementYaw(building.kind, building.x, building.z, network);
      const priorYaw = building.yaw;
      const yawDelta = priorYaw === undefined
        ? Number.POSITIVE_INFINITY
        : Math.atan2(Math.sin(yaw - priorYaw), Math.cos(yaw - priorYaw));
      if (Math.abs(yawDelta) <= 1e-5) return building;
      buildingClearanceYawChanged = true;
      return { ...building, yaw };
    });
    if (buildingClearanceYawChanged) {
      this.forestClearanceBuildings = roadFacingClearanceBuildings;
      this.lastForestClearanceSourceSignature = forestClearanceSourceSignature(
        this.forestClearanceBuildings,
        this.forestClearanceBurgageParcelPolygons,
        this.forestClearanceFarmFieldPolygons,
        this.forestClearanceBackyardGardenPolygons,
      );
      this.refreshForestClearance();
    }
    this.forestManager?.syncRoadClearance(network);
    this.riverSystem.syncRoadClearance(network);
    this.grassField?.syncRoadClearance(network);
    this.rebuildRockSpatialIndex();
    updateTerrainRoadWear(this.terrain, network);
    this.refreshShadowMap();
  }

  syncQuarryNodes(nodes: Iterable<ResourceNodeState>): boolean {
    const snapshot = [...nodes];
    const quarryChanged = this.quarrySystem.syncNodes(snapshot);
    const clayChanged = this.clayDepositSystem.syncNodes(snapshot);
    const mineralChanged = this.mineralDepositSystem.syncNodes(snapshot);
    const changed = quarryChanged || clayChanged || mineralChanged;
    if (!changed) return false;
    this.rebuildRockSpatialIndex();
    this.refreshShadowMap();
    return true;
  }

  private refreshForestClearance(): void {
    this.forestManager?.syncPlacementClearance({
      buildings: this.forestClearanceBuildings,
      burgageParcelPolygons: this.forestClearanceBurgageParcelPolygons,
      farmFieldPolygons: this.forestClearanceFarmFieldPolygons,
    });
    this.riverSystem.syncPlacementClearance(
      this.forestClearanceBuildings,
      this.forestClearanceFarmFieldPolygons,
    );
    this.rebuildRockSpatialIndex();
  }

  private refreshShadowMap(): void {
    if (this.sunLight) {
      this.sunLight.shadow.needsUpdate = true;
    }

    const shadowMap = this.renderer.shadowMap as { needsUpdate?: boolean };
    if ('needsUpdate' in shadowMap) {
      shadowMap.needsUpdate = true;
    }
  }

  getRoadPickMeshes(): THREE.Object3D[] {
    const meshes: THREE.Object3D[] = [];
    for (const visual of this.edgeVisuals.values()) {
      visual.group.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) meshes.push(child);
      });
    }
    return meshes;
  }

  getDryStoneWallPickMeshes(): THREE.Object3D[] {
    return this.dryStoneWallRenderer.getPickMeshes();
  }

  dispose(): void {
    this.unsubscribeShadowPreferences?.();
    this.unsubscribeShadowPreferences = null;
    this.unsubscribeMapOverlayPreference?.();
    this.unsubscribeMapOverlayPreference = null;
    this.unsubscribeConstellationPreference?.();
    this.unsubscribeConstellationPreference = null;
    this.hydrologyOverlay?.dispose();
    this.hydrologyOverlay = null;
    this.windOverlay?.dispose();
    this.windOverlay = null;
    this.cropSuitabilityOverlay?.dispose();
    this.cropSuitabilityOverlay = null;
    this.communityReachOverlay?.dispose();
    this.communityReachOverlay = null;
    this.cropSuitabilityCrop = null;
    this.vineyardSuitabilityActive = false;
    this.buildingAccessSpurs.dispose();
    this.dryStoneWallRenderer.dispose();
    for (const visual of this.edgeVisuals.values()) disposeObject3D(visual.group);
    this.edgeVisuals.clear();
    if (this.forestManager) {
      disposeObject3D(this.forestManager.group);
      this.forestManager.dispose();
    }
    if (this.grassField) {
      this.grassField.dispose();
      disposeObject3D(this.grassField.group);
    }
    if (this.berryPatchVisuals) {
      this.berryPatchVisuals.dispose();
      disposeObject3D(this.berryPatchVisuals.group);
      this.berryPatchVisuals = null;
    }
    if (this.mushroomPatchVisuals) {
      this.mushroomPatchVisuals.dispose();
      disposeObject3D(this.mushroomPatchVisuals.group);
      this.mushroomPatchVisuals = null;
    }
    if (this.deerWildlifeVisuals) {
      this.scene.remove(this.deerWildlifeVisuals.group);
      this.deerWildlifeVisuals.dispose();
      this.deerWildlifeVisuals = null;
    }
    if (this.fishWildlifeVisuals) {
      this.scene.remove(this.fishWildlifeVisuals.group);
      this.fishWildlifeVisuals.dispose();
      this.fishWildlifeVisuals = null;
    }
    this.riverSystem.dispose();
    disposeObject3D(this.riverSystem.group);
    this.quarrySystem.dispose();
    disposeObject3D(this.quarrySystem.group);
    this.clayDepositSystem.dispose();
    this.mineralDepositSystem.dispose();
    setActiveClayDepositLayout(null);
    this.precipitation.dispose();
    this.sky.dispose();
    this.illustratedMap.dispose();
    this.postProcessor.dispose();
    disposeObject3D(this.junctionGroup);
    disposeObject3D(this.previewGroup);
    disposeObject3D(this.selectionGroup);
    // Terrain owns its generated fair-weather node material. Restore it before
    // disposal if the scene happens to close while the shared rain material is
    // active; RoadMaterialFactory disposes the latter exactly once.
    this.terrain.mesh.material = this.fairTerrainMaterial;
    this.terrain.dispose();
    this.materials.dispose();
    disposeVineyardVineResources();
    disposeBuildingMaterialLibrary();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private upsertEdge(edge: RoadEdge, network: RoadNetwork): void {
    const existing = this.edgeVisuals.get(edge.id);
    const topologyKey = this.edgeTopologyKey(edge, network);
    if (
      existing
      && existing.revision === edge.revision
      && existing.topologyKey === topologyKey
    ) return;
    if (existing) {
      this.roadGroup.remove(existing.group);
      disposeObject3D(existing.group);
      this.edgeVisuals.delete(edge.id);
    }
    const group = this.roadMeshBuilder.buildEdge(edge, network);
    this.roadGroup.add(group);
    this.edgeVisuals.set(edge.id, { revision: edge.revision, topologyKey, group });
  }

  private edgeTopologyKey(edge: RoadEdge, network: RoadNetwork): string {
    return [edge.startNodeId, edge.endNodeId].map((nodeId) => {
      const node = network.nodes.get(nodeId);
      if (!node) return `${nodeId}:missing`;
      const incidents = network.getIncidents(node)
        .map((incident) => `${incident.edge.id}:${incident.edge.width.toFixed(3)}`)
        .sort()
        .join(',');
      return `${nodeId}:${incidents}`;
    }).join('|');
  }

  private rebuildJunctions(network: RoadNetwork): void {
    disposeObject3D(this.junctionGroup);
    this.junctionGroup.clear();
    const builder = new RoadJunctionBuilder(this.terrain, this.materials);
    const next = builder.build(network);
    for (const child of [...next.children]) this.junctionGroup.add(child);
  }

  private addLighting(): void {
    const hemi = new THREE.HemisphereLight(0xd9e8ec, 0x59634f, 1.55);
    this.hemiLight = hemi;
    this.scene.add(hemi);

    const ambient = new THREE.AmbientLight(0xb8c8d2, 0.18);
    this.ambientLight = ambient;
    this.scene.add(ambient);

    const sun = new THREE.DirectionalLight(0xffefd2, 5.2);
    sun.name = 'Sun';
    sun.position.copy(this.sunDirection).multiplyScalar(180);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.00008;
    sun.shadow.normalBias = 0.008;
    sun.shadow.radius = 1.8;
    sun.shadow.autoUpdate = false;
    sun.shadow.camera.layers.enable(TREE_SHADOW_CAST_LAYER);
    this.scene.add(sun);
    this.scene.add(sun.target);
    this.sunLight = sun;
    fitDirectionalLightShadow(sun, { bounds: this.terrain.bounds, sunOffsetDir: this.sunDirection });
    this.refreshShadowMap();

    const blueFill = new THREE.DirectionalLight(0xa8c6d8, 0.34);
    blueFill.name = 'Sky fill';
    this.skyFillLight = blueFill;
    blueFill.position.copy(this.sunDirection).multiplyScalar(-90).add(new THREE.Vector3(0, 65, 0));
    this.scene.add(blueFill);
  }

}

function forestClearanceSourceSignature(
  buildings: BuildingTerrainSource[],
  burgageParcelPolygons: Point2[][],
  farmFieldPolygons: Point2[][],
  backyardGardenPolygons: Point2[][],
): string {
  const buildingPart = buildings
    .map((building) => [
      building.kind,
      building.x.toFixed(2),
      building.z.toFixed(2),
      building.yaw?.toFixed(5) ?? 'fallback',
    ].join(':'))
    .sort()
    .join('|');
  const parcelPart = burgageParcelPolygons
    .map((polygon) => polygon
      .map((point) => `${point.x.toFixed(2)},${point.z.toFixed(2)}`)
      .join('-'))
    .sort()
    .join('|');
  const farmFieldPart = farmFieldPolygons
    .map((polygon) => polygon
      .map((point) => `${point.x.toFixed(2)},${point.z.toFixed(2)}`)
      .join('-'))
    .sort()
    .join('|');
  const backyardGardenPart = backyardGardenPolygons
    .map((polygon) => polygon
      .map((point) => `${point.x.toFixed(2)},${point.z.toFixed(2)}`)
      .join('-'))
    .sort()
    .join('|');
  return `${buildingPart}§${parcelPart}§${farmFieldPart}§${backyardGardenPart}`;
}

function blendColorHex(from: number, to: number, amount: number): number {
  const mix = THREE.MathUtils.clamp(amount, 0, 1);
  const fromR = (from >> 16) & 255;
  const fromG = (from >> 8) & 255;
  const fromB = from & 255;
  const toR = (to >> 16) & 255;
  const toG = (to >> 8) & 255;
  const toB = to & 255;
  const r = Math.round(THREE.MathUtils.lerp(fromR, toR, mix));
  const g = Math.round(THREE.MathUtils.lerp(fromG, toG, mix));
  const b = Math.round(THREE.MathUtils.lerp(fromB, toB, mix));
  return (r << 16) | (g << 8) | b;
}

type WeatherPresentationState = Pick<
  PrecipitationProfile,
  | 'atmosphericBlend'
  | 'sunlightMultiplier'
  | 'fogDensityMultiplier'
  | 'saturationMultiplier'
  | 'warmthOffset'
  | 'wetness'
> & {
  fogTint: THREE.Color;
};

function createWeatherPresentationState(
  environment: EnvironmentState | null,
): WeatherPresentationState {
  const profile = precipitationProfile(environment);
  return {
    atmosphericBlend: profile.atmosphericBlend,
    sunlightMultiplier: profile.sunlightMultiplier,
    fogDensityMultiplier: profile.fogDensityMultiplier,
    fogTint: new THREE.Color(profile.fogTint),
    saturationMultiplier: profile.saturationMultiplier,
    warmthOffset: profile.warmthOffset,
    wetness: profile.wetness,
  };
}
