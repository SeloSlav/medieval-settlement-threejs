import * as THREE from 'three';
import { isWithinAnimalCrowdView, type CrowdViewState } from './crowdView.ts';

export type CavalryHorsePresentation = 'yard' | 'hussar' | 'lancer' | 'archer' | 'ottoman';

export type CavalryHorsePose = Readonly<{
  id: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  moveSpeed: number;
  activity: 'standing' | 'grazing' | 'walking';
  presentation: CavalryHorsePresentation;
  appearanceSeed: number;
}>;

type HorseVisual = {
  root: THREE.Group;
  head: THREE.Group;
  legs: readonly THREE.Group[];
  tail: THREE.Group;
  blanket: THREE.Mesh;
  headPitch: number;
  elapsed: number;
};

/** The authored saddle contact point above terrain, in metres. */
export const CAVALRY_SADDLE_HEIGHT = 1.48;

const COAT_COLORS = [0x5a3525, 0x2b211c, 0x806047, 0xb29a78, 0x473229] as const;
const MANE_COLORS = [0x211815, 0x171313, 0x3c2a20] as const;

export class CavalryHorseRenderer {
  private readonly group = new THREE.Group();
  private readonly visuals = new Map<string, HorseVisual>();
  private readonly geometries = createHorseGeometries();
  private readonly coatMaterials = COAT_COLORS.map((color) => horseMaterial(color, 0.86));
  private readonly maneMaterials = MANE_COLORS.map((color) => horseMaterial(color, 0.95));
  private readonly leather = horseMaterial(0x3b2419, 0.92);
  private readonly metal = horseMaterial(0x858079, 0.42, 0.45);
  private readonly blanketMaterials: Record<CavalryHorsePresentation, THREE.MeshStandardMaterial> = {
    yard: horseMaterial(0x786b50, 0.94),
    hussar: horseMaterial(0x8f2f26, 0.88),
    lancer: horseMaterial(0x263b58, 0.82),
    archer: horseMaterial(0x435b35, 0.9),
    ottoman: horseMaterial(0x8a3128, 0.86),
  };

  constructor(parent: THREE.Group) {
    this.group.name = 'Cavalry horses and remounts';
    parent.add(this.group);
  }

  sync(poses: readonly CavalryHorsePose[], view: CrowdViewState | undefined, dt: number): void {
    const active = new Set<string>();
    for (const pose of poses) {
      if (!isWithinAnimalCrowdView(pose.x, pose.z, view)) continue;
      active.add(pose.id);
      let visual = this.visuals.get(pose.id);
      if (!visual) {
        visual = this.createVisual(pose);
        this.visuals.set(pose.id, visual);
      }
      visual.root.position.set(pose.x, pose.y, pose.z);
      visual.root.rotation.y = pose.yaw;
      visual.blanket.material = this.blanketMaterials[pose.presentation];
      const frameDt = Math.max(0, Math.min(0.1, dt));
      visual.elapsed += frameDt;
      animateHorse(visual, pose, frameDt);
    }
    for (const [id, visual] of this.visuals) {
      if (active.has(id)) continue;
      visual.root.removeFromParent();
      this.visuals.delete(id);
    }
  }

  dispose(): void {
    this.visuals.clear();
    this.group.clear();
    this.group.removeFromParent();
    for (const geometry of Object.values(this.geometries)) geometry.dispose();
    for (const material of this.coatMaterials) material.dispose();
    for (const material of this.maneMaterials) material.dispose();
    for (const material of Object.values(this.blanketMaterials)) material.dispose();
    this.leather.dispose();
    this.metal.dispose();
  }

  private createVisual(pose: CavalryHorsePose): HorseVisual {
    const root = new THREE.Group();
    root.name = `Cavalry horse ${pose.id}`;
    root.userData.cavalryHorseId = pose.id;
    const coat = this.coatMaterials[pose.appearanceSeed % this.coatMaterials.length]!;
    const mane = this.maneMaterials[(pose.appearanceSeed >>> 4) % this.maneMaterials.length]!;
    const blanket = this.blanketMaterials[pose.presentation];

    addPart(root, this.geometries.body, coat, [0, 1.12, 0], [0.61, 0.55, 1.08]);
    addPart(root, this.geometries.chest, coat, [0, 1.17, 0.67], [0.57, 0.66, 0.58]);
    const head = new THREE.Group();
    head.name = 'Articulated horse neck and head';
    head.position.set(0, 1.26, 0.53);
    root.add(head);
    const neck = addPart(head, this.geometries.neck, coat, [0, 0.36, 0.19], [0.39, 0.78, 0.42]);
    neck.rotation.x = -0.28;
    addPart(head, this.geometries.head, coat, [0, 0.7, 0.5], [0.42, 0.42, 0.63]);
    addPart(head, this.geometries.muzzle, coat, [0, 0.56, 0.94], [0.34, 0.3, 0.48]);
    for (const side of [-1, 1] as const) {
      const ear = addPart(head, this.geometries.ear, coat, [side * 0.16, 0.99, 0.43], [0.12, 0.34, 0.12]);
      ear.rotation.z = side * -0.12;
    }
    const maneStrip = addPart(head, this.geometries.mane, mane, [0, 0.5, -0.05], [0.12, 0.6, 0.7]);
    maneStrip.rotation.x = -0.3;
    const blanketMesh = addPart(root, this.geometries.blanket, blanket, [0, 1.49, -0.04], [0.73, 0.09, 0.84]);
    addPart(root, this.geometries.saddle, this.leather, [0, 1.56, -0.02], [0.52, 0.16, 0.51]);
    const rein = addPart(head, this.geometries.rein, this.leather, [0, 0.62, 0.79], [0.035, 0.39, 0.035]);
    rein.rotation.z = Math.PI * 0.5;
    const bit = addPart(head, this.geometries.bit, this.metal, [0, 0.52, 0.94], [0.035, 0.4, 0.035]);
    bit.rotation.z = Math.PI * 0.5;

    const legs: THREE.Group[] = [];
    for (const x of [-0.34, 0.34] as const) {
      for (const z of [-0.62, 0.62] as const) {
        const leg = new THREE.Group();
        leg.position.set(x, 1.09, z);
        addPart(leg, this.geometries.upperLeg, coat, [0, -0.28, 0], [0.2, 0.59, 0.2]);
        addPart(leg, this.geometries.lowerLeg, coat, [0, -0.75, 0.015], [0.145, 0.48, 0.145]);
        addPart(leg, this.geometries.hoof, this.maneMaterials[0]!, [0, -1.01, 0.06], [0.2, 0.15, 0.3]);
        root.add(leg);
        legs.push(leg);
      }
    }
    const tail = new THREE.Group();
    tail.position.set(0, 1.36, -1.02);
    const tailMesh = addPart(tail, this.geometries.tail, mane, [0, -0.25, -0.14], [0.19, 0.72, 0.2]);
    tailMesh.rotation.x = -0.34;
    root.add(tail);
    root.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    });
    this.group.add(root);
    return {
      root,
      head,
      legs,
      tail,
      blanket: blanketMesh,
      headPitch: 0,
      elapsed: (pose.appearanceSeed % 1000) / 113,
    };
  }
}

function animateHorse(visual: HorseVisual, pose: CavalryHorsePose, dt: number): void {
  const speed = Math.max(0, pose.moveSpeed);
  const moving = pose.activity === 'walking' && speed > 0.15;
  const gait = visual.elapsed * (moving ? 3.4 + Math.min(5.4, speed * 1.2) : 0.7);
  const amplitude = moving ? Math.min(0.62, 0.16 + speed * 0.09) : 0.025;
  for (let index = 0; index < visual.legs.length; index += 1) {
    const phase = index === 0 || index === 3 ? 0 : Math.PI;
    visual.legs[index]!.rotation.x = Math.sin(gait + phase) * amplitude;
  }
  visual.root.position.y = pose.y + (moving ? Math.abs(Math.sin(gait * 2)) * 0.025 : Math.sin(gait) * 0.008);
  visual.tail.rotation.x = -0.12 + Math.sin(gait * 0.62) * (moving ? 0.12 : 0.045);
  visual.tail.rotation.z = Math.sin(gait * 0.47) * 0.08;
  const targetHeadPitch = pose.activity === 'grazing'
    ? 1.02 + Math.sin(visual.elapsed * 0.42) * 0.055
    : moving ? -0.035 + Math.sin(gait) * 0.025 : Math.sin(visual.elapsed * 0.37) * 0.018;
  const headBlend = 1 - Math.exp(-Math.max(0, dt) * (pose.activity === 'grazing' ? 2.4 : 4.5));
  visual.headPitch += (targetHeadPitch - visual.headPitch) * headBlend;
  visual.head.rotation.x = visual.headPitch;
}

function addPart(
  parent: THREE.Object3D,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  position: readonly [number, number, number],
  scale: readonly [number, number, number],
): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(...position);
  mesh.scale.set(...scale);
  parent.add(mesh);
  return mesh;
}

function horseMaterial(color: number, roughness: number, metalness = 0): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

function createHorseGeometries() {
  return {
    body: new THREE.SphereGeometry(1, 14, 10),
    chest: new THREE.SphereGeometry(1, 12, 9),
    neck: new THREE.CapsuleGeometry(0.5, 1, 5, 10),
    head: new THREE.SphereGeometry(1, 12, 9),
    muzzle: new THREE.SphereGeometry(1, 10, 7),
    ear: new THREE.ConeGeometry(1, 2, 6),
    mane: new THREE.BoxGeometry(1, 1, 1),
    blanket: new THREE.BoxGeometry(1, 1, 1),
    saddle: new THREE.SphereGeometry(1, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.55),
    rein: new THREE.CylinderGeometry(1, 1, 1, 6),
    bit: new THREE.CylinderGeometry(1, 1, 1, 6),
    upperLeg: new THREE.CapsuleGeometry(0.5, 1, 4, 8),
    lowerLeg: new THREE.CapsuleGeometry(0.5, 1, 4, 8),
    hoof: new THREE.BoxGeometry(1, 1, 1),
    tail: new THREE.CapsuleGeometry(0.5, 1, 4, 8),
  } as const;
}
