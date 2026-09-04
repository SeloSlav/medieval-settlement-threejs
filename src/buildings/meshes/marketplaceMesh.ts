import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  MARKETPLACE_FOOD_STALL_SLOTS,
  MARKETPLACE_GOODS_STALL_SLOTS,
  STOREHOUSE_HAUL_PER_WORKER,
} from '../../generated/gameBalance.ts';
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
  MARKET_ALE_VISUAL_SEGMENTS,
  MARKET_CLOTH_VISUAL_SEGMENTS,
  MARKET_HONEY_VISUAL_SEGMENTS,
  MARKET_IRON_VISUAL_SEGMENTS,
  MARKET_POTTERY_VISUAL_SEGMENTS,
  MARKET_SALT_VISUAL_SEGMENTS,
  MARKET_WINE_VISUAL_SEGMENTS,
} from '../marketplaceSpecialtyStockpileVisuals.ts';
import { addBarrel, addCrate } from './buildingMeshKit.ts';
import { createProceduralBuildingPlan } from '../proceduralArchitecture/catalog.ts';
import { ProceduralGeometryWriter } from '../proceduralArchitecture/geometryWriter.ts';
import { addProceduralMaterialSlotMeshes } from '../proceduralArchitecture/materialSlotMeshes.ts';
import {
  MARKETPLACE_STALL_DISPLAY_KINDS,
  MARKETPLACE_STALL_WORKER_ANCHOR_NAME,
  marketStallDisplayName,
  marketplaceStallLayout,
} from '../marketplaceStallLayout.ts';
import type {
  MarketStallDisplayKind,
  MarketStallGroup,
} from '../../economy/marketStallAssignments.ts';
import { addSharedFirewoodLog } from '../firewoodPileMesh.ts';

export const MARKET_STAGING_VISUAL_SEGMENTS = 5;
export const MARKET_RECEIPT_VISUAL_SEGMENTS = 3;
export const MARKET_RECEIPT_VISUAL_CAPACITY =
  STOREHOUSE_HAUL_PER_WORKER * MARKET_RECEIPT_VISUAL_SEGMENTS;

const MARKETPLACE_ARCHITECTURE_MODULES = [
  'open-market-lane',
  'reversible-timber-stalls',
  'physical-linen-awnings',
  'small-shingled-toll-shelter',
] as const;

type MarketplaceStallPlacement = Readonly<{
  id: `market-${MarketStallGroup}-stall-${number}`;
  group: MarketStallGroup;
  slotIndex: number;
  x: number;
  z: number;
  rotation: number;
  tableWidth: number;
  canopyDepth: 1.22;
}>;

const MARKETPLACE_STALL_PLACEMENTS: readonly MarketplaceStallPlacement[] = [
  ...Array.from({ length: MARKETPLACE_FOOD_STALL_SLOTS }, (_, slotIndex) => {
    const layout = marketplaceStallLayout('food', slotIndex);
    if (!layout) throw new Error(`Missing marketplace food stall layout ${slotIndex}.`);
    return {
      id: `market-food-stall-${slotIndex}` as const,
      group: 'food' as const,
      slotIndex,
      x: layout.x,
      z: layout.z,
      rotation: layout.rotation,
      tableWidth: layout.tableWidth,
      canopyDepth: 1.22 as const,
    };
  }),
  ...Array.from({ length: MARKETPLACE_GOODS_STALL_SLOTS }, (_, slotIndex) => {
    const layout = marketplaceStallLayout('goods', slotIndex);
    if (!layout) throw new Error(`Missing marketplace goods stall layout ${slotIndex}.`);
    return {
      id: `market-goods-stall-${slotIndex}` as const,
      group: 'goods' as const,
      slotIndex,
      x: layout.x,
      z: layout.z,
      rotation: layout.rotation,
      tableWidth: layout.tableWidth,
      canopyDepth: 1.22 as const,
    };
  }),
];

function compileMarketplacePlanDiagnostics(): {
  readonly duplicatePlacementIds: readonly string[];
  readonly overlappingStallPairs: readonly string[];
  readonly missingCatalogModules: readonly string[];
  readonly centralAccessLaneClearance: number;
  readonly deterministicSignature: string;
} {
  const seen = new Set<string>();
  const duplicatePlacementIds: string[] = [];
  const overlappingStallPairs: string[] = [];
  for (const placement of MARKETPLACE_STALL_PLACEMENTS) {
    if (seen.has(placement.id)) duplicatePlacementIds.push(placement.id);
    seen.add(placement.id);
  }
  for (let leftIndex = 0; leftIndex < MARKETPLACE_STALL_PLACEMENTS.length; leftIndex += 1) {
    const left = MARKETPLACE_STALL_PLACEMENTS[leftIndex]!;
    for (let rightIndex = leftIndex + 1; rightIndex < MARKETPLACE_STALL_PLACEMENTS.length; rightIndex += 1) {
      const right = MARKETPLACE_STALL_PLACEMENTS[rightIndex]!;
      if (left.group !== right.group) continue;
      const required = (left.tableWidth + right.tableWidth) * 0.5;
      if (Math.abs(left.x - right.x) < required) {
        overlappingStallPairs.push(`${left.id}/${right.id}`);
      }
    }
  }
  const catalogModules = createProceduralBuildingPlan('marketplace').modules;
  const coveredCatalogModules = new Set([
    'timber-stalls',
    'canvas-awnings',
    'small-shingled-toll-shelters',
    'central-access-lane',
  ]);
  return {
    duplicatePlacementIds,
    overlappingStallPairs,
    missingCatalogModules: catalogModules.filter((moduleId) => !coveredCatalogModules.has(moduleId)),
    centralAccessLaneClearance: 0.62,
    deterministicSignature: MARKETPLACE_STALL_PLACEMENTS
      .map((placement) => `${placement.id}@${placement.x.toFixed(2)},${placement.z.toFixed(2)}`)
      .join('|'),
  };
}

export const MARKETPLACE_ARCHITECTURE_PLAN = Object.freeze({
  ...createProceduralBuildingPlan('marketplace'),
  typology: 'open-periodic-market-lane' as const,
  dimensions: Object.freeze({ width: 10.2, depth: 5.9, maximumHeight: 3.1 }),
  semanticModules: MARKETPLACE_ARCHITECTURE_MODULES,
  stallPlacements: MARKETPLACE_STALL_PLACEMENTS,
  diagnostics: Object.freeze(compileMarketplacePlanDiagnostics()),
});

/**
 * Collapse a runtime-toggled prop assembly into one mesh per shared material.
 * The named parent remains untouched, so BuildingMarkers can continue to own
 * visibility while hidden variants stop contributing hundreds of tiny draws.
 */
function compactMarketVisualGroup(group: THREE.Group, semanticName: string): void {
  group.updateMatrixWorld(true);
  const inverseGroupMatrix = group.matrixWorld.clone().invert();
  const byMaterial = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const sourceMeshes: THREE.Mesh[] = [];
  group.traverse((object) => {
    if (object === group || !(object instanceof THREE.Mesh)) return;
    if (Array.isArray(object.material)) {
      throw new Error(`${semanticName} cannot compact a multi-material prop mesh.`);
    }
    const localMatrix = new THREE.Matrix4().multiplyMatrices(
      inverseGroupMatrix,
      object.matrixWorld,
    );
    const transformed = object.geometry.clone().applyMatrix4(localMatrix);
    const geometry = transformed.index ? transformed.toNonIndexed() : transformed;
    if (geometry !== transformed) transformed.dispose();
    const entries = byMaterial.get(object.material) ?? [];
    entries.push(geometry);
    byMaterial.set(object.material, entries);
    sourceMeshes.push(object);
  });
  if (sourceMeshes.length === 0) return;

  group.clear();
  let materialIndex = 0;
  for (const [material, geometries] of byMaterial) {
    const merged = geometries.length === 1
      ? geometries[0]!
      : mergeGeometries(geometries, false);
    if (!merged) throw new Error(`Could not compile ${semanticName} material ${material.name}.`);
    for (const geometry of geometries) {
      if (geometry !== merged) geometry.dispose();
    }
    merged.computeBoundingBox();
    merged.computeBoundingSphere();
    const mesh = new THREE.Mesh(merged, material);
    mesh.name = `${semanticName} material ${materialIndex + 1}`;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.userData.marketCompiledVisual = true;
    mesh.userData.marketSemanticName = semanticName;
    group.add(mesh);
    materialIndex += 1;
  }
  for (const source of sourceMeshes) source.geometry.dispose();
  group.userData.marketCompiledMeshCount = byMaterial.size;
  group.userData.marketSourceMeshCount = sourceMeshes.length;
}

function addMarketTable(
  group: THREE.Group,
  name: string,
  stallGroup: MarketStallGroup,
  slotIndex: number,
  displayPrototypes: Map<MarketStallDisplayKind, THREE.Group>,
): void {
  const layout = marketplaceStallLayout(stallGroup, slotIndex);
  if (!layout) return;
  const table = new THREE.Group();
  table.name = name;
  table.visible = false;
  table.userData.marketStallGroup = stallGroup;
  table.userData.marketStallSlotIndex = slotIndex;
  table.position.set(layout.x, 0, layout.z);
  table.rotation.y = layout.rotation;

  const halfWidth = layout.tableWidth * 0.5;
  const frameWriter = new ProceduralGeometryWriter(['rough-timber']);
  for (const [boardIndex, z] of [-0.3, -0.1, 0.1, 0.3].entries()) {
    frameWriter.addMember({
      semanticId: `${name}-counter-board-${boardIndex + 1}`,
      moduleId: 'reversible-timber-stalls',
      materialRole: 'rough-timber',
      structuralUse: 'door-and-shutter-joinery',
      start: [-halfWidth, 0.98, z],
      end: [halfWidth, 0.98, z],
      width: 0.18,
      depth: 0.12,
    });
  }
  for (const px of [-layout.legX, layout.legX]) {
    for (const pz of [-0.27, 0.27]) {
      frameWriter.addMember({
        semanticId: `${name}-counter-leg-${px < 0 ? 'left' : 'right'}-${pz < 0 ? 'rear' : 'front'}`,
        moduleId: 'reversible-timber-stalls',
        materialRole: 'rough-timber',
        structuralUse: 'timber-frame',
        start: [px, 0.04, pz],
        end: [px, 0.94, pz],
        width: 0.13,
        depth: 0.13,
      });
    }
  }
  const postX = halfWidth - 0.12;
  for (const px of [-postX, postX]) {
    frameWriter.addMember({
      semanticId: `${name}-awning-post-${px < 0 ? 'left' : 'right'}`,
      moduleId: 'physical-linen-awnings',
      materialRole: 'rough-timber',
      structuralUse: 'timber-frame',
      start: [px, 0.9, -0.38],
      end: [px, 2.23, -0.38],
      width: 0.11,
      depth: 0.11,
    });
    frameWriter.addMember({
      semanticId: `${name}-awning-arm-${px < 0 ? 'left' : 'right'}`,
      moduleId: 'physical-linen-awnings',
      materialRole: 'rough-timber',
      structuralUse: 'roof-frame',
      start: [px, 2.22, -0.38],
      end: [px, 2.08, 0.55],
      width: 0.09,
      depth: 0.09,
      upHint: [0, 1, 0],
    });
  }
  for (const [railIndex, [y, z]] of [[2.22, -0.38], [2.08, 0.55]].entries()) {
    frameWriter.addMember({
      semanticId: `${name}-awning-rail-${railIndex + 1}`,
      moduleId: 'physical-linen-awnings',
      materialRole: 'rough-timber',
      structuralUse: 'roof-frame',
      start: [-postX, y, z],
      end: [postX, y, z],
      width: 0.09,
      depth: 0.09,
    });
  }
  const compiledFrame = frameWriter.build();
  const frameSlots = addProceduralMaterialSlotMeshes(table, compiledFrame, {
    namePrefix: `Marketplace ${stallGroup} stall ${slotIndex + 1}`,
    overrides: {
      'rough-timber': { source: 'construction', key: 'timberMid' },
    },
  });
  const frame = frameSlots.meshes.get('rough-timber');
  if (frame) frame.name = `Marketplace joined brown timber ${stallGroup} counter frame ${slotIndex + 1}`;

  const awning = new THREE.Group();
  awning.name = `Marketplace physical linen ${stallGroup} awning ${slotIndex + 1}`;
  awning.position.set(0, 2.15, 0.08);
  awning.rotation.x = 0.14;
  const awningWriter = new ProceduralGeometryWriter(['linen-canvas']);
  awningWriter.addBox({
    semanticId: `${name}-sewn-linen-awning-surface`,
    moduleId: 'physical-linen-awnings',
    materialRole: 'linen-canvas',
    structuralUse: 'awning-and-fly',
    center: [0, 0, 0],
    size: [layout.tableWidth + 0.22, 0.045, 1.22],
    uvOffsetMeters: [slotIndex * 0.17, stallGroup === 'food' ? 0.08 : 0.31],
  });
  const compiledAwning = awningWriter.build();
  const awningSlots = addProceduralMaterialSlotMeshes(awning, compiledAwning, {
    namePrefix: `Marketplace ${stallGroup} awning ${slotIndex + 1}`,
  });
  const canvas = awningSlots.meshes.get('linen-canvas');
  if (canvas) {
    canvas.name = `Marketplace joined physical linen canvas surface ${stallGroup} ${slotIndex + 1}`;
    canvas.userData.fabricSurface = 'sewn-linen-awning';
  }
  table.add(awning);
  table.userData.marketStallArchitecture = {
    typology: 'reversible-timber-counter-with-linen-awning',
    timberDrawCalls: frameSlots.drawCalls,
    canvasDrawCalls: awningSlots.drawCalls,
    sourceTriangles: frameSlots.triangleCount + awningSlots.triangleCount,
  };
  const workerAnchor = new THREE.Object3D();
  workerAnchor.name = MARKETPLACE_STALL_WORKER_ANCHOR_NAME;
  workerAnchor.position.set(0, 0.02, -0.86);
  workerAnchor.userData.marketStallWorkerAnchor = true;
  table.add(workerAnchor);
  for (const displayKind of MARKETPLACE_STALL_DISPLAY_KINDS[stallGroup]) {
    addMarketStallDisplay(table, displayKind, displayPrototypes);
  }
  group.add(table);
}

function addMarketStallDisplay(
  table: THREE.Group,
  displayKind: MarketStallDisplayKind,
  displayPrototypes: Map<MarketStallDisplayKind, THREE.Group>,
): void {
  const prototype = displayPrototypes.get(displayKind);
  if (prototype) {
    const display = prototype.clone(true);
    display.name = marketStallDisplayName(displayKind);
    display.visible = false;
    display.position.y = 1.07;
    display.userData.marketDisplayKind = displayKind;
    display.userData.marketSharedDisplayPrototype = true;
    table.add(display);
    return;
  }
  const display = new THREE.Group();
  display.name = marketStallDisplayName(displayKind);
  display.visible = false;
  display.position.y = 1.07;
  display.userData.marketDisplayKind = displayKind;

  switch (displayKind) {
    case 'provisions': addProduceCrate(display); break;
    case 'bread': addBreadCounter(display); break;
    case 'meat': addMeatCounter(display, false); break;
    case 'fish': addFishCounter(display, false); break;
    case 'foraged': addForagedCounter(display); break;
    case 'milk': addMilkCounter(display); break;
    case 'fruit': addFruitCounter(display); break;
    case 'vegetables': addVegetableCounter(display); break;
    case 'eggs': addEggCounter(display); break;
    case 'honey': addHoneyCounter(display); break;
    case 'wine': addWineCounter(display); break;
    case 'preserves': addPreserveCounter(display); break;
    case 'curedMeat': addMeatCounter(display, true); break;
    case 'smokedFish': addFishCounter(display, true); break;
    case 'cheese': addCheeseCounter(display); break;
    case 'firewood': addFirewoodCounter(display); break;
    case 'charcoal': addCharcoalCounter(display); break;
    case 'cloth': addClothCounter(display); break;
    case 'shoes': addShoesCounter(display); break;
    case 'pottery': addPotteryCounter(display); break;
    case 'candles': addCandleCounter(display); break;
  }
  compactMarketVisualGroup(display, `Marketplace ${displayKind} display variant`);
  displayPrototypes.set(displayKind, display);
  table.add(display);
}

function addProduceCrate(display: THREE.Group): void {
  const crate = new THREE.Group();
  crate.position.set(-0.32, 0, 0);
  addBrownMarketCrate(crate, 0, 0, 0.48);
  display.add(crate);
  for (let index = 0; index < 3; index += 1) {
    addMesh(
      display,
      new THREE.DodecahedronGeometry(0.1, 0),
      residenceFacadeMaterial('lightOrange'),
      new THREE.Vector3(-0.48 + index * 0.16, 0.34 + (index % 2) * 0.06, -0.04),
    );
  }
}

function addBrownMarketCrate(
  group: THREE.Group,
  x: number,
  z: number,
  scale: number,
): void {
  const material = timberMaterial('weathered');
  addMesh(
    group,
    new THREE.BoxGeometry(0.78 * scale, 0.58 * scale, 0.68 * scale),
    material,
    new THREE.Vector3(x, 0.29 * scale, z),
  );
  addMesh(
    group,
    new THREE.BoxGeometry(0.84 * scale, 0.07 * scale, 0.08 * scale),
    material,
    new THREE.Vector3(x, 0.42 * scale, z + 0.34 * scale),
  );
}

function addBreadCounter(display: THREE.Group): void {
  for (const [index, x] of [-0.42, 0, 0.42].entries()) {
    const loaf = addMesh(
      display,
      new THREE.DodecahedronGeometry(0.18, 0),
      residenceFacadeMaterial('lightOrange'),
      new THREE.Vector3(x, 0.17 + (index % 2) * 0.04, 0),
      new THREE.Euler(0, index === 1 ? -0.18 : 0.16, 0),
      new THREE.Vector3(1.45, 0.72, 0.82),
    );
    loaf.userData.marketProp = 'bread-loaf';
  }
}

function addMeatCounter(display: THREE.Group, cured: boolean): void {
  const meatMaterial = sharedBuildingDetailMaterial('paintRed');
  addMesh(
    display,
    new THREE.BoxGeometry(0.92, 0.06, 0.54),
    timberMaterial('weathered'),
    new THREE.Vector3(0, 0.03, 0),
  );
  const pieces = cured ? [-0.45, -0.15, 0.15, 0.45] : [-0.3, 0.3];
  for (const [index, x] of pieces.entries()) {
    addMesh(
      display,
      cured
        ? new THREE.CylinderGeometry(0.08, 0.08, 0.48, 8)
        : new THREE.DodecahedronGeometry(0.18, 0),
      meatMaterial,
      new THREE.Vector3(x, cured ? 0.13 : 0.18, 0),
      cured
        ? new THREE.Euler(0, 0, Math.PI * 0.5)
        : new THREE.Euler(0, index === 0 ? -0.2 : 0.2, 0),
      cured ? undefined : new THREE.Vector3(1.3, 0.62, 0.9),
    );
  }
  if (!cured) {
    addMesh(
      display,
      new THREE.CylinderGeometry(0.035, 0.035, 0.7, 7),
      residenceFacadeMaterial('white'),
      new THREE.Vector3(0, 0.23, 0),
      new THREE.Euler(0, 0, Math.PI * 0.5),
    );
  }
}

function addFishCounter(display: THREE.Group, smoked: boolean): void {
  const fishMaterial = smoked
    ? timberMaterial('dark')
    : residenceFacadeMaterial('grey');
  for (const [index, x] of [-0.38, 0, 0.38].entries()) {
    addMesh(
      display,
      new THREE.DodecahedronGeometry(0.14, 0),
      fishMaterial,
      new THREE.Vector3(x, 0.15 + (index % 2) * 0.05, 0),
      new THREE.Euler(0, index % 2 === 0 ? 0.12 : -0.12, 0),
      new THREE.Vector3(1.55, 0.58, 0.72),
    );
    addMesh(
      display,
      new THREE.ConeGeometry(0.12, 0.2, 3),
      fishMaterial,
      new THREE.Vector3(x + 0.24, 0.15 + (index % 2) * 0.05, 0),
      new THREE.Euler(0, 0, -Math.PI * 0.5),
    );
  }
}

function addForagedCounter(display: THREE.Group): void {
  const crate = new THREE.Group();
  crate.position.set(-0.3, 0, 0);
  addBrownMarketCrate(crate, 0, 0, 0.42);
  display.add(crate);
  for (let index = 0; index < 3; index += 1) {
    addMesh(
      display,
      new THREE.DodecahedronGeometry(0.075, 0),
      sharedBuildingDetailMaterial('paintRed'),
      new THREE.Vector3(-0.46 + index * 0.14, 0.31 + (index % 2) * 0.05, -0.02),
    );
  }
  for (const x of [0.2, 0.45]) {
    addMesh(
      display,
      new THREE.CylinderGeometry(0.035, 0.05, 0.18, 6),
      residenceFacadeMaterial('white'),
      new THREE.Vector3(x, 0.09, 0),
    );
    addMesh(
      display,
      new THREE.ConeGeometry(0.12, 0.1, 6),
      residenceFacadeMaterial('lightOrange'),
      new THREE.Vector3(x, 0.185, 0),
    );
  }
}

function addMilkCounter(display: THREE.Group): void {
  for (const [index, x] of [-0.36, 0, 0.36].entries()) {
    const scale = index === 1 ? 1 : 0.82;
    addMesh(
      display,
      new THREE.CylinderGeometry(0.12 * scale, 0.18 * scale, 0.36 * scale, 7),
      residenceFacadeMaterial('white'),
      new THREE.Vector3(x, 0.18 * scale, 0),
    );
    addMesh(
      display,
      new THREE.CylinderGeometry(0.08 * scale, 0.1 * scale, 0.13 * scale, 7),
      residenceFacadeMaterial('grey'),
      new THREE.Vector3(x, 0.425 * scale, 0),
    );
  }
}

function addFruitCounter(display: THREE.Group): void {
  const crate = new THREE.Group();
  crate.position.set(-0.3, 0, 0);
  addBrownMarketCrate(crate, 0, 0, 0.44);
  display.add(crate);
  for (let index = 0; index < 3; index += 1) {
    addMesh(
      display,
      new THREE.DodecahedronGeometry(0.1, 0),
      sharedBuildingDetailMaterial(index % 2 === 0 ? 'paintRed' : 'paintOchre'),
      new THREE.Vector3(0.18 + (index % 2) * 0.24, 0.12 + Math.floor(index / 2) * 0.16, 0),
    );
  }
}

function addVegetableCounter(display: THREE.Group): void {
  const crate = new THREE.Group();
  addBrownMarketCrate(crate, 0, 0, 0.5);
  display.add(crate);
}

function addEggCounter(display: THREE.Group): void {
  addMesh(
    display,
    new THREE.BoxGeometry(0.98, 0.07, 0.48),
    timberMaterial('weathered'),
    new THREE.Vector3(0, 0.035, 0),
  );
  for (let index = 0; index < 4; index += 1) {
    addMesh(
      display,
      new THREE.DodecahedronGeometry(0.095, 0),
      residenceFacadeMaterial('white'),
      new THREE.Vector3(-0.36 + (index % 2) * 0.72, 0.14, index < 2 ? -0.1 : 0.1),
      undefined,
      new THREE.Vector3(0.82, 1.15, 0.82),
    );
  }
}

function addHoneyCounter(display: THREE.Group): void {
  for (const x of [-0.24, 0.24]) {
    addMesh(
      display,
      new THREE.CylinderGeometry(0.13, 0.17, 0.34, 7),
      residenceFacadeMaterial('yellow'),
      new THREE.Vector3(x, 0.17, 0),
    );
    addMesh(
      display,
      new THREE.CylinderGeometry(0.1, 0.1, 0.045, 7),
      timberMaterial('dark'),
      new THREE.Vector3(x, 0.365, 0),
    );
  }
}

function addWineCounter(display: THREE.Group): void {
  for (const [index, x] of [-0.38, 0.38].entries()) {
    const cask = new THREE.Group();
    cask.position.set(x, 0, 0);
    addWineCask(cask, index === 0 ? 0.82 : 0.7);
    display.add(cask);
  }
}

function addPreserveCounter(display: THREE.Group): void {
  for (const [index, x] of [-0.34, 0, 0.34].entries()) {
    const jar = new THREE.Group();
    jar.position.x = x;
    addMarketPottery(jar, index === 1 ? 0.82 : 0.68, index);
    addMesh(
      jar,
      new THREE.CylinderGeometry(0.09, 0.11, 0.06, 8),
      timberMaterial('dark'),
      new THREE.Vector3(0, index === 1 ? 0.39 : 0.33, 0),
    );
    display.add(jar);
  }
}

function addCheeseCounter(display: THREE.Group): void {
  for (const [index, x] of [-0.34, 0.1, 0.43].entries()) {
    addMesh(
      display,
      new THREE.CylinderGeometry(0.22, 0.22, 0.18, 8, 1, false, 0, Math.PI * (index === 1 ? 1.25 : 0.7)),
      residenceFacadeMaterial('yellow'),
      new THREE.Vector3(x, 0.09 + (index === 1 ? 0.12 : 0), 0),
      new THREE.Euler(0, index * 0.65, 0),
    );
  }
}

function addFirewoodCounter(display: THREE.Group): void {
  for (let index = 0; index < 4; index += 1) {
    addSharedFirewoodLog(
      display,
      `Marketplace split firewood billet ${index + 1}`,
      new THREE.Vector3(-0.42 + index * 0.28, 0.12 + (index % 2) * 0.1, 0),
      'x',
      index % 2 === 0 ? 'weathered' : 'mid',
    );
  }
}

function addCharcoalCounter(display: THREE.Group): void {
  addMesh(
    display,
    new THREE.BoxGeometry(1.05, 0.08, 0.52),
    timberMaterial('weathered'),
    new THREE.Vector3(0, 0.04, 0),
  );
  for (let index = 0; index < 5; index += 1) {
    addMesh(
      display,
      new THREE.DodecahedronGeometry(0.11 + (index % 3) * 0.015, 0),
      sharedBuildingMaterial('interiorDark'),
      new THREE.Vector3(-0.4 + (index % 3) * 0.4, 0.14 + Math.floor(index / 3) * 0.16, 0),
      new THREE.Euler(index * 0.4, index * 0.27, 0),
    );
  }
}

function addClothCounter(display: THREE.Group): void {
  for (const [index, x] of [-0.34, 0.34].entries()) {
    const folded = new THREE.Group();
    folded.position.x = x;
    addFoldedCloth(folded, 0.68, index);
    display.add(folded);
  }
}

function addShoesCounter(display: THREE.Group): void {
  const leather = sharedBuildingMaterial('timberDark');
  for (const [index, x] of [-0.28, 0.28].entries()) {
    const direction = index % 2 === 0 ? 1 : -1;
    addMesh(
      display,
      new THREE.BoxGeometry(0.34, 0.15, 0.2),
      leather,
      new THREE.Vector3(x, 0.12, 0),
      new THREE.Euler(0, direction * 0.12, 0),
    );
    addMesh(
      display,
      new THREE.BoxGeometry(0.18, 0.24, 0.19),
      leather,
      new THREE.Vector3(x - direction * 0.08, 0.28, 0),
      new THREE.Euler(0, direction * 0.12, 0),
    );
  }
}

function addPotteryCounter(display: THREE.Group): void {
  for (const [index, x] of [-0.42, 0, 0.42].entries()) {
    const pottery = new THREE.Group();
    pottery.position.x = x;
    addMarketPottery(pottery, index === 1 ? 0.82 : 0.66, index);
    display.add(pottery);
  }
}

function addCandleCounter(display: THREE.Group): void {
  const wax = residenceFacadeMaterial('yellow');
  const wick = timberMaterial('dark');
  for (const [index, x] of [-0.34, 0, 0.34].entries()) {
    const height = index % 2 === 0 ? 0.42 : 0.3;
    addMesh(
      display,
      new THREE.CylinderGeometry(0.075, 0.085, height, 6),
      wax,
      new THREE.Vector3(x, height * 0.5, 0),
    );
    addMesh(
      display,
      new THREE.CylinderGeometry(0.012, 0.012, 0.08, 4),
      wick,
      new THREE.Vector3(x, height + 0.04, 0),
    );
  }
}

type MarketStockPlacement = readonly [
  x: number,
  y: number,
  z: number,
  scale: number,
];

function addMarketSpecialtyStock(
  group: THREE.Group,
  containerName: string,
  segmentName: string,
  placements: readonly MarketStockPlacement[],
  addSegment: (segment: THREE.Group, scale: number, index: number) => void,
): void {
  const stockpile = new THREE.Group();
  stockpile.name = containerName;
  stockpile.visible = false;
  for (const [index, [x, y, z, scale]] of placements.entries()) {
    const segment = new THREE.Group();
    segment.name = segmentName;
    segment.visible = false;
    segment.position.set(x, y, z);
    addSegment(segment, scale, index);
    compactMarketVisualGroup(segment, `${containerName} ${segmentName} ${index + 1}`);
    stockpile.add(segment);
  }
  group.add(stockpile);
}

function addHoneyJarPair(group: THREE.Group, scale: number): void {
  addMesh(
    group,
    new THREE.BoxGeometry(0.52 * scale, 0.07 * scale, 0.3 * scale),
    timberMaterial('weathered'),
    new THREE.Vector3(0, 0.035 * scale, 0),
  );
  for (const x of [-0.13, 0.13]) {
    addMesh(
      group,
      new THREE.CylinderGeometry(0.14 * scale, 0.19 * scale, 0.4 * scale, 7),
      residenceFacadeMaterial('yellow'),
      new THREE.Vector3(x * scale, 0.27 * scale, 0),
    );
    addMesh(
      group,
      new THREE.TorusGeometry(0.11 * scale, 0.022 * scale, 4, 7),
      timberMaterial('dark'),
      new THREE.Vector3(x * scale, 0.48 * scale, 0),
      new THREE.Euler(Math.PI * 0.5, 0, 0),
    );
  }
}

function addWineCask(group: THREE.Group, scale: number): void {
  addMesh(
    group,
    new THREE.CylinderGeometry(0.3 * scale, 0.3 * scale, 0.68 * scale, 8),
    timberMaterial('mid'),
    new THREE.Vector3(0, 0.32 * scale, 0),
    new THREE.Euler(0, 0, Math.PI * 0.5),
  );
  for (const x of [-0.25, 0.25]) {
    addMesh(
      group,
      new THREE.TorusGeometry(0.3 * scale, 0.022 * scale, 4, 8),
      timberMaterial('dark'),
      new THREE.Vector3(x * scale, 0.32 * scale, 0),
      new THREE.Euler(0, Math.PI * 0.5, 0),
    );
  }
  addMesh(
    group,
    new THREE.CylinderGeometry(0.055 * scale, 0.055 * scale, 0.045 * scale, 6),
    timberMaterial('dark'),
    new THREE.Vector3(0, 0.625 * scale, 0),
  );
}

function addFoldedCloth(group: THREE.Group, scale: number, variant: number): void {
  const clothMaterial = variant % 3 === 0
    ? residenceFacadeMaterial('grey')
    : variant % 3 === 1
      ? residenceFacadeMaterial('lightOrange')
      : residenceFacadeMaterial('yellow');
  for (let layer = 0; layer < 2; layer += 1) {
    addMesh(
      group,
      new THREE.BoxGeometry(0.58 * scale, 0.14 * scale, 0.42 * scale),
      clothMaterial,
      new THREE.Vector3(
        (layer === 0 ? -0.04 : 0.04) * scale,
        (0.08 + layer * 0.14) * scale,
        0,
      ),
      new THREE.Euler(0, layer === 0 ? -0.08 : 0.07, 0),
    );
  }
  addMesh(
    group,
    new THREE.BoxGeometry(0.07 * scale, 0.31 * scale, 0.46 * scale),
    timberMaterial('dark'),
    new THREE.Vector3(0, 0.15 * scale, 0),
  );
}

function addIronBundle(group: THREE.Group, scale: number, variant: number): void {
  for (let bar = 0; bar < 3; bar += 1) {
    addMesh(
      group,
      new THREE.BoxGeometry(0.62 * scale, 0.08 * scale, 0.1 * scale),
      metalMaterial('iron'),
      new THREE.Vector3(
        0,
        (0.08 + bar * 0.09) * scale,
        (bar - 1) * 0.11 * scale,
      ),
      new THREE.Euler(0, (variant % 2 === 0 ? 0.08 : -0.08), 0),
    );
  }
}

function addSaltSack(group: THREE.Group, scale: number): void {
  const sack = addMesh(
    group,
    new THREE.DodecahedronGeometry(0.29 * scale, 0),
    residenceFacadeMaterial('white'),
    new THREE.Vector3(0, 0.29 * scale, 0),
  );
  sack.scale.set(0.84, 1.18, 0.8);
  addMesh(
    group,
    new THREE.CylinderGeometry(0.06 * scale, 0.1 * scale, 0.14 * scale, 6),
    sharedBuildingDetailMaterial('wicker'),
    new THREE.Vector3(0, 0.65 * scale, 0),
  );
}

function addMarketPottery(group: THREE.Group, scale: number, variant: number): void {
  const potteryMaterial = residenceFacadeMaterial(
    variant % 2 === 0 ? 'orange' : 'lightOrange',
  );
  addMesh(
    group,
    new THREE.DodecahedronGeometry(0.2 * scale, 0),
    potteryMaterial,
    new THREE.Vector3(0, 0.22 * scale, 0),
    undefined,
    new THREE.Vector3(1, 1.12, 1),
  );
  addMesh(
    group,
    new THREE.CylinderGeometry(0.1 * scale, 0.14 * scale, 0.2 * scale, 7, 1, true),
    potteryMaterial,
    new THREE.Vector3(0, 0.43 * scale, 0),
  );
}

function addMarketSpecialtyStalls(group: THREE.Group): void {
  addMarketSpecialtyStock(
    group,
    'MarketAleStockpile',
    'MarketAleSegment',
    ([
      [-3.0, 0, 1.45, 0.9],
      [-2.35, 0, 1.42, 0.78],
      [-3.15, 0, 0.78, 0.7],
    ] as const).slice(0, MARKET_ALE_VISUAL_SEGMENTS),
    (segment, scale) => addBarrel(segment, 0, 0, scale),
  );
  addMarketSpecialtyStock(
    group,
    'MarketHoneyStockpile',
    'MarketHoneySegment',
    ([
      [-2.05, 0, 3.02, 1.35],
      [-1.58, 0, 3.08, 1.2],
      [-1.13, 0, 3.0, 1.05],
    ] as const).slice(0, MARKET_HONEY_VISUAL_SEGMENTS),
    (segment, scale) => addHoneyJarPair(segment, scale),
  );
  addMarketSpecialtyStock(
    group,
    'MarketWineStockpile',
    'MarketWineSegment',
    ([
      [2.75, 0, 1.5, 1],
      [2.08, 0, 1.45, 0.88],
      [3.0, 0, 0.82, 0.78],
    ] as const).slice(0, MARKET_WINE_VISUAL_SEGMENTS),
    (segment, scale) => addWineCask(segment, scale),
  );
  addMarketSpecialtyStock(
    group,
    'MarketClothStockpile',
    'MarketClothSegment',
    ([
      [1.02, 0, 3.0, 1.4],
      [1.68, 0, 3.08, 1.24],
      [2.3, 0, 3.0, 1.08],
    ] as const).slice(0, MARKET_CLOTH_VISUAL_SEGMENTS),
    (segment, scale, index) => addFoldedCloth(segment, scale, index),
  );
  addMarketSpecialtyStock(
    group,
    'MarketIronStockpile',
    'MarketIronSegment',
    ([
      [-3.08, 0, -1.9, 1.1],
      [-2.45, 0, -1.92, 0.98],
      [-1.82, 0, -1.88, 0.88],
    ] as const).slice(0, MARKET_IRON_VISUAL_SEGMENTS),
    (segment, scale, index) => addIronBundle(segment, scale, index),
  );
  addMarketSpecialtyStock(
    group,
    'MarketSaltStockpile',
    'MarketSaltSegment',
    ([
      [-0.82, 0, -1.92, 1.1],
      [-0.22, 0, -1.9, 0.98],
      [0.35, 0, -1.88, 0.88],
    ] as const).slice(0, MARKET_SALT_VISUAL_SEGMENTS),
    (segment, scale) => addSaltSack(segment, scale),
  );
  addMarketSpecialtyStock(
    group,
    'MarketPotteryStockpile',
    'MarketPotterySegment',
    ([
      [1.35, 0, -1.94, 1.18],
      [1.92, 0, -1.94, 1.04],
      [2.48, 0, -1.91, 0.92],
    ] as const).slice(0, MARKET_POTTERY_VISUAL_SEGMENTS),
    (segment, scale, index) => addMarketPottery(segment, scale, index),
  );
}

function addMarketStagingStock(group: THREE.Group): void {
  const timber = new THREE.Group();
  timber.name = 'MarketTimberStaging';
  timber.position.set(-4.55, 0.1, 1.25);
  for (let index = 0; index < MARKET_STAGING_VISUAL_SEGMENTS; index++) {
    const beam = addMesh(
      timber,
      new THREE.BoxGeometry(2.15, 0.18, 0.2),
      timberMaterial(index % 2 === 0 ? 'weathered' : 'dark'),
      new THREE.Vector3(
        0,
        0.12 + Math.floor(index / 2) * 0.2,
        (index % 2) * 0.26,
      ),
    );
    beam.name = `MarketTimberStageSegment${index}`;
    beam.visible = false;
  }
  group.add(timber);

  const stone = new THREE.Group();
  stone.name = 'MarketStoneStaging';
  stone.position.set(4.5, 0.1, -1.25);
  for (let index = 0; index < MARKET_STAGING_VISUAL_SEGMENTS; index++) {
    const block = addMesh(
      stone,
      new THREE.BoxGeometry(0.58, 0.38, 0.5),
      stoneMaterial(index % 2 === 0 ? 'mid' : 'light'),
      new THREE.Vector3(
        (index % 3) * 0.54 - 0.54,
        0.2 + Math.floor(index / 3) * 0.36,
        (index % 2) * 0.18,
      ),
      new THREE.Euler(0, (index % 3 - 1) * 0.08, 0),
    );
    block.name = `MarketStoneStageSegment${index}`;
    block.visible = false;
  }
  group.add(stone);

  const crates = new THREE.Group();
  crates.name = 'MarketCratedGoodsStaging';
  crates.position.set(4.5, 0, 1.25);
  for (let index = 0; index < MARKET_STAGING_VISUAL_SEGMENTS; index++) {
    const crate = new THREE.Group();
    crate.name = `MarketCratedStageSegment${index}`;
    crate.visible = false;
    crate.position.set(
      (index % 2) * 0.7 - 0.35,
      Math.floor(index / 4) * 0.62,
      Math.floor(index / 2) % 2 * 0.72,
    );
    addCrate(crate, 0, 0, index % 2 === 0 ? 0.62 : 0.54);
    compactMarketVisualGroup(crate, `Marketplace crated goods stage ${index + 1}`);
    crates.add(crate);
  }
  group.add(crates);
}

function addMarketProceedsChest(group: THREE.Group): void {
  const chest = new THREE.Group();
  chest.name = 'MarketProceedsChest';
  chest.visible = false;
  chest.position.set(2.6, 0.25, -1.45);
  for (let index = 0; index < MARKET_RECEIPT_VISUAL_SEGMENTS; index += 1) {
    const segment = new THREE.Group();
    segment.name = 'MarketReceiptSegment';
    segment.visible = false;
    const [x, y, z] = [
      [0, 0.08, 0.1],
      [-0.62, 0, 0],
      [0.62, 0, 0],
    ][index];
    segment.position.set(x, y, z);
    addMesh(
      segment,
      new THREE.BoxGeometry(0.58, 0.4, 0.48),
      timberMaterial(index === 1 ? 'weathered' : 'dark'),
      new THREE.Vector3(0, 0.22, 0),
    );
    addMesh(
      segment,
      new THREE.CylinderGeometry(0.24, 0.24, 0.58, 8, 1, false, 0, Math.PI),
      timberMaterial('weathered'),
      new THREE.Vector3(0, 0.45, 0),
      new THREE.Euler(0, 0, Math.PI * 0.5),
    );
    addMesh(
      segment,
      new THREE.BoxGeometry(0.065, 0.46, 0.52),
      metalMaterial('iron'),
      new THREE.Vector3(0, 0.3, 0),
    );
    compactMarketVisualGroup(segment, `MarketReceiptSegment ${index + 1}`);
    chest.add(segment);
  }
  group.add(chest);
}

function addMarketplaceTollShelter(writer: ProceduralGeometryWriter): void {
  const centerX = 4.3;
  const centerZ = -2.3;
  const postHalfX = 0.72;
  const postHalfZ = 0.42;
  for (const xSign of [-1, 1] as const) {
    for (const zSign of [-1, 1] as const) {
      const x = centerX + xSign * postHalfX;
      const z = centerZ + zSign * postHalfZ;
      writer.addBox({
        semanticId: `market-toll-shelter-footing-${xSign}-${zSign}`,
        moduleId: 'small-shingled-toll-shelter',
        materialRole: 'fieldstone',
        structuralUse: 'foundation-and-plinth',
        center: [x, 0.14, z],
        size: [0.36, 0.28, 0.36],
      });
      writer.addMember({
        semanticId: `market-toll-shelter-post-${xSign}-${zSign}`,
        moduleId: 'small-shingled-toll-shelter',
        materialRole: 'rough-timber',
        structuralUse: 'timber-frame',
        start: [x, 0.26, z],
        end: [x, 2.2, z],
        width: 0.16,
        depth: 0.16,
      });
    }
  }
  for (const zSign of [-1, 1] as const) {
    const z = centerZ + zSign * postHalfZ;
    writer.addMember({
      semanticId: `market-toll-shelter-header-${zSign}`,
      moduleId: 'small-shingled-toll-shelter',
      materialRole: 'rough-timber',
      structuralUse: 'roof-frame',
      start: [centerX - postHalfX, 2.18, z],
      end: [centerX + postHalfX, 2.18, z],
      width: 0.16,
      depth: 0.14,
    });
  }
  for (const xSign of [-1, 1] as const) {
    const x = centerX + xSign * postHalfX;
    writer.addMember({
      semanticId: `market-toll-shelter-tie-${xSign}`,
      moduleId: 'small-shingled-toll-shelter',
      materialRole: 'rough-timber',
      structuralUse: 'roof-frame',
      start: [x, 2.18, centerZ - postHalfZ],
      end: [x, 2.18, centerZ + postHalfZ],
      width: 0.14,
      depth: 0.14,
    });
  }
  writer.addMember({
    semanticId: 'market-toll-shelter-front-brace-left',
    moduleId: 'small-shingled-toll-shelter',
    materialRole: 'rough-timber',
    structuralUse: 'timber-frame',
    start: [centerX - postHalfX, 1.35, centerZ - postHalfZ],
    end: [centerX - 0.18, 2.18, centerZ - postHalfZ],
    width: 0.11,
    depth: 0.1,
  });
  writer.addMember({
    semanticId: 'market-toll-shelter-front-brace-right',
    moduleId: 'small-shingled-toll-shelter',
    materialRole: 'rough-timber',
    structuralUse: 'timber-frame',
    start: [centerX + postHalfX, 1.35, centerZ - postHalfZ],
    end: [centerX + 0.18, 2.18, centerZ - postHalfZ],
    width: 0.11,
    depth: 0.1,
  });
  writer.addBox({
    semanticId: 'market-toll-shelter-board-counter',
    moduleId: 'small-shingled-toll-shelter',
    materialRole: 'weathered-boards',
    structuralUse: 'door-and-shutter-joinery',
    center: [centerX, 1.02, centerZ - 0.33],
    size: [1.38, 0.16, 0.5],
    uvOffsetMeters: [0.13, 0.07],
  });

  const roofWidth = 2.08;
  const halfRoofDepth = 0.72;
  const roofEaveY = 2.24;
  const roofRise = 0.68;
  writer.addRoofPanel({
    semanticId: 'market-toll-shelter-front-joined-roof-panel',
    moduleId: 'small-shingled-toll-shelter',
    materialRole: 'split-shingles',
    structuralUse: 'roof-covering',
    eaveOrigin: [centerX - roofWidth * 0.5, roofEaveY, centerZ - halfRoofDepth],
    eaveVector: [roofWidth, 0, 0],
    slopeVector: [0, roofRise, halfRoofDepth],
    thickness: 0.11,
    uvOffsetMeters: [0.08, 0.16],
  });
  writer.addRoofPanel({
    semanticId: 'market-toll-shelter-rear-joined-roof-panel',
    moduleId: 'small-shingled-toll-shelter',
    materialRole: 'split-shingles',
    structuralUse: 'roof-covering',
    eaveOrigin: [centerX - roofWidth * 0.5, roofEaveY, centerZ + halfRoofDepth],
    eaveVector: [roofWidth, 0, 0],
    slopeVector: [0, roofRise, -halfRoofDepth],
    thickness: 0.11,
    uvOffsetMeters: [0.27, 0.16],
  });
}

/** Open periodic market with reversible stalls and one small toll shelter. */
export function createMarketplaceMesh(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Marketplace';
  group.userData.architecturePlan = MARKETPLACE_ARCHITECTURE_PLAN;

  const writer = new ProceduralGeometryWriter([
    'fieldstone',
    'rough-timber',
    'weathered-boards',
    'split-shingles',
  ]);
  addMarketplaceTollShelter(writer);
  const compiled = writer.build();
  const slots = addProceduralMaterialSlotMeshes(group, compiled, {
    namePrefix: 'Marketplace',
    overrides: {
      fieldstone: { source: 'construction', key: 'masonryDark' },
      'rough-timber': { source: 'construction', key: 'timberMid' },
    },
  });
  const footing = slots.meshes.get('fieldstone');
  if (footing) footing.name = 'Marketplace discrete toll-shelter fieldstone footings';
  const timber = slots.meshes.get('rough-timber');
  if (timber) timber.name = 'Marketplace joined brown-timber toll-shelter frame';
  const boards = slots.meshes.get('weathered-boards');
  if (boards) boards.name = 'Marketplace weathered-board toll counter';
  const roof = slots.meshes.get('split-shingles');
  if (roof) {
    roof.name = 'Marketplace joined split-shingle toll-shelter roof';
    roof.userData.proceduralRoofAttachment = 'joined-small-gable';
  }

  const displayPrototypes = new Map<MarketStallDisplayKind, THREE.Group>();
  for (let index = 0; index < MARKETPLACE_FOOD_STALL_SLOTS; index += 1) {
    addMarketTable(group, `MarketFoodStall${index}`, 'food', index, displayPrototypes);
  }
  for (let index = 0; index < MARKETPLACE_GOODS_STALL_SLOTS; index += 1) {
    addMarketTable(group, `MarketGoodsStall${index}`, 'goods', index, displayPrototypes);
  }
  addMarketSpecialtyStalls(group);
  addMarketStagingStock(group);
  addMarketProceedsChest(group);

  let sourceMeshCount = 0;
  let sourceTriangleCount = 0;
  let compiledVariantCount = 0;
  group.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      sourceMeshCount += 1;
      sourceTriangleCount += object.geometry.index
        ? object.geometry.index.count / 3
        : (object.geometry.getAttribute('position')?.count ?? 0) / 3;
    }
    if (object.userData.marketCompiledMeshCount !== undefined) compiledVariantCount += 1;
  });
  group.userData.architectureCompiler = {
    planTypology: MARKETPLACE_ARCHITECTURE_PLAN.typology,
    geometryWriter: compiled.version,
    staticTriangleCount: slots.triangleCount,
    staticDrawCalls: slots.drawCalls,
    sourceMeshCount,
    sourceTriangleCount: Math.round(sourceTriangleCount),
    compiledVariantCount,
    sharedDisplayPrototypeCount: displayPrototypes.size,
  };
  group.userData.architectureDiagnostics = {
    ...MARKETPLACE_ARCHITECTURE_PLAN.diagnostics,
    plannedStallCount: MARKETPLACE_STALL_PLACEMENTS.length,
    staticPrimitiveCount: compiled.diagnostics.primitiveCount,
    staticMaterialSlotCount: compiled.diagnostics.materialSlotCount,
    staticTriangleCount: slots.triangleCount,
    staticDrawCalls: slots.drawCalls,
    sourceMeshCount,
    sourceTriangleCount: Math.round(sourceTriangleCount),
    compiledVariantCount,
    sharedDisplayPrototypeCount: displayPrototypes.size,
  };
  return group;
}
