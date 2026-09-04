import { createServer } from 'vite';
import { appendFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const database = process.argv[2];
const zoomOnly = process.argv.includes('--zoom-only');
const startupBaseline = process.argv.includes('--startup-baseline');
const startup = process.argv.includes('--startup') || startupBaseline;
// Read-only A/B against the startup implementation before this optimization.
const baselineSources = new Map(startupBaseline ? [
  'index.html', 'src/app/App.ts', 'src/app/startupDiagnostics.ts',
  'src/scene/SceneManager.ts', 'src/scene/PostProcessing.ts', 'src/ui/LoadingScreen.ts',
].map(path => [path, execFileSync('git', ['show', `77710933:${path}`], { encoding: 'utf8' })]) : []);
if (!database) throw new Error('Pass an isolated local test database name. This harness places real buildings.');
process.env.VITE_SPACETIME_DB_NAME = database;
process.env.VITE_SPACETIME_URI = 'http://127.0.0.1:3000';
mkdirSync('artifacts/camp-placement', { recursive: true });
const server = await createServer({
  server: { host: '127.0.0.1', port: 5177, strictPort: true, hmr: false, watch: null },
  plugins: [{
    name: 'camp-placement-probe',
    enforce: 'pre',
    transformIndexHtml: { order: 'pre', handler: html => baselineSources.get('index.html') ?? html },
    transform(source, id) {
      for (const [path, baseline] of baselineSources) {
        if (id.replaceAll('\\', '/').endsWith(`/${path}`)) return baseline;
      }
      if (!id.replaceAll('\\', '/').endsWith('/src/main.ts')) return;
      if (startup) {
        return source.replace('const app = new App(root);', `const app = new App(root);\ninstallStartupLoadProbe(app, '${startupBaseline ? 'baseline-77710933' : 'optimized'}');\ninstallCloseGroundZoomProbe(app);`)
          .replace('app.start()', "(location.search.includes('spinnerTest') ? startLoadingSpinnerTest() : app.start())")
          + '\nimport { installStartupLoadProbe, startLoadingSpinnerTest } from "/src/e2e/startupLoadProbe.ts";\n'
          + '\nimport { installCloseGroundZoomProbe } from "/src/e2e/closeGroundZoomProbe.ts";\n';
      }
      if (zoomOnly) {
        return source.replace('const app = new App(root);', 'const app = new App(root);\ninstallCloseGroundZoomProbe(app);')
          + '\nimport { installCloseGroundZoomProbe } from "/src/e2e/closeGroundZoomProbe.ts";\n';
      }
      return source.replace("const app = new App(root);", "const app = new App(root);\ninstallCampPlacementProbe(app);")
        + '\nimport { installCampPlacementProbe } from "/src/e2e/campPlacementProbe.ts";\n';
    },
    configureServer(vite) {
      vite.middlewares.use('/__camp_probe', (request, response) => {
        let body = '';
        request.on('data', data => { body += data; });
        request.on('end', () => {
          if (body) appendFileSync('artifacts/camp-placement/events.jsonl', body + '\n');
          response.end('ok');
        });
      });
    },
  }],
});
await server.listen();
console.log('Camp placement trace server ready at http://127.0.0.1:5177');
