import { existsSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';

const gameEntry = fileURLToPath(new URL('./index.html', import.meta.url));
const visualGauntletEntry = fileURLToPath(
  new URL('./visual-gauntlet.html', import.meta.url),
);
const hamletFixtureEntry = fileURLToPath(
  new URL('./hamlet-fixture.html', import.meta.url),
);
const buildInputs: Record<string, string> = { game: gameEntry };
if (existsSync(visualGauntletEntry)) {
  buildInputs['visual-gauntlet'] = visualGauntletEntry;
}
if (existsSync(hamletFixtureEntry)) {
  buildInputs['hamlet-fixture'] = hamletFixtureEntry;
}

function vendorChunk(id: string): string | undefined {
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

export default defineConfig({
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
    rollupOptions: {
      input: buildInputs,
      output: {
        manualChunks(id) {
          return vendorChunk(id);
        },
      },
    },
  },
});
