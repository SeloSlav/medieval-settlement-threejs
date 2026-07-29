import * as THREE from 'three';
import { getBuildingDefinition } from '../resources/buildings.ts';
import type { BuildingKind } from '../resources/types.ts';

const DIRT = new THREE.MeshStandardMaterial({ color: 0x6f5638, roughness: 1 });
const STONE = new THREE.MeshStandardMaterial({ color: 0x77746c, roughness: 0.94 });
const PALE_STONE = new THREE.MeshStandardMaterial({ color: 0x9a9588, roughness: 0.96 });
const TIMBER = new THREE.MeshStandardMaterial({ color: 0x6d4527, roughness: 0.9 });
const CUT_WOOD = new THREE.MeshStandardMaterial({ color: 0xc39158, roughness: 0.86 });
const ROPE = new THREE.MeshStandardMaterial({ color: 0x9a8057, roughness: 1 });
const IRON = new THREE.MeshStandardMaterial({
  color: 0x343b3b,
  roughness: 0.62,
  metalness: 0.48,
});
const ROOF_PLATE_Y = 4.25;
const ROOF_RIDGE_Y = 5.45;

export function constructionVisualSignature(
  progress: number,
  timberRatio: number,
  stoneRatio: number,
  ironworkRatio = 0,
): string {
  const stage = Math.min(4, Math.floor(Math.max(0, progress) * 5));
  const timberPile = Math.min(3, Math.ceil(Math.max(0, timberRatio) * 3));
  const stonePile = Math.min(3, Math.ceil(Math.max(0, stoneRatio) * 3));
  const fittings = Math.min(3, Math.ceil(Math.max(0, ironworkRatio) * 3));
  return `site:${stage}:${timberPile}:${stonePile}:${fittings}`;
}

export function createConstructionSiteMesh(
  kind: BuildingKind,
  progress: number,
  timberRatio: number,
  stoneRatio: number,
  ironworkRatio = 0,
): THREE.Group {
  const root = new THREE.Group();
  root.name = 'Construction site';
  const definition = getBuildingDefinition(kind);
  const halfWidth = THREE.MathUtils.clamp(definition.pickRadius * 0.62, 3.4, 8.8);
  const halfDepth = THREE.MathUtils.clamp(definition.pickRadius * 0.48, 2.8, 7.2);
  const stage = Math.min(4, Math.floor(THREE.MathUtils.clamp(progress, 0, 1) * 5));

  const preparedGround = new THREE.Mesh(
    new THREE.BoxGeometry(halfWidth * 2.1, 0.12, halfDepth * 2.1),
    DIRT,
  );
  preparedGround.position.y = 0.05;
  preparedGround.receiveShadow = true;
  root.add(preparedGround);

  addStakeLine(root, halfWidth, halfDepth);
  addFoundation(root, halfWidth, halfDepth, Math.max(stage > 0 ? 0.35 : 0.12, stoneRatio));
  if (stage >= 1) addWallFrames(root, halfWidth, halfDepth, stage);
  if (stage >= 3) addRoofRafters(root, halfWidth, halfDepth);
  addScaffolding(root, halfWidth, halfDepth, stage);
  addTimberPile(root, halfWidth + 1.25, -halfDepth * 0.45, timberRatio);
  addStonePile(root, -halfWidth - 1.25, halfDepth * 0.42, stoneRatio);
  addFittingsCrate(root, halfWidth + 1.15, halfDepth * 0.62, ironworkRatio);

  root.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.castShadow = true;
      object.receiveShadow = true;
    }
  });
  return root;
}

function addFoundation(
  root: THREE.Group,
  halfWidth: number,
  halfDepth: number,
  stoneRatio: number,
): void {
  const courses = Math.max(1, Math.ceil(THREE.MathUtils.clamp(stoneRatio, 0, 1) * 3));
  for (let course = 0; course < courses; course += 1) {
    const y = 0.14 + course * 0.22;
    const inset = course * 0.08;
    addBeam(root, halfWidth * 2 - inset, 0.2, 0.36, 0, y, -halfDepth + inset, STONE);
    addBeam(root, halfWidth * 2 - inset, 0.2, 0.36, 0, y, halfDepth - inset, STONE);
    addBeam(root, 0.36, 0.2, halfDepth * 2 - inset, -halfWidth + inset, y, 0, STONE);
    addBeam(root, 0.36, 0.2, halfDepth * 2 - inset, halfWidth - inset, y, 0, STONE);
  }
}

function addWallFrames(
  root: THREE.Group,
  halfWidth: number,
  halfDepth: number,
  stage: number,
): void {
  const height = stage >= 2 ? 3.7 : 2.15;
  const corners: Array<[number, number]> = [
    [-halfWidth, -halfDepth],
    [halfWidth, -halfDepth],
    [-halfWidth, halfDepth],
    [halfWidth, halfDepth],
  ];
  for (const [x, z] of corners) {
    addBeam(root, 0.26, height, 0.26, x, 0.58 + height / 2, z, TIMBER);
  }
  if (stage >= 2) {
    addBeam(root, halfWidth * 2 + 0.3, 0.28, 0.28, 0, 4.2, -halfDepth, TIMBER);
    addBeam(root, halfWidth * 2 + 0.3, 0.28, 0.28, 0, 4.2, halfDepth, TIMBER);
    addBeam(root, 0.28, 0.28, halfDepth * 2 + 0.3, -halfWidth, 4.2, 0, TIMBER);
    addBeam(root, 0.28, 0.28, halfDepth * 2 + 0.3, halfWidth, 4.2, 0, TIMBER);
  }
}

function addRoofRafters(root: THREE.Group, halfWidth: number, halfDepth: number): void {
  for (const z of [-halfDepth, -halfDepth * 0.33, halfDepth * 0.33, halfDepth]) {
    addRoofRafter(root, -1, halfWidth, z);
    addRoofRafter(root, 1, halfWidth, z);
  }
  addBeam(root, 0.24, 0.24, halfDepth * 2 + 0.6, 0, ROOF_RIDGE_Y, 0, TIMBER);
}

function addRoofRafter(
  root: THREE.Group,
  side: -1 | 1,
  halfWidth: number,
  z: number,
): void {
  const rise = ROOF_RIDGE_Y - ROOF_PLATE_Y;
  const length = Math.hypot(halfWidth, rise);
  const pitch = Math.atan2(rise, halfWidth);
  const beam = new THREE.Mesh(new THREE.BoxGeometry(length, 0.22, 0.24), TIMBER);
  beam.name = 'Construction roof rafter';
  beam.position.set(
    side * halfWidth * 0.5,
    (ROOF_PLATE_Y + ROOF_RIDGE_Y) * 0.5,
    z,
  );
  beam.rotation.z = -side * pitch;
  root.add(beam);
}

function addScaffolding(
  root: THREE.Group,
  halfWidth: number,
  halfDepth: number,
  stage: number,
): void {
  const scaffoldHeight = stage >= 3 ? 4.8 : 2.8;
  for (const x of [-halfWidth * 0.72, halfWidth * 0.72]) {
    addBeam(root, 0.13, scaffoldHeight, 0.13, x, scaffoldHeight / 2, halfDepth + 1, TIMBER);
  }
  addBeam(root, halfWidth * 1.7, 0.13, 0.13, 0, scaffoldHeight * 0.55, halfDepth + 1, TIMBER);
  addBeam(root, halfWidth * 1.55, 0.11, 0.85, 0, scaffoldHeight * 0.58, halfDepth + 1, CUT_WOOD);
  const lash = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.025, 5, 9), ROPE);
  lash.position.set(-halfWidth * 0.72, scaffoldHeight * 0.55, halfDepth + 1);
  lash.rotation.x = Math.PI / 2;
  root.add(lash);
}

function addStakeLine(root: THREE.Group, halfWidth: number, halfDepth: number): void {
  for (const x of [-halfWidth - 0.55, halfWidth + 0.55]) {
    for (const z of [-halfDepth - 0.55, halfDepth + 0.55]) {
      addBeam(root, 0.09, 0.85, 0.09, x, 0.42, z, TIMBER);
    }
  }
}

function addTimberPile(root: THREE.Group, x: number, z: number, ratio: number): void {
  const count = Math.min(9, Math.ceil(THREE.MathUtils.clamp(ratio, 0, 1) * 9));
  for (let index = 0; index < count; index += 1) {
    const log = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.19, 2.3, 8), TIMBER);
    log.rotation.z = Math.PI / 2;
    log.position.set(x, 0.25 + Math.floor(index / 3) * 0.32, z + (index % 3 - 1) * 0.42);
    root.add(log);
    const end = new THREE.Mesh(new THREE.CircleGeometry(0.165, 8), CUT_WOOD);
    end.rotation.y = Math.PI / 2;
    end.position.set(x + 1.16, log.position.y, log.position.z);
    root.add(end);
  }
}

function addStonePile(root: THREE.Group, x: number, z: number, ratio: number): void {
  const count = Math.min(10, Math.ceil(THREE.MathUtils.clamp(ratio, 0, 1) * 10));
  for (let index = 0; index < count; index += 1) {
    const size = 0.34 + (index % 3) * 0.08;
    const stone = new THREE.Mesh(new THREE.DodecahedronGeometry(size, 0), index % 2 ? STONE : PALE_STONE);
    stone.scale.y = 0.65 + (index % 2) * 0.18;
    stone.rotation.set(index * 0.3, index * 0.71, index * 0.19);
    stone.position.set(
      x + ((index * 37) % 5 - 2) * 0.3,
      size * 0.55 + Math.floor(index / 6) * 0.3,
      z + ((index * 19) % 5 - 2) * 0.28,
    );
    root.add(stone);
  }
}

function addFittingsCrate(
  root: THREE.Group,
  x: number,
  z: number,
  ratio: number,
): void {
  const visibleBands = Math.min(
    3,
    Math.ceil(THREE.MathUtils.clamp(ratio, 0, 1) * 3),
  );
  if (visibleBands <= 0) return;

  const crate = new THREE.Group();
  crate.name = 'Construction fittings crate';
  crate.position.set(x, 0, z);
  const box = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.76, 0.9), CUT_WOOD);
  box.name = 'Construction fittings crate box';
  box.position.y = 0.43;
  crate.add(box);
  for (let index = 0; index < visibleBands; index += 1) {
    const strap = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.82, 0.96), IRON);
    strap.name = `Construction iron strap ${index + 1}`;
    strap.position.set((index - 1) * 0.42, 0.45, 0);
    crate.add(strap);
  }
  const hinge = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.08, 0.12), IRON);
  hinge.name = 'Construction iron hinge';
  hinge.position.set(0, 0.82, 0.12);
  crate.add(hinge);
  root.add(crate);
}

function addBeam(
  root: THREE.Group,
  width: number,
  height: number,
  depth: number,
  x: number,
  y: number,
  z: number,
  material: THREE.Material,
): void {
  const beam = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
  beam.position.set(x, y, z);
  root.add(beam);
}
