import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createBuildingMesh } from '../src/buildings/BuildingMeshes.ts';
import { BUILDING_LOCAL_VISUAL_BOUNDS } from '../src/buildings/BuildingVisualBounds.ts';
import {
  PROCEDURAL_BUILDING_CATALOG,
  type ProceduralMaterialRole,
} from '../src/buildings/proceduralArchitecture/catalog.ts';
import { PROCEDURAL_MATERIAL_ROLE_REGISTRY } from '../src/buildings/proceduralArchitecture/materialRoles.ts';
import { isProceduralRuntimeOwned } from '../src/buildings/proceduralArchitecture/runtimeOwnership.ts';

type ExtractionKind = 'stone_quarry' | 'large_quarry' | 'mine';

type StockpileContract = {
  readonly container: string;
  readonly segment: string;
  readonly segmentCount: number;
};

type ExtractionContract = {
  readonly alias: string;
  readonly semanticRole: string;
  readonly resources: readonly string[];
  readonly materialRoles: readonly ProceduralMaterialRole[];
  readonly visibleTriangleFloor: number;
  readonly atlasIdentityCeiling: number;
  readonly specialtyMaterialCeiling: number;
  readonly runtimeBoundaries: readonly string[];
  readonly stockpiles: readonly StockpileContract[];
  readonly semanticGroups: ReadonlyArray<{
    readonly name: string;
    readonly roles: readonly ProceduralMaterialRole[];
  }>;
  readonly requiredNames: readonly string[];
};

const CONTRACTS = {
  stone_quarry: {
    alias: 'Mining Camp',
    semanticRole: 'general-surface-extraction-camp',
    resources: ['stone', 'iron', 'salt', 'clay'],
    materialRoles: [
      'packed-earth',
      'fieldstone',
      'rough-timber',
      'weathered-boards',
      'split-shingles',
      'linen-canvas',
      'wrought-iron',
    ],
    visibleTriangleFloor: 1_750,
    atlasIdentityCeiling: 14,
    specialtyMaterialCeiling: 1,
    runtimeBoundaries: ['CivilianToolStockpile', 'MiningCampSurfaceStockpiles'],
    stockpiles: [
      { container: 'StoneQuarryStockpile', segment: 'StoneQuarryStockSegment', segmentCount: 3 },
      { container: 'MiningPitIronStockpile', segment: 'MiningPitIronSegment', segmentCount: 3 },
      { container: 'MiningPitSaltStockpile', segment: 'MiningPitSaltSegment', segmentCount: 3 },
      { container: 'MiningPitClayStockpile', segment: 'MiningPitClaySegment', segmentCount: 3 },
      { container: 'CivilianToolStockpile', segment: 'CivilianToolSegment', segmentCount: 4 },
    ],
    semanticGroups: [
      {
        name: 'Mining camp sorting-canopy weather frame',
        roles: ['fieldstone', 'rough-timber', 'linen-canvas'],
      },
    ],
    requiredNames: [
      'MiningCampDayShelter',
      'MiningCampSortingCanopy',
      'Mining camp sorting awning',
    ],
  },
  large_quarry: {
    alias: 'Quarry',
    semanticRole: 'rich-stone-quarry',
    resources: [],
    materialRoles: [
      'packed-earth',
      'fieldstone',
      'rough-timber',
      'weathered-boards',
      'split-shingles',
      'wrought-iron',
    ],
    visibleTriangleFloor: 1_750,
    atlasIdentityCeiling: 9,
    specialtyMaterialCeiling: 0,
    runtimeBoundaries: [
      'CivilianToolStockpile',
      'LargeQuarryStockpile',
      'LargeQuarrySupportStockpile',
    ],
    stockpiles: [
      { container: 'LargeQuarryStockpile', segment: 'LargeQuarryStockSegment', segmentCount: 4 },
      { container: 'LargeQuarrySupportStockpile', segment: 'LargeQuarrySupportSegment', segmentCount: 6 },
      { container: 'CivilianToolStockpile', segment: 'CivilianToolSegment', segmentCount: 4 },
    ],
    semanticGroups: [
      { name: 'Quarry crane grounded bracing', roles: ['fieldstone', 'rough-timber'] },
      { name: 'Quarry access guard frame', roles: ['rough-timber'] },
    ],
    requiredNames: [
      'Rich stone quarry stepped cut',
      'Quarry stone lifting crane',
      'Quarry cutters shelter',
    ],
  },
  mine: {
    alias: 'Mineworks',
    semanticRole: 'rich-mineral-mineworks',
    resources: ['iron', 'salt', 'clay'],
    materialRoles: [
      'packed-earth',
      'fieldstone',
      'rough-timber',
      'weathered-boards',
      'split-shingles',
      'wrought-iron',
    ],
    visibleTriangleFloor: 2_150,
    atlasIdentityCeiling: 12,
    specialtyMaterialCeiling: 0,
    runtimeBoundaries: [
      'CivilianToolStockpile',
      'ClayMineStockpile',
      'IronMineStockpile',
      'MineSupportStockpile',
      'SaltMineStockpile',
    ],
    stockpiles: [
      { container: 'IronMineStockpile', segment: 'IronMineOreSegment', segmentCount: 6 },
      { container: 'SaltMineStockpile', segment: 'SaltMineSaltSegment', segmentCount: 6 },
      { container: 'ClayMineStockpile', segment: 'ClayMineClaySegment', segmentCount: 6 },
      { container: 'MineSupportStockpile', segment: 'MineSupportTimberSegment', segmentCount: 4 },
      { container: 'CivilianToolStockpile', segment: 'CivilianToolSegment', segmentCount: 4 },
    ],
    semanticGroups: [
      { name: 'Mineworks headframe transverse cross bracing', roles: ['rough-timber'] },
      { name: 'Mineworks headframe weather roof', roles: ['split-shingles'] },
      { name: 'Mineworks sorting-floor weather frame', roles: ['rough-timber'] },
    ],
    requiredNames: [
      'Mineworks shaft collar',
      'Mineworks winding headframe',
      'Mineworks sorting-floor split-shingle weather roof',
    ],
  },
} as const satisfies Record<ExtractionKind, ExtractionContract>;

const LOCKED_PLACEMENT_BOUNDS = {
  stone_quarry: { minX: -9.28, maxX: 9.14, minZ: -8.32, maxZ: 8.31 },
  large_quarry: { minX: -11.92, maxX: 11.56, minZ: -11.88, maxZ: 11.37 },
  mine: { minX: -11.92, maxX: 11.56, minZ: -11.88, maxZ: 11.32 },
} as const;

const LIVING_VEGETATION_PATTERN = /\b(?:tree|sapling|bush|shrub|vine|foliage|grass|crop|flower|herb|moss|plant)\b/i;

assert.equal(
  Object.hasOwn(PROCEDURAL_BUILDING_CATALOG, 'clay_pit'),
  false,
  'Surface clay must remain a Mining Camp resource; no standalone clay-pit building may enter the catalog.',
);

for (const kind of Object.keys(CONTRACTS) as ExtractionKind[]) {
  const contract = CONTRACTS[kind];
  const root = createBuildingMesh(kind);
  const plan = root.userData.proceduralBuildingPlan as {
    readonly family: string;
    readonly materials: readonly ProceduralMaterialRole[];
    readonly triangleTarget: number;
    readonly triangleCeiling: number;
    readonly drawCallTarget: number;
  };
  const metrics = root.userData.proceduralArchitectureMetrics as {
    readonly measurementKind: string;
    readonly sourceMeshes: number;
    readonly visibleMeshes: number;
    readonly sourceTriangles: number;
    readonly visibleTriangles: number;
    readonly sourceDrawCalls: number;
    readonly visibleDrawCalls: number;
    readonly distinctMaterials: number;
    readonly atlasBackedMaterials: number;
    readonly specialtyMaterials: number;
    readonly finiteGeometry: boolean;
    readonly withinVisibleTriangleCeiling: boolean;
  };
  const compiler = root.userData.proceduralArchitectureCompiler as {
    readonly runtimeOwnedBoundaries: number;
  };

  assert.equal(root.name, contract.alias, `${kind} runtime alias changed.`);
  assert.equal(root.userData.semanticRole, contract.semanticRole, `${kind} semantic role changed.`);
  assert.deepEqual(root.userData.extractionResources ?? [], contract.resources, `${kind} resource aliases changed.`);
  assert.equal(root.userData.architectureEra, 'circa-1550', `${kind} lost its historical era contract.`);
  assert.equal(root.userData.architectureRegion, 'Gorski Kotar and Croatian Littoral');
  assert.equal(root.userData.livingVegetationOwner, 'SeedThree');
  assert.equal(plan.family, 'extraction');
  assert.deepEqual(plan.materials, contract.materialRoles, `${kind} material-role grammar changed.`);
  assert.deepEqual(BUILDING_LOCAL_VISUAL_BOUNDS[kind], LOCKED_PLACEMENT_BOUNDS[kind]);
  if (kind === 'stone_quarry') {
    const campPlan = root.userData.architecturePlan as {
      readonly centeredExcavationCount: number;
    };
    assert.equal(campPlan.centeredExcavationCount, 0);
    const forbiddenCenteredWorks: string[] = [];
    root.traverseVisible((object) => {
      if (/\b(?:shaft|derrick|headframe|windlass|central pit|centered excavation)\b/i.test(object.name)) {
        forbiddenCenteredWorks.push(object.name);
      }
    });
    assert.deepEqual(
      forbiddenCenteredWorks,
      [],
      'The mobile Mining Camp must not acquire a centered pit or underground hoist vocabulary.',
    );
  }

  assert.equal(metrics.measurementKind, 'scene-graph-estimates-not-renderer-counters');
  assert.equal(metrics.finiteGeometry, true, `${kind} reports non-finite geometry.`);
  assert.equal(metrics.withinVisibleTriangleCeiling, true, `${kind} reports a visible triangle overrun.`);
  assert.ok(
    metrics.visibleTriangles >= contract.visibleTriangleFloor,
    `${kind} lost its authored extraction structure (${metrics.visibleTriangles} visible triangles).`,
  );
  assert.ok(
    metrics.visibleTriangles <= plan.triangleCeiling,
    `${kind} exceeds ${plan.triangleCeiling.toLocaleString('en-US')} visible triangles.`,
  );
  assert.ok(metrics.sourceTriangles >= metrics.visibleTriangles);
  assert.ok(metrics.sourceMeshes >= metrics.visibleMeshes);
  assert.ok(metrics.sourceDrawCalls >= metrics.visibleDrawCalls);
  assert.ok(
    metrics.atlasBackedMaterials <= contract.atlasIdentityCeiling,
    `${kind} proliferated shared-atlas identities (${metrics.atlasBackedMaterials}).`,
  );
  assert.ok(metrics.specialtyMaterials <= contract.specialtyMaterialCeiling);
  assert.equal(metrics.distinctMaterials, metrics.atlasBackedMaterials + metrics.specialtyMaterials);

  const dynamicBoundaries: string[] = [];
  let semanticUvMeshCount = 0;
  root.traverse((object) => {
    if (isProceduralRuntimeOwned(object)) dynamicBoundaries.push(object.name);
    assert.equal(
      LIVING_VEGETATION_PATTERN.test(object.name),
      false,
      `${kind}/${object.name} embeds living vegetation in the architecture root.`,
    );
    const mesh = object as THREE.Mesh<THREE.BufferGeometry, THREE.Material | THREE.Material[]>;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    assert.equal(materials.length, 1, `${kind}/${object.name} uses a material array.`);
    const material = materials[0]!;
    assert.equal(
      material.userData.sharedBuildingMaterial,
      true,
      `${kind}/${object.name} does not reuse a shared building material.`,
    );
    assert.equal(
      LIVING_VEGETATION_PATTERN.test(material.name),
      false,
      `${kind}/${object.name} embeds living vegetation in the architecture root.`,
    );
    auditFiniteGeometry(kind, mesh);

    if (mesh.userData.proceduralPhysicalUv !== true) return;
    semanticUvMeshCount += 1;
    const role = mesh.userData.proceduralMaterialRole as ProceduralMaterialRole;
    assert.ok(contract.materialRoles.includes(role), `${kind} emits undeclared semantic material role ${role}.`);
    const allowedTiles = PROCEDURAL_MATERIAL_ROLE_REGISTRY[role].atlasTiles as readonly string[];
    const atlasTile = material.userData.buildingMaterialAtlasTile;
    assert.ok(
      typeof atlasTile === 'string' && allowedTiles.includes(atlasTile),
      `${kind}/${object.name} maps ${role} to invalid atlas tile ${String(atlasTile)}.`,
    );
    assert.equal(mesh.geometry.userData.proceduralGeometryWriter, 'semantic-physical-uv-v1');
    assert.equal(mesh.geometry.userData.proceduralMaterialRole, role);
    assert.ok(mesh.geometry.userData.proceduralPhysicalUv);
  });

  assert.ok(semanticUvMeshCount >= 3, `${kind} needs at least three semantic physical-UV material slots.`);
  dynamicBoundaries.sort();
  assert.deepEqual(dynamicBoundaries, contract.runtimeBoundaries, `${kind} runtime-owned boundaries changed.`);
  assert.equal(compiler.runtimeOwnedBoundaries, contract.runtimeBoundaries.length);

  for (const stockpile of contract.stockpiles) assertStockpile(root, kind, stockpile);
  for (const groupContract of contract.semanticGroups) {
    const group = root.getObjectByName(groupContract.name);
    assert.ok(group, `${kind} is missing ${groupContract.name}.`);
    const roles = semanticRolesUnder(group);
    assert.deepEqual(roles, [...groupContract.roles].sort(), `${kind}/${groupContract.name} material slots changed.`);
    const moduleBounds = new THREE.Box3().setFromObject(group);
    const placementBounds = LOCKED_PLACEMENT_BOUNDS[kind];
    assert.ok(
      moduleBounds.min.x >= placementBounds.minX - 1e-4
        && moduleBounds.max.x <= placementBounds.maxX + 1e-4
        && moduleBounds.min.z >= placementBounds.minZ - 1e-4
        && moduleBounds.max.z <= placementBounds.maxZ + 1e-4,
      `${kind}/${groupContract.name} escapes the locked placement bounds.`,
    );
  }
  for (const requiredName of contract.requiredNames) {
    assert.ok(root.getObjectByName(requiredName), `${kind} is missing ${requiredName}.`);
  }

  console.log([
    kind,
    `${metrics.visibleTriangles.toLocaleString('en-US')} visible tris`,
    `${metrics.sourceTriangles.toLocaleString('en-US')} source tris`,
    `${metrics.visibleMeshes}/${metrics.sourceMeshes} visible/source meshes`,
    `${metrics.atlasBackedMaterials} atlas identities`,
    `${semanticUvMeshCount} semantic UV slots`,
    `${compiler.runtimeOwnedBoundaries} runtime boundaries`,
    `budget ${plan.triangleTarget.toLocaleString('en-US')}/${plan.triangleCeiling.toLocaleString('en-US')} tris · ${plan.drawCallTarget} post-batch draws target`,
  ].join(' · '));
}

console.log('Extraction architecture regression passed.');

function assertStockpile(
  root: THREE.Group,
  kind: ExtractionKind,
  contract: StockpileContract,
): void {
  const matches: THREE.Object3D[] = [];
  root.traverse((object) => {
    if (object.name === contract.container) matches.push(object);
  });
  assert.equal(matches.length, 1, `${kind} must expose exactly one ${contract.container}.`);
  const container = matches[0]!;
  assert.equal(container.visible, false, `${kind}/${contract.container} must start hidden.`);
  const segments = container.children.filter((child) => child.name === contract.segment);
  assert.equal(
    segments.length,
    contract.segmentCount,
    `${kind}/${contract.container} must retain ${contract.segmentCount} ${contract.segment} anchors.`,
  );
  if (contract.container !== 'CivilianToolStockpile') {
    assert.ok(segments.every((segment) => segment.visible === false));
  }
}

function semanticRolesUnder(object: THREE.Object3D): ProceduralMaterialRole[] {
  const roles = new Set<ProceduralMaterialRole>();
  object.traverse((child) => {
    if (child.userData.proceduralPhysicalUv !== true) return;
    roles.add(child.userData.proceduralMaterialRole as ProceduralMaterialRole);
  });
  return [...roles].sort();
}

function auditFiniteGeometry(
  kind: ExtractionKind,
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.Material | THREE.Material[]>,
): void {
  const position = mesh.geometry.getAttribute('position');
  assert.ok(position && position.count >= 3, `${kind}/${mesh.name} has empty geometry.`);
  const elementCount = mesh.geometry.index?.count ?? position.count;
  assert.equal(elementCount % 3, 0, `${kind}/${mesh.name} is not triangle-addressable.`);
  for (const attributeName of ['position', 'normal', 'uv'] as const) {
    const attribute = mesh.geometry.getAttribute(attributeName);
    if (!attribute) continue;
    for (let index = 0; index < attribute.count; index += 1) {
      for (let component = 0; component < attribute.itemSize; component += 1) {
        assert.ok(
          Number.isFinite(attribute.getComponent(index, component)),
          `${kind}/${mesh.name} has a non-finite ${attributeName} component.`,
        );
      }
    }
  }
}
