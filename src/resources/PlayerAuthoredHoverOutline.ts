import * as THREE from 'three';
import {
  getBuildingFootprintCorners,
  getBuildingFootprintHalfExtents,
} from '../buildings/BuildingTerrainLayout.ts';
import { buildingPlacementYaw } from '../buildings/buildingPlacement.ts';
import {
  polygonSegments,
  updateTerrainRibbonGeometry,
} from '../placement/TerrainOverlayGeometry.ts';
import { layoutFromBurgageZone } from '../residences/burgageZoneLayout.ts';
import type { RoadNetwork } from '../roads/RoadNetwork.ts';
import type { TerrainProjector } from '../terrain/TerrainProjector.ts';
import { isPointInPolygon2, type Point2 } from '../utils/polygonGeometry.ts';
import type { GameState } from './types.ts';

type PlayerAuthoredHoverOutlineOptions = {
  domElement: HTMLElement;
  terrainProjector: TerrainProjector;
  parent: THREE.Group;
  getState: () => GameState;
  getRoadNetwork: () => RoadNetwork | null;
  getHeightAt: (x: number, z: number) => number;
  isBlocked: () => boolean;
};

type HoverPerimeter = {
  key: string;
  polygon: readonly Point2[];
};

const OUTLINE_WIDTH = 0.72;
const OUTLINE_DASH_LENGTH = 0.82;
const OUTLINE_GAP_LENGTH = 0.62;
const OUTLINE_LIFT = 0.24;
const BUILDING_OUTLINE_WIDTH = 0.3;
const BUILDING_OUTLINE_LIFT = 0.08;
const OUTLINE_RENDER_ORDER = 100;

/**
 * Shows one high-contrast, terrain-following perimeter for the authored object
 * beneath the pointer. Mesh ribbons keep the border thick on WebGL and WebGPU.
 */
export class PlayerAuthoredHoverOutline {
  private readonly options: PlayerAuthoredHoverOutlineOptions;
  private readonly geometry = new THREE.BufferGeometry();
  private readonly material = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  private readonly mesh = new THREE.Mesh(this.geometry, this.material);
  private currentKey = '';
  private pointerX = 0;
  private pointerY = 0;
  private pendingFrame = 0;

  constructor(options: PlayerAuthoredHoverOutlineOptions) {
    this.options = options;
    this.mesh.name = 'Player-authored hover perimeter';
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = OUTLINE_RENDER_ORDER;
    this.mesh.raycast = () => {};
    options.parent.add(this.mesh);

    options.domElement.addEventListener('pointermove', this.onPointerMove);
    options.domElement.addEventListener('pointerleave', this.onPointerLeave);
    window.addEventListener('blur', this.onPointerLeave);
  }

  dispose(): void {
    this.options.domElement.removeEventListener('pointermove', this.onPointerMove);
    this.options.domElement.removeEventListener('pointerleave', this.onPointerLeave);
    window.removeEventListener('blur', this.onPointerLeave);
    if (this.pendingFrame !== 0) cancelAnimationFrame(this.pendingFrame);
    this.options.parent.remove(this.mesh);
    this.geometry.dispose();
    this.material.dispose();
  }

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (event.pointerType === 'touch' || this.options.isBlocked()) {
      this.hide();
      return;
    }
    this.pointerX = event.clientX;
    this.pointerY = event.clientY;
    if (this.pendingFrame !== 0) return;
    this.pendingFrame = requestAnimationFrame(this.updateFromPointer);
  };

  private readonly onPointerLeave = (): void => {
    if (this.pendingFrame !== 0) cancelAnimationFrame(this.pendingFrame);
    this.pendingFrame = 0;
    this.hide();
  };

  private readonly updateFromPointer = (): void => {
    this.pendingFrame = 0;
    if (this.options.isBlocked()) {
      this.hide();
      return;
    }
    const point = this.options.terrainProjector.pick(this.pointerX, this.pointerY);
    if (!point) {
      this.hide();
      return;
    }
    const perimeter = findPlayerAuthoredHoverPerimeter(
      this.options.getState(),
      { x: point.x, z: point.z },
      this.options.getRoadNetwork(),
    );
    if (!perimeter) {
      this.hide();
      return;
    }
    if (perimeter.key === this.currentKey) return;
    const isBuilding = perimeter.key.startsWith('building:');
    this.material.depthTest = isBuilding;

    updateTerrainRibbonGeometry(
      this.geometry,
      polygonSegments(perimeter.polygon),
      this.options.getHeightAt,
      {
        width: isBuilding ? BUILDING_OUTLINE_WIDTH : OUTLINE_WIDTH,
        lift: isBuilding ? BUILDING_OUTLINE_LIFT : OUTLINE_LIFT,
        sampleSpacing: 0.7,
        dashLength: OUTLINE_DASH_LENGTH,
        gapLength: OUTLINE_GAP_LENGTH,
      },
    );
    this.currentKey = perimeter.key;
    this.mesh.visible = true;
  };

  private hide(): void {
    this.currentKey = '';
    this.mesh.visible = false;
  }
}

export function findPlayerAuthoredHoverPerimeter(
  state: GameState,
  point: Point2,
  roadNetwork: RoadNetwork | null,
): HoverPerimeter | null {
  for (const building of state.buildings.values()) {
    const { halfWidth, halfDepth } = getBuildingFootprintHalfExtents(building.kind);
    const dx = point.x - building.x;
    const dz = point.z - building.z;
    if (dx * dx + dz * dz > halfWidth * halfWidth + halfDepth * halfDepth) continue;

    const yaw = buildingPlacementYaw(
      building.kind,
      building.x,
      building.z,
      roadNetwork,
    );
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    const localX = dx * cos - dz * sin;
    const localZ = dx * sin + dz * cos;
    if (Math.abs(localX) > halfWidth || Math.abs(localZ) > halfDepth) continue;

    const polygon = getBuildingFootprintCorners(
      building.kind,
      building.x,
      building.z,
      yaw,
    );
    return { key: `building:${building.id}`, polygon };
  }

  for (const zone of state.burgageZones.values()) {
    const zonePolygon = [zone.cornerA, zone.cornerB, zone.cornerC, zone.cornerD];
    if (!isPointInPolygon2(point, zonePolygon)) continue;
    const layout = layoutFromBurgageZone(zone);
    if (!layout) return { key: `burgage-zone:${zone.id}`, polygon: zonePolygon };
    const parcel = layout.parcels.find((candidate) =>
      isPointInPolygon2(point, candidate.polygon)
    );
    return parcel
      ? { key: `burgage-parcel:${zone.id}:${parcel.index}`, polygon: parcel.polygon }
      : { key: `burgage-zone:${zone.id}`, polygon: zonePolygon };
  }

  for (const graveyard of state.graveyards?.values() ?? []) {
    if (isPointInPolygon2(point, graveyard.corners)) {
      return { key: `graveyard:${graveyard.id}`, polygon: graveyard.corners };
    }
  }

  for (const pasture of state.pastures.values()) {
    if (isPointInPolygon2(point, pasture.corners)) {
      return { key: `pasture:${pasture.id}`, polygon: pasture.corners };
    }
  }

  for (const field of state.farmFields.values()) {
    if (isPointInPolygon2(point, field.corners)) {
      return { key: `farm-field:${field.id}`, polygon: field.corners };
    }
  }

  return null;
}
