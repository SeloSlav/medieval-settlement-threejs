import * as THREE from 'three';
import type { BuildingKind } from '../resources/types.ts';
import { prepareBuildingGeometryUvs } from './buildingMetricUvs.ts';
import { getBuildingFootprintHalfExtents } from './BuildingFootprint.ts';
import {
  metalMaterial,
  sharedBuildingDetailMaterial,
  stoneMaterial,
  timberMaterial,
} from './buildingMaterials.ts';

const CONSTRUCTION_SITE_MATERIALS = {
  stone: stoneMaterial('mid'),
  paleStone: stoneMaterial('light'),
  timber: timberMaterial('mid'),
  cutWood: timberMaterial('light'),
  rope: sharedBuildingDetailMaterial('wicker'),
  iron: metalMaterial('iron'),
  firedClay: sharedBuildingDetailMaterial('firedClay'),
} as const;

const CONSTRUCTION_SITE_MATERIAL_SET = new Set<THREE.Material>(
  Object.values(CONSTRUCTION_SITE_MATERIALS),
);

const STONE = CONSTRUCTION_SITE_MATERIALS.stone;
const PALE_STONE = CONSTRUCTION_SITE_MATERIALS.paleStone;
const TIMBER = CONSTRUCTION_SITE_MATERIALS.timber;
const CUT_WOOD = CONSTRUCTION_SITE_MATERIALS.cutWood;
const ROPE = CONSTRUCTION_SITE_MATERIALS.rope;
const IRON = CONSTRUCTION_SITE_MATERIALS.iron;
const FIRED_CLAY = CONSTRUCTION_SITE_MATERIALS.firedClay;
const ROOF_PLATE_Y = 4.25;
const ROOF_RIDGE_Y = 5.45;

export function isSharedConstructionSiteMaterial(material: THREE.Material): boolean {
  return CONSTRUCTION_SITE_MATERIAL_SET.has(material);
}

export function getConstructionSiteMaterialLibraryStats(): { materials: number } {
  return { materials: Object.keys(CONSTRUCTION_SITE_MATERIALS).length };
}

export function constructionMaterialPileRatio(
  progress: number,
  deliveredRatio: number,
): number {
  return THREE.MathUtils.clamp(deliveredRatio, 0, 1)
    - Math.min(
      THREE.MathUtils.clamp(deliveredRatio, 0, 1),
      THREE.MathUtils.clamp(progress, 0, 1),
    );
}

export function constructionDeliveredRatio(
  delivered: number,
  required: number,
): number {
  return required <= 1e-6
    ? 0
    : THREE.MathUtils.clamp(delivered / required, 0, 1);
}

export function constructionVisualSignature(
  progress: number,
  timberRatio: number,
  stoneRatio: number,
  ironworkRatio = 0,
  roofTilesRatio = 0,
  dressedStoneRatio = 0,
): string {
  const clampedProgress = THREE.MathUtils.clamp(progress, 0, 1);
  const stage = Math.min(4, Math.floor(clampedProgress * 5));
  const timberPile = Math.min(
    3,
    Math.ceil(constructionMaterialPileRatio(clampedProgress, timberRatio) * 3),
  );
  const stonePile = Math.min(
    3,
    Math.ceil(constructionMaterialPileRatio(clampedProgress, stoneRatio) * 3),
  );
  const fittings = Math.min(
    3,
    Math.ceil(constructionMaterialPileRatio(clampedProgress, ironworkRatio) * 3),
  );
  const roofTiles = Math.min(
    3,
    Math.ceil(constructionMaterialPileRatio(clampedProgress, roofTilesRatio) * 3),
  );
  return `site:${stage}:${timberPile}:${stonePile}:${fittings}:${roofTiles}:${Math.ceil(constructionMaterialPileRatio(clampedProgress, dressedStoneRatio) * 3)}`;
}

export function createConstructionSiteMesh(
  kind: BuildingKind,
  progress: number,
  timberRatio: number,
  stoneRatio: number,
  ironworkRatio = 0,
  roofTilesRatio = 0,
  dressedStoneRatio = 0,
): THREE.Group {
  const root = new THREE.Group();
  root.name = 'Construction site';
  const { halfWidth, halfDepth } = getBuildingFootprintHalfExtents(kind);
  const clampedProgress = THREE.MathUtils.clamp(progress, 0, 1);
  const stage = Math.min(4, Math.floor(clampedProgress * 5));
  const remainingTimberRatio = constructionMaterialPileRatio(clampedProgress, timberRatio);
  const remainingStoneRatio = constructionMaterialPileRatio(clampedProgress, stoneRatio);
  const remainingIronworkRatio = constructionMaterialPileRatio(clampedProgress, ironworkRatio);
  const remainingRoofTilesRatio = constructionMaterialPileRatio(clampedProgress, roofTilesRatio);

  root.userData.constructionVisualContract = 'construction-site-lifecycle-v1';
  root.userData.constructionProgress = clampedProgress;
  root.userData.constructionStage = stage;
  root.userData.constructionFootprintHalfExtents = { halfWidth, halfDepth };
  root.userData.constructionMaterialPileRatios = {
    timber: remainingTimberRatio,
    stone: remainingStoneRatio,
    ironwork: remainingIronworkRatio,
    roofTiles: remainingRoofTilesRatio,
    dressedStone: constructionMaterialPileRatio(clampedProgress, dressedStoneRatio),
  };

  const blockLayers = Math.ceil(constructionMaterialPileRatio(clampedProgress, dressedStoneRatio) * 3);
  for (let i = 0; i < blockLayers * 3; i++) {
    const block = constructionMesh(new THREE.BoxGeometry(.62, .32, .46), PALE_STONE);
    block.name = 'Construction dressed stone block';
    block.position.set(-halfWidth * .6 + (i % 3) * .66, .17 + Math.floor(i / 3) * .34, halfDepth + .8);
    root.add(block);
  }
  addStakeLine(root, halfWidth, halfDepth);
  addFoundation(root, halfWidth, halfDepth, Math.min(1, clampedProgress * 5));
  if (stage >= 1) addWallFrames(root, halfWidth, halfDepth, stage);
  if (stage >= 3) addRoofRafters(root, halfWidth, halfDepth);
  addScaffolding(root, halfWidth, halfDepth, stage);
  addTimberPile(root, halfWidth + 1.25, -halfDepth * 0.45, remainingTimberRatio);
  addStonePile(root, -halfWidth - 1.25, halfDepth * 0.42, remainingStoneRatio);
  addFittingsCrate(root, halfWidth + 1.15, halfDepth * 0.62, remainingIronworkRatio);
  addRoofTileStack(root, -halfWidth - 1.2, -halfDepth * 0.55, remainingRoofTilesRatio);

  root.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.castShadow = true;
      object.receiveShadow = true;
    }
  });
  return root;
}

function addRoofTileStack(
  root: THREE.Group,
  x: number,
  z: number,
  ratio: number,
): void {
  const visibleLayers = Math.min(3, Math.ceil(THREE.MathUtils.clamp(ratio, 0, 1) * 3));
  if (visibleLayers <= 0) return;
  const stack = new THREE.Group();
  stack.name = 'Construction roof tile stack';
  stack.position.set(x, 0, z);
  for (let layer = 0; layer < visibleLayers; layer += 1) {
    for (let tile = 0; tile < 4; tile += 1) {
      const piece = constructionMesh(new THREE.BoxGeometry(0.3, 0.07, 0.56), FIRED_CLAY);
      piece.name = `Construction roof tile ${layer * 4 + tile + 1}`;
      piece.position.set((tile - 1.5) * 0.27, 0.06 + layer * 0.08, 0);
      stack.add(piece);
    }
  }
  root.add(stack);
}

function addFoundation(
  root: THREE.Group,
  halfWidth: number,
  halfDepth: number,
  stoneRatio: number,
): void {
  const courses = Math.ceil(THREE.MathUtils.clamp(stoneRatio, 0, 1) * 3);
  for (let course = 0; course < courses; course += 1) {
    const y = 0.14 + course * 0.22;
    const inset = course * 0.08;
    for (const beam of [
      addBeam(root, halfWidth * 2 - inset, 0.2, 0.36, 0, y, -halfDepth + inset, STONE),
      addBeam(root, halfWidth * 2 - inset, 0.2, 0.36, 0, y, halfDepth - inset, STONE),
      addBeam(root, 0.36, 0.2, halfDepth * 2 - inset, -halfWidth + inset, y, 0, STONE),
      addBeam(root, 0.36, 0.2, halfDepth * 2 - inset, halfWidth - inset, y, 0, STONE),
    ]) {
      beam.name = `Construction installed foundation course ${course + 1}`;
    }
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
  const beam = constructionMesh(new THREE.BoxGeometry(length, 0.22, 0.24), TIMBER);
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
  const lash = constructionMesh(new THREE.TorusGeometry(0.15, 0.025, 5, 9), ROPE);
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
    const log = constructionMesh(new THREE.CylinderGeometry(0.17, 0.19, 2.3, 8), TIMBER);
    log.name = 'Construction timber pile log';
    log.rotation.z = Math.PI / 2;
    log.position.set(x, 0.25 + Math.floor(index / 3) * 0.32, z + (index % 3 - 1) * 0.42);
    root.add(log);
    const end = constructionMesh(new THREE.CircleGeometry(0.165, 8), CUT_WOOD);
    end.name = 'Construction timber pile cut end';
    end.rotation.y = Math.PI / 2;
    end.position.set(x + 1.16, log.position.y, log.position.z);
    root.add(end);
  }
}

function addStonePile(root: THREE.Group, x: number, z: number, ratio: number): void {
  const count = Math.min(10, Math.ceil(THREE.MathUtils.clamp(ratio, 0, 1) * 10));
  for (let index = 0; index < count; index += 1) {
    const size = 0.34 + (index % 3) * 0.08;
    const stone = constructionMesh(new THREE.DodecahedronGeometry(size, 0), index % 2 ? STONE : PALE_STONE);
    stone.name = 'Construction stone pile piece';
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
  const box = constructionMesh(new THREE.BoxGeometry(1.35, 0.76, 0.9), CUT_WOOD);
  box.name = 'Construction fittings crate box';
  box.position.y = 0.43;
  crate.add(box);
  for (let index = 0; index < visibleBands; index += 1) {
    const strap = constructionMesh(new THREE.BoxGeometry(0.09, 0.82, 0.96), IRON);
    strap.name = `Construction iron strap ${index + 1}`;
    strap.position.set((index - 1) * 0.42, 0.45, 0);
    crate.add(strap);
  }
  const hinge = constructionMesh(new THREE.BoxGeometry(0.5, 0.08, 0.12), IRON);
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
): THREE.Mesh {
  const beam = constructionMesh(new THREE.BoxGeometry(width, height, depth), material);
  beam.position.set(x, y, z);
  root.add(beam);
  return beam;
}

function constructionMesh(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
): THREE.Mesh {
  return new THREE.Mesh(prepareBuildingGeometryUvs(geometry, material), material);
}
