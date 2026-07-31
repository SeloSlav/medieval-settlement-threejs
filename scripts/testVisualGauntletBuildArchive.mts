import { strict as assert } from 'node:assert';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createVisualGauntletBuildArchive,
  verifyVisualGauntletBuildArchive,
} from './archiveVisualGauntletBuild.mts';

const scratch = mkdtempSync(
  join(tmpdir(), 'visual-gauntlet-build-archive-'),
);
const sourceRoot = resolve(scratch, 'dist');
const archiveRoot = resolve(scratch, 'captured-build');
const manifestPath = resolve(scratch, 'bundle-manifest.json');

function write(relativePath: string, value: string | Uint8Array): void {
  const path = resolve(sourceRoot, relativePath);
  mkdirSync(resolve(path, '..'), { recursive: true });
  writeFileSync(path, value);
}

try {
  write(
    '.vite/manifest.json',
    `${JSON.stringify({
      'hamlet-fixture.html': {
        file: 'assets/entry.js',
        isEntry: true,
        dynamicImports: ['src/lazy.ts'],
      },
      'src/lazy.ts': {
        file: 'assets/lazy.js',
        imports: ['src/helper.ts'],
        assets: ['assets/emitted.png'],
      },
      'src/helper.ts': {
        file: 'assets/helper.js',
      },
    }, null, 2)}\n`,
  );
  write(
    'hamlet-fixture.html',
    '<script type="module" src="/assets/entry.js"></script>\n',
  );
  write(
    'assets/entry.js',
    'import("./lazy.js"); const forestBase = "/assets/textures/forest";\n',
  );
  write(
    'assets/lazy.js',
    'import "./helper.js"; const image = "/assets/emitted.png";\n',
  );
  write('assets/helper.js', 'export const helper = true;\n');
  write('assets/emitted.png', new Uint8Array([1, 2, 3, 4]));
  write('assets/textures/forest/albedo.png', new Uint8Array([5, 6, 7]));
  write(
    'visual-gauntlet/evidence/round-46/old.jpg',
    new Uint8Array([8, 9]),
  );

  const created = createVisualGauntletBuildArchive({
    round: 47,
    sourceRoot,
    archiveRoot,
    manifestPath,
    buildCommand: 'synthetic capture build',
    commitmentSha256:
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  });
  assert.deepEqual(created.preBlindCommitment, {
    algorithm: 'SHA-256',
    sha256:
      '0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF',
  });
  const sentinelPayload = JSON.parse(
    readFileSync(resolve(archiveRoot, created.archiveSentinel.file), 'utf8'),
  ) as { preBlindCommitmentSha256?: string };
  assert.equal(
    sentinelPayload.preBlindCommitmentSha256,
    created.preBlindCommitment!.sha256,
    'the archive origin sentinel must bind the pre-blind commitment',
  );
  assert.deepEqual(
    created.files.map((file) => file.file),
    [
      '_round-47-archive-origin.json',
      '.vite/manifest.json',
      'assets/emitted.png',
      'assets/entry.js',
      'assets/helper.js',
      'assets/lazy.js',
      'assets/textures/forest/albedo.png',
      'hamlet-fixture.html',
    ],
    'the snapshot must preserve paths, retain lazy imports/assets, and exclude prior evidence',
  );
  assert.equal(
    created.archiveSentinel.file,
    '_round-47-archive-origin.json',
    'the immutable archive must expose an origin-only HTTP sentinel',
  );
  assert.ok(
    created.dependencyClosure.dynamicManifestRecords.includes('src/lazy.ts'),
    'the Vite dynamic-import graph must be explicit in the public inventory',
  );
  assert.ok(
    created.dependencyClosure.files.includes(
      'assets/textures/forest/albedo.png',
    ),
    'template/base-directory local resources must be included in closure',
  );
  assert.equal(
    verifyVisualGauntletBuildArchive({
      archiveRoot,
      manifestPath,
    }).treeSha256,
    created.treeSha256,
  );

  const lazyPath = resolve(archiveRoot, 'assets/lazy.js');
  const originalLazy = readFileSync(lazyPath);
  writeFileSync(lazyPath, 'tampered\n');
  assert.throws(
    () => verifyVisualGauntletBuildArchive({ archiveRoot, manifestPath }),
    /hash mismatch/,
    'content tampering must fail archive verification',
  );
  writeFileSync(lazyPath, originalLazy);

  const extraPath = resolve(archiveRoot, 'assets/extra.js');
  writeFileSync(extraPath, 'export {};\n');
  assert.throws(
    () => verifyVisualGauntletBuildArchive({ archiveRoot, manifestPath }),
    /inventory does not exactly match/,
    'unlisted archive files must fail verification',
  );
  unlinkSync(extraPath);
  verifyVisualGauntletBuildArchive({ archiveRoot, manifestPath });

  const escapingSource = resolve(scratch, 'escaping-dist');
  mkdirSync(resolve(escapingSource, '.vite'), { recursive: true });
  writeFileSync(
    resolve(escapingSource, '.vite/manifest.json'),
    JSON.stringify({
      'hamlet-fixture.html': {
        file: 'assets/entry.js',
        isEntry: true,
      },
    }),
  );
  mkdirSync(resolve(escapingSource, 'assets'), { recursive: true });
  writeFileSync(resolve(escapingSource, 'assets/entry.js'), 'export {};\n');
  writeFileSync(
    resolve(escapingSource, 'hamlet-fixture.html'),
    '<script src="../secret.js"></script>\n',
  );
  assert.throws(
    () => createVisualGauntletBuildArchive({
      round: 47,
      sourceRoot: escapingSource,
      archiveRoot: resolve(scratch, 'escaping-archive'),
      manifestPath: resolve(scratch, 'escaping-manifest.json'),
    }),
    /escaping local reference/,
    'path traversal must be rejected before archive creation',
  );

  console.log(
    `visual gauntlet build archive tests passed (${created.files.length} files)`,
  );
} finally {
  rmSync(scratch, { recursive: true });
}
