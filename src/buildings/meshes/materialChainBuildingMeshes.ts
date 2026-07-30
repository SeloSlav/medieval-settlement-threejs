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
  addPlankDoor,
} from './buildingMeshKit.ts';
import { createCivilianToolStockpile } from './civilianToolStockpileMesh.ts';
import {
  CHARCOAL_BURNER_FIREWOOD_VISUAL_SEGMENTS,
  POTTER_FIREWOOD_VISUAL_SEGMENTS,
  SMITHY_CHARCOAL_VISUAL_SEGMENTS,
  SMITHY_WATER_VISUAL_SEGMENTS,
} from '../bulkStockpileVisuals.ts';

const CLAY = sharedBuildingDetailMaterial('earth');
const FIRED_CLAY = sharedBuildingDetailMaterial('paintRed');
const CHARCOAL = sharedBuildingMaterial('interiorDark');
const IRON_BLOOM = metalMaterial('iron');
const ASH = stoneMaterial('mortar');
const WATER = sharedBuildingDetailMaterial('water');
export const CHARCOAL_CLAMP_SMOKE_NAME = 'CharcoalClampSmoke';

function addYardBase(group: THREE.Group, width: number, depth: number): void {
  const base = addMesh(
    group,
    new THREE.CylinderGeometry(Math.max(width, depth) * 0.52, Math.max(width, depth) * 0.55, 0.14, 14),
    sharedBuildingDetailMaterial('earth'),
    new THREE.Vector3(0, 0.05, 0),
  );
  base.scale.set(width / Math.max(width, depth), 1, depth / Math.max(width, depth));
  base.receiveShadow = true;
}

function addTimberCanopy(
  group: THREE.Group,
  center: THREE.Vector3,
  width: number,
  depth: number,
): void {
  for (const x of [-width * 0.42, width * 0.42]) {
    for (const z of [-depth * 0.38, depth * 0.38]) {
      addMesh(
        group,
        new THREE.BoxGeometry(0.17, 2.05, 0.17),
        timberMaterial('dark'),
        new THREE.Vector3(center.x + x, 1.08, center.z + z),
      );
    }
  }
  addLeanToRoof(group, {
    width: width + 0.35,
    depth: depth + 0.45,
    thickness: 0.14,
    material: sharedBuildingMaterial('shingle'),
    position: new THREE.Vector3(center.x, 2.15, center.z),
    pitch: 0.1,
    highEdge: 'negativeZ',
    name: 'Weathered craft-yard canopy',
  });
}

function addClayLump(
  group: THREE.Group,
  name: string,
  position: THREE.Vector3,
  scale = 1,
): void {
  const lump = addMesh(
    group,
    new THREE.DodecahedronGeometry(0.23 * scale, 0),
    CLAY,
    position,
    new THREE.Euler(0.08, position.x * 0.4, -0.04),
  );
  lump.name = name;
  lump.scale.set(1.2, 0.62, 1);
  lump.visible = false;
}

function addCharcoalSack(
  group: THREE.Group,
  name: string,
  position: THREE.Vector3,
): void {
  const sack = new THREE.Group();
  sack.name = name;
  sack.position.copy(position);
  sack.visible = false;
  group.add(sack);
  const body = addMesh(
    sack,
    new THREE.SphereGeometry(0.29, 8, 6),
    CHARCOAL,
    new THREE.Vector3(),
  );
  body.scale.set(0.82, 1.22, 0.78);
  addMesh(
    sack,
    new THREE.CylinderGeometry(0.06, 0.11, 0.16, 7),
    CHARCOAL,
    new THREE.Vector3(0, 0.3, 0),
  );
}

function addIronBar(
  group: THREE.Group,
  name: string,
  position: THREE.Vector3,
  yaw = 0,
): void {
  const bar = addMesh(
    group,
    new THREE.BoxGeometry(0.72, 0.1, 0.11),
    IRON_BLOOM,
    position,
    new THREE.Euler(0, yaw, 0),
  );
  bar.name = name;
  bar.visible = false;
}

function addPot(
  group: THREE.Group,
  name: string,
  position: THREE.Vector3,
  scale = 1,
): void {
  const pot = new THREE.Group();
  pot.name = name;
  pot.position.copy(position);
  pot.visible = false;
  group.add(pot);
  addMesh(
    pot,
    new THREE.SphereGeometry(0.2 * scale, 9, 7),
    FIRED_CLAY,
    new THREE.Vector3(0, 0.17 * scale, 0),
    undefined,
    new THREE.Vector3(1, 1.12, 1),
  );
  addMesh(
    pot,
    new THREE.CylinderGeometry(0.1 * scale, 0.14 * scale, 0.2 * scale, 9, 1, true),
    FIRED_CLAY,
    new THREE.Vector3(0, 0.38 * scale, 0),
  );
  addMesh(
    pot,
    new THREE.TorusGeometry(0.105 * scale, 0.018 * scale, 5, 9),
    FIRED_CLAY,
    new THREE.Vector3(0, 0.49 * scale, 0),
    new THREE.Euler(Math.PI * 0.5, 0, 0),
  );
}

function addFirewoodStockpile(
  group: THREE.Group,
  containerName: string,
  segmentName: string,
  placements: readonly (readonly [x: number, y: number, z: number, yaw: number])[],
): void {
  const stockpile = new THREE.Group();
  stockpile.name = containerName;
  stockpile.visible = false;
  for (const [x, y, z, yaw] of placements) {
    const segment = new THREE.Group();
    segment.name = segmentName;
    segment.position.set(x, y, z);
    segment.rotation.y = yaw;
    segment.visible = false;
    for (let log = 0; log < 3; log++) {
      addMesh(
        segment,
        new THREE.CylinderGeometry(0.12, 0.14, 0.86, 7),
        timberMaterial(log % 2 === 0 ? 'mid' : 'light'),
        new THREE.Vector3(
          0,
          0.14 + Math.floor(log / 2) * 0.22,
          (log % 2) * 0.24,
        ),
        new THREE.Euler(0, 0, Math.PI * 0.5),
      );
    }
    stockpile.add(segment);
  }
  group.add(stockpile);
}

export function createClayPitMesh(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Riverbank clay pit';
  addYardBase(group, 10.5, 8.5);

  const pit = addMesh(
    group,
    new THREE.CylinderGeometry(3.6, 4.1, 0.42, 18),
    CLAY,
    new THREE.Vector3(-0.7, -0.04, -0.35),
  );
  pit.name = 'Wet clay excavation';
  pit.scale.set(1.18, 1, 0.76);
  addMesh(
    group,
    new THREE.CylinderGeometry(2.75, 3.25, 0.05, 18),
    sharedBuildingDetailMaterial('water'),
    new THREE.Vector3(-0.7, 0.18, -0.35),
  ).scale.set(1.18, 1, 0.72);

  const strata = new THREE.Group();
  strata.name = 'ClayBankStrata';
  strata.visible = false;
  for (const [index, [x, y, z, yaw, width]] of ([
    [-3.65, 0.38, -1.35, 0.34, 1.15],
    [-3.18, 0.53, -2.05, 0.62, 1.0],
    [1.77, 0.42, -2.22, -0.46, 1.1],
    [2.15, 0.58, -1.52, -0.24, 0.95],
  ] as const).entries()) {
    const seam = addMesh(
      strata,
      new THREE.BoxGeometry(width, 0.18 + index * 0.015, 0.32),
      CLAY,
      new THREE.Vector3(x, y, z),
      new THREE.Euler(-0.08, yaw, index % 2 === 0 ? 0.08 : -0.06),
    );
    seam.name = 'ClayBankStratum';
  }
  group.add(strata);

  addTimberCanopy(group, new THREE.Vector3(3.25, 0, 1.75), 3.4, 2.4);
  for (const [index, [x, z]] of ([
    [2.45, 1.45],
    [3.15, 1.5],
    [3.85, 1.45],
    [2.8, 2.05],
    [3.55, 2.05],
  ] as const).entries()) {
    addClayLump(
      group,
      'ClayPitClaySegment',
      new THREE.Vector3(x, 0.36 + (index % 2) * 0.08, z),
      1.15,
    );
  }
  const stockpile = new THREE.Group();
  stockpile.name = 'ClayPitStockpile';
  stockpile.visible = false;
  for (const child of [...group.children]) {
    if (child.name === 'ClayPitClaySegment') stockpile.attach(child);
  }
  group.add(stockpile);

  for (let step = 0; step < 5; step++) {
    addMesh(
      group,
      new THREE.BoxGeometry(2.2, 0.12, 0.34),
      timberMaterial('weathered'),
      new THREE.Vector3(-2.9 + step * 0.34, 0.2 + step * 0.14, 2.45),
      new THREE.Euler(0, -0.32, 0),
    );
  }
  group.add(createCivilianToolStockpile(new THREE.Vector3(-3.75, 0, -2.65), 0.24));
  return group;
}

export function createCharcoalBurnerMesh(): THREE.Group {
  const group = new THREE.Group();
  group.name = "Charcoal burner's yard";
  addYardBase(group, 9.5, 8.5);
  addTimberCanopy(group, new THREE.Vector3(2.6, 0, 1.8), 3.2, 2.5);

  addMesh(
    group,
    new THREE.ConeGeometry(2.35, 2.45, 16),
    sharedBuildingDetailMaterial('earth'),
    new THREE.Vector3(-1.15, 1.28, -0.2),
  ).name = 'Covered charcoal clamp';
  addMesh(
    group,
    new THREE.CylinderGeometry(0.34, 0.5, 0.85, 9),
    ASH,
    new THREE.Vector3(-1.15, 2.55, -0.2),
  );
  const smoke = new THREE.Group();
  smoke.name = CHARCOAL_CLAMP_SMOKE_NAME;
  smoke.position.set(-1.15, 2.95, -0.2);
  smoke.visible = false;
  smoke.userData.fpNoCollision = true;
  for (const [index, [x, y, z, scale]] of ([
    [0, 0.32, 0, 0.9],
    [0.12, 0.88, -0.05, 1.1],
    [-0.1, 1.52, 0.08, 1.3],
  ] as const).entries()) {
    const wisp = addMesh(
      smoke,
      new THREE.SphereGeometry(0.34, 7, 5),
      sharedBuildingDetailMaterial('smoke'),
      new THREE.Vector3(x, y, z),
    );
    wisp.name = `Charcoal clamp smoke wisp ${index + 1}`;
    wisp.scale.set(scale, scale * 1.45, scale);
    wisp.userData.fpNoCollision = true;
  }
  group.add(smoke);
  for (let vent = 0; vent < 8; vent++) {
    const angle = (vent / 8) * Math.PI * 2;
    addMesh(
      group,
      new THREE.CylinderGeometry(0.09, 0.09, 0.65, 6),
      timberMaterial('dark'),
      new THREE.Vector3(
        -1.15 + Math.cos(angle) * 2.05,
        0.48,
        -0.2 + Math.sin(angle) * 2.05,
      ),
    );
  }

  const stockpile = new THREE.Group();
  stockpile.name = 'CharcoalBurnerStockpile';
  stockpile.visible = false;
  group.add(stockpile);
  for (const [index, [x, z]] of ([
    [2.05, 1.45],
    [2.65, 1.5],
    [3.25, 1.48],
    [2.35, 2.02],
    [2.95, 2.05],
  ] as const).entries()) {
    addCharcoalSack(
      stockpile,
      'CharcoalBurnerCharcoalSegment',
      new THREE.Vector3(x, 0.48 + (index % 2) * 0.08, z),
    );
  }
  addFirewoodStockpile(
    group,
    'CharcoalBurnerFirewoodStockpile',
    'CharcoalBurnerFirewoodSegment',
    ([
      [2.0, 0, -2.7, -0.08],
      [2.95, 0, -2.72, 0.06],
      [2.45, 0.34, -2.68, -0.03],
    ] as const).slice(0, CHARCOAL_BURNER_FIREWOOD_VISUAL_SEGMENTS),
  );
  return group;
}

export function setCharcoalClampSmokeThroughput(
  marker: THREE.Object3D,
  throughputMultiplier: number,
): void {
  const smoke = marker.getObjectByName(CHARCOAL_CLAMP_SMOKE_NAME);
  if (!(smoke instanceof THREE.Group)) return;
  const throughput = THREE.MathUtils.clamp(throughputMultiplier, 0, 1.25);
  smoke.scale.set(
    0.82 + throughput * 0.18,
    0.62 + throughput * 0.38,
    0.82 + throughput * 0.18,
  );
}

export function createSmithyMesh(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Village smithy';
  addYardBase(group, 8.5, 7.5);
  const shell = addGableShell(group, {
    width: 5.9,
    depth: 4.6,
    stoneHeight: 0.65,
    wallHeight: 2.55,
    ridgeHeight: 1.45,
    wallMaterial: sharedBuildingMaterial('plasterGrey'),
    roofMaterial: sharedBuildingMaterial('clayDark'),
    centerX: -0.8,
    centerZ: -0.45,
    stoneGroundFloor: true,
  });
  addPlankDoor(group, -1.55, 0.65, shell.frontZ + 0.02, 1.15, 1.95);
  addMesh(
    group,
    new THREE.BoxGeometry(1.05, 3.7, 1.05),
    stoneMaterial('mid'),
    new THREE.Vector3(1.1, 3.15, -0.7),
  );
  addMesh(
    group,
    new THREE.CylinderGeometry(0.42, 0.58, 0.75, 9),
    stoneMaterial('mid'),
    new THREE.Vector3(1.1, 5.27, -0.7),
  );
  addLeanToRoof(group, {
    width: 3.25,
    depth: 2.5,
    thickness: 0.13,
    material: sharedBuildingMaterial('shingle'),
    position: new THREE.Vector3(2.65, 2.55, 1.35),
    pitch: 0.18,
    highEdge: 'negativeX',
    name: 'Smithing bay roof',
  });
  addMesh(
    group,
    new THREE.BoxGeometry(1.55, 0.7, 0.95),
    stoneMaterial('mid'),
    new THREE.Vector3(2.45, 0.45, 1.25),
  ).name = 'Smithy forge hearth';
  addMesh(
    group,
    new THREE.CylinderGeometry(0.14, 0.23, 0.72, 6),
    metalMaterial('iron'),
    new THREE.Vector3(3.25, 0.72, 0.25),
  ).name = 'Smithy anvil';
  addMesh(
    group,
    new THREE.BoxGeometry(0.65, 0.14, 0.24),
    metalMaterial('iron'),
    new THREE.Vector3(3.25, 1.02, 0.25),
  );
  const quenchTub = new THREE.Group();
  quenchTub.name = 'Smithy quench tub';
  quenchTub.position.set(3.55, 0.05, 1.95);
  group.add(quenchTub);
  addMesh(
    quenchTub,
    new THREE.CylinderGeometry(0.5, 0.54, 0.62, 10, 1, true),
    timberMaterial('dark'),
    new THREE.Vector3(0, 0.36, 0),
  ).name = 'Smithy coopered quench tub';
  for (const y of [0.16, 0.5]) {
    addMesh(
      quenchTub,
      new THREE.TorusGeometry(0.5, 0.035, 5, 10),
      IRON_BLOOM,
      new THREE.Vector3(0, y, 0),
      new THREE.Euler(Math.PI * 0.5, 0, 0),
    ).name = 'Smithy quench tub hoop';
  }
  const quenchWater = new THREE.Group();
  quenchWater.name = 'SmithyQuenchWaterStockpile';
  quenchWater.visible = false;
  quenchTub.add(quenchWater);
  for (let level = 0; level < SMITHY_WATER_VISUAL_SEGMENTS; level++) {
    const water = addMesh(
      quenchWater,
      new THREE.CylinderGeometry(0.42, 0.42, 0.025, 10),
      WATER,
      new THREE.Vector3(0, 0.2 + level * 0.17, 0),
    );
    water.name = 'SmithyQuenchWaterSegment';
    water.visible = false;
  }

  const ironStock = new THREE.Group();
  ironStock.name = 'SmithyIronStockpile';
  ironStock.visible = false;
  group.add(ironStock);
  const charcoalStock = new THREE.Group();
  charcoalStock.name = 'SmithyCharcoalStockpile';
  charcoalStock.visible = false;
  group.add(charcoalStock);
  const ironworkStock = new THREE.Group();
  ironworkStock.name = 'SmithyIronworkStockpile';
  ironworkStock.visible = false;
  group.add(ironworkStock);
  for (let index = 0; index < 4; index++) {
    addIronBar(
      ironStock,
      'SmithyIronSegment',
      new THREE.Vector3(1.75 + (index % 2) * 0.78, 0.3 + Math.floor(index / 2) * 0.13, -2.25),
      index % 2 ? -0.05 : 0.06,
    );
    const fitting = addMesh(
      ironworkStock,
      new THREE.TorusGeometry(0.2, 0.045, 5, 10),
      IRON_BLOOM,
      new THREE.Vector3(2 + (index % 2) * 0.52, 0.3 + Math.floor(index / 2) * 0.18, 2.35),
      new THREE.Euler(Math.PI * 0.5, 0, 0),
    );
    fitting.name = 'SmithyIronworkSegment';
    fitting.visible = false;
  }
  for (let index = 0; index < SMITHY_CHARCOAL_VISUAL_SEGMENTS; index++) {
    addCharcoalSack(
      charcoalStock,
      'SmithyCharcoalSegment',
      new THREE.Vector3(
        -3.55 - (index % 2) * 0.48,
        0.46 + Math.floor(index / 2) * 0.48,
        1.8,
      ),
    );
  }
  return group;
}

export function createPotterKilnMesh(): THREE.Group {
  const group = new THREE.Group();
  group.name = "Potter's kiln";
  addYardBase(group, 8.8, 7.7);
  const shell = addGableShell(group, {
    width: 5.1,
    depth: 4.2,
    stoneHeight: 0.45,
    wallHeight: 2.35,
    ridgeHeight: 1.35,
    wallMaterial: sharedBuildingMaterial('plasterOrange'),
    roofMaterial: sharedBuildingMaterial('clayRed'),
    centerX: -1.15,
    centerZ: -0.35,
  });
  addPlankDoor(group, -1.45, 0.45, shell.frontZ + 0.02, 1.05, 1.9);
  addTimberCanopy(group, new THREE.Vector3(2.55, 0, 1.25), 3.4, 2.7);

  addMesh(
    group,
    new THREE.SphereGeometry(1.3, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.62),
    FIRED_CLAY,
    new THREE.Vector3(2.25, 0.25, -1.35),
  ).name = 'Round updraft pottery kiln';
  addMesh(
    group,
    new THREE.BoxGeometry(0.75, 0.72, 0.22),
    sharedBuildingMaterial('interiorDark'),
    new THREE.Vector3(2.25, 0.48, -2.5),
  ).name = 'Kiln fire mouth';
  addMesh(
    group,
    new THREE.CylinderGeometry(0.28, 0.43, 1.2, 9),
    FIRED_CLAY,
    new THREE.Vector3(2.25, 1.88, -1.35),
  ).name = 'Kiln vent';

  const clayStock = new THREE.Group();
  clayStock.name = 'PotterClayStockpile';
  clayStock.visible = false;
  group.add(clayStock);
  const potteryStock = new THREE.Group();
  potteryStock.name = 'PotterPotteryStockpile';
  potteryStock.visible = false;
  group.add(potteryStock);
  for (let index = 0; index < 5; index++) {
    addClayLump(
      clayStock,
      'PotterClaySegment',
      new THREE.Vector3(
        -3.15 + (index % 2) * 0.55,
        0.28 + Math.floor(index / 2) * 0.18,
        1.65,
      ),
      1.05,
    );
    addPot(
      potteryStock,
      'PotterPotterySegment',
      new THREE.Vector3(
        1.55 + (index % 3) * 0.58,
        0.16 + Math.floor(index / 3) * 0.48,
        1.4,
      ),
      index >= 3 ? 0.86 : 1,
    );
  }
  addFirewoodStockpile(
    group,
    'PotterFirewoodStockpile',
    'PotterFirewoodSegment',
    ([
      [1.55, 0, -3.15, 0.05],
      [2.5, 0, -3.12, -0.07],
      [2.0, 0.34, -3.1, 0.02],
    ] as const).slice(0, POTTER_FIREWOOD_VISUAL_SEGMENTS),
  );
  return group;
}
