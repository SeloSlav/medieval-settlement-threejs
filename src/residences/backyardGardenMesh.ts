import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  BACKYARD_GARDEN_DEFINITIONS,
  type BackyardGardenKind,
} from '../generated/gameBalance.ts';
import {
  sharedBuildingDetailMaterial,
  sharedBuildingMaterial,
} from '../buildings/buildingMaterials.ts';
import { prepareBuildingGeometryUvs } from '../buildings/buildingMetricUvs.ts';
import { mulberry32 } from '../utils/random.ts';
import type { BackyardPlantCatalog } from '../vegetation/seedthree/backyardPlantAssets.ts';
import { backyardGardenPhenology } from '../economy/backyardGardenTick.ts';
import {
  deciduousFoliageForClock,
  type DeciduousFoliagePresentation,
} from '../world/deciduousFoliagePolicy.ts';

export type BackyardGardenMeshOptions = {
  width?: number;
  depth?: number;
  seed?: number;
  plants?: BackyardPlantCatalog | null;
  flowerLuxuryUpgraded?: boolean;
};

const FLOWER_STEM_MAP_SIZE = 64;
const MAX_GARDEN_GRID_COLUMNS = 8;
const MAX_GARDEN_GRID_ROWS = 24;
const MAX_FLOWER_GARDEN_STEMS = 160;
const MAX_GARDEN_STEPPING_STONES = 48;
const ORCHARD_SPRING_LEAF_COLOR = 0xb6d965;
const ORCHARD_AUTUMN_LEAF_COLOR = {
  apple: 0xd1762b,
  cherry: 0xc84d32,
  pear: 0xc79932,
} as const;

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

const KITCHEN_CROP_TEXTURE_PATHS = {
  cabbage: '/assets/textures/vegetation/kitchen_crops/cabbage_leaf.png',
  carrot: '/assets/textures/vegetation/kitchen_crops/carrot_frond.png',
  turnip: '/assets/textures/vegetation/kitchen_crops/turnip_leaf.png',
} as const;

const KITCHEN_HERB_TEXTURE_PATHS = {
  parsley: '/assets/textures/vegetation/kitchen_herbs/parsley_clump.png',
  rosemary: '/assets/textures/vegetation/kitchen_herbs/rosemary_clump.png',
  sage: '/assets/textures/vegetation/kitchen_herbs/sage_clump.png',
} as const;

const GARDEN_BED_SOIL_TEXTURE_PATHS = {
  albedo: '/assets/textures/terrain/mammoth_terrain_dirt/albedo.png',
  normal: '/assets/textures/terrain/mammoth_terrain_dirt/normal.png',
  roughness: '/assets/textures/terrain/mammoth_terrain_dirt/roughness.png',
} as const;

function loadKitchenCropTexture(path: string, name: string): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const texture = new THREE.TextureLoader().load(path);
  texture.name = name;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.anisotropy = 4;
  return texture;
}

const KITCHEN_CROP_TEXTURES = {
  cabbage: loadKitchenCropTexture(KITCHEN_CROP_TEXTURE_PATHS.cabbage, 'Generated cabbage leaf cutout'),
  carrot: loadKitchenCropTexture(KITCHEN_CROP_TEXTURE_PATHS.carrot, 'Generated carrot frond cutout'),
  turnip: loadKitchenCropTexture(KITCHEN_CROP_TEXTURE_PATHS.turnip, 'Generated turnip leaf cutout'),
} as const;

const KITCHEN_HERB_TEXTURES = {
  parsley: loadKitchenCropTexture(KITCHEN_HERB_TEXTURE_PATHS.parsley, 'Generated parsley clump cutout'),
  rosemary: loadKitchenCropTexture(KITCHEN_HERB_TEXTURE_PATHS.rosemary, 'Generated rosemary clump cutout'),
  sage: loadKitchenCropTexture(KITCHEN_HERB_TEXTURE_PATHS.sage, 'Generated sage clump cutout'),
} as const;

const GARDEN_BED_SOIL_TEXTURES = {
  albedo: loadKitchenCropTexture(
    GARDEN_BED_SOIL_TEXTURE_PATHS.albedo,
    'Existing dark garden-soil albedo',
  ),
  normal: loadKitchenCropTexture(
    GARDEN_BED_SOIL_TEXTURE_PATHS.normal,
    'Existing dark garden-soil normal',
  ),
  roughness: loadKitchenCropTexture(
    GARDEN_BED_SOIL_TEXTURE_PATHS.roughness,
    'Existing dark garden-soil roughness',
  ),
} as const;

for (const texture of Object.values(GARDEN_BED_SOIL_TEXTURES)) {
  if (!texture) continue;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 8;
}
if (GARDEN_BED_SOIL_TEXTURES.normal) {
  GARDEN_BED_SOIL_TEXTURES.normal.colorSpace = THREE.NoColorSpace;
}
if (GARDEN_BED_SOIL_TEXTURES.roughness) {
  GARDEN_BED_SOIL_TEXTURES.roughness.colorSpace = THREE.NoColorSpace;
}

const MATERIALS = {
  gardenSoil: new THREE.MeshStandardMaterial({
    name: 'Textured dark garden-bed soil',
    color: 0x8b7765,
    map: GARDEN_BED_SOIL_TEXTURES.albedo,
    normalMap: GARDEN_BED_SOIL_TEXTURES.normal,
    normalScale: new THREE.Vector2(0.38, 0.38),
    roughnessMap: GARDEN_BED_SOIL_TEXTURES.roughness,
    roughness: 1,
    metalness: 0,
  }),
  darkSoil: new THREE.MeshStandardMaterial({ color: 0x35271d, roughness: 0.98 }),
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
  pear: new THREE.MeshStandardMaterial({ color: 0x9aaa43, roughness: 0.78 }),
  aronia: new THREE.MeshStandardMaterial({ color: 0x242137, roughness: 0.7 }),
  rosehip: new THREE.MeshStandardMaterial({ color: 0xba482f, roughness: 0.76 }),
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
  cabbageLeafCard: new THREE.MeshStandardMaterial({
    name: 'Generated cabbage leaf material',
    color: 0xffffff,
    map: KITCHEN_CROP_TEXTURES.cabbage,
    emissive: 0x182014,
    emissiveIntensity: 0.16,
    roughness: 0.92,
    transparent: true,
    alphaTest: 0.16,
    side: THREE.DoubleSide,
  }),
  carrotFrondCard: new THREE.MeshStandardMaterial({
    name: 'Generated carrot frond material',
    color: 0xffffff,
    map: KITCHEN_CROP_TEXTURES.carrot,
    emissive: 0x182014,
    emissiveIntensity: 0.18,
    roughness: 0.91,
    transparent: true,
    alphaTest: 0.16,
    side: THREE.DoubleSide,
  }),
  turnipLeafCard: new THREE.MeshStandardMaterial({
    name: 'Generated turnip leaf material',
    color: 0xffffff,
    map: KITCHEN_CROP_TEXTURES.turnip,
    emissive: 0x182014,
    emissiveIntensity: 0.16,
    roughness: 0.92,
    transparent: true,
    alphaTest: 0.16,
    side: THREE.DoubleSide,
  }),
  parsleyCard: new THREE.MeshStandardMaterial({
    name: 'Generated parsley material',
    color: 0xffffff,
    map: KITCHEN_HERB_TEXTURES.parsley,
    roughness: 0.92,
    transparent: true,
    alphaTest: 0.16,
    side: THREE.DoubleSide,
  }),
  rosemaryCard: new THREE.MeshStandardMaterial({
    name: 'Generated rosemary material',
    color: 0xffffff,
    map: KITCHEN_HERB_TEXTURES.rosemary,
    roughness: 0.94,
    transparent: true,
    alphaTest: 0.16,
    side: THREE.DoubleSide,
  }),
  sageCard: new THREE.MeshStandardMaterial({
    name: 'Generated sage material',
    color: 0xffffff,
    map: KITCHEN_HERB_TEXTURES.sage,
    roughness: 0.96,
    transparent: true,
    alphaTest: 0.16,
    side: THREE.DoubleSide,
  }),
  terracotta: new THREE.MeshStandardMaterial({ color: 0x9b4c36, roughness: 0.88 }),
  straw: new THREE.MeshStandardMaterial({ color: 0xb28a49, roughness: 0.96 }),
  goat: new THREE.MeshStandardMaterial({ color: 0x9b8062, roughness: 0.92 }),
  goatDark: new THREE.MeshStandardMaterial({ color: 0x4a382c, roughness: 0.94 }),
  water: sharedBuildingDetailMaterial('water'),
  collisionProxy: new THREE.MeshBasicMaterial({ visible: false }),
} as const;

MATERIALS.gardenSoil.userData.metricUvMeters = 2.2;
MATERIALS.gardenSoil.userData.pbrTexturePaths = GARDEN_BED_SOIL_TEXTURE_PATHS;

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
  options: {
    bordered?: boolean;
    profile?: 'ground-level' | 'raised';
    soilMaterial?: THREE.Material;
    soilName?: string;
  } = {},
): void {
  const {
    bordered = true,
    profile = 'raised',
    soilMaterial = MATERIALS.gardenSoil,
    soilName = 'Textured garden soil bed',
  } = options;
  const groundLevel = profile === 'ground-level';
  addMesh(
    group,
    groundLevel
      ? new THREE.PlaneGeometry(width, depth)
      : new THREE.BoxGeometry(width, 0.1, depth),
    soilMaterial,
    x,
    groundLevel ? 0.006 : 0.05,
    z,
    groundLevel ? new THREE.Euler(-Math.PI * 0.5, 0, 0) : undefined,
    undefined,
    soilName,
  );
  if (!bordered) return;
  const rail = 0.11;
  const sideRailDepth = Math.max(rail, depth - rail);
  addMesh(group, new THREE.BoxGeometry(width + rail, 0.18, rail), MATERIALS.timber, x, 0.1, z - depth * 0.5, undefined, undefined, 'Garden bed end rail');
  addMesh(group, new THREE.BoxGeometry(width + rail, 0.18, rail), MATERIALS.timber, x, 0.1, z + depth * 0.5, undefined, undefined, 'Garden bed end rail');
  addMesh(group, new THREE.BoxGeometry(rail, 0.18, sideRailDepth), MATERIALS.timber, x - width * 0.5, 0.1, z, undefined, undefined, 'Garden bed side rail');
  addMesh(group, new THREE.BoxGeometry(rail, 0.18, sideRailDepth), MATERIALS.timber, x + width * 0.5, 0.1, z, undefined, undefined, 'Garden bed side rail');
}

function addSteppingStones(
  group: THREE.Group,
  z0: number,
  z1: number,
  seed: number,
  collidable = true,
): void {
  const rng = mulberry32(seed ^ 0x51a77e);
  const count = Math.min(
    MAX_GARDEN_STEPPING_STONES,
    Math.max(2, Math.floor(Math.abs(z1 - z0) / 0.75)),
  );
  for (let i = 0; i <= count; i++) {
    const t = i / count;
    const stone = addMesh(
      group,
      new THREE.CylinderGeometry(0.28 + rng() * 0.08, 0.31, 0.07, 7),
      MATERIALS.stone,
      (rng() - 0.5) * 0.22,
      0.055,
      THREE.MathUtils.lerp(z0, z1, t),
      new THREE.Euler(0, rng() * Math.PI, 0),
      undefined,
      'Orchard stepping stone',
    );
    stone.userData.fpNoCollision = !collidable;
  }
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
  const basket = new THREE.Group();
  basket.name = 'Harvest basket';
  basket.position.set(x, 0, z);
  basket.userData.fpCollisionAggregate = true;
  group.add(basket);
  addMesh(
    basket,
    new THREE.CylinderGeometry(0.3, 0.23, 0.32, 10, 1, true),
    MATERIALS.wicker,
    0,
    0.17,
    0,
    undefined,
    undefined,
    'Wicker basket body',
  );
  addMesh(
    basket,
    new THREE.TorusGeometry(0.27, 0.035, 5, 12),
    MATERIALS.darkTimber,
    0,
    0.45,
    0,
    new THREE.Euler(Math.PI * 0.5, 0, 0),
    undefined,
    'Wicker basket handle',
  );
  if (!filled) return;
  for (let i = 0; i < fruitCount; i++) {
    const angle = (i / fruitCount) * Math.PI * 2;
    const ring = fruitRadius < 0.06 ? 0.08 + (i % 2) * 0.07 : 0.14;
    const basketFruit = addMesh(
      basket,
      new THREE.IcosahedronGeometry(fruitRadius, 1),
      fruit,
      Math.cos(angle) * ring,
      0.32 + fruitRadius + (i % 3) * fruitRadius * 0.45,
      Math.sin(angle) * ring,
      undefined,
      undefined,
      'Basket fruit',
    );
    basketFruit.userData.backyardSeasonalRole = 'basket-produce';
  }
}

function addFruitClusters(
  anchor: THREE.Group,
  plantKind: 'apple' | 'cherry' | 'pear',
  variant: number,
  seed: number,
  plants: BackyardPlantCatalog,
): void {
  const rng = mulberry32(seed ^ 0x9e3779b9);
  const clusterCount = plantKind === 'apple' ? 10 : plantKind === 'cherry' ? 13 : 9;
  const positions: THREE.Vector3[] = [];

  for (let cluster = 0; cluster < clusterCount; cluster++) {
    const angle = rng() * Math.PI * 2;
    const radius = 0.45 + rng() * 0.8;
    const y = (plantKind === 'apple' ? 2.1 : plantKind === 'cherry' ? 2.35 : 2.5)
      + rng() * (plantKind === 'pear' ? 1.45 : 1.25);
    const center = new THREE.Vector3(
      Math.cos(angle) * radius,
      y,
      Math.sin(angle) * radius,
    );
    positions.push(center);
  }

  const fruit = plants.createFruitInstances(plantKind, positions, variant);
  fruit.userData.fpNoCollision = true;
  fruit.userData.backyardSeasonalRole = 'orchard-fruit';
  anchor.add(fruit);
}

function addFruitTreeCollisionProxy(
  anchor: THREE.Group,
  plantKind: 'apple' | 'cherry' | 'pear',
): void {
  const height = plantKind === 'apple' ? 1.72 : plantKind === 'cherry' ? 2.02 : 2.2;
  const radius = plantKind === 'apple' ? 0.22 : plantKind === 'cherry' ? 0.2 : 0.19;
  const label = plantKind === 'apple' ? 'Apple' : plantKind === 'cherry' ? 'Cherry' : 'Pear';
  const proxy = addMesh(
    anchor,
    new THREE.CylinderGeometry(radius, radius * 1.18, height, 8),
    MATERIALS.collisionProxy,
    0,
    height * 0.5,
    0,
    undefined,
    undefined,
    `${label} tree trunk collision proxy`,
  );
  proxy.userData.fpCollisionProxy = true;
}

function addFruitTree(
  group: THREE.Group,
  plantKind: 'apple' | 'cherry' | 'pear',
  x: number,
  z: number,
  variant: number,
  seed: number,
  plants: BackyardPlantCatalog | null,
): void {
  const anchor = new THREE.Group();
  const label = plantKind === 'apple' ? 'AppleTree' : plantKind === 'cherry' ? 'CherryTree' : 'PearTree';
  anchor.name = `${label}:${variant}`;
  anchor.position.set(x, 0, z);
  anchor.rotation.y = mulberry32(seed)() * Math.PI * 2;
  // Backyard orchards are managed semi-dwarf standards. SeedThree species
  // retain botanical metre scales for the forest/catalog; this plot-local
  // transform keeps crowns legible without swallowing the cottage parcel.
  anchor.scale.setScalar(plantKind === 'apple' ? 0.76 : plantKind === 'cherry' ? 0.64 : 0.68);
  anchor.userData.backyardMaturityAnchor = true;
  group.add(anchor);

  // Never substitute a procedural tree while the SeedThree catalog is
  // pending or unavailable. The gameplay orchard remains valid and its
  // authored non-vegetation props stay visible until the real tree is ready.
  if (!plants) return;
  const tree = plants.clone(plantKind, variant);
  tree.userData.fpNoCollision = true;
  tree.traverse((object) => {
    const foliage = object as THREE.InstancedMesh;
    if (!foliage.isInstancedMesh || foliage.name !== 'foliage') return;
    foliage.userData.backyardDeciduousFoliage = true;
    foliage.userData.backyardFoliageBaseCount = foliage.count;
  });
  anchor.add(tree);
  addFruitClusters(anchor, plantKind, variant, seed, plants);
  addFruitTreeCollisionProxy(anchor, plantKind);
  anchor.userData.fpCollisionAggregate = true;
}

function orchardTreeGrid(width: number, depth: number): {
  columns: number;
  rows: number;
  positions: Array<[number, number]>;
} {
  const roomy = width > 5.3 && depth > 4.6;
  const columns = roomy || width >= depth ? 2 : 1;
  const rows = roomy || width < depth ? 2 : 1;
  const positions: Array<[number, number]> = [];

  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      positions.push([
        ((column + 0.5) / columns - 0.5) * width,
        ((row + 0.5) / rows - 0.5) * depth,
      ]);
    }
  }

  return { columns, rows, positions };
}

function addOrchard(
  group: THREE.Group,
  kind: 'apple' | 'cherry' | 'pear',
  width: number,
  depth: number,
  seed: number,
  plants: BackyardPlantCatalog | null,
): void {
  const { columns, rows, positions } = orchardTreeGrid(width, depth);
  group.userData.orchardGrid = { columns, rows };
  positions.forEach(([x, z], index) => addFruitTree(group, kind, x!, z!, index, seed + index * 997, plants));
  addBasket(
    group,
    width * 0.34,
    -depth * 0.34,
    true,
    kind === 'apple' ? MATERIALS.apple : kind === 'cherry' ? MATERIALS.cherry : MATERIALS.pear,
    kind === 'apple' ? 0.09 : kind === 'cherry' ? 0.036 : 0.082,
    kind === 'apple' ? 5 : kind === 'cherry' ? 12 : 6,
  );
}

function addPreparedOrchard(
  group: THREE.Group,
  width: number,
  depth: number,
  seed: number,
): void {
  const { columns, rows, positions } = orchardTreeGrid(width, depth);
  group.userData.orchardGrid = { columns, rows };
  group.userData.orchardAwaitingSpecialization = true;
  for (const [x, z] of positions) {
    addMesh(
      group,
      new THREE.CylinderGeometry(0.48, 0.58, 0.055, 14),
      MATERIALS.darkSoil,
      x,
      0.03,
      z,
      undefined,
      undefined,
      'Prepared orchard planting pit',
    );
    addMesh(
      group,
      new THREE.CylinderGeometry(0.025, 0.04, 1.15, 6),
      MATERIALS.darkTimber,
      x + 0.34,
      0.575,
      z,
      new THREE.Euler(0, 0, -0.04),
      undefined,
      'Orchard planting stake',
    );
  }
  addSteppingStones(group, -depth * 0.44, depth * 0.42, seed, false);
  addBasket(group, width * 0.34, -depth * 0.34, false, MATERIALS.apple);
}

function orchardBushGrid(width: number, depth: number): Array<[number, number]> {
  const columns = width > 4.6 ? 2 : 1;
  const rows = Math.max(2, Math.min(4, Math.floor(depth / 1.25)));
  const positions: Array<[number, number]> = [];
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      positions.push([
        ((column + 0.5) / columns - 0.5) * width * 0.72,
        ((row + 0.5) / rows - 0.5) * depth * 0.8,
      ]);
    }
  }
  return positions;
}

function addFruitBush(
  group: THREE.Group,
  plantKind: 'aronia' | 'rosehip',
  x: number,
  z: number,
  variant: number,
  seed: number,
  plants: BackyardPlantCatalog | null,
): void {
  const anchor = new THREE.Group();
  anchor.name = `${plantKind === 'aronia' ? 'AroniaBush' : 'RosehipBush'}:${variant}`;
  anchor.position.set(x, 0, z);
  anchor.rotation.y = mulberry32(seed)() * Math.PI * 2;
  anchor.userData.backyardMaturityAnchor = true;
  group.add(anchor);
  if (!plants) return;

  const shrub = plants.clone(plantKind, variant);
  shrub.userData.fpNoCollision = true;
  anchor.add(shrub);
  const fruitAnchors = shrub.userData.backyardFruitAnchors as number[][] | undefined;
  const positions = (fruitAnchors ?? []).map(
    ([fruitX = 0, fruitY = 0.8, fruitZ = 0]) => new THREE.Vector3(fruitX, fruitY, fruitZ),
  );
  if (positions.length > 0) {
    const fruit = plants.createFruitInstances(plantKind, positions, variant);
    fruit.userData.fpNoCollision = true;
    fruit.userData.backyardSeasonalRole = 'orchard-fruit';
    anchor.add(fruit);
  }
  const proxy = addMesh(
    anchor,
    new THREE.CylinderGeometry(0.42, 0.5, 0.9, 8),
    MATERIALS.collisionProxy,
    0,
    0.45,
    0,
    undefined,
    undefined,
    `${plantKind === 'aronia' ? 'Aronia' : 'Rosehip'} bush collision proxy`,
  );
  proxy.userData.fpCollisionProxy = true;
  anchor.userData.fpCollisionAggregate = true;
}

function addBushOrchard(
  group: THREE.Group,
  kind: 'aronia' | 'rosehip',
  width: number,
  depth: number,
  seed: number,
  plants: BackyardPlantCatalog | null,
): void {
  const positions = orchardBushGrid(width, depth);
  group.userData.orchardGrid = {
    columns: width > 4.6 ? 2 : 1,
    rows: positions.length / (width > 4.6 ? 2 : 1),
  };
  positions.forEach(([x, z], index) => (
    addFruitBush(group, kind, x, z, index, seed + index * 617, plants)
  ));
  addBasket(
    group,
    width * 0.36,
    -depth * 0.39,
    true,
    kind === 'aronia' ? MATERIALS.aronia : MATERIALS.rosehip,
    kind === 'aronia' ? 0.027 : 0.045,
    kind === 'aronia' ? 14 : 9,
  );
}

function createRootedLeafCard(
  width: number,
  height: number,
  material: THREE.Material,
  name: string,
): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(width, height, 1, 1);
  geometry.translate(0, height * 0.5, 0);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function addCabbage(group: THREE.Group, x: number, z: number, seed: number): void {
  const rng = mulberry32(seed);
  const plant = new THREE.Group();
  plant.name = 'Cabbage plant';
  plant.position.set(x, 0.02, z);
  plant.rotation.y = rng() * Math.PI * 2;
  group.add(plant);

  for (let leaf = 0; leaf < 7; leaf++) {
    const angle = leaf / 7 * Math.PI * 2 + rng() * 0.14;
    const card = createRootedLeafCard(
      0.21 + rng() * 0.035,
      0.29 + rng() * 0.04,
      MATERIALS.cabbageLeafCard,
      'Textured cabbage outer leaf',
    );
    card.position.y = 0.02;
    card.rotation.set(-1.18 - rng() * 0.14, angle, (rng() - 0.5) * 0.1);
    plant.add(card);
  }
  for (let layer = 0; layer < 6; layer++) {
    const angle = (layer / 6) * Math.PI * 2 + rng() * 0.1;
    const card = createRootedLeafCard(
      0.13 + rng() * 0.02,
      0.17 + rng() * 0.025,
      MATERIALS.cabbageLeafCard,
      'Textured curled cabbage heart leaf',
    );
    card.position.set(
      Math.cos(angle) * 0.055,
      0.035 + (layer % 2) * 0.012,
      Math.sin(angle) * 0.055,
    );
    card.rotation.set(-0.42 - rng() * 0.12, angle, (rng() - 0.5) * 0.1);
    plant.add(card);
  }
}

function addCarrot(group: THREE.Group, x: number, z: number, seed: number): void {
  const rng = mulberry32(seed);
  const plant = new THREE.Group();
  plant.name = 'Carrot plant';
  plant.position.set(x, 0.02, z);
  plant.rotation.y = rng() * Math.PI * 2;
  group.add(plant);
  for (let frond = 0; frond < 2; frond++) {
    const card = createRootedLeafCard(
      0.28 + rng() * 0.045,
      0.38 + rng() * 0.055,
      MATERIALS.carrotFrondCard,
      'Textured carrot frond',
    );
    card.position.y = 0.015;
    card.rotation.set((rng() - 0.5) * 0.1, frond * Math.PI * 0.5, (rng() - 0.5) * 0.12);
    plant.add(card);
  }
}

function addTurnip(group: THREE.Group, x: number, z: number, seed: number): void {
  const rng = mulberry32(seed);
  const plant = new THREE.Group();
  plant.name = 'Turnip plant';
  plant.position.set(x, 0.02, z);
  plant.rotation.y = rng() * Math.PI * 2;
  group.add(plant);
  for (let leaf = 0; leaf < 2; leaf++) {
    const card = createRootedLeafCard(
      0.36 + rng() * 0.045,
      0.29 + rng() * 0.035,
      MATERIALS.turnipLeafCard,
      'Textured turnip leaf',
    );
    card.position.y = 0.015;
    card.rotation.set(-0.16 - rng() * 0.12, leaf * Math.PI * 0.5, (rng() - 0.5) * 0.08);
    plant.add(card);
  }
}

function addVegetableGarden(group: THREE.Group, width: number, depth: number, seed: number): void {
  const bedCount = 3;
  const gap = 0.3;
  const bedWidth = (width - gap * (bedCount + 1)) / bedCount;
  const bedDepth = Math.max(1.15, depth - 0.62);
  const bedZ = 0;
  const cropRows = [
    { name: 'CabbageRows', add: addCabbage, spacing: 0.58 },
    { name: 'CarrotRows', add: addCarrot, spacing: 0.4 },
    { name: 'TurnipRows', add: addTurnip, spacing: 0.48 },
  ] as const;
  for (let bed = 0; bed < bedCount; bed++) {
    const x = -width * 0.5 + gap + bedWidth * 0.5 + bed * (bedWidth + gap);
    addSoilBed(group, x, bedZ, bedWidth, bedDepth, {
      bordered: false,
      profile: 'ground-level',
    });
    const cropGroup = new THREE.Group();
    cropGroup.name = cropRows[bed]!.name;
    cropGroup.userData.backyardCropKind = (['cabbage', 'carrot', 'turnip'] as const)[bed];
    group.add(cropGroup);
    const spacing = cropRows[bed]!.spacing;
    const naturalCols = Math.max(2, Math.floor(bedWidth / spacing));
    const naturalRows = Math.max(2, Math.floor(bedDepth / spacing));
    const cols = Math.min(MAX_GARDEN_GRID_COLUMNS, naturalCols);
    const rows = Math.min(MAX_GARDEN_GRID_ROWS, naturalRows);
    const columnSpan = naturalCols > cols
      ? Math.max(spacing, bedWidth - 0.5)
      : (cols - 1) * spacing;
    const rowSpan = naturalRows > rows
      ? Math.max(spacing, bedDepth - 0.5)
      : (rows - 1) * spacing;
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        cropRows[bed]!.add(
          cropGroup,
          x - columnSpan * 0.5 + col * columnSpan / Math.max(1, cols - 1),
          bedZ - rowSpan * 0.5 + row * rowSpan / Math.max(1, rows - 1),
          seed + bed * 101 + row * 17 + col,
        );
      }
    }
  }
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

function addLuxuryFlowerTable(
  group: THREE.Group,
  width: number,
  depth: number,
): void {
  const table = new THREE.Group();
  table.name = 'Tier 4 flower luxury bouquet table';
  table.position.set(width * 0.31, 0, -depth * 0.34);
  table.userData.flowerLuxuryUpgrade = true;
  group.add(table);
  addMesh(table, new THREE.BoxGeometry(1.3, 0.12, 0.58), MATERIALS.timber, 0, 0.72, 0, undefined, undefined, 'Bouquet table top');
  for (const x of [-0.48, 0.48]) {
    addMesh(table, new THREE.BoxGeometry(0.1, 0.72, 0.44), MATERIALS.darkTimber, x, 0.36, 0, undefined, undefined, 'Bouquet table trestle');
  }
  for (let index = 0; index < 3; index++) {
    const bouquet = new THREE.Group();
    bouquet.name = `Arranged luxury bouquet ${index + 1}`;
    bouquet.position.set((index - 1) * 0.38, 0.81, 0);
    bouquet.rotation.z = (index - 1) * 0.12;
    table.add(bouquet);
    addMesh(bouquet, new THREE.CylinderGeometry(0.025, 0.035, 0.32, 6), MATERIALS.flowerStem, 0, 0.16, 0);
    addFlowerHead(
      bouquet,
      'Tier 4 arranged flower head',
      FLOWER_MATERIALS[(index + 1) % FLOWER_MATERIALS.length]!,
      0.82,
      index === 1,
    ).position.y = 0.34;
  }
}

function addFlowerGarden(
  group: THREE.Group,
  width: number,
  depth: number,
  seed: number,
  plants: BackyardPlantCatalog | null,
  luxuryUpgraded: boolean,
): void {
  const sideWidth = Math.max(1.25, width * 0.34);
  const groundLevelBed = { bordered: false, profile: 'ground-level' } as const;
  addSoilBed(group, -width * 0.29, 0, sideWidth, depth * 0.82, groundLevelBed);
  addSoilBed(group, width * 0.29, 0, sideWidth, depth * 0.82, groundLevelBed);
  const roseCount = width > 5.2 ? 4 : 3;
  for (let i = 0; i < roseCount; i++) {
    const side = i % 2 ? 1 : -1;
    const row = Math.floor(i / 2);
    addRoseShrub(group, side * width * 0.28, (row - 0.5) * Math.min(1.75, depth * 0.35), i, seed + i * 311, plants);
  }
  const rng = mulberry32(seed ^ 0xaf413);
  const flowerCount = Math.min(
    MAX_FLOWER_GARDEN_STEMS,
    Math.max(12, Math.floor(width * depth * 0.7)),
  );
  for (let i = 0; i < flowerCount; i++) {
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
  if (luxuryUpgraded) addLuxuryFlowerTable(group, width, depth);
}

function addHerbClump(group: THREE.Group, x: number, z: number, kind: number, seed: number): void {
  const rng = mulberry32(seed);
  const herbKind = (['parsley', 'rosemary', 'sage'] as const)[kind % 3]!;
  const material = {
    parsley: MATERIALS.parsleyCard,
    rosemary: MATERIALS.rosemaryCard,
    sage: MATERIALS.sageCard,
  }[herbKind];
  const dimensions = {
    parsley: { width: 0.52, height: 0.52 },
    rosemary: { width: 0.44, height: 0.68 },
    sage: { width: 0.56, height: 0.58 },
  }[herbKind];
  const clump = new THREE.Group();
  clump.name = `Textured ${herbKind} clump`;
  clump.userData.backyardHerbKind = herbKind;
  clump.position.set(x, 0.06, z);
  clump.rotation.y = rng() * Math.PI;
  group.add(clump);
  for (let cardIndex = 0; cardIndex < 3; cardIndex++) {
    const card = createRootedLeafCard(
      dimensions.width * (0.9 + rng() * 0.16),
      dimensions.height * (0.9 + rng() * 0.16),
      material,
      `Textured ${herbKind} herb card`,
    );
    card.rotation.y = cardIndex / 3 * Math.PI + (rng() - 0.5) * 0.12;
    clump.add(card);
  }
  registerBackyardSway(group, clump, seed * 0.0013, 0.006, 0.025);
}

function addDryingRack(
  group: THREE.Group,
  x: number,
  z: number,
  index: number,
): void {
  const rack = new THREE.Group();
  rack.name = `HerbDryingRack:${index}`;
  rack.position.set(x, 0, z);
  rack.rotation.y = Math.PI * 0.5;
  rack.userData.detachedFromBeds = true;
  group.add(rack);

  for (const dx of [-0.55, 0.55]) {
    addMesh(
      rack,
      new THREE.CylinderGeometry(0.035, 0.05, 1.2, 6),
      MATERIALS.darkTimber,
      dx,
      0.6,
      0,
      undefined,
      undefined,
      'Herb drying rack post',
    );
  }
  addMesh(
    rack,
    new THREE.CylinderGeometry(0.035, 0.035, 1.25, 6),
    MATERIALS.darkTimber,
    0,
    1.16,
    0,
    new THREE.Euler(0, 0, Math.PI * 0.5),
    undefined,
    'Herb drying rack crossbar',
  );
  const bundleMaterials = [
    MATERIALS.parsleyCard,
    MATERIALS.rosemaryCard,
    MATERIALS.sageCard,
  ] as const;
  for (let i = 0; i < 4; i++) {
    const dx = -0.42 + i * 0.28;
    const bundle = createRootedLeafCard(
      0.22,
      0.38 + (i % 2) * 0.04,
      bundleMaterials[i % bundleMaterials.length]!,
      'Textured hanging herb bundle',
    );
    bundle.position.set(dx, 1.12, 0);
    bundle.rotation.set(0, (i % 2 ? 1 : -1) * 0.12, Math.PI);
    bundle.userData.backyardSeasonalRole = 'drying-herb-bundle';
    rack.add(bundle);
  }
}

function addHerbGarden(group: THREE.Group, width: number, depth: number, seed: number): void {
  const plotDepth = Math.max(1.1, depth - 0.65);
  const plotZ = 0;
  const rackAisleWidth = Math.min(1.15, Math.max(0.9, width * 0.16));
  const bedAreaWidth = width - rackAisleWidth;
  const bedAreaX = -rackAisleWidth * 0.5;
  const plotW = (bedAreaWidth - 0.75) * 0.5;
  for (let side = 0; side < 2; side++) {
    const x = bedAreaX + (side ? 1 : -1) * (plotW * 0.5 + 0.18);
    addSoilBed(group, x, plotZ, plotW, plotDepth);
    const naturalCols = Math.max(2, Math.floor(plotW / 0.65));
    const naturalRows = Math.max(2, Math.floor(plotDepth / 0.72));
    const cols = Math.min(MAX_GARDEN_GRID_COLUMNS, naturalCols);
    const rows = Math.min(MAX_GARDEN_GRID_ROWS, naturalRows);
    const columnSpan = naturalCols > cols
      ? Math.max(0.58, plotW - 0.5)
      : (cols - 1) * 0.58;
    const rowSpan = naturalRows > rows
      ? Math.max(0.66, plotDepth - 0.5)
      : (rows - 1) * 0.66;
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        addHerbClump(
          group,
          x - columnSpan * 0.5 + col * columnSpan / Math.max(1, cols - 1),
          plotZ - rowSpan * 0.5 + row * rowSpan / Math.max(1, rows - 1),
          (side + row + col) % 3,
          seed + side * 101 + row * 13 + col,
        );
      }
    }
  }
  const rackX = width * 0.5 - rackAisleWidth * 0.5;
  addDryingRack(group, rackX, -depth * 0.17, 1);
  addDryingRack(group, rackX, depth * 0.17, 2);
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
  const enclosure = new THREE.Group();
  enclosure.name = 'Hen yard enclosure fence';
  group.add(enclosure);
  for (const x of [-width * 0.48, width * 0.48]) {
    for (const z of [-depth * 0.44, depth * 0.44]) {
      addMesh(enclosure, new THREE.CylinderGeometry(0.045, 0.06, 0.95, 6), MATERIALS.darkTimber, x, 0.48, z);
    }
  }
  for (const z of [-depth * 0.44, depth * 0.44]) {
    addMesh(enclosure, new THREE.BoxGeometry(width * 0.96, 0.055, 0.055), MATERIALS.wicker, 0, 0.45, z);
    addMesh(enclosure, new THREE.BoxGeometry(width * 0.96, 0.055, 0.055), MATERIALS.wicker, 0, 0.78, z);
  }
  for (const x of [-width * 0.48, width * 0.48]) {
    addMesh(enclosure, new THREE.BoxGeometry(0.055, 0.055, depth * 0.88), MATERIALS.wicker, x, 0.45, 0);
    addMesh(enclosure, new THREE.BoxGeometry(0.055, 0.055, depth * 0.88), MATERIALS.wicker, x, 0.78, 0);
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

function addGoatPen(group: THREE.Group, width: number, depth: number, seed: number): void {
  const rng = mulberry32(seed ^ 0x60a7);
  const shelterWidth = Math.min(2.6, width * 0.45);
  addMesh(group, new THREE.BoxGeometry(shelterWidth, 1.25, Math.min(1.8, depth * 0.34)), MATERIALS.timber, -width * 0.24, 0.68, -depth * 0.28, undefined, undefined, 'GoatShelter');
  addMesh(group, new THREE.ConeGeometry(shelterWidth * 0.72, 0.72, 4), MATERIALS.darkTimber, -width * 0.24, 1.62, -depth * 0.28, new THREE.Euler(0, Math.PI * 0.25, 0));
  addMesh(group, new THREE.BoxGeometry(1.25, 0.22, 0.42), MATERIALS.darkTimber, width * 0.22, 0.23, -depth * 0.24, undefined, undefined, 'GoatTrough');
  for (const x of [-width * 0.47, width * 0.47]) {
    for (const z of [-depth * 0.43, depth * 0.43]) {
      addMesh(group, new THREE.CylinderGeometry(0.055, 0.075, 1.12, 6), MATERIALS.darkTimber, x, 0.56, z);
    }
  }
  for (const z of [-depth * 0.43, depth * 0.43]) {
    for (const y of [0.42, 0.82]) addMesh(group, new THREE.BoxGeometry(width * 0.94, 0.065, 0.065), MATERIALS.wicker, 0, y, z, undefined, undefined, y === 0.42 && z < 0 ? 'Goat pen enclosure fence' : undefined);
  }
  for (const x of [-width * 0.47, width * 0.47]) {
    for (const y of [0.42, 0.82]) addMesh(group, new THREE.BoxGeometry(0.065, 0.065, depth * 0.86), MATERIALS.wicker, x, y, 0);
  }
  for (let index = 0; index < 3; index++) {
    const goat = new THREE.Group();
    goat.name = 'GoatFallback';
    addMesh(goat, new THREE.SphereGeometry(0.34, 8, 6), MATERIALS.goat, 0, 0.55, 0, undefined, new THREE.Vector3(1.35, 0.8, 0.72));
    addMesh(goat, new THREE.SphereGeometry(0.2, 8, 6), MATERIALS.goatDark, 0.42, 0.72, 0, undefined, new THREE.Vector3(0.85, 1.05, 0.78));
    for (const z of [-0.16, 0.16]) {
      addMesh(goat, new THREE.CylinderGeometry(0.035, 0.045, 0.48, 5), MATERIALS.goatDark, -0.18, 0.26, z);
      addMesh(goat, new THREE.CylinderGeometry(0.035, 0.045, 0.48, 5), MATERIALS.goatDark, 0.2, 0.26, z);
    }
    goat.position.set((rng() - 0.25) * width * 0.55, 0, (rng() - 0.1) * depth * 0.5);
    goat.rotation.y = rng() * Math.PI * 2;
    group.add(goat);
  }
}

function addBackyardApiary(group: THREE.Group, width: number, depth: number, seed: number): void {
  const rng = mulberry32(seed ^ 0xbeef5);
  addMesh(group, new THREE.BoxGeometry(width * 0.78, 0.16, 0.62), MATERIALS.darkTimber, 0, 0.34, -depth * 0.05, undefined, undefined, 'ApiaryBench');
  for (let index = 0; index < 3; index++) {
    const x = (index - 1) * Math.min(1.35, width * 0.23);
    addMesh(group, new THREE.CylinderGeometry(0.34, 0.45, 0.72, 12), MATERIALS.straw, x, 0.78, -depth * 0.05, undefined, undefined, 'BackyardBeeSkep');
    addMesh(group, new THREE.SphereGeometry(0.34, 12, 7, 0, Math.PI * 2, 0, Math.PI * 0.52), MATERIALS.straw, x, 1.12, -depth * 0.05);
    addMesh(group, new THREE.CircleGeometry(0.075, 10), MATERIALS.darkSoil, x, 0.72, -depth * 0.405, new THREE.Euler(0, 0, 0));
  }
  for (let index = 0; index < 16; index++) {
    const flower = new THREE.Group();
    flower.position.set((rng() - 0.5) * width * 0.78, 0.04, depth * (0.18 + rng() * 0.22));
    addMesh(flower, new THREE.CylinderGeometry(0.005, 0.007, 0.28, 5), MATERIALS.flowerStem, 0, 0.14, 0);
    addMesh(flower, new THREE.SphereGeometry(0.045, 8, 5), FLOWER_MATERIALS[index % FLOWER_MATERIALS.length]!, 0, 0.3, 0, undefined, new THREE.Vector3(1, 0.45, 1));
    group.add(flower);
  }
  group.userData.backyardApiaryPollination = 'minor';
}

export function createBackyardGardenMesh(
  kind: BackyardGardenKind,
  options: BackyardGardenMeshOptions = {},
): THREE.Group {
  const width = Math.max(3.8, options.width ?? 5.4);
  const depth = Math.max(1.8, options.depth ?? 4.6);
  const seed = options.seed ?? 1;
  const plants = options.plants ?? null;
  const group = new THREE.Group();
  group.name = `BackyardGarden:${kind}`;
  group.userData.gardenKind = kind;
  group.userData.footprint = { width, depth };
  group.userData.usesSeedThree = Boolean(plants);

  switch (kind) {
    case 'orchard':
      addPreparedOrchard(group, width, depth, seed);
      break;
    case 'apple_orchard':
      addOrchard(group, 'apple', width, depth, seed, plants);
      break;
    case 'cherry_orchard':
      addOrchard(group, 'cherry', width, depth, seed, plants);
      break;
    case 'pear_orchard':
      addOrchard(group, 'pear', width, depth, seed, plants);
      break;
    case 'aronia_orchard':
      addBushOrchard(group, 'aronia', width, depth, seed, plants);
      break;
    case 'rosehip_orchard':
      addBushOrchard(group, 'rosehip', width, depth, seed, plants);
      break;
    case 'vegetable_garden':
      addVegetableGarden(group, width, depth, seed);
      break;
    case 'flower_garden':
      addFlowerGarden(group, width, depth, seed, plants, options.flowerLuxuryUpgraded ?? false);
      break;
    case 'herb_garden':
      addHerbGarden(group, width, depth, seed);
      break;
    case 'hen_yard':
      addHenYard(group, width, depth, seed);
      break;
    case 'goat_pen':
      addGoatPen(group, width, depth, seed);
      break;
    case 'backyard_apiary':
      addBackyardApiary(group, width, depth, seed);
      break;
    default: {
      const unreachable: never = kind;
      throw new Error(`Unknown backyard garden kind: ${unreachable}`);
    }
  }

  return group;
}

const VEGETABLE_MONTHLY_SCALE = {
  cabbage: [0, 0, 0.28, 0.62, 0.86, 0.96, 0.9, 0.72, 0.86, 1, 0.58, 0],
  carrot: [0, 0, 0.16, 0.38, 0.64, 0.86, 1, 1, 0.9, 0.68, 0.18, 0],
  turnip: [0, 0, 0.22, 0.56, 0.86, 0.76, 0.48, 0.38, 0.66, 0.92, 0.62, 0],
} as const;

const HERB_MONTHLY_SCALE = {
  parsley: [0, 0, 0.5, 0.72, 0.86, 1, 1, 0.96, 0.78, 0.65, 0.32, 0],
  rosemary: [0.46, 0.44, 0.68, 0.82, 0.92, 1, 1, 0.96, 0.84, 0.74, 0.6, 0.48],
  sage: [0.4, 0.38, 0.62, 0.78, 0.9, 1, 1, 0.94, 0.8, 0.7, 0.55, 0.42],
} as const;

function setSeasonalScale(object: THREE.Object3D, factor: number): void {
  const stored = object.userData.backyardBaseScale as [number, number, number] | undefined;
  const base = stored ?? [object.scale.x, object.scale.y, object.scale.z];
  if (!stored) object.userData.backyardBaseScale = base;
  const visibleFactor = Math.max(0, factor);
  object.visible = visibleFactor > 1e-4;
  object.scale.set(
    base[0] * visibleFactor,
    base[1] * visibleFactor,
    base[2] * visibleFactor,
  );
}

function backyardFoliageForMonth(month: number): DeciduousFoliagePresentation {
  return deciduousFoliageForClock({
    simTick: 0,
    totalDays: 0,
    hour: 12,
    minute: 0,
    preciseHour: 12,
    weekday: 0,
    monthDay: 16,
    month: Math.min(12, Math.max(1, Math.floor(month))),
    year: 1,
    isSunday: false,
    isWorkHours: true,
  });
}

function syncOrchardDeciduousFoliage(
  group: THREE.Group,
  kind: 'apple_orchard' | 'cherry_orchard' | 'pear_orchard',
  presentation: DeciduousFoliagePresentation,
): void {
  const retention = THREE.MathUtils.clamp(1 - presentation.dormancy, 0, 1);
  const spring = THREE.MathUtils.clamp(presentation.springFlush, 0, 1);
  const autumn = THREE.MathUtils.clamp(presentation.autumnColor, 0, 1);
  const tintKind = kind === 'apple_orchard'
    ? 'apple'
    : kind === 'cherry_orchard'
      ? 'cherry'
      : 'pear';
  const tintColor = autumn > 0
    ? ORCHARD_AUTUMN_LEAF_COLOR[tintKind]
    : ORCHARD_SPRING_LEAF_COLOR;
  const tintAmount = autumn > 0 ? autumn : spring * 0.72;
  const updatedBindings = new Set<object>();

  group.traverse((object) => {
    const bindings = object.userData.backyardSeasonalFoliageTintBindings as Array<{
      color: { value: THREE.Color };
      amount: { value: number };
    }> | undefined;
    for (const binding of bindings ?? []) {
      if (updatedBindings.has(binding)) continue;
      binding.color.value.set(tintColor);
      binding.amount.value = tintAmount;
      updatedBindings.add(binding);
    }

    if (object.userData.backyardDeciduousFoliage !== true) return;
    const foliage = object as THREE.InstancedMesh;
    const baseCount = Number(object.userData.backyardFoliageBaseCount);
    if (!foliage.isInstancedMesh || !Number.isFinite(baseCount)) return;
    foliage.count = Math.round(baseCount * retention);
    foliage.visible = foliage.count > 0;
    foliage.userData.backyardFoliageRetention = retention;
  });

  group.userData.backyardDeciduousFoliage = { ...presentation };
}

/**
 * Applies calendar phenology without rebuilding deterministic garden geometry.
 * Fruit stays attached to its tree, mature mixed rows appear at different
 * rates, and only the actual orchard harvest fills the basket.
 */
export function syncBackyardGardenSeasonVisuals(
  group: THREE.Group,
  kind: BackyardGardenKind,
  month: number,
  deciduousFoliage?: DeciduousFoliagePresentation,
  daysUntilFirstHarvest = 0,
): void {
  const monthIndex = Math.min(12, Math.max(1, Math.floor(month))) - 1;
  const phenology = backyardGardenPhenology(kind, month, daysUntilFirstHarvest);
  group.userData.backyardPhenology = phenology;
  group.userData.daysUntilFirstHarvest = Math.max(0, daysUntilFirstHarvest);

  if (kind === 'apple_orchard' || kind === 'cherry_orchard' || kind === 'pear_orchard') {
    syncOrchardDeciduousFoliage(
      group,
      kind,
      deciduousFoliage ?? backyardFoliageForMonth(month),
    );
  }

  group.traverse((object) => {
    if (object.userData.backyardMaturityAnchor === true) {
      const establishmentDays = BACKYARD_GARDEN_DEFINITIONS[kind].firstHarvestDays;
      const progress = establishmentDays > 0
        ? THREE.MathUtils.clamp(1 - daysUntilFirstHarvest / establishmentDays, 0, 1)
        : 1;
      setSeasonalScale(object, THREE.MathUtils.lerp(0.3, 1, progress));
      object.userData.backyardMaturityProgress = progress;
    }
    const role = object.userData.backyardSeasonalRole as string | undefined;
    if (role === 'orchard-fruit') {
      object.visible = phenology.produceVisibility !== 'none';
      return;
    }
    if (role === 'basket-produce') {
      object.visible = phenology.produceVisibility === 'harvest';
      return;
    }
    if (role === 'drying-herb-bundle') {
      object.visible = kind === 'herb_garden' && monthIndex >= 3 && monthIndex <= 10;
      return;
    }

    const cropKind = object.userData.backyardCropKind as keyof typeof VEGETABLE_MONTHLY_SCALE | undefined;
    if (cropKind) {
      setSeasonalScale(object, VEGETABLE_MONTHLY_SCALE[cropKind][monthIndex]);
      return;
    }
    const herbKind = object.userData.backyardHerbKind as keyof typeof HERB_MONTHLY_SCALE | undefined;
    if (herbKind) setSeasonalScale(object, HERB_MONTHLY_SCALE[herbKind][monthIndex]);
  });
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
