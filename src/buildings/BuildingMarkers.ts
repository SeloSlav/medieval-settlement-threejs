import * as THREE from 'three';
import {
  BUILDING_STORAGE_CAPS,
  LIVESTOCK_HAY_STORAGE_CAPACITY,
} from '../generated/gameBalance.ts';
import { disposeObject3D } from '../utils/dispose.ts';
import type {
  BuildingKind,
  BuildingState,
  GameState,
  LivestockHerdState,
} from '../resources/types.ts';
import {
  getGuardhouseMusterState,
  guardhouseMusterResponseBand,
  watchtowerEffectiveRadius,
} from '../security/frontierSecurity.ts';
import { fireDisabledBuildingIds } from '../fires/fireIncident.ts';
import type { Terrain } from '../terrain/Terrain.ts';
import { areBuildingShadowsEnabled } from '../scene/shadowPreference.ts';
import type { RoadNetwork } from '../roads/RoadNetwork.ts';
import { buildingPlacementYaw } from './buildingPlacement.ts';
import { getBuildingExtent } from './buildingExtents.ts';
import { createBuildingShadowProxy } from './buildingShadowProxy.ts';
import { createBuildingMesh } from './BuildingMeshes.ts';
import {
  createConstructionSiteMesh,
} from './ConstructionSiteMesh.ts';
import { buildingMeshSignature } from './buildingMarkerSignature.ts';
import { syncStockpileSegments } from './buildingStockpileVisuals.ts';
import {
  createBuildingPreviewMesh,
  disposeBuildingPreviewMesh,
  updateBuildingPreviewAppearance,
} from './BuildingPlacementPreview.ts';

type BuildingMarkersOptions = {
  terrain: Terrain;
  parent: THREE.Group;
  getRoadNetwork?: () => RoadNetwork | null;
  getRoadConditionSpeedMultiplier?: () => number;
};

export class BuildingMarkers {
  private readonly terrain: Terrain;
  private readonly getRoadNetwork?: () => RoadNetwork | null;
  private readonly getRoadConditionSpeedMultiplier?: () => number;
  private readonly group = new THREE.Group();
  private readonly buildingMeshes = new Map<string, THREE.Group>();
  private extentOverlayMesh: THREE.Mesh | null = null;
  private extentOverlayKind: BuildingKind | null = null;
  private readonly guardhouseMusterRoute: THREE.InstancedMesh<
    THREE.BoxGeometry,
    THREE.MeshBasicMaterial
  >;
  private guardhouseMusterSignature = '';
  private previewMesh: THREE.Mesh | null = null;
  private previewBuilding: THREE.Group | null = null;
  private previewKind: BuildingKind | null = null;
  private previewValid: boolean | null = null;
  private lastPreviewSignature = '';
  private pendingPlacement: THREE.Group | null = null;

  constructor(options: BuildingMarkersOptions) {
    this.terrain = options.terrain;
    this.getRoadNetwork = options.getRoadNetwork;
    this.getRoadConditionSpeedMultiplier = options.getRoadConditionSpeedMultiplier;
    this.group.name = 'Building markers';
    this.guardhouseMusterRoute = createGuardhouseMusterRoute();
    this.group.add(this.guardhouseMusterRoute);
    options.parent.add(this.group);
  }

  setBuildingExtentOverlay(
    building: BuildingState | null,
    gameState?: GameState,
  ): void {
    const fireDisabled = fireDisabledBuildingIds(
      gameState?.fireIncidents.values() ?? [],
    );
    const extent = building
      ? getBuildingExtent(building.kind, building.workRadius)
      : null;
    const radius = building?.kind === 'watchtower'
      ? watchtowerEffectiveRadius(building, fireDisabled.has(building.id))
      : extent?.radius ?? 0;
    if (!building || !extent || radius <= 0) {
      if (this.extentOverlayMesh) this.extentOverlayMesh.visible = false;
    } else {
      const color = buildingExtentColor(building.kind);
      if (!this.extentOverlayMesh || this.extentOverlayKind !== building.kind) {
        if (this.extentOverlayMesh) {
          disposeObject3D(this.extentOverlayMesh);
          this.extentOverlayMesh.removeFromParent();
        }
        this.extentOverlayMesh = createRadiusRing(color, 0.14);
        this.extentOverlayMesh.name = 'Selected building extent';
        this.extentOverlayKind = building.kind;
        this.group.add(this.extentOverlayMesh);
      }

      const y = this.terrain.getHeightAt(building.x, building.z);
      this.extentOverlayMesh.visible = true;
      this.extentOverlayMesh.position.set(building.x, y + 0.15, building.z);
      this.extentOverlayMesh.scale.set(radius, 1, radius);
    }

    this.syncGuardhouseMusterRoute(building, gameState, fireDisabled);
  }

  syncBuildings(
    buildings: Iterable<BuildingState>,
    livestockHerds?: ReadonlyMap<string, LivestockHerdState>,
  ): void {
    const nextIds = new Set<string>();
    for (const building of buildings) {
      nextIds.add(building.id);
      this.upsertBuilding(building, livestockHerds?.get(building.id));
    }

    for (const id of this.buildingMeshes.keys()) {
      if (nextIds.has(id)) continue;
      this.removeBuilding(id);
    }
  }

  clearPlacementPreview(): void {
    if (this.previewMesh) this.previewMesh.visible = false;
    if (this.previewBuilding) this.previewBuilding.visible = false;
    this.previewValid = null;
    this.lastPreviewSignature = '';
  }

  showPendingPlacement(kind: BuildingKind, x: number, z: number): void {
    this.clearPendingPlacement();
    const marker = createConstructionSiteMesh(kind, 0, 0, 0);
    marker.name = 'Pending building placement';
    marker.rotation.y = buildingPlacementYaw(kind, x, z, this.getRoadNetwork?.() ?? null);
    marker.position.set(x, this.terrain.getHeightAt(x, z), z);
    this.pendingPlacement = marker;
    this.group.add(marker);
  }

  clearPendingPlacement(): void {
    if (!this.pendingPlacement) return;
    this.pendingPlacement.removeFromParent();
    disposeObject3D(this.pendingPlacement);
    this.pendingPlacement = null;
  }

  setPlacementPreview(
    kind: BuildingKind,
    x: number,
    z: number,
    extentRadius: number,
    valid: boolean,
    visible: boolean,
  ): void {
    const signature = `${kind}|${x.toFixed(2)}|${z.toFixed(2)}|${valid ? 1 : 0}|${visible ? 1 : 0}|${extentRadius.toFixed(1)}`;
    if (signature === this.lastPreviewSignature) return;
    this.lastPreviewSignature = signature;
    if (!visible) {
      if (this.previewMesh) this.previewMesh.visible = false;
      if (this.previewBuilding) this.previewBuilding.visible = false;
      return;
    }

    const ringColor = valid ? 0x00cc66 : 0xff4444;
    if (!this.previewMesh) {
      this.previewMesh = createRadiusRing(ringColor, 0.22);
      this.group.add(this.previewMesh);
    } else if (this.previewValid !== valid) {
      (this.previewMesh.material as THREE.MeshBasicMaterial).color.setHex(ringColor);
    }

    if (!this.previewBuilding || this.previewKind !== kind) {
      if (this.previewBuilding) {
        disposeBuildingPreviewMesh(this.previewBuilding);
        this.previewBuilding.removeFromParent();
      }
      this.previewBuilding = createBuildingPreviewMesh(kind);
      this.previewKind = kind;
      this.previewValid = valid;
      this.previewBuilding.rotation.y = buildingPlacementYaw(kind, x, z, this.getRoadNetwork?.() ?? null);
      this.group.add(this.previewBuilding);
    } else if (this.previewValid !== valid) {
      updateBuildingPreviewAppearance(this.previewBuilding, valid);
      this.previewValid = valid;
    }

    const y = this.terrain.getHeightAt(x, z);
    const yaw = buildingPlacementYaw(kind, x, z, this.getRoadNetwork?.() ?? null);
    this.previewMesh.visible = extentRadius > 0;
    this.previewMesh.position.set(x, y + 0.2, z);
    this.previewMesh.scale.set(extentRadius, 1, extentRadius);

    this.previewBuilding.visible = true;
    this.previewBuilding.rotation.y = yaw;
    this.previewBuilding.position.set(x, y, z);
  }

  dispose(): void {
    this.clearPendingPlacement();
    if (this.previewMesh) {
      disposeObject3D(this.previewMesh);
      this.previewMesh = null;
    }
    if (this.previewBuilding) {
      disposeBuildingPreviewMesh(this.previewBuilding);
      this.previewBuilding = null;
      this.previewKind = null;
    }
    if (this.extentOverlayMesh) {
      disposeObject3D(this.extentOverlayMesh);
      this.extentOverlayMesh = null;
      this.extentOverlayKind = null;
    }
    disposeObject3D(this.guardhouseMusterRoute);
    for (const id of [...this.buildingMeshes.keys()]) {
      this.removeBuilding(id);
    }
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
  ): void {
    let marker = this.buildingMeshes.get(building.id);
    const timberRatio = ratio(
      building.constructionDeliveredTimber,
      building.constructionRequiredTimber,
    );
    const stoneRatio = ratio(
      building.constructionDeliveredStone,
      building.constructionRequiredStone,
    );
    const operational = building.constructionComplete !== false;
    const visualSignature = buildingMeshSignature(building);
    if (marker && marker.userData.visualSignature !== visualSignature) {
      this.group.remove(marker);
      disposeObject3D(marker);
      this.buildingMeshes.delete(building.id);
      marker = undefined;
    }
    if (!marker) {
      marker = operational
        ? createBuildingMesh(building.kind)
        : createConstructionSiteMesh(
            building.kind,
            building.constructionProgress,
            timberRatio,
            stoneRatio,
          );
      marker.userData.visualSignature = visualSignature;
      marker.userData.fpCollisionAggregate = true;
      if (operational) {
        const shadowProxy = createBuildingShadowProxy(building.kind);
        shadowProxy.castShadow = areBuildingShadowsEnabled();
        marker.add(shadowProxy);
      }
      marker.rotation.y = buildingPlacementYaw(
        building.kind,
        building.x,
        building.z,
        this.getRoadNetwork?.() ?? null,
      );
      this.buildingMeshes.set(building.id, marker);
      this.group.add(marker);
    }

    const y = this.terrain.getHeightAt(building.x, building.z);
    marker.position.set(building.x, y, building.z);
    if (operational) syncBuildingVisualState(marker, building, herd);
    if (operational && !marker.getObjectByName('Building shadow proxy')) {
      const shadowProxy = createBuildingShadowProxy(building.kind);
      shadowProxy.castShadow = areBuildingShadowsEnabled();
      marker.add(shadowProxy);
    }
  }

  private removeBuilding(id: string): void {
    const marker = this.buildingMeshes.get(id);
    if (!marker) return;
    this.group.remove(marker);
    // Construction materials and textures belong to BuildingMaterialLibrary;
    // individual buildings own only their geometry.
    disposeObject3D(marker);
    this.buildingMeshes.delete(id);
  }
}

function ratio(value: number, required: number): number {
  return required <= 1e-6 ? 1 : THREE.MathUtils.clamp(value / required, 0, 1);
}

function syncBuildingVisualState(
  marker: THREE.Group,
  building: BuildingState,
  herd?: LivestockHerdState,
): void {
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
  }
}

const BUILDING_EXTENT_COLORS: Partial<Record<BuildingKind, number>> = {
  lumber_mill: 0xd7b463,
  reforester: 0x00cc66,
  stone_quarry: 0xa8a29e,
  large_quarry: 0xd5b866,
  well: 0x4f9fd4,
  hunters_hall: 0x8a6d45,
  foragers_shed: 0xb05c76,
  fishing_camp: 0x5b99b0,
  threshing_barn: 0xb8894c,
  monastery: 0xe4dfd2,
  watchtower: 0xe0ad4f,
};

function buildingExtentColor(kind: BuildingKind): number {
  return BUILDING_EXTENT_COLORS[kind] ?? 0xd7b463;
}

function createRadiusRing(color: number, opacity: number): THREE.Mesh {
  const geometry = new THREE.RingGeometry(0.94, 1, 64);
  geometry.rotateX(-Math.PI * 0.5);
  const material = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = 8;
  return mesh;
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
