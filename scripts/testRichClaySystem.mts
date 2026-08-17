import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import {
  resolveBuildingPlacementPoint,
  validateBuildingPlacement,
} from '../src/buildings/BuildingPlacementValidation.ts';
import {
  clayDepositAtCenter,
  clayDepositMaxYield,
  clayDepositNodeId,
  COASTAL_CLAY_DEPOSIT_MAX_YIELD,
  INLAND_CLAY_DEPOSIT_MAX_YIELD,
  ORDINARY_CLAY_DEPOSIT_MAX_YIELD,
  type ClayDepositSite,
} from '../src/clay/ClayDepositLayout.ts';
import { createClayDepositSystem } from '../src/clay/ClayDepositSystem.ts';
import { applyShadowPreferences } from '../src/scene/applyShadowPreferences.ts';
import {
  setBuildingShadowsEnabled,
  setTreeShadowsEnabled,
} from '../src/scene/shadowPreference.ts';
import {
  CLAY_BANK_ORDINARY_YIELD_MAX,
  CLAY_BANK_RICH_YIELD_THRESHOLD,
  clayBankYieldAt,
  clayBankYieldMultiplier,
  setActiveClayDepositLayout,
} from '../src/economy/clayBankPolicy.ts';
import {
  buildLayoutWorldMapMarkers,
  filterWorldMapForagingMarkers,
} from '../src/map/worldMapMarkers.ts';
import { CLAY_ICON_HTML } from '../src/map/resourceMapIconArt.ts';
import { createWorldLayout } from '../src/resources/WorldLayout.ts';
import { WorldLayoutRegistry } from '../src/resources/WorldLayoutRegistry.ts';
import type { ResourceNodeState } from '../src/resources/types.ts';
import {
  createPhysicalDepositFootprints,
  isPhysicalDepositAt,
  polygonOverlapsPhysicalDeposit,
} from '../src/resources/physicalDepositProtection.ts';
import { createRegionalResourcePlan } from '../src/world/regionalResourceDistribution.ts';
import {
  DEFAULT_WORLD_GENERATION_SETTINGS,
  type WorldGenerationSettings,
} from '../src/world/worldGenerationSettings.ts';
import { applyTerrainPreset } from '../src/world/worldTerrainPresets.ts';
import { syncQuarries } from '../src/data/spacetimeTableSync/syncQuarries.ts';
import type { ForagingNode } from '../src/generated/types.ts';

const richSettings = findSettings((settings) =>
  createRegionalResourcePlan(settings).richClayDepositCount > 0
);
const layout = createWorldLayout(richSettings);
const richClay = layout.clayDepositLayout.sites.find((site) => site.kind === 'rich');
assert.ok(richClay, 'at least one deterministic seed must roll a rich clay deposit');
const ordinaryClay = layout.clayDepositLayout.sites.find((site) => site.kind === 'ordinary');
assert.ok(ordinaryClay, 'every region must retain an ordinary physical clay deposit');
assert.equal(ordinaryClay.formation, 'alluvial');
assert.equal(
  clayDepositMaxYield(ordinaryClay),
  ORDINARY_CLAY_DEPOSIT_MAX_YIELD,
  'river alluvium must retain the best ordinary clay reserve',
);

const delniceClayLayout = createWorldLayout(applyTerrainPreset(
  { ...DEFAULT_WORLD_GENERATION_SETTINGS, seed: 0x4310_4d21 },
  'delnice_meadow',
));
assert.equal(delniceClayLayout.riverLayout.corridors.length, 0);
assert.ok(
  delniceClayLayout.clayDepositLayout.sites.every(
    (site) => site.formation === 'inland_basin',
  ),
  'a map without surface water must place clay in old inland drainage basins',
);
const delniceOrdinaryClay = delniceClayLayout.clayDepositLayout.sites.find(
  (site) => site.kind === 'ordinary',
);
assert.ok(delniceOrdinaryClay);
assert.equal(clayDepositMaxYield(delniceOrdinaryClay), INLAND_CLAY_DEPOSIT_MAX_YIELD);
assert.ok(
  delniceOrdinaryClay.radiusX < ordinaryClay.radiusX
    && delniceOrdinaryClay.radiusZ < ordinaryClay.radiusZ,
  'dry-map clay lenses must be physically smaller than river alluvium',
);

const vinodolClayLayout = createWorldLayout(applyTerrainPreset(
  { ...DEFAULT_WORLD_GENERATION_SETTINGS, seed: 0x5600_7a13 },
  'vinodol_coast',
));
assert.ok(
  vinodolClayLayout.clayDepositLayout.sites.every(
    (site) => site.formation === 'coastal',
  ),
  'a coastal map without rivers must use dry marine sediment rather than inland fallback sites',
);
const vinodolOrdinaryClay = vinodolClayLayout.clayDepositLayout.sites.find(
  (site) => site.kind === 'ordinary',
);
assert.ok(vinodolOrdinaryClay);
assert.equal(clayDepositMaxYield(vinodolOrdinaryClay), COASTAL_CLAY_DEPOSIT_MAX_YIELD);
const clayVisualSystem = createClayDepositSystem(
  { getHeightAt: () => 0 } as Parameters<typeof createClayDepositSystem>[0],
  layout.clayDepositLayout,
);
const ordinaryClayVisual = clayVisualSystem.group.getObjectByName('Exposed ordinary alluvial clay');
assert.ok(ordinaryClayVisual, 'ordinary clay must have a close-range scene representation');
const ordinaryClayMeshes: THREE.Mesh[] = [];
ordinaryClayVisual.traverse((object) => {
  if (object instanceof THREE.Mesh) ordinaryClayMeshes.push(object);
});
assert.ok(
  ordinaryClayMeshes.some((mesh) => mesh.name.startsWith('Ordinary clay clod')),
  'ordinary clay must include raised 3D clods rather than only a terrain-colored decal',
);
assert.equal(
  ordinaryClayVisual.getObjectByName('Ordinary clay bank surface'),
  undefined,
  'clay deposits must not retain a broad wet-ground patch beneath the raised material',
);
const ordinarySurface = ordinaryClayVisual.getObjectByName('Ordinary clay exposed stratum 1');
assert.ok(ordinarySurface instanceof THREE.Mesh);
ordinarySurface.geometry.computeBoundingBox();
assert.ok(
  (ordinarySurface.geometry.boundingBox?.max.y ?? 0)
    - (ordinarySurface.geometry.boundingBox?.min.y ?? 0) >= 0.2,
  'the clay bank surface must have modeled vertical relief at close zoom',
);
const ordinarySurfaceMaterial = ordinarySurface.material as THREE.MeshStandardMaterial;
assert.ok(
  ordinarySurfaceMaterial.map instanceof THREE.DataTexture
    && ordinarySurfaceMaterial.normalMap instanceof THREE.DataTexture
    && ordinarySurfaceMaterial.roughnessMap instanceof THREE.DataTexture
    && ordinarySurfaceMaterial.map.image.width === 64
    && ordinarySurfaceMaterial.map.image.height === 64
    && ordinarySurfaceMaterial.normalScale.x >= 0.4
    && ordinarySurfaceMaterial.userData.claySurface?.revision === 'alluvial-clay-v2',
  'clay banks must carry shared granular albedo, normal, and roughness detail',
);
assert.ok(
  ordinarySurface.geometry.getAttribute('uv') !== undefined,
  'the terrain-conforming bank needs UVs so surface texture remains visible across the patch',
);
const ordinarySurfaceNormals = ordinarySurface.geometry.getAttribute('normal') as THREE.BufferAttribute;
let upwardNormalCount = 0;
for (let index = 0; index < ordinarySurfaceNormals.count; index++) {
  if (ordinarySurfaceNormals.getY(index) > 0) upwardNormalCount++;
}
assert.ok(
  upwardNormalCount / ordinarySurfaceNormals.count >= 0.9,
  'the clay bank faces must wind upward so the raised surface is visible rather than backface-culled',
);
const clayAlbedoData = ordinarySurfaceMaterial.map.image.data as Uint8Array;
let clayAlbedoMinimum = 255;
let clayAlbedoMaximum = 0;
for (let offset = 0; offset < clayAlbedoData.length; offset += 4) {
  clayAlbedoMinimum = Math.min(clayAlbedoMinimum, clayAlbedoData[offset]);
  clayAlbedoMaximum = Math.max(clayAlbedoMaximum, clayAlbedoData[offset]);
}
assert.ok(
  clayAlbedoMaximum - clayAlbedoMinimum >= 40,
  'the clay albedo must retain camera-readable grain and fine drying cracks',
);
assert.ok(
  (() => {
    let shadowBatchFound = false;
    clayVisualSystem.group.traverse((object) => {
      const mesh = object as THREE.InstancedMesh;
      if (
        mesh.isInstancedMesh
        && mesh.userData.staticInstancedShadowBatch === true
        && mesh.castShadow
      ) shadowBatchFound = true;
    });
    return shadowBatchFound;
  })(),
  'raised clay deposit details must participate in scene shadows',
);
const countClayCasterInstances = (): number => {
  let count = 0;
  clayVisualSystem.group.traverse((object) => {
    const mesh = object as THREE.InstancedMesh;
    if (mesh.isInstancedMesh && mesh.userData.staticInstancedShadowBatch === true) {
      count += mesh.count;
    }
  });
  return count;
};
assert.equal(
  countClayCasterInstances(),
  layout.clayDepositLayout.sites.reduce(
    (count, site) => count + (site.kind === 'rich' ? 20 : 12),
    0,
  ),
  'the exact caster batches must initially contain every authored clay stratum and clod',
);
const depletedClayVisualNodes = layout.clayDepositLayout.sites.map(
  (site, index): ResourceNodeState => ({
    nodeId: clayDepositNodeId(site, index),
    kind: 'quarry',
    resource: 'clay',
    remaining: 0,
    maxYield: clayDepositMaxYield(site),
    x: site.x,
    z: site.z,
    isRich: site.kind === 'rich',
  }),
);
assert.equal(clayVisualSystem.syncNodes(depletedClayVisualNodes), true);
assert.equal(
  countClayCasterInstances(),
  layout.clayDepositLayout.sites.filter((site) => site.kind === 'rich').length * 20,
  'ordinary clay depletion must remove the same exact caster instances while rich seams remain',
);

const previousLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
const shadowPreferences = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => shadowPreferences.get(key) ?? null,
    setItem: (key: string, value: string) => shadowPreferences.set(key, value),
    removeItem: (key: string) => shadowPreferences.delete(key),
  },
});
setTreeShadowsEnabled(false);
setBuildingShadowsEnabled(true);
const preferenceSun = new THREE.DirectionalLight();
applyShadowPreferences({
  sunLight: preferenceSun,
  forestManager: null,
  propGroups: [clayVisualSystem.group],
  buildingRoot: new THREE.Group(),
});
assert.equal(preferenceSun.castShadow, true);
clayVisualSystem.group.traverse((object) => {
  const mesh = object as THREE.InstancedMesh;
  if (mesh.isInstancedMesh && mesh.userData.staticInstancedShadowBatch === true) {
    assert.equal(
      mesh.castShadow,
      true,
      'tree-shadow preferences must not disable deposit shadows while building shadows keep the sun active',
    );
  }
});
setTreeShadowsEnabled(true);
if (previousLocalStorage) {
  Object.defineProperty(globalThis, 'localStorage', previousLocalStorage);
} else {
  delete (globalThis as typeof globalThis & { localStorage?: unknown }).localStorage;
}
clayVisualSystem.dispose();
const physicalDeposits = createPhysicalDepositFootprints(layout);
const resources = new Set(physicalDeposits.map((deposit) => deposit.resource));
assert.deepEqual(
  resources,
  new Set(['stone', 'clay', 'iron', 'salt']),
  'one placement model must protect every generated physical deposit family',
);
assert.equal(
  isPhysicalDepositAt(physicalDeposits, ordinaryClay.x, ordinaryClay.z),
  true,
  'ordinary clay must participate in physical-deposit placement protection',
);
assert.equal(
  polygonOverlapsPhysicalDeposit([
    { x: ordinaryClay.x - 40, z: ordinaryClay.z - 40 },
    { x: ordinaryClay.x + 40, z: ordinaryClay.z - 40 },
    { x: ordinaryClay.x + 40, z: ordinaryClay.z + 40 },
    { x: ordinaryClay.x - 40, z: ordinaryClay.z + 40 },
  ], physicalDeposits),
  true,
  'a parcel must detect a clay bank enclosed between all four corners',
);
assert.equal(
  layout.clayDepositLayout.sites.filter((site) => site.kind === 'ordinary').length,
  layout.resourcePlan.ordinaryClayDepositCount,
);

setActiveClayDepositLayout(layout.clayDepositLayout);
assert.ok(
  clayBankYieldAt(richClay.x, richClay.z, 50) >= CLAY_BANK_RICH_YIELD_THRESHOLD,
  'a generated rich clay landmark must grade as rich',
);
setActiveClayDepositLayout(null);

assert.ok(
  clayBankYieldMultiplier(1, 100) <= CLAY_BANK_ORDINARY_YIELD_MAX,
  'ordinary shoreline must remain below the explicit rich-deposit tier',
);

assert.equal(
  clayDepositAtCenter(layout.clayDepositLayout.sites, ordinaryClay.x, ordinaryClay.z),
  ordinaryClay,
);
const clayNodes = layout.clayDepositLayout.sites.map(
  (site, index): ResourceNodeState => ({
    nodeId: `clay-${site.kind}-${index}`,
    kind: 'quarry',
    resource: 'clay',
    remaining: clayDepositMaxYield(site),
    maxYield: clayDepositMaxYield(site),
    x: site.x,
    z: site.z,
    isRich: site.kind === 'rich',
  }),
);
const syncedClay = syncQuarries(
  [],
  layout.clayDepositLayout.sites.map(
    (site, index): ForagingNode => ({
      nodeId: `clay-${site.kind}-${index}`,
      nodeKind: 'clay',
      remaining: clayDepositMaxYield(site),
      maxYield: clayDepositMaxYield(site),
      x: site.x,
      z: site.z,
      respawnCooldown: 0,
      anchorX: site.x,
      anchorZ: site.z,
    }),
  ),
);
assert.equal(syncedClay.size, clayNodes.length);
assert.equal(
  syncedClay.get(clayNodes.find((node) => node.isRich)?.nodeId ?? '')?.isRich,
  true,
  'replicated clay rows must enter the shared geological state with their rich grade',
);
assert.deepEqual(
  resolveBuildingPlacementPoint(
    'clay_pit',
    richClay.x + 24,
    richClay.z - 12,
    clayNodes,
  ),
  { x: richClay.x + 24, z: richClay.z - 12 },
  'Clay Pit placement should remain exactly where the player points',
);

const placementContext = {
  buildings: [],
  residences: [],
  burgageZones: [],
  quarries: clayNodes,
  foragingNodes: [],
  clayDepositSites: layout.clayDepositLayout.sites,
  stockpile: { timber: 10_000, stone: 10_000, ironwork: 10_000 },
  isWaterAt: () => true,
  isResourceDepositAt: (x: number, z: number) =>
    isPhysicalDepositAt(physicalDeposits, x, z),
  getNaturalHeightAt: () => 0,
};
assert.equal(
  validateBuildingPlacement(
    'clay_pit',
    ordinaryClay.x,
    ordinaryClay.z,
    placementContext,
  ).ok,
  true,
  'an ordinary generated clay bank must be a valid authoritative extraction site',
);
assert.equal(
  validateBuildingPlacement(
    'clay_pit',
    richClay.x,
    richClay.z,
    placementContext,
  ).ok,
  true,
  'a rich generated clay bank must be a valid authoritative extraction site',
);
const exhaustedOrdinaryNodes = clayNodes.map((node) =>
  node.x === ordinaryClay.x && node.z === ordinaryClay.z
    ? { ...node, remaining: 0 }
    : node
);
assert.deepEqual(
  validateBuildingPlacement(
    'clay_pit',
    ordinaryClay.x,
    ordinaryClay.z,
    { ...placementContext, quarries: exhaustedOrdinaryNodes },
  ),
  { ok: false, reason: 'requires_clay_deposit' },
  'an exhausted ordinary clay bank must not accept a replacement pit',
);
assert.deepEqual(
  validateBuildingPlacement('smithy', richClay.x, richClay.z, {
    ...placementContext,
    isWaterAt: () => false,
  }),
  { ok: false, reason: 'on_resource_deposit' },
  'an unrelated building must not erase a generated clay landmark',
);
assert.deepEqual(
  validateBuildingPlacement('clay_pit', 0, 0, {
    ...placementContext,
    clayDepositSites: [],
    isWaterAt: (x, z) => Math.hypot(x, z - 8) < 1.5,
  }),
  { ok: false, reason: 'requires_clay_deposit' },
  'an arbitrary usable shoreline must not create clay without a generated deposit',
);

const registry = WorldLayoutRegistry.fromWorldLayout(layout);
const markers = buildLayoutWorldMapMarkers(registry, layout.clayDepositLayout.sites);
assert.deepEqual(
  new Set(markers.filter((marker) => marker.kind === 'clay').map((marker) => marker.label)),
  new Set(['Clay deposit', 'Rich clay deposit']),
  'the world map must distinguish ordinary and rich physical clay banks',
);
assert.equal(
  filterWorldMapForagingMarkers(markers).filter((marker) => marker.kind === 'clay').length,
  layout.clayDepositLayout.sites.length,
  'all physical clay deposits must reach the projected far-zoom resource layer',
);
assert.ok(CLAY_ICON_HTML.includes('map-resource-icon-glyph--clay'));
const atlas = readFileSync('public/assets/ui/icons/map-resources.png');
assert.ok(
  atlas.byteLength > 350_000,
  'the clay sprite cell must be populated rather than pointing at the old blank atlas slot',
);

const generatedForaging = JSON.parse(
  readFileSync('server/generated/world_foraging.json', 'utf8'),
) as {
  foragingNodes: Array<{
    nodeId: string;
    nodeKind: string;
    x: number;
    z: number;
    maxYield: number;
  }>;
};
const generatedClay = generatedForaging.foragingNodes.filter(
  (node) => node.nodeKind === 'clay',
);
const defaultLayout = createWorldLayout(DEFAULT_WORLD_GENERATION_SETTINGS);
assert.equal(generatedClay.length, defaultLayout.clayDepositLayout.sites.length);
for (let index = 0; index < defaultLayout.clayDepositLayout.sites.length; index++) {
  const site = defaultLayout.clayDepositLayout.sites[index];
  const expectedId = `clay-${site.kind}-${index}`;
  const row = generatedClay.find((node) => node.nodeId === expectedId);
  assert.ok(row, `missing generated clay row ${expectedId}`);
  assert.ok(Math.hypot(row.x - site.x, row.z - site.z) < 1e-6);
  assert.equal(
    row.maxYield,
    clayDepositMaxYield(site as ClayDepositSite),
    'bootstrap clay rows must carry their physical reserve rather than a placement placeholder',
  );
}

const authority = readFileSync('server/src/hydrology/mod.rs', 'utf8');
const clayPitSimulation = readFileSync(
  'server/src/simulation/expanded_economy.rs',
  'utf8',
);
const buildingReducer = readFileSync('server/src/reducers/buildings.rs', 'utf8');
assert.match(clayPitSimulation, /deposit\.node_kind == "clay"/);
assert.match(clayPitSimulation, /clay_deposit_beneath/);
assert.match(clayPitSimulation, /clay_bank_yield_multiplier_at_deposit/);
assert.match(authority, /clay_bank_yield_multiplier_with_richness/);
assert.match(
  buildingReducer,
  /let on_generated_clay_bank = kind == "clay_pit" && is_clay_deposit_at_center/,
  'authority must recognize the generated landmark before applying water and deposit overlap checks',
);
assert.match(buildingReducer, /!on_generated_clay_bank\s*&& is_on_resource_deposit/);
assert.match(
  buildingReducer,
  /let on_usable_clay_bank = kind == "clay_pit" && has_clay_deposit_at_center[\s\S]*kind == "clay_pit" && !on_usable_clay_bank/,
  'authority must require remaining ordinary clay or a rich deep source before placement',
);
assert.match(
  buildingReducer,
  /fn clay_source_usable[\s\S]*"clay_pit" =>[\s\S]*clay_source_usable/,
  'the production steward must treat an off-deposit legacy Clay Pit as source-stalled',
);
assert.match(
  clayPitSimulation,
  /deposit\.node_id\.starts_with\("clay-rich-"\)/,
  'ordinary physical clay banks must not receive the rich-deposit multiplier',
);
assert.match(
  clayPitSimulation,
  /let Some\(mut deposit\) = clay_deposit_beneath[\s\S]*else \{\s*return;/,
  'legacy off-bank Clay Pits must stall rather than creating clay from a background shoreline score',
);
assert.match(
  clayPitSimulation,
  /if !is_rich && clay_produced > 1e-6[\s\S]*deposit\.remaining = \(deposit\.remaining - clay_produced\)\.max\(0\.0\)/,
  'ordinary banks must lose exactly the clay physically produced by their pit',
);
assert.match(
  clayPitSimulation,
  /let clay_batch = if is_rich[\s\S]*CLAY_PIT_CLAY_PER_CYCLE\.min\(deposit\.remaining\.max\(0\.0\)\)/,
  'the last ordinary digging cycle must not create more clay than remains in the bank',
);

const tableSync = readFileSync(
  'src/data/spacetimeTableSync/syncForagingNodes.ts',
  'utf8',
);
assert.match(
  tableSync,
  /row\.nodeKind === 'clay'\) continue/,
  'the geological authority row must not masquerade as a harvestable forage node',
);
const clayVisuals = readFileSync('src/clay/ClayDepositSystem.ts', 'utf8');
assert.match(
  clayVisuals,
  /syncNodes:[\s\S]*node\.remaining > 1e-6[\s\S]*stratum\.visible = hasExposedClay/,
  'the exposed ordinary clay stratum must visually clear when its physical reserve is exhausted',
);
const bootstrapReducer = readFileSync('server/src/reducers/bootstrap.rs', 'utf8');
assert.match(
  bootstrapReducer,
  /node\.node_kind == "clay"[\s\S]*existing\.max_yield <= 1\.0 \+ f64::EPSILON[\s\S]*node\.max_yield/,
  'development worlds with placeholder clay anchors must receive the new physical reserve',
);

console.log('rich clay system tests passed');

function findSettings(
  predicate: (settings: WorldGenerationSettings) => boolean,
): WorldGenerationSettings {
  for (let seed = 1; seed <= 512; seed++) {
    const settings = { ...DEFAULT_WORLD_GENERATION_SETTINGS, seed };
    if (predicate(settings)) return settings;
  }
  throw new Error('unable to find a representative world seed');
}
