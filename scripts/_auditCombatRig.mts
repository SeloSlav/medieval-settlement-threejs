import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';

(globalThis as typeof globalThis & { self: typeof globalThis }).self = globalThis;
(globalThis as typeof globalThis & {
  createImageBitmap: (blob: Blob) => Promise<ImageBitmap>;
}).createImageBitmap = async () => ({ width: 1, height: 1, close() {} } as ImageBitmap);

const assets = [
  'public/assets/models/villagers/worker-male-common-01-v002.glb',
  'public/assets/models/villagers/ottoman-raider-common-01-v001.glb',
];

for (const path of assets) {
  const bytes = fs.readFileSync(path);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const gltf = await new Promise<Awaited<ReturnType<GLTFLoader['loadAsync']>>>((resolve, reject) => {
    new GLTFLoader().parse(buffer, '', resolve, reject);
  });
  console.log(`ASSET ${path}`);
  const bones: THREE.Bone[] = [];
  gltf.scene.traverse((object) => {
    if (object instanceof THREE.Bone) bones.push(object);
  });
  for (const bone of bones) {
    if (/Hips|Waist|Spine|Abdomen|Torso|Neck|Arm|Hand|Palm/i.test(bone.name)) {
      console.log(
        `BONE ${bone.name} parent=${bone.parent?.name ?? '-'} pos=${bone.position.toArray().map((v) => v.toFixed(4)).join(',')} quat=${bone.quaternion.toArray().map((v) => v.toFixed(4)).join(',')}`,
      );
    }
  }
  for (const clip of gltf.animations) {
    if (!/slash|hit_to_body|fall|wait|idle|lift_heavy|chop/i.test(clip.name)) continue;
    console.log(`CLIP ${clip.name} duration=${clip.duration.toFixed(4)} tracks=${clip.tracks.length}`);
    const relevantTracks = clip.tracks.filter((track) => /Hips|Waist|Spine|Abdomen|Torso|Neck|Arm|Hand|Palm/i.test(track.name));
    console.log(`TRACKS ${relevantTracks.map((track) => track.name).join(' ')}`);
    const model = cloneSkinned(gltf.scene) as THREE.Group;
    const mixer = new THREE.AnimationMixer(model);
    const action = mixer.clipAction(clip, model).setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.play();
    for (const fraction of [0, 0.2, 0.4, 0.6, 0.8, 0.98]) {
      mixer.setTime(clip.duration * fraction);
      const sample = ['Spine01', 'Spine02', 'Torso', 'UpperArmL', 'LowerArmL', 'PalmL', 'UpperArmR', 'LowerArmR', 'PalmR']
        .map((name) => model.getObjectByName(name))
        .filter((bone): bone is THREE.Object3D => Boolean(bone))
        .map((bone) => {
          const euler = new THREE.Euler().setFromQuaternion(bone.quaternion, 'XYZ');
          return `${bone.name}=${[euler.x, euler.y, euler.z].map((value) => value.toFixed(2)).join(',')}`;
        });
      console.log(`POSE ${fraction.toFixed(2)} ${sample.join(' ')}`);
    }
    mixer.stopAllAction();
  }
}
