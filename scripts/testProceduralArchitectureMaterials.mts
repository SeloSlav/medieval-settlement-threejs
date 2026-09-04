import * as THREE from 'three';
import { createBuildingMesh } from '../src/buildings/BuildingMeshes.ts';
import {
  sharedBuildingDetailMaterial,
  type BuildingDetailMaterialKey,
  type BuildingMaterialKey,
} from '../src/buildings/buildingMaterials.ts';
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
  | 'wood-semantic-non-timber'
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
let strongWoodSemanticReferences = 0;

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

const ROLE_INDEPENDENT_BUILDING_MATERIALS = new Set<BuildingMaterialKey>([
  'glass',
  'interiorDark',
]);

const ROLE_INDEPENDENT_DETAIL_MATERIALS = new Set<BuildingDetailMaterialKey>([
  // These are finishes or prop substances, not declarations that the
  // building's structural palette includes their underlying atlas carrier.
  'brass',
  'firedClay',
  'paintRed',
  'paintBlue',
  'paintOchre',
  'water',
  'smoke',
  'foliage',
  'crop',
  'bread',
]);

const NON_STRUCTURAL_PROP_PATTERN = /(?:\bstock\b|sample|delivered|stored|storage|bundle|bale|roll|barrel|basket|bucket|\bcan\b|crate|goods|ore|clay|salt|wax|candle|hide|fodder|grain|bread|loaf|fish|meat|manure|tool|utensil|vessel|pottery|sign emblem|trade sign|survey flag|target)/i;
const STRUCTURAL_CANVAS_PATTERN = /(?:canvas|tent|awning|canopy|weather fly|processing fly|market.*cloth|stall.*cloth|shelter.*cloth|fabric panel)/i;
const STRUCTURAL_WICKER_PATTERN = /(?:wattle|woven (?:wall|panel|screen)|wicker (?:wall|panel|screen)|hurdle|lightweight screen)/i;
const STRUCTURAL_EARTH_PATTERN = /(?:packed earth|yard (?:floor|surface)|stall floor|work floor|walking surface|thermal cover|clamp cover|earth cover)/i;
const STRUCTURAL_IRON_PATTERN = /(?:hinge|latch|strap|fastener|nail|bracket|tie[- ]?bar|grille|gate hardware|iron cross|roof cross|windlass|hoist|mechanism)/i;
const STRONG_WOOD_NOUN_PATTERN = /(?:\b(?:box(?:es)?|chest(?:s)?|crate(?:s)?|fence(?:s)?|gate(?:s)?|rack(?:s)?|bench(?:es)?|table(?:s)?|shelf|shelves|shelving)\b|\b(?:tool|storage|strong|lock|ice|fire)box(?:es)?\b|\bworkbench(?:es)?\b|\bbookshel(?:f|ves)\b)/i;
const STRONG_WOOD_CAMEL_NOUN_PATTERN = /(?:Box(?:es)?|Chest(?:s)?|Crate(?:s|d)?|Fence(?:s|d)?|Gate(?:s)?|Rack(?:s)?|Bench(?:es)?|Table(?:s|top)?|Shelf|Shelves|Shelving|Workbench(?:es)?|Bookshel(?:f|ves))/;
const WICKER_WOOD_NOUN_EXCEPTION_PATTERN = /\b(?:wicker|woven|wattle|hurdle|fibre|cord)\b/i;
const CANVAS_WOOD_NOUN_EXCEPTION_PATTERN = /\b(?:canvas|cloth|fabric|awning|canopy|weather fly)\b/i;
const STONE_WOOD_NOUN_EXCEPTION_PATTERN = /\b(?:stone|masonry|brick)\b/i;
const METAL_WOOD_NOUN_EXCEPTION_PATTERN = /\b(?:iron|ironwork|metal|brass|strap|hinge|reinforcement|lock|bracket|hardware)\b/i;
const SHINGLE_WOOD_NOUN_EXCEPTION_PATTERN = /\b(?:shingle|roof|cap)\b/i;
const BROWN_TIMBER_KEYS = new Set<BuildingMaterialKey>([
  'timberDark',
  'timberMid',
  'timberLight',
  'timberWeathered',
  'stackedTimber',
]);

function hasStrongWoodNoun(semanticName: string): boolean {
  return STRONG_WOOD_NOUN_PATTERN.test(semanticName)
    || STRONG_WOOD_CAMEL_NOUN_PATTERN.test(semanticName);
}

function buildingMaterialKey(material: THREE.Material): BuildingMaterialKey | null {
  const key = material.userData.buildingMaterialKey;
  return typeof key === 'string' ? key as BuildingMaterialKey : null;
}

function detailMaterialKey(material: THREE.Material): BuildingDetailMaterialKey | null {
  const key = material.userData.buildingDetailMaterialKey;
  return typeof key === 'string' ? key as BuildingDetailMaterialKey : null;
}

function isSharedBrownTimberMaterial(material: THREE.Material): boolean {
  const key = buildingMaterialKey(material);
  return material.userData.sharedBuildingMaterial === true
    && key !== null
    && BROWN_TIMBER_KEYS.has(key)
    && material.userData.buildingWeatheringProfile === 'timber';
}

function isStrongWoodNounMaterialException(
  semanticName: string,
  material: THREE.Material,
  materialRole: string,
): boolean {
  const constructionKey = buildingMaterialKey(material);
  const detailKey = detailMaterialKey(material);

  // Semantic writer roles make intentional woven leaves explicit even when an
  // individual primitive id only says "gate leaf". The role alone is not an
  // exception: the resolved material must still be the shared wicker detail.
  if (detailKey === 'wicker') {
    return materialRole === 'wicker'
      || WICKER_WOOD_NOUN_EXCEPTION_PATTERN.test(semanticName);
  }
  if (detailKey === 'canvas') {
    return materialRole === 'linen-canvas'
      || CANVAS_WOOD_NOUN_EXCEPTION_PATTERN.test(semanticName);
  }
  if (constructionKey?.startsWith('masonry')) {
    return STONE_WOOD_NOUN_EXCEPTION_PATTERN.test(semanticName);
  }
  if (constructionKey === 'metalIron' || detailKey === 'brass') {
    return METAL_WOOD_NOUN_EXCEPTION_PATTERN.test(semanticName);
  }
  if (constructionKey === 'shingle') {
    return SHINGLE_WOOD_NOUN_EXCEPTION_PATTERN.test(semanticName);
  }
  if (detailKey === 'earth') return /\bgate[- ]lane\b/i.test(semanticName);
  if (constructionKey === 'interiorDark') return /\bfirebox\b/i.test(semanticName);
  return false;
}

/**
 * The plan palette describes visible construction, not every substance used
 * by signs, goods, tools, windows, interiors, or simulation stock. Require a
 * role only when this particular mesh is part of the permanent shell or a
 * temporary architectural cover/screen/floor.
 */
function requiresDeclaredConstructionRole(
  object: THREE.Object3D,
  material: THREE.Material,
  path: string,
  visible: boolean,
  runtimeOwned: boolean,
  dynamicClass: MaterialUsageClass | null,
): boolean {
  if (!visible || runtimeOwned || dynamicClass !== null) return false;

  const constructionKey = buildingMaterialKey(material);
  if (constructionKey) {
    if (ROLE_INDEPENDENT_BUILDING_MATERIALS.has(constructionKey)) return false;
    const semanticName = `${path} ${object.name}`;
    if (NON_STRUCTURAL_PROP_PATTERN.test(semanticName)) return false;
    const explicitlyStructural = object.name !== '' && object.name !== 'Mesh'
      || typeof object.userData.proceduralStructuralUse === 'string'
      || typeof object.userData.facadeOpeningRole === 'string'
      || object.userData.proceduralRoofShell === true;
    // Legacy addMesh call sites that never supplied a semantic name cannot be
    // safely distinguished from static props. The audit remains strict for
    // every named/tagged construction surface and the semantic writer output.
    if (!explicitlyStructural) return false;
    if (constructionKey === 'metalIron') {
      return STRUCTURAL_IRON_PATTERN.test(semanticName);
    }
    return true;
  }

  const detailKey = detailMaterialKey(material);
  if (!detailKey || ROLE_INDEPENDENT_DETAIL_MATERIALS.has(detailKey)) return false;
  const semanticName = `${path} ${object.name}`;
  if (NON_STRUCTURAL_PROP_PATTERN.test(semanticName)) return false;
  if (detailKey === 'canvas') return STRUCTURAL_CANVAS_PATTERN.test(semanticName);
  if (detailKey === 'wicker') return STRUCTURAL_WICKER_PATTERN.test(semanticName);
  if (detailKey === 'earth') return STRUCTURAL_EARTH_PATTERN.test(semanticName);
  return false;
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
    const shadowBatch = object.userData.buildingDetailCasterBatch === true;

    if (mesh.isMesh && !shadowBatch) {
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
        const semanticMaterialChecks: Array<{
          readonly semanticName: string;
          readonly materialRole: string;
          readonly samplePath: string;
        }> = [];
        if (hasStrongWoodNoun(object.name)) {
          semanticMaterialChecks.push({
            semanticName: object.name,
            materialRole: String(
              object.userData.proceduralMaterialRole
              ?? mesh.geometry.userData.proceduralMaterialRole
              ?? '',
            ),
            samplePath: path,
          });
        }
        const geometryDiagnostics = mesh.geometry.userData.proceduralGeometryDiagnostics as {
          readonly primitives?: readonly {
            readonly semanticId?: string;
            readonly materialRole?: string;
          }[];
        } | undefined;
        for (const primitive of geometryDiagnostics?.primitives ?? []) {
          const semanticName = String(primitive.semanticId ?? '');
          if (!hasStrongWoodNoun(semanticName)) continue;
          semanticMaterialChecks.push({
            semanticName,
            materialRole: String(primitive.materialRole ?? ''),
            samplePath: `${path}#${semanticName}`,
          });
        }
        for (const check of semanticMaterialChecks) {
          strongWoodSemanticReferences += 1;
          if (
            isSharedBrownTimberMaterial(material)
            || isStrongWoodNounMaterialException(
              check.semanticName,
              material,
              check.materialRole,
            )
          ) {
            continue;
          }
          recordViolation({
            code: 'wood-semantic-non-timber',
            rootLabel: audit.label,
            materialLabel: label,
            detail: `Strong wood noun “${check.semanticName}” must use the shared brown timber family unless its semantic name identifies a canvas, wicker, stone, metal, roof-cap, earthen-lane, or firebox surface.`,
            path: check.samplePath,
            visible,
          });
        }
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
          requiresDeclaredConstructionRole(
            object,
            material,
            path,
            visible,
            runtimeOwned,
            dynamicClass,
          )
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

if (strongWoodSemanticReferences === 0) {
  throw new Error(
    'Strong-wood semantic audit found no named mesh or procedural primitive references; the assertion became vacuous.',
  );
}

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
  `Procedural architecture material audit passed for ${BUILDING_KINDS.length} buildings, 4 residence tiers, and ${strongWoodSemanticReferences} strong-wood semantic references.`,
);
