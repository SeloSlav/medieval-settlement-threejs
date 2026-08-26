import * as THREE from 'three';
import {
  sharedBuildingDetailMaterial,
  sharedBuildingMaterial,
} from '../buildings/buildingMaterials.ts';
import type { BackyardGardenKind } from '../generated/gameBalance.ts';

export type BackyardConstructionMeshOptions = {
  width?: number;
  depth?: number;
  seed?: number;
};

export type BackyardConstructionProgress = {
  progress: number;
  assignedLabor: number;
  timberFill: number;
  stoneFill: number;
};

const MATERIALS = {
  earth: sharedBuildingDetailMaterial('earth'),
  timber: sharedBuildingMaterial('timberMid'),
  weatheredTimber: sharedBuildingMaterial('timberWeathered'),
  darkTimber: sharedBuildingMaterial('timberDark'),
  stone: sharedBuildingMaterial('masonryMid'),
  iron: sharedBuildingMaterial('metalIron'),
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function addConstructionMesh(
  parent: THREE.Object3D,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  name: string,
  position: THREE.Vector3,
  revealAt = 0,
  removeAt = Number.POSITIVE_INFINITY,
  rotation = new THREE.Euler(),
): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.position.copy(position);
  mesh.rotation.copy(rotation);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.backyardConstructionRevealAt = revealAt;
  mesh.userData.backyardConstructionRemoveAt = removeAt;
  parent.add(mesh);
  return mesh;
}

/**
 * A backyard project is its own architectural module. Its setting-out boards,
 * delivered materials, boundary frame, and working shelter all live in the
 * extension footprint instead of borrowing the completed house's scaffolds.
 */
export function createBackyardConstructionMesh(
  kind: BackyardGardenKind,
  options: BackyardConstructionMeshOptions = {},
): THREE.Group {
  const width = Math.max(3.8, options.width ?? 5.4);
  const depth = Math.max(1.8, options.depth ?? 4.6);
  const seed = options.seed ?? 1;
  const root = new THREE.Group();
  root.name = 'Backyard extension construction';
  root.userData.backyardConstructionSite = true;
  root.userData.backyardProjectKind = kind;
  root.userData.backyardConstructionSeed = seed;
  root.userData.footprint = { width, depth };

  const halfWidth = width * 0.5;
  const halfDepth = depth * 0.5;
  const stakeGeometry = new THREE.CylinderGeometry(0.045, 0.055, 0.72, 6);
  const postGeometry = new THREE.CylinderGeometry(0.065, 0.08, 1.36, 7);
  const railWidthGeometry = new THREE.BoxGeometry(Math.max(0.6, width - 0.34), 0.075, 0.09);
  const railDepthGeometry = new THREE.BoxGeometry(0.09, 0.075, Math.max(0.6, depth - 0.34));

  addConstructionMesh(
    root,
    new THREE.BoxGeometry(width * 0.94, 0.07, depth * 0.9),
    MATERIALS.earth,
    'Backyard construction earthworks',
    new THREE.Vector3(0, 0.025, 0),
    0.06,
  );

  const cornerPositions = [
    [-halfWidth + 0.12, -halfDepth + 0.12],
    [halfWidth - 0.12, -halfDepth + 0.12],
    [-halfWidth + 0.12, halfDepth - 0.12],
    [halfWidth - 0.12, halfDepth - 0.12],
  ] as const;
  cornerPositions.forEach(([x, z], index) => {
    addConstructionMesh(
      root,
      stakeGeometry,
      MATERIALS.weatheredTimber,
      `Backyard setting-out stake ${index}`,
      new THREE.Vector3(x, 0.36, z),
      0,
      0.88,
    );
  });

  addConstructionMesh(
    root,
    new THREE.BoxGeometry(width, 0.06, 0.08),
    MATERIALS.weatheredTimber,
    'Backyard setting-out board front',
    new THREE.Vector3(0, 0.12, halfDepth),
    0,
    0.88,
  );
  addConstructionMesh(
    root,
    new THREE.BoxGeometry(width, 0.06, 0.08),
    MATERIALS.weatheredTimber,
    'Backyard setting-out board rear',
    new THREE.Vector3(0, 0.12, -halfDepth),
    0,
    0.88,
  );
  for (const side of [-1, 1] as const) {
    addConstructionMesh(
      root,
      new THREE.BoxGeometry(0.08, 0.06, depth),
      MATERIALS.weatheredTimber,
      `Backyard setting-out board side ${side}`,
      new THREE.Vector3(side * halfWidth, 0.12, 0),
      0,
      0.88,
    );
  }

  const boundaryPosts = [
    ...cornerPositions,
    [0, -halfDepth + 0.12] as const,
    [0, halfDepth - 0.12] as const,
  ];
  boundaryPosts.forEach(([x, z], index) => {
    addConstructionMesh(
      root,
      postGeometry,
      MATERIALS.timber,
      `Backyard installed boundary post ${index}`,
      new THREE.Vector3(x, 0.68, z),
      0.18 + index * 0.035,
    );
  });

  for (const [index, z] of [-halfDepth + 0.12, halfDepth - 0.12].entries()) {
    for (const [level, y] of [0.48, 0.94].entries()) {
      addConstructionMesh(
        root,
        railWidthGeometry,
        MATERIALS.timber,
        `Backyard installed width rail ${index}:${level}`,
        new THREE.Vector3(0, y, z),
        0.42 + index * 0.045 + level * 0.075,
      );
    }
  }
  for (const [index, x] of [-halfWidth + 0.12, halfWidth - 0.12].entries()) {
    for (const [level, y] of [0.48, 0.94].entries()) {
      addConstructionMesh(
        root,
        railDepthGeometry,
        MATERIALS.timber,
        `Backyard installed depth rail ${index}:${level}`,
        new THREE.Vector3(x, y, 0),
        0.48 + index * 0.045 + level * 0.075,
      );
    }
  }

  const shelterWidth = Math.min(2.15, width * 0.42);
  const shelterDepth = Math.min(1.35, depth * 0.52);
  const shelterX = Math.max(0, halfWidth - shelterWidth * 0.58);
  const shelterZ = Math.min(0, -halfDepth + shelterDepth * 0.58);
  for (const [index, xSign] of [-1, 1].entries()) {
    for (const [zIndex, zSign] of [-1, 1].entries()) {
      addConstructionMesh(
        root,
        new THREE.BoxGeometry(0.09, 1.55, 0.09),
        MATERIALS.darkTimber,
        `Backyard work shelter post ${index}:${zIndex}`,
        new THREE.Vector3(
          shelterX + xSign * shelterWidth * 0.42,
          0.775,
          shelterZ + zSign * shelterDepth * 0.42,
        ),
        0.62 + (index * 2 + zIndex) * 0.03,
      );
    }
  }
  addConstructionMesh(
    root,
    new THREE.BoxGeometry(shelterWidth, 0.11, shelterDepth),
    MATERIALS.weatheredTimber,
    'Backyard work shelter roof frame',
    new THREE.Vector3(shelterX, 1.52, shelterZ),
    0.78,
  );
  addConstructionMesh(
    root,
    new THREE.BoxGeometry(shelterWidth * 0.74, 0.1, 0.48),
    MATERIALS.darkTimber,
    'Backyard construction workbench',
    new THREE.Vector3(shelterX, 0.72, shelterZ),
    0.36,
  );

  const hammerPivot = new THREE.Group();
  hammerPivot.name = 'Backyard construction hammer';
  hammerPivot.position.set(shelterX, 0.82, shelterZ);
  hammerPivot.userData.backyardConstructionRevealAt = 0.36;
  hammerPivot.userData.backyardConstructionRemoveAt = 0.96;
  hammerPivot.userData.backyardConstructionBaseRotation = -0.42;
  root.add(hammerPivot);
  addConstructionMesh(
    hammerPivot,
    new THREE.BoxGeometry(0.055, 0.58, 0.055),
    MATERIALS.weatheredTimber,
    'Backyard construction hammer handle',
    new THREE.Vector3(0, 0.25, 0),
  );
  addConstructionMesh(
    hammerPivot,
    new THREE.BoxGeometry(0.34, 0.12, 0.14),
    MATERIALS.iron,
    'Backyard construction hammer head',
    new THREE.Vector3(0, 0.56, 0),
  );

  const timberGeometry = new THREE.CylinderGeometry(0.07, 0.085, 1.15, 7);
  for (let index = 0; index < 8; index += 1) {
    addConstructionMesh(
      root,
      timberGeometry,
      index % 2 === 0 ? MATERIALS.timber : MATERIALS.weatheredTimber,
      `BackyardConstructionTimberSegment:${index}`,
      new THREE.Vector3(
        -halfWidth + 0.72,
        0.1 + Math.floor(index / 2) * 0.12,
        halfDepth - 0.56 + (index % 2) * 0.18,
      ),
      0,
      Number.POSITIVE_INFINITY,
      new THREE.Euler(0, 0, Math.PI * 0.5),
    );
  }

  const stoneGeometry = new THREE.BoxGeometry(0.32, 0.2, 0.28);
  for (let index = 0; index < 8; index += 1) {
    addConstructionMesh(
      root,
      stoneGeometry,
      MATERIALS.stone,
      `BackyardConstructionStoneSegment:${index}`,
      new THREE.Vector3(
        halfWidth - 0.72 + (index % 2) * 0.27,
        0.1 + Math.floor(index / 4) * 0.2,
        halfDepth - 0.58 + Math.floor((index % 4) / 2) * 0.27,
      ),
      0,
      Number.POSITIVE_INFINITY,
      new THREE.Euler(0, ((seed + index) % 3 - 1) * 0.11, 0),
    );
  }

  syncBackyardConstructionProgress(root, {
    progress: 0,
    assignedLabor: 0,
    timberFill: 0,
    stoneFill: 0,
  });
  return root;
}

export function syncBackyardConstructionProgress(
  root: THREE.Group,
  state: BackyardConstructionProgress,
): void {
  const progress = clamp01(state.progress);
  root.userData.constructionProgress = progress;
  root.userData.constructionAssignedLabor = Math.max(0, state.assignedLabor);
  root.userData.constructionMaterialPileRatios = {
    timber: clamp01(state.timberFill),
    stone: clamp01(state.stoneFill),
  };
  root.traverse((object) => {
    const revealAt = Number(object.userData.backyardConstructionRevealAt ?? 0);
    const removeAt = Number(
      object.userData.backyardConstructionRemoveAt ?? Number.POSITIVE_INFINITY,
    );
    object.visible = progress + 1e-6 >= revealAt && progress < removeAt - 1e-6;
  });
  syncMaterialSegments(root, 'BackyardConstructionTimberSegment:', state.timberFill);
  syncMaterialSegments(root, 'BackyardConstructionStoneSegment:', state.stoneFill);
}

function syncMaterialSegments(root: THREE.Group, prefix: string, fill: number): void {
  const segments: THREE.Object3D[] = [];
  root.traverse((object) => {
    if (object.name.startsWith(prefix)) segments.push(object);
  });
  const visibleCount = Math.ceil(clamp01(fill) * segments.length);
  for (let index = 0; index < segments.length; index += 1) {
    segments[index]!.visible = index < visibleCount;
  }
}

export function animateBackyardConstructionMesh(
  root: THREE.Group,
  elapsedSeconds: number,
): void {
  const hammer = root.getObjectByName('Backyard construction hammer');
  if (!hammer || (root.userData.constructionAssignedLabor ?? 0) <= 0) return;
  const base = Number(hammer.userData.backyardConstructionBaseRotation ?? 0);
  hammer.rotation.z = base + Math.sin(elapsedSeconds * 7.2) * 0.42;
}

/** Shared materials are centrally owned; each worksite owns only its geometry. */
export function disposeBackyardConstructionMesh(root: THREE.Group): void {
  const geometries = new Set<THREE.BufferGeometry>();
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.isMesh) geometries.add(mesh.geometry);
  });
  for (const geometry of geometries) geometry.dispose();
}
