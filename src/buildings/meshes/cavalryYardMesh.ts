import * as THREE from 'three';
import { ProceduralGeometryWriter } from '../proceduralArchitecture/geometryWriter.ts';
import { addProceduralMaterialSlotMeshes } from '../proceduralArchitecture/materialSlotMeshes.ts';

const EQUIPMENT_BAY_CENTERS = [-9.05, -7.15, -5.25, -3.35, -1.45, 0.45] as const;

const MODULES = [
  'timber-muster-hall',
  'armory-issue-bays',
  'campaign-store',
  'fenced-drill-yard',
  'mounted-drill-ring',
  'covered-hitching-rails',
  'muster-trough',
  'wattle-courtyard-and-cart-gate',
] as const;

export const CAVALRY_YARD_ARCHITECTURE_PLAN = {
  typology: 'frontier-cavalry-muster-yard',
  period: 'circa-1550',
  region: 'Croatian-Hungarian-frontier',
  roadFacingSide: 'positive-z',
  dimensions: { width: 21.6, depth: 14.8, ridgeHeight: 5.1 },
  modules: MODULES,
  signature: 'timber muster hall, six equipment-issue bays, mounted drill ring, campaign store, transient hitching rail, and gated wattle boundary',
  simultaneousMusterCapacity: 12,
  diagnostics: {
    equipmentIssueBayCount: EQUIPMENT_BAY_CENTERS.length,
    hitchingPostCount: 3,
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

function addMusterAndArmoryRange(writer: ProceduralGeometryWriter): void {
  writer.addBox({
    semanticId: 'muster-hall-packed-floor', moduleId: 'timber-muster-hall',
    materialRole: 'packed-earth', structuralUse: 'yard-and-floor-surface',
    center: [-4.3, 0.08, -1.75], size: [11.4, 0.16, 5.35],
  });
  writer.addBox({
    semanticId: 'muster-hall-rear-fieldstone-plinth', moduleId: 'timber-muster-hall',
    materialRole: 'fieldstone', structuralUse: 'foundation-and-plinth',
    center: [-4.3, 0.34, -4.32], size: [11.65, 0.68, 0.52],
  });
  writer.addBox({
    semanticId: 'muster-hall-left-fieldstone-plinth', moduleId: 'timber-muster-hall',
    materialRole: 'fieldstone', structuralUse: 'foundation-and-plinth',
    center: [-9.98, 0.34, -1.78], size: [0.52, 0.68, 5.55],
  });

  const postXs = [-10, -8.1, -6.2, -4.3, -2.4, -0.5, 1.4] as const;
  for (const x of postXs) {
    for (const z of [-4.12, 0.72] as const) {
      timberMember(writer, `muster-hall-post-${x}-${z}`, 'timber-muster-hall', [x, 0.16, z], [x, 3.28, z], 0.24, 0.28);
    }
  }
  for (const z of [-4.12, 0.72] as const) {
    timberMember(writer, `muster-hall-eave-plate-${z}`, 'timber-muster-hall', [-10.15, 3.27, z], [1.55, 3.27, z], 0.28, 0.3);
  }
  for (const x of postXs) {
    timberMember(writer, `muster-hall-rafter-front-${x}`, 'timber-muster-hall', [x, 3.23, 1.06], [x, 5.08, -1.7], 0.17, 0.19);
    timberMember(writer, `muster-hall-rafter-rear-${x}`, 'timber-muster-hall', [x, 3.23, -4.58], [x, 5.08, -1.7], 0.17, 0.19);
  }
  writer.addBox({
    semanticId: 'muster-hall-rear-board-wall', moduleId: 'timber-muster-hall',
    materialRole: 'weathered-boards', structuralUse: 'board-cladding',
    center: [-4.3, 1.78, -4.17], size: [11.25, 2.7, 0.16],
  });
  writer.addBox({
    semanticId: 'muster-hall-left-board-wall', moduleId: 'timber-muster-hall',
    materialRole: 'weathered-boards', structuralUse: 'board-cladding',
    center: [-9.94, 1.78, -1.75], size: [0.16, 2.7, 4.68],
  });

  for (let bayIndex = 0; bayIndex < EQUIPMENT_BAY_CENTERS.length; bayIndex += 1) {
    const centerX = EQUIPMENT_BAY_CENTERS[bayIndex]!;
    timberMember(writer, `equipment-bay-${bayIndex + 1}-lintel`, 'armory-issue-bays', [centerX - 0.72, 2.42, 0.73], [centerX + 0.72, 2.42, 0.73], 0.18, 0.22);
    for (const side of [-1, 1] as const) {
      writer.addBox({
        semanticId: `equipment-bay-${bayIndex + 1}-rack-${side}`,
        moduleId: 'armory-issue-bays',
        materialRole: 'weathered-boards', structuralUse: 'door-and-shutter-joinery',
        center: [centerX + side * 0.62, 1.02, 0.46], size: [0.18, 1.55, 0.3],
        uvOffsetMeters: [bayIndex * 0.17, side < 0 ? 0.13 : 0.47],
      });
    }
    writer.addBox({
      semanticId: `equipment-bay-${bayIndex + 1}-issue-bench`, moduleId: 'armory-issue-bays',
      materialRole: 'weathered-boards', structuralUse: 'board-cladding',
      center: [centerX, 0.72, -0.2], size: [1.45, 0.22, 0.58],
    });
  }

  writer.addRoofPanel({
    semanticId: 'muster-hall-road-roof', moduleId: 'timber-muster-hall',
    materialRole: 'split-shingles', structuralUse: 'roof-covering',
    eaveOrigin: [-10.35, 3.24, 1.12], eaveVector: [12.1, 0, 0],
    slopeVector: [0, 1.87, -2.82], thickness: 0.15,
  });
  writer.addRoofPanel({
    semanticId: 'muster-hall-rear-roof', moduleId: 'timber-muster-hall',
    materialRole: 'split-shingles', structuralUse: 'roof-covering',
    eaveOrigin: [1.75, 3.24, -4.64], eaveVector: [-12.1, 0, 0],
    slopeVector: [0, 1.87, 2.94], thickness: 0.15,
  });
}

function addMountedDrillYard(writer: ProceduralGeometryWriter): void {
  writer.addBox({
    semanticId: 'mounted-drill-ring-packed-surface', moduleId: 'mounted-drill-ring',
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
    timberMember(writer, `drill-yard-post-${index + 1}`, 'fenced-drill-yard', [start[0], 0.05, start[1]], [start[0], 1.48, start[1]], 0.18, 0.2);
    for (const y of [0.7, 1.28] as const) {
      timberMember(writer, `drill-yard-rail-${index + 1}-${y}`, 'fenced-drill-yard', [start[0], y, start[1]], [end[0], y, end[1]], 0.13, 0.17);
    }
  }
  for (const x of [4.35, 8.35] as const) {
    timberMember(writer, `mounted-drill-ring-marker-${x}`, 'mounted-drill-ring', [x, 0.05, -1.8], [x, 0.82, -1.8], 0.12, 0.14);
  }
}

function addCampaignStore(writer: ProceduralGeometryWriter): void {
  writer.addBox({
    semanticId: 'campaign-store-fieldstone-plinth', moduleId: 'campaign-store',
    materialRole: 'fieldstone', structuralUse: 'foundation-and-plinth',
    center: [7.9, 0.3, 4.18], size: [4.75, 0.6, 3.05],
  });
  writer.addBox({
    semanticId: 'campaign-store-boarded-body', moduleId: 'campaign-store',
    materialRole: 'weathered-boards', structuralUse: 'board-cladding',
    center: [7.9, 1.72, 4.18], size: [4.48, 2.32, 2.8],
  });
  for (const x of [5.72, 10.08] as const) {
    timberMember(writer, `campaign-store-front-post-${x}`, 'campaign-store', [x, 0.58, 5.63], [x, 3.05, 5.63], 0.2, 0.22);
  }
  writer.addBox({
    semanticId: 'campaign-store-open-door', moduleId: 'campaign-store',
    materialRole: 'weathered-boards', structuralUse: 'door-and-shutter-joinery',
    center: [6.0, 1.42, 5.96], size: [0.13, 1.9, 1.26],
  });
  writer.addRoofPanel({
    semanticId: 'campaign-store-front-roof', moduleId: 'campaign-store',
    materialRole: 'split-shingles', structuralUse: 'roof-covering',
    eaveOrigin: [5.35, 3.0, 5.88], eaveVector: [5.1, 0, 0],
    slopeVector: [0, 1.2, -1.7], thickness: 0.14,
  });
  writer.addRoofPanel({
    semanticId: 'campaign-store-rear-roof', moduleId: 'campaign-store',
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
    semanticId: 'muster-trough-bottom', moduleId: 'muster-trough',
    materialRole: 'weathered-boards', structuralUse: 'board-cladding',
    center: [1.0, 0.34, 3.72], size: [2.3, 0.12, 0.7],
  });
  for (const z of [3.38, 4.06] as const) {
    writer.addBox({
      semanticId: `muster-trough-side-${z}`, moduleId: 'muster-trough',
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

export function createCavalryYardMesh(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Cavalry Yard';
  group.userData.architecturePlan = CAVALRY_YARD_ARCHITECTURE_PLAN;
  const writer = new ProceduralGeometryWriter([
    'packed-earth', 'fieldstone', 'rough-timber', 'weathered-boards', 'split-shingles', 'wicker',
  ]);
  addMusterAndArmoryRange(writer);
  addMountedDrillYard(writer);
  addCampaignStore(writer);
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
  return group;
}
