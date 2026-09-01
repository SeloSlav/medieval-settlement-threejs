import * as THREE from 'three';
import { ProceduralGeometryWriter } from '../proceduralArchitecture/geometryWriter.ts';
import { addProceduralMaterialSlotMeshes } from '../proceduralArchitecture/materialSlotMeshes.ts';

export type CavalryHorseRestAnchor = Readonly<{
  id: `cavalry-horse-rest-${number}`;
  slotIndex: number;
  zone: 'stable' | 'paddock';
  localPosition: readonly [number, number, number];
  localYaw: number;
}>;

const STABLE_BAY_CENTERS = [-9.05, -7.15, -5.25, -3.35, -1.45, 0.45] as const;
const PADDOCK_REST_POINTS = [
  [3.65, -3.65], [6.25, -3.85], [8.75, -2.8],
  [3.65, 0.25], [6.35, 0.35], [8.75, -0.1],
] as const;

/** Purchase slots alternate between a sheltered loose box and the schooling
 * paddock, so even a small remount string visibly uses both parts of the yard. */
export const CAVALRY_HORSE_REST_ANCHORS = Array.from({ length: 12 }, (_, slot) => {
  const stable = slot % 2 === 0;
  const localIndex = Math.floor(slot / 2);
  const paddockPoint = PADDOCK_REST_POINTS[localIndex]!;
  return {
    id: `cavalry-horse-rest-${slot + 1}` as const,
    slotIndex: slot,
    zone: stable ? 'stable' as const : 'paddock' as const,
    localPosition: stable
      ? [STABLE_BAY_CENTERS[localIndex]!, 0.08, -0.35] as const
      : [paddockPoint[0], 0.08, paddockPoint[1]] as const,
    localYaw: stable ? 0 : localIndex / 6 * Math.PI * 2,
  };
}) satisfies readonly CavalryHorseRestAnchor[];

const MODULES = [
  'six-bay-stable-range',
  'open-stall-fronts',
  'feed-and-tack-store',
  'fenced-training-paddock',
  'schooling-ring',
  'covered-hitching-rails',
  'horse-trough',
  'wattle-courtyard-and-cart-gate',
] as const;

export const CAVALRY_YARD_ARCHITECTURE_PLAN = {
  typology: 'frontier-cavalry-yard',
  period: 'circa-1550',
  region: 'Croatian-Hungarian-frontier',
  roadFacingSide: 'positive-z',
  dimensions: { width: 21.6, depth: 14.8, ridgeHeight: 5.1 },
  modules: MODULES,
  signature: 'six open stable bays, detached tack room, schooling ring, hitching court, and gated wattle boundary',
  horseCapacity: 12,
  companyCapacity: 2,
  anchors: CAVALRY_HORSE_REST_ANCHORS,
  diagnostics: {
    duplicateAnchorIds: new Set(CAVALRY_HORSE_REST_ANCHORS.map((anchor) => anchor.id)).size
      === CAVALRY_HORSE_REST_ANCHORS.length ? [] : ['duplicate'],
    outOfBoundsAnchorIds: CAVALRY_HORSE_REST_ANCHORS
      .filter((anchor) => Math.abs(anchor.localPosition[0]) > 10.2 || Math.abs(anchor.localPosition[2]) > 6.6)
      .map((anchor) => anchor.id),
    stableBayCount: STABLE_BAY_CENTERS.length,
    stableAnchorCount: CAVALRY_HORSE_REST_ANCHORS.filter((anchor) => anchor.zone === 'stable').length,
    paddockAnchorCount: CAVALRY_HORSE_REST_ANCHORS.filter((anchor) => anchor.zone === 'paddock').length,
    minimumAnchorSpacing: 1.75,
    clearRoadApronDepth: 1.6,
  },
} as const;

function timberMember(
  writer: ProceduralGeometryWriter,
  semanticId: string,
  moduleId: (typeof MODULES)[number],
  start: readonly [number, number, number],
  end: readonly [number, number, number],
  width: number,
  depth = width,
): void {
  writer.addMember({
    semanticId,
    moduleId,
    materialRole: 'rough-timber',
    structuralUse: 'timber-frame',
    start,
    end,
    width,
    depth,
    upHint: [0, 1, 0],
  });
}

function addSixBayStableRange(writer: ProceduralGeometryWriter): void {
  writer.addBox({
    semanticId: 'stable-range-packed-floor', moduleId: 'six-bay-stable-range',
    materialRole: 'packed-earth', structuralUse: 'yard-and-floor-surface',
    center: [-4.3, 0.08, -1.75], size: [11.4, 0.16, 5.35],
  });
  writer.addBox({
    semanticId: 'stable-range-rear-fieldstone-plinth', moduleId: 'six-bay-stable-range',
    materialRole: 'fieldstone', structuralUse: 'foundation-and-plinth',
    center: [-4.3, 0.34, -4.32], size: [11.65, 0.68, 0.52],
  });
  writer.addBox({
    semanticId: 'stable-range-left-fieldstone-plinth', moduleId: 'six-bay-stable-range',
    materialRole: 'fieldstone', structuralUse: 'foundation-and-plinth',
    center: [-9.98, 0.34, -1.78], size: [0.52, 0.68, 5.55],
  });

  const postXs = [-10, -8.1, -6.2, -4.3, -2.4, -0.5, 1.4] as const;
  for (const x of postXs) {
    for (const z of [-4.12, 0.72] as const) {
      timberMember(writer, `stable-range-post-${x}-${z}`, 'six-bay-stable-range', [x, 0.16, z], [x, 3.28, z], 0.24, 0.28);
    }
  }
  for (const z of [-4.12, 0.72] as const) {
    timberMember(writer, `stable-range-eave-plate-${z}`, 'six-bay-stable-range', [-10.15, 3.27, z], [1.55, 3.27, z], 0.28, 0.3);
  }
  for (const x of postXs) {
    timberMember(writer, `stable-range-rafter-front-${x}`, 'six-bay-stable-range', [x, 3.23, 1.06], [x, 5.08, -1.7], 0.17, 0.19);
    timberMember(writer, `stable-range-rafter-rear-${x}`, 'six-bay-stable-range', [x, 3.23, -4.58], [x, 5.08, -1.7], 0.17, 0.19);
  }
  writer.addBox({
    semanticId: 'stable-range-rear-board-wall', moduleId: 'six-bay-stable-range',
    materialRole: 'weathered-boards', structuralUse: 'board-cladding',
    center: [-4.3, 1.78, -4.17], size: [11.25, 2.7, 0.16],
  });
  writer.addBox({
    semanticId: 'stable-range-left-board-wall', moduleId: 'six-bay-stable-range',
    materialRole: 'weathered-boards', structuralUse: 'board-cladding',
    center: [-9.94, 1.78, -1.75], size: [0.16, 2.7, 4.68],
  });

  for (let bayIndex = 0; bayIndex < STABLE_BAY_CENTERS.length; bayIndex += 1) {
    const centerX = STABLE_BAY_CENTERS[bayIndex]!;
    timberMember(writer, `stable-bay-${bayIndex + 1}-lintel`, 'open-stall-fronts', [centerX - 0.72, 2.42, 0.73], [centerX + 0.72, 2.42, 0.73], 0.18, 0.22);
    for (const side of [-1, 1] as const) {
      writer.addBox({
        semanticId: `stable-bay-${bayIndex + 1}-open-half-door-${side}`,
        moduleId: 'open-stall-fronts',
        materialRole: 'weathered-boards', structuralUse: 'door-and-shutter-joinery',
        center: [centerX + side * 0.88, 0.82, 1.25], size: [0.12, 1.25, 1.02],
        uvOffsetMeters: [bayIndex * 0.17, side < 0 ? 0.13 : 0.47],
      });
    }
    if (bayIndex < STABLE_BAY_CENTERS.length - 1) {
      const dividerX = centerX + 0.95;
      for (const y of [0.84, 1.45] as const) {
        timberMember(writer, `stable-bay-divider-${bayIndex + 1}-${y}`, 'six-bay-stable-range', [dividerX, y, -3.75], [dividerX, y, 0.35], 0.13, 0.16);
      }
    }
    writer.addBox({
      semanticId: `stable-bay-${bayIndex + 1}-manger`, moduleId: 'six-bay-stable-range',
      materialRole: 'weathered-boards', structuralUse: 'board-cladding',
      center: [centerX, 0.54, -3.62], size: [1.5, 0.5, 0.48],
    });
  }

  writer.addRoofPanel({
    semanticId: 'stable-range-road-roof', moduleId: 'six-bay-stable-range',
    materialRole: 'split-shingles', structuralUse: 'roof-covering',
    eaveOrigin: [-10.35, 3.24, 1.12], eaveVector: [12.1, 0, 0],
    slopeVector: [0, 1.87, -2.82], thickness: 0.15,
  });
  writer.addRoofPanel({
    semanticId: 'stable-range-rear-roof', moduleId: 'six-bay-stable-range',
    materialRole: 'split-shingles', structuralUse: 'roof-covering',
    eaveOrigin: [1.75, 3.24, -4.64], eaveVector: [-12.1, 0, 0],
    slopeVector: [0, 1.87, 2.94], thickness: 0.15,
  });
}

function addSchoolingPaddock(writer: ProceduralGeometryWriter): void {
  writer.addBox({
    semanticId: 'schooling-ring-packed-surface', moduleId: 'schooling-ring',
    materialRole: 'packed-earth', structuralUse: 'yard-and-floor-surface',
    center: [6.3, 0.055, -1.72], size: [8.25, 0.11, 7.05],
  });
  const circuit = [
    [3.25, -5.28], [8.25, -5.28], [10.45, -3.25], [10.45, 0.15],
    [8.6, 1.85], [3.75, 1.85], [2.18, 0.2], [2.18, -3.45],
  ] as const;
  for (let index = 0; index < circuit.length; index += 1) {
    const start = circuit[index]!;
    const end = circuit[(index + 1) % circuit.length]!;
    timberMember(writer, `paddock-post-${index + 1}`, 'fenced-training-paddock', [start[0], 0.05, start[1]], [start[0], 1.48, start[1]], 0.18, 0.2);
    for (const y of [0.7, 1.28] as const) {
      timberMember(writer, `paddock-rail-${index + 1}-${y}`, 'fenced-training-paddock', [start[0], y, start[1]], [end[0], y, end[1]], 0.13, 0.17);
    }
  }
  for (const x of [4.35, 8.35] as const) {
    timberMember(writer, `schooling-ring-marker-${x}`, 'schooling-ring', [x, 0.05, -1.8], [x, 0.82, -1.8], 0.12, 0.14);
  }
}

function addTackStore(writer: ProceduralGeometryWriter): void {
  writer.addBox({
    semanticId: 'tack-store-fieldstone-plinth', moduleId: 'feed-and-tack-store',
    materialRole: 'fieldstone', structuralUse: 'foundation-and-plinth',
    center: [7.9, 0.3, 4.18], size: [4.75, 0.6, 3.05],
  });
  writer.addBox({
    semanticId: 'tack-store-boarded-body', moduleId: 'feed-and-tack-store',
    materialRole: 'weathered-boards', structuralUse: 'board-cladding',
    center: [7.9, 1.72, 4.18], size: [4.48, 2.32, 2.8],
  });
  for (const x of [5.72, 10.08] as const) {
    timberMember(writer, `tack-store-front-post-${x}`, 'feed-and-tack-store', [x, 0.58, 5.63], [x, 3.05, 5.63], 0.2, 0.22);
  }
  writer.addBox({
    semanticId: 'tack-store-open-door', moduleId: 'feed-and-tack-store',
    materialRole: 'weathered-boards', structuralUse: 'door-and-shutter-joinery',
    center: [6.0, 1.42, 5.96], size: [0.13, 1.9, 1.26],
  });
  writer.addRoofPanel({
    semanticId: 'tack-store-front-roof', moduleId: 'feed-and-tack-store',
    materialRole: 'split-shingles', structuralUse: 'roof-covering',
    eaveOrigin: [5.35, 3.0, 5.88], eaveVector: [5.1, 0, 0],
    slopeVector: [0, 1.2, -1.7], thickness: 0.14,
  });
  writer.addRoofPanel({
    semanticId: 'tack-store-rear-roof', moduleId: 'feed-and-tack-store',
    materialRole: 'split-shingles', structuralUse: 'roof-covering',
    eaveOrigin: [10.45, 3.0, 2.48], eaveVector: [-5.1, 0, 0],
    slopeVector: [0, 1.2, 1.7], thickness: 0.14,
  });
}

function addCourtyardFittings(writer: ProceduralGeometryWriter): void {
  writer.addBox({
    semanticId: 'front-courtyard-packed-surface', moduleId: 'wattle-courtyard-and-cart-gate',
    materialRole: 'packed-earth', structuralUse: 'yard-and-floor-surface',
    center: [-1.55, 0.035, 3.78], size: [13.6, 0.07, 5.2],
  });
  for (const x of [-4.6, -2.8, -1.0] as const) {
    timberMember(writer, `hitching-post-${x}`, 'covered-hitching-rails', [x, 0.08, 2.28], [x, 1.22, 2.28], 0.16, 0.18);
  }
  timberMember(writer, 'hitching-long-rail', 'covered-hitching-rails', [-4.6, 1.08, 2.28], [-1.0, 1.08, 2.28], 0.17, 0.2);

  writer.addBox({
    semanticId: 'horse-trough-bottom', moduleId: 'horse-trough',
    materialRole: 'weathered-boards', structuralUse: 'board-cladding',
    center: [1.0, 0.34, 3.72], size: [2.3, 0.12, 0.7],
  });
  for (const z of [3.38, 4.06] as const) {
    writer.addBox({
      semanticId: `horse-trough-side-${z}`, moduleId: 'horse-trough',
      materialRole: 'weathered-boards', structuralUse: 'board-cladding',
      center: [1.0, 0.56, z], size: [2.3, 0.48, 0.1],
    });
  }

  const wattlePanels = [
    [-10.45, 3.65, 0.14, 1.02, 5.45],
    [10.45, 4.2, 0.14, 1.02, 4.2],
    [-7.15, 6.35, 6.5, 1.02, 0.14],
    [-0.35, 6.35, 4.7, 1.02, 0.14],
    [8.15, 6.35, 4.55, 1.02, 0.14],
  ] as const;
  for (let index = 0; index < wattlePanels.length; index += 1) {
    const [x, z, width, height, depth] = wattlePanels[index]!;
    writer.addBox({
      semanticId: `courtyard-wattle-panel-${index + 1}`, moduleId: 'wattle-courtyard-and-cart-gate',
      materialRole: 'wicker', structuralUse: 'lightweight-screen',
      center: [x, 0.62, z], size: [width, height, depth],
    });
  }
  for (const x of [-10.45, -3.85, 3.0, 5.35, 10.45] as const) {
    timberMember(writer, `courtyard-front-post-${x}`, 'wattle-courtyard-and-cart-gate', [x, 0.04, 6.35], [x, 1.52, 6.35], 0.2, 0.22);
  }
  timberMember(writer, 'courtyard-cart-gate-left-post', 'wattle-courtyard-and-cart-gate', [3.0, 0.04, 6.35], [3.0, 2.05, 6.35], 0.25, 0.27);
  timberMember(writer, 'courtyard-cart-gate-right-post', 'wattle-courtyard-and-cart-gate', [5.35, 0.04, 6.35], [5.35, 2.05, 6.35], 0.25, 0.27);
}

function addAnchorMarkers(group: THREE.Group): void {
  for (const anchor of CAVALRY_HORSE_REST_ANCHORS) {
    const marker = new THREE.Group();
    marker.name = `Cavalry horse rest anchor ${anchor.slotIndex + 1} (${anchor.zone})`;
    marker.position.fromArray(anchor.localPosition);
    marker.rotation.y = anchor.localYaw;
    marker.userData.cavalryHorseRestAnchorId = anchor.id;
    marker.userData.cavalryHorseSlotIndex = anchor.slotIndex;
    marker.userData.cavalryHorseZone = anchor.zone;
    group.add(marker);
  }
}

export function createCavalryYardMesh(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Cavalry Yard';
  group.userData.architecturePlan = CAVALRY_YARD_ARCHITECTURE_PLAN;
  group.userData.cavalryHorseRestAnchors = CAVALRY_HORSE_REST_ANCHORS;
  const writer = new ProceduralGeometryWriter([
    'packed-earth', 'fieldstone', 'rough-timber', 'weathered-boards', 'split-shingles', 'wicker',
  ]);
  addSixBayStableRange(writer);
  addSchoolingPaddock(writer);
  addTackStore(writer);
  addCourtyardFittings(writer);
  const compiled = writer.build();
  const slots = addProceduralMaterialSlotMeshes(group, compiled, {
    namePrefix: 'Cavalry Yard',
    overrides: {
      fieldstone: { source: 'construction', key: 'masonryDark' },
      'rough-timber': { source: 'construction', key: 'timberDark' },
    },
  });
  group.userData.architectureCompiler = {
    planTypology: CAVALRY_YARD_ARCHITECTURE_PLAN.typology,
    geometryWriter: compiled.version,
    triangleCount: slots.triangleCount,
    drawCalls: slots.drawCalls,
  };
  addAnchorMarkers(group);
  return group;
}
