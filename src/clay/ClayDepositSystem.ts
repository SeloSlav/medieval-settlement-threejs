import * as THREE from 'three';
import type { ResourceNodeState } from '../resources/types.ts';
import type { Terrain } from '../terrain/Terrain.ts';
import {
  clayDepositNodeId,
  type ClayDepositLayout,
  type ClayDepositSite,
} from './ClayDepositLayout.ts';

export type ClayDepositSystem = {
  group: THREE.Group;
  syncNodes: (nodes: Iterable<ResourceNodeState>) => boolean;
  isBlockedAt: (x: number, z: number) => boolean;
  isGrassBlockedAt: (x: number, z: number) => boolean;
  dispose: () => void;
};

const CLAY_COLORS = [0x8f5338, 0xa96643, 0xc18155] as const;

type ClayDepositVisual = {
  nodeId: string;
  isRich: boolean;
  exposedStrata: THREE.Mesh[];
};

export function createClayDepositSystem(
  terrain: Terrain,
  layout: ClayDepositLayout,
): ClayDepositSystem {
  const group = new THREE.Group();
  group.name = 'Clay deposits';
  const materials = CLAY_COLORS.map((color, index) =>
    new THREE.MeshStandardMaterial({
      color,
      roughness: 0.94 - index * 0.03,
      metalness: 0,
      polygonOffset: true,
      polygonOffsetFactor: -1 - index,
      polygonOffsetUnits: -1 - index,
    })
  );

  const visuals: ClayDepositVisual[] = layout.sites.map((site, index) => {
    const visual = createClayBankPatch(terrain, site, materials);
    group.add(visual.group);
    return {
      nodeId: clayDepositNodeId(site, index),
      isRich: site.kind === 'rich',
      exposedStrata: visual.exposedStrata,
    };
  });

  return {
    group,
    syncNodes: (nodes) => {
      const byId = new Map([...nodes].map((node) => [node.nodeId, node]));
      let changed = false;
      for (const visual of visuals) {
        const node = byId.get(visual.nodeId);
        const hasExposedClay = visual.isRich
          || !node
          || node.remaining > 1e-6;
        for (const stratum of visual.exposedStrata) {
          if (stratum.visible === hasExposedClay) continue;
          stratum.visible = hasExposedClay;
          changed = true;
        }
      }
      return changed;
    },
    isBlockedAt: (x, z) => layout.isBlockedForProps(x, z),
    isGrassBlockedAt: (x, z) => layout.isBlockedForGrass(x, z),
    dispose: () => {
      group.traverse((object) => {
        if (object instanceof THREE.Mesh) object.geometry.dispose();
      });
      for (const material of materials) material.dispose();
    },
  };
}

function createClayBankPatch(
  terrain: Terrain,
  site: ClayDepositSite,
  materials: readonly THREE.MeshStandardMaterial[],
): { group: THREE.Group; exposedStrata: THREE.Mesh[] } {
  const group = new THREE.Group();
  const exposedStrata: THREE.Mesh[] = [];
  const gradeLabel = site.kind === 'rich' ? 'rich' : 'ordinary';
  group.name = `Exposed ${gradeLabel} alluvial clay`;

  const patch = new THREE.Mesh(
    createTerrainConformingPatch(
      terrain,
      site,
      1,
      0,
      0.035,
      site.kind === 'rich' ? 0.32 : 0.22,
    ),
    materials[0],
  );
  patch.name = `${site.kind === 'rich' ? 'Rich' : 'Ordinary'} clay bank surface`;
  patch.castShadow = true;
  patch.receiveShadow = true;
  group.add(patch);

  const strata = [
    { scale: 0.76, offset: -0.9, lift: 0.085, crown: 0.3, materialIndex: 1 },
    { scale: 0.52, offset: 1.4, lift: 0.15, crown: 0.34, materialIndex: 2 },
  ].slice(0, site.kind === 'rich' ? 2 : 1);
  for (let index = 0; index < strata.length; index++) {
    const layer = strata[index];
    const seam = new THREE.Mesh(
      createTerrainConformingPatch(
        terrain,
        site,
        layer.scale,
        layer.offset,
        layer.lift,
        layer.crown,
      ),
      materials[layer.materialIndex],
    );
    seam.name = `${site.kind === 'rich' ? 'Rich' : 'Ordinary'} clay exposed stratum ${index + 1}`;
    seam.castShadow = true;
    seam.receiveShadow = true;
    exposedStrata.push(seam);
    group.add(seam);
  }

  const clods = createClayClods(terrain, site, materials);
  exposedStrata.push(...clods);
  group.add(...clods);

  return { group, exposedStrata };
}

function createClayClods(
  terrain: Terrain,
  site: ClayDepositSite,
  materials: readonly THREE.MeshStandardMaterial[],
): THREE.Mesh[] {
  const clods: THREE.Mesh[] = [];
  const count = site.kind === 'rich' ? 18 : 11;
  const seed = Math.round(site.x * 97)
    ^ Math.round(site.z * 193)
    ^ (site.kind === 'rich' ? 0x6d2b79f5 : 0x29c3);
  const cos = Math.cos(site.rotation);
  const sin = Math.sin(site.rotation);

  for (let index = 0; index < count; index++) {
    const angle = pseudoRandom(seed, index * 4) * Math.PI * 2;
    const radius = Math.sqrt(pseudoRandom(seed, index * 4 + 1)) * 0.82;
    const localX = Math.cos(angle) * site.radiusX * radius;
    const localZ = Math.sin(angle) * site.radiusZ * radius;
    const x = site.x + localX * cos - localZ * sin;
    const z = site.z + localX * sin + localZ * cos;
    const size = (site.kind === 'rich' ? 0.86 : 0.72)
      * (0.62 + pseudoRandom(seed, index * 4 + 2) * 0.72);
    const verticalScale = size * (0.48 + pseudoRandom(seed, index * 4 + 3) * 0.22);
    const clod = new THREE.Mesh(
      new THREE.DodecahedronGeometry(1, 0),
      materials[1 + index % (materials.length - 1)],
    );
    clod.name = `${site.kind === 'rich' ? 'Rich' : 'Ordinary'} clay clod ${index + 1}`;
    clod.position.set(x, terrain.getHeightAt(x, z) + verticalScale * 0.42, z);
    clod.rotation.set(
      (pseudoRandom(seed ^ 0x5a17, index) - 0.5) * 0.3,
      angle,
      (pseudoRandom(seed ^ 0x71c9, index) - 0.5) * 0.3,
    );
    clod.scale.set(size * 1.18, verticalScale, size * 0.92);
    clod.castShadow = true;
    clod.receiveShadow = true;
    clods.push(clod);
  }

  return clods;
}

function createTerrainConformingPatch(
  terrain: Terrain,
  site: ClayDepositSite,
  scale: number,
  lateralOffset: number,
  lift = 0.025,
  crownHeight = 0,
): THREE.BufferGeometry {
  const segments = 48;
  const radialSegments = 4;
  const positions: number[] = [];
  const indices: number[] = [];
  const cos = Math.cos(site.rotation);
  const sin = Math.sin(site.rotation);
  const centerX = site.x - sin * lateralOffset;
  const centerZ = site.z + cos * lateralOffset;
  const centerY = terrain.getHeightAt(centerX, centerZ) + lift + crownHeight;
  positions.push(centerX, centerY, centerZ);

  for (let ring = 1; ring <= radialSegments; ring++) {
    const radialT = ring / radialSegments;
    const crown = Math.pow(1 - radialT, 1.65) * crownHeight;
    for (let index = 0; index < segments; index++) {
      const angle = index / segments * Math.PI * 2;
      const irregularity =
        0.9
        + Math.sin(angle * 3 + site.x * 0.017) * 0.06
        + Math.sin(angle * 7 + site.z * 0.013) * 0.035;
      const localX = Math.cos(angle) * site.radiusX * scale * radialT * irregularity;
      const localZ = Math.sin(angle) * site.radiusZ * scale * radialT * irregularity;
      const x = centerX + localX * cos - localZ * sin;
      const z = centerZ + localX * sin + localZ * cos;
      positions.push(x, terrain.getHeightAt(x, z) + lift + crown, z);
    }
  }

  for (let index = 0; index < segments; index++) {
    indices.push(0, index + 1, (index + 1) % segments + 1);
  }
  for (let ring = 1; ring < radialSegments; ring++) {
    const innerStart = 1 + (ring - 1) * segments;
    const outerStart = 1 + ring * segments;
    for (let index = 0; index < segments; index++) {
      const next = (index + 1) % segments;
      indices.push(
        innerStart + index,
        outerStart + index,
        outerStart + next,
        innerStart + index,
        outerStart + next,
        innerStart + next,
      );
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function pseudoRandom(seed: number, index: number): number {
  let value = (seed + Math.imul(index + 1, 0x6d2b79f5)) | 0;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return ((value ^ (value >>> 14)) >>> 0) / 0x1_0000_0000;
}
