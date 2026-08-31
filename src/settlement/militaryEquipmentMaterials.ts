import * as THREE from 'three';

export const MILITARY_EQUIPMENT_MATERIAL_ROLES = [
  'ash',
  'walnut',
  'bone',
  'steel',
  'bluedSteel',
  'brass',
  'leather',
  'oxblood',
  'paintedWood',
  'feather',
  'cord',
] as const;

export const MILITARY_EQUIPMENT_TEXTURE_SIZE = 128;

export type MilitaryEquipmentMaterialRole =
  (typeof MILITARY_EQUIPMENT_MATERIAL_ROLES)[number];

export type MilitaryEquipmentMaterials = {
  ash: THREE.MeshStandardMaterial;
  walnut: THREE.MeshStandardMaterial;
  bone: THREE.MeshStandardMaterial;
  steel: THREE.MeshStandardMaterial;
  bluedSteel: THREE.MeshStandardMaterial;
  brass: THREE.MeshStandardMaterial;
  leather: THREE.MeshStandardMaterial;
  oxblood: THREE.MeshStandardMaterial;
  paintedWood: THREE.MeshStandardMaterial;
  feather: THREE.MeshStandardMaterial;
  cord: THREE.LineBasicMaterial;
};

/** Compatibility alias for the original equipment assembly's local contract. */
export type Materials = MilitaryEquipmentMaterials;

export type MilitaryEquipmentMaterialOptions = {
  /** Renderer capability, normally renderer.capabilities.getMaxAnisotropy(). */
  anisotropy?: number;
  /** Stable catalog seed. Changing it authors a different, still repeatable finish. */
  seed?: number;
  /** Perceptual UV-frequency multiplier for all maps. */
  textureScale?: number;
};

export type MilitaryEquipmentMaterialRoleDiagnostic = {
  role: MilitaryEquipmentMaterialRole;
  materialName: string;
  materialClass: 'pbr' | 'line';
  surfaceFamily: string;
  albedoMap: string | null;
  roughnessMap: string | null;
  normalMap: string | null;
  metalness: number | null;
  roughnessRange: readonly [number, number] | null;
  normalScale: readonly [number, number] | null;
  causalFields: readonly string[];
};

export type MilitaryEquipmentMaterialDiagnostics = {
  materialCount: number;
  pbrMaterialCount: number;
  textureCount: number;
  textureReferenceCount: number;
  sharedTextureReferences: number;
  textureResolution: number;
  sourceTextureBytes: number;
  estimatedMipmappedTextureBytes: number;
  deterministicSeed: number;
  roles: readonly MilitaryEquipmentMaterialRoleDiagnostic[];
};

type TexturedMaterialRole = Exclude<MilitaryEquipmentMaterialRole, 'cord'>;
type SurfaceFamily =
  | 'wood'
  | 'steel'
  | 'brass'
  | 'leather'
  | 'painted-wood'
  | 'bone'
  | 'feather';

type SurfaceCauses = {
  family: SurfaceFamily;
  seed: number;
  repeat: readonly [number, number];
  normalGain: number;
  labels: readonly string[];
  height: Float32Array;
  tone: Float32Array;
  roughness: Float32Array;
  accent: Float32Array;
};

type MaterialProfile = {
  name: string;
  family: SurfaceFamily;
  baseColor: number;
  accentColor?: number;
  albedoVariation: number;
  roughness: number;
  metalness: number;
  normalScale: number;
  envMapIntensity: number;
  side?: THREE.Side;
};

const TEXTURED_MATERIAL_ROLES = [
  'ash',
  'walnut',
  'bone',
  'steel',
  'bluedSteel',
  'brass',
  'leather',
  'oxblood',
  'paintedWood',
  'feather',
] as const satisfies readonly TexturedMaterialRole[];

const DEFAULT_SEED = 0x51a7c0de;
const TEXTURE_CHANNEL_BYTES = 4;
const TWO_PI = Math.PI * 2;

const MATERIAL_PROFILES = {
  ash: {
    name: 'Waxed ash weapon haft',
    family: 'wood',
    baseColor: 0x956a3b,
    albedoVariation: 0.3,
    roughness: 0.79,
    metalness: 0,
    normalScale: 0.62,
    envMapIntensity: 0.72,
  },
  walnut: {
    name: 'Dark walnut stock',
    family: 'wood',
    baseColor: 0x4b2b19,
    albedoVariation: 0.34,
    roughness: 0.7,
    metalness: 0,
    normalScale: 0.52,
    envMapIntensity: 0.78,
  },
  bone: {
    name: 'Polished horn and bone',
    family: 'bone',
    baseColor: 0xc7ba91,
    albedoVariation: 0.16,
    roughness: 0.66,
    metalness: 0,
    normalScale: 0.24,
    envMapIntensity: 0.74,
  },
  steel: {
    name: 'Satin forged steel',
    family: 'steel',
    baseColor: 0xbfc4c5,
    albedoVariation: 0.18,
    roughness: 0.47,
    metalness: 0.94,
    normalScale: 0.34,
    envMapIntensity: 1.05,
  },
  bluedSteel: {
    name: 'Blued forged steel',
    family: 'steel',
    baseColor: 0x3e4a4c,
    albedoVariation: 0.2,
    roughness: 0.58,
    metalness: 0.84,
    normalScale: 0.29,
    envMapIntensity: 0.92,
  },
  brass: {
    name: 'Cast brass fittings',
    family: 'brass',
    baseColor: 0xb58a3d,
    accentColor: 0x596247,
    albedoVariation: 0.2,
    roughness: 0.5,
    metalness: 0.9,
    normalScale: 0.38,
    envMapIntensity: 1,
  },
  leather: {
    name: 'Oiled brown leather',
    family: 'leather',
    baseColor: 0x4b2b19,
    albedoVariation: 0.34,
    roughness: 0.91,
    metalness: 0,
    normalScale: 0.7,
    envMapIntensity: 0.65,
  },
  oxblood: {
    name: 'Oxblood frontier leather',
    family: 'leather',
    baseColor: 0x67271f,
    albedoVariation: 0.32,
    roughness: 0.85,
    metalness: 0,
    normalScale: 0.64,
    envMapIntensity: 0.68,
  },
  paintedWood: {
    name: 'Muted red painted shield wood',
    family: 'painted-wood',
    baseColor: 0x7b3027,
    accentColor: 0x644329,
    albedoVariation: 0.23,
    roughness: 0.84,
    metalness: 0,
    normalScale: 0.56,
    envMapIntensity: 0.7,
  },
  feather: {
    name: 'Goose-feather fletching',
    family: 'feather',
    baseColor: 0xd7d1bd,
    albedoVariation: 0.16,
    roughness: 0.97,
    metalness: 0,
    normalScale: 0.42,
    envMapIntensity: 0.62,
    side: THREE.DoubleSide,
  },
} as const satisfies Record<TexturedMaterialRole, MaterialProfile>;

/**
 * Creates one compact surface library for the complete procedural weapon catalog.
 * Each family evaluates one deterministic cause stack; albedo, microsurface and
 * tangent normals are then derived from that same stack. Related finish colors
 * share roughness/normal textures, so close-up response does not add draw calls.
 */
export function createMilitaryEquipmentMaterials(
  options: MilitaryEquipmentMaterialOptions | number = {},
): MilitaryEquipmentMaterials {
  const normalized = normalizeOptions(options);
  const causesByFamily = new Map<SurfaceFamily, SurfaceCauses>();
  const responseMapsByFamily = new Map<
    SurfaceFamily,
    { roughness: THREE.DataTexture; normal: THREE.DataTexture }
  >();
  const materials = {} as Record<TexturedMaterialRole, THREE.MeshStandardMaterial>;

  for (const role of TEXTURED_MATERIAL_ROLES) {
    const profile: MaterialProfile = MATERIAL_PROFILES[role];
    let causes = causesByFamily.get(profile.family);
    if (!causes) {
      causes = createSurfaceCauses(profile.family, normalized.seed);
      causesByFamily.set(profile.family, causes);
    }

    let responseMaps = responseMapsByFamily.get(profile.family);
    if (!responseMaps) {
      responseMaps = {
        roughness: createRoughnessTexture(causes, normalized),
        normal: createNormalTexture(causes, normalized),
      };
      responseMapsByFamily.set(profile.family, responseMaps);
    }

    const map = createAlbedoTexture(role, profile, causes, normalized);
    const material = new THREE.MeshStandardMaterial({
      name: profile.name,
      color: 0xffffff,
      map,
      roughnessMap: responseMaps.roughness,
      normalMap: responseMaps.normal,
      roughness: profile.roughness,
      metalness: profile.metalness,
      envMapIntensity: profile.envMapIntensity,
      side: profile.side ?? THREE.FrontSide,
    });
    material.normalMapType = THREE.TangentSpaceNormalMap;
    material.normalScale.setScalar(profile.normalScale);
    material.userData.militaryEquipmentMaterial = true;
    material.userData.militaryEquipmentMaterialRole = role;
    material.userData.militaryEquipmentSurfaceFamily = profile.family;
    material.userData.militaryEquipmentCausalFields = [...causes.labels];
    material.userData.militaryEquipmentDeterministicSeed = causes.seed;
    material.userData.militaryEquipmentTextureResolution =
      MILITARY_EQUIPMENT_TEXTURE_SIZE;
    material.userData.militaryEquipmentTextureRepeat = [
      map.repeat.x,
      map.repeat.y,
    ];
    material.userData.militaryEquipmentSpecularAA =
      'mip-filtered normal plus authored roughness floor';
    materials[role] = material;
  }

  const cord = new THREE.LineBasicMaterial({
    name: 'Hemp bow cord',
    color: 0xd6c89d,
    fog: true,
    toneMapped: true,
  });
  cord.userData.militaryEquipmentMaterial = true;
  cord.userData.militaryEquipmentMaterialRole = 'cord';
  cord.userData.militaryEquipmentSurfaceFamily = 'hemp-cord-line';
  cord.userData.militaryEquipmentCausalFields = [];
  cord.userData.militaryEquipmentLineCompatibility =
    'LineBasicMaterial retained for THREE.Line assemblies';

  return { ...materials, cord };
}

/** Short compatibility name for callers migrating the former local helper. */
export const createMaterials = createMilitaryEquipmentMaterials;

export function militaryEquipmentMaterialDiagnostics(
  materials: MilitaryEquipmentMaterials,
): MilitaryEquipmentMaterialDiagnostics {
  const textures = new Set<THREE.Texture>();
  let textureReferenceCount = 0;
  const roles = MILITARY_EQUIPMENT_MATERIAL_ROLES.map((role) => {
    const material = materials[role];
    if (!(material instanceof THREE.MeshStandardMaterial)) {
      return {
        role,
        materialName: material.name,
        materialClass: 'line' as const,
        surfaceFamily: String(
          material.userData.militaryEquipmentSurfaceFamily ?? 'line',
        ),
        albedoMap: null,
        roughnessMap: null,
        normalMap: null,
        metalness: null,
        roughnessRange: null,
        normalScale: null,
        causalFields: [] as readonly string[],
      };
    }

    for (const texture of [material.map, material.roughnessMap, material.normalMap]) {
      if (!texture) continue;
      textures.add(texture);
      textureReferenceCount += 1;
    }
    return {
      role,
      materialName: material.name,
      materialClass: 'pbr' as const,
      surfaceFamily: String(
        material.userData.militaryEquipmentSurfaceFamily ?? 'unknown',
      ),
      albedoMap: material.map?.name ?? null,
      roughnessMap: material.roughnessMap?.name ?? null,
      normalMap: material.normalMap?.name ?? null,
      metalness: material.metalness,
      roughnessRange: roughnessRange(material),
      normalScale: [material.normalScale.x, material.normalScale.y] as const,
      causalFields: (
        material.userData.militaryEquipmentCausalFields as string[] | undefined
      ) ?? [],
    };
  });
  const sourceTextureBytes = textures.size
    * MILITARY_EQUIPMENT_TEXTURE_SIZE
    * MILITARY_EQUIPMENT_TEXTURE_SIZE
    * TEXTURE_CHANNEL_BYTES;

  return {
    materialCount: MILITARY_EQUIPMENT_MATERIAL_ROLES.length,
    pbrMaterialCount: TEXTURED_MATERIAL_ROLES.length,
    textureCount: textures.size,
    textureReferenceCount,
    sharedTextureReferences: textureReferenceCount - textures.size,
    textureResolution: MILITARY_EQUIPMENT_TEXTURE_SIZE,
    sourceTextureBytes,
    estimatedMipmappedTextureBytes:
      textures.size * mipmappedTextureBytes(MILITARY_EQUIPMENT_TEXTURE_SIZE),
    deterministicSeed: Number(
      materials.ash.userData.militaryEquipmentDeterministicSeed ?? DEFAULT_SEED,
    ),
    roles,
  };
}

/** Releases every shared map exactly once, then each role material exactly once. */
export function disposeMilitaryEquipmentMaterials(
  materials: MilitaryEquipmentMaterials,
): void {
  const textures = new Set<THREE.Texture>();
  for (const role of TEXTURED_MATERIAL_ROLES) {
    const material = materials[role];
    for (const texture of [material.map, material.roughnessMap, material.normalMap]) {
      if (texture) textures.add(texture);
    }
  }
  for (const texture of textures) {
    if (texture.userData.militaryEquipmentDisposed === true) continue;
    texture.userData.militaryEquipmentDisposed = true;
    texture.dispose();
  }
  for (const role of MILITARY_EQUIPMENT_MATERIAL_ROLES) {
    const material = materials[role];
    if (material.userData.militaryEquipmentDisposed === true) continue;
    material.userData.militaryEquipmentDisposed = true;
    material.dispose();
  }
}

function normalizeOptions(
  options: MilitaryEquipmentMaterialOptions | number,
): Required<MilitaryEquipmentMaterialOptions> {
  const requested = typeof options === 'number'
    ? { anisotropy: options }
    : options;
  return {
    anisotropy: THREE.MathUtils.clamp(
      Math.floor(requested.anisotropy ?? 4),
      1,
      16,
    ),
    seed: (requested.seed ?? DEFAULT_SEED) >>> 0,
    textureScale: THREE.MathUtils.clamp(requested.textureScale ?? 1, 0.25, 4),
  };
}

function createSurfaceCauses(
  family: SurfaceFamily,
  catalogSeed: number,
): SurfaceCauses {
  const seed = mix32(catalogSeed ^ stringSeed(family));
  const pixelCount = MILITARY_EQUIPMENT_TEXTURE_SIZE ** 2;
  const height = new Float32Array(pixelCount);
  const tone = new Float32Array(pixelCount);
  const roughness = new Float32Array(pixelCount);
  const accent = new Float32Array(pixelCount);
  const definition = surfaceDefinition(family);

  for (let y = 0; y < MILITARY_EQUIPMENT_TEXTURE_SIZE; y += 1) {
    const v = (y + 0.5) / MILITARY_EQUIPMENT_TEXTURE_SIZE;
    for (let x = 0; x < MILITARY_EQUIPMENT_TEXTURE_SIZE; x += 1) {
      const u = (x + 0.5) / MILITARY_EQUIPMENT_TEXTURE_SIZE;
      const sample = sampleSurface(family, u, v, seed);
      const index = y * MILITARY_EQUIPMENT_TEXTURE_SIZE + x;
      height[index] = sample.height;
      tone[index] = sample.tone;
      roughness[index] = sample.roughness;
      accent[index] = sample.accent;
    }
  }

  return {
    family,
    seed,
    repeat: definition.repeat,
    normalGain: definition.normalGain,
    labels: definition.labels,
    height,
    tone,
    roughness,
    accent,
  };
}

function surfaceDefinition(family: SurfaceFamily): {
  repeat: readonly [number, number];
  normalGain: number;
  labels: readonly string[];
} {
  switch (family) {
    case 'wood':
      return {
        repeat: [2, 6],
        normalGain: 5.4,
        labels: ['annual grain', 'open pores', 'handled wax wear'],
      };
    case 'steel':
      return {
        repeat: [3, 3],
        normalGain: 4.2,
        labels: ['forging undulation', 'draw-file scratches', 'micro-pits'],
      };
    case 'brass':
      return {
        repeat: [3, 3],
        normalGain: 4,
        labels: ['cast clouding', 'polish scratches', 'recess patina'],
      };
    case 'leather':
      return {
        repeat: [3, 3],
        normalGain: 4.8,
        labels: ['hide pebble', 'grain creases', 'oiled handling wear'],
      };
    case 'painted-wood':
      return {
        repeat: [2, 4],
        normalGain: 5,
        labels: ['wood grain', 'paint film', 'impact chips'],
      };
    case 'bone':
      return {
        repeat: [2, 3],
        normalGain: 2.8,
        labels: ['lamellar growth', 'fine pores', 'polished handling wear'],
      };
    case 'feather':
      return {
        repeat: [1, 2],
        normalGain: 3.6,
        labels: ['central rachis', 'interlocking barbs', 'small vane splits'],
      };
  }
}

function sampleSurface(
  family: SurfaceFamily,
  u: number,
  v: number,
  seed: number,
): { height: number; tone: number; roughness: number; accent: number } {
  switch (family) {
    case 'wood': {
      const warp = periodicFbm(u, v, seed ^ 0x1a51, 2, 2, 4) - 0.5;
      const grain = 0.5 + 0.5 * Math.sin(
        TWO_PI * (u * 6 + v * 2 + warp * 1.35),
      );
      const fineGrain = 0.5 + 0.5 * Math.sin(
        TWO_PI * (u * 23 + v * 4 + warp * 2.1),
      );
      const poreNoise = periodicValueNoise(u, v, 32, 16, seed ^ 0x7721);
      const pores = smoothstep(0.81, 0.96, poreNoise)
        * (0.45 + 0.55 * fineGrain);
      const wear = periodicFbm(u, v, seed ^ 0x529d, 2, 3, 3);
      return {
        height: clamp01(
          0.47 + (grain - 0.5) * 0.34 + (fineGrain - 0.5) * 0.1
            - pores * 0.2,
        ),
        tone: clampSigned(
          (grain - 0.5) * 1.08 + (fineGrain - 0.5) * 0.18
            + (wear - 0.5) * 0.2 - pores * 0.24,
        ),
        roughness: THREE.MathUtils.clamp(
          0.91 + pores * 0.08 - wear * 0.075
            + Math.abs(grain - 0.5) * 0.035,
          0.79,
          0.99,
        ),
        accent: 0,
      };
    }
    case 'steel': {
      const forge = periodicFbm(u, v, seed ^ 0x24d3, 2, 3, 4);
      const brushWarp = periodicValueNoise(u, v, 3, 2, seed ^ 0x5f18) - 0.5;
      const brush = Math.sin(TWO_PI * (v * 34 + u * 2 + brushWarp * 0.28));
      const scratchNoise = periodicValueNoise(u, v, 48, 12, seed ^ 0xa251);
      const scratches = smoothstep(0.88, 0.985, scratchNoise);
      const pitNoise = periodicValueNoise(u, v, 26, 24, seed ^ 0x6ad1);
      const pits = smoothstep(0.9, 0.985, pitNoise);
      const polish = periodicFbm(u, v, seed ^ 0xc301, 2, 2, 3);
      return {
        height: clamp01(
          0.5 + (forge - 0.5) * 0.17 + brush * 0.025
            - scratches * 0.13 - pits * 0.18,
        ),
        tone: clampSigned(
          (forge - 0.5) * 0.4 + brush * 0.055
            + scratches * 0.16 - pits * 0.24,
        ),
        roughness: THREE.MathUtils.clamp(
          0.79 + (forge - 0.5) * 0.11 + pits * 0.16
            + scratches * 0.07 - polish * 0.07,
          0.68,
          0.98,
        ),
        accent: 0,
      };
    }
    case 'brass': {
      const cast = periodicFbm(u, v, seed ^ 0x711a, 3, 3, 4);
      const polishWarp = periodicValueNoise(u, v, 3, 2, seed ^ 0xb173) - 0.5;
      const polish = Math.sin(TWO_PI * (u * 28 + v * 3 + polishWarp * 0.24));
      const recess = smoothstep(
        0.69,
        0.9,
        periodicFbm(u, v, seed ^ 0x4ac1, 5, 5, 3),
      );
      const nick = smoothstep(
        0.9,
        0.985,
        periodicValueNoise(u, v, 36, 22, seed ^ 0x1d51),
      );
      return {
        height: clamp01(
          0.49 + (cast - 0.5) * 0.19 + polish * 0.03
            - recess * 0.1 - nick * 0.15,
        ),
        tone: clampSigned(
          (cast - 0.5) * 0.48 + polish * 0.07
            - recess * 0.34 + nick * 0.12,
        ),
        roughness: THREE.MathUtils.clamp(
          0.79 + (cast - 0.5) * 0.11 + recess * 0.16 + nick * 0.08,
          0.72,
          0.99,
        ),
        accent: recess * 0.38,
      };
    }
    case 'leather': {
      const cells = periodicWorley(u, v, 15, 15, seed ^ 0x91bc);
      const pebble = 1 - smoothstep(0.12, 0.72, cells.nearest);
      const crease = 1 - smoothstep(0.025, 0.17, cells.second - cells.nearest);
      const wear = periodicFbm(u, v, seed ^ 0xe178, 2, 3, 4);
      const pores = smoothstep(
        0.86,
        0.985,
        periodicValueNoise(u, v, 42, 42, seed ^ 0x4d22),
      );
      return {
        height: clamp01(
          0.38 + pebble * 0.35 - crease * 0.18 - pores * 0.09,
        ),
        tone: clampSigned(
          (pebble - 0.5) * 0.31 - crease * 0.3
            + (wear - 0.5) * 0.27 - pores * 0.1,
        ),
        roughness: THREE.MathUtils.clamp(
          0.94 - pebble * wear * 0.13 + crease * 0.055 + pores * 0.03,
          0.8,
          0.995,
        ),
        accent: 0,
      };
    }
    case 'painted-wood': {
      const warp = periodicFbm(u, v, seed ^ 0x230a, 2, 2, 3) - 0.5;
      const grain = 0.5 + 0.5 * Math.sin(
        TWO_PI * (u * 7 + v * 2 + warp * 1.2),
      );
      const broadWear = periodicFbm(u, v, seed ^ 0x138c, 3, 4, 4);
      const impacts = periodicValueNoise(u, v, 32, 28, seed ^ 0xc12a);
      const chips = Math.max(
        smoothstep(0.72, 0.91, broadWear),
        smoothstep(0.925, 0.992, impacts) * 0.9,
      );
      const paintMottle = periodicFbm(u, v, seed ^ 0x78a2, 6, 6, 3);
      return {
        height: clamp01(
          0.43 + (grain - 0.5) * 0.14 + (1 - chips) * 0.15
            + (paintMottle - 0.5) * 0.05,
        ),
        tone: clampSigned(
          (paintMottle - 0.5) * 0.48 + (grain - 0.5) * 0.18
            - chips * 0.16,
        ),
        roughness: THREE.MathUtils.clamp(
          0.82 + chips * 0.15 + (paintMottle - 0.5) * 0.08,
          0.75,
          0.99,
        ),
        accent: clamp01(chips),
      };
    }
    case 'bone': {
      const lamella = 0.5 + 0.5 * Math.sin(
        TWO_PI * (v * 8 + periodicFbm(u, v, seed ^ 0x913a, 2, 3, 3) * 0.7),
      );
      const pores = smoothstep(
        0.91,
        0.992,
        periodicValueNoise(u, v, 34, 28, seed ^ 0xb061),
      );
      const polish = periodicFbm(u, v, seed ^ 0x7a12, 3, 3, 3);
      return {
        height: clamp01(0.5 + (lamella - 0.5) * 0.08 - pores * 0.12),
        tone: clampSigned(
          (lamella - 0.5) * 0.2 - pores * 0.18 + (polish - 0.5) * 0.1,
        ),
        roughness: THREE.MathUtils.clamp(
          0.82 + pores * 0.1 - polish * 0.08,
          0.69,
          0.96,
        ),
        accent: 0,
      };
    }
    case 'feather': {
      const rachis = Math.exp(-Math.pow((u - 0.5) / 0.065, 2));
      const barb = 0.5 + 0.5 * Math.sin(TWO_PI * (v * 30 + u * 7));
      const vane = periodicFbm(u, v, seed ^ 0x4f11, 4, 8, 3);
      const splits = smoothstep(
        0.91,
        0.99,
        periodicValueNoise(u, v, 18, 42, seed ^ 0xda41),
      ) * (1 - rachis);
      return {
        height: clamp01(
          0.46 + rachis * 0.23 + (barb - 0.5) * 0.1
            + (vane - 0.5) * 0.07 - splits * 0.14,
        ),
        tone: clampSigned(
          rachis * 0.22 + (barb - 0.5) * 0.2
            + (vane - 0.5) * 0.24 - splits * 0.31,
        ),
        roughness: THREE.MathUtils.clamp(
          0.95 - rachis * 0.055 + Math.abs(barb - 0.5) * 0.04
            + splits * 0.025,
          0.88,
          0.995,
        ),
        accent: 0,
      };
    }
  }
}

function createAlbedoTexture(
  role: TexturedMaterialRole,
  profile: MaterialProfile,
  causes: SurfaceCauses,
  options: Required<MilitaryEquipmentMaterialOptions>,
): THREE.DataTexture {
  const data = new Uint8Array(
    MILITARY_EQUIPMENT_TEXTURE_SIZE ** 2 * TEXTURE_CHANNEL_BYTES,
  );
  const base = colorToLinear(profile.baseColor);
  const accent = colorToLinear(profile.accentColor ?? profile.baseColor);
  for (let index = 0; index < causes.tone.length; index += 1) {
    const accentWeight = causes.accent[index]!;
    const variation = THREE.MathUtils.clamp(
      1 + causes.tone[index]! * profile.albedoVariation,
      0.55,
      1.35,
    );
    const offset = index * TEXTURE_CHANNEL_BYTES;
    data[offset] = encodeSrgb(
      THREE.MathUtils.lerp(base[0], accent[0], accentWeight) * variation,
    );
    data[offset + 1] = encodeSrgb(
      THREE.MathUtils.lerp(base[1], accent[1], accentWeight) * variation,
    );
    data[offset + 2] = encodeSrgb(
      THREE.MathUtils.lerp(base[2], accent[2], accentWeight) * variation,
    );
    data[offset + 3] = 255;
  }
  return createTexture(
    data,
    `Military equipment · ${role} · albedo · 128`,
    causes,
    'albedo',
    options,
  );
}

function createRoughnessTexture(
  causes: SurfaceCauses,
  options: Required<MilitaryEquipmentMaterialOptions>,
): THREE.DataTexture {
  const data = new Uint8Array(
    MILITARY_EQUIPMENT_TEXTURE_SIZE ** 2 * TEXTURE_CHANNEL_BYTES,
  );
  for (let index = 0; index < causes.roughness.length; index += 1) {
    const value = Math.round(clamp01(causes.roughness[index]!) * 255);
    const offset = index * TEXTURE_CHANNEL_BYTES;
    data[offset] = value;
    data[offset + 1] = value;
    data[offset + 2] = value;
    data[offset + 3] = 255;
  }
  return createTexture(
    data,
    `Military equipment · ${causes.family} · roughness · 128`,
    causes,
    'roughness',
    options,
  );
}

function createNormalTexture(
  causes: SurfaceCauses,
  options: Required<MilitaryEquipmentMaterialOptions>,
): THREE.DataTexture {
  const size = MILITARY_EQUIPMENT_TEXTURE_SIZE;
  const data = new Uint8Array(size * size * TEXTURE_CHANNEL_BYTES);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const left = causes.height[y * size + wrapInteger(x - 1, size)]!;
      const right = causes.height[y * size + wrapInteger(x + 1, size)]!;
      const up = causes.height[wrapInteger(y - 1, size) * size + x]!;
      const down = causes.height[wrapInteger(y + 1, size) * size + x]!;
      let normalX = -(right - left) * causes.normalGain;
      let normalY = -(down - up) * causes.normalGain;
      let normalZ = 1;
      const length = Math.hypot(normalX, normalY, normalZ);
      normalX /= length;
      normalY /= length;
      normalZ /= length;
      const offset = (y * size + x) * TEXTURE_CHANNEL_BYTES;
      data[offset] = Math.round((normalX * 0.5 + 0.5) * 255);
      data[offset + 1] = Math.round((normalY * 0.5 + 0.5) * 255);
      data[offset + 2] = Math.round((normalZ * 0.5 + 0.5) * 255);
      data[offset + 3] = 255;
    }
  }
  return createTexture(
    data,
    `Military equipment · ${causes.family} · normal · 128`,
    causes,
    'normal',
    options,
  );
}

function createTexture(
  data: Uint8Array,
  name: string,
  causes: SurfaceCauses,
  channel: 'albedo' | 'roughness' | 'normal',
  options: Required<MilitaryEquipmentMaterialOptions>,
): THREE.DataTexture {
  const texture = new THREE.DataTexture(
    data,
    MILITARY_EQUIPMENT_TEXTURE_SIZE,
    MILITARY_EQUIPMENT_TEXTURE_SIZE,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );
  texture.name = name;
  texture.colorSpace = channel === 'albedo'
    ? THREE.SRGBColorSpace
    : THREE.NoColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(
    causes.repeat[0] * options.textureScale,
    causes.repeat[1] * options.textureScale,
  );
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = options.anisotropy;
  texture.flipY = false;
  texture.unpackAlignment = 4;
  texture.userData.militaryEquipmentTexture = true;
  texture.userData.militaryEquipmentTextureChannel = channel;
  texture.userData.militaryEquipmentSurfaceFamily = causes.family;
  texture.userData.militaryEquipmentCausalFields = [...causes.labels];
  texture.userData.militaryEquipmentDeterministicSeed = causes.seed;
  texture.userData.militaryEquipmentHeightDerived = channel === 'normal';
  texture.userData.militaryEquipmentTextureResolution =
    MILITARY_EQUIPMENT_TEXTURE_SIZE;
  texture.needsUpdate = true;
  return texture;
}

function roughnessRange(
  material: THREE.MeshStandardMaterial,
): readonly [number, number] | null {
  const data = dataTextureBytes(material.roughnessMap);
  if (!data) return null;
  let minimum = 1;
  let maximum = 0;
  for (let offset = 1; offset < data.length; offset += TEXTURE_CHANNEL_BYTES) {
    const roughness = data[offset]! / 255 * material.roughness;
    minimum = Math.min(minimum, roughness);
    maximum = Math.max(maximum, roughness);
  }
  return [minimum, maximum];
}

function dataTextureBytes(texture: THREE.Texture | null): Uint8Array | null {
  if (!(texture instanceof THREE.DataTexture)) return null;
  const image = texture.image as { data?: unknown };
  return image.data instanceof Uint8Array ? image.data : null;
}

function mipmappedTextureBytes(size: number): number {
  let dimension = size;
  let bytes = 0;
  while (dimension >= 1) {
    bytes += dimension * dimension * TEXTURE_CHANNEL_BYTES;
    dimension = Math.floor(dimension / 2);
  }
  return bytes;
}

function periodicFbm(
  u: number,
  v: number,
  seed: number,
  basePeriodX: number,
  basePeriodY: number,
  octaves: number,
): number {
  let amplitude = 0.56;
  let total = 0;
  let weight = 0;
  for (let octave = 0; octave < octaves; octave += 1) {
    const scale = 2 ** octave;
    total += periodicValueNoise(
      u,
      v,
      basePeriodX * scale,
      basePeriodY * scale,
      seed ^ Math.imul(octave + 1, 0x9e3779b1),
    ) * amplitude;
    weight += amplitude;
    amplitude *= 0.5;
  }
  return total / weight;
}

function periodicValueNoise(
  u: number,
  v: number,
  periodX: number,
  periodY: number,
  seed: number,
): number {
  const sampleX = u * periodX;
  const sampleY = v * periodY;
  const cellX = Math.floor(sampleX);
  const cellY = Math.floor(sampleY);
  const fractionX = smoothCurve(sampleX - cellX);
  const fractionY = smoothCurve(sampleY - cellY);
  const left = wrapInteger(cellX, periodX);
  const right = wrapInteger(cellX + 1, periodX);
  const top = wrapInteger(cellY, periodY);
  const bottom = wrapInteger(cellY + 1, periodY);
  const topValue = THREE.MathUtils.lerp(
    hash2(left, top, seed),
    hash2(right, top, seed),
    fractionX,
  );
  const bottomValue = THREE.MathUtils.lerp(
    hash2(left, bottom, seed),
    hash2(right, bottom, seed),
    fractionX,
  );
  return THREE.MathUtils.lerp(topValue, bottomValue, fractionY);
}

function periodicWorley(
  u: number,
  v: number,
  periodX: number,
  periodY: number,
  seed: number,
): { nearest: number; second: number } {
  const sampleX = u * periodX;
  const sampleY = v * periodY;
  const cellX = Math.floor(sampleX);
  const cellY = Math.floor(sampleY);
  let nearest = Number.POSITIVE_INFINITY;
  let second = Number.POSITIVE_INFINITY;
  for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
    for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
      const candidateX = cellX + offsetX;
      const candidateY = cellY + offsetY;
      const wrappedX = wrapInteger(candidateX, periodX);
      const wrappedY = wrapInteger(candidateY, periodY);
      const pointX = candidateX + 0.12 + hash2(wrappedX, wrappedY, seed) * 0.76;
      const pointY = candidateY + 0.12
        + hash2(wrappedX, wrappedY, seed ^ 0x68bc21eb) * 0.76;
      const distance = Math.hypot(sampleX - pointX, sampleY - pointY);
      if (distance < nearest) {
        second = nearest;
        nearest = distance;
      } else if (distance < second) {
        second = distance;
      }
    }
  }
  return { nearest, second };
}

function hash2(x: number, y: number, seed: number): number {
  let value = seed ^ Math.imul(x + 0x7f4a7c15, 0x85ebca6b);
  value ^= Math.imul(y + 0x165667b1, 0xc2b2ae35);
  return mix32(value) / 0x1_0000_0000;
}

function mix32(input: number): number {
  let value = input >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
  return (value ^ (value >>> 16)) >>> 0;
}

function stringSeed(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function wrapInteger(value: number, period: number): number {
  return ((value % period) + period) % period;
}

function smoothCurve(value: number): number {
  return value * value * value * (value * (value * 6 - 15) + 10);
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const amount = clamp01((value - edge0) / (edge1 - edge0));
  return amount * amount * (3 - 2 * amount);
}

function clamp01(value: number): number {
  return THREE.MathUtils.clamp(value, 0, 1);
}

function clampSigned(value: number): number {
  return THREE.MathUtils.clamp(value, -1, 1);
}

function colorToLinear(color: number): readonly [number, number, number] {
  return [
    decodeSrgb((color >>> 16 & 0xff) / 255),
    decodeSrgb((color >>> 8 & 0xff) / 255),
    decodeSrgb((color & 0xff) / 255),
  ];
}

function decodeSrgb(value: number): number {
  return value <= 0.04045
    ? value / 12.92
    : ((value + 0.055) / 1.055) ** 2.4;
}

function encodeSrgb(linear: number): number {
  const value = clamp01(linear);
  const srgb = value <= 0.0031308
    ? value * 12.92
    : 1.055 * value ** (1 / 2.4) - 0.055;
  return Math.round(clamp01(srgb) * 255);
}
