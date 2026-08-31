import * as THREE from 'three';
import {
  AuthoredSkinnedInstanceBatch,
  type AuthoredSkinnedInstanceBatchDiagnostic,
} from './AuthoredSkinnedInstanceBatch.ts';

export type AuthoredAnimalMaterialColor = Readonly<{
  materialSlot: number;
  color: THREE.ColorRepresentation;
}>;

/**
 * Bridges ordinary AnimationMixer-driven animal rigs into the exact-asset
 * WebGPU palette batch. The hidden evaluator rig retains the complete authored
 * animation; only its duplicate draw submission is disabled.
 *
 * The representative SkinnedMesh matrix is uploaded rather than the clone's
 * outer scene matrix. Quaternius animals place every skinned layer beneath a
 * shared -90 degree / centimetre-to-metre parent, so this preserves that
 * authored transform without copying or rewriting vertex data.
 */
export class AuthoredAnimalInstanceBatch {
  private readonly batch: AuthoredSkinnedInstanceBatch;
  private submitted = 0;

  constructor(options: {
    parent: THREE.Object3D;
    sourceRoot: THREE.Object3D;
    capacity: number;
    name: string;
    castShadow?: boolean;
    receiveShadow?: boolean;
  }) {
    assertSourceCanBeSubmittedExactly(options.sourceRoot);
    this.batch = new AuthoredSkinnedInstanceBatch({
      parent: options.parent,
      sourceRoot: options.sourceRoot,
      capacity: options.capacity,
      name: options.name,
      castShadow: options.castShadow ?? false,
      receiveShadow: options.receiveShadow ?? false,
    });
  }

  materialSlots() {
    return this.batch.materialSlots();
  }

  beginFrame(requiredCapacity: number): void {
    this.batch.reserve(requiredCapacity);
    this.submitted = 0;
  }

  submit(
    model: THREE.Object3D,
    materialColors: readonly AuthoredAnimalMaterialColor[] = [],
  ): number {
    const slot = this.submitted++;
    this.batch.setFromCloneAt(slot, model);
    for (const entry of materialColors) {
      this.batch.setMaterialColorAt(slot, entry.materialSlot, entry.color);
    }
    return slot;
  }

  endFrame(): void {
    this.batch.setCount(this.submitted);
    this.batch.commit();
  }

  diagnostics(): AuthoredSkinnedInstanceBatchDiagnostic {
    return this.batch.diagnostics();
  }

  dispose(): void {
    this.batch.dispose();
  }
}

/** Disable only the draw layers; the hierarchy and bones remain live. */
export function setAuthoredAnimalEvaluatorOnly(
  model: THREE.Object3D,
  evaluatorOnly: boolean,
): void {
  model.traverse((object) => {
    const mesh = object as THREE.SkinnedMesh;
    if (mesh.isSkinnedMesh) mesh.visible = !evaluatorOnly;
  });
}

function assertSourceCanBeSubmittedExactly(sourceRoot: THREE.Object3D): void {
  let skinnedCount = 0;
  let unsupportedVisibleMeshName: string | null = null;
  let referenceWorldMatrix: THREE.Matrix4 | null = null;
  sourceRoot.updateMatrixWorld(true);
  sourceRoot.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || mesh.visible === false) return;
    if (!(mesh as THREE.SkinnedMesh).isSkinnedMesh) {
      unsupportedVisibleMeshName ??= mesh.name || 'Authored animal source';
      return;
    }
    skinnedCount += 1;
    if (!referenceWorldMatrix) {
      referenceWorldMatrix = mesh.matrixWorld.clone();
      return;
    }
    if (!matricesApproximatelyEqual(referenceWorldMatrix, mesh.matrixWorld)) {
      throw new Error(
        `${sourceRoot.name || 'Authored animal'} has skinned layers with different local transforms; `
          + 'individual exact-model rendering is retained.',
      );
    }
  });
  if (skinnedCount === 0) throw new Error('Authored animal source contains no SkinnedMesh');
  if (unsupportedVisibleMeshName) {
    throw new Error(
      `${unsupportedVisibleMeshName} includes visible non-skinned geometry; `
        + 'individual exact-model rendering is retained.',
    );
  }
}

function matricesApproximatelyEqual(left: THREE.Matrix4, right: THREE.Matrix4): boolean {
  for (let index = 0; index < 16; index += 1) {
    if (Math.abs(left.elements[index]! - right.elements[index]!) > 1e-5) return false;
  }
  return true;
}
