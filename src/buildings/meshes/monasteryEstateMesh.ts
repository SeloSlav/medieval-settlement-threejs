import * as THREE from 'three';
import { mulberry32 } from '../../utils/random.ts';
import {
  MONASTERY_EXTENSION_WORKSHOP,
  monasteryHasExtension,
  monasteryVisualEstateLevel,
} from '../monasteryEstate.ts';
import {
  addMesh,
  metalMaterial,
  residenceFacadeMaterial,
  sharedBuildingDetailMaterial,
  shingleMaterial,
  stoneMaterial,
  tileMaterial,
  timberMaterial,
} from '../buildingMaterials.ts';
import { addTriangularGableWall } from '../meshPrimitives.ts';
import {
  addBarrel,
  addGableShell,
  addHippedRoof,
  addLeanToRoof,
  addPlankDoor,
} from './buildingMeshKit.ts';
import {
  createMonasteryPrecinctPlan,
  monasteryPlanZone,
  type MonasteryPlanRect,
  type MonasteryPrecinctPlan,
  type MonasteryWallRun,
} from './monasteryPrecinctPlan.ts';

const earth = sharedBuildingDetailMaterial('earth');
const copper = sharedBuildingDetailMaterial('brass');
const wicker = sharedBuildingDetailMaterial('wicker');
const water = sharedBuildingDetailMaterial('water');

function addStoneWallRun(
  parent: THREE.Group,
  runPlan: MonasteryWallRun,
  wallHeight: number,
  thickness: number,
): void {
  const { start, end } = runPlan;
  const length = Math.hypot(end.x - start.x, end.z - start.z);
  const yaw = Math.atan2(end.x - start.x, end.z - start.z);
  const center = new THREE.Vector3((start.x + end.x) * 0.5, 0, (start.z + end.z) * 0.5);
  const run = new THREE.Group();
  run.name = runPlan.name;
  run.userData.architectureModule = runPlan.id;
  run.userData.wallConstruction = 'rubble-stone with dressed coping';

  const wall = addMesh(
    run,
    new THREE.BoxGeometry(thickness, wallHeight, length),
    stoneMaterial('mid'),
    new THREE.Vector3(center.x, wallHeight * 0.5, center.z),
    new THREE.Euler(0, yaw, 0),
  );
  wall.name = `${runPlan.name} rubble core`;
  addMesh(
    run,
    new THREE.BoxGeometry(thickness + 0.2, 0.38, length + 0.08),
    stoneMaterial('mortar'),
    new THREE.Vector3(center.x, 0.19, center.z),
    new THREE.Euler(0, yaw, 0),
  ).name = `${runPlan.name} battered plinth`;
  addMesh(
    run,
    new THREE.BoxGeometry(thickness + 0.18, 0.18, length + 0.12),
    stoneMaterial('light'),
    new THREE.Vector3(center.x, wallHeight + 0.09, center.z),
    new THREE.Euler(0, yaw, 0),
  ).name = `${runPlan.name} weathered coping`;

  const buttressIntervals = Math.max(1, Math.floor(length / 7.5));
  for (let index = 1; index < buttressIntervals; index += 1) {
    const t = index / buttressIntervals;
    addMesh(
      run,
      new THREE.BoxGeometry(thickness + 0.52, 1.7, 0.72),
      stoneMaterial(index % 2 === 0 ? 'light' : 'mid'),
      new THREE.Vector3(
        THREE.MathUtils.lerp(start.x, end.x, t),
        0.85,
        THREE.MathUtils.lerp(start.z, end.z, t),
      ),
      new THREE.Euler(0, yaw, 0),
    ).name = 'Monastery precinct wall buttress';
  }
  parent.add(run);
}

function addRoundTower(
  parent: THREE.Group,
  towerPlan: MonasteryPrecinctPlan['enclosure']['towers'][number],
): void {
  const tower = new THREE.Group();
  tower.name = towerPlan.name;
  tower.position.set(towerPlan.centerX, 0, towerPlan.centerZ);
  tower.userData.architectureModule = towerPlan.id;
  tower.userData.defensiveRole = 'modest precinct watch and refuge tower';
  addMesh(
    tower,
    new THREE.CylinderGeometry(towerPlan.radius, towerPlan.radius + 0.16, towerPlan.wallHeight, 14),
    stoneMaterial('mid'),
    new THREE.Vector3(0, towerPlan.wallHeight * 0.5, 0),
  ).name = `${towerPlan.name} rubble drum`;
  addMesh(
    tower,
    new THREE.CylinderGeometry(towerPlan.radius + 0.16, towerPlan.radius + 0.16, 0.22, 14),
    stoneMaterial('light'),
    new THREE.Vector3(0, towerPlan.wallHeight + 0.08, 0),
  ).name = `${towerPlan.name} dressed eaves`;
  addMesh(
    tower,
    new THREE.ConeGeometry(towerPlan.radius + 0.28, 1.42, 14),
    tileMaterial(towerPlan.id.includes('north') ? 1 : 2),
    new THREE.Vector3(0, towerPlan.wallHeight + 0.82, 0),
  ).name = `${towerPlan.name} conical roof`;

  const outwardX = Math.sign(towerPlan.centerX);
  const outwardZ = Math.sign(towerPlan.centerZ + 19);
  addMesh(
    tower,
    new THREE.BoxGeometry(0.16, 0.72, 0.08),
    timberMaterial('dark'),
    new THREE.Vector3(outwardX * (towerPlan.radius + 0.02), 2.55, 0),
    new THREE.Euler(0, Math.PI * 0.5, 0),
  ).name = 'Monastery tower arrow slit';
  addMesh(
    tower,
    new THREE.BoxGeometry(0.16, 0.72, 0.08),
    timberMaterial('dark'),
    new THREE.Vector3(0, 2.15, outwardZ * (towerPlan.radius + 0.02)),
  ).name = 'Monastery tower arrow slit';
  parent.add(tower);
}

function addArchedGateFacade(
  parent: THREE.Group,
  width: number,
  wallHeight: number,
  archWidth: number,
  springHeight: number,
  z: number,
  name: string,
): void {
  const halfWidth = width * 0.5;
  const radius = archWidth * 0.5;
  const pierWidth = halfWidth - radius;
  for (const side of [-1, 1] as const) {
    addMesh(
      parent,
      new THREE.BoxGeometry(pierWidth, springHeight, 0.46),
      stoneMaterial('mid'),
      new THREE.Vector3(side * (radius + pierWidth * 0.5), springHeight * 0.5, z),
    ).name = `${name} pier`;
  }

  const spandrel = new THREE.Shape();
  spandrel.moveTo(-halfWidth, springHeight);
  spandrel.lineTo(-radius, springHeight);
  for (let index = 1; index <= 16; index += 1) {
    const angle = Math.PI - Math.PI * index / 16;
    spandrel.lineTo(Math.cos(angle) * radius, springHeight + Math.sin(angle) * radius);
  }
  spandrel.lineTo(halfWidth, springHeight);
  spandrel.lineTo(halfWidth, wallHeight);
  spandrel.lineTo(-halfWidth, wallHeight);
  spandrel.closePath();
  const spandrelGeometry = new THREE.ExtrudeGeometry(spandrel, { depth: 0.46, bevelEnabled: false });
  spandrelGeometry.translate(0, 0, z - 0.23);
  addMesh(parent, spandrelGeometry, stoneMaterial('mid'), new THREE.Vector3()).name = `${name} arched spandrel`;

  addMesh(
    parent,
    new THREE.TorusGeometry(radius + 0.04, 0.19, 6, 24, Math.PI),
    stoneMaterial('light'),
    new THREE.Vector3(0, springHeight, z + 0.25),
  ).name = `${name} dressed arch ring`;
  addMesh(
    parent,
    new THREE.BoxGeometry(0.38, 0.5, 0.54),
    stoneMaterial('light'),
    new THREE.Vector3(0, springHeight + radius + 0.04, z + 0.02),
    new THREE.Euler(0, 0, Math.PI * 0.25),
  ).name = `${name} keystone`;
}

function addGatehouse(parent: THREE.Group, plan: MonasteryPrecinctPlan): void {
  const gatePlan = plan.gatehouse;
  const gatehouse = new THREE.Group();
  gatehouse.name = 'Monastery east gatehouse';
  gatehouse.position.set(gatePlan.centerX, 0, gatePlan.centerZ);
  gatehouse.userData.architectureModule = gatePlan.id;
  gatehouse.userData.accessSequence = 'road, arched gate passage, service forecourt, cloister';
  const halfWidth = gatePlan.width * 0.5;
  const halfDepth = gatePlan.depth * 0.5;
  for (const z of [-halfDepth, halfDepth]) {
    addArchedGateFacade(
      gatehouse,
      gatePlan.width,
      gatePlan.wallHeight,
      gatePlan.archWidth,
      gatePlan.archSpringHeight,
      z,
      z > 0 ? 'Monastery gatehouse outer facade' : 'Monastery gatehouse inner facade',
    );
  }
  for (const side of [-1, 1] as const) {
    addMesh(
      gatehouse,
      new THREE.BoxGeometry(0.52, gatePlan.wallHeight, gatePlan.depth),
      stoneMaterial('mid'),
      new THREE.Vector3(side * (halfWidth - 0.26), gatePlan.wallHeight * 0.5, 0),
    ).name = 'Monastery gatehouse side wall';
  }
  addMesh(
    gatehouse,
    new THREE.BoxGeometry(gatePlan.width + 0.18, 0.2, gatePlan.depth + 0.14),
    stoneMaterial('light'),
    new THREE.Vector3(0, gatePlan.wallHeight + 0.08, 0),
  ).name = 'Monastery gatehouse wall plate';

  const ridgeHeight = 2.05;
  const roofPitch = Math.atan2(ridgeHeight, halfWidth);
  const slopeLength = halfWidth / Math.cos(roofPitch) + 0.28;
  for (const side of [-1, 1] as const) {
    addMesh(
      gatehouse,
      new THREE.BoxGeometry(slopeLength, 0.16, gatePlan.depth + 0.5),
      tileMaterial(1),
      new THREE.Vector3(side * halfWidth * 0.46, gatePlan.wallHeight + ridgeHeight * 0.48, 0),
      new THREE.Euler(0, 0, side * -roofPitch),
    ).name = 'Monastery gatehouse tiled roof slope';
  }
  addMesh(
    gatehouse,
    new THREE.BoxGeometry(0.24, 0.2, gatePlan.depth + 0.64),
    tileMaterial(2),
    new THREE.Vector3(0, gatePlan.wallHeight + ridgeHeight + 0.03, 0),
  ).name = 'Monastery gatehouse roof ridge';
  for (const zSign of [-1, 1] as const) {
    addTriangularGableWall(
      gatehouse,
      'z',
      zSign * (halfDepth - 0.05),
      halfWidth,
      gatePlan.wallHeight,
      ridgeHeight,
      0.18,
      stoneMaterial('mid'),
      zSign,
    );
  }

  addPlankDoor(gatehouse, -2.55, 0.16, halfDepth + 0.27, 0.82, 1.72);
  const gate = new THREE.Group();
  gate.name = 'Monastery estate main gate';
  gate.userData.gateState = 'open inward';
  for (const side of [-1, 1] as const) {
    const leaf = new THREE.Group();
    leaf.position.set(side * 1.15, 0, -halfDepth + 0.3);
    leaf.rotation.y = side * 0.62;
    addMesh(leaf, new THREE.BoxGeometry(1.48, 1.9, 0.13), timberMaterial('dark'), new THREE.Vector3(0, 1.0, 0));
    for (const height of [0.35, 1.0, 1.64]) {
      addMesh(leaf, new THREE.BoxGeometry(1.52, 0.09, 0.16), metalMaterial('iron'), new THREE.Vector3(0, height, -0.02));
    }
    gate.add(leaf);
  }
  gatehouse.add(gate);
  parent.add(gatehouse);
}

function addPerimeterPrecinct(parent: THREE.Group, plan: MonasteryPrecinctPlan): void {
  for (const wallRun of plan.enclosure.wallRuns) {
    addStoneWallRun(parent, wallRun, plan.enclosure.wallHeight, plan.enclosure.wallThickness);
  }
  for (const tower of plan.enclosure.towers) addRoundTower(parent, tower);
  addGatehouse(parent, plan);
}

function addCirculation(parent: THREE.Group, plan: MonasteryPrecinctPlan): void {
  const circulation = new THREE.Group();
  circulation.name = 'Monastery precinct circulation';
  for (const run of plan.circulation) {
    const path = addMesh(
      circulation,
      new THREE.BoxGeometry(run.width, 0.055, run.depth),
      earth,
      new THREE.Vector3(run.centerX, 0.052, run.centerZ),
    );
    path.name = `Monastery ${run.id}`;
    path.userData.architectureModule = run.id;
  }
  parent.add(circulation);
}

function addPasture(parent: THREE.Group, zone: MonasteryPlanRect): void {
  const pasture = new THREE.Group();
  pasture.name = 'Monastery protected cattle and sheep pasture';
  pasture.userData.architectureModule = zone.id;
  pasture.userData.reservedArea = zone.width * zone.depth;
  pasture.userData.canonicalLivestock = ['cattle', 'sheep'];
  pasture.userData.canonicalOutputs = ['meat', 'milk', 'cheese'];
  pasture.userData.seedThreeVegetation = {
    owner: 'SeedThree',
    kind: 'pasture-grass',
    footprint: { width: zone.width, depth: zone.depth },
    embeddedGeometry: false,
  };
  addMesh(
    pasture,
    new THREE.BoxGeometry(zone.width, 0.035, zone.depth),
    earth,
    new THREE.Vector3(zone.centerX, 0.035, zone.centerZ),
  ).name = 'Monastery pasture meadow surface';
  const troughX = zone.centerX - zone.width * 0.32;
  const troughZ = zone.centerZ + zone.depth * 0.3;
  addMesh(pasture, new THREE.BoxGeometry(3.4, 0.45, 0.9), timberMaterial('weathered'), new THREE.Vector3(troughX, 0.34, troughZ)).name = 'Monastery pasture water trough';
  addMesh(pasture, new THREE.BoxGeometry(3.0, 0.16, 0.56), metalMaterial('iron'), new THREE.Vector3(troughX, 0.55, troughZ)).name = 'Monastery pasture trough lining';
  parent.add(pasture);
}

function addReservedUpgradePlot(
  parent: THREE.Group,
  zone: MonasteryPlanRect,
  level: number,
): void {
  const plot = new THREE.Group();
  plot.name = zone.id === 'dairy-upgrade'
    ? 'Monastery reserved dairy upgrade plot'
    : 'Monastery reserved fruit press upgrade plot';
  plot.userData.architectureModule = zone.id;
  plot.userData.activeFromLevel = zone.activeFromLevel;
  plot.userData.currentlyBuilt = level >= zone.activeFromLevel;
  addMesh(
    plot,
    new THREE.BoxGeometry(zone.width - 0.35, 0.035, zone.depth - 0.35),
    earth,
    new THREE.Vector3(zone.centerX, 0.04, zone.centerZ),
  ).name = `${plot.name} prepared ground`;
  for (const xSign of [-1, 1] as const) for (const zSign of [-1, 1] as const) {
    addMesh(
      plot,
      new THREE.BoxGeometry(0.34, 0.22, 0.34),
      stoneMaterial('light'),
      new THREE.Vector3(
        zone.centerX + xSign * (zone.width * 0.5 - 0.28),
        0.11,
        zone.centerZ + zSign * (zone.depth * 0.5 - 0.28),
      ),
    ).name = 'Monastery reserved plot boundary stone';
  }
  parent.add(plot);
}

type MonasteryPlantingKind =
  | 'apple_orchard'
  | 'pear_orchard'
  | 'vegetable_garden'
  | 'herb_garden'
  | 'flower_garden'
  | 'backyard_apiary'
  | 'chicken_pen'
  | 'goat_pen';

function createSeedThreeZone(
  name: string,
  kind: MonasteryPlantingKind,
  zone: MonasteryPlanRect,
  seed: number,
): THREE.Group {
  const planting = new THREE.Group();
  planting.name = name;
  planting.position.set(zone.centerX, 0.07, zone.centerZ);
  planting.userData.architectureModule = zone.id;
  planting.userData.gardenKind = kind;
  planting.userData.footprint = { width: zone.width, depth: zone.depth };
  planting.userData.usesSeedThree = true;
  planting.userData.seedThreeVegetation = {
    owner: 'SeedThree',
    kind,
    seed,
    embeddedGeometry: false,
  };
  return planting;
}

function addPreparedBed(
  parent: THREE.Group,
  x: number,
  z: number,
  width: number,
  depth: number,
  name: string,
): void {
  const bed = addMesh(
    parent,
    new THREE.BoxGeometry(width, 0.045, depth),
    earth,
    new THREE.Vector3(x, 0.023, z),
  );
  bed.name = name;
  bed.userData.seedThreePlantingSurface = true;
}

function addEmptyHarvestBasket(parent: THREE.Group, x: number, z: number, name: string): void {
  const basket = new THREE.Group();
  basket.name = name;
  basket.position.set(x, 0, z);
  addMesh(
    basket,
    new THREE.CylinderGeometry(0.3, 0.23, 0.32, 10, 1, true),
    wicker,
    new THREE.Vector3(0, 0.17, 0),
  ).name = `${name} body`;
  addMesh(
    basket,
    new THREE.TorusGeometry(0.27, 0.035, 5, 12),
    timberMaterial('dark'),
    new THREE.Vector3(0, 0.45, 0),
    new THREE.Euler(Math.PI * 0.5, 0, 0),
  ).name = `${name} handle`;
  parent.add(basket);
}

function addOrchardRowAnchors(
  row: THREE.Group,
  kind: 'apple' | 'pear',
  width: number,
  depth: number,
  seed: number,
  maturity: number,
): void {
  row.userData.orchardGrid = { columns: 2, rows: 2 };
  row.userData.monasteryOrchardMaturity = maturity;
  row.userData.seedThreeVegetation = {
    owner: 'SeedThree',
    kind,
    seed,
    maturity,
    embeddedGeometry: false,
  };
  for (let rowIndex = 0; rowIndex < 2; rowIndex += 1) {
    for (let column = 0; column < 2; column += 1) {
      const anchor = new THREE.Group();
      anchor.name = `SeedThree ${kind} orchard anchor ${rowIndex * 2 + column + 1}`;
      anchor.position.set(
        ((column + 0.5) / 2 - 0.5) * width,
        0,
        ((rowIndex + 0.5) / 2 - 0.5) * depth,
      );
      anchor.rotation.y = mulberry32(seed + rowIndex * 101 + column * 997)() * Math.PI * 2;
      anchor.userData.backyardMaturityAnchor = true;
      anchor.userData.backyardMaturityProgress = maturity / 2;
      anchor.userData.seedThreePlantKind = kind;
      anchor.userData.embeddedVegetationGeometry = false;
      row.add(anchor);
    }
  }
}

function placeMixedOrchard(
  parent: THREE.Group,
  zone: MonasteryPlanRect,
  maturity: number,
): THREE.Group {
  const orchard = new THREE.Group();
  orchard.name = 'Monastery mixed apple and pear orchard';
  orchard.userData.architectureModule = zone.id;
  orchard.userData.canonicalOutputs = ['apples', 'pears', 'cider'];
  orchard.userData.monasteryOrchardMaturity = maturity;
  orchard.userData.seedThreeVegetation = {
    owner: 'SeedThree',
    kind: 'mixed-apple-pear-orchard',
    maturity,
    embeddedGeometry: false,
  };
  const rowWidth = (zone.width - 0.6) * 0.5;
  const rowOffset = rowWidth * 0.5 + 0.15;
  const appleRows = new THREE.Group();
  appleRows.name = 'Monastery apple orchard rows';
  appleRows.position.x = -rowOffset;
  appleRows.userData.gardenKind = 'apple_orchard';
  appleRows.userData.footprint = { width: rowWidth, depth: zone.depth };
  appleRows.userData.usesSeedThree = true;
  addOrchardRowAnchors(appleRows, 'apple', rowWidth, zone.depth, 8301, maturity);
  addEmptyHarvestBasket(appleRows, rowWidth * 0.34, -zone.depth * 0.34, 'Monastery apple harvest basket');
  orchard.add(appleRows);

  const pearRows = new THREE.Group();
  pearRows.name = 'Monastery pear orchard rows';
  pearRows.position.x = rowOffset;
  pearRows.userData.gardenKind = 'pear_orchard';
  pearRows.userData.footprint = { width: rowWidth, depth: zone.depth };
  pearRows.userData.usesSeedThree = true;
  addOrchardRowAnchors(pearRows, 'pear', rowWidth, zone.depth, 8308, maturity);
  addEmptyHarvestBasket(pearRows, rowWidth * 0.34, -zone.depth * 0.34, 'Monastery pear harvest basket');
  orchard.add(pearRows);

  orchard.position.set(zone.centerX, 0, zone.centerZ);
  parent.add(orchard);
  return orchard;
}

function addHerbDryingRack(parent: THREE.Group, x: number, z: number, index: number): void {
  const rack = new THREE.Group();
  rack.name = `Monastery herb drying rack ${index}`;
  rack.position.set(x, 0, z);
  rack.rotation.y = Math.PI * 0.5;
  for (const dx of [-0.55, 0.55]) {
    addMesh(
      rack,
      new THREE.CylinderGeometry(0.035, 0.05, 1.2, 6),
      timberMaterial('dark'),
      new THREE.Vector3(dx, 0.6, 0),
    ).name = 'Monastery herb drying rack post';
  }
  addMesh(
    rack,
    new THREE.CylinderGeometry(0.035, 0.035, 1.25, 6),
    timberMaterial('dark'),
    new THREE.Vector3(0, 1.16, 0),
    new THREE.Euler(0, 0, Math.PI * 0.5),
  ).name = 'Monastery herb drying rack crossbar';
  parent.add(rack);
}

function addApiaryInfrastructure(parent: THREE.Group, width: number, depth: number): void {
  addMesh(
    parent,
    new THREE.BoxGeometry(width * 0.78, 0.16, 0.62),
    timberMaterial('dark'),
    new THREE.Vector3(0, 0.34, -depth * 0.05),
  ).name = 'Monastery apiary bench';
  for (let index = 0; index < 3; index += 1) {
    const x = (index - 1) * Math.min(1.35, width * 0.23);
    addMesh(
      parent,
      new THREE.CylinderGeometry(0.34, 0.45, 0.72, 12),
      wicker,
      new THREE.Vector3(x, 0.78, -depth * 0.05),
    ).name = 'Monastery bee skep';
    addMesh(
      parent,
      new THREE.SphereGeometry(0.34, 12, 7, 0, Math.PI * 2, 0, Math.PI * 0.52),
      wicker,
      new THREE.Vector3(x, 1.12, -depth * 0.05),
    ).name = 'Monastery bee skep cap';
    addMesh(
      parent,
      new THREE.CircleGeometry(0.075, 10),
      timberMaterial('dark'),
      new THREE.Vector3(x, 0.72, -depth * 0.405),
    ).name = 'Monastery bee skep entrance';
  }
}

function addAnimalYardInfrastructure(
  parent: THREE.Group,
  width: number,
  depth: number,
  _seed: number,
  species: 'chickens' | 'goats',
): void {
  const shelter = new THREE.Group();
  shelter.name = species === 'chickens'
    ? 'Monastery chicken yard weather shelter'
    : 'Monastery goat yard weather shelter';
  const shelterWidth = Math.min(species === 'chickens' ? 2.25 : 2.7, width * 0.44);
  const shelterDepth = Math.min(1.9, depth * 0.36);
  const wallHeight = species === 'chickens' ? 1.05 : 1.25;
  const shelterX = -width * 0.24;
  const shelterZ = -depth * 0.25;
  addMesh(
    shelter,
    new THREE.BoxGeometry(shelterWidth, wallHeight, 0.12),
    timberMaterial('mid'),
    new THREE.Vector3(shelterX, wallHeight * 0.5, shelterZ - shelterDepth * 0.5),
  ).name = 'Monastery animal shelter rear wall';
  for (const x of [shelterX - shelterWidth * 0.5, shelterX + shelterWidth * 0.5]) {
    addMesh(
      shelter,
      new THREE.BoxGeometry(0.12, wallHeight, shelterDepth),
      timberMaterial('mid'),
      new THREE.Vector3(x, wallHeight * 0.5, shelterZ),
    ).name = 'Monastery animal shelter side wall';
  }
  addHippedRoof(shelter, {
    width: shelterWidth + 0.4,
    depth: shelterDepth + 0.4,
    eaveY: wallHeight + 0.02,
    peakY: wallHeight + 0.74,
    thickness: 0.08,
    material: shingleMaterial(),
    centerX: shelterX,
    centerZ: shelterZ,
    name: 'Monastery animal shelter joined hipped roof',
  });
  addPreparedBed(
    shelter,
    shelterX,
    shelterZ,
    shelterWidth * 0.88,
    shelterDepth * 0.82,
    'Monastery animal shelter bedding floor',
  );
  parent.add(shelter);

  const troughX = width * 0.2;
  const troughZ = -depth * 0.19;
  addMesh(
    parent,
    new THREE.BoxGeometry(1.35, 0.22, 0.46),
    timberMaterial('dark'),
    new THREE.Vector3(troughX, 0.23, troughZ),
  ).name = 'Monastery animal trough';
  addMesh(
    parent,
    new THREE.BoxGeometry(1.12, 0.06, 0.28),
    water,
    new THREE.Vector3(troughX, 0.36, troughZ),
  ).name = 'Monastery animal trough water';

  if (species === 'chickens') {
    addMesh(
      parent,
      new THREE.BoxGeometry(shelterWidth * 0.72, 0.58, 0.18),
      timberMaterial('dark'),
      new THREE.Vector3(shelterX, 0.46, shelterZ + shelterDepth * 0.44),
    ).name = 'Monastery chicken nesting boxes';
    return;
  }

  addMesh(
    parent,
    new THREE.BoxGeometry(1.05, 0.12, 0.62),
    wicker,
    new THREE.Vector3(width * 0.22, 0.18, depth * 0.18),
  ).name = 'Monastery goat milking stand';
}

function placeGardenInfrastructure(
  parent: THREE.Group,
  kind: Exclude<MonasteryPlantingKind, 'apple_orchard' | 'pear_orchard'>,
  name: string,
  zone: MonasteryPlanRect,
  seed: number,
): THREE.Group {
  const garden = createSeedThreeZone(name, kind, zone, seed);
  if (kind === 'vegetable_garden') {
    const gap = 0.3;
    const bedWidth = (zone.width - gap * 4) / 3;
    for (let bed = 0; bed < 3; bed += 1) {
      addPreparedBed(
        garden,
        -zone.width * 0.5 + gap + bedWidth * 0.5 + bed * (bedWidth + gap),
        0,
        bedWidth,
        Math.max(1.15, zone.depth - 0.62),
        'Monastery kitchen garden prepared soil bed',
      );
    }
    addMesh(
      garden,
      new THREE.CylinderGeometry(0.035, 0.045, 0.82, 6),
      timberMaterial('dark'),
      new THREE.Vector3(zone.width * 0.38, 0.41, zone.depth * 0.38),
    ).name = 'Monastery kitchen garden marker stake';
    addMesh(
      garden,
      new THREE.BoxGeometry(0.62, 0.28, 0.055),
      timberMaterial('mid'),
      new THREE.Vector3(zone.width * 0.38, 0.72, zone.depth * 0.38),
      new THREE.Euler(0, -0.12, 0),
    ).name = 'Monastery kitchen garden marker';
  } else if (kind === 'herb_garden') {
    const rackAisleWidth = Math.min(1.15, Math.max(0.9, zone.width * 0.16));
    const bedAreaWidth = zone.width - rackAisleWidth;
    const plotWidth = (bedAreaWidth - 0.75) * 0.5;
    for (const side of [-1, 1] as const) {
      addPreparedBed(
        garden,
        -rackAisleWidth * 0.5 + side * (plotWidth * 0.5 + 0.18),
        0,
        plotWidth,
        Math.max(1.1, zone.depth - 0.65),
        'Monastery physic garden prepared soil bed',
      );
    }
    const rackX = zone.width * 0.5 - rackAisleWidth * 0.5;
    addHerbDryingRack(garden, rackX, -zone.depth * 0.17, 1);
    addHerbDryingRack(garden, rackX, zone.depth * 0.17, 2);
  } else if (kind === 'flower_garden') {
    const sideWidth = Math.max(1.25, zone.width * 0.34);
    addPreparedBed(garden, -zone.width * 0.29, 0, sideWidth, zone.depth * 0.82, 'Monastery pollinator garden prepared soil bed');
    addPreparedBed(garden, zone.width * 0.29, 0, sideWidth, zone.depth * 0.82, 'Monastery pollinator garden prepared soil bed');
  } else if (kind === 'backyard_apiary') {
    addApiaryInfrastructure(garden, zone.width, zone.depth);
  } else if (kind === 'chicken_pen') {
    addAnimalYardInfrastructure(garden, zone.width, zone.depth, seed, 'chickens');
  } else {
    addAnimalYardInfrastructure(garden, zone.width, zone.depth, seed, 'goats');
  }
  parent.add(garden);
  return garden;
}

function addMeadBrewhouse(parent: THREE.Group, level: number, zone: MonasteryPlanRect): void {
  const yard = new THREE.Group();
  yard.name = 'Monastery mead brewhouse and honey cellar';
  yard.position.set(zone.centerX, 0, zone.centerZ);
  yard.userData.architectureModule = zone.id;
  yard.userData.canonicalOutput = 'monastic mead from the estate apiary';
  const shell = addGableShell(yard, {
    width: zone.width,
    depth: zone.depth,
    stoneHeight: 1.0,
    wallHeight: 2.75,
    ridgeHeight: 2.15,
    wallMaterial: residenceFacadeMaterial('white'),
    roofMaterial: shingleMaterial(),
  });
  addPlankDoor(yard, 0, 1.05, shell.frontZ + 0.03, 1.2, 1.95);
  addLeanToRoof(yard, {
    width: 4.4,
    depth: 3.0,
    thickness: 0.14,
    material: shingleMaterial(),
    position: new THREE.Vector3(5.0, 2.35, 0.2),
    pitch: 0.12,
    highEdge: 'negativeX',
    name: 'Monastery open mead brewing bay',
  });
  addMesh(yard, new THREE.SphereGeometry(0.82, 12, 8), copper, new THREE.Vector3(5.0, 0.95, 0.2), new THREE.Euler(), new THREE.Vector3(1, 1.1, 1));
  addMesh(yard, new THREE.CylinderGeometry(0.14, 0.14, 1.55, 8), copper, new THREE.Vector3(5.0, 1.95, 0.2));
  const ciderPress = new THREE.Group();
  ciderPress.name = 'Monastery orchard cider press and cellar bay';
  ciderPress.position.set(-5.0, 0, 0.2);
  ciderPress.userData.physicalProduction = 'mixed apple and pear orchard fruit to house cider';
  addLeanToRoof(ciderPress, {
    width: 3.8,
    depth: 3.0,
    thickness: 0.14,
    material: shingleMaterial(),
    position: new THREE.Vector3(0, 2.2, 0),
    pitch: 0.12,
    highEdge: 'positiveX',
    name: 'Monastery open orchard pressing bay',
  });
  for (const postX of [-1.55, 1.55]) for (const postZ of [-1.15, 1.15]) {
    addMesh(ciderPress, new THREE.BoxGeometry(0.16, 2.15, 0.16), timberMaterial('dark'), new THREE.Vector3(postX, 1.08, postZ));
  }
  addMesh(ciderPress, new THREE.CylinderGeometry(0.72, 0.72, 0.34, 12), timberMaterial('weathered'), new THREE.Vector3(0, 0.27, 0));
  addMesh(ciderPress, new THREE.CylinderGeometry(0.12, 0.12, 1.7, 8), timberMaterial('dark'), new THREE.Vector3(0, 1.28, 0));
  addMesh(ciderPress, new THREE.BoxGeometry(2.25, 0.18, 0.22), timberMaterial('weathered'), new THREE.Vector3(0.38, 2.02, 0), new THREE.Euler(0, 0, -0.12));
  addBarrel(ciderPress, -1.15, 0.72, 0.72);
  yard.add(ciderPress);
  for (let index = 0; index < 3 + level * 2; index += 1) {
    addBarrel(yard, -3.2 + (index % 4) * 1.05, 4.0 + Math.floor(index / 4) * 1.0, 0.92);
  }
  parent.add(yard);
}

function addVintner(parent: THREE.Group, zone: MonasteryPlanRect): void {
  const vintner = new THREE.Group();
  vintner.name = 'Monastery vintner and wine cellar';
  vintner.position.set(zone.centerX, 0, zone.centerZ);
  vintner.userData.architectureModule = zone.id;
  vintner.userData.physicalProduction = 'vineyard grapes to wine';
  const shell = addGableShell(vintner, {
    width: zone.width,
    depth: zone.depth,
    stoneHeight: 1.0,
    wallHeight: 2.5,
    ridgeHeight: 1.9,
    wallMaterial: residenceFacadeMaterial('white'),
    roofMaterial: shingleMaterial(),
  });
  addPlankDoor(vintner, 0, 1.0, shell.frontZ + 0.03, 1.0, 1.8);
  const press = new THREE.Group();
  press.name = 'Monastery vintner screw press';
  press.position.set(1.45, 0, shell.frontZ + 0.9);
  addMesh(press, new THREE.CylinderGeometry(0.92, 0.92, 0.42, 12), timberMaterial('weathered'), new THREE.Vector3(0, 0.32, 0));
  addMesh(press, new THREE.CylinderGeometry(0.15, 0.15, 2.15, 8), timberMaterial('dark'), new THREE.Vector3(0, 1.45, 0));
  addMesh(press, new THREE.BoxGeometry(2.7, 0.2, 0.26), timberMaterial('weathered'), new THREE.Vector3(0.45, 2.35, 0), new THREE.Euler(0, 0, -0.12));
  addMesh(press, new THREE.CylinderGeometry(0.36, 0.44, 0.62, 10), metalMaterial('iron'), new THREE.Vector3(0, 0.8, 0));
  vintner.add(press);
  for (let index = 0; index < 3; index += 1) {
    addBarrel(vintner, -1.45 + index * 1.0, shell.frontZ + 0.9, 0.84);
  }
  parent.add(vintner);
}

function addAgriculturalArchive(parent: THREE.Group, level: number, zone: MonasteryPlanRect): void {
  const archive = new THREE.Group();
  archive.name = 'Monastery agricultural archive and seed vault';
  archive.userData.architectureModule = zone.id;
  archive.userData.seedCrops = ['rye', 'oats', 'maslin'];
  archive.position.set(zone.centerX, 0, zone.centerZ);
  const shell = addGableShell(archive, {
    width: zone.width,
    depth: zone.depth,
    stoneHeight: 1.55,
    wallHeight: 3.15,
    ridgeHeight: 2.4,
    wallMaterial: residenceFacadeMaterial('white'),
    roofMaterial: shingleMaterial(),
  });
  addPlankDoor(archive, 0, 1.58, shell.frontZ + 0.03, 1.3, 2.05);
  for (const x of [-3.25, -2.05, 2.05, 3.25]) {
    const vent = addMesh(
      archive,
      new THREE.BoxGeometry(0.52, 0.16, 0.12),
      timberMaterial('dark'),
      new THREE.Vector3(x, 2.75, shell.frontZ + 0.04),
    );
    vent.name = 'Agricultural archive drying vent';
  }
  for (const [index, cropName] of ['Rye', 'Oat', 'Maslin'].entries()) {
    const chest = new THREE.Group();
    chest.name = `${cropName} emergency seed chest`;
    chest.position.set(-2.1 + index * 2.1, 0, shell.frontZ + 1.15);
    addMesh(chest, new THREE.BoxGeometry(1.45, 0.82, 0.92), timberMaterial('weathered'), new THREE.Vector3(0, 0.42, 0));
    addMesh(chest, new THREE.BoxGeometry(1.5, 0.09, 0.97), metalMaterial('iron'), new THREE.Vector3(0, 0.78, 0));
    archive.add(chest);
  }
  for (let index = 0; index < level; index += 1) {
    addMesh(
      archive,
      new THREE.BoxGeometry(0.26, 1.45, 0.26),
      stoneMaterial('light'),
      new THREE.Vector3(-4.3 + index * 4.3, 0.73, -2.82),
    ).name = 'Agricultural archive expanded buttress';
  }
  parent.add(archive);
}

function addInvestmentBuildings(
  parent: THREE.Group,
  plan: MonasteryPrecinctPlan,
  extensions: number,
): void {
  const { level } = plan;
  addAgriculturalArchive(parent, level, monasteryPlanZone(plan, 'agricultural-archive'));
  if (!monasteryHasExtension(extensions, MONASTERY_EXTENSION_WORKSHOP)) return;
  const dairyZone = monasteryPlanZone(plan, 'dairy-upgrade');
  {
    const dairy = new THREE.Group();
    dairy.name = 'Monastery estate workshop and root cellar';
    dairy.position.set(dairyZone.centerX, 0, dairyZone.centerZ);
    dairy.userData.architectureModule = dairyZone.id;
    const shell = addGableShell(dairy, {
      width: 6.8,
      depth: 4.8,
      stoneHeight: 0.9,
      wallHeight: 2.35,
      ridgeHeight: 1.75,
      wallMaterial: residenceFacadeMaterial('white'),
      roofMaterial: shingleMaterial(),
    });
    addPlankDoor(dairy, 0, 0.95, shell.frontZ + 0.03, 1.0, 1.75);
    addMesh(dairy, new THREE.BoxGeometry(2.8, 0.18, 0.86), timberMaterial('weathered'), new THREE.Vector3(1.3, 0.92, shell.frontZ + 0.7)).name = 'Monastery estate workshop bench';
    parent.add(dairy);
  }
}

function countTriangles(root: THREE.Object3D): number {
  let triangles = 0;
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const index = object.geometry.getIndex();
    const positions = object.geometry.getAttribute('position');
    triangles += index ? index.count / 3 : (positions?.count ?? 0) / 3;
  });
  return Math.round(triangles);
}

export function createMonasteryEstateMesh(
  rawExtensions: number,
  rawOrchardPlanting = 0,
  rawCroftPlanting = 0,
  rawOrchardMaturity = 2,
): THREE.Group {
  const extensions = Math.max(0, Math.floor(rawExtensions));
  const level = monasteryVisualEstateLevel(extensions);
  void rawOrchardPlanting;
  void rawCroftPlanting;
  const orchardPlanting = 0 as const;
  const croftPlanting = 0 as const;
  const orchardMaturity = Math.max(0, Math.min(2, Math.floor(rawOrchardMaturity)));
  const plan = createMonasteryPrecinctPlan(level);
  const group = new THREE.Group();
  group.name = `Monastery enclosed estate level ${level}`;
  group.userData.monasteryEstateLevel = level;
  group.userData.monasteryOrchardPlanting = orchardPlanting;
  group.userData.monasteryCroftPlanting = croftPlanting;
  group.userData.monasteryExtensions = extensions;
  group.userData.monasteryOrchardMaturity = orchardMaturity;
  group.userData.reservedLand = { width: 68, depth: 53 };
  group.userData.architecturePlan = plan;

  addMesh(group, new THREE.BoxGeometry(66.5, 0.04, 51.5), earth, new THREE.Vector3(0, 0.01, -19)).name = 'Monastery precinct ground';
  addCirculation(group, plan);
  addPasture(group, monasteryPlanZone(plan, 'pasture'));
  for (const upgradeZoneId of plan.reservedUpgradeZoneIds) {
    addReservedUpgradePlot(
      group,
      monasteryPlanZone(plan, upgradeZoneId),
      monasteryHasExtension(extensions, MONASTERY_EXTENSION_WORKSHOP) ? 3 : 0,
    );
  }
  addMeadBrewhouse(group, level, monasteryPlanZone(plan, 'brewhouse'));
  addVintner(group, monasteryPlanZone(plan, 'vintner'));
  placeMixedOrchard(group, monasteryPlanZone(plan, 'orchard'), orchardMaturity);
  placeGardenInfrastructure(group, 'backyard_apiary', 'Monastery bee garden', monasteryPlanZone(plan, 'apiary'), 8302);
  placeGardenInfrastructure(group, 'vegetable_garden', 'Monastery kitchen gardens', monasteryPlanZone(plan, 'vegetable-garden'), 8303);
  placeGardenInfrastructure(group, 'herb_garden', 'Monastery physic herb garden', monasteryPlanZone(plan, 'herb-garden'), 8304);
  placeGardenInfrastructure(group, 'flower_garden', 'Monastery pollinator garden', monasteryPlanZone(plan, 'flower-garden'), 8305);
  placeGardenInfrastructure(group, 'chicken_pen', 'Monastery chicken yard', monasteryPlanZone(plan, 'hen-yard'), 8306);
  placeGardenInfrastructure(group, 'goat_pen', 'Monastery small-stock enclosure', monasteryPlanZone(plan, 'small-stock-yard'), 8307);

  // Living livestock is rendered exclusively from authoritative livestock
  // agents. Never bake primitive representative animals into the building:
  // they duplicate population and become an unavoidable visual proxy tier.
  addInvestmentBuildings(group, plan, extensions);
  addPerimeterPrecinct(group, plan);
  plan.diagnostics.estateMeshTriangles = countTriangles(group);
  group.userData.architectureDiagnostics = plan.diagnostics;
  return group;
}
