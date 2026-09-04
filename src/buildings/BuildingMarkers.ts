import * as THREE from 'three';
import { CampStandardRenderer } from '../settlement/CampStandardRenderer.ts';
import { edibleFoodStock } from '../economy/foodInventory.ts';
import { breadGrainStock, flourStock, grainSheafStock } from '../economy/cropGoods.ts';
import {
  assignMarketplaceStallRoster,
  indexMarketplaceStallWorkers,
  marketStallRepresentative,
  type IndexedMarketStallWorkerAssignment,
} from '../economy/marketStallAssignments.ts';
import {
  BUILDING_STORAGE_CAPS,
  LIVESTOCK_HAY_STORAGE_CAPACITY,
  MARKETPLACE_FOOD_STALL_SLOTS,
  MARKETPLACE_GOODS_STALL_SLOTS,
  STARTING_GOLD,
  STARTING_IRONWORK,
  STARTING_STONE,
  STARTING_TIMBER,
} from '../generated/gameBalance.ts';
import { disposeObject3D } from '../utils/dispose.ts';
import type {
  BuildingKind,
  BuildingState,
  GameState,
  LivestockHerdState,
} from '../resources/types.ts';
import type { EnvironmentState } from '../world/seasonPolicy.ts';
import { fireDisabledBuildingIds } from '../fires/fireIncident.ts';
import type { Terrain } from '../terrain/Terrain.ts';
import { areBuildingShadowsEnabled } from '../scene/shadowPreference.ts';
import type { RoadNetwork } from '../roads/RoadNetwork.ts';
import {
  buildingPlacementYaw,
  resolvedPlacedBuildingYaw,
} from './buildingPlacement.ts';
import {
  MARKETPLACE_STALL_DISPLAY_KINDS,
  marketStallDisplayName,
} from './marketplaceStallLayout.ts';
import {
  BatchedBuildingShadowProxies,
  setBuildingDetailShadowsEnabled,
} from './buildingShadowProxy.ts';
import { createBuildingMesh } from './BuildingMeshes.ts';
import {
  MARKET_RECEIPT_VISUAL_CAPACITY,
  MARKET_STAGING_VISUAL_SEGMENTS,
} from './meshes/marketplaceMesh.ts';
import {
  LOCAL_RECEIPT_VISUAL_CAPACITY,
} from './meshes/expandedBuildingMeshes.ts';
import {
  animateCampfire,
  disposeCampfire,
  FOUNDERS_CAMP_STONE_WINTER_ACCUMULATION_NAME,
  FOUNDERS_CAMP_TIMBER_WINTER_ACCUMULATION_NAME,
  setCampfireNightLighting,
  setFoundersCampWinterAccumulation,
} from './meshes/foundersCampMesh.ts';
import { refreshFoundersCampColorBatches } from './foundersCampColorBatch.ts';
import { setFireEffectActive } from '../fires/FireEffect.ts';
import {
  constructionDeliveredRatio,
  createConstructionSiteMesh,
} from './ConstructionSiteMesh.ts';
import { buildingMeshSignature } from './buildingMarkerSignature.ts';
import { buildingUsesCompletedMesh } from './buildingVisualState.ts';
import {
  FOUNDING_STONE_VISUAL_SEGMENTS,
  FOUNDING_TIMBER_VISUAL_SEGMENTS,
  FOUNDING_IRONWORK_VISUAL_SEGMENTS,
  SALVAGE_GOODS_VISUAL_CAPACITY,
  SALVAGE_STONE_VISUAL_CAPACITY,
  SALVAGE_TIMBER_VISUAL_CAPACITY,
  stockpileVisualLevel,
  syncStockpileSegments,
  STOREHOUSE_FIREWOOD_VISUAL_SEGMENTS,
  STOREHOUSE_IRON_VISUAL_SEGMENTS,
  STOREHOUSE_CLAY_VISUAL_SEGMENTS,
  STOREHOUSE_SALT_VISUAL_SEGMENTS,
  STOREHOUSE_STONE_VISUAL_SEGMENTS,
  STOREHOUSE_TIMBER_VISUAL_SEGMENTS,
} from './buildingStockpileVisuals.ts';
import {
  createBuildingPreviewMesh,
  disposeBuildingPreviewMesh,
  updateBuildingPreviewAppearance,
  updateBuildingPreviewGeometry,
} from './BuildingPlacementPreview.ts';
import type { BuildingPlacementWildlifePreview } from './buildingPlacementWildlifePreview.ts';
import { syncFoodStockpileVisuals } from './foodStockpileVisuals.ts';
import { syncBulkStockpileVisuals } from './bulkStockpileVisuals.ts';
import { syncArmoryStockpileVisuals } from './armoryStockpileVisuals.ts';
import { syncSeasonalStockpileVisuals } from './seasonalStockpileVisuals.ts';
import { syncMarketplaceSpecialtyStockpileVisuals } from './marketplaceSpecialtyStockpileVisuals.ts';
import { syncMonasteryStockpileVisuals } from './monasteryStockpileVisuals.ts';
import {
  CHARCOAL_CLAMP_SMOKE_NAME,
  setCharcoalClampSmokeThroughput,
} from './meshes/materialChainBuildingMeshes.ts';
import { processorOutputTargetForBuilding } from '../economy/processorOutputPolicy.ts';
import { batchCompletedBuildingStaticMeshes } from './staticBuildingBatch.ts';
import { BuildingStaticBatches } from './BuildingStaticBatches.ts';
import { refreshBuildingDetailCasterBatches } from './buildingDetailShadowBatch.ts';
import { getActiveWorldGeneration } from '../world/worldGenerationContext.ts';
import {
  windSiteThroughputMultiplier,
  windWeatherThroughputMultiplier,
} from '../wind/windField.ts';
import { MarketplaceSupplyLinks } from './MarketplaceSupplyLinks.ts';
import { WellServiceCoverage } from './WellServiceCoverage.ts';
import type { GameClock } from '../world/gameCalendar.ts';
import { setTierOneChurchClockTime } from './chapelRuntimeClock.ts';

type BuildingMarkersOptions = {
  terrain: Terrain;
  parent: THREE.Group;
  getRoadNetwork?: () => RoadNetwork | null;
  onShadowCastersChanged?: () => void;
};

type LivestockBuildingVisualState = {
  hayStock: number;
  hayStorageCapacity: number;
};

export class BuildingMarkers {
  private readonly terrain: Terrain;
  private readonly getRoadNetwork?: () => RoadNetwork | null;
  private readonly onShadowCastersChanged?: () => void;
  private readonly group = new THREE.Group();
  private readonly buildingMeshes = new Map<string, THREE.Group>();
  private readonly buildingStates = new Map<string, BuildingState>();
  private readonly shadowProxyBatch: BatchedBuildingShadowProxies;
  private readonly staticBatches: BuildingStaticBatches;
  private readonly campfiresByMarker = new Map<THREE.Group, THREE.Group[]>();
  private readonly campStandards: CampStandardRenderer;
  private readonly watermillWheels = new Set<THREE.Group>();
  private readonly windmillSails = new Map<THREE.Group, number>();
  private campfireNightLighting = 0;
  private foundersCampWinterAccumulation = false;
  private watermillThroughputMultiplier = 1;
  private windmillWeatherThroughputMultiplier = 1;
  private charcoalBurnerThroughputMultiplier = 1;
  private readonly marketplaceSupplyLinks: MarketplaceSupplyLinks;
  private readonly wellServiceCoverage: WellServiceCoverage;
  private wellServiceCoverageBuildingId: string | null = null;
  private previewBuilding: THREE.Group | null = null;
  private previewKind: BuildingKind | null = null;
  private lastPreviewSignature = '';
  private pendingPlacement: THREE.Group | null = null;
  private pendingPlacementKind: BuildingKind | null = null;
  private pendingPlacementX = 0;
  private pendingPlacementZ = 0;
  private prewarmedFoundersCamp: THREE.Group | null = null;
  private prewarmedFoundersCampPreview: THREE.Group | null = null;
  private destroyedBuildingIds = new Set<string>();

  constructor(options: BuildingMarkersOptions) {
    this.terrain = options.terrain;
    this.getRoadNetwork = options.getRoadNetwork;
    this.onShadowCastersChanged = options.onShadowCastersChanged;
    this.group.name = 'Building markers';
    this.campStandards = new CampStandardRenderer(this.group, (x, z) => this.terrain.getHeightAt(x, z));
    this.staticBatches = new BuildingStaticBatches(this.group);
    this.shadowProxyBatch = new BatchedBuildingShadowProxies(
      this.group,
      'Batched completed-building shadow proxies',
      areBuildingShadowsEnabled(),
    );
    this.marketplaceSupplyLinks = new MarketplaceSupplyLinks({
      parent: this.group,
      terrain: this.terrain,
    });
    this.wellServiceCoverage = new WellServiceCoverage(this.group, this.terrain);
    options.parent.add(this.group);
  }

  setBuildingSelectionOverlays(
    building: BuildingState | null,
    gameState?: GameState,
  ): void {
    const fireDisabled = fireDisabledBuildingIds(
      gameState?.fireIncidents.values() ?? [],
    );
    this.syncMarketplaceSupplyLinks(building, gameState, fireDisabled);
  }

  setMarketplaceServiceCoverage(
    marketplaceId: string | null,
    residenceIds: ReadonlySet<string>,
    gameState?: GameState,
  ): void {
    const marketplace = marketplaceId == null
      ? null
      : gameState?.buildings.get(marketplaceId) ?? null;
    this.marketplaceSupplyLinks.syncResidenceService(
      marketplace?.kind === 'marketplace' ? marketplace : null,
      gameState?.residences.values() ?? [],
      residenceIds,
    );
  }

  setWellServiceCoverage(building: BuildingState | null): void {
    this.wellServiceCoverageBuildingId = building?.id ?? null;
    this.wellServiceCoverage.sync(building);
  }

  private syncWellServiceCoverage(force = false): void {
    this.wellServiceCoverage.sync(
      this.buildingStates.get(this.wellServiceCoverageBuildingId ?? '') ?? null,
      force,
    );
  }

  syncBuildings(
    buildings: Iterable<BuildingState>,
    livestockHerds?: ReadonlyMap<string, LivestockHerdState>,
    issuedGuardPolearms?: ReadonlyMap<string, number>,
  ): void {
    const livestockVisualsByBuilding = new Map<string, LivestockBuildingVisualState>();
    for (const herd of livestockHerds?.values() ?? []) {
      const prior = livestockVisualsByBuilding.get(herd.buildingId);
      livestockVisualsByBuilding.set(
        herd.buildingId,
        {
          hayStock: (prior?.hayStock ?? 0) + Math.max(0, herd.hayStock),
          hayStorageCapacity: (prior?.hayStorageCapacity ?? 0)
            + (herd.species === 'swine' ? 0 : LIVESTOCK_HAY_STORAGE_CAPACITY),
        },
      );
    }
    const nextIds = new Set<string>();
    for (const building of buildings) {
      nextIds.add(building.id);
      const priorState = this.buildingStates.get(building.id);
      if (
        priorState === building
        && this.buildingMeshes.has(building.id)
        && livestockVisualsByBuilding.has(building.id) !== true
        && issuedGuardPolearms?.has(building.id) !== true
      ) {
        continue;
      }
      this.buildingStates.set(building.id, building);
      this.upsertBuilding(
        building,
        livestockVisualsByBuilding.get(building.id),
        issuedGuardPolearms?.get(building.id) ?? 0,
      );
      const marker = this.buildingMeshes.get(building.id);
      if (marker?.userData.skipNextDetailCasterRefresh === true) {
        delete marker.userData.skipNextDetailCasterRefresh;
      } else if (marker) {
        refreshBuildingDetailCasterBatches(marker);
      }
    }

    for (const id of this.buildingMeshes.keys()) {
      if (nextIds.has(id)) continue;
      this.removeBuilding(id);
    }
    this.syncMarketplaceStallVisuals();
    this.syncWellServiceCoverage();
    this.staticBatches.finalizeGeometryBuffers();
    if (this.shadowProxyBatch.flush()) {
      this.onShadowCastersChanged?.();
    }
  }

  private syncMarketplaceStallVisuals(): void {
    const network = this.getRoadNetwork?.() ?? null;
    const roster = network
      ? assignMarketplaceStallRoster(
        this.buildingStates.values(),
        (ax, az, bx, bz) => network.getPathfinder().roadPathDistance(ax, az, bx, bz),
      )
      : { stalls: [], workers: [] };
    const indexedWorkers = indexMarketplaceStallWorkers(roster);
    for (const marketplace of this.buildingStates.values()) {
      if (
        marketplace.kind !== 'marketplace'
        || marketplace.constructionComplete === false
      ) {
        continue;
      }
      const marketAssignments = roster.stalls.filter(
        (assignment) => assignment.marketplaceId === marketplace.id,
      );
      const foodAssignments = marketAssignments.filter(
        (assignment) => assignment.group === 'food',
      );
      const goodsAssignments = marketAssignments.filter(
        (assignment) => assignment.group === 'goods',
      );
      const foodWorkers = indexedWorkers.filter(
        (worker) => worker.marketplaceId === marketplace.id && worker.group === 'food',
      );
      const goodsWorkers = indexedWorkers.filter(
        (worker) => worker.marketplaceId === marketplace.id && worker.group === 'goods',
      );
      const marker = this.buildingMeshes.get(marketplace.id);
      if (!marker) continue;
      for (let index = 0; index < MARKETPLACE_FOOD_STALL_SLOTS; index += 1) {
        const foodStall = marker.getObjectByName(`MarketFoodStall${index}`);
        if (foodStall) {
          const worker = foodWorkers.find(
            (candidate) => candidate.marketplaceSlotIndex === index,
          );
          this.syncMarketplaceTable(foodStall, worker, 'food', marketplace);
        }
      }
      for (let index = 0; index < MARKETPLACE_GOODS_STALL_SLOTS; index += 1) {
        const goodsStall = marker.getObjectByName(`MarketGoodsStall${index}`);
        if (goodsStall) {
          const worker = goodsWorkers.find(
            (candidate) => candidate.marketplaceSlotIndex === index,
          );
          this.syncMarketplaceTable(goodsStall, worker, 'goods', marketplace);
        }
      }
      marker.userData.marketFoodStalls = foodAssignments.length;
      marker.userData.marketGoodsStalls = goodsAssignments.length;
      marker.userData.marketFoodWorkers = foodWorkers.length;
      marker.userData.marketGoodsWorkers = goodsWorkers.length;
      marker.userData.marketStallAssignments = marketAssignments;
    }
  }

  private syncMarketplaceTable(
    table: THREE.Object3D,
    worker: IndexedMarketStallWorkerAssignment | undefined,
    group: 'food' | 'goods',
    marketplace: BuildingState,
  ): void {
    const source = worker == null
      ? undefined
      : this.buildingStates.get(worker.workplaceId);
    const representative = source != null && worker?.needKind != null
      ? marketStallRepresentative(source, marketplace, worker.needKind)
      : null;
    table.visible = worker != null;
    table.userData.marketNeedKind = worker?.needKind ?? undefined;
    table.userData.marketCommodityKind = representative?.commodityKind;
    table.userData.marketDisplayKind = representative?.displayKind;
    table.userData.marketWorkplaceId = worker?.workplaceId;
    table.userData.marketWorkplaceSlotIndex = worker?.workplaceSlotIndex;
    for (const displayKind of MARKETPLACE_STALL_DISPLAY_KINDS[group]) {
      const display = table.getObjectByName(marketStallDisplayName(displayKind));
      if (display) display.visible = representative?.displayKind === displayKind;
    }
  }

  getRoadConnectionSources(): Array<
    Pick<BuildingState, 'id' | 'kind' | 'x' | 'z' | 'constructionComplete'> & { yaw: number }
  > {
    const sources: Array<
      Pick<BuildingState, 'id' | 'kind' | 'x' | 'z' | 'constructionComplete'> & { yaw: number }
    > = [];
    for (const [id, building] of this.buildingStates) {
      const marker = this.buildingMeshes.get(id);
      if (!marker || this.destroyedBuildingIds.has(id)) continue;
      sources.push({
        id,
        kind: building.kind,
        x: building.x,
        z: building.z,
        yaw: marker.rotation.y,
        constructionComplete: buildingUsesCompletedMesh(building),
      });
    }
    return sources;
  }

  /**
   * Rebase every rendered building after the terrain heightfield changes.
   * Building-state identity is deliberately ignored here: adding a terrain
   * pad changes the correct Y transform without changing the authoritative
   * building row that created the marker.
   */
  refreshTerrainHeights(): void {
    this.syncWellServiceCoverage(true);
    let moved = false;
    for (const [id, building] of this.buildingStates) {
      const marker = this.buildingMeshes.get(id);
      if (!marker) continue;
      const y = this.terrain.getHeightAt(building.x, building.z);
      if (Math.abs(marker.position.y - y) <= 1e-6) continue;

      marker.position.y = y;
      moved = true;
      this.staticBatches.updateBuilding(id, marker, marker.visible);
      if (
        marker.visible
        && building.constructionComplete !== false
        && building.kind !== 'founders_camp'
      ) {
        this.shadowProxyBatch.upsertBuilding(
          id,
          building.kind,
          marker,
          building.chapelTier ?? 3,
        );
      }
    }

    if (!moved) return;
    this.staticBatches.finalizeGeometryBuffers();
    this.shadowProxyBatch.flush();
    this.onShadowCastersChanged?.();
  }

  /**
   * Resolve legacy rows after startup road hydration. Persisted building yaw
   * always wins, so editing roads can never turn an already placed structure.
   */
  refreshRoadFacingOrientations(): void {
    const network = this.getRoadNetwork?.() ?? null;
    if (!network) return;

    for (const [id, building] of this.buildingStates) {
      const marker = this.buildingMeshes.get(id);
      if (!marker) continue;
      const yaw = resolvedPlacedBuildingYaw(building, network);
      const yawDelta = Math.atan2(
        Math.sin(yaw - marker.rotation.y),
        Math.cos(yaw - marker.rotation.y),
      );
      if (Math.abs(yawDelta) <= 1e-5) continue;

      marker.rotation.y = yaw;
      marker.position.y = this.terrain.getHeightAt(building.x, building.z);
      this.staticBatches.updateBuilding(id, marker, marker.visible);
      if (
        marker.visible
        && building.constructionComplete !== false
        && building.kind !== 'founders_camp'
      ) {
        this.shadowProxyBatch.upsertBuilding(
          id,
          building.kind,
          marker,
          building.chapelTier ?? 3,
        );
      }
    }

    this.staticBatches.finalizeGeometryBuffers();
    if (this.shadowProxyBatch.flush()) {
      this.onShadowCastersChanged?.();
    }
  }

  setDestroyedBuildingIds(ids: ReadonlySet<string>): void {
    if (setsEqual(this.destroyedBuildingIds, ids)) return;
    this.destroyedBuildingIds = new Set(ids);
    for (const [id, marker] of this.buildingMeshes) {
      const building = this.buildingStates.get(id);
      const destroyed = ids.has(id);
      marker.visible = !destroyed;
      if (building) this.syncCampfireOccupancy(marker, building);
      this.staticBatches.setBuildingVisible(id, !destroyed);
      if (
        destroyed
        || !building
        || building.constructionComplete === false
        || building.kind === 'founders_camp'
      ) {
        this.shadowProxyBatch.remove(id);
      } else {
        this.shadowProxyBatch.upsertBuilding(
          id,
          building.kind,
          marker,
          building.chapelTier ?? 3,
        );
      }
    }
    this.staticBatches.finalizeGeometryBuffers();
    if (this.shadowProxyBatch.flush()) {
      this.onShadowCastersChanged?.();
    }
  }

  setCampfireNightLighting(nightLighting: number): void {
    this.campfireNightLighting = THREE.MathUtils.clamp(nightLighting, 0, 1);
    for (const campfires of this.campfiresByMarker.values()) {
      for (const campfire of campfires) {
        setCampfireNightLighting(campfire, this.campfireNightLighting);
      }
    }
  }

  setEnvironment(
    environment: Pick<
      EnvironmentState,
      | 'season'
      | 'weather'
      | 'watermillThroughputMultiplier'
      | 'charcoalBurnerThroughputMultiplier'
    > | null,
  ): void {
    this.watermillThroughputMultiplier = Math.max(
      0,
      environment?.watermillThroughputMultiplier ?? 1,
    );
    this.windmillWeatherThroughputMultiplier = windWeatherThroughputMultiplier(
      environment?.weather ?? 'fair',
    );
    this.charcoalBurnerThroughputMultiplier = Math.max(
      0,
      environment?.charcoalBurnerThroughputMultiplier ?? 1,
    );
    for (const marker of this.buildingMeshes.values()) {
      setCharcoalClampSmokeThroughput(
        marker,
        this.charcoalBurnerThroughputMultiplier,
      );
    }
    const winterAccumulation = environment?.season === 'winter';
    if (winterAccumulation === this.foundersCampWinterAccumulation) return;
    this.foundersCampWinterAccumulation = winterAccumulation;
    for (const marker of this.buildingMeshes.values()) {
      if (marker.name !== "Founders' camp and open stockyard") continue;
      setFoundersCampWinterAccumulation(marker, winterAccumulation);
      refreshBuildingDetailCasterBatches(marker);
    }
  }

  tick(dtSeconds: number): void {
    this.campStandards.sync(this.buildingMeshes.values(), dtSeconds);
    for (const campfires of this.campfiresByMarker.values()) {
      for (const campfire of campfires) animateCampfire(campfire, dtSeconds);
    }
    const wheelRotation = Math.min(Math.max(dtSeconds, 0), 0.1)
      * 0.55
      * this.watermillThroughputMultiplier;
    for (const wheel of this.watermillWheels) {
      wheel.rotation.x -= wheelRotation;
    }
    const sailRotation = Math.min(Math.max(dtSeconds, 0), 0.1) * 0.24;
    for (const [sails, siteThroughput] of this.windmillSails) {
      sails.rotation.z -= sailRotation
        * siteThroughput
        * this.windmillWeatherThroughputMultiplier;
    }
  }

  clearPlacementPreview(): void {
    if (this.previewBuilding) this.previewBuilding.visible = false;
    this.lastPreviewSignature = '';
  }

  setChapelTowerClock(
    clock: Pick<GameClock, 'hour' | 'minute' | 'preciseHour'>,
  ): void {
    for (const marker of this.buildingMeshes.values()) {
      setTierOneChurchClockTime(marker, clock);
    }
  }

  prewarmFoundersCampPlacement(): void {
    if (
      this.pendingPlacementKind === 'founders_camp'
      || [...this.buildingStates.values()].some((building) => building.kind === 'founders_camp')
    ) return;
    if (!this.prewarmedFoundersCamp) {
      this.prewarmedFoundersCamp = createBuildingMesh('founders_camp');
      syncInitialFoundersCampVisualState(this.prewarmedFoundersCamp);
      setFoundersCampWinterAccumulation(
        this.prewarmedFoundersCamp,
        this.foundersCampWinterAccumulation,
      );
      batchCompletedBuildingStaticMeshes(this.prewarmedFoundersCamp);
      setBuildingDetailShadowsEnabled(
        this.prewarmedFoundersCamp,
        areBuildingShadowsEnabled(),
      );
    }
    if (
      !this.prewarmedFoundersCampPreview
      && !(this.previewBuilding && this.previewKind === 'founders_camp')
    ) {
      // Flatten the already-created camp instead of constructing the entire
      // authored model a second time solely for its placement ghost.
      this.prewarmedFoundersCampPreview = createBuildingPreviewMesh(
        'founders_camp',
        this.prewarmedFoundersCamp,
      );
    }
  }

  /**
   * Temporarily exposes the prebuilt founding camp and reusable placement
   * preview while the loading screen is compiling the live scene. Keeping the
   * roots detached during normal startup avoids stray world objects, but
   * excluding them from compileAsync makes the first click pay that cost.
   */
  beginFoundersCampGpuPrewarm(): {
    objects: readonly THREE.Object3D[];
    restore: () => void;
  } {
    this.prewarmFoundersCampPlacement();
    const marker = this.prewarmedFoundersCamp;
    const preview = this.prewarmedFoundersCampPreview;
    const objects: THREE.Object3D[] = [];
    const restores: Array<() => void> = [];

    if (marker && !marker.parent) {
      const previousVisible = marker.visible;
      const previousPosition = marker.position.clone();
      marker.visible = true;
      marker.position.set(0, this.terrain.getHeightAt(0, 0), 0);
      this.group.add(marker);
      objects.push(marker);
      const standardPrewarm = this.campStandards.beginGpuPrewarm(marker);
      objects.push(...standardPrewarm.objects);
      restores.push(standardPrewarm.restore);
      restores.push(() => {
        if (marker === this.prewarmedFoundersCamp && marker.parent === this.group) {
          marker.removeFromParent();
          marker.visible = previousVisible;
          marker.position.copy(previousPosition);
        }
      });
    }

    if (preview && !preview.parent) {
      const previousVisible = preview.visible;
      updateBuildingPreviewAppearance(preview, true);
      updateBuildingPreviewGeometry(
        preview,
        'founders_camp',
        0,
        0,
        buildingPlacementYaw('founders_camp', 0, 0, this.getRoadNetwork?.() ?? null),
        this.terrain.getHeightAt.bind(this.terrain),
      );
      preview.visible = true;
      this.group.add(preview);
      objects.push(preview);
      restores.push(() => {
        if (
          preview === this.prewarmedFoundersCampPreview
          && preview.parent === this.group
        ) {
          preview.removeFromParent();
          preview.visible = previousVisible;
        }
      });
    }

    return {
      objects,
      restore: () => {
        for (const restore of restores) restore();
      },
    };
  }

  showPendingPlacement(kind: BuildingKind, x: number, z: number, yaw?: number): void {
    this.clearPendingPlacement();
    const marker = kind === 'founders_camp'
      ? this.takeFoundersCampMesh()
      : createConstructionSiteMesh(kind, 0, 0, 0);
    marker.name = 'Pending building placement';
    marker.rotation.y = yaw ?? buildingPlacementYaw(kind, x, z, this.getRoadNetwork?.() ?? null);
    marker.position.set(x, this.terrain.getHeightAt(x, z), z);
    this.pendingPlacement = marker;
    this.pendingPlacementKind = kind;
    this.pendingPlacementX = x;
    this.pendingPlacementZ = z;
    this.group.add(marker);
  }

  clearPendingPlacement(): void {
    if (!this.pendingPlacement) return;
    this.pendingPlacement.removeFromParent();
    if (this.pendingPlacementKind === 'founders_camp' && !this.prewarmedFoundersCamp) {
      this.prewarmedFoundersCamp = this.pendingPlacement;
    } else {
      disposeObject3D(this.pendingPlacement);
    }
    this.pendingPlacement = null;
    this.pendingPlacementKind = null;
  }

  setPlacementPreview(
    kind: BuildingKind,
    x: number,
    z: number,
    valid: boolean,
    visible: boolean,
    wildlifePreview?: BuildingPlacementWildlifePreview,
    placementYaw?: number,
  ): void {
    const yaw = placementYaw ?? buildingPlacementYaw(kind, x, z, this.getRoadNetwork?.() ?? null);
    const signature = `${kind}|${x.toFixed(2)}|${z.toFixed(2)}|${yaw.toFixed(5)}|${valid ? 1 : 0}|${visible ? 1 : 0}|${wildlifePreview?.signature ?? ''}`;
    if (signature === this.lastPreviewSignature) return;
    this.lastPreviewSignature = signature;
    if (!visible) {
      if (this.previewBuilding) this.previewBuilding.visible = false;
      return;
    }

    if (!this.previewBuilding || this.previewKind !== kind) {
      if (this.previewBuilding) {
        disposeBuildingPreviewMesh(this.previewBuilding);
        this.previewBuilding.removeFromParent();
      }
      this.previewBuilding = kind === 'founders_camp'
        ? this.takeFoundersCampPreview()
        : createBuildingPreviewMesh(kind);
      this.previewKind = kind;
      this.group.add(this.previewBuilding);
    }
    updateBuildingPreviewAppearance(this.previewBuilding, valid);

    updateBuildingPreviewGeometry(
      this.previewBuilding,
      kind,
      x,
      z,
      yaw,
      this.terrain.getHeightAt.bind(this.terrain),
      wildlifePreview,
    );
    this.previewBuilding.visible = true;
  }

  dispose(): void {
    this.campStandards.dispose();
    this.clearPendingPlacement();
    if (this.prewarmedFoundersCamp) {
      disposeObject3D(this.prewarmedFoundersCamp);
      this.prewarmedFoundersCamp = null;
    }
    if (this.prewarmedFoundersCampPreview) {
      this.prewarmedFoundersCampPreview.removeFromParent();
      disposeBuildingPreviewMesh(this.prewarmedFoundersCampPreview);
      this.prewarmedFoundersCampPreview = null;
    }
    if (this.previewBuilding) {
      disposeBuildingPreviewMesh(this.previewBuilding);
      this.previewBuilding = null;
      this.previewKind = null;
    }
    this.marketplaceSupplyLinks.dispose();
    this.wellServiceCoverage.dispose();
    for (const id of [...this.buildingMeshes.keys()]) {
      this.removeBuilding(id);
    }
    this.staticBatches.dispose();
    this.shadowProxyBatch.dispose();
    this.group.removeFromParent();
  }

  private syncMarketplaceSupplyLinks(
    building: BuildingState | null,
    gameState: GameState | undefined,
    fireDisabled: ReadonlySet<string>,
  ): void {
    const network = this.getRoadNetwork?.() ?? null;
    if (
      !gameState
      || !network
      || (
        building?.kind !== 'granary'
        && building?.kind !== 'village_storehouse'
        && building?.kind !== 'marketplace'
      )
    ) {
      this.marketplaceSupplyLinks.sync(null, [], []);
      return;
    }

    const roster = assignMarketplaceStallRoster(
      gameState.buildings.values(),
      (ax, az, bx, bz) => network.getPathfinder().roadPathDistance(ax, az, bx, bz),
      fireDisabled,
    );
    this.marketplaceSupplyLinks.sync(
      building,
      gameState.buildings.values(),
      roster.stalls,
    );
  }

  private upsertBuilding(
    building: BuildingState,
    livestock?: LivestockBuildingVisualState,
    issuedGuardPolearms = 0,
  ): void {
    if (building.kind === 'founders_camp' && this.prewarmedFoundersCampPreview) {
      // An already-founded world cannot enter starter-camp placement. Release
      // the unused detached preview instead of carrying it through GPU warmup.
      this.prewarmedFoundersCampPreview.removeFromParent();
      disposeBuildingPreviewMesh(this.prewarmedFoundersCampPreview);
      this.prewarmedFoundersCampPreview = null;
    }
    let marker = this.buildingMeshes.get(building.id);
    let markerNeedsRegistration = false;
    let adoptedPendingFoundersCamp = false;
    const timberRatio = constructionDeliveredRatio(
      building.constructionDeliveredTimber,
      building.constructionRequiredTimber,
    );
    const stoneRatio = constructionDeliveredRatio(
      building.constructionDeliveredStone,
      building.constructionRequiredStone,
    );
    const ironworkRatio = constructionDeliveredRatio(
      building.constructionDeliveredIronwork ?? 0,
      building.constructionRequiredIronwork ?? 0,
    );
    const roofTilesRatio = constructionDeliveredRatio(
      building.constructionDeliveredRoofTiles ?? 0,
      building.constructionRequiredRoofTiles ?? 0,
    );
    const operational = building.constructionComplete !== false;
    const useCompletedMesh = buildingUsesCompletedMesh(building);
    const visualSignature = buildingMeshSignature(building);
    if (marker && marker.userData.visualSignature !== visualSignature) {
      this.unregisterCampfires(marker);
      this.unregisterWatermillWheel(marker);
      this.unregisterWindmillSails(marker);
      this.staticBatches.removeBuilding(building.id);
      this.group.remove(marker);
      disposeObject3D(marker);
      this.buildingMeshes.delete(building.id);
      marker = undefined;
    }
    if (
      !marker
      && operational
      && building.kind === 'founders_camp'
      && this.pendingPlacementKind === 'founders_camp'
      && Math.hypot(
        building.x - this.pendingPlacementX,
        building.z - this.pendingPlacementZ,
      ) <= 0.5
    ) {
      marker = this.pendingPlacement ?? undefined;
      this.pendingPlacement = null;
      this.pendingPlacementKind = null;
      markerNeedsRegistration = marker !== undefined;
      adoptedPendingFoundersCamp = marker !== undefined;
    }
    if (!marker) {
      marker = useCompletedMesh
        ? building.kind === 'founders_camp'
          ? this.takeFoundersCampMesh()
          : createBuildingMesh(
              building.kind,
              building.chapelTier ?? 3,
              building.kind === 'monastery'
                  ? {
                    orchard: 0,
                    croft: 0,
                    extensions: building.monasteryExtensions ?? 0,
                    orchardMaturity: building.monasteryOrchardMaturity ?? 2,
                  }
                : undefined,
            )
        : createConstructionSiteMesh(
            building.kind,
            building.constructionProgress,
            timberRatio,
            stoneRatio,
            ironworkRatio,
            roofTilesRatio,
          );
      markerNeedsRegistration = true;
    }
    if (markerNeedsRegistration) {
      marker.userData.visualSignature = visualSignature;
      if (building.kind === 'founders_camp') {
        marker.name = "Founders' camp and open stockyard";
      }
      if (marker.userData.fpCollisionChildrenOnly !== true) {
        marker.userData.fpCollisionAggregate = true;
      }
      if (useCompletedMesh && !adoptedPendingFoundersCamp) {
        setBuildingDetailShadowsEnabled(marker, areBuildingShadowsEnabled());
      }
      marker.rotation.y = resolvedPlacedBuildingYaw(
        building,
        this.getRoadNetwork?.() ?? null,
      );
      this.buildingMeshes.set(building.id, marker);
      if (marker.parent !== this.group) this.group.add(marker);
      this.registerWatermillWheel(marker);
      this.registerWindmillSails(marker, building);
      setCharcoalClampSmokeThroughput(
        marker,
        this.charcoalBurnerThroughputMultiplier,
      );
      if (building.kind === 'founders_camp' && !adoptedPendingFoundersCamp) {
        setFoundersCampWinterAccumulation(
          marker,
          this.foundersCampWinterAccumulation,
        );
      }
      this.registerCampfires(marker);
      if (operational) {
        if (!marker.userData.staticBuildingBatchStats) {
          batchCompletedBuildingStaticMeshes(marker);
        }
        // Founders' camps use a locally merged, GPU-prewarmed structure. Their
        // small bounded count gains little from cross-building packing, while
        // adopting one into those buffers made confirmation visibly hitch.
        if (building.kind !== 'founders_camp') {
          this.staticBatches.registerBuilding(building.id, marker);
        }
      }
    }

    marker.rotation.y = resolvedPlacedBuildingYaw(
      building,
      this.getRoadNetwork?.() ?? null,
    );
    const y = this.terrain.getHeightAt(building.x, building.z);
    marker.position.set(building.x, y, building.z);
    const destroyed = this.destroyedBuildingIds.has(building.id);
    marker.visible = !destroyed;
    this.syncCampfireOccupancy(marker, building);
    this.staticBatches.updateBuilding(building.id, marker, !destroyed);
    if (operational && !destroyed && building.kind !== 'founders_camp') {
      this.shadowProxyBatch.upsertBuilding(
        building.id,
        building.kind,
        marker,
        building.chapelTier ?? 3,
      );
    } else {
      this.shadowProxyBatch.remove(building.id);
    }
    if (operational || building.kind === 'salvage_pile') {
      syncBuildingVisualState(marker, building, livestock, issuedGuardPolearms);
    }
    if (
      adoptedPendingFoundersCamp
      && foundersCampMatchesInitialVisualState(building)
    ) {
      marker.userData.skipNextDetailCasterRefresh = true;
    }
  }

  private takeFoundersCampMesh(): THREE.Group {
    const marker = this.prewarmedFoundersCamp ?? createBuildingMesh('founders_camp');
    this.prewarmedFoundersCamp = null;
    return marker;
  }

  private takeFoundersCampPreview(): THREE.Group {
    const preview = this.prewarmedFoundersCampPreview
      ?? createBuildingPreviewMesh('founders_camp');
    this.prewarmedFoundersCampPreview = null;
    return preview;
  }

  private removeBuilding(id: string): void {
    const marker = this.buildingMeshes.get(id);
    if (!marker) return;
    this.unregisterCampfires(marker);
    this.unregisterWatermillWheel(marker);
    this.unregisterWindmillSails(marker);
    this.staticBatches.removeBuilding(id);
    this.shadowProxyBatch.remove(id);
    this.group.remove(marker);
    // Construction materials and textures belong to BuildingMaterialLibrary;
    // individual buildings own only their geometry.
    disposeObject3D(marker);
    this.buildingMeshes.delete(id);
    this.buildingStates.delete(id);
  }

  private registerCampfires(marker: THREE.Group): void {
    const campfires: THREE.Group[] = [];
    marker.traverse((object) => {
      if (!(object instanceof THREE.Group) || object.userData.runtimeCampfireEffect !== true) return;
      setCampfireNightLighting(object, this.campfireNightLighting);
      campfires.push(object);
    });
    if (campfires.length > 0) this.campfiresByMarker.set(marker, campfires);
  }

  private syncCampfireOccupancy(marker: THREE.Group, building: BuildingState): void {
    const campfires = this.campfiresByMarker.get(marker);
    if (!campfires) return;
    // Occupancy, not production, fuel stock, or the workday schedule, owns a
    // campfire. Founders remain occupants until their shelters are packed up.
    const occupied = building.kind === 'founders_camp'
      ? building.foundingShelterActive !== false
      : building.assignedLabor > 0;
    const lit = occupied
      && building.constructionComplete !== false
      && !this.destroyedBuildingIds.has(building.id);
    for (const campfire of campfires) {
      setFireEffectActive(campfire, lit);
      if (lit) animateCampfire(campfire, 0);
    }
  }

  private unregisterCampfires(marker: THREE.Group): void {
    for (const campfire of this.campfiresByMarker.get(marker) ?? []) {
      disposeCampfire(campfire);
    }
    this.campfiresByMarker.delete(marker);
  }

  private registerWatermillWheel(marker: THREE.Group): void {
    const wheel = marker.getObjectByName('Watermill wheel');
    if (wheel instanceof THREE.Group) this.watermillWheels.add(wheel);
  }

  private unregisterWatermillWheel(marker: THREE.Group): void {
    const wheel = marker.getObjectByName('Watermill wheel');
    if (wheel instanceof THREE.Group) this.watermillWheels.delete(wheel);
  }

  private registerWindmillSails(marker: THREE.Group, building: BuildingState): void {
    const sails = marker.getObjectByName('Windmill sails');
    if (sails instanceof THREE.Group) {
      this.windmillSails.set(
        sails,
        windSiteThroughputMultiplier(
          getActiveWorldGeneration().seed,
          building.x,
          building.z,
        ),
      );
    }
  }

  private unregisterWindmillSails(marker: THREE.Group): void {
    const sails = marker.getObjectByName('Windmill sails');
    if (sails instanceof THREE.Group) this.windmillSails.delete(sails);
  }
}

function setsEqual<T>(left: ReadonlySet<T>, right: ReadonlySet<T>): boolean {
  if (left.size !== right.size) return false;
  for (const value of left) {
    if (!right.has(value)) return false;
  }
  return true;
}

function syncBuildingVisualState(
  marker: THREE.Group,
  building: BuildingState,
  livestock?: LivestockBuildingVisualState,
  issuedGuardPolearms = 0,
): void {
  if (building.kind === 'founders_camp') {
    const shelters = marker.getObjectByName('FoundingShelters');
    if (shelters) shelters.visible = building.foundingShelterActive !== false;
    const timber = marker.getObjectByName('FoundingTimberStockpile');
    if (timber instanceof THREE.Group) {
      const visibleCount = syncStockpileSegments(
        timber,
        'FoundingTimberSegment',
        building.timber,
        BUILDING_STORAGE_CAPS.founders_camp.timber,
      );
      const accumulation = timber.getObjectByName(
        FOUNDERS_CAMP_TIMBER_WINTER_ACCUMULATION_NAME,
      );
      if (accumulation instanceof THREE.InstancedMesh) {
        accumulation.count = visibleCount;
      }
    }
    const stone = marker.getObjectByName('FoundingStoneStockpile');
    if (stone instanceof THREE.Group) {
      const visibleCount = syncStockpileSegments(
        stone,
        'FoundingStoneSegment',
        building.stone,
        BUILDING_STORAGE_CAPS.founders_camp.stone,
      );
      const accumulation = stone.getObjectByName(
        FOUNDERS_CAMP_STONE_WINTER_ACCUMULATION_NAME,
      );
      if (accumulation instanceof THREE.InstancedMesh) {
        accumulation.count = visibleCount;
      }
    }
    const chest = marker.getObjectByName('FoundingTreasuryChest');
    if (chest) chest.visible = building.gold > 1e-6;
    const ironwork = marker.getObjectByName('FoundingIronworkStockpile');
    if (ironwork instanceof THREE.Group) {
      syncStockpileSegments(
        ironwork,
        'FoundingIronworkSegment',
        building.ironwork ?? 0,
        BUILDING_STORAGE_CAPS.founders_camp.ironwork ?? 0,
      );
    }
    marker.userData.foundingTimberSegments = FOUNDING_TIMBER_VISUAL_SEGMENTS;
    marker.userData.foundingStoneSegments = FOUNDING_STONE_VISUAL_SEGMENTS;
    marker.userData.foundingIronworkSegments = FOUNDING_IRONWORK_VISUAL_SEGMENTS;
    refreshFoundersCampColorBatches(marker);
  }
  if (building.kind === 'town_hall') {
    const chest = marker.getObjectByName('TownHallTreasuryChest');
    if (chest) chest.visible = building.gold > 1e-6;
  }
  if (building.kind === 'chapel') {
    const chest = marker.getObjectByName('ChapelCofferChest');
    if (chest) chest.visible = building.gold > 1e-6;
  }
  if (building.kind === 'monastery') {
    const chest = marker.getObjectByName('MonasteryTreasuryChest');
    if (chest instanceof THREE.Group) {
      syncStockpileSegments(
        chest,
        'MonasteryGoldSegment',
        building.gold,
        LOCAL_RECEIPT_VISUAL_CAPACITY,
      );
    }
  }
  if (building.kind === 'salvage_pile') {
    const timber = marker.getObjectByName('SalvageTimberStockpile');
    if (timber instanceof THREE.Group) {
      syncStockpileSegments(
        timber,
        'SalvageTimberSegment',
        building.timber,
        SALVAGE_TIMBER_VISUAL_CAPACITY,
      );
    }
    const stone = marker.getObjectByName('SalvageStoneStockpile');
    if (stone instanceof THREE.Group) {
      syncStockpileSegments(
        stone,
        'SalvageStoneSegment',
        building.stone,
        SALVAGE_STONE_VISUAL_CAPACITY,
      );
    }
    const goods = marker.getObjectByName('SalvageCratedGoods');
    if (goods instanceof THREE.Group) {
      syncStockpileSegments(
        goods,
        'SalvageGoodsSegment',
        building.firewood
          + building.water
          + edibleFoodStock(building)
          + breadGrainStock(building)
          + grainSheafStock(building)
          + (building.barley ?? 0)
          + (building.malt ?? 0)
          + flourStock(building)
          + building.ale
          + building.wine
          + (building.ironwork ?? 0)
          + (building.polearms ?? 0)
          + (building.iron ?? 0)
          + (building.clay ?? 0)
          + (building.salt ?? 0)
          + (building.charcoal ?? 0)
          + (building.pottery ?? 0)
          + (building.roofTiles ?? 0)
          + (building.wool ?? 0)
          + (building.flax ?? 0)
          + (building.cloth ?? 0)
          + (building.hides ?? 0)
          + (building.leather ?? 0)
          + (building.shoes ?? 0),
        SALVAGE_GOODS_VISUAL_CAPACITY,
      );
    }
    const chest = marker.getObjectByName('SalvageTreasuryChest');
    if (chest) chest.visible = building.gold > 1e-6;
  }
  if (building.kind === 'marketplace') {
    const proceedsChest = marker.getObjectByName('MarketProceedsChest');
    if (proceedsChest instanceof THREE.Group) {
      syncStockpileSegments(
        proceedsChest,
        'MarketReceiptSegment',
        building.gold,
        MARKET_RECEIPT_VISUAL_CAPACITY,
      );
    }
    const timber = marker.getObjectByName('MarketTimberStaging');
    if (timber instanceof THREE.Group) {
      syncStockpileSegments(
        timber,
        'MarketTimberStageSegment',
        building.timber,
        BUILDING_STORAGE_CAPS.marketplace.timber,
      );
    }
    const stone = marker.getObjectByName('MarketStoneStaging');
    if (stone instanceof THREE.Group) {
      syncStockpileSegments(
        stone,
        'MarketStoneStageSegment',
        building.stone,
        BUILDING_STORAGE_CAPS.marketplace.stone,
      );
    }
    const crates = marker.getObjectByName('MarketCratedGoodsStaging');
    if (crates instanceof THREE.Group) {
      const stagedCratedGoods =
        building.firewood
        + edibleFoodStock(building)
        + building.ale
        + (building.cloth ?? 0)
        + (building.hides ?? 0)
        + (building.leather ?? 0)
        + (building.shoes ?? 0)
        + (building.pottery ?? 0);
      const cratedCapacity =
        BUILDING_STORAGE_CAPS.marketplace.firewood
        + BUILDING_STORAGE_CAPS.marketplace.food
        + BUILDING_STORAGE_CAPS.marketplace.preservedFood
        + BUILDING_STORAGE_CAPS.marketplace.ale
        + (BUILDING_STORAGE_CAPS.marketplace.cloth ?? 0)
        + (BUILDING_STORAGE_CAPS.marketplace.hides ?? 0)
        + (BUILDING_STORAGE_CAPS.marketplace.leather ?? 0)
        + (BUILDING_STORAGE_CAPS.marketplace.shoes ?? 0)
        + (BUILDING_STORAGE_CAPS.marketplace.pottery ?? 0);
      syncStockpileSegments(
        crates,
        'MarketCratedStageSegment',
        stagedCratedGoods,
        cratedCapacity,
      );
    }
    marker.userData.marketStagingSegments = MARKET_STAGING_VISUAL_SEGMENTS;
  }
  if (building.kind === 'village_storehouse' || building.kind === 'trading_post') {
    const storageCaps = BUILDING_STORAGE_CAPS[building.kind] as Partial<Record<
      'timber' | 'stone' | 'firewood' | 'iron' | 'clay' | 'salt',
      number
    >>;
    const timber = marker.getObjectByName('StorehouseTimberStockpile');
    if (timber instanceof THREE.Group) {
      syncStockpileSegments(
        timber,
        'StorehouseTimberSegment',
        building.timber,
        storageCaps.timber ?? 0,
      );
    }
    const stone = marker.getObjectByName('StorehouseStoneStockpile');
    if (stone instanceof THREE.Group) {
      syncStockpileSegments(
        stone,
        'StorehouseStoneSegment',
        building.stone,
        storageCaps.stone ?? 0,
      );
    }
    const firewood = marker.getObjectByName('StorehouseFirewoodStockpile');
    if (firewood instanceof THREE.Group) {
      syncStockpileSegments(
        firewood,
        'StorehouseFirewoodSegment',
        building.firewood,
        storageCaps.firewood ?? 0,
      );
    }
    const iron = marker.getObjectByName('StorehouseIronStockpile');
    if (iron instanceof THREE.Group) {
      syncStockpileSegments(
        iron,
        'StorehouseIronSegment',
        building.iron ?? 0,
        storageCaps.iron ?? 0,
      );
    }
    const clay = marker.getObjectByName('StorehouseClayStockpile');
    if (clay instanceof THREE.Group) {
      syncStockpileSegments(
        clay,
        'StorehouseClaySegment',
        building.clay ?? 0,
        storageCaps.clay ?? 0,
      );
    }
    const salt = marker.getObjectByName('StorehouseSaltStockpile');
    if (salt instanceof THREE.Group) {
      syncStockpileSegments(
        salt,
        'StorehouseSaltSegment',
        building.salt ?? 0,
        storageCaps.salt ?? 0,
      );
    }
    marker.userData.storehouseTimberSegments = STOREHOUSE_TIMBER_VISUAL_SEGMENTS;
    marker.userData.storehouseStoneSegments = STOREHOUSE_STONE_VISUAL_SEGMENTS;
    marker.userData.storehouseFirewoodSegments = STOREHOUSE_FIREWOOD_VISUAL_SEGMENTS;
    marker.userData.storehouseIronSegments = STOREHOUSE_IRON_VISUAL_SEGMENTS;
    marker.userData.storehouseClaySegments = STOREHOUSE_CLAY_VISUAL_SEGMENTS;
    marker.userData.storehouseSaltSegments = STOREHOUSE_SALT_VISUAL_SEGMENTS;
    const proceedsChest = marker.getObjectByName('TradingPostProceedsChest');
    if (proceedsChest instanceof THREE.Group) {
      syncStockpileSegments(
        proceedsChest,
        'TradingPostReceiptSegment',
        building.kind === 'trading_post' ? building.gold : 0,
        MARKET_RECEIPT_VISUAL_CAPACITY,
      );
    }
  }
  if (building.kind === 'charcoal_burner') {
    const smoke = marker.getObjectByName(CHARCOAL_CLAMP_SMOKE_NAME);
    if (smoke) {
      const outputTarget = processorOutputTargetForBuilding(building)
        ?? (BUILDING_STORAGE_CAPS.charcoal_burner.charcoal ?? 0);
      smoke.visible = building.assignedLabor > 0
        && building.firewood > 1e-6
        && (building.charcoal ?? 0) + 1e-6 < outputTarget;
    }
  }
  if (building.kind === 'lumber_mill') {
    const stockpile = marker.getObjectByName('TimberStockpile');
    if (stockpile instanceof THREE.Group) {
      syncStockpileSegments(
        stockpile,
        'TimberStockSegment',
        building.timber,
        BUILDING_STORAGE_CAPS.lumber_mill.timber,
      );
    }
  }
  if (building.kind === 'pastoral_farmstead') {
    const hayloft = marker.getObjectByName('HayloftStockpile');
    if (hayloft instanceof THREE.Group) {
      syncStockpileSegments(
        hayloft,
        'HayStockSegment',
        livestock?.hayStock ?? 0,
        Math.max(LIVESTOCK_HAY_STORAGE_CAPACITY, livestock?.hayStorageCapacity ?? 0),
      );
    }
    const wool = marker.getObjectByName('WoolStockpile');
    if (wool instanceof THREE.Group) {
      syncStockpileSegments(
        wool,
        'WoolStockSegment',
        building.wool ?? 0,
        BUILDING_STORAGE_CAPS.pastoral_farmstead.wool ?? 0,
      );
    }
  }
  if (building.kind === 'spinning_retting_house') {
    const caps = BUILDING_STORAGE_CAPS.spinning_retting_house as Partial<Record<
      'wool' | 'flax' | 'yarn' | 'linen',
      number
    >>;
    const wool = marker.getObjectByName('SpinningWoolStockpile');
    if (wool instanceof THREE.Group) {
      syncStockpileSegments(
        wool,
        'WoolStockSegment',
        building.wool ?? 0,
        caps.wool ?? 0,
      );
    }
    const flax = marker.getObjectByName('SpinningFlaxStockpile');
    if (flax instanceof THREE.Group) {
      syncStockpileSegments(
        flax,
        'FlaxStockSegment',
        building.flax ?? 0,
        caps.flax ?? 0,
      );
    }
    const yarn = marker.getObjectByName('SpinningYarnStockpile');
    if (yarn instanceof THREE.Group) {
      syncStockpileSegments(
        yarn,
        'YarnStockSegment',
        building.yarn ?? 0,
        caps.yarn ?? 0,
      );
    }
    const linen = marker.getObjectByName('SpinningLinenStockpile');
    if (linen instanceof THREE.Group) {
      syncStockpileSegments(
        linen,
        'LinenStockSegment',
        building.linen ?? 0,
        caps.linen ?? 0,
      );
    }
  }
  if (building.kind === 'weaver') {
    const caps = BUILDING_STORAGE_CAPS.weaver as Partial<Record<
      'yarn' | 'linen' | 'cloth',
      number
    >>;
    const yarn = marker.getObjectByName('WeaverYarnStockpile');
    if (yarn instanceof THREE.Group) {
      syncStockpileSegments(
        yarn,
        'YarnStockSegment',
        building.yarn ?? 0,
        caps.yarn ?? 0,
      );
    }
    const cloth = marker.getObjectByName('ClothStockpile');
    if (cloth instanceof THREE.Group) {
      syncStockpileSegments(
        cloth,
        'ClothStockSegment',
        building.cloth ?? 0,
        caps.cloth ?? 0,
      );
    }
    const linen = marker.getObjectByName('WeaverLinenStockpile');
    if (linen instanceof THREE.Group) {
      syncStockpileSegments(
        linen,
        'LinenStockSegment',
        building.linen ?? 0,
        caps.linen ?? 0,
      );
    }
  }
  if (building.kind === 'tannery' || building.kind === 'cobbler') {
    const leatherCaps = BUILDING_STORAGE_CAPS[building.kind] as Partial<Record<
      'hides' | 'leather' | 'shoes',
      number
    >>;
    const hides = marker.getObjectByName('HidesStock');
    if (hides instanceof THREE.Group) {
      syncStockpileSegments(hides, 'HidesStockSegment', building.hides ?? 0, leatherCaps.hides ?? 0);
    }
    const leather = marker.getObjectByName('LeatherStock');
    if (leather instanceof THREE.Group) {
      syncStockpileSegments(leather, 'LeatherStockSegment', building.leather ?? 0, leatherCaps.leather ?? 0);
    }
    const shoes = marker.getObjectByName('ShoesStock');
    if (shoes instanceof THREE.Group) {
      syncStockpileSegments(shoes, 'ShoesStockSegment', building.shoes ?? 0, leatherCaps.shoes ?? 0);
    }
  }
  if (building.kind === 'chandlery') {
    const wax = marker.getObjectByName('WaxStock');
    if (wax instanceof THREE.Group) {
      syncStockpileSegments(
        wax,
        'WaxStockSegment',
        building.wax ?? 0,
        BUILDING_STORAGE_CAPS.chandlery.wax ?? 0,
      );
    }
    const candles = marker.getObjectByName('CandlesStock');
    if (candles instanceof THREE.Group) {
      syncStockpileSegments(
        candles,
        'CandlesStockSegment',
        building.candles ?? 0,
        BUILDING_STORAGE_CAPS.chandlery.candles ?? 0,
      );
    }
  }
  syncFoodStockpileVisuals(marker, building);
  syncBulkStockpileVisuals(marker, building);
  syncArmoryStockpileVisuals(marker, building, issuedGuardPolearms);
  syncSeasonalStockpileVisuals(marker, building);
  syncMarketplaceSpecialtyStockpileVisuals(marker, building);
  syncMonasteryStockpileVisuals(marker, building);
}

function syncInitialFoundersCampVisualState(marker: THREE.Group): void {
  const timber = marker.getObjectByName('FoundingTimberStockpile');
  if (timber instanceof THREE.Group) {
    const visibleCount = syncStockpileSegments(
      timber,
      'FoundingTimberSegment',
      STARTING_TIMBER,
      BUILDING_STORAGE_CAPS.founders_camp.timber,
    );
    const accumulation = timber.getObjectByName(
      FOUNDERS_CAMP_TIMBER_WINTER_ACCUMULATION_NAME,
    );
    if (accumulation instanceof THREE.InstancedMesh) accumulation.count = visibleCount;
  }
  const stone = marker.getObjectByName('FoundingStoneStockpile');
  if (stone instanceof THREE.Group) {
    const visibleCount = syncStockpileSegments(
      stone,
      'FoundingStoneSegment',
      STARTING_STONE,
      BUILDING_STORAGE_CAPS.founders_camp.stone,
    );
    const accumulation = stone.getObjectByName(
      FOUNDERS_CAMP_STONE_WINTER_ACCUMULATION_NAME,
    );
    if (accumulation instanceof THREE.InstancedMesh) accumulation.count = visibleCount;
  }
  const chest = marker.getObjectByName('FoundingTreasuryChest');
  if (chest) chest.visible = STARTING_GOLD > 1e-6;
  const ironwork = marker.getObjectByName('FoundingIronworkStockpile');
  if (ironwork instanceof THREE.Group) {
    syncStockpileSegments(
      ironwork,
      'FoundingIronworkSegment',
      STARTING_IRONWORK,
      BUILDING_STORAGE_CAPS.founders_camp.ironwork ?? 0,
    );
  }
  refreshFoundersCampColorBatches(marker);
  refreshBuildingDetailCasterBatches(marker);
}

function foundersCampMatchesInitialVisualState(building: BuildingState): boolean {
  return building.kind === 'founders_camp'
    && building.foundingShelterActive !== false
    && stockpileVisualLevel(
      building.timber,
      BUILDING_STORAGE_CAPS.founders_camp.timber,
      FOUNDING_TIMBER_VISUAL_SEGMENTS,
    ) === stockpileVisualLevel(
      STARTING_TIMBER,
      BUILDING_STORAGE_CAPS.founders_camp.timber,
      FOUNDING_TIMBER_VISUAL_SEGMENTS,
    )
    && stockpileVisualLevel(
      building.stone,
      BUILDING_STORAGE_CAPS.founders_camp.stone,
      FOUNDING_STONE_VISUAL_SEGMENTS,
    ) === stockpileVisualLevel(
      STARTING_STONE,
      BUILDING_STORAGE_CAPS.founders_camp.stone,
      FOUNDING_STONE_VISUAL_SEGMENTS,
    )
    && stockpileVisualLevel(
      building.ironwork ?? 0,
      BUILDING_STORAGE_CAPS.founders_camp.ironwork ?? 0,
      FOUNDING_IRONWORK_VISUAL_SEGMENTS,
    ) === stockpileVisualLevel(
      STARTING_IRONWORK,
      BUILDING_STORAGE_CAPS.founders_camp.ironwork ?? 0,
      FOUNDING_IRONWORK_VISUAL_SEGMENTS,
    )
    && (building.gold > 1e-6) === (STARTING_GOLD > 1e-6);
}

