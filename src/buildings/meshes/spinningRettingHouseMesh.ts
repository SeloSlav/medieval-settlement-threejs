import * as THREE from 'three';
import {
  addMesh,
  metalMaterial,
  residenceFacadeMaterial,
  sharedBuildingDetailMaterial,
  sharedBuildingMaterial,
  stoneMaterial,
  timberMaterial,
} from '../buildingMaterials.ts';
import {
  FLAX_STOCKPILE_VISUAL_SEGMENTS,
  LINEN_STOCKPILE_VISUAL_SEGMENTS,
  WOOL_STOCKPILE_VISUAL_SEGMENTS,
  YARN_STOCKPILE_VISUAL_SEGMENTS,
} from '../buildingStockpileVisuals.ts';
import {
  addGableShell,
  addLeanToRoof,
} from './buildingMeshKit.ts';
import {
  addProceduralDoor,
  addProceduralWindow,
} from './facadeOpeningKit.ts';

export type SpinningRettingHouseDebugMode = 'final' | 'massing';
export type SpinningRettingHouseFacade = 'front' | 'back' | 'left' | 'right';
export type SpinningRettingHouseMaterialSlot =
  | 'masonry'
  | 'limewash'
  | 'timber'
  | 'shingle'
  | 'iron'
  | 'glass'
  | 'water'
  | 'fibre'
  | 'canvas'
  | 'interior';

export type SpinningRettingHouseModuleId =
  | 'main-shell'
  | 'wet-bay-shell'
  | 'front-entrance'
  | 'front-window'
  | 'rear-window'
  | 'loft-louver'
  | 'spinning-wheel'
  | 'retting-troughs'
  | 'flax-drying-rack'
  | 'scutching-bench'
  | 'trade-sign'
  | 'wool-stock'
  | 'flax-stock'
  | 'yarn-stock'
  | 'linen-stock'
  | 'approach-step';

export type SpinningRettingHouseMassPlan = {
  id: 'fibre-hall' | 'wet-work-bay';
  role: 'dry-fibre-workshop' | 'open-retting-bay';
  center: { x: number; z: number };
  width: number;
  depth: number;
  height: number;
  connectsTo?: SpinningRettingHouseMassPlan['id'];
};

export type SpinningRettingHouseFacadeEdgePlan = {
  id: string;
  massId: SpinningRettingHouseMassPlan['id'];
  facade: SpinningRettingHouseFacade;
  ownerKey: string;
  exposed: boolean;
  blockers: readonly string[];
};

export type SpinningRettingHouseModulePlacement = {
  id: string;
  moduleId: SpinningRettingHouseModuleId;
  role: 'massing' | 'opening' | 'work' | 'stock' | 'ornament' | 'approach';
  ownerKey: string;
  massId?: SpinningRettingHouseMassPlan['id'];
  facade?: SpinningRettingHouseFacade;
  bay?: number;
  anchor: { x: number; y: number; z: number };
  materialSlots: readonly SpinningRettingHouseMaterialSlot[];
};

export type SpinningRettingHousePlanDiagnostics = {
  duplicateSurfaceOwners: readonly string[];
  hiddenFacadeModules: readonly string[];
  overlappingPlacementPairs: readonly string[];
  missingModuleIds: readonly string[];
  unusedModuleIds: readonly SpinningRettingHouseModuleId[];
  unusedMaterialSlots: readonly SpinningRettingHouseMaterialSlot[];
};

export type SpinningRettingHousePlan = {
  signature: 'gorski-spinning-retting-house-v1';
  seed: 1551;
  deterministic: true;
  debugMode: SpinningRettingHouseDebugMode;
  roadFace: 'positive-z';
  footprint: { width: number; depth: number };
  masses: readonly SpinningRettingHouseMassPlan[];
  facadeEdges: readonly SpinningRettingHouseFacadeEdgePlan[];
  placements: readonly SpinningRettingHouseModulePlacement[];
  materialSlots: readonly SpinningRettingHouseMaterialSlot[];
  diagnostics: SpinningRettingHousePlanDiagnostics;
};

type SpinningRettingHouseCompileContext = {
  root: THREE.Group;
  module: THREE.Group;
  plan: SpinningRettingHousePlan;
  placement: SpinningRettingHouseModulePlacement;
};

type ModuleEmitter = (context: SpinningRettingHouseCompileContext) => void;

const MATERIAL_SLOTS = [
  'masonry',
  'limewash',
  'timber',
  'shingle',
  'iron',
  'glass',
  'water',
  'fibre',
  'canvas',
  'interior',
] as const satisfies readonly SpinningRettingHouseMaterialSlot[];

const MAIN_CENTER_X = 1;
const MAIN_WIDTH = 7;
const MAIN_DEPTH = 5.6;
const MAIN_STONE_HEIGHT = 0.66;
const MAIN_WALL_HEIGHT = 2.42;
const MAIN_RIDGE_HEIGHT = 1.9;
const MAIN_FRONT_Z = MAIN_DEPTH * 0.5 - 0.075;
const WET_BAY_CENTER_X = -3.72;
const WET_BAY_CENTER_Z = -0.08;

function modulePlacement(
  id: string,
  moduleId: SpinningRettingHouseModuleId,
  role: SpinningRettingHouseModulePlacement['role'],
  ownerKey: string,
  anchor: SpinningRettingHouseModulePlacement['anchor'],
  materialSlots: readonly SpinningRettingHouseMaterialSlot[],
  massId?: SpinningRettingHouseMassPlan['id'],
  facade?: SpinningRettingHouseFacade,
  bay?: number,
): SpinningRettingHouseModulePlacement {
  return { id, moduleId, role, ownerKey, anchor, materialSlots, massId, facade, bay };
}

function diagnosePlan(
  facadeEdges: readonly SpinningRettingHouseFacadeEdgePlan[],
  placements: readonly SpinningRettingHouseModulePlacement[],
): SpinningRettingHousePlanDiagnostics {
  const duplicateSurfaceOwners: string[] = [];
  const surfaceOwners = new Set<string>();
  for (const edge of facadeEdges) {
    if (surfaceOwners.has(edge.ownerKey)) duplicateSurfaceOwners.push(edge.ownerKey);
    surfaceOwners.add(edge.ownerKey);
  }

  const exposedSurfaces = new Set(
    facadeEdges.filter((edge) => edge.exposed).map((edge) => edge.ownerKey),
  );
  const hiddenFacadeModules = placements
    .filter((placement) => placement.facade != null && !exposedSurfaces.has(placement.ownerKey))
    .map((placement) => placement.id);

  const overlappingPlacementPairs: string[] = [];
  const occupiedBays = new Map<string, string>();
  for (const placement of placements) {
    if (placement.facade == null || placement.bay == null) continue;
    const key = `${placement.ownerKey}:${placement.bay}`;
    const previous = occupiedBays.get(key);
    if (previous) overlappingPlacementPairs.push(`${previous}:${placement.id}`);
    else occupiedBays.set(key, placement.id);
  }

  const moduleIds = new Set<SpinningRettingHouseModuleId>(
    Object.keys(SPINNING_RETTING_HOUSE_MODULE_REGISTRY) as SpinningRettingHouseModuleId[],
  );
  const usedModuleIds = new Set(placements.map((placement) => placement.moduleId));
  const missingModuleIds = [...usedModuleIds].filter((id) => !moduleIds.has(id));
  const unusedModuleIds = [...moduleIds].filter((id) => !usedModuleIds.has(id));
  const usedMaterialSlots = new Set(placements.flatMap((placement) => placement.materialSlots));
  const unusedMaterialSlots = MATERIAL_SLOTS.filter((slot) => !usedMaterialSlots.has(slot));

  return {
    duplicateSurfaceOwners,
    hiddenFacadeModules,
    overlappingPlacementPairs,
    missingModuleIds,
    unusedModuleIds,
    unusedMaterialSlots,
  };
}

/** Serializable deterministic architecture plan used by lineups and visual tests. */
export function createSpinningRettingHousePlan(
  debugMode: SpinningRettingHouseDebugMode = 'final',
): SpinningRettingHousePlan {
  const masses: SpinningRettingHouseMassPlan[] = [
    {
      id: 'fibre-hall',
      role: 'dry-fibre-workshop',
      center: { x: MAIN_CENTER_X, z: 0 },
      width: MAIN_WIDTH,
      depth: MAIN_DEPTH,
      height: MAIN_STONE_HEIGHT + MAIN_WALL_HEIGHT + MAIN_RIDGE_HEIGHT,
    },
    {
      id: 'wet-work-bay',
      role: 'open-retting-bay',
      center: { x: WET_BAY_CENTER_X, z: WET_BAY_CENTER_Z },
      width: 2.55,
      depth: 5.8,
      height: 2.68,
      connectsTo: 'fibre-hall',
    },
  ];
  const facadeEdges: SpinningRettingHouseFacadeEdgePlan[] = [
    ...(['front', 'back', 'left', 'right'] as const).map((facade) => ({
      id: `fibre-hall-${facade}`,
      massId: 'fibre-hall' as const,
      facade,
      ownerKey: `surface:fibre-hall:${facade}`,
      exposed: facade !== 'left',
      blockers: facade === 'left' ? ['wet-work-bay'] : [],
    })),
    ...(['front', 'back', 'left', 'right'] as const).map((facade) => ({
      id: `wet-work-bay-${facade}`,
      massId: 'wet-work-bay' as const,
      facade,
      ownerKey: `surface:wet-work-bay:${facade}`,
      exposed: facade !== 'right',
      blockers: facade === 'right' ? ['fibre-hall'] : [],
    })),
  ];
  const placements: SpinningRettingHouseModulePlacement[] = [
    modulePlacement('dry-fibre-workshop-shell', 'main-shell', 'massing', 'mass:fibre-hall', { x: MAIN_CENTER_X, y: 0, z: 0 }, ['masonry', 'limewash', 'timber', 'shingle'], 'fibre-hall'),
    modulePlacement('open-wet-work-bay', 'wet-bay-shell', 'massing', 'mass:wet-work-bay', { x: WET_BAY_CENTER_X, y: 0, z: WET_BAY_CENTER_Z }, ['masonry', 'timber', 'shingle', 'interior'], 'wet-work-bay'),
    modulePlacement('roadside-plank-door', 'front-entrance', 'opening', 'surface:fibre-hall:front', { x: 0.05, y: MAIN_STONE_HEIGHT, z: MAIN_FRONT_Z + 0.08 }, ['masonry', 'timber', 'iron', 'interior'], 'fibre-hall', 'front', -1),
    modulePlacement('roadside-workshop-window', 'front-window', 'opening', 'surface:fibre-hall:front', { x: 2.25, y: 1.92, z: MAIN_FRONT_Z + 0.09 }, ['masonry', 'timber', 'glass', 'interior'], 'fibre-hall', 'front', 1),
    modulePlacement('rear-cross-ventilation-window', 'rear-window', 'opening', 'surface:fibre-hall:back', { x: 1.2, y: 1.87, z: -MAIN_FRONT_Z - 0.09 }, ['masonry', 'timber', 'glass', 'interior'], 'fibre-hall', 'back', 0),
    modulePlacement('roadside-loft-louver', 'loft-louver', 'opening', 'surface:fibre-hall:front', { x: 1.1, y: 3.87, z: MAIN_FRONT_Z + 0.1 }, ['timber', 'interior'], 'fibre-hall', 'front', 0),
    modulePlacement('roadside-spinning-wheel', 'spinning-wheel', 'work', 'anchor:front-wheel', { x: 2.65, y: 0, z: 3.72 }, ['timber', 'iron']),
    modulePlacement('stone-lined-retting-troughs', 'retting-troughs', 'work', 'anchor:wet-yard', { x: WET_BAY_CENTER_X, y: 0, z: WET_BAY_CENTER_Z }, ['masonry', 'water']),
    modulePlacement('flax-drying-a-frame', 'flax-drying-rack', 'work', 'anchor:front-drying-rack', { x: -3.78, y: 0, z: 3.62 }, ['timber', 'fibre']),
    modulePlacement('covered-scutching-bench', 'scutching-bench', 'work', 'anchor:wet-bay-bench', { x: -3.7, y: 0, z: 0.15 }, ['timber', 'iron']),
    modulePlacement('spindle-trade-sign', 'trade-sign', 'ornament', 'anchor:front-sign', { x: 3.72, y: 3.05, z: 2.98 }, ['timber', 'iron', 'fibre']),
    modulePlacement('raw-wool-working-buffer', 'wool-stock', 'stock', 'anchor:wool-store', { x: -1.95, y: 0, z: -3.25 }, ['fibre']),
    modulePlacement('raw-flax-working-buffer', 'flax-stock', 'stock', 'anchor:flax-store', { x: -4.62, y: 0, z: -2.62 }, ['timber', 'fibre']),
    modulePlacement('spun-yarn-output-buffer', 'yarn-stock', 'stock', 'anchor:yarn-store', { x: 0.85, y: 0, z: 3.58 }, ['timber', 'fibre']),
    modulePlacement('retted-linen-output-buffer', 'linen-stock', 'stock', 'anchor:linen-store', { x: 4.02, y: 0, z: 3.55 }, ['timber', 'canvas']),
    modulePlacement('worn-roadside-step', 'approach-step', 'approach', 'anchor:front-approach', { x: 0.05, y: 0, z: 3.52 }, ['masonry']),
  ];

  return {
    signature: 'gorski-spinning-retting-house-v1',
    seed: 1551,
    deterministic: true,
    debugMode,
    roadFace: 'positive-z',
    footprint: { width: 10.5, depth: 8.2 },
    masses,
    facadeEdges,
    placements,
    materialSlots: [...MATERIAL_SLOTS],
    diagnostics: diagnosePlan(facadeEdges, placements),
  };
}

function namedMesh(
  group: THREE.Group,
  name: string,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  position: THREE.Vector3,
  rotation = new THREE.Euler(),
  scale = new THREE.Vector3(1, 1, 1),
): THREE.Mesh {
  const mesh = addMesh(group, geometry, material, position, rotation, scale);
  mesh.name = name;
  return mesh;
}

function emitMainShell({ module }: SpinningRettingHouseCompileContext): void {
  addGableShell(module, {
    width: MAIN_WIDTH,
    depth: MAIN_DEPTH,
    stoneHeight: MAIN_STONE_HEIGHT,
    wallHeight: MAIN_WALL_HEIGHT,
    ridgeHeight: MAIN_RIDGE_HEIGHT,
    wallMaterial: sharedBuildingMaterial('plasterYellow'),
    roofMaterial: sharedBuildingMaterial('shingle'),
    centerX: MAIN_CENTER_X,
    stoneGroundFloor: true,
  });
}

function emitWetBayShell({ module }: SpinningRettingHouseCompileContext): void {
  namedMesh(module, 'Spinning & Retting House wet-yard stone floor', new THREE.BoxGeometry(2.62, 0.24, 5.82), stoneMaterial('mid'), new THREE.Vector3(WET_BAY_CENTER_X, 0.12, WET_BAY_CENTER_Z));
  namedMesh(module, 'Spinning & Retting House wet-bay dark service wall', new THREE.BoxGeometry(0.16, 2.35, 5.55), sharedBuildingMaterial('interiorDark'), new THREE.Vector3(-2.48, 1.3, WET_BAY_CENTER_Z));
  for (const z of [-2.58, 2.42]) {
    namedMesh(module, 'Spinning & Retting House wet-bay timber post', new THREE.BoxGeometry(0.2, 2.42, 0.2), timberMaterial('dark'), new THREE.Vector3(-4.92, 1.21, z));
  }
  namedMesh(module, 'Spinning & Retting House wet-bay wall plate', new THREE.BoxGeometry(0.18, 0.18, 5.58), timberMaterial('weathered'), new THREE.Vector3(-4.92, 2.42, WET_BAY_CENTER_Z));
  addLeanToRoof(module, {
    width: 2.82,
    depth: 6.08,
    thickness: 0.15,
    material: sharedBuildingMaterial('shingle'),
    position: new THREE.Vector3(WET_BAY_CENTER_X, 2.54, WET_BAY_CENTER_Z),
    pitch: 0.19,
    highEdge: 'positiveX',
    name: 'Spinning & Retting House wet-yard lean-to roof',
  });
}

function emitFrontEntrance({ module, placement }: SpinningRettingHouseCompileContext): void {
  addProceduralDoor(module, {
    position: new THREE.Vector3(placement.anchor.x, placement.anchor.y, placement.anchor.z),
    face: 'positive-z',
    width: 1.04,
    height: 1.92,
    namePrefix: 'Spinning & Retting House',
  });
}

function emitWindow(
  { module, placement }: SpinningRettingHouseCompileContext,
  face: 'positive-z' | 'negative-z',
): void {
  addProceduralWindow(module, {
    position: new THREE.Vector3(placement.anchor.x, placement.anchor.y, placement.anchor.z),
    face,
    width: 0.92,
    height: 1.04,
    shutters: face === 'negative-z',
    frameMaterial: timberMaterial('weathered'),
    sillMaterial: stoneMaterial('light'),
    namePrefix: 'Spinning & Retting House',
  });
}

function emitLoftLouver({ module, placement }: SpinningRettingHouseCompileContext): void {
  const louver = new THREE.Group();
  louver.name = 'Spinning & Retting House fibre-drying loft louver';
  louver.position.set(placement.anchor.x, placement.anchor.y, placement.anchor.z);
  module.add(louver);
  namedMesh(louver, 'Spinning & Retting House loft vent shadow', new THREE.BoxGeometry(1.08, 0.74, 0.08), sharedBuildingMaterial('interiorDark'), new THREE.Vector3());
  for (let index = -2; index <= 2; index += 1) {
    namedMesh(louver, 'Spinning & Retting House loft timber louver', new THREE.BoxGeometry(0.9, 0.08, 0.1), timberMaterial('weathered'), new THREE.Vector3(0, index * 0.13, 0.07), new THREE.Euler(0.15, 0, 0));
  }
}

function emitSpinningWheel({ module, placement }: SpinningRettingHouseCompileContext): void {
  const wheel = new THREE.Group();
  wheel.name = 'Roadside spinning wheel';
  wheel.position.set(placement.anchor.x, placement.anchor.y, placement.anchor.z);
  module.add(wheel);
  namedMesh(wheel, 'Roadside spinning wheel rim', new THREE.TorusGeometry(0.78, 0.07, 7, 20), timberMaterial('weathered'), new THREE.Vector3(0, 1.28, 0));
  for (let index = 0; index < 10; index += 1) {
    namedMesh(wheel, `Roadside spinning wheel spoke ${index + 1}`, new THREE.BoxGeometry(1.42, 0.055, 0.055), timberMaterial('light'), new THREE.Vector3(0, 1.28, 0), new THREE.Euler(0, 0, index * Math.PI / 10));
  }
  namedMesh(wheel, 'Roadside spinning wheel hub', new THREE.CylinderGeometry(0.13, 0.13, 0.22, 10), timberMaterial('dark'), new THREE.Vector3(0, 1.28, 0), new THREE.Euler(Math.PI * 0.5, 0, 0));
  for (const x of [-0.53, 0.53]) {
    namedMesh(wheel, 'Roadside spinning wheel stand', new THREE.BoxGeometry(0.14, 0.9, 0.14), timberMaterial('dark'), new THREE.Vector3(x, 0.46, 0), new THREE.Euler(0, 0, x < 0 ? -0.16 : 0.16));
  }
  namedMesh(wheel, 'Roadside spinning wheel treadle', new THREE.BoxGeometry(1.42, 0.12, 0.42), timberMaterial('weathered'), new THREE.Vector3(0, 0.24, 0.05));
}

function emitRettingTroughs({ module }: SpinningRettingHouseCompileContext): void {
  for (const [index, z] of [-1.45, 1.18].entries()) {
    const center = new THREE.Vector3(WET_BAY_CENTER_X, 0, z);
    namedMesh(module, `Retting trough ${index + 1}`, new THREE.BoxGeometry(1.72, 0.48, 1.86), stoneMaterial('mid'), new THREE.Vector3(center.x, 0.28, center.z));
    namedMesh(module, `Retting trough ${index + 1} water`, new THREE.BoxGeometry(1.38, 0.05, 1.5), sharedBuildingDetailMaterial('water'), new THREE.Vector3(center.x, 0.54, center.z));
    for (const x of [-0.81, 0.81]) {
      namedMesh(module, `Retting trough ${index + 1} side rim`, new THREE.BoxGeometry(0.17, 0.18, 2.04), stoneMaterial('light'), new THREE.Vector3(center.x + x, 0.56, center.z));
    }
    for (const rimZ of [-0.93, 0.93]) {
      namedMesh(module, `Retting trough ${index + 1} end rim`, new THREE.BoxGeometry(1.48, 0.18, 0.17), stoneMaterial('light'), new THREE.Vector3(center.x, 0.56, center.z + rimZ));
    }
  }
}

function emitFlaxDryingRack({ module, placement }: SpinningRettingHouseCompileContext): void {
  const rack = new THREE.Group();
  rack.name = 'Flax drying rack';
  rack.position.set(placement.anchor.x, placement.anchor.y, placement.anchor.z);
  module.add(rack);
  for (const z of [-0.32, 0.32]) {
    for (const x of [-0.72, 0.72]) {
      namedMesh(rack, 'Flax drying rack A-frame leg', new THREE.BoxGeometry(0.14, 2.15, 0.14), timberMaterial('dark'), new THREE.Vector3(x, 1.02, z), new THREE.Euler(0, 0, x < 0 ? -0.19 : 0.19));
    }
  }
  namedMesh(rack, 'Flax drying rack ridge rail', new THREE.BoxGeometry(1.72, 0.14, 0.14), timberMaterial('weathered'), new THREE.Vector3(0, 2.04, 0));
  namedMesh(rack, 'Flax drying rack hanging rail', new THREE.BoxGeometry(1.58, 0.12, 0.12), timberMaterial('weathered'), new THREE.Vector3(0, 1.52, 0));
}

function emitScutchingBench({ module, placement }: SpinningRettingHouseCompileContext): void {
  const x = placement.anchor.x;
  const z = placement.anchor.z;
  namedMesh(module, 'Scutching bench work top', new THREE.BoxGeometry(1.55, 0.18, 0.54), timberMaterial('weathered'), new THREE.Vector3(x, 0.72, z));
  for (const offsetX of [-0.58, 0.58]) {
    namedMesh(module, 'Scutching bench leg', new THREE.BoxGeometry(0.14, 0.72, 0.14), timberMaterial('dark'), new THREE.Vector3(x + offsetX, 0.36, z));
  }
  namedMesh(module, 'Scutching knife', new THREE.BoxGeometry(0.06, 0.86, 0.22), metalMaterial('iron'), new THREE.Vector3(x + 0.12, 1.14, z), new THREE.Euler(0, 0, -0.38));
}

function emitTradeSign({ module, placement }: SpinningRettingHouseCompileContext): void {
  const x = placement.anchor.x;
  const y = placement.anchor.y;
  const z = placement.anchor.z;
  namedMesh(module, 'Spinning & Retting House projecting sign bracket', new THREE.BoxGeometry(0.1, 1.02, 0.1), metalMaterial('iron'), new THREE.Vector3(x, y + 0.35, z - 0.12));
  namedMesh(module, 'Spinning & Retting House spindle sign board', new THREE.BoxGeometry(0.78, 0.7, 0.1), timberMaterial('weathered'), new THREE.Vector3(x, y, z + 0.32));
  namedMesh(module, 'Spinning & Retting House spindle sign emblem', new THREE.CylinderGeometry(0.055, 0.11, 0.46, 8), sharedBuildingDetailMaterial('canvas'), new THREE.Vector3(x, y, z + 0.39), new THREE.Euler(Math.PI * 0.5, 0, 0));
}

function createWoolStockpile(name: string, anchor: THREE.Vector3): THREE.Group {
  const stockpile = new THREE.Group();
  stockpile.name = name;
  stockpile.visible = false;
  stockpile.position.copy(anchor);
  for (let index = 0; index < WOOL_STOCKPILE_VISUAL_SEGMENTS; index += 1) {
    const segment = new THREE.Group();
    segment.name = 'WoolStockSegment';
    segment.position.set((index % 2) * 0.64, 0.29 + Math.floor(index / 2) * 0.42, 0);
    namedMesh(segment, 'Raw wool fleece', new THREE.DodecahedronGeometry(0.38, 1), residenceFacadeMaterial(index % 2 ? 'grey' : 'white'), new THREE.Vector3(), new THREE.Euler(0.08, index * 0.31, 0), new THREE.Vector3(1, 0.72, 0.88));
    stockpile.add(segment);
  }
  return stockpile;
}

function createFlaxStockpile(name: string, anchor: THREE.Vector3): THREE.Group {
  const stockpile = new THREE.Group();
  stockpile.name = name;
  stockpile.visible = false;
  stockpile.position.copy(anchor);
  for (let index = 0; index < FLAX_STOCKPILE_VISUAL_SEGMENTS; index += 1) {
    const segment = new THREE.Group();
    segment.name = 'FlaxStockSegment';
    segment.position.set((index % 2) * 0.54, 0.48 + Math.floor(index / 2) * 0.36, 0);
    namedMesh(segment, 'Processed flax storage bale', new THREE.BoxGeometry(0.86, 0.34, 0.48), sharedBuildingDetailMaterial('canvas'), new THREE.Vector3(), new THREE.Euler(0, index * 0.08, 0));
    for (const x of [-0.24, 0.24]) {
      namedMesh(segment, 'Processed flax bale binding', new THREE.BoxGeometry(0.045, 0.38, 0.5), sharedBuildingDetailMaterial('wicker'), new THREE.Vector3(x, 0, 0));
    }
    stockpile.add(segment);
  }
  return stockpile;
}

function createYarnStockpile(name: string, anchor: THREE.Vector3): THREE.Group {
  const stockpile = new THREE.Group();
  stockpile.name = name;
  stockpile.visible = false;
  stockpile.position.copy(anchor);
  for (let index = 0; index < YARN_STOCKPILE_VISUAL_SEGMENTS; index += 1) {
    const segment = new THREE.Group();
    segment.name = 'YarnStockSegment';
    segment.position.set((index % 2) * 0.56, 0.26 + Math.floor(index / 2) * 0.36, 0);
    namedMesh(segment, 'Bound yarn hank', new THREE.TorusGeometry(0.23, 0.055, 7, 14), residenceFacadeMaterial(index % 2 ? 'grey' : 'white'), new THREE.Vector3(), new THREE.Euler(Math.PI * 0.5, 0, 0), new THREE.Vector3(1.35, 0.68, 1));
    namedMesh(segment, 'Yarn hank tie', new THREE.BoxGeometry(0.07, 0.09, 0.42), timberMaterial('light'), new THREE.Vector3());
    stockpile.add(segment);
  }
  return stockpile;
}

function createLinenStockpile(name: string, anchor: THREE.Vector3): THREE.Group {
  const stockpile = new THREE.Group();
  stockpile.name = name;
  stockpile.visible = false;
  stockpile.position.copy(anchor);
  for (let index = 0; index < LINEN_STOCKPILE_VISUAL_SEGMENTS; index += 1) {
    const segment = new THREE.Group();
    segment.name = 'LinenStockSegment';
    segment.position.set((index % 2) * 0.64, 0.25 + Math.floor(index / 2) * 0.38, 0);
    namedMesh(segment, 'Undyed linen roll', new THREE.CylinderGeometry(0.19, 0.19, 0.92, 10), sharedBuildingDetailMaterial('canvas'), new THREE.Vector3(), new THREE.Euler(0, 0, Math.PI * 0.5));
    namedMesh(segment, 'Linen roll core', new THREE.CylinderGeometry(0.045, 0.045, 1.0, 8), timberMaterial('dark'), new THREE.Vector3(), new THREE.Euler(0, 0, Math.PI * 0.5));
    stockpile.add(segment);
  }
  return stockpile;
}

function emitWoolStock({ module, placement }: SpinningRettingHouseCompileContext): void {
  module.add(createWoolStockpile('SpinningWoolStockpile', new THREE.Vector3(placement.anchor.x, placement.anchor.y, placement.anchor.z)));
}

function emitFlaxStock({ module, placement }: SpinningRettingHouseCompileContext): void {
  module.add(createFlaxStockpile('SpinningFlaxStockpile', new THREE.Vector3(placement.anchor.x, placement.anchor.y, placement.anchor.z)));
}

function emitYarnStock({ module, placement }: SpinningRettingHouseCompileContext): void {
  module.add(createYarnStockpile('SpinningYarnStockpile', new THREE.Vector3(placement.anchor.x, placement.anchor.y, placement.anchor.z)));
}

function emitLinenStock({ module, placement }: SpinningRettingHouseCompileContext): void {
  module.add(createLinenStockpile('SpinningLinenStockpile', new THREE.Vector3(placement.anchor.x, placement.anchor.y, placement.anchor.z)));
}

function emitApproach({ module, placement }: SpinningRettingHouseCompileContext): void {
  namedMesh(module, 'Spinning & Retting House worn roadside threshold', new THREE.BoxGeometry(1.54, 0.2, 0.68), stoneMaterial('mid'), new THREE.Vector3(placement.anchor.x, 0.1, placement.anchor.z));
  namedMesh(module, 'Spinning & Retting House approach stone', new THREE.BoxGeometry(1.8, 0.12, 0.72), stoneMaterial('light'), new THREE.Vector3(placement.anchor.x, 0.06, placement.anchor.z + 0.56));
}

const SPINNING_RETTING_HOUSE_MODULE_REGISTRY: Record<
  SpinningRettingHouseModuleId,
  ModuleEmitter
> = {
  'main-shell': emitMainShell,
  'wet-bay-shell': emitWetBayShell,
  'front-entrance': emitFrontEntrance,
  'front-window': (context) => emitWindow(context, 'positive-z'),
  'rear-window': (context) => emitWindow(context, 'negative-z'),
  'loft-louver': emitLoftLouver,
  'spinning-wheel': emitSpinningWheel,
  'retting-troughs': emitRettingTroughs,
  'flax-drying-rack': emitFlaxDryingRack,
  'scutching-bench': emitScutchingBench,
  'trade-sign': emitTradeSign,
  'wool-stock': emitWoolStock,
  'flax-stock': emitFlaxStock,
  'yarn-stock': emitYarnStock,
  'linen-stock': emitLinenStock,
  'approach-step': emitApproach,
};

function assertValidPlan(plan: SpinningRettingHousePlan): void {
  const diagnostics = plan.diagnostics;
  const failures = [
    ...diagnostics.duplicateSurfaceOwners,
    ...diagnostics.hiddenFacadeModules,
    ...diagnostics.overlappingPlacementPairs,
    ...diagnostics.missingModuleIds,
    ...diagnostics.unusedModuleIds,
    ...diagnostics.unusedMaterialSlots,
  ];
  if (failures.length > 0) {
    throw new Error(`Invalid Spinning & Retting House architecture plan: ${failures.join(', ')}`);
  }
}

/** Compiles the serializable plan through its semantic module registry. */
export function compileSpinningRettingHousePlan(
  plan: SpinningRettingHousePlan,
): THREE.Group {
  assertValidPlan(plan);
  const root = new THREE.Group();
  root.name = 'Spinning & Retting House';

  for (const placement of plan.placements) {
    if (plan.debugMode === 'massing' && placement.role !== 'massing') continue;
    const module = new THREE.Group();
    module.name = `Spinning & Retting House module: ${placement.id}`;
    module.userData.architectureModuleId = placement.moduleId;
    module.userData.architectureOwnerKey = placement.ownerKey;
    root.add(module);
    SPINNING_RETTING_HOUSE_MODULE_REGISTRY[placement.moduleId]({ root, module, plan, placement });
  }

  let meshCount = 0;
  let triangleCount = 0;
  let shadowCasterCount = 0;
  let shadowReceiverCount = 0;
  const materialTriangleCounts: Record<string, number> = {};
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    meshCount += 1;
    const triangles = object.geometry.index
      ? object.geometry.index.count / 3
      : (object.geometry.getAttribute('position')?.count ?? 0) / 3;
    triangleCount += triangles;
    if (object.castShadow) shadowCasterCount += 1;
    if (object.receiveShadow) shadowReceiverCount += 1;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      const slot = material.name || 'unnamed-material';
      materialTriangleCounts[slot] = (materialTriangleCounts[slot] ?? 0) + triangles;
    }
  });

  root.userData.architecturePlan = plan;
  root.userData.architectureDiagnostics = {
    ...plan.diagnostics,
    facadeOwnershipCount: plan.facadeEdges.length,
    exposedFacadeCount: plan.facadeEdges.filter((edge) => edge.exposed).length,
    plannedModuleCount: plan.placements.length,
    compiledModuleCount: root.children.length,
    meshCount,
    triangleCount: Math.round(triangleCount),
    materialSlotCount: plan.materialSlots.length,
    materialTriangleCounts,
    shadowCasterCount,
    shadowReceiverCount,
  };
  return root;
}

export function createSpinningRettingHouseMesh(
  debugMode: SpinningRettingHouseDebugMode = 'final',
): THREE.Group {
  return compileSpinningRettingHousePlan(createSpinningRettingHousePlan(debugMode));
}
