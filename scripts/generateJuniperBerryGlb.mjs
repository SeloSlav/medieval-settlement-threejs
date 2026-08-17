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

const BLOOM_DARK = new THREE.Color(0x27375f);
const BLOOM_MID = new THREE.Color(0x405a88);
const BLOOM_LIGHT = new THREE.Color(0x647ca2);
const SCALE_SCAR = new THREE.Color(0x17223e);
const PEDICEL = new THREE.Color(0x40512d);
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

// A ripe Juniperus communis berry is a 6-9 mm fleshy cone with a matte,
// glaucous bloom. Layer three subtly offset shells to keep the tiny silhouette
// round while giving its fused seed scales readable colour variation.
const berryRadius = 0.0042;
for (let lobe = 0; lobe < 3; lobe++) {
  const angle = (lobe / 3) * Math.PI * 2;
  const geometry = new THREE.IcosahedronGeometry(berryRadius * 0.92, 1);
  const matrix = new THREE.Matrix4().compose(
    new THREE.Vector3(
      Math.cos(angle) * berryRadius * 0.13,
      -0.0062 + (lobe === 0 ? 0.00015 : -0.0001),
      Math.sin(angle) * berryRadius * 0.13,
    ),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle + 0.4),
    new THREE.Vector3(0.98, 0.94, 0.98),
  );
  addColoredGeometry(
    geometry,
    lobe === 0 ? BLOOM_LIGHT : lobe === 1 ? BLOOM_MID : BLOOM_DARK,
    matrix,
  );
}

// The three-pointed scar at the cone apex is the botanical cue that keeps the
// fruit from reading as a generic blueberry at close range.
for (let scale = 0; scale < 3; scale++) {
  const angle = (scale / 3) * Math.PI * 2;
  const scar = new THREE.ConeGeometry(0.00115, 0.0022, 3);
  const quaternion = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(Math.PI * 0.54, angle, 0, 'YXZ'),
  );
  const matrix = new THREE.Matrix4().compose(
    new THREE.Vector3(
      Math.cos(angle) * 0.00115,
      -0.0101,
      Math.sin(angle) * 0.00115,
    ),
    quaternion,
    new THREE.Vector3(1, 1, 1),
  );
  addColoredGeometry(scar, SCALE_SCAR, matrix);
}

addColoredGeometry(
  new THREE.CylinderGeometry(0.00065, 0.0009, 0.007, 6),
  PEDICEL,
  new THREE.Matrix4().makeTranslation(0, -0.0003, 0),
);

const geometry = mergeGeometries(geometryParts, false);
geometry.computeVertexNormals();
geometry.computeBoundingBox();
geometry.computeBoundingSphere();
const material = new THREE.MeshStandardMaterial({
  name: 'Glaucous ripe common-juniper berry cone',
  color: 0xffffff,
  vertexColors: true,
  roughness: 0.9,
  metalness: 0,
});
const mesh = new THREE.Mesh(geometry, material);
mesh.name = 'Juniperus_communis_ripe_berry_cone';

const exporter = new GLTFExporter();
const arrayBuffer = await new Promise((resolveExport, rejectExport) => {
  exporter.parse(mesh, resolveExport, rejectExport, {
    binary: true,
    onlyVisible: true,
    truncateDrawRange: true,
  });
});
const outputPath = resolve('vendor/seedthree/assets/fruits/juniper_berry.glb');
writeFileSync(outputPath, Buffer.from(arrayBuffer));
console.log(JSON.stringify({
  outputPath,
  bytes: Buffer.byteLength(Buffer.from(arrayBuffer)),
  vertices: geometry.getAttribute('position').count,
  triangles: geometry.getAttribute('position').count / 3,
  diameterM: berryRadius * 2,
}));
