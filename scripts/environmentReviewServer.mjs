import { createServer } from 'vite';
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, relative, extname } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

// Freeze a source cohort so other active workspace tasks cannot hot-reload an
// A/B halfway through. Water is held at the committed version in both arms:
// its ongoing rewrite is outside the vegetation/material comparison.
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
collect(resolve(root, 'src'));
collect(resolve(root, 'vendor/seedthree/src'));
const heldAtHead = ['src/scene/SceneManager.ts', ...execFileSync('git',
  ['ls-tree', '-r', '--name-only', 'HEAD', 'src/rivers'], { encoding: 'utf8' },
).trim().split(/\r?\n/).filter(path => path.endsWith('.ts'))];
for (const path of heldAtHead) sources.set(resolve(root, path).replaceAll('\\', '/'), execFileSync('git', ['show', `HEAD:${path}`], { encoding: 'utf8' }));
const files = Object.fromEntries([...sources].map(([path, source]) => [relative(root, path).replaceAll('\\', '/'), createHash('sha256').update(source).digest('hex')]));
mkdirSync('artifacts/environment-pass', { recursive: true });
writeFileSync('artifacts/environment-pass/source-cohort.json', JSON.stringify({ heldAtHead, sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), files }, null, 2));
const server = await createServer({
  server: { host: '127.0.0.1', port: 5187, strictPort: true, hmr: false, watch: null },
  plugins: [{ name: 'environment-source-cohort', enforce: 'pre',
    transform(source, id) { return sources.get(id.split('?')[0].replaceAll('\\', '/')); },
    configureServer(vite) { vite.middlewares.use('/__environment_shutdown', (request, response) => {
      if (request.method !== 'POST') { response.writeHead(405).end(); return; }
      response.end('Review server stopped');
      setTimeout(() => { void vite.close(); }, 50);
    }); },
  }],
});
await server.listen();
console.log(`Frozen environment review: http://127.0.0.1:5187 (${sources.size} source files; water held at HEAD)`);
