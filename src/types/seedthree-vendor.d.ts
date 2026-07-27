declare module '@seedthree/core/tree.js' {
  import type * as THREE from 'three';

  export function buildTree(
    species: unknown,
    seed: string | number,
    assets?: Record<string, unknown>,
    lodOpts?: Record<string, unknown>,
    reuse?: THREE.LOD | null,
  ): { group: THREE.LOD; stems: unknown[]; tips: unknown[] };

  export function makeBarkMaterial(assets?: Record<string, unknown>): THREE.Material;
  export function forestBarkMaterial(srcMat: THREE.Material): THREE.Material;
}

declare module '@seedthree/core/leaf-cards.js' {
  import type * as THREE from 'three';

  export function makeFoliageMaterial(
    assets: Record<string, unknown>,
    foliage: Record<string, unknown>,
  ): {
    material: THREE.Material;
    centerUniform: { value: THREE.Vector3 };
    tintNode: unknown;
    tintAmount: unknown;
  };
}

declare module '@seedthree/core/branch-cards.js' {
  import type * as THREE from 'three';

  export type BranchCardsSet = {
    variants: Array<{
      geometry: THREE.BufferGeometry;
      material: THREE.Material;
      textures: Record<string, THREE.Texture>;
      chordLen: number;
    }>;
    centerUniform: { value: THREE.Vector3 };
    foliageOnly?: boolean;
  };

  export function forestCardMaterial(srcMat: THREE.Material): THREE.Material;

  export function bakeBranchCards(
    renderer: unknown,
    species: unknown,
    assets: unknown,
    opts?: Record<string, unknown>,
  ): Promise<BranchCardsSet | null>;

  export function disposeBranchCards(cards: {
    byLevel?: Map<string, BranchCardsSet>;
    variants?: BranchCardsSet['variants'];
  }): void;
}

declare module '@seedthree/core/forest-lod.js' {
  import type { Camera } from 'three';

  export type ForestLodItem = {
    x: number;
    y: number;
    z: number;
    radius: number;
  };

  export type ForestLodOptions = {
    cellSize?: number;
    frustumPadding?: number;
    nearDistance?: number;
    lodHysteresis?: number;
    minimumCameraMove?: number;
    minimumDirectionAngle?: number;
    casterBounds?: {
      minX: number;
      maxX: number;
      minZ: number;
      maxZ: number;
    } | null;
    casterPadding?: number;
    force?: boolean;
  };

  export type ForestLodSelector = {
    readonly items: readonly ForestLodItem[];
    readonly revision: number;
  };

  export type ForestLodSelection = {
    nearIndices: number[];
    overviewIndices: number[];
    /** Trees intersecting the padded camera frustum, excluding shadow-only casters. */
    viewIndices: number[];
    visibleCount: number;
    culledCount: number;
    changed: boolean;
    skipped: boolean;
    revision: number;
  };

  export function createForestLodSelector(
    items: readonly ForestLodItem[],
    options?: ForestLodOptions,
  ): ForestLodSelector;

  export function selectForestLods(
    selector: ForestLodSelector,
    camera: Camera,
    options?: ForestLodOptions,
  ): ForestLodSelection;

  export type ForestCanopyCompanion = {
    offsetX: number;
    offsetZ: number;
    scale: number;
    rotation: number;
  };

  export type ForestCanopyCompanionOptions = {
    neighborRadius?: number;
    maxCompanions?: number;
    denseNeighborCount?: number;
    minOffset?: number;
    maxOffset?: number;
    minScale?: number;
    maxScale?: number;
  };

  export function createForestCanopyCompanions(
    items: readonly ForestLodItem[],
    options?: ForestCanopyCompanionOptions,
  ): ForestCanopyCompanion[][];
}

declare module '@seedthree/core/forest-ecology.js' {
  import type * as THREE from 'three';

  export type ForestEcologyPlacement = {
    x: number;
    z: number;
    scale?: number;
    length?: number;
    rotation: number;
    variant: number;
    sourceIndex: number;
  };

  export type ForestEdgeEcology = {
    saplings: ForestEcologyPlacement[];
    understory: ForestEcologyPlacement[];
    deadwood: ForestEcologyPlacement[];
    litter: ForestEcologyPlacement[];
    anchorCount: number;
  };

  export type ForestEcologyStats = {
    counts: {
      anchors: number;
      saplings: number;
      understory: number;
      deadwood: number;
      litter: number;
    };
    draws: number;
    instances: number;
    triangles: number;
  };

  export function createForestEdgeEcology(
    items: readonly Array<{ x: number; z: number }>,
    options?: {
      protectedRadius?: number;
      outerRadius?: number;
      neighborRadius?: number;
      minimumNeighbors?: number;
      minimumAnchorSpacing?: number;
      edgeBandWidth?: number;
      maxAnchors?: number;
      maxSaplings?: number;
      maxUnderstory?: number;
      maxDeadwood?: number;
      maxLitter?: number;
      isBlockedAt?: (x: number, z: number) => boolean;
    },
  ): ForestEdgeEcology;

  export function buildForestEdgeEcology(
    ecology: ForestEdgeEcology,
    options?: {
      name?: string;
      getHeightAt?: (x: number, z: number) => number;
    },
  ): {
    group: THREE.Group;
    stats: ForestEcologyStats;
    dispose(): void;
  };
}

declare module '@seedthree/core/rng.js' {
  export class Rng {
    constructor(seed: string | number);
    next(): number;
    range(min: number, max: number): number;
  }
}

declare module '@seedthree/core/wind.js' {
  import type * as THREE from 'three';

  export const windStrength: { value: number };
  export const windSpeed: { value: number };
  export const WIND_DIR: THREE.Vector3;
  export function foliageWindPosition(withFlutter?: boolean): unknown;
  export function grassWindPosition(bladeHeight?: number): unknown;
  export function groundCoverWindPosition(amount?: number): unknown;
}

declare module '@seedthree/core/wildflowers.js' {
  import type * as THREE from 'three';

  export const WILDFLOWER_COLORS: readonly number[];
  export function createWildflowerGeometry(): THREE.BufferGeometry;
  export function createWildflowerMaterial(options?: {
    name?: string;
    positionNode?: unknown;
  }): THREE.Material;
  export function sampleWildflowerColor(
    paletteIndex: number,
    rng: () => number,
    out?: THREE.Color,
  ): THREE.Color;
}

declare module '@seedthree/core/ground-cover.js' {
  import type * as THREE from 'three';

  export type GroundCoverTextures = {
    albedo: THREE.Texture;
    normal: THREE.Texture | null;
    roughness: THREE.Texture | null;
    translucency: THREE.Texture | null;
  };

  export function loadGroundCoverTextures(
    sources: {
      albedo: string | undefined;
      normal?: string | undefined;
      roughness?: string | undefined;
      translucency?: string | undefined;
    },
    maxAnisotropy?: number,
  ): Promise<GroundCoverTextures>;

  export function createGroundCoverMaterial(options: {
    name?: string;
    textures: GroundCoverTextures;
    transmit?: [number, number, number];
    windAmount?: number;
    positionNode?: unknown;
    alphaTest?: number;
  }): THREE.Material;

  export function createCardClumpGeometry(spec: {
    quads: number;
    width: number;
    tiltMin: number;
    tiltSpan: number;
    heightMin: number;
    heightSpan: number;
    baseSpread: number;
  }): THREE.BufferGeometry;

  export function addGroundCoverInstanceAttributes(
    geometry: THREE.BufferGeometry,
    capacity: number,
  ): {
    tint: THREE.InstancedBufferAttribute;
    anchor: THREE.InstancedBufferAttribute;
    wind: THREE.InstancedBufferAttribute;
  };

  export function groundCoverWindVector(
    yaw: number,
    scale: THREE.Vector3,
    out?: THREE.Vector3,
  ): THREE.Vector3;
  export function disposeGroundCoverTextures(textures: GroundCoverTextures): void;
}

declare module '@seedthree/core/cattails.js' {
  import type * as THREE from 'three';

  export const CATTAIL_TEXTURE_FILES: {
    albedo: string;
    normal: string;
    roughness: string;
    translucency: string;
  };
  export function createCattailGeometry(
    overrides?: Partial<{
      quads: number;
      width: number;
      tiltMin: number;
      tiltSpan: number;
      heightMin: number;
      heightSpan: number;
      baseSpread: number;
    }>,
  ): THREE.BufferGeometry;
}

declare module '@seedthree/species/apple.js' {
  export const apple: Record<string, unknown>;
}

declare module '@seedthree/species/cherry.js' {
  export const cherry: Record<string, unknown>;
}

declare module '@seedthree/species/index.js' {
  export const SPECIES: Record<string, Record<string, unknown>>;
  export const DEFAULT_SPECIES: string;
}
