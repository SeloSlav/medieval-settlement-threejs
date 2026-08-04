import * as THREE from 'three';
import {
  polygonSegments,
  updateTerrainCircleRibbonGeometry,
  updateTerrainQuadGeometry,
  updateTerrainRibbonGeometry,
} from '../placement/TerrainOverlayGeometry.ts';
import type { BuildingKind } from '../resources/types.ts';
import { getBuildingDefinition } from '../resources/buildings.ts';
import { disposeObject3D } from '../utils/dispose.ts';
import {
  fireCoverageColor,
  hasFireRiskPlanningOverlay,
  type FireCoverageBand,
} from '../fires/fireRiskPolicy.ts';
import { FIRE_SPREAD_RADIUS } from '../generated/gameBalance.ts';
import { getBuildingFootprintCorners } from './BuildingTerrainLayout.ts';
import { buildingExtentColor, getBuildingExtent } from './buildingExtents.ts';

const PREVIEW_COLORS = {
  valid: 0xfffdf5,
  invalid: 0xff5d50,
} as const;

const FOOTPRINT_FILL_LIFT = 0.105;
const FOOTPRINT_BORDER_LIFT = 0.145;
const FOOTPRINT_BORDER_WIDTH = 0.34;
const EXTENT_BORDER_LIFT = 0.165;
const EXTENT_BORDER_WIDTH = 0.78;
const FIRE_RISK_BORDER_LIFT = 0.175;
const FIRE_RISK_BORDER_WIDTH = 0.62;
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

  const definition = getBuildingDefinition(kind);
  const extent = getBuildingExtent(kind, definition.workRadius);
  if (extent) {
    const extentColor = buildingExtentColor(kind);
    const extentRing = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({
        color: extentColor,
        transparent: true,
        opacity: 0.68,
        depthTest: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -3,
        polygonOffsetUnits: -3,
      }),
    );
    extentRing.name = 'Building placement extent';
    extentRing.userData.previewRole = 'extent';
    extentRing.userData.extentRadius = extent.radius;
    extentRing.userData.extentLabel = extent.label;
    extentRing.userData.validColor = extentColor;
    extentRing.renderOrder = PREVIEW_RENDER_ORDER + 2;
    extentRing.frustumCulled = false;
    group.add(extentRing);
  }

  if (hasFireRiskPlanningOverlay(kind)) {
    const fireRiskRing = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({
        color: fireCoverageColor('uncovered'),
        transparent: true,
        opacity: 0.8,
        depthTest: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -3,
        polygonOffsetUnits: -3,
      }),
    );
    fireRiskRing.name = 'Building fire spread range';
    fireRiskRing.userData.previewRole = 'fire-risk';
    fireRiskRing.userData.extentRadius = FIRE_SPREAD_RADIUS;
    fireRiskRing.userData.extentLabel = 'Fire spread range';
    fireRiskRing.renderOrder = PREVIEW_RENDER_ORDER + 3;
    fireRiskRing.frustumCulled = false;
    group.add(fireRiskRing);
  }

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

  const extentRing = group.getObjectByName('Building placement extent');
  const definition = getBuildingDefinition(kind);
  const extent = getBuildingExtent(kind, definition.workRadius);
  if (extentRing instanceof THREE.Mesh && extent) {
    updateTerrainCircleRibbonGeometry(
      extentRing.geometry,
      { x, z },
      extent.radius,
      getHeightAt,
      {
        width: EXTENT_BORDER_WIDTH,
        lift: EXTENT_BORDER_LIFT,
        sampleSpacing: 5.5,
        dashLength: 4.8,
        gapLength: 3.2,
      },
    );
  }

  const fireRiskRing = group.getObjectByName('Building fire spread range');
  if (fireRiskRing instanceof THREE.Mesh) {
    updateTerrainCircleRibbonGeometry(
      fireRiskRing.geometry,
      { x, z },
      FIRE_SPREAD_RADIUS,
      getHeightAt,
      {
        width: FIRE_RISK_BORDER_WIDTH,
        lift: FIRE_RISK_BORDER_LIFT,
        sampleSpacing: 4.8,
        dashLength: 2.4,
        gapLength: 2.1,
      },
    );
  }
}

export function updateBuildingPreviewAppearance(
  group: THREE.Group,
  valid: boolean,
  fireCoverage: FireCoverageBand | null = null,
): void {
  const color = valid ? PREVIEW_COLORS.valid : PREVIEW_COLORS.invalid;
  group.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const material = object.material;
    if (!(material instanceof THREE.MeshBasicMaterial)) return;
    if (object.userData.previewRole === 'fire-risk') {
      material.color.setHex(
        valid
          ? fireCoverageColor(fireCoverage ?? 'uncovered')
          : PREVIEW_COLORS.invalid,
      );
      material.opacity = valid ? 0.8 : 0.3;
      return;
    }
    if (object.userData.previewRole === 'extent') {
      material.color.setHex(valid ? object.userData.validColor as number : PREVIEW_COLORS.invalid);
      material.opacity = valid ? 0.68 : 0.32;
      return;
    }
    material.color.setHex(color);
    material.opacity = object.userData.previewRole === 'border'
      ? valid ? 0.94 : 0.98
      : valid ? 0.2 : 0.18;
  });
}

export function disposeBuildingPreviewMesh(group: THREE.Group): void {
  disposeObject3D(group, true);
}
