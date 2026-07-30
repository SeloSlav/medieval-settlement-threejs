import * as THREE from 'three';
import type { Terrain } from '../terrain/Terrain.ts';
import type { ClayDepositLayout, ClayDepositSite } from './ClayDepositLayout.ts';

export type ClayDepositSystem = {
  group: THREE.Group;
  isBlockedAt: (x: number, z: number) => boolean;
  isGrassBlockedAt: (x: number, z: number) => boolean;
  dispose: () => void;
};

const CLAY_COLORS = [0x8f5338, 0xa96643, 0xc18155] as const;

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

  for (const site of layout.sites) {
    group.add(createClayBankPatch(terrain, site, materials));
  }

  return {
    group,
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
): THREE.Group {
  const group = new THREE.Group();
  const gradeLabel = site.kind === 'rich' ? 'rich' : 'ordinary';
  group.name = `Exposed ${gradeLabel} alluvial clay`;

  const patch = new THREE.Mesh(
    createTerrainConformingPatch(terrain, site, 1, 0),
    materials[0],
  );
  patch.name = `${site.kind === 'rich' ? 'Rich' : 'Ordinary'} clay bank surface`;
  patch.receiveShadow = true;
  group.add(patch);

  const strata = [
    { scale: 0.76, offset: -0.9, lift: 0.045, materialIndex: 1 },
    { scale: 0.52, offset: 1.4, lift: 0.075, materialIndex: 2 },
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
      ),
      materials[layer.materialIndex],
    );
    seam.name = `${site.kind === 'rich' ? 'Rich' : 'Ordinary'} clay exposed stratum ${index + 1}`;
    seam.receiveShadow = true;
    group.add(seam);
  }

  return group;
}

function createTerrainConformingPatch(
  terrain: Terrain,
  site: ClayDepositSite,
  scale: number,
  lateralOffset: number,
  lift = 0.025,
): THREE.BufferGeometry {
  const segments = 48;
  const positions: number[] = [];
  const indices: number[] = [];
  const cos = Math.cos(site.rotation);
  const sin = Math.sin(site.rotation);
  const centerX = site.x - sin * lateralOffset;
  const centerZ = site.z + cos * lateralOffset;
  const centerY = terrain.getHeightAt(centerX, centerZ) + lift;
  positions.push(centerX, centerY, centerZ);

  for (let index = 0; index < segments; index++) {
    const angle = index / segments * Math.PI * 2;
    const irregularity =
      0.9
      + Math.sin(angle * 3 + site.x * 0.017) * 0.06
      + Math.sin(angle * 7 + site.z * 0.013) * 0.035;
    const localX = Math.cos(angle) * site.radiusX * scale * irregularity;
    const localZ = Math.sin(angle) * site.radiusZ * scale * irregularity;
    const x = centerX + localX * cos - localZ * sin;
    const z = centerZ + localX * sin + localZ * cos;
    positions.push(x, terrain.getHeightAt(x, z) + lift, z);
  }

  for (let index = 0; index < segments; index++) {
    indices.push(0, index + 1, (index + 1) % segments + 1);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}
