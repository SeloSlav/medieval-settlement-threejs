import assert from 'node:assert/strict';
import * as THREE from 'three';
import { AmbientAudio } from '../src/audio/AmbientAudio.ts';
import { AmbientAudioController } from '../src/audio/AmbientAudioController.ts';
import {
  nearestRiverSoundPoint,
  type RiverSoundPoint,
} from '../src/audio/RiverAudio.ts';
import { BuildToolbar } from '../src/ui/BuildToolbar.ts';
import { LivestockVisuals } from '../src/farming/LivestockVisuals.ts';
import { FireEffectsRenderer } from '../src/fires/FireEffectsRenderer.ts';
import { BurgageTool } from '../src/residences/BurgageTool.ts';
import {
  applyResidenceWindowGlow,
  ResidenceMarkers,
} from '../src/residences/ResidenceMarkers.ts';
import { residenceWindowActivity } from '../src/residences/householdRoutine.ts';
import type { GameClock } from '../src/world/gameCalendar.ts';
import { VillagerRenderer } from '../src/settlement/VillagerRenderer.ts';
import {
  beginMapIconFrame,
  placeProjectedMapButton,
} from '../src/map/mapIconProjection.ts';
import type { FireIncidentState } from '../src/fires/fireIncident.ts';
import type { DeliveryTripState } from '../src/logistics/deliveryTrips.ts';

testLivestockShadowTraversalCache();
testResidenceSmokeStateIsEventDriven();
const residenceLightingElapsed = testResidenceLightingPresentationInvalidation();
testAmbientLayerIterationReuse();
testChapelSnapshotIdentityCache();
const riverElapsed = testRiverSoundPointScratchEquivalence();
const fireElapsed = testFireWaterJetScratchReuse();
const toolbarElapsed = testBurgageHudDomWriteCache();
testBurgageHudScratchReuse();
const scheduleElapsed = testStableScheduleSkipsResidentReconciliation();
const mapIconElapsed = testStableMapIconProjectionCache();

console.log(
  'test:presentation-hot-path-pacing passed '
    + `(${fireElapsed.toFixed(1)} ms / 2,000 fire-effect frames; `
    + `${riverElapsed.toFixed(1)} ms / 10,000 river queries; `
    + `${residenceLightingElapsed.toFixed(1)} ms / 20,000 stable residence-light frames; `
    + `${toolbarElapsed.toFixed(1)} ms / 20,000 stable HUD frames; `
    + `${scheduleElapsed.toFixed(1)} ms / 20,000 stable schedule frames; `
    + `${mapIconElapsed.toFixed(1)} ms / 20,000 stable map-icon frames)`,
);

function testBurgageHudDomWriteCache(): number {
  let domWrites = 0;
  let layoutReads = 0;
  const element = (width = 0, height = 0) => {
    const target = {
      _hidden: true,
      _textContent: '',
      _disabled: false,
      dataset: {} as Record<string, string>,
      style: {} as Record<string, string>,
      get hidden() { return this._hidden; },
      set hidden(value: boolean) { domWrites += 1; this._hidden = value; },
      get textContent() { return this._textContent; },
      set textContent(value: string) { domWrites += 1; this._textContent = value; },
      get disabled() { return this._disabled; },
      set disabled(value: boolean) { domWrites += 1; this._disabled = value; },
      get offsetWidth() { layoutReads += 1; return width; },
      get offsetHeight() { layoutReads += 1; return height; },
    };
    target.dataset = new Proxy(target.dataset, {
      set(object, key, value) {
        domWrites += 1;
        return Reflect.set(object, key, value);
      },
    });
    target.style = new Proxy(target.style, {
      set(object, key, value) {
        domWrites += 1;
        return Reflect.set(object, key, value);
      },
    });
    return target;
  };

  const hud = element(168, 44);
  const plotCount = element();
  const plotMax = element();
  const decrease = element();
  const increase = element();
  const rotate = element();
  const frontage = element();
  const toolbar = Object.create(BuildToolbar.prototype) as BuildToolbar;
  Object.assign(toolbar as object, {
    burgageLayoutHud: hud,
    burgagePlotCountLabel: plotCount,
    burgagePlotMaxLabel: plotMax,
    burgagePlotDecreaseButton: decrease,
    burgagePlotIncreaseButton: increase,
    burgageRotateFrontageButton: rotate,
    burgageFrontageLabel: frontage,
    burgageLayoutHudVisible: false,
    lastHudLeft: Number.NaN,
    lastHudTop: Number.NaN,
    burgageHudStateInitialized: false,
  });
  const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { innerWidth: 1280, innerHeight: 720 },
  });
  const stableState = {
    plotCount: 4,
    residenceCount: 3,
    maxPlotCount: 8,
    canDecrease: true,
    canIncrease: true,
    canRotateFrontage: true,
    frontageLabel: 'South frontage',
    valid: true,
  };
  try {
    toolbar.setBurgageLayoutHud({ clientX: 640, clientY: 360 }, stableState);
    const writesAfterFirstFrame = domWrites;
    const started = performance.now();
    for (let frame = 0; frame < 20_000; frame += 1) {
      toolbar.setBurgageLayoutHud({ clientX: 640, clientY: 360 }, stableState);
    }
    const elapsed = performance.now() - started;
    assert.equal(
      domWrites,
      writesAfterFirstFrame,
      'stable burgage layout frames must not rewrite DOM content, attributes, visibility, or position',
    );
    assert.equal(layoutReads, 40_002, 'positioning must retain exact live HUD dimensions');
    toolbar.setBurgageLayoutHud(
      { clientX: 640, clientY: 360 },
      { ...stableState, plotCount: 5, residenceCount: 4, valid: false },
    );
    assert.equal(plotCount.textContent, '5');
    assert.equal(plotMax.textContent, 'plots / 8 max · 4 fit');
    assert.equal(hud.dataset.state, 'warning');
    assert.ok(elapsed < 250, `20,000 stable HUD frames took ${elapsed.toFixed(1)} ms`);
    return elapsed;
  } finally {
    if (windowDescriptor) {
      Object.defineProperty(globalThis, 'window', windowDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, 'window');
    }
  }
}

function testBurgageHudScratchReuse(): void {
  const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 100);
  camera.position.set(0, 0, 10);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  const tool = Object.create(BurgageTool.prototype) as BurgageTool;
  Object.assign(tool as object, {
    enabled: true,
    placementStage: 4,
    frontageEdge: 0,
    plotCount: 4,
    cachedFrontageOptionCount: 2,
    draftValidation: {
      ok: true,
      layout: { residences: [{}, {}, {}] },
    },
    points: [
      new THREE.Vector3(-2, 0, 0),
      new THREE.Vector3(2, 0, 0),
      new THREE.Vector3(2, 0, 4),
      new THREE.Vector3(-2, 0, 4),
    ],
    layoutHudProjectionScratch: new THREE.Vector3(),
    getMaxPlotCount: () => 8,
    options: {
      camera,
      getHeightAt: () => 0,
      domElement: {
        getBoundingClientRect: () => ({
          left: 10,
          top: 20,
          width: 400,
          height: 400,
        }),
      },
    },
  });

  const stateTarget = {
    plotCount: 0,
    residenceCount: null,
    maxPlotCount: 0,
    canDecrease: false,
    canIncrease: false,
    canRotateFrontage: false,
    frontageLabel: null,
    valid: false,
  };
  assert.strictEqual(tool.getLayoutHudState(stateTarget), stateTarget);
  assert.deepEqual(stateTarget, {
    plotCount: 4,
    residenceCount: 3,
    maxPlotCount: 8,
    canDecrease: true,
    canIncrease: true,
    canRotateFrontage: true,
    frontageLabel: 'A–B',
    valid: true,
  });
  assert.notStrictEqual(
    tool.getLayoutHudState(),
    tool.getLayoutHudState(),
    'callers that do not supply a scratch target must retain fresh-object semantics',
  );

  const positionTarget = { clientX: 0, clientY: 0 };
  assert.strictEqual(tool.getLayoutHudPosition(positionTarget), positionTarget);
  assert.equal(positionTarget.clientX, 210);
  assert.equal(positionTarget.clientY, 172);
  assert.notStrictEqual(
    tool.getLayoutHudPosition(),
    tool.getLayoutHudPosition(),
    'position callers that do not supply a scratch target must retain fresh-object semantics',
  );
}

function testStableScheduleSkipsResidentReconciliation(): number {
  const agents = new Map<string, { role: 'resident' | 'worker'; restUntilElapsedSeconds: number }>();
  for (let index = 0; index < 1_000; index += 1) {
    agents.set(`resident-${index}`, { role: 'resident', restUntilElapsedSeconds: 0 });
  }
  for (let index = 0; index < 24; index += 1) {
    agents.set(`worker-${index}`, { role: 'worker', restUntilElapsedSeconds: 0 });
  }
  let residentReconciliations = 0;
  let workerReconciliations = 0;
  const villagers = Object.create(VillagerRenderer.prototype) as VillagerRenderer;
  Object.assign(villagers as object, {
    agents,
    clock: null,
    lastScheduleElapsedSeconds: null,
    laborPaused: false,
    monasteryFeastsEnabled: true,
    sabbathPausedToday: false,
    reconcileRoutine: (agent: { role: 'resident' | 'worker' }) => {
      if (agent.role === 'worker') workerReconciliations += 1;
      else residentReconciliations += 1;
      return false;
    },
  });
  const clock = (minute: number, preciseHour: number) => ({
    simTick: 0,
    totalDays: 0,
    hour: 12,
    minute,
    preciseHour,
    preciseCalendarDay: preciseHour / 24,
    weekday: 1,
    monthDay: 1,
    month: 1,
    year: 1550,
    isSunday: false,
    isWorkHours: true,
  });

  villagers.setSchedule(clock(0, 12), false);
  assert.equal(residentReconciliations, 1_000);
  assert.equal(workerReconciliations, 24);
  residentReconciliations = 0;
  workerReconciliations = 0;
  const started = performance.now();
  for (let frame = 0; frame < 20_000; frame += 1) {
    villagers.setSchedule(
      clock(0, 12 + frame / 20_000 / 60),
      false,
    );
  }
  const elapsed = performance.now() - started;
  assert.equal(
    residentReconciliations,
    0,
    'stable minute and policy frames must not rescan resident routines',
  );
  assert.equal(
    workerReconciliations,
    20_000 * 24,
    'precise worker-route and rest deadlines must still be evaluated every frame',
  );
  villagers.setSchedule(clock(1, 12 + 1 / 60), false);
  assert.equal(residentReconciliations, 1_000, 'a minute transition must reconcile residents');
  assert.equal(workerReconciliations, 20_000 * 24 + 24);
  const retainedClock = clock(1, 12 + 1 / 60);
  villagers.setSchedule(retainedClock, false);
  residentReconciliations = 0;
  retainedClock.minute = 2;
  retainedClock.preciseHour = 12 + 2 / 60;
  villagers.setSchedule(retainedClock, false);
  assert.equal(
    residentReconciliations,
    1_000,
    'retained clocks mutated in place must still invalidate resident routines at minute boundaries',
  );
  assert.ok(elapsed < 250, `20,000 stable schedule frames took ${elapsed.toFixed(1)} ms`);
  return elapsed;
}

function testStableMapIconProjectionCache(): number {
  let domWrites = 0;
  let left = 0;
  let terrainHeight = 0;
  const styleState: Record<string, string> = {};
  const root = {
    _hidden: true,
    get hidden() { return this._hidden; },
    set hidden(value: boolean) { domWrites += 1; this._hidden = value; },
    style: new Proxy(styleState, {
      set(object, key, value) {
        domWrites += 1;
        return Reflect.set(object, key, value);
      },
    }),
  };
  const domElement = {
    getBoundingClientRect: () => ({ left, top: 0, width: 800, height: 600 }),
  };
  const buttonStyle: Record<string, string> = {};
  const button = {
    _hidden: true,
    get hidden() { return this._hidden; },
    set hidden(value: boolean) { domWrites += 1; this._hidden = value; },
    style: new Proxy(buttonStyle, {
      set(object, key, value) {
        domWrites += 1;
        return Reflect.set(object, key, value);
      },
    }),
  };
  const camera = new THREE.PerspectiveCamera(55, 4 / 3, 0.1, 500);
  camera.position.set(0, 20, 30);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  const terrain = { getHeightAt: () => terrainHeight };
  const worldPoint = new THREE.Vector3();
  const originalProject = worldPoint.project.bind(worldPoint);
  let projections = 0;
  worldPoint.project = (activeCamera) => {
    projections += 1;
    return originalProject(activeCamera);
  };
  const begin = () => beginMapIconFrame(
    root as never,
    domElement as never,
    terrain as never,
    () => camera,
    () => 100,
    () => false,
  );

  const firstFrame = begin();
  assert.ok(firstFrame);
  placeProjectedMapButton(button as never, 4, 6, worldPoint, firstFrame);
  const writesAfterFirstFrame = domWrites;
  const started = performance.now();
  for (let frameIndex = 0; frameIndex < 20_000; frameIndex += 1) {
    const frame = begin();
    assert.ok(frame);
    placeProjectedMapButton(button as never, 4, 6, worldPoint, frame);
  }
  const elapsed = performance.now() - started;
  assert.equal(projections, 1, 'stable camera/world coordinates must reuse projected icon positions');
  assert.equal(domWrites, writesAfterFirstFrame, 'stable map icons must not rewrite DOM state');
  left = 5;
  const movedRectFrame = begin();
  assert.ok(movedRectFrame);
  placeProjectedMapButton(button as never, 4, 6, worldPoint, movedRectFrame);
  assert.equal(projections, 2, 'a viewport offset change must invalidate icon projection');
  camera.position.x = 1;
  camera.updateMatrixWorld(true);
  const movedCameraFrame = begin();
  assert.ok(movedCameraFrame);
  placeProjectedMapButton(button as never, 4, 6, worldPoint, movedCameraFrame);
  assert.equal(projections, 3, 'a camera matrix change must invalidate icon projection');
  const inverseBeforeRotation = camera.matrixWorldInverse.clone();
  camera.lookAt(12, 0, -8);
  assert.ok(
    camera.matrixWorldInverse.equals(inverseBeforeRotation),
    'the test must reproduce Three.js leaving the inverse view matrix stale before render',
  );
  const rotatedCameraFrame = begin();
  assert.ok(rotatedCameraFrame);
  assert.ok(
    !camera.matrixWorldInverse.equals(inverseBeforeRotation),
    'map-icon projection must refresh the inverse view matrix before the render pass',
  );
  placeProjectedMapButton(button as never, 4, 6, worldPoint, rotatedCameraFrame);
  assert.equal(projections, 4, 'middle-mouse-style camera rotation must invalidate icon projection');
  terrainHeight = 1.5;
  const changedTerrainFrame = begin();
  assert.ok(changedTerrainFrame);
  placeProjectedMapButton(button as never, 4, 6, worldPoint, changedTerrainFrame);
  assert.equal(projections, 5, 'a terrain-height change must invalidate icon projection');
  assert.ok(elapsed < 250, `20,000 stable map-icon frames took ${elapsed.toFixed(1)} ms`);
  return elapsed;
}

function testLivestockShadowTraversalCache(): void {
  const model = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
  Object.defineProperty(mesh, 'isSkinnedMesh', { value: true });
  model.add(mesh);
  const originalTraverse = model.traverse.bind(model);
  let traversals = 0;
  model.traverse = (callback) => {
    traversals += 1;
    originalTraverse(callback);
  };

  const renderer = Object.create(LivestockVisuals.prototype) as LivestockVisuals;
  Object.assign(renderer as object, {
    animals: [{
      herdId: 'herd-1',
      root: new THREE.Group(),
      model,
      mixer: { update: () => undefined },
      actions: {},
      mode: 'idle',
      modeTimer: 10_000,
      x: 0,
      z: 0,
      targetX: 0,
      targetZ: 0,
      speed: 0,
      pasture: { corners: [] },
      random: () => 0.5,
      castShadow: null,
    }],
    getHeightAt: () => 0,
  });

  const nearView = {
    centerX: 0,
    centerZ: 0,
    viewRadius: 200,
    shadowRadius: 80,
  };
  for (let frame = 0; frame < 1_000; frame += 1) {
    renderer.tick(1 / 60, nearView);
  }
  assert.equal(
    traversals,
    1,
    'unchanged livestock shadow eligibility should traverse the model once, not every frame',
  );
  assert.equal(mesh.castShadow, true);

  renderer.tick(1 / 60, { ...nearView, centerX: 100 });
  assert.equal(traversals, 2, 'crossing the shadow boundary must still update the model immediately');
  assert.equal(mesh.castShadow, false);
  mesh.geometry.dispose();
}

function testResidenceSmokeStateIsEventDriven(): void {
  let activeUpdates = 0;
  let ticks = 0;
  const smokeEmitters = new Map<string, {
    setActive: (active: boolean) => void;
    tick: () => void;
  }>();
  const smokeEligible = new Map<string, boolean>();
  const smokeActive = new Map<string, boolean>();
  for (let index = 0; index < 250; index += 1) {
    const id = `residence-${index}`;
    smokeEmitters.set(id, {
      setActive: () => { activeUpdates += 1; },
      tick: () => { ticks += 1; },
    });
    smokeEligible.set(id, true);
    smokeActive.set(id, true);
  }
  const markers = Object.create(ResidenceMarkers.prototype) as ResidenceMarkers;
  Object.assign(markers as object, {
    smokeEmitters,
    smokeEligible,
    smokeActive,
    chimneySmokeAllowed: true,
    fireDisabledResidenceIds: new Set<string>(),
    meshes: new Map(),
  });

  for (let frame = 0; frame < 1_000; frame += 1) {
    markers.setChimneySmokeAllowed(true);
    markers.tick(1 / 60);
  }
  assert.equal(ticks, 250_000, 'every chimney emitter must still advance every frame');
  assert.equal(
    activeUpdates,
    0,
    'stable presentation smoke flags must not fan out to every emitter each frame',
  );
  markers.setChimneySmokeAllowed(false);
  assert.equal(activeUpdates, 250, 'a global smoke transition must reach every active chimney');
  markers.setChimneySmokeAllowed(false);
  assert.equal(activeUpdates, 250, 'an identical smoke flag must be an exact no-op');
  markers.setChimneySmokeAllowed(true);
  assert.equal(activeUpdates, 500, 're-enabling smoke must restore every eligible chimney');
  markers.setFireDisabledResidenceIds(new Set(['residence-7']));
  assert.equal(activeUpdates, 501, 'a fire change must update only the affected chimney');
  markers.setFireDisabledResidenceIds(new Set(['residence-7']));
  assert.equal(activeUpdates, 501, 'an equal fire-disabled set must not fan out');
}

function testResidenceLightingPresentationInvalidation(): number {
  const markers = new ResidenceMarkers(new THREE.Group());
  const internals = markers as unknown as {
    meshes: Map<string, THREE.Group>;
    residenceOccupied: Map<string, boolean>;
    residencePopulation: Map<string, number>;
  };
  const populations = new Map<string, number>();
  let activityScans = 0;
  const iteratePopulations = populations[Symbol.iterator].bind(populations);
  Object.defineProperty(populations, Symbol.iterator, {
    configurable: true,
    value: () => {
      activityScans += 1;
      return iteratePopulations();
    },
  });
  Object.assign(internals, { residencePopulation: populations });

  let materialWrites = 0;
  const materials = new Map<string, THREE.MeshStandardMaterial>();
  for (let index = 0; index < 250; index += 1) {
    const id = `lighting-residence-${index}`;
    const marker = new THREE.Group();
    const material = new THREE.MeshStandardMaterial();
    const setColorHex = material.color.setHex.bind(material.color);
    material.color.setHex = ((hex: number) => {
      materialWrites += 1;
      return setColorHex(hex);
    }) as THREE.Color['setHex'];
    marker.userData.windowMaterial = material;
    internals.meshes.set(id, marker);
    internals.residenceOccupied.set(id, true);
    populations.set(id, 3 + index % 6);
    materials.set(id, material);
  }

  const clock = presentationClock(20, 15);
  markers.setHouseholdLighting(clock, 0.31);
  assert.equal(activityScans, 1, 'the initial presentation call must build activity once');
  const writesAfterInitialPresentation = materialWrites;

  const stableStarted = performance.now();
  for (let frame = 0; frame < 20_000; frame += 1) {
    clock.preciseHour = 20.25 + frame / 1_000_000;
    markers.setHouseholdLighting(clock, 0.31);
  }
  const stableElapsed = performance.now() - stableStarted;
  assert.equal(
    activityScans,
    1,
    'same-minute presentation must not rescan household members when the clock object mutates',
  );
  assert.equal(
    materialWrites,
    writesAfterInitialPresentation,
    'identical derived lighting must not fan out redundant material writes',
  );

  const sampleId = 'lighting-residence-17';
  const sampleMaterial = materials.get(sampleId)!;
  for (let frame = 0; frame < 180; frame += 1) {
    const glow = 0.311 + frame / 1_000;
    markers.setHouseholdLighting(clock, glow);
    if (frame % 30 !== 0) continue;
    const reference = new THREE.MeshStandardMaterial();
    applyResidenceWindowGlow(
      reference,
      glow * residenceWindowActivity(
        sampleId,
        populations.get(sampleId)!,
        clock,
      ),
      true,
    );
    assert.equal(sampleMaterial.color.getHex(), reference.color.getHex());
    assert.equal(sampleMaterial.emissive.getHex(), reference.emissive.getHex());
    assert.equal(sampleMaterial.emissiveIntensity, reference.emissiveIntensity);
    reference.dispose();
  }
  assert.equal(
    activityScans,
    1,
    'smooth per-frame evening glow must reuse the discrete household activity cache',
  );
  assert.ok(
    materialWrites > writesAfterInitialPresentation,
    'changing evening glow must still update material output continuously',
  );

  clock.minute = 16;
  markers.setHouseholdLighting(clock, 0.49);
  assert.equal(activityScans, 2, 'a minute transition must invalidate household activity');
  markers.setHouseholdLighting(clock, 0.49);
  assert.equal(activityScans, 2, 'an unchanged cosmetic-lighting call must retain the activity cache');
  assert.ok(
    stableElapsed < 250,
    `20,000 stable residence-light presentation frames took ${stableElapsed.toFixed(1)} ms`,
  );
  markers.dispose();
  return stableElapsed;
}

function presentationClock(hour: number, minute: number): GameClock {
  return {
    simTick: 0,
    totalDays: 0,
    hour,
    minute,
    preciseHour: hour + minute / 60,
    preciseCalendarDay: 0,
    weekday: 0,
    monthDay: 1,
    month: 1,
    year: 1,
    isSunday: true,
    isWorkHours: false,
  };
}

function testAmbientLayerIterationReuse(): void {
  const audio = new AmbientAudio();
  const originalKeys = Object.keys;
  let keyArrayAllocations = 0;
  Object.keys = ((object: object) => {
    keyArrayAllocations += 1;
    return originalKeys(object);
  }) as typeof Object.keys;
  try {
    for (let frame = 0; frame < 1_000; frame += 1) audio.tick(1 / 60);
  } finally {
    Object.keys = originalKeys;
  }
  assert.equal(
    keyArrayAllocations,
    0,
    'ambient audio must reuse its stable layer list instead of allocating Object.keys arrays per frame',
  );
}

function testChapelSnapshotIdentityCache(): void {
  let buildingValuesReads = 0;
  const observedChapelX: number[] = [];
  const instrumentValues = (buildings: Map<string, object>): Map<string, object> => {
    const values = buildings.values.bind(buildings);
    Object.defineProperty(buildings, 'values', {
      value: () => {
        buildingValuesReads += 1;
        return values();
      },
    });
    return buildings;
  };
  let currentBuildings = instrumentValues(new Map([
    ['chapel-a', { kind: 'chapel', constructionComplete: true, x: 4, z: 7 }],
  ]));
  const chapelPositions: Array<{ x: number; z: number }> = [];
  const controller = Object.create(AmbientAudioController.prototype) as AmbientAudioController;
  Object.assign(controller as object, {
    running: true,
    audio: {
      getEnabled: () => true,
      setScoreActive: () => undefined,
      tick: () => undefined,
    },
    forestWind: {
      setScoreActive: () => undefined,
      tick: () => undefined,
    },
    chapelBell: {
      tick: (params: { chapels: Array<{ x: number }> }) => {
        observedChapelX.push(params.chapels[0]?.x ?? Number.NaN);
      },
    },
    riverAudio: { tick: () => undefined },
    soundtrack: { tick: () => undefined, isAudible: () => false },
    fireAudio: { tick: () => undefined },
    buildingAudio: { tick: () => undefined },
    worldFoley: { tick: () => undefined },
    buildingAudioView: {
      centerX: 0,
      centerZ: 0,
      viewRadius: 120,
      shadowRadius: 80,
      orbitDistance: 40,
    },
    config: {
      getBuildings: () => currentBuildings,
      getResidences: () => new Map(),
      getDeliveryTrips: () => new Map(),
      getFireIncidents: () => new Map(),
      getLivestockHerds: () => new Map(),
      getBackyardGardens: () => new Map(),
      getForagingNodes: () => new Map(),
      getGraveyards: () => new Map(),
      getCombatAgents: () => new Map(),
      getCameraTarget: () => ({ x: 0, z: 0 }),
      getOrbitDistance: () => 40,
      isFirstPersonActive: () => false,
      getForestCanopyCover: () => 0,
    },
    chapelPositions,
    chapelTick: {
      dtSeconds: 0,
      clockHour: 0,
      calendarMinute: 0,
      chapels: chapelPositions,
      listener: { x: 0, z: 0 },
      orbitDistance: 0,
      enabled: true,
    },
    schedule: {
      clock: { hour: 12, minute: 0, totalDays: 0 },
      dayNight: { isNight: false },
    },
    lastAmbientEvalAtMs: performance.now(),
    lastChapelBuildingSnapshot: null,
  });

  controller.tick(1 / 60);
  controller.tick(1 / 60);
  assert.equal(
    buildingValuesReads,
    1,
    'unchanged authoritative building snapshots must not rescan every building each frame',
  );
  currentBuildings = instrumentValues(new Map([
    ['chapel-b', { kind: 'chapel', constructionComplete: true, x: 19, z: -3 }],
  ]));
  controller.tick(1 / 60);
  assert.equal(
    buildingValuesReads,
    2,
    'same-sized replacement snapshots with changed contents must invalidate the chapel cache',
  );
  assert.deepEqual(observedChapelX, [4, 4, 19]);
}

function testRiverSoundPointScratchEquivalence(): number {
  const riverLayout = {
    corridors: Array.from({ length: 4 }, (_, corridorIndex) => ({
      points: Array.from({ length: 18 }, (_, pointIndex) => ({
        x: pointIndex * 11 - 90 + corridorIndex * 3.25,
        z: Math.sin(pointIndex * 0.61 + corridorIndex) * 38 + corridorIndex * 12,
        halfWidth: 3.5 + ((pointIndex + corridorIndex) % 5) * 1.15,
      })),
    })),
    drain: { x: 104, z: -46 },
  };
  let randomState = 0xa511e9b3;
  const random = (): number => {
    randomState ^= randomState << 13;
    randomState ^= randomState >>> 17;
    randomState ^= randomState << 5;
    return (randomState >>> 0) / 0x1_0000_0000;
  };
  for (let index = 0; index < 200; index += 1) {
    const x = random() * 360 - 180;
    const z = random() * 300 - 150;
    assert.deepEqual(
      nearestRiverSoundPoint(riverLayout as never, x, z),
      legacyNearestRiverSoundPoint(riverLayout, x, z),
      `river sound point ${index} must exactly match the allocation-heavy reference`,
    );
  }

  const scratch: RiverSoundPoint = { x: 0, z: 0, distance: 0 };
  assert.strictEqual(
    nearestRiverSoundPoint(riverLayout as never, 12, -9, scratch),
    scratch,
    'river audio refreshes must reuse their result object',
  );
  const started = performance.now();
  for (let index = 0; index < 10_000; index += 1) {
    nearestRiverSoundPoint(
      riverLayout as never,
      (index % 241) - 120,
      ((index * 17) % 203) - 101,
      scratch,
    );
  }
  const elapsed = performance.now() - started;
  assert.ok(elapsed < 500, `10,000 river sound queries took ${elapsed.toFixed(1)} ms`);
  return elapsed;
}

function legacyNearestRiverSoundPoint(
  riverLayout: {
    corridors: Array<{ points: Array<{ x: number; z: number; halfWidth: number }> }>;
    drain: { x: number; z: number };
  },
  x: number,
  z: number,
): RiverSoundPoint {
  let best: RiverSoundPoint | null = null;
  const considerWaterDisc = (centerX: number, centerZ: number, radius: number): void => {
    const dx = x - centerX;
    const dz = z - centerZ;
    const centerDistance = Math.hypot(dx, dz);
    const surfaceDistance = Math.max(0, centerDistance - radius);
    if (best && surfaceDistance >= best.distance) return;
    if (centerDistance <= radius || centerDistance <= 1e-6) {
      best = { x, z, distance: 0 };
      return;
    }
    const scale = radius / centerDistance;
    best = {
      x: centerX + dx * scale,
      z: centerZ + dz * scale,
      distance: surfaceDistance,
    };
  };
  for (const corridor of riverLayout.corridors) {
    for (let index = 0; index < corridor.points.length - 1; index += 1) {
      const a = corridor.points[index]!;
      const b = corridor.points[index + 1]!;
      const abx = b.x - a.x;
      const abz = b.z - a.z;
      const lengthSq = abx * abx + abz * abz;
      const t = lengthSq <= 1e-6
        ? 0
        : Math.max(0, Math.min(1, ((x - a.x) * abx + (z - a.z) * abz) / lengthSq));
      considerWaterDisc(
        a.x + abx * t,
        a.z + abz * t,
        (a.halfWidth + (b.halfWidth - a.halfWidth) * t) * 0.62,
      );
    }
  }
  considerWaterDisc(riverLayout.drain.x, riverLayout.drain.z, 48);
  return best ?? {
    x: riverLayout.drain.x,
    z: riverLayout.drain.z,
    distance: Math.hypot(x - riverLayout.drain.x, z - riverLayout.drain.z),
  };
}

function testFireWaterJetScratchReuse(): number {
  const renderer = new FireEffectsRenderer(
    { getHeightAt: () => 0 } as never,
    new THREE.Group(),
  );
  const residenceFire = fireIncident('fire-residence', 'residence', 'residence-1', 10);
  const buildingFire = fireIncident('fire-building', 'building', 'building-1', 20);
  renderer.syncIncidents(
    [residenceFire, buildingFire],
    new Map([['building-1', { kind: 'lumber_mill', workRadius: 40 }]]) as never,
    new Map([['residence-1', { tier: 1 }]]) as never,
  );
  renderer.syncTrips([
    {
      id: 'fire-trip',
      destinationKind: 'fire',
      phase: 'unloading',
      targetBuildingId: 'building-1',
      residenceId: 'residence-1',
      x: 0,
      z: 0,
    } as DeliveryTripState,
  ]);

  const internals = renderer as unknown as {
    waterJets: Map<string, { root: THREE.Group }>;
    waterStart: THREE.Vector3;
    waterEnd: THREE.Vector3;
    waterDirection: THREE.Vector3;
    activeWaterJetIds: Set<string>;
  };
  renderer.tick(1 / 60);
  const jet = internals.waterJets.get('fire-trip');
  assert.ok(jet);
  assert.equal(
    jet.root.position.x,
    5,
    'when both legacy target fields are populated, the first matching incident must still win',
  );
  const scratch = [
    internals.waterStart,
    internals.waterEnd,
    internals.waterDirection,
    internals.activeWaterJetIds,
  ];

  const started = performance.now();
  for (let frame = 0; frame < 2_000; frame += 1) {
    renderer.tick(1 / 60);
  }
  const elapsed = performance.now() - started;
  assert.strictEqual(internals.waterJets.get('fire-trip'), jet);
  assert.deepEqual(
    [
      internals.waterStart,
      internals.waterEnd,
      internals.waterDirection,
      internals.activeWaterJetIds,
    ],
    scratch,
    'fire suppression should retain one Set and vector scratch set across frames',
  );
  assert.ok(elapsed < 500, `2,000 fire-effect frames took ${elapsed.toFixed(1)} ms`);
  renderer.dispose();
  return elapsed;
}

function fireIncident(
  id: string,
  targetKind: FireIncidentState['targetKind'],
  targetId: string,
  x: number,
): FireIncidentState {
  return {
    id,
    targetKind,
    targetId,
    x,
    z: 0,
    ignitionSource: 'accident',
    status: 'burning',
    intensity: 0.6,
    damage: 0.2,
    waterDelivered: 0,
    requiredWater: 10,
    extinguishChance: 0,
    startedTick: 0,
    discoveredTick: 0,
    lastWaterTick: 0,
    resolvedTick: 0,
    responseWellId: null,
  };
}
