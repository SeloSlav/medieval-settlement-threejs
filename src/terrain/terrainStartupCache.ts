import type { SerializedQuarryLayout } from '../quarries/QuarryLayout.ts';
import type { SerializedRiverField } from '../rivers/RiverField.ts';
import type { SerializedRiverLayout } from '../rivers/RiverLayout.ts';
import type { ForestCore } from '../props/forestField.ts';
import type { WorldDimensions, WorldGenerationSettings } from '../world/worldGenerationSettings.ts';
import { TERRAIN_RESOLUTION, type TerrainGeometryData } from './terrainGeometryData.ts';
import { createHeightfieldNormals } from './terrainNormals.ts';
import type { LicPoljeTerrainFieldDebugMode } from './LicPoljeTerrainField.ts';

const DATABASE_NAME = 'medieval-road-system-generated-world';
const DATABASE_VERSION = 1;
const STORE_NAME = 'terrain-startup';
const CACHE_FORMAT_VERSION = 'terrain-startup-v7-organic-forest-floor';

export type TerrainStartupData = {
  terrain: TerrainGeometryData;
  riverField: SerializedRiverField;
};

export type TerrainStartupRequest = {
  settings: WorldGenerationSettings;
  dimensions: WorldDimensions;
  riverLayout: SerializedRiverLayout;
  quarryLayout: SerializedQuarryLayout;
  forestCores: ForestCore[];
  terrainFieldDebugMode?: LicPoljeTerrainFieldDebugMode;
};

type CacheRecord = {
  key: string;
  compact?: CompactTerrainStartupData;
  /** One-development-version migration path; remove after v1 caches age out. */
  data?: TerrainStartupData;
};

type CompactTerrainStartupData = {
  terrain: {
    resolution: number;
    terrainSize: number;
    heights: Float32Array;
    uvs: Float32Array;
    colors: Uint8Array;
    forestBlends: Uint8Array;
    shoreBlends: Uint8Array;
    quarryPadBlends: Uint8Array;
    boundingSphere: TerrainGeometryData['boundingSphere'];
  };
  riverField: SerializedRiverField;
};

export function terrainStartupCacheKey(request: TerrainStartupRequest): string {
  const { settings, dimensions } = request;
  return [
    CACHE_FORMAT_VERSION,
    settings.seed >>> 0,
    settings.terrainPreset,
    settings.mapSize,
    settings.topography,
    settings.hydrology,
    settings.resourceAbundance,
    settings.resourceVariety,
    settings.forestDensity,
    request.terrainFieldDebugMode ?? 'final',
    dimensions.playableSize,
    dimensions.terrainSize,
    TERRAIN_RESOLUTION,
  ].join(':');
}

export async function readTerrainStartupCache(key: string): Promise<TerrainStartupData | null> {
  if (typeof indexedDB === 'undefined') return null;
  try {
    const database = await openDatabase();
    const record = await requestResult<CacheRecord | undefined>(
      database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(key),
    );
    database.close();
    if (record?.compact) return expand(record.compact);
    if (record?.data && isValid(record.data)) {
      void writeTerrainStartupCache(key, record.data);
      return record.data;
    }
    return null;
  } catch (error) {
    console.warn('Generated terrain cache could not be read:', error);
    return null;
  }
}

export async function writeTerrainStartupCache(key: string, data: TerrainStartupData): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  try {
    const database = await openDatabase();
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    store.clear();
    store.put({ key, compact: compact(data) } satisfies CacheRecord);
    await transactionDone(transaction);
    database.close();
  } catch (error) {
    console.warn('Generated terrain cache could not be saved:', error);
  }
}

function compact(data: TerrainStartupData): CompactTerrainStartupData {
  const { terrain } = data;
  const vertexCount = terrain.resolution * terrain.resolution;
  const heights = new Float32Array(vertexCount);
  const colors = new Uint8Array(vertexCount * 3);
  const forestBlends = new Uint8Array(vertexCount);
  const shoreBlends = new Uint8Array(vertexCount);
  const quarryPadBlends = new Uint8Array(vertexCount);
  for (let index = 0; index < vertexCount; index++) {
    heights[index] = terrain.positions[index * 3 + 1];
    const colorOffset = index * 3;
    colors[colorOffset] = Math.round(terrain.colors[colorOffset] * 255);
    colors[colorOffset + 1] = Math.round(terrain.colors[colorOffset + 1] * 255);
    colors[colorOffset + 2] = Math.round(terrain.colors[colorOffset + 2] * 255);
    forestBlends[index] = Math.round(terrain.forestBlends[index] * 255);
    shoreBlends[index] = Math.round(terrain.shoreBlends[index] * 255);
    quarryPadBlends[index] = Math.round(terrain.quarryPadBlends[index] * 255);
  }
  const firstX = terrain.positions[0];
  const lastX = terrain.positions[(terrain.resolution - 1) * 3];
  return {
    terrain: {
      resolution: terrain.resolution,
      terrainSize: lastX - firstX,
      heights,
      uvs: terrain.uvs,
      colors,
      forestBlends,
      shoreBlends,
      quarryPadBlends,
      boundingSphere: terrain.boundingSphere,
    },
    riverField: data.riverField,
  };
}

function expand(data: CompactTerrainStartupData): TerrainStartupData {
  const compactTerrain = data.terrain;
  const resolution = compactTerrain.resolution;
  const vertexCount = resolution * resolution;
  const positions = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 3);
  const forestBlends = new Float32Array(vertexCount);
  const shoreBlends = new Float32Array(vertexCount);
  const quarryPadBlends = new Float32Array(vertexCount);
  const step = compactTerrain.terrainSize / (resolution - 1);
  const half = compactTerrain.terrainSize * 0.5;

  for (let zIndex = 0; zIndex < resolution; zIndex++) {
    for (let xIndex = 0; xIndex < resolution; xIndex++) {
      const index = zIndex * resolution + xIndex;
      const positionOffset = index * 3;
      positions[positionOffset] = -half + xIndex * step;
      positions[positionOffset + 1] = compactTerrain.heights[index];
      positions[positionOffset + 2] = -half + zIndex * step;

      const colorOffset = index * 3;
      colors[colorOffset] = compactTerrain.colors[colorOffset] / 255;
      colors[colorOffset + 1] = compactTerrain.colors[colorOffset + 1] / 255;
      colors[colorOffset + 2] = compactTerrain.colors[colorOffset + 2] / 255;
      forestBlends[index] = compactTerrain.forestBlends[index] / 255;
      shoreBlends[index] = compactTerrain.shoreBlends[index] / 255;
      quarryPadBlends[index] = compactTerrain.quarryPadBlends[index] / 255;
    }
  }
  // Reconstruct the same smooth normal field as fresh generation. This avoids
  // both storing redundant data and reviving fixed-grid lighting through lossy
  // signed-byte normals on cached launches.
  const normals = createHeightfieldNormals(positions, resolution);

  return {
    terrain: {
      resolution,
      positions,
      normals,
      uvs: compactTerrain.uvs,
      colors,
      forestBlends,
      shoreBlends,
      quarryPadBlends,
      indices: createTerrainIndices(resolution),
      boundingSphere: compactTerrain.boundingSphere,
    },
    riverField: data.riverField,
  };
}

function createTerrainIndices(resolution: number): Uint32Array {
  const indices = new Uint32Array((resolution - 1) * (resolution - 1) * 6);
  let offset = 0;
  for (let zIndex = 0; zIndex < resolution - 1; zIndex++) {
    for (let xIndex = 0; xIndex < resolution - 1; xIndex++) {
      const a = zIndex * resolution + xIndex;
      const b = a + 1;
      const c = a + resolution;
      const d = c + 1;
      indices[offset++] = a;
      indices[offset++] = c;
      indices[offset++] = b;
      indices[offset++] = b;
      indices[offset++] = c;
      indices[offset++] = d;
    }
  }
  return indices;
}

function isValid(data: TerrainStartupData): boolean {
  const terrain = data.terrain;
  const vertexCount = terrain.resolution * terrain.resolution;
  return (
    terrain.resolution > 1
    && terrain.positions?.length === vertexCount * 3
    && terrain.normals?.length === vertexCount * 3
    && terrain.uvs?.length === vertexCount * 2
    && terrain.colors?.length === vertexCount * 3
    && terrain.forestBlends?.length === vertexCount
    && terrain.shoreBlends?.length === vertexCount
    && terrain.quarryPadBlends?.length === vertexCount
    && terrain.indices?.length === (terrain.resolution - 1) * (terrain.resolution - 1) * 6
    && data.riverField?.riverMask?.length === data.riverField.resolution * data.riverField.resolution
  );
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) database.createObjectStore(STORE_NAME, { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}
