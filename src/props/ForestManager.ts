import * as THREE from 'three';
import type { BuildingTerrainSource } from '../buildings/BuildingTerrainLayout.ts';
import { pointWithinBuildingSiteClearance } from '../buildings/BuildingTerrainLayout.ts';
import type { Point2 } from '../utils/polygonGeometry.ts';
import type { Terrain, TerrainBounds } from '../terrain/Terrain.ts';
import type { RoadEdge } from '../roads/RoadEdge.ts';
import type { RoadNetwork } from '../roads/RoadNetwork.ts';
import { collectRoadRemovedRockIndices } from '../roads/roadRockClearance.ts';
import { distancePointToPolylineXZ, type RockObstacle } from '../utils/pathGeometry.ts';
import { distancePointToPolygon2 } from '../utils/polygonGeometry.ts';
import {
  UNDERGROWTH_KINDS,
  markUndergrowthMatricesUpdated,
  undergrowthPlacementClearanceRadius,
  undergrowthBucketForPlacement,
  type UndergrowthInstances,
  type UndergrowthPlacement,
  type UndergrowthStats,
} from './ForestUndergrowth.ts';
import type {
  ForestFloorIvyInstances,
  ForestFloorIvyStats,
} from './ForestFloorIvy.ts';
import type {
  ForestFloorNettleInstances,
  ForestFloorNettleStats,
} from './ForestFloorNettles.ts';
import type {
  ForestFloorTwigInstances,
  ForestFloorTwigStats,
} from './ForestFloorTwigs.ts';
import {
  commitHarvestStumpInstanceUpdates,
  createHarvestStumpInstances,
  disposeHarvestStumpInstances,
  hideHarvestStumpInstance,
  isUndergrowthNearAnyEdge,
  setHarvestStumpShadowsEnabled,
  shouldShowHarvestStumps,
  type HarvestStumpBarkResolver,
  type HarvestStumpInstances,
  updateHarvestStumpInstance,
} from './RoadStumps.ts';
import type { TreePhase } from '../resources/types.ts';
import type { SeedThreeForestController } from '../vegetation/seedthree/seedThreeForestTypes.ts';
import type {
  SeedThreeForestProfileBreakdown,
  SeedThreeForestStructuralStats,
} from '../vegetation/seedthree/seedThreeForestTypes.ts';
import type { DeciduousFoliagePresentation } from '../world/deciduousFoliagePolicy.ts';
import { PlacementClearanceSpatialIndex } from '../placement/PlacementClearanceSpatialIndex.ts';
import { GRASS_BLADE_REVEAL } from '../grass/grassLodMath.ts';
import { FOREST_WIND_SAMPLE_RADIUS } from '../audio/forestWindRules.ts';
import {
  forestCanopyOcclusionMapFromMaterial,
  type ForestCanopyOcclusionDebugMode,
  type ForestCanopyOcclusionMap,
} from '../terrain/ForestCanopyOcclusion.ts';
import type { ForestTreePlacement } from './forestPlacements.ts';

const ROAD_CLEAR_MARGIN = 1.35;
const BUILDING_CLEAR_MARGIN = 1.35;
const UNDERGROWTH_CLEAR_MARGIN = 0.95;
/**
 * Forest-floor cards are close-detail dressing. Past this orbit band they are
 * sub-pixel beneath the canopy but still submit three large, map-wide
 * instanced draws. Keep a small hysteresis band so wheel zoom cannot flicker
 * the group at the threshold.
 */
const UNDERGROWTH_HIDE_DISTANCE = GRASS_BLADE_REVEAL.far + 8;
const UNDERGROWTH_SHOW_DISTANCE = GRASS_BLADE_REVEAL.far;

export type ForestPlacementClearance = {
  roadNetwork?: RoadNetwork | null;
  buildings?: Iterable<BuildingTerrainSource>;
  burgageParcelPolygons?: Iterable<Point2[]>;
  farmFieldPolygons?: Iterable<Point2[]>;
};

export type ForestRockInstance = {
  placement: RockObstacle;
  mesh: THREE.InstancedMesh;
  shadowMesh: THREE.InstancedMesh;
  instanceIndex: number;
  matrix: THREE.Matrix4;
};

export type ForestRockInstances = {
  group: THREE.Group;
  instances: ForestRockInstance[];
};

type TreePlacement = ForestTreePlacement;

export type ForestTreeLayout = TreePlacement & {
  layoutIndex: number;
};

export type ForestTreePhaseUpdate = {
  layoutIndex: number;
  phase: TreePhase;
  growthProgress: number;
};

export type MixedForestInstances = {
  group: THREE.Group;
  trunkMesh: THREE.InstancedMesh;
  coniferFoliageMesh: THREE.InstancedMesh;
  broadleafFoliageMesh: THREE.InstancedMesh;
  coniferShadowMesh: THREE.InstancedMesh;
  broadleafShadowMesh: THREE.InstancedMesh;
  placements: TreePlacement[];
  coniferLayerCounts: number[];
  broadleafLayerCounts: number[];
  coniferStartIndex: number[];
  broadleafStartIndex: number[];
  trunkMatrices: THREE.Matrix4[];
  coniferFoliageMatrices: THREE.Matrix4[];
  broadleafFoliageMatrices: THREE.Matrix4[];
};

export class ForestManager {
  readonly group: THREE.Group;
  private readonly disposeResources: () => void;
  private readonly placements: TreePlacement[];
  private readonly trunkMesh: THREE.InstancedMesh;
  private readonly coniferFoliageMesh: THREE.InstancedMesh;
  private readonly broadleafFoliageMesh: THREE.InstancedMesh;
  private readonly coniferShadowMesh: THREE.InstancedMesh;
  private readonly broadleafShadowMesh: THREE.InstancedMesh;
  private readonly coniferLayerCounts: number[];
  private readonly broadleafLayerCounts: number[];
  private readonly coniferStartIndex: number[];
  private readonly broadleafStartIndex: number[];
  private readonly trunkMatrices: THREE.Matrix4[];
  private readonly coniferFoliageMatrices: THREE.Matrix4[];
  private readonly broadleafFoliageMatrices: THREE.Matrix4[];
  private readonly undergrowth: UndergrowthInstances | null;
  private readonly undergrowthPlacements: UndergrowthPlacement[];
  private readonly forestFloorIvy: ForestFloorIvyInstances | null;
  private readonly forestFloorNettles: ForestFloorNettleInstances | null;
  private readonly forestFloorTwigs: ForestFloorTwigInstances | null;
  private readonly canopyOcclusion: ForestCanopyOcclusionMap | null;
  private readonly rockInstances: ForestRockInstance[];
  private readonly allRockPlacements: RockObstacle[];
  private activeRockPlacements: RockObstacle[];
  private readonly harvestStumps: HarvestStumpInstances;
  private readonly terrain: Terrain;
  private readonly seedThreeForest: SeedThreeForestController | null;
  private readonly hiddenMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
  private roadRemovedTrees = new Set<number>();
  private placementRemovedTrees = new Set<number>();
  private removedTrees = new Set<number>();
  private missingTreeEntities = new Set<number>();
  private roadRemovedUndergrowth = new Set<number>();
  private placementRemovedUndergrowth = new Set<number>();
  private removedUndergrowth = new Set<number>();
  private roadRemovedRocks = new Set<number>();
  private placementRemovedRocks = new Set<number>();
  private removedRocks = new Set<number>();
  private forestFloorRoadEdges: RoadEdge[] = [];
  private forestFloorPlacementClearance: PlacementClearanceSpatialIndex | null = null;
  private treePhases = new Map<number, TreePhase>();
  private treeGrowthProgress = new Map<number, number>();
  private collisionVersion = 0;
  private undergrowthVisible = true;
  private treeUpdateBatchDepth = 0;
  private treeInstanceUpdatesPending = false;

  constructor(
    root: THREE.Group,
    forestInstances: MixedForestInstances,
    rockField: ForestRockInstances,
    undergrowth: UndergrowthInstances | null,
    undergrowthPlacements: UndergrowthPlacement[],
    terrain: Terrain,
    disposeResources: () => void,
    seedThreeForest: SeedThreeForestController | null = null,
    maxAnisotropy = 1,
    resolveHarvestStumpBark?: HarvestStumpBarkResolver,
    forestFloorIvy: ForestFloorIvyInstances | null = null,
    forestFloorNettles: ForestFloorNettleInstances | null = null,
    forestFloorTwigs: ForestFloorTwigInstances | null = null,
  ) {
    this.seedThreeForest = seedThreeForest;
    this.group = root;
    this.rockInstances = rockField.instances;
    this.allRockPlacements = rockField.instances.map((instance) => instance.placement);
    this.activeRockPlacements = [...this.allRockPlacements];
    this.disposeResources = disposeResources;
    this.placements = forestInstances.placements;
    this.trunkMesh = forestInstances.trunkMesh;
    this.coniferFoliageMesh = forestInstances.coniferFoliageMesh;
    this.broadleafFoliageMesh = forestInstances.broadleafFoliageMesh;
    this.coniferShadowMesh = forestInstances.coniferShadowMesh;
    this.broadleafShadowMesh = forestInstances.broadleafShadowMesh;
    this.coniferLayerCounts = forestInstances.coniferLayerCounts;
    this.broadleafLayerCounts = forestInstances.broadleafLayerCounts;
    this.coniferStartIndex = forestInstances.coniferStartIndex;
    this.broadleafStartIndex = forestInstances.broadleafStartIndex;
    this.trunkMatrices = forestInstances.trunkMatrices;
    this.coniferFoliageMatrices = forestInstances.coniferFoliageMatrices;
    this.broadleafFoliageMatrices = forestInstances.broadleafFoliageMatrices;
    this.undergrowth = undergrowth;
    this.undergrowthPlacements = undergrowthPlacements;
    this.forestFloorIvy = forestFloorIvy;
    this.forestFloorNettles = forestFloorNettles;
    this.forestFloorTwigs = forestFloorTwigs;
    this.terrain = terrain;
    this.canopyOcclusion = forestCanopyOcclusionMapFromMaterial(
      terrain.mesh.material,
    );
    this.canopyOcclusion?.rebuild(this.placements.map((placement) => ({
      x: placement.x,
      z: placement.z,
      canopyRadius: treeCanopyRadius(placement),
    })));
    this.harvestStumps = createHarvestStumpInstances(
      this.placements,
      maxAnisotropy,
      resolveHarvestStumpBark,
    );
    this.group.add(this.harvestStumps.group);
    for (let i = 0; i < this.placements.length; i++) {
      this.hideHarvestStump(i);
    }
    commitHarvestStumpInstanceUpdates(this.harvestStumps);
  }

  getTreeLayouts(): ForestTreeLayout[] {
    return this.placements.map((placement, layoutIndex) => ({
      layoutIndex,
      ...placement,
    }));
  }

  /**
   * Measures living canopy around the audio listener without allocating. The
   * radial weighting distinguishes a real stand from one isolated roadside
   * tree, and authoritative felling/clearance immediately affects the result.
   */
  sampleAudioCanopyCover(
    x: number,
    z: number,
    radius = FOREST_WIND_SAMPLE_RADIUS,
  ): number {
    if (radius <= 0) return 0;
    const radiusSquared = radius * radius;
    let weightedCanopy = 0;
    for (let layoutIndex = 0; layoutIndex < this.placements.length; layoutIndex++) {
      if (
        this.removedTrees.has(layoutIndex)
        || this.missingTreeEntities.has(layoutIndex)
        || (this.treePhases.get(layoutIndex) ?? 'mature') !== 'mature'
      ) {
        continue;
      }
      const placement = this.placements[layoutIndex];
      const dx = placement.x - x;
      const dz = placement.z - z;
      const distanceSquared = dx * dx + dz * dz;
      if (distanceSquared >= radiusSquared) continue;
      const radial = 1 - Math.sqrt(distanceSquared) / radius;
      weightedCanopy += radial * radial;
      if (weightedCanopy >= 6) return 1;
    }
    return Math.min(1, weightedCanopy / 6);
  }

  get rockPlacements(): ReadonlyArray<RockObstacle> {
    return this.activeRockPlacements;
  }

  setDeciduousFoliage(presentation: DeciduousFoliagePresentation): void {
    this.seedThreeForest?.setDeciduousFoliage(presentation);
    this.forestFloorNettles?.setDeciduousFoliage(presentation);
    this.undergrowth?.setDeciduousFoliage(presentation);
  }

  setSnowCoverage(coverage: number): void {
    this.seedThreeForest?.setSnowCoverage(coverage);
    this.forestFloorIvy?.setSnowCoverage(coverage);
  }

  setDistantCanopyCardsEnabled(enabled: boolean): void {
    this.seedThreeForest?.setDistantCanopyCardsEnabled(enabled);
  }

  isTreeLayoutActiveForCollision(layoutIndex: number): boolean {
    return layoutIndex >= 0
      && layoutIndex < this.placements.length
      && !this.removedTrees.has(layoutIndex)
      && !this.missingTreeEntities.has(layoutIndex);
  }

  getCollisionVersion(): number {
    return this.collisionVersion;
  }

  getForestFloorIvyStats(): ForestFloorIvyStats | null {
    return this.forestFloorIvy?.stats ?? null;
  }

  getForestFloorNettleStats(): ForestFloorNettleStats | null {
    return this.forestFloorNettles?.stats ?? null;
  }

  getForestFloorTwigStats(): ForestFloorTwigStats | null {
    return this.forestFloorTwigs?.stats ?? null;
  }

  getUndergrowthStats(): UndergrowthStats | null {
    return this.undergrowth?.stats ?? null;
  }

  setForestFloorDebugMode(mode: ForestCanopyOcclusionDebugMode): void {
    this.canopyOcclusion?.setDebugMode(mode);
  }

  batchTreeInstanceUpdates<T>(applyUpdates: () => T): T {
    this.treeUpdateBatchDepth += 1;
    try {
      return applyUpdates();
    } finally {
      this.treeUpdateBatchDepth -= 1;
      if (this.treeUpdateBatchDepth === 0 && this.treeInstanceUpdatesPending) {
        this.treeInstanceUpdatesPending = false;
        this.flushTreeInstanceUpdates();
      }
    }
  }

  applyTreePhase(layoutIndex: number, phase: TreePhase, growthProgress: number): void {
    if (this.applyTreePhaseWithoutCommit(layoutIndex, phase, growthProgress)) {
      this.commitTreeInstanceUpdates();
    }
  }

  applyTreePhases(updates: Iterable<ForestTreePhaseUpdate>): void {
    let needsCommit = false;
    for (const update of updates) {
      needsCommit = this.applyTreePhaseWithoutCommit(
        update.layoutIndex,
        update.phase,
        update.growthProgress,
      ) || needsCommit;
    }
    if (needsCommit) {
      this.commitTreeInstanceUpdates();
    }
  }

  private applyTreePhaseWithoutCommit(
    layoutIndex: number,
    phase: TreePhase,
    growthProgress: number,
  ): boolean {
    if (layoutIndex < 0 || layoutIndex >= this.placements.length) return false;
    const wasMissing = this.missingTreeEntities.delete(layoutIndex);
    const phaseChanged = this.treePhases.get(layoutIndex) !== phase;
    const growthChanged = this.treeGrowthProgress.get(layoutIndex) !== growthProgress;
    if (!wasMissing && !phaseChanged && !growthChanged) return false;
    this.collisionVersion += 1;

    this.treePhases.set(layoutIndex, phase);
    this.treeGrowthProgress.set(layoutIndex, growthProgress);

    if (this.removedTrees.has(layoutIndex)) {
      this.hideTree(layoutIndex);
      this.hideHarvestStump(layoutIndex);
    } else {
      this.restoreTreePhaseVisual(layoutIndex, phase);
    }
    return true;
  }

  syncAuthoritativeTreeLayouts(activeLayoutIndices: Iterable<number>): void {
    const active = new Set(activeLayoutIndices);
    const nextMissing = new Set<number>();
    for (let layoutIndex = 0; layoutIndex < this.placements.length; layoutIndex++) {
      if (!active.has(layoutIndex)) nextMissing.add(layoutIndex);
    }
    if (removedIndexSetsEqual(nextMissing, this.missingTreeEntities)) return;

    const previousMissing = this.missingTreeEntities;
    this.missingTreeEntities = nextMissing;
    this.collisionVersion += 1;
    for (let layoutIndex = 0; layoutIndex < this.placements.length; layoutIndex++) {
      const wasMissing = previousMissing.has(layoutIndex);
      const isMissing = nextMissing.has(layoutIndex);
      if (wasMissing === isMissing) continue;
      if (isMissing || this.removedTrees.has(layoutIndex)) {
        this.hideTree(layoutIndex);
        this.hideHarvestStump(layoutIndex);
      } else {
        this.restoreTreePhaseVisual(layoutIndex);
      }
    }
    this.commitTreeInstanceUpdates();
  }

  removeAuthoritativeTreeLayouts(layoutIndices: Iterable<number>): void {
    let needsCommit = false;
    for (const layoutIndex of layoutIndices) {
      if (
        layoutIndex < 0
        || layoutIndex >= this.placements.length
        || this.missingTreeEntities.has(layoutIndex)
      ) {
        continue;
      }
      this.missingTreeEntities.add(layoutIndex);
      this.hideTree(layoutIndex);
      this.hideHarvestStump(layoutIndex);
      needsCommit = true;
    }
    if (needsCommit) {
      this.collisionVersion += 1;
      this.commitTreeInstanceUpdates();
    }
  }

  private restoreTreePhaseVisual(
    layoutIndex: number,
    phase: TreePhase = this.treePhases.get(layoutIndex) ?? 'mature',
  ): void {
    switch (phase) {
      case 'mature':
        this.hideHarvestStump(layoutIndex);
        this.showTree(layoutIndex);
        break;
      case 'stump':
        this.hideTree(layoutIndex);
        this.showHarvestStump(layoutIndex);
        break;
      case 'growing':
        // Reforestation remains simulation-active, but it stays visually empty
        // until a Seloslav/SeedThree sapling asset replaces the removed cone proxy.
        this.hideTree(layoutIndex);
        this.hideHarvestStump(layoutIndex);
        break;
      default: {
        const unreachable: never = phase;
        return unreachable;
      }
    }
  }

  setTreeShadowsEnabled(enabled: boolean): void {
    this.seedThreeForest?.setShadows(enabled);
    this.trunkMesh.castShadow = enabled;
    this.coniferShadowMesh.castShadow = enabled;
    this.broadleafShadowMesh.castShadow = enabled;
    setHarvestStumpShadowsEnabled(this.harvestStumps, enabled);
    if (this.undergrowth) {
      for (const kind of UNDERGROWTH_KINDS) {
        for (const bucket of this.undergrowth.buckets[kind]) {
          bucket.shadowMesh.castShadow = enabled;
        }
      }
    }
    this.group.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      if (mesh.name.toLowerCase().includes('shadow')) {
        mesh.castShadow = enabled;
      }
    });
  }

  updateCameraState(
    camera: THREE.Camera,
    cameraDistance: number,
    firstPersonActive: boolean,
    casterBounds: TerrainBounds,
    cameraInteractionActive = false,
    deltaSeconds = 1 / 60,
  ): boolean {
    const shadowCastersChanged = this.seedThreeForest?.updateCamera(
      camera,
      cameraDistance,
      firstPersonActive,
      casterBounds,
      cameraInteractionActive,
      deltaSeconds,
    ).shadowCastersChanged ?? false;
    const harvestStumpsVisible = shouldShowHarvestStumps(
      this.harvestStumps.group.visible,
      cameraDistance,
      firstPersonActive,
    );
    const harvestStumpVisibilityChanged =
      harvestStumpsVisible !== this.harvestStumps.group.visible;
    if (harvestStumpVisibilityChanged) {
      this.harvestStumps.group.visible = harvestStumpsVisible;
    }
    if (
      !this.undergrowth
      && !this.forestFloorIvy
      && !this.forestFloorNettles
      && !this.forestFloorTwigs
    ) {
      return shadowCastersChanged || harvestStumpVisibilityChanged;
    }
    const threshold = this.undergrowthVisible
      ? UNDERGROWTH_HIDE_DISTANCE
      : UNDERGROWTH_SHOW_DISTANCE;
    const visible = firstPersonActive || cameraDistance <= threshold;
    this.forestFloorNettles?.updateCamera(
      camera.position,
      visible,
    );
    if (visible === this.undergrowthVisible) {
      return shadowCastersChanged || harvestStumpVisibilityChanged;
    }
    this.undergrowthVisible = visible;
    if (this.undergrowth) this.undergrowth.group.visible = visible;
    if (this.forestFloorIvy) this.forestFloorIvy.group.visible = visible;
    this.forestFloorTwigs?.setCloseDetailVisible(visible);
    return shadowCastersChanged || harvestStumpVisibilityChanged;
  }

  getSeedThreeStructuralStats(): SeedThreeForestStructuralStats | null {
    return this.seedThreeForest?.getStructuralStats() ?? null;
  }

  getSeedThreeProfileBreakdown(): SeedThreeForestProfileBreakdown | null {
    return this.seedThreeForest?.getProfileBreakdown() ?? null;
  }

  syncRoadClearance(network: RoadNetwork | null): void {
    const edges = network ? [...network.edges.values()] : [];
    this.forestFloorRoadEdges = edges;
    const nextRoadRemovedTrees = new Set<number>();
    for (let treeIndex = 0; treeIndex < this.placements.length; treeIndex++) {
      if (this.isTreeNearAnyEdge(this.placements[treeIndex], edges)) {
        nextRoadRemovedTrees.add(treeIndex);
      }
    }
    this.roadRemovedTrees = nextRoadRemovedTrees;
    this.applyTreeClearance(removedIndexSetUnion(
      this.roadRemovedTrees,
      this.placementRemovedTrees,
    ));

    if (this.undergrowth) {
      const nextRoadRemovedUndergrowth = new Set<number>();
      for (let index = 0; index < this.undergrowthPlacements.length; index++) {
        const placement = this.undergrowthPlacements[index];
        if (isUndergrowthNearAnyEdge(
          placement.x,
          placement.z,
          edges,
          undergrowthPlacementClearanceRadius(placement),
        )) {
          nextRoadRemovedUndergrowth.add(index);
        }
      }
      this.roadRemovedUndergrowth = nextRoadRemovedUndergrowth;
      this.applyUndergrowthClearance(removedIndexSetUnion(
        this.roadRemovedUndergrowth,
        this.placementRemovedUndergrowth,
      ));
    }

    this.roadRemovedRocks = collectRoadRemovedRockIndices(
      this.allRockPlacements,
      network,
    );
    this.applyRockClearance(removedIndexSetUnion(
      this.roadRemovedRocks,
      this.placementRemovedRocks,
    ));
    this.syncForestFloorPlacementClearance();
  }

  syncPlacementClearance(clearance: ForestPlacementClearance): void {
    if (clearance.roadNetwork !== undefined) {
      this.syncRoadClearance(clearance.roadNetwork);
    }
    const buildings = clearance.buildings ? [...clearance.buildings] : [];
    const burgageParcelPolygons = clearance.burgageParcelPolygons ? [...clearance.burgageParcelPolygons] : [];
    const farmFieldPolygons = clearance.farmFieldPolygons ? [...clearance.farmFieldPolygons] : [];
    const clearanceIndex = new PlacementClearanceSpatialIndex(
      buildings,
      burgageParcelPolygons,
      farmFieldPolygons,
    );
    this.forestFloorPlacementClearance = clearanceIndex;
    const nextPlacementRemovedTrees = new Set<number>();

    for (let treeIndex = 0; treeIndex < this.placements.length; treeIndex++) {
      const placement = this.placements[treeIndex];
      const treeClearance = treeCanopyRadius(placement) + BUILDING_CLEAR_MARGIN;
      if (clearanceIndex.someBuildingNear(
        placement.x,
        placement.z,
        treeClearance,
        (building) => treeWithinBuildingPad(placement, building),
      )) {
        nextPlacementRemovedTrees.add(treeIndex);
        continue;
      }
      if (clearanceIndex.someBurgageParcelNear(
        placement.x,
        placement.z,
        treeClearance,
        (polygon) => treeWithinBurgageParcel(placement, polygon),
      )) {
        nextPlacementRemovedTrees.add(treeIndex);
        continue;
      }
      if (clearanceIndex.someFarmFieldNear(
        placement.x,
        placement.z,
        0,
        (polygon) => distancePointToPolygon2(placement, polygon) <= 1e-6,
      )) {
        nextPlacementRemovedTrees.add(treeIndex);
      }
    }

    this.placementRemovedTrees = nextPlacementRemovedTrees;
    this.applyTreeClearance(removedIndexSetUnion(
      this.roadRemovedTrees,
      this.placementRemovedTrees,
    ));

    this.syncPlacementUndergrowthClearance(clearanceIndex);
    this.syncPlacementRockClearance(clearanceIndex);
    this.syncForestFloorPlacementClearance();
  }

  dispose(): void {
    disposeHarvestStumpInstances(this.harvestStumps);
    this.disposeResources();
  }

  private syncForestFloorPlacementClearance(): void {
    const isBlockedAt = (x: number, z: number): boolean => (
      this.isForestFloorPointWithinClearance(x, z)
    );
    if ((this.forestFloorIvy?.refreshBlockedMask(isBlockedAt) ?? 0) > 0) {
      this.forestFloorIvy?.commit();
    }
    if ((this.forestFloorNettles?.refreshBlockedMask(isBlockedAt) ?? 0) > 0) {
      this.forestFloorNettles?.commit();
    }
    if ((this.forestFloorTwigs?.refreshBlockedMask(isBlockedAt) ?? 0) > 0) {
      this.forestFloorTwigs?.commit();
    }
  }

  private isForestFloorPointWithinClearance(x: number, z: number): boolean {
    if (isUndergrowthNearAnyEdge(
      x,
      z,
      this.forestFloorRoadEdges,
      UNDERGROWTH_CLEAR_MARGIN,
    )) {
      return true;
    }
    const clearanceIndex = this.forestFloorPlacementClearance;
    if (!clearanceIndex) return false;
    if (clearanceIndex.someBuildingNear(
      x,
      z,
      0,
      (building) => pointWithinBuildingSiteClearance(x, z, building),
    )) {
      return true;
    }
    const point = { x, z };
    if (clearanceIndex.someBurgageParcelNear(
      x,
      z,
      UNDERGROWTH_CLEAR_MARGIN,
      (polygon) => distancePointToPolygon2(point, polygon) <= UNDERGROWTH_CLEAR_MARGIN,
    )) {
      return true;
    }
    return clearanceIndex.someFarmFieldNear(
      x,
      z,
      UNDERGROWTH_CLEAR_MARGIN,
      (polygon) => distancePointToPolygon2(point, polygon) <= UNDERGROWTH_CLEAR_MARGIN,
    );
  }

  private syncPlacementUndergrowthClearance(
    clearanceIndex: PlacementClearanceSpatialIndex,
  ): void {
    if (!this.undergrowth) return;

    const nextPlacementRemovedUndergrowth = new Set<number>();
    for (let index = 0; index < this.undergrowthPlacements.length; index++) {
      const placement = this.undergrowthPlacements[index];
      const clearRadius = undergrowthPlacementClearanceRadius(placement);
      if (clearanceIndex.someBuildingNear(
        placement.x,
        placement.z,
        clearRadius,
        (building) => pointWithinBuildingSiteClearance(
          placement.x,
          placement.z,
          building,
          clearRadius,
        ),
      )) {
        nextPlacementRemovedUndergrowth.add(index);
        continue;
      }
      if (clearanceIndex.someBurgageParcelNear(
        placement.x,
        placement.z,
        clearRadius,
        (polygon) => distancePointToPolygon2(placement, polygon) <= clearRadius,
      )) {
        nextPlacementRemovedUndergrowth.add(index);
        continue;
      }
      if (clearanceIndex.someFarmFieldNear(
        placement.x,
        placement.z,
        clearRadius,
        (polygon) => distancePointToPolygon2(placement, polygon) <= clearRadius,
      )) {
        nextPlacementRemovedUndergrowth.add(index);
      }
    }

    this.placementRemovedUndergrowth = nextPlacementRemovedUndergrowth;
    this.applyUndergrowthClearance(removedIndexSetUnion(
      this.roadRemovedUndergrowth,
      this.placementRemovedUndergrowth,
    ));
  }

  private applyTreeClearance(nextRemoved: Set<number>): void {
    if (removedIndexSetsEqual(nextRemoved, this.removedTrees)) return;

    const previousRemoved = this.removedTrees;
    this.removedTrees = nextRemoved;
    this.collisionVersion += 1;
    for (let treeIndex = 0; treeIndex < this.placements.length; treeIndex++) {
      const wasRemoved = previousRemoved.has(treeIndex);
      const isRemoved = nextRemoved.has(treeIndex);
      if (wasRemoved === isRemoved) continue;

      if (isRemoved || this.missingTreeEntities.has(treeIndex)) {
        this.hideTree(treeIndex);
        this.hideHarvestStump(treeIndex);
      } else {
        this.restoreTreePhaseVisual(treeIndex);
      }
    }
    this.commitTreeInstanceUpdates();
  }

  private applyUndergrowthClearance(nextRemoved: Set<number>): void {
    if (!this.undergrowth || removedIndexSetsEqual(nextRemoved, this.removedUndergrowth)) {
      return;
    }

    for (let index = 0; index < this.undergrowthPlacements.length; index++) {
      const shouldRemove = nextRemoved.has(index);
      if (shouldRemove === this.removedUndergrowth.has(index)) continue;
      const placement = this.undergrowthPlacements[index];
      const bucket = undergrowthBucketForPlacement(this.undergrowth, placement);
      const matrix = shouldRemove ? this.hiddenMatrix : bucket.matrices[placement.meshIndex];
      bucket.mesh.setMatrixAt(placement.meshIndex, matrix);
      bucket.shadowMesh.setMatrixAt(placement.meshIndex, matrix);
    }

    this.removedUndergrowth = nextRemoved;
    markUndergrowthMatricesUpdated(this.undergrowth);
  }

  private syncPlacementRockClearance(
    clearanceIndex: PlacementClearanceSpatialIndex,
  ): void {
    const nextPlacementRemoved = new Set<number>();
    for (let index = 0; index < this.rockInstances.length; index++) {
      const placement = this.rockInstances[index].placement;
      const clearRadius = placement.scale * 1.35 + 0.35;
      if (
        clearanceIndex.someBuildingNear(
          placement.x,
          placement.z,
          clearRadius,
          (building) =>
            pointWithinBuildingSiteClearance(
              placement.x,
              placement.z,
              building,
              clearRadius,
            ),
        )
        || clearanceIndex.someFarmFieldNear(
          placement.x,
          placement.z,
          clearRadius,
          (polygon) => distancePointToPolygon2(placement, polygon) <= clearRadius,
        )
      ) {
        nextPlacementRemoved.add(index);
      }
    }
    this.placementRemovedRocks = nextPlacementRemoved;
    this.applyRockClearance(removedIndexSetUnion(
      this.roadRemovedRocks,
      this.placementRemovedRocks,
    ));
  }

  private applyRockClearance(nextRemoved: Set<number>): void {
    if (removedIndexSetsEqual(nextRemoved, this.removedRocks)) return;

    for (let index = 0; index < this.rockInstances.length; index++) {
      if (nextRemoved.has(index) === this.removedRocks.has(index)) continue;
      const instance = this.rockInstances[index];
      const matrix = nextRemoved.has(index) ? this.hiddenMatrix : instance.matrix;
      instance.mesh.setMatrixAt(instance.instanceIndex, matrix);
      instance.shadowMesh.setMatrixAt(instance.instanceIndex, matrix);
      instance.mesh.instanceMatrix.needsUpdate = true;
      instance.shadowMesh.instanceMatrix.needsUpdate = true;
    }

    this.removedRocks = nextRemoved;
    this.activeRockPlacements = this.allRockPlacements.filter((_, index) => !nextRemoved.has(index));
  }

  private isTreeNearAnyEdge(placement: TreePlacement, edges: RoadEdge[]): boolean {
    for (const edge of edges) {
      const path = edge.sampledPath.length >= 2 ? edge.sampledPath : edge.controlPoints;
      if (path.length < 2) continue;
      const distance = distancePointToPolylineXZ(placement.x, placement.z, path);
      if (distance <= treeClearRadius(placement, edge.width)) return true;
    }
    return false;
  }

  private hideTree(treeIndex: number): void {
    this.setTreeForestFloorActive(treeIndex, false);
    if (this.seedThreeForest) {
      this.seedThreeForest.hideTree(treeIndex);
      return;
    }
    this.trunkMesh.setMatrixAt(treeIndex, this.hiddenMatrix);
    this.hideConiferLayers(treeIndex);
    this.hideBroadleafLayers(treeIndex);
  }

  private showTree(treeIndex: number): void {
    this.setTreeForestFloorActive(treeIndex, true);
    if (this.seedThreeForest) {
      this.seedThreeForest.showTree(treeIndex);
      return;
    }
    this.trunkMesh.setMatrixAt(treeIndex, this.trunkMatrices[treeIndex]);
    this.showConiferLayers(treeIndex);
    this.showBroadleafLayers(treeIndex);
  }

  private showHarvestStump(layoutIndex: number): void {
    const placement = this.placements[layoutIndex];
    updateHarvestStumpInstance(
      this.harvestStumps,
      layoutIndex,
      placement.x,
      placement.z,
      this.terrain.getHeightAt(placement.x, placement.z),
      placement.scale,
    );
  }

  private hideHarvestStump(layoutIndex: number): void {
    hideHarvestStumpInstance(this.harvestStumps, layoutIndex, this.hiddenMatrix);
  }

  private commitTreeInstanceUpdates(): void {
    if (this.treeUpdateBatchDepth > 0) {
      this.treeInstanceUpdatesPending = true;
      return;
    }
    this.flushTreeInstanceUpdates();
  }

  private flushTreeInstanceUpdates(): void {
    this.canopyOcclusion?.commit();
    if (this.seedThreeForest) {
      this.seedThreeForest.commit();
    } else {
      this.trunkMesh.instanceMatrix.needsUpdate = true;
      this.coniferFoliageMesh.instanceMatrix.needsUpdate = true;
      this.broadleafFoliageMesh.instanceMatrix.needsUpdate = true;
      this.coniferShadowMesh.instanceMatrix.needsUpdate = true;
      this.broadleafShadowMesh.instanceMatrix.needsUpdate = true;
    }
    this.forestFloorIvy?.commit();
    this.forestFloorNettles?.commit();
    this.forestFloorTwigs?.commit();
    commitHarvestStumpInstanceUpdates(this.harvestStumps);
  }

  private setTreeForestFloorActive(treeIndex: number, active: boolean): void {
    this.canopyOcclusion?.setTreeActive(treeIndex, active, true);
    this.forestFloorIvy?.setTreeActive(treeIndex, active);
    // Nettles are independent colonies, not part of the source tree. Their
    // own footprint mask handles roads and placed sites, while felling a tree
    // leaves the existing forest-floor plants in the newly opened light gap.
    this.forestFloorTwigs?.setTreeActive(treeIndex, active);
  }

  private hideConiferLayers(treeIndex: number): void {
    const foliageStart = this.coniferStartIndex[treeIndex];
    const foliageCount = this.coniferLayerCounts[treeIndex];
    for (let i = 0; i < foliageCount; i++) {
      const layerIndex = foliageStart + i;
      this.coniferFoliageMesh.setMatrixAt(layerIndex, this.hiddenMatrix);
      this.coniferShadowMesh.setMatrixAt(layerIndex, this.hiddenMatrix);
    }
  }

  private showConiferLayers(treeIndex: number): void {
    const foliageStart = this.coniferStartIndex[treeIndex];
    const foliageCount = this.coniferLayerCounts[treeIndex];
    for (let i = 0; i < foliageCount; i++) {
      const layerIndex = foliageStart + i;
      this.coniferFoliageMesh.setMatrixAt(layerIndex, this.coniferFoliageMatrices[layerIndex]);
      this.coniferShadowMesh.setMatrixAt(layerIndex, this.coniferFoliageMatrices[layerIndex]);
    }
  }

  private hideBroadleafLayers(treeIndex: number): void {
    const foliageStart = this.broadleafStartIndex[treeIndex];
    const foliageCount = this.broadleafLayerCounts[treeIndex];
    for (let i = 0; i < foliageCount; i++) {
      const layerIndex = foliageStart + i;
      this.broadleafFoliageMesh.setMatrixAt(layerIndex, this.hiddenMatrix);
      this.broadleafShadowMesh.setMatrixAt(layerIndex, this.hiddenMatrix);
    }
  }

  private showBroadleafLayers(treeIndex: number): void {
    const foliageStart = this.broadleafStartIndex[treeIndex];
    const foliageCount = this.broadleafLayerCounts[treeIndex];
    for (let i = 0; i < foliageCount; i++) {
      const layerIndex = foliageStart + i;
      this.broadleafFoliageMesh.setMatrixAt(layerIndex, this.broadleafFoliageMatrices[layerIndex]);
      this.broadleafShadowMesh.setMatrixAt(layerIndex, this.broadleafFoliageMatrices[layerIndex]);
    }
  }
}

function treeCanopyRadius(placement: TreePlacement): number {
  if (placement.form === 'broad') return 4.1 * placement.scale;
  if (placement.form === 'young' || placement.form === 'midstory') return 2.3 * placement.scale;
  return 3.3 * placement.scale;
}

function treeClearRadius(placement: TreePlacement, roadWidth: number): number {
  return roadWidth * 0.5 + treeCanopyRadius(placement) + ROAD_CLEAR_MARGIN;
}

function treeWithinBuildingPad(placement: TreePlacement, building: BuildingTerrainSource): boolean {
  const canopyRadius = treeCanopyRadius(placement) + BUILDING_CLEAR_MARGIN;
  return pointWithinBuildingSiteClearance(placement.x, placement.z, building, canopyRadius);
}

function treeWithinBurgageParcel(placement: TreePlacement, polygon: Point2[]): boolean {
  const distance = distancePointToPolygon2({ x: placement.x, z: placement.z }, polygon);
  return distance <= treeCanopyRadius(placement) + BUILDING_CLEAR_MARGIN;
}

function removedIndexSetsEqual(a: Set<number>, b: Set<number>): boolean {
  if (a.size !== b.size) return false;
  for (const index of a) {
    if (!b.has(index)) return false;
  }
  return true;
}

function removedIndexSetUnion(left: Set<number>, right: Set<number>): Set<number> {
  if (left.size === 0) return new Set(right);
  if (right.size === 0) return new Set(left);
  const union = new Set(left);
  for (const index of right) union.add(index);
  return union;
}
