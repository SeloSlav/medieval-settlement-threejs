import * as THREE from 'three';
import {
  polygonSegments,
  updateTerrainQuadGeometry,
  updateTerrainRibbonGeometry,
} from '../placement/TerrainOverlayGeometry.ts';
import type { BuildingKind } from '../resources/types.ts';
import { disposeObject3D } from '../utils/dispose.ts';
import { getBuildingFootprintCorners } from './BuildingTerrainLayout.ts';

const PREVIEW_COLORS = {
  valid: 0xfffdf5,
  invalid: 0xff5d50,
} as const;

const FOOTPRINT_FILL_LIFT = 0.105;
const FOOTPRINT_BORDER_LIFT = 0.145;
const FOOTPRINT_BORDER_WIDTH = 0.34;
const PREVIEW_RENDER_ORDER = 12;

export function createBuildingPreviewMesh(kind: BuildingKind): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Terrain-hugging building footprint';
  group.userData.previewKind = kind;
  group.frustumCulled = false;
  group.renderOrder = PREVIEW_RENDER_ORDER;

  const fill = new THREE.Mesh(
    new THREE.BufferGeometry(),
    new THREE.MeshBasicMaterial({
      color: PREVIEW_COLORS.valid,
      transparent: true,
      opacity: 0.2,
      depthTest: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    }),
  );
  fill.name = 'Building footprint fill';
  fill.userData.previewRole = 'fill';
  fill.renderOrder = PREVIEW_RENDER_ORDER;
  fill.frustumCulled = false;
  group.add(fill);

  const border = new THREE.Mesh(
    new THREE.BufferGeometry(),
    new THREE.MeshBasicMaterial({
      color: PREVIEW_COLORS.valid,
      transparent: true,
      opacity: 0.94,
      depthTest: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
    }),
  );
  border.name = 'Building footprint border';
  border.userData.previewRole = 'border';
  border.renderOrder = PREVIEW_RENDER_ORDER + 1;
  border.frustumCulled = false;
  group.add(border);

  return group;
}

export function updateBuildingPreviewGeometry(
  group: THREE.Group,
  kind: BuildingKind,
  x: number,
  z: number,
  yaw: number,
  getHeightAt: (x: number, z: number) => number,
): void {
  const corners = getBuildingFootprintCorners(kind, x, z, yaw);

  const fill = group.getObjectByName('Building footprint fill');
  if (fill instanceof THREE.Mesh) {
    updateTerrainQuadGeometry(
      fill.geometry,
      corners,
      getHeightAt,
      FOOTPRINT_FILL_LIFT,
      7,
      7,
    );
  }

  const border = group.getObjectByName('Building footprint border');
  if (border instanceof THREE.Mesh) {
    updateTerrainRibbonGeometry(
      border.geometry,
      polygonSegments(corners),
      getHeightAt,
      {
        width: FOOTPRINT_BORDER_WIDTH,
        lift: FOOTPRINT_BORDER_LIFT,
        sampleSpacing: 0.95,
      },
    );
  }
}

export function updateBuildingPreviewAppearance(
  group: THREE.Group,
  valid: boolean,
): void {
  const color = valid ? PREVIEW_COLORS.valid : PREVIEW_COLORS.invalid;
  group.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const material = object.material;
    if (!(material instanceof THREE.MeshBasicMaterial)) return;
    material.color.setHex(color);
    material.opacity = object.userData.previewRole === 'border'
      ? valid ? 0.94 : 0.98
      : valid ? 0.2 : 0.18;
  });
}

export function disposeBuildingPreviewMesh(group: THREE.Group): void {
  disposeObject3D(group, true);
}
