import * as THREE from 'three';
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
import {
  getGuardhouseMusterState,
  guardhouseMusterResponseBand,
} from '../security/frontierSecurity.ts';
import { fireDisabledBuildingIds } from '../fires/fireIncident.ts';
import type { Terrain } from '../terrain/Terrain.ts';
import { areBuildingShadowsEnabled } from '../scene/shadowPreference.ts';
import type { RoadNetwork } from '../roads/RoadNetwork.ts';
import { buildingPlacementYaw } from './buildingPlacement.ts';
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
  GUARDHOUSE_PAYROLL_VISUAL_CAPACITY,
} from './meshes/civicLogisticsBuildingMeshes.ts';
import {
  animateFoundersCampfire,
  FOUNDERS_CAMPFIRE_NAME,
  FOUNDERS_CAMP_STONE_WINTER_ACCUMULATION_NAME,
  FOUNDERS_CAMP_TIMBER_WINTER_ACCUMULATION_NAME,
  setFoundersCampfireNightLighting,
  setFoundersCampWinterAccumulation,
} from './meshes/foundersCampMesh.ts';
import {
  REMOTE_WORK_CAMPFIRE_NAME,
} from './remoteWorkCamp.ts';
import { disposeFireEffect } from '../fires/FireEffect.ts';
import {
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

type BuildingMarkersOptions = {
  terrain: Terrain;
  parent: THREE.Group;
  getRoadNetwork?: () => RoadNetwork | null;
  getRoadConditionSpeedMultiplier?: () => number;
  onShadowCastersChanged?: () => void;
};

export class BuildingMarkers {
  private readonly terrain: Terrain;
  private readonly getRoadNetwork?: () => RoadNetwork | null;
  private readonly getRoadConditionSpeedMultiplier?: () => number;
  private readonly onShadowCastersChanged?: () => void;
  private readonly group = new THREE.Group();
  private readonly buildingMeshes = new Map<string, THREE.Group>();
  private readonly buildingStates = new Map<string, BuildingState>();
  private readonly shadowProxyBatch: BatchedBuildingShadowProxies;
  private readonly staticBatches: BuildingStaticBatches;
  private readonly foundersCampfires = new Set<THREE.Group>();
  private readonly watermillWheels = new Set<THREE.Group>();
  private readonly windmillSails = new Map<THREE.Group, number>();
  private foundersCampfireNightLighting = 0;
  private foundersCampWinterAccumulation = false;
  private watermillThroughputMultiplier = 1;
  private windmillWeatherThroughputMultiplier = 1;
  private charcoalBurnerThroughputMultiplier = 1;
  private readonly guardhouseMusterRoute: THREE.InstancedMesh<
    THREE.BoxGeometry,
    THREE.MeshBasicMaterial
  >;
  private guardhouseMusterSignature = '';
  private previewBuilding: THREE.Group | null = null;
  private previewKind: BuildingKind | null = null;
  private lastPreviewSignature = '';
  private pendingPlacement: THREE.Group | null = null;
  private pendingPlacementKind: BuildingKind | null = null;
  private pendingPlacementX = 0;
  private pendingPlacementZ = 0;
  private prewarmedFoundersCamp: THREE.Group | null = null;
  private destroyedBuildingIds = new Set<string>();

  constructor(options: BuildingMarkersOptions) {
    this.terrain = options.terrain;
    this.getRoadNetwork = options.getRoadNetwork;
    this.getRoadConditionSpeedMultiplier = options.getRoadConditionSpeedMultiplier;
    this.onShadowCastersChanged = options.onShadowCastersChanged;
    this.group.name = 'Building markers';
    this.staticBatches = new BuildingStaticBatches(this.group);
    this.shadowProxyBatch = new BatchedBuildingShadowProxies(
      this.group,
      'Batched completed-building shadow proxies',
      areBuildingShadowsEnabled(),
    );
    this.guardhouseMusterRoute = createGuardhouseMusterRoute();
    this.group.add(this.guardhouseMusterRoute);
    options.parent.add(this.group);
  }

  setBuildingSelectionOverlays(
    building: BuildingState | null,
    gameState?: GameState,
  ): void {
    const fireDisabled = fireDisabledBuildingIds(
      gameState?.fireIncidents.values() ?? [],
    );
    this.syncGuardhouseMusterRoute(building, gameState, fireDisabled);
  }

  syncBuildings(
    buildings: Iterable<BuildingState>,
    livestockHerds?: ReadonlyMap<string, LivestockHerdState>,
    issuedGuardPolearms?: ReadonlyMap<string, number>,
  ): void {
    const nextIds = new Set<string>();
    for (const building of buildings) {
      nextIds.add(building.id);
      const priorState = this.buildingStates.get(building.id);
      if (
        priorState === building
        && this.buildingMeshes.has(building.id)
        && livestockHerds?.has(building.id) !== true
        && issuedGuardPolearms?.has(building.id) !== true
      ) {
        continue;
      }
      this.buildingStates.set(building.id, building);
      this.upsertBuilding(
        building,
        livestockHerds?.get(building.id),
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
   * Reapply the road-facing yaw after the authoritative road snapshot changes.
   * Building rows can reach the client before that snapshot during startup, in
   * which case their meshes are initially created with the deterministic
   * fallback yaw. Updating every transform here keeps the authored local +Z
   * facade (normally the door side) aimed at the road once it is available.
   */
  refreshRoadFacingOrientations(): void {
    const network = this.getRoadNetwork?.() ?? null;
    if (!network) return;

    for (const [id, building] of this.buildingStates) {
      const marker = this.buildingMeshes.get(id);
      if (!marker) continue;
      const yaw = buildingPlacementYaw(building.kind, building.x, building.z, network);
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

  setFoundersCampfireNightLighting(nightLighting: number): void {
    this.foundersCampfireNightLighting = THREE.MathUtils.clamp(nightLighting, 0, 1);
    for (const campfire of this.foundersCampfires) {
      setFoundersCampfireNightLighting(campfire, this.foundersCampfireNightLighting);
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
    for (const campfire of this.foundersCampfires) {
      animateFoundersCampfire(campfire, dtSeconds);
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

  prewarmFoundersCampPlacement(): void {
    if (
      this.prewarmedFoundersCamp
      || this.pendingPlacementKind === 'founders_camp'
      || [...this.buildingStates.values()].some((building) => building.kind === 'founders_camp')
    ) return;
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

  /**
   * Temporarily exposes the prebuilt founding camp while the loading screen is
   * compiling the live scene. Keeping the mesh detached during normal startup
   * avoids a stray world object, but excluding it from compileAsync made the
   * first placement click pay the entire shader compilation cost.
   */
  beginFoundersCampGpuPrewarm(): () => void {
    this.prewarmFoundersCampPlacement();
    const marker = this.prewarmedFoundersCamp;
    if (!marker || marker.parent) return () => {};

    const previousVisible = marker.visible;
    const previousPosition = marker.position.clone();
    marker.visible = true;
    marker.position.set(0, this.terrain.getHeightAt(0, 0), 0);
    this.group.add(marker);

    return () => {
      if (marker === this.prewarmedFoundersCamp && marker.parent === this.group) {
        marker.removeFromParent();
        marker.visible = previousVisible;
        marker.position.copy(previousPosition);
      }
    };
  }

  showPendingPlacement(kind: BuildingKind, x: number, z: number): void {
    this.clearPendingPlacement();
    const marker = kind === 'founders_camp'
      ? this.takeFoundersCampMesh()
      : createConstructionSiteMesh(kind, 0, 0, 0);
    marker.name = 'Pending building placement';
    marker.rotation.y = buildingPlacementYaw(kind, x, z, this.getRoadNetwork?.() ?? null);
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
  ): void {
    const signature = `${kind}|${x.toFixed(2)}|${z.toFixed(2)}|${valid ? 1 : 0}|${visible ? 1 : 0}|${wildlifePreview?.signature ?? ''}`;
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
      this.previewBuilding = createBuildingPreviewMesh(kind);
      this.previewKind = kind;
      this.group.add(this.previewBuilding);
    }
    updateBuildingPreviewAppearance(this.previewBuilding, valid);

    const yaw = buildingPlacementYaw(kind, x, z, this.getRoadNetwork?.() ?? null);
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
    this.clearPendingPlacement();
    if (this.prewarmedFoundersCamp) {
      disposeObject3D(this.prewarmedFoundersCamp);
      this.prewarmedFoundersCamp = null;
    }
    if (this.previewBuilding) {
      disposeBuildingPreviewMesh(this.previewBuilding);
      this.previewBuilding = null;
      this.previewKind = null;
    }
    disposeObject3D(this.guardhouseMusterRoute);
    for (const id of [...this.buildingMeshes.keys()]) {
      this.removeBuilding(id);
    }
    this.staticBatches.dispose();
    this.shadowProxyBatch.dispose();
    this.group.removeFromParent();
  }

  private syncGuardhouseMusterRoute(
    building: BuildingState | null,
    gameState: GameState | undefined,
    fireDisabled: ReadonlySet<string>,
  ): void {
    const network = this.getRoadNetwork?.() ?? null;
    if (
      building?.kind !== 'guardhouse'
      || building.constructionComplete === false
      || fireDisabled.has(building.id)
      || !gameState
      || !network
    ) {
      this.guardhouseMusterSignature = '';
      this.guardhouseMusterRoute.visible = false;
      return;
    }

    const towerSignature: string[] = [];
    for (const candidate of gameState.buildings.values()) {
      if (candidate.kind !== 'watchtower') continue;
      towerSignature.push([
        candidate.id,
        candidate.constructionComplete === false ? 0 : 1,
        candidate.assignedLabor,
        fireDisabled.has(candidate.id) ? 1 : 0,
        candidate.x.toFixed(2),
        candidate.z.toFixed(2),
      ].join(':'));
    }
    const roadSpeedMultiplier = this.getRoadConditionSpeedMultiplier?.() ?? 1;
    const signature = [
      building.id,
      building.x.toFixed(2),
      building.z.toFixed(2),
      fireDisabled.has(building.id) ? 1 : 0,
      network.getTopologyRevision(),
      roadSpeedMultiplier.toFixed(3),
      towerSignature.join('|'),
    ].join(';');
    if (signature === this.guardhouseMusterSignature) return;
    this.guardhouseMusterSignature = signature;

    const muster = getGuardhouseMusterState(
      building,
      gameState,
      (ax, az, bx, bz) => network.getPathfinder().roadPathDistance(ax, az, bx, bz),
      roadSpeedMultiplier,
    );
    const linkedTower = muster.linkedTowerId
      ? gameState.buildings.get(muster.linkedTowerId)
      : null;
    if (!linkedTower) {
      this.guardhouseMusterRoute.visible = false;
      return;
    }
    const route = network.getPathfinder().roadPathRoute(
      building.x,
      building.z,
      linkedTower.x,
      linkedTower.z,
    );
    if (!route || route.polyline.length < 2) {
      this.guardhouseMusterRoute.visible = false;
      return;
    }

    const responseBand = guardhouseMusterResponseBand(muster.efficiency);
    this.guardhouseMusterRoute.material.color.setHex(responseBand === 'full'
      ? 0x9aca6f
      : responseBand === 'delayed'
        ? 0xf0a63f
        : 0xe2573e);
    syncGuardhouseMusterRouteInstances(
      this.guardhouseMusterRoute,
      route.polyline,
      this.terrain,
    );
  }

  private upsertBuilding(
    building: BuildingState,
    herd?: LivestockHerdState,
    issuedGuardPolearms = 0,
  ): void {
    let marker = this.buildingMeshes.get(building.id);
    let markerNeedsRegistration = false;
    let adoptedPendingFoundersCamp = false;
    const timberRatio = ratio(
      building.constructionDeliveredTimber,
      building.constructionRequiredTimber,
    );
    const stoneRatio = ratio(
      building.constructionDeliveredStone,
      building.constructionRequiredStone,
    );
    const ironworkRatio = ratio(
      building.constructionDeliveredIronwork ?? 0,
      building.constructionRequiredIronwork ?? 0,
    );
    const roofTilesRatio = ratio(
      building.constructionDeliveredRoofTiles ?? 0,
      building.constructionRequiredRoofTiles ?? 0,
    );
    const operational = building.constructionComplete !== false;
    const useCompletedMesh = buildingUsesCompletedMesh(building);
    const visualSignature = buildingMeshSignature(building);
    if (marker && marker.userData.visualSignature !== visualSignature) {
      this.unregisterFoundersCampfire(marker);
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
      if (
        operational
        && building.kind === 'founders_camp'
        && !adoptedPendingFoundersCamp
      ) {
        setBuildingDetailShadowsEnabled(marker, areBuildingShadowsEnabled());
      }
      marker.rotation.y = buildingPlacementYaw(
        building.kind,
        building.x,
        building.z,
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
      if (
        building.kind === 'founders_camp'
        && building.foundingShelterActive !== false
      ) {
        const campfire = marker.getObjectByName(FOUNDERS_CAMPFIRE_NAME);
        if (campfire instanceof THREE.Group) {
          setFoundersCampfireNightLighting(
            campfire,
            this.foundersCampfireNightLighting,
          );
          this.foundersCampfires.add(campfire);
        }
      }
      const remoteCampfire = marker.getObjectByName(REMOTE_WORK_CAMPFIRE_NAME);
      if (remoteCampfire instanceof THREE.Group) {
        setFoundersCampfireNightLighting(
          remoteCampfire,
          this.foundersCampfireNightLighting,
        );
        this.foundersCampfires.add(remoteCampfire);
      }
      if (operational) {
        if (!marker.userData.staticBuildingBatchStats) {
          batchCompletedBuildingStaticMeshes(marker);
        }
        // There is only one founders' camp. Its locally merged, GPU-prewarmed
        // structure gains nothing from cross-building packing, while adopting
        // it into those buffers made the placement confirmation visibly hitch.
        if (building.kind !== 'founders_camp') {
          this.staticBatches.registerBuilding(building.id, marker);
        }
      }
    }

    const y = this.terrain.getHeightAt(building.x, building.z);
    marker.position.set(building.x, y, building.z);
    const destroyed = this.destroyedBuildingIds.has(building.id);
    marker.visible = !destroyed;
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
      syncBuildingVisualState(marker, building, herd, issuedGuardPolearms);
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

  private removeBuilding(id: string): void {
    const marker = this.buildingMeshes.get(id);
    if (!marker) return;
    this.unregisterFoundersCampfire(marker);
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

  private unregisterFoundersCampfire(marker: THREE.Group): void {
    for (const name of [FOUNDERS_CAMPFIRE_NAME, REMOTE_WORK_CAMPFIRE_NAME]) {
      const campfire = marker.getObjectByName(name);
      if (!(campfire instanceof THREE.Group)) continue;
      this.foundersCampfires.delete(campfire);
      disposeFireEffect(campfire);
    }
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

function ratio(value: number, required: number): number {
  return required <= 1e-6 ? 1 : THREE.MathUtils.clamp(value / required, 0, 1);
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
  herd?: LivestockHerdState,
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
  if (building.kind === 'guardhouse') {
    const chest = marker.getObjectByName('GuardhousePayrollChest');
    if (chest instanceof THREE.Group) {
      syncStockpileSegments(
        chest,
        'GuardhousePayrollSegment',
        building.gold,
        GUARDHOUSE_PAYROLL_VISUAL_CAPACITY,
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
        herd?.hayStock ?? 0,
        LIVESTOCK_HAY_STORAGE_CAPACITY,
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
  if (building.kind === 'weaver') {
    const wool = marker.getObjectByName('WeaverWoolStockpile');
    if (wool instanceof THREE.Group) {
      syncStockpileSegments(
        wool,
        'WoolStockSegment',
        building.wool ?? 0,
        BUILDING_STORAGE_CAPS.weaver.wool ?? 0,
      );
    }
    const cloth = marker.getObjectByName('ClothStockpile');
    if (cloth instanceof THREE.Group) {
      syncStockpileSegments(
        cloth,
        'ClothStockSegment',
        building.cloth ?? 0,
        BUILDING_STORAGE_CAPS.weaver.cloth ?? 0,
      );
    }
    const flax = marker.getObjectByName('WeaverFlaxStockpile');
    if (flax instanceof THREE.Group) {
      syncStockpileSegments(
        flax,
        'FlaxStockSegment',
        building.flax ?? 0,
        BUILDING_STORAGE_CAPS.weaver.flax ?? 0,
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

const MAX_GUARDHOUSE_MUSTER_DASHES = 512;
const GUARDHOUSE_MUSTER_DASH_STRIDE = 3.35;
const GUARDHOUSE_MUSTER_DASH_FILL = 0.66;

function createGuardhouseMusterRoute(): THREE.InstancedMesh<
  THREE.BoxGeometry,
  THREE.MeshBasicMaterial
> {
  const material = new THREE.MeshBasicMaterial({
    color: 0x9aca6f,
    transparent: true,
    opacity: 0.84,
    depthWrite: false,
    depthTest: false,
  });
  const route = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 0.08, 0.54),
    material,
    MAX_GUARDHOUSE_MUSTER_DASHES,
  );
  route.name = 'Selected guardhouse muster route';
  route.count = 0;
  route.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  route.renderOrder = 14;
  route.visible = false;
  route.frustumCulled = false;
  return route;
}

function syncGuardhouseMusterRouteInstances(
  route: THREE.InstancedMesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>,
  polyline: readonly { x: number; z: number }[],
  terrain: Terrain,
): void {
  const segmentLengths: number[] = [];
  let totalLength = 0;
  for (let index = 0; index < polyline.length - 1; index += 1) {
    const start = polyline[index]!;
    const end = polyline[index + 1]!;
    const length = Math.hypot(end.x - start.x, end.z - start.z);
    segmentLengths.push(length);
    totalLength += length;
  }
  if (totalLength <= 1e-6) {
    route.count = 0;
    route.visible = false;
    return;
  }

  const stride = Math.max(
    GUARDHOUSE_MUSTER_DASH_STRIDE,
    totalLength / MAX_GUARDHOUSE_MUSTER_DASHES,
  );
  const dashLength = stride * GUARDHOUSE_MUSTER_DASH_FILL;
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  let segmentIndex = 0;
  let segmentStartDistance = 0;
  let dashCount = 0;

  for (
    let dashStart = 0;
    dashStart < totalLength - 1e-6 && dashCount < MAX_GUARDHOUSE_MUSTER_DASHES;
    dashStart += stride
  ) {
    const visibleLength = Math.min(dashLength, totalLength - dashStart);
    const midpointDistance = dashStart + visibleLength * 0.5;
    while (
      segmentIndex < segmentLengths.length - 1
      && segmentStartDistance + segmentLengths[segmentIndex]! < midpointDistance
    ) {
      segmentStartDistance += segmentLengths[segmentIndex]!;
      segmentIndex += 1;
    }
    const start = polyline[segmentIndex]!;
    const end = polyline[segmentIndex + 1]!;
    const segmentLength = Math.max(1e-9, segmentLengths[segmentIndex]!);
    const t = THREE.MathUtils.clamp(
      (midpointDistance - segmentStartDistance) / segmentLength,
      0,
      1,
    );
    const x = THREE.MathUtils.lerp(start.x, end.x, t);
    const z = THREE.MathUtils.lerp(start.z, end.z, t);
    position.set(x, terrain.getHeightAt(x, z) + 0.34, z);
    rotation.setFromAxisAngle(up, -Math.atan2(end.z - start.z, end.x - start.x));
    scale.set(visibleLength, 1, 1);
    matrix.compose(position, rotation, scale);
    route.setMatrixAt(dashCount, matrix);
    dashCount += 1;
  }

  route.count = dashCount;
  route.instanceMatrix.needsUpdate = dashCount > 0;
  route.visible = dashCount > 0;
}
