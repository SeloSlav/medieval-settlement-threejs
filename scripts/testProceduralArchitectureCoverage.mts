import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createBuildingMesh } from '../src/buildings/BuildingMeshes.ts';
import {
  FISHING_FOOD_VISUAL_SEGMENTS,
  HUNTERS_FOOD_VISUAL_SEGMENTS,
} from '../src/buildings/foodStockpileVisuals.ts';
import {
  PROCEDURAL_ARCHITECTURE_VERSION,
  PROCEDURAL_BUILDING_CATALOG,
  type ProceduralBuildingPlan,
} from '../src/buildings/proceduralArchitecture/catalog.ts';
import { proceduralVisualRequestKey } from '../src/buildings/proceduralArchitecture/visualRequest.ts';
import { BUILDING_KINDS, type BuildingKind } from '../src/generated/gameBalance.ts';
import { createResidenceMesh } from '../src/residences/ResidenceMarkers.ts';

const PROCEDURAL_SOURCE = 'threejs-procedural';
const VISUAL_SEED = 1550;
const DEFAULT_BUILDING_SOURCE_TRIANGLE_CEILING = 5_000;
const BUILDING_SOURCE_TRIANGLE_CEILINGS: Partial<Record<BuildingKind, number>> = {
  // Multi-structure sites and mutually exclusive stock/display banks keep
  // explicit source-memory ceilings even though not every triangle is drawn.
  founders_camp: 18_000,
  marketplace: 14_500,
  mine: 7_000,
  monastery: 16_000,
};
const AUTHORED_GLB_METADATA_KEYS = [
  'authoredGlbAsset',
  'authoredGlbVersion',
  'authoredGlbUrl',
] as const;

type GeometryAudit = {
  meshes: number;
  triangles: number;
  vertices: number;
};

type ProceduralMetrics = {
  finiteGeometry?: boolean;
  sourceMeshes?: number;
  sourceTriangles?: number;
  sourceVertices?: number;
};

const failures: string[] = [];
let auditedMeshes = 0;
let auditedTriangles = 0;

function check(label: string, test: () => void): void {
  try {
    test();
  } catch (error) {
    failures.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function assertFiniteArray(values: ArrayLike<number>, label: string): void {
  for (let index = 0; index < values.length; index += 1) {
    assert.ok(Number.isFinite(Number(values[index])), `${label}[${index}] must be finite`);
  }
}

function attributeStorage(
  attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
): ArrayLike<number> {
  if ((attribute as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute) {
    return (attribute as THREE.InterleavedBufferAttribute).data.array;
  }
  return (attribute as THREE.BufferAttribute).array;
}

function assertFiniteObjectTransform(object: THREE.Object3D, label: string): void {
  assertFiniteArray(object.position.toArray(), `${label}.position`);
  assertFiniteArray(object.quaternion.toArray(), `${label}.quaternion`);
  assertFiniteArray(object.scale.toArray(), `${label}.scale`);
  assertFiniteArray(object.matrix.elements, `${label}.matrix`);
  assertFiniteArray(object.matrixWorld.elements, `${label}.matrixWorld`);
}

function auditFiniteGeometry(root: THREE.Object3D, label: string): GeometryAudit {
  root.updateMatrixWorld(true);
  let meshes = 0;
  let triangles = 0;
  let vertices = 0;

  root.traverse((object) => {
    assertFiniteObjectTransform(object, `${label}/${object.name || object.type}`);
    for (const key of AUTHORED_GLB_METADATA_KEYS) {
      assert.equal(
        Object.prototype.hasOwnProperty.call(object.userData, key),
        false,
        `${label}/${object.name || object.type} must not retain ${key}`,
      );
    }

    const mesh = object as THREE.Mesh<THREE.BufferGeometry>;
    if (!mesh.isMesh) return;
    meshes += 1;
    const geometry = mesh.geometry;
    assert.ok(geometry?.isBufferGeometry, `${label}/${mesh.name || 'Mesh'} needs BufferGeometry`);
    const position = geometry.getAttribute('position');
    assert.ok(position, `${label}/${mesh.name || 'Mesh'} needs a position attribute`);
    assert.ok(position.count > 0, `${label}/${mesh.name || 'Mesh'} needs at least one vertex`);

    for (const [attributeName, attribute] of Object.entries(geometry.attributes)) {
      assert.ok(attribute.count > 0, `${label}/${mesh.name || 'Mesh'}.${attributeName} is empty`);
      assertFiniteArray(
        attributeStorage(attribute),
        `${label}/${mesh.name || 'Mesh'}.${attributeName}`,
      );
    }
    for (const [attributeName, attributes] of Object.entries(geometry.morphAttributes)) {
      for (const [morphIndex, attribute] of attributes.entries()) {
        assertFiniteArray(
          attributeStorage(attribute),
          `${label}/${mesh.name || 'Mesh'}.morph.${attributeName}[${morphIndex}]`,
        );
      }
    }

    if (geometry.index) {
      for (let index = 0; index < geometry.index.count; index += 1) {
        const vertexIndex = geometry.index.getX(index);
        assert.ok(Number.isInteger(vertexIndex), `${label}/${mesh.name || 'Mesh'} index ${index} must be integral`);
        assert.ok(
          vertexIndex >= 0 && vertexIndex < position.count,
          `${label}/${mesh.name || 'Mesh'} index ${index} (${vertexIndex}) is outside 0..${position.count - 1}`,
        );
      }
    }

    const elementCount = geometry.index?.count ?? position.count;
    assert.equal(
      elementCount % 3,
      0,
      `${label}/${mesh.name || 'Mesh'} triangle element count must be divisible by three`,
    );
    assert.ok(elementCount >= 3, `${label}/${mesh.name || 'Mesh'} must contain a triangle`);
    vertices += position.count;
    const instanceCount = (mesh as THREE.InstancedMesh).isInstancedMesh
      ? Math.max(0, Math.floor((mesh as THREE.InstancedMesh).count))
      : 1;
    if ((mesh as THREE.InstancedMesh).isInstancedMesh) {
      const instancedMesh = mesh as THREE.InstancedMesh;
      assertFiniteArray(
        instancedMesh.instanceMatrix.array,
        `${label}/${mesh.name || 'InstancedMesh'}.instanceMatrix`,
      );
    }
    triangles += elementCount / 3 * instanceCount;
  });

  assert.ok(meshes > 0, `${label} must contain at least one mesh`);
  assert.ok(triangles > 0 && Number.isFinite(triangles), `${label} must contain finite triangles`);
  return { meshes, triangles, vertices };
}

function visibleTriangleCount(root: THREE.Object3D): number {
  let triangles = 0;
  root.traverse((object) => {
    const mesh = object as THREE.Mesh<THREE.BufferGeometry>;
    if (!mesh.isMesh) return;
    let current: THREE.Object3D | null = object;
    while (current) {
      if (!current.visible) return;
      current = current.parent;
    }
    const elements = mesh.geometry.index?.count
      ?? mesh.geometry.getAttribute('position')?.count
      ?? 0;
    const instances = (mesh as THREE.InstancedMesh).isInstancedMesh
      ? Math.max(0, Math.floor((mesh as THREE.InstancedMesh).count))
      : 1;
    triangles += Math.floor(elements / 3) * instances;
  });
  return triangles;
}

function assertProceduralBuildingMetadata(root: THREE.Group, kind: BuildingKind): void {
  assert.equal(root.userData.proceduralArchitecture, true);
  assert.equal(root.userData.proceduralArchitectureVersion, PROCEDURAL_ARCHITECTURE_VERSION);
  assert.equal(root.userData.proceduralArchitectureSource, PROCEDURAL_SOURCE);

  const plan = root.userData.proceduralBuildingPlan as ProceduralBuildingPlan | undefined;
  assert.ok(plan, `${kind} needs a serialized procedural building plan`);
  assert.equal(plan.kind, kind);
  assert.equal(plan.version, PROCEDURAL_ARCHITECTURE_VERSION);
  assert.equal(plan.source, PROCEDURAL_SOURCE);
  assert.equal(plan.seed, VISUAL_SEED);
  assert.deepEqual(
    {
      family: plan.family,
      status: plan.status,
      roof: plan.roof,
      massing: plan.massing,
      modules: plan.modules,
      materials: plan.materials,
      dynamicSlots: plan.dynamicSlots,
    },
    {
      family: PROCEDURAL_BUILDING_CATALOG[kind].family,
      status: PROCEDURAL_BUILDING_CATALOG[kind].status,
      roof: PROCEDURAL_BUILDING_CATALOG[kind].roof,
      massing: PROCEDURAL_BUILDING_CATALOG[kind].massing,
      modules: PROCEDURAL_BUILDING_CATALOG[kind].modules,
      materials: PROCEDURAL_BUILDING_CATALOG[kind].materials,
      dynamicSlots: PROCEDURAL_BUILDING_CATALOG[kind].dynamicSlots,
    },
    `${kind} plan must retain its canonical catalog contract`,
  );

  const metrics = root.userData.proceduralArchitectureMetrics as ProceduralMetrics | undefined;
  assert.ok(metrics, `${kind} needs procedural geometry metrics`);
  assert.equal(metrics.finiteGeometry, true);
  assert.ok(Number(metrics.sourceMeshes) > 0 && Number.isFinite(metrics.sourceMeshes));
  assert.ok(Number(metrics.sourceTriangles) > 0 && Number.isFinite(metrics.sourceTriangles));
  assert.ok(Number(metrics.sourceVertices) > 0 && Number.isFinite(metrics.sourceVertices));
  const triangleCeiling = BUILDING_SOURCE_TRIANGLE_CEILINGS[kind]
    ?? DEFAULT_BUILDING_SOURCE_TRIANGLE_CEILING;
  assert.ok(
    Number(metrics.sourceTriangles) <= triangleCeiling,
    `${kind} exceeds its reviewed ${triangleCeiling.toLocaleString('en-US')}-triangle source ceiling (${Number(metrics.sourceTriangles).toLocaleString('en-US')})`,
  );
}

function objectsNamed(root: THREE.Object3D, name: string): THREE.Object3D[] {
  const matches: THREE.Object3D[] = [];
  root.traverse((object) => {
    if (object.name === name) matches.push(object);
  });
  return matches;
}

check('canonical catalog parity', () => {
  const canonicalKinds = [...BUILDING_KINDS];
  const catalogKinds = Object.keys(PROCEDURAL_BUILDING_CATALOG);
  assert.equal(new Set(canonicalKinds).size, canonicalKinds.length, 'BUILDING_KINDS must not contain duplicates');
  assert.deepEqual(
    [...catalogKinds].sort(),
    [...canonicalKinds].sort(),
    'procedural catalog keys must exactly equal BUILDING_KINDS',
  );
  assert.equal(canonicalKinds.includes('clay_pit' as BuildingKind), false, 'clay_pit must stay removed');
  assert.equal(
    Object.prototype.hasOwnProperty.call(PROCEDURAL_BUILDING_CATALOG, 'clay_pit'),
    false,
    'procedural catalog must not restore legacy clay_pit',
  );
});

for (const kind of BUILDING_KINDS) {
  check(`canonical building ${kind}`, () => {
    const building = createBuildingMesh(kind);
    const audit = auditFiniteGeometry(building, kind);
    assertProceduralBuildingMetadata(building, kind);
    auditedMeshes += audit.meshes;
    auditedTriangles += audit.triangles;
  });
}

const churchRequestKeys = new Set<string>();
for (const tier of [1, 2, 3] as const) {
  check(`church tier ${tier}`, () => {
    const church = createBuildingMesh('chapel', tier);
    const audit = auditFiniteGeometry(church, `chapel tier ${tier}`);
    assertProceduralBuildingMetadata(church, 'chapel');
    const requestKey = proceduralVisualRequestKey({
      type: 'church',
      kind: 'chapel',
      tier,
      seed: VISUAL_SEED,
    });
    churchRequestKeys.add(requestKey);
    assert.equal(
      church.userData.proceduralVisualRequestKey,
      requestKey,
      `chapel tier ${tier} must expose its canonical visual request key`,
    );
    assert.equal(
      (church.userData.proceduralBuildingPlan as ProceduralBuildingPlan).developmentTier,
      tier,
      `chapel tier ${tier} must retain its development tier`,
    );
    assert.equal(objectsNamed(church, 'ChapelCofferChest').length, 1, 'church needs one runtime coffer');
    auditedMeshes += audit.meshes;
    auditedTriangles += audit.triangles;
  });
}
check('church request identity', () => {
  assert.equal(churchRequestKeys.size, 3, 'church tiers need three distinct request identities');
});

const residenceRequestKeys = new Set<string>();
for (const tier of [1, 2, 3, 4] as const) {
  check(`residence tier ${tier}`, () => {
    const residence = createResidenceMesh(VISUAL_SEED, tier);
    const audit = auditFiniteGeometry(residence, `residence tier ${tier}`);
    const requestKey = proceduralVisualRequestKey({ type: 'residence', tier, seed: VISUAL_SEED });
    assert.equal(residence.userData.proceduralArchitecture, true);
    assert.equal(residence.userData.proceduralArchitectureVersion, PROCEDURAL_ARCHITECTURE_VERSION);
    assert.equal(residence.userData.proceduralArchitectureSource, PROCEDURAL_SOURCE);
    assert.equal(residence.userData.proceduralVisualRequestKey, requestKey);
    assert.equal(residence.userData.residenceTier, tier);
    assert.equal(residence.userData.residenceVisualSeed, VISUAL_SEED);
    const plan = residence.userData.residenceBuildingPlan as { tier?: number; seed?: number } | undefined;
    assert.equal(plan?.tier, tier);
    assert.equal(plan.seed, VISUAL_SEED);
    const visibleTriangles = visibleTriangleCount(residence);
    assert.ok(
      visibleTriangles <= 4_000,
      `residence tier ${tier} exceeds the 4,000-triangle active budget (${visibleTriangles})`,
    );
    residenceRequestKeys.add(requestKey);
    auditedMeshes += audit.meshes;
    auditedTriangles += audit.triangles;
  });
}
check('residence request identity', () => {
  assert.equal(residenceRequestKeys.size, 4, 'residence tiers need four distinct request identities');
});

const semanticContracts = [
  ['hunters_hall', 'HunterCampfire', THREE.Group, 1],
  ['hunters_hall', 'HuntersFoodStockpile', THREE.Group, 1],
  ['hunters_hall', 'HuntersFoodSegment', THREE.Group, HUNTERS_FOOD_VISUAL_SEGMENTS],
  ['fishing_camp', 'FishingFoodStockpile', THREE.Group, 1],
  ['fishing_camp', 'FishingFoodSegment', THREE.Group, FISHING_FOOD_VISUAL_SEGMENTS],
  ['fishing_camp', 'FishingServiceShedSmoke', THREE.Object3D, 1],
  ['chapel', 'ChapelCofferChest', THREE.Group, 1],
  ['watermill', 'Watermill wheel', THREE.Group, 1],
  ['windmill', 'Windmill sails', THREE.Group, 1],
] as const satisfies readonly [BuildingKind, string, typeof THREE.Object3D, number][];

const semanticModels = new Map<BuildingKind, THREE.Group>();
for (const [kind, objectName, Constructor, expectedCount] of semanticContracts) {
  check(`${kind} semantic name ${objectName}`, () => {
    let model = semanticModels.get(kind);
    if (!model) {
      model = createBuildingMesh(kind);
      semanticModels.set(kind, model);
    }
    const matches = objectsNamed(model, objectName);
    assert.equal(matches.length, expectedCount, `${kind} needs ${expectedCount} object(s) named ${objectName}`);
    assert.ok(matches[0] instanceof Constructor, `${kind}/${objectName} must retain its runtime object type`);
  });
}

if (failures.length > 0) {
  throw new Error(
    `Procedural architecture coverage failed (${failures.length}):\n${failures
      .map((failure, index) => `${index + 1}. ${failure}`)
      .join('\n')}`,
  );
}

console.log(
  `Procedural architecture coverage passed: ${BUILDING_KINDS.length} canonical buildings, `
    + `3 church tiers, 4 residence tiers, ${auditedMeshes} meshes, ${auditedTriangles} triangles audited.`,
);
