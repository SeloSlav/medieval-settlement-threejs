import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const roundRoot = resolve(
  root,
  'public/visual-gauntlet/evidence/round-55',
);
const artifactRoot = resolve(
  root,
  'artifacts/visual-gauntlet/round-55',
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

type Attempt = {
  attemptNumber: number;
  disposition: 'discarded' | 'retained';
  path: string;
  publicPath?: string;
  bytes: number;
  sha256: string;
};

type Ledger = {
  status: string;
  commitmentSha256: string;
  summary: {
    attemptCount: number;
    discardedAttemptCount: number;
    retainedAttemptCount: number;
    primeRepeatPairs: number;
    allPrimeRepeatPngsExact: boolean;
    allCrossArmCameraPosesExact: boolean;
    bothArmsPassedHardPerformanceBar: boolean;
  };
  attempts: Attempt[];
  discardedAttempts: number[];
  retainedAttempts: number[];
};

type Validation = {
  status: string;
  allPrimeRepeatPngsExact: boolean;
  allCrossArmCameraPosesExact: boolean;
  framePairs: Array<{
    bytesExact: boolean;
    sha256Exact: boolean;
    cameraPoseSignatureExact: boolean;
  }>;
  crossArmCameraPoses: Array<{
    frameIndex: number;
    exact: boolean;
  }>;
  performance: Record<
    'blind-A' | 'blind-B',
    {
      metrics: {
        onePercentLowFps: number;
        maxFrameMs: number;
        framesOver25Ms: number;
        framesOver50Ms: number;
      };
      renderer: {
        medianDrawCalls: number;
        medianTriangles: number;
      };
      hardBarPassed: boolean;
    }
  >;
  bothArmsPassedHardPerformanceBar: boolean;
};

const commitmentPath = resolve(roundRoot, 'pre-blind-commitment.json');
const revealPath = resolve(roundRoot, 'pre-blind-reveal.json');
const artifactRevealPath = resolve(artifactRoot, 'pre-blind-reveal.json');
const ledger = readJson<Ledger>(resolve(roundRoot, 'capture-ledger.json'));
const validation = readJson<Validation>(
  resolve(roundRoot, 'capture-validation.json'),
);
const reveal = readJson<{
  seedThreeCommit: string;
  seedThreeScope: { status: string };
  arms: {
    control: { layout: string };
    treatment: { layout: string };
  };
  soleArmQueryDifference: {
    parameter: string;
    controlValue: string;
    treatmentValue: string;
  };
  randomization: {
    blindAssignment: Record<'blind-A' | 'blind-B', string>;
    captureOrder: string[];
  };
  frameIndices: number[];
}>(revealPath);

assert.ok(existsSync(commitmentPath), 'Round 55 commitment is missing');
assert.ok(existsSync(artifactRevealPath), 'private reveal is missing');
assert.equal(sha256(revealPath), ledger.commitmentSha256);
assert.equal(sha256(artifactRevealPath), ledger.commitmentSha256);
assert.equal(
  readFileSync(revealPath).compare(readFileSync(artifactRevealPath)),
  0,
  'public reveal must be byte-identical to its private committed preimage',
);
assert.equal(
  ledger.commitmentSha256,
  'D7BB0F53BCC0091FAD879B9755A41D25F5649CCD64D08B31AC29B316064867F3',
);
assert.equal(ledger.status, 'complete-valid-evidence-blind-tie');
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
assert.equal(
  new Set(ledger.attempts.map(({ attemptNumber }) => attemptNumber)).size,
  39,
);
assert.deepEqual(
  ledger.discardedAttempts,
  ledger.attempts
    .filter(({ disposition }) => disposition === 'discarded')
    .map(({ attemptNumber }) => attemptNumber),
);
assert.deepEqual(
  ledger.retainedAttempts,
  ledger.attempts
    .filter(({ disposition }) => disposition === 'retained')
    .map(({ attemptNumber }) => attemptNumber),
);

for (const attempt of ledger.attempts) {
  const attemptPath = resolve(root, attempt.path);
  assert.ok(existsSync(attemptPath), `missing attempt ${attempt.attemptNumber}`);
  assert.equal(readFileSync(attemptPath).byteLength, attempt.bytes);
  assert.equal(sha256(attemptPath), attempt.sha256);
  if (attempt.publicPath) {
    const publicPath = resolve(root, attempt.publicPath);
    assert.ok(
      existsSync(publicPath),
      `missing retained public copy ${attempt.publicPath}`,
    );
    assert.equal(sha256(publicPath), attempt.sha256);
  }
}

const frames = [0, 180, 276, 277, 278, 279, 330, 375, 480];
assert.equal(validation.status, 'passed-before-blind-verdict');
assert.equal(validation.allPrimeRepeatPngsExact, true);
assert.equal(validation.allCrossArmCameraPosesExact, true);
assert.equal(validation.bothArmsPassedHardPerformanceBar, true);
assert.equal(validation.framePairs.length, 18);
assert.deepEqual(
  validation.crossArmCameraPoses.map(({ frameIndex }) => frameIndex),
  frames,
);
assert.ok(validation.crossArmCameraPoses.every(({ exact }) => exact));
assert.ok(
  validation.framePairs.every(
    ({ bytesExact, sha256Exact, cameraPoseSignatureExact }) =>
      bytesExact && sha256Exact && cameraPoseSignatureExact,
  ),
);

for (const blindLabel of ['blind-A', 'blind-B'] as const) {
  const performance = validation.performance[blindLabel];
  assert.equal(performance.hardBarPassed, true);
  assert.ok(performance.metrics.onePercentLowFps >= 60);
  assert.ok(performance.metrics.maxFrameMs <= 25);
  assert.equal(performance.metrics.framesOver25Ms, 0);
  assert.equal(performance.metrics.framesOver50Ms, 0);
  assert.equal(performance.renderer.medianDrawCalls, 82);
}
assert.ok(
  validation.performance['blind-B'].renderer.medianTriangles
    < validation.performance['blind-A'].renderer.medianTriangles,
);

assert.equal(
  reveal.seedThreeCommit,
  '4182accfc1fb7a66815e963b5355ca4996418cf3',
);
assert.equal(
  reveal.seedThreeScope.status,
  'existing-generic-primitive-reused',
);
assert.equal(
  reveal.arms.control.layout,
  'tapered-shrub-sapling-belt-256',
);
assert.equal(
  reveal.arms.treatment.layout,
  'interlocking-midstory-thicket-256',
);
assert.equal(reveal.soleArmQueryDifference.parameter, 'forestEdgeLayout');
assert.deepEqual(reveal.randomization.blindAssignment, {
  'blind-A': 'control',
  'blind-B': 'treatment',
});
assert.deepEqual(reveal.randomization.captureOrder, ['blind-A', 'blind-B']);
assert.deepEqual(reveal.frameIndices, frames);

for (const frame of frames) {
  const blindA = resolve(
    roundRoot,
    'blind-A',
    `frame-${String(frame).padStart(3, '0')}.png`,
  );
  const blindB = resolve(
    roundRoot,
    'blind-B',
    `frame-${String(frame).padStart(3, '0')}.png`,
  );
  const control = resolve(
    roundRoot,
    'control',
    `route-${String(frame).padStart(4, '0')}.png`,
  );
  const treatment = resolve(
    roundRoot,
    'treatment',
    `route-${String(frame).padStart(4, '0')}.png`,
  );
  for (const path of [blindA, blindB, control, treatment]) verifyPng(path);
  assert.equal(sha256(control), sha256(blindA));
  assert.equal(sha256(treatment), sha256(blindB));
}

const verdict = readJson<{
  winner: string;
  confidencePercent: number;
  reviewedReferences: number;
  reviewedFramesPerArm: number;
  gates: Record<
    'blind-A' | 'blind-B',
    { visual: string; performance: string }
  >;
}>(resolve(roundRoot, 'blind-verdict.json'));
assert.equal(verdict.winner, 'tie');
assert.equal(verdict.confidencePercent, 82);
assert.equal(verdict.reviewedReferences, 10);
assert.equal(verdict.reviewedFramesPerArm, 9);
for (const blindLabel of ['blind-A', 'blind-B'] as const) {
  assert.deepEqual(verdict.gates[blindLabel], {
    visual: 'fail',
    performance: 'pass',
  });
}

const report = readJson<{
  status: string;
  winner: string;
  confidencePercent: number;
  acceptedAsNewVisualDefault: boolean;
  defaultLayoutAfterVerdict: string;
  mappingRevealedAfterVerdict: Record<'blind-A' | 'blind-B', string>;
  seedThreeAudit: {
    classification: string;
    seedThreeCommit: string;
    gitlinkChanged: boolean;
  };
}>(resolve(roundRoot, 'round-report.json'));
assert.equal(report.status, 'complete-valid-evidence-blind-tie');
assert.equal(report.winner, 'tie');
assert.equal(report.confidencePercent, 82);
assert.equal(report.acceptedAsNewVisualDefault, false);
assert.equal(
  report.defaultLayoutAfterVerdict,
  'tapered-shrub-sapling-belt-256',
);
assert.deepEqual(report.mappingRevealedAfterVerdict, {
  'blind-A': 'control',
  'blind-B': 'treatment',
});
assert.deepEqual(report.seedThreeAudit, {
  classification: 'fixture-specific composition of the existing generic primitive',
  seedThreeCommit: '4182accfc1fb7a66815e963b5355ca4996418cf3',
  gitlinkChanged: false,
  reason:
    'Depth fallbacks depend directly on Hamlet road, parcel, field, landmark, boundary, and clearance geometry; no reusable SeedThree primitive was added.',
});

const postReview = readJson<{
  status: string;
  winner: string;
  acceptedAsNewVisualDefault: boolean;
  files: Array<{ path: string; bytes: number; sha256: string }>;
}>(resolve(roundRoot, 'post-review-manifest.json'));
assert.equal(postReview.status, 'complete-valid-evidence-blind-tie');
assert.equal(postReview.winner, 'tie');
assert.equal(postReview.acceptedAsNewVisualDefault, false);
for (const file of postReview.files) {
  const path = resolve(root, file.path);
  assert.ok(existsSync(path), `post-review file is missing: ${file.path}`);
  assert.equal(readFileSync(path).byteLength, file.bytes);
  assert.equal(sha256(path), file.sha256);
}

const tracker = readFileSync(resolve(root, 'visual-gauntlet.html'), 'utf8');
assert.match(tracker, /Round 55 · valid evidence \/ blind tie/);
assert.match(tracker, /Round 55 · VALID EVIDENCE \/ 82% BLIND TIE/);

console.log(
  'Round 55 commitment, immutable attempts, exact repeats, pose matching, '
    + 'blind tie, reveal, aliases, SeedThree scope, and performance bars verified.',
);
