import { createServer } from 'vite';
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, relative, extname } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { gzipSync, gunzipSync } from 'node:zlib';

// Freeze a source cohort so other active workspace tasks cannot hot-reload an
// A/B halfway through. Every arm uses the same complete source cohort.
const root = process.cwd();
const sources = new Map();
function collect(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) collect(path);
    else if (['.ts', '.js', '.glsl'].includes(extname(path))) sources.set(path.replaceAll('\\', '/'), readFileSync(path, 'utf8'));
  }
}
if (process.env.ENVIRONMENT_SOURCE_ARCHIVE) {
  for (const [path, source] of JSON.parse(gunzipSync(readFileSync(process.env.ENVIRONMENT_SOURCE_ARCHIVE)))) {
    sources.set(resolve(root, path).replaceAll('\\', '/'), source);
  }
} else {
  collect(resolve(root, 'src'));
  collect(resolve(root, 'vendor/seedthree/src'));
}
// An explicit historical road-material control can be paired with a saved
// source archive. All other files then remain byte-identical across arms.
if (process.env.ENVIRONMENT_ROAD_REVISION) {
  const path = 'src/roads/RoadSurfaceMaterial.ts';
  sources.set(resolve(root, path).replaceAll('\\', '/'), execFileSync('git', ['show', `${process.env.ENVIRONMENT_ROAD_REVISION}:${path}`], { encoding: 'utf8' }));
}
const refreshable = new Set([
  'src/e2e/environmentLineup.ts',
  'src/roads/RoadSurfaceMaterial.ts',
  'src/terrain/TerrainGrassMaterial.ts',
  'src/vegetation/seedthree/gorskiKotarPresets.ts',
  'src/vegetation/seedthree/seedThreeGrass.ts',
]);
for (const path of (process.env.ENVIRONMENT_SOURCE_REFRESH ?? '').split(',').filter(Boolean)) {
  if (!refreshable.has(path)) throw new Error(`Environment review cannot refresh unrelated source: ${path}`);
  sources.set(resolve(root, path).replaceAll('\\', '/'), readFileSync(path, 'utf8'));
}
const files = Object.fromEntries([...sources].map(([path, source]) => [relative(root, path).replaceAll('\\', '/'), createHash('sha256').update(source).digest('hex')]));
mkdirSync('artifacts/environment-pass', { recursive: true });
const cohort = { sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), files };
const cohortId = createHash('sha256').update(JSON.stringify(files)).digest('hex').slice(0, 16);
writeFileSync(`artifacts/environment-pass/sources-${cohortId}.json.gz`, gzipSync(JSON.stringify([...sources].map(([path, source]) => [relative(root, path).replaceAll('\\', '/'), source]))));
writeFileSync('artifacts/environment-pass/source-cohort.json', JSON.stringify({ cohortId, ...cohort }, null, 2));
const server = await createServer({
  server: { host: '127.0.0.1', port: 5187, strictPort: true, hmr: false, watch: null },
  plugins: [{ name: 'environment-source-cohort', enforce: 'pre',
    transform(source, id) { return sources.get(id.split('?')[0].replaceAll('\\', '/')); },
    configureServer(vite) {
      vite.middlewares.use('/__environment_cohort', (_request, response) => {
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify({ cohortId, ...cohort }));
      });
      vite.middlewares.use('/__environment_shutdown', (request, response) => {
      if (request.method !== 'POST') { response.writeHead(405).end(); return; }
      response.end('Review server stopped');
      setTimeout(() => { void vite.close(); }, 50);
      });
    },
  }],
});
await server.listen();
console.log(`Frozen environment review: http://127.0.0.1:5187 (${sources.size} source files)`);
