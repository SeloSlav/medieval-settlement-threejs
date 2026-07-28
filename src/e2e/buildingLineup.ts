import * as THREE from 'three';
import { createBuildingMesh } from '../buildings/BuildingMeshes.ts';
import { initializeBuildingMaterialLibrary } from '../buildings/buildingMaterials.ts';
import { BUILDING_KINDS } from '../generated/gameBalance.ts';
import { getBuildingDefinition } from '../resources/buildings.ts';
import { createResidenceMesh } from '../residences/ResidenceMarkers.ts';
import { createConstructionSiteMesh } from '../buildings/ConstructionSiteMesh.ts';
import { createPreferredRenderer } from '../scene/RendererBackend.ts';
import {
  animateFoundersCampfire,
  FOUNDERS_CAMPFIRE_NAME,
} from '../buildings/meshes/foundersCampMesh.ts';

declare global {
  interface Window {
    __BUILDING_LINEUP_READY__?: boolean;
  }
}

const lineupParams = new URLSearchParams(window.location.search);
const requestedKind = lineupParams.get('kind');
const showStockedState = lineupParams.get('stocked') === '1';
const compareResidences = lineupParams.get('compare') === 'residences';
const selectedKinds = compareResidences
  ? []
  : requestedKind && BUILDING_KINDS.includes(requestedKind as (typeof BUILDING_KINDS)[number])
    ? [requestedKind as (typeof BUILDING_KINDS)[number]]
    : BUILDING_KINDS;
const STOCKED_PREVIEW_PREFIXES = [
  'MarketTimberStageSegment',
  'MarketStoneStageSegment',
  'MarketCratedStageSegment',
  'MarketAleStockpile',
  'MarketAleSegment',
  'MarketHoneyStockpile',
  'MarketHoneySegment',
  'MarketWineStockpile',
  'MarketWineSegment',
  'MarketClothStockpile',
  'MarketClothSegment',
  'CarpenterTimberStockpile',
  'CarpenterTimberSegment',
  'CarpenterIronworkStockpile',
  'CarpenterIronworkSegment',
  'CarpenterPolearmStockpile',
  'CarpenterPolearmSegment',
  'GuardhouseFoodStockpile',
  'GuardhouseFoodSegment',
  'GuardhousePolearmStockpile',
  'GuardhousePolearmSegment',
  'ThreshingGrainStockpile',
  'ThreshingGrainSegment',
  'ApiaryFoodStockpile',
  'ApiaryFoodSegment',
  'ApiaryHoneyStockpile',
  'ApiaryHoneySegment',
  'VineyardFoodStockpile',
  'VineyardFoodSegment',
  'VineyardWineStockpile',
  'VineyardWineSegment',
  'MonasteryFoodStockpile',
  'MonasteryFoodSegment',
  'MonasteryAleStockpile',
  'MonasteryAleSegment',
  'MonasteryHoneyStockpile',
  'MonasteryHoneySegment',
  'MonasteryWineStockpile',
  'MonasteryWineSegment',
] as const;
const COLS = compareResidences ? 4 : selectedKinds.length === 1 ? 1 : 7;
const ROWS = compareResidences || selectedKinds.length === 1 ? 1 : 4;
const root = document.querySelector<HTMLElement>('#lineup-root');
const labels = document.querySelector<HTMLElement>('#labels');
if (!root || !labels) throw new Error('Building lineup host is missing.');
labels.style.gridTemplateColumns = `repeat(${COLS}, minmax(0, 1fr))`;
labels.style.gridTemplateRows = `repeat(${ROWS}, minmax(0, 1fr))`;

const rendererBackend = await createPreferredRenderer();
const renderer = rendererBackend.renderer as unknown as THREE.WebGLRenderer;
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
root.prepend(renderer.domElement);

const viewSpecs = compareResidences
  ? [
      { mesh: createBuildingMesh('chapel'), label: 'Church' },
      { mesh: createResidenceMesh(1, 1), label: 'Residence · tier 1' },
      { mesh: createResidenceMesh(2, 2), label: 'Residence · tier 2' },
      { mesh: createResidenceMesh(3, 3), label: 'Residence · tier 3' },
    ]
  : [
      ...selectedKinds.map((kind) => {
        const mesh = createBuildingMesh(kind);
        if (showStockedState) {
          mesh.traverse((object) => {
            if (STOCKED_PREVIEW_PREFIXES.some((prefix) => object.name.startsWith(prefix))) {
              object.visible = true;
            }
          });
        }
        return {
          mesh,
          label: `${getBuildingDefinition(kind).label}${showStockedState && kind === 'marketplace' ? ' · staged export lots' : ''}`,
        };
      }),
      {
        mesh: createConstructionSiteMesh('village_storehouse', 0.75, 0.9, 1),
        label: 'Storehouse construction · 75%',
      },
    ].slice(0, selectedKinds.length === 1 ? 1 : undefined);

const comparisonLargest = compareResidences
  ? Math.max(...viewSpecs.map(({ mesh }) => {
      const size = new THREE.Box3().setFromObject(mesh).getSize(new THREE.Vector3());
      return Math.max(size.x, size.y * 1.2, size.z);
    }))
  : null;
const comparisonLookY = compareResidences
  ? new THREE.Box3().setFromObject(viewSpecs[0]!.mesh).getSize(new THREE.Vector3()).y * 0.4
  : null;

const views = viewSpecs.map((spec) => {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xa6b29a);
  scene.fog = new THREE.Fog(0xa6b29a, 32, 74);

  const building = spec.mesh;
  building.rotation.y = -0.1;
  building.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  });
  scene.add(building);

  const bounds = new THREE.Box3().setFromObject(building);
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  building.position.sub(new THREE.Vector3(center.x, bounds.min.y, center.z));

  const groundRadius = Math.max(11, Math.max(size.x, size.z) * 0.92);
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(groundRadius, 64),
    new THREE.MeshStandardMaterial({ color: 0x66794b, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI * 0.5;
  ground.position.y = -0.035;
  ground.receiveShadow = true;
  scene.add(ground);

  const path = new THREE.Mesh(
    new THREE.PlaneGeometry(Math.max(2.4, size.x * 0.27), groundRadius * 1.4),
    new THREE.MeshStandardMaterial({ color: 0x8e7d61, roughness: 1 }),
  );
  path.rotation.x = -Math.PI * 0.5;
  path.position.set(0, -0.025, groundRadius * 0.52);
  path.receiveShadow = true;
  scene.add(path);

  scene.add(new THREE.HemisphereLight(0xdbe5df, 0x4c3b2b, 2.25));
  const sun = new THREE.DirectionalLight(0xfff0cf, 3.25);
  sun.position.set(-12, 20, 13);
  sun.castShadow = true;
  sun.shadow.mapSize.set(512, 512);
  sun.shadow.camera.left = -18;
  sun.shadow.camera.right = 18;
  sun.shadow.camera.top = 18;
  sun.shadow.camera.bottom = -18;
  scene.add(sun);

  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 160);
  const largest = comparisonLargest ?? Math.max(size.x, size.y * 1.2, size.z);
  const distance = Math.max(13, largest / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5))) * 1.24);
  const direction = new THREE.Vector3(
    0.72,
    0.56,
    spec.mesh.name === "Founders' camp and open stockyard" ? -1 : 1,
  ).normalize();
  const lookY = comparisonLookY ?? Math.max(1.2, size.y * 0.43);
  camera.position.copy(direction.multiplyScalar(distance)).add(new THREE.Vector3(0, lookY, 0));
  camera.lookAt(0, lookY, 0);

  const cell = document.createElement('div');
  cell.className = 'cell';
  const label = document.createElement('div');
  label.className = 'label';
  label.textContent = spec.label;
  cell.append(label);
  labels.append(cell);
  return { scene, camera };
});

for (let index = views.length; index < COLS * ROWS; index++) {
  const cell = document.createElement('div');
  cell.className = 'cell';
  labels.append(cell);
}

function render(): void {
  const width = root!.clientWidth;
  const height = root!.clientHeight;
  renderer.setSize(width, height, false);
  renderer.setScissorTest(true);
  renderer.setClearColor(0x1a1e16, 1);
  renderer.clear();

  const cellWidth = width / COLS;
  const cellHeight = height / ROWS;
  for (let index = 0; index < views.length; index++) {
    const view = views[index]!;
    const col = index % COLS;
    const row = Math.floor(index / COLS);
    const x = Math.floor(col * cellWidth);
    const y = Math.floor(height - (row + 1) * cellHeight);
    const w = Math.ceil(cellWidth);
    const h = Math.ceil(cellHeight);
    view.camera.aspect = w / h;
    view.camera.updateProjectionMatrix();
    renderer.setViewport(x, y, w, h);
    renderer.setScissor(x, y, w, h);
    renderer.render(view.scene, view.camera);
  }
  renderer.setScissorTest(false);
}

await initializeBuildingMaterialLibrary(rendererBackend.maxAnisotropy);
render();
await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
render();
window.__BUILDING_LINEUP_READY__ = true;
document.body.dataset.ready = 'true';
document.body.dataset.rendererBackend = rendererBackend.kind;
window.addEventListener('resize', render);

let previousFrameMs = performance.now();
function animate(nowMs: number): void {
  const dtSeconds = Math.min(0.1, Math.max(0, nowMs - previousFrameMs) / 1000);
  previousFrameMs = nowMs;
  for (const view of views) {
    const campfire = view.scene.getObjectByName(FOUNDERS_CAMPFIRE_NAME);
    if (campfire instanceof THREE.Group) {
      animateFoundersCampfire(campfire, dtSeconds);
    }
  }
  render();
  requestAnimationFrame(animate);
}
if (selectedKinds.length === 1 && selectedKinds[0] === 'founders_camp') {
  requestAnimationFrame(animate);
}
