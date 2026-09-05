// @ts-nocheck -- browser imports and private renderer probes are intentional.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const baseUrl = process.env.HUNTING_REVIEW_URL ?? 'http://127.0.0.1:5175';
const output = 'artifacts/hunting-work';
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'chrome', args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 850 } });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/hunting-work-test', route => route.fulfill({ contentType: 'text/html', body: '<html><body style="margin:0"></body></html>' }));
  await page.goto(`${baseUrl}/hunting-work-test`);
  const result = await page.evaluate(async () => {
    const { THREE, WebGPURenderer } = await import('/scripts/fixtures/huntingWorkBrowser.ts');
    const { SettlementCrowdRenderer } = await import('/src/settlement/SettlementCrowdRenderer.ts');
    const { buildCrowdViewState } = await import('/src/settlement/crowdView.ts');
    const { huntingShotCooldown, HUNTING_SHOT_SECONDS } = await import('/src/settlement/huntingWork.ts');
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#aebfce');
    scene.add(new THREE.HemisphereLight(0xeaf2ff, 0x71766d, 2));
    const light = new THREE.DirectionalLight(0xfff2da, 3);
    light.position.set(-3, 7, 5); scene.add(light);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.MeshStandardMaterial({ color: 0x8c967d }));
    ground.rotation.x = -Math.PI / 2; scene.add(ground);
    const parent = new THREE.Group(); scene.add(parent);
    const renderer = new WebGPURenderer({ antialias: true });
    renderer.setSize(innerWidth, innerHeight); document.body.append(renderer.domElement); await renderer.init();
    const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, .02, 100);
    camera.position.set(5, 3, 6); camera.lookAt(0, .95, 0);
    const crowd = new SettlementCrowdRenderer({ parent });
    if (!await crowd.ready) throw new Error('Crowd assets did not load');
    const view = buildCrowdViewState(0, 0, 25);
    const target = { id: 'deer', nodeId: 'game', x: 0, y: 1, z: 16, active: true };
    const agents = ['man', 'woman'].map((variant, slot) => ({
      id: `hunter-${variant}`, slot, variant, x: slot * 2.2 - 1.1, y: .02, z: 0,
      yaw: Math.atan2(1.1 - slot * 2.2, 16), appearanceSeed: 431 + slot,
      mode: 'wait', tool: 'bow', huntingBow: true, huntingTarget: target,
      huntingShotCooldown: huntingShotCooldown(HUNTING_SHOT_SECONDS), movementSpeed: 0,
      tunicColor: slot ? 0x637d8d : 0x846646, skinColor: 0xc9946a, hairColor: 0x3d2b22, active: true,
    }));
    const releases = [];
    const originalRelease = crowd.combatProjectiles.spawnRelease.bind(crowd.combatProjectiles);
    crowd.combatProjectiles.spawnRelease = (kind, start, end, sequence) => {
      releases.push({ kind, start: start.toArray(), end: end.toArray() });
      originalRelease(kind, start, end, sequence);
    };
    const snapshot = () => agents.map(agent => {
      const visual = crowd.animated.get(agent.id);
      const names = [];
      visual.model.traverse(object => { if (object.userData.equipmentIdentity) names.push(object.userData.equipmentIdentity); });
      return { variant: agent.variant, tool: !!visual.tool, rig: !!visual.combatRig,
        action: visual.actionMode, nocked: visual.combatRig?.nockedArrow?.visible,
        boneCount: visual.skeleton.bones.length, equipment: names };
    });
    for (let frame = 0; frame < 98; frame++) {
      for (const agent of agents) agent.huntingShotCooldown = huntingShotCooldown(HUNTING_SHOT_SECONDS - frame / 30);
      crowd.syncAgents(agents, view, 1 / 30);
    }
    const shots = [...releases];
    const combatEvents = crowd.pendingCombatAttackEvents.length;
    for (const agent of agents) { agent.mode = 'walk'; agent.movementSpeed = 1.4; agent.huntingTarget = undefined; agent.huntingShotCooldown = undefined; }
    crowd.syncAgents(agents, view, .05);
    const walking = snapshot();
    // Assignment changes and pooled reuse must remove the hunting exception.
    const woman = agents[1];
    woman.huntingBow = false;
    crowd.syncAgents(agents, view, .05);
    const offDuty = { tool: !!crowd.animated.get(woman.id).tool, rig: !!crowd.animated.get(woman.id).combatRig };
    woman.huntingBow = true;
    crowd.syncAgents(agents, view, .05);
    const reassigned = snapshot();
    const show = async (mode) => {
      for (const agent of agents) {
        agent.mode = mode === 'walk' ? 'walk' : 'wait';
        agent.movementSpeed = mode === 'walk' ? 1.4 : 0;
        agent.huntingTarget = mode === 'walk' ? undefined : target;
        agent.huntingShotCooldown = mode === 'walk' ? undefined : .2;
      }
      for (let frame = 0; frame < 12; frame++) crowd.syncAgents(agents, view, 1 / 30);
      scene.updateMatrixWorld(true);
      await renderer.renderAsync(scene, camera);
      return snapshot();
    };
    window.huntingReview = { show, crowd, agents, scene, renderer, camera };
    const drawing = await show('draw');
    const { createDeerWildlifeVisuals } = await import('/src/foraging/DeerWildlifeVisuals.ts');
    const { VillagerRenderer } = await import('/src/settlement/VillagerRenderer.ts');
    const { gameClock } = await import('/src/world/gameCalendar.ts');
    const wildlife = await createDeerWildlifeVisuals({ getHeightAt: () => 0 }, [{ kind: 'game', x: 0, z: 22 }], 731);
    const node = { nodeId: 'foraging-game-0', kind: 'game', resource: 'game', x: 0, z: 22, remaining: 40, maxYield: 40 };
    wildlife.sync([node]);
    const workers = new VillagerRenderer({ parent: new THREE.Group(), getGameSpeed: () => 1,
      getHeightAt: () => 0, findHuntingTarget: query => wildlife.findHuntingTarget(query) });
    await workers.visualAssetsReady;
    const camp = { id: 'hunting-camp-qa', kind: 'hunters_hall', x: 0, z: 0, workRadius: 60,
      assignedLabor: 4, constructionComplete: true, timber: 0, ironwork: 0 };
    workers.setSchedule({ ...gameClock(0), hour: 10, minute: 0 }, false, false);
    workers.sync({ residences: [], buildings: [camp], quarries: [], foragingNodes: [node], trees: new Map(),
      treeRegistry: null, farmFields: [], pastures: [], roadNetwork: null });
    // Keep both authored bodies represented independently of roster seed changes.
    [...workers.agents.values()].forEach((agent, index) => { agent.modelVariant = index % 2 ? 'woman' : 'man'; });
    const liveReleases = [];
    workers.renderer.combatProjectiles.spawnRelease = (kind, origin, end) => {
      liveReleases.push({ kind, x: end.x, z: end.z });
    };
    const huntingVariants = new Set();
    const walkingAfterShooting = new Set();
    const shotPositions = new Map();
    for (let frame = 0; frame < 2400; frame++) {
      wildlife.update(1 / 30, null, 25);
      workers.tick(1 / 30, view);
      for (const agent of workers.agents.values()) {
        if (agent.huntingTarget && agent.workRemaining < .4 && agent.workRemaining > 0) {
          huntingVariants.add(agent.modelVariant);
          shotPositions.set(agent.id, { x: agent.x, z: agent.z });
        }
        const previous = shotPositions.get(agent.id);
        if (previous && agent.mode === 'walk' && Math.hypot(agent.x - previous.x, agent.z - previous.z) > 1) {
          walkingAfterShooting.add(agent.modelVariant);
        }
      }
      if (huntingVariants.size === 2 && walkingAfterShooting.size === 2 && liveReleases.length >= 4) break;
    }
    const integration = { workerCount: workers.agents.size, huntingVariants: [...huntingVariants].sort(),
      walkingAfterShooting: [...walkingAfterShooting].sort(), releases: liveReleases };
    wildlife.sync([{ ...node, remaining: 0 }]);
    const releasedBeforeDepletion = liveReleases.length;
    for (let frame = 0; frame < 120; frame++) workers.tick(1 / 30, view);
    integration.releasesAfterDepletion = liveReleases.length - releasedBeforeDepletion;
    workers.dispose(); wildlife.dispose();
    return { shots, combatEvents, walking, offDuty, reassigned, drawing, integration };
  });
  await page.screenshot({ path: `${output}/drawing.png` });
  await page.evaluate(() => window.huntingReview.show('walk'));
  await page.screenshot({ path: `${output}/walking.png` });
  assert.equal(result.shots.length, 2, 'each hunter releases one arrow per stop');
  for (const shot of result.shots) {
    assert.equal(shot.kind, 'arrow');
    assert.ok(Math.hypot(shot.end[0], shot.end[2] - 16) < .001, 'arrows target the live deer');
    assert.ok(shot.start.every(Number.isFinite));
  }
  assert.equal(result.combatEvents, 0, 'hunting releases stay out of military combat events');
  assert.equal(result.integration.workerCount, 4);
  assert.deepEqual(result.integration.huntingVariants, ['man', 'woman']);
  assert.deepEqual(result.integration.walkingAfterShooting, ['man', 'woman']);
  assert.ok(result.integration.releases.length >= 4);
  assert.ok(result.integration.releases.every(shot => shot.kind === 'arrow' && Math.hypot(shot.x, shot.z) <= 60));
  assert.equal(result.integration.releasesAfterDepletion, 0);
  assert.deepEqual(result.offDuty, { tool: false, rig: false });
  for (const pose of [...result.walking, ...result.reassigned, ...result.drawing]) {
    assert.equal(pose.tool, true, `${pose.variant} carries a bow`);
    assert.equal(pose.rig, true, `${pose.variant} uses the bow overlay`);
    assert.ok(pose.equipment.includes('bow-ammunition-kit'), `${pose.variant} wears the bowman quiver`);
  }
  for (const pose of result.walking) { assert.equal(pose.action, 'walk'); assert.equal(pose.nocked, false); }
  for (const pose of result.drawing) { assert.equal(pose.action, 'wait'); assert.equal(pose.nocked, true); }
  assert.deepEqual(errors, []);
  writeFileSync(`${output}/report.json`, JSON.stringify(result, null, 2));
  console.log('Male and female hunting bows, quivers, arrow release, walking and reassignment passed in Chrome/WebGPU.');
} finally { await browser.close(); }
