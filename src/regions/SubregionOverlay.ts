import * as THREE from 'three';
import { BUILDING_DEFINITIONS } from '../generated/gameBalance.ts';
import type {
  BuildingState,
  FarmFieldState,
  PastureState,
  ResidenceState,
  VineyardParcelState,
} from '../resources/types.ts';
import type { Terrain, TerrainBounds } from '../terrain/Terrain.ts';
import { fullTerrainBounds } from '../terrain/terrainBounds.ts';
import { isPointInPolygon2, type Point2 } from '../utils/polygonGeometry.ts';
import type { WorldGenerationSettings } from '../world/worldGenerationSettings.ts';
import {
  BUILDING_RURAL_MARGIN,
  BUILDING_URBAN_MARGIN,
  RESIDENCE_RURAL_AREA,
  RESIDENCE_URBAN_AREA,
  RURAL_BUILDING_KINDS,
  computeLandUseProfile,
  publishLandUseProfile,
  type LandUseProfile,
} from './landUseProfile.ts';
import {
  SUBREGION_KINDS,
  naturalWoodlandFraction,
  subregionDefinition,
  type SubregionKind,
} from './subregionField.ts';

export const SUBREGION_OVERLAY_RESOLUTION = 192;
const OVERLAY_MESH_SEGMENTS = 112;
const OVERLAY_HEIGHT_OFFSET = 0.42;

export type SubregionOverlayState = {
  buildings: Iterable<BuildingState>;
  residences: Iterable<ResidenceState>;
  farmFields: Iterable<FarmFieldState>;
  pastures: Iterable<PastureState>;
  vineyardParcels?: Iterable<VineyardParcelState>;
};

type RasterState = {
  urbanSources: Array<{ x: number; z: number; radiusSq: number }>;
  ruralSources: Array<{ x: number; z: number; radiusSq: number }>;
  farmlandPolygons: Point2[][];
  ruralPolygons: Point2[][];
};

export type SubregionRaster = {
  data: Uint8Array;
  realmCounts: Record<SubregionKind, number>;
};

type RasterizeSubregionsOptions = {
  resolution: number;
  bounds: TerrainBounds;
  realmBounds?: TerrainBounds;
  woodlandFraction?: number;
  sampleForestBlend: (x: number, z: number) => number;
  state: SubregionOverlayState;
};

export class SubregionOverlay {
  private readonly terrain: Terrain;
  private readonly settings: WorldGenerationSettings;
  private readonly material: THREE.MeshBasicMaterial;
  private readonly mesh: THREE.Mesh;
  private texture: THREE.DataTexture | null = null;
  private state: SubregionOverlayState = {
    buildings: [], residences: [], farmFields: [], pastures: [], vineyardParcels: [],
  };
  private dirty = true;
  private visible = false;
  profile: LandUseProfile;

  constructor(options: {
    terrain: Terrain;
    parent: THREE.Object3D;
    settings: WorldGenerationSettings;
  }) {
    this.terrain = options.terrain;
    this.settings = options.settings;
    this.profile = computeLandUseProfile(this.settings, this.state);
    publishLandUseProfile(this.profile);
    this.material = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      toneMapped: false,
    });
    this.mesh = new THREE.Mesh(createDrapedOverlayGeometry(options.terrain), this.material);
    this.mesh.name = 'Global land-use subregion overlay';
    this.mesh.renderOrder = 5;
    this.mesh.visible = false;
    this.mesh.frustumCulled = true;
    options.parent.add(this.mesh);
  }

  setState(state: SubregionOverlayState): void {
    this.state = {
      buildings: [...state.buildings],
      residences: [...state.residences],
      farmFields: [...state.farmFields],
      pastures: [...state.pastures],
      vineyardParcels: [...(state.vineyardParcels ?? [])],
    };
    this.profile = computeLandUseProfile(this.settings, this.state);
    publishLandUseProfile(this.profile);
    this.dirty = true;
    if (this.visible) this.rebuildTexture();
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    if (visible && this.dirty) this.rebuildTexture();
    this.mesh.visible = visible;
  }

  isVisible(): boolean {
    return this.visible;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.texture?.dispose();
    this.material.dispose();
    this.mesh.removeFromParent();
  }

  private rebuildTexture(): void {
    const raster = rasterizeSubregionsWithStats({
      resolution: SUBREGION_OVERLAY_RESOLUTION,
      bounds: this.terrain.bounds,
      realmBounds: fullTerrainBounds(this.terrain.generationSize),
      woodlandFraction: naturalWoodlandFraction(this.settings.forestDensity),
      sampleForestBlend: (x, z) => this.terrain.getForestBlendAt(x, z),
      state: this.state,
    });
    this.texture?.dispose();
    this.texture = new THREE.DataTexture(
      raster.data,
      SUBREGION_OVERLAY_RESOLUTION,
      SUBREGION_OVERLAY_RESOLUTION,
      THREE.RGBAFormat,
      THREE.UnsignedByteType,
    );
    this.texture.name = 'Live five-way land-use field';
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.wrapS = THREE.ClampToEdgeWrapping;
    this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false;
    this.texture.flipY = false;
    this.texture.needsUpdate = true;
    this.material.map = this.texture;
    this.material.needsUpdate = true;
    this.dirty = false;
  }
}

export function rasterizeSubregions(options: RasterizeSubregionsOptions): Uint8Array {
  return rasterizeSubregionsWithStats(options).data;
}

export function rasterizeSubregionsWithStats(
  options: RasterizeSubregionsOptions,
): SubregionRaster {
  const resolution = Math.max(2, Math.floor(options.resolution));
  const data = new Uint8Array(resolution * resolution * 4);
  const rasterState = prepareRasterState(options.state);
  const realmBounds = options.realmBounds ?? options.bounds;
  const realmCounts = Object.fromEntries(
    SUBREGION_KINDS.map((kind) => [kind, 0]),
  ) as Record<SubregionKind, number>;
  const denominator = resolution - 1;
  const kinds = new Array<SubregionKind | null>(resolution * resolution).fill(null);
  const naturalRealm: Array<{ index: number; forestBlend: number }> = [];
  const naturalOutside: Array<{ index: number; forestBlend: number }> = [];

  for (let row = 0; row < resolution; row += 1) {
    const z = options.bounds.minZ
      + row / denominator * (options.bounds.maxZ - options.bounds.minZ);
    for (let column = 0; column < resolution; column += 1) {
      const x = options.bounds.minX
        + column / denominator * (options.bounds.maxX - options.bounds.minX);
      const index = row * resolution + column;
      const kind = claimedSubregionAt(x, z, rasterState);
      kinds[index] = kind;
      if (kind == null) {
        const candidate = {
          index,
          forestBlend: finiteForestBlend(options.sampleForestBlend(x, z)),
        };
        (insideBounds(x, z, realmBounds) ? naturalRealm : naturalOutside).push(candidate);
      }
    }
  }

  const woodlandFraction = clamp01(options.woodlandFraction ?? 0.39);
  assignNaturalQuota(kinds, naturalRealm, woodlandFraction);
  assignNaturalQuota(kinds, naturalOutside, woodlandFraction);

  for (let row = 0; row < resolution; row += 1) {
    const z = options.bounds.minZ
      + row / denominator * (options.bounds.maxZ - options.bounds.minZ);
    const dataRow = resolution - 1 - row;
    for (let column = 0; column < resolution; column += 1) {
      const x = options.bounds.minX
        + column / denominator * (options.bounds.maxX - options.bounds.minX);
      const kind = kinds[row * resolution + column] ?? 'meadow';
      const color = subregionDefinition(kind).rgb;
      const index = (dataRow * resolution + column) * 4;
      data[index] = color[0];
      data[index + 1] = color[1];
      data[index + 2] = color[2];
      data[index + 3] = 222;
      if (insideBounds(x, z, realmBounds)) realmCounts[kind] += 1;
    }
  }
  return { data, realmCounts };
}

function prepareRasterState(state: SubregionOverlayState): RasterState {
  const urbanSources: RasterState['urbanSources'] = [];
  const ruralSources: RasterState['ruralSources'] = [];
  for (const building of state.buildings) {
    const definition = BUILDING_DEFINITIONS[building.kind];
    if (!definition) continue;
    const rural = RURAL_BUILDING_KINDS.has(building.kind);
    const radius = definition.pickRadius + (rural ? BUILDING_RURAL_MARGIN : BUILDING_URBAN_MARGIN);
    (rural ? ruralSources : urbanSources).push({
      x: building.x,
      z: building.z,
      radiusSq: radius * radius,
    });
  }
  for (const residence of state.residences) {
    const urban = residence.tier >= 3;
    const area = urban ? RESIDENCE_URBAN_AREA : RESIDENCE_RURAL_AREA;
    const radius = Math.sqrt(area / Math.PI);
    (urban ? urbanSources : ruralSources).push({
      x: residence.x,
      z: residence.z,
      radiusSq: radius * radius,
    });
  }
  return {
    urbanSources,
    ruralSources,
    farmlandPolygons: [
      ...[...state.farmFields].map((field) => field.corners),
      ...[...(state.vineyardParcels ?? [])].map((parcel) => parcel.corners),
    ],
    ruralPolygons: [...state.pastures].map((pasture) => pasture.corners),
  };
}

function claimedSubregionAt(
  x: number,
  z: number,
  state: RasterState,
): SubregionKind | null {
  if (insideAnySource(x, z, state.urbanSources)) return 'urban';
  if (insideAnyPolygon(x, z, state.farmlandPolygons)) return 'farmland';
  if (insideAnyPolygon(x, z, state.ruralPolygons) || insideAnySource(x, z, state.ruralSources)) {
    return 'rural';
  }
  return null;
}

function assignNaturalQuota(
  kinds: Array<SubregionKind | null>,
  candidates: Array<{ index: number; forestBlend: number }>,
  woodlandFraction: number,
): void {
  const woodlandCount = Math.round(candidates.length * woodlandFraction);
  candidates.sort((left, right) =>
    right.forestBlend - left.forestBlend || left.index - right.index);
  for (let rank = 0; rank < candidates.length; rank += 1) {
    kinds[candidates[rank]!.index] = rank < woodlandCount ? 'woodland' : 'meadow';
  }
}

function finiteForestBlend(value: number): number {
  return clamp01(Number.isFinite(value) ? value : 0);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function insideBounds(x: number, z: number, bounds: TerrainBounds): boolean {
  return x >= bounds.minX && x <= bounds.maxX && z >= bounds.minZ && z <= bounds.maxZ;
}

function insideAnySource(
  x: number,
  z: number,
  sources: readonly { x: number; z: number; radiusSq: number }[],
): boolean {
  return sources.some((source) => (source.x - x) ** 2 + (source.z - z) ** 2 <= source.radiusSq);
}

function insideAnyPolygon(x: number, z: number, polygons: readonly Point2[][]): boolean {
  return polygons.some((polygon) => isPointInPolygon2({ x, z }, polygon));
}

function createDrapedOverlayGeometry(terrain: Terrain): THREE.BufferGeometry {
  const width = terrain.bounds.maxX - terrain.bounds.minX;
  const depth = terrain.bounds.maxZ - terrain.bounds.minZ;
  const centerX = (terrain.bounds.minX + terrain.bounds.maxX) * 0.5;
  const centerZ = (terrain.bounds.minZ + terrain.bounds.maxZ) * 0.5;
  const geometry = new THREE.PlaneGeometry(
    width,
    depth,
    OVERLAY_MESH_SEGMENTS,
    OVERLAY_MESH_SEGMENTS,
  );
  geometry.rotateX(-Math.PI * 0.5);
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index) + centerX;
    const z = position.getZ(index) + centerZ;
    position.setY(index, terrain.getHeightAt(x, z) + OVERLAY_HEIGHT_OFFSET);
  }
  position.needsUpdate = true;
  geometry.translate(centerX, 0, centerZ);
  geometry.computeBoundingSphere();
  return geometry;
}
