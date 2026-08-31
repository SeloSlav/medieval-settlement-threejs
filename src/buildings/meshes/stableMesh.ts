import * as THREE from 'three';
import { ProceduralGeometryWriter } from '../proceduralArchitecture/geometryWriter.ts';
import { addProceduralMaterialSlotMeshes } from '../proceduralArchitecture/materialSlotMeshes.ts';

export type StableOxRestAnchor = Readonly<{
  id: `stable-ox-rest-${1 | 2 | 3}`;
  slotIndex: 0 | 1 | 2;
  /** Local building-space position; local +Z is the road-facing entrance. */
  localPosition: readonly [x: number, y: number, z: number];
  /** Oxen face the rear mangers while resting, ready to turn toward local +Z. */
  localYaw: number;
}>;

const STABLE_BAY_CENTERS_X = [-3, 0, 3] as const;

/**
 * Stable simulation and presentation share these three authored rest slots.
 * Keep them as plain serializable data so dynamic ox visuals do not need to
 * inspect or retain the statically batched building mesh.
 */
export const STABLE_OX_REST_ANCHORS = [
  {
    id: 'stable-ox-rest-1',
    slotIndex: 0,
    localPosition: [STABLE_BAY_CENTERS_X[0], 0.08, 0.35],
    localYaw: Math.PI,
  },
  {
    id: 'stable-ox-rest-2',
    slotIndex: 1,
    localPosition: [STABLE_BAY_CENTERS_X[1], 0.08, 0.35],
    localYaw: Math.PI,
  },
  {
    id: 'stable-ox-rest-3',
    slotIndex: 2,
    localPosition: [STABLE_BAY_CENTERS_X[2], 0.08, 0.35],
    localYaw: Math.PI,
  },
] as const satisfies readonly StableOxRestAnchor[];

const STABLE_MODULE_IDS = [
  'fieldstone-post-footings',
  'connected-post-and-rafter-frame',
  'packed-earth-stall-floor',
  'wide-stall-doors',
  'vented-loft',
  'open-boarded-mangers',
  'joined-split-shingle-roof',
  'covered-tie-rail',
] as const;

type StableModuleId = typeof STABLE_MODULE_IDS[number];

export type StableArchitecturePlan = Readonly<{
  typology: 'three-bay-open-ox-stable';
  bayCount: 3;
  bayCentersX: readonly [-3, 0, 3];
  roadFacingSide: 'positive-z';
  dimensions: Readonly<{
    width: 10.2;
    depth: 4.7;
    eaveHeight: 3.37;
    ridgeHeight: 5.35;
    roofOverhang: 0.45;
  }>;
  bays: readonly Readonly<{
    id: `stable-bay-${1 | 2 | 3}`;
    centerX: number;
    clearOpeningWidth: 2.72;
  }>[];
  modules: readonly StableModuleId[];
  oxRestAnchorIds: readonly [
    'stable-ox-rest-1',
    'stable-ox-rest-2',
    'stable-ox-rest-3',
  ];
  diagnostics: Readonly<{
    overlappingBayPairs: readonly string[];
    duplicateAnchorIds: readonly string[];
    outOfBoundsAnchorIds: readonly string[];
    misalignedAnchorIds: readonly string[];
    missingCatalogModuleIds: readonly string[];
    minimumAnchorSpacing: number;
    minimumPortalClearWidth: number;
  }>;
}>;

const STABLE_DIMENSIONS = {
  width: 10.2,
  depth: 4.7,
  eaveHeight: 3.37,
  ridgeHeight: 5.35,
  roofOverhang: 0.45,
} as const;
const STABLE_BAYS = STABLE_BAY_CENTERS_X.map((centerX, index) => ({
  id: `stable-bay-${index + 1}` as `stable-bay-${1 | 2 | 3}`,
  centerX,
  clearOpeningWidth: 2.72 as const,
}));
const CATALOG_STABLE_MODULES = [
  'packed-earth-stall-floor',
  'wide-stall-doors',
  'vented-loft',
  'covered-tie-rail',
] as const;

function compileStablePlanDiagnostics(): StableArchitecturePlan['diagnostics'] {
  const seenIds = new Set<string>();
  const duplicateAnchorIds: string[] = [];
  const outOfBoundsAnchorIds: string[] = [];
  const misalignedAnchorIds: string[] = [];
  const overlappingBayPairs: string[] = [];
  let minimumAnchorSpacing = Number.POSITIVE_INFINITY;

  for (const anchor of STABLE_OX_REST_ANCHORS) {
    if (seenIds.has(anchor.id)) duplicateAnchorIds.push(anchor.id);
    seenIds.add(anchor.id);
    const [x, , z] = anchor.localPosition;
    if (Math.abs(x) > 4.35 || z < -1.15 || z > 1.35) {
      outOfBoundsAnchorIds.push(anchor.id);
    }
    if (Math.abs(x - STABLE_BAY_CENTERS_X[anchor.slotIndex]) > 1e-6) {
      misalignedAnchorIds.push(anchor.id);
    }
  }

  for (let left = 0; left < STABLE_BAYS.length; left += 1) {
    for (let right = left + 1; right < STABLE_BAYS.length; right += 1) {
      const leftBay = STABLE_BAYS[left]!;
      const rightBay = STABLE_BAYS[right]!;
      const anchorDistance = Math.abs(leftBay.centerX - rightBay.centerX);
      minimumAnchorSpacing = Math.min(minimumAnchorSpacing, anchorDistance);
      if (anchorDistance < (leftBay.clearOpeningWidth + rightBay.clearOpeningWidth) * 0.5) {
        overlappingBayPairs.push(`${leftBay.id}/${rightBay.id}`);
      }
    }
  }

  return {
    overlappingBayPairs,
    duplicateAnchorIds,
    outOfBoundsAnchorIds,
    misalignedAnchorIds,
    missingCatalogModuleIds: CATALOG_STABLE_MODULES.filter(
      (moduleId) => !(STABLE_MODULE_IDS as readonly string[]).includes(moduleId),
    ),
    minimumAnchorSpacing,
    minimumPortalClearWidth: Math.min(...STABLE_BAYS.map((bay) => bay.clearOpeningWidth)),
  };
}

/** Serializable, plan-first contract retained on the mesh for lineup/debug validation. */
export function createStableArchitecturePlan(): StableArchitecturePlan {
  return {
    typology: 'three-bay-open-ox-stable',
    bayCount: 3,
    bayCentersX: STABLE_BAY_CENTERS_X,
    roadFacingSide: 'positive-z',
    dimensions: STABLE_DIMENSIONS,
    bays: STABLE_BAYS,
    modules: STABLE_MODULE_IDS,
    oxRestAnchorIds: [
      'stable-ox-rest-1',
      'stable-ox-rest-2',
      'stable-ox-rest-3',
    ],
    diagnostics: compileStablePlanDiagnostics(),
  };
}

export const STABLE_ARCHITECTURE_PLAN = createStableArchitecturePlan();

const POST_X = [-4.5, -1.5, 1.5, 4.5] as const;
const POST_LINE_Z = STABLE_DIMENSIONS.depth * 0.5;
const ROOF_HALF_DEPTH = POST_LINE_Z + STABLE_DIMENSIONS.roofOverhang;
const ROOF_HALF_WIDTH = STABLE_DIMENSIONS.width * 0.5 + 0.35;
const ROOF_EAVE_Y = 3.27;
const FOUNDATION_HEIGHT = 0.3;

function addTimberMember(
  writer: ProceduralGeometryWriter,
  semanticId: string,
  moduleId: StableModuleId,
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

function addStableStructure(writer: ProceduralGeometryWriter): void {
  for (const x of POST_X) {
    for (const z of [-POST_LINE_Z, POST_LINE_Z] as const) {
      writer.addBox({
        semanticId: `stable-footing-${x}-${z}`,
        moduleId: 'fieldstone-post-footings',
        materialRole: 'fieldstone',
        structuralUse: 'foundation-and-plinth',
        center: [x, FOUNDATION_HEIGHT * 0.5, z],
        size: [0.52, FOUNDATION_HEIGHT, 0.52],
      });
      addTimberMember(
        writer,
        `stable-post-${x}-${z}`,
        'connected-post-and-rafter-frame',
        [x, FOUNDATION_HEIGHT - 0.04, z],
        [x, STABLE_DIMENSIONS.eaveHeight, z],
        0.25,
        0.27,
      );
    }
  }

  for (const z of [-POST_LINE_Z, POST_LINE_Z] as const) {
    addTimberMember(
      writer,
      `stable-eave-plate-${z}`,
      'connected-post-and-rafter-frame',
      [-4.72, STABLE_DIMENSIONS.eaveHeight, z],
      [4.72, STABLE_DIMENSIONS.eaveHeight, z],
      0.26,
      0.3,
    );
  }

  for (const x of POST_X) {
    addTimberMember(
      writer,
      `stable-transverse-tie-${x}`,
      'connected-post-and-rafter-frame',
      [x, STABLE_DIMENSIONS.eaveHeight - 0.04, -POST_LINE_Z],
      [x, STABLE_DIMENSIONS.eaveHeight - 0.04, POST_LINE_Z],
      0.2,
      0.22,
    );
    for (const side of [-1, 1] as const) {
      addTimberMember(
        writer,
        `stable-rafter-${x}-${side}`,
        'joined-split-shingle-roof',
        [x, 3.49, side * POST_LINE_Z],
        [x, STABLE_DIMENSIONS.ridgeHeight - 0.13, 0],
        0.18,
        0.16,
      );
    }
  }

  for (const dividerX of [-1.5, 1.5] as const) {
    for (const y of [0.86, 1.46] as const) {
      addTimberMember(
        writer,
        `stable-divider-${dividerX}-${y}`,
        'connected-post-and-rafter-frame',
        [dividerX, y, -1.72],
        [dividerX, y, 1.72],
        0.14,
        0.15,
      );
    }
  }

  // A short road-facing hitching rail sits under the deep eave without
  // blocking any of the three entrance centrelines.
  for (const x of [3.45, 4.75] as const) {
    addTimberMember(
      writer,
      `stable-covered-tie-post-${x}`,
      'covered-tie-rail',
      [x, 0.12, 2.72],
      [x, 1.16, 2.72],
      0.16,
      0.17,
    );
  }
  addTimberMember(
    writer,
    'stable-covered-tie-horizontal-rail',
    'covered-tie-rail',
    [3.45, 1.08, 2.72],
    [4.75, 1.08, 2.72],
    0.17,
    0.16,
  );
}

function addStableEnclosureAndFittings(writer: ProceduralGeometryWriter): void {
  writer.addBox({
    semanticId: 'stable-rear-boarded-wall',
    moduleId: 'vented-loft',
    materialRole: 'weathered-boards',
    structuralUse: 'board-cladding',
    center: [0, 1.39, -POST_LINE_Z + 0.04],
    size: [8.84, 2.18, 0.14],
  });
  for (const [index, y] of [2.62, 2.94].entries()) {
    writer.addBox({
      semanticId: `stable-vented-loft-slat-${index + 1}`,
      moduleId: 'vented-loft',
      materialRole: 'weathered-boards',
      structuralUse: 'board-cladding',
      center: [0, y, -POST_LINE_Z + 0.035],
      size: [8.84, 0.17, 0.15],
      uvOffsetMeters: [index * 0.23, index * 0.17],
    });
  }
  for (const side of [-1, 1] as const) {
    writer.addBox({
      semanticId: `stable-${side < 0 ? 'left' : 'right'}-end-boarding`,
      moduleId: 'vented-loft',
      materialRole: 'weathered-boards',
      structuralUse: 'board-cladding',
      center: [side * 4.46, 1.42, 0],
      size: [0.13, 2.24, 4.42],
      uvOffsetMeters: [side < 0 ? 0.31 : 0.69, 0.11],
    });
  }

  for (const bay of STABLE_BAYS) {
    writer.addBox({
      semanticId: `${bay.id}-packed-earth-floor`,
      moduleId: 'packed-earth-stall-floor',
      materialRole: 'packed-earth',
      structuralUse: 'yard-and-floor-surface',
      center: [bay.centerX, 0.04, 0],
      size: [2.72, 0.08, 4.2],
    });

    // Double leaves are physically open against their jambs. The road-facing
    // portal itself remains empty instead of using a dark opening decal.
    for (const side of [-1, 1] as const) {
      writer.addBox({
        semanticId: `${bay.id}-${side < 0 ? 'left' : 'right'}-open-door-leaf`,
        moduleId: 'wide-stall-doors',
        materialRole: 'weathered-boards',
        structuralUse: 'door-and-shutter-joinery',
        center: [bay.centerX + side * 1.34, 1.34, POST_LINE_Z + 0.56],
        size: [0.12, 2.02, 1.12],
        uvOffsetMeters: [side < 0 ? 0.17 : 0.53, bay.centerX + 3],
      });
    }

    const troughCenterZ = -1.82;
    writer.addBox({
      semanticId: `${bay.id}-manger-bottom`,
      moduleId: 'open-boarded-mangers',
      materialRole: 'weathered-boards',
      structuralUse: 'board-cladding',
      center: [bay.centerX, 0.36, troughCenterZ],
      size: [2.24, 0.1, 0.62],
    });
    for (const zOffset of [-0.31, 0.31] as const) {
      writer.addBox({
        semanticId: `${bay.id}-manger-side-${zOffset}`,
        moduleId: 'open-boarded-mangers',
        materialRole: 'weathered-boards',
        structuralUse: 'board-cladding',
        center: [bay.centerX, 0.56, troughCenterZ + zOffset],
        size: [2.24, 0.42, 0.09],
      });
    }
    for (const xOffset of [-1.08, 1.08] as const) {
      writer.addBox({
        semanticId: `${bay.id}-manger-end-${xOffset}`,
        moduleId: 'open-boarded-mangers',
        materialRole: 'weathered-boards',
        structuralUse: 'board-cladding',
        center: [bay.centerX + xOffset, 0.56, troughCenterZ],
        size: [0.09, 0.42, 0.62],
      });
    }
  }
}

function addStableRoof(writer: ProceduralGeometryWriter): void {
  const roofWidth = ROOF_HALF_WIDTH * 2;
  const roofRise = STABLE_DIMENSIONS.ridgeHeight - ROOF_EAVE_Y;
  writer.addRoofPanel({
    semanticId: 'stable-roadside-joined-roof-panel',
    moduleId: 'joined-split-shingle-roof',
    materialRole: 'split-shingles',
    structuralUse: 'roof-covering',
    eaveOrigin: [-ROOF_HALF_WIDTH, ROOF_EAVE_Y, ROOF_HALF_DEPTH],
    eaveVector: [roofWidth, 0, 0],
    slopeVector: [0, roofRise, -ROOF_HALF_DEPTH],
    thickness: 0.15,
  });
  writer.addRoofPanel({
    semanticId: 'stable-rear-joined-roof-panel',
    moduleId: 'joined-split-shingle-roof',
    materialRole: 'split-shingles',
    structuralUse: 'roof-covering',
    eaveOrigin: [ROOF_HALF_WIDTH, ROOF_EAVE_Y, -ROOF_HALF_DEPTH],
    eaveVector: [-roofWidth, 0, 0],
    slopeVector: [0, roofRise, ROOF_HALF_DEPTH],
    thickness: 0.15,
    uvOffsetMeters: [0.19, 0.11],
  });
}

function addRestAnchors(group: THREE.Group): void {
  for (const anchor of STABLE_OX_REST_ANCHORS) {
    const marker = new THREE.Group();
    marker.name = `Stable ox rest anchor ${anchor.slotIndex + 1}`;
    marker.position.fromArray(anchor.localPosition);
    marker.rotation.y = anchor.localYaw;
    marker.userData.stableOxRestAnchorId = anchor.id;
    marker.userData.stableOxSlotIndex = anchor.slotIndex;
    group.add(marker);
  }
}

/** Open roadside range with three deterministic draft-ox bays. */
export function createStableMesh(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Stable';
  group.userData.architecturePlan = STABLE_ARCHITECTURE_PLAN;
  group.userData.oxRestAnchors = STABLE_OX_REST_ANCHORS;

  const writer = new ProceduralGeometryWriter([
    'packed-earth',
    'fieldstone',
    'rough-timber',
    'weathered-boards',
    'split-shingles',
  ]);
  addStableStructure(writer);
  addStableEnclosureAndFittings(writer);
  addStableRoof(writer);
  const compiled = writer.build();
  const slots = addProceduralMaterialSlotMeshes(group, compiled, {
    namePrefix: 'Stable',
    overrides: {
      fieldstone: { source: 'construction', key: 'masonryDark' },
      'rough-timber': { source: 'construction', key: 'timberDark' },
    },
  });

  const earth = slots.meshes.get('packed-earth');
  if (earth) earth.name = 'Stable three packed-earth stall floors';
  const footing = slots.meshes.get('fieldstone');
  if (footing) footing.name = 'Stable fieldstone post footings';
  const frame = slots.meshes.get('rough-timber');
  if (frame) {
    frame.name = 'Stable joined structural timber frame and covered tie rail';
    frame.userData.structuralConnection = 'joined-endpoint-authored';
    frame.userData.structuralMemberCount = frame.userData.proceduralPrimitiveCount;
  }
  const boards = slots.meshes.get('weathered-boards');
  if (boards) boards.name = 'Stable weathered-board enclosure, open doors, and mangers';
  const roof = slots.meshes.get('split-shingles');
  if (roof) {
    roof.name = 'Stable joined split-shingle roof';
    roof.userData.proceduralRoofAttachment = 'joined-gable';
  }

  group.userData.architectureCompiler = {
    planTypology: STABLE_ARCHITECTURE_PLAN.typology,
    geometryWriter: compiled.version,
    triangleCount: slots.triangleCount,
    drawCalls: slots.drawCalls,
  };
  addRestAnchors(group);
  return group;
}
