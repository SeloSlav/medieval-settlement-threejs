import assert from 'node:assert/strict';
import fs from 'node:fs';
import { gzipSync } from 'node:zlib';
import { build as buildVite } from 'vite';

const bootstrapPath = 'src/app/appBootstrap.ts';
const appPath = 'src/app/App.ts';
const mainPath = 'src/main.ts';
const boundaryPath = 'src/app/deferredSettlementPresentation.ts';
const skyPath = 'src/sky/SkyCloudMesh.ts';
const starLoaderPath = 'src/sky/CelestialStarMapLoader.ts';

const bootstrap = fs.readFileSync(bootstrapPath, 'utf8');
const app = fs.readFileSync(appPath, 'utf8');
const main = fs.readFileSync(mainPath, 'utf8');
const boundary = fs.readFileSync(boundaryPath, 'utf8');
const sky = fs.readFileSync(skyPath, 'utf8');
const starLoader = fs.readFileSync(starLoaderPath, 'utf8');

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
assert.ok(firstPlayableIndex >= 0, 'App must retain the first-playable checkpoint');
assert.ok(
  celestialLoadIndex > firstPlayableIndex,
  'historical sky loading must begin only after the first playable frame',
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
const entryChunk = chunks.find((chunk) => chunk.isEntry);
assert.ok(entryChunk, 'production build must expose one application entry chunk');

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
  entryBytes <= 950_000,
  `initial application chunk grew beyond its 950 KB parse budget (${entryBytes} bytes)`,
);
assert.ok(
  entryGzipBytes <= 280_000,
  `initial application chunk grew beyond its 280 KB transfer budget (${entryGzipBytes} bytes gzip)`,
);

console.log(
  `startup chunking contract tests passed (${(entryBytes / 1000).toFixed(1)} KB raw / ${(entryGzipBytes / 1000).toFixed(1)} KB gzip entry)`,
);
