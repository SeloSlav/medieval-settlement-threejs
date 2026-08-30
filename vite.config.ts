import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig, type Plugin, type ResolvedConfig } from 'vite';
import { copyPublicAssets } from './scripts/productionPublicAssets.ts';

const gameEntry = fileURLToPath(new URL('./index.html', import.meta.url));
const visualGauntletEntry = fileURLToPath(
  new URL('./visual-gauntlet.html', import.meta.url),
);
const hamletFixtureEntry = fileURLToPath(
  new URL('./hamlet-fixture.html', import.meta.url),
);
const buildingLineupEntry = fileURLToPath(
  new URL('./building-lineup.html', import.meta.url),
);
const shrubLineupEntry = fileURLToPath(
  new URL('./shrub-lineup.html', import.meta.url),
);
const forestFloorLineupEntry = fileURLToPath(
  new URL('./forest-floor-lineup.html', import.meta.url),
);
const forestSeasonLineupEntry = fileURLToPath(
  new URL('./forest-season-lineup.html', import.meta.url),
);
const farmFieldLineupEntry = fileURLToPath(
  new URL('./farm-field-lineup.html', import.meta.url),
);
const backyardLineupEntry = fileURLToPath(
  new URL('./backyard-lineup.html', import.meta.url),
);
const bridgeStructureLineupEntry = fileURLToPath(
  new URL('./bridge-structure-lineup.html', import.meta.url),
);
const illustratedMapLineupEntry = fileURLToPath(
  new URL('./illustrated-map-lineup.html', import.meta.url),
);
const soldierLineupEntry = fileURLToPath(
  new URL('./soldier-lineup.html', import.meta.url),
);
const battleSceneEntry = fileURLToPath(
  new URL('./battle-scene.html', import.meta.url),
);
const webGpuRenderOwnerEntry = fileURLToPath(
  new URL('./webgpu-render-owner.html', import.meta.url),
);
const publicRoot = fileURLToPath(new URL('./public', import.meta.url));

function vendorChunk(id: string): string | undefined {
  const normalizedId = id.replaceAll('\\', '/');
  if (normalizedId.endsWith('/src/ui/SettlementHud.ts')) return 'settlement-hud';
  if (!id.includes('node_modules')) {
    if (id.includes('/vendor/seedthree/')) return 'seedthree-vendor';
    if (id.includes('/vendor/eanpa-sky/')) return 'sky-vendor';
    if (id.includes('/src/generated/')) return 'spacetime-generated';
    return undefined;
  }
  if (id.includes('/three/') || id.includes('\\three\\')) return 'three';
  if (id.includes('spacetimedb')) return 'spacetime';
  return undefined;
}

function explicitPublicAssetCopy(includeQaArchives: boolean): Plugin {
  let resolvedConfig: ResolvedConfig | null = null;
  return {
    name: 'explicit-public-asset-copy',
    apply: 'build',
    configResolved(config) {
      resolvedConfig = config;
    },
    writeBundle() {
      if (!resolvedConfig) return;
      copyPublicAssets(
        publicRoot,
        resolve(resolvedConfig.root, resolvedConfig.build.outDir),
        includeQaArchives,
      );
    },
  };
}

export default defineConfig(({ mode }) => {
  const includeQaArchives = mode === 'visual-gauntlet';
  const stableCapture = process.env.SELO_STABLE_CAPTURE === '1';
  const buildInputs: Record<string, string> = { game: gameEntry };
  if (includeQaArchives && existsSync(visualGauntletEntry)) {
    buildInputs['visual-gauntlet'] = visualGauntletEntry;
  }
  if ((includeQaArchives || mode === 'e2e') && existsSync(hamletFixtureEntry)) {
    buildInputs['hamlet-fixture'] = hamletFixtureEntry;
  }
  if (mode === 'e2e' && existsSync(buildingLineupEntry)) {
    buildInputs['building-lineup'] = buildingLineupEntry;
  }
  if (mode === 'e2e' && existsSync(shrubLineupEntry)) {
    buildInputs['shrub-lineup'] = shrubLineupEntry;
  }
  if (mode === 'e2e' && existsSync(forestFloorLineupEntry)) {
    buildInputs['forest-floor-lineup'] = forestFloorLineupEntry;
  }
  if (mode === 'e2e' && existsSync(forestSeasonLineupEntry)) {
    buildInputs['forest-season-lineup'] = forestSeasonLineupEntry;
  }
  if (mode === 'e2e' && existsSync(farmFieldLineupEntry)) {
    buildInputs['farm-field-lineup'] = farmFieldLineupEntry;
  }
  if (mode === 'e2e' && existsSync(backyardLineupEntry)) {
    buildInputs['backyard-lineup'] = backyardLineupEntry;
  }
  if (mode === 'e2e' && existsSync(bridgeStructureLineupEntry)) {
    buildInputs['bridge-structure-lineup'] = bridgeStructureLineupEntry;
  }
  if ((includeQaArchives || mode === 'e2e') && existsSync(illustratedMapLineupEntry)) {
    buildInputs['illustrated-map-lineup'] = illustratedMapLineupEntry;
  }
  if (mode === 'e2e' && existsSync(soldierLineupEntry)) {
    buildInputs['soldier-lineup'] = soldierLineupEntry;
  }
  if (mode === 'e2e' && existsSync(battleSceneEntry)) {
    buildInputs['battle-scene'] = battleSceneEntry;
  }
  if (mode === 'e2e' && existsSync(webGpuRenderOwnerEntry)) {
    buildInputs['webgpu-render-owner'] = webGpuRenderOwnerEntry;
  }

  return {
    plugins: [explicitPublicAssetCopy(includeQaArchives)],
    optimizeDeps: {
      // Keep automatic discovery off so Vite does not crawl the game's large
      // import graph. SpacetimeDB pulls in CommonJS helpers (including
      // safe-stable-stringify and base64-js), so prebundle the SDK and its bare
      // stringify entry for browser ESM interop.
      noDiscovery: true,
      include: ['spacetimedb', 'safe-stable-stringify'],
    },
    server: {
      // A live capture must survive unrelated edits elsewhere in the shared
      // workspace while retaining Vite's development-only showcase gates.
      hmr: stableCapture ? false : undefined,
      watch: {
        // These trees contain disposable worktrees, generated QA archives, and
        // Rust build output. Watching them can monopolize the Windows watcher
        // and prevent Vite from answering normal page and asset requests.
        ignored: [
          '**/.tmp/**',
          '**/tmp/**',
          '**/_tmp/**',
          '**/artifacts/**',
          '**/server/target/**',
        ],
      },
    },
    resolve: {
    // SeedThree is vendored with its own r184 development install. Loading that
    // alongside the game's r185 runtime mixes incompatible TSL node classes and
    // produces malformed WebGPU shaders across otherwise unrelated materials.
    dedupe: ['three'],
    alias: {
      '@seedthree': fileURLToPath(new URL('./vendor/seedthree/src', import.meta.url)),
    },
    },
    build: {
      copyPublicDir: false,
      // The renderer is deliberately split into named Three.js/SeedThree chunks.
      // Keep the warning just above their current uncompressed ceiling so that
      // meaningful bundle growth still fails the noise floor.
      chunkSizeWarningLimit: 1_200,
      rollupOptions: {
        input: buildInputs,
        output: {
          manualChunks(id) {
            return vendorChunk(id);
          },
        },
      },
    },
  };
});
