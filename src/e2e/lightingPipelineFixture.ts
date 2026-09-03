import * as THREE from 'three';
import { createPreferredRenderer, setRendererAnimationLoop } from '../scene/RendererBackend.ts';
import { createPostProcessor } from '../scene/PostProcessing.ts';
import { SceneAtmosphere } from '../scene/SceneAtmosphere.ts';

const status = document.querySelector('#status')!;
window.addEventListener('error', event => { status.textContent = String(event.error ?? event.message); });
window.addEventListener('unhandledrejection', event => { status.textContent = String(event.reason); });
try {
  const backend = await createPreferredRenderer();
  const renderer = backend.renderer;
  renderer.setPixelRatio(1); renderer.setSize(innerWidth, innerHeight);
  renderer.toneMappingExposure = 0.86;
  document.body.append(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x718995);
  scene.fog = new THREE.FogExp2(0x9fbccc, 0.0012);
  const atmosphere = new SceneAtmosphere(scene.fog);
  scene.fogNode = atmosphere.node as never;
  const hemisphere = new THREE.HemisphereLight(0xd9e8ec, 0x59634f, 0.65);
  const ambient = new THREE.AmbientLight(0xb8c8d2, 0.075);
  const sun = new THREE.DirectionalLight(0xffefd2, 3.38);
  sun.position.set(-12, 20, 8); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -25, right: 25, top: 25, bottom: -25, near: 0.5, far: 80 });
  sun.shadow.normalBias = 0.025;
  scene.add(hemisphere, ambient, sun, sun.target);
  const material = new THREE.MeshStandardMaterial({ color: 0x99917d, roughness: 0.92 });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), material);
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
  for (const [x, y, z, sx, sy, sz, color] of [
    [-2, 2, 0, 5, 4, 5, 0xddd6bf], [4, 3, -2, 1, 6, 8, 0xb2a890],
    [0, 0.3, 4, 1.4, 0.6, 1.4, 0x888270], [-5, 3, 4, 0.3, 6, 0.3, 0x725b43],
  ]) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), new THREE.MeshStandardMaterial({ color, roughness: 0.85 }));
    mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true; scene.add(mesh);
  }
  const emission = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.6), new THREE.MeshStandardMaterial({ color: 0, emissive: 0xff8b30, emissiveIntensity: 4 }));
  emission.position.set(4.55, 0.3, 2); scene.add(emission);
  const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 600);
  let angle = -0.65;
  function pose() { camera.position.set(Math.sin(angle) * 23, 16, Math.cos(angle) * 23); camera.lookAt(0, 1, 0); camera.updateMatrixWorld(); }
  pose();
  const post = createPostProcessor(backend, scene, camera, scene, { hemisphere, ambient }, atmosphere);
  post.setDayNightGrade({ saturation: 0.9, contrast: 1.035, warmth: 0.025, nightBlue: 0, vignette: 0.05 });
  document.querySelector<HTMLSelectElement>('[aria-label="Validation pass"]')!.onchange = event => post.setDiagnostic((event.target as HTMLSelectElement).value);
  document.querySelector<HTMLButtonElement>('#rotate')!.onclick = () => { angle += 0.6; pose(); };
  let frames = 0;
  setRendererAnimationLoop(renderer, () => {
    post.render(1 / 60);
    if (++frames % 30 === 1) status.textContent = JSON.stringify({ frames, backend: backend.kind, camera: camera.position.toArray() });
  });
  window.addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); post.setSize(innerWidth, innerHeight); });
  window.addEventListener('pagehide', () => { setRendererAnimationLoop(renderer, null); post.dispose(); renderer.dispose(); });
} catch (error) { status.textContent = String(error); console.error(error); }
