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
  camera: THREE.PerspectiveCamera;
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

const OUTLINE_WIDTH_PX = 4.5;
const OUTLINE_DASH_LENGTH_PX = 12;
const OUTLINE_GAP_LENGTH_PX = 9;
const OUTLINE_LIFT = 0.24;
const BUILDING_OUTLINE_LIFT = 0.08;
const OUTLINE_RENDER_ORDER = 100;
const SCALE_CHANGE_THRESHOLD = 0.015;

/**
 * Shows one high-contrast, terrain-following perimeter for the authored object
 * beneath the pointer. The world-space ribbon is rebuilt as the camera moves so
 * its thickness and dash rhythm remain visually constant at every zoom level.
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
  private readonly perimeterCenter = new THREE.Vector3();
  private readonly viewCenter = new THREE.Vector3();
  private currentPerimeter: HoverPerimeter | null = null;
  private currentKey = '';
  private lastWorldUnitsPerPixel = Number.NaN;
  private pointerX = 0;
  private pointerY = 0;
  private pendingFrame = 0;
  private cameraFrame = 0;

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
    if (this.cameraFrame !== 0) cancelAnimationFrame(this.cameraFrame);
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
    if (perimeter.key === this.currentKey) {
      this.ensureCameraTracking();
      return;
    }
    const isBuilding = perimeter.key.startsWith('building:');
    this.material.depthTest = isBuilding;
    this.currentPerimeter = perimeter;
    this.currentKey = perimeter.key;
    this.lastWorldUnitsPerPixel = Number.NaN;
    this.updateGeometryForCamera(true);
    this.mesh.visible = true;
    this.ensureCameraTracking();
  };

  private readonly updateFromCamera = (): void => {
    this.cameraFrame = 0;
    if (!this.mesh.visible || !this.currentPerimeter) return;
    this.updateGeometryForCamera(false);
    this.ensureCameraTracking();
  };

  private ensureCameraTracking(): void {
    if (this.cameraFrame !== 0 || !this.mesh.visible) return;
    this.cameraFrame = requestAnimationFrame(this.updateFromCamera);
  }

  private updateGeometryForCamera(force: boolean): void {
    const perimeter = this.currentPerimeter;
    if (!perimeter) return;

    let centerX = 0;
    let centerZ = 0;
    for (const point of perimeter.polygon) {
      centerX += point.x;
      centerZ += point.z;
    }
    centerX /= Math.max(1, perimeter.polygon.length);
    centerZ /= Math.max(1, perimeter.polygon.length);
    this.perimeterCenter.set(
      centerX,
      this.options.getHeightAt(centerX, centerZ),
      centerZ,
    );

    const camera = this.options.camera;
    camera.updateMatrixWorld();
    this.viewCenter.copy(this.perimeterCenter).applyMatrix4(camera.matrixWorldInverse);
    const viewDepth = Math.max(camera.near, -this.viewCenter.z);
    const viewportHeight = Math.max(1, this.options.domElement.clientHeight);
    const worldUnitsPerPixel = (
      2 * viewDepth * Math.tan(THREE.MathUtils.degToRad(camera.fov) * 0.5)
    ) / viewportHeight;
    if (
      !force
      && Number.isFinite(this.lastWorldUnitsPerPixel)
      && Math.abs(worldUnitsPerPixel - this.lastWorldUnitsPerPixel)
        <= this.lastWorldUnitsPerPixel * SCALE_CHANGE_THRESHOLD
    ) return;

    this.lastWorldUnitsPerPixel = worldUnitsPerPixel;
    const dashLength = worldUnitsPerPixel * OUTLINE_DASH_LENGTH_PX;
    updateTerrainRibbonGeometry(
      this.geometry,
      polygonSegments(perimeter.polygon),
      this.options.getHeightAt,
      {
        width: worldUnitsPerPixel * OUTLINE_WIDTH_PX,
        lift: perimeter.key.startsWith('building:')
          ? BUILDING_OUTLINE_LIFT
          : OUTLINE_LIFT,
        sampleSpacing: Math.max(0.1, dashLength * 0.25),
        dashLength,
        gapLength: worldUnitsPerPixel * OUTLINE_GAP_LENGTH_PX,
      },
    );
  }

  private hide(): void {
    if (this.cameraFrame !== 0) cancelAnimationFrame(this.cameraFrame);
    this.cameraFrame = 0;
    this.currentPerimeter = null;
    this.currentKey = '';
    this.lastWorldUnitsPerPixel = Number.NaN;
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
