import type { VegetationStartupTiming } from '../scene/SceneManager.ts';

export type StartupDiagnostics = {
  startedAt: number;
  terrainSource?: 'cache' | 'generated';
  terrainDataReadyMs?: number;
  firstPlayableMs?: number;
  settlementPresentationReadyMs?: number;
  detailedWorldTexturesReadyMs?: number;
  vegetationReadyMs?: number;
  vegetation?: VegetationStartupTiming;
  seedThree?: import('../vegetation/seedthree/seedThreeForestBuilder.ts').SeedThreeForestStartupTiming;
  firstPlayableAssets?: FirstPlayableAssetReadiness;
};

export type FirstPlayableAssetReadiness = {
  celestialSkyHydrationMs: number;
  celestialGenerationMs: number | null;
  buildingMaterialHydrationMs: number;
  vineyardHydrationMs: number;
  villagerVisualHydrationMs: number;
  gpuPrecompileMs: number;
  gpuTargetedObjectCount: number;
  gpuCoveredSubmissionCount: number;
  totalMs: number;
  celestialReady: boolean;
  buildingMaterialsReady: boolean;
  vineyardReady: boolean;
  villagerVisualsReady: boolean;
  gpuReady: boolean;
};

const stats: StartupDiagnostics = {
  startedAt: performance.now(),
};

if (typeof window !== 'undefined') {
  (window as typeof window & { __medievalRoadStartup?: StartupDiagnostics }).__medievalRoadStartup = stats;
}

export function markTerrainDataReady(source: 'cache' | 'generated'): void {
  stats.terrainSource = source;
  stats.terrainDataReadyMs = elapsed();
  console.info(`[Startup] terrain data ${source} in ${stats.terrainDataReadyMs} ms`);
}

export function markFirstPlayable(): void {
  stats.firstPlayableMs = elapsed();
  console.info(`[Startup] first playable frame in ${stats.firstPlayableMs} ms`);
}

export function markSettlementPresentationReady(): void {
  stats.settlementPresentationReadyMs = elapsed();
  console.info(
    `[Startup] settlement presentation ready in ${stats.settlementPresentationReadyMs} ms`,
  );
}

export function markDetailedWorldTexturesReady(): void {
  stats.detailedWorldTexturesReadyMs = elapsed();
  console.info(`[Startup] detailed world textures ready in ${stats.detailedWorldTexturesReadyMs} ms`);
}

export function markVegetationReady(): void {
  stats.vegetationReadyMs = elapsed();
  console.info(`[Startup] vegetation ready in ${stats.vegetationReadyMs} ms`);
}

export function markFirstPlayableAssetsReady(
  readiness: FirstPlayableAssetReadiness,
): void {
  stats.firstPlayableAssets = { ...readiness };
  console.info(
    '[Startup] first-playable assets ready',
    stats.firstPlayableAssets,
  );
}

export function markStartupCheckpoint(label: string): void {
  console.info(`[Startup] ${label} in ${elapsed()} ms`);
}

function elapsed(): number {
  return Math.round((performance.now() - stats.startedAt) * 10) / 10;
}
