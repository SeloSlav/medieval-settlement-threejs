import * as THREE from 'three';
import type { BuildingKind } from '../../resources/types.ts';
import {
  createProceduralBuildingPlan,
  type ProceduralBuildingPlan,
} from './catalog.ts';
import { installProceduralShadowCasters } from './shadows.ts';
import {
  proceduralVisualRequestKey,
  type ProceduralVisualRequest,
} from './visualRequest.ts';
import { validateProceduralBuildingPlanMaterials } from './materialRoles.ts';

export type ProceduralArchitectureMetrics = {
  /** Scene-graph estimates captured before local/cross-building batching. */
  readonly measurementKind: 'scene-graph-estimates-not-renderer-counters';
  /** Backward-compatible alias for sourceMeshes. */
  readonly meshes: number;
  /** Backward-compatible alias for sourceTriangles. */
  readonly triangles: number;
  /** Backward-compatible alias for sourceVertices. */
  readonly vertices: number;
  /** Mesh nodes present in the source graph, including currently hidden slots. */
  readonly sourceMeshes: number;
  /** Source mesh nodes currently drawable through their complete ancestor chain. */
  readonly visibleMeshes: number;
  /** Instance-expanded source triangle estimate, including currently hidden slots. */
  readonly sourceTriangles: number;
  /** Instance-expanded triangle estimate for the graph's current visible state. */
  readonly visibleTriangles: number;
  /** Geometry-buffer vertices; instances do not duplicate source vertex storage. */
  readonly sourceVertices: number;
  /** Potential source-graph submissions before batching, not renderer draw counters. */
  readonly sourceDrawCalls: number;
  /** Current visible source-graph submissions before batching, not renderer counters. */
  readonly visibleDrawCalls: number;
  readonly distinctMaterials: number;
  readonly atlasBackedMaterials: number;
  readonly specialtyMaterials: number;
  readonly finiteGeometry: boolean;
  /** Backward-compatible source-graph budget result. */
  readonly withinTriangleCeiling: boolean;
  readonly withinVisibleTriangleCeiling: boolean;
};

/**
 * Applies one serializable visual contract to every native Three.js building.
 * Immutable leaves are still merged later by the existing completed-building
 * batcher; this pass deliberately preserves named runtime-owned subtrees.
 */
export function finalizeProceduralBuilding(
  root: THREE.Group,
  kind: BuildingKind,
  options: {
    readonly seed?: number;
    readonly developmentTier?: 0 | 1 | 2 | 3;
    readonly visualRequest?: ProceduralVisualRequest;
  } = {},
): THREE.Group {
  const plan = createProceduralBuildingPlan(kind, options);
  const materialValidation = validateProceduralBuildingPlanMaterials(plan);
  if (!materialValidation.valid) {
    throw new Error(
      `Procedural ${kind} violates its historical material contract: ${materialValidation.issues
        .map((issue) => issue.message)
        .join(' ')}`,
    );
  }
  const metrics = measureProceduralArchitecture(root, plan);
  const shadowMetrics = installProceduralShadowCasters(
    root,
    `Procedural ${kind} structural shadow batches`,
  );

  root.userData.proceduralArchitecture = true;
  root.userData.proceduralArchitectureVersion = plan.version;
  root.userData.proceduralArchitectureSource = plan.source;
  root.userData.proceduralBuildingPlan = plan;
  root.userData.proceduralMaterialValidation = materialValidation;
  if (options.visualRequest) {
    root.userData.proceduralVisualRequest = options.visualRequest;
    root.userData.proceduralVisualRequestKey = proceduralVisualRequestKey(options.visualRequest);
  }
  root.userData.proceduralArchitectureMetrics = metrics;
  root.userData.proceduralArchitectureShadowMetrics = shadowMetrics;
  root.userData.proceduralArchitectureBudget = {
    triangleTarget: plan.triangleTarget,
    triangleCeiling: plan.triangleCeiling,
    drawCallTarget: plan.drawCallTarget,
  };
  delete root.userData.authoredGlbAsset;
  delete root.userData.authoredGlbVersion;
  delete root.userData.authoredGlbUrl;

  if (!metrics.finiteGeometry) {
    throw new Error(`Procedural ${kind} contains non-finite geometry.`);
  }
  if (!metrics.withinVisibleTriangleCeiling) {
    throw new Error(
      `Procedural ${kind} exceeds its visible triangle ceiling: ${metrics.visibleTriangles} > ${plan.triangleCeiling}.`,
    );
  }
  return root;
}

export function measureProceduralArchitecture(
  root: THREE.Object3D,
  plan: Pick<ProceduralBuildingPlan, 'triangleCeiling'>,
): ProceduralArchitectureMetrics {
  let sourceMeshes = 0;
  let visibleMeshes = 0;
  let sourceTriangles = 0;
  let visibleTriangles = 0;
  let sourceVertices = 0;
  let sourceDrawCalls = 0;
  let visibleDrawCalls = 0;
  let finiteGeometry = true;
  const materials = new Set<THREE.Material>();
  const atlasMaterials = new Set<THREE.Material>();

  const visit = (object: THREE.Object3D, ancestorsVisible: boolean): void => {
    const visibleThroughAncestors = ancestorsVisible && object.visible;
    const mesh = object as THREE.Mesh<THREE.BufferGeometry, THREE.Material | THREE.Material[]>;
    if (mesh.isMesh && mesh.geometry) {
      sourceMeshes += 1;
      const position = mesh.geometry.getAttribute('position');
      if (position) {
        sourceVertices += position.count;
        for (let index = 0; index < position.count; index += 1) {
          if (
            !Number.isFinite(position.getX(index))
            || !Number.isFinite(position.getY(index))
            || !Number.isFinite(position.getZ(index))
          ) {
            finiteGeometry = false;
            break;
          }
        }
      }
      const instanceCount = meshInstanceCount(mesh);
      sourceTriangles += geometryTriangleCount(mesh.geometry) * instanceCount;
      sourceDrawCalls += estimatedMeshDrawCalls(mesh, false);

      const meshVisibleDrawCalls = visibleThroughAncestors && instanceCount > 0
        ? estimatedMeshDrawCalls(mesh, true)
        : 0;
      if (meshVisibleDrawCalls > 0) {
        visibleMeshes += 1;
        visibleDrawCalls += meshVisibleDrawCalls;
        visibleTriangles += estimatedVisibleTriangleCount(mesh) * instanceCount;
      }

      const meshMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of meshMaterials) {
        materials.add(material);
        if (material.userData.buildingMaterialAtlas === 'gorski-building-atlas-v1') {
          atlasMaterials.add(material);
        }
      }
    }

    for (const child of object.children) {
      visit(child, visibleThroughAncestors);
    }
  };
  visit(root, true);

  return {
    measurementKind: 'scene-graph-estimates-not-renderer-counters',
    meshes: sourceMeshes,
    triangles: sourceTriangles,
    vertices: sourceVertices,
    sourceMeshes,
    visibleMeshes,
    sourceTriangles,
    visibleTriangles,
    sourceVertices,
    sourceDrawCalls,
    visibleDrawCalls,
    distinctMaterials: materials.size,
    atlasBackedMaterials: atlasMaterials.size,
    specialtyMaterials: materials.size - atlasMaterials.size,
    finiteGeometry,
    withinTriangleCeiling: sourceTriangles <= plan.triangleCeiling,
    withinVisibleTriangleCeiling: visibleTriangles <= plan.triangleCeiling,
  };
}

function meshInstanceCount(
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.Material | THREE.Material[]>,
): number {
  const instanced = mesh as THREE.InstancedMesh<THREE.BufferGeometry, THREE.Material | THREE.Material[]>;
  return instanced.isInstancedMesh
    ? Math.max(0, Math.floor(instanced.count))
    : 1;
}

function geometryTriangleCount(geometry: THREE.BufferGeometry): number {
  const position = geometry.getAttribute('position');
  const elementCount = geometry.index?.count ?? position?.count ?? 0;
  return elementCount / 3;
}

function estimatedMeshDrawCalls(
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.Material | THREE.Material[]>,
  visibleMaterialsOnly: boolean,
): number {
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  const groups = mesh.geometry.groups;
  if (Array.isArray(mesh.material) && groups.length > 0) {
    let draws = 0;
    for (const group of groups) {
      const material = materials[group.materialIndex ?? 0];
      if (!material || (visibleMaterialsOnly && !material.visible)) continue;
      if (intersectedDrawElementCount(mesh.geometry, group.start, group.count) >= 3) {
        draws += 1;
      }
    }
    return draws;
  }

  const hasEligibleMaterial = materials.some(
    (material) => !visibleMaterialsOnly || material.visible,
  );
  return hasEligibleMaterial && intersectedDrawElementCount(
    mesh.geometry,
    0,
    geometryElementCount(mesh.geometry),
  ) >= 3
    ? 1
    : 0;
}

function estimatedVisibleTriangleCount(
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.Material | THREE.Material[]>,
): number {
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  const groups = mesh.geometry.groups;
  if (Array.isArray(mesh.material) && groups.length > 0) {
    let elements = 0;
    for (const group of groups) {
      const material = materials[group.materialIndex ?? 0];
      if (!material?.visible) continue;
      elements += intersectedDrawElementCount(mesh.geometry, group.start, group.count);
    }
    return elements / 3;
  }
  if (!materials.some((material) => material.visible)) return 0;
  return intersectedDrawElementCount(
    mesh.geometry,
    0,
    geometryElementCount(mesh.geometry),
  ) / 3;
}

function geometryElementCount(geometry: THREE.BufferGeometry): number {
  return geometry.index?.count ?? geometry.getAttribute('position')?.count ?? 0;
}

function intersectedDrawElementCount(
  geometry: THREE.BufferGeometry,
  groupStart: number,
  groupCount: number,
): number {
  const total = geometryElementCount(geometry);
  const drawStart = Math.max(0, Math.min(total, geometry.drawRange.start));
  const requestedDrawCount = Number.isFinite(geometry.drawRange.count)
    ? Math.max(0, geometry.drawRange.count)
    : total - drawStart;
  const drawEnd = Math.min(total, drawStart + requestedDrawCount);
  const start = Math.max(drawStart, Math.max(0, groupStart));
  const requestedGroupCount = Number.isFinite(groupCount)
    ? Math.max(0, groupCount)
    : total - start;
  const end = Math.min(drawEnd, groupStart + requestedGroupCount);
  return Math.max(0, end - start);
}
