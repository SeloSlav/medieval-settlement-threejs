import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import * as THREE from 'three';
import { pickResidenceAppearance } from '../src/residences/residenceAppearance.ts';
import { createResidenceMesh } from '../src/residences/ResidenceMarkers.ts';
import {
  batchStaticFixtureMeshes,
  countFixtureStructuralSubmissions,
} from '../src/e2e/staticFixtureBatch.ts';
import {
  HAMLET_ABLATION_IDS,
  HAMLET_BARE_RAF_LEAD_IN_MS,
  HAMLET_BARE_RAF_WINDOW_MS,
  HAMLET_DEFERRED_DOM_NO_UPDATE_SHELL_TREATMENT,
  HAMLET_DEGRADED_NO_RENDER_DISABLED_SUBSYSTEMS,
  HAMLET_FOREST_ROUTE_WORK_BUDGET,
  HAMLET_NO_UPDATE_SHELL_LEAD_IN_MS,
  HAMLET_NO_UPDATE_SHELL_TREATMENT,
  HAMLET_NO_UPDATE_SHELL_WINDOW_MS,
  HAMLET_PERFORMANCE_VIEWPORT,
  advanceHamletFixtureRouteWarmupDrain,
  canFinalizeHamletFixtureEvidence,
  canFinalizeHamletNoUpdateShellEvidence,
  createHamletBareRafCapture,
  createHamletFixtureEvidenceEnvelope,
  createHamletNoUpdateShellCapture,
  doesHamletNoUpdateShellMatchCollector,
  resolveHamletBareRafPairRequest,
  resolveHamletDeferredDomRequest,
  resolveHamletForestUpdateAblationTelemetry,
  resolveHamletFixtureAblation,
  resolveHamletNoUpdateShellRequest,
  resolveHamletPerformanceProtocol,
} from '../src/e2e/hamletFixturePerformance.ts';
import {
  HAMLET_FIELD_SPECS,
  HAMLET_LANDMARKS,
  HAMLET_MOTION_ROUTE,
  HAMLET_MOTION_ROUTE_ID,
  HAMLET_RESIDENCE_VIEW_SUBJECT,
  HAMLET_RESIDENCE_VIEW_SUBJECT_ID,
  HAMLET_RESIDENCE_ROOF,
  HAMLET_ROAD_ARMS,
  HAMLET_VIEW_IDS,
  HAMLET_VIEW_SPECS,
  HAMLET_ZONE_SPECS,
  resolveHamletBuildingLodBand,
  resolveHamletFullVisualSystemsReady,
  sampleHamletMotionRoute,
} from '../src/e2e/hamletFixtureConfig.ts';
import {
  VISUAL_FRAME_CPU_SPAN,
  VISUAL_FRAME_CPU_SUBSPANS,
  VISUAL_FRAME_GPU_SPAN,
  type ProfileSubsystem,
  type VisualPerformanceReport,
} from '../src/e2e/visualPerformanceHooks.ts';

assert.equal(HAMLET_VIEW_IDS.length, 7, 'fixture must expose seven matched review views');
assert.deepEqual(
  HAMLET_VIEW_SPECS.map((view) => view.id),
  HAMLET_VIEW_IDS,
  'view specs must cover every review distance in stable order',
);
assert.equal(new Set(HAMLET_VIEW_IDS).size, HAMLET_VIEW_IDS.length, 'view ids must be unique');
for (const view of HAMLET_VIEW_SPECS) {
  assert.ok(view.position.every(Number.isFinite), `${view.id} camera position must be fixed`);
  assert.ok(view.target.every(Number.isFinite), `${view.id} camera target must be fixed`);
}
const residenceView = HAMLET_VIEW_SPECS.find((view) => view.id === 'residence');
assert.ok(residenceView, 'the fixed residence material judge must retain the residence view id');
assert.equal(HAMLET_RESIDENCE_VIEW_SUBJECT_ID, 'west-lane-south-residence-1');
assert.deepEqual(residenceView.position, [-25.2, 3, 23]);
assert.deepEqual(residenceView.target, [-22.3, 3.5, 35.9]);
assert.equal(residenceView.fov, 43);
assert.equal(residenceView.firstPerson, true);
const residenceViewPosition = new THREE.Vector3(...residenceView.position);
const residenceViewTarget = new THREE.Vector3(...residenceView.target);
const residenceViewDistance = residenceViewPosition.distanceTo(residenceViewTarget);
assert.ok(
  residenceViewDistance >= 13 && residenceViewDistance <= 13.5,
  `residence judge must remain a close single-house 13–13.5 m view (${residenceViewDistance.toFixed(2)} m)`,
);
assert.ok(
  residenceView.position[1] >= 2.8 && residenceView.position[1] <= 3.2,
  'residence judge camera must remain modestly elevated above the foreground fence',
);
assert.ok(
  residenceView.target[1] >= 3.3 && residenceView.target[1] <= 3.7,
  'residence judge must center the complete steep-roof silhouette and work yard',
);
const subjectPosition = new THREE.Vector3(...HAMLET_RESIDENCE_VIEW_SUBJECT.position);
const subjectToCamera = residenceViewPosition.clone().sub(subjectPosition);
subjectToCamera.y = 0;
subjectToCamera.normalize();
const subjectFrontNormal = new THREE.Vector3(
  Math.sin(HAMLET_RESIDENCE_VIEW_SUBJECT.yaw),
  0,
  Math.cos(HAMLET_RESIDENCE_VIEW_SUBJECT.yaw),
);
assert.ok(
  THREE.MathUtils.radToDeg(subjectToCamera.angleTo(subjectFrontNormal)) >= 24
    && THREE.MathUtils.radToDeg(subjectToCamera.angleTo(subjectFrontNormal)) <= 36,
  'residence judge must retain a 24–36° three-quarter view of the selected cottage',
);

assert.equal(HAMLET_MOTION_ROUTE.id, HAMLET_MOTION_ROUTE_ID);
assert.equal(HAMLET_MOTION_ROUTE.durationMs, 21_000);
assert.equal(HAMLET_MOTION_ROUTE.interpolation, 'world-space-position-target-look-at');
assert.equal(HAMLET_MOTION_ROUTE.easing, 'smootherstep');
assert.deepEqual(
  HAMLET_MOTION_ROUTE.keyframes.map((keyframe) => keyframe.distanceMeters),
  [240, 240, 88, 4, 4, 88, 240],
  'motion must traverse strategic -> settlement -> road-eye -> settlement -> strategic',
);
assert.deepEqual(
  HAMLET_MOTION_ROUTE.settledStartPredicate,
  {
    id: 'fixture-ready-two-stable-frames',
    fixtureReady: true,
    detailedTexturesReady: true,
    minimumRenderedFrames: 2,
    motionInactive: true,
  },
);
for (let index = 0; index < HAMLET_MOTION_ROUTE.keyframes.length; index += 1) {
  const keyframe = HAMLET_MOTION_ROUTE.keyframes[index]!;
  if (index > 0) {
    assert.ok(
      keyframe.timeMs > HAMLET_MOTION_ROUTE.keyframes[index - 1]!.timeMs,
      `${keyframe.id} must advance route time`,
    );
  }
  const position = new THREE.Vector3(...keyframe.position);
  const target = new THREE.Vector3(...keyframe.target);
  assert.ok(
    Math.abs(position.distanceTo(target) - keyframe.distanceMeters) < 0.001,
    `${keyframe.id} world-space points must encode its named camera distance`,
  );
  const orientation = new THREE.Quaternion(...keyframe.orientation);
  assert.ok(
    Math.abs(orientation.length() - 1) < 0.000_001,
    `${keyframe.id} orientation must be a normalized world-space quaternion`,
  );
  const lookAtOrientation = new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().lookAt(position, target, new THREE.Vector3(0, 1, 0)),
  );
  assert.ok(
    THREE.MathUtils.radToDeg(orientation.angleTo(lookAtOrientation)) < 0.02,
    `${keyframe.id} authored orientation must agree with its world-space target`,
  );
}
assert.equal(
  HAMLET_MOTION_ROUTE.keyframes.at(-1)!.timeMs,
  HAMLET_MOTION_ROUTE.durationMs,
);
assert.deepEqual(
  HAMLET_MOTION_ROUTE.lodBands,
  {
    forest: { id: 'seedthree-overview-to-near', nearDistanceMeters: 108 },
    groundcover: {
      id: 'close-ground-dirt-and-cover',
      transitionStartMeters: 44,
      fullDetailMeters: 22,
    },
    building: {
      id: 'building-review-distance',
      settlementMeters: 88,
      roadEyeMeters: 4,
    },
  },
);
for (let elapsedMs = 0; elapsedMs <= HAMLET_MOTION_ROUTE.durationMs; elapsedMs += 25) {
  const sample = sampleHamletMotionRoute(elapsedMs);
  const actualDistance = sample.position.distanceTo(sample.target);
  assert.ok(
    Math.abs(sample.distanceMeters - actualDistance) < 1e-9,
    `motion distance telemetry must equal sampled geometry at ${elapsedMs}ms`,
  );
  const cameraForward = new THREE.Vector3(0, 0, -1)
    .applyQuaternion(sample.orientation)
    .normalize();
  const targetDirection = sample.target.clone().sub(sample.position).normalize();
  assert.ok(
    THREE.MathUtils.radToDeg(cameraForward.angleTo(targetDirection)) < 0.000_002,
    `camera orientation must aim at its published target at ${elapsedMs}ms`,
  );
}
const fullVisualReadiness = {
  fixtureReady: true,
  detailedTexturesReady: true,
  skyRuntimeReady: true,
  forestRuntimeReady: true,
  groundcoverRuntimeReady: true,
};
assert.equal(resolveHamletFullVisualSystemsReady(fullVisualReadiness), true);
assert.equal(
  resolveHamletFullVisualSystemsReady({
    ...fullVisualReadiness,
    skyRuntimeReady: false,
  }),
  false,
  'capture and motion readiness must remain false after a sky runtime timeout',
);
assert.equal(HAMLET_PERFORMANCE_VIEWPORT.label, '1280x720@renderer-pr1');
assert.equal(HAMLET_BARE_RAF_LEAD_IN_MS, 250);
assert.equal(HAMLET_BARE_RAF_WINDOW_MS, 30_000);
assert.equal(HAMLET_NO_UPDATE_SHELL_LEAD_IN_MS, 250);
assert.equal(HAMLET_NO_UPDATE_SHELL_WINDOW_MS, 30_000);
assert.equal(
  HAMLET_NO_UPDATE_SHELL_TREATMENT,
  'profiled-no-update-no-render-shell',
);
assert.deepEqual(
  HAMLET_DEGRADED_NO_RENDER_DISABLED_SUBSYSTEMS,
  ['forest', 'post', 'shadows'],
  'the paired control must reproduce the exact Round 32 presentation state',
);
assert.equal(
  resolveHamletBareRafPairRequest({
    requested: false,
    visualProfile: false,
    visualNoRender: false,
    routeId: null,
    ablationId: 'baseline',
    disabledSubsystems: [],
  }),
  false,
  'the paired control must be completely inert without its profile-only query',
);
assert.equal(
  resolveHamletBareRafPairRequest({
    requested: true,
    visualProfile: true,
    visualNoRender: true,
    routeId: HAMLET_MOTION_ROUTE_ID,
    ablationId: 'groundcover-stream-forest-update-frozen',
    disabledSubsystems: ['shadows', 'forest', 'post'],
  }),
  true,
  'the exact Round 32 arm must qualify regardless of query ordering',
);
for (const invalidPair of [
  {
    visualProfile: false,
    visualNoRender: true,
    routeId: HAMLET_MOTION_ROUTE_ID,
    ablationId: 'groundcover-stream-forest-update-frozen' as const,
    disabledSubsystems: ['forest', 'post', 'shadows'],
  },
  {
    visualProfile: true,
    visualNoRender: false,
    routeId: HAMLET_MOTION_ROUTE_ID,
    ablationId: 'groundcover-stream-forest-update-frozen' as const,
    disabledSubsystems: ['forest', 'post', 'shadows'],
  },
  {
    visualProfile: true,
    visualNoRender: true,
    routeId: HAMLET_MOTION_ROUTE_ID,
    ablationId: 'groundcover-stream-forest-update-frozen' as const,
    disabledSubsystems: ['forest', 'post'],
  },
  {
    visualProfile: true,
    visualNoRender: true,
    routeId: HAMLET_MOTION_ROUTE_ID,
    ablationId: 'groundcover-stream-forest-update-frozen' as const,
    disabledSubsystems: ['forest', 'post', 'shadows', 'shadows'],
  },
]) {
  assert.throws(
    () => resolveHamletBareRafPairRequest({
      requested: true,
      ...invalidPair,
    }),
    /exact Round 32 degraded no-render arm/,
    'paired controls must reject every treatment drift before boot',
  );
}

assert.equal(
  resolveHamletNoUpdateShellRequest({
    requested: false,
    visualProfile: false,
    visualNoRender: false,
    visualBareRafPair: false,
    routeId: null,
    ablationId: 'baseline',
    disabledSubsystems: [],
  }),
  false,
  'the no-update shell must be inert in the default fixture',
);
assert.equal(
  resolveHamletNoUpdateShellRequest({
    requested: true,
    visualProfile: true,
    visualNoRender: true,
    visualBareRafPair: false,
    routeId: HAMLET_MOTION_ROUTE_ID,
    ablationId: 'groundcover-stream-forest-update-frozen',
    disabledSubsystems: ['shadows', 'forest', 'post'],
  }),
  true,
  'only the exact degraded no-render presentation may enter the no-update shell',
);
assert.throws(
  () => resolveHamletNoUpdateShellRequest({
    requested: true,
    visualProfile: true,
    visualNoRender: true,
    visualBareRafPair: true,
    routeId: HAMLET_MOTION_ROUTE_ID,
    ablationId: 'groundcover-stream-forest-update-frozen',
    disabledSubsystems: ['forest', 'post', 'shadows'],
  }),
  /without visualBareRafPair/,
  'the profiled shell and callback-only control must remain mutually exclusive',
);
assert.equal(
  resolveHamletDeferredDomRequest({
    requested: false,
    visualNoUpdateShell: false,
  }),
  false,
  'deferred publication must remain absent from the default fixture',
);
assert.equal(
  resolveHamletDeferredDomRequest({
    requested: true,
    visualNoUpdateShell: true,
  }),
  true,
  'the DOM control must require and preserve the exact no-update/no-render shell',
);
assert.throws(
  () => resolveHamletDeferredDomRequest({
    requested: true,
    visualNoUpdateShell: false,
  }),
  /requires the exact visualNoUpdateShell=1 treatment/,
  'visualDeferDom must reject every broader fixture or profiler treatment',
);

const pairIdentity = {
  runUuid: 'f16558cc-5f5a-4e80-b00e-3d9fccb31409',
  performanceTimeOriginMs: 1_753_876_800_000,
};
const noUpdateShellCapture = createHamletNoUpdateShellCapture(pairIdentity);
assert.deepEqual(
  noUpdateShellCapture.appendRafTimestamp(1_000),
  { armCollectorAfterCurrentFrame: false, report: null },
);
const expectedNoUpdateLeadInFrameTimesMs = [100, 100, 50];
let noUpdateShellTimestampMs = 1_000;
for (
  let index = 0;
  index < expectedNoUpdateLeadInFrameTimesMs.length;
  index += 1
) {
  noUpdateShellTimestampMs += expectedNoUpdateLeadInFrameTimesMs[index]!;
  const step = noUpdateShellCapture.appendRafTimestamp(
    noUpdateShellTimestampMs,
  );
  assert.equal(step.report, null);
  assert.equal(
    step.armCollectorAfterCurrentFrame,
    index === expectedNoUpdateLeadInFrameTimesMs.length - 1,
    'only the terminal lead-in callback may reset and arm schema-5 collection',
  );
}
noUpdateShellTimestampMs += 10;
assert.deepEqual(
  noUpdateShellCapture.appendRafTimestamp(noUpdateShellTimestampMs),
  { armCollectorAfterCurrentFrame: false, report: null },
  'the callback after the lead-in must anchor both exact cohorts without adding an interval',
);
const expectedNoUpdateShellFrameTimesMs = Array.from(
  { length: 3_000 },
  () => 10,
);
let terminalNoUpdateShellReport = null;
for (const frameTimeMs of expectedNoUpdateShellFrameTimesMs) {
  noUpdateShellTimestampMs += frameTimeMs;
  const step = noUpdateShellCapture.appendRafTimestamp(
    noUpdateShellTimestampMs,
  );
  terminalNoUpdateShellReport = step.report;
}
assert.ok(terminalNoUpdateShellReport);
const noUpdateShellCaptureReport = noUpdateShellCapture.getReport();
assert.ok(noUpdateShellCaptureReport);
assert.deepEqual(
  noUpdateShellCaptureReport.leadIn.frameTimesMs,
  expectedNoUpdateLeadInFrameTimesMs,
  'the lead-in must remain a separate complete ordered sequence',
);
assert.equal(noUpdateShellCaptureReport.leadIn.elapsedMs, 250);
assert.equal(noUpdateShellCaptureReport.leadInToCohortGapMs, 10);
assert.deepEqual(
  noUpdateShellCaptureReport.judgedCohort.frameTimesMs,
  expectedNoUpdateShellFrameTimesMs,
  'the judged evidence must preserve the complete ordered schema-5 cohort',
);
assert.equal(noUpdateShellCaptureReport.judgedCohort.elapsedMs, 30_000);
assert.equal(noUpdateShellCaptureReport.judgedCohort.sampleCount, 3_000);
assert.deepEqual(
  noUpdateShellCaptureReport.judgedCohort.skippedWork,
  {
    motionRouteUpdates: 0,
    lodSceneUpdates: 0,
    skyUpdates: 0,
    renderSubmissions: 0,
  },
  'the treatment identity must serialize zero skipped update/render work',
);
assert.deepEqual(
  noUpdateShellCaptureReport.judgedCohort.retainedShell,
  {
    schemaVersion: 5,
    rafScheduling: 'requestAnimationFrame',
    collector: 'visual-performance-hooks',
    postamble: 'telemetry-evidence-dom',
  },
  'the treatment must explicitly retain the profiled scheduling and reporting shell',
);
assert.deepEqual(
  noUpdateShellCaptureReport.judgedCohort.metrics,
  {
    medianFps: 100,
    onePercentLowFps: 100,
    meanFps: 100,
    p99FrameMs: 10,
    maxFrameMs: 10,
    framesOver25Ms: 0,
    framesOver50Ms: 0,
  },
  'the complete ordered cohort must reproduce every judged aggregate',
);
const mutableNoUpdateShellReport =
  terminalNoUpdateShellReport as typeof terminalNoUpdateShellReport & {
    judgedCohort: { frameTimesMs: number[] };
  };
mutableNoUpdateShellReport.judgedCohort.frameTimesMs[0] = 999;
assert.equal(
  noUpdateShellCapture.getReport()?.judgedCohort.frameTimesMs[0],
  10,
  'published no-update shell cohorts must be immutable to consumers',
);

const deferredDomShellCapture = createHamletNoUpdateShellCapture(
  pairIdentity,
  { deferCohortDomPublication: true },
);
let deferredDomTimestampMs = 2_000;
deferredDomShellCapture.appendRafTimestamp(deferredDomTimestampMs);
for (const frameTimeMs of expectedNoUpdateLeadInFrameTimesMs) {
  deferredDomTimestampMs += frameTimeMs;
  deferredDomShellCapture.appendRafTimestamp(deferredDomTimestampMs);
}
deferredDomTimestampMs += 10;
deferredDomShellCapture.appendRafTimestamp(deferredDomTimestampMs);
for (const frameTimeMs of expectedNoUpdateShellFrameTimesMs) {
  deferredDomTimestampMs += frameTimeMs;
  deferredDomShellCapture.appendRafTimestamp(deferredDomTimestampMs);
}
const deferredDomShellReport = deferredDomShellCapture.getReport();
assert.ok(deferredDomShellReport);
assert.equal(
  deferredDomShellReport.treatment,
  HAMLET_DEFERRED_DOM_NO_UPDATE_SHELL_TREATMENT,
);
assert.deepEqual(deferredDomShellReport.deferredDom, {
  mode: 'terminal-only-after-freeze',
  cohortDomMutations: 0,
  statusDatasets: 'deferred',
  schema5DatasetPublication: 'deferred',
  metricsTextContent: 'deferred',
});
assert.deepEqual(
  deferredDomShellReport.judgedCohort.retainedShell,
  {
    schemaVersion: 5,
    rafScheduling: 'requestAnimationFrame',
    collector: 'visual-performance-hooks',
    postamble: 'telemetry-evidence-dom',
    domPublication: 'terminal-only-after-freeze',
    inMemoryReportCadence: '500ms',
    jsonSerialization: 'every-in-memory-report',
  },
  'the treatment identity must preserve the reporting shell while naming the one deferred dimension',
);
assert.deepEqual(
  deferredDomShellReport.leadIn.frameTimesMs,
  expectedNoUpdateLeadInFrameTimesMs,
  'deferred DOM publication must not alter lead-in isolation',
);
assert.deepEqual(
  deferredDomShellReport.judgedCohort.frameTimesMs,
  expectedNoUpdateShellFrameTimesMs,
  'the deferred treatment must retain the complete independently recomputable cohort',
);
assert.deepEqual(
  deferredDomShellReport.judgedCohort.metrics,
  noUpdateShellCaptureReport.judgedCohort.metrics,
  'deferral metadata must not alter exact cohort aggregates',
);

const bareRafCapture = createHamletBareRafCapture(pairIdentity);
assert.equal(bareRafCapture.appendRafTimestamp(1_000), null);
const expectedBareRafLeadInFrameTimesMs = [50, 75, 125];
let bareRafTimestampMs = 1_000;
for (const leadInFrameTimeMs of expectedBareRafLeadInFrameTimesMs) {
  bareRafTimestampMs += leadInFrameTimeMs;
  assert.equal(
    bareRafCapture.appendRafTimestamp(bareRafTimestampMs),
    null,
    'the callback-only lead-in must never publish or enter the judged cohort',
  );
}
assert.equal(
  bareRafCapture.getReport(),
  null,
  'the 250ms lead-in alone must not produce judged bare-rAF evidence',
);
const expectedBareRafFrameTimesMs = Array.from(
  { length: 3_000 },
  (_, index) => [5, 10, 15][index % 3]!,
);
for (
  let index = 0;
  index < expectedBareRafFrameTimesMs.length;
  index += 1
) {
  bareRafTimestampMs += expectedBareRafFrameTimesMs[index]!;
  const terminalReport = bareRafCapture.appendRafTimestamp(bareRafTimestampMs);
  if (index === expectedBareRafFrameTimesMs.length - 1) {
    assert.ok(terminalReport);
  } else {
    assert.equal(
      terminalReport,
      null,
      'the bare-rAF cohort must not publish before a complete 30-second window',
    );
  }
}
const bareRafCaptureReport = bareRafCapture.getReport();
assert.ok(bareRafCaptureReport);
const { leadIn: bareRafLeadInReport, bareRaf: bareRafReport } =
  bareRafCaptureReport;
assert.deepEqual(
  bareRafLeadInReport.frameTimesMs,
  expectedBareRafLeadInFrameTimesMs,
  'the pre-arm callback intervals must be serialized separately and in order',
);
assert.equal(
  bareRafLeadInReport.frameTimesMs.reduce(
    (sum, frameTimeMs) => sum + frameTimeMs,
    0,
  ),
  bareRafLeadInReport.elapsedMs,
  'the serialized lead-in intervals must exactly reproduce its elapsed time',
);
assert.equal(
  bareRafLeadInReport.elapsedMs,
  HAMLET_BARE_RAF_LEAD_IN_MS,
  'the deterministic test lead-in must span the full predeclared 250ms',
);
assert.equal(
  bareRafReport.startedAtRafTimestampMs,
  bareRafLeadInReport.completedAtRafTimestampMs,
  'the judged cohort must arm only at the lead-in terminal callback',
);
assert.equal(
  bareRafReport.frameTimesMs.length,
  bareRafReport.sampleCount,
  'the serialized cohort must contain every counted bare-rAF interval',
);
assert.deepEqual(
  bareRafReport.frameTimesMs,
  expectedBareRafFrameTimesMs,
  'the serialized cohort must preserve exact callback interval order',
);
assert.equal(
  bareRafReport.frameTimesMs[0],
  expectedBareRafFrameTimesMs[0],
  'the lead-in terminal interval must not leak into the judged cohort',
);
assert.equal(
  bareRafReport.frameTimesMs.reduce((sum, frameTimeMs) => sum + frameTimeMs, 0),
  bareRafReport.elapsedMs,
  'serialized interval duration must exactly reproduce the measured elapsed window',
);
const sortedBareRafFrameTimesMs = [...bareRafReport.frameTimesMs]
  .sort((left, right) => left - right);
const bareRafMiddleIndex = Math.floor(sortedBareRafFrameTimesMs.length / 2);
const bareRafMedianFrameMs = (
  sortedBareRafFrameTimesMs[bareRafMiddleIndex - 1]!
  + sortedBareRafFrameTimesMs[bareRafMiddleIndex]!
) * 0.5;
const bareRafWorstOnePercentCount = Math.max(
  1,
  Math.ceil(bareRafReport.frameTimesMs.length * 0.01),
);
const bareRafWorstOnePercentFrameTimesMs = sortedBareRafFrameTimesMs
  .slice(-bareRafWorstOnePercentCount);
const bareRafWorstOnePercentMeanMs =
  bareRafWorstOnePercentFrameTimesMs.reduce(
    (sum, frameTimeMs) => sum + frameTimeMs,
    0,
  ) / bareRafWorstOnePercentFrameTimesMs.length;
const independentlyRecomputedBareRafMetrics = {
  medianFps: 1000 / bareRafMedianFrameMs,
  onePercentLowFps: 1000 / bareRafWorstOnePercentMeanMs,
  meanFps:
    (bareRafReport.frameTimesMs.length * 1000)
    / bareRafReport.frameTimesMs.reduce(
      (sum, frameTimeMs) => sum + frameTimeMs,
      0,
    ),
  p99FrameMs: bareRafWorstOnePercentMeanMs,
  maxFrameMs: sortedBareRafFrameTimesMs.at(-1)!,
  framesOver25Ms: bareRafReport.frameTimesMs.filter(
    (frameTimeMs) => frameTimeMs > 25,
  ).length,
  framesOver50Ms: bareRafReport.frameTimesMs.filter(
    (frameTimeMs) => frameTimeMs > 50,
  ).length,
};
assert.deepEqual(
  independentlyRecomputedBareRafMetrics,
  bareRafReport.metrics,
  'the ordered cohort must independently reproduce every published aggregate',
);
assert.deepEqual(
  bareRafCaptureReport,
  {
    leadIn: {
      ...pairIdentity,
      phase: 'bare-raf-lead-in',
      beforeArm: 'bare-raf-only',
      declaredDurationMs: 250,
      startedAtRafTimestampMs: 1_000,
      completedAtRafTimestampMs: 1_250,
      elapsedMs: 250,
      sampleCount: 3,
      frameTimesMs: expectedBareRafLeadInFrameTimesMs,
      forbiddenWork: {
        routeSceneUpdates: 0,
        rendererCalls: 0,
        perFrameDomTelemetryWrites: 0,
      },
    },
    bareRaf: {
      ...pairIdentity,
      arm: 'bare-raf-only',
      sequenceIndex: 2,
      windowSeconds: 30,
      startedAtRafTimestampMs: 1_250,
      completedAtRafTimestampMs: 31_250,
      elapsedMs: 30_000,
      sampleCount: 3_000,
      frameTimesMs: expectedBareRafFrameTimesMs,
      metrics: {
        medianFps: 100,
        onePercentLowFps: 1000 / 15,
        meanFps: 100,
        p99FrameMs: 15,
        maxFrameMs: 15,
        framesOver25Ms: 0,
        framesOver50Ms: 0,
      },
      forbiddenWork: {
        routeSceneUpdates: 0,
        rendererCalls: 0,
        perFrameDomTelemetryWrites: 0,
      },
    },
  },
  'the terminal control must separate its lead-in from a fresh exact-window cohort',
);
const mutableBareRafCaptureReport =
  bareRafCaptureReport as typeof bareRafCaptureReport & {
    leadIn: {
      frameTimesMs: number[];
    };
    bareRaf: {
      frameTimesMs: number[];
    };
  };
mutableBareRafCaptureReport.leadIn.sampleCount = 0;
mutableBareRafCaptureReport.leadIn.frameTimesMs[0] = 999;
mutableBareRafCaptureReport.bareRaf.sampleCount = 0;
mutableBareRafCaptureReport.bareRaf.frameTimesMs[0] = 999;
mutableBareRafCaptureReport.bareRaf.metrics.maxFrameMs = 999;
const immutableBareRafCaptureReport = bareRafCapture.getReport();
assert.equal(
  immutableBareRafCaptureReport?.leadIn.sampleCount,
  3,
  'published lead-in evidence metadata must be immutable to consumers',
);
assert.deepEqual(
  immutableBareRafCaptureReport?.leadIn.frameTimesMs,
  expectedBareRafLeadInFrameTimesMs,
  'published lead-in intervals must be immutable to consumers',
);
assert.equal(
  immutableBareRafCaptureReport?.bareRaf.sampleCount,
  3_000,
  'published bare-rAF evidence metadata must be immutable to consumers',
);
assert.deepEqual(
  immutableBareRafCaptureReport?.bareRaf.frameTimesMs,
  expectedBareRafFrameTimesMs,
  'published bare-rAF intervals must be immutable to consumers',
);
assert.equal(
  immutableBareRafCaptureReport?.bareRaf.metrics.maxFrameMs,
  15,
  'published bare-rAF aggregates must be immutable to consumers',
);
assert.throws(
  () => createHamletBareRafCapture(pairIdentity).appendRafTimestamp(Number.NaN),
  /finite/,
);
const incompleteLeadInCapture = createHamletBareRafCapture(pairIdentity);
assert.equal(incompleteLeadInCapture.appendRafTimestamp(100), null);
assert.equal(incompleteLeadInCapture.appendRafTimestamp(349.999), null);
assert.equal(
  incompleteLeadInCapture.getReport(),
  null,
  'a sub-250ms lead-in must leave the judged collector unarmed and unpublished',
);
assert.throws(
  () => incompleteLeadInCapture.appendRafTimestamp(349.999),
  /strictly increasing/,
  'lead-in callbacks must preserve the same monotonic timestamp contract',
);
assert.deepEqual(
  HAMLET_FOREST_ROUTE_WORK_BUDGET,
  {
    maxBucketCompactionsPerFrame: 1,
    maxUpdateDurationMs: 2,
    maxMatrixWritesPerChunk: 128,
    minimumCameraMoveMeters: 8,
    minimumDirectionAngleDegrees: 2.5,
    minimumProjectionChange: 0.005,
    minimumCasterBoundsChangeMeters: 0.75,
  },
  'the deterministic profile must bound matrix work, elapsed time, and invalidation cadence',
);
assert.equal(
  resolveHamletPerformanceProtocol({
    requested: true,
    cssWidth: 1280,
    cssHeight: 720,
    drawingBufferWidth: 1280,
    drawingBufferHeight: 720,
    rendererPixelRatio: 1,
  }).valid,
  true,
  'the exact 1280x720 renderer-PR1 capture must qualify',
);
for (const invalidProfile of [
  { cssWidth: 1279, cssHeight: 720, drawingBufferWidth: 1280, drawingBufferHeight: 720, rendererPixelRatio: 1 },
  { cssWidth: 1280, cssHeight: 720, drawingBufferWidth: 1920, drawingBufferHeight: 1080, rendererPixelRatio: 1.5 },
]) {
  assert.equal(
    resolveHamletPerformanceProtocol({ requested: true, ...invalidProfile }).valid,
    false,
    'mismatched CSS or drawing-buffer dimensions must invalidate the profile',
  );
}

assert.deepEqual(
  HAMLET_ABLATION_IDS,
  [
    'baseline',
    'route-warmup',
    'forest-selection-frozen',
    'groundcover-stream-frozen',
    'groundcover-stream-forest-update-frozen',
    'groundcover-off',
    'post-off',
    'shadows-off',
    'forest-render-off',
    'heavy-render-off',
  ],
  'fixture subsystem A/B identifiers must remain stable for comparable captures',
);
assert.deepEqual(
  HAMLET_ABLATION_IDS.map((id) => resolveHamletFixtureAblation(id)),
  [
    {
      id: 'baseline',
      disabledSubsystems: [],
      forestSelection: 'budgeted',
      forestUpdates: 'active',
      groundcoverStreaming: 'active',
      routeWarmup: 'none',
    },
    {
      id: 'route-warmup',
      disabledSubsystems: [],
      forestSelection: 'budgeted',
      forestUpdates: 'active',
      groundcoverStreaming: 'active',
      routeWarmup: 'full-route',
    },
    {
      id: 'forest-selection-frozen',
      disabledSubsystems: [],
      forestSelection: 'frozen',
      forestUpdates: 'active',
      groundcoverStreaming: 'active',
      routeWarmup: 'none',
    },
    {
      id: 'groundcover-stream-frozen',
      disabledSubsystems: [],
      forestSelection: 'budgeted',
      forestUpdates: 'active',
      groundcoverStreaming: 'frozen',
      routeWarmup: 'full-route',
    },
    {
      id: 'groundcover-stream-forest-update-frozen',
      disabledSubsystems: [],
      forestSelection: 'budgeted',
      forestUpdates: 'frozen-after-settled-warmup',
      groundcoverStreaming: 'frozen',
      routeWarmup: 'full-route',
    },
    {
      id: 'groundcover-off',
      disabledSubsystems: ['groundcover'],
      forestSelection: 'budgeted',
      forestUpdates: 'active',
      groundcoverStreaming: 'active',
      routeWarmup: 'none',
    },
    {
      id: 'post-off',
      disabledSubsystems: ['post'],
      forestSelection: 'budgeted',
      forestUpdates: 'active',
      groundcoverStreaming: 'active',
      routeWarmup: 'none',
    },
    {
      id: 'shadows-off',
      disabledSubsystems: ['shadows'],
      forestSelection: 'budgeted',
      forestUpdates: 'active',
      groundcoverStreaming: 'active',
      routeWarmup: 'none',
    },
    {
      id: 'forest-render-off',
      disabledSubsystems: ['forest'],
      forestSelection: 'disabled',
      forestUpdates: 'active',
      groundcoverStreaming: 'active',
      routeWarmup: 'none',
    },
    {
      id: 'heavy-render-off',
      disabledSubsystems: ['groundcover', 'post', 'shadows', 'forest'],
      forestSelection: 'disabled',
      forestUpdates: 'active',
      groundcoverStreaming: 'active',
      routeWarmup: 'none',
    },
  ],
  'each A/B must change only the subsystem named by its identifier',
);
assert.throws(
  () => resolveHamletFixtureAblation('unknown-ablation'),
  /Unknown hamlet fixture ablation/,
  'typos must fail instead of silently producing incomparable evidence',
);
assert.deepEqual(
  resolveHamletForestUpdateAblationTelemetry({
    requestedMode: 'frozen-after-settled-warmup',
    warmupCompleted: false,
    pendingBuckets: 0,
  }),
  {
    requestedMode: 'frozen-after-settled-warmup',
    state: 'warming',
    pendingBucketsAtFreeze: null,
    convergedAtFreeze: false,
  },
  'forest updates must not freeze before the discarded route completes',
);
assert.deepEqual(
  resolveHamletForestUpdateAblationTelemetry({
    requestedMode: 'frozen-after-settled-warmup',
    warmupCompleted: true,
    pendingBuckets: 2,
  }),
  {
    requestedMode: 'frozen-after-settled-warmup',
    state: 'warming',
    pendingBucketsAtFreeze: null,
    convergedAtFreeze: false,
  },
  'forest updates must remain live until publication drains to zero pending buckets',
);
assert.deepEqual(
  resolveHamletForestUpdateAblationTelemetry({
    requestedMode: 'frozen-after-settled-warmup',
    warmupCompleted: true,
    pendingBuckets: 0,
  }),
  {
    requestedMode: 'frozen-after-settled-warmup',
    state: 'frozen',
    pendingBucketsAtFreeze: 0,
    convergedAtFreeze: true,
  },
  'the update-only ablation may freeze exactly at the settled warmup boundary',
);

let fakeWarmupPendingBuckets = 3;
let fakeWarmupDrainSteps = 0;
const fakeWarmupDrainPendingHistory: number[] = [];
while (fakeWarmupPendingBuckets > 0) {
  const result = advanceHamletFixtureRouteWarmupDrain({
    stage: 'strategic-drain',
    motionStatus: 'complete',
    pendingBuckets: fakeWarmupPendingBuckets,
    step: () => {
      fakeWarmupDrainSteps += 1;
      fakeWarmupPendingBuckets -= 1;
      return fakeWarmupPendingBuckets;
    },
  });
  assert.equal(result.stepped, true);
  assert.equal(result.progressed, true);
  fakeWarmupPendingBuckets = result.pendingBuckets;
  fakeWarmupDrainPendingHistory.push(result.pendingBuckets);
}
assert.equal(fakeWarmupDrainSteps, 3, 'strategic drain must step once per tick');
assert.deepEqual(
  fakeWarmupDrainPendingHistory,
  [2, 1, 0],
  'strategic drain must make deterministic progress until pending work reaches zero',
);
const completedWarmupDrain = advanceHamletFixtureRouteWarmupDrain({
  stage: 'strategic-drain',
  motionStatus: 'complete',
  pendingBuckets: fakeWarmupPendingBuckets,
  step: () => {
    throw new Error('a converged strategic drain must not schedule extra work');
  },
});
assert.deepEqual(completedWarmupDrain, {
  stepped: false,
  progressed: false,
  pendingBuckets: 0,
  complete: true,
});
const pausedWarmupDrain = advanceHamletFixtureRouteWarmupDrain({
  stage: 'route',
  motionStatus: 'running',
  pendingBuckets: 3,
  step: () => {
    throw new Error('route-time work must not be mistaken for strategic draining');
  },
});
assert.equal(pausedWarmupDrain.stepped, false);
assert.equal(pausedWarmupDrain.complete, false);

const sampleForestWork = {
  mode: 'frozen' as const,
  updateAblation: {
    requestedMode: 'active' as const,
    state: 'not-requested' as const,
    pendingBucketsAtFreeze: null,
    convergedAtFreeze: false,
  },
  configuredMaxBucketCompactionsPerFrame: 1,
  maxBucketCompactionsPerFrame: 0,
  maxUpdateDurationBudgetMs: 2,
  minimumCameraMoveMeters: 8,
  minimumDirectionAngleDegrees: 2.5,
  minimumProjectionChange: 0.005,
  minimumCasterBoundsChangeMeters: 0.75,
  totalBucketCompactions: 0,
  totalBucketUploads: 0,
  totalWorkChunks: 0,
  totalMatrixWrites: 0,
  selectorEvaluations: 0,
  selectorSkips: 1_160,
  triggerReasons: {},
  selectionChanges: 0,
  pendingBuckets: 0,
  maxUpdateDurationMs: 0,
  phases: {
    strategic: {
      frames: 320,
      selectionChanges: 0,
      bucketCompactions: 0,
      bucketUploads: 0,
      workChunks: 0,
      matrixWrites: 0,
      maxBucketCompactionsPerFrame: 0,
      maxUpdateDurationMs: 0,
      triggerReasons: {},
    },
    settlement: {
      frames: 560,
      selectionChanges: 0,
      bucketCompactions: 0,
      bucketUploads: 0,
      workChunks: 0,
      matrixWrites: 0,
      maxBucketCompactionsPerFrame: 0,
      maxUpdateDurationMs: 0,
      triggerReasons: {},
    },
    'road-eye': {
      frames: 280,
      selectionChanges: 0,
      bucketCompactions: 0,
      bucketUploads: 0,
      workChunks: 0,
      matrixWrites: 0,
      maxBucketCompactionsPerFrame: 0,
      maxUpdateDurationMs: 0,
      triggerReasons: {},
    },
  },
  settledKeyframes: {
    'strategic-settled': {
      observations: 2,
      pendingBuckets: 0,
      maxPendingBuckets: 0,
      converged: true,
      sampledAtMs: 983.3,
      sampleTiming: 'pre-departure-dwell' as const,
    },
    'road-eye-settled': {
      observations: 1,
      pendingBuckets: 0,
      maxPendingBuckets: 0,
      converged: true,
      sampledAtMs: 12_483.3,
      sampleTiming: 'pre-departure-dwell' as const,
    },
  },
};
const sampleGroundcoverWork = {
  mode: 'frozen' as const,
  maxUpdateDurationBudgetMs: 2,
  updates: 48,
  generationSubsteps: 24,
  generationDurationMs: 18,
  clearWriteSubsteps: 12,
  clearWriteDurationMs: 6,
  refreshCount: 12,
  refreshDurationMs: 1,
  gpuFlagUpdates: 60,
  gpuUpdateRanges: 60,
  bytesUploaded: 120_000,
  boundsScans: 0,
  completedSlots: 12,
  cancelledSlots: 0,
  pendingSlots: 0,
  maxPendingSlots: 12,
  lastUpdateDurationMs: 0.8,
  maxUpdateDurationMs: 1.9,
  converged: true,
};
const sampleRouteWarmup = {
  required: true,
  stage: 'complete' as const,
  completedRoutes: 1,
  completed: true,
  strategicPendingAtReset: 0,
  collectorReset: true,
};
const sampleAblation = {
  ...resolveHamletFixtureAblation('groundcover-stream-frozen'),
  disabledSubsystems: [] as ProfileSubsystem[],
};
const sampleProtocol = resolveHamletPerformanceProtocol({
  requested: true,
  cssWidth: 1280,
  cssHeight: 720,
  drawingBufferWidth: 1280,
  drawingBufferHeight: 720,
  rendererPixelRatio: 1,
});
const samplePerformanceReport: VisualPerformanceReport = {
  schemaVersion: 5,
  status: 'ready',
  windowSeconds: 30,
  elapsedSeconds: 30,
  sampleCount: 1_800,
  metrics: {
    medianFps: 60,
    onePercentLowFps: 58,
    meanFps: 59.8,
    p99FrameMs: 17.24,
    maxFrameMs: 22,
    framesOver25Ms: 0,
    framesOver50Ms: 0,
  },
  renderer: {
    medianDrawCalls: 100,
    medianFrameCalls: 100,
    medianTriangles: 1_000_000,
  },
  frameCpuSpan: { ...VISUAL_FRAME_CPU_SPAN },
  frameCpuSubspans: { ...VISUAL_FRAME_CPU_SUBSPANS },
  frameGpuSpan: { ...VISUAL_FRAME_GPU_SPAN },
  slowFrames: [],
  context: {
    backend: 'webgpu',
    viewport: { width: 1280, height: 720 },
    devicePixelRatio: 1,
    rendererPixelRatio: 1,
    visibility: 'visible',
    adapter: {
      source: 'unavailable',
      identityStatus: 'unavailable',
      fallbackStatus: 'unavailable',
      vendor: null,
      architecture: null,
      device: null,
      description: null,
      isFallbackAdapter: null,
      limitations: [],
    },
    gpuTiming: {
      requested: true,
      status: 'available',
      source: 'webgpu-timestamp-query',
      feature: 'timestamp-query',
      api: 'compute-pass-timestamp-writes',
      span: 'full-post-processing-queue-bookends',
      unit: 'milliseconds',
      slotCount: 32,
      attemptedFrames: 1_800,
      submittedFrames: 1_800,
      resolvedFrames: 1_800,
      pendingFrames: 0,
      droppedFrames: 0,
      failedFrames: 0,
      limitations: [],
    },
    subsystems: {
      post: true,
      sky: true,
      shadows: true,
      river: false,
      riverSimulation: false,
      riverRender: false,
      precipitation: false,
      selection: false,
      preview: false,
      terrain: true,
      groundcover: true,
      forest: true,
      ui: true,
    },
  },
};
const sampleEnvelope = createHamletFixtureEvidenceEnvelope({
  fixtureId: 'manor-lords-hamlet-v1',
  routeId: HAMLET_MOTION_ROUTE_ID,
  routeDurationMs: HAMLET_MOTION_ROUTE.durationMs,
  ablation: sampleAblation,
  protocol: sampleProtocol,
  performanceReport: samplePerformanceReport,
  forestWork: sampleForestWork,
  groundcoverWork: sampleGroundcoverWork,
  completedRoutes: 1,
  routeWarmup: sampleRouteWarmup,
  content: {
    residences: 17,
    residenceRoof: 'wood-shingle',
    trees: 10_000,
    visibleTrees: 2_000,
    forestDraws: 12,
  },
});
assert.equal(sampleEnvelope.performanceReport?.status, 'ready');
assert.equal(
  'pairedRafControl' in sampleEnvelope,
  false,
  'ordinary fixture evidence must retain its existing schema shape',
);
assert.equal(
  'noUpdateShell' in sampleEnvelope,
  false,
  'the default fixture must not publish no-update treatment evidence',
);
assert.equal(
  sampleEnvelope.forestWork.converged,
  true,
  'a frozen selector must publish zero pending work instead of stale pending buckets',
);
assert.equal(
  sampleEnvelope.forestWork.settledKeyframesConverged,
  true,
  'every observed route-settled checkpoint must prove pending=0',
);
assert.ok(
  sampleEnvelope.forestWork.phases['road-eye'].frames > 0,
  'authored road-eye dwell must contribute nonzero phase evidence',
);
assert.equal(
  sampleEnvelope.groundcoverWork.mode,
  'frozen',
  'the frozen-stream A/B must retain rendered groundcover while eliminating route-time writes',
);
assert.equal(sampleEnvelope.groundcoverWork.pendingSlots, 0);
assert.equal(sampleEnvelope.groundcoverWork.converged, true);
assert.equal(sampleEnvelope.groundcoverWork.boundsScans, 0);

const noUpdateCollectorReport: VisualPerformanceReport = {
  ...samplePerformanceReport,
  sampleCount: noUpdateShellCaptureReport.judgedCohort.sampleCount,
  metrics: { ...noUpdateShellCaptureReport.judgedCohort.metrics },
  renderer: {
    medianDrawCalls: 0,
    medianFrameCalls: 0,
    medianTriangles: 0,
  },
};
assert.equal(
  doesHamletNoUpdateShellMatchCollector(
    noUpdateShellCaptureReport,
    noUpdateCollectorReport,
  ),
  true,
  'the schema-5 collector must exactly reproduce the independent ordered cohort',
);
assert.equal(
  doesHamletNoUpdateShellMatchCollector(
    noUpdateShellCaptureReport,
    {
      ...noUpdateCollectorReport,
      sampleCount: noUpdateCollectorReport.sampleCount - 1,
    },
  ),
  false,
  'a missing schema-5 interval must fail treatment integrity',
);
const noUpdateEnvelope = createHamletFixtureEvidenceEnvelope({
  fixtureId: 'manor-lords-hamlet-v1',
  routeId: HAMLET_MOTION_ROUTE_ID,
  routeDurationMs: HAMLET_MOTION_ROUTE.durationMs,
  ablation: resolveHamletFixtureAblation(
    'groundcover-stream-forest-update-frozen',
  ),
  protocol: sampleProtocol,
  performanceReport: noUpdateCollectorReport,
  forestWork: {
    ...sampleForestWork,
    mode: 'frozen-after-settled-warmup',
    updateAblation: {
      requestedMode: 'frozen-after-settled-warmup',
      state: 'frozen',
      pendingBucketsAtFreeze: 0,
      convergedAtFreeze: true,
    },
  },
  groundcoverWork: sampleGroundcoverWork,
  completedRoutes: 0,
  routeWarmup: sampleRouteWarmup,
  content: {
    residences: 17,
    residenceRoof: 'wood-shingle',
    trees: 10_000,
    visibleTrees: 2_000,
    forestDraws: 12,
  },
});
assert.equal(
  canFinalizeHamletNoUpdateShellEvidence(
    noUpdateEnvelope,
    noUpdateShellCaptureReport,
    'ready',
  ),
  true,
  'the control may finalize without route updates only after a complete warmup and exact schema-5 cohort',
);
assert.equal(
  canFinalizeHamletNoUpdateShellEvidence(
    {
      ...noUpdateEnvelope,
      performanceReport: {
        ...noUpdateCollectorReport,
        renderer: {
          ...noUpdateCollectorReport.renderer,
          medianFrameCalls: 1,
        },
      },
    },
    noUpdateShellCaptureReport,
    'ready',
  ),
  false,
  'any render submission must invalidate the no-render treatment',
);
assert.equal(
  canFinalizeHamletFixtureEvidence(sampleEnvelope, 'ready'),
  true,
  'a full ready boot with every phase, one route, and settled frozen grass may finalize',
);
assert.equal(
  canFinalizeHamletFixtureEvidence(sampleEnvelope, 'ready-degraded'),
  false,
  'an ablation label must not disguise a degraded boot as valid evidence',
);
assert.equal(
  canFinalizeHamletFixtureEvidence({
    ...sampleEnvelope,
    route: { ...sampleEnvelope.route, completedRoutes: 0 },
  }, 'ready'),
  false,
  'idle profile windows must not finalize before a complete 21-second route',
);
assert.equal(
  canFinalizeHamletFixtureEvidence({
    ...sampleEnvelope,
    route: {
      ...sampleEnvelope.route,
      completedRoutes: 1,
      phasesTraversed: {
        ...sampleEnvelope.route.phasesTraversed,
        'road-eye': false,
      },
    },
  }, 'ready'),
  false,
  'evidence must prove that the road-eye phase was actually traversed',
);
assert.equal(
  canFinalizeHamletFixtureEvidence({
    ...sampleEnvelope,
    groundcoverWork: {
      ...sampleEnvelope.groundcoverWork,
      pendingSlots: 1,
      converged: false,
    },
  }, 'ready'),
  false,
  'frozen evidence must retain its fully primed pending=0 state',
);
const frozenForestUpdateEnvelope = createHamletFixtureEvidenceEnvelope({
  fixtureId: 'manor-lords-hamlet-v1',
  routeId: HAMLET_MOTION_ROUTE_ID,
  routeDurationMs: HAMLET_MOTION_ROUTE.durationMs,
  ablation: resolveHamletFixtureAblation(
    'groundcover-stream-forest-update-frozen',
  ),
  protocol: sampleProtocol,
  performanceReport: samplePerformanceReport,
  forestWork: {
    ...sampleForestWork,
    mode: 'frozen-after-settled-warmup',
    updateAblation: {
      requestedMode: 'frozen-after-settled-warmup',
      state: 'frozen',
      pendingBucketsAtFreeze: 0,
      convergedAtFreeze: true,
    },
  },
  groundcoverWork: sampleGroundcoverWork,
  completedRoutes: 1,
  routeWarmup: sampleRouteWarmup,
  content: {
    residences: 17,
    residenceRoof: 'wood-shingle',
    trees: 10_000,
    visibleTrees: 2_000,
    forestDraws: 12,
  },
});
assert.equal(
  canFinalizeHamletFixtureEvidence(frozenForestUpdateEnvelope, 'ready'),
  true,
  'the combined ablation may finalize only with rendered forest, a settled freeze, and zero measured update work',
);
assert.equal(
  frozenForestUpdateEnvelope.performanceReport?.context.subsystems.forest,
  true,
  'the update-only ablation must preserve forest rendering',
);
assert.deepEqual(
  {
    trees: frozenForestUpdateEnvelope.content.trees,
    visibleTrees: frozenForestUpdateEnvelope.content.visibleTrees,
    forestDraws: frozenForestUpdateEnvelope.content.forestDraws,
  },
  { trees: 10_000, visibleTrees: 2_000, forestDraws: 12 },
  'saved evidence must prove that the settled forest still publishes visible draws',
);
assert.deepEqual(
  frozenForestUpdateEnvelope.ablation.disabledSubsystems,
  [],
  'the combined ablation must preserve scene identity instead of hiding forest or groundcover',
);
for (const invalidFrozenForestWork of [
  {
    ...frozenForestUpdateEnvelope.forestWork,
    updateAblation: {
      ...frozenForestUpdateEnvelope.forestWork.updateAblation,
      state: 'warming' as const,
      convergedAtFreeze: false,
      pendingBucketsAtFreeze: null,
    },
  },
  {
    ...frozenForestUpdateEnvelope.forestWork,
    totalMatrixWrites: 128,
  },
]) {
  assert.equal(
    canFinalizeHamletFixtureEvidence({
      ...frozenForestUpdateEnvelope,
      forestWork: invalidFrozenForestWork,
    }, 'ready'),
    false,
    'combined evidence must reject either an unsettled freeze or measured forest update work',
  );
}
const forestRenderIsolationEnvelope = {
  ...frozenForestUpdateEnvelope,
  performanceReport: {
    ...samplePerformanceReport,
    context: {
      ...samplePerformanceReport.context,
      subsystems: {
        ...samplePerformanceReport.context.subsystems,
        post: false,
        shadows: false,
        forest: false,
      },
    },
  },
};
assert.equal(
  canFinalizeHamletFixtureEvidence(forestRenderIsolationEnvelope, 'ready'),
  true,
  'a recorded runtime forest-render isolation may finalize after the forest was built, warmed, converged, and frozen',
);
assert.deepEqual(
  {
    post: forestRenderIsolationEnvelope.performanceReport.context.subsystems.post,
    shadows:
      forestRenderIsolationEnvelope.performanceReport.context.subsystems.shadows,
    forest:
      forestRenderIsolationEnvelope.performanceReport.context.subsystems.forest,
    groundcover:
      forestRenderIsolationEnvelope.performanceReport.context.subsystems.groundcover,
  },
  { post: false, shadows: false, forest: false, groundcover: true },
  'the treatment must isolate forest rendering on top of the existing post/shadow controls without hiding groundcover',
);
assert.equal(
  canFinalizeHamletFixtureEvidence({
    ...forestRenderIsolationEnvelope,
    ablation: {
      ...forestRenderIsolationEnvelope.ablation,
      disabledSubsystems: ['forest'],
    },
  }, 'ready'),
  false,
  'runtime visual isolation must not weaken the canonical ablation scene-identity guard',
);
const groundcoverRenderIsolationEnvelope = {
  ...forestRenderIsolationEnvelope,
  performanceReport: {
    ...forestRenderIsolationEnvelope.performanceReport,
    context: {
      ...forestRenderIsolationEnvelope.performanceReport.context,
      subsystems: {
        ...forestRenderIsolationEnvelope.performanceReport.context.subsystems,
        groundcover: false,
      },
    },
  },
};
assert.equal(
  canFinalizeHamletFixtureEvidence(
    groundcoverRenderIsolationEnvelope,
    'ready',
  ),
  true,
  'runtime groundcover presentation may be hidden after the stream was primed, converged, and frozen',
);
assert.deepEqual(
  {
    post:
      groundcoverRenderIsolationEnvelope.performanceReport.context.subsystems.post,
    shadows:
      groundcoverRenderIsolationEnvelope.performanceReport.context.subsystems.shadows,
    forest:
      groundcoverRenderIsolationEnvelope.performanceReport.context.subsystems.forest,
    groundcover:
      groundcoverRenderIsolationEnvelope.performanceReport.context.subsystems.groundcover,
  },
  { post: false, shadows: false, forest: false, groundcover: false },
  'the next presentation control must add only groundcover hiding to the existing direct-render treatment',
);
assert.equal(
  canFinalizeHamletFixtureEvidence({
    ...groundcoverRenderIsolationEnvelope,
    ablation: {
      ...groundcoverRenderIsolationEnvelope.ablation,
      disabledSubsystems: ['groundcover'],
    },
  }, 'ready'),
  false,
  'runtime groundcover isolation must not be recorded as a canonical ablation mutation',
);
const warmRouteEnvelope = createHamletFixtureEvidenceEnvelope({
  fixtureId: 'manor-lords-hamlet-v1',
  routeId: HAMLET_MOTION_ROUTE_ID,
  routeDurationMs: HAMLET_MOTION_ROUTE.durationMs,
  ablation: resolveHamletFixtureAblation('route-warmup'),
  protocol: sampleProtocol,
  performanceReport: samplePerformanceReport,
  forestWork: sampleForestWork,
  groundcoverWork: sampleGroundcoverWork,
  completedRoutes: 1,
  routeWarmup: {
    required: true,
    stage: 'complete',
    completedRoutes: 1,
    completed: true,
    strategicPendingAtReset: 0,
    collectorReset: true,
  },
  content: {
    residences: 17,
    residenceRoof: 'wood-shingle',
    trees: 10_000,
    visibleTrees: 2_000,
    forestDraws: 12,
  },
});
assert.equal(
  canFinalizeHamletFixtureEvidence(warmRouteEnvelope, 'ready'),
  true,
  'the warm A/B may finalize only after one discarded route, a zero-pending drain, and reset',
);
for (const invalidWarmup of [
  { ...warmRouteEnvelope.route.warmup, completedRoutes: 0 },
  { ...warmRouteEnvelope.route.warmup, completed: false },
  { ...warmRouteEnvelope.route.warmup, strategicPendingAtReset: 1 },
  { ...warmRouteEnvelope.route.warmup, collectorReset: false },
  { ...warmRouteEnvelope.route.warmup, stage: 'resettling' as const },
]) {
  assert.equal(
    canFinalizeHamletFixtureEvidence({
      ...warmRouteEnvelope,
      route: {
        ...warmRouteEnvelope.route,
        warmup: invalidWarmup,
      },
    }, 'ready'),
    false,
    'incomplete warmup evidence must not finalize a measured route',
  );
}
assert.doesNotThrow(
  () => JSON.stringify(sampleEnvelope),
  'the combined performance and route-work evidence must be serializable',
);
sampleForestWork.phases.strategic.frames = 999;
sampleAblation.disabledSubsystems.push('forest');
assert.equal(
  sampleEnvelope.forestWork.phases.strategic.frames,
  320,
  'the evidence envelope must snapshot route-phase telemetry',
);
assert.deepEqual(
  sampleEnvelope.ablation.disabledSubsystems,
  [],
  'the evidence envelope must snapshot the effective subsystem state',
);
const pendingEnvelope = createHamletFixtureEvidenceEnvelope({
  fixtureId: 'manor-lords-hamlet-v1',
  routeId: HAMLET_MOTION_ROUTE_ID,
  routeDurationMs: HAMLET_MOTION_ROUTE.durationMs,
  ablation: resolveHamletFixtureAblation('baseline'),
  protocol: sampleProtocol,
  performanceReport: samplePerformanceReport,
  forestWork: { ...sampleForestWork, pendingBuckets: 2 },
  groundcoverWork: sampleGroundcoverWork,
  completedRoutes: 1,
  routeWarmup: sampleRouteWarmup,
  content: {
    residences: 17,
    residenceRoof: 'wood-shingle',
    trees: 10_000,
    visibleTrees: 2_000,
    forestDraws: 12,
  },
});
assert.equal(
  pendingEnvelope.forestWork.converged,
  false,
  'saved evidence must expose unfinished scheduler work',
);
const unsettledCheckpointEnvelope = createHamletFixtureEvidenceEnvelope({
  fixtureId: 'manor-lords-hamlet-v1',
  routeId: HAMLET_MOTION_ROUTE_ID,
  routeDurationMs: HAMLET_MOTION_ROUTE.durationMs,
  ablation: resolveHamletFixtureAblation('baseline'),
  protocol: sampleProtocol,
  performanceReport: samplePerformanceReport,
  forestWork: {
    ...sampleForestWork,
    settledKeyframes: {
      ...sampleForestWork.settledKeyframes,
      'road-eye-settled': {
        observations: 1,
        pendingBuckets: 1,
        maxPendingBuckets: 1,
        converged: false,
        sampledAtMs: 12_483.3,
        sampleTiming: 'pre-departure-dwell',
      },
    },
  },
  groundcoverWork: sampleGroundcoverWork,
  completedRoutes: 1,
  routeWarmup: sampleRouteWarmup,
  content: {
    residences: 17,
    residenceRoof: 'wood-shingle',
    trees: 10_000,
    visibleTrees: 2_000,
    forestDraws: 12,
  },
});
assert.equal(
  unsettledCheckpointEnvelope.forestWork.settledKeyframesConverged,
  false,
  'evidence must fail checkpoint convergence when road-eye still has pending work',
);

const roadEyeArrival = sampleHamletMotionRoute(11_000);
assert.ok(
  roadEyeArrival.distanceMeters > HAMLET_MOTION_ROUTE.lodBands.building.roadEyeMeters,
  'the authored floating-point distance documents the prior exact-threshold miss',
);
assert.equal(
  resolveHamletBuildingLodBand(roadEyeArrival.distanceMeters),
  'road-eye',
  'road-eye classification must tolerate authored world-space floating-point drift',
);
let sampledRoadEyeFrames = 0;
for (let elapsedMs = 0; elapsedMs <= HAMLET_MOTION_ROUTE.durationMs; elapsedMs += 1000 / 60) {
  if (
    resolveHamletBuildingLodBand(sampleHamletMotionRoute(elapsedMs).distanceMeters)
    === 'road-eye'
  ) {
    sampledRoadEyeFrames += 1;
  }
}
assert.ok(
  sampledRoadEyeFrames > 60,
  `road-eye dwell must be measurable at 60Hz (${sampledRoadEyeFrames} frames)`,
);

assert.equal(HAMLET_ROAD_ARMS.length, 3, 'fixture road must have three Y arms');
for (const arm of HAMLET_ROAD_ARMS) {
  assert.deepEqual(arm.points[0], [0, 0], `${arm.id} must share the deterministic junction`);
}
assert.ok(
  HAMLET_ZONE_SPECS.reduce((sum, zone) => sum + zone.plotCount, 0) >= 16,
  'compact hamlet fabric should read as a clustered settlement at strategic distance',
);
assert.ok(HAMLET_FIELD_SPECS.length >= 4, 'cultivated fabric needs multiple readable parcels');
assert.deepEqual(
  new Set(HAMLET_LANDMARKS.map((landmark) => landmark.kind)),
  new Set(['chapel', 'well', 'marketplace']),
  'fixture needs chapel, well, and trade building',
);
for (const landmark of HAMLET_LANDMARKS) {
  const roadClearance = Math.min(
    ...HAMLET_ROAD_ARMS.flatMap((arm) => arm.points.slice(0, -1).map((start, index) => (
      distanceToSegment(landmark.position, start, arm.points[index + 1]!)
    ))),
  );
  assert.ok(
    roadClearance >= 5,
    `${landmark.id} must sit beside the lane rather than overlap it (${roadClearance.toFixed(2)}m)`,
  );
}

for (let seed = 0; seed < 48; seed += 1) {
  const residence = createResidenceMesh(seed, 1);
  assert.equal(residence.userData.residenceRoof, 'brown');
  const forbiddenRoofMaterials = new Set<THREE.Material>();
  residence.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    let ancestor = object.parent;
    while (ancestor && ancestor !== residence) {
      if (ancestor.name === 'ResidenceUpgradeWorks') return;
      ancestor = ancestor.parent;
    }
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (/\b(?:clayRed|clayDark|slate)\b/.test(material.name)) {
        forbiddenRoofMaterials.add(material);
      }
    }
  });
  assert.equal(
    forbiddenRoofMaterials.size,
    0,
    `pre-tile residence seed ${seed} must contain only wood roof surfaces`,
  );

  const normalResidence = createResidenceMesh(seed, 1);
  assert.equal(
    normalResidence.userData.residenceRoof,
    pickResidenceAppearance(seed).roof,
    'wood-roof policy must preserve ordinary seeded gameplay appearances',
  );
}

const authoredHamlet = new THREE.Group();
const expectedResidenceCount = HAMLET_ZONE_SPECS.reduce(
  (sum, zone) => sum + zone.plotCount,
  0,
);
for (let index = 0; index < expectedResidenceCount; index += 1) {
  const seed = (0x1550_09a3 ^ Math.imul(index + 1, 0x45d9f3b)) >>> 0;
  const residence = createResidenceMesh(seed, 1);
  residence.position.set((index % 6) * 12, 0, Math.floor(index / 6) * 14);
  residence.rotation.y = index * 0.17;
  authoredHamlet.add(residence);
}
let authoredMeshCount = 0;
authoredHamlet.traverseVisible((object) => {
  if ((object as THREE.Mesh).isMesh) authoredMeshCount += 1;
});
const batchedHamlet = batchStaticFixtureMeshes(
  authoredHamlet,
  'Test fixture hamlet batch',
);
assert.equal(
  batchedHamlet.stats.sourceTriangles,
  batchedHamlet.stats.batchedTriangles,
  'static batching must preserve every authored triangle',
);
assert.equal(
  batchedHamlet.stats.sourceMeshes,
  authoredMeshCount,
  'all effectively visible immutable residence meshes must enter the fixture batch',
);
assert.ok(
  batchedHamlet.stats.batches <= Math.ceil(authoredMeshCount * 0.04),
  `batching should collapse ${authoredMeshCount} home draws, got ${batchedHamlet.stats.batches}`,
);
assert.ok(
  batchedHamlet.group.children.some((object) => (
    (object as THREE.Mesh).material?.name === 'Shared building material: shingle'
  )),
  'the batched 17-home fabric must retain its wooden shingle material',
);
assert.ok(
  batchedHamlet.group.children.every((object) => (
    !/\b(?:clayRed|clayDark|slate)\b/.test(
      ((object as THREE.Mesh).material as THREE.Material).name,
    )
  )),
  'fixture batching must not introduce a post-industry roof material',
);
assert.deepEqual(
  countFixtureStructuralSubmissions(batchedHamlet.group),
  {
    draws: batchedHamlet.stats.batches,
    triangles: batchedHamlet.stats.batchedTriangles,
  },
  'frame-local structural telemetry must report the batches actually submitted',
);

const fixtureSource = readFileSync('src/e2e/hamletFixture.ts', 'utf8');
const visualPerformanceHookSource = readFileSync(
  'src/e2e/visualPerformanceHooks.ts',
  'utf8',
);
assert.match(
  visualPerformanceHookSource,
  /stopFrameCollection: \(\) => stopFrameCollection\(\)/,
  'the profile-only fixture must be able to stop its normal collector before the bare-rAF arm',
);
assert.match(
  visualPerformanceHookSource,
  /stop: \(\) => \{\s*stopped = true;\s*if \(animationFrameId !== null\) \{\s*cancelAnimationFrame\(animationFrameId\);/,
  'stopping must cancel the already-scheduled profiler callback, not merely make its telemetry inert',
);
assert.match(
  fixtureSource,
  /const visualGpuTimestampMarkersEnabled =\s*params\.get\('visualGpuTimestampMarkers'\) !== '0';/,
  'timestamp marker submissions must stay enabled unless the profile-only query explicitly disables them',
);
assert.match(
  fixtureSource,
  /createVisualGpuTimestampProfiler\(rendererBackend, \{\s*submitTimestampMarkers: visualGpuTimestampMarkersEnabled,\s*\}\)/,
  'the marker-off query must flow only into WebGPU timestamp instrumentation',
);
assert.equal(
  fixtureSource.match(/visualGpuTimestampMarkersEnabled/g)?.length,
  2,
  'the marker control must not alter route, scene, render, vegetation, warmup, or collector behavior',
);
assert.match(
  fixtureSource,
  /const requestedVisualNoRender =\s*requestedVisualProfile && params\.get\('visualNoRender'\) === '1';/,
  'visualNoRender must remain inert unless the visual profile is explicitly requested',
);
assert.match(
  fixtureSource,
  /const requestedVisualNoUpdateShell = resolveHamletNoUpdateShellRequest\(\{[\s\S]*?requested: params\.get\('visualNoUpdateShell'\) === '1',[\s\S]*?visualBareRafPair: requestedVisualBareRafPair,/,
  'the no-update shell must be an explicit, validated, profile-only treatment',
);
assert.match(
  fixtureSource,
  /const requestedVisualDeferredDom = resolveHamletDeferredDomRequest\(\{\s*requested: params\.get\('visualDeferDom'\) === '1',\s*visualNoUpdateShell: requestedVisualNoUpdateShell,\s*\}\);/,
  'DOM deferral must be a separately explicit exact-shell control',
);
assert.match(
  fixtureSource,
  /requestedMotionRouteId !== HAMLET_MOTION_ROUTE_ID[\s\S]*?fixtureAblation\.id !== 'groundcover-stream-forest-update-frozen'/,
  'the no-render diagnostic must require the canonical route and the fully warmed frozen-vegetation arm',
);
assert.match(
  fixtureSource,
  /requestedVisualNoRender\s*\?\s*createUnavailableVisualGpuTimestampProfiler\(\s*VISUAL_GPU_NO_RENDER_CONTROL_LIMITATION,\s*\)\s*:\s*createVisualGpuTimestampProfiler/,
  'only the no-render profile must replace marker-on instrumentation with terminal unavailable evidence',
);
assert.match(
  fixtureSource,
  /function isNoRenderMeasuredWindowActive\(\): boolean \{\s*return requestedVisualNoRender\s*&& routeWarmupWork\.stage === 'complete'\s*&& document\.documentElement\.dataset\.visualProfileStatus === 'collecting';\s*\}/,
  'full route warmup and resettling must render before the no-render measured window begins',
);
for (const sharedSystem of [
  'RoadMeshBuilder',
  'RoadJunctionBuilder',
  'FarmFieldMarkers',
  'BurgageFencing',
  'createSeedThreeForest',
  'createGrassBladeField',
  'createBuildingMesh',
  'createResidenceMesh',
  'createPostProcessor',
  'SkyCloudMesh',
  'installVisualPerformanceHooksIfRequested',
]) {
  assert.ok(fixtureSource.includes(sharedSystem), `fixture must exercise ${sharedSystem}`);
}
for (const runtimeContract of [
  'getPointAt(',
  'getPointAtInto(',
  'setDirtZoomGate(',
  'startContinuousTick',
  'requestAnimationFrame',
  '__HAMLET_FIXTURE_MOTION_ROUTE__',
  '__HAMLET_FIXTURE_CAPTURE_VIEW__',
  '__HAMLET_FIXTURE_CAPTURE_MOTION__',
  '__HAMLET_FIXTURE_BOOT_STATE__',
  '__HAMLET_FIXTURE_WAIT_FOR_TERMINAL__',
  '__HAMLET_FIXTURE_DETAILED_TEXTURES_READY__',
  '__HAMLET_FIXTURE_FULL_VISUAL_SYSTEMS_READY__',
  '__HAMLET_FIXTURE_FOREST_WORK__',
  '__HAMLET_FIXTURE_GROUNDCOVER_WORK__',
  '__HAMLET_FIXTURE_COMPLETED_ROUTES__',
  '__HAMLET_FIXTURE_ROUTE_WARMUP__',
  '__HAMLET_FIXTURE_ABLATION__',
  '__HAMLET_FIXTURE_EVIDENCE__',
  '__HAMLET_FIXTURE_GET_EVIDENCE__',
  'hamletFixtureEvidence',
  'resolveHamletFixtureAblation',
  'canFinalizeHamletFixtureEvidence',
  'updateSeedThreeForestCameraBudgeted',
  'primeAndFreezeStream',
  'forestUpdatesFrozenForMeasurement',
  'frozen-after-settled-warmup',
  'forestUpdatePendingBucketsAtFreeze',
  'restartTrace()',
  'armTraceAfterCurrentFrame()',
  'resetMeasuredRouteTelemetry',
  'advanceHamletFixtureRouteWarmupDrain',
  'waitForBootStage',
  'createVisualGpuTimestampProfiler',
  'getVisualGpuFrameTiming',
  'getVisualGpuTimingEvidence',
]) {
  assert.ok(
    fixtureSource.includes(runtimeContract),
    `fixture must expose or implement ${runtimeContract}`,
  );
}
assert.doesNotMatch(fixtureSource, /await\s+(?:sky\.ready|roadTexturesReady|skyPerlinPromise)/);
assert.doesNotMatch(
  fixtureSource,
  /SettlementCrowdRenderer|VillagerRenderer/,
  'fixture should not instantiate people renderers',
);
assert.match(
  fixtureSource,
  /routeWarmupWork\.stage === 'resettling'[\s\S]*?startMotionRoute\(0, true\)\s*\)\s*\{\s*visualPerf\.armTraceAfterCurrentFrame\(\);\s*routeWarmupWork\.stage = 'complete';/,
  'the route-zero seek/render callback must arm collection only after that callback completes',
);
assert.match(
  fixtureSource,
  /const tick = \(nowMs: number\): void => \{[\s\S]*?if \(bareRafControlCollecting\) \{[\s\S]*?bareRafCapture\?\.appendRafTimestamp\(nowMs\)[\s\S]*?return;\s*\}\s*const frameCpuStartedAtMs = requestedVisualProfile \? performance\.now\(\) : null;/,
  'the paired bare-rAF branch must run before every route, scene, render, DOM, and CPU-timing operation',
);
assert.match(
  fixtureSource,
  /runUuid: crypto\.randomUUID\(\),\s*performanceTimeOriginMs: performance\.timeOrigin,/,
  'both paired arms must carry one document-local UUID and performance time origin',
);
assert.match(
  fixtureSource,
  /degradedNoRenderArm = \{[\s\S]*?\.\.\.performancePairIdentity,[\s\S]*?arm: 'degraded-no-render',[\s\S]*?window\.__visualPerf\?\.stopFrameCollection\(\);\s*bareRafControlCollecting = true;/,
  'the bare-rAF arm must begin only after the exact degraded report is frozen and its collector is stopped',
);
assert.match(
  fixtureSource,
  /const \{ leadIn, bareRaf \} = capture;[\s\S]*?schemaVersion: 2,[\s\S]*?transitionGapMs:\s*bareRaf\.startedAtRafTimestampMs[\s\S]*?leadInStartGapMs:\s*leadIn\.startedAtRafTimestampMs[\s\S]*?leadInToBareRafGapMs:\s*bareRaf\.startedAtRafTimestampMs\s*- leadIn\.completedAtRafTimestampMs,[\s\S]*?bareRafLeadIn: leadIn,[\s\S]*?bareRaf,/,
  'paired evidence must serialize the callback-only lead-in before the fresh judged arm',
);
assert.match(
  fixtureSource,
  /const bareRafCapture = performancePairIdentity\s*\? createHamletBareRafCapture\(performancePairIdentity\)\s*: null;/,
  'the lead-in and judged collector must remain absent from the default fixture',
);
assert.match(
  fixtureSource,
  /const noUpdateShellCapture = noUpdateShellIdentity\s*\? createHamletNoUpdateShellCapture\(noUpdateShellIdentity, \{\s*deferCohortDomPublication: requestedVisualDeferredDom,\s*\}\)\s*: null;/,
  'the no-update lead-in and ordered cohort must remain absent from the default fixture',
);
const bareRafTickBranch = fixtureSource.slice(
  fixtureSource.indexOf('if (bareRafControlCollecting) {'),
  fixtureSource.indexOf(
    'const frameCpuStartedAtMs = requestedVisualProfile ? performance.now() : null;',
  ),
);
for (const forbiddenBareRafWork of [
  'updateSceneLods(',
  'render(',
  'publishMotionState(',
  'performance.now(',
  'dataset.',
  'metricsElement',
]) {
  assert.ok(
    !bareRafTickBranch.includes(forbiddenBareRafWork),
    `bare-rAF hot path must exclude ${forbiddenBareRafWork}`,
  );
}
const noUpdateShellTickBranch = fixtureSource.slice(
  fixtureSource.indexOf('if (\n      requestedVisualNoUpdateShell'),
  fixtureSource.indexOf(
    'const dtMs = previousTickNowMs === 0',
  ),
);
for (const skippedNoUpdateShellWork of [
  'sampleHamletMotionRoute(',
  'updateSceneLods(',
  'advanceRouteWarmupProtocol(',
  'sky.updateCamera(',
  'sky.updateSun(',
  'sky.updateTime(',
  'postProcessor.render(',
]) {
  assert.ok(
    !noUpdateShellTickBranch.includes(skippedNoUpdateShellWork),
    `the no-update shell must skip ${skippedNoUpdateShellWork}`,
  );
}
for (const retainedNoUpdateShellWork of [
  'appendRafTimestamp(nowMs)',
  'armTraceAfterCurrentFrame()',
  'render(',
  'performance.now()',
  'latestProfileFrameTiming',
]) {
  assert.ok(
    noUpdateShellTickBranch.includes(retainedNoUpdateShellWork),
    `the no-update shell must retain ${retainedNoUpdateShellWork}`,
  );
}
assert.doesNotMatch(
  noUpdateShellTickBranch,
  /dataset\.|metricsElement/,
  'the deferred cohort branch must not directly mutate status datasets or metrics text',
);
assert.match(
  fixtureSource,
  /const frameCpuStartedAtMs = requestedVisualProfile \? performance\.now\(\) : null;\s*motionAnimationFrame = requestAnimationFrame\(tick\);\s*if \(\s*requestedVisualNoUpdateShell/,
  'the treatment must retain the ordinary profiled callback clock and rAF scheduler',
);
assert.match(
  fixtureSource,
  /const controlStep = noUpdateShellCapture\.appendRafTimestamp\(nowMs\);[\s\S]*?controlStep\.armCollectorAfterCurrentFrame[\s\S]*?window\.__visualPerf\?\.deferDomPublicationUntilReady\(\);[\s\S]*?window\.__visualPerf\?\.armTraceAfterCurrentFrame\(\);[\s\S]*?const frameBeforeRenderAtMs = performance\.now\(\);[\s\S]*?render\(\s*0,\s*true,\s*nowMs,\s*true,\s*\)[\s\S]*?latestProfileFrameTiming = \{/,
  'the terminal lead-in callback must reset the retained schema-5 collector before a no-render profiled cohort',
);
assert.match(
  fixtureSource,
  /function publishNoUpdateShellStatus\(status: string\): void \{\s*if \(requestedVisualDeferredDom\) return;\s*document\.documentElement\.dataset\.visualNoUpdateShellStatus = status;\s*\}/,
  'all shell status datasets must be suppressed by the explicit deferred treatment',
);
assert.match(
  fixtureSource,
  /maybeFinalizeFixtureEvidence\(\);\s*if \(!deferredDomCohortActive \|\| finalizedFixtureEvidence\) \{\s*metricsElement!\.textContent = /,
  'metrics text must remain unchanged throughout the deferred cohort and publish only after finalization',
);
assert.match(
  fixtureSource,
  /const performanceReport = window\.__visualPerf\?\.getReport\(\) \?\? null;[\s\S]*?performanceReport\?\.status !== 'ready'/,
  'terminal evidence must follow the in-memory frozen report instead of a cohort-time dataset',
);
assert.match(
  fixtureSource,
  /canFinalizeHamletNoUpdateShellEvidence\([\s\S]*?noUpdateShellCaptureReport,[\s\S]*?collectorAgreement: \{[\s\S]*?schemaVersion: 5,[\s\S]*?exactSampleCount: true,[\s\S]*?exactMetrics: true,[\s\S]*?zeroRendererSubmissions: true,/,
  'final evidence must require the complete independent cohort to agree with schema 5',
);
assert.match(
  visualPerformanceHookSource,
  /if \(traceArmingBoundary\.consumeCompletedFrame\(\)\) \{[\s\S]*?resetTrace\('collecting'\);[\s\S]*?traceArmed = true;/,
  'arming after the lead-in must clear every pre-treatment collector interval',
);
assert.match(
  visualPerformanceHookSource,
  /const domPublication = domPublicationGate\.accept\(report\);\s*setLatestReport\(report\);\s*lifecycleStatus = report\.status;\s*if \(!domPublication\.publishToDom\) return;[\s\S]*?dataset\.visualProfileReport = domPublication\.serializedReport;/,
  '500ms reports and JSON must be constructed in memory before any gated DOM publication',
);
assert.match(
  visualPerformanceHookSource,
  /deferDomPublicationUntilReady: domPublicationGate\.deferUntilReady,\s*getDomPublicationEvidence: domPublicationGate\.getEvidence,/,
  'the exact shell must be able to arm terminal-only publication without changing collector scheduling',
);
assert.match(
  fixtureSource,
  /latestProfileFrameTiming = \{[\s\S]*?frameRafTimestampMs: nowMs,[\s\S]*?frameCallbackEntryTimestampMs: frameCpuStartedAtMs,/,
  'schema-5 callback entry identity must reuse the existing profile-only performance.now sample',
);
assert.match(
  fixtureSource,
  /if \(frameCpuStartedAtMs === null\) \{\s*render\(dtMs \/ 1000\);\s*return;\s*\}\s*const frameBeforeRenderAtMs = performance\.now\(\);\s*const frameAfterProfileRenderPathAtMs = render\(\s*dtMs \/ 1000,\s*true,\s*nowMs,\s*isNoRenderMeasuredWindowActive\(\),\s*\)!;[\s\S]*?const frameCpuCompletedAtMs = performance\.now\(\);/,
  'the two added callback boundaries must run only on the visual-profile path',
);
assert.match(
  fixtureSource,
  /if \(!profileRenderSubmission\) \{\s*postProcessor\.render\(dt\);\s*postProcessorRendered = true;\s*\} else if \(!skipProfilePostProcessorRender\) \{[\s\S]*?visualGpuTimestampProfiler\?\.beginFrame\(profileFrameRafTimestampMs\)[\s\S]*?try \{\s*postProcessor\.render\(dt\);\s*postProcessorRendered = true;\s*renderPathCompletedAtMs = performance\.now\(\);[\s\S]*?visualGpuTimestampProfiler\?\.endFrame\(gpuTimestampHandle\);[\s\S]*?\} else \{\s*const result = executeVisualProfileRenderPath\(\{[\s\S]*?skipPostProcessorRender: true,[\s\S]*?postProcessorRender: \(renderDt\) => postProcessor\.render\(renderDt\),[\s\S]*?gpuTimestampProfiler: visualGpuTimestampProfiler,[\s\S]*?now: \(\) => performance\.now\(\),/,
  'default and marker-on rendering must remain direct while only the no-render treatment enters the isolated skip path',
);
assert.match(
  fixtureSource,
  /frameUpdatePreRenderDurationMs: Math\.max\([\s\S]*?frameBeforeRenderAtMs - frameCpuStartedAtMs[\s\S]*?frameRenderSubmissionDurationMs: Math\.max\([\s\S]*?frameAfterProfileRenderPathAtMs - frameBeforeRenderAtMs[\s\S]*?framePostRenderDurationMs: Math\.max\([\s\S]*?frameCpuCompletedAtMs - frameAfterProfileRenderPathAtMs/,
  'schema-5 subspans must partition update, the selected render path, and post-render callback work',
);
const continuousTickSource = fixtureSource.slice(
  fixtureSource.indexOf('function startContinuousTick(): void'),
  fixtureSource.indexOf('function render('),
);
const profiledRenderSource = fixtureSource.slice(
  fixtureSource.indexOf('function render('),
  fixtureSource.indexOf('function isHamletViewId'),
);
assert.equal(
  continuousTickSource.match(/performance\.now\(\)/g)?.length,
  5,
  'both mutually exclusive profiled paths must reuse one callback entry sample and add only pre-render and completion boundaries',
);
assert.equal(
  profiledRenderSource.match(/performance\.now\(\)/g)?.length,
  2,
  'the mutually exclusive marker-on and no-render branches must each sample one render-path boundary',
);
assert.match(
  fixtureSource,
  /const timing = latestProfileFrameTiming;\s*if \(\s*timing\?\.frameRafTimestampMs !== frameTimestampMs\s*\|\| visualGpuTimestampProfiler === null\s*\) \{\s*return null;/,
  'slow-frame context must reject CPU/GPU timing from a different or uninstrumented rAF timestamp',
);
const packageSource = readFileSync('package.json', 'utf8');
const runAllSource = readFileSync('scripts/run-all-tests.mts', 'utf8');
assert.ok(packageSource.includes('"test:hamlet-fixture"'));
assert.ok(runAllSource.includes("'test:hamlet-fixture'"));

console.log(
  `hamlet fixture tests passed (${HAMLET_VIEW_IDS.length} views, `
  + `${HAMLET_ZONE_SPECS.reduce((sum, zone) => sum + zone.plotCount, 0)} wood-roof residences, `
  + `${HAMLET_FIELD_SPECS.length} fields)`,
);

function distanceToSegment(
  point: readonly [number, number],
  start: readonly [number, number],
  end: readonly [number, number],
): number {
  const dx = end[0] - start[0];
  const dz = end[1] - start[1];
  const lengthSquared = dx * dx + dz * dz;
  const t = lengthSquared <= 1e-6
    ? 0
    : Math.max(0, Math.min(1, (
      (point[0] - start[0]) * dx + (point[1] - start[1]) * dz
    ) / lengthSquared));
  return Math.hypot(
    point[0] - (start[0] + dx * t),
    point[1] - (start[1] + dz * t),
  );
}
