import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  addMesh,
  metalMaterial,
  timberMaterial,
} from '../buildings/buildingMaterials.ts';
import type { DeliveryCargoKind } from './deliveryTrips.ts';

const MODEL_URL = '/assets/models/delivery-cart/quaternius-medieval-cart.glb';
const MODEL_TARGET_HEIGHT = 1.56;

const WHEEL_MATERIAL = new THREE.MeshStandardMaterial({
  color: 0x3a2d22,
  roughness: 0.9,
  metalness: 0,
});
const FIRE_BUCKET_MATERIAL = new THREE.MeshStandardMaterial({
  color: 0x6f7476,
  roughness: 0.72,
  metalness: 0.36,
});
const FIRE_BUCKET_WATER_MATERIAL = new THREE.MeshStandardMaterial({
  color: 0x4e91bd,
  roughness: 0.25,
  metalness: 0,
  transparent: true,
  opacity: 0.82,
});

const CARGO_MATERIALS = {
  rope: createCargoMaterial('Cargo rope', 0x8b7048, 0.98),
  grainCanvas: createCargoMaterial('Grain sack canvas', 0xc6aa70, 0.96),
  feedCanvas: createCargoMaterial('Animal feed sack canvas', 0x9b8352, 0.98),
  feedCake: createCargoMaterial('Compressed oat feed', 0x756036, 1),
  feedMark: createCargoMaterial('Animal feed sack mark', 0x465338, 0.99),
  flourCanvas: createCargoMaterial('Flour sack canvas', 0xd8cfb9, 0.97),
  flourMark: createCargoMaterial('Flour sack mark', 0x766a58, 0.96),
  terracotta: createCargoMaterial('Preserving crock terracotta', 0x9a5339, 0.93),
  darkTerracotta: createCargoMaterial('Wine amphora terracotta', 0x75402f, 0.94),
  crockGlaze: createCargoMaterial('Honey crock glaze', 0xb9872e, 0.7),
  crockCloth: createCargoMaterial('Crock lid cloth', 0xc7b88e, 0.98),
  beeswax: createCargoMaterial('Beeswax', 0xc99a42, 0.88),
  candleWax: createCargoMaterial('Beeswax candles', 0xe3c878, 0.9),
  candleWick: createCargoMaterial('Candle wicks', 0x3b3024, 0.99),
  leaf: createCargoMaterial('Food leaves', 0x536c3d, 0.98),
  apple: createCargoMaterial('Food apples', 0xa84637, 0.9),
  rootVegetable: createCargoMaterial('Food root vegetables', 0xb56f32, 0.94),
  bread: createCargoMaterial('Food bread', 0xb9854f, 0.96),
  stoneDark: createCargoMaterial('Cargo stone dark', 0x51565c, 0.99),
  stoneMid: createCargoMaterial('Cargo stone mid', 0x6b7178, 0.99),
  stoneLight: createCargoMaterial('Cargo stone light', 0x858b91, 0.98),
  wool: createCargoMaterial('Raw wool fleece', 0xd8d1c2, 0.99),
  flax: createCargoMaterial('Dried flax stems', 0xc8ad69, 0.98),
  yarn: createCargoMaterial('Spun wool yarn', 0xe1d9c9, 0.99),
  linen: createCargoMaterial('Undyed retted linen', 0xd8caa7, 0.98),
  clothRed: createCargoMaterial('Madder-dyed cloth', 0x8f443d, 0.96),
  clothBlue: createCargoMaterial('Blue-grey woven cloth', 0x52697a, 0.96),
  ironBloom: createCargoMaterial('Forged iron bloom', 0x42494d, 0.78, 0.42),
  ironOreDark: createCargoMaterial('Iron-bearing stone', 0x4b4540, 0.98, 0.04),
  ironOreRust: createCargoMaterial('Weathered iron ore', 0x7b4933, 0.97, 0.03),
  clay: createCargoMaterial('Wet river clay', 0x8d5139, 0.99),
  saltCanvas: createCargoMaterial('Salt sack canvas', 0xd9d0b8, 0.98),
  seaSalt: createCargoMaterial('Coarse Adriatic sea salt', 0xe7e1d2, 0.92),
  rockSalt: createCargoMaterial('Mined rock salt', 0xd5cec2, 0.96, 0.01),
  charcoal: createCargoMaterial('Lump charcoal', 0x202324, 0.99),
  manure: createCargoMaterial('Dung and straw manure', 0x5b472c, 1),
  manureStraw: createCargoMaterial('Manure bedding straw', 0xaa8647, 0.99),
  driedHerb: createCargoMaterial('Dried medicinal herbs', 0x73804b, 0.98),
} as const;

const CANOPY_PALETTES = [
  { primary: 0x8a3228, cloth: 0xd8c9a6 },
  { primary: 0x4a5c44, cloth: 0xd1c7a9 },
  { primary: 0x3d4a62, cloth: 0xc8c0a9 },
  { primary: 0x7a5e46, cloth: 0xd8c7a0 },
] as const;

export type DeliveryCartModelSource = {
  scene: THREE.Group;
  bounds: THREE.Box3;
  sourceHeight: number;
};

export type DeliveryCartMeshOptions = {
  appearanceSeed?: number;
  source?: DeliveryCartModelSource | null;
  regionalImport?: boolean;
  loaded?: boolean;
};

function createCargoMaterial(
  name: string,
  color: number,
  roughness: number,
  metalness = 0,
): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    color,
    roughness,
    metalness,
  });
  material.name = name;
  return material;
}

function addCargo(
  group: THREE.Group,
  kind: DeliveryCargoKind,
  regionalImport: boolean,
): void {
  switch (kind) {
    case 'firewood':
      addFirewoodLoad(group);
      break;
    case 'water':
      addWaterLoad(group);
      break;
    case 'food':
    case 'ryeBread':
    case 'maslinBread':
    case 'meat':
    case 'fish':
    case 'berries':
    case 'mushrooms':
    case 'milk':
    case 'apples':
    case 'pears':
    case 'cherries':
    case 'aronia':
    case 'rosehips':
    case 'vegetables':
    case 'cabbage':
    case 'carrots':
    case 'beetroot':
    case 'eggs':
    case 'grapes':
      addFoodLoad(group);
      break;
    case 'ryeSheaves':
    case 'oatSheaves':
    case 'barleySheaves':
    case 'maslinSheaves':
    case 'ryeGrain':
    case 'oatGrain':
    case 'maslinGrain':
    case 'barley':
    case 'malt':
      addGrainLoad(group);
      break;
    case 'animalFeed':
      addAnimalFeedLoad(group);
      break;
    case 'ryeFlour':
    case 'maslinFlour':
      addFlourLoad(group);
      break;
    case 'ale':
    case 'cider':
    case 'pearCider':
    case 'mead':
      addAleLoad(group);
      break;
    case 'preservedFood':
    case 'curedMeat':
    case 'smokedFish':
    case 'cheese':
    case 'aroniaJam':
    case 'rosehipJam':
      addPreservedFoodLoad(group);
      break;
    case 'honey':
      addHoneyLoad(group);
      break;
    case 'wax':
      addWaxLoad(group);
      break;
    case 'candles':
      addCandleLoad(group);
      break;
    case 'wine':
      addWineLoad(group);
      break;
    case 'timber':
      addTimberLoad(group);
      break;
    case 'stone':
      addStoneLoad(group);
      break;
    case 'polearms':
      addPolearmLoad(group);
      break;
    case 'ironwork':
      addIronworkLoad(group);
      break;
    case 'wool':
      addWoolLoad(group);
      break;
    case 'flax':
      addFlaxLoad(group);
      break;
    case 'yarn':
      addYarnLoad(group);
      break;
    case 'linen':
      addLinenLoad(group);
      break;
    case 'cloth':
      addClothLoad(group);
      break;
    case 'pelts':
    case 'hides':
    case 'leather':
      addClothLoad(group);
      break;
    case 'shoes':
      addPotteryLoad(group);
      break;
    case 'gold':
      addGoldLoad(group);
      break;
    case 'iron':
      if (regionalImport) {
        addImportedIronLoad(group);
      } else {
        addSettlementIronLoad(group);
      }
      break;
    case 'clay':
      addClayLoad(group);
      break;
    case 'salt':
      if (regionalImport) {
        addAdriaticSaltLoad(group);
      } else {
        addRockSaltLoad(group);
      }
      break;
    case 'charcoal':
      addCharcoalLoad(group);
      break;
    case 'pottery':
      addPotteryLoad(group);
      break;
    case 'roofTiles':
      addRoofTileLoad(group);
      break;
    case 'manure':
      addManureLoad(group);
      break;
    case 'remedies':
      addRemedyLoad(group);
      break;
    default: {
      const unreachable: never = kind;
      throw new Error(`Unknown cargo kind: ${unreachable}`);
    }
  }
}

function addFirewoodLoad(group: THREE.Group): void {
  const rows = [
    { y: 0.64, z: -0.16, length: 0.58, radius: 0.075 },
    { y: 0.64, z: 0, length: 0.62, radius: 0.078 },
    { y: 0.64, z: 0.16, length: 0.56, radius: 0.072 },
    { y: 0.77, z: -0.09, length: 0.54, radius: 0.07 },
    { y: 0.77, z: 0.09, length: 0.6, radius: 0.074 },
    { y: 0.89, z: 0, length: 0.5, radius: 0.068 },
  ] as const;
  for (const [index, log] of rows.entries()) {
    addCutLog(
      group,
      `Firewood split log ${index + 1}`,
      new THREE.Vector3(0, log.y, log.z),
      log.length,
      log.radius,
      'x',
      index % 2 === 0 ? 'weathered' : 'mid',
    );
  }
  for (const x of [-0.16, 0.16]) {
    addNamedMesh(
      group,
      'Firewood bundle rope',
      new THREE.BoxGeometry(0.038, 0.31, 0.43),
      CARGO_MATERIALS.rope,
      new THREE.Vector3(x, 0.75, 0),
    );
  }
}

function addRemedyLoad(group: THREE.Group): void {
  addBasket(group, 'Remedy herb basket', new THREE.Vector3(-0.18, 0.7, 0), 0.94);
  addCrock(
    group,
    'Remedy storage crock',
    new THREE.Vector3(0.22, 0.72, 0.03),
    0.86,
    CARGO_MATERIALS.terracotta,
  );
  for (const [index, [x, y, z, roll]] of [
    [-0.24, 0.92, -0.03, -0.2],
    [-0.12, 0.95, 0.05, 0.18],
    [0.01, 0.9, -0.06, -0.08],
  ].entries()) {
    addNamedMesh(
      group,
      `Dried remedy bundle ${index + 1}`,
      new THREE.CylinderGeometry(0.055, 0.075, 0.42, 7),
      CARGO_MATERIALS.driedHerb,
      new THREE.Vector3(x, y, z),
      new THREE.Euler(Math.PI * 0.5, roll, Math.PI * 0.5),
    );
    addNamedMesh(
      group,
      `Dried remedy bundle tie ${index + 1}`,
      new THREE.TorusGeometry(0.066, 0.012, 5, 8),
      CARGO_MATERIALS.rope,
      new THREE.Vector3(x, y, z),
      new THREE.Euler(Math.PI * 0.5, 0, 0),
    );
  }
}

function addGoldLoad(group: THREE.Group): void {
  addNamedMesh(
    group,
    'Treasury lockbox',
    new THREE.BoxGeometry(0.7, 0.42, 0.5),
    timberMaterial('dark'),
    new THREE.Vector3(0, 0.67, 0),
  );
  addNamedMesh(
    group,
    'Treasury lockbox lid',
    new THREE.CylinderGeometry(0.25, 0.25, 0.7, 8, 1, false, 0, Math.PI),
    timberMaterial('weathered'),
    new THREE.Vector3(0, 0.9, 0),
    new THREE.Euler(0, 0, Math.PI * 0.5),
  );
  addNamedMesh(
    group,
    'Treasury lockbox iron band',
    new THREE.BoxGeometry(0.08, 0.48, 0.54),
    metalMaterial(),
    new THREE.Vector3(0, 0.74, 0),
  );
}

function addWaterLoad(group: THREE.Group): void {
  addBarrel(
    group,
    'Water barrel',
    new THREE.Vector3(0, 0.76, 0),
    1.12,
    true,
  );
  addNamedMesh(
    group,
    'Water barrel bung',
    new THREE.CylinderGeometry(0.045, 0.052, 0.06, 8),
    timberMaterial('dark'),
    new THREE.Vector3(0.09, 1.1, 0),
  );
}

function addFoodLoad(group: THREE.Group): void {
  addBasket(group, 'Fresh food basket', new THREE.Vector3(-0.17, 0.69, 0), 1);
  addNamedMesh(
    group,
    'Food apples',
    new THREE.SphereGeometry(0.09, 8, 6),
    CARGO_MATERIALS.apple,
    new THREE.Vector3(-0.25, 0.89, -0.02),
  );
  addNamedMesh(
    group,
    'Food leaves',
    new THREE.SphereGeometry(0.1, 7, 5),
    CARGO_MATERIALS.leaf,
    new THREE.Vector3(-0.08, 0.9, 0.05),
    new THREE.Euler(0.15, 0, 0.2),
    new THREE.Vector3(1.15, 0.7, 0.8),
  );
  addNamedMesh(
    group,
    'Food root vegetables',
    new THREE.ConeGeometry(0.07, 0.26, 7),
    CARGO_MATERIALS.rootVegetable,
    new THREE.Vector3(-0.13, 0.93, -0.08),
    new THREE.Euler(0, 0, 0.55),
  );
  addCrate(group, 'Bread crate', new THREE.Vector3(0.25, 0.69, 0.04), 0.72);
  for (const [x, z, yaw] of [
    [0.2, 0, -0.18],
    [0.31, 0.07, 0.16],
  ] as const) {
    addNamedMesh(
      group,
      'Bread loaf',
      new THREE.CapsuleGeometry(0.07, 0.13, 3, 7),
      CARGO_MATERIALS.bread,
      new THREE.Vector3(x, 0.88, z),
      new THREE.Euler(Math.PI * 0.5, yaw, 0),
    );
  }
}

function addGrainLoad(group: THREE.Group): void {
  addSack(
    group,
    'Grain sack',
    new THREE.Vector3(-0.18, 0.76, 0.02),
    1.05,
    CARGO_MATERIALS.grainCanvas,
  );
  addSack(
    group,
    'Grain sack',
    new THREE.Vector3(0.2, 0.72, -0.03),
    0.88,
    CARGO_MATERIALS.grainCanvas,
  );
  addNamedMesh(
    group,
    'Grain sheaf',
    new THREE.CylinderGeometry(0.09, 0.15, 0.48, 7),
    CARGO_MATERIALS.grainCanvas,
    new THREE.Vector3(0.23, 0.96, 0.08),
    new THREE.Euler(0.08, 0, -0.38),
  );
}

function addAnimalFeedLoad(group: THREE.Group): void {
  addSack(
    group,
    'Animal feed sack 1',
    new THREE.Vector3(-0.2, 0.73, -0.02),
    0.95,
    CARGO_MATERIALS.feedCanvas,
  );
  addSack(
    group,
    'Animal feed sack 2',
    new THREE.Vector3(0.2, 0.7, 0.04),
    0.82,
    CARGO_MATERIALS.feedCanvas,
  );
  for (const [index, position] of [
    new THREE.Vector3(-0.1, 0.98, -0.08),
    new THREE.Vector3(0.12, 0.99, -0.04),
  ].entries()) {
    addNamedMesh(
      group,
      `Compressed animal feed cake ${index + 1}`,
      new THREE.BoxGeometry(0.2, 0.1, 0.28),
      CARGO_MATERIALS.feedCake,
      position,
      new THREE.Euler(0, index === 0 ? -0.12 : 0.16, 0),
    );
  }
  addNamedMesh(
    group,
    'Animal feed sack mark',
    new THREE.CircleGeometry(0.075, 8),
    CARGO_MATERIALS.feedMark,
    new THREE.Vector3(-0.2, 0.76, 0.175),
  );
}

function addFlourLoad(group: THREE.Group): void {
  addSack(
    group,
    'Flour sack',
    new THREE.Vector3(-0.16, 0.75, 0),
    1,
    CARGO_MATERIALS.flourCanvas,
  );
  addSack(
    group,
    'Flour sack',
    new THREE.Vector3(0.2, 0.72, 0.04),
    0.84,
    CARGO_MATERIALS.flourCanvas,
  );
  addNamedMesh(
    group,
    'Flour sack mill mark',
    new THREE.CircleGeometry(0.09, 10),
    CARGO_MATERIALS.flourMark,
    new THREE.Vector3(-0.16, 0.78, 0.19),
  );
}

function addAleLoad(group: THREE.Group): void {
  addBarrel(group, 'Ale keg', new THREE.Vector3(-0.18, 0.72, 0), 0.82, true);
  addBarrel(group, 'Ale keg', new THREE.Vector3(0.2, 0.69, 0.03), 0.72, true);
}

function addPreservedFoodLoad(group: THREE.Group): void {
  addCrate(
    group,
    'Preserved food crock crate',
    new THREE.Vector3(0, 0.64, 0),
    1.05,
  );
  for (const [index, x] of [-0.2, 0, 0.2].entries()) {
    addCrock(
      group,
      `Preserved food crock ${index + 1}`,
      new THREE.Vector3(x, 0.86 + (index % 2) * 0.025, 0),
      0.78,
      CARGO_MATERIALS.terracotta,
    );
  }
}

function addHoneyLoad(group: THREE.Group): void {
  for (const [index, [x, z, scale]] of [
    [-0.2, -0.03, 0.9],
    [0.04, 0.03, 1],
    [0.24, -0.05, 0.78],
  ].entries()) {
    addCrock(
      group,
      `Honey crock ${index + 1}`,
      new THREE.Vector3(x, 0.73, z),
      scale,
      CARGO_MATERIALS.crockGlaze,
    );
  }
}

function addWaxLoad(group: THREE.Group): void {
  for (const [index, [x, y, z]] of [
    [-0.2, 0.67, -0.12],
    [0, 0.67, -0.12],
    [0.2, 0.67, -0.12],
    [-0.11, 0.81, 0.05],
    [0.11, 0.81, 0.05],
  ].entries()) {
    addNamedMesh(
      group,
      `Beeswax block ${index + 1}`,
      new THREE.BoxGeometry(0.18, 0.12, 0.28),
      CARGO_MATERIALS.beeswax,
      new THREE.Vector3(x, y, z),
      new THREE.Euler(0, index % 2 === 0 ? 0.025 : -0.025, 0),
    );
  }
}

function addCandleLoad(group: THREE.Group): void {
  addCrate(
    group,
    'Candle crate',
    new THREE.Vector3(0, 0.65, 0),
    1.05,
  );
  for (const [index, [x, z, height]] of [
    [-0.16, -0.1, 0.34],
    [0, -0.1, 0.3],
    [0.16, -0.1, 0.36],
    [-0.16, 0.1, 0.29],
    [0, 0.1, 0.37],
    [0.16, 0.1, 0.32],
  ].entries()) {
    const baseY = 0.77;
    addNamedMesh(
      group,
      `Beeswax candle ${index + 1}`,
      new THREE.CylinderGeometry(0.045, 0.052, height, 8),
      CARGO_MATERIALS.candleWax,
      new THREE.Vector3(x, baseY + height * 0.5, z),
    );
    addNamedMesh(
      group,
      `Candle wick ${index + 1}`,
      new THREE.CylinderGeometry(0.006, 0.006, 0.035, 5),
      CARGO_MATERIALS.candleWick,
      new THREE.Vector3(x, baseY + height + 0.015, z),
    );
  }
}

function addWineLoad(group: THREE.Group): void {
  addAmphora(group, new THREE.Vector3(-0.18, 0.76, 0.02), 1);
  addAmphora(group, new THREE.Vector3(0.19, 0.72, -0.02), 0.88);
}

function addTimberLoad(group: THREE.Group): void {
  for (const [index, [x, y, z, length, radius]] of [
    [-0.18, 0.64, 0, 0.82, 0.095],
    [0.02, 0.64, 0, 0.9, 0.105],
    [0.21, 0.64, 0, 0.78, 0.09],
    [-0.09, 0.82, 0, 0.86, 0.09],
    [0.12, 0.82, 0, 0.8, 0.086],
  ].entries()) {
    addCutLog(
      group,
      `Timber pole ${index + 1}`,
      new THREE.Vector3(x, y, z),
      length,
      radius,
      'z',
      index % 2 === 0 ? 'weathered' : 'mid',
    );
  }
  for (const z of [-0.22, 0.22]) {
    addNamedMesh(
      group,
      'Timber load rope',
      new THREE.BoxGeometry(0.58, 0.035, 0.04),
      CARGO_MATERIALS.rope,
      new THREE.Vector3(0.01, 0.88, z),
    );
  }
}

function addStoneLoad(group: THREE.Group): void {
  const rocks = [
    [-0.24, 0.67, 0.08, 0.23, 'dark'],
    [0.18, 0.68, -0.08, 0.25, 'mid'],
    [0.26, 0.86, 0.1, 0.18, 'light'],
    [-0.08, 0.88, -0.04, 0.2, 'cut'],
    [0.03, 0.65, 0.16, 0.17, 'mid'],
  ] as const;
  for (const [index, [x, y, z, radius, shade]] of rocks.entries()) {
    const material = shade === 'dark'
      ? CARGO_MATERIALS.stoneDark
      : shade === 'light' || shade === 'cut'
        ? CARGO_MATERIALS.stoneLight
        : CARGO_MATERIALS.stoneMid;
    addNamedMesh(
      group,
      `Quarried stone ${index + 1}`,
      new THREE.DodecahedronGeometry(radius, 0),
      material,
      new THREE.Vector3(x, y, z),
      new THREE.Euler(index * 0.19, index * 0.37, index * 0.11),
      new THREE.Vector3(1, 0.84 + (index % 2) * 0.12, 0.92),
    );
  }
}

function addPolearmLoad(group: THREE.Group): void {
  for (let index = 0; index < 5; index += 1) {
    const x = -0.22 + index * 0.11;
    const y = 0.67 + (index % 2) * 0.07;
    addNamedMesh(
      group,
      `Polearm shaft ${index + 1}`,
      new THREE.CylinderGeometry(0.025, 0.03, 1.22, 6),
      timberMaterial(index % 2 ? 'light' : 'weathered'),
      new THREE.Vector3(x, y, 0),
      new THREE.Euler(Math.PI * 0.5, 0, 0),
    );
    addNamedMesh(
      group,
      `Polearm head ${index + 1}`,
      new THREE.ConeGeometry(0.075, 0.24, 5),
      metalMaterial('iron'),
      new THREE.Vector3(x, y, 0.72),
      new THREE.Euler(Math.PI * 0.5, 0, 0),
    );
  }
  for (const z of [-0.28, 0.28]) {
    addNamedMesh(
      group,
      'Polearm bundle rope',
      new THREE.BoxGeometry(0.58, 0.035, 0.04),
      CARGO_MATERIALS.rope,
      new THREE.Vector3(0, 0.83, z),
    );
  }
}

function addIronworkLoad(group: THREE.Group): void {
  addCrate(
    group,
    'Ironwork fitting crate',
    new THREE.Vector3(0, 0.63, 0),
    1.05,
  );
  for (const [index, [x, z, yaw]] of [
    [-0.2, -0.08, -0.22],
    [0, 0.06, 0.16],
    [0.2, -0.04, -0.1],
  ].entries()) {
    addNamedMesh(
      group,
      `Ironwork spearhead ${index + 1}`,
      new THREE.ConeGeometry(0.07, 0.28, 5),
      metalMaterial('iron'),
      new THREE.Vector3(x, 0.91, z),
      new THREE.Euler(0, 0, Math.PI * 0.5 + yaw),
    );
    addNamedMesh(
      group,
      `Ironwork socket ${index + 1}`,
      new THREE.CylinderGeometry(0.035, 0.05, 0.16, 7),
      metalMaterial('iron'),
      new THREE.Vector3(x - 0.17 * Math.cos(yaw), 0.91, z + 0.17 * Math.sin(yaw)),
      new THREE.Euler(0, 0, Math.PI * 0.5 + yaw),
    );
  }
}

function addWoolLoad(group: THREE.Group): void {
  for (const [index, [x, y, z, scale]] of ([
    [-0.2, 0.72, -0.06, 1],
    [0.2, 0.7, 0.05, 0.9],
    [0, 0.93, 0, 0.8],
  ] as const).entries()) {
    addNamedMesh(
      group,
      `Wool fleece bundle ${index + 1}`,
      new THREE.DodecahedronGeometry(0.3 * scale, 1),
      CARGO_MATERIALS.wool,
      new THREE.Vector3(x, y, z),
      new THREE.Euler(0.08, index * 0.35, index % 2 ? 0.06 : -0.05),
      new THREE.Vector3(1.15, 0.8, 0.95),
    );
  }
  for (const x of [-0.18, 0.18]) {
    addNamedMesh(
      group,
      'Wool bundle rope',
      new THREE.BoxGeometry(0.035, 0.52, 0.5),
      CARGO_MATERIALS.rope,
      new THREE.Vector3(x, 0.78, 0),
    );
  }
}

function addImportedIronLoad(group: THREE.Group): void {
  for (const [index, [x, y, z, yaw]] of ([
    [-0.2, 0.62, -0.12, 0.08],
    [0.15, 0.64, -0.06, -0.06],
    [-0.12, 0.78, 0.12, -0.04],
    [0.2, 0.8, 0.14, 0.07],
  ] as const).entries()) {
    addNamedMesh(
      group,
      `Imported iron bar ${index + 1}`,
      new THREE.BoxGeometry(0.62, 0.1, 0.1),
      CARGO_MATERIALS.ironBloom,
      new THREE.Vector3(x, y, z),
      new THREE.Euler(0, yaw, 0),
    );
  }
  addCrate(group, 'Imported iron bloom crate', new THREE.Vector3(0, 0.52, 0), 1);
}

function addSettlementIronLoad(group: THREE.Group): void {
  const baskets = [
    { x: -0.2, z: -0.04, yaw: 0.08 },
    { x: 0.2, z: 0.06, yaw: -0.06 },
  ] as const;
  for (const [basketIndex, basket] of baskets.entries()) {
    addBasket(
      group,
      `Local iron ore basket ${basketIndex + 1}`,
      new THREE.Vector3(basket.x, 0.6, basket.z),
      0.96,
    );
    for (let chunkIndex = 0; chunkIndex < 4; chunkIndex += 1) {
      const angle = basket.yaw + chunkIndex * Math.PI * 0.5;
      addNamedMesh(
        group,
        `Local iron ore chunk ${basketIndex * 4 + chunkIndex + 1}`,
        new THREE.IcosahedronGeometry(0.105 - chunkIndex * 0.008, 0),
        chunkIndex % 2 === 0
          ? CARGO_MATERIALS.ironOreRust
          : CARGO_MATERIALS.ironOreDark,
        new THREE.Vector3(
          basket.x + Math.cos(angle) * 0.075,
          0.76 + (chunkIndex % 2) * 0.045,
          basket.z + Math.sin(angle) * 0.075,
        ),
        new THREE.Euler(
          chunkIndex * 0.31,
          angle,
          chunkIndex * 0.19,
        ),
        new THREE.Vector3(1.15, 0.82, 0.94),
      );
    }
  }
}

function addClayLoad(group: THREE.Group): void {
  for (const [index, [x, z]] of ([
    [-0.22, -0.12],
    [0.22, -0.1],
    [-0.2, 0.18],
    [0.2, 0.18],
  ] as const).entries()) {
    addBasket(group, `Clay basket ${index + 1}`, new THREE.Vector3(x, 0.6, z), 0.9);
    addNamedMesh(
      group,
      `Clay basket load ${index + 1}`,
      new THREE.SphereGeometry(0.17, 8, 5),
      CARGO_MATERIALS.clay,
      new THREE.Vector3(x, 0.74, z),
      undefined,
      new THREE.Vector3(1, 0.48, 1),
    );
  }
}

function addAdriaticSaltLoad(group: THREE.Group): void {
  addSack(group, 'Adriatic salt sack 1', new THREE.Vector3(-0.2, 0.7, 0), 1, CARGO_MATERIALS.saltCanvas);
  addSack(group, 'Adriatic salt sack 2', new THREE.Vector3(0.2, 0.72, 0.04), 0.94, CARGO_MATERIALS.saltCanvas);
  addNamedMesh(
    group,
    'Visible coarse salt',
    new THREE.SphereGeometry(0.16, 8, 5),
    CARGO_MATERIALS.seaSalt,
    new THREE.Vector3(0, 0.96, -0.08),
    undefined,
    new THREE.Vector3(1.2, 0.4, 0.9),
  );
}

function addRockSaltLoad(group: THREE.Group): void {
  const baskets = [
    { x: -0.2, z: -0.06 },
    { x: 0.2, z: 0.08 },
  ] as const;
  for (const [basketIndex, basket] of baskets.entries()) {
    addBasket(
      group,
      `Rock salt basket ${basketIndex + 1}`,
      new THREE.Vector3(basket.x, 0.6, basket.z),
      0.96,
    );
    for (let chunkIndex = 0; chunkIndex < 4; chunkIndex += 1) {
      const angle = chunkIndex * Math.PI * 0.5 + basketIndex * 0.22;
      addNamedMesh(
        group,
        `Mined rock salt chunk ${basketIndex * 4 + chunkIndex + 1}`,
        new THREE.IcosahedronGeometry(0.1 - chunkIndex * 0.006, 0),
        CARGO_MATERIALS.rockSalt,
        new THREE.Vector3(
          basket.x + Math.cos(angle) * 0.075,
          0.76 + (chunkIndex % 2) * 0.045,
          basket.z + Math.sin(angle) * 0.075,
        ),
        new THREE.Euler(
          chunkIndex * 0.23,
          angle,
          chunkIndex * 0.17,
        ),
        new THREE.Vector3(1.08, 0.9, 0.92),
      );
    }
  }
}

function addCharcoalLoad(group: THREE.Group): void {
  for (const [index, [x, z, scale]] of ([
    [-0.2, -0.08, 1],
    [0.2, 0.02, 0.95],
    [0, 0.16, 0.82],
  ] as const).entries()) {
    addSack(
      group,
      `Charcoal sack ${index + 1}`,
      new THREE.Vector3(x, 0.68 + index * 0.1, z),
      scale,
      CARGO_MATERIALS.charcoal,
    );
  }
}

function addPotteryLoad(group: THREE.Group): void {
  for (const [index, [x, y, z, scale]] of ([
    [-0.22, 0.64, -0.1, 1],
    [0.22, 0.64, -0.08, 1],
    [-0.2, 0.82, 0.16, 0.9],
    [0.2, 0.82, 0.16, 0.9],
    [0, 0.96, 0, 0.78],
  ] as const).entries()) {
    addCrock(
      group,
      `Fired pottery vessel ${index + 1}`,
      new THREE.Vector3(x, y, z),
      scale,
      CARGO_MATERIALS.terracotta,
    );
  }
}

function addRoofTileLoad(group: THREE.Group): void {
  const stacks = [
    { x: -0.23, z: -0.12, yaw: -0.04 },
    { x: 0.23, z: -0.1, yaw: 0.05 },
    { x: 0, z: 0.2, yaw: -0.02 },
  ] as const;
  for (const [stackIndex, stack] of stacks.entries()) {
    for (let layer = 0; layer < 5; layer += 1) {
      addNamedMesh(
        group,
        `Fired roof tile stack ${stackIndex + 1} layer ${layer + 1}`,
        new THREE.BoxGeometry(0.34, 0.036, 0.48),
        layer % 2 === 0
          ? CARGO_MATERIALS.terracotta
          : CARGO_MATERIALS.darkTerracotta,
        new THREE.Vector3(stack.x, 0.59 + layer * 0.041, stack.z),
        new THREE.Euler(0, stack.yaw + (layer % 2) * 0.018, 0),
      );
    }
    addNamedMesh(
      group,
      `Fired roof tile stack ${stackIndex + 1} rope`,
      new THREE.BoxGeometry(0.035, 0.24, 0.54),
      CARGO_MATERIALS.rope,
      new THREE.Vector3(stack.x, 0.68, stack.z),
      new THREE.Euler(0, stack.yaw, 0),
    );
  }
}

function addManureLoad(group: THREE.Group): void {
  addNamedMesh(
    group,
    'Manure cart heap',
    new THREE.DodecahedronGeometry(0.47, 1),
    CARGO_MATERIALS.manure,
    new THREE.Vector3(0, 0.72, 0),
    new THREE.Euler(0.04, 0.2, -0.03),
    new THREE.Vector3(1.3, 0.68, 0.95),
  );
  for (const [index, [x, y, z, rotation]] of ([
    [-0.3, 0.92, -0.08, 0.8],
    [0.04, 1.0, 0.02, -0.5],
    [0.3, 0.9, 0.13, 0.42],
  ] as const).entries()) {
    addNamedMesh(
      group,
      `Manure bedding straw ${index + 1}`,
      new THREE.CylinderGeometry(0.012, 0.016, 0.62, 5),
      CARGO_MATERIALS.manureStraw,
      new THREE.Vector3(x, y, z),
      new THREE.Euler(0.08, rotation, Math.PI * 0.5),
    );
  }
}

function addFlaxLoad(group: THREE.Group): void {
  for (const [bundleIndex, [z, y]] of ([
    [-0.16, 0.7],
    [0.16, 0.72],
    [0, 0.9],
  ] as const).entries()) {
    for (let stem = 0; stem < 7; stem += 1) {
      const x = (stem - 3) * 0.055;
      addNamedMesh(
        group,
        `Flax bundle ${bundleIndex + 1} stem ${stem + 1}`,
        new THREE.CylinderGeometry(0.012, 0.016, 0.72, 5),
        CARGO_MATERIALS.flax,
        new THREE.Vector3(x, y, z),
        new THREE.Euler(0, 0, Math.PI * 0.5 + (stem % 2 === 0 ? 0.03 : -0.03)),
      );
    }
    addNamedMesh(
      group,
      `Flax bundle ${bundleIndex + 1} rope`,
      new THREE.BoxGeometry(0.035, 0.43, 0.035),
      CARGO_MATERIALS.rope,
      new THREE.Vector3(0, y, z),
    );
  }
}

function addYarnLoad(group: THREE.Group): void {
  for (const [index, [x, y, z, yaw]] of ([
    [-0.2, 0.7, -0.08, -0.08],
    [0.2, 0.71, 0.06, 0.1],
    [0, 0.93, 0.01, -0.03],
  ] as const).entries()) {
    addNamedMesh(
      group,
      `Yarn skein ${index + 1}`,
      new THREE.TorusGeometry(0.18, 0.045, 7, 14),
      CARGO_MATERIALS.yarn,
      new THREE.Vector3(x, y, z),
      new THREE.Euler(Math.PI * 0.5, yaw, 0),
      new THREE.Vector3(1.45, 0.7, 1),
    );
    addNamedMesh(
      group,
      `Yarn skein tie ${index + 1}`,
      new THREE.BoxGeometry(0.055, 0.08, 0.34),
      CARGO_MATERIALS.rope,
      new THREE.Vector3(x, y, z),
      new THREE.Euler(0, yaw, 0),
    );
  }
}

function addLinenLoad(group: THREE.Group): void {
  for (const [index, [x, y, z, yaw]] of ([
    [-0.2, 0.7, -0.08, -0.08],
    [0.21, 0.71, 0.06, 0.07],
    [0, 0.93, 0, -0.02],
  ] as const).entries()) {
    addNamedMesh(
      group,
      `Linen bolt ${index + 1}`,
      new THREE.CylinderGeometry(0.145, 0.145, 0.58, 10),
      CARGO_MATERIALS.linen,
      new THREE.Vector3(x, y, z),
      new THREE.Euler(0, yaw, Math.PI * 0.5),
    );
    addNamedMesh(
      group,
      `Linen bolt core ${index + 1}`,
      new THREE.CylinderGeometry(0.035, 0.035, 0.64, 8),
      timberMaterial('dark'),
      new THREE.Vector3(x, y, z),
      new THREE.Euler(0, yaw, Math.PI * 0.5),
    );
  }
}

function addClothLoad(group: THREE.Group): void {
  for (const [index, [x, y, z, material]] of ([
    [-0.18, 0.72, -0.04, CARGO_MATERIALS.clothRed],
    [0.19, 0.69, 0.04, CARGO_MATERIALS.clothBlue],
    [0, 0.94, 0, CARGO_MATERIALS.flourCanvas],
  ] as const).entries()) {
    addNamedMesh(
      group,
      `Woven cloth roll ${index + 1}`,
      new THREE.CylinderGeometry(0.16, 0.16, 0.58, 10),
      material,
      new THREE.Vector3(x, y, z),
      new THREE.Euler(0, 0, Math.PI * 0.5),
    );
    addNamedMesh(
      group,
      `Cloth roll core ${index + 1}`,
      new THREE.CylinderGeometry(0.04, 0.04, 0.64, 8),
      timberMaterial('dark'),
      new THREE.Vector3(x, y, z),
      new THREE.Euler(0, 0, Math.PI * 0.5),
    );
  }
}

function addCutLog(
  group: THREE.Group,
  name: string,
  center: THREE.Vector3,
  length: number,
  radius: number,
  axis: 'x' | 'z',
  shade: 'mid' | 'weathered',
): void {
  const rotation = axis === 'x'
    ? new THREE.Euler(0, 0, Math.PI * 0.5)
    : new THREE.Euler(Math.PI * 0.5, 0, 0);
  addNamedMesh(
    group,
    name,
    new THREE.CylinderGeometry(radius * 0.9, radius, length, 7),
    timberMaterial(shade),
    center,
    rotation,
  );
  for (const direction of [-1, 1]) {
    const capPosition = center.clone();
    if (axis === 'x') capPosition.x += direction * length * 0.5;
    else capPosition.z += direction * length * 0.5;
    addNamedMesh(
      group,
      `${name} cut end`,
      new THREE.CylinderGeometry(radius * 0.82, radius * 0.86, 0.018, 7),
      timberMaterial('light'),
      capPosition,
      rotation,
    );
  }
}

function addBarrel(
  group: THREE.Group,
  name: string,
  center: THREE.Vector3,
  scale: number,
  ironBands: boolean,
): void {
  const radius = 0.24 * scale;
  const height = 0.54 * scale;
  addNamedMesh(
    group,
    name,
    new THREE.CylinderGeometry(radius * 0.91, radius * 0.91, height, 10),
    timberMaterial('mid'),
    center,
  );
  addNamedMesh(
    group,
    `${name} middle staves`,
    new THREE.CylinderGeometry(radius, radius, height * 0.58, 10),
    timberMaterial('weathered'),
    center,
  );
  const bandMaterial = ironBands ? metalMaterial('iron') : timberMaterial('dark');
  for (const yOffset of [-height * 0.34, 0, height * 0.34]) {
    addNamedMesh(
      group,
      `${name} band`,
      new THREE.TorusGeometry(radius * 0.96, 0.025 * scale, 5, 12),
      bandMaterial,
      center.clone().add(new THREE.Vector3(0, yOffset, 0)),
      new THREE.Euler(Math.PI * 0.5, 0, 0),
    );
  }
  for (const yOffset of [-height * 0.5, height * 0.5]) {
    addNamedMesh(
      group,
      `${name} lid`,
      new THREE.CylinderGeometry(radius * 0.9, radius * 0.9, 0.025, 10),
      timberMaterial('dark'),
      center.clone().add(new THREE.Vector3(0, yOffset, 0)),
    );
  }
}

function addSack(
  group: THREE.Group,
  name: string,
  center: THREE.Vector3,
  scale: number,
  material: THREE.Material,
): void {
  addNamedMesh(
    group,
    name,
    new THREE.SphereGeometry(0.24 * scale, 8, 6),
    material,
    center,
    new THREE.Euler(0, 0, -0.06),
    new THREE.Vector3(0.82, 1.3, 0.76),
  );
  addNamedMesh(
    group,
    `${name} tied neck`,
    new THREE.CylinderGeometry(
      0.06 * scale,
      0.12 * scale,
      0.18 * scale,
      7,
    ),
    material,
    center.clone().add(new THREE.Vector3(0, 0.35 * scale, 0)),
  );
  addNamedMesh(
    group,
    `${name} tie`,
    new THREE.TorusGeometry(0.065 * scale, 0.015, 5, 8),
    CARGO_MATERIALS.rope,
    center.clone().add(new THREE.Vector3(0, 0.29 * scale, 0)),
    new THREE.Euler(Math.PI * 0.5, 0, 0),
  );
}

function addBasket(
  group: THREE.Group,
  name: string,
  center: THREE.Vector3,
  scale: number,
): void {
  addNamedMesh(
    group,
    name,
    new THREE.CylinderGeometry(0.21 * scale, 0.27 * scale, 0.25 * scale, 10),
    timberMaterial('light'),
    center,
  );
  addNamedMesh(
    group,
    `${name} rim`,
    new THREE.TorusGeometry(0.22 * scale, 0.025 * scale, 5, 12),
    timberMaterial('dark'),
    center.clone().add(new THREE.Vector3(0, 0.14 * scale, 0)),
    new THREE.Euler(Math.PI * 0.5, 0, 0),
  );
}

function addCrate(
  group: THREE.Group,
  name: string,
  center: THREE.Vector3,
  scale: number,
): void {
  addNamedMesh(
    group,
    name,
    new THREE.BoxGeometry(0.48 * scale, 0.24 * scale, 0.4 * scale),
    timberMaterial('weathered'),
    center,
  );
  for (const yOffset of [-0.085, 0.085]) {
    addNamedMesh(
      group,
      `${name} slat`,
      new THREE.BoxGeometry(0.52 * scale, 0.045 * scale, 0.425 * scale),
      timberMaterial('dark'),
      center.clone().add(new THREE.Vector3(0, yOffset * scale, 0)),
    );
  }
}

function addCrock(
  group: THREE.Group,
  name: string,
  center: THREE.Vector3,
  scale: number,
  material: THREE.Material,
): void {
  addNamedMesh(
    group,
    name,
    new THREE.SphereGeometry(0.15 * scale, 9, 7),
    material,
    center,
    undefined,
    new THREE.Vector3(1, 1.15, 1),
  );
  addNamedMesh(
    group,
    `${name} neck`,
    new THREE.CylinderGeometry(
      0.08 * scale,
      0.11 * scale,
      0.14 * scale,
      9,
    ),
    material,
    center.clone().add(new THREE.Vector3(0, 0.18 * scale, 0)),
  );
  addNamedMesh(
    group,
    `${name} cloth lid`,
    new THREE.CylinderGeometry(0.095 * scale, 0.095 * scale, 0.025, 9),
    CARGO_MATERIALS.crockCloth,
    center.clone().add(new THREE.Vector3(0, 0.255 * scale, 0)),
  );
  addNamedMesh(
    group,
    `${name} lid tie`,
    new THREE.TorusGeometry(0.09 * scale, 0.012, 5, 9),
    CARGO_MATERIALS.rope,
    center.clone().add(new THREE.Vector3(0, 0.235 * scale, 0)),
    new THREE.Euler(Math.PI * 0.5, 0, 0),
  );
}

function addAmphora(group: THREE.Group, center: THREE.Vector3, scale: number): void {
  const name = 'Wine amphora';
  addNamedMesh(
    group,
    name,
    new THREE.SphereGeometry(0.2 * scale, 9, 7),
    CARGO_MATERIALS.darkTerracotta,
    center,
    undefined,
    new THREE.Vector3(0.86, 1.25, 0.86),
  );
  addNamedMesh(
    group,
    `${name} neck`,
    new THREE.CylinderGeometry(
      0.075 * scale,
      0.11 * scale,
      0.24 * scale,
      9,
    ),
    CARGO_MATERIALS.darkTerracotta,
    center.clone().add(new THREE.Vector3(0, 0.29 * scale, 0)),
  );
  addNamedMesh(
    group,
    `${name} lip`,
    new THREE.TorusGeometry(0.078 * scale, 0.018, 5, 10),
    CARGO_MATERIALS.terracotta,
    center.clone().add(new THREE.Vector3(0, 0.42 * scale, 0)),
    new THREE.Euler(Math.PI * 0.5, 0, 0),
  );
  for (const xOffset of [-0.14, 0.14]) {
    addNamedMesh(
      group,
      `${name} handle`,
      new THREE.TorusGeometry(0.075 * scale, 0.018, 5, 9),
      CARGO_MATERIALS.darkTerracotta,
      center.clone().add(new THREE.Vector3(xOffset * scale, 0.24 * scale, 0)),
    );
  }
}

function addNamedMesh(
  group: THREE.Group,
  name: string,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  position: THREE.Vector3,
  rotation?: THREE.Euler,
  scale?: THREE.Vector3,
): THREE.Mesh {
  const mesh = addMesh(
    group,
    geometry,
    material,
    position,
    rotation,
    scale,
  );
  mesh.name = name;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return mesh;
}

export function deliveryCartMeshName(
  kind: DeliveryCargoKind,
  hasModelSource: boolean,
  regionalImport = false,
  loaded = true,
): string {
  return `DeliveryCart:${kind}:${
    regionalImport ? 'regional-import' : 'settlement'
  }:${loaded ? 'loaded' : 'empty'}:${hasModelSource ? 'quaternius' : 'fallback'}`;
}

export function fireBucketCarrierMeshName(): string {
  return 'DeliveryFireBucketCarrier';
}

export function createFireBucketCarrierMesh(): THREE.Group {
  const group = new THREE.Group();
  group.name = fireBucketCarrierMeshName();
  group.userData.deliveryCartAsset = 'fire-bucket-carrier';

  for (const x of [-0.264, 0.264]) {
    addNamedMesh(
      group,
      'Fire bucket hand rail',
      new THREE.BoxGeometry(0.055, 0.055, 1.18),
      timberMaterial('dark'),
      new THREE.Vector3(x, 0.68, 0.66),
    );
  }
  addNamedMesh(
    group,
    'Fire bucket carrier crossbar',
    new THREE.BoxGeometry(0.68, 0.08, 0.08),
    timberMaterial('mid'),
    new THREE.Vector3(0, 0.57, 0.16),
  );

  for (const x of [-0.2, 0.2]) {
    addNamedMesh(
      group,
      'Filled firefighting bucket',
      new THREE.CylinderGeometry(0.18, 0.145, 0.42, 12, 1, true),
      FIRE_BUCKET_MATERIAL,
      new THREE.Vector3(x, 0.36, 0.08),
    );
    addNamedMesh(
      group,
      'Firefighting bucket water',
      new THREE.CircleGeometry(0.158, 12),
      FIRE_BUCKET_WATER_MATERIAL,
      new THREE.Vector3(x, 0.575, 0.08),
      new THREE.Euler(-Math.PI * 0.5, 0, 0),
    );
    addNamedMesh(
      group,
      'Firefighting bucket bail',
      new THREE.TorusGeometry(0.18, 0.018, 5, 14, Math.PI),
      metalMaterial(),
      new THREE.Vector3(x, 0.57, 0.08),
    );
  }
  return group;
}

export function createDeliveryCartMesh(
  kind: DeliveryCargoKind,
  options: DeliveryCartMeshOptions = {},
): THREE.Group {
  const group = new THREE.Group();
  const source = options.source ?? null;
  const regionalImport = options.regionalImport === true;
  const loaded = options.loaded !== false;
  group.name = deliveryCartMeshName(kind, source != null, regionalImport, loaded);
  group.userData.deliveryCartAsset = source ? 'quaternius-medieval-cart' : 'procedural-fallback';
  group.userData.deliveryCargoProvenance = regionalImport
    ? 'regional-import'
    : 'settlement';
  group.userData.deliveryCargoStatus = loaded ? 'loaded' : 'empty';

  if (source) {
    addQuaterniusCart(group, source, options.appearanceSeed ?? 0);
  } else {
    addProceduralCart(group);
  }

  if (loaded) {
    const cargoRoot = new THREE.Group();
    cargoRoot.name = regionalImport
      ? `Regional import cargo: ${kind}`
      : `Cart cargo: ${kind}`;
    if (source) {
      cargoRoot.scale.setScalar(0.76);
      cargoRoot.position.set(0, 0.08, 0.08);
    }
    addCargo(cargoRoot, kind, regionalImport);
    group.add(cargoRoot);
  }
  return group;
}

export async function loadDeliveryCartModelSource(): Promise<DeliveryCartModelSource> {
  const gltf = await new GLTFLoader().loadAsync(MODEL_URL);
  const bounds = new THREE.Box3().setFromObject(gltf.scene);
  const sourceHeight = bounds.max.y - bounds.min.y;
  if (!Number.isFinite(sourceHeight) || sourceHeight <= 0.001) {
    throw new Error(`Invalid delivery cart model bounds for ${MODEL_URL}`);
  }
  return { scene: gltf.scene, bounds, sourceHeight };
}

export function disposeDeliveryCartMesh(group: THREE.Group): void {
  const ownedMaterials = new Set<THREE.Material>(
    Array.isArray(group.userData.ownedCartMaterials)
      ? group.userData.ownedCartMaterials as THREE.Material[]
      : [],
  );
  group.traverse((object) => {
    const mesh = object as THREE.Mesh;
    mesh.geometry?.dispose();
  });
  for (const material of ownedMaterials) material.dispose();
}

export function disposeDeliveryCartModelSource(source: DeliveryCartModelSource): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  source.scene.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.geometry) geometries.add(mesh.geometry);
    const meshMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of meshMaterials) {
      if (!material) continue;
      materials.add(material);
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) textures.add(value);
      }
    }
  });
  for (const texture of textures) texture.dispose();
  for (const material of materials) material.dispose();
  for (const geometry of geometries) geometry.dispose();
}

function addQuaterniusCart(
  group: THREE.Group,
  source: DeliveryCartModelSource,
  appearanceSeed: number,
): void {
  const model = source.scene.clone(true);
  model.name = 'Quaternius medieval canopy cart';
  const palette = CANOPY_PALETTES[
    Math.abs(appearanceSeed) % CANOPY_PALETTES.length
  ] ?? CANOPY_PALETTES[0];
  const ownedMaterials: THREE.Material[] = [];

  model.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry = mesh.geometry.clone();
    const sourceMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const materials = sourceMaterials.map((material) => {
      const clone = material.clone();
      const standard = clone as THREE.MeshStandardMaterial;
      const materialName = material.name.toLowerCase();
      if (standard.color && materialName === 'red') standard.color.setHex(palette.primary);
      if (standard.color && materialName === 'beige') standard.color.setHex(palette.cloth);
      if (standard.color) {
        standard.roughness = 0.9;
        standard.metalness = materialName.includes('stone') ? 0.08 : 0;
      }
      ownedMaterials.push(clone);
      return clone;
    });
    mesh.material = Array.isArray(mesh.material) ? materials : materials[0]!;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;
  });

  const scale = MODEL_TARGET_HEIGHT / source.sourceHeight;
  model.scale.setScalar(scale);
  model.position.y = -source.bounds.min.y * scale + 0.01;
  group.userData.ownedCartMaterials = ownedMaterials;
  group.add(model);
}

function addProceduralCart(group: THREE.Group): void {
  const frame = timberMaterial('mid');
  addMesh(group, new THREE.BoxGeometry(1.15, 0.14, 0.72), frame, new THREE.Vector3(0, 0.42, 0));
  addMesh(group, new THREE.BoxGeometry(0.12, 0.55, 0.72), frame, new THREE.Vector3(-0.48, 0.68, 0));
  addMesh(group, new THREE.BoxGeometry(0.12, 0.42, 0.72), frame, new THREE.Vector3(0.48, 0.62, 0));

  const wheelGeometry = new THREE.CylinderGeometry(0.22, 0.22, 0.12, 12);
  addMesh(
    group,
    wheelGeometry,
    WHEEL_MATERIAL,
    new THREE.Vector3(-0.42, 0.22, 0.34),
    new THREE.Euler(Math.PI * 0.5, 0, 0),
  );
  addMesh(
    group,
    wheelGeometry.clone(),
    WHEEL_MATERIAL,
    new THREE.Vector3(-0.42, 0.22, -0.34),
    new THREE.Euler(Math.PI * 0.5, 0, 0),
  );
  addMesh(
    group,
    wheelGeometry.clone(),
    WHEEL_MATERIAL,
    new THREE.Vector3(0.42, 0.22, 0.34),
    new THREE.Euler(Math.PI * 0.5, 0, 0),
  );
  addMesh(
    group,
    wheelGeometry.clone(),
    WHEEL_MATERIAL,
    new THREE.Vector3(0.42, 0.22, -0.34),
    new THREE.Euler(Math.PI * 0.5, 0, 0),
  );
}
