import * as THREE from 'three';
import { mulberry32 } from '../props/forestField.ts';
import type { ForagingNodeState } from '../resources/types.ts';
import type { Terrain } from '../terrain/Terrain.ts';
import type { ForagingSite } from './ForagingLayout.ts';
import { isForagingHarvestAvailable } from './foragingSeason.ts';
import { MUSHROOM_PATCH_MAX_SPAWN_RADIUS } from './foragingYields.ts';

export type MushroomPatchVisuals = {
  group: THREE.Group;
  mushroomCount: number;
  sync: (nodes: Iterable<ForagingNodeState>, month: number) => void;
  updateCameraState: (cameraDistance: number, firstPersonActive: boolean) => void;
  dispose: () => void;
};

type MushroomPlacement = {
  nodeId: string;
  x: number;
  z: number;
  yaw: number;
  scale: number;
  visibilityNoise: number;
};

const TAU = Math.PI * 2;
const MUSHROOMS_PER_PATCH = 26;
const CLOSE_WORLD_MAX_CAMERA_DISTANCE = 155;

/** Close-zoom, low-poly mushrooms for persistent deep-forest resource beds. */
export function createMushroomPatchVisuals(
  terrain: Terrain,
  sites: ReadonlyArray<ForagingSite>,
  seed: number,
  isBlockedAt?: (x: number, z: number) => boolean,
): MushroomPatchVisuals {
  const mushroomSites = sites.filter((site) => site.kind === 'mushrooms');
  const rng = mulberry32(seed ^ 0x5a17c3);
  const placements = createPlacements(mushroomSites, rng, isBlockedAt);
  const capacity = Math.max(placements.length, 1);

  const stemGeometry = new THREE.CylinderGeometry(0.055, 0.085, 0.42, 7, 1);
  stemGeometry.translate(0, 0.21, 0);
  const capGeometry = new THREE.SphereGeometry(0.24, 9, 5, 0, TAU, 0, Math.PI * 0.56);
  capGeometry.scale(1, 0.55, 1);
  capGeometry.translate(0, 0.43, 0);

  const stemMaterial = new THREE.MeshStandardMaterial({
    name: 'Mushroom stems',
    color: 0xd8c9a2,
    roughness: 0.92,
    metalness: 0,
  });
  const capMaterial = new THREE.MeshStandardMaterial({
    name: 'Forest mushroom caps',
    color: 0x9c5f32,
    roughness: 0.88,
    metalness: 0,
  });
  const stems = new THREE.InstancedMesh(stemGeometry, stemMaterial, capacity);
  const caps = new THREE.InstancedMesh(capGeometry, capMaterial, capacity);
  stems.name = 'Harvestable mushroom stems';
  caps.name = 'Harvestable mushroom caps';
  stems.count = placements.length;
  caps.count = placements.length;
  stems.castShadow = false;
  caps.castShadow = false;
  stems.receiveShadow = true;
  caps.receiveShadow = true;
  stems.frustumCulled = false;
  caps.frustumCulled = false;

  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const tint = new THREE.Color();
  const baseMatrices: THREE.Matrix4[] = [];
  placements.forEach((placement, index) => {
    position.set(
      placement.x,
      terrain.getHeightAt(placement.x, placement.z) + 0.025,
      placement.z,
    );
    quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), placement.yaw);
    scale.setScalar(placement.scale);
    matrix.compose(position, quaternion, scale);
    baseMatrices.push(matrix.clone());
    stems.setMatrixAt(index, matrix);
    caps.setMatrixAt(index, matrix);
    tint.setHSL(
      THREE.MathUtils.lerp(0.035, 0.095, rng()),
      THREE.MathUtils.lerp(0.46, 0.72, rng()),
      THREE.MathUtils.lerp(0.28, 0.48, rng()),
    );
    caps.setColorAt(index, tint);
  });
  stems.instanceMatrix.needsUpdate = true;
  caps.instanceMatrix.needsUpdate = true;
  if (caps.instanceColor) caps.instanceColor.needsUpdate = true;

  const group = new THREE.Group();
  group.name = 'Deep-forest mushroom resource beds';
  group.userData.mushroomPatchCenters = mushroomSites.map((site, index) => ({
    nodeId: `foraging-mushrooms-${index}`,
    x: site.x,
    z: site.z,
  }));
  group.add(stems, caps);

  const hiddenMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
  const sync = (nodes: Iterable<ForagingNodeState>, month: number): void => {
    const byId = new Map(Array.from(nodes, (node) => [node.nodeId, node] as const));
    const seasonAvailable = isForagingHarvestAvailable('mushrooms', month);
    placements.forEach((placement, index) => {
      const node = byId.get(placement.nodeId);
      const ratio = node && node.maxYield > 0
        ? THREE.MathUtils.clamp(node.remaining / node.maxYield, 0, 1)
        : 0;
      const visible = seasonAvailable && placement.visibilityNoise < ratio;
      const next = visible ? baseMatrices[index] : hiddenMatrix;
      stems.setMatrixAt(index, next);
      caps.setMatrixAt(index, next);
    });
    stems.instanceMatrix.needsUpdate = true;
    caps.instanceMatrix.needsUpdate = true;
  };

  return {
    group,
    mushroomCount: placements.length,
    sync,
    updateCameraState: (cameraDistance, firstPersonActive) => {
      group.visible = firstPersonActive || cameraDistance <= CLOSE_WORLD_MAX_CAMERA_DISTANCE;
    },
    dispose: () => {
      stemGeometry.dispose();
      capGeometry.dispose();
      stemMaterial.dispose();
      capMaterial.dispose();
    },
  };
}

function createPlacements(
  sites: ReadonlyArray<ForagingSite>,
  random: () => number,
  isBlockedAt?: (x: number, z: number) => boolean,
): MushroomPlacement[] {
  const placements: MushroomPlacement[] = [];
  sites.forEach((site, siteIndex) => {
    const patch: MushroomPlacement[] = [];
    let attempts = 0;
    while (patch.length < MUSHROOMS_PER_PATCH && attempts < MUSHROOMS_PER_PATCH * 24) {
      attempts++;
      const radius = Math.sqrt(random()) * MUSHROOM_PATCH_MAX_SPAWN_RADIUS;
      const angle = random() * TAU;
      const x = site.x + Math.cos(angle) * radius;
      const z = site.z + Math.sin(angle) * radius * 0.82;
      if (isBlockedAt?.(x, z)) continue;
      if (patch.some((entry) => Math.hypot(entry.x - x, entry.z - z) < 0.62)) continue;
      patch.push({
        nodeId: `foraging-mushrooms-${siteIndex}`,
        x,
        z,
        yaw: random() * TAU,
        scale: THREE.MathUtils.lerp(0.72, 1.42, random()),
        visibilityNoise: random(),
      });
    }
    placements.push(...patch);
  });
  return placements;
}
