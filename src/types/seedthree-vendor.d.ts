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

  export const BRANCH_CARD_CROWN_UNDERLAY_DEFAULTS: {
    maxRootCards: number;
    radialPlanes: number;
    trianglesPerPlane: number;
    lateralScale: number;
    maxLateralScale: number;
  };

  export function planBranchCardCrownUnderlay(
    foliage?: Record<string, unknown>,
    rootStemCount?: number,
  ): {
    enabled: boolean;
    lateralScale: number;
    rootCardInstances: number;
    runtimeTrianglesAdded: number;
    runtimeDrawsAdded: number;
  };

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

  export function forestCardMaterial(
    srcMat: THREE.Material,
    options?: {
      seasonalDeciduous?: boolean;
      canopyTint?: readonly [number, number, number];
      autumnColor?: readonly [number, number, number];
      toneVariation?: number;
    },
  ): THREE.Material;
  export function setForestCardDormancy(material: THREE.Material, amount: number): boolean;
  export function setForestCardSeason(
    material: THREE.Material,
    state: {
      springFlush: number;
      autumnColor: number;
      dormancy: number;
    },
  ): boolean;

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
    /** Permanently cap this slot to the existing overview/card detail rung. */
    forceOverview?: boolean;
  };

  export type ForestLodOptions = {
    cellSize?: number;
    frustumPadding?: number;
    /** Keep a 360-degree color-visible bubble around a rapidly turning camera. */
    viewRetentionRadius?: number;
    nearDistance?: number;
    lodHysteresis?: number;
    minimumCameraMove?: number;
    minimumDirectionAngle?: number;
    minimumProjectionChange?: number;
    minimumCasterBoundsChange?: number;
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
    readonly telemetry: {
      calls: number;
      evaluations: number;
      skips: number;
      lastTriggerReasons: ForestLodTriggerReason[];
      triggerReasons: Record<ForestLodTriggerReason, number>;
    };
  };

  export type ForestLodTriggerReason =
    | 'initial'
    | 'force'
    | 'camera-moved'
    | 'camera-turned'
    | 'projection-envelope'
    | 'caster-bounds-envelope'
    | 'selection-policy';

  export type ForestLodSelection = {
    nearIndices: number[];
    overviewIndices: number[];
    /** Trees intersecting the padded camera frustum, excluding shadow-only casters. */
    viewIndices: number[];
    visibleCount: number;
    culledCount: number;
    changed: boolean;
    skipped: boolean;
    triggerReasons: ForestLodTriggerReason[];
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

declare module '@seedthree/core/forest-edge-band.js' {
  export type ForestEdgeBandSourceItem = {
    x: number;
    z: number;
    [key: string]: unknown;
  };

  export type ForestEdgeBandSample = {
    x: number;
    z: number;
    outwardX: number;
    outwardZ: number;
  };

  export type ForestEdgeBandAssignment = {
    sourceIndex: number;
    x: number;
    z: number;
    clusterIndex: number;
    memberIndex: number;
    edgeSampleIndex: number;
    bandDistance: number;
    tangentOffset: number;
    variantIndex: number;
  };

  export type ForestEdgeBandStats = {
    sourceCount: number;
    eligibleSourceCount: number;
    reallocatedCount: number;
    retainedCount: number;
    clusterCount: number;
    minBandDistance: number;
    maxBandDistance: number;
    observedMinBandDistance: number | null;
    observedMaxBandDistance: number | null;
  };

  export function createForestEdgeBandReallocation<
    Item extends ForestEdgeBandSourceItem,
  >(
    sourceItems: readonly Item[],
    edgeSamples: readonly ForestEdgeBandSample[],
    options?: {
      targetCount?: number;
      sourceIndices?: readonly number[];
      minBandDistance?: number;
      maxBandDistance?: number;
      maxClusterSize?: number;
      clusterTangentSpread?: number;
      clusterDepthSpread?: number;
      variantCount?: number;
      seed?: number | string;
      maxPlacementAttempts?: number;
      isAllowedAt?: (
        x: number,
        z: number,
        sourceIndex: number,
      ) => boolean;
    },
  ): {
    items: Item[];
    assignments: ForestEdgeBandAssignment[];
    stats: ForestEdgeBandStats;
  };
}

declare module '@seedthree/core/forest-update-budget.js' {
  export type SeedThreeBucketSelection = {
    near: readonly number[];
    overview: readonly number[];
  };

  export function planForestBucketUpdates(
    current: readonly SeedThreeBucketSelection[],
    desired: readonly SeedThreeBucketSelection[],
    previousPendingBucketIndices: readonly number[],
    maxBucketUploads: number,
  ): {
    uploadBucketIndices: number[];
    pendingBucketIndices: number[];
  };

  export function coalesceForestBucketUpdates(
    current: readonly SeedThreeBucketSelection[],
    desired: readonly SeedThreeBucketSelection[],
    previousPendingBucketIndices: readonly number[],
  ): {
    pendingBucketIndices: number[];
    cancelledBucketIndices: number[];
  };

  export function runForestBucketUpdateChunk(
    current: readonly SeedThreeBucketSelection[],
    desired: readonly SeedThreeBucketSelection[],
    previousPendingBucketIndices: readonly number[],
    options: {
      maxDurationMs: number;
      minimumChunkHeadroomMs?: number;
      maxChunks: number;
      maxBucketCompletions: number;
      now?: () => number;
      applyBucketChunk(
        bucketIndex: number,
        context: {
          deadlineMs: number;
          elapsedMs: number;
          remainingMs: number;
        },
      ): boolean | { completed: boolean };
    },
  ): {
    completedBucketIndices: number[];
    pendingBucketIndices: number[];
    cancelledBucketIndices: number[];
    chunks: number;
    durationMs: number;
    stopReason: 'converged' | 'chunk-limit' | 'time-limit' | 'headroom-limit';
  };
}

declare module '@seedthree/core/instance-matrix-chunks.js' {
  import type * as THREE from 'three';

  export const DEFAULT_INSTANCE_MATRIX_WRITES_PER_CHUNK: number;
  export const DEFAULT_INSTANCE_MATRIX_DEADLINE_CHECK_INTERVAL: number;

  export type InstanceMatrixLodSet = {
    branches: THREE.InstancedMesh | null;
    cards: Array<THREE.InstancedMesh & { userData: Record<string, unknown> }>;
  };

  export type InstanceMatrixWriteJob = {
    completed: boolean;
  };

  export type InstanceMatrixWriteChunkResult = {
    completed: boolean;
    matrixWrites: number;
    durationMs: number;
  };

  export type InstanceMatrixWriteSlicesResult = {
    completed: boolean;
    chunks: number;
    matrixWrites: number;
    maxMatrixWritesInChunk: number;
    durationMs: number;
    stopReason:
      | 'converged'
      | 'chunk-limit'
      | 'time-limit'
      | 'headroom-limit'
      | 'no-progress';
  };

  export function createInstanceMatrixWriteJob<
    TSlot extends {
      matrix: THREE.Matrix4;
      pos: { x: number; y: number; z: number };
    },
  >(
    nearSet: InstanceMatrixLodSet,
    overviewSet: InstanceMatrixLodSet,
    slots: TSlot[],
    nearSlotIndices: readonly number[],
    overviewSlotIndices: readonly number[],
    options?: {
      isSlotVisible?: (slot: TSlot) => boolean;
      resolveTreeOriginY?: (slot: TSlot) => number;
      windXZInitializedZero?: boolean;
    },
  ): InstanceMatrixWriteJob;

  export function runInstanceMatrixWriteChunk(
    job: InstanceMatrixWriteJob,
    options: {
      deadlineMs: number;
      maxMatrixWrites?: number;
      deadlineCheckInterval?: number;
      now?: () => number;
    },
  ): InstanceMatrixWriteChunkResult;

  export function runInstanceMatrixWriteSlices(
    job: InstanceMatrixWriteJob,
    options: {
      deadlineMs: number;
      minimumChunkHeadroomMs?: number;
      maxChunks?: number;
      maxMatrixWritesPerChunk?: number;
      deadlineCheckInterval?: number;
      now?: () => number;
    },
  ): InstanceMatrixWriteSlicesResult;
}

declare module '@seedthree/core/stream-slot-budget.js' {
  export type StreamSlotRequest = {
    slotIndex: number;
    sortKey?: number;
  };

  export function coalesceStreamSlotRequests<T extends StreamSlotRequest>(
    previousPending: readonly T[],
    newestRequests: readonly T[],
  ): {
    pending: T[];
    cancelledSlotIndices: number[];
  };

  export function runStreamSlotUpdateChunk<T extends StreamSlotRequest>(
    pendingRequests: readonly T[],
    options: {
      maxDurationMs: number;
      minimumHeadroomMs?: number;
      maxSubsteps: number;
      now?: () => number;
      applySubstep(
        request: T,
        context: {
          deadlineMs: number;
          elapsedMs: number;
          remainingMs: number;
        },
      ): {
        completed: boolean;
        generated?: number;
        cleared?: number;
        written?: number;
        bytesWritten?: number;
      };
    },
  ): {
    pending: T[];
    completedSlotIndices: number[];
    substeps: number;
    generated: number;
    cleared: number;
    written: number;
    bytesWritten: number;
    durationMs: number;
    stopReason: 'converged' | 'substep-limit' | 'time-limit' | 'headroom-limit';
  };

  export function planSlotAttributeUpdateRanges(
    changedSlotIndices: readonly number[],
    slotCapacity: number,
    itemSize: number,
    bytesPerElement?: number,
  ): {
    ranges: Array<{ start: number; count: number }>;
    componentCount: number;
    byteCount: number;
  };

  export function resolveStreamVisibilityHysteresis(
    wasVisible: boolean,
    value: number,
    enterThreshold: number,
    exitThreshold: number,
  ): boolean;
}

declare module '@seedthree/core/ground-cover-shadows.js' {
  import type * as THREE from 'three';

  export type GroundCoverShadowMode =
    | 'terrain-projected'
    | 'mesh-received'
    | 'unshadowed';

  export type GroundCoverShadowOptions = {
    castShadow?: boolean;
    receiveShadow?: boolean | 'auto';
    terrainReceivesShadow?: boolean;
  };

  export type GroundCoverShadowPolicy = {
    castShadow: boolean;
    receiveShadow: boolean;
    mode: GroundCoverShadowMode;
  };

  export function resolveGroundCoverShadowPolicy(
    options?: GroundCoverShadowOptions,
  ): GroundCoverShadowPolicy;

  export function applyGroundCoverShadowPolicy(
    mesh: Pick<THREE.Object3D, 'userData'> & {
      castShadow: boolean;
      receiveShadow: boolean;
    },
    options?: GroundCoverShadowOptions,
  ): GroundCoverShadowPolicy;
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
    setDeciduousDormancy(amount: number): boolean;
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
  export const CATTAIL_CARD_REFERENCE_HEIGHT: number;
  export const CATTAIL_HEIGHT_PROFILE: Readonly<{
    youngMinMeters: number;
    youngMaxMeters: number;
    matureMinMeters: number;
    matureMaxMeters: number;
    tallMinMeters: number;
    tallMaxMeters: number;
  }>;
  export function sampleCattailHeightMeters(
    wetEdge: number,
    random?: () => number,
  ): number;
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
