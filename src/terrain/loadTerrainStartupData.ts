import type { WorldLayout } from '../resources/WorldLayout.ts';
import { RiverField } from '../rivers/RiverField.ts';
import type { WorldDimensions, WorldGenerationSettings } from '../world/worldGenerationSettings.ts';
import { yieldToMain } from '../utils/yieldToMain.ts';
import { buildTerrainGeometryData } from './terrainGeometryData.ts';
import {
  readTerrainStartupCache,
  terrainStartupCacheKey,
  writeTerrainStartupCache,
  type TerrainStartupData,
  type TerrainStartupRequest,
} from './terrainStartupCache.ts';
import { fullTerrainBounds } from './terrainBounds.ts';
import { markTerrainDataReady } from '../app/startupDiagnostics.ts';
import { parseLicPoljeTerrainFieldDebugMode } from './LicPoljeTerrainField.ts';

type ProgressCallback = (completedRows: number, totalRows: number, source: 'cache' | 'generated') => void;

export async function loadTerrainStartupData(
  settings: WorldGenerationSettings,
  dimensions: WorldDimensions,
  worldLayout: WorldLayout,
  onProgress?: ProgressCallback,
): Promise<TerrainStartupData> {
  const request: TerrainStartupRequest = {
    settings,
    dimensions,
    riverLayout: worldLayout.riverLayout.serialize(),
    quarryLayout: worldLayout.quarryLayout.serialize(),
    forestCores: worldLayout.forestCores,
    terrainFieldDebugMode: settings.terrainPreset === 'lic_polje'
      ? parseLicPoljeTerrainFieldDebugMode(
        typeof location === 'undefined' ? '' : location.search,
      )
      : 'final',
  };
  const key = terrainStartupCacheKey(request);
  const cached = await readTerrainStartupCache(key);
  if (cached) {
    onProgress?.(cached.terrain.resolution, cached.terrain.resolution, 'cache');
    markTerrainDataReady('cache');
    return cached;
  }

  let generated: TerrainStartupData;
  try {
    generated = await generateInWorker(request, onProgress);
  } catch (error) {
    console.warn('Terrain worker unavailable; generating on the main thread:', error);
    const riverField = RiverField.fromLayout({
      bounds: fullTerrainBounds(dimensions.terrainSize),
      layout: worldLayout.riverLayout,
    });
    const terrain = await buildTerrainGeometryData(
      riverField,
      worldLayout.quarryLayout,
      dimensions,
      (completedRows, totalRows) => onProgress?.(completedRows, totalRows, 'generated'),
      yieldToMain,
      worldLayout.forestCores,
      request.terrainFieldDebugMode,
    );
    generated = { terrain, riverField: riverField.serialize() };
  }

  void writeTerrainStartupCache(key, generated);
  markTerrainDataReady('generated');
  return generated;
}

function generateInWorker(
  request: TerrainStartupRequest,
  onProgress?: ProgressCallback,
): Promise<TerrainStartupData> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./terrainStartup.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<
      | { type: 'progress'; completedRows: number; totalRows: number }
      | { type: 'complete'; data: TerrainStartupData }
      | { type: 'error'; message: string }
    >) => {
      const message = event.data;
      if (message.type === 'progress') {
        onProgress?.(message.completedRows, message.totalRows, 'generated');
        return;
      }
      worker.terminate();
      if (message.type === 'complete') resolve(message.data);
      else reject(new Error(message.message));
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message || 'Terrain worker failed.'));
    };
    worker.postMessage({ type: 'generate', request });
  });
}
