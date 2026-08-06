import * as THREE from 'three';
import { Terrain } from './Terrain.ts';

export class TerrainProjector {
  private readonly terrain: Terrain;
  private readonly camera: THREE.Camera;
  private readonly raycaster = new THREE.Raycaster();
  private readonly mouse = new THREE.Vector2();
  private readonly hitScratch = new THREE.Vector3();
  private readonly rayInterval = { min: 0, max: 0 };
  private viewportLeft = 0;
  private viewportTop = 0;
  private viewportWidth = 1;
  private viewportHeight = 1;

  constructor(terrain: Terrain, camera: THREE.Camera, domElement: HTMLElement) {
    this.terrain = terrain;
    this.camera = camera;
    this.setViewportRect(domElement.getBoundingClientRect());
  }

  setViewportRect(rect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>): void {
    this.viewportLeft = rect.left;
    this.viewportTop = rect.top;
    this.viewportWidth = Math.max(1, rect.width);
    this.viewportHeight = Math.max(1, rect.height);
  }

  pick(clientX: number, clientY: number): THREE.Vector3 | null {
    this.mouse.x = ((clientX - this.viewportLeft) / this.viewportWidth) * 2 - 1;
    this.mouse.y = -((clientY - this.viewportTop) / this.viewportHeight) * 2 + 1;
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const cameraFar = (this.camera as THREE.Camera & { far?: number }).far;
    const maxDistance = Number.isFinite(cameraFar) && cameraFar! > 0
      ? cameraFar!
      : this.terrain.size * 4;
    return intersectTerrainHeightfieldRay(
      this.raycaster.ray,
      this.terrain,
      maxDistance,
      this.hitScratch,
      this.rayInterval,
    );
  }

  project(point: THREE.Vector3, offset = 0): THREE.Vector3 {
    return new THREE.Vector3(point.x, this.terrain.getHeightAt(point.x, point.z) + offset, point.z);
  }
}

type HeightfieldTerrain = Pick<Terrain, 'size' | 'resolution' | 'getHeightAt'>;

/**
 * Finds the first ray/heightfield crossing without testing the terrain's
 * million-plus render triangles. Sampling below one grid-cell spacing and
 * bisecting the crossing retains placement precision at a tiny fixed cost.
 */
export function intersectTerrainHeightfieldRay(
  ray: THREE.Ray,
  terrain: HeightfieldTerrain,
  maxDistance: number,
  target = new THREE.Vector3(),
  interval = { min: 0, max: 0 },
): THREE.Vector3 | null {
  const half = terrain.size * 0.5;
  interval.min = 0;
  interval.max = Math.max(0, maxDistance);
  if (!clipRayAxis(ray.origin.x, ray.direction.x, -half, half, interval)) return null;
  if (!clipRayAxis(ray.origin.z, ray.direction.z, -half, half, interval)) return null;
  if (interval.max < interval.min) return null;

  const horizontalRate = Math.hypot(ray.direction.x, ray.direction.z);
  const horizontalDistance = (interval.max - interval.min) * horizontalRate;
  const cellSize = terrain.size / Math.max(1, terrain.resolution - 1);
  const sampleCount = Math.max(
    1,
    Math.min(terrain.resolution * 2, Math.ceil(horizontalDistance / (cellSize * 0.75))),
  );

  let previousT = interval.min;
  let previousDelta = rayHeightDelta(ray, terrain, previousT);
  if (Math.abs(previousDelta) <= 1e-5) return writeTerrainHit(ray, terrain, previousT, target);

  for (let index = 1; index <= sampleCount; index += 1) {
    const t = THREE.MathUtils.lerp(interval.min, interval.max, index / sampleCount);
    const delta = rayHeightDelta(ray, terrain, t);
    if (Math.abs(delta) <= 1e-5) return writeTerrainHit(ray, terrain, t, target);
    if ((previousDelta > 0) !== (delta > 0)) {
      return refineTerrainHit(
        ray,
        terrain,
        previousT,
        previousDelta,
        t,
        target,
      );
    }
    previousT = t;
    previousDelta = delta;
  }
  return null;
}

function clipRayAxis(
  origin: number,
  direction: number,
  minimum: number,
  maximum: number,
  interval: { min: number; max: number },
): boolean {
  if (Math.abs(direction) <= 1e-10) return origin >= minimum && origin <= maximum;
  const inverse = 1 / direction;
  const a = (minimum - origin) * inverse;
  const b = (maximum - origin) * inverse;
  interval.min = Math.max(interval.min, Math.min(a, b));
  interval.max = Math.min(interval.max, Math.max(a, b));
  return interval.max >= interval.min;
}

function rayHeightDelta(ray: THREE.Ray, terrain: HeightfieldTerrain, t: number): number {
  const x = ray.origin.x + ray.direction.x * t;
  const z = ray.origin.z + ray.direction.z * t;
  return ray.origin.y + ray.direction.y * t - terrain.getHeightAt(x, z);
}

function refineTerrainHit(
  ray: THREE.Ray,
  terrain: HeightfieldTerrain,
  startT: number,
  startDelta: number,
  endT: number,
  target: THREE.Vector3,
): THREE.Vector3 {
  let lowT = startT;
  let lowDelta = startDelta;
  let highT = endT;
  for (let iteration = 0; iteration < 12; iteration += 1) {
    const middleT = (lowT + highT) * 0.5;
    const middleDelta = rayHeightDelta(ray, terrain, middleT);
    if ((lowDelta > 0) === (middleDelta > 0)) {
      lowT = middleT;
      lowDelta = middleDelta;
    } else {
      highT = middleT;
    }
  }
  return writeTerrainHit(ray, terrain, (lowT + highT) * 0.5, target);
}

function writeTerrainHit(
  ray: THREE.Ray,
  terrain: HeightfieldTerrain,
  t: number,
  target: THREE.Vector3,
): THREE.Vector3 {
  const x = ray.origin.x + ray.direction.x * t;
  const z = ray.origin.z + ray.direction.z * t;
  return target.set(x, terrain.getHeightAt(x, z), z);
}

