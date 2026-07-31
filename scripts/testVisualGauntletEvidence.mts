import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

type EvidenceFile = {
  file: string;
  bytes?: number;
  sha256?: string;
  count?: number;
  blindAlias?: string;
};

type EvidenceManifest = {
  round: number;
  files: EvidenceFile[];
};

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const evidenceRoot = resolve(
  projectRoot,
  'public',
  'visual-gauntlet',
  'evidence',
);
const gauntletPath = resolve(projectRoot, 'visual-gauntlet.html');
const FIRST_VERIFIED_ROUND = 37;
const LATEST_VERIFIED_ROUND = 47;

function safeEvidencePath(root: string, relativePath: string): string {
  const normalized = relativePath.replaceAll('\\', '/');
  assert.ok(
    normalized.length > 0
      && !normalized.startsWith('/')
      && !normalized.startsWith('../')
      && !normalized.includes('/../'),
    `unsafe evidence-relative path: ${JSON.stringify(relativePath)}`,
  );
  const absolute = resolve(root, normalized);
  const rel = relative(root, absolute);
  assert.ok(
    rel !== '..'
      && !rel.startsWith(`..\\`)
      && !rel.startsWith('../')
      && !isAbsolute(rel),
    `evidence path escapes its round: ${JSON.stringify(relativePath)}`,
  );
  return absolute;
}

function sha256(path: string): string {
  return createHash('sha256')
    .update(readFileSync(path))
    .digest('hex')
    .toUpperCase();
}

function listFiles(root: string): string[] {
  const files: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = resolve(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) files.push(absolute);
    }
  };
  visit(root);
  return files;
}

function verifyFile(
  roundRoot: string,
  entry: EvidenceFile,
): void {
  const isDirectoryEntry = entry.file.endsWith('/');
  const path = safeEvidencePath(roundRoot, entry.file);
  assert.ok(
    existsSync(path),
    `round evidence is missing ${entry.file}`,
  );

  if (isDirectoryEntry) {
    assert.ok(statSync(path).isDirectory(), `${entry.file} must be a directory`);
    const files = listFiles(path);
    if (entry.count !== undefined) {
      assert.equal(
        files.length,
        entry.count,
        `${entry.file} file count drifted`,
      );
    }
    if (entry.bytes !== undefined) {
      assert.equal(
        files.reduce((total, file) => total + statSync(file).size, 0),
        entry.bytes,
        `${entry.file} byte count drifted`,
      );
    }
    return;
  }

  assert.ok(statSync(path).isFile(), `${entry.file} must be a file`);
  if (entry.bytes !== undefined) {
    assert.equal(statSync(path).size, entry.bytes, `${entry.file} size drifted`);
  }
  if (entry.sha256 !== undefined) {
    assert.match(entry.sha256, /^[0-9A-F]{64}$/);
    assert.equal(sha256(path), entry.sha256, `${entry.file} hash drifted`);
  }

  if (entry.blindAlias) {
    const aliasPath = safeEvidencePath(roundRoot, entry.blindAlias);
    assert.ok(existsSync(aliasPath), `missing blind alias ${entry.blindAlias}`);
    assert.equal(
      statSync(aliasPath).size,
      statSync(path).size,
      `${entry.blindAlias} size differs from ${entry.file}`,
    );
    assert.equal(
      sha256(aliasPath),
      sha256(path),
      `${entry.blindAlias} differs from ${entry.file}`,
    );
  }
}

const gauntletHtml = readFileSync(gauntletPath, 'utf8');
const linkedEvidence = new Set<string>();
for (const match of gauntletHtml.matchAll(
  /(?:href|src)="\/visual-gauntlet\/evidence\/([^"?#]+)(?:[?#][^"]*)?"/g,
)) {
  linkedEvidence.add(match[1]!);
}
assert.ok(linkedEvidence.size > 0, 'the gauntlet must link its public evidence');
for (const relativePath of linkedEvidence) {
  const path = safeEvidencePath(evidenceRoot, relativePath);
  assert.ok(
    existsSync(path) && statSync(path).isFile(),
    `visual-gauntlet.html links missing evidence ${relativePath}`,
  );
}

let verifiedFiles = 0;
for (
  let round = FIRST_VERIFIED_ROUND;
  round <= LATEST_VERIFIED_ROUND;
  round++
) {
  const roundRoot = resolve(evidenceRoot, `round-${round}`);
  const manifestPath = resolve(roundRoot, 'manifest.json');
  assert.ok(existsSync(manifestPath), `round ${round} needs manifest.json`);
  const manifest = JSON.parse(
    readFileSync(manifestPath, 'utf8'),
  ) as EvidenceManifest;
  assert.equal(manifest.round, round, `round ${round} manifest identity drifted`);
  assert.ok(
    Array.isArray(manifest.files) && manifest.files.length > 0,
    `round ${round} needs a non-empty evidence inventory`,
  );
  const listed = new Set<string>();
  for (const entry of manifest.files) {
    assert.equal(typeof entry.file, 'string');
    assert.ok(!listed.has(entry.file), `round ${round} lists ${entry.file} twice`);
    listed.add(entry.file);
    verifyFile(roundRoot, entry);
    verifiedFiles++;
  }
}

console.log(
  `visual gauntlet evidence tests passed `
  + `(${linkedEvidence.size} linked files, ${verifiedFiles} manifest entries)`,
);
