import * as THREE from 'three';
import type { Terrain } from '../terrain/Terrain.ts';
import type { BanditCampState } from './banditState.ts';

type CampVisual = { root: THREE.Group; intact: THREE.Group; ruin: THREE.Group };

const timber = new THREE.MeshStandardMaterial({ color: 0x35281d, roughness: 0.96 });
const darkCloth = new THREE.MeshStandardMaterial({ color: 0x282622, roughness: 1, side: THREE.DoubleSide });
const blackCloth = new THREE.MeshStandardMaterial({ color: 0x171817, roughness: 1, side: THREE.DoubleSide });
const dirt = new THREE.MeshStandardMaterial({ color: 0x44392d, roughness: 1 });
const iron = new THREE.MeshStandardMaterial({ color: 0x484946, roughness: 0.7, metalness: 0.42 });
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
      keep.add(camp.id);
      let visual = this.visuals.get(camp.id);
      if (!visual) {
        visual = createCamp(Number(camp.id.replace(/\D/g, '')) || 1);
        this.visuals.set(camp.id, visual);
        this.root.add(visual.root);
      }
      visual.root.position.set(camp.x, this.terrain.getHeightAt(camp.x, camp.z) + 0.03, camp.z);
      visual.intact.visible = camp.active;
      visual.ruin.visible = !camp.active;
    }
    for (const [id, visual] of this.visuals) {
      if (keep.has(id)) continue;
      visual.root.removeFromParent();
      this.visuals.delete(id);
    }
  }

  dispose(): void {
    this.root.removeFromParent();
    this.visuals.clear();
  }
}

function createCamp(seed: number): CampVisual {
  const root = new THREE.Group();
  root.name = `Bandit camp ${seed}`;
  root.rotation.y = seeded(seed * 17) * Math.PI * 2;
  const intact = new THREE.Group();
  const ruin = new THREE.Group();
  root.add(intact, ruin);

  const ground = new THREE.Mesh(new THREE.CircleGeometry(7.6, 24), dirt);
  ground.rotation.x = -Math.PI / 2;
  ground.scale.set(1, 0.76, 1);
  ground.receiveShadow = true;
  intact.add(ground);

  for (let i = 0; i < 15; i += 1) {
    const angle = -2.62 + i / 14 * 5.24;
    if (Math.abs(angle) < 0.38) continue;
    const radius = 7.1 + (seeded(seed + i * 41) - 0.5) * 0.7;
    const stake = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.18, 2.7, 5), timber);
    stake.position.set(Math.sin(angle) * radius, 1.25, Math.cos(angle) * radius);
    stake.rotation.z = (seeded(seed + i * 73) - 0.5) * 0.22;
    stake.castShadow = true;
    intact.add(stake);
  }
  addTent(intact, -2.35, -1.0, 1.0, darkCloth);
  addTent(intact, 2.2, -1.55, -0.72, blackCloth);
  addWeaponRack(intact, 3.45, 1.45);
  addFirePit(intact, 0.2, 1.1);
  addPennant(intact, -4.5, 2.5);

  const brokenGround = ground.clone();
  ruin.add(brokenGround);
  for (let i = 0; i < 7; i += 1) {
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.16, 2.5, 5), timber);
    const angle = i / 7 * Math.PI * 2;
    beam.position.set(Math.sin(angle) * 4.6, 0.2, Math.cos(angle) * 4.6);
    beam.rotation.set(Math.PI / 2, angle, 0.35);
    beam.castShadow = true;
    ruin.add(beam);
  }
  const torn = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 1.8), darkCloth);
  torn.rotation.x = -Math.PI / 2;
  torn.position.set(-1.4, 0.08, -0.4);
  ruin.add(torn);
  ruin.visible = false;
  return { root, intact, ruin };
}

function addTent(parent: THREE.Group, x: number, z: number, yaw: number, material: THREE.Material): void {
  const tent = new THREE.Mesh(new THREE.ConeGeometry(2.1, 2.6, 4), material);
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
