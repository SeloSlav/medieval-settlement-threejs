import * as THREE from 'three';

export type ColorSubmissionCategory =
  | 'authoredBodies'
  | 'mountedEquipment'
  | 'companyStandards'
  | 'seedThreeForest'
  | 'groundcover'
  | 'terrain'
  | 'authoredAnimals'
  | 'other';

export type ColorSubmissionStats = {
  drawCalls: number;
  triangles: number;
  instances: number;
  objects: number;
};

export type ColorSubmissionBudget = {
  total: ColorSubmissionStats;
  categories: Record<ColorSubmissionCategory, ColorSubmissionStats>;
};

const CATEGORY_ORDER: readonly ColorSubmissionCategory[] = [
  'authoredBodies',
  'mountedEquipment',
  'companyStandards',
  'seedThreeForest',
  'groundcover',
  'terrain',
  'authoredAnimals',
  'other',
] as const;

const projectionView = new THREE.Matrix4();
const cameraFrustum = new THREE.Frustum();

/**
 * Mirrors Three's color-camera object/frustum/material submission rules and
 * reports the exact indexed triangle ranges sent for the current scene state.
 * It does not mutate visibility, geometry, material, instance count or LOD.
 *
 * This deliberately reports submitted work, not post-clip visible pixels: one
 * broad InstancedMesh remains one broad GPU submission exactly as Three sees it.
 */
export function measureColorSubmissionBudget(
  scene: THREE.Scene,
  camera: THREE.Camera,
): ColorSubmissionBudget {
  scene.updateWorldMatrix(false, true);
  camera.updateWorldMatrix(true, false);
  projectionView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  cameraFrustum.setFromProjectionMatrix(
    projectionView,
    camera.coordinateSystem,
    camera.reversedDepth,
  );

  const categories = Object.fromEntries(
    CATEGORY_ORDER.map((category) => [category, emptyStats()]),
  ) as Record<ColorSubmissionCategory, ColorSubmissionStats>;

  visitVisible(scene, camera, (object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    if (mesh.frustumCulled && !cameraFrustum.intersectsObject(mesh)) return;

    const instanceCount = (mesh as THREE.InstancedMesh).isInstancedMesh
      ? Math.max(0, Math.floor((mesh as THREE.InstancedMesh).count))
      : 1;
    if (instanceCount <= 0) return;

    const drawRanges = submittedTriangleRanges(mesh.geometry, mesh.material);
    if (drawRanges.drawCalls <= 0 || drawRanges.triangles <= 0) return;
    const target = categories[classifySubmission(mesh)];
    target.drawCalls += drawRanges.drawCalls;
    target.triangles += drawRanges.triangles * instanceCount;
    target.instances += instanceCount;
    target.objects += 1;
  });

  const total = emptyStats();
  for (const category of CATEGORY_ORDER) addStats(total, categories[category]);
  return { total, categories };
}

function visitVisible(
  object: THREE.Object3D,
  camera: THREE.Camera,
  visitor: (object: THREE.Object3D) => void,
): void {
  if (!object.visible) return;
  if (object.layers.test(camera.layers)) visitor(object);
  for (const child of object.children) visitVisible(child, camera, visitor);
}

function submittedTriangleRanges(
  geometry: THREE.BufferGeometry,
  material: THREE.Material | THREE.Material[],
): { drawCalls: number; triangles: number } {
  const elementCount = geometry.index?.count
    ?? geometry.getAttribute('position')?.count
    ?? 0;
  if (elementCount <= 0) return { drawCalls: 0, triangles: 0 };

  const drawStart = Math.max(0, Math.floor(geometry.drawRange.start));
  const rawDrawCount = geometry.drawRange.count;
  const drawEnd = Number.isFinite(rawDrawCount)
    ? Math.min(elementCount, drawStart + Math.max(0, Math.floor(rawDrawCount)))
    : elementCount;
  if (drawEnd <= drawStart) return { drawCalls: 0, triangles: 0 };

  if (!Array.isArray(material)) {
    if (!material.visible) return { drawCalls: 0, triangles: 0 };
    return { drawCalls: 1, triangles: Math.floor((drawEnd - drawStart) / 3) };
  }

  let drawCalls = 0;
  let triangles = 0;
  for (const group of geometry.groups) {
    const groupMaterial = material[group.materialIndex ?? 0];
    if (!groupMaterial?.visible) continue;
    const groupStart = Math.max(0, Math.floor(group.start));
    const groupEnd = Math.min(
      elementCount,
      groupStart + Math.max(0, Math.floor(group.count)),
    );
    const submittedStart = Math.max(drawStart, groupStart);
    const submittedEnd = Math.min(drawEnd, groupEnd);
    if (submittedEnd <= submittedStart) continue;
    drawCalls += 1;
    triangles += Math.floor((submittedEnd - submittedStart) / 3);
  }
  return { drawCalls, triangles };
}

function classifySubmission(object: THREE.Object3D): ColorSubmissionCategory {
  let authoredInstances = false;
  let authoredCrowd = false;
  let authoredAnimal = false;
  for (let current: THREE.Object3D | null = object; current; current = current.parent) {
    const name = current.name.toLowerCase();
    if (current.userData.terrain === true) return 'terrain';
    if (current.userData.exactMountedAttachmentBatch === true) return 'mountedEquipment';
    if (name.includes('company standards')) return 'companyStandards';
    if (
      current.userData.groundcoverSubmission !== undefined
      || name.includes('seedthree grass field')
    ) return 'groundcover';
    if (name.includes('seedthree gorski kotar forest')) return 'seedThreeForest';
    authoredInstances ||= current.userData.authoredSkinnedInstances === true;
    authoredCrowd ||= name.includes('exact authored crowd');
    authoredAnimal ||= name.includes('exact-model');
  }
  if (authoredInstances && authoredCrowd) return 'authoredBodies';
  if (authoredInstances && authoredAnimal) return 'authoredAnimals';
  return 'other';
}

function emptyStats(): ColorSubmissionStats {
  return { drawCalls: 0, triangles: 0, instances: 0, objects: 0 };
}

function addStats(target: ColorSubmissionStats, source: ColorSubmissionStats): void {
  target.drawCalls += source.drawCalls;
  target.triangles += source.triangles;
  target.instances += source.instances;
  target.objects += source.objects;
}
