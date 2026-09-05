import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  MILITARY_EQUIPMENT_KINDS,
  attachMilitaryEquipment,
  createMilitaryEquipmentSources,
  disposeMilitaryEquipmentSource,
  isMilitaryEquipmentSource,
  militaryEquipmentMountDiagnostics,
  setMilitaryEquipmentCombatStance,
  setMilitaryEquipmentVisible,
  type MilitaryEquipmentKind,
  type MilitaryEquipmentCombatRole,
} from '../src/settlement/militaryEquipment.ts';
import { WORKER_TOOL_URLS } from '../src/settlement/workerTools.ts';

type ExpectedKit = {
  targetLength: number;
  primaryBone: 'R_Hand' | 'L_Hand';
  primaryRole: MilitaryEquipmentCombatRole;
  secondaryBones: readonly ('R_Hand' | 'L_Hand' | 'Spine02' | 'Waist')[];
  secondaryLengths: readonly number[];
  secondaryRoles: readonly MilitaryEquipmentCombatRole[];
};

const EXPECTED_KINDS = [
  'spear',
  'spear-shield',
  'pike-kit',
  'crossbow',
  'sidearm',
  'sidearm-shield',
  'sword-shield',
  'halberd',
  'bow',
] as const satisfies readonly MilitaryEquipmentKind[];

const EXPECTED_KITS: Record<MilitaryEquipmentKind, ExpectedKit> = {
  spear: { targetLength: 2.35, primaryBone: 'R_Hand', primaryRole: 'melee-held', secondaryBones: [], secondaryLengths: [], secondaryRoles: [] },
  'spear-shield': { targetLength: 2.65, primaryBone: 'R_Hand', primaryRole: 'melee-held', secondaryBones: ['L_Hand'], secondaryLengths: [0.56], secondaryRoles: ['always'] },
  'pike-kit': { targetLength: 4.7, primaryBone: 'R_Hand', primaryRole: 'melee-held', secondaryBones: [], secondaryLengths: [], secondaryRoles: [] },
  crossbow: {
    targetLength: 0.95,
    primaryBone: 'R_Hand',
    primaryRole: 'ranged-held',
    secondaryBones: ['Spine02', 'Spine02', 'R_Hand', 'Waist'],
    secondaryLengths: [0.54, 0.95, 0.42, 0.46],
    secondaryRoles: ['always', 'ranged-stowed', 'melee-held', 'melee-stowed'],
  },
  sidearm: { targetLength: 0.82, primaryBone: 'R_Hand', primaryRole: 'melee-held', secondaryBones: [], secondaryLengths: [], secondaryRoles: [] },
  'sidearm-shield': { targetLength: 0.82, primaryBone: 'R_Hand', primaryRole: 'melee-held', secondaryBones: ['L_Hand'], secondaryLengths: [0.34], secondaryRoles: ['always'] },
  'sword-shield': { targetLength: 1.08, primaryBone: 'R_Hand', primaryRole: 'melee-held', secondaryBones: ['L_Hand'], secondaryLengths: [0.62], secondaryRoles: ['always'] },
  halberd: { targetLength: 2.55, primaryBone: 'R_Hand', primaryRole: 'melee-held', secondaryBones: [], secondaryLengths: [], secondaryRoles: [] },
  bow: {
    targetLength: 1.88,
    primaryBone: 'L_Hand',
    primaryRole: 'ranged-held',
    secondaryBones: ['Spine02', 'Spine02', 'R_Hand'],
    secondaryLengths: [0.86, 1.88, 0.42],
    secondaryRoles: ['always', 'ranged-stowed', 'melee-held'],
  },
};

const REQUIRED_CRAFT_DETAILS: Record<MilitaryEquipmentKind, readonly string[]> = {
  spear: ['reinforcing langet', 'central blade ridge', 'socket binding'],
  'spear-shield': ['reinforcing langet', 'convex laminated', 'peened rim rivet'],
  'pike-kit': ['reinforcing langet', 'forged head ridge', 'lower-hand grip binding'],
  crossbow: ['antler rotating nut', 'spring bolt retainer', 'belt-carried cranequin rack'],
  sidearm: ['tapered double-edged blade', 'fitted guard collar', 'peened tang'],
  'sidearm-shield': ['tapered double-edged blade', 'convex laminated', 'boss neck collar'],
  'sword-shield': ['tapered double-edged blade', 'convex laminated', 'rolled and riveted forged rim'],
  halberd: ['front socket langet', 'beveled axe cheek', 'peened head rivet'],
  bow: ['tapered d-section stave', 'upper horn nock', 'leather quiver with lined mouth'],
};

const sorted = <T extends string>(values: readonly T[]): T[] => [...values].sort();

assert.deepEqual(
  sorted(MILITARY_EQUIPMENT_KINDS),
  sorted(EXPECTED_KINDS),
  'the procedural source catalog must include every production military kit exactly once',
);
assert.equal(
  new Set(MILITARY_EQUIPMENT_KINDS).size,
  MILITARY_EQUIPMENT_KINDS.length,
  'military equipment kind identifiers must be unique',
);

for (const kind of EXPECTED_KINDS) {
  assert.equal(
    Object.hasOwn(WORKER_TOOL_URLS, kind),
    true,
    `${kind} must remain addressable through the crowd renderer's unified tool catalog`,
  );
  assert.equal(
    WORKER_TOOL_URLS[kind],
    '',
    `${kind} must be generated locally rather than silently falling back to an external model`,
  );
}

const sources = createMilitaryEquipmentSources();
assert.deepEqual(
  sorted(Object.keys(sources) as MilitaryEquipmentKind[]),
  sorted(EXPECTED_KINDS),
  'the generated source record must have complete one-to-one kind coverage',
);

const sharedMaterialByName = new Map<string, THREE.Material>();
let uniqueSourceTriangles = 0;
let optimizedDrawMeshes = 0;

for (const kind of EXPECTED_KINDS) {
  const source = sources[kind];
  const expected = EXPECTED_KITS[kind];
  assert.equal(source.kind, kind);
  assert.equal(isMilitaryEquipmentSource(source), true);
  assert.equal(source.militaryEquipment, true);
  assert.ok(
    Math.abs(source.targetLength - expected.targetLength) < 1e-9,
    `${kind} must preserve its authored real-world primary length`,
  );
  assert.deepEqual(
    source.secondaryMounts.map((mount) => mount.targetLength),
    expected.secondaryLengths,
    `${kind} must preserve all authored secondary-equipment dimensions`,
  );
  assert.equal(source.secondaryMounts.length, expected.secondaryBones.length);
  validateOptimizedAssembly(`${kind} primary`, source.scene);
  for (const [index, mount] of source.secondaryMounts.entries()) {
    validateOptimizedAssembly(`${kind} secondary ${index + 1}`, mount.scene);
  }
  const craftEvidence = [source.scene, ...source.secondaryMounts.map((mount) => mount.scene)]
    .flatMap((assembly) => assembly.userData.semanticWeaponParts as string[])
    .join('\n')
    .toLowerCase();
  if (kind === 'bow' || kind === 'pike-kit') {
    assert.equal(
      craftEvidence.includes('scabbard'),
      false,
      `${kind} must not carry a sidearm scabbard`,
    );
  }
  for (const detail of REQUIRED_CRAFT_DETAILS[kind]) {
    assert.equal(
      craftEvidence.includes(detail),
      true,
      `${kind} must retain close-inspection construction evidence for ${detail}`,
    );
  }

  const rig = createSemanticTestRig(0.63);
  const tool = attachMilitaryEquipment(rig, source);
  rig.updateWorldMatrix(true, true);
  assert.equal(tool.parent?.name, expected.primaryBone, `${kind} primary equipment must mount to its authored grip hand`);
  assert.equal(tool.userData.workerTool, kind);

  const mounted = tool.userData.workerToolMounts as THREE.Group[] | undefined;
  assert.ok(mounted, `${kind} must expose all of its mounts to renderer visibility control`);
  assert.equal(mounted.length, 1 + expected.secondaryBones.length);
  assert.deepEqual(
    mounted.map((mount) => mount.userData.workerToolCombatRole),
    [expected.primaryRole, ...expected.secondaryRoles],
    `${kind} must expose deterministic held/stowed combat roles`,
  );
  assert.deepEqual(
    mounted.slice(1).map((mount) => mount.parent?.name),
    expected.secondaryBones,
    `${kind} secondary equipment must use the intended semantic rig joints`,
  );

  validateMountedLength(`${kind} primary`, tool, source.sourceLength, expected.targetLength);
  source.secondaryMounts.forEach((mountSource, index) => {
    validateMountedLength(
      `${kind} secondary ${index + 1}`,
      mounted[index + 1]!,
      mountSource.sourceLength,
      expected.secondaryLengths[index]!,
    );
  });

  const diagnostics = militaryEquipmentMountDiagnostics(tool);
  assert.deepEqual(
    diagnostics.map((entry) => entry.bone),
    [expected.primaryBone, ...expected.secondaryBones],
    `${kind} diagnostics must report the actual semantic bone ownership`,
  );
  for (const entry of diagnostics) {
    assert.ok(entry.partCount > 0, `${kind} ${entry.mount} mount must contain optimized render meshes`);
    assert.ok(entry.triangleCount > 0, `${kind} ${entry.mount} mount must contain renderable triangles`);
    assert.ok(entry.triangleCount < 30_000, `${kind} ${entry.mount} exceeds its realtime triangle budget`);
    assert.ok(entry.worldLength > 0.1, `${kind} ${entry.mount} must retain nondegenerate world bounds`);
    assert.ok(entry.semanticParts.length > 0, `${kind} ${entry.mount} must retain semantic part evidence after merging`);
    uniqueSourceTriangles += entry.triangleCount;
    optimizedDrawMeshes += entry.partCount;
  }

  const sourcePrimaryMeshes = collectMeshes(source.scene);
  const mountedPrimaryMeshes = collectMeshes(tool);
  assert.equal(sourcePrimaryMeshes.length, mountedPrimaryMeshes.length);
  for (let index = 0; index < sourcePrimaryMeshes.length; index += 1) {
    assert.equal(
      mountedPrimaryMeshes[index]!.geometry,
      sourcePrimaryMeshes[index]!.geometry,
      `${kind} instances must share immutable source geometry instead of allocating per soldier`,
    );
    assert.equal(
      mountedPrimaryMeshes[index]!.material,
      sourcePrimaryMeshes[index]!.material,
      `${kind} instances must share PBR materials instead of allocating per soldier`,
    );
  }

  setMilitaryEquipmentVisible(tool, false);
  assert.equal(mounted.every((mount) => !mount.visible), true, `${kind} must hide all body-mounted parts together`);
  setMilitaryEquipmentVisible(tool, true);
  for (const stance of ['melee', 'ranged'] as const) {
    setMilitaryEquipmentCombatStance(tool, stance);
    assert.deepEqual(
      mounted.map((mount) => mount.visible),
      mounted.map((mount) => combatRoleVisible(
        mount.userData.workerToolCombatRole as MilitaryEquipmentCombatRole,
        stance,
      )),
      `${kind} ${stance} stance must show only the matching held/stowed representations`,
    );
  }
}

assert.ok(
  optimizedDrawMeshes < 120,
  `all ten complete kits should stay materially batched (got ${optimizedDrawMeshes} source draw meshes)`,
);
assert.ok(
  uniqueSourceTriangles < 160_000,
  `all ten complete kits should remain within the shared source topology budget (got ${uniqueSourceTriangles})`,
);
assert.ok(
  sharedMaterialByName.size <= 10,
  `the full catalog should reuse a compact material library (got ${sharedMaterialByName.size})`,
);

for (const source of Object.values(sources)) disposeMilitaryEquipmentSource(source);

console.log(
  `test:military-equipment passed (${EXPECTED_KINDS.length} kits, `
    + `${optimizedDrawMeshes} optimized meshes, ${uniqueSourceTriangles} source triangles)`,
);

function createSemanticTestRig(scale: number): THREE.Group {
  const root = new THREE.Group();
  root.name = 'Synthetic worker rig';
  root.scale.setScalar(scale);
  for (const name of ['R_Hand', 'L_Hand', 'Spine02', 'Waist']) {
    const bone = new THREE.Bone();
    bone.name = name;
    root.add(bone);
  }
  root.updateWorldMatrix(true, true);
  return root;
}

function validateOptimizedAssembly(label: string, assembly: THREE.Group): void {
  assert.equal(assembly.userData.optimizedByMaterial, true, `${label} must be material-batched`);
  const semanticParts = assembly.userData.semanticWeaponParts as string[] | undefined;
  assert.ok(semanticParts && semanticParts.length > 0, `${label} must retain semantic source-part names`);
  const materialNames = new Set<string>();
  let meshCount = 0;
  assembly.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    meshCount += 1;
    assert.equal(mesh.position.lengthSq(), 0, `${label} mesh transforms must be baked before batching`);
    assert.equal(mesh.scale.distanceTo(new THREE.Vector3(1, 1, 1)) < 1e-9, true);
    assert.equal(mesh.quaternion.angleTo(new THREE.Quaternion()) < 1e-9, true);
    assert.equal(mesh.geometry.index, null, `${label} must use one merge-compatible geometry contract`);
    assert.ok(mesh.geometry.getAttribute('position'), `${label} mesh requires positions`);
    assert.ok(mesh.geometry.getAttribute('normal'), `${label} mesh requires normals`);
    assert.ok(mesh.geometry.getAttribute('uv'), `${label} mesh requires UVs`);
    assert.deepEqual(
      Object.keys(mesh.geometry.attributes).sort(),
      (mesh.material as THREE.MeshStandardMaterial).vertexColors ? ['color', 'normal', 'position', 'uv'] : ['normal', 'position', 'uv'],
      `${label} must strip incidental attributes that prevent stable material merging`,
    );
    const material = mesh.material as THREE.Material;
    assert.equal(Array.isArray(mesh.material), false, `${label} owns one material per optimized draw mesh`);
    assert.equal(materialNames.has(material.name), false, `${label} should have at most one mesh per material role`);
    materialNames.add(material.name);
    const shared = sharedMaterialByName.get(material.name);
    if (shared) assert.equal(material, shared, `${material.name} must be shared across the complete source catalog`);
    else sharedMaterialByName.set(material.name, material);
    assert.equal(
      material instanceof THREE.MeshStandardMaterial,
      true,
      `${label} must retain a lit PBR material rather than a flat-color shortcut`,
    );
    const pbr = material as THREE.MeshStandardMaterial;
    if (pbr.vertexColors) {
      assert.equal(pbr.name, 'Ash arrows · banded goose feathers', 'only tiny ammunition uses baked material colors');
      assert.equal(mesh.geometry.getAttribute('color').count, mesh.geometry.getAttribute('position').count);
    } else {
      assert.ok(pbr.map, `${label} ${material.name} requires an authored albedo response`);
      assert.ok(pbr.roughnessMap, `${label} ${material.name} requires causal roughness microstructure`);
      assert.ok(pbr.normalMap, `${label} ${material.name} requires filtered close-up surface relief`);
      assert.ok(pbr.map.anisotropy >= 4, `${label} ${material.name} must resist grazing-angle texture blur`);
    }
    const position = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let index = 0; index < position.count; index += 1) {
      assert.equal(
        Number.isFinite(position.getX(index))
          && Number.isFinite(position.getY(index))
          && Number.isFinite(position.getZ(index)),
        true,
        `${label} contains a non-finite vertex`,
      );
    }
  });
  assert.ok(meshCount > 0, `${label} must compile to at least one render mesh`);
  assert.equal(meshCount, materialNames.size, `${label} draw meshes must correspond one-to-one with material roles`);
}

function validateMountedLength(
  label: string,
  mounted: THREE.Group,
  sourceLength: number,
  targetLength: number,
): void {
  mounted.updateWorldMatrix(true, true);
  const worldScale = mounted.getWorldScale(new THREE.Vector3());
  const physicalLength = sourceLength * Math.max(
    Math.abs(worldScale.x),
    Math.abs(worldScale.y),
    Math.abs(worldScale.z),
  );
  assert.ok(
    Math.abs(physicalLength - targetLength) < 0.002,
    `${label} must resolve to ${targetLength.toFixed(2)}m after inherited rig scale `
      + `(got ${physicalLength.toFixed(3)}m)`,
  );
  const bounds = new THREE.Box3().setFromObject(mounted);
  const size = bounds.getSize(new THREE.Vector3());
  assert.equal(
    [size.x, size.y, size.z].every((value) => Number.isFinite(value) && value > 0),
    true,
    `${label} must produce finite, nondegenerate attached world bounds`,
  );
}

function collectMeshes(root: THREE.Object3D): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.isMesh) meshes.push(mesh);
  });
  return meshes;
}

function combatRoleVisible(
  role: MilitaryEquipmentCombatRole,
  stance: 'melee' | 'ranged',
): boolean {
  return role === 'always'
    || (role === 'melee-held' && stance === 'melee')
    || (role === 'melee-stowed' && stance === 'ranged')
    || (role === 'ranged-held' && stance === 'ranged')
    || (role === 'ranged-stowed' && stance === 'melee');
}
