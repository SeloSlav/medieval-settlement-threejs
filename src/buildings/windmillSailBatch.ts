import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

type SailSource = THREE.Mesh<THREE.BufferGeometry, THREE.Material>;

/**
 * Compiles one rotating sail assembly into a few material draws. The authored
 * sails remain the transform owner; original leaves stay attached but hidden,
 * so normal building disposal continues to own their borrowed resources.
 */
export function batchWindmillSails(sails: THREE.Group): number {
  if (sails.userData.windmillSailBatch === true) return sails.userData.windmillSailBatchDraws as number;
  sails.updateWorldMatrix(true, true);
  const inverseSails = sails.matrixWorld.clone().invert();
  const buckets = new Map<string, SailSource[]>();
  sails.traverse(object => {
    const mesh = object as SailSource;
    if (!mesh.isMesh || !isBatchableSailMesh(mesh)) return;
    const key = [mesh.material.uuid, mesh.castShadow, mesh.receiveShadow, mesh.layers.mask,
      mesh.renderOrder, mesh.frustumCulled, mesh.geometry.index ? 1 : 0,
      ...Object.keys(mesh.geometry.attributes).sort().map(name => {
        const attribute = mesh.geometry.getAttribute(name);
        return `${name}:${attribute.itemSize}:${attribute.normalized}:${attribute.array.constructor.name}`;
      }),
    ].join('|');
    const bucket = buckets.get(key) ?? [];
    bucket.push(mesh); buckets.set(key, bucket);
  });
  const batchRoot = new THREE.Group();
  batchRoot.name = 'Windmill batched rotating sails';
  batchRoot.userData.windmillSailBatch = true;
  let draw = 0;
  for (const sources of buckets.values()) {
    const first = sources[0]!;
    const copies = sources.map(source => source.geometry.clone().applyMatrix4(
      new THREE.Matrix4().multiplyMatrices(inverseSails, source.matrixWorld),
    ));
    const geometry = copies.length === 1 ? copies[0]! : mergeGeometries(copies, false);
    if (copies.length > 1) for (const copy of copies) copy.dispose();
    if (!geometry) throw new Error('Windmill sail geometry attributes must be compatible.');
    geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, first.material);
    mesh.name = `Windmill batched sail material ${draw + 1}`;
    mesh.castShadow = first.castShadow;
    mesh.receiveShadow = first.receiveShadow;
    mesh.layers.mask = first.layers.mask;
    mesh.renderOrder = first.renderOrder;
    mesh.frustumCulled = first.frustumCulled;
    batchRoot.add(mesh); draw += 1;
    for (const source of sources) source.visible = false;
  }
  sails.add(batchRoot);
  sails.userData.windmillSailBatch = true;
  sails.userData.windmillSailBatchDraws = draw;
  return draw;
}

function isBatchableSailMesh(mesh: SailSource): boolean {
  return !mesh.userData.windmillSailBatch
    && !Array.isArray(mesh.material)
    && mesh.geometry.getAttribute('position') !== undefined
    && Object.keys(mesh.geometry.morphAttributes).length === 0
    && mesh.onBeforeRender === THREE.Object3D.prototype.onBeforeRender
    && mesh.onAfterRender === THREE.Object3D.prototype.onAfterRender;
}
