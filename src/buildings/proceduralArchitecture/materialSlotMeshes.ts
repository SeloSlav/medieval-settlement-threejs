import * as THREE from 'three';
import type {
  BuildingDetailMaterialKey,
  BuildingMaterialKey,
} from '../buildingMaterials.ts';
import {
  addMesh,
  sharedBuildingDetailMaterial,
  sharedBuildingMaterial,
} from '../buildingMaterials.ts';
import type { ProceduralMaterialRole } from './catalog.ts';
import type {
  CompiledProceduralMaterialSlot,
  ProceduralGeometryWriterResult,
} from './geometryWriter.ts';

export type ProceduralMaterialSlotOverride =
  | { readonly source: 'construction'; readonly key: BuildingMaterialKey }
  | { readonly source: 'detail'; readonly key: BuildingDetailMaterialKey };

export type ProceduralMaterialSlotMeshResult = {
  readonly meshes: ReadonlyMap<ProceduralMaterialRole, THREE.Mesh>;
  readonly triangleCount: number;
  readonly drawCalls: number;
};

/**
 * Turns the semantic writer's one-geometry-per-role output into shared-atlas
 * meshes. This is deliberately the only default role-to-material resolver:
 * authored generators may request a historically valid shade override, but
 * cannot silently create a local material or lose the writer's physical UVs.
 */
export function addProceduralMaterialSlotMeshes(
  parent: THREE.Group,
  result: ProceduralGeometryWriterResult,
  options: {
    readonly namePrefix: string;
    readonly overrides?: Partial<Record<ProceduralMaterialRole, ProceduralMaterialSlotOverride>>;
  },
): ProceduralMaterialSlotMeshResult {
  const meshes = new Map<ProceduralMaterialRole, THREE.Mesh>();
  let triangleCount = 0;

  for (const slot of result.slots) {
    const material = resolveSlotMaterial(slot, options.overrides?.[slot.materialRole]);
    const mesh = addMesh(
      parent,
      slot.geometry,
      material,
      new THREE.Vector3(),
    );
    mesh.name = `${options.namePrefix} ${slot.materialRole} material slot`;
    mesh.userData.proceduralMaterialRole = slot.materialRole;
    mesh.userData.proceduralMaterialSlot = slot.materialIndex;
    mesh.userData.proceduralPhysicalUv = true;
    mesh.userData.proceduralPrimitiveCount = slot.diagnostics.primitiveCount;
    mesh.userData.proceduralTriangleCount = slot.diagnostics.triangleCount;
    mesh.userData.proceduralPrimitiveDiagnostics = slot.diagnostics.primitives;
    meshes.set(slot.materialRole, mesh);
    triangleCount += slot.diagnostics.triangleCount;
  }

  parent.userData.proceduralGeometryWriter = result.version;
  parent.userData.proceduralGeometryDiagnostics = result.diagnostics;
  return {
    meshes,
    triangleCount,
    drawCalls: meshes.size,
  };
}

function resolveSlotMaterial(
  slot: CompiledProceduralMaterialSlot,
  override: ProceduralMaterialSlotOverride | undefined,
): THREE.Material {
  if (override) {
    assertOverrideAllowed(slot, override);
    return override.source === 'construction'
      ? sharedBuildingMaterial(override.key)
      : sharedBuildingDetailMaterial(override.key);
  }

  const constructionKey = slot.sharedMaterialKeys[0];
  if (constructionKey) return sharedBuildingMaterial(constructionKey);
  const detailKey = slot.sharedDetailMaterialKeys[0];
  if (detailKey) return sharedBuildingDetailMaterial(detailKey);
  throw new Error(
    `Procedural material role ${slot.materialRole} has no shared renderer identity.`,
  );
}

function assertOverrideAllowed(
  slot: CompiledProceduralMaterialSlot,
  override: ProceduralMaterialSlotOverride,
): void {
  const allowed = override.source === 'construction'
    ? slot.sharedMaterialKeys.includes(override.key as never)
    : slot.sharedDetailMaterialKeys.includes(override.key as never);
  if (!allowed) {
    throw new Error(
      `${override.source} material ${override.key} is not permitted for ${slot.materialRole}.`,
    );
  }
}
