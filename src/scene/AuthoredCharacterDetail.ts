import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { MeshoptSimplifier } from 'meshoptimizer/simplifier';

export type CharacterDetail = 0 | 1 | 2;
export type CharacterDetailGeometry = readonly [
  ReadonlyMap<THREE.BufferGeometry, THREE.BufferGeometry>,
  ReadonlyMap<THREE.BufferGeometry, THREE.BufferGeometry>,
];

/** Index-only detail variants. Every original vertex attribute remains borrowed. */
export async function createAuthoredCharacterDetail(
  source: THREE.Object3D,
  clips: readonly THREE.AnimationClip[],
  maxRelativeErrors: readonly [number, number] = [0.002, 0.006],
): Promise<CharacterDetailGeometry> {
  await MeshoptSimplifier.ready;
  const variants = [new Map(), new Map()] as [
    Map<THREE.BufferGeometry, THREE.BufferGeometry>,
    Map<THREE.BufferGeometry, THREE.BufferGeometry>,
  ];
  const posed = cloneSkinned(source);
  const meshes: THREE.SkinnedMesh[] = [];
  posed.traverse(object => { if ((object as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(object as THREE.SkinnedMesh); });
  // Deformed coordinates prevent a bind-pose collapse from ignoring elbows,
  // knees or clothing which changes shape in authored civilian/combat motion.
  const samples = [...new Set(clips)].slice(0, 8);
  const mixer = new THREE.AnimationMixer(posed);
  const point = new THREE.Vector3();
  for (const mesh of meshes) {
    const original = mesh.geometry;
    if (variants[0].has(original) || !original.index || original.morphAttributes.position?.length) continue;
    const position = original.getAttribute('position');
    const normal = original.getAttribute('normal');
    const uv = original.getAttribute('uv');
    const positions = new Float32Array(position.count * 3);
    for (let i = 0; i < position.count; i++) point.fromBufferAttribute(position, i).toArray(positions, i * 3);
    const scale = MeshoptSimplifier.getScale(positions, 3);
    const stride = samples.length * 3 + (normal ? 3 : 0) + (uv ? 2 : 0);
    const attributes = new Float32Array(position.count * stride);
    const weights: number[] = [];
    for (let sample = 0; sample < samples.length; sample++) {
      const clip = samples[sample]!;
      mixer.stopAllAction();
      const action = mixer.clipAction(clip).play();
      action.time = clip.duration * (sample % 2 === 0 ? 0.31 : 0.69);
      mixer.update(0);
      posed.updateMatrixWorld(true);
      mesh.skeleton.update();
      for (let i = 0; i < position.count; i++) {
        point.fromBufferAttribute(position, i);
        mesh.applyBoneTransform(i, point).toArray(attributes, i * stride + sample * 3);
      }
      weights.push(1, 1, 1);
    }
    const offset = samples.length * 3;
    if (normal) weights.push(scale * 0.02, scale * 0.02, scale * 0.02);
    if (uv) weights.push(scale * 0.1, scale * 0.1);
    for (let i = 0; i < position.count; i++) {
      let at = i * stride + offset;
      if (normal) { point.fromBufferAttribute(normal, i).toArray(attributes, at); at += 3; }
      if (uv) { attributes[at] = uv.getX(i); attributes[at + 1] = uv.getY(i); }
    }
    const groups = original.groups.length ? original.groups : [{ start: 0, count: original.index.count, materialIndex: 0 }];
    for (let level = 0; level < 2; level++) {
      const geometry = new THREE.BufferGeometry();
      for (const [name, attribute] of Object.entries(original.attributes)) geometry.setAttribute(name, attribute);
      geometry.boundingBox = original.boundingBox?.clone() ?? null;
      geometry.boundingSphere = original.boundingSphere?.clone() ?? null;
      const parts: Uint32Array[] = [];
      let count = 0;
      for (const group of groups) {
        const indices = Uint32Array.from(original.index.array.slice(group.start, group.start + group.count));
        const target = Math.max(3, Math.floor(indices.length / 3 * (level === 0 ? 0.35 : 0.12)) * 3);
        const [reduced, error] = MeshoptSimplifier.simplifyWithAttributes(
          indices, positions, 3, attributes, stride, weights, null,
          Math.min(target, indices.length), maxRelativeErrors[level]!, ['LockBorder'],
        );
        if (!Number.isFinite(error)) throw new Error('Non-finite authored character detail error');
        geometry.addGroup(count, reduced.length, group.materialIndex ?? 0);
        parts.push(reduced);
        count += reduced.length;
      }
      const index = new Uint32Array(count);
      let at = 0;
      for (const part of parts) { index.set(part, at); at += part.length; }
      geometry.setIndex(new THREE.BufferAttribute(index, 1));
      geometry.userData.authoredCharacterDetail = level + 1;
      variants[level]!.set(original, geometry);
    }
  }
  mixer.stopAllAction();
  mixer.uncacheRoot(posed);
  return variants;
}

/** Hysteresis keeps small camera movements from switching topology repeatedly. */
export function selectCharacterDetail(projectedHeightPixels: number, previous: CharacterDetail = 0): CharacterDetail {
  if (!Number.isFinite(projectedHeightPixels)) return 0;
  if (previous === 0) return projectedHeightPixels < 42 ? (projectedHeightPixels < 18 ? 2 : 1) : 0;
  if (previous === 1) return projectedHeightPixels > 50 ? 0 : projectedHeightPixels < 18 ? 2 : 1;
  return projectedHeightPixels > 50 ? 0 : projectedHeightPixels > 23 ? 1 : 2;
}
