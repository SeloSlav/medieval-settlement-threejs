import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const browserGlobal = globalThis as typeof globalThis & {
  self?: typeof globalThis;
  createImageBitmap?: () => Promise<unknown>;
};
browserGlobal.self = globalThis;
browserGlobal.createImageBitmap = async () => ({ width: 1, height: 1, close() {} });

const assets = [
  'public/assets/models/villagers/worker-male-common-01-v002.glb',
  'public/assets/models/villagers/worker-female-common-01-v001.glb',
  'public/assets/models/villagers/cleric-monk-common-01-v001.glb',
  'public/assets/models/villagers/ottoman-raider-common-01-v001.glb',
];

for (const path of assets) {
  const bytes = fs.readFileSync(path);
  const arrayBuffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const gltf = await new GLTFLoader().parseAsync(arrayBuffer, '');
  const meshes: THREE.SkinnedMesh[] = [];
  gltf.scene.traverse((object) => {
    const mesh = object as THREE.SkinnedMesh;
    if (mesh.isSkinnedMesh) meshes.push(mesh);
  });
  let vertices = 0;
  let triangles = 0;
  console.log(`\n${path}`);
  for (const [index, mesh] of meshes.entries()) {
    const geometry = mesh.geometry;
    const meshVertices = geometry.getAttribute('position').count;
    const meshTriangles = Math.floor((geometry.index?.count ?? meshVertices) / 3);
    vertices += meshVertices;
    triangles += meshTriangles;
    const materials = (Array.isArray(mesh.material) ? mesh.material : [mesh.material])
      .filter((material): material is THREE.Material => Boolean(material));
    console.log(JSON.stringify({
      layer: index,
      name: mesh.name,
      vertices: meshVertices,
      triangles: meshTriangles,
      indexed: Boolean(geometry.index),
      groups: geometry.groups.length,
      bones: mesh.skeleton.bones.length,
      materials: materials.map((material) => ({
        name: material.name,
        type: material.type,
        transparent: material.transparent,
        side: material.side,
        color: material instanceof THREE.MeshStandardMaterial
          ? material.color.getHexString()
          : null,
        emissive: material instanceof THREE.MeshStandardMaterial
          ? material.emissive.getHexString()
          : null,
        emissiveIntensity: material instanceof THREE.MeshStandardMaterial
          ? material.emissiveIntensity
          : null,
        hasMap: material instanceof THREE.MeshStandardMaterial && Boolean(material.map),
      })),
    }));
  }
  console.log(JSON.stringify({ meshes: meshes.length, vertices, triangles }));
}
