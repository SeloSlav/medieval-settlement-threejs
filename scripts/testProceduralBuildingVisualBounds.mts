import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createBuildingMesh } from '../src/buildings/BuildingMeshes.ts';
import {
  BUILDING_DETAIL_CASTER_BATCH_FLAG,
} from '../src/buildings/buildingDetailShadowBatch.ts';
import {
  BUILDING_LOCAL_VISUAL_BOUNDS,
  BUILDING_VISUAL_BOUNDS_SAFETY_MARGIN,
  type BuildingLocalVisualBounds,
} from '../src/buildings/BuildingVisualBounds.ts';
import { BUILDING_KINDS, type BuildingKind } from '../src/generated/gameBalance.ts';

const CONTAINMENT_EPSILON = 1e-4;

type BoundsCase = Readonly<{
  label: string;
  kind: BuildingKind;
  tier?: 1 | 2 | 3;
}>;

type MeasuredBounds = Readonly<{
  box: THREE.Box3;
  meshCount: number;
  vertexCount: number;
  includedMeshNames: ReadonlySet<string>;
}>;

const cases: BoundsCase[] = [
  ...BUILDING_KINDS.map((kind) => ({ label: kind, kind })),
  ...([1, 2, 3] as const).map((tier) => ({
    label: `chapel tier ${tier}`,
    kind: 'chapel' as const,
    tier,
  })),
];

assert.equal(BUILDING_KINDS.length, 45, 'visual-bounds regression must cover all 45 placeable kinds');

const failures: string[] = [];
let measuredMeshes = 0;
let measuredVertices = 0;

for (const testCase of cases) {
  const root = createBuildingMesh(testCase.kind, testCase.tier);
  const measured = measureLocalVisibleStructuralBounds(root);
  measuredMeshes += measured.meshCount;
  measuredVertices += measured.vertexCount;

  assert.ok(!measured.box.isEmpty(), `${testCase.label} must contain visible structural geometry`);
  assert.ok(measured.meshCount > 0, `${testCase.label} must contain a measured mesh`);
  assert.ok(measured.vertexCount > 0, `${testCase.label} must contain measured vertices`);

  if (testCase.kind === 'trading_post') {
    assert.ok(
      measured.includedMeshNames.has('Trading post loading-bay post'),
      'trading-post bounds must include the new covered loading-bay posts',
    );
    assert.ok(
      measured.includedMeshNames.has('Trading post loading-bay shingle roof'),
      'trading-post bounds must include the new covered loading-bay roof',
    );
  }

  const declared = BUILDING_LOCAL_VISUAL_BOUNDS[testCase.kind];
  const failure = containmentFailure(testCase.label, declared, measured.box);
  if (failure) failures.push(failure);
}

if (failures.length > 0) {
  throw new Error(
    `Procedural building visual bounds failed (${failures.length}):\n${failures
      .map((failure, index) => `${index + 1}. ${failure}`)
      .join('\n')}`,
  );
}

console.log(
  `Procedural building visual bounds passed: ${BUILDING_KINDS.length} kinds + 3 chapel tiers, `
    + `${measuredMeshes} visible structural meshes / ${measuredVertices} vertices measured.`,
);

/**
 * Measures authored color geometry in root-local space. Hidden runtime stock is
 * naturally rejected through ancestor visibility, while exact shadow batches
 * are rejected explicitly so their baked duplicate vertices cannot widen the
 * completed-building contract.
 */
function measureLocalVisibleStructuralBounds(root: THREE.Object3D): MeasuredBounds {
  root.updateWorldMatrix(true, true);
  const rootWorldInverse = root.matrixWorld.clone().invert();
  const box = new THREE.Box3();
  const meshNames = new Set<string>();
  const instanceMatrix = new THREE.Matrix4();
  const meshWorldMatrix = new THREE.Matrix4();
  const relativeMatrix = new THREE.Matrix4();
  const vertex = new THREE.Vector3();
  let meshCount = 0;
  let vertexCount = 0;

  const visit = (object: THREE.Object3D, ancestorsVisible: boolean): void => {
    const visible = ancestorsVisible && object.visible;
    if (!visible || object.userData[BUILDING_DETAIL_CASTER_BATCH_FLAG] === true) return;

    const mesh = object as THREE.Mesh<
      THREE.BufferGeometry,
      THREE.Material | THREE.Material[]
    >;
    if (mesh.isMesh && mesh.geometry) {
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const position = mesh.geometry.getAttribute('position');
      if (position && materials.some((material) => material.visible)) {
        const instanceCount = (mesh as THREE.InstancedMesh).isInstancedMesh
          ? Math.max(0, Math.floor((mesh as THREE.InstancedMesh).count))
          : 1;
        if (instanceCount > 0) {
          meshCount += 1;
          meshNames.add(mesh.name);
        }
        for (let instanceIndex = 0; instanceIndex < instanceCount; instanceIndex += 1) {
          if ((mesh as THREE.InstancedMesh).isInstancedMesh) {
            (mesh as THREE.InstancedMesh).getMatrixAt(instanceIndex, instanceMatrix);
            meshWorldMatrix.multiplyMatrices(mesh.matrixWorld, instanceMatrix);
          } else {
            meshWorldMatrix.copy(mesh.matrixWorld);
          }
          relativeMatrix.multiplyMatrices(rootWorldInverse, meshWorldMatrix);
          for (let vertexIndex = 0; vertexIndex < position.count; vertexIndex += 1) {
            vertex.fromBufferAttribute(position, vertexIndex).applyMatrix4(relativeMatrix);
            assert.ok(
              Number.isFinite(vertex.x) && Number.isFinite(vertex.y) && Number.isFinite(vertex.z),
              `${root.name || 'procedural building'}/${mesh.name || 'Mesh'} contains non-finite bounds geometry`,
            );
            box.expandByPoint(vertex);
            vertexCount += 1;
          }
        }
      }
    }

    for (const child of object.children) visit(child, visible);
  };
  visit(root, true);

  return {
    box,
    meshCount,
    vertexCount,
    includedMeshNames: meshNames,
  };
}

function containmentFailure(
  label: string,
  declared: BuildingLocalVisualBounds,
  measured: THREE.Box3,
): string | null {
  // The authored bounds reserve five centimetres beyond canonical geometry so
  // float32 transforms cannot make a mathematically clear road marker touch it.
  const required: BuildingLocalVisualBounds = {
    minX: measured.min.x - BUILDING_VISUAL_BOUNDS_SAFETY_MARGIN,
    maxX: measured.max.x + BUILDING_VISUAL_BOUNDS_SAFETY_MARGIN,
    minZ: measured.min.z - BUILDING_VISUAL_BOUNDS_SAFETY_MARGIN,
    maxZ: measured.max.z + BUILDING_VISUAL_BOUNDS_SAFETY_MARGIN,
  };
  const escaped = (
    declared.minX > required.minX + CONTAINMENT_EPSILON
    || declared.maxX < required.maxX - CONTAINMENT_EPSILON
    || declared.minZ > required.minZ + CONTAINMENT_EPSILON
    || declared.maxZ < required.maxZ - CONTAINMENT_EPSILON
  );
  if (!escaped) return null;
  return `${label}: declared ${formatBounds(declared)} does not contain measured `
    + `${formatBounds(measuredBoxToBounds(measured))} + `
    + `${BUILDING_VISUAL_BOUNDS_SAFETY_MARGIN.toFixed(2)} m clearance; requires at least `
    + formatBounds(required);
}

function measuredBoxToBounds(box: THREE.Box3): BuildingLocalVisualBounds {
  return {
    minX: box.min.x,
    maxX: box.max.x,
    minZ: box.min.z,
    maxZ: box.max.z,
  };
}

function formatBounds(bounds: BuildingLocalVisualBounds): string {
  return `[x ${bounds.minX.toFixed(4)}..${bounds.maxX.toFixed(4)}, `
    + `z ${bounds.minZ.toFixed(4)}..${bounds.maxZ.toFixed(4)}]`;
}
