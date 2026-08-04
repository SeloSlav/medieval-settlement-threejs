import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { build as buildVite } from 'vite';
import { shouldCopyPublicPath } from './productionPublicAssets.ts';

const bootstrapPath = 'src/app/appBootstrap.ts';
const appPath = 'src/app/App.ts';
const mainPath = 'src/main.ts';
const boundaryPath = 'src/app/deferredSettlementPresentation.ts';
const skyPath = 'src/sky/SkyCloudMesh.ts';
const starLoaderPath = 'src/sky/CelestialStarMapLoader.ts';
const startupDiagnosticsPath = 'src/app/startupDiagnostics.ts';
const sceneManagerPath = 'src/scene/SceneManager.ts';
const buildingMaterialsPath = 'src/buildings/buildingMaterials.ts';
const vineyardPath = 'src/vegetation/seedthree/vineyardVines.ts';
const seedThreeTexturesPath = 'src/vegetation/seedthree/seedThreeTextures.ts';
const seedThreeForestBuilderPath = 'src/vegetation/seedthree/seedThreeForestBuilder.ts';
const seedThreeAssetsPath = 'src/vegetation/seedthree/seedThreeAssets.ts';
const viteConfigPath = 'vite.config.ts';
const gauntletArchivePath = 'scripts/archiveVisualGauntletBuild.mts';

const bootstrap = fs.readFileSync(bootstrapPath, 'utf8');
const app = fs.readFileSync(appPath, 'utf8');
const main = fs.readFileSync(mainPath, 'utf8');
const boundary = fs.readFileSync(boundaryPath, 'utf8');
const sky = fs.readFileSync(skyPath, 'utf8');
const starLoader = fs.readFileSync(starLoaderPath, 'utf8');
const startupDiagnostics = fs.readFileSync(startupDiagnosticsPath, 'utf8');
const sceneManager = fs.readFileSync(sceneManagerPath, 'utf8');
const buildingMaterials = fs.readFileSync(buildingMaterialsPath, 'utf8');
const vineyard = fs.readFileSync(vineyardPath, 'utf8');
const seedThreeTextures = fs.readFileSync(seedThreeTexturesPath, 'utf8');
const seedThreeForestBuilder = fs.readFileSync(seedThreeForestBuilderPath, 'utf8');
const seedThreeAssetsSource = fs.readFileSync(seedThreeAssetsPath, 'utf8');
const viteConfig = fs.readFileSync(viteConfigPath, 'utf8');
const gauntletArchive = fs.readFileSync(gauntletArchivePath, 'utf8');
const publicRoot = path.resolve('public');

assert.equal(
  shouldCopyPublicPath(publicRoot, path.join(publicRoot, 'assets'), false),
  true,
  'production builds must retain every runtime public asset',
);
assert.equal(
  shouldCopyPublicPath(publicRoot, path.join(publicRoot, 'visual-gauntlet'), false),
  false,
  'production builds must exclude the visual QA archive root',
);
assert.equal(
  shouldCopyPublicPath(
    publicRoot,
    path.join(publicRoot, 'visual-gauntlet', 'evidence', 'round-57'),
    false,
  ),
  false,
  'production builds must exclude nested visual QA evidence',
);
assert.equal(
  shouldCopyPublicPath(
    publicRoot,
    path.join(publicRoot, 'visual-gauntlet', 'evidence', 'round-57'),
    true,
  ),
  true,
  'dedicated visual-gauntlet builds must preserve the complete QA archive',
);
assert.ok(
  viteConfig.includes('copyPublicDir: false')
    && viteConfig.includes("mode === 'visual-gauntlet'")
    && viteConfig.includes('explicitPublicAssetCopy(includeQaArchives)'),
  'production builds must route public files through the QA-archive exclusion filter',
);
assert.ok(
  gauntletArchive.includes('npm.cmd run build:visual-gauntlet -- --manifest'),
  'visual QA archives must use the dedicated complete-evidence build mode',
);

assert.equal(
  seedThreeTextures.includes("assets/bark/*.png"),
  false,
  'SeedThree bark imports must remain an explicit runtime whitelist',
);
assert.equal(
  seedThreeTextures.includes("assets/leaves/*.png"),
  false,
  'SeedThree leaf imports must remain an explicit runtime whitelist',
);
assert.ok(
  seedThreeForestBuilder.includes('const assetEntryPromises = GORSKI_KOTAR_PRESETS.map')
    && seedThreeForestBuilder.includes('for (const entryPromise of assetEntryPromises)')
    && seedThreeForestBuilder.includes('const entry = await entryPromise;'),
  'SeedThree must start all species texture loads before awaiting ordered renderer bakes',
);
assert.ok(
  seedThreeAssetsSource.includes('const assetPromiseCache = new Map<string, Promise<SeedThreeSpeciesAssets>>()')
    && seedThreeAssetsSource.includes('const pending = assetPromiseCache.get(species.name)')
    && seedThreeAssetsSource.includes('assetPromiseCache.set(species.name, request)'),
  'overlapped SeedThree preload/build calls must share one texture request per species',
);
assert.ok(
  sceneManager.includes("import('../vegetation/seedthree/seedThreeForestBuilder.ts')")
    && sceneManager.includes('preloadSeedThreeForestAssets(backend.maxAnisotropy)'),
  'WebGPU startup must overlap immutable forest texture fetch/decode with terrain generation',
);

const deferredModules = [
  ['DeliveryAgentRenderer', '../logistics/DeliveryAgentRenderer.ts'],
  ['FireEffectsRenderer', '../fires/FireEffectsRenderer.ts'],
  ['VillagerRenderer', '../settlement/VillagerRenderer.ts'],
  ['ResidenceMarkers', '../residences/ResidenceMarkers.ts'],
  ['BackyardGardenMarkers', '../residences/BackyardGardenMarkers.ts'],
  ['BurgageFencing', '../residences/BurgageFencing.ts'],
  ['FarmFieldMarkers', '../farming/FarmFieldMarkers.ts'],
  ['PastureMarkers', '../farming/PastureMarkers.ts'],
  ['LivestockVisuals', '../farming/LivestockVisuals.ts'],
  ['ResourceInspector', '../resources/ResourceInspector.ts'],
] as const;

for (const [exportName, modulePath] of deferredModules) {
  assert.ok(
    boundary.includes(`export { ${exportName} } from '${modulePath}';`),
    `startup presentation boundary must export ${modulePath}`,
  );
  assert.equal(
    bootstrap.includes(`import type { ${exportName} } from '${modulePath}';`),
    true,
    `bootstrap must retain a type-only contract for ${modulePath}`,
  );
  assert.equal(
    app.includes(`import type { ${exportName} } from '${modulePath}';`),
    true,
    `App must retain a type-only contract for ${modulePath}`,
  );
}

const boundaryImport = "const settlementPresentationPromise = import('./deferredSettlementPresentation.ts');";
const startIndex = bootstrap.indexOf(boundaryImport);
const sceneIndex = bootstrap.indexOf('const sceneManager = await SceneManager.create');
const awaitIndex = bootstrap.indexOf('} = await settlementPresentationPromise;');
const instantiateIndex = bootstrap.indexOf('const deliveryAgents = new DeliveryAgentRenderer');
const inspectorInstantiateIndex = bootstrap.indexOf('resourceInspector = new ResourceInspector');

assert.ok(startIndex >= 0, 'bootstrap must start the presentation request explicitly');
assert.ok(
  startIndex < sceneIndex,
  'presentation download must begin before terrain and scene generation',
);
assert.ok(
  awaitIndex > sceneIndex,
  'presentation code must resolve behind terrain and scene generation',
);
assert.ok(
  instantiateIndex > awaitIndex,
  'presentation code must resolve before its first renderer is constructed',
);
assert.ok(
  inspectorInstantiateIndex > awaitIndex,
  'presentation code must resolve before the deferred inspector is constructed',
);
assert.equal(
  bootstrap.match(/import\('\.\/deferredSettlementPresentation\.ts'\)/g)?.length,
  1,
  'bootstrap should use one coherent deferred presentation request',
);
assert.equal(
  bootstrap.match(/await settlementPresentationPromise/g)?.length,
  1,
  'bootstrap should resolve the shared request once',
);
assert.ok(
  bootstrap.includes('markSettlementPresentationReady();'),
  'runtime startup diagnostics must expose when deferred presentation is ready',
);

assert.equal(
  sky.includes("from './CelestialStarMap.ts'"),
  false,
  'the startup sky wrapper must not import the historical catalogue graph directly',
);
assert.ok(
  starLoader.includes("import('./CelestialStarMap.ts')"),
  'the historical sky must retain an explicit deferred import boundary',
);
const firstPlayableIndex = app.indexOf('markFirstPlayable();');
const celestialLoadIndex = app.indexOf('session.sceneManager.loadCelestialSky()');
const buildingHydrationIndex = app.indexOf('await initializeBuildingMaterialLibrary(');
const vineyardHydrationIndex = app.indexOf('await initializeVineyardVineResources(');
const villagerVisualHydrationIndex = app.indexOf('await session.villagers.visualAssetsReady');
const gpuPrecompileIndex = app.indexOf('await session.sceneManager.precompileFirstPlayableScene()');
const villagerGpuPrewarmIndex = app.indexOf('session.villagers.beginFirstPlayableGpuPrewarm()');
const gpuCompletionIndex = app.indexOf('await session.sceneManager.waitForFirstPlayableGpuWork()');
const startupRafIndex = app.indexOf(
  'await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))',
);
assert.ok(firstPlayableIndex >= 0, 'App must retain the first-playable checkpoint');
for (const [label, index] of [
  ['historical sky hydration', celestialLoadIndex],
  ['building-material hydration', buildingHydrationIndex],
  ['vineyard hydration', vineyardHydrationIndex],
  ['villager model and batch hydration', villagerVisualHydrationIndex],
  ['live-scene shader precompile', gpuPrecompileIndex],
  ['villager GPU prewarm visibility', villagerGpuPrewarmIndex],
  ['submitted GPU work completion', gpuCompletionIndex],
] as const) {
  assert.ok(index >= 0, `App must retain ${label}`);
  assert.ok(
    index < startupRafIndex && index < firstPlayableIndex,
    `${label} must complete under the loading cover before the first gameplay rAF`,
  );
}
assert.ok(
  app.indexOf('const firstPlayableAssetResults = await Promise.allSettled([')
    < celestialLoadIndex,
  'CPU-heavy startup hydration must be an awaited barrier',
);
const postPlayableStartup = app.slice(
  firstPlayableIndex,
  app.indexOf('\n  dispose(): void', firstPlayableIndex),
);
for (const forbiddenPostPlayWork of [
  'loadCelestialSky()',
  'initializeBuildingMaterialLibrary(',
  'initializeVineyardVineResources(',
  'villagers.visualAssetsReady',
  'precompileFirstPlayableScene()',
  'beginFirstPlayableGpuPrewarm()',
]) {
  assert.equal(
    postPlayableStartup.includes(forbiddenPostPlayWork),
    false,
    `first-playable startup must not launch post-play work: ${forbiddenPostPlayWork}`,
  );
}
assert.ok(
  sceneManager.includes('(this.renderer as StartupPrecompilableRenderer).initTexture(texture);')
    && sceneManager.includes('await renderer.compileAsync(this.scene, this.camera);')
    && sceneManager.includes('return this.waitForSubmittedWork();'),
  'startup residency must include texture upload, live-scene shader compilation, and GPU completion',
);
assert.ok(
  buildingMaterials.includes('preloadTexture?.(map);')
    && buildingMaterials.includes('preloadTexture?.(normalMap);')
    && buildingMaterials.includes('preloadTexture?.(roughnessMap);'),
  'every detailed building texture channel must be uploaded during hydration',
);
assert.ok(
  vineyard.includes('preloadTexture?.(textures.albedo);')
    && vineyard.includes('preloadTexture?.(textures.normal);')
    && vineyard.includes('preloadTexture?.(textures.roughness);')
    && vineyard.includes('preloadTexture?.(textures.translucency);'),
  'every available vineyard foliage texture channel must be uploaded during hydration',
);
assert.ok(
  startupDiagnostics.includes('firstPlayableAssets?: FirstPlayableAssetReadiness;')
    && startupDiagnostics.includes('celestialGenerationMs: number | null;')
    && startupDiagnostics.includes('villagerVisualsReady: boolean;')
    && app.includes('markFirstPlayableAssetsReady({'),
  'startup diagnostics must quantify celestial generation and exact asset readiness',
);

assert.equal(
  main.includes(
    "import { installVisualPerformanceHooksIfRequested } from './e2e/visualPerformanceHooks.ts';",
  ),
  false,
  'ordinary startup must not statically import the development-only visual profiler',
);
assert.ok(
  main.includes("get('visualProfile') === '1'"),
  'the visual profiler must remain available behind its explicit URL opt-in',
);
assert.ok(
  main.includes("import('./e2e/visualPerformanceHooks.ts')"),
  'profiling runs must retain a dedicated deferred module request',
);

const memoryBuild = await buildVite({
  logLevel: 'silent',
  build: {
    write: false,
  },
});
const buildOutputs = (Array.isArray(memoryBuild) ? memoryBuild : [memoryBuild])
  .flatMap((result) => ('output' in result ? result.output : []));
const chunks = buildOutputs.filter((output) => output.type === 'chunk');
const assets = buildOutputs.filter((output) => output.type === 'asset');

const seedThreeBarkBases = [
  'american_beech',
  'white_oak',
  'red_maple',
  'sweetgum',
  'douglas_fir',
  'loblolly',
  'pine',
  'apple_bark',
  'cherry_bark',
] as const;
const seedThreeForestLeafBases = [
  'american_beech_single',
  'white_oak_single',
  'red_maple_single',
  'sweetgum_single',
  'douglas_fir_needle',
  'loblolly_needle',
  'pine_needle',
] as const;
const seedThreeUndergrowthBases = [
  'bilberry',
  'fern',
  'juniper_scrub',
] as const;
const seedThreeExpectedOriginalFiles = new Set<string>([
  ...seedThreeBarkBases.flatMap((base) => (
    ['albedo', 'normal', 'roughness'] as const
  ).map((channel) => `vendor/seedthree/assets/bark/${base}_${channel}.png`)),
  ...[...seedThreeForestLeafBases, ...seedThreeUndergrowthBases].flatMap((base) => (
    ['albedo', 'normal', 'roughness', 'translucency'] as const
  ).map((channel) => `vendor/seedthree/assets/leaves/${base}_${channel}.png`)),
  ...['', '_normal', '_roughness', '_translucency'].map((suffix) => (
    `vendor/seedthree/assets/leaves/cattail_reed_card${suffix}.png`
  )),
]);
const seedThreeAssets = assets.filter((asset) => (
  asset.originalFileNames.some((originalFileName) => {
    const normalized = originalFileName.replaceAll('\\', '/');
    return normalized.startsWith('vendor/seedthree/assets/bark/')
      || normalized.startsWith('vendor/seedthree/assets/leaves/');
  })
));
const seedThreeOriginalFiles = new Set(
  seedThreeAssets.flatMap((asset) => asset.originalFileNames)
    .map((originalFileName) => originalFileName.replaceAll('\\', '/'))
    .filter((originalFileName) => (
      originalFileName.startsWith('vendor/seedthree/assets/bark/')
      || originalFileName.startsWith('vendor/seedthree/assets/leaves/')
    )),
);
assert.deepEqual(
  seedThreeOriginalFiles,
  seedThreeExpectedOriginalFiles,
  'production builds must contain exactly the SeedThree textures used at runtime',
);
assert.ok(
  seedThreeAssets.length <= 71,
  `SeedThree output grew beyond 71 emitted assets (${seedThreeAssets.length})`,
);
const seedThreeAssetBytes = seedThreeAssets.reduce((total, asset) => (
  total + (typeof asset.source === 'string'
    ? Buffer.byteLength(asset.source)
    : asset.source.byteLength)
), 0);
assert.ok(
  seedThreeAssetBytes <= 96_000_000,
  `SeedThree output grew beyond its 96 MB source budget (${seedThreeAssetBytes} bytes)`,
);
const entryChunk = chunks.find((chunk) => chunk.isEntry);
assert.ok(entryChunk, 'production build must expose one application entry chunk');
assert.deepEqual(
  chunks.filter((chunk) => chunk.isEntry).map((chunk) => chunk.name),
  ['game'],
  'production output must not emit visual-QA or fixture entry points',
);

const inspectorModuleSuffix = '/src/resources/ResourceInspector.ts';
const moduleNames = (chunk: (typeof chunks)[number]): string[] => (
  Object.keys(chunk.modules).map((moduleName) => moduleName.replaceAll('\\', '/'))
);
assert.equal(
  moduleNames(entryChunk).some((moduleName) => moduleName.endsWith(inspectorModuleSuffix)),
  false,
  'the initial application chunk must not parse the inspector/reporting graph',
);
const inspectorChunk = chunks.find((chunk) => (
  moduleNames(chunk).some((moduleName) => moduleName.endsWith(inspectorModuleSuffix))
));
assert.ok(inspectorChunk, 'production build must retain the deferred resource inspector');
assert.equal(
  inspectorChunk.isEntry,
  false,
  'the resource inspector must remain outside the initial application entry',
);

const visualProfilerModuleSuffix = '/src/e2e/visualPerformanceHooks.ts';
const visualProfilerChunk = chunks.find((chunk) => (
  moduleNames(chunk).some((moduleName) =>
    moduleName.endsWith(visualProfilerModuleSuffix)
  )
));
assert.ok(
  visualProfilerChunk,
  'production builds must retain the opt-in visual profiling harness',
);
assert.equal(
  entryChunk.imports.includes(visualProfilerChunk.fileName),
  false,
  'ordinary startup must not fetch the visual profiling chunk',
);
assert.ok(
  entryChunk.dynamicImports.includes(visualProfilerChunk.fileName),
  'the application entry must expose the visual profiler only as a dynamic import',
);

const celestialCatalogModuleSuffix = '/src/sky/celestialCatalog.generated.ts';
assert.equal(
  moduleNames(entryChunk).some((moduleName) => moduleName.endsWith(celestialCatalogModuleSuffix)),
  false,
  'the initial application chunk must not parse the historical star catalogue',
);
const celestialCatalogChunk = chunks.find((chunk) => (
  moduleNames(chunk).some((moduleName) => moduleName.endsWith(celestialCatalogModuleSuffix))
));
assert.ok(celestialCatalogChunk, 'production build must retain the deferred historical star catalogue');
assert.equal(
  celestialCatalogChunk.isEntry,
  false,
  'the historical star catalogue must remain outside the initial application entry',
);

const entryBytes = Buffer.byteLength(entryChunk.code);
const entryGzipBytes = gzipSync(entryChunk.code).byteLength;
assert.ok(
  entryBytes <= 1_000_000,
  `initial application chunk grew beyond its 1 MB parse budget (${entryBytes} bytes)`,
);
assert.ok(
  entryGzipBytes <= 285_000,
  `initial application chunk grew beyond its 285 KB transfer budget (${entryGzipBytes} bytes gzip)`,
);

const chunksByFileName = new Map(chunks.map((chunk) => [chunk.fileName, chunk]));
const startupChunkNames = new Set<string>();
const visitStartupChunk = (chunk: (typeof chunks)[number]): void => {
  if (startupChunkNames.has(chunk.fileName)) return;
  startupChunkNames.add(chunk.fileName);
  for (const importedFileName of chunk.imports) {
    const importedChunk = chunksByFileName.get(importedFileName);
    if (importedChunk) visitStartupChunk(importedChunk);
  }
};
visitStartupChunk(entryChunk);
const startupChunks = [...startupChunkNames].map((fileName) => (
  chunksByFileName.get(fileName)!
));
const startupClosureBytes = startupChunks.reduce(
  (total, chunk) => total + Buffer.byteLength(chunk.code),
  0,
);
const startupClosureGzipBytes = startupChunks.reduce(
  (total, chunk) => total + gzipSync(chunk.code).byteLength,
  0,
);
assert.ok(
  // The forest-floor material adds one packed-atlas sample plus its
  // grass/dirt edge handoff. Keep that intentional 20 KB allowance explicit
  // instead of weakening the startup closure budget generally.
  startupClosureBytes <= 2_680_000,
  `initial static chunk closure grew beyond 2.68 MB (${startupClosureBytes} bytes)`,
);
assert.ok(
  startupClosureGzipBytes <= 738_000,
  `initial static chunk closure grew beyond 738 KB gzip (${startupClosureGzipBytes} bytes)`,
);

console.log(
  `startup chunking contract tests passed (${(entryBytes / 1000).toFixed(1)} KB raw / ${(entryGzipBytes / 1000).toFixed(1)} KB gzip entry; ${(startupClosureBytes / 1000).toFixed(1)} KB / ${(startupClosureGzipBytes / 1000).toFixed(1)} KB gzip static closure)`,
);
