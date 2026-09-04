import * as THREE from 'three';
import { sharedBuildingDetailMaterial } from '../buildingMaterials.ts';
import { ProceduralGeometryWriter } from '../proceduralArchitecture/geometryWriter.ts';
import { addProceduralMaterialSlotMeshes } from '../proceduralArchitecture/materialSlotMeshes.ts';

export type KennelDogRestAnchor = Readonly<{
  slotIndex: 0 | 1 | 2 | 3;
  localPosition: readonly [number, number, number];
  localYaw: number;
}>;

export const KENNEL_DOG_REST_ANCHORS = [
  { slotIndex: 0, localPosition: [-2.55, 0.04, 0.7], localYaw: 0 },
  { slotIndex: 1, localPosition: [-0.85, 0.04, 0.7], localYaw: 0 },
  { slotIndex: 2, localPosition: [0.85, 0.04, 0.7], localYaw: 0 },
  { slotIndex: 3, localPosition: [2.55, 0.04, 0.7], localYaw: 0 },
] as const satisfies readonly KennelDogRestAnchor[];

const KENNEL_MODULE_IDS = [
  'fieldstone-range-footing',
  'four-dog-bays',
  'connected-kennel-frame',
  'weathered-board-enclosure',
  'joined-split-shingle-roof',
  'exercise-yard',
  'physically-open-yard-gate',
  'water-trough',
] as const;

type KennelModuleId = typeof KENNEL_MODULE_IDS[number];

export type KennelArchitecturePlan = Readonly<{
  typology: 'four-bay-open-roadside-kennel';
  bayCount: 4;
  roadFacingSide: 'positive-z';
  dimensions: Readonly<{
    width: 7.3;
    rangeDepth: 2.36;
    eaveHeight: 2.5;
    ridgeHeight: 3.75;
    gateClearWidth: 2.2;
  }>;
  bays: readonly Readonly<{
    id: `kennel-bay-${1 | 2 | 3 | 4}`;
    centerX: number;
    clearOpeningWidth: 1.48;
    anchorSlotIndex: 0 | 1 | 2 | 3;
  }>[];
  modules: readonly KennelModuleId[];
  diagnostics: Readonly<{
    duplicateAnchorSlotIndices: readonly number[];
    misalignedAnchorSlotIndices: readonly number[];
    overlappingBayPairs: readonly string[];
    missingCatalogModuleIds: readonly string[];
    gateClearWidth: number;
    minimumBayClearWidth: number;
  }>;
}>;

const KENNEL_DIMENSIONS = {
  width: 7.3,
  rangeDepth: 2.36,
  eaveHeight: 2.5,
  ridgeHeight: 3.75,
  gateClearWidth: 2.2,
} as const;
const KENNEL_BAYS = KENNEL_DOG_REST_ANCHORS.map((anchor, index) => ({
  id: `kennel-bay-${index + 1}` as `kennel-bay-${1 | 2 | 3 | 4}`,
  centerX: anchor.localPosition[0],
  clearOpeningWidth: 1.48 as const,
  anchorSlotIndex: anchor.slotIndex,
}));
const CATALOG_KENNEL_MODULES = ['four-dog-bays', 'exercise-yard', 'water-trough'] as const;

function compileKennelPlanDiagnostics(): KennelArchitecturePlan['diagnostics'] {
  const seenSlots = new Set<number>();
  const duplicateAnchorSlotIndices: number[] = [];
  const misalignedAnchorSlotIndices: number[] = [];
  const overlappingBayPairs: string[] = [];

  for (const bay of KENNEL_BAYS) {
    if (seenSlots.has(bay.anchorSlotIndex)) duplicateAnchorSlotIndices.push(bay.anchorSlotIndex);
    seenSlots.add(bay.anchorSlotIndex);
    const anchor = KENNEL_DOG_REST_ANCHORS[bay.anchorSlotIndex];
    if (!anchor || Math.abs(anchor.localPosition[0] - bay.centerX) > 1e-6) {
      misalignedAnchorSlotIndices.push(bay.anchorSlotIndex);
    }
  }
  for (let left = 0; left < KENNEL_BAYS.length; left += 1) {
    for (let right = left + 1; right < KENNEL_BAYS.length; right += 1) {
      const leftBay = KENNEL_BAYS[left]!;
      const rightBay = KENNEL_BAYS[right]!;
      if (Math.abs(leftBay.centerX - rightBay.centerX)
        < (leftBay.clearOpeningWidth + rightBay.clearOpeningWidth) * 0.5) {
        overlappingBayPairs.push(`${leftBay.id}/${rightBay.id}`);
      }
    }
  }

  return {
    duplicateAnchorSlotIndices,
    misalignedAnchorSlotIndices,
    overlappingBayPairs,
    missingCatalogModuleIds: CATALOG_KENNEL_MODULES.filter(
      (moduleId) => !(KENNEL_MODULE_IDS as readonly string[]).includes(moduleId),
    ),
    gateClearWidth: KENNEL_DIMENSIONS.gateClearWidth,
    minimumBayClearWidth: Math.min(...KENNEL_BAYS.map((bay) => bay.clearOpeningWidth)),
  };
}

/** Serializable placement plan compiled before any Three.js mesh is emitted. */
export function createKennelArchitecturePlan(): KennelArchitecturePlan {
  return {
    typology: 'four-bay-open-roadside-kennel',
    bayCount: 4,
    roadFacingSide: 'positive-z',
    dimensions: KENNEL_DIMENSIONS,
    bays: KENNEL_BAYS,
    modules: KENNEL_MODULE_IDS,
    diagnostics: compileKennelPlanDiagnostics(),
  };
}

export const KENNEL_ARCHITECTURE_PLAN = createKennelArchitecturePlan();

const BAY_BOUNDARY_X = [-3.4, -1.7, 0, 1.7, 3.4] as const;
const RANGE_FRONT_Z = -0.28;
const RANGE_REAR_Z = RANGE_FRONT_Z - KENNEL_DIMENSIONS.rangeDepth;
const RANGE_CENTER_Z = (RANGE_FRONT_Z + RANGE_REAR_Z) * 0.5;
const ROOF_HALF_WIDTH = 3.95;
const ROOF_FRONT_EAVE_Z = 0.1;
const ROOF_REAR_EAVE_Z = -3.02;
const ROOF_EAVE_Y = 2.57;
const KENNEL_TROUGH = {
  x: 2.45,
  z: 2.12,
  width: 1.48,
  depth: 0.64,
  bottomTopY: 0.25,
  rimTopY: 0.56,
  waterDepth: 0.07,
} as const;

function addTimberMember(
  writer: ProceduralGeometryWriter,
  semanticId: string,
  moduleId: KennelModuleId,
  start: readonly [number, number, number],
  end: readonly [number, number, number],
  width: number,
  depth = width,
): void {
  writer.addMember({
    semanticId,
    moduleId,
    materialRole: 'rough-timber',
    structuralUse: moduleId === 'joined-split-shingle-roof' ? 'roof-frame' : 'timber-frame',
    start,
    end,
    width,
    depth,
    upHint: [0, 1, 0],
  });
}

function addKennelShell(writer: ProceduralGeometryWriter): void {
  writer.addBox({
    semanticId: 'kennel-continuous-fieldstone-footing',
    moduleId: 'fieldstone-range-footing',
    materialRole: 'fieldstone',
    structuralUse: 'foundation-and-plinth',
    center: [0, 0.15, RANGE_CENTER_Z],
    size: [7.3, 0.3, 2.52],
  });

  for (const x of BAY_BOUNDARY_X) {
    for (const z of [RANGE_FRONT_Z, RANGE_REAR_Z] as const) {
      addTimberMember(
        writer,
        `kennel-${z === RANGE_FRONT_Z ? 'front' : 'rear'}-bay-post-${x}`,
        'connected-kennel-frame',
        [x, 0.27, z],
        [x, KENNEL_DIMENSIONS.eaveHeight, z],
        0.2,
        0.22,
      );
    }
    addTimberMember(
      writer,
      `kennel-transverse-tie-${x}`,
      'connected-kennel-frame',
      [x, KENNEL_DIMENSIONS.eaveHeight - 0.02, RANGE_REAR_Z],
      [x, KENNEL_DIMENSIONS.eaveHeight - 0.02, RANGE_FRONT_Z],
      0.17,
      0.19,
    );
    for (const side of [-1, 1] as const) {
      addTimberMember(
        writer,
        `kennel-rafter-${x}-${side}`,
        'joined-split-shingle-roof',
        [x, 2.69, side > 0 ? RANGE_FRONT_Z : RANGE_REAR_Z],
        [x, KENNEL_DIMENSIONS.ridgeHeight - 0.13, RANGE_CENTER_Z],
        0.16,
        0.15,
      );
    }
  }
  for (const z of [RANGE_FRONT_Z, RANGE_REAR_Z] as const) {
    addTimberMember(
      writer,
      `kennel-${z === RANGE_FRONT_Z ? 'front' : 'rear'}-continuous-eave-plate`,
      'connected-kennel-frame',
      [-3.52, KENNEL_DIMENSIONS.eaveHeight, z],
      [3.52, KENNEL_DIMENSIONS.eaveHeight, z],
      0.23,
      0.25,
    );
  }

  // The road-facing facade is deliberately only posts plus a connected
  // lintel. Bay centres remain literal empty apertures, not dark rectangles.
  writer.addBox({
    semanticId: 'kennel-rear-boarded-wall',
    moduleId: 'weathered-board-enclosure',
    materialRole: 'weathered-boards',
    structuralUse: 'board-cladding',
    center: [0, 1.4, RANGE_REAR_Z + 0.06],
    size: [6.82, 2.14, 0.14],
  });
  for (const side of [-1, 1] as const) {
    writer.addBox({
      semanticId: `kennel-${side < 0 ? 'left' : 'right'}-boarded-end-wall`,
      moduleId: 'weathered-board-enclosure',
      materialRole: 'weathered-boards',
      structuralUse: 'board-cladding',
      center: [side * 3.38, 1.4, RANGE_CENTER_Z],
      size: [0.14, 2.14, 2.18],
      uvOffsetMeters: [side < 0 ? 0.21 : 0.57, 0.13],
    });
  }
  for (const x of [-1.7, 0, 1.7] as const) {
    writer.addBox({
      semanticId: `kennel-interior-bay-divider-${x}`,
      moduleId: 'four-dog-bays',
      materialRole: 'weathered-boards',
      structuralUse: 'board-cladding',
      center: [x, 1.01, RANGE_CENTER_Z],
      size: [0.12, 1.42, 2.08],
    });
  }
  for (const bay of KENNEL_BAYS) {
    writer.addBox({
      semanticId: `${bay.id}-woven-rest-bed`,
      moduleId: 'four-dog-bays',
      materialRole: 'wicker',
      structuralUse: 'basketry-and-wattle',
      center: [bay.centerX, 0.36, RANGE_CENTER_Z + 0.05],
      size: [1.22, 0.1, 1.04],
      uvOffsetMeters: [bay.anchorSlotIndex * 0.17, bay.anchorSlotIndex * 0.09],
    });
  }
}

function addKennelRoof(writer: ProceduralGeometryWriter): void {
  const roofWidth = ROOF_HALF_WIDTH * 2;
  const roofCenterZ = (ROOF_FRONT_EAVE_Z + ROOF_REAR_EAVE_Z) * 0.5;
  const roofHalfDepth = (ROOF_FRONT_EAVE_Z - ROOF_REAR_EAVE_Z) * 0.5;
  const roofRise = KENNEL_DIMENSIONS.ridgeHeight - ROOF_EAVE_Y;
  writer.addRoofPanel({
    semanticId: 'kennel-roadside-joined-roof-panel',
    moduleId: 'joined-split-shingle-roof',
    materialRole: 'split-shingles',
    structuralUse: 'roof-covering',
    eaveOrigin: [-ROOF_HALF_WIDTH, ROOF_EAVE_Y, ROOF_FRONT_EAVE_Z],
    eaveVector: [roofWidth, 0, 0],
    slopeVector: [0, roofRise, -roofHalfDepth],
    thickness: 0.14,
  });
  writer.addRoofPanel({
    semanticId: 'kennel-rear-joined-roof-panel',
    moduleId: 'joined-split-shingle-roof',
    materialRole: 'split-shingles',
    structuralUse: 'roof-covering',
    eaveOrigin: [ROOF_HALF_WIDTH, ROOF_EAVE_Y, ROOF_REAR_EAVE_Z],
    eaveVector: [-roofWidth, 0, 0],
    slopeVector: [0, roofRise, roofCenterZ - ROOF_REAR_EAVE_Z],
    thickness: 0.14,
    uvOffsetMeters: [0.13, 0.19],
  });
}

function addKennelYard(writer: ProceduralGeometryWriter): void {
  const fenceX = 3.75;
  const fenceFrontZ = 3.18;
  const gateHalfWidth = KENNEL_DIMENSIONS.gateClearWidth * 0.5;
  for (const x of [-fenceX, -gateHalfWidth, gateHalfWidth, fenceX] as const) {
    addTimberMember(
      writer,
      `kennel-front-yard-post-${x}`,
      x === -gateHalfWidth || x === gateHalfWidth ? 'physically-open-yard-gate' : 'exercise-yard',
      [x, 0.08, fenceFrontZ],
      [x, 1.18, fenceFrontZ],
      0.17,
      0.18,
    );
  }
  for (const side of [-1, 1] as const) {
    for (const z of [RANGE_FRONT_Z, 1.45] as const) {
      addTimberMember(
        writer,
        `kennel-${side < 0 ? 'left' : 'right'}-yard-post-${z}`,
        'exercise-yard',
        [side * fenceX, 0.08, z],
        [side * fenceX, 1.12, z],
        0.16,
        0.17,
      );
    }
  }
  for (const y of [0.45, 0.91] as const) {
    for (const side of [-1, 1] as const) {
      const startX = side < 0 ? -fenceX : gateHalfWidth;
      const endX = side < 0 ? -gateHalfWidth : fenceX;
      addTimberMember(
        writer,
        `kennel-front-fence-rail-${side}-${y}`,
        'exercise-yard',
        [startX, y, fenceFrontZ],
        [endX, y, fenceFrontZ],
        0.13,
        0.14,
      );
      addTimberMember(
        writer,
        `kennel-side-fence-rail-${side}-${y}`,
        'exercise-yard',
        [side * fenceX, y, RANGE_FRONT_Z],
        [side * fenceX, y, fenceFrontZ],
        0.13,
        0.14,
      );
    }
  }

  // Woven leaves are swung back against the gate posts, leaving the central
  // 2.2 m passage physically clear all the way to the kennel bays.
  for (const side of [-1, 1] as const) {
    writer.addBox({
      semanticId: `kennel-open-gate-leaf-${side}`,
      moduleId: 'physically-open-yard-gate',
      materialRole: 'wicker',
      structuralUse: 'lightweight-screen',
      center: [side * (gateHalfWidth - 0.04), 0.59, fenceFrontZ - 0.64],
      size: [0.08, 0.88, 1.28],
      uvOffsetMeters: [side < 0 ? 0.18 : 0.49, 0.12],
    });
  }

  writer.addBox({
    semanticId: 'kennel-water-trough-bottom',
    moduleId: 'water-trough',
    materialRole: 'weathered-boards',
    structuralUse: 'board-cladding',
    center: [KENNEL_TROUGH.x, 0.2, KENNEL_TROUGH.z],
    size: [KENNEL_TROUGH.width, 0.1, KENNEL_TROUGH.depth],
  });
  for (const zOffset of [-0.32, 0.32] as const) {
    writer.addBox({
      semanticId: `kennel-water-trough-side-${zOffset}`,
      moduleId: 'water-trough',
      materialRole: 'weathered-boards',
      structuralUse: 'board-cladding',
      center: [KENNEL_TROUGH.x, 0.36, KENNEL_TROUGH.z + zOffset],
      size: [KENNEL_TROUGH.width, 0.4, 0.09],
    });
  }
  for (const xOffset of [-0.71, 0.71] as const) {
    writer.addBox({
      semanticId: `kennel-water-trough-end-${xOffset}`,
      moduleId: 'water-trough',
      materialRole: 'weathered-boards',
      structuralUse: 'board-cladding',
      center: [KENNEL_TROUGH.x + xOffset, 0.36, KENNEL_TROUGH.z],
      size: [0.09, 0.4, KENNEL_TROUGH.depth],
    });
  }
}

function addKennelTroughWater(group: THREE.Group): void {
  const waterSurfaceY = KENNEL_TROUGH.bottomTopY + KENNEL_TROUGH.waterDepth;
  const water = new THREE.Mesh(
    new THREE.BoxGeometry(
      KENNEL_TROUGH.width - 0.2,
      0.018,
      KENNEL_TROUGH.depth - 0.2,
    ),
    sharedBuildingDetailMaterial('water'),
  );
  water.name = 'Kennel shallow trough water';
  water.position.set(KENNEL_TROUGH.x, waterSurfaceY - 0.009, KENNEL_TROUGH.z);
  water.castShadow = false;
  water.receiveShadow = true;
  water.userData.waterDepthMeters = KENNEL_TROUGH.waterDepth;
  water.userData.troughRimClearanceMeters = KENNEL_TROUGH.rimTopY - waterSurfaceY;
  water.userData.dynamicSlot = 'water-surface';
  group.add(water);
}

function addDogRestAnchors(group: THREE.Group): void {
  for (const anchor of KENNEL_DOG_REST_ANCHORS) {
    const marker = new THREE.Group();
    marker.name = `Kennel dog rest ${anchor.slotIndex + 1}`;
    marker.position.fromArray(anchor.localPosition);
    marker.rotation.y = anchor.localYaw;
    marker.userData.kennelDogSlotIndex = anchor.slotIndex;
    group.add(marker);
  }
}

/** Four-bay roadside kennel with literal open bays and an open exercise-yard gate. */
export function createKennelMesh(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Kennel';
  group.userData.architecturePlan = KENNEL_ARCHITECTURE_PLAN;
  group.userData.dogRestAnchors = KENNEL_DOG_REST_ANCHORS;

  const writer = new ProceduralGeometryWriter([
    'fieldstone',
    'rough-timber',
    'weathered-boards',
    'split-shingles',
    'wicker',
  ]);
  addKennelShell(writer);
  addKennelRoof(writer);
  addKennelYard(writer);
  const compiled = writer.build();
  const slots = addProceduralMaterialSlotMeshes(group, compiled, {
    namePrefix: 'Kennel',
    overrides: {
      fieldstone: { source: 'construction', key: 'masonryDark' },
      'rough-timber': { source: 'construction', key: 'timberDark' },
    },
  });

  const foundation = slots.meshes.get('fieldstone');
  if (foundation) foundation.name = 'Kennel continuous fieldstone range footing';
  const frame = slots.meshes.get('rough-timber');
  if (frame) {
    frame.name = 'Kennel joined bay, roof, fence, and gate frame';
    frame.userData.structuralConnection = 'joined-endpoint-authored';
    frame.userData.structuralMemberCount = frame.userData.proceduralPrimitiveCount;
  }
  const boards = slots.meshes.get('weathered-boards');
  if (boards) boards.name = 'Kennel weathered-board enclosure and open water trough';
  const roof = slots.meshes.get('split-shingles');
  if (roof) {
    roof.name = 'Kennel joined split-shingle roof';
    roof.userData.proceduralRoofAttachment = 'joined-gable';
  }
  const wicker = slots.meshes.get('wicker');
  if (wicker) wicker.name = 'Kennel woven rest beds and open gate leaves';
  addKennelTroughWater(group);

  group.userData.architectureCompiler = {
    planTypology: KENNEL_ARCHITECTURE_PLAN.typology,
    geometryWriter: compiled.version,
    triangleCount: slots.triangleCount,
    drawCalls: slots.drawCalls,
  };
  addDogRestAnchors(group);
  return group;
}
