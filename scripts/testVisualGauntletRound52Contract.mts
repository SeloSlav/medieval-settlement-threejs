import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  verifyVisualGauntletBuildArchive,
  type VisualGauntletBuildArchiveManifest,
} from './archiveVisualGauntletBuild.mts';

const root = process.cwd();
const roundRoot = resolve(
  root,
  'public/visual-gauntlet/evidence/round-52',
);
const artifactRoot = resolve(
  root,
  'artifacts/visual-gauntlet/round-52',
);

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function sha256(path: string): string {
  return createHash('sha256')
    .update(readFileSync(path))
    .digest('hex')
    .toUpperCase();
}

function verifyPng(path: string): void {
  const bytes = readFileSync(path);
  assert.deepEqual(
    [...bytes.subarray(0, 8)],
    [137, 80, 78, 71, 13, 10, 26, 10],
    `${path} must be a PNG`,
  );
  assert.equal(bytes.readUInt32BE(16), 1280, `${path} width drifted`);
  assert.equal(bytes.readUInt32BE(20), 720, `${path} height drifted`);
}

type Commitment = {
  createdAtUtc: string;
  preimageByteLength: number;
  preimageSha256: string;
  seedThreeCommit: string;
  committedInvariants: {
    soleArmQueryDifference: string;
    frameIndices: number[];
    captureSurface: string;
    cameraPoseSignatureMustMatchAcrossArms: boolean;
    neverOverwriteAnyAttempt: boolean;
  };
};

type Protocol = {
  commitment: { sha256: string; sealedBeforeCapture: boolean };
  archive: { archiveId: string; treeSha256: string };
  arms: {
    control: { layout: string; pathAndQuery: string };
    treatment: { layout: string; pathAndQuery: string };
    soleQueryDifference: string;
  };
  capture: {
    source: string;
    dimensions: string;
    frameIndices: number[];
    crossArmCameraPoseSignatureMustMatch: boolean;
  };
  requiredEvidence: {
    trees: number;
    treatmentReallocatedSlots: number;
    treatmentRetainedSlots: number;
    treatmentClusters: number;
    treatmentBroadleafSaplings: number;
    treatmentBroadleafShrubCards: number;
    seedThreeCommit: string;
  };
  performanceBar: {
    onePercentLowFpsMinimum: number;
    maxFrameMsMaximum: number;
    framesOver25MsMaximum: number;
    framesOver50MsMaximum: number;
  };
};

type Attempt = {
  attemptNumber: number;
  blindLabel: 'blind-A' | 'blind-B';
  frameIndex?: number;
  kind: string;
  disposition: 'retained' | 'discarded';
  path: string;
  publicPath?: string;
  bytes: number;
  sha256: string;
  recordedAtUtc: string;
  reason: string;
};

type Ledger = {
  status: string;
  commitmentSha256: string;
  policy: { neverOverwriteAnyAttempt: boolean };
  attempts: Attempt[];
  discardedAttempts: number[];
  retainedAttempts: number[];
  captureValidation: {
    correspondingCameraPoseSignaturesMatch: boolean;
    nativeGpuSynchronizedPng: boolean;
    blindAPerformanceHardBarPass: boolean;
    blindBPerformanceHardBarPass: boolean;
  };
  verdict: {
    path: string;
    selectedBlindArm: 'blind-A' | 'blind-B';
    mappingKnownAtVerdict: boolean;
  };
  independentVerdict: {
    path: string;
    reviewedFrameCount: number;
    selection: 'tie';
    confidence: number;
    mappingKnownAtVerdict: boolean;
  };
  adjudication: {
    path: string;
    status: string;
    acceptedVisualWinner: null;
  };
  reveal: {
    path: string;
    publishedAfterVerdict: boolean;
    bytes: number;
    sha256: string;
    blindAssignment: Record<'blind-A' | 'blind-B', 'control' | 'treatment'>;
  };
  outcome: {
    selectedBlindArm: 'blind-A' | 'blind-B';
    selectedArm: 'control' | 'treatment';
    treatmentLayout: string;
    acceptedVisualWinner: null;
    reason: string;
  };
  completedAtUtc: string;
};

type Verdict = {
  status: string;
  recordedAtUtc: string;
  selectedBlindArm: 'blind-A' | 'blind-B';
  mappingKnownAtVerdict: boolean;
  reviewedFrameIndices: number[];
};

type ExhaustiveVerdict = {
  status: string;
  selectedBlindArm: null;
  selection: 'tie';
  confidence: number;
  mappingKnownAtVerdict: boolean;
  reviewedFrameIndices: number[];
  referenceFilesReviewed: number;
};

type Adjudication = {
  status: string;
  acceptedVisualWinner: null;
  verdicts: Array<{
    path: string;
    reviewedFrameCount: number;
    result: string;
  }>;
};

type Reveal = {
  createdAtUtc: string;
  seedThreeCommit: string;
  soleArmQueryDifference: { parameter: string };
  randomization: {
    blindAssignment: Record<'blind-A' | 'blind-B', 'control' | 'treatment'>;
    captureOrder: Array<'blind-A' | 'blind-B'>;
  };
  captureSurface: string;
  cameraPoseIdentity: string;
  frameIndices: number[];
};

type Validation = {
  captureMethod: string;
  viewport: string;
  frameIndices: number[];
  correspondingCameraPoseSignaturesMatch: boolean;
  fullVisualSystemsReady: Record<'blind-A' | 'blind-B', boolean>;
  performance: {
    bar: {
      onePercentLowFpsAtLeast: number;
      maxFrameMsAtMost: number;
      framesOver25Ms: number;
      framesOver50Ms: number;
    };
    'blind-A': {
      onePercentLowFps: number;
      maxFrameMs: number;
      framesOver25Ms: number;
      framesOver50Ms: number;
      hardBarPass: boolean;
    };
    'blind-B': {
      onePercentLowFps: number;
      maxFrameMs: number;
      framesOver25Ms: number;
      framesOver50Ms: number;
      hardBarPass: boolean;
    };
  };
};

const commitment = readJson<Commitment>(
  resolve(roundRoot, 'pre-blind-commitment.json'),
);
const protocol = readJson<Protocol>(
  resolve(roundRoot, 'capture-protocol.json'),
);
const ledger = readJson<Ledger>(
  resolve(roundRoot, 'capture-ledger.json'),
);
const verdict = readJson<Verdict>(
  resolve(roundRoot, 'blind-verdict.json'),
);
const exhaustiveVerdict = readJson<ExhaustiveVerdict>(
  resolve(roundRoot, 'blind-verdict-exhaustive.json'),
);
const adjudication = readJson<Adjudication>(
  resolve(roundRoot, 'blind-adjudication.json'),
);
const revealPath = resolve(roundRoot, 'pre-blind-reveal.json');
const reveal = readJson<Reveal>(revealPath);
const validation = readJson<Validation>(
  resolve(roundRoot, 'capture-validation.json'),
);
const bundleManifestPath = resolve(roundRoot, 'bundle-manifest.json');
const bundle = readJson<VisualGauntletBuildArchiveManifest>(
  bundleManifestPath,
);

assert.equal(ledger.status, 'complete-split-independent-blind-verdicts');
assert.equal(protocol.commitment.sealedBeforeCapture, true);
assert.equal(protocol.commitment.sha256, commitment.preimageSha256);
assert.equal(ledger.commitmentSha256, commitment.preimageSha256);
assert.equal(
  bundle.preBlindCommitment?.sha256,
  commitment.preimageSha256,
);
assert.equal(readFileSync(revealPath).byteLength, commitment.preimageByteLength);
assert.equal(sha256(revealPath), commitment.preimageSha256);
assert.equal(ledger.reveal.sha256, commitment.preimageSha256);
assert.equal(ledger.reveal.bytes, commitment.preimageByteLength);
assert.equal(ledger.reveal.publishedAfterVerdict, true);
assert.ok(
  Date.parse(commitment.createdAtUtc) < Date.parse(verdict.recordedAtUtc),
  'the commitment must predate the blind verdict',
);
assert.ok(
  Date.parse(verdict.recordedAtUtc) < Date.parse(ledger.completedAtUtc),
  'the blind verdict must predate ledger finalization/reveal publication',
);
assert.equal(verdict.status, 'blind-verdict-recorded-before-reveal');
assert.equal(verdict.mappingKnownAtVerdict, false);
assert.equal(ledger.verdict.mappingKnownAtVerdict, false);
assert.equal(ledger.verdict.selectedBlindArm, verdict.selectedBlindArm);
assert.equal(exhaustiveVerdict.mappingKnownAtVerdict, false);
assert.equal(exhaustiveVerdict.selection, 'tie');
assert.equal(exhaustiveVerdict.selectedBlindArm, null);
assert.equal(exhaustiveVerdict.confidence, 0.95);
assert.equal(exhaustiveVerdict.referenceFilesReviewed, 10);
assert.deepEqual(
  exhaustiveVerdict.reviewedFrameIndices,
  protocol.capture.frameIndices,
);
assert.equal(ledger.independentVerdict.selection, 'tie');
assert.equal(ledger.independentVerdict.reviewedFrameCount, 9);
assert.equal(ledger.independentVerdict.mappingKnownAtVerdict, false);
assert.equal(adjudication.status, 'split-independent-blind-verdicts');
assert.equal(adjudication.acceptedVisualWinner, null);
assert.equal(ledger.adjudication.acceptedVisualWinner, null);
assert.deepEqual(ledger.reveal.blindAssignment, reveal.randomization.blindAssignment);
assert.equal(
  reveal.randomization.blindAssignment[verdict.selectedBlindArm],
  'treatment',
);
assert.deepEqual(ledger.outcome, {
  selectedBlindArm: verdict.selectedBlindArm,
  selectedArm: 'treatment',
  treatmentLayout: 'clustered-sapling-shrub-256',
  acceptedVisualWinner: null,
  reason: 'The primary preference was not confirmed by the fresh exhaustive blind review.',
});

assert.equal(commitment.seedThreeCommit, reveal.seedThreeCommit);
assert.equal(protocol.requiredEvidence.seedThreeCommit, reveal.seedThreeCommit);
assert.match(reveal.seedThreeCommit, /^[0-9a-f]{40}$/);
assert.equal(commitment.committedInvariants.soleArmQueryDifference, 'forestEdgeLayout');
assert.equal(reveal.soleArmQueryDifference.parameter, 'forestEdgeLayout');
assert.equal(protocol.arms.soleQueryDifference, 'forestEdgeLayout');
assert.equal(protocol.arms.control.layout, 'legacy-perimeter');
assert.equal(protocol.arms.treatment.layout, 'clustered-sapling-shrub-256');
assert.deepEqual(protocol.capture.frameIndices, commitment.committedInvariants.frameIndices);
assert.deepEqual(validation.frameIndices, protocol.capture.frameIndices);
assert.deepEqual(reveal.frameIndices, protocol.capture.frameIndices);
assert.equal(
  protocol.capture.source,
  'renderer-drawing-buffer-after-gpu-queue-completion',
);
assert.equal(protocol.capture.dimensions, '1280x720@renderer-pr1');
assert.equal(validation.viewport, '1280x720');
assert.match(validation.captureMethod, /GPU-synchronized PNG/i);
assert.equal(commitment.committedInvariants.cameraPoseSignatureMustMatchAcrossArms, true);
assert.equal(protocol.capture.crossArmCameraPoseSignatureMustMatch, true);
assert.equal(validation.correspondingCameraPoseSignaturesMatch, true);
assert.equal(ledger.captureValidation.correspondingCameraPoseSignaturesMatch, true);
assert.equal(ledger.captureValidation.nativeGpuSynchronizedPng, true);
assert.match(reveal.cameraPoseIdentity, /must match across blind arms/i);

const controlUrl = new URL(
  protocol.arms.control.pathAndQuery,
  'http://127.0.0.1',
);
const treatmentUrl = new URL(
  protocol.arms.treatment.pathAndQuery,
  'http://127.0.0.1',
);
assert.equal(controlUrl.pathname, treatmentUrl.pathname);
assert.equal(controlUrl.searchParams.get('forestEdgeLayout'), 'legacy-perimeter');
assert.equal(
  treatmentUrl.searchParams.get('forestEdgeLayout'),
  'clustered-sapling-shrub-256',
);
controlUrl.searchParams.delete('forestEdgeLayout');
treatmentUrl.searchParams.delete('forestEdgeLayout');
assert.equal(
  controlUrl.searchParams.toString(),
  treatmentUrl.searchParams.toString(),
  'forestEdgeLayout must remain the sole arm query difference',
);

assert.deepEqual(protocol.requiredEvidence, {
  trees: 1651,
  forestDrawsMaximum: 20,
  residenceRoof: 'wood-shingle',
  treatmentReallocatedSlots: 256,
  treatmentRetainedSlots: 1395,
  treatmentClusters: 32,
  treatmentBroadleafSaplings: 128,
  treatmentBroadleafShrubCards: 128,
  controlReallocatedSlots: 0,
  seedThreeCommit: reveal.seedThreeCommit,
});

assert.equal(ledger.policy.neverOverwriteAnyAttempt, true);
assert.equal(commitment.committedInvariants.neverOverwriteAnyAttempt, true);
assert.equal(ledger.attempts.length, 21);
assert.deepEqual(ledger.discardedAttempts, [1]);
assert.deepEqual(
  ledger.retainedAttempts,
  Array.from({ length: 20 }, (_, index) => index + 2),
);
const seenAttemptPaths = new Set<string>();
for (const [index, attempt] of ledger.attempts.entries()) {
  assert.equal(attempt.attemptNumber, index + 1);
  assert.ok(!seenAttemptPaths.has(attempt.path), 'attempt paths must be immutable and unique');
  seenAttemptPaths.add(attempt.path);
  assert.ok(attempt.bytes > 0);
  assert.match(attempt.sha256, /^[0-9A-F]{64}$/);
  assert.ok(Number.isFinite(Date.parse(attempt.recordedAtUtc)));
  assert.ok(attempt.reason.length > 0);
  if (attempt.publicPath) {
    const publicPath = resolve(root, attempt.publicPath);
    assert.ok(existsSync(publicPath), `missing ${attempt.publicPath}`);
    assert.equal(readFileSync(publicPath).byteLength, attempt.bytes);
    assert.equal(sha256(publicPath), attempt.sha256);
  }
}

assert.deepEqual(
  ledger.attempts
    .filter((attempt) => attempt.kind === 'terminal-evidence')
    .map((attempt) => attempt.blindLabel),
  reveal.randomization.captureOrder,
  'retained arm groups must preserve the committed capture order',
);

for (const blindLabel of ['blind-A', 'blind-B'] as const) {
  assert.equal(validation.fullVisualSystemsReady[blindLabel], true);
  assert.equal(validation.performance[blindLabel].hardBarPass, true);
  assert.ok(
    validation.performance[blindLabel].onePercentLowFps
      >= protocol.performanceBar.onePercentLowFpsMinimum,
  );
  assert.ok(
    validation.performance[blindLabel].maxFrameMs
      <= protocol.performanceBar.maxFrameMsMaximum,
  );
  assert.equal(
    validation.performance[blindLabel].framesOver25Ms,
    protocol.performanceBar.framesOver25MsMaximum,
  );
  assert.equal(
    validation.performance[blindLabel].framesOver50Ms,
    protocol.performanceBar.framesOver50MsMaximum,
  );
}
assert.equal(ledger.captureValidation.blindAPerformanceHardBarPass, true);
assert.equal(ledger.captureValidation.blindBPerformanceHardBarPass, true);

for (const frameIndex of protocol.capture.frameIndices) {
  const label = String(frameIndex).padStart(4, '0');
  const blindHashes: string[] = [];
  for (const blindLabel of ['blind-A', 'blind-B'] as const) {
    const mappedArm = reveal.randomization.blindAssignment[blindLabel];
    const attempt = ledger.attempts.find(
      (entry) => entry.blindLabel === blindLabel
        && entry.frameIndex === frameIndex,
    );
    assert.ok(attempt, `missing ${blindLabel} frame ${frameIndex} attempt`);
    const originalPath = resolve(
      roundRoot,
      `${blindLabel}/frame-${String(frameIndex).padStart(3, '0')}.png`,
    );
    const routePath = resolve(roundRoot, `${blindLabel}/route-${label}.png`);
    const mappedPath = resolve(roundRoot, `${mappedArm}-frames/route-${label}.png`);
    for (const path of [originalPath, routePath, mappedPath]) {
      assert.ok(existsSync(path), `missing ${path}`);
      verifyPng(path);
      assert.equal(sha256(path), attempt!.sha256);
    }
    blindHashes.push(attempt!.sha256);
  }
  assert.notEqual(
    blindHashes[0],
    blindHashes[1],
    `frame ${frameIndex} must contain a visible treatment difference`,
  );
}

const archiveRoot = resolve(artifactRoot, 'captured-build');
if (existsSync(archiveRoot)) {
  const verified = verifyVisualGauntletBuildArchive({
    archiveRoot,
    manifestPath: bundleManifestPath,
  });
  assert.equal(verified.archiveSentinel.archiveId, protocol.archive.archiveId);
  assert.equal(verified.treeSha256, protocol.archive.treeSha256);
}

console.log(
  'Round 52 commitment, GPU-synchronized pose-matched capture, split independent '
  + 'blind verdicts, reveal, aliases, and performance bars verified.',
);
