import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  verifyVisualGauntletBuildArchive,
  type VisualGauntletBuildArchiveManifest,
} from './archiveVisualGauntletBuild.mts';

const root = process.cwd();
const publicRoot = resolve(
  root,
  'public/visual-gauntlet/evidence/round-48',
);
const commitmentPath = resolve(publicRoot, 'pre-blind-commitment.json');
const protocolPath = resolve(publicRoot, 'capture-protocol.json');
const ledgerPath = resolve(publicRoot, 'capture-ledger.json');
const bundleManifestPath = resolve(publicRoot, 'bundle-manifest.json');
const privateRevealPath = resolve(
  root,
  'artifacts/visual-gauntlet/round-48/pre-blind-reveal.json',
);
const archiveRoot = resolve(
  root,
  'artifacts/visual-gauntlet/round-48/captured-build',
);

const commitment = JSON.parse(readFileSync(commitmentPath, 'utf8')) as {
  preimageByteLength: number;
  preimageSha256: string;
  committedInvariants: {
    soleArmQueryDifference: string;
    frameIndices: number[];
    neverOverwriteAnyAttempt: boolean;
  };
};
const protocol = JSON.parse(readFileSync(protocolPath, 'utf8')) as {
  commitment: { sha256: string };
  archive: { archiveId: string; treeSha256: string };
  arms: {
    control: { layout: string; pathAndQuery: string };
    treatment: { layout: string; pathAndQuery: string };
    soleQueryDifference: {
      parameter: string;
      controlValue: string;
      treatmentValue: string;
    };
  };
  readinessSelectors: {
    common: string;
    control: string;
    treatment: string;
  };
  capture: { frameIndices: number[] };
};
const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8')) as {
  commitmentSha256: string;
  policy: { neverOverwriteAnyAttempt: boolean };
  attempts: Array<{
    attemptNumber?: number;
    path?: string;
    bytes?: number;
    sha256?: string;
    disposition?: 'retained' | 'discarded';
  }>;
  discardedAttempts: unknown[];
  retainedAttempts: unknown[];
};
const bundle = JSON.parse(
  readFileSync(bundleManifestPath, 'utf8'),
) as VisualGauntletBuildArchiveManifest;

assert.equal(protocol.commitment.sha256, commitment.preimageSha256);
assert.equal(ledger.commitmentSha256, commitment.preimageSha256);
assert.equal(
  bundle.preBlindCommitment?.sha256,
  commitment.preimageSha256,
);
assert.equal(
  commitment.committedInvariants.soleArmQueryDifference,
  'forestEdgeLayout',
);
assert.deepEqual(
  protocol.capture.frameIndices,
  commitment.committedInvariants.frameIndices,
);
assert.equal(commitment.committedInvariants.neverOverwriteAnyAttempt, true);
assert.equal(ledger.policy.neverOverwriteAnyAttempt, true);

const controlUrl = new URL(
  protocol.arms.control.pathAndQuery,
  'http://127.0.0.1:4179',
);
const treatmentUrl = new URL(
  protocol.arms.treatment.pathAndQuery,
  'http://127.0.0.1:4179',
);
assert.equal(controlUrl.pathname, treatmentUrl.pathname);
assert.equal(
  protocol.arms.soleQueryDifference.parameter,
  'forestEdgeLayout',
);
assert.equal(
  controlUrl.searchParams.get('forestEdgeLayout'),
  protocol.arms.soleQueryDifference.controlValue,
);
assert.equal(
  treatmentUrl.searchParams.get('forestEdgeLayout'),
  protocol.arms.soleQueryDifference.treatmentValue,
);
controlUrl.searchParams.delete('forestEdgeLayout');
treatmentUrl.searchParams.delete('forestEdgeLayout');
assert.equal(
  controlUrl.searchParams.toString(),
  treatmentUrl.searchParams.toString(),
  'forestEdgeLayout must remain the sole arm query difference',
);
for (const selector of [
  protocol.readinessSelectors.control,
  protocol.readinessSelectors.treatment,
]) {
  assert.ok(selector.startsWith(protocol.readinessSelectors.common));
  assert.match(selector, /data-visual-route-forest-edge-layout=/);
  assert.match(selector, /data-visual-route-forest-renderer=/);
  assert.match(selector, /data-visual-route-shadow-subsystem=/);
}

const attemptPaths = new Set<string>();
for (const [index, attempt] of ledger.attempts.entries()) {
  assert.equal(attempt.attemptNumber, index + 1);
  assert.ok(attempt.path && !attemptPaths.has(attempt.path));
  attemptPaths.add(attempt.path!);
  assert.ok(Number.isInteger(attempt.bytes) && attempt.bytes! > 0);
  assert.match(attempt.sha256 ?? '', /^[0-9A-F]{64}$/);
  assert.ok(
    attempt.disposition === 'retained'
    || attempt.disposition === 'discarded',
  );
}
assert.equal(
  ledger.discardedAttempts.length + ledger.retainedAttempts.length,
  ledger.attempts.length,
);

if (existsSync(privateRevealPath)) {
  const revealBytes = readFileSync(privateRevealPath);
  assert.equal(revealBytes.byteLength, commitment.preimageByteLength);
  assert.equal(
    createHash('sha256').update(revealBytes).digest('hex').toUpperCase(),
    commitment.preimageSha256,
    'the private preimage must remain byte-identical after sealing',
  );
}
if (existsSync(archiveRoot)) {
  const verified = verifyVisualGauntletBuildArchive({
    archiveRoot,
    manifestPath: bundleManifestPath,
  });
  assert.equal(verified.archiveSentinel.archiveId, protocol.archive.archiveId);
  assert.equal(verified.treeSha256, protocol.archive.treeSha256);
}

console.log(
  'Round 48 pre-blind commitment, sole-query arm pair, archive binding, '
  + 'and no-overwrite ledger contract verified.',
);
