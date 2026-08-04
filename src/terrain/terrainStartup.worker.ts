/// <reference lib="webworker" />

import { QuarryLayout } from '../quarries/QuarryLayout.ts';
import { RiverField } from '../rivers/RiverField.ts';
import { RiverLayout } from '../rivers/RiverLayout.ts';
import { setActiveQuarryLayout, setActiveRiverLayout } from './TerrainHeight.ts';
import { setDraftWorldGeneration } from '../world/worldGenerationContext.ts';
import { fullTerrainBounds } from './terrainBounds.ts';
import { buildTerrainGeometryData } from './terrainGeometryData.ts';
import type { TerrainStartupData, TerrainStartupRequest } from './terrainStartupCache.ts';

type WorkerRequest = {
  type: 'generate';
  request: TerrainStartupRequest;
};

type WorkerResponse =
  | { type: 'progress'; completedRows: number; totalRows: number }
  | { type: 'complete'; data: TerrainStartupData }
  | { type: 'error'; message: string };

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  if (event.data.type !== 'generate') return;
  void generate(event.data.request);
};

async function generate(request: TerrainStartupRequest): Promise<void> {
  try {
    setDraftWorldGeneration(request.settings);
    const riverLayout = RiverLayout.fromSerialized(request.riverLayout);
    const quarryLayout = QuarryLayout.fromSerialized(request.quarryLayout);
    setActiveRiverLayout(riverLayout);
    setActiveQuarryLayout(quarryLayout);
    const riverField = RiverField.fromLayout({
      bounds: fullTerrainBounds(request.dimensions.terrainSize),
      layout: riverLayout,
    });
    const terrain = await buildTerrainGeometryData(
      riverField,
      quarryLayout,
      request.dimensions,
      (completedRows, totalRows) => {
        post({ type: 'progress', completedRows, totalRows });
      },
      undefined,
      request.forestCores,
    );
    const data: TerrainStartupData = { terrain, riverField: riverField.serialize() };
    post(
      { type: 'complete', data },
      [
        terrain.positions.buffer,
        terrain.normals.buffer,
        terrain.uvs.buffer,
        terrain.colors.buffer,
        terrain.forestBlends.buffer,
        terrain.shoreBlends.buffer,
        terrain.quarryPadBlends.buffer,
        terrain.indices.buffer,
        data.riverField.riverMask.buffer,
        data.riverField.shoreDistance.buffer,
        data.riverField.organicSignedDistance.buffer,
      ],
    );
  } catch (error) {
    post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
}

function post(message: WorkerResponse, transfer: Transferable[] = []): void {
  self.postMessage(message, { transfer });
}
