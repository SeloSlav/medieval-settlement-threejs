import * as THREE from 'three';
import type { Terrain } from '../terrain/Terrain.ts';
import type { ResourceNodeState } from '../resources/types.ts';
import type {
  MineralDepositLayout,
  MineralDepositResource,
  MineralDepositSite,
} from './MineralDepositLayout.ts';
import {
  mineralDepositNodeId,
} from './MineralDepositLayout.ts';

type SiteVisual = {
  nodeId: string;
  grade: MineralDepositSite['grade'];
  stones: THREE.Mesh[];
};

type WeatheredTextureSet = {
  map: THREE.DataTexture;
  normalMap: THREE.DataTexture;
  roughnessMap: THREE.DataTexture;
};

type MineralSurfaceStyle = {
  materials: Record<MineralDepositResource, THREE.MeshStandardMaterial[]>;
  geometries: Record<MineralDepositResource, THREE.BufferGeometry[]>;
  textures: THREE.DataTexture[];
};

export type MineralDepositSystem = {
  group: THREE.Group;
  syncNodes: (nodes: Iterable<ResourceNodeState>) => boolean;
  isBlockedAt: (x: number, z: number) => boolean;
  isGrassBlockedAt: (x: number, z: number) => boolean;
  dispose: () => void;
};

const MATERIAL_COLORS: Record<MineralDepositResource, readonly [number, number]> = {
  iron: [0x79695f, 0x8d7465],
  salt: [0xcfcbbd, 0xeeeadd],
};

const TAU = Math.PI * 2;
const WEATHER_TEXTURE_SIZE = 64;

export function createMineralDepositSystem(
  terrain: Terrain,
  layout: MineralDepositLayout,
): MineralDepositSystem {
  const group = new THREE.Group();
  group.name = 'Mineral deposits';
  const surfaceStyle = createSurfaceStyle();
  const { materials, geometries } = surfaceStyle;
  const visuals: SiteVisual[] = layout.sites.map((site, index) => {
    const visual = createSiteVisual(terrain, site, index, materials, geometries);
    group.add(visual.group);
    return {
      nodeId: mineralDepositNodeId(site, index),
      grade: site.grade,
      stones: visual.stones,
    };
  });

  return {
    group,
    syncNodes: (nodes) => {
      const byId = new Map([...nodes].map((node) => [node.nodeId, node]));
      let changed = false;
      for (const visual of visuals) {
        const node = byId.get(visual.nodeId);
        const visibleShare = visual.grade === 'rich' || !node
          ? 1
          : Math.max(0, Math.min(1, node.remaining / Math.max(1, node.maxYield)));
        const visibleCount = Math.ceil(visual.stones.length * visibleShare);
        visual.stones.forEach((stone, index) => {
          const visible = index < visibleCount;
          if (stone.visible !== visible) {
            stone.visible = visible;
            changed = true;
          }
        });
      }
      return changed;
    },
    isBlockedAt: (x, z) => layout.isBlockedForProps(x, z),
    isGrassBlockedAt: (x, z) => layout.isBlockedForGrass(x, z),
    dispose: () => {
      for (const geometry of new Set(Object.values(geometries).flat())) geometry.dispose();
      for (const material of Object.values(materials).flat()) material.dispose();
      for (const texture of surfaceStyle.textures) texture.dispose();
    },
  };
}

function createSurfaceStyle(): MineralSurfaceStyle {
  const ironTextures = createWeatheredTextureSet('iron');
  const saltTextures = createWeatheredTextureSet('salt');
  const textureSets: Record<MineralDepositResource, WeatheredTextureSet> = {
    iron: ironTextures,
    salt: saltTextures,
  };
  const materials = {
    iron: MATERIAL_COLORS.iron.map((color, index) =>
      new THREE.MeshStandardMaterial({
        color,
        map: ironTextures.map,
        normalMap: ironTextures.normalMap,
        roughnessMap: ironTextures.roughnessMap,
        roughness: 0.96 - index * 0.02,
        metalness: 0,
        vertexColors: true,
      })
    ),
    salt: MATERIAL_COLORS.salt.map((color, index) =>
      new THREE.MeshStandardMaterial({
        color,
        map: saltTextures.map,
        normalMap: saltTextures.normalMap,
        roughnessMap: saltTextures.roughnessMap,
        roughness: 0.96 - index * 0.02,
        metalness: 0,
        vertexColors: true,
      })
    ),
  };
  for (const resource of ['iron', 'salt'] as const) {
    for (const material of materials[resource]) {
      const normalStrength = resource === 'iron' ? 0.55 : 0.42;
      material.normalScale.set(normalStrength, normalStrength);
      material.userData.weatheredMineralSurface = {
        resource,
        revision: 'mineral-weathering-v13',
        surfaceGrammar: 'scattered-weathered-outcrops',
        planeWeathering: resource === 'iron'
          ? 'patchy-host-rock-oxidation'
          : 'fissured-stratified-salt',
        textureSize: WEATHER_TEXTURE_SIZE,
        mipReadable: true,
        static: true,
      };
    }
  }

  return {
    materials,
    geometries: createMineralGeometries(),
    textures: Object.values(textureSets).flatMap((set) => [
      set.map,
      set.normalMap,
      set.roughnessMap,
    ]),
  };
}

function createSiteVisual(
  terrain: Terrain,
  site: MineralDepositSite,
  siteIndex: number,
  materials: Record<MineralDepositResource, THREE.MeshStandardMaterial[]>,
  geometries: Record<MineralDepositResource, THREE.BufferGeometry[]>,
): { group: THREE.Group; stones: THREE.Mesh[] } {
  const group = new THREE.Group();
  group.name = `${site.grade === 'rich' ? 'Rich ' : ''}${site.resource} deposit`;
  const stones: THREE.Mesh[] = [];
  const count = site.grade === 'rich' ? 18 : 10;
  const seed = ((siteIndex + 1) * 0x9e3779b1) ^ Math.round(site.x * 97) ^ Math.round(site.z * 193);

  for (let index = 0; index < count; index++) {
    const angle = pseudoRandom(seed, index * 3) * TAU;
    const radius = Math.sqrt(pseudoRandom(seed, index * 3 + 1)) * 0.8;
    const gradeScale = site.grade === 'rich' ? 1.12 : 0.98;
    const localX = Math.cos(angle) * site.radiusX * radius;
    const localZ = Math.sin(angle) * site.radiusZ * radius;
    const alongShare = localX / site.radiusX;
    const crossShare = localZ / site.radiusZ;
    const cos = Math.cos(site.rotation);
    const sin = Math.sin(site.rotation);
    const x = site.x + localX * cos - localZ * sin;
    const z = site.z + localX * sin + localZ * cos;
    const scaleRoll = pseudoRandom(seed, index * 3 + 2);
    const scale = gradeScale * (0.62 + scaleRoll * 0.76);
    const resourceGeometries = geometries[site.resource];
    const geometryIndex = (
      index + Math.floor(pseudoRandom(seed ^ 0x4f1b, index) * 3)
    ) % resourceGeometries.length;
    const stone = new THREE.Mesh(
      resourceGeometries[geometryIndex],
      materials[site.resource][index % materials[site.resource].length],
    );
    const surfaceTurn = (pseudoRandom(seed ^ 0xa2e5, index) - 0.5) * Math.PI;
    const scaleX = scale * (0.82 + pseudoRandom(seed ^ 0x3d67, index) * 0.42);
    const scaleY = scale * (0.62 + pseudoRandom(seed ^ 0x8b31, index) * 0.24);
    const scaleZ = scale * (0.78 + pseudoRandom(seed ^ 0x1ca7, index) * 0.4);
    stone.name = `${site.resource} outcrop ${index + 1}`;
    stone.scale.set(scaleX, scaleY, scaleZ);
    stone.geometry.computeBoundingBox();
    const bottom = stone.geometry.boundingBox?.min.y ?? -0.28;
    const top = stone.geometry.boundingBox?.max.y ?? 0.72;
    const burialDepth = (top - bottom) * scaleY
      * (0.2 + pseudoRandom(seed ^ 0xb3e9, index) * 0.12);
    stone.position.set(
      x,
      terrain.getHeightAt(x, z)
        - bottom * scaleY
        - burialDepth,
      z,
    );
    stone.rotation.set(
      (pseudoRandom(seed ^ 0x5a17, index) - 0.5) * 0.24,
      site.rotation + surfaceTurn,
      (pseudoRandom(seed ^ 0x29c3, index) - 0.5) * 0.24,
    );
    stone.castShadow = true;
    stone.receiveShadow = true;
    stone.userData.mineralSurface = {
      resource: site.resource,
      weathered: true,
      grounded: true,
      hierarchyRole: 'scattered-outcrop',
      continuousParentGeometry: true,
      attachedToAnchor: false,
      formationAlongShare: alongShare,
      formationCrossShare: crossShare,
      geometryVariant: geometryIndex,
      geometryProfile: 'continuous-quarry-outcrop',
      formation: site.resource === 'salt'
        ? 'matte-salt-host-rock'
        : 'oxide-mottled-host-rock',
    };
    stones.push(stone);
    group.add(stone);
  }
  return { group, stones };
}

function createWeatheredTextureSet(resource: MineralDepositResource): WeatheredTextureSet {
  const size = WEATHER_TEXTURE_SIZE;
  const texelCount = size * size;
  const height = new Float32Array(texelCount);
  const albedo = new Uint8Array(texelCount * 4);
  const normal = new Uint8Array(texelCount * 4);
  const roughness = new Uint8Array(texelCount * 4);
  const pitField = new Float32Array(texelCount);
  const fractureField = new Float32Array(texelCount);
  const depositField = new Float32Array(texelCount);
  const cavityField = new Float32Array(texelCount);
  const seed = resource === 'iron' ? 0x4d3 : 0x7b1;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const broad = periodicValueNoise(u, v, 3, seed);
      const medium = periodicValueNoise(u, v, 7, seed ^ 0x2d7);
      const fine = periodicValueNoise(u, v, 17, seed ^ 0x6e5);
      const cavitySeed = periodicValueNoise(u, v, 11, seed ^ 0x937);
      const cellularCavity = Math.pow(
        THREE.MathUtils.clamp((0.27 - cavitySeed) * 2.15, 0, 1),
        2,
      );
      const localizedCavity = localizedSpotField(
        u,
        v,
        seed ^ 0x53ef,
        resource === 'iron' ? 3 : 6,
        resource === 'iron' ? 0.028 : 0.032,
        resource === 'iron' ? 0.068 : 0.082,
      );
      const cavity = Math.max(cellularCavity, localizedCavity);
      const pits = localizedSpotField(
        u,
        v,
        seed ^ 0x1a7d,
        resource === 'iron' ? 7 : 8,
        resource === 'iron' ? 0.018 : 0.02,
        resource === 'iron' ? 0.048 : 0.055,
      );
      const fractures = localizedFractureField(
        u,
        v,
        seed ^ 0xc2b3,
        resource === 'iron' ? 4 : 7,
        resource === 'iron' ? 0.04 : 0.05,
        resource === 'iron' ? 0.12 : 0.16,
        resource === 'iron' ? 0.006 : 0.008,
        resource === 'iron' ? 0.014 : 0.018,
      );
      const deposits = localizedSpotField(
        u,
        v,
        seed ^ 0x8791,
        resource === 'iron' ? 7 : 6,
        resource === 'iron' ? 0.065 : 0.045,
        resource === 'iron' ? 0.19 : 0.12,
      );
      const pixel = y * size + x;
      pitField[pixel] = pits;
      fractureField[pixel] = fractures;
      depositField[pixel] = deposits;
      cavityField[pixel] = cavity;
      const baseHeight =
        (broad - 0.5) * 0.07
        + (medium - 0.5) * 0.03
        + (fine - 0.5) * 0.009
        - cavity * (resource === 'iron' ? 0.028 : 0.035);
      if (resource === 'iron') {
        height[pixel] = baseHeight
          - pits * 0.025
          - fractures * 0.018
          + deposits * 0.006;
      } else {
        height[pixel] = baseHeight * 0.78
          - pits * 0.022
          - fractures * 0.02
          + deposits * 0.004;
      }
    }
  }

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const pixel = y * size + x;
      const offset = pixel * 4;
      const h = height[pixel];
      const u = x / size;
      const v = y / size;
      const broad = periodicValueNoise(u, v, 3, seed);
      const medium = periodicValueNoise(u, v, 7, seed ^ 0x2d7);
      const crevice = THREE.MathUtils.clamp((-h - 0.012) * 7.5, 0, 1);
      const soilNoise = periodicValueNoise(u, v, 5, seed ^ 0xb49);
      const cloudNoise = periodicValueNoise(u, v, 4, seed ^ 0xcd1) * 0.62
        + periodicValueNoise(u, v, 9, seed ^ 0xa63) * 0.38;
      const inclusionNoise = periodicValueNoise(u, v, 13, seed ^ 0xe29);
      const pits = pitField[pixel];
      const fractures = fractureField[pixel];
      const deposits = depositField[pixel];
      const cavity = cavityField[pixel];
      const earth = THREE.MathUtils.clamp(
        crevice * (0.18 + soilNoise * 0.12),
        0,
        1,
      );
      const mineralCloud = THREE.MathUtils.smoothstep(cloudNoise, 0.38, 0.78);
      const inclusion = Math.pow(
        THREE.MathUtils.smoothstep(inclusionNoise, 0.63, 0.88),
        1.6,
      );
      const oxidation = THREE.MathUtils.clamp(
        0.1 + THREE.MathUtils.smoothstep(
          cloudNoise * 0.7 + soilNoise * 0.3,
          0.34,
          0.72,
        ) * 0.3 + deposits * 0.86 + crevice * 0.08,
        0,
        1,
      );
      const value = resource === 'iron'
        ? THREE.MathUtils.clamp(
            0.78 + (broad - 0.5) * 0.15 + (medium - 0.5) * 0.055
              + h * 0.15 - earth * 0.06 - pits * 0.055
              - fractures * 0.04 - cavity * 0.055,
            0.58,
            0.88,
          )
        : THREE.MathUtils.clamp(
            0.93 + (broad - 0.5) * 0.1 + (medium - 0.5) * 0.04
              + h * 0.08 - pits * 0.045 - fractures * 0.085
              - cavity * 0.075 - earth * 0.04,
            0.68,
            0.98,
          );
      const tint = resource === 'iron'
        ? [
            value * (
              0.92 + oxidation * 0.13 - earth * 0.025 - inclusion * 0.025
            ),
            value * (
              0.96 - oxidation * 0.24 - earth * 0.03 - inclusion * 0.025
            ),
            value * (
              0.95 - oxidation * 0.37 - earth * 0.035 - inclusion * 0.02
            ),
          ]
        : [
            value * (
              1 - mineralCloud * 0.018 - inclusion * 0.045
                - earth * 0.025 - fractures * 0.028
            ),
            value * (
              0.995 - mineralCloud * 0.015 - inclusion * 0.04
                - earth * 0.025 - fractures * 0.03
            ),
            value * (
              0.97 - mineralCloud * 0.01 - inclusion * 0.025
                - earth * 0.03 - fractures * 0.028
            ),
          ];

      const albedoFloor = resource === 'salt' ? 0.64 : 0;
      albedo[offset] = toByte(Math.max(albedoFloor, tint[0]));
      albedo[offset + 1] = toByte(Math.max(albedoFloor, tint[1]));
      albedo[offset + 2] = toByte(Math.max(albedoFloor, tint[2]));
      albedo[offset + 3] = 255;

      const hLeft = height[y * size + ((x - 1 + size) % size)];
      const hRight = height[y * size + ((x + 1) % size)];
      const hDown = height[((y - 1 + size) % size) * size + x];
      const hUp = height[((y + 1) % size) * size + x];
      const normalGain = resource === 'iron' ? 1.7 : 1.45;
      const nx = (hLeft - hRight) * normalGain;
      const ny = (hDown - hUp) * normalGain;
      const invLength = 1 / Math.hypot(nx, ny, 1);
      normal[offset] = toByte(nx * invLength * 0.5 + 0.5);
      normal[offset + 1] = toByte(ny * invLength * 0.5 + 0.5);
      normal[offset + 2] = toByte(invLength * 0.5 + 0.5);
      normal[offset + 3] = 255;

      const roughnessValue = resource === 'iron'
        ? THREE.MathUtils.clamp(
            0.9 + crevice * 0.035 + earth * 0.025 + inclusion * 0.015
              + pits * 0.025 + fractures * 0.02,
            0.88,
            1,
          )
        : THREE.MathUtils.clamp(
            0.92 + fractures * 0.025 + earth * 0.02 + inclusion * 0.025
              + pits * 0.025 + cavity * 0.025,
            0.9,
            1,
          );
      const roughnessByte = toByte(roughnessValue);
      roughness[offset] = roughnessByte;
      roughness[offset + 1] = roughnessByte;
      roughness[offset + 2] = roughnessByte;
      roughness[offset + 3] = 255;
    }
  }

  const map = createDataTexture(albedo, size, `${resource} weathered albedo`, true);
  const normalMap = createDataTexture(normal, size, `${resource} weathered normal`, false);
  const roughnessMap = createDataTexture(roughness, size, `${resource} weathered roughness`, false);
  return { map, normalMap, roughnessMap };
}

function createDataTexture(
  data: Uint8Array,
  size: number,
  name: string,
  srgb: boolean,
): THREE.DataTexture {
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.name = name;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1, 1);
  texture.anisotropy = 2;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function createMineralGeometries(): Record<MineralDepositResource, THREE.BufferGeometry[]> {
  const weatheredOutcrops = [4.7, 13.1, 29.3].map((seed) => {
    const structure = createWeatheredOutcropStructure(seed);
    return {
      iron: createResourceSurfaceVariant(structure, 'iron', seed),
      salt: createResourceSurfaceVariant(structure, 'salt', seed),
    };
  });
  return {
    iron: weatheredOutcrops.map((outcrop) => outcrop.iron),
    salt: weatheredOutcrops.map((outcrop) => outcrop.salt),
  };
}

function createWeatheredOutcropStructure(seed: number): THREE.BufferGeometry {
  const geometry = new THREE.IcosahedronGeometry(1, 2);
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  const point = new THREE.Vector3();
  const uvs: number[] = [];

  for (let index = 0; index < position.count; index++) {
    point.fromBufferAttribute(position, index).normalize();
    const sourceY = point.y;
    const azimuth = Math.atan2(point.z, point.x);
    const broadErosion = surfaceValueNoise(point, seed + 5.7, 1.35);
    const secondaryErosion = surfaceValueNoise(point, seed + 19.1, 2.15);
    const lobes = Math.sin(azimuth * 2 + seed * 0.37) * 0.105
      + Math.sin(azimuth * 3 - seed * 0.19) * 0.055;
    const shoulderErosion = THREE.MathUtils.smoothstep(
      surfaceValueNoise(point, seed + 41.3, 1.7),
      0.58,
      0.88,
    ) * (0.06 + Math.max(0, sourceY) * 0.055);
    const radius = 0.91
      + lobes * (0.72 + (1 - Math.abs(sourceY)) * 0.28)
      + (broadErosion - 0.5) * 0.2
      + (secondaryErosion - 0.5) * 0.065
      - shoulderErosion;
    point.multiplyScalar(radius);
    point.x *= 1.08;
    point.z *= 0.97;
    point.y *= 0.61 + (broadErosion - 0.5) * 0.1;
    const footBlend = THREE.MathUtils.smoothstep(-sourceY, 0.12, 0.78);
    if (footBlend > 0) {
      const flattenedFoot = -0.305 + (secondaryErosion - 0.5) * 0.024;
      point.y = THREE.MathUtils.lerp(point.y, flattenedFoot, footBlend * 0.92);
      const footFlare = 1 + footBlend * 0.09;
      point.x *= footFlare;
      point.z *= footFlare;
    }
    position.setXYZ(index, point.x, point.y, point.z);
    uvs.push(
      Math.atan2(point.z, point.x) / TAU + 0.5,
      THREE.MathUtils.clamp(point.y * 0.5 + 0.5, 0, 1),
    );
  }

  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function createResourceSurfaceVariant(
  structure: THREE.BufferGeometry,
  resource: MineralDepositResource,
  seed: number,
): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  for (const attributeName of ['position', 'normal', 'uv'] as const) {
    geometry.setAttribute(attributeName, structure.getAttribute(attributeName));
  }
  geometry.name = `${resource} weathered quarry boulder`;
  geometry.userData.mineralGeometry = {
    resource,
    profile: 'continuous-quarry-outcrop',
    deformation: 'continuous-quarry-v3',
    topology: 'single-connected-shell',
    silhouette: 'low-frequency-lobes-and-erosion',
    groundProfile: 'flattened-eroded-foot',
    surfaceColorProfile: resource === 'iron'
      ? 'patchy-host-rock-oxidation'
      : 'fissured-stratified-salt',
    structureSeed: seed,
    triangles: geometry.getAttribute('position').count / 3,
  };
  geometry.setAttribute(
    'color',
    createPlaneWeatheringColorAttribute(geometry, resource, seed),
  );
  geometry.boundingBox = structure.boundingBox?.clone() ?? null;
  geometry.boundingSphere = structure.boundingSphere?.clone() ?? null;
  return geometry;
}

function createPlaneWeatheringColorAttribute(
  geometry: THREE.BufferGeometry,
  resource: MineralDepositResource,
  seed: number,
): THREE.Uint8BufferAttribute {
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  const colors = new Uint8Array(position.count * 3);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const centroid = new THREE.Vector3();
  const edgeA = new THREE.Vector3();
  const edgeB = new THREE.Vector3();
  const normal = new THREE.Vector3();

  for (let face = 0; face < position.count; face += 3) {
    a.fromBufferAttribute(position, face);
    b.fromBufferAttribute(position, face + 1);
    c.fromBufferAttribute(position, face + 2);
    centroid.copy(a).add(b).add(c).multiplyScalar(1 / 3).normalize();
    edgeA.subVectors(b, a);
    edgeB.subVectors(c, a);
    normal.crossVectors(edgeA, edgeB).normalize();

    const broad = surfaceValueNoise(centroid, seed + 17.3, 2.15);
    const medium = surfaceValueNoise(centroid, seed + 43.7, 4.6);
    const fine = surfaceValueNoise(centroid, seed + 81.1, 8.4);
    const faceTurn = Math.abs(normal.x * 0.57 + normal.y * 0.31 - normal.z * 0.76);
    let red: number;
    let green: number;
    let blue: number;

    if (resource === 'iron') {
      const oxidation = THREE.MathUtils.smoothstep(
        broad * 0.64 + medium * 0.23 + faceTurn * 0.08 + fine * 0.05,
        0.32,
        0.68,
      );
      const cavity = THREE.MathUtils.smoothstep(
        (1 - medium) * 0.62 + (1 - fine) * 0.38,
        0.69,
        0.86,
      );
      const host = 0.86 + (broad - 0.5) * 0.16;
      red = host * (0.95 + oxidation * 0.15 - cavity * 0.17);
      green = host * (1 - oxidation * 0.25 - cavity * 0.19);
      blue = host * (1.02 - oxidation * 0.405 - cavity * 0.21);
    } else {
      const fissureThreshold = 0.43 + (broad - 0.5) * 0.24;
      const primaryFissure = 1 - THREE.MathUtils.smoothstep(
        Math.abs(medium - fissureThreshold),
        0.022,
        0.125,
      );
      const secondaryFissure = 1 - THREE.MathUtils.smoothstep(
        Math.abs(fine - (0.58 - broad * 0.13)),
        0.018,
        0.075,
      );
      const fissure = Math.max(primaryFissure, secondaryFissure * 0.7);
      const inclusion = THREE.MathUtils.smoothstep(
        fine * 0.72 + (1 - broad) * 0.28,
        0.67,
        0.84,
      );
      const host = 0.94
        + (broad - 0.5) * 0.1
        + (medium - 0.5) * 0.045
        + (fine - 0.5) * 0.025
        + faceTurn * 0.018;
      const mineralShift = surfaceValueNoise(centroid, seed + 109.3, 3.3) - 0.5;
      red = host * (
        1 - fissure * 0.19 - inclusion * 0.075 + mineralShift * 0.012
      );
      green = host * (
        0.99 - fissure * 0.195 - inclusion * 0.078 - mineralShift * 0.008
      );
      blue = host * (
        0.96 - fissure * 0.185 - inclusion * 0.09 + mineralShift * 0.006
      );
    }

    const faceColor = [toByte(red), toByte(green), toByte(blue)];
    for (let vertex = face; vertex < face + 3; vertex++) {
      colors.set(faceColor, vertex * 3);
    }
  }

  return new THREE.Uint8BufferAttribute(colors, 3, true);
}

function surfaceValueNoise(
  point: THREE.Vector3,
  seed: number,
  frequency: number,
): number {
  const x = point.x * frequency + 19.7;
  const y = point.y * frequency + 31.3;
  const z = point.z * frequency + 47.9;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const z0 = Math.floor(z);
  const tx = smoothNoiseStep(x - x0);
  const ty = smoothNoiseStep(y - y0);
  const tz = smoothNoiseStep(z - z0);
  const zBottom = THREE.MathUtils.lerp(
    THREE.MathUtils.lerp(
      volumeNoise(x0, y0, z0, seed),
      volumeNoise(x0 + 1, y0, z0, seed),
      tx,
    ),
    THREE.MathUtils.lerp(
      volumeNoise(x0, y0 + 1, z0, seed),
      volumeNoise(x0 + 1, y0 + 1, z0, seed),
      tx,
    ),
    ty,
  );
  const zTop = THREE.MathUtils.lerp(
    THREE.MathUtils.lerp(
      volumeNoise(x0, y0, z0 + 1, seed),
      volumeNoise(x0 + 1, y0, z0 + 1, seed),
      tx,
    ),
    THREE.MathUtils.lerp(
      volumeNoise(x0, y0 + 1, z0 + 1, seed),
      volumeNoise(x0 + 1, y0 + 1, z0 + 1, seed),
      tx,
    ),
    ty,
  );
  return THREE.MathUtils.lerp(zBottom, zTop, tz);
}

function volumeNoise(x: number, y: number, z: number, seed: number): number {
  let value = Math.imul(x + 17, 0x1f123bb5)
    ^ Math.imul(y + 31, 0x5f356495)
    ^ Math.imul(z + 47, 0x6c8e9cf5)
    ^ Math.imul(Math.round(seed * 101), 0x27d4eb2d);
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return ((value ^ (value >>> 14)) >>> 0) / 0x1_0000_0000;
}

function periodicValueNoise(
  u: number,
  v: number,
  cells: number,
  seed: number,
): number {
  const px = u * cells;
  const py = v * cells;
  const x0 = Math.floor(px);
  const y0 = Math.floor(py);
  const tx = smoothNoiseStep(px - x0);
  const ty = smoothNoiseStep(py - y0);
  const x1 = (x0 + 1) % cells;
  const y1 = (y0 + 1) % cells;
  const wrappedX0 = ((x0 % cells) + cells) % cells;
  const wrappedY0 = ((y0 % cells) + cells) % cells;
  const bottom = THREE.MathUtils.lerp(
    gridNoise(wrappedX0, wrappedY0, seed),
    gridNoise(x1, wrappedY0, seed),
    tx,
  );
  const top = THREE.MathUtils.lerp(
    gridNoise(wrappedX0, y1, seed),
    gridNoise(x1, y1, seed),
    tx,
  );
  return THREE.MathUtils.lerp(bottom, top, ty);
}

function smoothNoiseStep(value: number): number {
  return value * value * (3 - 2 * value);
}

function localizedSpotField(
  u: number,
  v: number,
  seed: number,
  count: number,
  minimumRadius: number,
  maximumRadius: number,
): number {
  let field = 0;
  for (let index = 0; index < count; index++) {
    const centerU = pseudoRandom(seed ^ 0x2e17, index * 5);
    const centerV = pseudoRandom(seed ^ 0x6a4b, index * 5 + 1);
    const radius = THREE.MathUtils.lerp(
      minimumRadius,
      maximumRadius,
      pseudoRandom(seed ^ 0xb8d1, index * 5 + 2),
    );
    const aspect = THREE.MathUtils.lerp(
      0.68,
      1.38,
      pseudoRandom(seed ^ 0x713f, index * 5 + 3),
    );
    const angle = pseudoRandom(seed ^ 0xd529, index * 5 + 4) * TAU;
    const dx = wrappedTextureDelta(u - centerU);
    const dy = wrappedTextureDelta(v - centerV);
    const along = Math.cos(angle) * dx + Math.sin(angle) * dy;
    const across = -Math.sin(angle) * dx + Math.cos(angle) * dy;
    const distance = Math.hypot(along / aspect, across * aspect) / radius;
    field = Math.max(field, 1 - THREE.MathUtils.smoothstep(distance, 0.48, 1));
  }
  return field;
}

function localizedFractureField(
  u: number,
  v: number,
  seed: number,
  count: number,
  minimumHalfLength: number,
  maximumHalfLength: number,
  minimumWidth: number,
  maximumWidth: number,
): number {
  let field = 0;
  for (let index = 0; index < count; index++) {
    const centerU = pseudoRandom(seed ^ 0x941d, index * 5);
    const centerV = pseudoRandom(seed ^ 0x37c9, index * 5 + 1);
    const angle = pseudoRandom(seed ^ 0xe45b, index * 5 + 2) * TAU;
    const halfLength = THREE.MathUtils.lerp(
      minimumHalfLength,
      maximumHalfLength,
      pseudoRandom(seed ^ 0xa67f, index * 5 + 3),
    );
    const width = THREE.MathUtils.lerp(
      minimumWidth,
      maximumWidth,
      pseudoRandom(seed ^ 0x58a3, index * 5 + 4),
    );
    const dx = wrappedTextureDelta(u - centerU);
    const dy = wrappedTextureDelta(v - centerV);
    const along = Math.cos(angle) * dx + Math.sin(angle) * dy;
    const across = -Math.sin(angle) * dx + Math.cos(angle) * dy;
    const beyondEnd = Math.max(0, Math.abs(along) - halfLength);
    const distance = Math.hypot(beyondEnd, across);
    field = Math.max(field, 1 - THREE.MathUtils.smoothstep(distance, width, width * 2.4));
  }
  return field;
}

function wrappedTextureDelta(value: number): number {
  return value - Math.round(value);
}

function gridNoise(x: number, y: number, seed: number): number {
  let value = Math.imul(x + 17, 0x1f123bb5)
    ^ Math.imul(y + 31, 0x5f356495)
    ^ Math.imul(seed, 0x6c8e9cf5);
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return ((value ^ (value >>> 14)) >>> 0) / 0x1_0000_0000;
}

function toByte(value: number): number {
  return Math.round(THREE.MathUtils.clamp(value, 0, 1) * 255);
}

function pseudoRandom(seed: number, index: number): number {
  let value = (seed + Math.imul(index + 1, 0x6d2b79f5)) | 0;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return ((value ^ (value >>> 14)) >>> 0) / 0x1_0000_0000;
}
