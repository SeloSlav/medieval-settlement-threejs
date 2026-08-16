import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

class NodeFileReader {
  result = null;
  onloadend = null;
  onerror = null;

  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((buffer) => {
      this.result = buffer;
      this.onloadend?.({ target: this });
    }).catch((error) => this.onerror?.(error));
  }

  readAsDataURL(blob) {
    blob.arrayBuffer().then((buffer) => {
      this.result = `data:${blob.type};base64,${Buffer.from(buffer).toString('base64')}`;
      this.onloadend?.({ target: this });
    }).catch((error) => this.onerror?.(error));
  }
}

globalThis.FileReader = NodeFileReader;

const RED = new THREE.Color(0xb3152e);
const RED_LIGHT = new THREE.Color(0xd72d42);
const GREEN = new THREE.Color(0x49672d);
const geometryParts = [];

function addColoredGeometry(geometry, color, matrix = new THREE.Matrix4()) {
  const part = (geometry.index ? geometry.toNonIndexed() : geometry.clone()).applyMatrix4(matrix);
  const colors = new Float32Array(part.getAttribute('position').count * 3);
  for (let index = 0; index < colors.length; index += 3) {
    colors[index] = color.r;
    colors[index + 1] = color.g;
    colors[index + 2] = color.b;
  }
  part.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometryParts.push(part);
}

const drupelet = new THREE.IcosahedronGeometry(0.0048, 0);
const rings = [
  { y: 0.012, radius: 0.005, count: 6 },
  { y: 0.0055, radius: 0.009, count: 9 },
  { y: -0.0015, radius: 0.0105, count: 10 },
  { y: -0.0085, radius: 0.0085, count: 8 },
  { y: -0.014, radius: 0.0045, count: 5 },
];
for (let ringIndex = 0; ringIndex < rings.length; ringIndex++) {
  const ring = rings[ringIndex];
  for (let index = 0; index < ring.count; index++) {
    const angle = (index / ring.count) * Math.PI * 2 + ringIndex * 0.47;
    const matrix = new THREE.Matrix4().makeTranslation(
      Math.cos(angle) * ring.radius,
      ring.y,
      Math.sin(angle) * ring.radius,
    );
    addColoredGeometry(drupelet, (index + ringIndex) % 3 === 0 ? RED_LIGHT : RED, matrix);
  }
}

addColoredGeometry(
  new THREE.CylinderGeometry(0.0017, 0.0022, 0.025, 7),
  GREEN,
  new THREE.Matrix4().makeTranslation(0, 0.028, 0),
);
for (let index = 0; index < 5; index++) {
  const angle = (index / 5) * Math.PI * 2;
  const sepal = new THREE.ConeGeometry(0.0042, 0.012, 4);
  const quaternion = new THREE.Quaternion()
    .setFromEuler(new THREE.Euler(Math.PI * 0.42, angle, 0, 'YXZ'));
  const matrix = new THREE.Matrix4().compose(
    new THREE.Vector3(Math.cos(angle) * 0.004, 0.015, Math.sin(angle) * 0.004),
    quaternion,
    new THREE.Vector3(1, 1, 1),
  );
  addColoredGeometry(sepal, GREEN, matrix);
}

const geometry = mergeGeometries(geometryParts, false);
geometry.computeVertexNormals();
geometry.computeBoundingBox();
geometry.computeBoundingSphere();
const material = new THREE.MeshStandardMaterial({
  name: 'Raspberry drupelets and calyx',
  color: 0xffffff,
  vertexColors: true,
  roughness: 0.78,
  metalness: 0,
});
const mesh = new THREE.Mesh(geometry, material);
mesh.name = 'Rubus_idaeus_ripe_fruit';

const exporter = new GLTFExporter();
const arrayBuffer = await new Promise((resolveExport, rejectExport) => {
  exporter.parse(mesh, resolveExport, rejectExport, {
    binary: true,
    onlyVisible: true,
    truncateDrawRange: true,
  });
});
const outputPath = resolve('vendor/seedthree/assets/fruits/raspberry_cluster.glb');
writeFileSync(outputPath, Buffer.from(arrayBuffer));
console.log(JSON.stringify({
  outputPath,
  bytes: Buffer.byteLength(Buffer.from(arrayBuffer)),
  vertices: geometry.getAttribute('position').count,
  triangles: geometry.getAttribute('position').count / 3,
}));
