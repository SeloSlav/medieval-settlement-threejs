import * as THREE from 'three';
import type { Terrain } from '../terrain/Terrain.ts';
import type { ResourceNodeState } from '../resources/types.ts';
import type {
  MineralDepositLayout,
  MineralDepositResource,
  MineralDepositSite,
} from './MineralDepositLayout.ts';
import {
  mineralDepositNodeId,
} from './MineralDepositLayout.ts';

type SiteVisual = {
  nodeId: string;
  grade: MineralDepositSite['grade'];
  stones: THREE.Mesh[];
};

export type MineralDepositSystem = {
  group: THREE.Group;
  syncNodes: (nodes: Iterable<ResourceNodeState>) => boolean;
  isBlockedAt: (x: number, z: number) => boolean;
  isGrassBlockedAt: (x: number, z: number) => boolean;
  dispose: () => void;
};

const MATERIAL_COLORS: Record<MineralDepositResource, readonly [number, number]> = {
  iron: [0x63382e, 0xa45a3f],
  salt: [0xc9c7b8, 0xeee8d5],
};

export function createMineralDepositSystem(
  terrain: Terrain,
  layout: MineralDepositLayout,
): MineralDepositSystem {
  const group = new THREE.Group();
  group.name = 'Mineral deposits';
  const materials = createMaterials();
  const visuals: SiteVisual[] = layout.sites.map((site, index) => {
    const visual = createSiteVisual(terrain, site, index, materials);
    group.add(visual.group);
    return {
      nodeId: mineralDepositNodeId(site, index),
      grade: site.grade,
      stones: visual.stones,
    };
  });

  return {
    group,
    syncNodes: (nodes) => {
      const byId = new Map([...nodes].map((node) => [node.nodeId, node]));
      let changed = false;
      for (const visual of visuals) {
        const node = byId.get(visual.nodeId);
        const visibleShare = visual.grade === 'rich' || !node
          ? 1
          : Math.max(0, Math.min(1, node.remaining / Math.max(1, node.maxYield)));
        const visibleCount = Math.ceil(visual.stones.length * visibleShare);
        visual.stones.forEach((stone, index) => {
          const visible = index < visibleCount;
          if (stone.visible !== visible) {
            stone.visible = visible;
            changed = true;
          }
        });
      }
      return changed;
    },
    isBlockedAt: (x, z) => layout.isBlockedForProps(x, z),
    isGrassBlockedAt: (x, z) => layout.isBlockedForGrass(x, z),
    dispose: () => {
      group.traverse((object) => {
        if (object instanceof THREE.Mesh) object.geometry.dispose();
      });
      for (const material of Object.values(materials).flat()) material.dispose();
    },
  };
}

function createMaterials(): Record<MineralDepositResource, THREE.MeshStandardMaterial[]> {
  return {
    iron: MATERIAL_COLORS.iron.map((color, index) =>
      new THREE.MeshStandardMaterial({
        color,
        roughness: 0.84 - index * 0.08,
        metalness: 0.12 + index * 0.12,
      })
    ),
    salt: MATERIAL_COLORS.salt.map((color, index) =>
      new THREE.MeshStandardMaterial({
        color,
        roughness: 0.72 - index * 0.08,
        metalness: 0,
      })
    ),
  };
}

function createSiteVisual(
  terrain: Terrain,
  site: MineralDepositSite,
  siteIndex: number,
  materials: Record<MineralDepositResource, THREE.MeshStandardMaterial[]>,
): { group: THREE.Group; stones: THREE.Mesh[] } {
  const group = new THREE.Group();
  group.name = `${site.grade === 'rich' ? 'Rich ' : ''}${site.resource} deposit`;
  const stones: THREE.Mesh[] = [];
  const count = site.grade === 'rich' ? 18 : 10;
  const seed = ((siteIndex + 1) * 0x9e3779b1) ^ Math.round(site.x * 97) ^ Math.round(site.z * 193);

  for (let index = 0; index < count; index++) {
    const angle = pseudoRandom(seed, index * 3) * Math.PI * 2;
    const radius = Math.sqrt(pseudoRandom(seed, index * 3 + 1)) * 0.78;
    const localX = Math.cos(angle) * site.radiusX * radius;
    const localZ = Math.sin(angle) * site.radiusZ * radius;
    const cos = Math.cos(site.rotation);
    const sin = Math.sin(site.rotation);
    const x = site.x + localX * cos - localZ * sin;
    const z = site.z + localX * sin + localZ * cos;
    const scale = (site.grade === 'rich' ? 1.15 : 0.9)
      * (0.68 + pseudoRandom(seed, index * 3 + 2) * 0.82);
    const stone = new THREE.Mesh(
      new THREE.DodecahedronGeometry(scale, 0),
      materials[site.resource][index % materials[site.resource].length],
    );
    stone.name = `${site.resource} outcrop ${index + 1}`;
    stone.position.set(x, terrain.getHeightAt(x, z) + scale * 0.42, z);
    stone.rotation.set(
      pseudoRandom(seed ^ 0x5a17, index) * 0.5,
      angle,
      pseudoRandom(seed ^ 0x29c3, index) * 0.4,
    );
    stone.scale.set(1.15, 0.72, 0.92);
    stone.castShadow = true;
    stone.receiveShadow = true;
    stones.push(stone);
    group.add(stone);
  }
  return { group, stones };
}

function pseudoRandom(seed: number, index: number): number {
  let value = (seed + Math.imul(index + 1, 0x6d2b79f5)) | 0;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return ((value ^ (value >>> 14)) >>> 0) / 0x1_0000_0000;
}
