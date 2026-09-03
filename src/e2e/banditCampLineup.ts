import * as THREE from 'three';
import { BanditCampRenderer } from '../security/BanditCampRenderer.ts';
import type { Terrain } from '../terrain/Terrain.ts';
import { createPreferredRenderer } from '../scene/RendererBackend.ts';
import { initializeBuildingMaterialLibrary } from '../buildings/buildingMaterials.ts';
import { createFoundersCampMesh, animateCampfire, FOUNDERS_CAMPFIRE_NAME } from '../buildings/meshes/foundersCampMesh.ts';
import { CampStandardRenderer } from '../settlement/CampStandardRenderer.ts';
import { BuildingMarkers } from '../buildings/BuildingMarkers.ts';
import type { BuildingState } from '../resources/types.ts';
import { fireEffectFromRoot } from '../fires/FireEffect.ts';
import {
  beginRendererFrame,
  configureRendererFrameStats,
  readRendererFrameStats,
} from '../scene/rendererFrameStats.ts';

const params = new URLSearchParams(location.search);
const host = document.querySelector<HTMLElement>('#app')!;
const backend = await createPreferredRenderer();
const renderer = backend.renderer;
configureRendererFrameStats(renderer.info);
await initializeBuildingMaterialLibrary(backend.maxAnisotropy);
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = params.has('noPost') ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
host.append(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9fa58f);
scene.fog = new THREE.Fog(0x9fa58f, 38, 70);
const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.1, 120);
camera.position.set(18, 13, 23);
camera.lookAt(0, 1.4, 0);
scene.add(new THREE.HemisphereLight(0xdde3cb, 0x4d4437, params.has('night') ? 0.25 : 2.25));
const sun = new THREE.DirectionalLight(0xffe2b0, params.has('night') ? 0.12 : 3.4);
sun.position.set(-12, 18, 11);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -24; sun.shadow.camera.right = 24;
sun.shadow.camera.top = 18; sun.shadow.camera.bottom = -18;
scene.add(sun);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(80, 80),
  new THREE.MeshStandardMaterial({ color: 0x7f876b, roughness: 1 }),
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const parent = new THREE.Group();
scene.add(parent);
const terrain = { getHeightAt: () => 0 } as unknown as Terrain;
const camps = new BanditCampRenderer(terrain, parent);
camps.setCampfireNightLighting(params.has('night') ? 1 : 0);
const campSeed = Number(params.get('seed') ?? 11);
camps.sync([
  { id: `bandit-camp-${campSeed}`, x: -8, z: 0, health: 180, maxHealth: 180, active: true, stolenGoods: 18, spawnedTick: 0, nextTheftTick: 0, lastTheftTick: 0, destroyedTick: 0 },
  { id: 'bandit-camp-12', x: 8, z: 0, health: 0, maxHealth: 180, active: false, stolenGoods: 0, spawnedTick: 0, nextTheftTick: 0, lastTheftTick: 0, destroyedTick: 1 },
]);
const founders = params.has('founders') ? createFoundersCampMesh() : null;
const founderStandards = new CampStandardRenderer(parent);
if (founders) {
  founders.position.set(11, 0, 0);
  parent.add(founders);
}
const hunterMarkers = new BuildingMarkers({ terrain, parent });
hunterMarkers.setCampfireNightLighting(params.has('night') ? 1 : 0);
let hunterState = {
  id: 'campfire-qa-hunter', kind: 'hunters_hall', x: 11, z: 0, yaw: 0,
  workRadius: 0, actionCooldown: 999, assignedLabor: params.has('unstaffed') ? 0 : 1,
  timber: 0, firewood: 0, stone: 0, water: 0, food: 0,
  ale: 0, preservedFood: 0, honey: 0, wine: 0, wool: 0, cloth: 0,
  ironwork: 0, polearms: 0, gold: 0, waterCapacity: 0,
  constructionComplete: true, constructionProgress: 1,
  constructionRequiredTimber: 0, constructionRequiredStone: 0,
  constructionDeliveredTimber: 0, constructionDeliveredStone: 0,
  constructionReservedTimber: 0, constructionReservedStone: 0,
  constructionTreasuryTimber: 0, constructionTreasuryStone: 0,
  storehouseAcceptsTimber: true, storehouseAcceptsStone: true, storehouseAcceptsFirewood: true,
} satisfies BuildingState;
if (params.has('hunters')) {
  hunterMarkers.syncBuildings([hunterState]);
  const staffingToggle = document.createElement('button');
  staffingToggle.style.cssText = 'position:fixed;left:18px;bottom:18px;padding:12px;z-index:10';
  const updateLabel = () => {
    staffingToggle.textContent = hunterState.assignedLabor > 0 ? 'Remove hunter staff' : 'Assign hunter staff';
  };
  staffingToggle.addEventListener('click', () => {
    hunterState = { ...hunterState, assignedLabor: hunterState.assignedLabor > 0 ? 0 : 1 };
    hunterMarkers.syncBuildings([hunterState]);
    updateLabel();
  });
  updateLabel();
  document.body.append(staffingToggle);
}

const focus = params.get('focus');
const targetX = focus === 'founders' || focus === 'hunters' ? 11 : focus === 'bandit' ? -8 : 0;
const distanceScale = params.get('camera') === 'near' ? 0.65 : params.get('camera') === 'far' ? 1.65 : 1;
if (focus) {
  camera.position.set(targetX + 9 * distanceScale, 9 * distanceScale, 14 * distanceScale);
  camera.lookAt(targetX, 1.4, 0);
}
if (params.has('wireframe')) parent.traverse((object) => {
  if (!(object instanceof THREE.Mesh)) return;
  const materials = Array.isArray(object.material) ? object.material : [object.material];
  for (const material of materials) (material as THREE.MeshStandardMaterial).wireframe = true;
});

const labelTexture = (text: string) => {
  const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 96;
  const context = canvas.getContext('2d')!; context.fillStyle = '#1b1c18dd'; context.fillRect(0, 0, 512, 96);
  context.font = 'bold 35px Georgia'; context.textAlign = 'center'; context.fillStyle = '#eee6d1'; context.fillText(text, 256, 59);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; return texture;
};
for (const [text, x] of [['ACTIVE BANDIT CAMP', -8], [params.has('hunters') ? "HUNTER'S CAMP" : founders ? "FOUNDERS' CAMP" : 'DESTROYED / REMOVED', founders || params.has('hunters') ? 11 : 8]] as const) {
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture(text), depthTest: false }));
  sprite.position.set(x, 7.5, 0); sprite.scale.set(8, 1.5, 1); scene.add(sprite);
}

let lastFrameMs = performance.now();
let simulationFrames = 0;
let frameStats = { drawCalls: 0, renderPasses: 0, triangles: 0 };
const metrics = document.querySelector<HTMLElement>('.qa span');
function frame(nowMs = performance.now()): void {
  const dt = params.has('paused') ? (simulationFrames < 90 ? 1 / 30 : 0) : Math.min(0.05, (nowMs - lastFrameMs) / 1000);
  lastFrameMs = nowMs;
  simulationFrames += 1;
  camps.tick(dt);
  hunterMarkers.tick(dt);
  founderStandards.sync(founders ? [founders] : [], dt);
  const fire = founders?.getObjectByName(FOUNDERS_CAMPFIRE_NAME);
  if (fire instanceof THREE.Group) animateCampfire(fire, dt);
  const frameBoundary = beginRendererFrame(renderer.info);
  renderer.render(scene, camera);
  frameStats = readRendererFrameStats(renderer.info, frameBoundary);
  if (metrics && simulationFrames % 30 === 0) {
    const flags = camps.standardDiagnostics();
    metrics.textContent = `${backend.kind} · seed ${campSeed} · ${params.has('noPost') ? 'no post' : 'final'} · ${flags?.standards ?? 0} outlaw / ${founderStandards.diagnostics()?.standards ?? 0} founders flags · ${flags?.simulationNodes ?? 0} cloth nodes · ${flags?.drawCalls ?? 0} flag draws · max stretch ${flags?.maxStretchRatio.toFixed(3) ?? '—'}${params.has('hunters') ? ` · hunter ${hunterState.assignedLabor > 0 ? 'staffed / lit' : 'unstaffed / unlit'}` : ''} · ${frameStats.drawCalls} draws / ${frameStats.triangles} triangles`;
  }
  requestAnimationFrame(frame);
}
frame();
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight);
});

(window as unknown as { __BANDIT_CAMP_QA__: unknown }).__BANDIT_CAMP_QA__ = {
  seed: campSeed,
  camera: camera.position.toArray(),
  backend: backend.kind,
  standards: () => ({ bandit: camps.standardDiagnostics(), founders: founderStandards.diagnostics() }),
  activeCampCount: 1,
  renderer: () => ({ calls: frameStats.drawCalls, triangles: frameStats.triangles }),
  campfires: () => {
    const effects: unknown[] = [];
    parent.traverse((object) => {
      if (!(object instanceof THREE.Group) || object.userData.runtimeCampfireEffect !== true) return;
      const effect = fireEffectFromRoot(object)!;
      effects.push({
        name: object.name, active: effect.active, visible: object.visible,
        position: object.getWorldPosition(new THREE.Vector3()).toArray(),
        elapsed: effect.elapsedSeconds, lightIntensity: effect.light.intensity,
        flames: effect.flames.length, smoke: effect.smoke.length,
      });
    });
    return { assignedLabor: hunterState.assignedLabor, effects };
  },
};
