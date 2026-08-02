import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, extname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

type ViteManifestRecord = {
  file: string;
  src?: string;
  isEntry?: boolean;
  imports?: string[];
  dynamicImports?: string[];
  css?: string[];
  assets?: string[];
};

type ViteManifest = Record<string, ViteManifestRecord>;

export type VisualGauntletBuildArchiveFile = {
  file: string;
  bytes: number;
  sha256: string;
  roles: string[];
};

export type VisualGauntletBuildArchiveManifest = {
  schemaVersion: 2;
  round: number;
  archivedAtUtc: string;
  sourceCommit: string;
  sourceStatusSha256: string;
  buildCommand: string;
  preBlindCommitment?: {
    algorithm: 'SHA-256';
    sha256: string;
  };
  sourceDirectory: string;
  archiveDirectory: string;
  entryHtml: string;
  viteManifest: '.vite/manifest.json';
  snapshotRule: {
    mode: 'complete-built-tree-except-unrelated-prior-evidence';
    excludedPrefixes: string[];
    sourceFileCount: number;
    sourceBytes: number;
  };
  archiveSentinel: {
    file: string;
    archiveId: string;
    bytes: number;
    sha256: string;
  };
  dependencyClosure: {
    source: '.vite/manifest.json plus recursive emitted local-reference walk';
    entryManifestKey: string;
    manifestRecords: string[];
    dynamicManifestRecords: string[];
    files: string[];
    emittedJavaScriptFiles: number;
    localAssetFiles: number;
  };
  portability: {
    serveAsOriginRoot: true;
    limitation: string;
    suggestedServeCommand: string;
  };
  treeSha256: string;
  files: VisualGauntletBuildArchiveFile[];
};

export type CreateVisualGauntletBuildArchiveOptions = {
  round: number;
  sourceRoot: string;
  archiveRoot: string;
  manifestPath: string;
  entryHtml?: string;
  buildCommand?: string;
  excludedPrefixes?: string[];
  commitmentSha256?: string;
};

const DEFAULT_ENTRY_HTML = 'hamlet-fixture.html';
const VITE_MANIFEST_PATH = '.vite/manifest.json';
const DEFAULT_EXCLUDED_PREFIXES = ['visual-gauntlet/evidence/'];
const SCANNABLE_EXTENSIONS = new Set(['.css', '.html', '.js', '.json']);
const RESOURCE_EXTENSIONS = new Set([
  '.avif',
  '.bin',
  '.css',
  '.gif',
  '.glb',
  '.gltf',
  '.jpeg',
  '.jpg',
  '.js',
  '.json',
  '.ktx2',
  '.mp3',
  '.ogg',
  '.png',
  '.svg',
  '.wav',
  '.webm',
  '.webp',
  '.woff',
  '.woff2',
]);

function toPosix(path: string): string {
  return path.replaceAll('\\', '/');
}

function normalizeArchivePath(path: string): string {
  const normalized = toPosix(path).replace(/^\.\/+/, '');
  if (
    normalized.length === 0
    || normalized.startsWith('/')
    || normalized === '..'
    || normalized.startsWith('../')
    || normalized.includes('/../')
    || /^[A-Za-z]:\//.test(normalized)
  ) {
    throw new Error(`Unsafe archive-relative path: ${JSON.stringify(path)}.`);
  }
  return normalized;
}

function isWithin(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === '' || (
    !isAbsolute(rel)
    && rel !== '..'
    && !rel.startsWith(`..\\`)
    && !rel.startsWith('../')
  );
}

function listFiles(root: string): string[] {
  const output: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absolute);
      } else if (entry.isFile()) {
        output.push(normalizeArchivePath(relative(root, absolute)));
      }
    }
  };
  visit(root);
  return output.sort((left, right) => left.localeCompare(right));
}

function sha256Bytes(bytes: Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex').toUpperCase();
}

function hashFile(path: string): { bytes: number; sha256: string } {
  const bytes = readFileSync(path);
  return {
    bytes: bytes.byteLength,
    sha256: sha256Bytes(bytes),
  };
}

function gitValue(args: string[]): string {
  try {
    return execFileSync('git', args, {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return 'unavailable';
  }
}

function loadViteManifest(sourceRoot: string): ViteManifest {
  const path = resolve(sourceRoot, VITE_MANIFEST_PATH);
  if (!existsSync(path)) {
    throw new Error(
      `Missing ${VITE_MANIFEST_PATH}; build the capture tree with Vite --manifest.`,
    );
  }
  return JSON.parse(readFileSync(path, 'utf8')) as ViteManifest;
}

function findEntryManifestKey(
  manifest: ViteManifest,
  entryHtml: string,
): string {
  const normalizedEntry = normalizeArchivePath(entryHtml);
  if (manifest[normalizedEntry]) return normalizedEntry;
  const match = Object.entries(manifest).find(
    ([key, record]) =>
      normalizeArchivePath(key) === normalizedEntry
      || (record.src && normalizeArchivePath(record.src) === normalizedEntry),
  );
  if (!match) {
    throw new Error(
      `Vite manifest does not contain the entry ${normalizedEntry}.`,
    );
  }
  return match[0];
}

function collectManifestGraph(
  manifest: ViteManifest,
  entryKey: string,
): {
  records: Set<string>;
  dynamicRecords: Set<string>;
  files: Map<string, Set<string>>;
} {
  const records = new Set<string>();
  const dynamicRecords = new Set<string>();
  const files = new Map<string, Set<string>>();
  const addFile = (file: string, role: string): void => {
    const normalized = normalizeArchivePath(file);
    const roles = files.get(normalized) ?? new Set<string>();
    roles.add(role);
    files.set(normalized, roles);
  };
  const visit = (key: string, role: string): void => {
    if (records.has(key)) return;
    const record = manifest[key];
    if (!record) {
      throw new Error(`Vite manifest references missing record ${key}.`);
    }
    records.add(key);
    addFile(record.file, role);
    for (const css of record.css ?? []) addFile(css, 'manifest-css');
    for (const asset of record.assets ?? []) addFile(asset, 'manifest-asset');
    for (const imported of record.imports ?? []) {
      visit(imported, 'manifest-static-import');
    }
    for (const imported of record.dynamicImports ?? []) {
      dynamicRecords.add(imported);
      visit(imported, 'manifest-dynamic-import');
    }
  };
  visit(entryKey, 'manifest-entry-module');
  return { records, dynamicRecords, files };
}

function stripUrlDecoration(value: string): string {
  return value.split('#', 1)[0]!.split('?', 1)[0]!;
}

function scanLocalReferences(source: string): string[] {
  const references = new Set<string>();
  const quoted = /(["'`])((?:\/|\.\/|\.\.\/)[^"'`\r\n]*)\1/g;
  for (const match of source.matchAll(quoted)) {
    references.add(match[2]!);
  }
  const cssUrl = /url\(\s*([^)"'\s][^)\s]*)\s*\)/g;
  for (const match of source.matchAll(cssUrl)) {
    references.add(match[1]!);
  }
  return [...references];
}

function addDirectoryFiles(
  sourceRoot: string,
  directory: string,
  rolesByFile: Map<string, Set<string>>,
  role: string,
): void {
  for (const file of listFiles(directory)) {
    const absolute = resolve(directory, file);
    const archiveRelative = normalizeArchivePath(relative(sourceRoot, absolute));
    const roles = rolesByFile.get(archiveRelative) ?? new Set<string>();
    roles.add(role);
    rolesByFile.set(archiveRelative, roles);
  }
}

function collectRecursiveLocalReferences(
  sourceRoot: string,
  initialFiles: Map<string, Set<string>>,
): Map<string, Set<string>> {
  const rolesByFile = new Map<string, Set<string>>();
  for (const [file, roles] of initialFiles) {
    rolesByFile.set(file, new Set(roles));
  }
  const queue = [...rolesByFile.keys()];
  const scanned = new Set<string>();

  while (queue.length > 0) {
    const sourceRelative = queue.shift()!;
    if (scanned.has(sourceRelative)) continue;
    scanned.add(sourceRelative);
    const sourceAbsolute = resolve(sourceRoot, sourceRelative);
    if (!isWithin(sourceRoot, sourceAbsolute) || !existsSync(sourceAbsolute)) {
      throw new Error(
        `Dependency closure references missing file ${sourceRelative}.`,
      );
    }
    if (!SCANNABLE_EXTENSIONS.has(extname(sourceRelative).toLowerCase())) {
      continue;
    }
    const text = readFileSync(sourceAbsolute, 'utf8');
    for (const rawReference of scanLocalReferences(text)) {
      if (
        rawReference.startsWith('//')
        || rawReference.startsWith('data:')
        || rawReference.startsWith('blob:')
      ) {
        continue;
      }
      const templatePrefix = rawReference.includes('${')
        ? rawReference.slice(0, rawReference.indexOf('${'))
        : rawReference;
      const cleaned = stripUrlDecoration(templatePrefix);
      if (!cleaned || cleaned === '/' || cleaned.endsWith(':')) continue;
      // Vite preserves import.meta.glob source keys such as
      // "../../../vendor/.../asset.png" inside emitted JavaScript object
      // literals. They are lookup identities, not browser resource URLs.
      // Emitted module edges are independently authoritative in the Vite
      // manifest, so only HTML/CSS may treat an escaping ../ literal as a
      // resource reference.
      if (
        cleaned.startsWith('../')
        && !['.css', '.html'].includes(
          extname(sourceRelative).toLowerCase(),
        )
      ) {
        continue;
      }
      const candidate = cleaned.startsWith('/')
        ? resolve(sourceRoot, `.${cleaned}`)
        : resolve(dirname(sourceAbsolute), cleaned);
      if (!isWithin(sourceRoot, candidate)) {
        throw new Error(
          `${sourceRelative} contains escaping local reference ${rawReference}.`,
        );
      }
      if (!existsSync(candidate)) {
        const clearlyLocal = cleaned.startsWith('/assets/')
          || cleaned.startsWith('/textures/')
          || RESOURCE_EXTENSIONS.has(extname(cleaned).toLowerCase());
        if (clearlyLocal) {
          throw new Error(
            `${sourceRelative} references missing local resource ${rawReference}.`,
          );
        }
        continue;
      }
      if (statSync(candidate).isDirectory()) {
        addDirectoryFiles(
          sourceRoot,
          candidate,
          rolesByFile,
          'local-reference-directory',
        );
        for (const file of rolesByFile.keys()) {
          if (!scanned.has(file)) queue.push(file);
        }
        continue;
      }
      const archiveRelative =
        normalizeArchivePath(relative(sourceRoot, candidate));
      const roles = rolesByFile.get(archiveRelative) ?? new Set<string>();
      roles.add(
        extname(archiveRelative).toLowerCase() === '.js'
          ? 'emitted-js-local-reference'
          : 'local-asset-reference',
      );
      rolesByFile.set(archiveRelative, roles);
      if (!scanned.has(archiveRelative)) queue.push(archiveRelative);
    }
  }
  return rolesByFile;
}

function canonicalTreeHash(
  files: VisualGauntletBuildArchiveFile[],
): string {
  const canonical = files
    .map((file) => `${file.sha256}  ${file.bytes}  ${file.file}\n`)
    .join('');
  return sha256Bytes(canonical);
}

function ensureCaseUnique(files: string[]): void {
  const seen = new Map<string, string>();
  for (const file of files) {
    const folded = file.toLocaleLowerCase('en-US');
    const prior = seen.get(folded);
    if (prior && prior !== file) {
      throw new Error(`Case-colliding archive paths: ${prior} and ${file}.`);
    }
    seen.set(folded, file);
  }
}

export function createVisualGauntletBuildArchive(
  options: CreateVisualGauntletBuildArchiveOptions,
): VisualGauntletBuildArchiveManifest {
  if (!Number.isInteger(options.round) || options.round < 1) {
    throw new Error('Archive round must be a positive integer.');
  }
  const commitmentSha256 = options.commitmentSha256?.toUpperCase();
  if (
    commitmentSha256 !== undefined
    && !/^[0-9A-F]{64}$/.test(commitmentSha256)
  ) {
    throw new Error(
      'Pre-blind commitment SHA-256 must contain exactly 64 hexadecimal characters.',
    );
  }
  const sourceRoot = resolve(options.sourceRoot);
  const archiveRoot = resolve(options.archiveRoot);
  const manifestPath = resolve(options.manifestPath);
  const entryHtml = normalizeArchivePath(
    options.entryHtml ?? DEFAULT_ENTRY_HTML,
  );
  const excludedPrefixes = (
    options.excludedPrefixes ?? DEFAULT_EXCLUDED_PREFIXES
  ).map((prefix) => {
    const normalized = normalizeArchivePath(prefix);
    return normalized.endsWith('/') ? normalized : `${normalized}/`;
  });
  if (!existsSync(sourceRoot) || !statSync(sourceRoot).isDirectory()) {
    throw new Error(`Build source directory does not exist: ${sourceRoot}.`);
  }
  if (existsSync(archiveRoot)) {
    throw new Error(`Archive directory already exists: ${archiveRoot}.`);
  }
  if (existsSync(manifestPath)) {
    throw new Error(`Archive manifest already exists: ${manifestPath}.`);
  }
  if (isWithin(sourceRoot, archiveRoot) || isWithin(archiveRoot, sourceRoot)) {
    throw new Error('Source and archive directories must not contain each other.');
  }

  const viteManifest = loadViteManifest(sourceRoot);
  const entryManifestKey = findEntryManifestKey(viteManifest, entryHtml);
  const graph = collectManifestGraph(viteManifest, entryManifestKey);
  graph.files.set(entryHtml, new Set(['entry-html']));
  graph.files.set(VITE_MANIFEST_PATH, new Set(['vite-build-manifest']));
  const closure = collectRecursiveLocalReferences(sourceRoot, graph.files);

  const sourceFiles = listFiles(sourceRoot).filter(
    (file) => !excludedPrefixes.some((prefix) => file.startsWith(prefix)),
  );
  ensureCaseUnique(sourceFiles);
  const sourceFileSet = new Set(sourceFiles);
  for (const file of closure.keys()) {
    if (!sourceFileSet.has(file)) {
      throw new Error(
        `Required closure file ${file} was excluded from the captured build.`,
      );
    }
  }

  const archivedAtUtc = new Date().toISOString();
  const sentinelFile = `_round-${options.round}-archive-origin.json`;
  if (sourceFileSet.has(sentinelFile)) {
    throw new Error(`Build source unexpectedly contains ${sentinelFile}.`);
  }
  const entryModule = [...graph.files.entries()].find(
    ([, roles]) => roles.has('manifest-entry-module'),
  )?.[0];
  if (!entryModule) {
    throw new Error('Vite graph did not identify an entry module.');
  }
  const sourceBuildManifestSha256 =
    hashFile(resolve(sourceRoot, VITE_MANIFEST_PATH)).sha256;
  const entryModuleSha256 =
    hashFile(resolve(sourceRoot, entryModule)).sha256;
  const archiveId = sha256Bytes(
    [
      `round=${options.round}`,
      `viteManifest=${sourceBuildManifestSha256}`,
      `entryModule=${entryModule}:${entryModuleSha256}`,
      `archivedAt=${archivedAtUtc}`,
      `preBlindCommitment=${commitmentSha256 ?? 'none'}`,
    ].join('\n'),
  );
  const sentinelContents = `${JSON.stringify({
    schemaVersion: 1,
    purpose: 'visual-gauntlet-captured-build-origin-sentinel',
    round: options.round,
    archiveId,
    archivedAtUtc,
    sourceBuildManifestSha256,
    entryModule,
    entryModuleSha256,
    ...(commitmentSha256
      ? { preBlindCommitmentSha256: commitmentSha256 }
      : {}),
  }, null, 2)}\n`;

  mkdirSync(archiveRoot, { recursive: true });
  try {
    for (const file of sourceFiles) {
      const source = resolve(sourceRoot, file);
      const destination = resolve(archiveRoot, file);
      mkdirSync(dirname(destination), { recursive: true });
      copyFileSync(source, destination);
    }
    writeFileSync(resolve(archiveRoot, sentinelFile), sentinelContents);

    const inventoryFiles = [...sourceFiles, sentinelFile].sort(
      (left, right) => left.localeCompare(right),
    );
    const inventory = inventoryFiles.map((file) => {
      const hashed = hashFile(resolve(archiveRoot, file));
      return {
        file,
        ...hashed,
        roles: [
          file === sentinelFile
            ? 'archive-origin-sentinel'
            : 'captured-build-snapshot',
          ...(closure.get(file) ? [...closure.get(file)!].sort() : []),
        ],
      };
    });
    const sourceBytes = inventory
      .filter((file) => file.file !== sentinelFile)
      .reduce(
      (total, file) => total + file.bytes,
      0,
    );
    const sentinelInventory = inventory.find(
      (file) => file.file === sentinelFile,
    )!;
    const gitStatus = gitValue(['status', '--short', '--untracked-files=no']);
    const manifest: VisualGauntletBuildArchiveManifest = {
      schemaVersion: 2,
      round: options.round,
      archivedAtUtc,
      sourceCommit: gitValue(['rev-parse', 'HEAD']),
      sourceStatusSha256: sha256Bytes(gitStatus),
      buildCommand:
        options.buildCommand ?? 'npm.cmd run build:visual-gauntlet -- --manifest',
      ...(commitmentSha256
        ? {
            preBlindCommitment: {
              algorithm: 'SHA-256' as const,
              sha256: commitmentSha256,
            },
          }
        : {}),
      sourceDirectory: toPosix(relative(process.cwd(), sourceRoot)),
      archiveDirectory: toPosix(relative(process.cwd(), archiveRoot)),
      entryHtml,
      viteManifest: VITE_MANIFEST_PATH,
      snapshotRule: {
        mode: 'complete-built-tree-except-unrelated-prior-evidence',
        excludedPrefixes,
        sourceFileCount: sourceFiles.length,
        sourceBytes,
      },
      archiveSentinel: {
        file: sentinelInventory.file,
        archiveId,
        bytes: sentinelInventory.bytes,
        sha256: sentinelInventory.sha256,
      },
      dependencyClosure: {
        source:
          '.vite/manifest.json plus recursive emitted local-reference walk',
        entryManifestKey,
        manifestRecords:
          [...graph.records].sort((left, right) => left.localeCompare(right)),
        dynamicManifestRecords:
          [...graph.dynamicRecords].sort(
            (left, right) => left.localeCompare(right),
          ),
        files:
          [...closure.keys()].sort((left, right) => left.localeCompare(right)),
        emittedJavaScriptFiles:
          [...closure.keys()].filter((file) => file.endsWith('.js')).length,
        localAssetFiles:
          [...closure.keys()].filter(
            (file) =>
              !file.endsWith('.js')
              && file !== entryHtml
              && file !== VITE_MANIFEST_PATH,
          ).length,
      },
      portability: {
        serveAsOriginRoot: true,
        limitation:
          'The archived HTML retains absolute same-origin resource URLs and must be served as the origin root. Unrelated prior-round visual-gauntlet evidence is intentionally excluded; remote services are not vendored.',
        suggestedServeCommand:
          `npx vite preview --outDir ${toPosix(relative(process.cwd(), archiveRoot))} --host 127.0.0.1 --port 4177`,
      },
      treeSha256: canonicalTreeHash(inventory),
      files: inventory,
    };

    mkdirSync(dirname(manifestPath), { recursive: true });
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    verifyVisualGauntletBuildArchive({ archiveRoot, manifestPath });
    return manifest;
  } catch (error) {
    if (existsSync(archiveRoot)) rmSync(archiveRoot, { recursive: true });
    if (existsSync(manifestPath)) rmSync(manifestPath);
    throw error;
  }
}

export function verifyVisualGauntletBuildArchive(input: {
  archiveRoot: string;
  manifestPath: string;
}): VisualGauntletBuildArchiveManifest {
  const archiveRoot = resolve(input.archiveRoot);
  const manifestPath = resolve(input.manifestPath);
  const manifest = JSON.parse(
    readFileSync(manifestPath, 'utf8'),
  ) as VisualGauntletBuildArchiveManifest;
  if (manifest.schemaVersion !== 2) {
    throw new Error(`Unsupported archive schema ${manifest.schemaVersion}.`);
  }
  const actualFiles = listFiles(archiveRoot);
  const listedFiles = manifest.files.map((file) =>
    normalizeArchivePath(file.file)
  );
  ensureCaseUnique(listedFiles);
  if (
    actualFiles.length !== listedFiles.length
    || actualFiles.some((file, index) => file !== listedFiles[index])
  ) {
    throw new Error(
      'Archive inventory does not exactly match the path-preserving served tree.',
    );
  }
  for (const listed of manifest.files) {
    const actual = hashFile(resolve(archiveRoot, listed.file));
    if (
      actual.bytes !== listed.bytes
      || actual.sha256 !== listed.sha256
    ) {
      throw new Error(`Archive hash mismatch for ${listed.file}.`);
    }
  }
  const sentinel = manifest.files.find(
    (file) => file.file === manifest.archiveSentinel.file,
  );
  if (
    !sentinel
    || sentinel.bytes !== manifest.archiveSentinel.bytes
    || sentinel.sha256 !== manifest.archiveSentinel.sha256
    || !sentinel.roles.includes('archive-origin-sentinel')
  ) {
    throw new Error('Archive origin sentinel is absent or inconsistent.');
  }
  const sentinelPayload = JSON.parse(
    readFileSync(resolve(archiveRoot, sentinel.file), 'utf8'),
  ) as {
    archiveId?: string;
    preBlindCommitmentSha256?: string;
  };
  if (sentinelPayload.archiveId !== manifest.archiveSentinel.archiveId) {
    throw new Error('Archive origin sentinel ID does not match its manifest.');
  }
  if (
    sentinelPayload.preBlindCommitmentSha256
      !== manifest.preBlindCommitment?.sha256
  ) {
    throw new Error(
      'Archive origin sentinel pre-blind commitment does not match its manifest.',
    );
  }
  if (canonicalTreeHash(manifest.files) !== manifest.treeSha256) {
    throw new Error('Archive tree SHA-256 does not match its canonical inventory.');
  }

  const viteManifest = loadViteManifest(archiveRoot);
  const entryKey = findEntryManifestKey(viteManifest, manifest.entryHtml);
  const graph = collectManifestGraph(viteManifest, entryKey);
  graph.files.set(manifest.entryHtml, new Set(['entry-html']));
  graph.files.set(VITE_MANIFEST_PATH, new Set(['vite-build-manifest']));
  const closure = collectRecursiveLocalReferences(archiveRoot, graph.files);
  const listedSet = new Set(listedFiles);
  for (const file of closure.keys()) {
    if (!listedSet.has(file)) {
      throw new Error(`Verified dependency ${file} is absent from inventory.`);
    }
  }
  const expectedClosure = [...manifest.dependencyClosure.files];
  const actualClosure =
    [...closure.keys()].sort((left, right) => left.localeCompare(right));
  if (
    expectedClosure.length !== actualClosure.length
    || expectedClosure.some((file, index) => file !== actualClosure[index])
  ) {
    throw new Error('Archived dependency closure differs from the recorded closure.');
  }
  return manifest;
}

function parseCli(argv: string[]): {
  command: 'create' | 'verify';
  round: number;
  sourceRoot: string;
  archiveRoot: string;
  manifestPath: string;
  commitmentSha256?: string;
} {
  const command = argv[0];
  if (command !== 'create' && command !== 'verify') {
    throw new Error('Usage: archiveVisualGauntletBuild.mts create|verify --round N --source DIR --archive DIR --manifest FILE [--commitment SHA256]');
  }
  const values = new Map<string, string>();
  for (let index = 1; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || value === undefined) {
      throw new Error(`Invalid archive CLI argument near ${key ?? '<end>'}.`);
    }
    values.set(key.slice(2), value);
  }
  const round = Number(values.get('round'));
  return {
    command,
    round,
    sourceRoot: values.get('source') ?? 'dist',
    archiveRoot:
      values.get('archive')
      ?? `artifacts/visual-gauntlet/round-${round}/captured-build`,
    manifestPath:
      values.get('manifest')
      ?? `public/visual-gauntlet/evidence/round-${round}/bundle-manifest.json`,
    ...(values.has('commitment')
      ? { commitmentSha256: values.get('commitment')! }
      : {}),
  };
}

function isMainModule(): boolean {
  const executed = process.argv[1];
  return Boolean(
    executed
    && import.meta.url === pathToFileURL(resolve(executed)).href,
  );
}

if (isMainModule()) {
  const cli = parseCli(process.argv.slice(2));
  const manifest = cli.command === 'create'
    ? createVisualGauntletBuildArchive(cli)
    : verifyVisualGauntletBuildArchive(cli);
  process.stdout.write(
    `${cli.command} verified ${manifest.files.length} files, `
    + `${manifest.snapshotRule.sourceBytes} bytes, tree `
    + `${manifest.treeSha256}\n`,
  );
}
