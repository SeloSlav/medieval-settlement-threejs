import * as THREE from 'three';
import type { Terrain } from '../terrain/Terrain.ts';
import {
  getAgedTentCanvasMaterial,
  getCampGroundMaterial,
} from '../buildings/meshes/foundersCampMesh.ts';
import { metalMaterial, timberMaterial } from '../buildings/buildingMaterials.ts';
import type { BanditCampState } from './banditState.ts';

type CampVisual = { root: THREE.Group };

const timber = standardCampMaterial(
  timberMaterial('dark'),
  0x9b765a,
  'Weathered textured bandit timber',
);
const darkCloth = banditCanvasMaterial(0xb2a28a, 'Weathered umber bandit canvas');
const blackCloth = banditCanvasMaterial(0x83796a, 'Soot-darkened bandit canvas');
const dirt = getCampGroundMaterial();
const iron = standardCampMaterial(
  metalMaterial('iron'),
  0x9a9287,
  'Worn bandit ironwork',
  0.68,
  0.35,
);
const ember = new THREE.MeshStandardMaterial({ color: 0x4a1f12, emissive: 0x5d1c08, emissiveIntensity: 0.65, roughness: 1 });

/** Deterministic, low-cost outlaw encampment. Deliberately avoids the founder
 * camp's stocked crates and supply piles: crooked perimeter stakes, dark
 * shelters, a weapon rack, and torn pennant are the identity read at distance. */
export class BanditCampRenderer {
  private readonly root = new THREE.Group();
  private readonly visuals = new Map<string, CampVisual>();
  private readonly terrain: Terrain;

  constructor(terrain: Terrain, parent: THREE.Group) {
    this.terrain = terrain;
    this.root.name = 'Physical bandit camps';
    parent.add(this.root);
  }

  sync(camps: Iterable<BanditCampState>): void {
    const keep = new Set<string>();
    for (const camp of camps) {
      // Inactive rows remain authoritative so the scheduler can respawn them,
      // but a destroyed physical camp must leave no ruin or click silhouette.
      if (!camp.active || camp.health <= 0) continue;
      keep.add(camp.id);
      let visual = this.visuals.get(camp.id);
      if (!visual) {
        visual = createCamp(Number(camp.id.replace(/\D/g, '')) || 1);
        this.visuals.set(camp.id, visual);
        this.root.add(visual.root);
      }
      visual.root.position.set(camp.x, this.terrain.getHeightAt(camp.x, camp.z) + 0.03, camp.z);
    }
    for (const [id, visual] of this.visuals) {
      if (keep.has(id)) continue;
      removeCampVisual(visual);
      this.visuals.delete(id);
    }
  }

  dispose(): void {
    for (const visual of this.visuals.values()) removeCampVisual(visual);
    this.root.removeFromParent();
    this.visuals.clear();
  }
}

function createCamp(seed: number): CampVisual {
  const root = new THREE.Group();
  root.name = `Bandit camp ${seed}`;
  root.rotation.y = seeded(seed * 17) * Math.PI * 2;

  const ground = new THREE.Mesh(new THREE.CircleGeometry(7.6, 24), dirt);
  ground.name = 'Bandit camp trampled earth';
  ground.rotation.x = -Math.PI / 2;
  ground.scale.set(1, 0.76, 1);
  ground.receiveShadow = true;
  root.add(ground);

  for (let i = 0; i < 15; i += 1) {
    const angle = -2.62 + i / 14 * 5.24;
    if (Math.abs(angle) < 0.38) continue;
    const radius = 7.1 + (seeded(seed + i * 41) - 0.5) * 0.7;
    const stake = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.18, 2.7, 5), timber);
    stake.name = 'Bandit textured perimeter stake';
    stake.position.set(Math.sin(angle) * radius, 1.25, Math.cos(angle) * radius);
    stake.rotation.z = (seeded(seed + i * 73) - 0.5) * 0.22;
    stake.castShadow = true;
    root.add(stake);
  }
  addTent(root, -2.35, -1.0, 1.0, darkCloth);
  addTent(root, 2.2, -1.55, -0.72, blackCloth);
  addWeaponRack(root, 3.45, 1.45);
  addFirePit(root, 0.2, 1.1);
  addPennant(root, -4.5, 2.5);
  return { root };
}

function addTent(parent: THREE.Group, x: number, z: number, yaw: number, material: THREE.Material): void {
  const tent = new THREE.Mesh(new THREE.ConeGeometry(2.1, 2.6, 4), material);
  tent.name = 'Bandit weathered canvas tent';
  tent.position.set(x, 1.3, z);
  tent.rotation.y = yaw + Math.PI / 4;
  tent.scale.z = 0.72;
  tent.castShadow = true;
  tent.receiveShadow = true;
  parent.add(tent);
}

function addWeaponRack(parent: THREE.Group, x: number, z: number): void {
  const rack = new THREE.Group();
  rack.position.set(x, 0, z);
  for (const dx of [-0.8, 0.8]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 1.65, 5), timber);
    post.position.set(dx, 0.82, 0);
    rack.add(post);
  }
  const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 1.8, 5), timber);
  rail.rotation.z = Math.PI / 2;
  rail.position.y = 1.15;
  rack.add(rail);
  for (const dx of [-0.5, 0, 0.5]) {
    const spear = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 2.1, 5), timber);
    spear.position.set(dx, 1.05, 0.12);
    spear.rotation.z = 0.08 + dx * 0.1;
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.3, 4), iron);
    head.position.set(dx - 0.08, 2.06, 0.12);
    rack.add(spear, head);
  }
  parent.add(rack);
}

function addFirePit(parent: THREE.Group, x: number, z: number): void {
  const pit = new THREE.Mesh(new THREE.CylinderGeometry(0.65, 0.72, 0.12, 12), ember);
  pit.position.set(x, 0.09, z);
  pit.receiveShadow = true;
  parent.add(pit);
}

function addPennant(parent: THREE.Group, x: number, z: number): void {
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.08, 4.2, 6), timber);
  pole.position.set(x, 2.1, z);
  pole.castShadow = true;
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.25, 0.72), blackCloth);
  flag.position.set(x + 0.64, 3.55, z);
  flag.geometry.translate(0, 0, 0);
  parent.add(pole, flag);
}

function seeded(value: number): number {
  const x = Math.sin(value * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function banditCanvasMaterial(color: number, name: string): THREE.MeshStandardMaterial {
  return standardCampMaterial(
    getAgedTentCanvasMaterial(0),
    color,
    name,
    0.98,
    0,
    THREE.DoubleSide,
  );
}

/** Building materials use node shaders in the WebGPU game. Bandit camps also
 * appear in the WebGL visual contract, so reuse their authored texture maps in
 * a backend-neutral standard material instead of cloning the node shader. */
function standardCampMaterial(
  source: THREE.MeshStandardMaterial,
  color: number,
  name: string,
  roughness = 0.96,
  metalness = 0,
  side: THREE.Side = THREE.FrontSide,
): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    color,
    map: source.map,
    roughness,
    metalness,
    side,
  });
  material.name = name;
  return material;
}

function removeCampVisual(visual: CampVisual): void {
  visual.root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.isMesh) mesh.geometry.dispose();
  });
  visual.root.removeFromParent();
}
