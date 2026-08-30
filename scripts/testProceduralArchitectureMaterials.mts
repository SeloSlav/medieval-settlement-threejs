import * as THREE from 'three';
import { createBuildingMesh } from '../src/buildings/BuildingMeshes.ts';
import { sharedBuildingDetailMaterial } from '../src/buildings/buildingMaterials.ts';
import {
  PROCEDURAL_MATERIAL_ROLE_REGISTRY,
  validateProceduralBuildingPlanMaterials,
} from '../src/buildings/proceduralArchitecture/materialRoles.ts';
import { isProceduralRuntimeOwned } from '../src/buildings/proceduralArchitecture/runtimeOwnership.ts';
import type {
  ProceduralBuildingPlan,
  ProceduralMaterialRole,
} from '../src/buildings/proceduralArchitecture/catalog.ts';
import { BUILDING_KINDS, type BuildingKind } from '../src/generated/gameBalance.ts';
import { createResidenceMesh } from '../src/residences/ResidenceMarkers.ts';

type AuditedRootClass = 'placeable-buildings' | 'residences';

type MaterialUsageClass =
  | 'living-vegetation'
  | 'runtime-owned'
  | 'dynamic-window'
  | 'dynamic-fire-smoke'
  | 'dynamic-water'
  | 'dynamic-interior'
  | 'shared-atlas-construction'
  | 'shared-atlas-detail'
  | 'shared-specialty'
  | 'non-shared-standard-node'
  | 'other-material';

type AuditRoot = {
  readonly label: string;
  readonly rootClass: AuditedRootClass;
  readonly root: THREE.Group;
  readonly materialRoles: readonly ProceduralMaterialRole[];
  readonly plan?: ProceduralBuildingPlan;
};

type ClassStats = {
  readonly identities: Set<THREE.Material>;
  sourceMeshReferences: number;
  visibleMeshReferences: number;
  sourceInstances: number;
  visibleInstances: number;
};

type ViolationCode =
  | 'material-array'
  | 'living-vegetation-material'
  | 'non-shared-structural-material'
  | 'atlas-role-mismatch'
  | 'invalid-plan-material-contract';

type ViolationAggregate = {
  readonly code: ViolationCode;
  readonly rootLabel: string;
  readonly materialLabel: string;
  readonly detail: string;
  occurrences: number;
  visibleOccurrences: number;
  readonly samplePaths: Set<string>;
};

const RESIDENCE_MATERIAL_ROLES = {
  1: ['fieldstone', 'lime-plaster', 'rough-timber', 'weathered-boards', 'split-shingles', 'wrought-iron'],
  2: ['fieldstone', 'limestone-ashlar', 'lime-plaster', 'rough-timber', 'weathered-boards', 'split-shingles', 'wrought-iron'],
  3: ['fieldstone', 'limestone-ashlar', 'lime-plaster', 'rough-timber', 'weathered-boards', 'split-shingles', 'wrought-iron'],
  4: ['fieldstone', 'limestone-ashlar', 'lime-plaster', 'rough-timber', 'weathered-boards', 'clay-tiles', 'wrought-iron'],
} as const satisfies Record<1 | 2 | 3 | 4, readonly ProceduralMaterialRole[]>;

const forbiddenLivingDetailMaterials = new Set<THREE.Material>([
  sharedBuildingDetailMaterial('foliage'),
  sharedBuildingDetailMaterial('crop'),
]);
const LIVING_MATERIAL_NAME_PATTERN = /(?:foliage|\bcrop\b|leaf|leaves|flower|herb|parsley|rosemary|sage|moss|grass|turf|sapling|shrub|tree|orchard|fruit|apple|pear|vine|plant)/i;

const auditRoots: AuditRoot[] = BUILDING_KINDS.map((kind) => {
  const root = createBuildingMesh(kind);
  const plan = root.userData.proceduralBuildingPlan as ProceduralBuildingPlan | undefined;
  return {
    label: kind,
    rootClass: 'placeable-buildings',
    root,
    materialRoles: plan?.materials ?? [],
    plan,
  };
});
for (const tier of [1, 2, 3, 4] as const) {
  auditRoots.push({
    label: `residence-tier-${tier}`,
    rootClass: 'residences',
    root: createResidenceMesh(1550, tier),
    materialRoles: RESIDENCE_MATERIAL_ROLES[tier],
  });
}

const materialClassStats = new Map<MaterialUsageClass, ClassStats>();
const rootClassStats = new Map<AuditedRootClass, ClassStats>();
const violations = new Map<string, ViolationAggregate>();

function classStatsFor<Key extends string>(
  map: Map<Key, ClassStats>,
  key: Key,
): ClassStats {
  let stats = map.get(key);
  if (!stats) {
    stats = {
      identities: new Set<THREE.Material>(),
      sourceMeshReferences: 0,
      visibleMeshReferences: 0,
      sourceInstances: 0,
      visibleInstances: 0,
    };
    map.set(key, stats);
  }
  return stats;
}

function materialLabel(material: THREE.Material): string {
  return material.name || `${material.type}:${material.uuid.slice(0, 8)}`;
}

function recordViolation(options: {
  readonly code: ViolationCode;
  readonly rootLabel: string;
  readonly materialLabel: string;
  readonly detail: string;
  readonly path: string;
  readonly visible: boolean;
}): void {
  const key = [
    options.code,
    options.rootLabel,
    options.materialLabel,
    options.detail,
  ].join('\u0000');
  let aggregate = violations.get(key);
  if (!aggregate) {
    aggregate = {
      code: options.code,
      rootLabel: options.rootLabel,
      materialLabel: options.materialLabel,
      detail: options.detail,
      occurrences: 0,
      visibleOccurrences: 0,
      samplePaths: new Set<string>(),
    };
    violations.set(key, aggregate);
  }
  aggregate.occurrences += 1;
  if (options.visible) aggregate.visibleOccurrences += 1;
  if (aggregate.samplePaths.size < 3) aggregate.samplePaths.add(options.path);
}

function isLivingVegetationMaterial(material: THREE.Material): boolean {
  return forbiddenLivingDetailMaterials.has(material)
    || LIVING_MATERIAL_NAME_PATTERN.test(material.name);
}

function isStandardOrNodeMaterial(material: THREE.Material): boolean {
  const candidate = material as THREE.Material & {
    readonly isMeshStandardMaterial?: boolean;
    readonly isMeshPhysicalMaterial?: boolean;
    readonly isNodeMaterial?: boolean;
  };
  return candidate.isMeshStandardMaterial === true
    || candidate.isMeshPhysicalMaterial === true
    || candidate.isNodeMaterial === true
    || /(?:MeshStandard|MeshPhysical).*NodeMaterial/.test(material.type);
}

function dynamicUsageClass(
  root: THREE.Group,
  object: THREE.Object3D,
  material: THREE.Material,
): MaterialUsageClass | null {
  if (root.userData.windowMaterial === material
    || material.name === 'Residence window (dynamic glow)') {
    return 'dynamic-window';
  }

  const openingRole = String(object.userData.facadeOpeningRole ?? '');
  if (openingRole === 'window-pane' || openingRole === 'window-interior') {
    return 'dynamic-window';
  }

  const semanticName = `${object.name} ${material.name}`;
  if (/(?:campfire|fire spark|flame|ember|smoke wisp|lit smoke|smoke material)/i.test(semanticName)) {
    return 'dynamic-fire-smoke';
  }
  if (/(?:water surface|quench water|shared bounded well water|detail material: water)/i.test(semanticName)) {
    return 'dynamic-water';
  }
  if (/(?:interiorDark|open interior|window-interior|door-reveal|shadowed.*reveal)/i.test(semanticName)) {
    return 'dynamic-interior';
  }
  return null;
}

function materialUsageClass(
  root: THREE.Group,
  object: THREE.Object3D,
  material: THREE.Material,
  runtimeOwned: boolean,
): MaterialUsageClass {
  if (isLivingVegetationMaterial(material)) return 'living-vegetation';
  if (runtimeOwned) return 'runtime-owned';
  const dynamicClass = dynamicUsageClass(root, object, material);
  if (dynamicClass) return dynamicClass;
  if (material.userData.sharedBuildingMaterial === true) {
    if (typeof material.userData.buildingMaterialAtlasTile === 'string') {
      return material.name.startsWith('Shared building detail material:')
        ? 'shared-atlas-detail'
        : 'shared-atlas-construction';
    }
    return 'shared-specialty';
  }
  return isStandardOrNodeMaterial(material)
    ? 'non-shared-standard-node'
    : 'other-material';
}

function addStats(
  stats: ClassStats,
  material: THREE.Material,
  visible: boolean,
  instanceCount: number,
): void {
  stats.identities.add(material);
  stats.sourceMeshReferences += 1;
  stats.sourceInstances += instanceCount;
  if (visible) {
    stats.visibleMeshReferences += 1;
    stats.visibleInstances += instanceCount;
  }
}

function allowedAtlasTiles(
  materialRoles: readonly ProceduralMaterialRole[],
): Set<string> {
  const result = new Set<string>();
  for (const role of materialRoles) {
    for (const tile of PROCEDURAL_MATERIAL_ROLE_REGISTRY[role].atlasTiles) {
      result.add(tile);
    }
  }
  return result;
}

function auditRoot(audit: AuditRoot): void {
  const allowedTiles = allowedAtlasTiles(audit.materialRoles);
  if (audit.plan) {
    const validation = validateProceduralBuildingPlanMaterials(audit.plan);
    for (const issue of validation.issues) {
      recordViolation({
        code: 'invalid-plan-material-contract',
        rootLabel: audit.label,
        materialLabel: issue.role ?? '(plan)',
        detail: `${issue.code}: ${issue.message}`,
        path: audit.root.name || audit.label,
        visible: true,
      });
    }
  }

  const visit = (
    object: THREE.Object3D,
    ancestorsVisible: boolean,
    ancestorRuntimeOwned: boolean,
    parentPath: string,
  ): void => {
    const visibleThroughAncestors = ancestorsVisible && object.visible;
    const runtimeOwned = ancestorRuntimeOwned || isProceduralRuntimeOwned(object);
    const objectName = object.name || object.type;
    const path = parentPath ? `${parentPath}/${objectName}` : objectName;
    const mesh = object as THREE.Mesh<THREE.BufferGeometry, THREE.Material | THREE.Material[]>;

    if (mesh.isMesh) {
      if (Array.isArray(mesh.material)) {
        recordViolation({
          code: 'material-array',
          rootLabel: audit.label,
          materialLabel: `[${mesh.material.map(materialLabel).join(', ')}]`,
          detail: 'Every architecture mesh must resolve to one material slot; material arrays are prohibited.',
          path,
          visible: visibleThroughAncestors,
        });
      }
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const instanceCount = (mesh as THREE.InstancedMesh).isInstancedMesh
        ? Math.max(0, Math.floor((mesh as THREE.InstancedMesh).count))
        : 1;

      for (const material of materials) {
        const visible = visibleThroughAncestors && material.visible && instanceCount > 0;
        const usageClass = materialUsageClass(
          audit.root,
          object,
          material,
          runtimeOwned,
        );
        addStats(
          classStatsFor(materialClassStats, usageClass),
          material,
          visible,
          instanceCount,
        );
        addStats(
          classStatsFor(rootClassStats, audit.rootClass),
          material,
          visible,
          instanceCount,
        );

        const label = materialLabel(material);
        if (isLivingVegetationMaterial(material)) {
          const exactForbidden = forbiddenLivingDetailMaterials.has(material);
          recordViolation({
            code: 'living-vegetation-material',
            rootLabel: audit.label,
            materialLabel: label,
            detail: exactForbidden
              ? 'Architecture references the forbidden shared foliage/crop detail identity; living vegetation belongs to SeedThree.'
              : 'The material name identifies living vegetation embedded in the architecture root.',
            path,
            visible,
          });
        }

        const dynamicClass = dynamicUsageClass(audit.root, object, material);
        const immutableStructural = !runtimeOwned && dynamicClass === null;
        if (
          immutableStructural
          && isStandardOrNodeMaterial(material)
          && material.userData.sharedBuildingMaterial !== true
        ) {
          recordViolation({
            code: 'non-shared-structural-material',
            rootLabel: audit.label,
            materialLabel: label,
            detail: 'Immutable MeshStandard/Node architecture must use a shared building material identity.',
            path,
            visible,
          });
        }

        const atlasTile = material.userData.buildingMaterialAtlasTile;
        if (
          immutableStructural
          && typeof atlasTile === 'string'
          && !allowedTiles.has(atlasTile)
        ) {
          recordViolation({
            code: 'atlas-role-mismatch',
            rootLabel: audit.label,
            materialLabel: label,
            detail: `Atlas tile ${atlasTile} is outside plan roles [${audit.materialRoles.join(', ')}]; allowed tiles are [${[...allowedTiles].sort().join(', ')}].`,
            path,
            visible,
          });
        }
      }
    }

    for (const child of object.children) {
      visit(child, visibleThroughAncestors, runtimeOwned, path);
    }
  };

  visit(audit.root, true, false, '');
}

for (const audit of auditRoots) auditRoot(audit);

function printStats<Key extends string>(title: string, statsByClass: Map<Key, ClassStats>): void {
  console.log(title);
  console.log('class\tidentities\tsource-meshes\tvisible-meshes\tsource-instances\tvisible-instances');
  for (const [usageClass, stats] of [...statsByClass].sort(([left], [right]) =>
    left.localeCompare(right))) {
    console.log([
      usageClass,
      stats.identities.size,
      stats.sourceMeshReferences,
      stats.visibleMeshReferences,
      stats.sourceInstances,
      stats.visibleInstances,
    ].join('\t'));
  }
}

printStats('Procedural architecture material classes', materialClassStats);
printStats('Procedural architecture root classes', rootClassStats);

const violationList = [...violations.values()].sort((left, right) =>
  left.code.localeCompare(right.code)
    || left.rootLabel.localeCompare(right.rootLabel)
    || left.materialLabel.localeCompare(right.materialLabel));

if (violationList.length > 0) {
  const byCode = new Map<ViolationCode, { groups: number; occurrences: number; roots: Set<string> }>();
  for (const violation of violationList) {
    let summary = byCode.get(violation.code);
    if (!summary) {
      summary = { groups: 0, occurrences: 0, roots: new Set<string>() };
      byCode.set(violation.code, summary);
    }
    summary.groups += 1;
    summary.occurrences += violation.occurrences;
    summary.roots.add(violation.rootLabel);
  }

  console.error('Procedural architecture material violations');
  for (const [code, summary] of [...byCode].sort(([left], [right]) =>
    left.localeCompare(right))) {
    console.error(
      `${code}: ${summary.groups} groups / ${summary.occurrences} mesh references / roots [${[...summary.roots].sort().join(', ')}]`,
    );
  }

  const detailLimit = 100;
  for (const [index, violation] of violationList.slice(0, detailLimit).entries()) {
    console.error(
      `${index + 1}. ${violation.code} ${violation.rootLabel} :: ${violation.materialLabel} `
        + `(${violation.occurrences} source, ${violation.visibleOccurrences} visible) - ${violation.detail} `
        + `samples [${[...violation.samplePaths].join('; ')}]`,
    );
  }
  if (violationList.length > detailLimit) {
    console.error(`... ${violationList.length - detailLimit} additional violation groups omitted.`);
  }
  throw new Error(
    `Procedural architecture material audit failed with ${violationList.length} grouped violations.`,
  );
}

console.log(
  `Procedural architecture material audit passed for ${BUILDING_KINDS.length} buildings and 4 residence tiers.`,
);
