import * as THREE from 'three';
import {
  sharedBuildingDetailMaterial,
  sharedBuildingMaterial,
} from '../buildings/buildingMaterials.ts';
import type { BackyardGardenKind } from '../generated/gameBalance.ts';
import {
  createAnimalPenVisualPlan,
  isAnimalPenKind,
  type AnimalPenVisualPlan,
} from './animalPenArchitecture.ts';

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

function populateAnimalHouseConstruction(
  root: THREE.Group,
  plan: AnimalPenVisualPlan,
): void {
  const { shelter } = plan;
  const workWidth = shelter.width + 0.58;
  const workDepth = shelter.depth + 0.58;
  const halfWorkWidth = workWidth * 0.5;
  const halfWorkDepth = workDepth * 0.5;
  root.userData.footprint = { width: workWidth, depth: workDepth };
  root.userData.backyardConstructionPlan = {
    profile: 'animal-house',
    typology: plan.typology,
    footprint: { width: workWidth, depth: workDepth },
    yardFootprint: { ...plan.footprint },
    animalHouse: { ...shelter },
    boundaryPostCount: 0,
    railSegmentCount: 0,
    scaffoldPostCount: 4,
    scaffoldRailCount: 6,
  };

  addConstructionMesh(
    root,
    new THREE.BoxGeometry(workWidth, 0.06, workDepth),
    MATERIALS.earth,
    'Animal house construction earthworks',
    new THREE.Vector3(shelter.x, 0.025, shelter.z),
    0.04,
  );

  const stakeGeometry = new THREE.CylinderGeometry(0.045, 0.055, 0.68, 6);
  for (const [index, [xSign, zSign]] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ].entries()) {
    addConstructionMesh(
      root,
      stakeGeometry,
      MATERIALS.weatheredTimber,
      `Animal house setting-out stake ${index}`,
      new THREE.Vector3(
        shelter.x + xSign * (shelter.width * 0.5 + 0.08),
        0.34,
        shelter.z + zSign * (shelter.depth * 0.5 + 0.08),
      ),
      0,
      0.42,
    );
  }

  addConstructionMesh(
    root,
    new THREE.BoxGeometry(shelter.width + 0.18, shelter.foundationHeight, shelter.depth + 0.16),
    MATERIALS.stone,
    'Animal house rising fieldstone sill',
    new THREE.Vector3(shelter.x, shelter.foundationHeight * 0.5, shelter.z),
    0.12,
  );

  let memberIndex = 0;
  for (const xSign of [-1, 1] as const) {
    for (const zSign of [-1, 1] as const) {
      addConstructionMesh(
        root,
        new THREE.BoxGeometry(0.15, shelter.eaveHeight, 0.15),
        MATERIALS.darkTimber,
        `Animal house structural post ${memberIndex}`,
        new THREE.Vector3(
          shelter.x + xSign * (shelter.width * 0.5 - 0.08),
          shelter.eaveHeight * 0.5,
          shelter.z + zSign * (shelter.depth * 0.5 - 0.08),
        ),
        0.22 + memberIndex * 0.045,
      );
      memberIndex += 1;
    }
  }
  for (const [index, zSign] of [-1, 1].entries()) {
    addConstructionMesh(
      root,
      new THREE.BoxGeometry(shelter.width + 0.12, 0.16, 0.16),
      MATERIALS.darkTimber,
      `Animal house connected eave beam ${index}`,
      new THREE.Vector3(
        shelter.x,
        shelter.eaveHeight - 0.07,
        shelter.z + zSign * (shelter.depth * 0.5 - 0.06),
      ),
      0.38 + index * 0.06,
    );
  }
  addConstructionMesh(
    root,
    new THREE.BoxGeometry(shelter.width + 0.24, 0.13, 0.15),
    MATERIALS.darkTimber,
    'Animal house ridge beam',
    new THREE.Vector3(shelter.x, shelter.ridgeHeight, shelter.z),
    0.5,
  );

  const halfRun = shelter.depth * 0.5 + 0.2;
  const rise = shelter.ridgeHeight - shelter.eaveHeight;
  const slopeLength = Math.hypot(halfRun, rise);
  const pitch = Math.atan2(rise, halfRun);
  for (const side of [-1, 1] as const) {
    addConstructionMesh(
      root,
      new THREE.BoxGeometry(shelter.width + 0.34, 0.09, slopeLength),
      MATERIALS.weatheredTimber,
      `Animal house roof boarding ${side}`,
      new THREE.Vector3(
        shelter.x,
        shelter.eaveHeight + rise * 0.5,
        shelter.z + side * halfRun * 0.5,
      ),
      0.65 + (side > 0 ? 0.09 : 0),
      Number.POSITIVE_INFINITY,
      new THREE.Euler(side > 0 ? pitch : -pitch, 0, 0),
    );
  }
  addConstructionMesh(
    root,
    new THREE.BoxGeometry(shelter.width - 0.16, shelter.eaveHeight - shelter.foundationHeight - 0.08, 0.13),
    MATERIALS.weatheredTimber,
    'Animal house weathered rear enclosure',
    new THREE.Vector3(
      shelter.x,
      shelter.foundationHeight + (shelter.eaveHeight - shelter.foundationHeight - 0.08) * 0.5,
      shelter.z - shelter.depth * 0.5 + 0.07,
    ),
    0.58,
  );

  const scaffoldPostGeometry = new THREE.CylinderGeometry(0.045, 0.055, shelter.eaveHeight + 0.3, 6);
  for (const [index, [xSign, zSign]] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ].entries()) {
    addConstructionMesh(
      root,
      scaffoldPostGeometry,
      MATERIALS.weatheredTimber,
      `Animal house scaffold post ${index}`,
      new THREE.Vector3(
        shelter.x + xSign * halfWorkWidth,
        (shelter.eaveHeight + 0.3) * 0.5,
        shelter.z + zSign * halfWorkDepth,
      ),
      0.08,
      0.94,
    );
  }
  let scaffoldRailCount = 0;
  for (const y of [0.62, 1.18]) {
    for (const zSign of [-1, 1] as const) {
      addConstructionMesh(
        root,
        new THREE.BoxGeometry(workWidth, 0.07, 0.07),
        MATERIALS.weatheredTimber,
        `Animal house scaffold width rail ${scaffoldRailCount++}`,
        new THREE.Vector3(shelter.x, y, shelter.z + zSign * halfWorkDepth),
        0.08,
        0.94,
      );
    }
    addConstructionMesh(
      root,
      new THREE.BoxGeometry(0.07, 0.07, workDepth),
      MATERIALS.weatheredTimber,
      `Animal house scaffold rear rail ${scaffoldRailCount++}`,
      new THREE.Vector3(shelter.x - halfWorkWidth, y, shelter.z),
      0.08,
      0.94,
    );
  }

  const benchX = shelter.x + halfWorkWidth + 0.42;
  const benchZ = shelter.z + halfWorkDepth * 0.4;
  addConstructionMesh(
    root,
    new THREE.BoxGeometry(0.9, 0.1, 0.42),
    MATERIALS.darkTimber,
    'Backyard construction workbench',
    new THREE.Vector3(benchX, 0.62, benchZ),
    0.3,
  );
  const hammerPivot = new THREE.Group();
  hammerPivot.name = 'Backyard construction hammer';
  hammerPivot.position.set(benchX, 0.7, benchZ);
  hammerPivot.userData.backyardConstructionRevealAt = 0.3;
  hammerPivot.userData.backyardConstructionRemoveAt = 0.96;
  hammerPivot.userData.backyardConstructionBaseRotation = -0.42;
  root.add(hammerPivot);
  addConstructionMesh(
    hammerPivot,
    new THREE.BoxGeometry(0.05, 0.52, 0.05),
    MATERIALS.weatheredTimber,
    'Backyard construction hammer handle',
    new THREE.Vector3(0, 0.23, 0),
  );
  addConstructionMesh(
    hammerPivot,
    new THREE.BoxGeometry(0.31, 0.11, 0.13),
    MATERIALS.iron,
    'Backyard construction hammer head',
    new THREE.Vector3(0, 0.5, 0),
  );

  for (let index = 0; index < 6; index += 1) {
    addConstructionMesh(
      root,
      new THREE.CylinderGeometry(0.06, 0.075, 0.92, 7),
      index % 2 === 0 ? MATERIALS.timber : MATERIALS.weatheredTimber,
      `BackyardConstructionTimberSegment:${index}`,
      new THREE.Vector3(
        shelter.x - halfWorkWidth - 0.42,
        0.08 + Math.floor(index / 2) * 0.1,
        shelter.z + halfWorkDepth * 0.45 + (index % 2) * 0.14,
      ),
      0,
      Number.POSITIVE_INFINITY,
      new THREE.Euler(0, 0, Math.PI * 0.5),
    );
  }
  for (let index = 0; index < 6; index += 1) {
    addConstructionMesh(
      root,
      new THREE.BoxGeometry(0.28, 0.18, 0.24),
      MATERIALS.stone,
      `BackyardConstructionStoneSegment:${index}`,
      new THREE.Vector3(
        shelter.x + halfWorkWidth + 0.34 + (index % 2) * 0.22,
        0.09 + Math.floor(index / 4) * 0.18,
        shelter.z - halfWorkDepth * 0.56 + Math.floor((index % 4) / 2) * 0.22,
      ),
    );
  }
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

  if (isAnimalPenKind(kind)) {
    populateAnimalHouseConstruction(
      root,
      createAnimalPenVisualPlan(kind, width, depth, seed),
    );
    syncBackyardConstructionProgress(root, {
      progress: 0,
      assignedLabor: 0,
      timberFill: 0,
      stoneFill: 0,
    });
    return root;
  }

  const halfWidth = width * 0.5;
  const halfDepth = depth * 0.5;
  const stakeGeometry = new THREE.CylinderGeometry(0.045, 0.055, 0.72, 6);
  const postGeometry = new THREE.CylinderGeometry(0.065, 0.08, 1.36, 7);

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

  const usableWidth = Math.max(0.6, width - 0.24);
  const usableDepth = Math.max(0.6, depth - 0.24);
  const widthSegments = Math.max(2, Math.ceil(usableWidth / 2.35));
  const depthSegments = Math.max(1, Math.ceil(usableDepth / 2.35));
  const boundaryPosts: Array<readonly [number, number]> = [];
  for (let segment = 0; segment <= widthSegments; segment++) {
    const x = -usableWidth * 0.5 + usableWidth * segment / widthSegments;
    boundaryPosts.push([x, -usableDepth * 0.5], [x, usableDepth * 0.5]);
  }
  for (let segment = 1; segment < depthSegments; segment++) {
    const z = -usableDepth * 0.5 + usableDepth * segment / depthSegments;
    boundaryPosts.push([-usableWidth * 0.5, z], [usableWidth * 0.5, z]);
  }
  const boundaryRevealSpan = Math.max(1, boundaryPosts.length - 1);
  boundaryPosts.forEach(([x, z], index) => {
    addConstructionMesh(
      root,
      postGeometry,
      MATERIALS.timber,
      `Backyard installed boundary post ${index}`,
      new THREE.Vector3(x, 0.68, z),
      0.18 + index / boundaryRevealSpan * 0.28,
    );
  });

  let railIndex = 0;
  const railCount = (widthSegments * 2 + depthSegments * 2) * 2;
  const addRail = (
    geometry: THREE.BoxGeometry,
    x: number,
    y: number,
    z: number,
    label: string,
  ): void => {
    addConstructionMesh(
      root,
      geometry,
      MATERIALS.timber,
      `Backyard installed ${label} rail ${railIndex}`,
      new THREE.Vector3(x, y, z),
      0.46 + railIndex / Math.max(1, railCount - 1) * 0.28,
    );
    railIndex += 1;
  };
  const widthRailLength = usableWidth / widthSegments;
  const widthRailGeometry = new THREE.BoxGeometry(widthRailLength + 0.05, 0.075, 0.09);
  for (const z of [-usableDepth * 0.5, usableDepth * 0.5]) {
    for (let segment = 0; segment < widthSegments; segment++) {
      const x = -usableWidth * 0.5 + widthRailLength * (segment + 0.5);
      for (const y of [0.48, 0.94]) {
        addRail(widthRailGeometry, x, y, z, 'width');
      }
    }
  }
  const depthRailLength = usableDepth / depthSegments;
  const depthRailGeometry = new THREE.BoxGeometry(0.09, 0.075, depthRailLength + 0.05);
  for (const x of [-usableWidth * 0.5, usableWidth * 0.5]) {
    for (let segment = 0; segment < depthSegments; segment++) {
      const z = -usableDepth * 0.5 + depthRailLength * (segment + 0.5);
      for (const y of [0.48, 0.94]) {
        addRail(depthRailGeometry, x, y, z, 'depth');
      }
    }
  }
  root.userData.backyardConstructionPlan = {
    profile: 'fixture',
    footprint: { width, depth },
    boundaryPostCount: boundaryPosts.length,
    railSegmentCount: railIndex,
    widthSegments,
    depthSegments,
  };

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
