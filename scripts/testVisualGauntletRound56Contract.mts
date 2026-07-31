import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const roundRoot = resolve(
  root,
  'public/visual-gauntlet/evidence/round-56',
);
const artifactRoot = resolve(
  root,
  'artifacts/visual-gauntlet/round-56',
);
const commitmentSha256 =
  '8553DB93B87BD4F46D66A90F11ED25D4696FBEEB1D6FABD7BE319959D3CB97BD';
const frames = [0, 180, 276, 277, 278, 279, 330, 375, 480];

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
  archive: {
    archiveId: string;
    treeSha256: string;
    fileCount: number;
    bytes: number;
  };
};

type GroundEvidence = {
  query: {
    parameter: string;
    value: string;
    defaultWhenAbsent: string;
  };
  source: {
    forestEdgeLayout: string;
    vegetationSlots: number;
    edgeSlots: number;
  };
  footprint: {
    terrainVertices: number;
    candidateVertices: number;
    modifiedVertices: number;
    modifiedPercent: number;
    weightedCoverageSquareMeters: number;
    interpolationHaloMeters: number;
    clearance: {
      guaranteedRoadFragmentMinimumMeters: number | null;
      guaranteedSettlementFragmentMinimumMeters: number | null;
      roadContaminationVertices: number;
      parcelContaminationVertices: number;
    };
  };
  tone: { meanStableLuminanceReductionPercent: number };
  budget: Record<string, number | Record<string, number>>;
  seedThreeAudit: {
    classification: string;
    reusableSeedThreeBehaviorAdded: boolean;
    gitlinkChangeRequired: boolean;
  };
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
  structural: Record<
    'blind-A' | 'blind-B',
    {
      forestGround: GroundEvidence;
      forestEdgeLayout: string;
      trees: number;
      residenceRoof: string;
    }
  >;
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
    control: { forestEdgeLayout: string; forestGround: string };
    treatment: { forestEdgeLayout: string; forestGround: string };
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

assert.ok(existsSync(commitmentPath), 'Round 56 commitment is missing');
assert.ok(existsSync(artifactRevealPath), 'private reveal is missing');
assert.equal(sha256(revealPath), commitmentSha256);
assert.equal(sha256(artifactRevealPath), commitmentSha256);
assert.equal(
  readFileSync(revealPath).compare(readFileSync(artifactRevealPath)),
  0,
  'public reveal must be byte-identical to its committed private preimage',
);

assert.equal(ledger.status, 'complete-valid-evidence-blind-tie');
assert.equal(ledger.commitmentSha256, commitmentSha256);
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
assert.deepEqual(ledger.archive, {
  archiveId:
    '201B9BE2364C63E86A9A90CBF51F1537D355646EE0B05F6E128DE5B92F0DE0EB',
  treeSha256:
    '66FCDAD1727AEF879594EB04C0BEE776803C6256CD887B21DDF59181F6533EF4',
  fileCount: 435,
  bytes: 375681719,
});

for (const attempt of ledger.attempts) {
  const path = resolve(root, attempt.path);
  assert.ok(existsSync(path), `missing attempt ${attempt.attemptNumber}`);
  assert.equal(readFileSync(path).byteLength, attempt.bytes);
  assert.equal(sha256(path), attempt.sha256);
  if (attempt.publicPath) {
    const publicPath = resolve(root, attempt.publicPath);
    assert.ok(existsSync(publicPath), `missing ${attempt.publicPath}`);
    assert.equal(sha256(publicPath), attempt.sha256);
  }
}

assert.equal(validation.status, 'passed-before-blind-verdict');
assert.equal(validation.allPrimeRepeatPngsExact, true);
assert.equal(validation.allCrossArmCameraPosesExact, true);
assert.equal(validation.bothArmsPassedHardPerformanceBar, true);
assert.equal(validation.framePairs.length, 18);
assert.ok(
  validation.framePairs.every(
    ({ bytesExact, sha256Exact, cameraPoseSignatureExact }) =>
      bytesExact && sha256Exact && cameraPoseSignatureExact,
  ),
);
assert.deepEqual(
  validation.crossArmCameraPoses.map(({ frameIndex }) => frameIndex),
  frames,
);
assert.ok(validation.crossArmCameraPoses.every(({ exact }) => exact));

for (const label of ['blind-A', 'blind-B'] as const) {
  const performance = validation.performance[label];
  assert.equal(performance.hardBarPassed, true);
  assert.ok(performance.metrics.onePercentLowFps >= 60);
  assert.ok(performance.metrics.maxFrameMs <= 25);
  assert.equal(performance.metrics.framesOver25Ms, 0);
  assert.equal(performance.metrics.framesOver50Ms, 0);
  assert.equal(performance.renderer.medianDrawCalls, 82);
  assert.equal(validation.structural[label].forestEdgeLayout,
    'tapered-shrub-sapling-belt-256');
  assert.equal(validation.structural[label].trees, 1651);
  assert.equal(validation.structural[label].residenceRoof, 'wood-shingle');
}

const controlGround = validation.structural['blind-A'].forestGround;
const treatmentGround = validation.structural['blind-B'].forestGround;
assert.deepEqual(controlGround.query, {
  parameter: 'forestGround',
  value: 'existing-terrain',
  defaultWhenAbsent: 'existing-terrain',
});
assert.equal(controlGround.footprint.modifiedVertices, 0);
assert.deepEqual(treatmentGround.query, {
  parameter: 'forestGround',
  value: 'shadowed-under-canopy',
  defaultWhenAbsent: 'existing-terrain',
});
assert.equal(treatmentGround.source.forestEdgeLayout,
  'tapered-shrub-sapling-belt-256');
assert.equal(treatmentGround.source.vegetationSlots, 1651);
assert.equal(treatmentGround.source.edgeSlots, 256);
assert.equal(treatmentGround.footprint.terrainVertices, 50369);
assert.equal(treatmentGround.footprint.candidateVertices, 1377);
assert.equal(treatmentGround.footprint.modifiedVertices, 1250);
assert.ok(treatmentGround.footprint.modifiedPercent > 2.48);
assert.ok(treatmentGround.footprint.weightedCoverageSquareMeters > 5981);
assert.ok(treatmentGround.footprint.interpolationHaloMeters > 3.53);
assert.ok(
  (treatmentGround.footprint.clearance
    .guaranteedRoadFragmentMinimumMeters ?? 0) > 10,
);
assert.ok(
  (treatmentGround.footprint.clearance
    .guaranteedSettlementFragmentMinimumMeters ?? 0) > 8,
);
assert.equal(
  treatmentGround.footprint.clearance.roadContaminationVertices,
  0,
);
assert.equal(
  treatmentGround.footprint.clearance.parcelContaminationVertices,
  0,
);
assert.ok(treatmentGround.tone.meanStableLuminanceReductionPercent > 5.9);
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
  'perFrameWorkDelta',
]) {
  assert.equal(treatmentGround.budget[key], 0, `${key} must remain zero`);
}
assert.deepEqual(treatmentGround.seedThreeAudit, {
  classification: 'hamlet-specific-terrain-weighting',
  reusableSeedThreeBehaviorAdded: false,
  gitlinkChangeRequired: false,
  reason:
    'footprint-and-clearance-depend-on-hamlet-road-parcel-and-edge-composition',
});

assert.equal(
  reveal.seedThreeCommit,
  '4182accfc1fb7a66815e963b5355ca4996418cf3',
);
assert.equal(reveal.seedThreeScope.status, 'hamlet-specific-terrain-weighting');
assert.deepEqual(reveal.arms.control, {
  forestEdgeLayout: 'tapered-shrub-sapling-belt-256',
  forestGround: 'existing-terrain',
  pathAndQuery:
    '/hamlet-fixture.html?clean=1&view=strategic&route=gorski-kotar-lod-traverse-v1&visualProfile=1&ablation=groundcover-stream-forest-update-frozen&visualDisable=post&visualRouteLodSkyDirectRender=1&visualGpuTimestampMarkers=1&forestEdgeLayout=tapered-shrub-sapling-belt-256&forestGround=existing-terrain',
});
assert.equal(
  reveal.arms.treatment.forestEdgeLayout,
  'tapered-shrub-sapling-belt-256',
);
assert.equal(reveal.arms.treatment.forestGround, 'shadowed-under-canopy');
assert.deepEqual(reveal.soleArmQueryDifference, {
  parameter: 'forestGround',
  controlValue: 'existing-terrain',
  treatmentValue: 'shadowed-under-canopy',
});
assert.deepEqual(reveal.randomization.blindAssignment, {
  'blind-A': 'control',
  'blind-B': 'treatment',
});
assert.deepEqual(reveal.randomization.captureOrder, ['blind-A', 'blind-B']);
assert.deepEqual(reveal.frameIndices, frames);

for (const frame of frames) {
  const padded = String(frame).padStart(3, '0');
  const route = String(frame).padStart(4, '0');
  const blindA = resolve(roundRoot, 'blind-A', `frame-${padded}.png`);
  const blindB = resolve(roundRoot, 'blind-B', `frame-${padded}.png`);
  const control = resolve(roundRoot, 'control', `route-${route}.png`);
  const treatment = resolve(roundRoot, 'treatment', `route-${route}.png`);
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
  underCanopyVerdict: string;
  roadParcelCheck: string;
  lodPopCheck: string;
}>(resolve(roundRoot, 'blind-verdict.json'));
assert.equal(verdict.winner, 'tie');
assert.equal(verdict.confidencePercent, 97);
assert.equal(verdict.reviewedReferences, 10);
assert.equal(verdict.reviewedFramesPerArm, 9);
for (const label of ['blind-A', 'blind-B'] as const) {
  assert.deepEqual(verdict.gates[label], {
    visual: 'fail',
    performance: 'pass',
  });
}
assert.match(verdict.underCanopyVerdict, /not materially perceptible/);
assert.equal(verdict.roadParcelCheck, 'pass for both');
assert.match(verdict.lodPopCheck, /pass for both/);

const report = readJson<{
  status: string;
  winner: string;
  confidencePercent: number;
  acceptedAsNewVisualDefault: boolean;
  defaultForestGroundAfterVerdict: string;
  mappingRevealedAfterVerdict: Record<'blind-A' | 'blind-B', string>;
  seedThreeAudit: {
    classification: string;
    seedThreeCommit: string;
    gitlinkChanged: boolean;
    reusableSeedThreeBehaviorAdded: boolean;
  };
}>(resolve(roundRoot, 'round-report.json'));
assert.equal(report.status, 'complete-valid-evidence-blind-tie');
assert.equal(report.winner, 'tie');
assert.equal(report.confidencePercent, 97);
assert.equal(report.acceptedAsNewVisualDefault, false);
assert.equal(report.defaultForestGroundAfterVerdict, 'existing-terrain');
assert.deepEqual(report.mappingRevealedAfterVerdict, {
  'blind-A': 'control',
  'blind-B': 'treatment',
});
assert.equal(report.seedThreeAudit.classification,
  'Hamlet-specific terrain weighting');
assert.equal(
  report.seedThreeAudit.seedThreeCommit,
  '4182accfc1fb7a66815e963b5355ca4996418cf3',
);
assert.equal(report.seedThreeAudit.gitlinkChanged, false);
assert.equal(report.seedThreeAudit.reusableSeedThreeBehaviorAdded, false);

const postReview = readJson<{
  status: string;
  winner: string;
  confidencePercent: number;
  acceptedAsNewVisualDefault: boolean;
  files: Array<{ path: string; bytes: number; sha256: string }>;
}>(resolve(roundRoot, 'post-review-manifest.json'));
assert.equal(postReview.status, 'complete-valid-evidence-blind-tie');
assert.equal(postReview.winner, 'tie');
assert.equal(postReview.confidencePercent, 97);
assert.equal(postReview.acceptedAsNewVisualDefault, false);
for (const file of postReview.files) {
  const path = resolve(root, file.path);
  assert.ok(existsSync(path), `post-review file missing: ${file.path}`);
  assert.equal(readFileSync(path).byteLength, file.bytes);
  assert.equal(sha256(path), file.sha256);
}

const tracker = readFileSync(resolve(root, 'visual-gauntlet.html'), 'utf8');
assert.match(tracker, /Round 56 · valid evidence \/ 97% blind tie/);
assert.match(tracker, /Round 56 · VALID EVIDENCE \/ 97% BLIND TIE/);

console.log(
  'Round 56 commitment, immutable attempts, exact repeats, pose matching, '
    + 'terrain budget, blind tie, reveal, aliases, SeedThree scope, and '
    + 'performance bars verified.',
);
