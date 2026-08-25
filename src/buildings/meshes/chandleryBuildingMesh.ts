import * as THREE from 'three';
import {
  addMesh,
  metalMaterial,
  sharedBuildingDetailMaterial,
  sharedBuildingMaterial,
  stoneMaterial,
  timberMaterial,
} from '../buildingMaterials.ts';
import {
  addGableShell,
  addLeanToRoof,
} from './buildingMeshKit.ts';
import {
  addProceduralDoor,
  addProceduralWindow,
} from './facadeOpeningKit.ts';

export type ChandleryDebugMode = 'final' | 'massing';
export type ChandleryFacade = 'front' | 'back' | 'left' | 'right';
export type ChandleryMaterialSlot =
  | 'masonry'
  | 'limewash'
  | 'timber'
  | 'shingle'
  | 'iron'
  | 'glass'
  | 'wax'
  | 'interior';

export type ChandleryModuleId =
  | 'main-shell'
  | 'melt-bay-shell'
  | 'front-entrance'
  | 'front-display-window'
  | 'rear-window'
  | 'side-window'
  | 'melt-bay-vent'
  | 'dipping-porch'
  | 'melting-hearth'
  | 'candle-dipping-rack'
  | 'trade-sign'
  | 'wax-stock'
  | 'candle-stock'
  | 'approach-step';

export type ChandleryMassPlan = {
  id: 'main-hall' | 'heated-melt-bay';
  role: 'workshop-hall' | 'heated-service-bay';
  center: { x: number; z: number };
  width: number;
  depth: number;
  height: number;
  connectsTo?: ChandleryMassPlan['id'];
};

export type ChandleryFacadeEdgePlan = {
  id: string;
  massId: ChandleryMassPlan['id'];
  facade: ChandleryFacade;
  ownerKey: string;
  exposed: boolean;
  blockers: readonly string[];
};

export type ChandleryModulePlacement = {
  id: string;
  moduleId: ChandleryModuleId;
  role: 'massing' | 'opening' | 'work' | 'stock' | 'ornament' | 'approach';
  ownerKey: string;
  facade?: ChandleryFacade;
  bay?: number;
  anchor: { x: number; y: number; z: number };
  materialSlots: readonly ChandleryMaterialSlot[];
};

export type ChandleryPlanDiagnostics = {
  duplicateSurfaceOwners: readonly string[];
  hiddenFacadeModules: readonly string[];
  overlappingPlacementPairs: readonly string[];
  missingModuleIds: readonly string[];
  unusedModuleIds: readonly string[];
  unusedMaterialSlots: readonly ChandleryMaterialSlot[];
};

export type ChandleryPlan = {
  signature: 'gorski-chandlery-v1';
  seed: 1427;
  deterministic: true;
  debugMode: ChandleryDebugMode;
  roadFace: 'positive-z';
  footprint: { width: number; depth: number };
  masses: readonly ChandleryMassPlan[];
  facadeEdges: readonly ChandleryFacadeEdgePlan[];
  placements: readonly ChandleryModulePlacement[];
  materialSlots: readonly ChandleryMaterialSlot[];
  diagnostics: ChandleryPlanDiagnostics;
};

type ChandleryCompileContext = {
  root: THREE.Group;
  module: THREE.Group;
  plan: ChandleryPlan;
  placement: ChandleryModulePlacement;
};

type ChandleryModuleEmitter = (context: ChandleryCompileContext) => void;

const MATERIAL_SLOTS = [
  'masonry',
  'limewash',
  'timber',
  'shingle',
  'iron',
  'glass',
  'wax',
  'interior',
] as const satisfies readonly ChandleryMaterialSlot[];

const MAIN_WIDTH = 8.2;
const MAIN_DEPTH = 6.2;
const STONE_HEIGHT = 0.72;
const WALL_HEIGHT = 2.78;
const RIDGE_HEIGHT = 2.12;
const FRONT_Z = MAIN_DEPTH * 0.5 - 0.075;

function modulePlacement(
  id: string,
  moduleId: ChandleryModuleId,
  role: ChandleryModulePlacement['role'],
  ownerKey: string,
  anchor: ChandleryModulePlacement['anchor'],
  materialSlots: readonly ChandleryMaterialSlot[],
  facade?: ChandleryFacade,
  bay?: number,
): ChandleryModulePlacement {
  return { id, moduleId, role, ownerKey, anchor, materialSlots, facade, bay };
}

function diagnosePlan(
  facadeEdges: readonly ChandleryFacadeEdgePlan[],
  placements: readonly ChandleryModulePlacement[],
): ChandleryPlanDiagnostics {
  const duplicateSurfaceOwners: string[] = [];
  const surfaceOwners = new Set<string>();
  for (const edge of facadeEdges) {
    if (surfaceOwners.has(edge.ownerKey)) duplicateSurfaceOwners.push(edge.ownerKey);
    surfaceOwners.add(edge.ownerKey);
  }

  const exposedFacades = new Set(
    facadeEdges.filter((edge) => edge.exposed).map((edge) => edge.facade),
  );
  const hiddenFacadeModules = placements
    .filter((placement) => placement.facade && !exposedFacades.has(placement.facade))
    .map((placement) => placement.id);

  const overlappingPlacementPairs: string[] = [];
  const occupiedBays = new Map<string, string>();
  for (const placement of placements) {
    if (placement.facade == null || placement.bay == null) continue;
    const key = `${placement.ownerKey}:${placement.facade}:${placement.bay}`;
    const previous = occupiedBays.get(key);
    if (previous) overlappingPlacementPairs.push(`${previous}:${placement.id}`);
    else occupiedBays.set(key, placement.id);
  }

  const moduleIds = new Set<ChandleryModuleId>(
    Object.keys(CHANDLERY_MODULE_REGISTRY) as ChandleryModuleId[],
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

/**
 * Deterministic mass/facade/module plan. It is deliberately plain data so
 * diagnostics, tests, and future editor tooling can inspect the architecture
 * without traversing Three.js objects.
 */
export function createChandleryPlan(
  debugMode: ChandleryDebugMode = 'final',
): ChandleryPlan {
  const masses: ChandleryMassPlan[] = [
    {
      id: 'main-hall',
      role: 'workshop-hall',
      center: { x: 0, z: 0 },
      width: MAIN_WIDTH,
      depth: MAIN_DEPTH,
      height: STONE_HEIGHT + WALL_HEIGHT + RIDGE_HEIGHT,
    },
    {
      id: 'heated-melt-bay',
      role: 'heated-service-bay',
      center: { x: 4.64, z: -0.55 },
      width: 2.2,
      depth: 3.25,
      height: 2.58,
      connectsTo: 'main-hall',
    },
  ];
  const facadeEdges: ChandleryFacadeEdgePlan[] = (
    ['front', 'back', 'left', 'right'] as const
  ).map((facade) => ({
    id: `main-hall-${facade}`,
    massId: 'main-hall',
    facade,
    ownerKey: `surface:main-hall:${facade}`,
    exposed: true,
    blockers: [],
  }));
  const placements: ChandleryModulePlacement[] = [
    modulePlacement('main-workshop-shell', 'main-shell', 'massing', 'mass:main-hall', { x: 0, y: 0, z: 0 }, ['masonry', 'limewash', 'timber', 'shingle']),
    modulePlacement('heated-side-bay', 'melt-bay-shell', 'massing', 'mass:heated-melt-bay', { x: 4.64, y: 0, z: -0.55 }, ['masonry', 'timber', 'shingle', 'interior']),
    modulePlacement('roadside-plank-door', 'front-entrance', 'opening', 'surface:main-hall:front', { x: -2.45, y: STONE_HEIGHT, z: FRONT_Z + 0.07 }, ['masonry', 'timber', 'iron', 'interior'], 'front', -2),
    modulePlacement('roadside-display-window', 'front-display-window', 'opening', 'surface:main-hall:front', { x: 0.45, y: 2.0, z: FRONT_Z + 0.09 }, ['masonry', 'timber', 'glass', 'interior'], 'front', 0),
    modulePlacement('rear-service-window', 'rear-window', 'opening', 'surface:main-hall:back', { x: -1.65, y: 2.05, z: -FRONT_Z - 0.09 }, ['masonry', 'timber', 'glass', 'interior'], 'back', -1),
    modulePlacement('left-cross-ventilation-window', 'side-window', 'opening', 'surface:main-hall:left', { x: -MAIN_WIDTH * 0.5 + 0.04, y: 2.0, z: -0.55 }, ['masonry', 'timber', 'glass', 'interior'], 'left', 0),
    modulePlacement('heated-bay-louver', 'melt-bay-vent', 'opening', 'surface:main-hall:right', { x: 5.76, y: 1.72, z: -0.55 }, ['timber', 'interior'], 'right', 0),
    modulePlacement('roadside-dipping-porch', 'dipping-porch', 'work', 'anchor:front-porch', { x: 0, y: 0, z: 3.72 }, ['timber', 'shingle']),
    modulePlacement('wax-melting-hearth', 'melting-hearth', 'work', 'anchor:heated-melt-bay', { x: 4.62, y: 0, z: -0.72 }, ['masonry', 'iron', 'interior']),
    modulePlacement('candle-dipping-frame', 'candle-dipping-rack', 'work', 'anchor:front-work-rack', { x: 0.65, y: 0, z: 4.02 }, ['timber', 'wax', 'interior']),
    modulePlacement('hanging-candle-sign', 'trade-sign', 'ornament', 'anchor:front-sign', { x: 3.48, y: 2.82, z: 3.36 }, ['timber', 'iron', 'wax']),
    modulePlacement('beeswax-working-stock', 'wax-stock', 'stock', 'anchor:wax-store', { x: -3.42, y: 0, z: 1.76 }, ['timber', 'wax']),
    modulePlacement('finished-candle-stock', 'candle-stock', 'stock', 'anchor:candle-store', { x: 2.65, y: 0, z: 3.86 }, ['timber', 'wax']),
    modulePlacement('worn-roadside-step', 'approach-step', 'approach', 'anchor:front-approach', { x: -2.45, y: 0, z: 4.12 }, ['masonry']),
  ];

  return {
    signature: 'gorski-chandlery-v1',
    seed: 1427,
    deterministic: true,
    debugMode,
    roadFace: 'positive-z',
    footprint: { width: 11.4, depth: 8.8 },
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
): THREE.Mesh {
  const mesh = addMesh(group, geometry, material, position, rotation);
  mesh.name = name;
  return mesh;
}

function emitMainShell({ module }: ChandleryCompileContext): void {
  addGableShell(module, {
    width: MAIN_WIDTH,
    depth: MAIN_DEPTH,
    stoneHeight: STONE_HEIGHT,
    wallHeight: WALL_HEIGHT,
    ridgeHeight: RIDGE_HEIGHT,
    wallMaterial: sharedBuildingMaterial('plasterYellow'),
    roofMaterial: sharedBuildingMaterial('shingle'),
    stoneGroundFloor: true,
  });
}

function emitMeltBayShell({ module }: ChandleryCompileContext): void {
  namedMesh(module, 'Chandlery heated melt-bay stone floor', new THREE.BoxGeometry(2.3, 0.28, 3.34), stoneMaterial('mid'), new THREE.Vector3(4.66, 0.14, -0.55));
  namedMesh(module, 'Chandlery melt-bay dark service wall', new THREE.BoxGeometry(0.18, 2.3, 3.15), sharedBuildingMaterial('interiorDark'), new THREE.Vector3(4.02, 1.28, -0.55));
  for (const z of [-1.95, 0.85]) {
    namedMesh(module, 'Chandlery melt-bay timber post', new THREE.BoxGeometry(0.2, 2.35, 0.2), timberMaterial('dark'), new THREE.Vector3(5.55, 1.18, z));
  }
  addLeanToRoof(module, {
    width: 2.45,
    depth: 3.55,
    thickness: 0.15,
    material: sharedBuildingMaterial('shingle'),
    position: new THREE.Vector3(4.72, 2.48, -0.55),
    pitch: 0.2,
    highEdge: 'negativeX',
    name: 'Chandlery heated melt-bay lean-to roof',
  });
}

function emitFrontEntrance({ module, placement }: ChandleryCompileContext): void {
  addProceduralDoor(module, {
    position: new THREE.Vector3(placement.anchor.x, placement.anchor.y, placement.anchor.z),
    face: 'positive-z',
    width: 1.12,
    height: 1.96,
    namePrefix: 'Chandlery',
  });
}

function emitWindow(
  context: ChandleryCompileContext,
  face: 'positive-z' | 'negative-z' | 'negative-x',
  width: number,
  height: number,
): void {
  const { module, placement } = context;
  addProceduralWindow(module, {
    position: new THREE.Vector3(placement.anchor.x, placement.anchor.y, placement.anchor.z),
    face,
    width,
    height,
    shutters: face !== 'positive-z',
    frameMaterial: timberMaterial('weathered'),
    sillMaterial: stoneMaterial('light'),
    namePrefix: 'Chandlery',
  });
}

function emitMeltVent({ module, placement }: ChandleryCompileContext): void {
  const vent = new THREE.Group();
  vent.name = 'Chandlery heated-bay louvered vent';
  vent.position.set(placement.anchor.x, placement.anchor.y, placement.anchor.z);
  vent.rotation.y = Math.PI * 0.5;
  module.add(vent);
  namedMesh(vent, 'Chandlery vent shadow', new THREE.BoxGeometry(1.12, 0.92, 0.08), sharedBuildingMaterial('interiorDark'), new THREE.Vector3());
  for (let index = -2; index <= 2; index += 1) {
    namedMesh(vent, 'Chandlery vent timber louver', new THREE.BoxGeometry(0.92, 0.09, 0.1), timberMaterial('weathered'), new THREE.Vector3(0, index * 0.17, 0.07), new THREE.Euler(0.18, 0, 0));
  }
}

function emitDippingPorch({ module }: ChandleryCompileContext): void {
  addLeanToRoof(module, {
    width: 7.65,
    depth: 1.85,
    thickness: 0.14,
    material: sharedBuildingMaterial('shingle'),
    position: new THREE.Vector3(-0.05, 2.96, 3.73),
    pitch: 0.15,
    highEdge: 'negativeZ',
    name: 'Chandlery roadside dipping porch roof',
  });
  for (const x of [-3.62, 3.52]) {
    namedMesh(module, 'Chandlery dipping porch timber post', new THREE.BoxGeometry(0.19, 2.72, 0.19), timberMaterial('dark'), new THREE.Vector3(x, 1.36, 4.38));
  }
  namedMesh(module, 'Chandlery roadside work porch sill', new THREE.BoxGeometry(7.48, 0.16, 0.66), timberMaterial('weathered'), new THREE.Vector3(-0.04, 0.24, 3.98));
}

function emitMeltingHearth({ module }: ChandleryCompileContext): void {
  namedMesh(module, 'Chandlery wax melting hearth', new THREE.BoxGeometry(1.35, 0.82, 1.15), stoneMaterial('mid'), new THREE.Vector3(4.65, 0.41, -0.78));
  namedMesh(module, 'Chandlery hearth firebox', new THREE.BoxGeometry(0.74, 0.42, 0.08), sharedBuildingMaterial('interiorDark'), new THREE.Vector3(4.65, 0.37, -0.19));
  namedMesh(module, 'Chandlery wax cauldron', new THREE.CylinderGeometry(0.5, 0.38, 0.48, 14, 1, true), metalMaterial('iron'), new THREE.Vector3(4.65, 1.02, -0.78));
  namedMesh(module, 'Chandlery molten wax surface', new THREE.CylinderGeometry(0.4, 0.4, 0.035, 14), sharedBuildingDetailMaterial('canvas'), new THREE.Vector3(4.65, 1.25, -0.78));
  namedMesh(module, 'Chandlery stone chimney', new THREE.BoxGeometry(0.72, 3.35, 0.72), stoneMaterial('mid'), new THREE.Vector3(3.48, 3.52, -1.35));
  namedMesh(module, 'Chandlery chimney cap', new THREE.BoxGeometry(0.92, 0.18, 0.92), stoneMaterial('light'), new THREE.Vector3(3.48, 5.18, -1.35));
}

function emitDippingRack({ module }: ChandleryCompileContext): void {
  for (const x of [-0.9, 2.2]) {
    namedMesh(module, 'Chandlery candle dipping frame upright', new THREE.BoxGeometry(0.16, 2.05, 0.16), timberMaterial('dark'), new THREE.Vector3(x, 1.2, 4.08));
  }
  for (const y of [1.18, 2.15]) {
    namedMesh(module, 'Chandlery candle dipping frame rail', new THREE.BoxGeometry(3.28, 0.13, 0.15), timberMaterial('weathered'), new THREE.Vector3(0.65, y, 4.08));
  }
  for (let row = 0; row < 2; row += 1) {
    const y = row === 0 ? 1.55 : 0.62;
    for (let index = 0; index < 9; index += 1) {
      const x = -0.68 + index * 0.33;
      namedMesh(module, `Chandlery hanging candle row ${row + 1}`, new THREE.CylinderGeometry(0.035, 0.045, 0.58, 7), sharedBuildingDetailMaterial('canvas'), new THREE.Vector3(x, y, 4.1));
      namedMesh(module, 'Chandlery candle wick', new THREE.BoxGeometry(0.012, 0.14, 0.012), sharedBuildingMaterial('interiorDark'), new THREE.Vector3(x, y + 0.35, 4.1));
    }
  }
}

function emitTradeSign({ module }: ChandleryCompileContext): void {
  namedMesh(module, 'Chandlery projecting sign bracket', new THREE.BoxGeometry(0.12, 1.28, 0.12), metalMaterial('iron'), new THREE.Vector3(3.5, 3.48, 3.26));
  namedMesh(module, 'Chandlery hanging sign board', new THREE.BoxGeometry(0.88, 0.8, 0.11), timberMaterial('weathered'), new THREE.Vector3(3.5, 2.96, 3.76));
  namedMesh(module, 'Chandlery candle sign emblem', new THREE.CylinderGeometry(0.08, 0.1, 0.46, 8), sharedBuildingDetailMaterial('canvas'), new THREE.Vector3(3.5, 2.92, 3.83), new THREE.Euler(Math.PI * 0.5, 0, 0));
  namedMesh(module, 'Chandlery flame sign emblem', new THREE.ConeGeometry(0.12, 0.26, 8), sharedBuildingDetailMaterial('paintOchre'), new THREE.Vector3(3.5, 3.26, 3.83), new THREE.Euler(Math.PI * 0.5, 0, 0));
}

function addWaxBlock(group: THREE.Group, x: number, y: number, z: number): void {
  namedMesh(group, 'Chandlery beeswax block', new THREE.BoxGeometry(0.58, 0.22, 0.42), sharedBuildingDetailMaterial('canvas'), new THREE.Vector3(x, y, z));
}

function emitWaxStock({ module }: ChandleryCompileContext): void {
  const stock = new THREE.Group();
  stock.name = 'WaxStock';
  stock.visible = false;
  for (let index = 0; index < 3; index += 1) {
    const segment = new THREE.Group();
    segment.name = 'WaxStockSegment';
    segment.visible = false;
    segment.position.set(-3.55 + index * 0.58, 0, 1.76);
    addWaxBlock(segment, 0, 0.38, 0);
    addWaxBlock(segment, 0.04, 0.62, 0.02);
    stock.add(segment);
  }
  module.add(stock);
}

function emitCandleStock({ module }: ChandleryCompileContext): void {
  const stock = new THREE.Group();
  stock.name = 'CandlesStock';
  stock.visible = false;
  for (let segmentIndex = 0; segmentIndex < 3; segmentIndex += 1) {
    const segment = new THREE.Group();
    segment.name = 'CandlesStockSegment';
    segment.visible = false;
    segment.position.set(2.18 + segmentIndex * 0.58, 0, 3.72);
    namedMesh(segment, 'Chandlery finished candle crate', new THREE.BoxGeometry(0.5, 0.32, 0.5), timberMaterial('weathered'), new THREE.Vector3(0, 0.16, 0));
    for (let index = 0; index < 4; index += 1) {
      namedMesh(segment, 'Chandlery finished candle bundle', new THREE.CylinderGeometry(0.03, 0.04, 0.62, 7), sharedBuildingDetailMaterial('canvas'), new THREE.Vector3(-0.18 + index * 0.12, 0.62, 0));
    }
    stock.add(segment);
  }
  module.add(stock);
}

function emitApproach({ module }: ChandleryCompileContext): void {
  namedMesh(module, 'Chandlery worn roadside threshold step', new THREE.BoxGeometry(1.62, 0.2, 0.72), stoneMaterial('mid'), new THREE.Vector3(-2.45, 0.1, 3.68));
  namedMesh(module, 'Chandlery road approach stone', new THREE.BoxGeometry(1.92, 0.12, 0.78), stoneMaterial('light'), new THREE.Vector3(-2.45, 0.06, 4.34));
}

const CHANDLERY_MODULE_REGISTRY: Record<ChandleryModuleId, ChandleryModuleEmitter> = {
  'main-shell': emitMainShell,
  'melt-bay-shell': emitMeltBayShell,
  'front-entrance': emitFrontEntrance,
  'front-display-window': (context) => emitWindow(context, 'positive-z', 1.72, 1.32),
  'rear-window': (context) => emitWindow(context, 'negative-z', 0.88, 1.02),
  'side-window': (context) => emitWindow(context, 'negative-x', 0.9, 1.02),
  'melt-bay-vent': emitMeltVent,
  'dipping-porch': emitDippingPorch,
  'melting-hearth': emitMeltingHearth,
  'candle-dipping-rack': emitDippingRack,
  'trade-sign': emitTradeSign,
  'wax-stock': emitWaxStock,
  'candle-stock': emitCandleStock,
  'approach-step': emitApproach,
};

function assertValidPlan(plan: ChandleryPlan): void {
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
    throw new Error(`Invalid Chandlery architecture plan: ${failures.join(', ')}`);
  }
}

/** Compile the serializable plan through the semantic module registry. */
export function compileChandleryPlan(plan: ChandleryPlan): THREE.Group {
  assertValidPlan(plan);
  const root = new THREE.Group();
  root.name = 'Chandlery';

  for (const placement of plan.placements) {
    if (plan.debugMode === 'massing' && placement.role !== 'massing') continue;
    const module = new THREE.Group();
    module.name = `Chandlery module: ${placement.id}`;
    module.userData.architectureModuleId = placement.moduleId;
    module.userData.architectureOwnerKey = placement.ownerKey;
    root.add(module);
    CHANDLERY_MODULE_REGISTRY[placement.moduleId]({ root, module, plan, placement });
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

export function createChandleryMesh(
  debugMode: ChandleryDebugMode = 'final',
): THREE.Group {
  return compileChandleryPlan(createChandleryPlan(debugMode));
}
