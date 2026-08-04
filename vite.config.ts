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
const publicRoot = fileURLToPath(new URL('./public', import.meta.url));

function vendorChunk(id: string): string | undefined {
  const normalizedId = id.replaceAll('\\', '/');
  if (normalizedId.endsWith('/src/ui/SettlementHud.ts')) return 'settlement-hud';
  if (!id.includes('node_modules')) {
    if (id.includes('/vendor/seedthree/')) return 'seedthree-vendor';
    if (id.includes('/vendor/sky-cloud-3d/')) return 'sky-vendor';
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

  return {
    plugins: [explicitPublicAssetCopy(includeQaArchives)],
    resolve: {
    // SeedThree is vendored with its own r184 development install. Loading that
    // alongside the game's r185 runtime mixes incompatible TSL node classes and
    // produces malformed WebGPU shaders across otherwise unrelated materials.
    dedupe: ['three'],
    alias: {
      'sky-cloud-3d/webgl': fileURLToPath(new URL('./vendor/sky-cloud-3d/SkyCloudMesh.webgl', import.meta.url)),
      'sky-cloud-3d': fileURLToPath(new URL('./vendor/sky-cloud-3d/SkyCloudMesh.js', import.meta.url)),
      '@seedthree': fileURLToPath(new URL('./vendor/seedthree/src', import.meta.url)),
    },
    },
    build: {
      copyPublicDir: false,
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
