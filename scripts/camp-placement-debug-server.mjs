import { createServer } from 'vite';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';

process.env.VITE_SPACETIME_DB_NAME = 'camp-placement-repro-0904';
process.env.VITE_SPACETIME_URI = 'http://127.0.0.1:3000';
mkdirSync('artifacts/camp-placement', { recursive: true });
writeFileSync('artifacts/camp-placement/events.jsonl', '');
const server = await createServer({
  server: { host: '127.0.0.1', port: 5177, strictPort: true, hmr: false, watch: null },
  plugins: [{
    name: 'camp-placement-probe',
    enforce: 'pre',
    transform(source, id) {
      if (!id.replaceAll('\\', '/').endsWith('/src/main.ts')) return;
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
