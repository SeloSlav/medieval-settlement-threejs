import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import * as THREE from '../vendor/seedthree/node_modules/three/build/three.module.js';
import { GLTFExporter } from '../vendor/seedthree/node_modules/three/examples/jsm/exporters/GLTFExporter.js';
import { mergeGeometries } from '../vendor/seedthree/node_modules/three/examples/jsm/utils/BufferGeometryUtils.js';

const vendorRequire = createRequire(resolve('vendor/seedthree/package.json'));
const sharp = vendorRequire('sharp');

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

const leafDir = resolve('vendor/seedthree/assets/leaves');
const barkDir = resolve('vendor/seedthree/assets/bark');
const fruitDir = resolve('vendor/seedthree/assets/fruits');
for (const directory of [leafDir, barkDir, fruitDir]) mkdirSync(directory, { recursive: true });

const species = [
  {
    id: 'pear_single', source: 'pear_leaf_source.png', roughness: 0.58,
    bark: 'pear_bark', seed: 19, barkDark: [77, 72, 62], barkLight: [139, 132, 112],
    lenticel: [177, 170, 145], fiberScale: 5.8,
  },
  {
    id: 'aronia_spray', source: 'aronia_leaf_source.png', roughness: 0.66,
    bark: 'aronia_branch', seed: 41, barkDark: [68, 45, 52], barkLight: [124, 91, 91],
    lenticel: [172, 139, 130], fiberScale: 8.4,
  },
  {
    id: 'rosehip_spray', source: 'rosehip_leaf_source.png', roughness: 0.74,
    bark: 'rosehip_cane', seed: 73, barkDark: [65, 63, 42], barkLight: [129, 100, 64],
    lenticel: [177, 151, 99], fiberScale: 7.2,
  },
];

function clampByte(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function hash2(x, y, seed) {
  const value = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453123;
  return value - Math.floor(value);
}

async function writeRgba(path, data, width, height) {
  await sharp(data, { raw: { width, height, channels: 4 } }).png({ compressionLevel: 9 }).toFile(path);
}

function normalMapFromHeight(height, alpha, width, heightPx, strength) {
  const out = new Uint8Array(width * heightPx * 4);
  const sample = (x, y) => height[Math.max(0, Math.min(heightPx - 1, y)) * width + Math.max(0, Math.min(width - 1, x))];
  for (let y = 0; y < heightPx; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      const dx = (sample(x + 1, y) - sample(x - 1, y)) * strength;
      const dy = (sample(x, y + 1) - sample(x, y - 1)) * strength;
      const length = Math.hypot(dx, dy, 1) || 1;
      out[index * 4] = clampByte(127.5 + (-dx / length) * 127.5);
      out[index * 4 + 1] = clampByte(127.5 + (dy / length) * 127.5);
      out[index * 4 + 2] = clampByte(127.5 + (1 / length) * 127.5);
      out[index * 4 + 3] = alpha[index];
    }
  }
  return out;
}

async function generateLeafMaps(definition) {
  const input = resolve('art-source/seedthree/orchards', definition.source);
  const { data, info } = await sharp(input)
    .resize(1024, 1024, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const pixels = info.width * info.height;
  const height = new Float32Array(pixels);
  const alpha = new Uint8Array(pixels);
  const roughness = new Uint8Array(pixels * 4);
  const translucency = new Uint8Array(pixels * 4);
  for (let index = 0; index < pixels; index++) {
    const r = data[index * 4];
    const g = data[index * 4 + 1];
    const b = data[index * 4 + 2];
    const a = data[index * 4 + 3];
    const luma = (r * 0.22 + g * 0.7 + b * 0.08) / 255;
    alpha[index] = a;
    height[index] = a > 6 ? luma : 0;
    const rough = clampByte((definition.roughness + (0.5 - luma) * 0.18) * 255);
    const transmit = clampByte((0.36 + luma * 0.34) * 255);
    roughness.set([rough, rough, rough, a], index * 4);
    translucency.set([transmit, transmit, transmit, a], index * 4);
  }
  await writeRgba(resolve(leafDir, `${definition.id}_albedo.png`), data, info.width, info.height);
  await writeRgba(resolve(leafDir, `${definition.id}_normal.png`), normalMapFromHeight(height, alpha, info.width, info.height, 7.5), info.width, info.height);
  await writeRgba(resolve(leafDir, `${definition.id}_roughness.png`), roughness, info.width, info.height);
  await writeRgba(resolve(leafDir, `${definition.id}_translucency.png`), translucency, info.width, info.height);
}

async function generateBarkMaps(definition) {
  const width = 512;
  const heightPx = 512;
  const pixels = width * heightPx;
  const albedo = new Uint8Array(pixels * 4);
  const roughness = new Uint8Array(pixels * 4);
  const alpha = new Uint8Array(pixels).fill(255);
  const relief = new Float32Array(pixels);
  for (let y = 0; y < heightPx; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      const u = x / width;
      const v = y / heightPx;
      const fiber = 0.5 + 0.28 * Math.sin((u * definition.fiberScale + 0.13 * Math.sin(v * Math.PI * 6)) * Math.PI * 2);
      const fine = hash2(x >> 2, y >> 3, definition.seed) - 0.5;
      const lenticelBand = Math.abs(Math.sin((v * 23 + hash2(0, y >> 4, definition.seed)) * Math.PI));
      const lenticel = lenticelBand > 0.975 && hash2(x >> 3, y >> 2, definition.seed + 11) > 0.78 ? 1 : 0;
      const cause = THREE.MathUtils.clamp(fiber * 0.72 + fine * 0.2 + lenticel * 0.45, 0, 1);
      relief[index] = cause;
      for (let channel = 0; channel < 3; channel++) {
        const base = THREE.MathUtils.lerp(definition.barkDark[channel], definition.barkLight[channel], cause);
        albedo[index * 4 + channel] = clampByte(lenticel ? THREE.MathUtils.lerp(base, definition.lenticel[channel], 0.75) : base);
      }
      albedo[index * 4 + 3] = 255;
      const rough = clampByte((0.72 + (1 - cause) * 0.18 - lenticel * 0.12) * 255);
      roughness.set([rough, rough, rough, 255], index * 4);
    }
  }
  await writeRgba(resolve(barkDir, `${definition.bark}_albedo.png`), albedo, width, heightPx);
  await writeRgba(resolve(barkDir, `${definition.bark}_normal.png`), normalMapFromHeight(relief, alpha, width, heightPx, 4.2), width, heightPx);
  await writeRgba(resolve(barkDir, `${definition.bark}_roughness.png`), roughness, width, heightPx);
}

function addPart(parts, geometry, color, matrix = new THREE.Matrix4()) {
  const part = (geometry.index ? geometry.toNonIndexed() : geometry.clone()).applyMatrix4(matrix);
  const colors = new Float32Array(part.getAttribute('position').count * 3);
  const positions = part.getAttribute('position');
  for (let index = 0; index < positions.count; index++) {
    const variation = 0.92 + ((index * 13) % 17) / 170;
    colors[index * 3] = color.r * variation;
    colors[index * 3 + 1] = color.g * variation;
    colors[index * 3 + 2] = color.b * variation;
  }
  part.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  parts.push(part);
}

async function exportFruit(fileName, name, parts, roughness = 0.74) {
  const geometry = mergeGeometries(parts, false);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
    name, color: 0xffffff, vertexColors: true, roughness, metalness: 0,
  }));
  mesh.name = name.replaceAll(' ', '_');
  const exporter = new GLTFExporter();
  const arrayBuffer = await new Promise((resolveExport, rejectExport) => {
    exporter.parse(mesh, resolveExport, rejectExport, { binary: true, onlyVisible: true });
  });
  const outputPath = resolve(fruitDir, fileName);
  writeFileSync(outputPath, Buffer.from(arrayBuffer));
  return { outputPath, bytes: Buffer.byteLength(Buffer.from(arrayBuffer)), triangles: geometry.getAttribute('position').count / 3 };
}

function pearParts() {
  const parts = [];
  const fruit = new THREE.SphereGeometry(1, 24, 18).toNonIndexed();
  const position = fruit.getAttribute('position');
  for (let index = 0; index < position.count; index++) {
    const y = position.getY(index);
    const waist = 0.68 + (1 - y) * 0.17 + Math.max(0, -y) * 0.08;
    position.setXYZ(index, position.getX(index) * 0.035 * waist, y * 0.052, position.getZ(index) * 0.035 * waist);
  }
  addPart(parts, fruit, new THREE.Color(0xa8ae42), new THREE.Matrix4().makeTranslation(0, 0.052, 0));
  addPart(parts, new THREE.CylinderGeometry(0.0015, 0.0022, 0.025, 8), new THREE.Color(0x59462f), new THREE.Matrix4().makeTranslation(0, 0.115, 0));
  return parts;
}

function aroniaParts() {
  const parts = [];
  const centers = [[0, 0, 0], [-0.007, -0.004, 0.003], [0.007, -0.005, 0.002], [-0.004, -0.008, -0.006], [0.005, -0.009, -0.006], [0, -0.013, 0.005]];
  for (const [x, y, z] of centers) {
    addPart(parts, new THREE.IcosahedronGeometry(0.0052, 2), new THREE.Color(0x21172d), new THREE.Matrix4().makeTranslation(x, y, z));
    addPart(parts, new THREE.CylinderGeometry(0.00045, 0.00065, 0.008, 5), new THREE.Color(0x694c43), new THREE.Matrix4().makeTranslation(x * 0.35, y + 0.008, z * 0.35));
  }
  return parts;
}

function rosehipParts() {
  const parts = [];
  for (const [x, y, z, tilt] of [[-0.009, -0.006, 0, -0.18], [0.009, -0.004, 0.002, 0.16], [0, -0.012, -0.006, 0.04]]) {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, tilt));
    addPart(parts, new THREE.SphereGeometry(0.008, 18, 12), new THREE.Color(0xc24625), new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(0.92, 1.55, 0.92)));
    for (let tooth = 0; tooth < 5; tooth++) {
      const angle = tooth / 5 * Math.PI * 2;
      addPart(parts, new THREE.ConeGeometry(0.0012, 0.0045, 3), new THREE.Color(0x5b6d31), new THREE.Matrix4().compose(new THREE.Vector3(x + Math.cos(angle) * 0.0025, y - 0.013, z + Math.sin(angle) * 0.0025), new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI, angle, 0)), new THREE.Vector3(1, 1, 1)));
    }
  }
  return parts;
}

for (const definition of species) {
  await generateLeafMaps(definition);
  await generateBarkMaps(definition);
}
const fruit = [
  await exportFruit('pear.glb', 'Pyrus communis ripe pear', pearParts(), 0.7),
  await exportFruit('aronia_cluster.glb', 'Aronia melanocarpa berry cluster', aroniaParts(), 0.82),
  await exportFruit('rosehip_cluster.glb', 'Rosa canina rosehip cluster', rosehipParts(), 0.76),
];
console.log(JSON.stringify({ textureSpecies: species.map(({ id, bark }) => ({ id, bark })), fruit }, null, 2));
