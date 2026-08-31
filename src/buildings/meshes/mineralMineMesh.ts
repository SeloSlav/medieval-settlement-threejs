import * as THREE from 'three';
import {
  addMesh,
  metalMaterial,
  quarryRockMaterial,
  sharedBuildingDetailMaterial,
  sharedBuildingMaterial,
  timberMaterial,
} from '../buildingMaterials.ts';
import {
  addDarkOpening,
  addGableShell,
  addPlankDoor,
} from './buildingMeshKit.ts';
import { createCivilianToolStockpile } from './civilianToolStockpileMesh.ts';
import { ProceduralGeometryWriter } from '../proceduralArchitecture/geometryWriter.ts';
import { addProceduralMaterialSlotMeshes } from '../proceduralArchitecture/materialSlotMeshes.ts';

const UP = new THREE.Vector3(0, 1, 0);
const IRON_DARK = metalMaterial('iron');
const IRON_OXIDE = sharedBuildingDetailMaterial('paintRed');
const SALT_DARK = sharedBuildingMaterial('masonryMid');
const SALT_LIGHT = sharedBuildingMaterial('masonryLight');
const CLAY_DARK = sharedBuildingDetailMaterial('earth');
const CLAY_LIGHT = sharedBuildingDetailMaterial('paintOchre');

const HEADFRAME_FRAME_PLATE_Y = 7.79;
const HEADFRAME_ROOF_EAVE_Y = 7.78;
const HEADFRAME_ROOF_RISE = 0.73;
const HEADFRAME_ROOF_HALF_RUN = 2.28;
const HEADFRAME_ROOF_THICKNESS = 0.07;

const SORTING_ROOF_EAVE_Y = 3.044;
const SORTING_ROOF_EAVE_Z = 1.703;
const SORTING_ROOF_RISE = 0.55;
const SORTING_ROOF_RUN = 3.406;
const SORTING_ROOF_THICKNESS = 0.1;
const SORTING_WALL_PLATE_VERTICAL_DEPTH = 0.19;

function sortingRoofTopYAtZ(z: number): number {
  return SORTING_ROOF_EAVE_Y
    + (SORTING_ROOF_EAVE_Z - z) / SORTING_ROOF_RUN * SORTING_ROOF_RISE;
}

function sortingRoofUndersideYAtZ(z: number): number {
  const outwardY = SORTING_ROOF_RUN / Math.hypot(SORTING_ROOF_RUN, SORTING_ROOF_RISE);
  return sortingRoofTopYAtZ(z) - SORTING_ROOF_THICKNESS * outwardY;
}

function sortingWallPlateYAtZ(z: number): number {
  return sortingRoofUndersideYAtZ(z) - SORTING_WALL_PLATE_VERTICAL_DEPTH * 0.5;
}

type MineworksResource = 'iron' | 'salt' | 'clay';

function addBeamBetween(
  group: THREE.Group,
  start: THREE.Vector3,
  end: THREE.Vector3,
  thickness: number,
  material: THREE.Material,
  name: string,
): THREE.Mesh {
  const direction = end.clone().sub(start);
  const beam = addMesh(
    group,
    new THREE.BoxGeometry(thickness, direction.length(), thickness),
    material,
    start.clone().add(end).multiplyScalar(0.5),
  );
  beam.quaternion.setFromUnitVectors(UP, direction.normalize());
  beam.name = name;
  return beam;
}

function addShaftCollar(group: THREE.Group): void {
  const shaft = new THREE.Group();
  shaft.name = 'Mineworks shaft collar';

  addMesh(
    shaft,
    new THREE.BoxGeometry(4.5, 0.2, 3.5),
    sharedBuildingMaterial('interiorDark'),
    new THREE.Vector3(0, 0.12, 0),
  ).name = 'Mineworks deep shaft opening';

  for (const [x, z, width, depth] of [
    [0, -1.88, 5.3, 0.42],
    [0, 1.88, 5.3, 0.42],
    [-2.48, 0, 0.42, 3.35],
    [2.48, 0, 0.42, 3.35],
  ] as const) {
    addMesh(
      shaft,
      new THREE.BoxGeometry(width, 0.62, depth),
      quarryRockMaterial('cut'),
      new THREE.Vector3(x, 0.35, z),
    ).name = 'Mineworks dressed shaft curb';
  }

  for (const z of [-1.25, 0, 1.25]) {
    addMesh(
      shaft,
      new THREE.BoxGeometry(4.15, 0.16, 0.22),
      timberMaterial(z === 0 ? 'dark' : 'weathered'),
      new THREE.Vector3(0, 0.58, z),
    ).name = 'Mineworks shaft safety bearer';
  }
  group.add(shaft);
}

/**
 * A compact four-leg winding tower. Its closed vertical silhouette and paired
 * sheaves identify deep underground work, in deliberate contrast with the
 * quarry's low terraces and cantilevered crane.
 */
function addHeadframe(group: THREE.Group): void {
  const headframe = new THREE.Group();
  headframe.name = 'Mineworks winding headframe';
  headframe.userData.roofSupportProfile = {
    framePlateY: HEADFRAME_FRAME_PLATE_Y,
    roofEaveY: HEADFRAME_ROOF_EAVE_Y,
    roofRidgeY: HEADFRAME_ROOF_EAVE_Y + HEADFRAME_ROOF_RISE,
    roofHalfRun: HEADFRAME_ROOF_HALF_RUN,
    roofThickness: HEADFRAME_ROOF_THICKNESS,
  };
  const darkTimber = timberMaterial('dark');
  const weatheredTimber = timberMaterial('weathered');

  for (const x of [-2.4, 2.4]) {
    for (const z of [-1.65, 1.65]) {
      addBeamBetween(
        headframe,
        new THREE.Vector3(x, 0.35, z),
        new THREE.Vector3(x * 0.58, HEADFRAME_FRAME_PLATE_Y, z * 0.68),
        0.46,
        darkTimber,
        'Mineworks inclined headframe leg',
      );
    }
  }

  for (const z of [-1.25, 1.25]) {
    addBeamBetween(
      headframe,
      new THREE.Vector3(-1.65, HEADFRAME_FRAME_PLATE_Y, z),
      new THREE.Vector3(1.65, HEADFRAME_FRAME_PLATE_Y, z),
      0.44,
      weatheredTimber,
      'Mineworks headframe crown beam',
    );
  }
  for (const side of [-1, 1] as const) {
    addBeamBetween(
      headframe,
      new THREE.Vector3(side * 2.25, 2.0, -1.52),
      new THREE.Vector3(side * 1.48, 6.9, 1.18),
      0.23,
      weatheredTimber,
      'Mineworks headframe cross brace',
    );
    addBeamBetween(
      headframe,
      new THREE.Vector3(side * 2.25, 2.0, 1.52),
      new THREE.Vector3(side * 1.48, 6.9, -1.18),
      0.23,
      weatheredTimber,
      'Mineworks headframe cross brace',
    );
  }
  addHeadframeCrossBracing(headframe);

  for (const x of [-0.74, 0.74]) {
    addMesh(
      headframe,
      new THREE.TorusGeometry(0.78, 0.1, 8, 20),
      metalMaterial('iron'),
      new THREE.Vector3(x, 7.45, 0),
      new THREE.Euler(0, Math.PI * 0.5, 0),
    ).name = 'Mineworks winding sheave';
    addBeamBetween(
      headframe,
      new THREE.Vector3(x, 7.37, 0),
      new THREE.Vector3(x, 0.7, 0),
      0.055,
      metalMaterial('iron'),
      'Mineworks winding cable',
    );
  }

  addHeadframeWeatherRoof(headframe);
  group.add(headframe);
}

/** Completes both open transverse faces and ties them below the roof. */
function addHeadframeCrossBracing(headframe: THREE.Group): void {
  const bracing = new THREE.Group();
  bracing.name = 'Mineworks headframe transverse cross bracing';
  bracing.userData.architectureModule = 'shaft-headframe';
  bracing.userData.bracingSystem = 'four-face-cross-braced-headframe';
  const writer = new ProceduralGeometryWriter(['rough-timber']);

  for (const zSign of [-1, 1] as const) {
    const baseZ = zSign * 1.52;
    const crownZ = zSign * 1.2;
    writer.addMember({
      semanticId: `mineworks-${zSign < 0 ? 'rear' : 'front'}-left-to-right-cross-brace`,
      moduleId: 'shaft-headframe',
      materialRole: 'rough-timber',
      structuralUse: 'timber-frame',
      start: [-2.22, 1.96, baseZ],
      end: [1.48, 6.9, crownZ],
      width: 0.22,
      depth: 0.22,
    });
    writer.addMember({
      semanticId: `mineworks-${zSign < 0 ? 'rear' : 'front'}-right-to-left-cross-brace`,
      moduleId: 'shaft-headframe',
      materialRole: 'rough-timber',
      structuralUse: 'timber-frame',
      start: [2.22, 1.96, baseZ],
      end: [-1.48, 6.9, crownZ],
      width: 0.22,
      depth: 0.22,
    });
  }
  for (const xSign of [-1, 1] as const) {
    writer.addMember({
      semanticId: `mineworks-${xSign < 0 ? 'left' : 'right'}-roof-sole-tie`,
      moduleId: 'shaft-headframe',
      materialRole: 'rough-timber',
      structuralUse: 'roof-frame',
      start: [xSign * 1.52, 7.82, -1.48],
      end: [xSign * 1.52, 7.82, 1.48],
      width: 0.24,
      depth: 0.24,
    });
  }

  addProceduralMaterialSlotMeshes(bracing, writer.build(), {
    namePrefix: 'Mineworks headframe transverse cross bracing',
  });
  headframe.add(bracing);
}

/**
 * A deep-eaved split-shingle cap replaces the former flat slab without raising
 * the established headframe envelope. Two small overlapping ridge panels keep
 * the wet-weather load path explicit and preserve roof-course-aligned UVs.
 */
function addHeadframeWeatherRoof(headframe: THREE.Group): void {
  const roof = new THREE.Group();
  roof.name = 'Mineworks headframe weather roof';
  roof.userData.architectureModule = 'headframe-weather-cap';
  roof.userData.weatherProtection = 'deep-eave-split-shingle-gable';
  const writer = new ProceduralGeometryWriter(['split-shingles']);
  writer.addRoofPanel({
    semanticId: 'mineworks-headframe-left-weather-roof-plane',
    moduleId: 'headframe-weather-cap',
    materialRole: 'split-shingles',
    structuralUse: 'roof-covering',
    eaveOrigin: [-2.05, HEADFRAME_ROOF_EAVE_Y, -HEADFRAME_ROOF_HALF_RUN],
    eaveVector: [4.1, 0, 0],
    slopeVector: [0, HEADFRAME_ROOF_RISE, HEADFRAME_ROOF_HALF_RUN],
    thickness: HEADFRAME_ROOF_THICKNESS,
  });
  writer.addRoofPanel({
    semanticId: 'mineworks-headframe-right-weather-roof-plane',
    moduleId: 'headframe-weather-cap',
    materialRole: 'split-shingles',
    structuralUse: 'roof-covering',
    eaveOrigin: [2.05, HEADFRAME_ROOF_EAVE_Y, HEADFRAME_ROOF_HALF_RUN],
    eaveVector: [-4.1, 0, 0],
    slopeVector: [0, HEADFRAME_ROOF_RISE, -HEADFRAME_ROOF_HALF_RUN],
    thickness: HEADFRAME_ROOF_THICKNESS,
    uvOffsetMeters: [0.13, 0.07],
  });
  writer.addRoofPanel({
    semanticId: 'mineworks-headframe-left-ridge-weather-course',
    moduleId: 'headframe-weather-cap',
    materialRole: 'split-shingles',
    structuralUse: 'roof-ridge-and-cap',
    eaveOrigin: [-2.08, 8.47, -0.17],
    eaveVector: [4.16, 0, 0],
    slopeVector: [0, 0.055, 0.17],
    thickness: 0.035,
    uvOffsetMeters: [0.31, 0.11],
  });
  writer.addRoofPanel({
    semanticId: 'mineworks-headframe-right-ridge-weather-course',
    moduleId: 'headframe-weather-cap',
    materialRole: 'split-shingles',
    structuralUse: 'roof-ridge-and-cap',
    eaveOrigin: [2.08, 8.47, 0.17],
    eaveVector: [-4.16, 0, 0],
    slopeVector: [0, 0.055, -0.17],
    thickness: 0.035,
    uvOffsetMeters: [0.44, 0.17],
  });
  addProceduralMaterialSlotMeshes(roof, writer.build(), {
    namePrefix: 'Mineworks headframe weather roof',
  });
  headframe.add(roof);
}

function addHoistHouse(group: THREE.Group): void {
  const house = new THREE.Group();
  house.name = 'Mineworks hoist house';
  house.position.set(7.1, 0, 1.55);
  house.rotation.y = -Math.PI * 0.5;
  const shell = addGableShell(house, {
    width: 5.5,
    depth: 4.65,
    stoneHeight: 1.1,
    wallHeight: 2.4,
    ridgeHeight: 1.8,
    wallMaterial: quarryRockMaterial('light'),
    roofMaterial: sharedBuildingMaterial('shingle'),
    stoneGroundFloor: true,
  });
  addPlankDoor(house, -1.35, 1.08, shell.frontZ + 0.02, 0.95, 1.95);
  addDarkOpening(house, 1.18, 2.25, shell.frontZ + 0.04, 0.98, 0.82);

  const drum = addMesh(
    house,
    new THREE.CylinderGeometry(0.67, 0.67, 1.8, 16),
    timberMaterial('mid'),
    new THREE.Vector3(0.3, 1.05, -1.35),
    new THREE.Euler(0, 0, Math.PI * 0.5),
  );
  drum.name = 'Mineworks winding drum';
  for (const x of [-0.64, 1.24]) {
    addMesh(
      house,
      new THREE.TorusGeometry(0.69, 0.075, 7, 16),
      metalMaterial('iron'),
      new THREE.Vector3(x, 1.05, -1.35),
      new THREE.Euler(0, Math.PI * 0.5, 0),
    ).name = 'Mineworks winding drum rim';
  }
  group.add(house);
}

function addOreSortingFloor(group: THREE.Group): void {
  const floor = new THREE.Group();
  floor.name = 'Mineworks sorting floor';
  floor.userData.architectureModule = 'roofed-ore-sorting-yard';
  floor.userData.weatherProtection = 'single-slope-split-shingle-canopy';
  floor.position.set(-7.15, 0, 3.9);
  floor.rotation.y = 0.18;

  const deck = addMesh(
    floor,
    new THREE.BoxGeometry(5.8, 0.22, 2.8),
    timberMaterial('weathered'),
    new THREE.Vector3(0, 0.62, 0),
  );
  deck.name = 'Mineworks sorting-floor weathered-board deck';
  for (const x of [-2.55, -0.85, 0.85, 2.55]) {
    const bearer = addMesh(
      floor,
      new THREE.BoxGeometry(0.22, 1.15, 0.22),
      timberMaterial('dark'),
      new THREE.Vector3(x, 0.25, 0),
    );
    bearer.name = 'Mineworks sorting-floor timber bearer';
  }
  addSortingFloorWeatherFrame(floor);

  const chute = addMesh(
    floor,
    new THREE.BoxGeometry(1.55, 0.26, 5.2),
    timberMaterial('mid'),
    new THREE.Vector3(2.25, 1.42, -1.25),
    new THREE.Euler(-0.28, 0.08, 0),
  );
  chute.name = 'Mineworks hand-sorting chute';

  for (const x of [-1.7, 0, 1.7]) {
    const tub = addMesh(
      floor,
      new THREE.CylinderGeometry(0.62, 0.5, 0.72, 10, 1, true),
      timberMaterial('mid'),
      new THREE.Vector3(x, 1.08, 0.38),
    );
    tub.name = 'Mineworks sorting tub';
  }
  group.add(floor);
}

function addSortingFloorWeatherFrame(floor: THREE.Group): void {
  const shelter = new THREE.Group();
  shelter.name = 'Mineworks sorting-floor weather frame';
  shelter.userData.bracingSystem = 'four-post-knee-braced-sorting-canopy';
  shelter.userData.roofSupportProfile = {
    highSideZ: -1.2,
    highSideWallPlateY: sortingWallPlateYAtZ(-1.2),
    lowSideZ: 1.2,
    lowSideWallPlateY: sortingWallPlateYAtZ(1.2),
    roofEaveY: SORTING_ROOF_EAVE_Y,
    roofRise: SORTING_ROOF_RISE,
    roofRun: SORTING_ROOF_RUN,
    roofThickness: SORTING_ROOF_THICKNESS,
  };
  const writer = new ProceduralGeometryWriter(['rough-timber', 'split-shingles']);
  for (const x of [-2.62, 2.62]) {
    for (const z of [-1.2, 1.2]) {
      const side = x < 0 ? 'left' : 'right';
      const end = z < 0 ? 'high' : 'low';
      const plateY = sortingWallPlateYAtZ(z);
      writer.addMember({
        semanticId: `mineworks-sorting-${side}-${end}-canopy-post`,
        moduleId: 'roofed-ore-sorting-yard',
        materialRole: 'rough-timber',
        structuralUse: 'timber-frame',
        start: [x, 0.68, z],
        end: [x, plateY, z],
        width: 0.2,
        depth: 0.2,
      });
      writer.addMember({
        semanticId: `mineworks-sorting-${side}-${end}-canopy-knee-brace`,
        moduleId: 'roofed-ore-sorting-yard',
        materialRole: 'rough-timber',
        structuralUse: 'roof-frame',
        start: [x, plateY - 0.76, z],
        end: [x - Math.sign(x) * 0.68, plateY, z],
        width: 0.13,
        depth: 0.13,
      });
    }
  }
  for (const z of [-1.2, 1.2]) {
    writer.addMember({
      semanticId: `mineworks-sorting-${z < 0 ? 'high' : 'low'}-wall-plate`,
      moduleId: 'roofed-ore-sorting-yard',
      materialRole: 'rough-timber',
      structuralUse: 'roof-frame',
      start: [-2.78, sortingWallPlateYAtZ(z), z],
      end: [2.78, sortingWallPlateYAtZ(z), z],
      width: 0.19,
      depth: 0.19,
    });
  }
  writer.addRoofPanel({
    semanticId: 'mineworks-sorting-floor-split-shingle-weather-roof',
    moduleId: 'roofed-ore-sorting-yard',
    materialRole: 'split-shingles',
    structuralUse: 'roof-covering',
    eaveOrigin: [-3.175, SORTING_ROOF_EAVE_Y, SORTING_ROOF_EAVE_Z],
    eaveVector: [6.35, 0, 0],
    slopeVector: [0, SORTING_ROOF_RISE, -SORTING_ROOF_RUN],
    thickness: SORTING_ROOF_THICKNESS,
  });
  const slots = addProceduralMaterialSlotMeshes(shelter, writer.build(), {
    namePrefix: 'Mineworks sorting-floor weather frame',
  });
  const roof = slots.meshes.get('split-shingles');
  if (roof) roof.name = 'Mineworks sorting-floor split-shingle weather roof';
  floor.add(shelter);
}

function stockpileNames(resource: MineworksResource): {
  container: string;
  segment: string;
  item: string;
} {
  if (resource === 'iron') {
    return {
      container: 'IronMineStockpile',
      segment: 'IronMineOreSegment',
      item: 'Sorted rich iron ore',
    };
  }
  if (resource === 'salt') {
    return {
      container: 'SaltMineStockpile',
      segment: 'SaltMineSaltSegment',
      item: 'Sorted rich salt rock',
    };
  }
  return {
    container: 'ClayMineStockpile',
    segment: 'ClayMineClaySegment',
    item: 'Sorted rich clay lump',
  };
}

function stockpilePositions(resource: MineworksResource): readonly (readonly [number, number])[] {
  if (resource === 'iron') {
    return [
      [7.4, -5.7], [8.7, -4.5], [9.5, -2.9],
      [7.1, -6.9], [9.2, -6.1], [6.4, -4.2],
    ];
  }
  if (resource === 'salt') {
    return [
      [8.3, 4.6], [9.6, 3.2], [7.1, 5.8],
      [9.2, 5.4], [6.8, 3.4], [8.1, 6.6],
    ];
  }
  return [
    [-8.3, -5.2], [-9.5, -3.8], [-6.9, -6.2],
    [-9.0, -6.5], [-6.6, -4.4], [-10.1, -5.3],
  ];
}

function stockpileMaterials(resource: MineworksResource): readonly [THREE.Material, THREE.Material] {
  if (resource === 'iron') return [IRON_DARK, IRON_OXIDE];
  if (resource === 'salt') return [SALT_DARK, SALT_LIGHT];
  return [CLAY_DARK, CLAY_LIGHT];
}

function addMineralStockpile(group: THREE.Group, resource: MineworksResource): void {
  const stockpile = new THREE.Group();
  const names = stockpileNames(resource);
  const materials = stockpileMaterials(resource);
  stockpile.name = names.container;
  stockpile.visible = false;

  stockpilePositions(resource).forEach(([x, z], segmentIndex) => {
    const segment = new THREE.Group();
    segment.name = names.segment;
    segment.visible = false;
    segment.position.set(x, 0, z);
    segment.rotation.y = segmentIndex * 0.57;
    for (let index = 0; index < 5; index++) {
      const angle = index / 5 * Math.PI * 2;
      const geometry = resource === 'clay'
        ? new THREE.SphereGeometry(0.5 + (index % 3) * 0.07, 8, 5)
        : new THREE.DodecahedronGeometry(0.46 + (index % 3) * 0.09, 0);
      const item = addMesh(
        segment,
        geometry,
        materials[(index + segmentIndex) % 3 === 0 ? 0 : 1],
        new THREE.Vector3(
          Math.cos(angle) * 0.62,
          0.36 + (index === 4 ? 0.48 : 0),
          Math.sin(angle) * 0.48,
        ),
        new THREE.Euler(index * 0.23, angle, segmentIndex * 0.11),
        resource === 'clay'
          ? new THREE.Vector3(1.22, 0.68, 1.02)
          : new THREE.Vector3(1.18, 0.76, 0.96),
      );
      item.name = names.item;
    }
    stockpile.add(segment);
  });
  group.add(stockpile);
}

function addMineSupportStockpile(group: THREE.Group): void {
  const stockpile = new THREE.Group();
  stockpile.name = 'MineSupportStockpile';
  stockpile.visible = false;
  stockpile.position.set(-4.7, 0, -6.5);
  stockpile.rotation.y = -0.18;

  for (let segmentIndex = 0; segmentIndex < 4; segmentIndex += 1) {
    const segment = new THREE.Group();
    segment.name = 'MineSupportTimberSegment';
    segment.visible = false;
    segment.position.set(
      (segmentIndex % 2) * 3.15,
      0,
      Math.floor(segmentIndex / 2) * 1.15,
    );
    for (let beamIndex = 0; beamIndex < 3; beamIndex += 1) {
      const beam = addMesh(
        segment,
        new THREE.BoxGeometry(2.75, 0.24, 0.3),
        timberMaterial(beamIndex === 1 ? 'dark' : 'weathered'),
        new THREE.Vector3(
          0,
          0.25 + beamIndex * 0.24,
          (beamIndex - 1) * 0.12,
        ),
        new THREE.Euler(0, (beamIndex - 1) * 0.025, 0),
      );
      beam.name = 'Prepared mineworks shaft-support beam';
    }
    stockpile.add(segment);
  }
  group.add(stockpile);
}

/** Applies the simulation-facing identity shared by procedural and GLB variants. */
export function applyMineworksSemanticContract(group: THREE.Group): void {
  group.name = 'Mineworks';
  group.userData.semanticRole = 'rich-mineral-mineworks';
  group.userData.extractionResources = ['iron', 'salt', 'clay'];
  group.userData.silhouette = 'vertical-shaft-headframe';
  group.userData.architectureEra = 'circa-1550';
  group.userData.architectureRegion = 'Gorski Kotar and Croatian Littoral';
  group.userData.weatherProtection = [
    'deep-eave-headframe-shingle-cap',
    'roofed-ore-sorting-floor',
  ];
  group.userData.livingVegetationOwner = 'SeedThree';
}

/** Adds only simulation-owned stores; the authored GLB stays a neutral fixed shell. */
export function addMineworksRuntimeState(group: THREE.Group): void {
  addMineralStockpile(group, 'iron');
  addMineralStockpile(group, 'salt');
  addMineralStockpile(group, 'clay');
  addMineSupportStockpile(group);
  group.add(createCivilianToolStockpile(new THREE.Vector3(4.8, 0, 5.7), -0.16));
}

/** Deep rich-mineral works for iron, salt, and clay deposits. */
export function createMineralMineMesh(): THREE.Group {
  const group = new THREE.Group();
  applyMineworksSemanticContract(group);
  addShaftCollar(group);
  addHeadframe(group);
  addHoistHouse(group);
  addOreSortingFloor(group);
  addMineworksRuntimeState(group);
  return group;
}
