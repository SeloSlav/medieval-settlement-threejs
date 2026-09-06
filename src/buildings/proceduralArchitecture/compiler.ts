import * as THREE from 'three';
import type { BuildingKind } from '../../resources/types.ts';
import { applyBuildingRoofTones } from '../buildingRoofTones.ts';
import { isDynamicBuildingBatchBoundary } from '../staticBuildingBatch.ts';
import { PROCEDURAL_ARCHITECTURE_VERSION } from './catalog.ts';
import { finalizeProceduralBuilding } from './finalize.ts';
import { markProceduralRuntimeOwned } from './runtimeOwnership.ts';
import {
  proceduralVisualRequestKey,
  type ProceduralVisualRequest,
} from './visualRequest.ts';

export type ProceduralBuildingVisualRequest = Extract<
  ProceduralVisualRequest,
  { readonly type: 'building' | 'church' | 'monastery' }
>;

export type ProceduralBuildingCompilerInput = {
  readonly kind: BuildingKind;
  readonly request: ProceduralBuildingVisualRequest;
  readonly developmentTier: 0 | 1 | 2 | 3 | 4;
  readonly generate: () => THREE.Group;
};

export type ProceduralArchitectureCompilerDiagnostics = {
  readonly compilerVersion: typeof PROCEDURAL_ARCHITECTURE_VERSION;
  readonly requestKey: string;
  readonly generatorMilliseconds: number;
  readonly runtimeOwnedBoundaries: number;
  readonly declaredModules: readonly string[];
  readonly deterministicVariant: 0 | 1 | 2 | 3;
};

/**
 * One production seam for every non-residence building. Individual generators
 * author massing and modules; the compiler owns deterministic identity,
 * simulation boundaries, material/historical validation, metrics, and shadows.
 */
export function compileProceduralBuilding(
  input: ProceduralBuildingCompilerInput,
): THREE.Group {
  assertRequestMatchesKind(input.request, input.kind);
  const startedAt = performance.now();
  const root = input.generate();
  const generatorMilliseconds = performance.now() - startedAt;
  const runtimeOwnedBoundaries = markRuntimeBoundaries(root);
  applyBuildingRoofTones(root, input.kind, input.request.seed);

  const finalized = finalizeProceduralBuilding(root, input.kind, {
    seed: input.request.seed,
    developmentTier: input.developmentTier,
    visualRequest: input.request,
  });
  const plan = finalized.userData.proceduralBuildingPlan as {
    readonly modules: readonly string[];
  };
  const requestKey = proceduralVisualRequestKey(input.request);
  const diagnostics: ProceduralArchitectureCompilerDiagnostics = {
    compilerVersion: PROCEDURAL_ARCHITECTURE_VERSION,
    requestKey,
    generatorMilliseconds,
    runtimeOwnedBoundaries,
    declaredModules: plan.modules,
    deterministicVariant: boundedVariant(input.request.seed),
  };
  finalized.userData.proceduralArchitectureCompiler = diagnostics;
  finalized.userData.proceduralArchitectureContentSignature = [
    PROCEDURAL_ARCHITECTURE_VERSION,
    requestKey,
    plan.modules.join(','),
  ].join('|');
  return finalized;
}

function assertRequestMatchesKind(
  request: ProceduralBuildingVisualRequest,
  kind: BuildingKind,
): void {
  if (request.kind !== kind) {
    throw new Error(
      `Procedural request ${proceduralVisualRequestKey(request)} cannot compile as ${kind}.`,
    );
  }
}

function markRuntimeBoundaries(root: THREE.Group): number {
  let boundaries = 0;
  const visit = (object: THREE.Object3D, ownedByAncestor: boolean): void => {
    const owned = ownedByAncestor || isDynamicBuildingBatchBoundary(object);
    if (owned && !ownedByAncestor) {
      markProceduralRuntimeOwned(object);
      boundaries += 1;
    }
    for (const child of object.children) visit(child, owned);
  };
  for (const child of root.children) visit(child, false);
  return boundaries;
}

function boundedVariant(seed: number): 0 | 1 | 2 | 3 {
  const normalized = Math.abs(Math.trunc(seed)) % 4;
  return normalized as 0 | 1 | 2 | 3;
}
