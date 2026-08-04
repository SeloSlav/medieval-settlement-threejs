import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  readFileSync,
} from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const publicRoot = path.join(
  root,
  'public',
  'visual-gauntlet',
  'evidence',
  'round-57',
);
const artifactRoot = path.join(root, 'artifacts', 'visual-gauntlet', 'round-57');
const frameIndices = [0, 180, 276, 277, 278, 279, 330, 375, 480];
const expectedCommitment =
  '8C13E88129B5BA039437748D530D0C68A2573A22573B421ECA7F54D1A164BB69';
const expectedSeedThree =
  '4182accfc1fb7a66815e963b5355ca4996418cf3';

function json(relativePath: string) {
  return JSON.parse(readFileSync(path.join(publicRoot, relativePath), 'utf8'));
}

function bytes(relativePath: string) {
  return readFileSync(path.join(root, relativePath));
}

function sha256(buffer: Buffer) {
  return createHash('sha256').update(buffer).digest('hex').toUpperCase();
}

function assertExactCopy(left: string, right: string) {
  assert.deepEqual(bytes(left), bytes(right), `${left} must exactly match ${right}`);
}

assert.ok(existsSync(publicRoot), 'Round 57 public evidence directory is missing');
assert.ok(existsSync(artifactRoot), 'Round 57 private artifact directory is missing');

const commitment = json('pre-blind-commitment.json');
const reveal = json('pre-blind-reveal.json');
const privateRevealPath = path.join(artifactRoot, 'pre-blind-reveal.json');
const privateReveal = readFileSync(privateRevealPath);
assert.equal(commitment.status, 'sealed-before-capture');
assert.equal(commitment.sha256, expectedCommitment);
assert.equal(commitment.bytes, 4691);
assert.equal(privateReveal.length, commitment.bytes);
assert.equal(sha256(privateReveal), commitment.sha256);
assert.deepEqual(
  readFileSync(path.join(publicRoot, 'pre-blind-reveal.json')),
  privateReveal,
  'The post-verdict public reveal must be the exact committed preimage',
);
assert.deepEqual(reveal.randomization.blindAssignment, {
  'blind-A': 'treatment',
  'blind-B': 'control',
});
assert.deepEqual(reveal.randomization.captureOrder, ['blind-B', 'blind-A']);
assert.deepEqual(reveal.soleArmQueryDifference, {
  parameter: 'forestGround',
  controlValue: 'existing-terrain',
  treatmentValue: 'mottled-dense-crown-floor',
});
assert.equal(reveal.seedThreeCommit, expectedSeedThree);
assert.equal(reveal.seedThreeScope.status, 'hamlet-specific-terrain-weighting');
assert.equal(reveal.seedThreeScope.reason.includes('no reusable SeedThree behavior'), true);

const protocol = json('capture-protocol.json');
assert.equal(protocol.commitment.sha256, expectedCommitment);
assert.equal(protocol.commitment.sealedBeforeCapture, true);
assert.deepEqual(protocol.capture.frameIndices, frameIndices);
assert.equal(protocol.capture.primeCaptureDiscarded, true);
assert.equal(protocol.capture.immediateRepeatRequired, true);
assert.equal(protocol.capture.primeAndRepeatPngSha256MustMatch, true);
assert.equal(protocol.capture.crossArmCameraPoseSignatureMustMatch, true);

const validation = json('capture-validation.json');
assert.equal(validation.status, 'passed-before-blind-verdict');
assert.equal(validation.commitmentSha256, expectedCommitment);
assert.equal(validation.framePairs.length, 18);
assert.equal(validation.allPrimeRepeatPngsExact, true);
assert.equal(validation.allCrossArmCameraPosesExact, true);
assert.equal(validation.bothArmsPassedHardPerformanceBar, true);
assert.equal(validation.crossArmCameraPoses.length, frameIndices.length);
assert.ok(validation.framePairs.every((entry: any) => entry.bytesExact));
assert.ok(validation.framePairs.every((entry: any) => entry.sha256Exact));
assert.ok(
  validation.framePairs.every((entry: any) => entry.cameraPoseSignatureExact),
);
assert.ok(validation.crossArmCameraPoses.every((entry: any) => entry.exact));

for (const blindLabel of ['blind-A', 'blind-B']) {
  const metrics = validation.performance[blindLabel].metrics;
  assert.ok(metrics.onePercentLowFps >= 60);
  assert.ok(metrics.maxFrameMs <= 25);
  assert.equal(metrics.framesOver25Ms, 0);
  assert.equal(metrics.framesOver50Ms, 0);
  assert.equal(validation.performance[blindLabel].hardBarPassed, true);
  assert.equal(validation.structural[blindLabel].forestEdgeLayout,
    'tapered-shrub-sapling-belt-256');
  assert.equal(validation.structural[blindLabel].trees, 1651);
  assert.equal(validation.structural[blindLabel].residenceRoof, 'wood-shingle');
  assert.equal(validation.structural[blindLabel].seedThreeCommit, expectedSeedThree);
}

const treatmentGround = validation.structural['blind-A'].forestGround;
assert.equal(treatmentGround.query.value, 'mottled-dense-crown-floor');
assert.equal(treatmentGround.source.denseCrownSlots, 112);
assert.equal(treatmentGround.footprint.candidateVertices, 1639);
assert.equal(treatmentGround.footprint.densityQualifiedVertices, 856);
assert.equal(treatmentGround.footprint.modifiedVertices, 682);
assert.equal(treatmentGround.footprint.modifiedPercent, 1.3540074252020091);
assert.equal(
  treatmentGround.footprint.weightedCoverageSquareMeters,
  2176.9650015205907,
);
assert.equal(treatmentGround.footprint.observedMinimumAdjoiningCrowns, 3);
assert.equal(
  treatmentGround.footprint.clearance.guaranteedRoadFragmentMinimumMeters,
  11.214328166754143,
);
assert.equal(
  treatmentGround.footprint.clearance.guaranteedSettlementFragmentMinimumMeters,
  9.207812169432728,
);
assert.equal(treatmentGround.footprint.clearance.roadContaminationVertices, 0);
assert.equal(treatmentGround.footprint.clearance.parcelContaminationVertices, 0);
assert.equal(treatmentGround.footprint.clearance.roadContaminationTriangles, 0);
assert.equal(treatmentGround.footprint.clearance.parcelContaminationTriangles, 0);
assert.equal(
  treatmentGround.tone.meanStableLuminanceReductionPercent,
  13.965192485585554,
);
assert.equal(
  treatmentGround.tone.maximumStableLuminanceReductionPercent,
  30.068781687160374,
);
assert.equal(
  treatmentGround.tone.stableLuminanceReductionStandardDeviationPercent,
  7.45920874785387,
);
assert.equal(treatmentGround.tone.mottling.darkBasinVertices, 177);
assert.equal(treatmentGround.tone.mottling.leafLitterVertices, 177);
assert.equal(treatmentGround.tone.mottling.lighterChannelVertices, 161);
assert.equal(treatmentGround.budget.startupColorWrites, 682);
for (const key of [
  'forestSlotDelta',
  'forestDrawDelta',
  'terrainDrawDelta',
  'textureAssetDelta',
  'meshDelta',
  'materialDelta',
  'geometryVertexDelta',
  'geometryIndexDelta',
  'vertexAttributeDelta',
  'colorBufferByteDelta',
  'shaderDelta',
  'perFrameWorkDelta',
]) {
  assert.equal(treatmentGround.budget[key], 0, `${key} must remain zero`);
}
assert.equal(treatmentGround.seedThreeAudit.reusableSeedThreeBehaviorAdded, false);
assert.equal(treatmentGround.seedThreeAudit.gitlinkChangeRequired, false);

const controlGround = validation.structural['blind-B'].forestGround;
assert.equal(controlGround.query.value, 'existing-terrain');
assert.equal(controlGround.footprint.modifiedVertices, 0);
assert.equal(controlGround.budget.startupColorWrites, 0);

const ledger = json('capture-ledger.json');
assert.equal(ledger.status, 'complete-valid-evidence-blind-tie');
assert.equal(ledger.commitmentSha256, expectedCommitment);
assert.deepEqual(ledger.summary, {
  attemptCount: 39,
  discardedAttemptCount: 19,
  retainedAttemptCount: 20,
  primeRepeatPairs: 18,
  allPrimeRepeatPngsExact: true,
  allCrossArmCameraPosesExact: true,
  bothArmsPassedHardPerformanceBar: true,
});
assert.equal(ledger.attempts.length, 39);
assert.deepEqual(
  ledger.attempts.map((entry: any) => entry.attemptNumber),
  Array.from({ length: 39 }, (_, index) => index + 1),
);
assert.deepEqual(ledger.blindVerdict, {
  winner: 'tie',
  confidencePercent: 98,
  mappingRevealedAfterVerdict: {
    'blind-A': 'treatment',
    'blind-B': 'control',
  },
  acceptedAsNewVisualDefault: false,
});
for (const attempt of ledger.attempts) {
  const attemptBytes = bytes(attempt.path);
  assert.equal(attemptBytes.length, attempt.bytes);
  assert.equal(sha256(attemptBytes), attempt.sha256);
  if (attempt.publicPath) {
    assertExactCopy(attempt.path, attempt.publicPath);
  }
}

const verdict = json('blind-verdict.json');
assert.equal(verdict.reviewMode, 'fresh-context exhaustive blind A/B');
assert.equal(verdict.reviewedReferences, 10);
assert.equal(verdict.reviewedFramesPerArm, 9);
assert.equal(verdict.winner, 'tie');
assert.equal(verdict.confidencePercent, 98);
assert.equal(verdict.mappingUnknownUntilVerdictLocked, true);
assert.equal(verdict.gates['blind-A'].visual, 'fail');
assert.equal(verdict.gates['blind-B'].visual, 'fail');
assert.equal(verdict.lodPopCheck, 'pass for both across frames 276-279');
assert.equal(verdict.roadParcelCheck, 'pass for both');
assert.match(verdict.biggestRemainingGap, /continuous crown-density-driven/);

const report = json('round-report.json');
assert.equal(report.status, 'complete-valid-evidence-blind-tie');
assert.equal(report.winner, 'tie');
assert.equal(report.confidencePercent, 98);
assert.equal(report.acceptedAsNewVisualDefault, false);
assert.equal(report.defaultForestGroundAfterVerdict, 'existing-terrain');
assert.deepEqual(report.mappingRevealedAfterVerdict, {
  'blind-A': 'treatment',
  'blind-B': 'control',
});
assert.equal(report.comparison.treatment, 'mottled-dense-crown-floor');
assert.equal(report.performance.control.hardBarPassed, true);
assert.equal(report.performance.treatment.hardBarPassed, true);
assert.equal(report.seedThreeAudit.seedThreeCommit, expectedSeedThree);
assert.equal(report.seedThreeAudit.gitlinkChanged, false);

const postReviewManifest = json('post-review-manifest.json');
assert.equal(postReviewManifest.status, 'complete-valid-evidence-blind-tie');
assert.equal(postReviewManifest.mappingRevealSha256, expectedCommitment);
assert.equal(postReviewManifest.winner, 'tie');
assert.equal(postReviewManifest.confidencePercent, 98);
assert.equal(postReviewManifest.acceptedAsNewVisualDefault, false);
assert.equal(postReviewManifest.files.length, 49);
for (const file of postReviewManifest.files) {
  const fileBytes = bytes(file.path);
  assert.equal(fileBytes.length, file.bytes);
  assert.equal(sha256(fileBytes), file.sha256);
}

for (const frameIndex of frameIndices) {
  const blindName = `frame-${String(frameIndex).padStart(3, '0')}.png`;
  const aliasName = `route-${String(frameIndex).padStart(4, '0')}.png`;
  assertExactCopy(
    `public/visual-gauntlet/evidence/round-57/blind-B/${blindName}`,
    `public/visual-gauntlet/evidence/round-57/control/${aliasName}`,
  );
  assertExactCopy(
    `public/visual-gauntlet/evidence/round-57/blind-A/${blindName}`,
    `public/visual-gauntlet/evidence/round-57/treatment/${aliasName}`,
  );
}
assertExactCopy(
  'public/visual-gauntlet/evidence/round-57/blind-B/terminal-evidence.json',
  'public/visual-gauntlet/evidence/round-57/control/terminal-evidence.json',
);
assertExactCopy(
  'public/visual-gauntlet/evidence/round-57/blind-A/terminal-evidence.json',
  'public/visual-gauntlet/evidence/round-57/treatment/terminal-evidence.json',
);

const seedThreeHead = spawnSync(
  'git',
  [
    '-c',
    `safe.directory=${path.join(root, 'vendor', 'seedthree')}`,
    '-C',
    path.join(root, 'vendor', 'seedthree'),
    'rev-parse',
    'HEAD',
  ],
  { encoding: 'utf8' },
);
assert.equal(seedThreeHead.status, 0, seedThreeHead.stderr);
assert.match(seedThreeHead.stdout.trim(), /^[0-9a-f]{40}$/);

const seedThreeEvidenceIsAncestor = spawnSync(
  'git',
  [
    '-c',
    `safe.directory=${path.join(root, 'vendor', 'seedthree')}`,
    '-C',
    path.join(root, 'vendor', 'seedthree'),
    'merge-base',
    '--is-ancestor',
    expectedSeedThree,
    'HEAD',
  ],
  { encoding: 'utf8' },
);
assert.equal(
  seedThreeEvidenceIsAncestor.status,
  0,
  `the live SeedThree integration must retain the archived Round 57 revision in its history: ${seedThreeEvidenceIsAncestor.stderr}`,
);

const tracker = readFileSync(path.join(root, 'visual-gauntlet.html'), 'utf8');
assert.match(tracker, /Round 57 · valid 98% blind tie recorded/);
assert.match(tracker, /Round 57 · valid evidence \/ 98% blind tie/);
assert.match(tracker, /Round 57 · VALID EVIDENCE \/ 98% BLIND TIE/);
assert.match(tracker, /accepted control remains unchanged/);

console.log(
  'Round 57 commitment, immutable attempt ledger, exact repeats, matched poses, '
  + 'hard performance bar, blind tie, mapping reveal, alias integrity, tracker, '
  + 'and exact SeedThree boundary are valid.',
);
