import * as THREE from 'three';
import type { Terrain } from '../terrain/Terrain.ts';
import {
  addCampAFrameShelter,
  addCampfire,
  addCampStumpSeat,
  animateCampfire,
  disposeCampfire,
  getAgedTentCanvasMaterial,
  getCampGroundMaterial,
  setCampfireNightLighting,
} from '../buildings/meshes/foundersCampMesh.ts';
import { metalMaterial, timberMaterial } from '../buildings/buildingMaterials.ts';
import type { BanditCampState } from './banditState.ts';
import { CampStandardRenderer, createCampStandardAnchor } from '../settlement/CampStandardRenderer.ts';

type CampVisual = { root: THREE.Group; campfire: THREE.Group };

const timber = timberMaterial('dark');
const darkCloth = banditCanvasMaterial(0xb2a28a, 'Weathered umber bandit canvas');
const blackCloth = banditCanvasMaterial(0x83796a, 'Soot-darkened bandit canvas');
const dirt = getCampGroundMaterial();
const iron = metalMaterial('iron');

/** Deterministic, low-cost outlaw encampment. Deliberately avoids the founder
 * camp's stocked crates and supply piles: crooked perimeter stakes, dark
 * shelters, a weapon rack, and planted outlaw standard distinguish it. */
export class BanditCampRenderer {
  private readonly root = new THREE.Group();
  private readonly visuals = new Map<string, CampVisual>();
  private readonly terrain: Terrain;
  private readonly standards: CampStandardRenderer;
  private nightLighting = 0;

  constructor(terrain: Terrain, parent: THREE.Group) {
    this.terrain = terrain;
    this.root.name = 'Physical bandit camps';
    parent.add(this.root);
    this.standards = new CampStandardRenderer(parent, (x, z) => this.terrain.getHeightAt(x, z));
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
        setCampfireNightLighting(visual.campfire, this.nightLighting);
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
    this.tick(0);
  }

  tick(dtSeconds: number): void {
    this.standards.sync(this.root.children, dtSeconds);
    for (const visual of this.visuals.values()) animateCampfire(visual.campfire, dtSeconds);
  }

  setCampfireNightLighting(nightLighting: number): void {
    this.nightLighting = THREE.MathUtils.clamp(nightLighting, 0, 1);
    for (const visual of this.visuals.values()) {
      setCampfireNightLighting(visual.campfire, this.nightLighting);
    }
  }

  standardDiagnostics() {
    return this.standards.diagnostics();
  }

  dispose(): void {
    this.standards.dispose();
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
  // Full-size founders' A-frames, with entrances turned into the clearing.
  addCampAFrameShelter(root, -2.65, -1.7, -2.85, 0, null, darkCloth);
  addCampAFrameShelter(root, 2.65, -1.7, 2.85, 1, null, blackCloth);
  addWeaponRack(root, 3.45, 1.45);
  const campfire = addCampfire(root, 0, 1.65);
  addCampStumpSeat(root, 0.1, 3.35);
  addCampStumpSeat(root, -1.5, 2.35);
  addCampStumpSeat(root, 1.55, 2.4);
  const standard = createCampStandardAnchor('bandit');
  standard.position.set(-4.5, 0, 2.5);
  root.add(standard);
  const enablePhysicalShadows = (object: THREE.Object3D): void => {
    // The shared fire already owns its hearth shadows; don't turn animated
    // smoke puffs or sparks into opaque shadow casters.
    if (object === campfire) return;
    if (object instanceof THREE.Mesh && object !== ground) object.castShadow = true;
    for (const child of object.children) enablePhysicalShadows(child);
  };
  enablePhysicalShadows(root);
  return { root, campfire };
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

function seeded(value: number): number {
  const x = Math.sin(value * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function banditCanvasMaterial(color: number, name: string): THREE.MeshStandardMaterial {
  const material = getAgedTentCanvasMaterial(0).clone();
  material.color.setHex(color);
  material.name = name;
  return material;
}

function removeCampVisual(visual: CampVisual): void {
  disposeCampfire(visual.campfire);
  visual.root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.isMesh) mesh.geometry.dispose();
  });
  visual.root.removeFromParent();
}
