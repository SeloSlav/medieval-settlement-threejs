import * as THREE from 'three';
import { BASELINE_ORBIT_DISTANCE } from '../camera/CameraCurves.ts';
import type { TerrainBounds } from './Terrain.ts';

export const PLAYABLE_MAP_BOUNDARY_PARAMETERS = Object.freeze({
  color: 0xb83f43,
  maximumOpacity: 0.68,
  fullyVisibleThroughZoomPercent: 55,
  hiddenFromZoomPercent: 88,
  widthToMapSize: 0.0075,
  minimumWidth: 6,
  maximumWidth: 16,
  terrainLift: 0.48,
  sampleSpacing: 4,
  maximumTriangles: 6_000,
});

export type PlayableMapBoundaryDiagnostics = {
  width: number;
  opacity: number;
  visible: boolean;
  vertexCount: number;
  triangleCount: number;
  drawCalls: number;
};

type TerrainBoundarySource = {
  bounds: TerrainBounds;
  getHeightAt(x: number, z: number): number;
};

type BoundaryPair = {
  outerX: number;
  outerZ: number;
  innerX: number;
  innerZ: number;
};

/**
 * Strategic-only visibility factor. The boundary stays stable through broad
 * navigation, then hands the view back to the authored world before the
 * normal 100% gameplay scale.
 */
export function playableMapBoundaryVisibilityAtZoom(
  zoomPercent: number,
  firstPersonActive = false,
): number {
  if (firstPersonActive || !Number.isFinite(zoomPercent)) return 0;
  return 1 - THREE.MathUtils.smoothstep(
    zoomPercent,
    PLAYABLE_MAP_BOUNDARY_PARAMETERS.fullyVisibleThroughZoomPercent,
    PLAYABLE_MAP_BOUNDARY_PARAMETERS.hiddenFromZoomPercent,
  );
}

export function playableMapBoundaryVisibilityAtDistance(
  cameraDistance: number,
  firstPersonActive = false,
): number {
  if (!Number.isFinite(cameraDistance) || cameraDistance <= 0) return 0;
  return playableMapBoundaryVisibilityAtZoom(
    BASELINE_ORBIT_DISTANCE / cameraDistance * 100,
    firstPersonActive,
  );
}

/**
 * A single terrain-conforming rectangular annulus whose centreline is the
 * authoritative playable bound. The paired outer/inner contours give the
 * square corners proper mitered joins instead of four visibly capped strips.
 */
export class PlayableMapBoundary {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  readonly width: number;

  constructor(source: TerrainBoundarySource) {
    const mapSize = Math.max(
      source.bounds.maxX - source.bounds.minX,
      source.bounds.maxZ - source.bounds.minZ,
    );
    this.width = THREE.MathUtils.clamp(
      mapSize * PLAYABLE_MAP_BOUNDARY_PARAMETERS.widthToMapSize,
      PLAYABLE_MAP_BOUNDARY_PARAMETERS.minimumWidth,
      PLAYABLE_MAP_BOUNDARY_PARAMETERS.maximumWidth,
    );

    const geometry = createBoundaryGeometry(
      source.bounds,
      source.getHeightAt.bind(source),
      this.width,
    );
    const material = new THREE.MeshBasicMaterial({
      color: PLAYABLE_MAP_BOUNDARY_PARAMETERS.color,
      transparent: true,
      opacity: 0,
      depthTest: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.name = 'Playable map strategic boundary';
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.renderOrder = 12;
    this.mesh.visible = false;
    this.mesh.userData.playableMapBoundary = true;
  }

  update(cameraDistance: number, firstPersonActive: boolean): void {
    const visibility = playableMapBoundaryVisibilityAtDistance(
      cameraDistance,
      firstPersonActive,
    );
    this.mesh.material.opacity = visibility
      * PLAYABLE_MAP_BOUNDARY_PARAMETERS.maximumOpacity;
    this.mesh.visible = visibility > 0.01;
  }

  getDiagnostics(): PlayableMapBoundaryDiagnostics {
    const index = this.mesh.geometry.getIndex();
    const positions = this.mesh.geometry.getAttribute('position');
    return {
      width: this.width,
      opacity: this.mesh.material.opacity,
      visible: this.mesh.visible,
      vertexCount: positions?.count ?? 0,
      triangleCount: index ? index.count / 3 : 0,
      drawCalls: this.mesh.visible ? 1 : 0,
    };
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}

function createBoundaryGeometry(
  bounds: TerrainBounds,
  getHeightAt: (x: number, z: number) => number,
  width: number,
): THREE.BufferGeometry {
  const pairs: BoundaryPair[] = [];
  const halfWidth = width * 0.5;
  const sideLengthX = bounds.maxX - bounds.minX;
  const sideLengthZ = bounds.maxZ - bounds.minZ;
  const stepsX = Math.max(
    1,
    Math.ceil(sideLengthX / PLAYABLE_MAP_BOUNDARY_PARAMETERS.sampleSpacing),
  );
  const stepsZ = Math.max(
    1,
    Math.ceil(sideLengthZ / PLAYABLE_MAP_BOUNDARY_PARAMETERS.sampleSpacing),
  );

  appendHorizontalSide(
    pairs,
    bounds.minX,
    bounds.maxX,
    bounds.maxZ,
    halfWidth,
    stepsX,
    1,
  );
  appendVerticalSide(
    pairs,
    bounds.maxZ,
    bounds.minZ,
    bounds.maxX,
    halfWidth,
    stepsZ,
    1,
  );
  appendHorizontalSide(
    pairs,
    bounds.maxX,
    bounds.minX,
    bounds.minZ,
    halfWidth,
    stepsX,
    -1,
  );
  appendVerticalSide(
    pairs,
    bounds.minZ,
    bounds.maxZ,
    bounds.minX,
    halfWidth,
    stepsZ,
    -1,
  );

  const positions = new Float32Array(pairs.length * 2 * 3);
  const indices: number[] = [];
  for (let index = 0; index < pairs.length; index += 1) {
    const pair = pairs[index]!;
    const positionOffset = index * 6;
    positions[positionOffset] = pair.outerX;
    positions[positionOffset + 1] = getHeightAt(pair.outerX, pair.outerZ)
      + PLAYABLE_MAP_BOUNDARY_PARAMETERS.terrainLift;
    positions[positionOffset + 2] = pair.outerZ;
    positions[positionOffset + 3] = pair.innerX;
    positions[positionOffset + 4] = getHeightAt(pair.innerX, pair.innerZ)
      + PLAYABLE_MAP_BOUNDARY_PARAMETERS.terrainLift;
    positions[positionOffset + 5] = pair.innerZ;

    const next = (index + 1) % pairs.length;
    const outer = index * 2;
    const inner = outer + 1;
    const nextOuter = next * 2;
    const nextInner = nextOuter + 1;
    indices.push(
      outer,
      nextOuter,
      inner,
      nextOuter,
      nextInner,
      inner,
    );
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function appendHorizontalSide(
  target: BoundaryPair[],
  startX: number,
  endX: number,
  centerZ: number,
  halfWidth: number,
  steps: number,
  outwardZ: 1 | -1,
): void {
  const outwardStartX = startX < endX ? -halfWidth : halfWidth;
  const outwardEndX = -outwardStartX;
  for (let step = 0; step < steps; step += 1) {
    const t = step / steps;
    target.push({
      outerX: THREE.MathUtils.lerp(
        startX + outwardStartX,
        endX + outwardEndX,
        t,
      ),
      outerZ: centerZ + outwardZ * halfWidth,
      innerX: THREE.MathUtils.lerp(
        startX - outwardStartX,
        endX - outwardEndX,
        t,
      ),
      innerZ: centerZ - outwardZ * halfWidth,
    });
  }
}

function appendVerticalSide(
  target: BoundaryPair[],
  startZ: number,
  endZ: number,
  centerX: number,
  halfWidth: number,
  steps: number,
  outwardX: 1 | -1,
): void {
  const outwardStartZ = startZ > endZ ? halfWidth : -halfWidth;
  const outwardEndZ = -outwardStartZ;
  for (let step = 0; step < steps; step += 1) {
    const t = step / steps;
    target.push({
      outerX: centerX + outwardX * halfWidth,
      outerZ: THREE.MathUtils.lerp(
        startZ + outwardStartZ,
        endZ + outwardEndZ,
        t,
      ),
      innerX: centerX - outwardX * halfWidth,
      innerZ: THREE.MathUtils.lerp(
        startZ - outwardStartZ,
        endZ - outwardEndZ,
        t,
      ),
    });
  }
}
