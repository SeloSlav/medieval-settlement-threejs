import assert from 'node:assert/strict';
import fs from 'node:fs';

const bootstrapPath = 'src/app/appBootstrap.ts';
const appPath = 'src/app/App.ts';
const boundaryPath = 'src/app/deferredSettlementPresentation.ts';

const bootstrap = fs.readFileSync(bootstrapPath, 'utf8');
const app = fs.readFileSync(appPath, 'utf8');
const boundary = fs.readFileSync(boundaryPath, 'utf8');

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

console.log('startup chunking contract tests passed');
