import * as THREE from 'three';
import { createBackyardGardenMesh } from '../../residences/backyardGardenMesh.ts';
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
import { addBarrel, addGableShell, addLeanToRoof, addPlankDoor } from './buildingMeshKit.ts';
import {
  createMonasteryPrecinctPlan,
  monasteryPlanZone,
  type MonasteryPlanRect,
  type MonasteryPrecinctPlan,
  type MonasteryWallRun,
} from './monasteryPrecinctPlan.ts';

const grass = sharedBuildingDetailMaterial('foliage');
const earth = sharedBuildingDetailMaterial('earth');
const foliage = sharedBuildingDetailMaterial('foliage');
const copper = sharedBuildingDetailMaterial('brass');

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

function addPasture(parent: THREE.Group, zone: MonasteryPlanRect, level: number): void {
  const pasture = new THREE.Group();
  pasture.name = 'Monastery protected cattle and sheep pasture';
  pasture.userData.architectureModule = zone.id;
  pasture.userData.reservedArea = zone.width * zone.depth;
  pasture.userData.canonicalLivestock = ['cattle', 'sheep'];
  pasture.userData.canonicalOutputs = ['meat', 'milk', 'cheese'];
  addMesh(
    pasture,
    new THREE.BoxGeometry(zone.width, 0.035, zone.depth),
    grass,
    new THREE.Vector3(zone.centerX, 0.035, zone.centerZ),
  ).name = 'Monastery pasture meadow surface';

  const random = mulberry32(8380 + level * 23);
  for (let index = 0; index < 26; index += 1) {
    const clump = addMesh(
      pasture,
      new THREE.SphereGeometry(0.1 + random() * 0.09, 6, 4),
      foliage,
      new THREE.Vector3(
        zone.centerX - zone.width * 0.45 + random() * zone.width * 0.9,
        0.13,
        zone.centerZ - zone.depth * 0.42 + random() * zone.depth * 0.84,
      ),
      new THREE.Euler(),
      new THREE.Vector3(0.75, 1, 0.75),
    );
    clump.name = 'Monastery pasture grass clump';
  }
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

function placeGarden(
  parent: THREE.Group,
  kind: 'apple_orchard' | 'pear_orchard' | 'vegetable_garden' | 'herb_garden' | 'flower_garden' | 'chicken_pen' | 'goat_pen' | 'backyard_apiary',
  name: string,
  zone: MonasteryPlanRect,
  seed: number,
): THREE.Group {
  const garden = createBackyardGardenMesh(kind, { width: zone.width, depth: zone.depth, seed });
  garden.name = name;
  garden.position.set(zone.centerX, 0.07, zone.centerZ);
  garden.userData.architectureModule = zone.id;
  parent.add(garden);
  return garden;
}

function placeMixedOrchard(
  parent: THREE.Group,
  zone: MonasteryPlanRect,
): THREE.Group {
  const orchard = new THREE.Group();
  orchard.name = 'Monastery mixed apple and pear orchard';
  orchard.userData.architectureModule = zone.id;
  orchard.userData.canonicalOutputs = ['apples', 'pears', 'cider'];
  const rowWidth = (zone.width - 0.6) * 0.5;
  const rowOffset = rowWidth * 0.5 + 0.15;
  const appleZone = { ...zone, centerX: -rowOffset, centerZ: 0, width: rowWidth };
  const pearZone = { ...zone, centerX: rowOffset, centerZ: 0, width: rowWidth };
  placeGarden(orchard, 'apple_orchard', 'Monastery apple orchard rows', appleZone, 8301);
  placeGarden(orchard, 'pear_orchard', 'Monastery pear orchard rows', pearZone, 8308);
  orchard.position.set(zone.centerX, 0, zone.centerZ);
  parent.add(orchard);
  return orchard;
}

function addAnimal(
  parent: THREE.Group,
  species: 'cow' | 'sheep' | 'pig',
  x: number,
  z: number,
  heading: number,
  variant: number,
): void {
  const animal = new THREE.Group();
  animal.name = species === 'cow'
    ? 'Monastery dairy cow'
    : species === 'sheep'
      ? 'Monastery pasture sheep'
      : 'Monastery pig';
  if (species === 'sheep') {
    const wool = residenceFacadeMaterial(variant % 3 === 0 ? 'yellow' : 'white');
    const dark = timberMaterial('dark');
    for (const zOffset of [-0.34, 0, 0.34]) {
      addMesh(
        animal,
        new THREE.SphereGeometry(0.48, 9, 7),
        wool,
        new THREE.Vector3(0, 0.67, zOffset),
        new THREE.Euler(),
        new THREE.Vector3(0.9, 0.92, 1.05),
      );
    }
    addMesh(animal, new THREE.SphereGeometry(0.3, 9, 6), dark, new THREE.Vector3(0, 0.72, 0.77), new THREE.Euler(), new THREE.Vector3(0.76, 0.9, 1.0));
    for (const xSign of [-1, 1] as const) {
      addMesh(animal, new THREE.ConeGeometry(0.11, 0.3, 5), dark, new THREE.Vector3(xSign * 0.28, 0.86, 0.74), new THREE.Euler(0, 0, xSign * 0.9));
    }
    for (const legX of [-0.26, 0.26]) for (const legZ of [-0.32, 0.32]) {
      addMesh(animal, new THREE.CylinderGeometry(0.055, 0.07, 0.45, 6), dark, new THREE.Vector3(legX, 0.23, legZ));
    }
    animal.userData.canonicalProducts = ['meat', 'milk', 'cheese'];
    animal.position.set(x, 0, z);
    animal.rotation.y = heading;
    parent.add(animal);
    return;
  }
  const bodyMaterial = species === 'cow'
    ? residenceFacadeMaterial(variant % 2 === 0 ? 'white' : 'orange')
    : residenceFacadeMaterial('lightOrange');
  const bodyY = species === 'cow' ? 0.88 : 0.48;
  const length = species === 'cow' ? 1.75 : 1.15;
  addMesh(animal, new THREE.SphereGeometry(0.6, 10, 7), bodyMaterial, new THREE.Vector3(0, bodyY, 0), new THREE.Euler(), new THREE.Vector3(0.82, species === 'cow' ? 1 : 0.75, length));
  addMesh(animal, new THREE.SphereGeometry(species === 'cow' ? 0.4 : 0.34, 9, 6), bodyMaterial, new THREE.Vector3(0, bodyY + 0.08, length * 0.55));
  for (const legX of [-0.34, 0.34]) for (const legZ of [-0.48, 0.48]) {
    addMesh(animal, new THREE.CylinderGeometry(0.075, 0.09, species === 'cow' ? 0.72 : 0.38, 6), bodyMaterial, new THREE.Vector3(legX, species === 'cow' ? 0.36 : 0.2, legZ));
  }
  animal.userData.canonicalProducts = species === 'cow'
    ? ['meat', 'milk', 'cheese']
    : ['meat'];
  animal.position.set(x, 0, z);
  animal.rotation.y = heading;
  parent.add(animal);
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

  addMesh(group, new THREE.BoxGeometry(66.5, 0.04, 51.5), grass, new THREE.Vector3(0, 0.01, -19)).name = 'Monastery precinct ground';
  addCirculation(group, plan);
  addPasture(group, monasteryPlanZone(plan, 'pasture'), level);
  for (const upgradeZoneId of plan.reservedUpgradeZoneIds) {
    addReservedUpgradePlot(
      group,
      monasteryPlanZone(plan, upgradeZoneId),
      monasteryHasExtension(extensions, MONASTERY_EXTENSION_WORKSHOP) ? 3 : 0,
    );
  }
  addMeadBrewhouse(group, level, monasteryPlanZone(plan, 'brewhouse'));
  addVintner(group, monasteryPlanZone(plan, 'vintner'));
  const orchard = placeMixedOrchard(group, monasteryPlanZone(plan, 'orchard'));
  orchard.traverse((object) => {
    if (object.userData.backyardMaturityAnchor !== true) return;
    const scale = orchardMaturity === 0 ? 0.35 : orchardMaturity === 1 ? 0.68 : 1;
    object.scale.multiplyScalar(scale);
  });
  placeGarden(group, 'backyard_apiary', 'Monastery bee garden', monasteryPlanZone(plan, 'apiary'), 8302);
  placeGarden(group, 'vegetable_garden', 'Monastery kitchen gardens', monasteryPlanZone(plan, 'vegetable-garden'), 8303);
  placeGarden(group, 'herb_garden', 'Monastery physic herb garden', monasteryPlanZone(plan, 'herb-garden'), 8304);
  placeGarden(group, 'flower_garden', 'Monastery pollinator garden', monasteryPlanZone(plan, 'flower-garden'), 8305);
  placeGarden(group, 'chicken_pen', 'Monastery chicken yard', monasteryPlanZone(plan, 'hen-yard'), 8306);
  placeGarden(group, 'goat_pen', 'Monastery small-stock enclosure', monasteryPlanZone(plan, 'small-stock-yard'), 8307);

  const random = mulberry32(8310 + level * 19);
  const pasture = monasteryPlanZone(plan, 'pasture');
  for (let index = 0; index < 2 + level; index += 1) {
    addAnimal(
      group,
      'cow',
      pasture.centerX - pasture.width * 0.38 + random() * pasture.width * 0.76,
      pasture.centerZ - pasture.depth * 0.34 + random() * pasture.depth * 0.68,
      random() * Math.PI * 2,
      index,
    );
  }
  for (let index = 0; index < 4 + level * 2; index += 1) {
    addAnimal(
      group,
      'sheep',
      pasture.centerX - pasture.width * 0.4 + random() * pasture.width * 0.8,
      pasture.centerZ - pasture.depth * 0.36 + random() * pasture.depth * 0.72,
      random() * Math.PI * 2,
      index,
    );
  }
  const smallStock = monasteryPlanZone(plan, 'small-stock-yard');
  for (let index = 0; index < 3 + level * 2; index += 1) {
    addAnimal(
      group,
      'pig',
      smallStock.centerX - smallStock.width * 0.36 + random() * smallStock.width * 0.72,
      smallStock.centerZ - smallStock.depth * 0.32 + random() * smallStock.depth * 0.64,
      random() * Math.PI * 2,
      index,
    );
  }
  const orchardGround = monasteryPlanZone(plan, 'orchard');
  for (let index = 0; index < 4 + level * 2; index += 1) {
    addMesh(group, new THREE.SphereGeometry(0.16, 7, 5), foliage, new THREE.Vector3(orchardGround.centerX - 4 + random() * 8, 0.18, orchardGround.centerZ + 1 + random() * 8));
  }
  addInvestmentBuildings(group, plan, extensions);
  addPerimeterPrecinct(group, plan);
  plan.diagnostics.estateMeshTriangles = countTriangles(group);
  group.userData.architectureDiagnostics = plan.diagnostics;
  return group;
}
