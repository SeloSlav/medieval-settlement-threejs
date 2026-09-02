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
  auditHamletRouteLodSkyDirectRenderCollector,
  HAMLET_ABLATION_IDS,
  HAMLET_BARE_RAF_LEAD_IN_MS,
  HAMLET_BARE_RAF_WINDOW_MS,
  HAMLET_DEFERRED_DOM_NO_UPDATE_SHELL_TREATMENT,
  HAMLET_DEGRADED_NO_RENDER_DISABLED_SUBSYSTEMS,
  HAMLET_FOREST_ROUTE_WORK_BUDGET,
  HAMLET_FROZEN_UPDATE_DIRECT_RENDER_TREATMENT,
  HAMLET_NO_UPDATE_SHELL_LEAD_IN_MS,
  HAMLET_NO_UPDATE_SHELL_TREATMENT,
  HAMLET_NO_UPDATE_SHELL_WINDOW_MS,
  HAMLET_PERFORMANCE_VIEWPORT,
  HAMLET_ROUTE_FOREST_RENDERER_DISABLED,
  HAMLET_ROUTE_FOREST_RENDERER_ENABLED,
  HAMLET_ROUTE_LOD_SKY_DIRECT_RENDER_TREATMENT,
  HAMLET_ROUTE_SEQUENCE_CAPTURE_FPS,
  HAMLET_ROUTE_SHADOW_SUBSYSTEM_DISABLED,
  HAMLET_ROUTE_SHADOW_SUBSYSTEM_ENABLED,
  HAMLET_ROUTE_UPDATE_PAIR_EXPERIMENT,
  advanceHamletFixtureRouteWarmupDrain,
  canFinalizeHamletFixtureEvidence,
  canFinalizeHamletFrozenUpdateDirectRenderEvidence,
  canFinalizeHamletNoUpdateShellEvidence,
  canFinalizeHamletRouteLodSkyDirectRenderEvidence,
  canFinalizeHamletRouteUpdatePairArmEvidence,
  createHamletBareRafCapture,
  createHamletDomPublicationPairCoordinator,
  createHamletFixtureEvidenceEnvelope,
  createHamletFrozenUpdateDirectRenderCapture,
  createHamletFrozenUpdateDirectRenderEvidence,
  createHamletNoUpdateShellCapture,
  createHamletRouteFrameSequenceDescriptor,
  createHamletRouteLodSkyDirectRenderCapture,
  createHamletRouteLodSkyDirectRenderEvidence,
  createHamletRouteUpdatePairCoordinator,
  doesHamletFrozenUpdateDirectRenderMatchCollector,
  doesHamletNoUpdateShellMatchCollector,
  doesHamletRouteLodSkyDirectRenderMatchCollector,
  resolveHamletBareRafPairRequest,
  resolveHamletDeferredDomRequest,
  resolveHamletDomPublicationPairOrder,
  resolveHamletDomPublicationPairRequest,
  resolveHamletForestUpdateAblationTelemetry,
  resolveHamletFixtureAblation,
  resolveHamletFrozenUpdateDirectRenderRequest,
  resolveHamletNoUpdateShellRequest,
  resolveHamletPerformanceProtocol,
  resolveHamletRouteFrameSequenceDomRequest,
  resolveHamletRouteFrameSequenceElapsedMs,
  resolveHamletRouteLodSkyDirectRenderRequest,
  resolveHamletRouteUpdatePairOrder,
  resolveHamletRouteUpdatePairRequest,
  type HamletRouteLodSkyFrameUpdate,
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
assert.equal(residenceView.fov, 39.8);
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
assert.equal(
  HAMLET_FROZEN_UPDATE_DIRECT_RENDER_TREATMENT,
  'profiled-frozen-update-direct-color-render',
);
assert.equal(
  HAMLET_ROUTE_LOD_SKY_DIRECT_RENDER_TREATMENT,
  'profiled-canonical-route-lod-scene-sky-direct-color-render',
);
assert.equal(HAMLET_ROUTE_SEQUENCE_CAPTURE_FPS, 30);
const routeFrameSequenceDescriptor =
  createHamletRouteFrameSequenceDescriptor();
assert.deepEqual(routeFrameSequenceDescriptor, {
  schemaVersion: 1,
  routeId: HAMLET_MOTION_ROUTE_ID,
  durationMs: HAMLET_MOTION_ROUTE.durationMs,
  framesPerSecond: 30,
  frameCount: 631,
  ordering: 'frame-index-ascending',
  renderer: 'direct-color-scene',
  vegetation:
    'frozen-groundcover-forest-work-with-forest-render-disabled',
  forestRenderer: HAMLET_ROUTE_FOREST_RENDERER_DISABLED,
  forestUpdates: 'frozen-after-settled-warmup',
  postProcessing: 'disabled',
  shadowSubsystem: HAMLET_ROUTE_SHADOW_SUBSYSTEM_DISABLED,
  signature:
    'gorski-kotar-lod-traverse-v1|21000ms|30fps|631frames|direct-color|frozen-vegetation|forest-post-shadows-off',
});
assert.deepEqual(
  createHamletRouteFrameSequenceDescriptor(
    HAMLET_ROUTE_SHADOW_SUBSYSTEM_ENABLED,
  ),
  {
    ...routeFrameSequenceDescriptor,
    shadowSubsystem: HAMLET_ROUTE_SHADOW_SUBSYSTEM_ENABLED,
    signature:
      'gorski-kotar-lod-traverse-v1|21000ms|30fps|631frames|direct-color|frozen-vegetation|forest-post-disabled-shadows-on',
  },
  'the shadow-on route sequence must carry a distinct auditable signature',
);
assert.deepEqual(
  createHamletRouteFrameSequenceDescriptor(
    HAMLET_ROUTE_SHADOW_SUBSYSTEM_ENABLED,
    HAMLET_ROUTE_FOREST_RENDERER_ENABLED,
  ),
  {
    ...routeFrameSequenceDescriptor,
    vegetation:
      'frozen-groundcover-and-forest-update-work-with-forest-render-enabled',
    forestRenderer: HAMLET_ROUTE_FOREST_RENDERER_ENABLED,
    shadowSubsystem: HAMLET_ROUTE_SHADOW_SUBSYSTEM_ENABLED,
    signature:
      'gorski-kotar-lod-traverse-v1|21000ms|30fps|631frames|direct-color|groundcover-and-forest-updates-frozen|forest-render-on|post-disabled|shadows-on',
  },
  'the forest-on route sequence must explicitly retain frozen updates, post off, and shadows on',
);
assert.throws(
  () => createHamletRouteFrameSequenceDescriptor(
    HAMLET_ROUTE_SHADOW_SUBSYSTEM_DISABLED,
    HAMLET_ROUTE_FOREST_RENDERER_ENABLED,
  ),
  /requires the existing shadow subsystem/,
  'the Round 47 forest restoration must not silently disable existing shadows',
);
assert.equal(resolveHamletRouteFrameSequenceElapsedMs(0), 0);
assert.equal(resolveHamletRouteFrameSequenceElapsedMs(315), 10_500);
assert.equal(resolveHamletRouteFrameSequenceElapsedMs(630), 21_000);
assert.throws(
  () => resolveHamletRouteFrameSequenceElapsedMs(631),
  /integer from 0 to 630/,
  'the deterministic sequence hook must reject frames outside its manifest',
);
assert.equal(resolveHamletRouteFrameSequenceDomRequest(null), null);
assert.equal(resolveHamletRouteFrameSequenceDomRequest('0'), 0);
assert.equal(resolveHamletRouteFrameSequenceDomRequest('315'), 315);
assert.equal(resolveHamletRouteFrameSequenceDomRequest('630'), 630);
assert.equal(
  resolveHamletRouteFrameSequenceDomRequest('315'),
  315,
  'clearing the terminal control must permit the same canonical index again',
);
for (const invalidDomRequest of [
  '',
  '01',
  '1.5',
  '-1',
  ' 1',
  '1 ',
  '631',
]) {
  assert.throws(
    () => resolveHamletRouteFrameSequenceDomRequest(invalidDomRequest),
    /canonical integer index|integer from 0 to 630/,
    `the DOM replay bridge must reject ${JSON.stringify(invalidDomRequest)}`,
  );
}
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
  resolveHamletFrozenUpdateDirectRenderRequest({
    requested: false,
    visualProfile: false,
    visualNoRender: false,
    visualBareRafPair: false,
    visualNoUpdateShell: false,
    gpuTimestampMarkersEnabled: true,
    routeId: null,
    ablationId: 'baseline',
    disabledSubsystems: [],
  }),
  false,
  'the frozen-update direct render must remain absent by default',
);
assert.equal(
  resolveHamletFrozenUpdateDirectRenderRequest({
    requested: true,
    visualProfile: true,
    visualNoRender: false,
    visualBareRafPair: false,
    visualNoUpdateShell: false,
    gpuTimestampMarkersEnabled: true,
    routeId: HAMLET_MOTION_ROUTE_ID,
    ablationId: 'groundcover-stream-forest-update-frozen',
    disabledSubsystems: ['shadows', 'forest', 'post'],
  }),
  true,
  'the exact frozen-update render-on treatment must be accepted',
);
for (const invalidDirectRender of [
  {
    visualProfile: false,
    visualNoRender: false,
    visualBareRafPair: false,
    visualNoUpdateShell: false,
    gpuTimestampMarkersEnabled: true,
    disabledSubsystems: ['forest', 'post', 'shadows'],
  },
  {
    visualProfile: true,
    visualNoRender: true,
    visualBareRafPair: false,
    visualNoUpdateShell: false,
    gpuTimestampMarkersEnabled: true,
    disabledSubsystems: ['forest', 'post', 'shadows'],
  },
  {
    visualProfile: true,
    visualNoRender: false,
    visualBareRafPair: false,
    visualNoUpdateShell: false,
    gpuTimestampMarkersEnabled: false,
    disabledSubsystems: ['forest', 'post', 'shadows'],
  },
  {
    visualProfile: true,
    visualNoRender: false,
    visualBareRafPair: false,
    visualNoUpdateShell: false,
    gpuTimestampMarkersEnabled: true,
    disabledSubsystems: ['forest', 'post'],
  },
]) {
  assert.throws(
    () => resolveHamletFrozenUpdateDirectRenderRequest({
      requested: true,
      ...invalidDirectRender,
      routeId: HAMLET_MOTION_ROUTE_ID,
      ablationId: 'groundcover-stream-forest-update-frozen',
    }),
    /one exact render-on treatment/,
    'the direct-render rung must reject every workload or instrumentation drift',
  );
}
assert.equal(
  resolveHamletRouteLodSkyDirectRenderRequest({
    requested: false,
    visualProfile: false,
    visualNoRender: false,
    visualBareRafPair: false,
    visualNoUpdateShell: false,
    visualFrozenDirectRender: false,
    gpuTimestampMarkersEnabled: true,
    routeId: null,
    ablationId: 'baseline',
    disabledSubsystems: [],
  }),
  false,
  'the route/LOD/sky render treatment must remain absent by default',
);
assert.equal(
  resolveHamletRouteLodSkyDirectRenderRequest({
    requested: true,
    visualProfile: true,
    visualNoRender: false,
    visualBareRafPair: false,
    visualNoUpdateShell: false,
    visualFrozenDirectRender: false,
    gpuTimestampMarkersEnabled: true,
    routeId: HAMLET_MOTION_ROUTE_ID,
    ablationId: 'groundcover-stream-forest-update-frozen',
    disabledSubsystems: ['post', 'shadows', 'forest'],
  }),
  true,
  'the one exact canonical route/LOD/scene/sky treatment must be accepted',
);
assert.equal(
  resolveHamletRouteLodSkyDirectRenderRequest({
    requested: true,
    visualProfile: true,
    visualNoRender: false,
    visualBareRafPair: false,
    visualNoUpdateShell: false,
    visualFrozenDirectRender: false,
    gpuTimestampMarkersEnabled: true,
    routeId: HAMLET_MOTION_ROUTE_ID,
    ablationId: 'groundcover-stream-forest-update-frozen',
    disabledSubsystems: ['post', 'forest'],
  }),
  true,
  'the controlled shadow restoration may enable only the existing shadow subsystem',
);
assert.equal(
  resolveHamletRouteLodSkyDirectRenderRequest({
    requested: true,
    visualProfile: true,
    visualNoRender: false,
    visualBareRafPair: false,
    visualNoUpdateShell: false,
    visualFrozenDirectRender: false,
    gpuTimestampMarkersEnabled: true,
    routeId: HAMLET_MOTION_ROUTE_ID,
    ablationId: 'groundcover-stream-forest-update-frozen',
    disabledSubsystems: ['post'],
  }),
  true,
  'the controlled forest restoration may enable only the existing forest renderer while retaining shadows',
);
for (const invalidRouteLodSkyDirectRender of [
  {
    visualProfile: false,
    visualNoRender: false,
    visualBareRafPair: false,
    visualNoUpdateShell: false,
    visualFrozenDirectRender: false,
    gpuTimestampMarkersEnabled: true,
    disabledSubsystems: ['forest', 'post', 'shadows'],
  },
  {
    visualProfile: true,
    visualNoRender: false,
    visualBareRafPair: false,
    visualNoUpdateShell: false,
    visualFrozenDirectRender: true,
    gpuTimestampMarkersEnabled: true,
    disabledSubsystems: ['forest', 'post', 'shadows'],
  },
  {
    visualProfile: true,
    visualNoRender: false,
    visualBareRafPair: false,
    visualNoUpdateShell: false,
    visualFrozenDirectRender: false,
    gpuTimestampMarkersEnabled: false,
    disabledSubsystems: ['forest', 'post', 'shadows'],
  },
  {
    visualProfile: true,
    visualNoRender: false,
    visualBareRafPair: false,
    visualNoUpdateShell: false,
    visualFrozenDirectRender: false,
    gpuTimestampMarkersEnabled: true,
    disabledSubsystems: ['post', 'shadows'],
  },
]) {
  assert.throws(
    () => resolveHamletRouteLodSkyDirectRenderRequest({
      requested: true,
      ...invalidRouteLodSkyDirectRender,
      routeId: HAMLET_MOTION_ROUTE_ID,
      ablationId: 'groundcover-stream-forest-update-frozen',
    }),
    /one exact route-update treatment/,
    'the route/LOD/sky rung must reject every workload or control drift',
  );
}
assert.equal(
  resolveHamletRouteUpdatePairRequest({
    requested: false,
    visualProfile: false,
    visualNoRender: false,
    visualBareRafPair: false,
    visualNoUpdateShell: false,
    visualFrozenDirectRender: false,
    visualRouteLodSkyDirectRender: false,
    gpuTimestampMarkersEnabled: true,
    routeId: null,
    ablationId: 'baseline',
    disabledSubsystems: [],
  }),
  false,
  'the route-update pair must remain absent by default',
);
assert.equal(
  resolveHamletRouteUpdatePairRequest({
    requested: true,
    visualProfile: true,
    visualNoRender: false,
    visualBareRafPair: false,
    visualNoUpdateShell: false,
    visualFrozenDirectRender: false,
    visualRouteLodSkyDirectRender: false,
    gpuTimestampMarkersEnabled: true,
    routeId: HAMLET_MOTION_ROUTE_ID,
    ablationId: 'groundcover-stream-forest-update-frozen',
    disabledSubsystems: ['post', 'forest', 'shadows'],
  }),
  true,
  'the exact same-document route-update pair must be explicitly accepted',
);
assert.throws(
  () => resolveHamletRouteUpdatePairRequest({
    requested: true,
    visualProfile: true,
    visualNoRender: false,
    visualBareRafPair: false,
    visualNoUpdateShell: false,
    visualFrozenDirectRender: true,
    visualRouteLodSkyDirectRender: false,
    gpuTimestampMarkersEnabled: true,
    routeId: HAMLET_MOTION_ROUTE_ID,
    ablationId: 'groundcover-stream-forest-update-frozen',
    disabledSubsystems: ['forest', 'post', 'shadows'],
  }),
  /one exact paired treatment/,
  'the pair must reject every fixed-arm control',
);
assert.deepEqual(
  resolveHamletRouteUpdatePairOrder(0),
  [
    HAMLET_FROZEN_UPDATE_DIRECT_RENDER_TREATMENT,
    HAMLET_ROUTE_LOD_SKY_DIRECT_RENDER_TREATMENT,
  ],
);
assert.deepEqual(
  resolveHamletRouteUpdatePairOrder(0xffff_ffff),
  [
    HAMLET_ROUTE_LOD_SKY_DIRECT_RENDER_TREATMENT,
    HAMLET_FROZEN_UPDATE_DIRECT_RENDER_TREATMENT,
  ],
);
assert.throws(
  () => resolveHamletRouteUpdatePairOrder(-1),
  /unsigned 32-bit draw/,
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
assert.equal(
  resolveHamletDomPublicationPairRequest({
    requested: false,
    visualNoUpdateShell: false,
    visualDeferDom: false,
  }),
  false,
  'the randomized DOM pair must remain absent from the default fixture',
);
assert.equal(
  resolveHamletDomPublicationPairRequest({
    requested: true,
    visualNoUpdateShell: true,
    visualDeferDom: false,
  }),
  true,
  'the randomized pair must own both treatments inside the exact shell',
);
assert.throws(
  () => resolveHamletDomPublicationPairRequest({
    requested: true,
    visualNoUpdateShell: true,
    visualDeferDom: true,
  }),
  /owns both publication treatments/,
  'a fixed deferred treatment must not contaminate randomized pair order',
);
assert.deepEqual(
  resolveHamletDomPublicationPairOrder(0),
  [
    HAMLET_NO_UPDATE_SHELL_TREATMENT,
    HAMLET_DEFERRED_DOM_NO_UPDATE_SHELL_TREATMENT,
  ],
  'an even cryptographic draw must serialize DOM-on then deferred-DOM',
);
assert.deepEqual(
  resolveHamletDomPublicationPairOrder(0xffff_ffff),
  [
    HAMLET_DEFERRED_DOM_NO_UPDATE_SHELL_TREATMENT,
    HAMLET_NO_UPDATE_SHELL_TREATMENT,
  ],
  'an odd cryptographic draw must serialize deferred-DOM then DOM-on',
);
assert.throws(
  () => resolveHamletDomPublicationPairOrder(0x1_0000_0000),
  /unsigned 32-bit draw/,
  'pair order must reject a substituted or lossy random value',
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

const frozenDirectRenderCapture =
  createHamletFrozenUpdateDirectRenderCapture(pairIdentity);
let frozenDirectRenderTimestampMs = 10_000;
frozenDirectRenderCapture.appendRafTimestamp(
  frozenDirectRenderTimestampMs,
);
for (const frameTimeMs of expectedNoUpdateLeadInFrameTimesMs) {
  frozenDirectRenderTimestampMs += frameTimeMs;
  frozenDirectRenderCapture.appendRafTimestamp(
    frozenDirectRenderTimestampMs,
  );
}
frozenDirectRenderTimestampMs += 10;
frozenDirectRenderCapture.appendRafTimestamp(
  frozenDirectRenderTimestampMs,
);
for (const frameTimeMs of expectedNoUpdateShellFrameTimesMs) {
  frozenDirectRenderTimestampMs += frameTimeMs;
  frozenDirectRenderCapture.appendRafTimestamp(
    frozenDirectRenderTimestampMs,
  );
}
const frozenDirectRenderCaptureReport =
  frozenDirectRenderCapture.getReport();
assert.ok(frozenDirectRenderCaptureReport);
assert.equal(frozenDirectRenderCaptureReport.leadIn.elapsedMs, 250);
assert.deepEqual(
  frozenDirectRenderCaptureReport.leadIn.frameTimesMs,
  expectedNoUpdateLeadInFrameTimesMs,
  'render-on lead-in isolation must preserve its complete ordered intervals',
);
assert.deepEqual(
  frozenDirectRenderCaptureReport.judgedCohort.frameTimesMs,
  expectedNoUpdateShellFrameTimesMs,
  'render-on evidence must retain the exact ordered 30-second cohort',
);
assert.deepEqual(
  frozenDirectRenderCaptureReport.judgedCohort.skippedWork,
  {
    motionRouteUpdates: 0,
    lodSceneUpdates: 0,
    skyUpdates: 0,
  },
  'the render-on treatment must skip only route, LOD, and sky updates',
);
assert.deepEqual(
  frozenDirectRenderCaptureReport.judgedCohort.retainedRender,
  {
    mode: 'direct-color-scene',
    submission: 'renderer.render(scene,camera)',
    postProcessing: false,
  },
  'the treatment must explicitly retain one direct-color scene submission',
);
assert.deepEqual(
  frozenDirectRenderCaptureReport.judgedCohort.retainedShell,
  {
    schemaVersion: 5,
    rafScheduling: 'requestAnimationFrame',
    collector: 'visual-performance-hooks',
    postamble: 'telemetry-evidence-dom',
    gpuTimestamp: 'required-when-supported',
  },
  'the direct renderer must retain schema-5 and GPU timestamp instrumentation',
);

function createZeroWorkRouteLodSkyFrameUpdate(
  routeClockMs: number,
): HamletRouteLodSkyFrameUpdate {
  const routeCycle = Math.floor(
    routeClockMs / HAMLET_MOTION_ROUTE.durationMs,
  );
  const routeElapsedMs =
    routeClockMs % HAMLET_MOTION_ROUTE.durationMs;
  const sample = sampleHamletMotionRoute(routeElapsedMs);
  const phase = resolveHamletBuildingLodBand(sample.distanceMeters);
  return {
    routeId: HAMLET_MOTION_ROUTE_ID,
    routeStatus: 'running',
    routeElapsedMs,
    routeCycle,
    phase,
    lod: {
      forest: sample.distanceMeters
          <= HAMLET_MOTION_ROUTE.lodBands.forest.nearDistanceMeters
        ? 'near'
        : 'overview',
      groundcover: sample.distanceMeters
          <= HAMLET_MOTION_ROUTE.lodBands.groundcover.fullDetailMeters
        ? 'full'
        : sample.distanceMeters
            <= HAMLET_MOTION_ROUTE.lodBands.groundcover.transitionStartMeters
          ? 'transition'
          : 'hidden',
      building: phase,
    },
    forest: {
      selectionChanged: false,
      selectorSkipped: true,
      workChunks: 0,
      matrixWrites: 0,
      bucketUploads: 0,
      pendingBuckets: 0,
    },
    groundcoverDelta: {
      generationSubsteps: 0,
      clearWriteSubsteps: 0,
      refreshes: 0,
      gpuFlagUpdates: 0,
      gpuUpdateRanges: 0,
      bytesUploaded: 0,
      wildflowerLodCompactions: 0,
      wildflowerLodGpuFlagUpdates: 0,
      wildflowerLodGpuUpdateRanges: 0,
      wildflowerLodBytesUploaded: 0,
      wildflowerLodReclassifications: 0,
      completedSlots: 0,
      cancelledSlots: 0,
      pendingSlots: 0,
    },
  };
}

const routeLodSkyDirectRenderCapture =
  createHamletRouteLodSkyDirectRenderCapture(pairIdentity);
let routeLodSkyDirectRenderTimestampMs = 20_000;
let routeLodSkyDirectRenderClockMs = 0;
const appendRouteLodSkyDirectRenderFrame = () => {
  const step = routeLodSkyDirectRenderCapture.appendRafTimestamp(
    routeLodSkyDirectRenderTimestampMs,
  );
  if (step.recordCompletedCanonicalUpdateBlock) {
    routeLodSkyDirectRenderCapture.recordCompletedCanonicalUpdateBlock(
      createZeroWorkRouteLodSkyFrameUpdate(
        routeLodSkyDirectRenderClockMs,
      ),
    );
  }
  return step;
};
appendRouteLodSkyDirectRenderFrame();
for (const frameTimeMs of expectedNoUpdateLeadInFrameTimesMs) {
  routeLodSkyDirectRenderTimestampMs += frameTimeMs;
  routeLodSkyDirectRenderClockMs += frameTimeMs;
  appendRouteLodSkyDirectRenderFrame();
}
routeLodSkyDirectRenderTimestampMs += 10;
routeLodSkyDirectRenderClockMs += 10;
appendRouteLodSkyDirectRenderFrame();
for (const frameTimeMs of expectedNoUpdateShellFrameTimesMs) {
  routeLodSkyDirectRenderTimestampMs += frameTimeMs;
  routeLodSkyDirectRenderClockMs += frameTimeMs;
  appendRouteLodSkyDirectRenderFrame();
}
const routeLodSkyDirectRenderCaptureReport =
  routeLodSkyDirectRenderCapture.getReport();
assert.ok(routeLodSkyDirectRenderCaptureReport);
assert.equal(
  routeLodSkyDirectRenderCaptureReport.forestRenderer,
  HAMLET_ROUTE_FOREST_RENDERER_DISABLED,
);
assert.equal(
  routeLodSkyDirectRenderCaptureReport.forestUpdates,
  'frozen-after-settled-warmup',
);
assert.equal(
  routeLodSkyDirectRenderCaptureReport.postProcessing,
  'disabled',
);
assert.equal(routeLodSkyDirectRenderCaptureReport.leadIn.elapsedMs, 250);
assert.deepEqual(
  routeLodSkyDirectRenderCaptureReport.leadIn.frameTimesMs,
  expectedNoUpdateLeadInFrameTimesMs,
  'the restored-update treatment must preserve the exact 250ms lead-in',
);
assert.deepEqual(
  routeLodSkyDirectRenderCaptureReport.judgedCohort.frameTimesMs,
  expectedNoUpdateShellFrameTimesMs,
  'the restored-update treatment must preserve the exact ordered 30s cohort',
);
assert.deepEqual(
  routeLodSkyDirectRenderCaptureReport.judgedCohort.retainedUpdates,
  {
    motionRoute: 'canonical-loop',
    lodScene: 'updateSceneLods',
    sky: ['updateCamera', 'updateSun', 'updateTime'],
  },
);
assert.deepEqual(
  routeLodSkyDirectRenderCaptureReport
    .judgedCohort.updates.updateCounts,
  {
    motionRoute: 3_000,
    lodScene: 3_000,
    sky: {
      camera: 3_000,
      sun: 3_000,
      time: 3_000,
    },
  },
  'every judged interval must retain exactly one route/LOD/scene/sky update block',
);
assert.deepEqual(
  routeLodSkyDirectRenderCaptureReport
    .judgedCohort.updates.phaseSequence.slice(0, 3),
  ['strategic', 'settlement', 'road-eye'],
  'the ordered cohort must visibly progress strategic to settlement to road-eye',
);
assert.ok(
  Object.values(
    routeLodSkyDirectRenderCaptureReport
      .judgedCohort.updates.phaseFrameCounts,
  ).every((count) => count > 0),
  'all three canonical route phases must contribute judged frames',
);
assert.ok(
  routeLodSkyDirectRenderCaptureReport
    .judgedCohort.updates.route.wrapCount >= 1,
  'the 30-second cohort must include a complete 21-second route wrap',
);
assert.deepEqual(
  routeLodSkyDirectRenderCaptureReport
    .judgedCohort.updates.lodStatesTraversed,
  {
    forest: ['overview', 'near'],
    groundcover: ['hidden', 'transition', 'full'],
    building: ['strategic', 'settlement', 'road-eye'],
  },
  'all authored LOD states must be exercised by the judged route',
);
assert.deepEqual(
  routeLodSkyDirectRenderCaptureReport
    .judgedCohort.updates.frozenVegetationWork,
  {
    forest: {
      selectionChanges: 0,
      workChunks: 0,
      matrixWrites: 0,
      bucketUploads: 0,
      maxPendingBuckets: 0,
      selectorSkippedFrames: 3_000,
    },
    groundcover: {
      generationSubsteps: 0,
      clearWriteSubsteps: 0,
      refreshes: 0,
      gpuFlagUpdates: 0,
      gpuUpdateRanges: 0,
      bytesUploaded: 0,
      wildflowerLodCompactions: 0,
      wildflowerLodGpuFlagUpdates: 0,
      wildflowerLodGpuUpdateRanges: 0,
      wildflowerLodBytesUploaded: 0,
      wildflowerLodReclassifications: 0,
      completedSlots: 0,
      cancelledSlots: 0,
      maxPendingSlots: 0,
    },
  },
  'generation/caster work must stay frozen while presentation LOD remains separately attributable',
);
assert.deepEqual(
  routeLodSkyDirectRenderCaptureReport.routeFrameSequence,
  routeFrameSequenceDescriptor,
  'terminal evidence must carry the deterministic popping-review sequence manifest',
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
    residenceRoof: 'tier-1-bundled-thatch',
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
  'pairedDomPublicationControl' in sampleEnvelope,
  false,
  'the randomized DOM pair must not change default evidence shape',
);
assert.equal(
  'frozenUpdateDirectRender' in sampleEnvelope,
  false,
  'the render-on diagnostic must not change default evidence shape',
);
assert.equal(
  'routeLodSkyDirectRender' in sampleEnvelope,
  false,
  'the restored-update diagnostic must not change default evidence shape',
);
assert.equal(
  'pairedRouteUpdateControl' in sampleEnvelope,
  false,
  'the same-document route-update pair must not change default evidence shape',
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

const frozenDirectRendererRecord = {
  routeElapsedMs: 0,
  routeCycle: 0,
  phase: 'strategic' as const,
  forest: {
    selectionChanged: false,
    selectorSkipped: true,
    workChunks: 0,
    matrixWrites: 0,
    bucketUploads: 0,
    pendingBuckets: 0,
  },
  groundcoverDelta: {
    generationSubsteps: 0,
    clearWriteSubsteps: 0,
    refreshes: 0,
    gpuFlagUpdates: 0,
    gpuUpdateRanges: 0,
    bytesUploaded: 0,
    wildflowerLodCompactions: 0,
    wildflowerLodGpuFlagUpdates: 0,
    wildflowerLodGpuUpdateRanges: 0,
    wildflowerLodBytesUploaded: 0,
    wildflowerLodReclassifications: 0,
    completedSlots: 0,
    cancelledSlots: 0,
    pendingSlots: 0,
  },
  dtMs: 10,
  traceMs: 10,
  intervalStartRafTimestampMs: 20_000,
  intervalEndRafTimestampMs: 20_010,
  precedingFrameRafTimestampMs: 20_000,
  precedingFrameCallbackEntryTimestampMs: 20_000.1,
  precedingFrameEntryLatenessMs: 0.1,
  precedingFrameCpuDurationMs: 1.2,
  precedingFrameUpdatePreRenderDurationMs: 0.1,
  precedingFrameRenderSubmissionDurationMs: 0.9,
  precedingFramePostRenderDurationMs: 0.2,
  precedingFrameGpuRafTimestampMs: 20_000,
  precedingFrameGpuQueryId: 41,
  precedingFrameGpuDurationMs: 0.75,
  precedingFrameGpuTimingStatus: 'available' as const,
  precedingFrameGpuTimingLimitation: null,
  renderer: {
    drawCalls: 48,
    frameCalls: 1,
    triangles: 420_000,
  },
};
const frozenDirectRendererCollectorReport: VisualPerformanceReport = {
  ...samplePerformanceReport,
  sampleCount:
    frozenDirectRenderCaptureReport.judgedCohort.sampleCount,
  metrics: {
    ...frozenDirectRenderCaptureReport.judgedCohort.metrics,
  },
  renderer: {
    medianDrawCalls: 48,
    medianFrameCalls: 1,
    medianTriangles: 420_000,
  },
  slowFrames: [frozenDirectRendererRecord],
  context: {
    ...samplePerformanceReport.context,
    gpuTiming: {
      ...samplePerformanceReport.context.gpuTiming,
      attemptedFrames: 3_000,
      submittedFrames: 3_000,
      resolvedFrames: 3_000,
    },
    subsystems: {
      ...samplePerformanceReport.context.subsystems,
      post: false,
      shadows: false,
      forest: false,
      sky: true,
      groundcover: true,
    },
  },
};
assert.equal(
  doesHamletFrozenUpdateDirectRenderMatchCollector(
    frozenDirectRenderCaptureReport,
    frozenDirectRendererCollectorReport,
  ),
  true,
  'positive renderer counters and available GPU timestamps must exactly agree',
);
for (const invalidDirectRendererReport of [
  {
    ...frozenDirectRendererCollectorReport,
    renderer: {
      ...frozenDirectRendererCollectorReport.renderer,
      medianFrameCalls: 0,
    },
  },
  {
    ...frozenDirectRendererCollectorReport,
    context: {
      ...frozenDirectRendererCollectorReport.context,
      subsystems: {
        ...frozenDirectRendererCollectorReport.context.subsystems,
        forest: true,
      },
    },
  },
  {
    ...frozenDirectRendererCollectorReport,
    slowFrames: [{
      ...frozenDirectRendererRecord,
      precedingFrameGpuTimingStatus: 'missing' as const,
      precedingFrameGpuDurationMs: null,
    }],
  },
]) {
  assert.equal(
    doesHamletFrozenUpdateDirectRenderMatchCollector(
      frozenDirectRenderCaptureReport,
      invalidDirectRendererReport,
    ),
    false,
    'renderer, subsystem, or GPU evidence drift must invalidate the treatment',
  );
}
const unavailableGpuDirectRendererReport: VisualPerformanceReport = {
  ...frozenDirectRendererCollectorReport,
  slowFrames: [{
    ...frozenDirectRendererRecord,
    precedingFrameGpuQueryId: null,
    precedingFrameGpuDurationMs: null,
    precedingFrameGpuTimingStatus: 'unavailable',
    precedingFrameGpuTimingLimitation:
      'The selected GPUDevice did not enable timestamp-query.',
  }],
  context: {
    ...frozenDirectRendererCollectorReport.context,
    gpuTiming: {
      requested: true,
      status: 'unavailable',
      source: 'unavailable',
      feature: 'timestamp-query',
      api: 'unavailable',
      span: 'unavailable',
      unit: 'milliseconds',
      slotCount: 0,
      attemptedFrames: 0,
      submittedFrames: 0,
      resolvedFrames: 0,
      pendingFrames: 0,
      droppedFrames: 0,
      failedFrames: 0,
      limitations: [
        'The selected GPUDevice did not enable timestamp-query.',
      ],
    },
  },
};
assert.equal(
  doesHamletFrozenUpdateDirectRenderMatchCollector(
    frozenDirectRenderCaptureReport,
    unavailableGpuDirectRendererReport,
  ),
  true,
  'unsupported timestamp queries must remain admissible only with explicit terminal limitations',
);
const frozenDirectRendererEvidence =
  createHamletFrozenUpdateDirectRenderEvidence(
    frozenDirectRenderCaptureReport,
    frozenDirectRendererCollectorReport,
  );
assert.deepEqual(
  frozenDirectRendererEvidence.collectorAgreement.renderer,
  frozenDirectRendererCollectorReport.renderer,
);
assert.equal(
  frozenDirectRendererEvidence.collectorAgreement
    .gpuTimestamp.retainedAvailableRecords,
  1,
);
assert.equal(
  frozenDirectRendererEvidence.collectorAgreement
    .gpuTimestamp.spanInterpretation,
  'schema-5 queue bookends surround the direct-color renderer submission because post is disabled',
);
assert.equal(
  doesHamletRouteLodSkyDirectRenderMatchCollector(
    routeLodSkyDirectRenderCaptureReport,
    frozenDirectRendererCollectorReport,
  ),
  true,
  'route/LOD/scene/sky counts and progression must agree with the same direct-render schema-5/GPU cohort',
);
assert.deepEqual(
  auditHamletRouteLodSkyDirectRenderCollector(
    routeLodSkyDirectRenderCaptureReport,
    frozenDirectRendererCollectorReport,
  ),
  {
    matches: true,
    failures: [],
    captureSampleCount:
      routeLodSkyDirectRenderCaptureReport.judgedCohort.sampleCount,
    collectorSampleCount:
      frozenDirectRendererCollectorReport.sampleCount,
    captureMetrics: {
      ...routeLodSkyDirectRenderCaptureReport.judgedCohort.metrics,
    },
    collectorMetrics: {
      ...frozenDirectRendererCollectorReport.metrics,
    },
    captureForestEdgeLayout: null,
    captureSequenceSignature:
      routeLodSkyDirectRenderCaptureReport.routeFrameSequence.signature,
    expectedSequenceSignature:
      routeLodSkyDirectRenderCaptureReport.routeFrameSequence.signature,
  },
  'the exact collector audit must remain empty for a valid route cohort',
);
const invalidRouteLodSkyCapture = JSON.parse(
  JSON.stringify(routeLodSkyDirectRenderCaptureReport),
) as typeof routeLodSkyDirectRenderCaptureReport;
invalidRouteLodSkyCapture.judgedCohort
  .updates.frozenVegetationWork.forest.workChunks = 1;
assert.equal(
  doesHamletRouteLodSkyDirectRenderMatchCollector(
    invalidRouteLodSkyCapture,
    frozenDirectRendererCollectorReport,
  ),
  false,
  'any forest or groundcover work must invalidate the restored-update rung',
);
assert.deepEqual(
  auditHamletRouteLodSkyDirectRenderCollector(
    invalidRouteLodSkyCapture,
    frozenDirectRendererCollectorReport,
  ).failures,
  ['cohort-updates'],
  'the audit must name the precise route-cohort agreement failure',
);
const routeLodSkyDirectRendererEvidence =
  createHamletRouteLodSkyDirectRenderEvidence(
    routeLodSkyDirectRenderCaptureReport,
    frozenDirectRendererCollectorReport,
  );
assert.equal(
  routeLodSkyDirectRendererEvidence
    .judgedCohort.updates.updateCounts.motionRoute,
  routeLodSkyDirectRendererEvidence.judgedCohort.sampleCount,
);
assert.equal(
  routeLodSkyDirectRendererEvidence
    .collectorAgreement.actualRendererSubmissions,
  true,
);
const shadowOnRouteLodSkyCapture = JSON.parse(
  JSON.stringify(routeLodSkyDirectRenderCaptureReport),
) as typeof routeLodSkyDirectRenderCaptureReport;
shadowOnRouteLodSkyCapture.shadowSubsystem =
  HAMLET_ROUTE_SHADOW_SUBSYSTEM_ENABLED;
shadowOnRouteLodSkyCapture.routeFrameSequence =
  createHamletRouteFrameSequenceDescriptor(
    HAMLET_ROUTE_SHADOW_SUBSYSTEM_ENABLED,
  );
const shadowOnDirectRendererCollectorReport: VisualPerformanceReport = {
  ...frozenDirectRendererCollectorReport,
  context: {
    ...frozenDirectRendererCollectorReport.context,
    subsystems: {
      ...frozenDirectRendererCollectorReport.context.subsystems,
      shadows: true,
    },
  },
};
assert.equal(
  doesHamletRouteLodSkyDirectRenderMatchCollector(
    shadowOnRouteLodSkyCapture,
    shadowOnDirectRendererCollectorReport,
  ),
  true,
  'the shadow-on variant must agree only with a schema-5 collector that observed shadows enabled',
);
assert.equal(
  doesHamletRouteLodSkyDirectRenderMatchCollector(
    shadowOnRouteLodSkyCapture,
    frozenDirectRendererCollectorReport,
  ),
  false,
  'shadow-on evidence must reject a collector that actually ran shadows off',
);
assert.equal(
  createHamletRouteLodSkyDirectRenderEvidence(
    shadowOnRouteLodSkyCapture,
    shadowOnDirectRendererCollectorReport,
  ).collectorAgreement.subsystems.shadows,
  true,
  'terminal evidence must truthfully serialize the restored shadow subsystem',
);
const forestOnRouteLodSkyCapture = JSON.parse(
  JSON.stringify(shadowOnRouteLodSkyCapture),
) as typeof routeLodSkyDirectRenderCaptureReport;
forestOnRouteLodSkyCapture.forestRenderer =
  HAMLET_ROUTE_FOREST_RENDERER_ENABLED;
forestOnRouteLodSkyCapture.routeFrameSequence =
  createHamletRouteFrameSequenceDescriptor(
    HAMLET_ROUTE_SHADOW_SUBSYSTEM_ENABLED,
    HAMLET_ROUTE_FOREST_RENDERER_ENABLED,
  );
const forestOnDirectRendererCollectorReport: VisualPerformanceReport = {
  ...shadowOnDirectRendererCollectorReport,
  context: {
    ...shadowOnDirectRendererCollectorReport.context,
    subsystems: {
      ...shadowOnDirectRendererCollectorReport.context.subsystems,
      forest: true,
    },
  },
};
assert.equal(
  doesHamletRouteLodSkyDirectRenderMatchCollector(
    forestOnRouteLodSkyCapture,
    forestOnDirectRendererCollectorReport,
  ),
  true,
  'the forest-on treatment must agree with a collector that observed only forest restored over the shadow-on control',
);
assert.equal(
  doesHamletRouteLodSkyDirectRenderMatchCollector(
    forestOnRouteLodSkyCapture,
    shadowOnDirectRendererCollectorReport,
  ),
  false,
  'forest-on evidence must reject a collector that actually hid the forest',
);
const forestEdgeLayoutCapture = JSON.parse(
  JSON.stringify(forestOnRouteLodSkyCapture),
) as typeof routeLodSkyDirectRenderCaptureReport;
forestEdgeLayoutCapture.forestEdgeLayout =
  'clustered-sapling-shrub-256';
forestEdgeLayoutCapture.routeFrameSequence =
  createHamletRouteFrameSequenceDescriptor(
    HAMLET_ROUTE_SHADOW_SUBSYSTEM_ENABLED,
    HAMLET_ROUTE_FOREST_RENDERER_ENABLED,
    forestEdgeLayoutCapture.forestEdgeLayout,
  );
assert.equal(
  doesHamletRouteLodSkyDirectRenderMatchCollector(
    forestEdgeLayoutCapture,
    forestOnDirectRendererCollectorReport,
  ),
  true,
  'a layout-bearing forest capture must match the descriptor reconstructed from the same immutable layout identity',
);
const driftedForestEdgeLayoutCapture = JSON.parse(
  JSON.stringify(forestEdgeLayoutCapture),
) as typeof forestEdgeLayoutCapture;
driftedForestEdgeLayoutCapture.forestEdgeLayout = 'legacy-perimeter';
assert.equal(
  doesHamletRouteLodSkyDirectRenderMatchCollector(
    driftedForestEdgeLayoutCapture,
    forestOnDirectRendererCollectorReport,
  ),
  false,
  'a capture-level forest-edge layout drift must fail against its serialized route sequence',
);
const forestOnDirectRendererEvidence =
  createHamletRouteLodSkyDirectRenderEvidence(
    forestOnRouteLodSkyCapture,
    forestOnDirectRendererCollectorReport,
  );
assert.deepEqual(
  {
    forestRenderer: forestOnDirectRendererEvidence.forestRenderer,
    forestUpdates: forestOnDirectRendererEvidence.forestUpdates,
    postProcessing: forestOnDirectRendererEvidence.postProcessing,
    shadows:
      forestOnDirectRendererEvidence
        .collectorAgreement.subsystems.shadows,
    forest:
      forestOnDirectRendererEvidence
        .collectorAgreement.subsystems.forest,
  },
  {
    forestRenderer: HAMLET_ROUTE_FOREST_RENDERER_ENABLED,
    forestUpdates: 'frozen-after-settled-warmup',
    postProcessing: 'disabled',
    shadows: true,
    forest: true,
  },
  'terminal evidence must explicitly identify forest on, updates frozen, post off, and shadows on',
);

function runRouteUpdatePair(
  drawUint32: number,
  initialTimestampMs: number,
) {
  const coordinator = createHamletRouteUpdatePairCoordinator(
    pairIdentity,
    drawUint32,
  );
  let timestampMs = initialTimestampMs;
  let terminalPair = null;
  for (let armIndex = 0; armIndex < 2; armIndex += 1) {
    if (armIndex > 0) timestampMs += 1_000;
    let routeClockMs = 0;
    const treatment = coordinator.getCurrentTreatment();
    const appendFrame = () => {
      const step = coordinator.appendRafTimestamp(timestampMs);
      if (step.recordCompletedCanonicalUpdateBlock) {
        coordinator.recordCompletedCanonicalUpdateBlock(
          createZeroWorkRouteLodSkyFrameUpdate(routeClockMs),
        );
      }
      return step;
    };
    appendFrame();
    for (const frameTimeMs of expectedNoUpdateLeadInFrameTimesMs) {
      timestampMs += frameTimeMs;
      routeClockMs += frameTimeMs;
      appendFrame();
    }
    timestampMs += 10;
    routeClockMs += 10;
    appendFrame();
    let captureComplete = false;
    for (const frameTimeMs of expectedNoUpdateShellFrameTimesMs) {
      timestampMs += frameTimeMs;
      routeClockMs += frameTimeMs;
      captureComplete = appendFrame().captureComplete;
    }
    assert.equal(
      captureComplete,
      true,
      'each pair arm must complete its exact independent 30-second capture',
    );
    const completion = coordinator.completeCurrentArm({
      performanceReport: frozenDirectRendererCollectorReport,
      completedAtPerformanceTimestampMs: timestampMs + 1,
    });
    assert.equal(
      completion.advanceToNextArm,
      armIndex === 0,
      'only arm one may install the next fresh collector generation',
    );
    if (treatment === HAMLET_FROZEN_UPDATE_DIRECT_RENDER_TREATMENT) {
      assert.throws(
        () => coordinator.recordCompletedCanonicalUpdateBlock(
          createZeroWorkRouteLodSkyFrameUpdate(routeClockMs),
        ),
        armIndex === 0
          ? /canonical update block was not requested/
          : /already complete|forbidden in the OFF arm/,
        'the OFF arm must never accept a canonical update record',
      );
    }
    terminalPair = completion.report;
  }
  assert.ok(terminalPair);
  return { coordinator, report: terminalPair };
}

for (const [drawUint32, expectedOrder] of [
  [
    4,
    [
      HAMLET_FROZEN_UPDATE_DIRECT_RENDER_TREATMENT,
      HAMLET_ROUTE_LOD_SKY_DIRECT_RENDER_TREATMENT,
    ],
  ],
  [
    5,
    [
      HAMLET_ROUTE_LOD_SKY_DIRECT_RENDER_TREATMENT,
      HAMLET_FROZEN_UPDATE_DIRECT_RENDER_TREATMENT,
    ],
  ],
] as const) {
  const { coordinator, report } = runRouteUpdatePair(
    drawUint32,
    500_000 + drawUint32 * 100_000,
  );
  assert.equal(report.experiment, HAMLET_ROUTE_UPDATE_PAIR_EXPERIMENT);
  assert.deepEqual(report.randomizedOrder, expectedOrder);
  assert.equal(report.randomization.drawUint32, drawUint32);
  assert.equal(report.randomization.orderBit, drawUint32 & 1);
  assert.equal(report.runUuid, pairIdentity.runUuid);
  assert.equal(
    report.performanceTimeOriginMs,
    pairIdentity.performanceTimeOriginMs,
  );
  assert.deepEqual(
    report.arms.map((arm) => arm.collectorGeneration),
    [1, 2],
    'the serialized arms must name two fresh schema-5 collectors',
  );
  assert.deepEqual(
    report.arms.map((arm) => arm.leadIn.frameTimesMs),
    [
      expectedNoUpdateLeadInFrameTimesMs,
      expectedNoUpdateLeadInFrameTimesMs,
    ],
    'both arms must serialize independent complete 250ms lead-ins',
  );
  assert.deepEqual(
    report.arms.map((arm) => arm.judgedCohort.frameTimesMs),
    [
      expectedNoUpdateShellFrameTimesMs,
      expectedNoUpdateShellFrameTimesMs,
    ],
    'both arms must serialize the exact ordered 30-second interval arrays',
  );
  const offArm = report.arms.find(
    (arm) =>
      arm.treatment === HAMLET_FROZEN_UPDATE_DIRECT_RENDER_TREATMENT,
  )!;
  const onArm = report.arms.find(
    (arm) =>
      arm.treatment === HAMLET_ROUTE_LOD_SKY_DIRECT_RENDER_TREATMENT,
  )!;
  assert.deepEqual(offArm.canonicalUpdateBlock.updateCounts, {
    motionRoute: 0,
    lodScene: 0,
    sky: { camera: 0, sun: 0, time: 0 },
  });
  assert.deepEqual(onArm.canonicalUpdateBlock.updateCounts, {
    motionRoute: onArm.judgedCohort.sampleCount,
    lodScene: onArm.judgedCohort.sampleCount,
    sky: {
      camera: onArm.judgedCohort.sampleCount,
      sun: onArm.judgedCohort.sampleCount,
      time: onArm.judgedCohort.sampleCount,
    },
  });
  assert.equal(onArm.canonicalUpdateBlock.phaseAndLodCoverage, true);
  assert.deepEqual(
    report.controlledDifference,
    {
      canonicalRouteLodSceneSkyUpdates: 'off-vs-on',
      renderer: {
        mode: 'direct-color-scene',
        submission: 'renderer.render(scene,camera)',
        postProcessing: false,
      },
      vegetation: 'frozen',
      disabledSubsystems: ['forest', 'post', 'shadows'],
      schemaVersion: 5,
      gpuTimestamp: 'identical-required-when-supported',
    },
    'the terminal pair must declare only the canonical update block as different',
  );
  assert.ok(Object.values(report.agreements).every(Boolean));
  assert.deepEqual(report.armHandoffGapsMs, {
    firstCohortEndToSecondLeadInStart: 1_000,
    firstTerminalFreezeToSecondLeadInStart: 999,
  });
  assert.notStrictEqual(
    report.arms[0].judgedCohort.frameTimesMs,
    report.arms[1].judgedCohort.frameTimesMs,
  );
  const mutablePair = report as typeof report & {
    arms: [
      { judgedCohort: { frameTimesMs: number[] } },
      { judgedCohort: { frameTimesMs: number[] } },
    ];
  };
  mutablePair.arms[0].judgedCohort.frameTimesMs[0] = 999;
  assert.equal(mutablePair.arms[1].judgedCohort.frameTimesMs[0], 10);
  assert.equal(
    coordinator.getReport()?.arms[0].judgedCohort.frameTimesMs[0],
    10,
    'returned paired evidence must not mutate the coordinator snapshot',
  );
}

function runDomPublicationPair(
  drawUint32: number,
  initialTimestampMs: number,
  firstArmCounterOverride?: 'periodic' | 'terminal-only-after-freeze',
) {
  const coordinator = createHamletDomPublicationPairCoordinator(
    pairIdentity,
    drawUint32,
  );
  let timestampMs = initialTimestampMs;
  let terminalPair = null;
  for (let armIndex = 0; armIndex < 2; armIndex += 1) {
    if (armIndex > 0) timestampMs += 1_000;
    const treatment = coordinator.getCurrentTreatment();
    coordinator.appendRafTimestamp(timestampMs);
    for (const frameTimeMs of expectedNoUpdateLeadInFrameTimesMs) {
      timestampMs += frameTimeMs;
      coordinator.appendRafTimestamp(timestampMs);
    }
    timestampMs += 10;
    coordinator.appendRafTimestamp(timestampMs);
    let armCapture = null;
    for (const frameTimeMs of expectedNoUpdateShellFrameTimesMs) {
      timestampMs += frameTimeMs;
      armCapture = coordinator.appendRafTimestamp(timestampMs).report;
    }
    assert.ok(armCapture);
    assert.equal(
      armCapture.treatment,
      treatment,
      'each serialized arm must retain its randomized treatment identity',
    );
    const publicationMode = armIndex === 0 && firstArmCounterOverride
      ? firstArmCounterOverride
      : treatment === HAMLET_NO_UPDATE_SHELL_TREATMENT
        ? 'periodic'
        : 'terminal-only-after-freeze';
    const domPublication = publicationMode === 'periodic'
      ? {
          mode: 'periodic' as const,
          inMemoryReportConstructions: 61,
          jsonSerializations: 61,
          cohortDomPublications: 60,
          terminalDomPublications: 1,
        }
      : {
          mode: 'terminal-only-after-freeze' as const,
          inMemoryReportConstructions: 61,
          jsonSerializations: 61,
          cohortDomPublications: 0,
          terminalDomPublications: 1,
        };
    const completion = coordinator.completeCurrentArm({
      performanceReport: {
        ...noUpdateCollectorReport,
        sampleCount: armCapture.judgedCohort.sampleCount,
        metrics: { ...armCapture.judgedCohort.metrics },
      },
      domPublication,
      completedAtPerformanceTimestampMs: timestampMs + 1,
    });
    assert.equal(
      completion.advanceToNextArm,
      armIndex === 0,
      'only the first exact arm may advance to a fresh collector',
    );
    terminalPair = completion.report;
  }
  assert.ok(terminalPair);
  return { coordinator, report: terminalPair };
}

assert.throws(
  () => runDomPublicationPair(2, 50_000, 'terminal-only-after-freeze'),
  /counters do not match its treatment/,
  'the DOM-on arm must reject a deferred or zero-publication counter set',
);
assert.throws(
  () => runDomPublicationPair(3, 60_000, 'periodic'),
  /counters do not match its treatment/,
  'the deferred arm must reject any cohort-time DOM publication',
);

for (const [drawUint32, expectedOrder] of [
  [
    2,
    [
      HAMLET_NO_UPDATE_SHELL_TREATMENT,
      HAMLET_DEFERRED_DOM_NO_UPDATE_SHELL_TREATMENT,
    ],
  ],
  [
    3,
    [
      HAMLET_DEFERRED_DOM_NO_UPDATE_SHELL_TREATMENT,
      HAMLET_NO_UPDATE_SHELL_TREATMENT,
    ],
  ],
] as const) {
  const { coordinator, report } = runDomPublicationPair(
    drawUint32,
    100_000 + drawUint32 * 100_000,
  );
  assert.deepEqual(
    report.randomizedOrder,
    expectedOrder,
    'the terminal artifact must serialize the cryptographically selected order',
  );
  assert.equal(report.randomization.drawUint32, drawUint32);
  assert.equal(report.randomization.orderBit, drawUint32 & 1);
  assert.equal(report.runUuid, pairIdentity.runUuid);
  assert.equal(
    report.performanceTimeOriginMs,
    pairIdentity.performanceTimeOriginMs,
  );
  assert.deepEqual(
    report.arms.map((arm) => arm.leadIn.frameTimesMs),
    [
      expectedNoUpdateLeadInFrameTimesMs,
      expectedNoUpdateLeadInFrameTimesMs,
    ],
    'both randomized arms must serialize independent complete 250ms lead-ins',
  );
  assert.deepEqual(
    report.arms.map((arm) => arm.judgedCohort.frameTimesMs),
    [
      expectedNoUpdateShellFrameTimesMs,
      expectedNoUpdateShellFrameTimesMs,
    ],
    'both randomized arms must serialize complete exact 30-second cohorts',
  );
  assert.deepEqual(
    report.arms.map((arm) => arm.sequenceIndex),
    [1, 2],
  );
  assert.deepEqual(
    report.arms.map((arm) => arm.collectorAgreement),
    expectedOrder.map((treatment) => ({
      schemaVersion: 5,
      exactSampleCount: true,
      exactMetrics: true,
      zeroRendererSubmissions: true,
      domPublication: treatment === HAMLET_NO_UPDATE_SHELL_TREATMENT
        ? {
            mode: 'periodic',
            inMemoryReportConstructions: 61,
            jsonSerializations: 61,
            cohortDomPublications: 60,
            terminalDomPublications: 1,
          }
        : {
            mode: 'terminal-only-after-freeze',
            inMemoryReportConstructions: 61,
            jsonSerializations: 61,
            cohortDomPublications: 0,
            terminalDomPublications: 1,
          },
    })),
    'each arm must serialize every schema-5 and DOM publication counter',
  );
  assert.deepEqual(report.armHandoffGapsMs, {
    firstCohortEndToSecondLeadInStart: 1_000,
    firstTerminalFreezeToSecondLeadInStart: 999,
  });
  assert.notStrictEqual(
    report.arms[0].judgedCohort.frameTimesMs,
    report.arms[1].judgedCohort.frameTimesMs,
    'the paired arms must not share a mutable ordered interval array',
  );
  const mutablePair = report as typeof report & {
    arms: [
      {
        judgedCohort: {
          frameTimesMs: number[];
          metrics: { medianFps: number };
        };
        performanceReport: {
          metrics: { medianFps: number };
        };
      },
      {
        judgedCohort: {
          frameTimesMs: number[];
          metrics: { medianFps: number };
        };
      },
    ];
  };
  mutablePair.arms[0].judgedCohort.frameTimesMs[0] = 999;
  mutablePair.arms[0].judgedCohort.metrics.medianFps = 1;
  mutablePair.arms[0].performanceReport.metrics.medianFps = 2;
  assert.equal(
    mutablePair.arms[1].judgedCohort.frameTimesMs[0],
    10,
    'mutating one returned arm must not leak into the other arm',
  );
  const immutablePair = coordinator.getReport();
  assert.equal(immutablePair?.arms[0].judgedCohort.frameTimesMs[0], 10);
  assert.equal(immutablePair?.arms[0].judgedCohort.metrics.medianFps, 100);
  assert.equal(immutablePair?.arms[0].performanceReport.metrics.medianFps, 100);
}

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
    residenceRoof: 'tier-1-bundled-thatch',
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
const frozenDirectRendererEnvelope = {
  ...noUpdateEnvelope,
  performanceReport: frozenDirectRendererCollectorReport,
};
assert.equal(
  canFinalizeHamletFrozenUpdateDirectRenderEvidence(
    frozenDirectRendererEnvelope,
    frozenDirectRenderCaptureReport,
    'ready',
  ),
  true,
  'the render-on arm may finalize only after warmup, freeze, schema-5 agreement, and positive submissions',
);
assert.equal(
  canFinalizeHamletFrozenUpdateDirectRenderEvidence(
    {
      ...frozenDirectRendererEnvelope,
      forestWork: {
        ...frozenDirectRendererEnvelope.forestWork,
        selectorEvaluations: 1,
      },
    },
    frozenDirectRenderCaptureReport,
    'ready',
  ),
  false,
  'any measured forest selector work must invalidate the frozen-update arm',
);
const routeLodSkyDirectRendererEnvelope = {
  ...frozenDirectRendererEnvelope,
  presentationTreatment: {
    id: 'groundcover-continuous-alpha-coverage-live-wildflower-route',
    rendererTreatment:
      HAMLET_ROUTE_LOD_SKY_DIRECT_RENDER_TREATMENT,
    disabledSubsystems: ['forest', 'post', 'shadows'],
    groundcoverFadeMode: 'continuous-alpha-coverage' as const,
    groundcoverSubmission:
      'two-grass-plus-ten-spatial-wildflower-lod-meshes' as const,
    forestRenderer: HAMLET_ROUTE_FOREST_RENDERER_DISABLED,
    forestUpdates: 'frozen-after-settled-warmup' as const,
    postProcessing: 'disabled' as const,
    shadowSubsystem: HAMLET_ROUTE_SHADOW_SUBSYSTEM_DISABLED,
  },
  route: {
    ...frozenDirectRendererEnvelope.route,
    completedRoutes: 1,
  },
};
assert.equal(
  canFinalizeHamletRouteLodSkyDirectRenderEvidence(
    routeLodSkyDirectRendererEnvelope,
    routeLodSkyDirectRenderCaptureReport,
    'ready',
  ),
  true,
  'the restored-update rung must require a measured full route, all phases, exact updates, and schema-5/GPU agreement',
);
assert.equal(
  canFinalizeHamletRouteLodSkyDirectRenderEvidence(
    {
      ...routeLodSkyDirectRendererEnvelope,
      route: {
        ...routeLodSkyDirectRendererEnvelope.route,
        completedRoutes: 0,
      },
    },
    routeLodSkyDirectRenderCaptureReport,
    'ready',
  ),
  false,
  'warmup alone must not masquerade as measured canonical route progression',
);
const forestOnRouteLodSkyDirectRendererEnvelope = {
  ...routeLodSkyDirectRendererEnvelope,
  performanceReport: forestOnDirectRendererCollectorReport,
  presentationTreatment: {
    ...routeLodSkyDirectRendererEnvelope.presentationTreatment,
    disabledSubsystems: ['post'],
    forestRenderer: HAMLET_ROUTE_FOREST_RENDERER_ENABLED,
    shadowSubsystem: HAMLET_ROUTE_SHADOW_SUBSYSTEM_ENABLED,
  },
};
assert.equal(
  canFinalizeHamletRouteLodSkyDirectRenderEvidence(
    forestOnRouteLodSkyDirectRendererEnvelope,
    forestOnRouteLodSkyCapture,
    'ready',
  ),
  true,
  'the forest-on arm may finalize only when its explicit presentation identity and positive forest content agree',
);
for (const invalidForestOnEnvelope of [
  {
    ...forestOnRouteLodSkyDirectRendererEnvelope,
    presentationTreatment: undefined,
  },
  {
    ...forestOnRouteLodSkyDirectRendererEnvelope,
    presentationTreatment: {
      ...forestOnRouteLodSkyDirectRendererEnvelope.presentationTreatment,
      disabledSubsystems: ['forest', 'post'],
    },
  },
  {
    ...forestOnRouteLodSkyDirectRendererEnvelope,
    presentationTreatment: {
      ...forestOnRouteLodSkyDirectRendererEnvelope.presentationTreatment,
      groundcoverFadeMode: 'legacy-pipeline-cutover' as const,
    },
  },
  {
    ...forestOnRouteLodSkyDirectRendererEnvelope,
    content: {
      ...forestOnRouteLodSkyDirectRendererEnvelope.content,
      visibleTrees: 0,
      forestDraws: 0,
    },
  },
]) {
  assert.equal(
    canFinalizeHamletRouteLodSkyDirectRenderEvidence(
      invalidForestOnEnvelope,
      forestOnRouteLodSkyCapture,
      'ready',
    ),
    false,
    'missing, contradictory, legacy-fade, or empty forest presentation evidence must not finalize',
  );
}
assert.equal(
  canFinalizeHamletRouteUpdatePairArmEvidence(
    frozenDirectRendererEnvelope,
    'ready',
  ),
  true,
  'either randomized arm may freeze only after the common full-route warmup and exact frozen state',
);
assert.equal(
  canFinalizeHamletRouteUpdatePairArmEvidence(
    {
      ...frozenDirectRendererEnvelope,
      groundcoverWork: {
        ...frozenDirectRendererEnvelope.groundcoverWork,
        pendingSlots: 1,
        converged: false,
      },
    },
    'ready',
  ),
  false,
  'the paired collector must reject any vegetation-state drift',
);
const serializedFrozenDirectRendererEnvelope =
  createHamletFixtureEvidenceEnvelope({
    fixtureId: frozenDirectRendererEnvelope.fixtureId,
    routeId: frozenDirectRendererEnvelope.routeId,
    routeDurationMs: frozenDirectRendererEnvelope.routeDurationMs,
    ablation: frozenDirectRendererEnvelope.ablation,
    protocol: frozenDirectRendererEnvelope.protocol,
    performanceReport: frozenDirectRendererCollectorReport,
    forestWork: frozenDirectRendererEnvelope.forestWork,
    groundcoverWork: frozenDirectRendererEnvelope.groundcoverWork,
    completedRoutes: frozenDirectRendererEnvelope.route.completedRoutes,
    routeWarmup: frozenDirectRendererEnvelope.route.warmup,
    content: frozenDirectRendererEnvelope.content,
    frozenUpdateDirectRender: frozenDirectRendererEvidence,
  });
assert.equal(
  serializedFrozenDirectRendererEnvelope.frozenUpdateDirectRender
    ?.collectorAgreement.actualRendererSubmissions,
  true,
  'terminal evidence must serialize the positive direct-render agreement',
);
const serializedRouteLodSkyDirectRendererEnvelope =
  createHamletFixtureEvidenceEnvelope({
    fixtureId: routeLodSkyDirectRendererEnvelope.fixtureId,
    routeId: routeLodSkyDirectRendererEnvelope.routeId,
    routeDurationMs: routeLodSkyDirectRendererEnvelope.routeDurationMs,
    ablation: routeLodSkyDirectRendererEnvelope.ablation,
    protocol: routeLodSkyDirectRendererEnvelope.protocol,
    performanceReport: frozenDirectRendererCollectorReport,
    forestWork: routeLodSkyDirectRendererEnvelope.forestWork,
    groundcoverWork: routeLodSkyDirectRendererEnvelope.groundcoverWork,
    completedRoutes:
      routeLodSkyDirectRendererEnvelope.route.completedRoutes,
    routeWarmup: routeLodSkyDirectRendererEnvelope.route.warmup,
    content: routeLodSkyDirectRendererEnvelope.content,
    routeLodSkyDirectRender: routeLodSkyDirectRendererEvidence,
  });
assert.equal(
  serializedRouteLodSkyDirectRendererEnvelope
    .routeLodSkyDirectRender?.routeFrameSequence.signature,
  routeFrameSequenceDescriptor.signature,
  'terminal evidence must serialize the deterministic LOD popping-review sequence signature',
);
const routeUpdatePairFixtureReport =
  runRouteUpdatePair(6, 1_500_000).report;
const serializedRouteUpdatePairEnvelope =
  createHamletFixtureEvidenceEnvelope({
    fixtureId: frozenDirectRendererEnvelope.fixtureId,
    routeId: frozenDirectRendererEnvelope.routeId,
    routeDurationMs: frozenDirectRendererEnvelope.routeDurationMs,
    ablation: frozenDirectRendererEnvelope.ablation,
    protocol: frozenDirectRendererEnvelope.protocol,
    performanceReport: frozenDirectRendererCollectorReport,
    forestWork: frozenDirectRendererEnvelope.forestWork,
    groundcoverWork: frozenDirectRendererEnvelope.groundcoverWork,
    completedRoutes: 1,
    routeWarmup: frozenDirectRendererEnvelope.route.warmup,
    content: frozenDirectRendererEnvelope.content,
    pairedRouteUpdateControl: routeUpdatePairFixtureReport,
  });
assert.equal(
  serializedRouteUpdatePairEnvelope
    .pairedRouteUpdateControl?.experiment,
  HAMLET_ROUTE_UPDATE_PAIR_EXPERIMENT,
);
assert.ok(
  serializedRouteUpdatePairEnvelope
    .pairedRouteUpdateControl?.agreements.onUpdatesExactlyOncePerInterval,
  'the envelope must retain the terminal normalized update agreement',
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
    residenceRoof: 'tier-1-bundled-thatch',
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
    residenceRoof: 'tier-1-bundled-thatch',
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
    residenceRoof: 'tier-1-bundled-thatch',
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
    residenceRoof: 'tier-1-bundled-thatch',
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
  'the batched 17-home Tier-1 fabric must retain its earth-toned split-shingle material',
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
const rendererBackendSource = readFileSync(
  'src/scene/RendererBackend.ts',
  'utf8',
);
const visualPerformanceHookSource = readFileSync(
  'src/e2e/visualPerformanceHooks.ts',
  'utf8',
);
assert.match(
  fixtureSource,
  /const structureShadowBatch = new BatchedBuildingShadowProxies\([\s\S]*?structureShadowBatch\.upsertBuilding\([\s\S]*?structureShadowBatch\.flush\(\);/,
  'the representative hamlet must use the production coarse structure-shadow path',
);
assert.match(
  fixtureSource,
  /function configureWorldMesh\([\s\S]*?mesh\.castShadow = false;[\s\S]*?mesh\.receiveShadow = true;/,
  'detailed fixture structures must receive shadows without re-entering the atlas',
);
assert.match(
  fixtureSource,
  /sun\.shadow\.camera\.layers\.enable\(TREE_SHADOW_CAST_LAYER\);[\s\S]*?countFixtureStructuralSubmissions\(scene, camera\)/,
  'the shadow camera alone must see proxies while color structural telemetry ignores them',
);
assert.match(
  fixtureSource,
  /sun\.shadow\.autoUpdate = false;[\s\S]*?if \(shadowMapNeedsRefresh\) \{\s*sun\.shadow\.needsUpdate = true;\s*shadowMap\.needsUpdate = true;\s*shadowMapNeedsRefresh = false;/,
  'the representative static atlas must refresh explicitly instead of redrawing every frame',
);
assert.match(
  fixtureSource,
  /const profileLegacyGroundcoverShadowReception =[\s\S]*?requestedVisualProfile[\s\S]*?visualGroundcoverShadowReceive'\) === 'legacy'[\s\S]*?if \(profileLegacyGroundcoverShadowReception\) \{[\s\S]*?mesh\.receiveShadow = true;/,
  'the profiler may opt into the legacy receiver path only for controlled comparison',
);
assert.match(
  fixtureSource,
  /document\.body\.dataset\.groundcoverShadowReception =[\s\S]*?mesh-received-legacy-profile[\s\S]*?: 'terrain-projected';/,
  'fixture telemetry must distinguish the production policy from the explicit legacy profile',
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
  5,
  'the marker control may govern only instrumentation, the two fixed direct-render treatments, and their exact pair',
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
  /const requestedVisualDomPublicationPair =\s*resolveHamletDomPublicationPairRequest\(\{\s*requested: params\.get\('visualDomPair'\) === '1',\s*visualNoUpdateShell: requestedVisualNoUpdateShell,\s*visualDeferDom: requestedVisualDeferredDom,\s*\}\);/,
  'the randomized pair must be an explicit exact-shell treatment',
);
assert.match(
  fixtureSource,
  /const requestedVisualFrozenUpdateDirectRender =\s*resolveHamletFrozenUpdateDirectRenderRequest\(\{[\s\S]*?requested: params\.get\('visualFrozenDirectRender'\) === '1',[\s\S]*?visualNoRender: requestedVisualNoRender,[\s\S]*?visualNoUpdateShell: requestedVisualNoUpdateShell,[\s\S]*?gpuTimestampMarkersEnabled: visualGpuTimestampMarkersEnabled,[\s\S]*?disabledSubsystems: requestedVisualDisabledSubsystems,/,
  'the render-on rung must be an explicit exact-query treatment',
);
assert.match(
  fixtureSource,
  /const requestedVisualRouteLodSkyDirectRender =\s*resolveHamletRouteLodSkyDirectRenderRequest\(\{[\s\S]*?requested: params\.get\('visualRouteLodSkyDirectRender'\) === '1',[\s\S]*?visualFrozenDirectRender: requestedVisualFrozenUpdateDirectRender,[\s\S]*?gpuTimestampMarkersEnabled: visualGpuTimestampMarkersEnabled,[\s\S]*?disabledSubsystems: requestedVisualDisabledSubsystems,/,
  'the restored route/LOD/scene/sky rung must be a separate exact-query treatment',
);
assert.match(
  fixtureSource,
  /const requestedVisualRouteUpdatePair =\s*resolveHamletRouteUpdatePairRequest\(\{[\s\S]*?requested: params\.get\('visualRouteUpdatePair'\) === '1',[\s\S]*?visualFrozenDirectRender: requestedVisualFrozenUpdateDirectRender,[\s\S]*?visualRouteLodSkyDirectRender:\s*requestedVisualRouteLodSkyDirectRender,[\s\S]*?gpuTimestampMarkersEnabled: visualGpuTimestampMarkersEnabled,[\s\S]*?disabledSubsystems: requestedVisualDisabledSubsystems,/,
  'Round 42 must remain one explicit exact-query paired treatment',
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
  '__HAMLET_FIXTURE_ROUTE_FRAME_SEQUENCE__',
  '__HAMLET_FIXTURE_ROUTE_FRAME_SEQUENCE_READY__',
  '__HAMLET_FIXTURE_CAPTURE_ROUTE_FRAME__',
  '__HAMLET_FIXTURE_CAPTURE_ROUTE_FRAME_PNG__',
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
  /routeWarmupWork\.stage === 'resettling'[\s\S]*?startMotionRoute\(0, true\)\s*\)\s*\{[\s\S]*?visualPerf\.armTraceAfterCurrentFrame\(\);\s*routeWarmupWork\.stage = 'complete';/,
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
  /const domPublicationPairRandomDraw = requestedVisualDomPublicationPair\s*\? crypto\.getRandomValues\(new Uint32Array\(1\)\)\[0\]!\s*: null;[\s\S]*?createHamletDomPublicationPairCoordinator\(\s*noUpdateShellIdentity,\s*domPublicationPairRandomDraw,\s*\)/,
  'the DOM pair must use one serialized cryptographic order draw and shared document identity',
);
assert.match(
  fixtureSource,
  /const routeUpdatePairIdentity: HamletPerformancePairIdentity \| null =\s*requestedVisualRouteUpdatePair\s*\? \{\s*runUuid: crypto\.randomUUID\(\),\s*performanceTimeOriginMs: performance\.timeOrigin,\s*\}\s*: null;[\s\S]*?const routeUpdatePairRandomDraw = requestedVisualRouteUpdatePair\s*\? crypto\.getRandomValues\(new Uint32Array\(1\)\)\[0\]!\s*: null;[\s\S]*?createHamletRouteUpdatePairCoordinator\(\s*routeUpdatePairIdentity,\s*routeUpdatePairRandomDraw,\s*\)/,
  'the route-update pair must use one shared document identity and serialized cryptographic order draw',
);
assert.match(
  fixtureSource,
  /routeUpdatePairCoordinator\.completeCurrentArm\(\{[\s\S]*?performanceReport,[\s\S]*?completedAtPerformanceTimestampMs: performance\.now\(\),[\s\S]*?completion\.advanceToNextArm[\s\S]*?stopFrameCollection\(\);[\s\S]*?routeUpdatePairArmCaptureComplete = false;[\s\S]*?routeUpdatePairAwaitingFreshCollector = true;[\s\S]*?installVisualPerformanceHooksIfRequested\(\s*hamletVisualPerformanceApp,\s*\);/,
  'arm one must freeze before a fresh same-document schema-5 collector is installed',
);
assert.match(
  fixtureSource,
  /pairedRouteUpdateControl: completion\.report,[\s\S]*?visualRouteUpdatePairStatus =\s*'ready';[\s\S]*?dataset\.hamletFixtureEvidence =\s*JSON\.stringify\(finalizedFixtureEvidence\);[\s\S]*?installRouteFrameSequenceDomBridge\(\);/,
  'only the terminal two-arm route-update pair may publish evidence and visual hooks',
);
assert.match(
  fixtureSource,
  /domPublicationPairCoordinator\.completeCurrentArm\(\{[\s\S]*?performanceReport,[\s\S]*?getDomPublicationEvidence\(\),[\s\S]*?completedAtPerformanceTimestampMs: performance\.now\(\),[\s\S]*?completion\.advanceToNextArm[\s\S]*?stopFrameCollection\(\);[\s\S]*?noUpdateShellCaptureReport = null;[\s\S]*?deferredDomCohortActive = false;[\s\S]*?domPublicationPairAwaitingFreshCollector = true;[\s\S]*?installVisualPerformanceHooksIfRequested\(\s*hamletVisualPerformanceApp,\s*\);/,
  'arm one must freeze all evidence, clear arm-local state, and install a fresh same-document collector',
);
assert.match(
  fixtureSource,
  /pairedDomPublicationControl: completion\.report,[\s\S]*?dataset\.visualDomPairStatus = 'ready';[\s\S]*?dataset\.hamletFixtureEvidence =\s*JSON\.stringify\(finalizedFixtureEvidence\);/,
  'only the completed two-arm reversion may publish the terminal paired artifact',
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
  /const noUpdateShellCapture = noUpdateShellIdentity\s*&& !domPublicationPairCoordinator\s*\? createHamletNoUpdateShellCapture\(noUpdateShellIdentity, \{\s*deferCohortDomPublication: requestedVisualDeferredDom,\s*\}\)\s*: null;/,
  'the no-update lead-in and ordered cohort must remain absent from the default fixture',
);
assert.match(
  fixtureSource,
  /const frozenUpdateDirectRenderCapture =\s*frozenUpdateDirectRenderIdentity\s*\? createHamletFrozenUpdateDirectRenderCapture\(\s*frozenUpdateDirectRenderIdentity,\s*\)\s*: null;/,
  'the direct-render lead-in and ordered cohort must remain absent by default',
);
assert.match(
  fixtureSource,
  /const requestedForestEdgeLayout = resolveHamletForestEdgeLayout\([\s\S]*?dataset\.visualRouteForestEdgeLayout =\s*requestedForestEdgeLayout;[\s\S]*?const requestedVisualRouteShadowSubsystem =[\s\S]*?HAMLET_ROUTE_SHADOW_SUBSYSTEM_ENABLED[\s\S]*?HAMLET_ROUTE_SHADOW_SUBSYSTEM_DISABLED;[\s\S]*?const requestedVisualRouteForestRenderer =[\s\S]*?HAMLET_ROUTE_FOREST_RENDERER_ENABLED[\s\S]*?HAMLET_ROUTE_FOREST_RENDERER_DISABLED;[\s\S]*?const routeFrameSequenceDescriptor =\s*requestedVisualRouteLodSkyDirectRender\s*\|\| requestedVisualRouteUpdatePair\s*\|\| requestedGroundcoverTransitionEvidence\s*\? createHamletRouteFrameSequenceDescriptor\(\s*requestedVisualRouteShadowSubsystem,\s*requestedVisualRouteForestRenderer,\s*requestedForestEdgeLayout,\s*\)\s*: null;[\s\S]*?const routeLodSkyDirectRenderCapture =\s*routeLodSkyDirectRenderIdentity\s*\? createHamletRouteLodSkyDirectRenderCapture\(\s*routeLodSkyDirectRenderIdentity,\s*\{\s*shadowSubsystem: requestedVisualRouteShadowSubsystem,\s*forestRenderer: requestedVisualRouteForestRenderer,\s*forestEdgeLayout: requestedForestEdgeLayout,\s*\},\s*\)\s*: null;/,
  'the shadow, forest, and immutable edge-layout identities must drive the collector and terminal frame sequence while remaining absent by default',
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
    'if (routeUpdatePairTreatmentActive) {',
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
const frozenDirectRenderTickBranch = fixtureSource.slice(
  fixtureSource.indexOf(
    'if (\n      requestedVisualFrozenUpdateDirectRender',
  ),
  fixtureSource.indexOf('if (\n      requestedVisualNoUpdateShell'),
);
for (const skippedFrozenDirectRenderWork of [
  'sampleHamletMotionRoute(',
  'updateSceneLods(',
  'advanceRouteWarmupProtocol(',
  'sky.updateCamera(',
  'sky.updateSun(',
  'sky.updateTime(',
]) {
  assert.ok(
    !frozenDirectRenderTickBranch.includes(skippedFrozenDirectRenderWork),
    `the render-on arm must skip ${skippedFrozenDirectRenderWork}`,
  );
}
for (const retainedFrozenDirectRenderWork of [
  'appendRafTimestamp(nowMs)',
  'armTraceAfterCurrentFrame()',
  'render(',
  'performance.now()',
  'latestProfileFrameTiming',
]) {
  assert.ok(
    frozenDirectRenderTickBranch.includes(retainedFrozenDirectRenderWork),
    `the render-on arm must retain ${retainedFrozenDirectRenderWork}`,
  );
}
assert.match(
  frozenDirectRenderTickBranch,
  /render\(\s*0,\s*true,\s*nowMs,\s*false,\s*true,\s*\)/,
  'the exact cohort must request the direct-color scene renderer',
);
const routeUpdatePairTickBranch = fixtureSource.slice(
  fixtureSource.indexOf('if (routeUpdatePairTreatmentActive) {'),
  fixtureSource.indexOf('if (routeLodSkyTreatmentActive) {'),
);
for (const retainedRouteUpdatePairControl of [
  'restartRouteUpdatePairArmFromCanonicalZero()',
  'getCurrentTreatment()',
  'appendRafTimestamp(nowMs)',
  'recordCompletedCanonicalUpdateBlock',
  'armTraceAfterCurrentFrame()',
]) {
  assert.ok(
    routeUpdatePairTickBranch.includes(retainedRouteUpdatePairControl),
    `the same-document pair must retain ${retainedRouteUpdatePairControl}`,
  );
}
assert.match(
  routeUpdatePairTickBranch,
  /routeUpdatePairCanonicalUpdatesEnabled =\s*currentTreatment\s*!== HAMLET_FROZEN_UPDATE_DIRECT_RENDER_TREATMENT;/,
  'the randomized treatment identity must control only one canonical update gate',
);
const canonicalSceneUpdateStart = fixtureSource.indexOf(
  'const canonicalSceneUpdateBlockEnabled =',
);
const canonicalSceneUpdateEnd = fixtureSource.indexOf(
  'if (frameCpuStartedAtMs === null) {',
  canonicalSceneUpdateStart,
);
assert.ok(
  canonicalSceneUpdateStart >= 0 && canonicalSceneUpdateEnd > canonicalSceneUpdateStart,
  'the canonical route/LOD/scene/sky update block must remain inspectable',
);
const canonicalSceneUpdateBlock = fixtureSource.slice(
  canonicalSceneUpdateStart,
  canonicalSceneUpdateEnd,
);
assert.match(
  canonicalSceneUpdateBlock,
  /const canonicalSceneUpdateBlockEnabled =\s*!routeUpdatePairTreatmentActive\s*\|\| routeUpdatePairCanonicalUpdatesEnabled;\s*if \(canonicalSceneUpdateBlockEnabled\) \{/,
  'the randomized route-update treatment must own the complete canonical update gate',
);
for (const requiredCanonicalUpdate of [
  'sampleHamletMotionRoute(elapsed)',
  'updateSceneLods(',
  'sky.updateCamera(camera)',
  'sky.updateSun(sunDirection)',
  'sky.updateTime(fixtureTimeSeconds)',
  'routeUpdatePairCoordinator!.recordCompletedCanonicalUpdateBlock({',
]) {
  assert.ok(
    canonicalSceneUpdateBlock.includes(requiredCanonicalUpdate),
    `the canonical paired block must retain ${requiredCanonicalUpdate}`,
  );
}
const routeLodSkyDirectRenderTickBranch = fixtureSource.slice(
  fixtureSource.indexOf('if (routeLodSkyTreatmentActive) {'),
  fixtureSource.indexOf('if (frameCpuStartedAtMs === null) {'),
);
for (const restoredRouteLodSkyWork of [
  'appendRafTimestamp(nowMs)',
  'sampleHamletMotionRoute(elapsed)',
  'updateSceneLods(',
  'publishMotionState()',
  'advanceRouteWarmupProtocol()',
  'sky.updateCamera(camera)',
  'sky.updateSun(sunDirection)',
  'sky.updateTime(fixtureTimeSeconds)',
  'recordCompletedCanonicalUpdateBlock({',
]) {
  assert.ok(
    routeLodSkyDirectRenderTickBranch.includes(restoredRouteLodSkyWork),
    `the Round 41 treatment must retain ${restoredRouteLodSkyWork}`,
  );
}
assert.match(
  routeLodSkyDirectRenderTickBranch,
  /sky\.updateCamera\(camera\);\s*sky\.updateSun\(sunDirection\);\s*sky\.updateTime\(fixtureTimeSeconds\);[\s\S]*?recordCompletedCanonicalUpdateBlock\(\{[\s\S]*?routeId: HAMLET_MOTION_ROUTE_ID,[\s\S]*?routeStatus: 'running',[\s\S]*?lod: \{ \.\.\.motionState\.lod \},[\s\S]*?forest: \{ \.\.\.latestForestFrameWork \},[\s\S]*?groundcoverDelta: \{ \.\.\.latestGroundcoverFrameDelta \},/,
  'the evidence counter must run only after the complete canonical route/LOD/scene/sky block',
);
assert.match(
  fixtureSource,
  /const frameAfterProfileRenderPathAtMs = render\(\s*dtMs \/ 1000,\s*true,\s*nowMs,\s*isNoRenderMeasuredWindowActive\(\),\s*routeLodSkyTreatmentActive \|\| routeUpdatePairTreatmentActive,\s*\)!;/,
  'only the fixed restored-update treatment or its exact pair may select the direct-color renderer on the normal route path',
);
assert.match(
  fixtureSource,
  /const frameCpuStartedAtMs = requestedVisualProfile \? performance\.now\(\) : null;\s*motionAnimationFrame = requestAnimationFrame\(tick\);[\s\S]*?if \(\s*requestedVisualNoUpdateShell/,
  'the treatment must retain the ordinary profiled callback clock and rAF scheduler',
);
assert.match(
  fixtureSource,
  /const activeNoUpdateShellCapture =\s*domPublicationPairCoordinator \?\? noUpdateShellCapture;[\s\S]*?activeNoUpdateShellCapture!\.appendRafTimestamp\(nowMs\);[\s\S]*?controlStep\?\.armCollectorAfterCurrentFrame[\s\S]*?window\.__visualPerf\?\.deferDomPublicationUntilReady\(\);[\s\S]*?window\.__visualPerf\?\.armTraceAfterCurrentFrame\(\);[\s\S]*?const frameBeforeRenderAtMs = performance\.now\(\);[\s\S]*?render\(\s*0,\s*true,\s*nowMs,\s*true,\s*\)[\s\S]*?latestProfileFrameTiming = \{/,
  'the terminal lead-in callback must reset the retained schema-5 collector before a no-render profiled cohort',
);
assert.match(
  fixtureSource,
  /function publishNoUpdateShellStatus\(status: string\): void \{\s*if \(\s*requestedVisualDeferredDom\s*\|\| domPublicationPairCoordinator\?\.getCurrentTreatment\(\)\s*=== HAMLET_DEFERRED_DOM_NO_UPDATE_SHELL_TREATMENT\s*\) \{\s*return;\s*\}\s*document\.documentElement\.dataset\.visualNoUpdateShellStatus = status;\s*\}/,
  'all shell status datasets must be suppressed by the explicit deferred treatment',
);
assert.match(
  fixtureSource,
  /maybeFinalizeFixtureEvidence\(\);\s*maybeInstallGroundcoverTransitionEvidenceBridge\(\);\s*if \(!deferredDomCohortActive \|\| finalizedFixtureEvidence\) \{\s*metricsElement!\.textContent = /,
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
  fixtureSource,
  /canFinalizeHamletFrozenUpdateDirectRenderEvidence\([\s\S]*?frozenUpdateDirectRenderCaptureReport,[\s\S]*?createHamletFrozenUpdateDirectRenderEvidence\([\s\S]*?performanceReport,[\s\S]*?frozenUpdateDirectRender,[\s\S]*?visualFrozenDirectRenderStatus =\s*'ready';/,
  'terminal render-on evidence must require exact schema-5 renderer and GPU agreement',
);
assert.match(
  fixtureSource,
  /canFinalizeHamletRouteLodSkyDirectRenderEvidence\([\s\S]*?routeLodSkyDirectRenderCaptureReport,[\s\S]*?createHamletRouteLodSkyDirectRenderEvidence\([\s\S]*?performanceReport,[\s\S]*?routeLodSkyDirectRender,[\s\S]*?visualRouteLodSkyDirectRenderStatus =\s*'ready';[\s\S]*?dataset\.hamletFixtureEvidence =\s*JSON\.stringify\(finalizedFixtureEvidence\);[\s\S]*?installRouteFrameSequenceDomBridge\(\);[\s\S]*?visualRouteFrameSequenceStatus =\s*'ready';/,
  'terminal Round 41 evidence and its sequence hook must require exact route/update/schema-5/GPU agreement',
);
assert.match(
  fixtureSource,
  /if \(routeFrameSequenceDescriptor\) \{[\s\S]*?__HAMLET_FIXTURE_ROUTE_FRAME_SEQUENCE__ = \{[\s\S]*?__HAMLET_FIXTURE_ROUTE_FRAME_SEQUENCE_READY__ =\s*isRouteFrameSequenceReady;[\s\S]*?__HAMLET_FIXTURE_CAPTURE_ROUTE_FRAME__ =\s*captureRouteFrameSequenceFrame;/,
  'the deterministic frame hook must exist only for an explicit route-evidence URL',
);
assert.match(
  fixtureSource,
  /requestedGroundcoverTransitionEvidence[\s\S]*?!requestedVisualRouteLodSkyDirectRender[\s\S]*?groundcoverTransitionEvidence=1 requires the canonical Hamlet route,[\s\S]*?visualGroundcoverEvidenceTreatment[\s\S]*?waiting-for-settled-groundcover[\s\S]*?function maybeInstallGroundcoverTransitionEvidenceBridge\(\): void \{[\s\S]*?!grassField\.isStreamSettled\(\)[\s\S]*?visualRouteFrameSequenceStatus = 'ready';[\s\S]*?installRouteFrameSequenceDomBridge\(\);/,
  'the transition bridge must use the exact direct-color treatment identity and wait for frozen groundcover convergence',
);
assert.match(
  fixtureSource,
  /presentationTreatment:[\s\S]*?requestedVisualRouteLodSkyDirectRender[\s\S]*?disabledSubsystems:[\s\S]*?requestedVisualDisabledSubsystems[\s\S]*?groundcoverSubmission:[\s\S]*?'two-grass-plus-ten-spatial-wildflower-lod-meshes'[\s\S]*?forestRenderer:[\s\S]*?requestedVisualRouteForestRenderer[\s\S]*?forestUpdates:[\s\S]*?'frozen-after-settled-warmup'[\s\S]*?postProcessing:[\s\S]*?'disabled'[\s\S]*?shadowSubsystem:[\s\S]*?requestedVisualRouteShadowSubsystem/,
  'route evidence must serialize groundcover identity plus forest on/off, frozen forest updates, post off, and shadow state',
);
assert.match(
  fixtureSource,
  /function captureRouteFrameSequenceFrame\([\s\S]*?if \(!isRouteFrameSequenceReady\(\)[\s\S]*?cancelAnimationFrame\(motionAnimationFrame\);[\s\S]*?resolveHamletRouteFrameSequenceElapsedMs\(frameIndex\);[\s\S]*?seekMotionRoute\(elapsedMs, 'paused', false\);[\s\S]*?sky\.updateCamera\(camera\);[\s\S]*?sky\.updateSun\(sunDirection\);[\s\S]*?sky\.updateTime\(fixtureTimeSeconds\);[\s\S]*?render\(0, true, null, false, true\);[\s\S]*?visualRouteFrameSequenceSignature =\s*routeFrameSequenceDescriptor\.signature;/,
  'sequence frames must be terminal-gated, deterministic seeks rendered through the same direct-color LOD/sky path',
);
assert.match(
  fixtureSource,
  /renderer\.domElement\.setAttribute\(\s*'data-testid',\s*'hamlet-native-render-capture-surface',\s*\);/,
  'the exact native renderer surface must be addressable without viewport screenshot inference',
);
assert.match(
  fixtureSource,
  /configureRendererFrameStats\(renderer\.info as unknown as RendererInfoLike\);[\s\S]*?getPerformanceStats: \(\) => \{[\s\S]*?calls: structural\.draws,[\s\S]*?renderPasses: lastRendererFrameStats\.renderPasses,[\s\S]*?triangles: structural\.triangles/,
  'schema-5 fixture evidence must measure each renderer frame boundary and publish its real render-pass count',
);
assert.match(
  fixtureSource,
  /function render\([\s\S]*?const rendererFrameBoundary = beginRendererFrame\(rendererInfo\);[\s\S]*?lastRendererFrameStats = readRendererFrameStats\([\s\S]*?rendererFrameBoundary,[\s\S]*?\);/,
  'each fixture render must reset and sample the shared renderer-frame statistics contract',
);
assert.match(
  fixtureSource,
  /__HAMLET_FIXTURE_CAPTURE_ROUTE_FRAME_PNG__ =\s*captureRouteFrameSequencePng;/,
  'the native PNG hook must remain terminal route-evidence only',
);
assert.match(
  fixtureSource,
  /async function captureRouteFrameSequencePng\([\s\S]*?captureRouteFrameSequenceFrame\(frameIndex\);[\s\S]*?await rendererBackend\.waitForSubmittedWork\(\);[\s\S]*?canvas\.width !== 1280[\s\S]*?canvas\.height !== 720[\s\S]*?rendererPixelRatio !== 1[\s\S]*?performanceProtocol\?\.valid !== true[\s\S]*?canvas\.toDataURL\('image\/png'\);[\s\S]*?source: 'renderer-drawing-buffer',[\s\S]*?protocol: '1280x720@renderer-pr1',[\s\S]*?width: 1280,[\s\S]*?height: 720,[\s\S]*?mimeType: 'image\/png',/,
  'visual capture must wait for submitted GPU work before exporting the validated native 1280x720 drawing buffer',
);
assert.match(
  rendererBackendSource,
  /waitForSubmittedWork: \(\) =>\s*waitForNativeWebGPUSubmittedWork\(renderer\),[\s\S]*?async function waitForNativeWebGPUSubmittedWork\([\s\S]*?const backend = \(renderer as RendererWithBackend\)\.backend;[\s\S]*?backend\.device\?\.queue[\s\S]*?typeof queue\?\.onSubmittedWorkDone !== 'function'[\s\S]*?throw new Error\([\s\S]*?Native WebGPU capture synchronization is unavailable on the active renderer device queue\.[\s\S]*?await queue\.onSubmittedWorkDone\(\);/,
  'native capture synchronization must inspect the active WebGPU backend and fail closed when its queue cannot be awaited',
);
assert.equal(
  rendererBackendSource.match(
    /waitForSubmittedWork: async \(\) => \{\},/g,
  )?.length,
  2,
  'both WebGL node fallback paths must preserve their synchronous no-op capture behavior',
);
assert.match(
  fixtureSource,
  /function createRouteFrameCameraPoseSignature\([\s\S]*?routeFrameSequenceDescriptor\?\.routeId \?\? 'missing-route',[\s\S]*?frameIndex,[\s\S]*?elapsedMs\.toFixed\(3\),[\s\S]*?motion\.lod\.forest,[\s\S]*?motion\.lod\.groundcover,[\s\S]*?motion\.lod\.building,/,
  'cross-arm camera identity must exclude the treatment-specific forest-edge signature',
);
assert.match(
  fixtureSource,
  /function installRouteFrameSequenceDomBridge\(\): void \{\s*if \(\s*routeFrameSequenceDomControl !== null\s*\|\| routeFrameSequenceDescriptor === null\s*\|\| !hasTerminalRouteFrameSequenceEvidence\(\)\s*\) \{\s*return;\s*\}[\s\S]*?document\.createElement\('input'\);[\s\S]*?document\.createElement\('output'\);[\s\S]*?requestControl\.type = 'text';[\s\S]*?requestControl\.setAttribute\(\s*'data-testid',\s*'hamlet-route-frame-sequence-request',\s*\);[\s\S]*?requestControl\.setAttribute\(\s*'aria-label',\s*'Route frame sequence index',\s*\);[\s\S]*?requestControl\.style\.position = 'fixed';[\s\S]*?requestControl\.style\.width = '2px';[\s\S]*?requestControl\.style\.height = '2px';[\s\S]*?requestControl\.style\.opacity = '0';[\s\S]*?requestControl\.style\.pointerEvents = 'auto';[\s\S]*?outputControl\.hidden = true;[\s\S]*?outputControl\.setAttribute\(\s*'data-testid',\s*'hamlet-route-frame-sequence-native-png-output',\s*\);/,
  'the terminal bridge must preserve its Playwright-fillable request control and expose one hidden native-PNG output',
);
const routeFrameSequenceDomBridgeSource = fixtureSource.match(
  /function installRouteFrameSequenceDomBridge\(\): void \{[\s\S]*?\n\}\n\nfunction captureRouteFrameSequenceFrame\(/,
)?.[0];
assert.ok(
  routeFrameSequenceDomBridgeSource,
  'the route frame sequence DOM bridge source must remain independently auditable',
);
assert.match(
  routeFrameSequenceDomBridgeSource,
  /const clearReplayCompletion = \(\): void => \{\s*outputControl\.textContent = '';\s*outputControl\.removeAttribute\('data-completed-index'\);\s*outputControl\.removeAttribute\('data-completed-elapsed-ms'\);\s*outputControl\.removeAttribute\('data-completed-signature'\);\s*outputControl\.removeAttribute\('data-completed-camera-pose-signature'\);[\s\S]*?delete bridgeRoot\.dataset\.visualRouteFrameSequenceCompletedIndex;[\s\S]*?delete bridgeRoot\.dataset\.visualRouteFrameSequenceCompletedElapsedMs;[\s\S]*?delete bridgeRoot\.dataset\.visualRouteFrameSequenceCompletedSignature;[\s\S]*?visualRouteFrameSequenceCompletedCameraPoseSignature;/,
  'clearing a replay must remove PNG bytes, sequence identity, and camera-pose identity',
);
const nativeCaptureCallOffset = routeFrameSequenceDomBridgeSource.indexOf(
  'captureRouteFrameSequencePng(frameIndex)',
);
const preCaptureClearOffset = routeFrameSequenceDomBridgeSource.lastIndexOf(
  'clearReplayCompletion();',
  nativeCaptureCallOffset,
);
const pngPublishOffset = routeFrameSequenceDomBridgeSource.indexOf(
  'outputControl.textContent = completed.dataUrl;',
);
assert.ok(
  preCaptureClearOffset >= 0
    && nativeCaptureCallOffset > preCaptureClearOffset
    && pngPublishOffset > nativeCaptureCallOffset,
  'native capture must clear prior output before rendering and publish only after capture succeeds',
);
assert.match(
  routeFrameSequenceDomBridgeSource,
  /const completed = await captureRouteFrameSequencePng\(frameIndex\);\s*if \(\s*generation !== replayGeneration\s*\|\| requestControl\.value !== requestedIndex\s*\) \{\s*return;\s*\}\s*const completionIdentity = Object\.freeze\(\{\s*index: String\(completed\.frame\.frameIndex\),\s*elapsedMs: completed\.frame\.elapsedMs\.toFixed\(3\),\s*signature: completed\.frame\.signature,\s*cameraPoseSignature: completed\.frame\.cameraPoseSignature,\s*\}\);[\s\S]*?outputControl\.setAttribute\(\s*'data-completed-index',[\s\S]*?outputControl\.setAttribute\(\s*'data-completed-elapsed-ms',[\s\S]*?outputControl\.setAttribute\(\s*'data-completed-signature',[\s\S]*?outputControl\.setAttribute\(\s*'data-completed-camera-pose-signature',[\s\S]*?outputControl\.textContent = completed\.dataUrl;[\s\S]*?visualRouteFrameSequenceCompletedCameraPoseSignature[\s\S]*?visualRouteFrameSequenceReplayStatus = 'complete';/,
  'successful captures must publish exact native PNG data with immutable frame and camera-pose identity',
);
assert.match(
  routeFrameSequenceDomBridgeSource,
  /\} catch \{\s*if \(\s*generation !== replayGeneration\s*\|\| requestControl\.value !== requestedIndex\s*\) \{\s*return;\s*\}\s*clearReplayCompletion\(\);\s*bridgeRoot\.dataset\.visualRouteFrameSequenceReplayStatus = 'error';/,
  'failed requests must clear any partial publication so no stale PNG survives',
);
assert.match(
  routeFrameSequenceDomBridgeSource,
  /if \(requestedIndex === ''\) \{\s*replayGeneration \+= 1;[\s\S]*?clearReplayCompletion\(\);[\s\S]*?visualRouteFrameSequenceReplayStatus = 'idle';[\s\S]*?if \(requestedIndex === lastHandledRequestIndex\) return;\s*const generation = \+\+replayGeneration;/,
  'blank requests must invalidate in-flight work while duplicate DOM events must not invalidate the active capture',
);
assert.match(
  fixtureSource,
  /requestControl\.addEventListener\('input', handleReplayRequest\);\s*requestControl\.addEventListener\('change', handleReplayRequest\);\s*routeFrameSequenceDomControl = requestControl;\s*document\.body\.append\(requestControl, outputControl\);/,
  'the terminal request and output controls must be installed together exactly once',
);
assert.equal(
  fixtureSource.match(/installRouteFrameSequenceDomBridge\(\)/g)?.length,
  4,
  'the DOM bridge may be defined once and installed only by fixed, paired, or settled transition evidence',
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
  /if \(frameCpuStartedAtMs === null\) \{\s*render\(dtMs \/ 1000\);\s*return;\s*\}\s*const frameBeforeRenderAtMs = performance\.now\(\);\s*const frameAfterProfileRenderPathAtMs = render\(\s*dtMs \/ 1000,\s*true,\s*nowMs,\s*isNoRenderMeasuredWindowActive\(\),\s*routeLodSkyTreatmentActive \|\| routeUpdatePairTreatmentActive,\s*\)!;[\s\S]*?const frameCpuCompletedAtMs = performance\.now\(\);/,
  'the two added callback boundaries must run only on the visual-profile path',
);
assert.match(
  fixtureSource,
  /if \(!profileRenderSubmission\) \{\s*postProcessor\.render\(dt\);\s*postProcessorRendered = true;\s*\} else if \(!skipProfilePostProcessorRender\) \{[\s\S]*?visualGpuTimestampProfiler\?\.beginFrame\(profileFrameRafTimestampMs\)[\s\S]*?try \{\s*if \(directColorSceneRender\) renderer\.render\(scene, camera\);\s*else postProcessor\.render\(dt\);[\s\S]*?renderPathCompletedAtMs = performance\.now\(\);[\s\S]*?visualGpuTimestampProfiler\?\.endFrame\(gpuTimestampHandle\);[\s\S]*?\} else \{\s*const result = executeVisualProfileRenderPath\(\{[\s\S]*?skipPostProcessorRender: true,[\s\S]*?postProcessorRender: \(renderDt\) => postProcessor\.render\(renderDt\),[\s\S]*?gpuTimestampProfiler: visualGpuTimestampProfiler,[\s\S]*?now: \(\) => performance\.now\(\),/,
  'default, direct-color, and no-render paths must remain explicit and mutually exclusive',
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
  7,
  'all three mutually exclusive profiled paths must reuse one callback entry sample and two boundaries',
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
assert.match(
  runAllSource,
  /Object\.keys\(manifest\.scripts \?\? \{\}\)[\s\S]*?script\.startsWith\('test:'\)/,
  'the exhaustive dynamic aggregator must discover the Hamlet fixture from package scripts',
);

console.log(
  `hamlet fixture tests passed (${HAMLET_VIEW_IDS.length} views, `
  + `${HAMLET_ZONE_SPECS.reduce((sum, zone) => sum + zone.plotCount, 0)} bundled-thatch residences, `
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
