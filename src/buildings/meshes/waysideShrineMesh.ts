import * as THREE from 'three';
import {
  addMesh,
  sharedBuildingDetailMaterial,
  sharedBuildingMaterial,
  stoneMaterial,
  timberMaterial,
} from '../buildingMaterials.ts';
import { ProceduralGeometryWriter } from '../proceduralArchitecture/geometryWriter.ts';
import { addProceduralMaterialSlotMeshes } from '../proceduralArchitecture/materialSlotMeshes.ts';

export type WaysideShrineDebugMode = 'final' | 'massing';

export type WaysideShrinePlan = {
  seed: number;
  debugMode: WaysideShrineDebugMode;
  dimensions: {
    width: number;
    depth: number;
    foundationHeight: number;
    wallHeight: number;
    ridgeHeight: number;
  };
  tiers: ReadonlyArray<{
    id: 'foundation' | 'shrine-body' | 'roof';
    role: 'plinth' | 'devotional-niche' | 'weather-cap';
    y0: number;
    height: number;
  }>;
  modules: ReadonlyArray<{
    id: string;
    role: 'massing' | 'devotional' | 'ornament' | 'approach';
  }>;
  diagnostics: {
    hiddenFacadeModules: number;
    overlappingModules: number;
    materialSlots: readonly string[];
  };
};

const SHRINE_DIMENSIONS = Object.freeze({
  width: 2.18,
  depth: 1.34,
  foundationHeight: 0.62,
  wallHeight: 2.62,
  ridgeHeight: 1.28,
});

/**
 * Serializable, deterministic plan kept separate from mesh emission so the
 * shrine's scale, module ownership, and visual diagnostics remain inspectable.
 */
export function createWaysideShrinePlan(
  debugMode: WaysideShrineDebugMode = 'final',
): WaysideShrinePlan {
  const dimensions = { ...SHRINE_DIMENSIONS };
  const wallTop = dimensions.foundationHeight + dimensions.wallHeight;
  return {
    seed: 1733,
    debugMode,
    dimensions,
    tiers: [
      { id: 'foundation', role: 'plinth', y0: 0, height: dimensions.foundationHeight },
      { id: 'shrine-body', role: 'devotional-niche', y0: dimensions.foundationHeight, height: dimensions.wallHeight },
      { id: 'roof', role: 'weather-cap', y0: wallTop, height: dimensions.ridgeHeight },
    ],
    modules: [
      { id: 'irregular-limestone-plinth', role: 'massing' },
      { id: 'limewashed-niche-body', role: 'massing' },
      { id: 'split-shingle-weather-cap', role: 'massing' },
      { id: 'marian-devotional-niche', role: 'devotional' },
      { id: 'forged-iron-ridge-cross', role: 'ornament' },
      { id: 'worn-roadside-steps', role: 'approach' },
    ],
    diagnostics: {
      hiddenFacadeModules: 0,
      overlappingModules: 0,
      materialSlots: [
        'limewash',
        'limestone',
        'shingle',
        'timber',
        'iron',
        'devotional-paint',
      ],
    },
  };
}

function createArchedPanelGeometry(
  width: number,
  height: number,
  depth: number,
): THREE.ExtrudeGeometry {
  const radius = width * 0.5;
  const springY = height - radius;
  const shape = new THREE.Shape();
  shape.moveTo(-radius, 0);
  shape.lineTo(radius, 0);
  shape.lineTo(radius, springY);
  shape.absarc(0, springY, radius, 0, Math.PI, false);
  shape.closePath();
  return new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: false,
    curveSegments: 8,
  });
}

function createArchedSurroundGeometry(
  outerWidth: number,
  outerHeight: number,
  innerWidth: number,
  innerHeight: number,
  depth: number,
): THREE.ExtrudeGeometry {
  const shape = createArchedShape(outerWidth, outerHeight, THREE.Shape);
  const opening = createArchedShape(innerWidth, innerHeight, THREE.Path);
  shape.holes.push(opening);
  return new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: false,
    curveSegments: 10,
  });
}

function createArchedShape<T extends THREE.Shape | THREE.Path>(
  width: number,
  height: number,
  Constructor: new () => T,
): T {
  const radius = width * 0.5;
  const springY = height - radius;
  const path = new Constructor();
  path.moveTo(-radius, 0);
  path.lineTo(radius, 0);
  path.lineTo(radius, springY);
  path.absarc(0, springY, radius, 0, Math.PI, false);
  path.closePath();
  return path;
}

function name(mesh: THREE.Mesh, value: string): THREE.Mesh {
  mesh.name = value;
  return mesh;
}

function addFoundationStoneFace(
  writer: ProceduralGeometryWriter,
  width: number,
  depth: number,
  height: number,
): void {
  const frontZ = depth * 0.5 + 0.055;
  const courseY = [0.18, 0.47] as const;
  for (const [course, y] of courseY.entries()) {
    const count = course === 0 ? 4 : 5;
    const blockWidth = width / count;
    for (let index = 0; index < count; index += 1) {
      const x = -width * 0.5 + blockWidth * (index + 0.5);
      const jitter = ((index * 17 + course * 11) % 5 - 2) * 0.015;
      writer.addBox({
        semanticId: `wayside-shrine-foundation-stone-${course + 1}-${index + 1}`,
        moduleId: 'irregular-limestone-plinth',
        materialRole: 'fieldstone',
        structuralUse: 'foundation-and-plinth',
        center: [x + jitter, Math.min(height - 0.08, y), frontZ],
        size: [blockWidth * 0.93, course === 0 ? 0.3 : 0.24, 0.16],
        uvOffsetMeters: [index * 0.17 + course * 0.09, course * 0.23],
      });
    }
  }
}

function addStructuralShell(
  group: THREE.Group,
  plan: WaysideShrinePlan,
): void {
  const { width, depth, foundationHeight, wallHeight, ridgeHeight } = plan.dimensions;
  const wallTop = foundationHeight + wallHeight;
  const halfWidth = width * 0.5;
  const halfDepth = depth * 0.5;
  const roofDepth = depth + 0.58;
  const roofEaveX = halfWidth + 0.22;
  const roofEaveY = wallTop - 0.045;
  const roofRise = ridgeHeight + 0.07;
  const openingWidth = 1.08;
  const sillHeight = 0.34;
  const headerHeight = 0.46;
  const pierWidth = (width - openingWidth) * 0.5;
  const writer = new ProceduralGeometryWriter([
    'fieldstone',
    'limestone-ashlar',
    'lime-plaster',
    'rough-timber',
    'split-shingles',
    'wrought-iron',
  ]);

  writer.addBox({
    semanticId: 'wayside-shrine-foundation-mass',
    moduleId: 'irregular-limestone-plinth',
    materialRole: 'fieldstone',
    structuralUse: 'foundation-and-plinth',
    center: [0, foundationHeight * 0.5, 0],
    size: [width + 0.38, foundationHeight, depth + 0.36],
  });
  addFoundationStoneFace(writer, width + 0.2, depth + 0.24, foundationHeight);
  writer.addBox({
    semanticId: 'wayside-shrine-plinth-cap-course',
    moduleId: 'irregular-limestone-plinth',
    materialRole: 'limestone-ashlar',
    structuralUse: 'masonry-trim',
    center: [0, foundationHeight + 0.05, 0],
    size: [width + 0.34, 0.16, depth + 0.32],
  });

  // Four wall volumes leave a real, deep front niche instead of a black decal
  // on a solid facade. The thin rear leaf is the physical devotional back wall.
  writer.addBox({
    semanticId: 'wayside-shrine-niche-sill-wall',
    moduleId: 'limewashed-niche-body',
    materialRole: 'lime-plaster',
    structuralUse: 'lime-render',
    center: [0, foundationHeight + sillHeight * 0.5, 0],
    size: [width, sillHeight, depth],
  });
  for (const side of [-1, 1] as const) {
    writer.addBox({
      semanticId: `wayside-shrine-${side < 0 ? 'left' : 'right'}-niche-pier`,
      moduleId: 'limewashed-niche-body',
      materialRole: 'lime-plaster',
      structuralUse: 'lime-render',
      center: [side * (openingWidth * 0.5 + pierWidth * 0.5), foundationHeight + sillHeight + (wallHeight - sillHeight) * 0.5, 0],
      size: [pierWidth, wallHeight - sillHeight, depth],
    });
  }
  writer.addBox({
    semanticId: 'wayside-shrine-niche-header-wall',
    moduleId: 'limewashed-niche-body',
    materialRole: 'lime-plaster',
    structuralUse: 'lime-render',
    center: [0, wallTop - headerHeight * 0.5, 0],
    size: [openingWidth, headerHeight, depth],
  });
  writer.addBox({
    semanticId: 'wayside-shrine-devotional-back-wall',
    moduleId: 'marian-devotional-niche',
    materialRole: 'lime-plaster',
    structuralUse: 'lime-render',
    center: [0, foundationHeight + sillHeight + (wallHeight - sillHeight - headerHeight) * 0.5, -halfDepth + 0.085],
    size: [openingWidth, wallHeight - sillHeight - headerHeight, 0.17],
  });

  for (const zSign of [-1, 1] as const) {
    writer.addPrism({
      semanticId: `wayside-shrine-${zSign < 0 ? 'rear' : 'front'}-gable`,
      moduleId: 'limewashed-niche-body',
      materialRole: 'lime-plaster',
      structuralUse: 'masonry-infill',
      center: [0, wallTop, zSign * (halfDepth - 0.055)],
      profile: [[-halfWidth, 0], [halfWidth, 0], [0, ridgeHeight]],
      depth: 0.11,
    });
  }

  writer.addRoofPanel({
    semanticId: 'wayside-shrine-left-shingle-roof',
    moduleId: 'split-shingle-weather-cap',
    materialRole: 'split-shingles',
    structuralUse: 'roof-covering',
    eaveOrigin: [-roofEaveX, roofEaveY, -roofDepth * 0.5],
    eaveVector: [0, 0, roofDepth],
    slopeVector: [roofEaveX, roofRise, 0],
    thickness: 0.11,
  });
  writer.addRoofPanel({
    semanticId: 'wayside-shrine-right-shingle-roof',
    moduleId: 'split-shingle-weather-cap',
    materialRole: 'split-shingles',
    structuralUse: 'roof-covering',
    eaveOrigin: [roofEaveX, roofEaveY, roofDepth * 0.5],
    eaveVector: [0, 0, -roofDepth],
    slopeVector: [-roofEaveX, roofRise, 0],
    thickness: 0.11,
    uvOffsetMeters: [0.13, 0.07],
  });
  writer.addMember({
    semanticId: 'wayside-shrine-ridge-cap',
    moduleId: 'split-shingle-weather-cap',
    materialRole: 'rough-timber',
    structuralUse: 'roof-frame',
    start: [0, roofEaveY + roofRise + 0.045, -roofDepth * 0.5 - 0.02],
    end: [0, roofEaveY + roofRise + 0.045, roofDepth * 0.5 + 0.02],
    width: 0.16,
    depth: 0.15,
  });

  const crossZ = halfDepth + 0.06;
  const roofTop = roofEaveY + roofRise;
  writer.addMember({
    semanticId: 'wayside-shrine-cross-upright',
    moduleId: 'forged-iron-ridge-cross',
    materialRole: 'wrought-iron',
    structuralUse: 'decorative-metalwork',
    start: [0, roofTop + 0.02, crossZ],
    end: [0, roofTop + 0.88, crossZ],
    width: 0.085,
    depth: 0.085,
  });
  writer.addMember({
    semanticId: 'wayside-shrine-cross-arm',
    moduleId: 'forged-iron-ridge-cross',
    materialRole: 'wrought-iron',
    structuralUse: 'decorative-metalwork',
    start: [-0.26, roofTop + 0.6, crossZ],
    end: [0.26, roofTop + 0.6, crossZ],
    width: 0.075,
    depth: 0.075,
  });

  for (let step = 0; step < 2; step += 1) {
    writer.addBox({
      semanticId: `wayside-shrine-approach-step-${step + 1}`,
      moduleId: 'worn-roadside-steps',
      materialRole: 'fieldstone',
      structuralUse: 'foundation-and-plinth',
      center: [0, 0.08 + step * 0.11, halfDepth + 0.5 - step * 0.16],
      size: [1.34 - step * 0.22, 0.16, 0.58],
      uvOffsetMeters: [step * 0.21, step * 0.13],
    });
  }

  const compiled = writer.build();
  addProceduralMaterialSlotMeshes(group, compiled, {
    namePrefix: 'Wayside shrine',
    overrides: {
      fieldstone: { source: 'construction', key: 'masonryMid' },
      'rough-timber': { source: 'construction', key: 'timberDark' },
    },
  });
}

function addDevotionalNiche(
  group: THREE.Group,
  plan: WaysideShrinePlan,
): void {
  const { depth, foundationHeight } = plan.dimensions;
  const frontZ = depth * 0.5 + 0.01;
  const nicheBackZ = -depth * 0.5 + 0.16;
  const nicheY = foundationHeight + 0.42;

  name(addMesh(
    group,
    createArchedSurroundGeometry(1.28, 1.94, 0.9, 1.55, 0.12),
    stoneMaterial('light'),
    new THREE.Vector3(0, nicheY, frontZ),
  ), 'Wayside shrine open arched limestone niche surround');
  name(addMesh(
    group,
    createArchedPanelGeometry(0.9, 1.55, 0.05),
    sharedBuildingMaterial('interiorDark'),
    new THREE.Vector3(0, nicheY + 0.2, nicheBackZ),
  ), 'Wayside shrine physical devotional niche back');
  name(addMesh(
    group,
    createArchedPanelGeometry(0.63, 1.18, 0.025),
    timberMaterial('dark'),
    new THREE.Vector3(0, nicheY + 0.36, nicheBackZ + 0.06),
  ), 'Wayside shrine Marian icon board');

  const blue = sharedBuildingDetailMaterial('paintBlue');
  const ochre = sharedBuildingDetailMaterial('paintOchre');
  name(addMesh(
    group,
    new THREE.ConeGeometry(0.24, 0.62, 8),
    blue,
    new THREE.Vector3(-0.05, nicheY + 0.75, nicheBackZ + 0.12),
  ), 'Wayside shrine Marian blue mantle');
  name(addMesh(
    group,
    new THREE.SphereGeometry(0.105, 10, 7),
    ochre,
    new THREE.Vector3(-0.05, nicheY + 1.13, nicheBackZ + 0.13),
  ), 'Wayside shrine Marian icon face');
  name(addMesh(
    group,
    new THREE.SphereGeometry(0.07, 9, 6),
    ochre,
    new THREE.Vector3(0.17, nicheY + 0.9, nicheBackZ + 0.14),
  ), 'Wayside shrine infant icon face');
  name(addMesh(
    group,
    new THREE.BoxGeometry(0.12, 0.25, 0.055),
    sharedBuildingDetailMaterial('paintOchre'),
    new THREE.Vector3(0.14, nicheY + 0.73, nicheBackZ + 0.13),
  ), 'Wayside shrine infant icon robe');

  name(addMesh(
    group,
    new THREE.BoxGeometry(0.92, 0.12, 0.28),
    stoneMaterial('light'),
    new THREE.Vector3(0, nicheY + 0.22, frontZ + 0.2),
  ), 'Wayside shrine votive ledge');
  name(addMesh(
    group,
    new THREE.CylinderGeometry(0.045, 0.052, 0.18, 8),
    sharedBuildingDetailMaterial('canvas'),
    new THREE.Vector3(0.29, nicheY + 0.38, frontZ + 0.31),
  ), 'Wayside shrine votive candle');
  name(addMesh(
    group,
    new THREE.SphereGeometry(0.045, 8, 6),
    ochre,
    new THREE.Vector3(0.29, nicheY + 0.5, frontZ + 0.31),
    new THREE.Euler(),
    new THREE.Vector3(0.7, 1.35, 0.7),
  ), 'Wayside shrine votive flame');
}

function compileWaysideShrine(plan: WaysideShrinePlan): THREE.Group {
  const root = new THREE.Group();
  root.name = 'Gorski Kotar Wayside Shrine';
  const group = new THREE.Group();
  group.name = 'Gorski Kotar Wayside Shrine procedural model';
  root.add(group);

  const { depth } = plan.dimensions;
  const halfDepth = depth * 0.5;
  addStructuralShell(group, plan);
  if (plan.debugMode === 'final') addDevotionalNiche(group, plan);
  void halfDepth;

  let triangleCount = 0;
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const geometry = object.geometry;
    triangleCount += geometry.index
      ? geometry.index.count / 3
      : (geometry.getAttribute('position')?.count ?? 0) / 3;
  });
  root.userData.architecturePlan = plan;
  root.userData.architectureDiagnostics = {
    ...plan.diagnostics,
    moduleCount: plan.modules.length,
    triangleCount,
  };
  return root;
}

/** Compact decorative roadside poklonac with no gameplay-state props. */
export function createWaysideShrineMesh(
  debugMode: WaysideShrineDebugMode = 'final',
): THREE.Group {
  return compileWaysideShrine(createWaysideShrinePlan(debugMode));
}
