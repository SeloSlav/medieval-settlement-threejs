import * as THREE from 'three';
import { BanditCampRenderer } from '../security/BanditCampRenderer.ts';
import type { Terrain } from '../terrain/Terrain.ts';

const host = document.querySelector<HTMLElement>('#app')!;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
host.append(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9fa58f);
scene.fog = new THREE.Fog(0x9fa58f, 38, 70);
const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.1, 120);
camera.position.set(18, 13, 23);
camera.lookAt(0, 1.4, 0);
scene.add(new THREE.HemisphereLight(0xdde3cb, 0x4d4437, 2.25));
const sun = new THREE.DirectionalLight(0xffe2b0, 3.4);
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
camps.sync([
  { id: 'bandit-camp-11', x: -8, z: 0, health: 180, maxHealth: 180, active: true, stolenGoods: 18, spawnedTick: 0, nextTheftTick: 0, lastTheftTick: 0, destroyedTick: 0 },
  { id: 'bandit-camp-12', x: 8, z: 0, health: 0, maxHealth: 180, active: false, stolenGoods: 0, spawnedTick: 0, nextTheftTick: 0, lastTheftTick: 0, destroyedTick: 1 },
]);

const labelTexture = (text: string) => {
  const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 96;
  const context = canvas.getContext('2d')!; context.fillStyle = '#1b1c18dd'; context.fillRect(0, 0, 512, 96);
  context.font = 'bold 35px Georgia'; context.textAlign = 'center'; context.fillStyle = '#eee6d1'; context.fillText(text, 256, 59);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; return texture;
};
for (const [text, x] of [['ACTIVE BANDIT CAMP', -8], ['DESTROYED / RECOVERED', 8]] as const) {
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture(text), depthTest: false }));
  sprite.position.set(x, 7.5, 0); sprite.scale.set(8, 1.5, 1); scene.add(sprite);
}

function frame(): void {
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
frame();
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight);
});

(window as unknown as { __BANDIT_CAMP_QA__: unknown }).__BANDIT_CAMP_QA__ = {
  seed: 11,
  camera: [18, 13, 23],
  campCount: 2,
  renderer: () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles }),
};
