import * as THREE from 'three';
import type { Terrain } from '../terrain/Terrain.ts';
import type { RoadEdge } from '../roads/RoadEdge.ts';
import type { RoadNetwork } from '../roads/RoadNetwork.ts';
import { distancePointToPolylineXZ, type RockObstacle } from '../utils/pathGeometry.ts';
import type { UndergrowthInstances, UndergrowthPlacement } from './ForestUndergrowth.ts';
import {
  computeRoadStumpPlacements,
  createRoadStumpMesh,
  createHarvestStumpMesh,
  isUndergrowthNearAnyEdge,
  updateRoadStumpInstances,
  updateHarvestStumpInstance,
} from './RoadStumps.ts';
import { createTreeSaplingMesh, updateTreeSaplingInstance } from './TreeSaplings.ts';
import type { TreePhase } from '../resources/types.ts';

const ROAD_CLEAR_MARGIN = 1.35;
const UNDERGROWTH_CLEAR_MARGIN = 0.95;

type TreePlacement = {
  x: number;
  z: number;
  form: 'narrow' | 'broad' | 'young' | 'midstory';
  species: string;
  scale: number;
};

export type ForestTreeLayout = TreePlacement & {
  layoutIndex: number;
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
  readonly rockPlacements: ReadonlyArray<RockObstacle>;
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
  private readonly stumpMesh: THREE.InstancedMesh;
  private readonly harvestStumpMesh: THREE.InstancedMesh;
  private readonly saplingMesh: THREE.InstancedMesh;
  private readonly terrain: Terrain;
  private readonly hiddenMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
  private removedTrees = new Set<number>();
  private removedUndergrowth = new Set<number>();
  private treePhases = new Map<number, TreePhase>();
  private treeGrowthProgress = new Map<number, number>();

  constructor(
    root: THREE.Group,
    forestInstances: MixedForestInstances,
    rockPlacements: ReadonlyArray<RockObstacle>,
    undergrowth: UndergrowthInstances | null,
    undergrowthPlacements: UndergrowthPlacement[],
    terrain: Terrain,
    disposeResources: () => void,
  ) {
    this.group = root;
    this.rockPlacements = rockPlacements;
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
    this.terrain = terrain;
    this.stumpMesh = createRoadStumpMesh();
    this.harvestStumpMesh = createHarvestStumpMesh(this.placements.length);
    this.saplingMesh = createTreeSaplingMesh(this.placements.length);
    this.group.add(this.stumpMesh);
    this.group.add(this.harvestStumpMesh);
    this.group.add(this.saplingMesh);
    for (let i = 0; i < this.placements.length; i++) {
      this.hideHarvestStump(i);
      this.hideSapling(i);
    }
  }

  getTreeLayouts(): ForestTreeLayout[] {
    return this.placements.map((placement, layoutIndex) => ({
      layoutIndex,
      ...placement,
    }));
  }

  applyTreePhase(layoutIndex: number, phase: TreePhase, growthProgress: number): void {
    if (layoutIndex < 0 || layoutIndex >= this.placements.length) return;
    this.treePhases.set(layoutIndex, phase);
    this.treeGrowthProgress.set(layoutIndex, growthProgress);

    if (this.removedTrees.has(layoutIndex)) {
      this.hideTree(layoutIndex);
      this.hideHarvestStump(layoutIndex);
      this.hideSapling(layoutIndex);
      this.commitTreeInstanceUpdates();
      return;
    }

    switch (phase) {
      case 'mature':
        this.hideHarvestStump(layoutIndex);
        this.hideSapling(layoutIndex);
        this.showTree(layoutIndex);
        break;
      case 'stump':
        this.hideTree(layoutIndex);
        this.hideSapling(layoutIndex);
        this.showHarvestStump(layoutIndex);
        break;
      case 'growing':
        this.hideTree(layoutIndex);
        this.hideHarvestStump(layoutIndex);
        this.showSapling(layoutIndex, growthProgress);
        break;
      default: {
        const unreachable: never = phase;
        return unreachable;
      }
    }

    this.commitTreeInstanceUpdates();
  }

  syncRoadClearance(network: RoadNetwork): void {
    const edges = [...network.edges.values()];
    const nextRemoved = new Set<number>();

    for (let treeIndex = 0; treeIndex < this.placements.length; treeIndex++) {
      if (this.isTreeNearAnyEdge(this.placements[treeIndex], edges)) {
        nextRemoved.add(treeIndex);
      }
    }

    this.removedTrees = nextRemoved;

    for (let treeIndex = 0; treeIndex < this.placements.length; treeIndex++) {
      const phase = this.treePhases.get(treeIndex) ?? 'mature';
      const growthProgress = this.treeGrowthProgress.get(treeIndex) ?? 1;
      this.applyTreePhase(treeIndex, phase, growthProgress);
    }

    this.syncUndergrowthClearance(edges);
    this.syncRoadStumps(network);
  }

  dispose(): void {
    this.stumpMesh.geometry.dispose();
    (this.stumpMesh.material as THREE.Material).dispose();
    this.harvestStumpMesh.geometry.dispose();
    (this.harvestStumpMesh.material as THREE.Material).dispose();
    this.saplingMesh.geometry.dispose();
    (this.saplingMesh.material as THREE.Material).dispose();
    this.disposeResources();
  }

  private syncUndergrowthClearance(edges: RoadEdge[]): void {
    if (!this.undergrowth) return;

    const nextRemoved = new Set<number>();
    for (let index = 0; index < this.undergrowthPlacements.length; index++) {
      const placement = this.undergrowthPlacements[index];
      if (isUndergrowthNearAnyEdge(placement.x, placement.z, edges, UNDERGROWTH_CLEAR_MARGIN)) {
        nextRemoved.add(index);
      }
    }

    for (let index = 0; index < this.undergrowthPlacements.length; index++) {
      const shouldRemove = nextRemoved.has(index);
      if (shouldRemove === this.removedUndergrowth.has(index)) continue;
      const placement = this.undergrowthPlacements[index];
      const mesh = placement.kind === 'bush' ? this.undergrowth.bushMesh : this.undergrowth.fernMesh;
      const shadowMesh =
        placement.kind === 'bush' ? this.undergrowth.bushShadowMesh : this.undergrowth.fernShadowMesh;
      const matrices = placement.kind === 'bush' ? this.undergrowth.bushMatrices : this.undergrowth.fernMatrices;
      const matrix = shouldRemove ? this.hiddenMatrix : matrices[placement.meshIndex];
      mesh.setMatrixAt(placement.meshIndex, matrix);
      shadowMesh.setMatrixAt(placement.meshIndex, matrix);
    }

    this.removedUndergrowth = nextRemoved;
    this.undergrowth.bushMesh.instanceMatrix.needsUpdate = true;
    this.undergrowth.fernMesh.instanceMatrix.needsUpdate = true;
    this.undergrowth.bushShadowMesh.instanceMatrix.needsUpdate = true;
    this.undergrowth.fernShadowMesh.instanceMatrix.needsUpdate = true;
  }

  private syncRoadStumps(network: RoadNetwork): void {
    const placements = computeRoadStumpPlacements(network);
    updateRoadStumpInstances(this.stumpMesh, placements, this.terrain);
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
    this.trunkMesh.setMatrixAt(treeIndex, this.hiddenMatrix);
    this.hideConiferLayers(treeIndex);
    this.hideBroadleafLayers(treeIndex);
  }

  private showTree(treeIndex: number): void {
    this.trunkMesh.setMatrixAt(treeIndex, this.trunkMatrices[treeIndex]);
    this.showConiferLayers(treeIndex);
    this.showBroadleafLayers(treeIndex);
  }

  private showHarvestStump(layoutIndex: number): void {
    const placement = this.placements[layoutIndex];
    updateHarvestStumpInstance(
      this.harvestStumpMesh,
      layoutIndex,
      placement.x,
      placement.z,
      this.terrain.getHeightAt(placement.x, placement.z),
      placement.scale,
    );
  }

  private hideHarvestStump(layoutIndex: number): void {
    this.harvestStumpMesh.setMatrixAt(layoutIndex, this.hiddenMatrix);
  }

  private showSapling(layoutIndex: number, growthProgress: number): void {
    const placement = this.placements[layoutIndex];
    updateTreeSaplingInstance(
      this.saplingMesh,
      layoutIndex,
      placement.x,
      placement.z,
      this.terrain.getHeightAt(placement.x, placement.z),
      growthProgress,
      isConiferSpecies(placement.species),
    );
  }

  private hideSapling(layoutIndex: number): void {
    this.saplingMesh.setMatrixAt(layoutIndex, this.hiddenMatrix);
  }

  private commitTreeInstanceUpdates(): void {
    this.trunkMesh.instanceMatrix.needsUpdate = true;
    this.coniferFoliageMesh.instanceMatrix.needsUpdate = true;
    this.broadleafFoliageMesh.instanceMatrix.needsUpdate = true;
    this.coniferShadowMesh.instanceMatrix.needsUpdate = true;
    this.broadleafShadowMesh.instanceMatrix.needsUpdate = true;
    this.harvestStumpMesh.instanceMatrix.needsUpdate = true;
    this.saplingMesh.instanceMatrix.needsUpdate = true;
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

function isConiferSpecies(species: string): boolean {
  return species === 'norwaySpruce'
    || species === 'scotsPine'
    || species === 'silverFir'
    || species === 'larch';
}

function treeClearRadius(placement: TreePlacement, roadWidth: number): number {
  const canopyRadius =
    placement.form === 'broad'
      ? 4.1 * placement.scale
      : placement.form === 'young' || placement.form === 'midstory'
        ? 2.3 * placement.scale
        : 3.3 * placement.scale;
  return roadWidth * 0.5 + canopyRadius + ROAD_CLEAR_MARGIN;
}
