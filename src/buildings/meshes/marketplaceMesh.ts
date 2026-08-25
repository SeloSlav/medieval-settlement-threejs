import * as THREE from 'three';
import {
  MARKETPLACE_FOOD_STALL_SLOTS,
  MARKETPLACE_GOODS_STALL_SLOTS,
  STOREHOUSE_HAUL_PER_WORKER,
} from '../../generated/gameBalance.ts';
import {
  addMesh,
  metalMaterial,
  residenceFacadeMaterial,
  sharedBuildingDetailMaterial,
  sharedBuildingMaterial,
  shingleMaterial,
  stoneMaterial,
  timberMaterial,
} from '../buildingMaterials.ts';
import {
  MARKET_ALE_VISUAL_SEGMENTS,
  MARKET_CLOTH_VISUAL_SEGMENTS,
  MARKET_HONEY_VISUAL_SEGMENTS,
  MARKET_IRON_VISUAL_SEGMENTS,
  MARKET_POTTERY_VISUAL_SEGMENTS,
  MARKET_SALT_VISUAL_SEGMENTS,
  MARKET_WINE_VISUAL_SEGMENTS,
} from '../marketplaceSpecialtyStockpileVisuals.ts';
import { addTriangularGableWall } from '../meshPrimitives.ts';
import { addBarrel, addCrate } from './buildingMeshKit.ts';
import {
  MARKETPLACE_STALL_DISPLAY_KINDS,
  MARKETPLACE_STALL_WORKER_ANCHOR_NAME,
  marketStallDisplayName,
  marketplaceStallLayout,
} from '../marketplaceStallLayout.ts';
import type {
  MarketStallDisplayKind,
  MarketStallGroup,
} from '../../economy/marketStallAssignments.ts';

export const MARKET_STAGING_VISUAL_SEGMENTS = 5;
export const MARKET_RECEIPT_VISUAL_SEGMENTS = 3;
export const MARKET_RECEIPT_VISUAL_CAPACITY =
  STOREHOUSE_HAUL_PER_WORKER * MARKET_RECEIPT_VISUAL_SEGMENTS;

function addMarketTable(
  group: THREE.Group,
  name: string,
  stallGroup: MarketStallGroup,
  slotIndex: number,
): void {
  const layout = marketplaceStallLayout(stallGroup, slotIndex);
  if (!layout) return;
  const table = new THREE.Group();
  table.name = name;
  table.visible = false;
  table.position.set(layout.x, 0, layout.z);
  table.rotation.y = layout.rotation;
  addMesh(
    table,
    new THREE.BoxGeometry(layout.tableWidth, 0.16, 0.86),
    timberMaterial('light'),
    new THREE.Vector3(0, 0.98, 0),
  );
  for (const px of [-layout.legX, layout.legX]) {
    for (const pz of [-0.27, 0.27]) {
      addMesh(
        table,
        new THREE.BoxGeometry(0.13, 0.9, 0.13),
        timberMaterial('dark'),
        new THREE.Vector3(px, 0.48, pz),
      );
    }
  }
  const workerAnchor = new THREE.Object3D();
  workerAnchor.name = MARKETPLACE_STALL_WORKER_ANCHOR_NAME;
  workerAnchor.position.set(0, 0.02, -0.86);
  workerAnchor.userData.marketStallWorkerAnchor = true;
  table.add(workerAnchor);
  for (const displayKind of MARKETPLACE_STALL_DISPLAY_KINDS[stallGroup]) {
    addMarketStallDisplay(table, displayKind);
  }
  group.add(table);
}

function addMarketStallDisplay(
  table: THREE.Group,
  displayKind: MarketStallDisplayKind,
): void {
  const display = new THREE.Group();
  display.name = marketStallDisplayName(displayKind);
  display.visible = false;
  display.position.y = 1.07;
  display.userData.marketDisplayKind = displayKind;

  switch (displayKind) {
    case 'provisions': addProduceCrate(display); break;
    case 'bread': addBreadCounter(display); break;
    case 'meat': addMeatCounter(display, false); break;
    case 'fish': addFishCounter(display, false); break;
    case 'foraged': addForagedCounter(display); break;
    case 'milk': addMilkCounter(display); break;
    case 'fruit': addFruitCounter(display); break;
    case 'vegetables': addVegetableCounter(display); break;
    case 'eggs': addEggCounter(display); break;
    case 'honey': addHoneyCounter(display); break;
    case 'wine': addWineCounter(display); break;
    case 'preserves': addPreserveCounter(display); break;
    case 'curedMeat': addMeatCounter(display, true); break;
    case 'smokedFish': addFishCounter(display, true); break;
    case 'cheese': addCheeseCounter(display); break;
    case 'firewood': addFirewoodCounter(display); break;
    case 'charcoal': addCharcoalCounter(display); break;
    case 'cloth': addClothCounter(display); break;
    case 'shoes': addShoesCounter(display); break;
    case 'pottery': addPotteryCounter(display); break;
    case 'candles': addCandleCounter(display); break;
  }
  table.add(display);
}

function addProduceCrate(display: THREE.Group): void {
  const crate = new THREE.Group();
  crate.position.set(-0.32, 0, 0);
  addCrate(crate, 0, 0, 0.48);
  display.add(crate);
  const produceColors = ['orange', 'yellow', 'lightOrange'] as const;
  for (let index = 0; index < 5; index += 1) {
    addMesh(
      display,
      new THREE.SphereGeometry(0.1, 7, 5),
      residenceFacadeMaterial(produceColors[index % produceColors.length]),
      new THREE.Vector3(-0.54 + index * 0.12, 0.34 + (index % 2) * 0.06, -0.04),
    );
  }
}

function addBreadCounter(display: THREE.Group): void {
  for (const [index, x] of [-0.42, 0, 0.42].entries()) {
    const loaf = addMesh(
      display,
      new THREE.SphereGeometry(0.18, 9, 6),
      residenceFacadeMaterial(index === 1 ? 'yellow' : 'lightOrange'),
      new THREE.Vector3(x, 0.17 + (index % 2) * 0.04, 0),
      new THREE.Euler(0, index === 1 ? -0.18 : 0.16, 0),
      new THREE.Vector3(1.45, 0.72, 0.82),
    );
    loaf.userData.marketProp = 'bread-loaf';
  }
}

function addMeatCounter(display: THREE.Group, cured: boolean): void {
  const meatMaterial = sharedBuildingDetailMaterial('paintRed');
  addMesh(
    display,
    new THREE.BoxGeometry(0.92, 0.06, 0.54),
    timberMaterial('light'),
    new THREE.Vector3(0, 0.03, 0),
  );
  const pieces = cured ? [-0.45, -0.15, 0.15, 0.45] : [-0.3, 0.3];
  for (const [index, x] of pieces.entries()) {
    addMesh(
      display,
      cured
        ? new THREE.CylinderGeometry(0.08, 0.08, 0.48, 8)
        : new THREE.SphereGeometry(0.18, 8, 6),
      meatMaterial,
      new THREE.Vector3(x, cured ? 0.13 : 0.18, 0),
      cured
        ? new THREE.Euler(0, 0, Math.PI * 0.5)
        : new THREE.Euler(0, index === 0 ? -0.2 : 0.2, 0),
      cured ? undefined : new THREE.Vector3(1.3, 0.62, 0.9),
    );
  }
  if (!cured) {
    addMesh(
      display,
      new THREE.CylinderGeometry(0.035, 0.035, 0.7, 7),
      residenceFacadeMaterial('white'),
      new THREE.Vector3(0, 0.23, 0),
      new THREE.Euler(0, 0, Math.PI * 0.5),
    );
  }
}

function addFishCounter(display: THREE.Group, smoked: boolean): void {
  const fishMaterial = smoked
    ? timberMaterial('dark')
    : residenceFacadeMaterial('grey');
  for (const [index, x] of [-0.38, 0, 0.38].entries()) {
    addMesh(
      display,
      new THREE.SphereGeometry(0.14, 8, 5),
      fishMaterial,
      new THREE.Vector3(x, 0.15 + (index % 2) * 0.05, 0),
      new THREE.Euler(0, index % 2 === 0 ? 0.12 : -0.12, 0),
      new THREE.Vector3(1.55, 0.58, 0.72),
    );
    addMesh(
      display,
      new THREE.ConeGeometry(0.12, 0.2, 3),
      fishMaterial,
      new THREE.Vector3(x + 0.24, 0.15 + (index % 2) * 0.05, 0),
      new THREE.Euler(0, 0, -Math.PI * 0.5),
    );
  }
}

function addForagedCounter(display: THREE.Group): void {
  const crate = new THREE.Group();
  crate.position.set(-0.3, 0, 0);
  addCrate(crate, 0, 0, 0.42);
  display.add(crate);
  for (let index = 0; index < 5; index += 1) {
    addMesh(
      display,
      new THREE.SphereGeometry(0.075, 7, 5),
      sharedBuildingDetailMaterial('paintRed'),
      new THREE.Vector3(-0.5 + index * 0.11, 0.31 + (index % 2) * 0.05, -0.02),
    );
  }
  for (const x of [0.2, 0.45]) {
    addMesh(
      display,
      new THREE.CylinderGeometry(0.035, 0.05, 0.18, 7),
      residenceFacadeMaterial('white'),
      new THREE.Vector3(x, 0.09, 0),
    );
    addMesh(
      display,
      new THREE.SphereGeometry(0.12, 8, 5, 0, Math.PI * 2, 0, Math.PI * 0.5),
      residenceFacadeMaterial('lightOrange'),
      new THREE.Vector3(x, 0.18, 0),
    );
  }
}

function addMilkCounter(display: THREE.Group): void {
  for (const [index, x] of [-0.36, 0, 0.36].entries()) {
    const scale = index === 1 ? 1 : 0.82;
    addMesh(
      display,
      new THREE.CylinderGeometry(0.12 * scale, 0.18 * scale, 0.36 * scale, 9),
      residenceFacadeMaterial('white'),
      new THREE.Vector3(x, 0.18 * scale, 0),
    );
    addMesh(
      display,
      new THREE.CylinderGeometry(0.08 * scale, 0.1 * scale, 0.13 * scale, 9),
      residenceFacadeMaterial('grey'),
      new THREE.Vector3(x, 0.425 * scale, 0),
    );
  }
}

function addFruitCounter(display: THREE.Group): void {
  addProduceCrate(display);
  for (let index = 0; index < 4; index += 1) {
    addMesh(
      display,
      new THREE.SphereGeometry(0.1, 8, 6),
      sharedBuildingDetailMaterial(index % 2 === 0 ? 'paintRed' : 'paintOchre'),
      new THREE.Vector3(0.2 + (index % 2) * 0.22, 0.12 + Math.floor(index / 2) * 0.16, 0),
    );
  }
}

function addVegetableCounter(display: THREE.Group): void {
  const foliage = sharedBuildingDetailMaterial('foliage');
  for (let index = 0; index < 7; index += 1) {
    addMesh(
      display,
      index % 2 === 0
        ? new THREE.SphereGeometry(0.11, 7, 5)
        : new THREE.ConeGeometry(0.09, 0.28, 7),
      foliage,
      new THREE.Vector3(-0.56 + index * 0.18, 0.12 + (index % 2) * 0.05, 0),
      index % 2 === 0 ? undefined : new THREE.Euler(0, 0, Math.PI * 0.5),
    );
  }
}

function addEggCounter(display: THREE.Group): void {
  addMesh(
    display,
    new THREE.BoxGeometry(0.98, 0.07, 0.48),
    timberMaterial('weathered'),
    new THREE.Vector3(0, 0.035, 0),
  );
  for (let index = 0; index < 6; index += 1) {
    addMesh(
      display,
      new THREE.SphereGeometry(0.095, 8, 6),
      residenceFacadeMaterial(index % 3 === 0 ? 'lightOrange' : 'white'),
      new THREE.Vector3(-0.42 + (index % 3) * 0.42, 0.14, index < 3 ? -0.1 : 0.1),
      undefined,
      new THREE.Vector3(0.82, 1.15, 0.82),
    );
  }
}

function addHoneyCounter(display: THREE.Group): void {
  for (const x of [-0.32, 0, 0.32]) {
    addMesh(
      display,
      new THREE.CylinderGeometry(0.13, 0.17, 0.34, 9),
      residenceFacadeMaterial('yellow'),
      new THREE.Vector3(x, 0.17, 0),
    );
    addMesh(
      display,
      new THREE.CylinderGeometry(0.1, 0.1, 0.045, 9),
      timberMaterial('dark'),
      new THREE.Vector3(x, 0.365, 0),
    );
  }
}

function addWineCounter(display: THREE.Group): void {
  for (const [index, x] of [-0.38, 0.38].entries()) {
    const cask = new THREE.Group();
    cask.position.set(x, 0, 0);
    addWineCask(cask, index === 0 ? 0.82 : 0.7);
    display.add(cask);
  }
}

function addPreserveCounter(display: THREE.Group): void {
  for (const [index, x] of [-0.34, 0, 0.34].entries()) {
    const jar = new THREE.Group();
    jar.position.x = x;
    addMarketPottery(jar, index === 1 ? 0.82 : 0.68, index);
    addMesh(
      jar,
      new THREE.CylinderGeometry(0.09, 0.11, 0.06, 8),
      timberMaterial('dark'),
      new THREE.Vector3(0, index === 1 ? 0.39 : 0.33, 0),
    );
    display.add(jar);
  }
}

function addCheeseCounter(display: THREE.Group): void {
  for (const [index, x] of [-0.34, 0.1, 0.43].entries()) {
    addMesh(
      display,
      new THREE.CylinderGeometry(0.22, 0.22, 0.18, 12, 1, false, 0, Math.PI * (index === 1 ? 1.25 : 0.7)),
      residenceFacadeMaterial('yellow'),
      new THREE.Vector3(x, 0.09 + (index === 1 ? 0.12 : 0), 0),
      new THREE.Euler(0, index * 0.65, 0),
    );
  }
}

function addFirewoodCounter(display: THREE.Group): void {
  for (let index = 0; index < 4; index += 1) {
    addMesh(
      display,
      new THREE.CylinderGeometry(0.09, 0.11, 0.62, 7),
      timberMaterial(index % 2 === 0 ? 'weathered' : 'mid'),
      new THREE.Vector3(-0.42 + index * 0.28, 0.12 + (index % 2) * 0.1, 0),
      new THREE.Euler(0, 0, Math.PI * 0.5),
    );
  }
}

function addCharcoalCounter(display: THREE.Group): void {
  addMesh(
    display,
    new THREE.BoxGeometry(1.05, 0.08, 0.52),
    timberMaterial('weathered'),
    new THREE.Vector3(0, 0.04, 0),
  );
  for (let index = 0; index < 8; index += 1) {
    addMesh(
      display,
      new THREE.DodecahedronGeometry(0.11 + (index % 3) * 0.015, 0),
      sharedBuildingMaterial('interiorDark'),
      new THREE.Vector3(-0.48 + (index % 4) * 0.32, 0.14 + Math.floor(index / 4) * 0.16, 0),
      new THREE.Euler(index * 0.4, index * 0.27, 0),
    );
  }
}

function addClothCounter(display: THREE.Group): void {
  for (const [index, x] of [-0.34, 0.34].entries()) {
    const folded = new THREE.Group();
    folded.position.x = x;
    addFoldedCloth(folded, 0.68, index);
    display.add(folded);
  }
}

function addShoesCounter(display: THREE.Group): void {
  const leather = sharedBuildingMaterial('timberDark');
  for (const [index, x] of [-0.42, 0, 0.42].entries()) {
    const direction = index % 2 === 0 ? 1 : -1;
    addMesh(
      display,
      new THREE.BoxGeometry(0.34, 0.15, 0.2),
      leather,
      new THREE.Vector3(x, 0.12, 0),
      new THREE.Euler(0, direction * 0.12, 0),
    );
    addMesh(
      display,
      new THREE.BoxGeometry(0.18, 0.24, 0.19),
      leather,
      new THREE.Vector3(x - direction * 0.08, 0.28, 0),
      new THREE.Euler(0, direction * 0.12, 0),
    );
  }
}

function addPotteryCounter(display: THREE.Group): void {
  for (const [index, x] of [-0.42, 0, 0.42].entries()) {
    const pottery = new THREE.Group();
    pottery.position.x = x;
    addMarketPottery(pottery, index === 1 ? 0.82 : 0.66, index);
    display.add(pottery);
  }
}

function addCandleCounter(display: THREE.Group): void {
  const wax = residenceFacadeMaterial('yellow');
  const wick = timberMaterial('dark');
  for (const [index, x] of [-0.48, -0.16, 0.16, 0.48].entries()) {
    const height = index % 2 === 0 ? 0.42 : 0.3;
    addMesh(
      display,
      new THREE.CylinderGeometry(0.075, 0.085, height, 8),
      wax,
      new THREE.Vector3(x, height * 0.5, 0),
    );
    addMesh(
      display,
      new THREE.CylinderGeometry(0.012, 0.012, 0.08, 5),
      wick,
      new THREE.Vector3(x, height + 0.04, 0),
    );
  }
}

type MarketStockPlacement = readonly [
  x: number,
  y: number,
  z: number,
  scale: number,
];

function addMarketSpecialtyStock(
  group: THREE.Group,
  containerName: string,
  segmentName: string,
  placements: readonly MarketStockPlacement[],
  addSegment: (segment: THREE.Group, scale: number, index: number) => void,
): void {
  const stockpile = new THREE.Group();
  stockpile.name = containerName;
  stockpile.visible = false;
  for (const [index, [x, y, z, scale]] of placements.entries()) {
    const segment = new THREE.Group();
    segment.name = segmentName;
    segment.visible = false;
    segment.position.set(x, y, z);
    addSegment(segment, scale, index);
    stockpile.add(segment);
  }
  group.add(stockpile);
}

function addHoneyJarPair(group: THREE.Group, scale: number): void {
  addMesh(
    group,
    new THREE.BoxGeometry(0.52 * scale, 0.07 * scale, 0.3 * scale),
    timberMaterial('light'),
    new THREE.Vector3(0, 0.035 * scale, 0),
  );
  for (const x of [-0.13, 0.13]) {
    addMesh(
      group,
      new THREE.CylinderGeometry(0.14 * scale, 0.19 * scale, 0.4 * scale, 9),
      residenceFacadeMaterial('yellow'),
      new THREE.Vector3(x * scale, 0.27 * scale, 0),
    );
    addMesh(
      group,
      new THREE.TorusGeometry(0.11 * scale, 0.022 * scale, 4, 9),
      timberMaterial('dark'),
      new THREE.Vector3(x * scale, 0.48 * scale, 0),
      new THREE.Euler(Math.PI * 0.5, 0, 0),
    );
  }
}

function addWineCask(group: THREE.Group, scale: number): void {
  addMesh(
    group,
    new THREE.CylinderGeometry(0.3 * scale, 0.3 * scale, 0.68 * scale, 10),
    timberMaterial('mid'),
    new THREE.Vector3(0, 0.32 * scale, 0),
    new THREE.Euler(0, 0, Math.PI * 0.5),
  );
  for (const x of [-0.25, 0.25]) {
    addMesh(
      group,
      new THREE.TorusGeometry(0.3 * scale, 0.022 * scale, 5, 10),
      timberMaterial('dark'),
      new THREE.Vector3(x * scale, 0.32 * scale, 0),
      new THREE.Euler(0, Math.PI * 0.5, 0),
    );
  }
  addMesh(
    group,
    new THREE.CylinderGeometry(0.055 * scale, 0.055 * scale, 0.045 * scale, 8),
    timberMaterial('dark'),
    new THREE.Vector3(0, 0.625 * scale, 0),
  );
}

function addFoldedCloth(group: THREE.Group, scale: number, variant: number): void {
  const clothMaterial = variant % 3 === 0
    ? residenceFacadeMaterial('grey')
    : variant % 3 === 1
      ? residenceFacadeMaterial('lightOrange')
      : residenceFacadeMaterial('yellow');
  for (let layer = 0; layer < 2; layer += 1) {
    addMesh(
      group,
      new THREE.BoxGeometry(0.58 * scale, 0.14 * scale, 0.42 * scale),
      clothMaterial,
      new THREE.Vector3(
        (layer === 0 ? -0.04 : 0.04) * scale,
        (0.08 + layer * 0.14) * scale,
        0,
      ),
      new THREE.Euler(0, layer === 0 ? -0.08 : 0.07, 0),
    );
  }
  addMesh(
    group,
    new THREE.BoxGeometry(0.07 * scale, 0.31 * scale, 0.46 * scale),
    timberMaterial('dark'),
    new THREE.Vector3(0, 0.15 * scale, 0),
  );
}

function addIronBundle(group: THREE.Group, scale: number, variant: number): void {
  for (let bar = 0; bar < 3; bar += 1) {
    addMesh(
      group,
      new THREE.BoxGeometry(0.62 * scale, 0.08 * scale, 0.1 * scale),
      metalMaterial('iron'),
      new THREE.Vector3(
        0,
        (0.08 + bar * 0.09) * scale,
        (bar - 1) * 0.11 * scale,
      ),
      new THREE.Euler(0, (variant % 2 === 0 ? 0.08 : -0.08), 0),
    );
  }
}

function addSaltSack(group: THREE.Group, scale: number): void {
  const sack = addMesh(
    group,
    new THREE.SphereGeometry(0.29 * scale, 8, 6),
    residenceFacadeMaterial('white'),
    new THREE.Vector3(0, 0.29 * scale, 0),
  );
  sack.scale.set(0.84, 1.18, 0.8);
  addMesh(
    group,
    new THREE.CylinderGeometry(0.06 * scale, 0.1 * scale, 0.14 * scale, 7),
    timberMaterial('light'),
    new THREE.Vector3(0, 0.65 * scale, 0),
  );
}

function addMarketPottery(group: THREE.Group, scale: number, variant: number): void {
  const potteryMaterial = residenceFacadeMaterial(
    variant % 2 === 0 ? 'orange' : 'lightOrange',
  );
  addMesh(
    group,
    new THREE.SphereGeometry(0.2 * scale, 9, 7),
    potteryMaterial,
    new THREE.Vector3(0, 0.22 * scale, 0),
    undefined,
    new THREE.Vector3(1, 1.12, 1),
  );
  addMesh(
    group,
    new THREE.CylinderGeometry(0.1 * scale, 0.14 * scale, 0.2 * scale, 9, 1, true),
    potteryMaterial,
    new THREE.Vector3(0, 0.43 * scale, 0),
  );
}

function addMarketSpecialtyStalls(group: THREE.Group): void {
  addMarketSpecialtyStock(
    group,
    'MarketAleStockpile',
    'MarketAleSegment',
    ([
      [-3.0, 0, 1.45, 0.9],
      [-2.35, 0, 1.42, 0.78],
      [-3.15, 0, 0.78, 0.7],
    ] as const).slice(0, MARKET_ALE_VISUAL_SEGMENTS),
    (segment, scale) => addBarrel(segment, 0, 0, scale),
  );
  addMarketSpecialtyStock(
    group,
    'MarketHoneyStockpile',
    'MarketHoneySegment',
    ([
      [-2.05, 0, 3.02, 1.35],
      [-1.58, 0, 3.08, 1.2],
      [-1.13, 0, 3.0, 1.05],
    ] as const).slice(0, MARKET_HONEY_VISUAL_SEGMENTS),
    (segment, scale) => addHoneyJarPair(segment, scale),
  );
  addMarketSpecialtyStock(
    group,
    'MarketWineStockpile',
    'MarketWineSegment',
    ([
      [2.75, 0, 1.5, 1],
      [2.08, 0, 1.45, 0.88],
      [3.0, 0, 0.82, 0.78],
    ] as const).slice(0, MARKET_WINE_VISUAL_SEGMENTS),
    (segment, scale) => addWineCask(segment, scale),
  );
  addMarketSpecialtyStock(
    group,
    'MarketClothStockpile',
    'MarketClothSegment',
    ([
      [1.02, 0, 3.0, 1.4],
      [1.68, 0, 3.08, 1.24],
      [2.3, 0, 3.0, 1.08],
    ] as const).slice(0, MARKET_CLOTH_VISUAL_SEGMENTS),
    (segment, scale, index) => addFoldedCloth(segment, scale, index),
  );
  addMarketSpecialtyStock(
    group,
    'MarketIronStockpile',
    'MarketIronSegment',
    ([
      [-3.08, 0, -1.9, 1.1],
      [-2.45, 0, -1.92, 0.98],
      [-1.82, 0, -1.88, 0.88],
    ] as const).slice(0, MARKET_IRON_VISUAL_SEGMENTS),
    (segment, scale, index) => addIronBundle(segment, scale, index),
  );
  addMarketSpecialtyStock(
    group,
    'MarketSaltStockpile',
    'MarketSaltSegment',
    ([
      [-0.82, 0, -1.92, 1.1],
      [-0.22, 0, -1.9, 0.98],
      [0.35, 0, -1.88, 0.88],
    ] as const).slice(0, MARKET_SALT_VISUAL_SEGMENTS),
    (segment, scale) => addSaltSack(segment, scale),
  );
  addMarketSpecialtyStock(
    group,
    'MarketPotteryStockpile',
    'MarketPotterySegment',
    ([
      [1.35, 0, -1.94, 1.18],
      [1.92, 0, -1.94, 1.04],
      [2.48, 0, -1.91, 0.92],
    ] as const).slice(0, MARKET_POTTERY_VISUAL_SEGMENTS),
    (segment, scale, index) => addMarketPottery(segment, scale, index),
  );
}

function addMarketStagingStock(group: THREE.Group): void {
  const timber = new THREE.Group();
  timber.name = 'MarketTimberStaging';
  timber.position.set(-4.55, 0.1, 1.25);
  for (let index = 0; index < MARKET_STAGING_VISUAL_SEGMENTS; index++) {
    const beam = addMesh(
      timber,
      new THREE.BoxGeometry(2.15, 0.18, 0.2),
      timberMaterial(index % 2 === 0 ? 'weathered' : 'dark'),
      new THREE.Vector3(
        0,
        0.12 + Math.floor(index / 2) * 0.2,
        (index % 2) * 0.26,
      ),
    );
    beam.name = `MarketTimberStageSegment${index}`;
    beam.visible = false;
  }
  group.add(timber);

  const stone = new THREE.Group();
  stone.name = 'MarketStoneStaging';
  stone.position.set(4.5, 0.1, -1.25);
  for (let index = 0; index < MARKET_STAGING_VISUAL_SEGMENTS; index++) {
    const block = addMesh(
      stone,
      new THREE.BoxGeometry(0.58, 0.38, 0.5),
      stoneMaterial(index % 2 === 0 ? 'mid' : 'light'),
      new THREE.Vector3(
        (index % 3) * 0.54 - 0.54,
        0.2 + Math.floor(index / 3) * 0.36,
        (index % 2) * 0.18,
      ),
      new THREE.Euler(0, (index % 3 - 1) * 0.08, 0),
    );
    block.name = `MarketStoneStageSegment${index}`;
    block.visible = false;
  }
  group.add(stone);

  const crates = new THREE.Group();
  crates.name = 'MarketCratedGoodsStaging';
  crates.position.set(4.5, 0, 1.25);
  for (let index = 0; index < MARKET_STAGING_VISUAL_SEGMENTS; index++) {
    const crate = new THREE.Group();
    crate.name = `MarketCratedStageSegment${index}`;
    crate.visible = false;
    crate.position.set(
      (index % 2) * 0.7 - 0.35,
      Math.floor(index / 4) * 0.62,
      Math.floor(index / 2) % 2 * 0.72,
    );
    addCrate(crate, 0, 0, index % 2 === 0 ? 0.62 : 0.54);
    crates.add(crate);
  }
  group.add(crates);
}

function addMarketProceedsChest(group: THREE.Group): void {
  const chest = new THREE.Group();
  chest.name = 'MarketProceedsChest';
  chest.visible = false;
  chest.position.set(2.6, 0.25, -1.45);
  for (let index = 0; index < MARKET_RECEIPT_VISUAL_SEGMENTS; index += 1) {
    const segment = new THREE.Group();
    segment.name = 'MarketReceiptSegment';
    segment.visible = false;
    const [x, y, z] = [
      [0, 0.08, 0.1],
      [-0.62, 0, 0],
      [0.62, 0, 0],
    ][index];
    segment.position.set(x, y, z);
    addMesh(
      segment,
      new THREE.BoxGeometry(0.58, 0.4, 0.48),
      timberMaterial(index === 1 ? 'weathered' : 'dark'),
      new THREE.Vector3(0, 0.22, 0),
    );
    addMesh(
      segment,
      new THREE.CylinderGeometry(0.24, 0.24, 0.58, 8, 1, false, 0, Math.PI),
      timberMaterial('weathered'),
      new THREE.Vector3(0, 0.45, 0),
      new THREE.Euler(0, 0, Math.PI * 0.5),
    );
    addMesh(
      segment,
      new THREE.BoxGeometry(0.065, 0.46, 0.52),
      metalMaterial('iron'),
      new THREE.Vector3(0, 0.3, 0),
    );
    chest.add(segment);
  }
  group.add(chest);
}

/** Open Croatian market loggia: a permanent civic roof, not a carnival tent. */
export function createMarketplaceMesh(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Marketplace';
  const width = 7.55;
  const depth = 5.35;
  const halfW = width * 0.5;
  const halfD = depth * 0.5;
  const floorY = 0.24;
  const wallTop = 3.15;
  const ridgeHeight = 2.05;
  const pitch = Math.atan2(ridgeHeight, halfW);
  const slope = halfW / Math.cos(pitch) + 0.3;

  addMesh(
    group,
    new THREE.BoxGeometry(width + 0.55, floorY, depth + 0.55),
    stoneMaterial('light'),
    new THREE.Vector3(0, floorY * 0.5, 0),
  );
  for (const z of [-halfD + 0.28, halfD - 0.28]) {
    addMesh(
      group,
      new THREE.BoxGeometry(width - 0.3, 0.24, 0.42),
      stoneMaterial('mid'),
      new THREE.Vector3(0, 0.36, z),
    );
  }

  for (const x of [-halfW + 0.38, 0, halfW - 0.38]) {
    for (const z of [-halfD + 0.3, halfD - 0.3]) {
      addMesh(
        group,
        new THREE.BoxGeometry(0.28, wallTop - floorY, 0.28),
        timberMaterial('dark'),
        new THREE.Vector3(x, floorY + (wallTop - floorY) * 0.5, z),
      );
      addMesh(
        group,
        new THREE.BoxGeometry(0.5, 0.18, 0.5),
        stoneMaterial('light'),
        new THREE.Vector3(x, floorY + 0.09, z),
      );
    }
  }
  for (const z of [-halfD + 0.3, halfD - 0.3]) {
    addMesh(
      group,
      new THREE.BoxGeometry(width - 0.32, 0.2, 0.22),
      timberMaterial('weathered'),
      new THREE.Vector3(0, wallTop - 0.08, z),
    );
  }

  for (const side of [-1, 1] as const) {
    addMesh(
      group,
      new THREE.BoxGeometry(slope, 0.14, depth + 0.58),
      shingleMaterial(),
      new THREE.Vector3(side * halfW * 0.46, wallTop + ridgeHeight * 0.48, 0),
      new THREE.Euler(0, 0, side * -pitch),
    );
    for (let row = 0; row < 4; row++) {
      const t = (row + 0.5) / 4.8;
      addMesh(
        group,
        new THREE.BoxGeometry(0.07, 0.055, depth + 0.6),
        shingleMaterial(),
        new THREE.Vector3(side * halfW * (1 - t), wallTop + ridgeHeight * t + 0.02, 0),
        new THREE.Euler(0, 0, side * -pitch),
      );
    }
  }
  addMesh(
    group,
    new THREE.BoxGeometry(0.24, 0.18, depth + 0.72),
    shingleMaterial(),
    new THREE.Vector3(0, wallTop + ridgeHeight + 0.04, 0),
  );
  for (const zSign of [-1, 1] as const) {
    addTriangularGableWall(
      group,
      'z',
      zSign * (halfD - 0.05),
      halfW,
      wallTop,
      ridgeHeight,
      0.14,
      timberMaterial('weathered'),
    );
  }

  for (let index = 0; index < MARKETPLACE_FOOD_STALL_SLOTS; index += 1) {
    addMarketTable(group, `MarketFoodStall${index}`, 'food', index);
  }
  for (let index = 0; index < MARKETPLACE_GOODS_STALL_SLOTS; index += 1) {
    addMarketTable(group, `MarketGoodsStall${index}`, 'goods', index);
  }
  addMarketSpecialtyStalls(group);
  addMarketStagingStock(group);
  addMarketProceedsChest(group);

  // A simple hanging steelyard gives the open loggia a strong trade silhouette.
  addMesh(
    group,
    new THREE.BoxGeometry(1.55, 0.08, 0.08),
    metalMaterial('iron'),
    new THREE.Vector3(0, 2.55, halfD - 0.22),
    new THREE.Euler(0, 0, 0.08),
  );
  addMesh(
    group,
    new THREE.CylinderGeometry(0.022, 0.022, 0.72, 6),
    metalMaterial('iron'),
    new THREE.Vector3(0.48, 2.18, halfD - 0.22),
  );
  addMesh(
    group,
    new THREE.CylinderGeometry(0.34, 0.28, 0.08, 12),
    metalMaterial('iron'),
    new THREE.Vector3(0.48, 1.8, halfD - 0.22),
  );
  return group;
}
