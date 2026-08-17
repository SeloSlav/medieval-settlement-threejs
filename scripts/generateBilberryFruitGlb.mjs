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

const SKIN_DARK = new THREE.Color(0x172342);
const SKIN_MID = new THREE.Color(0x273b68);
const BLOOM = new THREE.Color(0x50688f);
const CALYX = new THREE.Color(0x101a32);
const PEDICEL = new THREE.Color(0x526635);
const geometryParts = [];

function addColoredGeometry(geometry, color, matrix = new THREE.Matrix4()) {
  const part = (geometry.index ? geometry.toNonIndexed() : geometry.clone()).applyMatrix4(matrix);
  const colors = new Float32Array(part.getAttribute('position').count * 3);
  const positions = part.getAttribute('position');
  for (let index = 0; index < positions.count; index++) {
    const variation = 0.92 + ((index * 17) % 11) / 110;
    colors[index * 3] = color.r * variation;
    colors[index * 3 + 1] = color.g * variation;
    colors[index * 3 + 2] = color.b * variation;
  }
  part.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometryParts.push(part);
}

// Vaccinium myrtillus fruit is a smooth, slightly oblate 6–10 mm berry with a
// powdery blue bloom. Three nearly coincident shells create restrained colour
// breakup without giving it raspberry-like lobes.
const berryRadius = 0.0047;
for (let layer = 0; layer < 3; layer++) {
  const angle = (layer / 3) * Math.PI * 2;
  const shell = new THREE.IcosahedronGeometry(berryRadius * (layer === 0 ? 1 : 0.985), 2);
  const matrix = new THREE.Matrix4().compose(
    new THREE.Vector3(
      Math.cos(angle) * berryRadius * 0.025,
      -0.0061 + (layer - 1) * 0.00005,
      Math.sin(angle) * berryRadius * 0.025,
    ),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle),
    new THREE.Vector3(1, 0.91, 1),
  );
  addColoredGeometry(shell, layer === 0 ? BLOOM : layer === 1 ? SKIN_MID : SKIN_DARK, matrix);
}

// Five persistent calyx teeth around the distal depression are the close-view
// cue that distinguishes a bilberry from the three-scaled juniper cone.
for (let tooth = 0; tooth < 5; tooth++) {
  const angle = (tooth / 5) * Math.PI * 2;
  const calyxTooth = new THREE.ConeGeometry(0.00075, 0.0021, 3);
  const quaternion = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(Math.PI * 0.56, angle, 0, 'YXZ'),
  );
  const matrix = new THREE.Matrix4().compose(
    new THREE.Vector3(
      Math.cos(angle) * 0.00145,
      -0.01045,
      Math.sin(angle) * 0.00145,
    ),
    quaternion,
    new THREE.Vector3(1, 1, 1),
  );
  addColoredGeometry(calyxTooth, CALYX, matrix);
}
addColoredGeometry(
  new THREE.CylinderGeometry(0.00065, 0.00085, 0.00045, 8),
  CALYX,
  new THREE.Matrix4().makeTranslation(0, -0.01075, 0),
);
addColoredGeometry(
  new THREE.CylinderGeometry(0.00045, 0.00072, 0.0048, 6),
  PEDICEL,
  new THREE.Matrix4().makeTranslation(0, -0.0008, 0),
);

const geometry = mergeGeometries(geometryParts, false);
geometry.computeVertexNormals();
geometry.computeBoundingBox();
geometry.computeBoundingSphere();
const material = new THREE.MeshStandardMaterial({
  name: 'Glaucous ripe bilberry with persistent calyx',
  color: 0xffffff,
  vertexColors: true,
  roughness: 0.86,
  metalness: 0,
});
const mesh = new THREE.Mesh(geometry, material);
mesh.name = 'Vaccinium_myrtillus_ripe_bilberry';

const exporter = new GLTFExporter();
const arrayBuffer = await new Promise((resolveExport, rejectExport) => {
  exporter.parse(mesh, resolveExport, rejectExport, {
    binary: true,
    onlyVisible: true,
    truncateDrawRange: true,
  });
});
const outputPath = resolve('vendor/seedthree/assets/fruits/bilberry_berry.glb');
writeFileSync(outputPath, Buffer.from(arrayBuffer));
console.log(JSON.stringify({
  outputPath,
  bytes: Buffer.byteLength(Buffer.from(arrayBuffer)),
  vertices: geometry.getAttribute('position').count,
  triangles: geometry.getAttribute('position').count / 3,
  diameterM: berryRadius * 2,
}));
