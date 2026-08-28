import * as THREE from 'three';
import {
  BRIDGE_SUSPENSION_DEBUG_MODES,
  buildBridgeSuspensionStructure,
  setBridgeSuspensionDebugMode,
  type BridgeSuspensionDebugMode,
} from '../roads/BridgeSuspension.ts';
import { buildBridgeRailings } from '../roads/BridgeRailings.ts';
import { buildBridgeSupports } from '../roads/BridgeSupports.ts';
import type { BridgeSpan } from '../roads/RiverBridgeSpans.ts';

type BridgeVisualEvidence = {
  ready: boolean;
  view: string;
  debugMode: BridgeSuspensionDebugMode;
  noPost: true;
  deterministicInput: string;
  suspension: unknown;
  camera: { position: number[]; target: number[]; fov: number };
  renderer: { drawCalls: number; triangles: number };
};

declare global {
  interface Window {
    __bridgeVisualEvidence?: BridgeVisualEvidence;
  }
}

const rootElement = document.querySelector<HTMLElement>('#app');
if (!rootElement) throw new Error('Missing bridge visual-contract root');
const root = rootElement;
const detail = document.querySelector<HTMLElement>('#detail');
const params = new URLSearchParams(window.location.search);
const view = params.get('view') ?? 'design';
const requestedDebug = params.get('debug');
const debugMode: BridgeSuspensionDebugMode = BRIDGE_SUSPENSION_DEBUG_MODES.includes(
  requestedDebug as BridgeSuspensionDebugMode,
)
  ? requestedDebug as BridgeSuspensionDebugMode
  : 'final';
if (detail) {
  detail.textContent = `${view} camera · ${debugMode} load path · direct no-post render`;
}

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xb8cba9);
scene.fog = new THREE.Fog(0xc4d2b8, 45, 88);
const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 140);
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(root.clientWidth, root.clientHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
root.appendChild(renderer.domElement);

const bridgeCurve = new THREE.CatmullRomCurve3([
  new THREE.Vector3(-19, 0.75, -1.7),
  new THREE.Vector3(-13, 1.56, -1.05),
  new THREE.Vector3(-6.5, 1.72, -0.35),
  new THREE.Vector3(0, 1.76, 0.3),
  new THREE.Vector3(6.5, 1.72, 0.76),
  new THREE.Vector3(13, 1.56, 1.25),
  new THREE.Vector3(19, 0.75, 1.7),
], false, 'centripetal');
const path = bridgeCurve.getPoints(76);
const pathDistances = cumulativeDistances(path);
const totalLength = pathDistances[pathDistances.length - 1];
const span: BridgeSpan = {
  rampStart: 0,
  deckStart: 6.2,
  deckEnd: totalLength - 6.2,
  rampEnd: totalLength,
  deckY: 1.76,
};
const bridgeWidth = 3.15;

const timber = new THREE.MeshStandardMaterial({
  color: 0x6c4a31,
  roughness: 0.88,
  metalness: 0,
});
const timberDark = new THREE.MeshStandardMaterial({
  color: 0x402b1e,
  roughness: 0.92,
  metalness: 0,
});
const rope = new THREE.MeshStandardMaterial({
  color: 0x7b552f,
  roughness: 0.98,
  metalness: 0,
});
const plankMaterial = new THREE.MeshStandardMaterial({
  color: 0x9b7650,
  roughness: 0.94,
  metalness: 0,
});

scene.add(createBanks(), createWater(), createDeckPlanks());
const supports = buildBridgeSupports(
  path,
  bridgeWidth,
  [span],
  {
    isWaterAt: (x) => Math.abs(x) < 14,
    getTerrainY: () => -0.72,
    getWaterSurfaceY: () => 0,
  },
  timberDark,
);
if (supports) scene.add(supports);

const railingSections = path.map((point, index) => {
  const frame = sampleFrame(path, pathDistances, pathDistances[index]);
  const normal = frame?.normal ?? new THREE.Vector3(0, 0, 1);
  return {
    center: point,
    leftDeck: point.clone().addScaledVector(normal, -bridgeWidth * 0.5),
    rightDeck: point.clone().addScaledVector(normal, bridgeWidth * 0.5),
    bridgeBlend: 1,
  };
});
const railings = buildBridgeRailings(railingSections, timber);
if (railings) scene.add(railings);

const suspensionResult = buildBridgeSuspensionStructure(
  path,
  bridgeWidth,
  [span],
  timberDark,
  rope,
);
if (!suspensionResult) throw new Error('Bridge suspension visual fixture did not build');
const suspension = suspensionResult;
setBridgeSuspensionDebugMode(suspension, debugMode);
scene.add(suspension);

addLighting();
const target = applyCamera(view);

function render(): void {
  renderer.render(scene, camera);
  const evidence: BridgeVisualEvidence = {
    ready: true,
    view,
    debugMode,
    noPost: true,
    deterministicInput: 'fixed-bridge-curve-v1',
    suspension: suspension.userData.bridgeSuspension,
    camera: {
      position: camera.position.toArray(),
      target: target.toArray(),
      fov: camera.fov,
    },
    renderer: {
      drawCalls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
    },
  };
  window.__bridgeVisualEvidence = evidence;
  document.documentElement.dataset.bridgeReady = 'true';
  document.documentElement.dataset.bridgeEvidence = JSON.stringify(evidence);
}

window.addEventListener('resize', () => {
  camera.aspect = root.clientWidth / Math.max(1, root.clientHeight);
  camera.updateProjectionMatrix();
  renderer.setSize(root.clientWidth, root.clientHeight);
  render();
});
requestAnimationFrame(render);

function createDeckPlanks(): THREE.InstancedMesh {
  const spacing = 0.62;
  const plankCount = Math.floor(totalLength / spacing) + 1;
  const mesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(bridgeWidth, 0.14, spacing * 0.9),
    plankMaterial,
    plankCount,
  );
  mesh.name = 'Visual-contract bridge deck planks';
  const localForward = new THREE.Vector3(0, 0, 1);
  const matrix = new THREE.Matrix4();
  for (let index = 0; index < plankCount; index += 1) {
    const frame = sampleFrame(
      path,
      pathDistances,
      totalLength * index / Math.max(1, plankCount - 1),
    );
    if (!frame) continue;
    const quaternion = new THREE.Quaternion().setFromUnitVectors(localForward, frame.tangent);
    matrix.compose(
      frame.point.clone().add(new THREE.Vector3(0, -0.07, 0)),
      quaternion,
      new THREE.Vector3(1, 1, 1),
    );
    mesh.setMatrixAt(index, matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function createWater(): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(34, 15);
  geometry.rotateX(-Math.PI * 0.5);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
    color: 0x4d96a0,
    roughness: 0.3,
    metalness: 0.03,
    transparent: true,
    opacity: 0.88,
  }));
  mesh.name = 'Visual-contract river';
  mesh.position.y = -0.02;
  mesh.receiveShadow = true;
  return mesh;
}

function createBanks(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Visual-contract river banks';
  const material = new THREE.MeshStandardMaterial({
    color: 0x738c4d,
    roughness: 1,
    metalness: 0,
  });
  for (const x of [-21.5, 21.5]) {
    const bank = new THREE.Mesh(new THREE.BoxGeometry(9, 1.25, 22), material);
    bank.position.set(x, -0.5, 0);
    bank.receiveShadow = true;
    group.add(bank);
  }
  return group;
}

function addLighting(): void {
  scene.add(new THREE.HemisphereLight(0xe7f1d8, 0x4b4437, 2.25));
  const sun = new THREE.DirectionalLight(0xffd89b, 4.3);
  sun.position.set(-22, 32, 18);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -36;
  sun.shadow.camera.right = 36;
  sun.shadow.camera.top = 28;
  sun.shadow.camera.bottom = -28;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 80;
  sun.shadow.normalBias = 0.025;
  scene.add(sun, sun.target);
}

function applyCamera(selected: string): THREE.Vector3 {
  const presets: Record<string, { position: THREE.Vector3; target: THREE.Vector3; fov: number }> = {
    near: {
      position: new THREE.Vector3(5.5, 5.1, 8.8),
      target: new THREE.Vector3(1.5, 1.55, 0.2),
      fov: 43,
    },
    far: {
      position: new THREE.Vector3(34, 24, 39),
      target: new THREE.Vector3(0, 1, 0),
      fov: 48,
    },
    design: {
      position: new THREE.Vector3(24, 14.5, 23),
      target: new THREE.Vector3(-1, 1.1, 0),
      fov: 45,
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

function cumulativeDistances(points: readonly THREE.Vector3[]): number[] {
  const distances = [0];
  for (let index = 1; index < points.length; index += 1) {
    distances.push(
      distances[index - 1]
      + Math.hypot(
        points[index].x - points[index - 1].x,
        points[index].z - points[index - 1].z,
      ),
    );
  }
  return distances;
}

function sampleFrame(
  points: readonly THREE.Vector3[],
  distances: readonly number[],
  requestedDistance: number,
): { point: THREE.Vector3; tangent: THREE.Vector3; normal: THREE.Vector3 } | null {
  if (points.length < 2) return null;
  const distance = THREE.MathUtils.clamp(
    requestedDistance,
    0,
    distances[distances.length - 1],
  );
  let segment = 0;
  while (segment < points.length - 2 && distances[segment + 1] < distance) {
    segment += 1;
  }
  const startDistance = distances[segment];
  const endDistance = distances[segment + 1];
  const t = endDistance <= startDistance
    ? 0
    : (distance - startDistance) / (endDistance - startDistance);
  const tangent = new THREE.Vector3(
    points[segment + 1].x - points[segment].x,
    0,
    points[segment + 1].z - points[segment].z,
  ).normalize();
  return {
    point: points[segment].clone().lerp(points[segment + 1], t),
    tangent,
    normal: new THREE.Vector3(-tangent.z, 0, tangent.x),
  };
}
