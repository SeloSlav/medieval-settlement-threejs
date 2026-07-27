import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { BackyardGardenKind } from '../generated/gameBalance.ts';
import {
  sharedBuildingDetailMaterial,
  sharedBuildingMaterial,
} from '../buildings/buildingMaterials.ts';
import { prepareBuildingGeometryUvs } from '../buildings/buildingMetricUvs.ts';
import { mulberry32 } from '../utils/random.ts';
import type { BackyardPlantCatalog } from '../vegetation/seedthree/backyardPlantAssets.ts';

export type BackyardGardenMeshOptions = {
  width?: number;
  depth?: number;
  seed?: number;
  plants?: BackyardPlantCatalog | null;
};

const FLOWER_STEM_MAP_SIZE = 64;

function createFlowerStemMaps(): {
  albedo: THREE.DataTexture;
  normal: THREE.DataTexture;
  roughness: THREE.DataTexture;
} {
  const albedoPixels = new Uint8Array(FLOWER_STEM_MAP_SIZE * FLOWER_STEM_MAP_SIZE * 4);
  const normalPixels = new Uint8Array(FLOWER_STEM_MAP_SIZE * FLOWER_STEM_MAP_SIZE * 4);
  const roughnessPixels = new Uint8Array(FLOWER_STEM_MAP_SIZE * FLOWER_STEM_MAP_SIZE * 4);

  for (let y = 0; y < FLOWER_STEM_MAP_SIZE; y++) {
    const v = y / FLOWER_STEM_MAP_SIZE;
    const nodeBand = Math.exp(-Math.pow((v * 3.2) % 1 - 0.5, 2) / 0.006);
    for (let x = 0; x < FLOWER_STEM_MAP_SIZE; x++) {
      const offset = (y * FLOWER_STEM_MAP_SIZE + x) * 4;
      const fiber = Math.sin(x * 0.78 + y * 0.13)
        + Math.sin(x * 2.41 - y * 0.07) * 0.35;
      const grain = ((x * 37 + y * 53 + x * y * 3) % 31) / 30 - 0.5;
      const highlight = fiber * 4 + grain * 5 - nodeBand * 13;

      albedoPixels[offset] = THREE.MathUtils.clamp(63 + highlight, 34, 88);
      albedoPixels[offset + 1] = THREE.MathUtils.clamp(101 + highlight * 1.35, 55, 134);
      albedoPixels[offset + 2] = THREE.MathUtils.clamp(48 + highlight * 0.75, 29, 72);
      albedoPixels[offset + 3] = 255;

      normalPixels[offset] = THREE.MathUtils.clamp(128 + fiber * 7, 105, 151);
      normalPixels[offset + 1] = THREE.MathUtils.clamp(128 - nodeBand * 9 + grain * 3, 108, 140);
      normalPixels[offset + 2] = 252;
      normalPixels[offset + 3] = 255;

      const roughness = THREE.MathUtils.clamp(226 + grain * 14 + nodeBand * 13, 197, 247);
      roughnessPixels[offset] = roughness;
      roughnessPixels[offset + 1] = roughness;
      roughnessPixels[offset + 2] = roughness;
      roughnessPixels[offset + 3] = 255;
    }
  }

  const createMap = (pixels: Uint8Array, name: string, srgb = false): THREE.DataTexture => {
    const texture = new THREE.DataTexture(
      pixels,
      FLOWER_STEM_MAP_SIZE,
      FLOWER_STEM_MAP_SIZE,
      THREE.RGBAFormat,
      THREE.UnsignedByteType,
    );
    texture.name = name;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(1, 3);
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = true;
    if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    return texture;
  };

  return {
    albedo: createMap(albedoPixels, 'Wildflower stem fiber albedo', true),
    normal: createMap(normalPixels, 'Wildflower stem fiber normal'),
    roughness: createMap(roughnessPixels, 'Wildflower stem roughness'),
  };
}

const FLOWER_STEM_MAPS = createFlowerStemMaps();

const MATERIALS = {
  soil: new THREE.MeshStandardMaterial({ color: 0x4b3828, roughness: 0.97 }),
  darkSoil: new THREE.MeshStandardMaterial({ color: 0x35271d, roughness: 0.98 }),
  path: new THREE.MeshStandardMaterial({ color: 0x8a795f, roughness: 0.98 }),
  timber: sharedBuildingMaterial('timberMid'),
  darkTimber: sharedBuildingMaterial('timberDark'),
  wicker: sharedBuildingMaterial('timberLight'),
  stone: sharedBuildingMaterial('masonryMid'),
  leaf: new THREE.MeshStandardMaterial({ color: 0x527a3d, roughness: 0.9 }),
  leafLight: new THREE.MeshStandardMaterial({ color: 0x739650, roughness: 0.9 }),
  herb: new THREE.MeshStandardMaterial({
    color: 0x66834e,
    roughness: 0.91,
    side: THREE.DoubleSide,
  }),
  herbSilver: new THREE.MeshStandardMaterial({
    color: 0x829078,
    roughness: 0.92,
    side: THREE.DoubleSide,
  }),
  apple: new THREE.MeshStandardMaterial({ color: 0xb94332, roughness: 0.76 }),
  appleGold: new THREE.MeshStandardMaterial({ color: 0xd99b3a, roughness: 0.76 }),
  cherry: new THREE.MeshStandardMaterial({ color: 0x7f1f2f, roughness: 0.72 }),
  flowerCenter: new THREE.MeshStandardMaterial({ color: 0xd8aa3f, roughness: 0.82 }),
  flowerVertex: new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.72,
    vertexColors: true,
    side: THREE.DoubleSide,
  }),
  flowerStem: new THREE.MeshStandardMaterial({
    name: 'Textured wildflower stem material',
    color: 0xffffff,
    map: FLOWER_STEM_MAPS.albedo,
    normalMap: FLOWER_STEM_MAPS.normal,
    normalScale: new THREE.Vector2(0.32, 0.32),
    roughnessMap: FLOWER_STEM_MAPS.roughness,
    roughness: 0.92,
    metalness: 0,
  }),
  cabbage: new THREE.MeshStandardMaterial({ color: 0x759c5c, roughness: 0.9 }),
  squash: new THREE.MeshStandardMaterial({ color: 0x4d7939, roughness: 0.9 }),
  terracotta: new THREE.MeshStandardMaterial({ color: 0x9b4c36, roughness: 0.88 }),
  water: sharedBuildingDetailMaterial('water'),
} as const;

const FLOWER_MATERIALS = [
  new THREE.MeshStandardMaterial({ color: 0xb83f55, roughness: 0.78 }),
  new THREE.MeshStandardMaterial({ color: 0xdc7582, roughness: 0.78 }),
  new THREE.MeshStandardMaterial({ color: 0xe6c8a0, roughness: 0.8 }),
  new THREE.MeshStandardMaterial({ color: 0x8663a8, roughness: 0.8 }),
  new THREE.MeshStandardMaterial({ color: 0xd9a43c, roughness: 0.8 }),
] as const;

const ROSE_BLOSSOM_TEXTURE_PATH = '/assets/textures/vegetation/rose_blossom_card.png';
const roseBlossomTexture = typeof document === 'undefined'
  ? null
  : new THREE.TextureLoader().load(ROSE_BLOSSOM_TEXTURE_PATH);
if (roseBlossomTexture) {
  roseBlossomTexture.colorSpace = THREE.SRGBColorSpace;
  roseBlossomTexture.wrapS = THREE.ClampToEdgeWrapping;
  roseBlossomTexture.wrapT = THREE.ClampToEdgeWrapping;
}

const ROSE_CARD_MATERIALS = FLOWER_MATERIALS.slice(0, 3).map((flowerMaterial) => {
  const material = new THREE.SpriteMaterial({
    map: roseBlossomTexture,
    color: flowerMaterial.color,
    transparent: true,
    alphaTest: 0.18,
    depthWrite: true,
  });
  material.name = 'Textured rose blossom material';
  return material;
});

type BackyardSwayBinding = {
  object: THREE.Object3D;
  basePosition: THREE.Vector3;
  baseRotation: THREE.Euler;
  phase: number;
  translation: number;
  tilt: number;
};

function addMesh(
  parent: THREE.Object3D,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  x: number,
  y: number,
  z: number,
  rotation = new THREE.Euler(),
  scale = new THREE.Vector3(1, 1, 1),
  name?: string,
): THREE.Mesh {
  const mesh = new THREE.Mesh(prepareBuildingGeometryUvs(geometry, material), material);
  mesh.position.set(x, y, z);
  mesh.rotation.copy(rotation);
  mesh.scale.copy(scale);
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  if (name) mesh.name = name;
  parent.add(mesh);
  return mesh;
}

function addFlowerHead(
  parent: THREE.Object3D,
  name: string,
  material: THREE.Material,
  scale: number,
  rose = false,
): THREE.Group {
  const flower = new THREE.Group();
  flower.name = name;
  parent.add(flower);
  const color = (material as THREE.MeshStandardMaterial).color?.clone()
    ?? new THREE.Color(0xffffff);
  const parts: THREE.BufferGeometry[] = [];
  const petalGeometry = createRoundedPetalGeometry();
  const addPetalLayer = (
    count: number,
    radius: number,
    petalScale: THREE.Vector3,
    yawOffset: number,
    layerY: number,
  ) => {
    for (let index = 0; index < count; index++) {
      const angle = yawOffset + (index / count) * Math.PI * 2;
      parts.push(coloredFlowerPart(
        petalGeometry.clone(),
        color,
        new THREE.Vector3(Math.sin(angle) * radius, layerY, Math.cos(angle) * radius),
        new THREE.Euler(0, angle, 0),
        petalScale,
        scale,
      ));
    }
  };

  const petalCount = rose ? 12 : 6;
  if (rose) {
    addPetalLayer(7, 0.011, new THREE.Vector3(1, 0.86, 1), 0, 0);
    addPetalLayer(5, 0.0035, new THREE.Vector3(0.72, 0.88, 0.68), Math.PI / 5, 0.004);
  } else {
    addPetalLayer(6, 0.01, new THREE.Vector3(0.92, 0.9, 1), 0, 0);
  }
  petalGeometry.dispose();
  parts.push(coloredFlowerPart(
    new THREE.SphereGeometry(rose ? 0.0065 : 0.008, 12, 7),
    rose ? color.clone().multiplyScalar(0.72) : MATERIALS.flowerCenter.color,
    new THREE.Vector3(0, rose ? 0.006 : 0.004, 0),
    new THREE.Euler(),
    rose ? new THREE.Vector3(1, 0.68, 1) : new THREE.Vector3(1, 0.74, 1),
    scale,
  ));

  const geometry = mergeGeometries(parts, false);
  if (!geometry) throw new Error(`Could not merge ${name} geometry.`);
  const mesh = addMesh(
    flower,
    geometry,
    MATERIALS.flowerVertex,
    0,
    0,
    0,
    undefined,
    undefined,
    rose ? 'Modeled rose blossom' : 'Modeled cottage flower',
  );
  mesh.userData.petalCount = petalCount;
  mesh.userData.realWorldDiameterM = 0.088 * scale;
  return flower;
}

/**
 * A gently cupped, rounded petal in metres. Six longitudinal sections and a
 * center rib keep the silhouette soft without turning each small bloom into a
 * high-poly prop.
 */
function createRoundedPetalGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  const lengths = [0, 0.006, 0.014, 0.023, 0.03, 0.034] as const;
  const halfWidths = [0.0015, 0.0085, 0.0135, 0.0145, 0.0095, 0.0028] as const;
  const cupHeights = [0, 0.0012, 0.0034, 0.0054, 0.0062, 0.005] as const;
  const shade = [0.7, 0.82, 0.95, 1, 1.06, 1.1] as const;
  const positions: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  for (let row = 0; row < lengths.length; row++) {
    for (let column = 0; column < 3; column++) {
      const across = column - 1;
      const edgeCurl = Math.abs(across) * cupHeights[row]! * 0.28;
      positions.push(
        across * halfWidths[row]!,
        cupHeights[row]! - edgeCurl,
        lengths[row]!,
      );
      uvs.push(column * 0.5, row / (lengths.length - 1));
      colors.push(shade[row]!, shade[row]!, shade[row]!);
    }
  }

  for (let row = 0; row < lengths.length - 1; row++) {
    const lower = row * 3;
    const upper = (row + 1) * 3;
    indices.push(
      lower, upper, upper + 1,
      lower, upper + 1, lower + 1,
      lower + 1, upper + 1, upper + 2,
      lower + 1, upper + 2, lower + 2,
    );
  }

  geometry.setIndex(indices);
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function createLanceolateFlowerLeafGeometry(
  length: number,
  halfWidth: number,
): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  const rowFractions = [0, 0.2, 0.46, 0.7, 0.88, 1] as const;
  const widthFactors = [0.08, 0.58, 1, 0.88, 0.48, 0.04] as const;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let row = 0; row < rowFractions.length; row++) {
    const t = rowFractions[row]!;
    const width = halfWidth * widthFactors[row]!;
    const curl = Math.sin(t * Math.PI) * length * 0.075;
    for (let column = 0; column < 3; column++) {
      const across = column - 1;
      positions.push(
        t * length,
        curl - Math.abs(across) * curl * 0.3,
        across * width,
      );
      uvs.push(t, column * 0.5);
    }
  }

  for (let row = 0; row < rowFractions.length - 1; row++) {
    const lower = row * 3;
    const upper = (row + 1) * 3;
    indices.push(
      lower, upper + 1, upper,
      lower, lower + 1, upper + 1,
      lower + 1, upper + 2, upper + 1,
      lower + 1, lower + 2, upper + 2,
    );
  }

  geometry.setIndex(indices);
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function addTexturedRoseCard(
  parent: THREE.Object3D,
  material: THREE.SpriteMaterial,
  scale: number,
): THREE.Sprite {
  const roseCard = new THREE.Sprite(material);
  roseCard.name = 'Textured rose blossom card';
  roseCard.position.y = 0.035;
  roseCard.scale.setScalar(scale);
  roseCard.renderOrder = 6;
  roseCard.userData.texturePath = ROSE_BLOSSOM_TEXTURE_PATH;
  parent.add(roseCard);
  return roseCard;
}

function coloredFlowerPart(
  geometry: THREE.BufferGeometry,
  color: THREE.Color,
  position: THREE.Vector3,
  rotation: THREE.Euler,
  partScale: THREE.Vector3,
  flowerScale: number,
): THREE.BufferGeometry {
  const matrix = new THREE.Matrix4().compose(
    position.clone().multiplyScalar(flowerScale),
    new THREE.Quaternion().setFromEuler(rotation),
    partScale.clone().multiplyScalar(flowerScale),
  );
  geometry.applyMatrix4(matrix);
  const vertexCount = geometry.getAttribute('position').count;
  const colors = new Float32Array(vertexCount * 3);
  const sourceColors = geometry.getAttribute('color');
  for (let index = 0; index < vertexCount; index++) {
    colors[index * 3] = color.r * (sourceColors?.getX(index) ?? 1);
    colors[index * 3 + 1] = color.g * (sourceColors?.getY(index) ?? 1);
    colors[index * 3 + 2] = color.b * (sourceColors?.getZ(index) ?? 1);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

function registerBackyardSway(
  root: THREE.Group,
  object: THREE.Object3D,
  phase: number,
  translation: number,
  tilt: number,
): void {
  const bindings = (root.userData.backyardSwayBindings ??= []) as BackyardSwayBinding[];
  bindings.push({
    object,
    basePosition: object.position.clone(),
    baseRotation: object.rotation.clone(),
    phase,
    translation,
    tilt,
  });
}

function addSoilBed(
  group: THREE.Group,
  x: number,
  z: number,
  width: number,
  depth: number,
  bordered = true,
): void {
  addMesh(group, new THREE.BoxGeometry(width, 0.1, depth), MATERIALS.soil, x, 0.05, z);
  if (!bordered) return;
  const rail = 0.11;
  addMesh(group, new THREE.BoxGeometry(width + 0.18, 0.18, rail), MATERIALS.timber, x, 0.1, z - depth * 0.5);
  addMesh(group, new THREE.BoxGeometry(width + 0.18, 0.18, rail), MATERIALS.timber, x, 0.1, z + depth * 0.5);
  addMesh(group, new THREE.BoxGeometry(rail, 0.18, depth), MATERIALS.timber, x - width * 0.5, 0.1, z);
  addMesh(group, new THREE.BoxGeometry(rail, 0.18, depth), MATERIALS.timber, x + width * 0.5, 0.1, z);
}

function addSteppingStones(group: THREE.Group, z0: number, z1: number, seed: number): void {
  const rng = mulberry32(seed ^ 0x51a77e);
  const count = Math.max(2, Math.floor(Math.abs(z1 - z0) / 0.75));
  for (let i = 0; i <= count; i++) {
    const t = i / count;
    addMesh(
      group,
      new THREE.CylinderGeometry(0.28 + rng() * 0.08, 0.31, 0.07, 7),
      MATERIALS.stone,
      (rng() - 0.5) * 0.22,
      0.055,
      THREE.MathUtils.lerp(z0, z1, t),
      new THREE.Euler(0, rng() * Math.PI, 0),
    );
  }
}

function addLowWattleFence(group: THREE.Group, width: number, z: number, seed: number): void {
  const fence = new THREE.Group();
  fence.name = 'Backyard wattle fence';
  group.add(fence);
  const postCount = Math.max(4, Math.floor(width / 1.25));
  const span = width * 0.88;
  for (let i = 0; i < postCount; i++) {
    const x = -span * 0.5 + (span * i) / (postCount - 1);
    addMesh(
      fence,
      new THREE.CylinderGeometry(0.045, 0.06, 0.68, 6),
      MATERIALS.darkTimber,
      x,
      0.34,
      z,
      new THREE.Euler(0, 0, (i % 2 ? 1 : -1) * 0.035),
    );
  }
  for (let row = 0; row < 3; row++) {
    addMesh(
      fence,
      new THREE.CylinderGeometry(0.035, 0.035, span, 6),
      MATERIALS.wicker,
      0,
      0.18 + row * 0.17,
      z + (row % 2 ? 0.025 : -0.025),
      new THREE.Euler(0, 0, Math.PI * 0.5 + (row - 1) * 0.012),
    );
  }
  group.userData.wattleSeed = seed;
}

function addBasket(
  group: THREE.Group,
  x: number,
  z: number,
  filled: boolean,
  fruit: THREE.Material,
  fruitRadius = 0.095,
  fruitCount = 5,
): void {
  addMesh(group, new THREE.CylinderGeometry(0.3, 0.23, 0.32, 10, 1, true), MATERIALS.wicker, x, 0.17, z);
  addMesh(group, new THREE.TorusGeometry(0.27, 0.035, 5, 12), MATERIALS.darkTimber, x, 0.45, z, new THREE.Euler(Math.PI * 0.5, 0, 0));
  if (!filled) return;
  for (let i = 0; i < fruitCount; i++) {
    const angle = (i / fruitCount) * Math.PI * 2;
    const ring = fruitRadius < 0.06 ? 0.08 + (i % 2) * 0.07 : 0.14;
    addMesh(
      group,
      new THREE.IcosahedronGeometry(fruitRadius, 1),
      fruit,
      x + Math.cos(angle) * ring,
      0.32 + fruitRadius + (i % 3) * fruitRadius * 0.45,
      z + Math.sin(angle) * ring,
    );
  }
}

function addFallbackTree(anchor: THREE.Group, kind: 'apple' | 'cherry', seed: number): void {
  const rng = mulberry32(seed);
  const height = kind === 'apple' ? 3.7 : 4.1;
  addMesh(anchor, new THREE.CylinderGeometry(0.14, 0.24, height * 0.55, 7), MATERIALS.darkTimber, 0, height * 0.275, 0);
  const lobes = kind === 'apple' ? 5 : 6;
  for (let i = 0; i < lobes; i++) {
    const angle = (i / lobes) * Math.PI * 2 + rng();
    const radius = i === 0 ? 0 : 0.62 + rng() * 0.28;
    addMesh(
      anchor,
      new THREE.IcosahedronGeometry(0.74 + rng() * 0.18, 1),
      i % 3 === 0 ? MATERIALS.leafLight : MATERIALS.leaf,
      Math.cos(angle) * radius,
      height * (0.64 + rng() * 0.18),
      Math.sin(angle) * radius,
      new THREE.Euler(rng(), rng(), rng()),
      new THREE.Vector3(1, 0.8, 1),
    );
  }
}

function addFruitClusters(
  anchor: THREE.Group,
  plantKind: 'apple' | 'cherry',
  variant: number,
  seed: number,
): void {
  const rng = mulberry32(seed ^ 0x9e3779b9);
  const material = plantKind === 'apple'
    ? (variant % 3 === 2 ? MATERIALS.appleGold : MATERIALS.apple)
    : MATERIALS.cherry;
  const clusterCount = plantKind === 'apple' ? 10 : 22;
  const positions: THREE.Vector3[] = [];

  for (let cluster = 0; cluster < clusterCount; cluster++) {
    const angle = rng() * Math.PI * 2;
    const radius = 0.45 + rng() * 0.8;
    const y = (plantKind === 'apple' ? 2.1 : 2.35) + rng() * 1.25;
    const center = new THREE.Vector3(
      Math.cos(angle) * radius,
      y,
      Math.sin(angle) * radius,
    );
    positions.push(center);
    if (plantKind === 'cherry') {
      positions.push(center.clone().add(new THREE.Vector3(0.048, -0.055, 0.022)));
      if (cluster % 3 === 0) {
        positions.push(center.clone().add(new THREE.Vector3(-0.04, -0.085, -0.032)));
      }
    }
  }

  const fruitRadius = plantKind === 'apple' ? 0.09 : 0.036;
  const geometry = new THREE.IcosahedronGeometry(fruitRadius, 1);
  const fruit = new THREE.InstancedMesh(geometry, material, positions.length);
  fruit.name = plantKind === 'apple' ? 'Apple fruit' : 'Cherry fruit clusters';
  fruit.userData.fruitRadius = fruitRadius;
  fruit.userData.fruitCount = positions.length;
  fruit.receiveShadow = true;
  fruit.castShadow = false;
  const matrix = new THREE.Matrix4();
  const rotation = new THREE.Quaternion();
  const scale = new THREE.Vector3(1, 1, 1);
  for (let index = 0; index < positions.length; index++) {
    matrix.compose(positions[index]!, rotation, scale);
    fruit.setMatrixAt(index, matrix);
  }
  fruit.instanceMatrix.needsUpdate = true;
  fruit.computeBoundingSphere();
  anchor.add(fruit);
}

function addFruitTree(
  group: THREE.Group,
  plantKind: 'apple' | 'cherry',
  x: number,
  z: number,
  variant: number,
  seed: number,
  plants: BackyardPlantCatalog | null,
): void {
  const anchor = new THREE.Group();
  anchor.name = `${plantKind === 'apple' ? 'AppleTree' : 'CherryTree'}:${variant}`;
  anchor.position.set(x, 0, z);
  anchor.rotation.y = mulberry32(seed)() * Math.PI * 2;
  group.add(anchor);

  if (plants) anchor.add(plants.clone(plantKind, variant));
  else addFallbackTree(anchor, plantKind, seed);

  addFruitClusters(anchor, plantKind, variant, seed);
}

function addOrchard(
  group: THREE.Group,
  kind: 'apple' | 'cherry',
  width: number,
  depth: number,
  seed: number,
  plants: BackyardPlantCatalog | null,
): void {
  const shallow = depth < 3.9;
  const treeCount = width > 5.3 && depth > 4.6 ? 3 : 2;
  const positions = treeCount === 3
    ? [[-width * 0.27, -depth * 0.18], [width * 0.24, -depth * 0.08], [0, depth * 0.28]]
    : [[-width * 0.25, shallow ? 0 : -depth * 0.12], [width * 0.25, shallow ? 0 : depth * 0.16]];
  positions.forEach(([x, z], index) => addFruitTree(group, kind, x!, z!, index, seed + index * 997, plants));
  addLowWattleFence(group, width, depth * 0.47, seed);
  addBasket(
    group,
    width * 0.34,
    -depth * 0.34,
    true,
    kind === 'apple' ? MATERIALS.apple : MATERIALS.cherry,
    kind === 'apple' ? 0.09 : 0.036,
    kind === 'apple' ? 5 : 12,
  );
  addSteppingStones(group, -depth * 0.46, depth * 0.34, seed);
}

function addCabbage(group: THREE.Group, x: number, z: number, seed: number): void {
  const rng = mulberry32(seed);
  for (let layer = 0; layer < 5; layer++) {
    const angle = (layer / 5) * Math.PI * 2;
    addMesh(
      group,
      new THREE.SphereGeometry(0.18, 7, 5),
      layer % 2 ? MATERIALS.cabbage : MATERIALS.leafLight,
      x + Math.cos(angle) * 0.1,
      0.21 + rng() * 0.035,
      z + Math.sin(angle) * 0.1,
      new THREE.Euler(0, angle, 0),
      new THREE.Vector3(1.2, 0.42, 0.72),
    );
  }
}

function addBeanTrellis(group: THREE.Group, x: number, z: number, length: number): void {
  const topY = 1.35;
  for (const dx of [-length * 0.5, 0, length * 0.5]) {
    addMesh(group, new THREE.CylinderGeometry(0.035, 0.05, topY, 6), MATERIALS.darkTimber, x + dx, topY * 0.5, z, new THREE.Euler(0, 0, dx * 0.025));
  }
  addMesh(group, new THREE.CylinderGeometry(0.035, 0.035, length + 0.12, 6), MATERIALS.darkTimber, x, topY, z, new THREE.Euler(0, 0, Math.PI * 0.5), undefined, 'BeanTrellis');
  for (let i = 0; i < 11; i++) {
    const dx = -length * 0.48 + (length * 0.96 * i) / 10;
    addMesh(group, new THREE.SphereGeometry(0.12, 6, 4), i % 2 ? MATERIALS.leaf : MATERIALS.squash, x + dx, 0.3 + (i % 4) * 0.28, z, new THREE.Euler(0, i, 0), new THREE.Vector3(1, 0.55, 0.45));
  }
}

function addVegetableGarden(group: THREE.Group, width: number, depth: number, seed: number): void {
  addMesh(group, new THREE.BoxGeometry(width, 0.04, depth), MATERIALS.path, 0, 0.02, 0);
  const bedCount = width > 5.4 ? 3 : 2;
  const gap = 0.42;
  const bedWidth = (width - gap * (bedCount + 1)) / bedCount;
  const bedDepth = Math.max(1.2, depth - 0.65);
  for (let bed = 0; bed < bedCount; bed++) {
    const x = -width * 0.5 + gap + bedWidth * 0.5 + bed * (bedWidth + gap);
    addSoilBed(group, x, 0, bedWidth, bedDepth);
    if (bed === bedCount - 1 && depth > 3.2) {
      addBeanTrellis(group, x, 0, bedWidth * 0.75);
      continue;
    }
    const cols = Math.max(2, Math.floor(bedWidth / 0.52));
    const rows = Math.max(2, Math.floor(bedDepth / 0.65));
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        addCabbage(
          group,
          x - ((cols - 1) * 0.48) * 0.5 + col * 0.48,
          -((rows - 1) * 0.61) * 0.5 + row * 0.61,
          seed + bed * 101 + row * 17 + col,
        );
      }
    }
  }
  addBasket(group, width * 0.38, -depth * 0.38, false, MATERIALS.apple);
}

function addRoseShrub(
  group: THREE.Group,
  x: number,
  z: number,
  index: number,
  seed: number,
  plants: BackyardPlantCatalog | null,
): void {
  const anchor = new THREE.Group();
  anchor.name = `RoseBush:${index}`;
  anchor.position.set(x, 0, z);
  anchor.rotation.y = mulberry32(seed)() * Math.PI * 2;
  group.add(anchor);
  if (plants) anchor.add(plants.clone('rose', index));
  else {
    for (let branch = 0; branch < 7; branch++) {
      const angle = (branch / 7) * Math.PI * 2;
      addMesh(anchor, new THREE.CylinderGeometry(0.018, 0.03, 0.75, 5), MATERIALS.darkTimber, Math.cos(angle) * 0.16, 0.38, Math.sin(angle) * 0.16, new THREE.Euler(Math.cos(angle) * 0.2, 0, -Math.sin(angle) * 0.2));
      addMesh(anchor, new THREE.IcosahedronGeometry(0.24, 1), branch % 2 ? MATERIALS.leaf : MATERIALS.leafLight, Math.cos(angle) * 0.27, 0.62 + (branch % 3) * 0.12, Math.sin(angle) * 0.27, undefined, new THREE.Vector3(1, 0.7, 1));
    }
  }
  const flower = FLOWER_MATERIALS[index % 3]!;
  const roseCard = ROSE_CARD_MATERIALS[index % 3]!;
  for (let bloom = 0; bloom < 8; bloom++) {
    const angle = (bloom / 8) * Math.PI * 2 + index * 0.37;
    const bloomRoot = new THREE.Group();
    bloomRoot.name = `Swaying rose bloom ${index + 1}.${bloom + 1}`;
    const radius = 0.28 + (bloom % 2) * 0.14;
    bloomRoot.position.set(
      Math.cos(angle) * radius,
      0.66 + (bloom % 3) * 0.14,
      Math.sin(angle) * radius,
    );
    bloomRoot.rotation.y = angle;
    anchor.add(bloomRoot);
    addFlowerHead(
      bloomRoot,
      'Layered rose flower',
      flower,
      0.62 + (bloom % 3) * 0.045,
      true,
    );
    addTexturedRoseCard(bloomRoot, roseCard, 0.052 + (bloom % 3) * 0.003);
    registerBackyardSway(
      group,
      bloomRoot,
      seed * 0.0007 + angle,
      plants ? 0.075 : 0.025,
      plants ? 0.065 : 0.035,
    );
  }
}

function addFlowerGarden(
  group: THREE.Group,
  width: number,
  depth: number,
  seed: number,
  plants: BackyardPlantCatalog | null,
): void {
  const sideWidth = Math.max(1.25, width * 0.34);
  addSoilBed(group, -width * 0.29, 0, sideWidth, depth * 0.82, false);
  addSoilBed(group, width * 0.29, 0, sideWidth, depth * 0.82, false);
  const roseCount = width > 5.2 ? 4 : 3;
  for (let i = 0; i < roseCount; i++) {
    const side = i % 2 ? 1 : -1;
    const row = Math.floor(i / 2);
    addRoseShrub(group, side * width * 0.28, (row - 0.5) * Math.min(1.75, depth * 0.35), i, seed + i * 311, plants);
  }
  const rng = mulberry32(seed ^ 0xaf413);
  for (let i = 0; i < Math.max(12, Math.floor(width * depth * 0.7)); i++) {
    const side = i % 2 ? 1 : -1;
    const x = side * (width * 0.16 + rng() * width * 0.26);
    const z = (rng() - 0.5) * depth * 0.72;
    const h = 0.18 + rng() * 0.22;
    const wildflower = new THREE.Group();
    wildflower.name = `Swaying cottage flower ${i + 1}`;
    wildflower.position.set(x, 0.08, z);
    wildflower.rotation.y = rng() * Math.PI * 2;
    group.add(wildflower);
    const stem = addMesh(
      wildflower,
      new THREE.CylinderGeometry(0.0022, 0.0035, h, 8, 3),
      MATERIALS.flowerStem,
      0,
      h * 0.5,
      0,
      undefined,
      undefined,
      'Flower stem',
    );
    stem.userData.maxDiameterM = 0.007;
    for (const direction of [-1, 1]) {
      addMesh(
        wildflower,
        createLanceolateFlowerLeafGeometry(0.06, 0.013),
        i % 2 ? MATERIALS.herb : MATERIALS.herbSilver,
        0,
        h * (direction < 0 ? 0.42 : 0.62),
        0,
        new THREE.Euler(
          0,
          direction < 0 ? Math.PI : 0,
          direction * 0.38,
        ),
        undefined,
        'Flower stem leaf',
      );
    }
    const head = new THREE.Group();
    head.position.y = h;
    head.rotation.y = rng() * Math.PI;
    wildflower.add(head);
    addFlowerHead(
      head,
      'Six-petal cottage flower',
      FLOWER_MATERIALS[(i + 3) % FLOWER_MATERIALS.length]!,
      0.48 + rng() * 0.16,
    );
    registerBackyardSway(
      group,
      wildflower,
      seed * 0.0009 + x * 0.35 + z * 0.27,
      0,
      0.075 + rng() * 0.035,
    );
  }
  addSteppingStones(group, -depth * 0.45, depth * 0.42, seed);
}

function addHerbClump(group: THREE.Group, x: number, z: number, kind: number, seed: number): void {
  const rng = mulberry32(seed);
  const material = kind % 2 ? MATERIALS.herbSilver : MATERIALS.herb;
  const stalks = 5 + (kind % 3);
  for (let i = 0; i < stalks; i++) {
    const angle = (i / stalks) * Math.PI * 2;
    const h = 0.25 + rng() * 0.3;
    addMesh(group, new THREE.CylinderGeometry(0.012, 0.018, h, 5), material, x + Math.cos(angle) * 0.11, 0.16 + h * 0.5, z + Math.sin(angle) * 0.11, new THREE.Euler(Math.cos(angle) * 0.16, 0, -Math.sin(angle) * 0.16));
    addMesh(group, new THREE.SphereGeometry(0.095, 6, 4), material, x + Math.cos(angle) * 0.17, 0.18 + h, z + Math.sin(angle) * 0.17, undefined, new THREE.Vector3(1, 0.45, 0.65));
    if (kind === 2 && i % 2 === 0) addMesh(group, new THREE.IcosahedronGeometry(0.045, 0), FLOWER_MATERIALS[3], x + Math.cos(angle) * 0.17, 0.25 + h, z + Math.sin(angle) * 0.17);
  }
}

function addDryingRack(group: THREE.Group, x: number, z: number): void {
  for (const dx of [-0.55, 0.55]) {
    addMesh(group, new THREE.CylinderGeometry(0.035, 0.05, 1.2, 6), MATERIALS.darkTimber, x + dx, 0.6, z);
  }
  addMesh(group, new THREE.CylinderGeometry(0.035, 0.035, 1.25, 6), MATERIALS.darkTimber, x, 1.16, z, new THREE.Euler(0, 0, Math.PI * 0.5), undefined, 'HerbDryingRack');
  for (let i = 0; i < 4; i++) {
    const dx = -0.42 + i * 0.28;
    addMesh(group, new THREE.CylinderGeometry(0.035, 0.08, 0.5, 6), i % 2 ? MATERIALS.herbSilver : MATERIALS.herb, x + dx, 0.82, z, new THREE.Euler(0, 0, Math.PI));
  }
}

function addHerbGarden(group: THREE.Group, width: number, depth: number, seed: number): void {
  addMesh(group, new THREE.BoxGeometry(width, 0.04, depth), MATERIALS.path, 0, 0.02, 0);
  const rackSpace = depth > 3.7 ? 1.15 : 0;
  const plotDepth = Math.max(1.1, depth - 0.65 - rackSpace);
  const plotZ = rackSpace > 0 ? -rackSpace * 0.35 : 0;
  const plotW = (width - 0.85) * 0.5;
  for (let side = 0; side < 2; side++) {
    const x = (side ? 1 : -1) * (plotW * 0.5 + 0.18);
    addSoilBed(group, x, plotZ, plotW, plotDepth);
    const cols = Math.max(2, Math.floor(plotW / 0.65));
    const rows = Math.max(2, Math.floor(plotDepth / 0.72));
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        addHerbClump(group, x - ((cols - 1) * 0.58) * 0.5 + col * 0.58, plotZ - ((rows - 1) * 0.66) * 0.5 + row * 0.66, (side + row + col) % 3, seed + side * 101 + row * 13 + col);
      }
    }
  }
  if (rackSpace > 0) addDryingRack(group, 0, depth * 0.36);
  addMesh(group, new THREE.CylinderGeometry(0.21, 0.28, 0.42, 10), MATERIALS.terracotta, -width * 0.4, 0.22, -depth * 0.38);
}

function addHenYard(group: THREE.Group, width: number, depth: number, seed: number): void {
  const rng = mulberry32(seed ^ 0x4e57a11);
  const coopWidth = Math.min(2.4, width * 0.42);
  const coopDepth = Math.min(1.9, depth * 0.38);
  const coopX = -width * 0.24;
  const coopZ = -depth * 0.24;
  addMesh(group, new THREE.BoxGeometry(coopWidth, 1.15, coopDepth), MATERIALS.timber, coopX, 0.72, coopZ);
  addMesh(group, new THREE.ConeGeometry(Math.max(coopWidth, coopDepth) * 0.72, 0.75, 4), MATERIALS.darkTimber, coopX, 1.65, coopZ, new THREE.Euler(0, Math.PI * 0.25, 0));
  addMesh(group, new THREE.BoxGeometry(0.62, 0.72, 0.08), MATERIALS.darkSoil, coopX + 0.35, 0.58, coopZ + coopDepth * 0.52, new THREE.Euler(), undefined, 'HenCoopDoor');
  for (let rung = 0; rung < 4; rung++) {
    addMesh(group, new THREE.BoxGeometry(0.82, 0.07, 0.08), MATERIALS.wicker, coopX + 0.35, 0.18 + rung * 0.18, coopZ + coopDepth * 0.68 + rung * 0.12);
  }
  for (const x of [-width * 0.48, width * 0.48]) {
    for (const z of [-depth * 0.44, depth * 0.44]) {
      addMesh(group, new THREE.CylinderGeometry(0.045, 0.06, 0.95, 6), MATERIALS.darkTimber, x, 0.48, z);
    }
  }
  for (const z of [-depth * 0.44, depth * 0.44]) {
    addMesh(group, new THREE.BoxGeometry(width * 0.96, 0.055, 0.055), MATERIALS.wicker, 0, 0.45, z);
    addMesh(group, new THREE.BoxGeometry(width * 0.96, 0.055, 0.055), MATERIALS.wicker, 0, 0.78, z);
  }
  for (const x of [-width * 0.48, width * 0.48]) {
    addMesh(group, new THREE.BoxGeometry(0.055, 0.055, depth * 0.88), MATERIALS.wicker, x, 0.45, 0);
    addMesh(group, new THREE.BoxGeometry(0.055, 0.055, depth * 0.88), MATERIALS.wicker, x, 0.78, 0);
  }
  // Lightweight fallback birds are replaced by the freely licensed animated asset when available.
  for (let i = 0; i < Math.max(3, Math.min(6, Math.round(width * depth / 6))); i++) {
    const x = (rng() - 0.34) * width * 0.72;
    const z = (rng() - 0.2) * depth * 0.62;
    const bird = new THREE.Group();
    bird.name = 'HenFallback';
    addMesh(bird, new THREE.SphereGeometry(0.19, 7, 5), i === 0 ? MATERIALS.darkTimber : MATERIALS.wicker, 0, 0.22, 0, new THREE.Euler(), new THREE.Vector3(1.12, 0.88, 0.82));
    addMesh(bird, new THREE.SphereGeometry(0.11, 7, 5), MATERIALS.wicker, 0.15, 0.38, 0);
    addMesh(bird, new THREE.ConeGeometry(0.045, 0.14, 5), MATERIALS.terracotta, 0.27, 0.38, 0, new THREE.Euler(0, 0, -Math.PI * 0.5));
    bird.position.set(x, 0, z);
    bird.rotation.y = rng() * Math.PI * 2;
    group.add(bird);
  }
}

export function createBackyardGardenMesh(
  kind: BackyardGardenKind,
  options: BackyardGardenMeshOptions = {},
): THREE.Group {
  const width = THREE.MathUtils.clamp(options.width ?? 5.4, 3.8, 7.2);
  const depth = THREE.MathUtils.clamp(options.depth ?? 4.6, 1.8, 8.2);
  const seed = options.seed ?? 1;
  const plants = options.plants ?? null;
  const group = new THREE.Group();
  group.name = `BackyardGarden:${kind}`;
  group.userData.gardenKind = kind;
  group.userData.footprint = { width, depth };
  group.userData.usesSeedThree = Boolean(plants);

  switch (kind) {
    case 'apple_orchard':
      addOrchard(group, 'apple', width, depth, seed, plants);
      break;
    case 'cherry_orchard':
      addOrchard(group, 'cherry', width, depth, seed, plants);
      break;
    case 'vegetable_garden':
      addVegetableGarden(group, width, depth, seed);
      break;
    case 'flower_garden':
      addFlowerGarden(group, width, depth, seed, plants);
      break;
    case 'herb_garden':
      addHerbGarden(group, width, depth, seed);
      break;
    case 'hen_yard':
      addHenYard(group, width, depth, seed);
      break;
    default: {
      const unreachable: never = kind;
      throw new Error(`Unknown backyard garden kind: ${unreachable}`);
    }
  }

  return group;
}

/** Keeps modeled blossoms moving with SeedThree shrubs and bends bed flowers from their roots. */
export function animateBackyardGardenMesh(
  group: THREE.Group,
  elapsedSeconds: number,
): void {
  const bindings = group.userData.backyardSwayBindings as BackyardSwayBinding[] | undefined;
  if (!bindings?.length) return;

  for (const binding of bindings) {
    const phase = binding.phase;
    const sway = Math.sin(elapsedSeconds * 1.15 + phase) * 0.72
      + Math.sin(elapsedSeconds * 2.63 + phase * 1.9) * 0.28;
    binding.object.position.set(
      binding.basePosition.x + sway * binding.translation * 0.85,
      binding.basePosition.y,
      binding.basePosition.z + sway * binding.translation * 0.53,
    );
    binding.object.rotation.set(
      binding.baseRotation.x + sway * binding.tilt * 0.28,
      binding.baseRotation.y,
      binding.baseRotation.z - sway * binding.tilt,
    );
  }
}

/** Dispose only geometry owned by a garden instance; SeedThree clones share prototypes. */
export function disposeBackyardGardenMesh(group: THREE.Group): void {
  group.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || mesh.userData.backyardSharedGeometry) return;
    mesh.geometry.dispose();
  });
}
