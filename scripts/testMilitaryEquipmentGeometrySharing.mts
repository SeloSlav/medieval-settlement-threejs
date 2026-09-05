import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  createMilitaryEquipmentSources,
  disposeMilitaryEquipmentSource,
  type MilitaryEquipmentSource,
} from '../src/settlement/militaryEquipment.ts';

const sources = createMilitaryEquipmentSources();

assertSameRenderableIdentity(
  sources.spear.scene,
  sources['spear-shield'].scene,
  'the same spear used with and without a shield',
);
assertSameRenderableIdentity(
  sources.sidearm.scene,
  sources['sidearm-shield'].scene,
  'the same field sword used with and without a shield',
);
assertSameRenderableIdentity(
  sources.crossbow.scene,
  sources.crossbow.secondaryMounts[1]!.scene,
  'held and stowed crossbow',
);
assertSameRenderableIdentity(
  sources.bow.scene,
  sources.bow.secondaryMounts[1]!.scene,
  'held and stowed bow',
);
assertSameRenderableIdentity(
  sources.crossbow.secondaryMounts[2]!.scene,
  sources.bow.secondaryMounts[2]!.scene,
  'ranged fallback dagger',
);
assertSameRenderableIdentity(
  sources.crossbow.secondaryMounts[3]!.scene,
  sources.bow.secondaryMounts[3]!.scene,
  'ranged fallback dagger scabbard',
);

const defaultVisibleBatchKeys = new Set<string>();
for (const source of Object.values(sources)) {
  const stance = source.kind === 'bow' || source.kind === 'crossbow'
    ? 'ranged'
    : 'melee';
  if (roleVisible(source.primaryCombatRole, stance)) {
    addMeshBatchKeys(defaultVisibleBatchKeys, source.scene);
  }
  for (const mount of source.secondaryMounts) {
    if (roleVisible(mount.combatRole, stance)) {
      addMeshBatchKeys(defaultVisibleBatchKeys, mount.scene);
    }
  }
}
assert.equal(
  defaultVisibleBatchKeys.size,
  70,
  'the rebuilt default equipment catalog must collapse exact shared parts to 70 mesh draws',
);

for (const source of Object.values(sources)) disposeMilitaryEquipmentSource(source);

console.log(
  'Military equipment exact geometry sharing passed '
  + '(70 identity batches; no visual substitutions).',
);

function assertSameRenderableIdentity(
  left: THREE.Object3D,
  right: THREE.Object3D,
  label: string,
): void {
  const leftParts = renderableParts(left);
  const rightParts = renderableParts(right);
  assert.equal(leftParts.length, rightParts.length, `${label} renderable count`);
  for (let index = 0; index < leftParts.length; index += 1) {
    const leftPart = leftParts[index]!;
    const rightPart = rightParts[index]!;
    assert.equal(leftPart.geometry, rightPart.geometry, `${label} geometry ${index}`);
    assert.equal(leftPart.material, rightPart.material, `${label} material ${index}`);
    assert.deepEqual(leftPart.matrix, rightPart.matrix, `${label} local matrix ${index}`);
  }
}

function renderableParts(root: THREE.Object3D): Array<{
  geometry: THREE.BufferGeometry;
  material: THREE.Material | THREE.Material[];
  matrix: readonly number[];
}> {
  root.updateMatrixWorld(true);
  const parts: Array<{
    geometry: THREE.BufferGeometry;
    material: THREE.Material | THREE.Material[];
    matrix: readonly number[];
  }> = [];
  root.traverse((object) => {
    const renderable = object as THREE.Mesh | THREE.Line;
    if (!(renderable as THREE.Mesh).isMesh && !(renderable as THREE.Line).isLine) return;
    parts.push({
      geometry: renderable.geometry,
      material: renderable.material,
      matrix: renderable.matrixWorld.toArray(),
    });
  });
  return parts;
}

function roleVisible(role: string, stance: 'melee' | 'ranged'): boolean {
  return role === 'always'
    || (role === 'melee-held' && stance === 'melee')
    || (role === 'melee-stowed' && stance === 'ranged')
    || (role === 'ranged-held' && stance === 'ranged')
    || (role === 'ranged-stowed' && stance === 'melee');
}

function addMeshBatchKeys(target: Set<string>, root: THREE.Object3D): void {
  root.traverseVisible((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const material = Array.isArray(mesh.material)
      ? mesh.material.map((entry) => entry.uuid).join(',')
      : mesh.material.uuid;
    target.add([
      mesh.geometry.uuid,
      material,
      mesh.castShadow ? 1 : 0,
      mesh.receiveShadow ? 1 : 0,
      mesh.renderOrder,
      mesh.layers.mask,
    ].join('|'));
  });
}
