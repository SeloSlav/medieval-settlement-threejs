import * as THREE from 'three';
import { DryStoneWallRenderer } from '../decorations/DryStoneWallRenderer.ts';
import type {
  DryStoneWallDebugMode,
  DryStoneWallState,
} from '../decorations/DryStoneWall.ts';
import type { Terrain } from '../terrain/Terrain.ts';

type WallEvidence = {
  ready: boolean;
  seed: number;
  view: string;
  debugMode: DryStoneWallDebugMode;
  noPost: true;
  diagnostics: unknown;
  camera: { position: number[]; target: number[]; fov: number };
};

declare global {
  interface Window {
    __dryStoneWallVisualEvidence?: WallEvidence;
  }
}

const rootElement = document.querySelector<HTMLElement>('#app');
if (!rootElement) throw new Error('Missing visual-contract root');
const root = rootElement;

const params = new URLSearchParams(window.location.search);
const view = params.get('view') ?? 'design';
const requestedDebug = params.get('debug');
const debugMode: DryStoneWallDebugMode = (
  requestedDebug === 'courses'
  || requestedDebug === 'variants'
  || requestedDebug === 'moss-mask'
)
  ? requestedDebug
  : 'final';

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xa8bb9c);
scene.fog = new THREE.FogExp2(0xb9c4a8, 0.012);
const camera = new THREE.PerspectiveCamera(46, 1, 0.1, 180);
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(root.clientWidth, root.clientHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
root.appendChild(renderer.domElement);

const terrainSampler = { getHeightAt: terrainHeight } as Terrain;
const ground = createGround();
scene.add(ground);
const roadCurve = new THREE.CatmullRomCurve3([
  new THREE.Vector3(-27, 0, -8),
  new THREE.Vector3(-15, 0, -5),
  new THREE.Vector3(-3, 0, -1),
  new THREE.Vector3(9, 0, 2.5),
  new THREE.Vector3(25, 0, 8),
], false, 'centripetal');
const roadPath = roadCurve.getPoints(90).map((point) => (
  new THREE.Vector3(point.x, terrainHeight(point.x, point.z) + 0.025, point.z)
));
scene.add(createRoadRibbon(roadPath, 2.8));

const finalParent = new THREE.Group();
const previewParent = new THREE.Group();
scene.add(finalParent, previewParent);
const wallRenderer = new DryStoneWallRenderer({
  terrain: terrainSampler,
  parent: finalParent,
  previewParent,
});
wallRenderer.setDebugMode(debugMode);
const primaryWall = wallBesideCurve(roadCurve, 0.06, 0.94, 1, 'visual-wall-1', 1550);
const returnWall = wallBesideCurve(roadCurve, 0.17, 0.46, -1, 'visual-wall-2', 2471);
wallRenderer.sync([primaryWall, returnWall]);

addVegetation();
addLighting();
const target = applyCamera(view);

function render(): void {
  renderer.render(scene, camera);
  window.__dryStoneWallVisualEvidence = {
    ready: true,
    seed: 1550,
    view,
    debugMode,
    noPost: true,
    diagnostics: wallRenderer.group.userData.dryStoneWallDiagnostics,
    camera: {
      position: camera.position.toArray(),
      target: target.toArray(),
      fov: camera.fov,
    },
  };
  document.documentElement.dataset.wallReady = 'true';
  document.documentElement.dataset.wallEvidence = JSON.stringify(
    window.__dryStoneWallVisualEvidence,
  );
}

window.addEventListener('resize', () => {
  camera.aspect = root.clientWidth / Math.max(1, root.clientHeight);
  camera.updateProjectionMatrix();
  renderer.setSize(root.clientWidth, root.clientHeight);
  render();
});
requestAnimationFrame(render);

function terrainHeight(x: number, z: number): number {
  return Math.sin(x * 0.075) * 0.22
    + Math.cos(z * 0.09) * 0.17
    + Math.sin((x + z) * 0.035) * 0.14;
}

function createGround(): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(76, 56, 95, 70);
  geometry.rotateX(-Math.PI * 0.5);
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  const colors = new Float32Array(position.count * 3);
  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index);
    const z = position.getZ(index);
    position.setY(index, terrainHeight(x, z));
    const variation = 0.9 + Math.sin(x * 1.7 + z * 0.8) * 0.035;
    colors[index * 3] = 0.39 * variation;
    colors[index * 3 + 1] = 0.53 * variation;
    colors[index * 3 + 2] = 0.27 * variation;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    roughness: 1,
    metalness: 0,
  }));
  mesh.name = 'Visual-contract meadow terrain';
  mesh.receiveShadow = true;
  return mesh;
}

function createRoadRibbon(path: readonly THREE.Vector3[], width: number): THREE.Mesh {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (let index = 0; index < path.length; index += 1) {
    const before = path[Math.max(0, index - 1)];
    const after = path[Math.min(path.length - 1, index + 1)];
    const tangent = new THREE.Vector3(after.x - before.x, 0, after.z - before.z).normalize();
    const normal = new THREE.Vector3(-tangent.z, 0, tangent.x);
    for (const side of [-1, 1]) {
      positions.push(
        path[index].x + normal.x * width * 0.5 * side,
        path[index].y + 0.01,
        path[index].z + normal.z * width * 0.5 * side,
      );
      uvs.push(index / 4, side < 0 ? 0 : 1);
    }
    if (index > 0) {
      const base = index * 2;
      indices.push(base - 2, base - 1, base, base, base - 1, base + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
    color: 0xb18b58,
    roughness: 1,
    metalness: 0,
  }));
  mesh.name = 'Visual-contract dirt road';
  mesh.receiveShadow = true;
  return mesh;
}

function wallBesideCurve(
  curve: THREE.CatmullRomCurve3,
  start: number,
  end: number,
  side: -1 | 1,
  id: string,
  seed: number,
): DryStoneWallState {
  const path: Array<[number, number, number]> = [];
  const samples = 52;
  for (let index = 0; index <= samples; index += 1) {
    const t = THREE.MathUtils.lerp(start, end, index / samples);
    const point = curve.getPoint(t);
    const tangent = curve.getTangent(t).setY(0).normalize();
    const normal = new THREE.Vector3(-tangent.z, 0, tangent.x);
    const x = point.x + normal.x * 2.18 * side;
    const z = point.z + normal.z * 2.18 * side;
    path.push([x, terrainHeight(x, z), z]);
  }
  let length = 0;
  for (let index = 1; index < path.length; index += 1) {
    length += Math.hypot(path[index][0] - path[index - 1][0], path[index][2] - path[index - 1][2]);
  }
  return {
    id,
    seed,
    controlPoints: path,
    sampledPath: path,
    length,
    revision: 1,
  };
}

function addVegetation(): void {
  const geometry = new THREE.DodecahedronGeometry(0.65, 0);
  const material = new THREE.MeshStandardMaterial({
    color: 0x607a38,
    roughness: 1,
    metalness: 0,
  });
  const bushes = new THREE.InstancedMesh(geometry, material, 34);
  bushes.name = 'Visual-contract roadside scrub';
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  for (let index = 0; index < bushes.count; index += 1) {
    const x = -25 + (index * 7.31) % 51;
    const z = -14 + (index * 11.17) % 28;
    if (Math.abs(z - (x * 0.28 + 0.4)) < 4) {
      position.set(x, terrainHeight(x, z) + 0.45, z + 5.4);
    } else {
      position.set(x, terrainHeight(x, z) + 0.45, z);
    }
    const size = 0.62 + (index % 5) * 0.09;
    scale.set(size * 1.15, size, size);
    matrix.compose(position, quaternion, scale);
    bushes.setMatrixAt(index, matrix);
  }
  bushes.castShadow = true;
  bushes.receiveShadow = true;
  scene.add(bushes);
}

function addLighting(): void {
  scene.add(new THREE.HemisphereLight(0xe5efd8, 0x4b533b, 2.15));
  const sun = new THREE.DirectionalLight(0xffe0a6, 4.1);
  sun.position.set(-22, 34, 18);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -42;
  sun.shadow.camera.right = 42;
  sun.shadow.camera.top = 34;
  sun.shadow.camera.bottom = -34;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 90;
  sun.shadow.normalBias = 0.025;
  scene.add(sun, sun.target);
}

function applyCamera(selected: string): THREE.Vector3 {
  const presets: Record<string, { position: THREE.Vector3; target: THREE.Vector3; fov: number }> = {
    near: {
      position: new THREE.Vector3(2.5, 4.4, 10.5),
      target: new THREE.Vector3(-1.5, 0.85, -0.2),
      fov: 43,
    },
    far: {
      position: new THREE.Vector3(31, 32, 46),
      target: new THREE.Vector3(0, 0.2, 0),
      fov: 48,
    },
    design: {
      position: new THREE.Vector3(21, 19, 30),
      target: new THREE.Vector3(-1, 0.45, 0),
      fov: 46,
    },
  };
  const preset = presets[selected] ?? presets.design;
  camera.position.copy(preset.position);
  camera.fov = preset.fov;
  camera.aspect = root.clientWidth / Math.max(1, root.clientHeight);
  camera.updateProjectionMatrix();
  camera.lookAt(preset.target);
  return preset.target;
}
