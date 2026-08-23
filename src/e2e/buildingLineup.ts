import * as THREE from 'three';
import { createBuildingMesh } from '../buildings/BuildingMeshes.ts';
import { initializeBuildingMaterialLibrary } from '../buildings/buildingMaterials.ts';
import { BUILDING_KINDS } from '../generated/gameBalance.ts';
import { getBuildingDefinition } from '../resources/buildings.ts';
import {
  createResidenceMesh,
  ResidenceMarkers,
} from '../residences/ResidenceMarkers.ts';
import { createDefaultNeeds } from '../residences/residenceNeedState.ts';
import { createConstructionSiteMesh } from '../buildings/ConstructionSiteMesh.ts';
import { createWaysideShrineMesh } from '../buildings/meshes/waysideShrineMesh.ts';
import { createPreferredRenderer } from '../scene/RendererBackend.ts';
import {
  animateFoundersCampfire,
  FOUNDERS_CAMPFIRE_NAME,
} from '../buildings/meshes/foundersCampMesh.ts';
import {
  FOUNDERS_CAMP_BENCH_SEAT,
  FOUNDERS_CAMP_FIRESIDE_STUMP_SEAT,
  type FoundersCampSeatLandmark,
} from '../buildings/foundersCampLandmarks.ts';
import {
  seatedVillagerContactHeight,
  SettlementCrowdRenderer,
  type CrowdRenderAgent,
  type VillagerModelVariant,
} from '../settlement/SettlementCrowdRenderer.ts';
import {
  beginRendererFrame,
  configureRendererFrameStats,
  readRendererFrameStats,
  type RendererFrameStats,
} from '../scene/rendererFrameStats.ts';

declare global {
  interface Window {
    __BUILDING_LINEUP_READY__?: boolean;
    __BUILDING_LINEUP_METRICS__?: {
      seed: number | null;
      camera: 'near' | 'design' | 'far';
      debugMode: 'final' | 'massing';
      presentation: 'final' | 'no-post';
      rendererBackend: string;
      viewport: readonly [number, number];
      dpr: number;
      drawCalls: number;
      triangles: number;
    };
  }
}

const lineupParams = new URLSearchParams(window.location.search);
const requestedCamera = lineupParams.get('camera');
const cameraBookmark = requestedCamera === 'near' || requestedCamera === 'far'
  ? requestedCamera
  : 'design';
const shrineDebugMode = lineupParams.get('debug') === 'massing' ? 'massing' : 'final';
const presentationMode = lineupParams.get('presentation') === 'no-post' ? 'no-post' : 'final';
const showWaysidePrayerVisitors = lineupParams.get('visitors') === 'prayer';
const showClearedFoundingStockyard = lineupParams.get('mode') === 'cleared-stockyard';
const requestedKind = showClearedFoundingStockyard
  ? 'founders_camp'
  : lineupParams.get('kind');
const showStockedState = lineupParams.get('stocked') === '1'
  || showClearedFoundingStockyard;
const showCampSeating = lineupParams.get('seating') === '1';
const compareResidences = lineupParams.get('compare') === 'residences';
const compareServiceCoverage = lineupParams.get('compare') === 'service-coverage';
const compareChurchTiers = lineupParams.get('compare') === 'church-tiers';
const comparisonMode = compareResidences || compareServiceCoverage || compareChurchTiers;
const selectedKinds = comparisonMode
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
  'MarketIronStockpile',
  'MarketIronSegment',
  'MarketSaltStockpile',
  'MarketSaltSegment',
  'MarketPotteryStockpile',
  'MarketPotterySegment',
  'SmokehouseFirewoodStockpile',
  'SmokehouseFirewoodSegment',
  'SmokehouseFreshFoodStockpile',
  'SmokehouseFreshFoodSegment',
  'SmokehouseSaltStockpile',
  'SmokehouseSaltSegment',
  'SmokehousePotteryStockpile',
  'SmokehousePotterySegment',
  'SmokehousePreservedFoodStockpile',
  'SmokehousePreservedFoodSegment',
  'ClayPitStockpile',
  'ClayPitClaySegment',
  'CivilianToolStockpile',
  'CivilianToolSegment',
  'FoundingIronworkStockpile',
  'FoundingIronworkSegment',
  'CharcoalBurnerFirewoodStockpile',
  'CharcoalBurnerFirewoodSegment',
  'CharcoalBurnerStockpile',
  'CharcoalBurnerCharcoalSegment',
  'CharcoalClampSmoke',
  'SmithyIronStockpile',
  'SmithyIronSegment',
  'SmithyCharcoalStockpile',
  'SmithyCharcoalSegment',
  'SmithyIronworkStockpile',
  'SmithyIronworkSegment',
  'PotterClayStockpile',
  'PotterClaySegment',
  'PotterFirewoodStockpile',
  'PotterFirewoodSegment',
  'PotterPotteryStockpile',
  'PotterPotterySegment',
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
  'PastoralSaltStockpile',
  'PastoralSaltSegment',
  'ApiaryHoneyStockpile',
  'ApiaryHoneySegment',
  'MonasteryFoodStockpile',
  'MonasteryFoodSegment',
  'MonasteryCiderStockpile',
  'MonasteryCiderSegment',
  'MonasteryMeadStockpile',
  'MonasteryMeadSegment',
  'MonasteryHoneyStockpile',
  'MonasteryHoneySegment',
  'MonasteryWineStockpile',
  'MonasteryWineSegment',
] as const;
const COLS = compareServiceCoverage
  ? 2
  : compareChurchTiers
    ? 3
  : compareResidences
    ? 4
    : selectedKinds.length === 1
      ? 1
      : 9;
const ROWS = comparisonMode || selectedKinds.length === 1
  ? 1
  : Math.ceil((selectedKinds.length + 1) / COLS);
const root = document.querySelector<HTMLElement>('#lineup-root');
const labels = document.querySelector<HTMLElement>('#labels');
if (!root || !labels) throw new Error('Building lineup host is missing.');
const labelBandHeight = Number.parseFloat(
  getComputedStyle(document.documentElement).getPropertyValue('--lineup-label-band-height'),
) || 38;
if (compareServiceCoverage) {
  const heading = document.querySelector('h1');
  const subtitle = document.querySelector('header p');
  if (heading) heading.textContent = 'Service Territory Readability';
  if (subtitle) {
    subtitle.textContent = 'Actual assignments · one instanced draw per overlay';
  }
} else if (compareChurchTiers) {
  const heading = document.querySelector('h1');
  const subtitle = document.querySelector('header p');
  if (heading) heading.textContent = 'Church Upgrade Lineup';
  if (subtitle) subtitle.textContent = 'Reserved final footprint · timber → stone → landmark';
}
labels.style.gridTemplateColumns = `repeat(${COLS}, minmax(0, 1fr))`;
labels.style.gridTemplateRows = `repeat(${ROWS}, minmax(0, 1fr))`;

const rendererBackend = await createPreferredRenderer();
const renderer = rendererBackend.renderer as unknown as THREE.WebGLRenderer;
configureRendererFrameStats(renderer.info);
let lastRendererFrameStats: RendererFrameStats = {
  drawCalls: 0,
  renderPasses: 0,
  triangles: 0,
};
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = presentationMode === 'no-post'
  ? THREE.NoToneMapping
  : THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = presentationMode === 'no-post' ? 1 : 1.08;
root.prepend(renderer.domElement);

const viewSpecs = compareServiceCoverage
  ? [
      {
        mesh: createServiceCoveragePreview('well'),
        label: 'Well water · 4 claimed homes · 1 outside the territory',
      },
      {
        mesh: createServiceCoveragePreview('marketplace'),
        label: 'Marketplace · 4 assigned homes · 1 outside the territory',
      },
    ]
  : compareChurchTiers
  ? [
      { mesh: createBuildingMesh('chapel', 1), label: 'Tier 1 · Small wooden church' },
      { mesh: createBuildingMesh('chapel', 2), label: 'Tier 2 · Small stone church' },
      { mesh: createBuildingMesh('chapel', 3), label: 'Tier 3 · Large stone church' },
    ]
  : compareResidences
  ? [
      { mesh: createBuildingMesh('chapel'), label: 'Church' },
      { mesh: createResidenceMesh(1, 1), label: 'Residence · tier 1' },
      { mesh: createResidenceMesh(2, 2), label: 'Residence · tier 2' },
      { mesh: createResidenceMesh(3, 3), label: 'Residence · tier 3' },
    ]
  : [
      ...selectedKinds.map((kind) => {
        const mesh = kind === 'wayside_shrine'
          ? createWaysideShrineMesh(shrineDebugMode)
          : createBuildingMesh(kind);
        if (showStockedState) {
          mesh.traverse((object) => {
            if (STOCKED_PREVIEW_PREFIXES.some((prefix) => object.name.startsWith(prefix))) {
              object.visible = true;
            }
          });
        }
        if (showClearedFoundingStockyard && kind === 'founders_camp') {
          const shelters = mesh.getObjectByName('FoundingShelters');
          if (shelters) shelters.visible = false;
          const timber = mesh.getObjectByName('FoundingTimberStockpile');
          if (timber) timber.visible = false;
          const stone = mesh.getObjectByName('FoundingStoneStockpile');
          if (stone) stone.visible = false;
          const chest = mesh.getObjectByName('FoundingTreasuryChest');
          if (chest) chest.visible = true;
          const ironwork = mesh.getObjectByName('FoundingIronworkStockpile');
          if (ironwork) {
            ironwork.visible = true;
            for (const segment of ironwork.children) segment.visible = true;
          }
        }
        return {
          mesh,
          label: `${getBuildingDefinition(kind).label}${showStockedState && kind === 'marketplace' ? ' · staged export lots' : ''}${showClearedFoundingStockyard && kind === 'founders_camp' ? ' · shelters cleared, stores remain' : ''}`,
        };
      }),
      {
        mesh: createConstructionSiteMesh('village_storehouse', 0.75, 0.9, 1),
        label: 'Storehouse construction · 75%',
      },
    ].slice(0, selectedKinds.length === 1 ? 1 : undefined);

const comparisonLargest = comparisonMode
  ? Math.max(...viewSpecs.map(({ mesh }) => {
      const size = new THREE.Box3().setFromObject(mesh).getSize(new THREE.Vector3());
      return Math.max(size.x, size.y * 1.2, size.z);
    }))
  : null;
const comparisonLookY = comparisonMode
  ? new THREE.Box3().setFromObject(viewSpecs[0]!.mesh).getSize(new THREE.Vector3()).y * 0.4
  : null;

const views = viewSpecs.map((spec) => {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xa6b29a);
  scene.fog = new THREE.Fog(
    0xa6b29a,
    compareServiceCoverage ? 64 : 32,
    compareServiceCoverage ? 132 : 74,
  );

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
  const footprintScale = Math.max(size.x, size.z);
  if (!compareServiceCoverage && scene.fog instanceof THREE.Fog) {
    // Large estate buildings (notably the monastery precinct) used to sit
    // entirely beyond the fixed 74 m fog curtain, leaving their QA cell blank.
    scene.fog.near = Math.max(scene.fog.near, footprintScale * 0.62);
    scene.fog.far = Math.max(scene.fog.far, footprintScale * 2.7);
  }
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

  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, Math.max(160, footprintScale * 4));
  const largest = comparisonLargest ?? Math.max(size.x, size.y * 1.2, size.z);
  const designDistance = Math.max(
    13,
    largest
      / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5)))
      * (compareServiceCoverage ? 1.08 : 1.24),
  );
  const distance = designDistance * (
    cameraBookmark === 'near' ? 0.66 : cameraBookmark === 'far' ? 1.8 : 1
  );
  const direction = (
    compareServiceCoverage
      ? new THREE.Vector3(0.62, 0.82, 1)
      : new THREE.Vector3(
          0.72,
          0.56,
          spec.mesh.name === "Founders' camp and open stockyard" ? -1 : 1,
        )
  ).normalize();
  const lookY = comparisonLookY ?? Math.max(1.2, size.y * 0.43);
  camera.position.copy(direction.multiplyScalar(distance)).add(new THREE.Vector3(0, lookY, 0));
  camera.lookAt(0, lookY, 0);

  const campSeating = building.name === "Founders' camp and open stockyard"
    && showCampSeating
    ? createCampSeatingPreview(scene, building)
    : null;
  const waysidePrayer = showWaysidePrayerVisitors
    && building.name === 'Gorski Kotar Wayside Shrine'
    ? createWaysidePrayerPreview(scene, building)
    : null;
  if (campSeating) {
    const benchFocus = building.localToWorld(new THREE.Vector3(
      FOUNDERS_CAMP_BENCH_SEAT.supportPosition.x,
      FOUNDERS_CAMP_BENCH_SEAT.surfaceHeight,
      FOUNDERS_CAMP_BENCH_SEAT.supportPosition.z,
    ));
    const stumpFocus = building.localToWorld(new THREE.Vector3(
      FOUNDERS_CAMP_FIRESIDE_STUMP_SEAT.supportPosition.x,
      FOUNDERS_CAMP_FIRESIDE_STUMP_SEAT.surfaceHeight,
      FOUNDERS_CAMP_FIRESIDE_STUMP_SEAT.supportPosition.z,
    ));
    const seatFocus = benchFocus.add(stumpFocus).multiplyScalar(0.5);
    camera.position.copy(new THREE.Vector3(0.72, 0.46, -1).normalize())
      .multiplyScalar(9)
      .add(seatFocus);
    camera.lookAt(seatFocus);
  }

  const cell = document.createElement('div');
  cell.className = 'cell';
  const label = document.createElement('div');
  label.className = 'label';
  label.textContent = spec.label;
  cell.append(label);
  labels.append(cell);
  return { scene, camera, campSeating, waysidePrayer };
});

for (let index = views.length; index < COLS * ROWS; index++) {
  const cell = document.createElement('div');
  cell.className = 'cell';
  labels.append(cell);
}

function render(): void {
  const frameBoundary = beginRendererFrame(renderer.info);
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
    const cellRight = Math.floor((col + 1) * cellWidth);
    const cellTop = Math.floor(row * cellHeight);
    const cellBottom = Math.floor((row + 1) * cellHeight);
    const w = Math.max(1, cellRight - x);
    const h = Math.max(1, cellBottom - cellTop - labelBandHeight);
    // WebGPURenderer (including its WebGL2 node backend) owns a top-left
    // viewport origin. Only the legacy WebGLRenderer path uses bottom-left.
    // Applying the WebGL flip unconditionally rendered the correct meshes in
    // vertically reversed label rows.
    const y = Math.floor(
      rendererBackend.kind === 'webgl'
        ? height - cellBottom + labelBandHeight
        : cellTop,
    );
    view.camera.aspect = w / h;
    view.camera.updateProjectionMatrix();
    renderer.setViewport(x, y, w, h);
    renderer.setScissor(x, y, w, h);
    renderer.render(view.scene, view.camera);
  }
  renderer.setScissorTest(false);
  lastRendererFrameStats = readRendererFrameStats(renderer.info, frameBoundary);
}

await initializeBuildingMaterialLibrary(rendererBackend.maxAnisotropy);
await Promise.all(
  views.map((view) => view.waysidePrayer?.renderer.ready ?? Promise.resolve(true)),
);
for (const view of views) {
  view.waysidePrayer?.renderer.syncAgents(
    view.waysidePrayer.agents,
    { centerX: 0, centerZ: 0, viewRadius: 80, shadowRadius: 80 },
    0.25,
  );
}
render();
await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
render();
window.__BUILDING_LINEUP_READY__ = true;
window.__BUILDING_LINEUP_METRICS__ = {
  seed: selectedKinds.length === 1 && selectedKinds[0] === 'wayside_shrine' ? 1733 : null,
  camera: cameraBookmark,
  debugMode: shrineDebugMode,
  presentation: presentationMode,
  rendererBackend: rendererBackend.kind,
  viewport: [root.clientWidth, root.clientHeight],
  dpr: renderer.getPixelRatio(),
  drawCalls: lastRendererFrameStats.drawCalls,
  triangles: lastRendererFrameStats.triangles,
};
document.body.dataset.ready = 'true';
document.body.dataset.rendererBackend = rendererBackend.kind;
window.addEventListener('resize', render);

function createServiceCoveragePreview(
  kind: 'well' | 'marketplace',
): THREE.Group {
  const group = new THREE.Group();
  const markers = new ResidenceMarkers(group);
  const prefix = kind === 'well' ? 'water' : 'market';
  const homes = [
    { x: -8.5, z: -6.5, tier: 1 as const },
    { x: 8.5, z: -6.5, tier: 2 as const },
    { x: -8.5, z: 6.5, tier: 2 as const },
    { x: 8.5, z: 6.5, tier: 3 as const },
    { x: 0, z: 17.5, tier: 1 as const },
  ].map((home, index) => ({
    id: `${prefix}-home-${index}`,
    zoneId: `${prefix}-zone`,
    parcelIndex: index,
    x: home.x,
    z: home.z,
    yaw: index % 2 === 0 ? 0.06 : -0.08,
    population: 4,
    populationCapacity: 6,
    tier: home.tier,
    settlementTicks: 0,
    needs: createDefaultNeeds(),
    abandoned: false,
    householdWealth: 8,
  }));
  markers.syncResidences(homes, () => 0);
  markers.setServiceCoverageHighlights(
    new Set(homes.slice(0, 4).map((home) => home.id)),
    kind,
  );
  group.userData.residenceMarkers = markers;

  const serviceBuilding = createBuildingMesh(kind);
  serviceBuilding.position.set(0, 0, 4.5);
  group.add(serviceBuilding);
  return group;
}

let previousFrameMs = performance.now();
function animate(nowMs: number): void {
  const dtSeconds = Math.min(0.1, Math.max(0, nowMs - previousFrameMs) / 1000);
  previousFrameMs = nowMs;
  for (const view of views) {
    const campfire = view.scene.getObjectByName(FOUNDERS_CAMPFIRE_NAME);
    if (campfire instanceof THREE.Group) {
      animateFoundersCampfire(campfire, dtSeconds);
    }
    view.campSeating?.renderer.syncAgents(
      view.campSeating.agents,
      {
        centerX: 0,
        centerZ: 0,
        viewRadius: 80,
        shadowRadius: 80,
      },
      dtSeconds,
    );
    view.waysidePrayer?.renderer.syncAgents(
      view.waysidePrayer.agents,
      {
        centerX: 0,
        centerZ: 0,
        viewRadius: 80,
        shadowRadius: 80,
      },
      dtSeconds,
    );
  }
  render();
  requestAnimationFrame(animate);
}
if (
  (selectedKinds.length === 1 && selectedKinds[0] === 'founders_camp')
  || showWaysidePrayerVisitors
) {
  requestAnimationFrame(animate);
}

function createWaysidePrayerPreview(
  scene: THREE.Scene,
  shrine: THREE.Object3D,
): {
  renderer: SettlementCrowdRenderer;
  agents: CrowdRenderAgent[];
} {
  shrine.updateMatrixWorld(true);
  const lookAt = shrine.localToWorld(new THREE.Vector3(0, 1.15, 0.42));
  const agents = [-0.58, 0, 0.58].map((lateral, index): CrowdRenderAgent => {
    const position = shrine.localToWorld(new THREE.Vector3(lateral, 0.02, 1.72));
    return {
      id: `wayside-prayer-preview-${index}`,
      slot: index,
      x: position.x,
      y: position.y,
      z: position.z,
      yaw: Math.atan2(lookAt.x - position.x, lookAt.z - position.z),
      appearanceSeed: 0x0031_0000 + index * 0x000f_1937,
      variant: index === 1 ? 'woman' : 'man',
      mode: 'pray',
      tunicColor: [0x596342, 0x6f4b3c, 0x485b6d][index]!,
      skinColor: 0xb87952,
      hairColor: 0x3a2418,
      tool: null,
      movementSpeed: 0,
      active: true,
    };
  });
  const parent = new THREE.Group();
  parent.name = 'Wayside shrine prayer preview';
  scene.add(parent);
  const renderer = new SettlementCrowdRenderer({ parent });
  renderer.syncAgents(
    agents,
    { centerX: 0, centerZ: 0, viewRadius: 80, shadowRadius: 80 },
  );
  return { renderer, agents };
}

function createCampSeatingPreview(
  scene: THREE.Scene,
  camp: THREE.Group,
): {
  renderer: SettlementCrowdRenderer;
  agents: CrowdRenderAgent[];
} {
  camp.updateMatrixWorld(true);
  const seats: ReadonlyArray<{
    landmark: FoundersCampSeatLandmark;
    variant: VillagerModelVariant;
    appearanceSeed: number;
    tunicColor: number;
  }> = [
    {
      landmark: FOUNDERS_CAMP_BENCH_SEAT,
      variant: 'man',
      appearanceSeed: 0x0080_0000,
      tunicColor: 0x6d402c,
    },
    {
      landmark: FOUNDERS_CAMP_FIRESIDE_STUMP_SEAT,
      variant: 'woman',
      appearanceSeed: 0x007f_0000,
      tunicColor: 0x4e5f77,
    },
  ];
  const campGroundY = camp.localToWorld(new THREE.Vector3()).y;
  const agents = seats.map((seat, index): CrowdRenderAgent => {
    const destination = camp.localToWorld(new THREE.Vector3(
      seat.landmark.destination.x,
      0,
      seat.landmark.destination.z,
    ));
    const lookAt = camp.localToWorld(new THREE.Vector3(
      seat.landmark.lookAt.x,
      0,
      seat.landmark.lookAt.z,
    ));
    return {
      id: `camp-seat-preview-${index}`,
      slot: index,
      x: destination.x,
      y: campGroundY
        + seat.landmark.surfaceHeight
        - seatedVillagerContactHeight(seat.variant, seat.appearanceSeed),
      z: destination.z,
      yaw: Math.atan2(lookAt.x - destination.x, lookAt.z - destination.z),
      appearanceSeed: seat.appearanceSeed,
      variant: seat.variant,
      mode: seat.landmark.behavior,
      tunicColor: seat.tunicColor,
      skinColor: 0xb87952,
      hairColor: 0x3a2418,
      tool: null,
      movementSpeed: 0,
      active: true,
    };
  });
  const crowdParent = new THREE.Group();
  crowdParent.name = 'Camp seating preview';
  scene.add(crowdParent);
  const renderer = new SettlementCrowdRenderer({ parent: crowdParent });
  renderer.syncAgents(agents, {
    centerX: 0,
    centerZ: 0,
    viewRadius: 80,
    shadowRadius: 80,
  });
  return { renderer, agents };
}
