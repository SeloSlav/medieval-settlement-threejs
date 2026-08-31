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
  addGableShell,
  addLeanToRoof,
  addPlankDoor,
  addSmallWindow,
} from './buildingMeshKit.ts';
import { createCivilianToolStockpile } from './civilianToolStockpileMesh.ts';
import { ProceduralGeometryWriter } from '../proceduralArchitecture/geometryWriter.ts';
import { addProceduralMaterialSlotMeshes } from '../proceduralArchitecture/materialSlotMeshes.ts';

type MiningCampCommodity = 'iron' | 'salt' | 'clay';
type MiningCampModuleId =
  | 'day-shelter'
  | 'sorting-canopy'
  | 'handcart'
  | 'tool-rack'
  | 'survey-stakes'
  | 'surface-stockpiles'
  | 'tool-stockpile';

type MiningCampPlacement = {
  id: MiningCampModuleId;
  x: number;
  z: number;
  yaw: number;
};

type MiningCampPlan = {
  semanticRole: 'general-surface-extraction-camp';
  silhouette: 'day-work-shelter-and-sorting-yard';
  centeredExcavationCount: 0;
  resources: readonly ['stone', 'iron', 'salt', 'clay'];
  placements: readonly MiningCampPlacement[];
};

/** Serializable mass-and-module plan compiled below into the procedural camp mesh. */
const MINING_CAMP_PLAN: MiningCampPlan = Object.freeze({
  semanticRole: 'general-surface-extraction-camp',
  silhouette: 'day-work-shelter-and-sorting-yard',
  centeredExcavationCount: 0,
  resources: ['stone', 'iron', 'salt', 'clay'] as const,
  placements: [
    { id: 'day-shelter', x: -5.7, z: 4.7, yaw: -0.07 },
    { id: 'sorting-canopy', x: 2.55, z: 3.65, yaw: 0.04 },
    { id: 'handcart', x: -0.75, z: -0.85, yaw: -0.34 },
    { id: 'tool-rack', x: -3.35, z: 1.55, yaw: -0.18 },
    { id: 'survey-stakes', x: 0, z: 0, yaw: 0 },
    { id: 'surface-stockpiles', x: 0, z: 0, yaw: 0 },
    { id: 'tool-stockpile', x: 3.65, z: 5.4, yaw: -0.08 },
  ] as const,
});

const IRON_ORE_DARK = metalMaterial('iron');
const IRON_ORE_OXIDE = sharedBuildingDetailMaterial('paintRed');
const SALT_ROCK_DARK = sharedBuildingMaterial('masonryMid');
const SALT_ROCK_LIGHT = sharedBuildingMaterial('masonryLight');
const CLAY_DARK = sharedBuildingDetailMaterial('earth');
const CLAY_LIGHT = sharedBuildingDetailMaterial('paintOchre');

const SORTING_CANOPY_HALF_DEPTH = 1.62;
const SORTING_CANOPY_ROOF_CENTER_Y = 3.16;
const SORTING_CANOPY_ROOF_PITCH = 0.085;
const SORTING_CANOPY_ROOF_THICKNESS = 0.1;
const SORTING_CANOPY_WALL_PLATE_HEIGHT = 0.2;

/**
 * The sewn-linen fly is rotated around its centre with its negative-Z edge
 * raised. Resolve the lower fabric plane analytically so the two wall plates
 * and their posts terminate against the roof instead of sharing one height
 * and leaving the windward side visibly unsupported.
 */
function sortingCanopyRoofUndersideY(z: number): number {
  return SORTING_CANOPY_ROOF_CENTER_Y
    - z * Math.tan(SORTING_CANOPY_ROOF_PITCH)
    - SORTING_CANOPY_ROOF_THICKNESS / (2 * Math.cos(SORTING_CANOPY_ROOF_PITCH));
}

function sortingCanopyWallPlateY(z: number): number {
  return sortingCanopyRoofUndersideY(z) - SORTING_CANOPY_WALL_PLATE_HEIGHT * 0.5;
}

function addSurfaceStonePile(
  group: THREE.Group,
  x: number,
  z: number,
  rotation = 0,
): void {
  const pile = new THREE.Group();
  // These legacy names are the stock-visibility contract for stone_quarry.
  pile.name = 'StoneQuarryStockSegment';
  pile.visible = false;
  pile.position.set(x, 0, z);
  pile.rotation.y = rotation;
  const stones = [
    [-0.62, 0.3, -0.12, 0.62],
    [0.62, 0.27, 0.08, 0.56],
    [0.02, 0.76, 0.05, 0.54],
    [-0.05, 0.28, 0.58, 0.48],
  ] as const;
  for (let i = 0; i < stones.length; i++) {
    const [sx, sy, sz, scale] = stones[i];
    const stone = addMesh(
      pile,
      new THREE.DodecahedronGeometry(scale, 0),
      quarryRockMaterial(i === 2 ? 'light' : i === 1 ? 'dark' : 'mid'),
      new THREE.Vector3(sx, sy, sz),
      new THREE.Euler(i * 0.17, (i - 1) * 0.38, i * 0.11),
      new THREE.Vector3(1.16, 0.78, 1.02),
    );
    stone.name = 'Mining camp surface-stone lump';
  }
  // A low timber skid keeps the rough field stone visibly sorted from loose terrain rock.
  for (const skidX of [-0.62, 0.62]) {
    addMesh(
      pile,
      new THREE.BoxGeometry(0.14, 0.14, 1.7),
      timberMaterial('weathered'),
      new THREE.Vector3(skidX, 0.08, 0.08),
      new THREE.Euler(0, 0.03 * Math.sign(skidX), 0),
    );
  }
  group.add(pile);
}

function createStoneStockpile(): THREE.Group {
  const stockpile = new THREE.Group();
  stockpile.name = 'StoneQuarryStockpile';
  stockpile.visible = false;
  addSurfaceStonePile(stockpile, -7.45, -6.55, 0.05);
  addSurfaceStonePile(stockpile, -5.95, -6.55, -0.04);
  addSurfaceStonePile(stockpile, -4.45, -6.55, 0.08);
  return stockpile;
}

function commodityStockpileNames(commodity: MiningCampCommodity): {
  container: string;
  segment: string;
  item: string;
} {
  if (commodity === 'iron') {
    return {
      // Retain legacy container/segment names for bulk-stock synchronization.
      container: 'MiningPitIronStockpile',
      segment: 'MiningPitIronSegment',
      item: 'Mining camp iron-ore lump',
    };
  }
  if (commodity === 'salt') {
    return {
      container: 'MiningPitSaltStockpile',
      segment: 'MiningPitSaltSegment',
      item: 'Mining camp salt-rock lump',
    };
  }
  return {
    container: 'MiningPitClayStockpile',
    segment: 'MiningPitClaySegment',
    item: 'Mining camp clay lump',
  };
}

function commodityStockpilePositions(
  commodity: MiningCampCommodity,
): readonly (readonly [number, number, number])[] {
  if (commodity === 'iron') {
    return [
      [4.45, -6.55, -0.08],
      [5.95, -6.55, 0.04],
      [7.45, -6.55, -0.05],
    ];
  }
  if (commodity === 'salt') {
    return [
      [-8.1, -2.15, 0.04],
      [-8.1, -0.2, -0.08],
      [-8.1, 1.75, 0.06],
    ];
  }
  return [
    [8.15, -2.15, -0.05],
    [8.15, -0.2, 0.07],
    [8.15, 1.75, -0.08],
  ];
}

function commodityStockpileMaterials(
  commodity: MiningCampCommodity,
): readonly [THREE.Material, THREE.Material] {
  if (commodity === 'iron') return [IRON_ORE_DARK, IRON_ORE_OXIDE];
  if (commodity === 'salt') return [SALT_ROCK_DARK, SALT_ROCK_LIGHT];
  return [CLAY_DARK, CLAY_LIGHT];
}

function createCommodityStockpile(commodity: MiningCampCommodity): THREE.Group {
  const names = commodityStockpileNames(commodity);
  const materials = commodityStockpileMaterials(commodity);
  const stockpile = new THREE.Group();
  stockpile.name = names.container;
  stockpile.visible = false;

  commodityStockpilePositions(commodity).forEach(([x, z, rotation], segmentIndex) => {
    const segment = new THREE.Group();
    segment.name = names.segment;
    segment.visible = false;
    segment.position.set(x, 0, z);
    segment.rotation.y = rotation;

    for (let itemIndex = 0; itemIndex < 5; itemIndex += 1) {
      const angle = itemIndex / 5 * Math.PI * 2;
      const geometry = commodity === 'clay'
        ? new THREE.SphereGeometry(0.48 + (itemIndex % 2) * 0.07, 8, 5)
        : new THREE.DodecahedronGeometry(0.42 + (itemIndex % 3) * 0.08, 0);
      const item = addMesh(
        segment,
        geometry,
        materials[(itemIndex + segmentIndex) % 3 === 0 ? 0 : 1],
        new THREE.Vector3(
          Math.cos(angle) * 0.58,
          0.34 + (itemIndex === 4 ? 0.46 : 0),
          Math.sin(angle) * 0.45,
        ),
        new THREE.Euler(itemIndex * 0.19, angle, segmentIndex * 0.08),
        commodity === 'clay'
          ? new THREE.Vector3(1.22, 0.66, 1.02)
          : new THREE.Vector3(1.12, 0.78, 0.96),
      );
      item.name = names.item;
    }
    stockpile.add(segment);
  });
  return stockpile;
}

function addDayShelter(group: THREE.Group): void {
  group.name = 'MiningCampDayShelter';
  const shell = addGableShell(group, {
    width: 5.55,
    depth: 4.25,
    stoneHeight: 0.52,
    wallHeight: 2.25,
    ridgeHeight: 1.7,
    wallMaterial: timberMaterial('weathered'),
    roofMaterial: sharedBuildingMaterial('shingle'),
  });
  addPlankDoor(group, -0.9, 0.56, shell.frontZ + 0.02, 0.88, 1.72);
  addSmallWindow(group, 1.08, 1.48, shell.frontZ + 0.02, 0.7, 0.78);

  const sign = addMesh(
    group,
    new THREE.BoxGeometry(1.5, 0.52, 0.1),
    timberMaterial('mid'),
    new THREE.Vector3(0.7, 2.65, shell.frontZ + 0.12),
    new THREE.Euler(0, 0, -0.03),
  );
  sign.name = 'Mining camp field office signboard';
}

function addSortingCanopy(group: THREE.Group): void {
  group.name = 'MiningCampSortingCanopy';
  const halfWidth = 3.05;
  const halfDepth = SORTING_CANOPY_HALF_DEPTH;
  group.userData.roofSupportProfile = {
    roofKind: 'negative-z-high-sewn-linen-fly',
    roofCenterY: SORTING_CANOPY_ROOF_CENTER_Y,
    roofPitch: SORTING_CANOPY_ROOF_PITCH,
    roofThickness: SORTING_CANOPY_ROOF_THICKNESS,
    windwardWallPlateY: sortingCanopyWallPlateY(-halfDepth),
    yardWallPlateY: sortingCanopyWallPlateY(halfDepth),
  };
  for (const x of [-halfWidth, halfWidth]) {
    for (const z of [-halfDepth, halfDepth]) {
      const plateY = sortingCanopyWallPlateY(z);
      const post = addMesh(
        group,
        new THREE.BoxGeometry(0.2, plateY, 0.2),
        timberMaterial('dark'),
        new THREE.Vector3(x, plateY * 0.5, z),
      );
      post.name = 'Mining camp sorting-canopy post';
    }
  }
  for (const z of [-halfDepth, halfDepth]) {
    const plate = addMesh(
      group,
      new THREE.BoxGeometry(6.45, SORTING_CANOPY_WALL_PLATE_HEIGHT, 0.2),
      timberMaterial('weathered'),
      new THREE.Vector3(0, sortingCanopyWallPlateY(z), z),
    );
    plate.name = `Mining camp ${z < 0 ? 'windward' : 'yard'} sorting-canopy wall plate`;
  }
  addLeanToRoof(group, {
    width: 6.75,
    depth: 3.8,
    thickness: SORTING_CANOPY_ROOF_THICKNESS,
    material: sharedBuildingDetailMaterial('canvas'),
    position: new THREE.Vector3(0, SORTING_CANOPY_ROOF_CENTER_Y, 0),
    pitch: SORTING_CANOPY_ROOF_PITCH,
    highEdge: 'negativeZ',
    name: 'Mining camp sorting awning',
  });
  addSortingCanopyWeatherFrame(group, halfWidth, halfDepth);
  addSortingBench(group);
}

/**
 * Grounds the temporary fly on stone pads, triangulates its wall plate, and
 * closes only the windward side with removable sewn-linen panels. The single
 * material-slot meshes retain member/fabric-aligned physical UVs while keeping
 * the camp visibly mobile rather than turning it into a permanent building.
 */
function addSortingCanopyWeatherFrame(
  group: THREE.Group,
  halfWidth: number,
  halfDepth: number,
): void {
  const frame = new THREE.Group();
  frame.name = 'Mining camp sorting-canopy weather frame';
  frame.userData.architectureModule = 'knee-braced-sorting-fly';
  frame.userData.bracingSystem = 'four-post-knee-braced-frame';
  frame.userData.weatherProtection = 'removable-sewn-linen-windward-screen';

  const writer = new ProceduralGeometryWriter([
    'fieldstone',
    'rough-timber',
    'linen-canvas',
  ]);
  for (const x of [-halfWidth, halfWidth]) {
    for (const z of [-halfDepth, halfDepth]) {
      const side = x < 0 ? 'left' : 'right';
      const end = z < 0 ? 'windward' : 'yard';
      writer.addBox({
        semanticId: `mining-camp-${side}-${end}-canopy-footing`,
        moduleId: 'knee-braced-sorting-fly',
        materialRole: 'fieldstone',
        structuralUse: 'foundation-and-plinth',
        center: [x, 0.14, z],
        size: [0.48, 0.28, 0.48],
        uvOffsetMeters: [x < 0 ? 0.17 : 0.61, z < 0 ? 0.23 : 0.73],
      });
      writer.addMember({
        semanticId: `mining-camp-${side}-${end}-canopy-knee-brace`,
        moduleId: 'knee-braced-sorting-fly',
        materialRole: 'rough-timber',
        structuralUse: 'roof-frame',
        start: [x, sortingCanopyWallPlateY(z) - 0.74, z],
        end: [x - Math.sign(x) * 0.72, sortingCanopyWallPlateY(z), z],
        width: 0.14,
        depth: 0.14,
      });
    }
  }

  const windwardZ = -halfDepth + 0.035;
  for (const [index, y] of [1.48, 2.76].entries()) {
    writer.addMember({
      semanticId: `mining-camp-windward-screen-rail-${index + 1}`,
      moduleId: 'knee-braced-sorting-fly',
      materialRole: 'rough-timber',
      structuralUse: 'timber-frame',
      start: [-halfWidth + 0.06, y, windwardZ],
      end: [halfWidth - 0.06, y, windwardZ],
      width: 0.12,
      depth: 0.12,
    });
  }
  for (let panelIndex = 0; panelIndex < 3; panelIndex += 1) {
    writer.addBox({
      semanticId: `mining-camp-windward-storm-panel-${panelIndex + 1}`,
      moduleId: 'knee-braced-sorting-fly',
      materialRole: 'linen-canvas',
      structuralUse: 'awning-and-fly',
      center: [-2.02 + panelIndex * 2.02, 2.12, windwardZ + 0.018],
      size: [1.88, 1.18, 0.036],
      uvOffsetMeters: [panelIndex * 0.23, panelIndex * 0.11],
    });
  }

  addProceduralMaterialSlotMeshes(frame, writer.build(), {
    namePrefix: 'Mining camp sorting-canopy',
  });
  group.add(frame);
}

function addSortingBench(group: THREE.Group): void {
  const yard = new THREE.Group();
  yard.name = 'MiningCampSortingYard';
  yard.position.set(-0.2, 0, 0.15);
  const tabletop = addMesh(
    yard,
    new THREE.BoxGeometry(4.45, 0.24, 1.15),
    timberMaterial('weathered'),
    new THREE.Vector3(0, 1.02, 0),
  );
  tabletop.name = 'Mining camp sorting table';
  for (const x of [-1.75, 1.75]) {
    for (const z of [-0.38, 0.38]) {
      const leg = addMesh(
        yard,
        new THREE.BoxGeometry(0.2, 0.96, 0.2),
        timberMaterial('dark'),
        new THREE.Vector3(x, 0.48, z),
      );
      leg.name = 'Mining camp sorting-table leg';
    }
  }

  const samples = [
    ['stone', quarryRockMaterial('mid')],
    ['iron', IRON_ORE_OXIDE],
    ['salt', SALT_ROCK_LIGHT],
    ['clay', CLAY_LIGHT],
  ] as const;
  samples.forEach(([commodity, material], index) => {
    const sample = addMesh(
      yard,
      commodity === 'clay'
        ? new THREE.SphereGeometry(0.23, 8, 5)
        : new THREE.DodecahedronGeometry(0.23, 0),
      material,
      new THREE.Vector3(-1.45 + index * 0.92, 1.27, -0.06),
      new THREE.Euler(index * 0.13, index * 0.52, -index * 0.07),
      commodity === 'clay'
        ? new THREE.Vector3(1.2, 0.7, 1)
        : undefined,
    );
    sample.name = `Mining camp ${commodity} sorting sample`;
  });

  for (const x of [-1.25, 1.25]) {
    const sieve = addMesh(
      yard,
      new THREE.TorusGeometry(0.38, 0.055, 6, 18),
      timberMaterial('mid'),
      new THREE.Vector3(x, 1.23, 0.38),
      new THREE.Euler(Math.PI * 0.5, 0, x < 0 ? -0.08 : 0.11),
    );
    sieve.name = 'Mining camp hand sieve';
  }
  group.add(yard);
}

function addHandcart(group: THREE.Group): void {
  group.name = 'MiningCampHandcart';
  const bed = addMesh(
    group,
    new THREE.BoxGeometry(1.65, 0.18, 2.2),
    timberMaterial('weathered'),
    new THREE.Vector3(0, 0.9, 0),
    new THREE.Euler(-0.08, 0, 0),
  );
  bed.name = 'Mining camp field handcart bed';
  for (const x of [-0.75, 0.75]) {
    const wheel = addMesh(
      group,
      new THREE.CylinderGeometry(0.58, 0.58, 0.16, 14),
      timberMaterial('dark'),
      new THREE.Vector3(x, 0.58, -0.12),
      new THREE.Euler(0, 0, Math.PI * 0.5),
    );
    wheel.name = 'Mining camp handcart wheel';
  }
  const axle = addMesh(
    group,
    new THREE.CylinderGeometry(0.08, 0.08, 1.75, 8),
    metalMaterial('iron'),
    new THREE.Vector3(0, 0.58, -0.12),
    new THREE.Euler(0, 0, Math.PI * 0.5),
  );
  axle.name = 'Mining camp handcart iron axle';
  for (const x of [-0.56, 0.56]) {
    const shaft = addMesh(
      group,
      new THREE.BoxGeometry(0.13, 0.13, 2.25),
      timberMaterial('mid'),
      new THREE.Vector3(x, 0.68, 1.72),
      new THREE.Euler(-0.12, 0, 0),
    );
    shaft.name = 'Mining camp handcart timber handle';
  }
}

function addCampToolRack(group: THREE.Group): void {
  group.name = 'MiningCampToolRack';
  for (const x of [-0.8, 0.8]) {
    const post = addMesh(
      group,
      new THREE.BoxGeometry(0.16, 1.75, 0.16),
      timberMaterial('dark'),
      new THREE.Vector3(x, 0.88, 0),
    );
    post.name = 'Mining camp tool-rack post';
  }
  const rail = addMesh(
    group,
    new THREE.BoxGeometry(1.85, 0.15, 0.16),
    timberMaterial('weathered'),
    new THREE.Vector3(0, 1.5, 0),
  );
  rail.name = 'Mining camp tool-rack rail';
  for (let index = 0; index < 3; index += 1) {
    const tool = new THREE.Group();
    tool.name = 'Mining camp hand tool';
    tool.position.set(-0.52 + index * 0.52, 0.08, 0.12);
    tool.rotation.z = -0.13 + index * 0.12;
    addMesh(
      tool,
      new THREE.CylinderGeometry(0.045, 0.052, 1.42, 6),
      timberMaterial('weathered'),
      new THREE.Vector3(0, 0.71, 0),
    );
    addMesh(
      tool,
      index === 2
        ? new THREE.ConeGeometry(0.16, 0.44, 4)
        : new THREE.BoxGeometry(0.55, 0.12, 0.14),
      metalMaterial(index === 1 ? 'steel' : 'iron'),
      new THREE.Vector3(index === 2 ? 0 : -0.12, 1.42, 0),
      new THREE.Euler(index === 2 ? Math.PI * 0.5 : 0, 0, 0),
    );
    group.add(tool);
  }
}

function addSurveyStakes(group: THREE.Group): void {
  group.name = 'MiningCampSurveyStakes';
  const stakes = [
    [-3.8, -3.55, -0.08],
    [0.25, -4.35, 0.06],
    [3.45, -3.65, -0.04],
  ] as const;
  for (let index = 0; index < stakes.length; index += 1) {
    const [x, z, tilt] = stakes[index];
    const stake = addMesh(
      group,
      new THREE.CylinderGeometry(0.045, 0.065, 1.55, 6),
      timberMaterial('dark'),
      new THREE.Vector3(x, 0.76, z),
      new THREE.Euler(0, 0, tilt),
    );
    stake.name = 'Mining camp survey stake';
    const flag = addMesh(
      group,
      new THREE.BoxGeometry(0.58, 0.34, 0.035),
      sharedBuildingDetailMaterial(index % 2 === 0 ? 'canvas' : 'paintRed'),
      new THREE.Vector3(x + 0.26, 1.28, z),
      new THREE.Euler(0, -0.08 + index * 0.07, tilt),
    );
    flag.name = 'Mining camp survey flag';
  }
}

function addSurfaceStockpiles(group: THREE.Group): void {
  group.name = 'MiningCampSurfaceStockpiles';
  group.add(createStoneStockpile());
  group.add(createCommodityStockpile('iron'));
  group.add(createCommodityStockpile('salt'));
  group.add(createCommodityStockpile('clay'));
}

/** Adds simulation-owned material and civilian-tool inventory to either shell. */
export function addMiningCampRuntimeState(target: THREE.Group): void {
  if (target.getObjectByName('MiningCampSurfaceStockpiles') == null) {
    const surfaceStockpiles = new THREE.Group();
    addSurfaceStockpiles(surfaceStockpiles);
    target.add(surfaceStockpiles);
  }
  if (target.getObjectByName('MiningCampCivilianToolInventory') == null) {
    const toolInventory = new THREE.Group();
    toolInventory.name = 'MiningCampCivilianToolInventory';
    toolInventory.position.set(3.65, 0, 5.4);
    toolInventory.rotation.y = -0.08;
    toolInventory.add(createCivilianToolStockpile(new THREE.Vector3(), 0));
    target.add(toolInventory);
  }
}

/** Applies the surface-extraction identity shared by procedural and GLB shells. */
export function applyMiningCampSemanticContract(target: THREE.Group): void {
  target.name = 'Mining Camp';
  target.userData.semanticRole = MINING_CAMP_PLAN.semanticRole;
  target.userData.extractionResources = [...MINING_CAMP_PLAN.resources];
  target.userData.silhouette = MINING_CAMP_PLAN.silhouette;
  target.userData.architectureEra = 'circa-1550';
  target.userData.architectureRegion = 'Gorski Kotar and Croatian Littoral';
  target.userData.weatherProtection = [
    'steep-split-shingle-day-shelter',
    'removable-linen-sorting-fly',
  ];
  target.userData.livingVegetationOwner = 'SeedThree';
  target.userData.centeredResourceRequired = false;
  target.userData.architecturePlan = {
    ...MINING_CAMP_PLAN,
    resources: [...MINING_CAMP_PLAN.resources],
    placements: MINING_CAMP_PLAN.placements.map((placement) => ({ ...placement })),
  };
  target.userData.architectureDiagnostics = {
    moduleCount: MINING_CAMP_PLAN.placements.length,
    centeredExcavationCount: MINING_CAMP_PLAN.centeredExcavationCount,
    dynamicStockpileCount: MINING_CAMP_PLAN.resources.length,
  };
}

function compileMiningCampModule(
  target: THREE.Group,
  placement: MiningCampPlacement,
): void {
  const moduleGroup = new THREE.Group();
  moduleGroup.position.set(placement.x, 0, placement.z);
  moduleGroup.rotation.y = placement.yaw;
  switch (placement.id) {
    case 'day-shelter':
      addDayShelter(moduleGroup);
      break;
    case 'sorting-canopy':
      addSortingCanopy(moduleGroup);
      break;
    case 'handcart':
      addHandcart(moduleGroup);
      break;
    case 'tool-rack':
      addCampToolRack(moduleGroup);
      break;
    case 'survey-stakes':
      addSurveyStakes(moduleGroup);
      break;
    case 'surface-stockpiles':
      addSurfaceStockpiles(moduleGroup);
      break;
    case 'tool-stockpile': {
      const toolStockpile = createCivilianToolStockpile(new THREE.Vector3(), 0);
      moduleGroup.name = 'MiningCampCivilianToolInventory';
      moduleGroup.add(toolStockpile);
      break;
    }
  }
  target.add(moduleGroup);
}

/** Day-work camp for finite surface stone, iron, salt, and clay deposits. */
export function createStoneQuarryMesh(): THREE.Group {
  const group = new THREE.Group();
  applyMiningCampSemanticContract(group);
  for (const placement of MINING_CAMP_PLAN.placements) {
    if (placement.id === 'surface-stockpiles' || placement.id === 'tool-stockpile') continue;
    compileMiningCampModule(group, placement);
  }
  addMiningCampRuntimeState(group);
  return group;
}
