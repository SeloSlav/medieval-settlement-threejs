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
import { createSpinningRettingHouseMesh } from '../buildings/meshes/spinningRettingHouseMesh.ts';
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
import { OxenRenderer } from '../settlement/OxenRenderer.ts';
import type { BuildingState } from '../resources/types.ts';
import { setTierOneChurchClockTime } from '../buildings/chapelRuntimeClock.ts';
import {
  GORSKI_ARCHITECTURE_FAMILIES,
  loadGorskiArchitecturePart,
  type GorskiArchitectureFamily,
} from '../buildings/gorskiArchitectureKit.ts';

type LineupLightingMode = 'production-parity' | 'neutral-proof';

declare global {
  interface Window {
    __BUILDING_LINEUP_READY__?: boolean;
    __BUILDING_LINEUP_METRICS__?: {
      seed: number | null;
      camera: 'near' | 'design' | 'far';
      debugMode: 'final' | 'massing' | 'materials';
      presentation: 'final' | 'no-post';
      lightingMode: LineupLightingMode;
      rendererBackend: string;
      viewport: readonly [number, number];
      dpr: number;
      drawCalls: number;
      triangles: number;
      cpuFrameMs: number;
      renderTargets: number;
      stableOxVisuals: number;
    };
  }
}

const lineupParams = new URLSearchParams(window.location.search);
const requestedCamera = lineupParams.get('camera');
const cameraBookmark = requestedCamera === 'near' || requestedCamera === 'far'
  ? requestedCamera
  : 'design';
const architectureDebugMode = lineupParams.get('debug') === 'massing' ? 'massing' : 'final';
const presentationMode = lineupParams.get('presentation') === 'no-post' ? 'no-post' : 'final';
const lightingMode: LineupLightingMode = lineupParams.get('lighting') === 'neutral-proof'
  ? 'neutral-proof'
  : 'production-parity';
const requestedYawParam = lineupParams.get('yaw');
const requestedYaw = requestedYawParam === null ? Number.NaN : Number(requestedYawParam);
const authoredBuildingYaw = Number.isFinite(requestedYaw) ? requestedYaw : -0.1;
const showWaysidePrayerVisitors = lineupParams.get('visitors') === 'prayer';
const showClericVisitors = lineupParams.get('visitors') === 'cleric';
const showClearedFoundingStockyard = lineupParams.get('mode') === 'cleared-stockyard';
const requestedKind = showClearedFoundingStockyard
  ? 'founders_camp'
  : lineupParams.get('kind');
const requestedConstructionKind = lineupParams.get('construction');
const constructionKind = requestedConstructionKind
  && BUILDING_KINDS.includes(requestedConstructionKind as (typeof BUILDING_KINDS)[number])
  ? requestedConstructionKind as (typeof BUILDING_KINDS)[number]
  : null;
const showStockedState = lineupParams.get('stocked') === '1'
  || showClearedFoundingStockyard;
const showCampSeating = lineupParams.get('seating') === '1';
const showStableOxen = lineupParams.get('oxen') === '3';
const compareResidences = lineupParams.get('compare') === 'residences';
const residenceMaterialProof = compareResidences && lineupParams.get('debug') === 'materials';
const requestedResidenceTierValue = Number(lineupParams.get('residence-tier'));
const requestedResidenceTier = requestedResidenceTierValue === 1
  || requestedResidenceTierValue === 2
  || requestedResidenceTierValue === 3
  || requestedResidenceTierValue === 4
  ? requestedResidenceTierValue
  : null;
const residenceVariantSeeds = [6, 8, 9, 17] as const;
const compareServiceCoverage = lineupParams.get('compare') === 'service-coverage';
const compareChurchTiers = lineupParams.get('compare') === 'church-tiers';
const compareArchitectureKit = lineupParams.get('compare') === 'architecture-kit';
const requestedChapelTierValue = Number(lineupParams.get('tier'));
const requestedChapelTier = requestedChapelTierValue === 1
  || requestedChapelTierValue === 2
  || requestedChapelTierValue === 3
  ? requestedChapelTierValue
  : 3;
const requestedClockHour = Number(lineupParams.get('clock'));
const comparisonMode = compareResidences
  || compareServiceCoverage
  || compareChurchTiers
  || compareArchitectureKit;
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
  'StoneQuarryStockpile',
  'StoneQuarryStockSegment',
  'LargeQuarryStockpile',
  'LargeQuarryStockSegment',
  'LargeQuarrySupportStockpile',
  'LargeQuarrySupportSegment',
  'IronMineStockpile',
  'IronMineOreSegment',
  'SaltMineStockpile',
  'SaltMineSaltSegment',
  'ClayMineStockpile',
  'ClayMineClaySegment',
  'MineSupportStockpile',
  'MineSupportTimberSegment',
  'MiningPitIronStockpile',
  'MiningPitIronSegment',
  'MiningPitSaltStockpile',
  'MiningPitSaltSegment',
  'MiningPitClayStockpile',
  'MiningPitClaySegment',
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
  'SpinningWoolStockpile',
  'SpinningFlaxStockpile',
  'SpinningYarnStockpile',
  'SpinningLinenStockpile',
  'WeaverYarnStockpile',
  'WeaverLinenStockpile',
  'WoolStockSegment',
  'FlaxStockSegment',
  'YarnStockSegment',
  'LinenStockSegment',
  'ClothStockpile',
  'ClothStockSegment',
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
  ? 3
  : compareChurchTiers
    ? 3
  : compareArchitectureKit
    ? 4
  : compareResidences
    ? 4
    : constructionKind
      ? 1
    : selectedKinds.length === 1
      ? 1
      : 9;
const ROWS = compareArchitectureKit
  ? 3
  : compareResidences
    ? 1
  : comparisonMode || constructionKind || selectedKinds.length === 1
  ? 1
  : Math.ceil((selectedKinds.length + 1) / COLS);
const root = document.querySelector<HTMLElement>('#lineup-root');
const labels = document.querySelector<HTMLElement>('#labels');
if (!root || !labels) throw new Error('Building lineup host is missing.');
const labelBandHeight = Number.parseFloat(
  getComputedStyle(document.documentElement).getPropertyValue('--lineup-label-band-height'),
) || 38;
if (compareResidences && requestedResidenceTier !== null) {
  const heading = document.querySelector('h1');
  const subtitle = document.querySelector('header p');
  if (heading) heading.textContent = `Residence Tier ${requestedResidenceTier} · Seeded Variants`;
  if (subtitle) {
    subtitle.textContent = requestedResidenceTier === 4
      ? 'Narrow, balanced, and broad plans · Soot-darkened, weathered fired-clay roofs'
      : 'Narrow, balanced, and broad plans · Earth, smoke, and mossed-brown roofs';
  }
} else if (compareServiceCoverage) {
  const heading = document.querySelector('h1');
  const subtitle = document.querySelector('header p');
  if (heading) heading.textContent = 'Service Territory Readability';
  if (subtitle) {
    subtitle.textContent = 'Translucent full-home assignment overlays · Marketplace fulfillment traffic lights';
  }
} else if (compareChurchTiers) {
  const heading = document.querySelector('h1');
  const subtitle = document.querySelector('header p');
  if (heading) heading.textContent = 'Church Upgrade Lineup';
  if (subtitle) subtitle.textContent = 'Reserved final footprint · timber → stone → landmark';
} else if (compareArchitectureKit) {
  const heading = document.querySelector('h1');
  const subtitle = document.querySelector('header p');
  if (heading) heading.textContent = 'Gorski Architecture Kit Runtime Lineup';
  if (subtitle) subtitle.textContent = '12 lazy family GLBs · canonical origins · shared game atlas';
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
let lastRenderCpuMs = 0;
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = presentationMode === 'no-post'
  ? THREE.NoToneMapping
  : THREE.ACESFilmicToneMapping;
// SceneManager's settled daytime exposure starts at 1.08. Keep the no-post
// proof ungraded while matching the production presentation for final views.
renderer.toneMappingExposure = presentationMode === 'no-post' ? 1 : 1.08;
root.prepend(renderer.domElement);

const architectureKitSamples: ReadonlyArray<{
  family: GorskiArchitectureFamily;
  partId: string;
  label: string;
}> = [
  { family: 'foundations', partId: 'foundation_fieldstone_4m_h1p2m', label: 'Foundation · 4 m fieldstone' },
  { family: 'walls', partId: 'wall_limewash_4m_door_barn_host', label: 'Wall · limewash barn host' },
  { family: 'frames', partId: 'frame_portal_cart', label: 'Frame · cart portal' },
  { family: 'openings', partId: 'opening_church_arch_door', label: 'Opening · church arch door' },
  { family: 'roofs', partId: 'roof_shingle_panel_4m_full', label: 'Roof · split-shingle panel' },
  { family: 'enclosures', partId: 'enclosure_dry_stone_gate_cart', label: 'Enclosure · dry-stone cart gate' },
  { family: 'siteworks', partId: 'site_market_stall_canvas', label: 'Site work · canvas market stall' },
  { family: 'extraction', partId: 'extract_headframe_large', label: 'Extraction · mine headframe' },
  { family: 'production', partId: 'production_waterwheel_d3p6m', label: 'Production · 3.6 m waterwheel' },
  { family: 'agriculture', partId: 'agri_apiary_stand_9', label: 'Agriculture · nine-hive stand' },
  { family: 'civic', partId: 'civic_belfry_frame_large', label: 'Civic · large belfry frame' },
  { family: 'props', partId: 'prop_two_wheel_cart', label: 'Prop · two-wheel cart' },
] as const;
if (new Set(architectureKitSamples.map((sample) => sample.family)).size !== GORSKI_ARCHITECTURE_FAMILIES.length) {
  throw new Error('Architecture-kit lineup must represent every runtime family exactly once');
}
const architectureKitViewSpecs = compareArchitectureKit
  ? await Promise.all(architectureKitSamples.map(async (sample) => ({
      mesh: await loadGorskiArchitecturePart(
        sample.family,
        sample.partId,
        rendererBackend.maxAnisotropy,
      ),
      label: sample.label,
    })))
  : null;

const viewSpecs = architectureKitViewSpecs ?? (constructionKind
  ? [{
      mesh: createConstructionSiteMesh(constructionKind, 0.55, 1, 1, 1, 1),
      label: `${getBuildingDefinition(constructionKind).label} construction · 55%`,
    }]
  : compareServiceCoverage
  ? [
      {
        mesh: createServiceCoveragePreview('well'),
        label: 'Well water · 4 claimed homes · 1 outside the territory',
      },
      {
        mesh: createServiceCoveragePreview('marketplace'),
        label: 'Marketplace · green fulfilled · yellow partial · red unfulfilled',
      },
      {
        mesh: createServiceCoveragePreview('chapel'),
        label: 'Church · 4 tier-qualified parish homes · 1 outside the territory',
      },
    ]
  : compareChurchTiers
  ? [
      { mesh: createBuildingMesh('chapel', 1), label: 'Tier 1 · Delnice parish church' },
      { mesh: createBuildingMesh('chapel', 2), label: 'Tier 2 · Small stone church' },
      { mesh: createBuildingMesh('chapel', 3), label: 'Tier 3 · Large stone church' },
    ]
  : compareResidences
  ? requestedResidenceTier !== null
    ? residenceVariantSeeds.map((seed) => ({
        mesh: createResidenceMesh(seed, requestedResidenceTier),
        label: `Residence · tier ${requestedResidenceTier} · seed ${seed}`,
      }))
    : [
      { mesh: createResidenceMesh(1, 1), label: 'Residence · tier 1' },
      { mesh: createResidenceMesh(2, 2), label: 'Residence · tier 2' },
      { mesh: createResidenceMesh(3, 3), label: 'Residence · tier 3' },
      { mesh: createResidenceMesh(4, 4), label: 'Residence · tier 4' },
    ]
  : [
      ...selectedKinds.map((kind) => {
        const mesh = kind === 'wayside_shrine' && architectureDebugMode !== 'final'
          ? createWaysideShrineMesh(architectureDebugMode)
          : kind === 'spinning_retting_house' && architectureDebugMode !== 'final'
            ? createSpinningRettingHouseMesh(architectureDebugMode)
          : createBuildingMesh(kind, kind === 'chapel' ? requestedChapelTier : undefined);
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
    ].slice(0, selectedKinds.length === 1 ? 1 : undefined));

const comparisonLargest = comparisonMode
  ? Math.max(...viewSpecs.map(({ mesh }) => {
      const size = new THREE.Box3().setFromObject(mesh).getSize(new THREE.Vector3());
      return Math.max(size.x, size.y * 1.2, size.z);
    }))
  : null;
const comparisonLookY = comparisonMode
  ? new THREE.Box3().setFromObject(viewSpecs[0]!.mesh).getSize(new THREE.Vector3()).y * 0.4
  : null;

// Inspection-only materials: no atlas, vertex tint, emissive fill, or extra
// passes. These expose silhouette/joins and face ownership independently.
const residenceProofMaterials = compareResidences
  && (architectureDebugMode === 'massing' || residenceMaterialProof)
  ? {
      massing: new THREE.MeshStandardMaterial({ color: 0xaaa69d, roughness: 1 }),
      stone: new THREE.MeshBasicMaterial({ color: 0x5d8fb0 }),
      plaster: new THREE.MeshBasicMaterial({ color: 0xd6b980 }),
      timber: new THREE.MeshBasicMaterial({ color: 0x754f33 }),
      roof: new THREE.MeshBasicMaterial({ color: 0x789763 }),
      other: new THREE.MeshBasicMaterial({ color: 0x263239 }),
    }
  : null;
if (residenceMaterialProof) {
  const subtitle = document.querySelector('header p');
  if (subtitle) subtitle.textContent = 'Material ownership · Stone blue · Daub ochre · Timber brown · Roof green';
}

const views = viewSpecs.map((spec) => {
  if (Number.isFinite(requestedClockHour)) {
    setTierOneChurchClockTime(spec.mesh, {
      hour: Math.floor(requestedClockHour),
      minute: Math.floor((requestedClockHour % 1) * 60),
      preciseHour: requestedClockHour,
    });
  }
  const scene = new THREE.Scene();
  scene.userData.buildingLineupLightingMode = lightingMode;
  scene.background = new THREE.Color(0xa6b29a);
  scene.fog = new THREE.Fog(
    0xa6b29a,
    compareServiceCoverage ? 64 : 32,
    compareServiceCoverage ? 132 : 74,
  );

  const building = spec.mesh;
  building.rotation.y = showStableOxen && building.name === 'Stable' ? 0 : authoredBuildingYaw;
  building.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    // Production parity preserves the generator's deliberately sparse detail
    // caster set. Neutral proof retains the old all-caster inspection mode.
    if (lightingMode === 'neutral-proof') mesh.castShadow = true;
    mesh.receiveShadow = true;
    if (residenceProofMaterials) {
      const source = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      const profile = source.userData.buildingWeatheringProfile;
      mesh.material = !residenceMaterialProof
        ? residenceProofMaterials.massing
        : mesh.userData.residenceRoofSurface === true && !mesh.userData.residenceRoofEdgeRole
          ? residenceProofMaterials.roof
          : profile === 'masonry'
            ? residenceProofMaterials.stone
            : profile === 'plaster'
              ? residenceProofMaterials.plaster
              : profile === 'timber'
                ? residenceProofMaterials.timber
                : residenceProofMaterials.other;
    }
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

  const productionSunDirection = new THREE.Vector3().setFromSphericalCoords(
    1,
    THREE.MathUtils.degToRad(43),
    THREE.MathUtils.degToRad(225),
  );
  const sun = lightingMode === 'production-parity'
    ? new THREE.DirectionalLight(0xffefd2, 5.2)
    : new THREE.DirectionalLight(0xfff0cf, 3.25);
  if (lightingMode === 'production-parity') {
    scene.add(
      new THREE.HemisphereLight(0xd9e8ec, 0x59634f, 1.55),
      new THREE.AmbientLight(0xb8c8d2, 0.18),
    );
    sun.name = 'Sun';
    sun.position.copy(productionSunDirection).multiplyScalar(180);
    const fill = new THREE.DirectionalLight(0xa8c6d8, 0.34);
    fill.name = 'Sky fill';
    fill.position.copy(productionSunDirection).multiplyScalar(-90).add(new THREE.Vector3(0, 65, 0));
    scene.add(fill);
  } else {
    scene.add(new THREE.HemisphereLight(0xdbe5df, 0x4c3b2b, 2.25));
    sun.position.set(-12, 20, 13);
  }
  sun.castShadow = true;
  const shadowMapSize = lightingMode === 'production-parity' ? 2048 : 512;
  sun.shadow.mapSize.set(shadowMapSize, shadowMapSize);
  if (lightingMode === 'production-parity') {
    sun.shadow.bias = -0.00008;
    sun.shadow.normalBias = 0.008;
    sun.shadow.radius = 1.8;
  }
  sun.shadow.camera.left = -18;
  sun.shadow.camera.right = 18;
  sun.shadow.camera.top = 18;
  sun.shadow.camera.bottom = -18;
  scene.add(sun);

  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, Math.max(160, footprintScale * 4));
  const largest = comparisonLargest ?? Math.max(size.x, size.y * 1.2, size.z);
  const residenceCellAspect = compareResidences
    ? (root.clientWidth / COLS) / Math.max(1, root.clientHeight / ROWS - labelBandHeight)
    : 1;
  const designDistance = Math.max(
    13,
    largest
      / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5)))
      * (compareServiceCoverage ? 1.08 : 1.24)
      / Math.min(1, residenceCellAspect),
  );
  const distance = designDistance * (
    cameraBookmark === 'near' ? 0.66 : cameraBookmark === 'far' ? 1.8 : 1
  );
  if (!compareServiceCoverage && scene.fog instanceof THREE.Fog) {
    // The bookmark—not only the footprint—owns the proof-frame depth. Large
    // precincts can otherwise sit behind the curtain when `far` moves the eye
    // well outside the ordinary single-building inspection distance.
    scene.fog.near = Math.max(scene.fog.near, distance * 0.74);
    scene.fog.far = Math.max(scene.fog.far, distance + largest * 2.5);
  }
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
  const clericPreview = showClericVisitors
    && selectedKinds.length === 1
    && (selectedKinds[0] === 'chapel' || selectedKinds[0] === 'monastery')
    ? createClericPreview(scene, building)
    : null;
  const stableOxen = showStableOxen && building.name === 'Stable'
    ? createStableOxPreview(scene, building)
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
  if (clericPreview) {
    const clericFocus = building.localToWorld(new THREE.Vector3(0, 1.4, 11.2));
    const clericCamera = building.localToWorld(new THREE.Vector3(11.5, 7.2, 19));
    camera.position.copy(clericCamera);
    camera.lookAt(clericFocus);
  }

  const cell = document.createElement('div');
  cell.className = 'cell';
  const label = document.createElement('div');
  label.className = 'label';
  label.textContent = spec.label;
  cell.append(label);
  labels.append(cell);
  return { scene, camera, campSeating, waysidePrayer, clericPreview, stableOxen };
});

for (let index = views.length; index < COLS * ROWS; index++) {
  const cell = document.createElement('div');
  cell.className = 'cell';
  labels.append(cell);
}

function render(): void {
  const frameStartedAt = performance.now();
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
  lastRenderCpuMs = performance.now() - frameStartedAt;
}

await initializeBuildingMaterialLibrary(rendererBackend.maxAnisotropy);
await Promise.all(
  views.flatMap((view) => [
    view.waysidePrayer?.renderer.ready ?? Promise.resolve(true),
    view.clericPreview?.renderer.ready ?? Promise.resolve(true),
    view.stableOxen?.renderer.ready ?? Promise.resolve(true),
  ]),
);
for (const view of views) {
  view.waysidePrayer?.renderer.syncAgents(
    view.waysidePrayer.agents,
    { centerX: 0, centerZ: 0, viewRadius: 80 },
    0.25,
  );
  view.clericPreview?.renderer.syncAgents(
    view.clericPreview.agents,
    { centerX: 0, centerZ: 0, viewRadius: 80 },
    0.25,
  );
  view.stableOxen?.renderer.tick(0);
}
render();
await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
render();
await rendererBackend.waitForSubmittedWork();
window.__BUILDING_LINEUP_READY__ = true;
window.__BUILDING_LINEUP_METRICS__ = {
  seed: selectedKinds.length === 1
    ? selectedKinds[0] === 'wayside_shrine'
      ? 1733
      : selectedKinds[0] === 'spinning_retting_house'
        ? 1551
        : null
    : null,
  camera: cameraBookmark,
  debugMode: residenceMaterialProof ? 'materials' : architectureDebugMode,
  presentation: presentationMode,
  lightingMode,
  rendererBackend: rendererBackend.kind,
  viewport: [root.clientWidth, root.clientHeight],
  dpr: renderer.getPixelRatio(),
  drawCalls: lastRendererFrameStats.drawCalls,
  triangles: lastRendererFrameStats.triangles,
  cpuFrameMs: lastRenderCpuMs,
  renderTargets: 0,
  stableOxVisuals: views.reduce(
    (count, view) => count + (view.stableOxen?.renderer.getVisualCount() ?? 0),
    0,
  ),
};
document.body.dataset.lineupMetrics = JSON.stringify(window.__BUILDING_LINEUP_METRICS__);
document.body.dataset.ready = 'true';
document.body.dataset.rendererBackend = rendererBackend.kind;
document.body.dataset.lightingMode = lightingMode;
window.addEventListener('resize', render);

function createServiceCoveragePreview(
  kind: 'well' | 'marketplace' | 'chapel',
): THREE.Group {
  const group = new THREE.Group();
  const markers = new ResidenceMarkers(group);
  const prefix = kind === 'well' ? 'water' : kind === 'chapel' ? 'church' : 'market';
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
    kind === 'marketplace'
      ? new Map([
          [homes[0]!.id, 'fulfilled' as const],
          [homes[1]!.id, 'partial' as const],
          [homes[2]!.id, 'unfulfilled' as const],
          [homes[3]!.id, 'fulfilled' as const],
        ])
      : undefined,
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
      },
      dtSeconds,
    );
    view.waysidePrayer?.renderer.syncAgents(
      view.waysidePrayer.agents,
      {
        centerX: 0,
        centerZ: 0,
        viewRadius: 80,
      },
      dtSeconds,
    );
    view.clericPreview?.renderer.syncAgents(
      view.clericPreview.agents,
      {
        centerX: 0,
        centerZ: 0,
        viewRadius: 80,
      },
      dtSeconds,
    );
    view.stableOxen?.renderer.tick(dtSeconds);
  }
  render();
  requestAnimationFrame(animate);
}
if (
  (selectedKinds.length === 1 && selectedKinds[0] === 'founders_camp')
  || showWaysidePrayerVisitors
  || showClericVisitors
  || showStableOxen
) {
  requestAnimationFrame(animate);
}

function createStableOxPreview(
  scene: THREE.Scene,
  stableMesh: THREE.Object3D,
): { renderer: OxenRenderer } {
  const stableId = 'stable-preview';
  const stable = {
    id: stableId,
    kind: 'stable',
    x: stableMesh.position.x,
    z: stableMesh.position.z,
    assignedLabor: 0,
    constructionComplete: true,
  } as BuildingState;
  const oxParent = new THREE.Group();
  oxParent.name = 'Stable ox lineup preview';
  scene.add(oxParent);
  const oxRenderer = new OxenRenderer({
    parent: oxParent,
    getGameSpeed: () => 1,
    getHeightAt: () => 0,
    getWorkerPose: () => null,
    getDeliveryPose: () => null,
  });
  oxRenderer.sync({
    oxen: [0, 1, 2].map((slot) => ({
      id: `stable-ox-preview-${slot + 1}`,
      stableId,
      slot,
    })),
    buildings: new Map([[stableId, stable]]),
    deliveryTrips: [],
    disabledBuildingIds: new Set(),
    roadNetwork: null,
  });
  return { renderer: oxRenderer };
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
    { centerX: 0, centerZ: 0, viewRadius: 80 },
  );
  return { renderer, agents };
}

function createClericPreview(
  scene: THREE.Scene,
  institution: THREE.Object3D,
): {
  renderer: SettlementCrowdRenderer;
  agents: CrowdRenderAgent[];
} {
  institution.updateMatrixWorld(true);
  const localPositions = [
    { x: 0, z: 10.2, mode: 'sermon' },
    { x: -2, z: 12.2, mode: 'bow' },
    { x: 2, z: 12.2, mode: 'greet' },
    { x: 0, z: 13.8, mode: 'relax' },
  ] as const;
  const agents = localPositions.map((entry, index): CrowdRenderAgent => {
    const position = institution.localToWorld(new THREE.Vector3(entry.x, 0.02, entry.z));
    const lookAt = institution.localToWorld(new THREE.Vector3(0, 0.8, 10.2));
    return {
      id: `cleric-preview-${index}`,
      slot: index,
      x: position.x,
      y: position.y,
      z: position.z,
      yaw: index === 0
        ? institution.rotation.y
        : Math.atan2(lookAt.x - position.x, lookAt.z - position.z),
      appearanceSeed: 0x0042_0000 + index * 0x000f_1937,
      variant: 'man',
      presentation: 'cleric',
      mode: entry.mode,
      tunicColor: 0x493629,
      skinColor: 0xb87952,
      hairColor: 0x3a2418,
      tool: null,
      movementSpeed: 0,
      active: true,
    };
  });
  const parent = new THREE.Group();
  parent.name = 'Cleric animation preview';
  scene.add(parent);
  const renderer = new SettlementCrowdRenderer({ parent });
  renderer.syncAgents(agents, { centerX: 0, centerZ: 0, viewRadius: 80 });
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
  });
  return { renderer, agents };
}
