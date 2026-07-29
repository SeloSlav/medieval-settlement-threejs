import * as THREE from 'three';
import { addTriangularGableWall } from '../buildings/meshPrimitives.ts';
import { addLogPile } from '../buildings/logPile.ts';
import { createResidenceShadowProxy } from '../buildings/buildingShadowProxy.ts';
import {
  addMesh,
  residenceFacadeMaterial,
  residenceRoofMaterial,
  sharedBuildingDetailMaterial,
  sharedBuildingMaterial,
  stoneMaterial,
  timberMaterial,
} from '../buildings/buildingMaterials.ts';
import { areBuildingShadowsEnabled } from '../scene/shadowPreference.ts';
import { ChimneySmokeEmitter } from './ResidenceChimneySmoke.ts';
import {
  pickResidenceAppearance,
  residenceGroundDoorLocalX,
  type ResidenceArchetype,
  type ResidenceTrimColor,
} from './residenceAppearance.ts';
import { getNeedStock } from './residenceNeedState.ts';
import {
  residenceHasActiveProject,
  type ResidenceState,
} from '../resources/types.ts';
import { RESIDENCE_FIREWOOD_CAPACITY } from '../generated/gameBalance.ts';
import { hashStringSeed } from '../utils/random.ts';
import type { GameClock } from '../world/gameCalendar.ts';
import { residenceWindowActivity } from './householdRoutine.ts';
import type { NightPolicyState } from '../economy/nightPolicy.ts';

const WINDOW_GLOW_EMISSIVE = 0xffc060;
const WINDOW_GLOW_COLOR = 0x4a3820;
const WINDOW_DARK_EMISSIVE = 0x18201f;
const WINDOW_DARK_COLOR = 0x303a39;

function createWindowMaterial(): THREE.MeshStandardMaterial {
  const material = sharedBuildingMaterial('glass').clone();
  material.name = 'Residence window (dynamic glow)';
  material.userData.sharedBuildingMaterial = false;
  material.emissive.setHex(WINDOW_DARK_EMISSIVE);
  material.emissiveIntensity = 0.15;
  return material;
}

export function applyResidenceWindowGlow(
  material: THREE.MeshStandardMaterial,
  eveningGlow: number,
  occupied: boolean,
): void {
  const amount = occupied ? eveningGlow : eveningGlow * 0.06;
  material.color.setHex(lerpColor(WINDOW_DARK_COLOR, WINDOW_GLOW_COLOR, amount));
  material.emissive.setHex(lerpColor(WINDOW_DARK_EMISSIVE, WINDOW_GLOW_EMISSIVE, amount));
  material.emissiveIntensity = 0.12 + amount * 1.15;
}

function lerpColor(a: number, b: number, t: number): number {
  const mix = Math.min(1, Math.max(0, t));
  const ar = (a >> 16) & 255;
  const ag = (a >> 8) & 255;
  const ab = a & 255;
  const br = (b >> 16) & 255;
  const bg = (b >> 8) & 255;
  const bb = b & 255;
  const r = Math.round(ar + (br - ar) * mix);
  const g = Math.round(ag + (bg - ag) * mix);
  const bl = Math.round(ab + (bb - ab) * mix);
  return (r << 16) | (g << 8) | bl;
}

type HouseDimensions = {
  width: number;
  depth: number;
  foundationHeight: number;
  groundHeight: number;
  upperHeight: number;
  ridgeHeight: number;
};

function dimensionsForArchetype(archetype: ResidenceArchetype): HouseDimensions {
  switch (archetype) {
    case 'stone_portal':
      return { width: 6.3, depth: 7.05, foundationHeight: 0.48, groundHeight: 2.42, upperHeight: 2.34, ridgeHeight: 2.5 };
    case 'timber_balcony':
      return { width: 6.0, depth: 6.45, foundationHeight: 0.5, groundHeight: 2.38, upperHeight: 2.32, ridgeHeight: 2.42 };
    case 'working_lean_to':
      return { width: 5.65, depth: 6.7, foundationHeight: 0.46, groundHeight: 2.36, upperHeight: 2.28, ridgeHeight: 2.38 };
  }
}

function dimensionsForTier(archetype: ResidenceArchetype, tier: 1 | 2 | 3): HouseDimensions {
  const base = dimensionsForArchetype(archetype);
  if (tier === 1) return { width: base.width * 0.82, depth: base.depth * 0.82, foundationHeight: 0.38, groundHeight: 2.18, upperHeight: 0.62, ridgeHeight: 1.85 };
  if (tier === 3) return { width: base.width * 1.22, depth: base.depth * 1.14, foundationHeight: 0.62, groundHeight: 2.58, upperHeight: 2.55, ridgeHeight: 2.78 };
  return base;
}

function residenceTrimMaterial(trim: ResidenceTrimColor): THREE.MeshStandardMaterial {
  if (trim === 'red') return sharedBuildingDetailMaterial('paintRed');
  if (trim === 'blue') return sharedBuildingDetailMaterial('paintBlue');
  if (trim === 'green') return sharedBuildingMaterial('moss');
  return sharedBuildingMaterial('timberDark');
}

function addFrontWindow(
  group: THREE.Group,
  windowMaterial: THREE.MeshStandardMaterial,
  shutterMaterial: THREE.MeshStandardMaterial,
  x: number,
  y: number,
  z: number,
  width = 0.82,
  height = 1.12,
  shutters = true,
): void {
  addMesh(
    group,
    new THREE.BoxGeometry(width + 0.22, height + 0.22, 0.08),
    stoneMaterial('light'),
    new THREE.Vector3(x, y, z),
  );
  addMesh(
    group,
    new THREE.BoxGeometry(width, height, 0.075),
    windowMaterial,
    new THREE.Vector3(x, y, z + 0.065),
  );
  addMesh(
    group,
    new THREE.BoxGeometry(width + 0.28, 0.1, 0.2),
    stoneMaterial('mortar'),
    new THREE.Vector3(x, y - height * 0.5 - 0.1, z + 0.09),
  );
  const mullion = addMesh(
    group,
    new THREE.BoxGeometry(0.055, height * 0.88, 0.055),
    timberMaterial('dark'),
    new THREE.Vector3(x, y, z + 0.125),
  );
  mullion.name = 'Residence front window vertical mullion';
  const transom = addMesh(
    group,
    new THREE.BoxGeometry(width * 0.88, 0.055, 0.055),
    timberMaterial('dark'),
    new THREE.Vector3(x, y, z + 0.13),
  );
  transom.name = 'Residence front window horizontal transom';
  if (!shutters) return;

  for (const side of [-1, 1] as const) {
    addMesh(
      group,
      new THREE.BoxGeometry(width * 0.32, height * 0.92, 0.07),
      shutterMaterial,
      new THREE.Vector3(x + side * (width * 0.7), y, z + 0.08),
    );
  }
}

function addSideWindow(
  group: THREE.Group,
  windowMaterial: THREE.MeshStandardMaterial,
  side: -1 | 1,
  x: number,
  y: number,
  z: number,
  width = 0.78,
  height = 1.08,
): void {
  addMesh(
    group,
    new THREE.BoxGeometry(0.08, height + 0.22, width + 0.22),
    stoneMaterial('light'),
    new THREE.Vector3(x, y, z),
  );
  addMesh(
    group,
    new THREE.BoxGeometry(0.075, height, width),
    windowMaterial,
    new THREE.Vector3(x + side * 0.065, y, z),
  );
  addMesh(
    group,
    new THREE.BoxGeometry(0.18, 0.1, width + 0.28),
    stoneMaterial('mortar'),
    new THREE.Vector3(x + side * 0.09, y - height * 0.5 - 0.1, z),
  );
  const mullion = addMesh(
    group,
    new THREE.BoxGeometry(0.055, height * 0.88, 0.055),
    timberMaterial('dark'),
    new THREE.Vector3(x + side * 0.125, y, z),
  );
  mullion.name = 'Residence side window vertical mullion';
  const transom = addMesh(
    group,
    new THREE.BoxGeometry(0.055, 0.055, width * 0.88),
    timberMaterial('dark'),
    new THREE.Vector3(x + side * 0.13, y, z),
  );
  transom.name = 'Residence side window horizontal transom';
}

function addPlankDoor(
  group: THREE.Group,
  x: number,
  baseY: number,
  z: number,
  width = 1.02,
  height = 1.92,
): void {
  addMesh(
    group,
    new THREE.BoxGeometry(width + 0.38, height + 0.24, 0.1),
    stoneMaterial('light'),
    new THREE.Vector3(x, baseY + height * 0.5, z),
  );
  addMesh(
    group,
    new THREE.BoxGeometry(width, height, 0.12),
    timberMaterial('dark'),
    new THREE.Vector3(x, baseY + height * 0.5, z + 0.075),
  );
  for (let plank = -1; plank <= 1; plank++) {
    addMesh(
      group,
      new THREE.BoxGeometry(0.26, height * 0.88, 0.055),
      plank === 0 ? timberMaterial('mid') : timberMaterial('weathered'),
      new THREE.Vector3(x + plank * 0.29, baseY + height * 0.5, z + 0.155),
    );
  }
  for (const y of [baseY + 0.45, baseY + 1.36]) {
    addMesh(
      group,
      new THREE.BoxGeometry(width * 0.82, 0.075, 0.055),
      timberMaterial('dark'),
      new THREE.Vector3(x, y, z + 0.205),
    );
  }
}

function addStoneStoreyCourses(
  group: THREE.Group,
  width: number,
  depth: number,
  foundationHeight: number,
  groundHeight: number,
): void {
  for (let course = 1; course <= 3; course++) {
    addMesh(
      group,
      new THREE.BoxGeometry(width + 0.04, 0.035, depth + 0.04),
      stoneMaterial('mortar'),
      new THREE.Vector3(0, foundationHeight + groundHeight * (course / 4), 0),
    );
  }
}

function addRoofCourses(
  group: THREE.Group,
  material: THREE.Material,
  halfWidth: number,
  depth: number,
  wallTop: number,
  ridgeHeight: number,
  roofPitch: number,
): void {
  for (const side of [-1, 1] as const) {
    for (let row = 0; row < 4; row++) {
      const t = (row + 0.45) / 4.8;
      addMesh(
        group,
        new THREE.BoxGeometry(0.07, 0.06, depth + 0.46),
        material,
        new THREE.Vector3(side * halfWidth * (1 - t), wallTop + ridgeHeight * t + 0.02, 0),
        new THREE.Euler(0, 0, side * -roofPitch),
      );
    }
  }
}

function addStonePortalPorch(
  group: THREE.Group,
  entryX: number,
  frontZ: number,
  foundationHeight: number,
): void {
  for (const side of [-1, 1] as const) {
    addMesh(
      group,
      new THREE.BoxGeometry(0.16, 1.72, 0.16),
      timberMaterial('dark'),
      new THREE.Vector3(entryX + side * 0.68, foundationHeight + 0.86, frontZ + 0.7),
    );
  }
  addMesh(
    group,
    new THREE.BoxGeometry(1.7, 0.12, 1.08),
    residenceRoofMaterial('red'),
    new THREE.Vector3(entryX, foundationHeight + 1.77, frontZ + 0.36),
    new THREE.Euler(-0.16, 0, 0),
  );
}

function addTimberBalcony(
  group: THREE.Group,
  entrySide: -1 | 1,
  frontZ: number,
  floorY: number,
): void {
  const width = 4.4;
  const depth = 0.62;
  const deckZ = frontZ + depth * 0.52;
  addMesh(
    group,
    new THREE.BoxGeometry(width, 0.16, depth),
    timberMaterial('mid'),
    new THREE.Vector3(0, floorY, deckZ),
  );
  for (const x of [-2.0, -1.0, 0, 1.0, 2.0]) {
    addMesh(
      group,
      new THREE.BoxGeometry(0.11, 0.82, 0.11),
      timberMaterial('dark'),
      new THREE.Vector3(x, floorY + 0.46, deckZ + depth * 0.42),
    );
  }
  addMesh(
    group,
    new THREE.BoxGeometry(width + 0.08, 0.1, 0.1),
    timberMaterial('weathered'),
    new THREE.Vector3(0, floorY + 0.84, deckZ + depth * 0.42),
  );
  addMesh(
    group,
    new THREE.BoxGeometry(0.12, 1.95, 0.12),
    timberMaterial('dark'),
    new THREE.Vector3(-entrySide * 2.0, floorY - 0.75, deckZ),
  );
}

function addWorkingLeanTo(
  group: THREE.Group,
  side: -1 | 1,
  halfWidth: number,
  foundationHeight: number,
): void {
  const annexWidth = 0.74;
  const annexHeight = 1.78;
  const x = side * (halfWidth + annexWidth * 0.48);
  addMesh(
    group,
    new THREE.BoxGeometry(annexWidth, annexHeight, 3.4),
    timberMaterial('weathered'),
    new THREE.Vector3(x, foundationHeight + annexHeight * 0.5, -0.28),
  );
  addMesh(
    group,
    new THREE.BoxGeometry(annexWidth + 0.22, 0.12, 3.68),
    residenceRoofMaterial('brown'),
    new THREE.Vector3(x, foundationHeight + annexHeight + 0.12, -0.28),
    new THREE.Euler(0, 0, side * 0.18),
  );
}

function addResidenceUpgradeWorks(
  residence: THREE.Group,
  dimensions: HouseDimensions,
): void {
  const works = new THREE.Group();
  works.name = 'ResidenceUpgradeWorks';
  works.visible = false;
  residence.add(works);

  const halfWidth = dimensions.width * 0.5 + 0.48;
  const halfDepth = dimensions.depth * 0.5 + 0.48;
  const scaffoldHeight =
    dimensions.foundationHeight + dimensions.groundHeight + dimensions.upperHeight + 0.65;
  for (const x of [-halfWidth, halfWidth]) {
    for (const z of [-halfDepth, halfDepth]) {
      const post = addMesh(
        works,
        new THREE.CylinderGeometry(0.07, 0.085, scaffoldHeight, 7),
        timberMaterial('weathered'),
        new THREE.Vector3(x, scaffoldHeight * 0.5, z),
      );
      post.name = 'UpgradeScaffoldPost';
    }
  }
  for (const y of [1.15, Math.max(2.25, scaffoldHeight * 0.58), scaffoldHeight - 0.18]) {
    for (const z of [-halfDepth, halfDepth]) {
      const rail = addMesh(
        works,
        new THREE.BoxGeometry(dimensions.width + 1.15, 0.1, 0.1),
        timberMaterial('weathered'),
        new THREE.Vector3(0, y, z),
      );
      rail.name = 'UpgradeScaffoldRail';
    }
    for (const x of [-halfWidth, halfWidth]) {
      const rail = addMesh(
        works,
        new THREE.BoxGeometry(0.1, 0.1, dimensions.depth + 1.15),
        timberMaterial('weathered'),
        new THREE.Vector3(x, y, 0),
      );
      rail.name = 'UpgradeScaffoldRail';
    }
  }
  for (const x of [-halfWidth, halfWidth]) {
    const platform = addMesh(
      works,
      new THREE.BoxGeometry(0.58, 0.1, dimensions.depth + 1.05),
      timberMaterial('weathered'),
      new THREE.Vector3(x, Math.max(2.2, scaffoldHeight * 0.56), 0),
    );
    platform.name = 'UpgradeScaffoldPlatform';
  }

  const pileZ = halfDepth + 0.9;
  for (let index = 0; index < 8; index += 1) {
    const timber = addMesh(
      works,
      new THREE.CylinderGeometry(0.1, 0.12, 1.45, 7),
      timberMaterial(index % 2 === 0 ? 'light' : 'weathered'),
      new THREE.Vector3(
        -halfWidth + 0.75 + (index % 2) * 0.23,
        0.13 + Math.floor(index / 2) * 0.17,
        pileZ + Math.floor(index / 2) * 0.04,
      ),
      new THREE.Euler(0, 0, Math.PI * 0.5),
    );
    timber.name = `UpgradeTimberSegment:${index}`;
  }
  for (let index = 0; index < 8; index += 1) {
    const stone = addMesh(
      works,
      new THREE.BoxGeometry(0.34 + (index % 2) * 0.06, 0.24, 0.3),
      stoneMaterial(index % 3 === 0 ? 'light' : 'mid'),
      new THREE.Vector3(
        halfWidth - 0.75 + (index % 2) * 0.28,
        0.12 + Math.floor(index / 4) * 0.24,
        pileZ + Math.floor((index % 4) / 2) * 0.3,
      ),
      new THREE.Euler(0, (index % 3 - 1) * 0.12, 0),
    );
    stone.name = `UpgradeStoneSegment:${index}`;
  }
  const lockbox = new THREE.Group();
  lockbox.name = 'UpgradeCoinLockbox';
  works.add(lockbox);
  addMesh(
    lockbox,
    new THREE.BoxGeometry(0.48, 0.32, 0.34),
    timberMaterial('dark'),
    new THREE.Vector3(halfWidth - 0.1, 0.16, pileZ + 0.72),
  );
  addMesh(
    lockbox,
    new THREE.BoxGeometry(0.12, 0.16, 0.05),
    sharedBuildingDetailMaterial('brass'),
    new THREE.Vector3(halfWidth - 0.1, 0.22, pileZ + 0.9),
  );
}

export function createResidenceMesh(seed = 0, tier: 1 | 2 | 3 = 1): THREE.Group {
  const appearance = pickResidenceAppearance(seed);
  const { facade, roof, archetype, entrySide, trim } = appearance;
  const dimensions = dimensionsForTier(archetype, tier);
  const wallMaterial = residenceFacadeMaterial(facade);
  const roofSurfaceMaterial = residenceRoofMaterial(roof);
  const shutterMaterial = residenceTrimMaterial(trim);
  const windowMaterial = createWindowMaterial();

  const group = new THREE.Group();
  group.name = 'Residence';
  group.userData.windowMaterial = windowMaterial;
  group.userData.residenceArchetype = archetype;
  group.userData.residenceTier = tier;

  const { width, depth, foundationHeight, groundHeight, upperHeight, ridgeHeight } = dimensions;
  const halfW = width * 0.5;
  const halfD = depth * 0.5;
  const groundTop = foundationHeight + groundHeight;
  const wallTop = groundTop + upperHeight;
  const roofPitch = Math.atan2(ridgeHeight, halfW);
  const slopeLen = halfW / Math.cos(roofPitch) + 0.3;
  const frontZ = halfD - 0.075;

  addMesh(
    group,
    new THREE.BoxGeometry(width + 0.38, foundationHeight, depth + 0.38),
    stoneMaterial('light'),
    new THREE.Vector3(0, foundationHeight * 0.5, 0),
  );
  addMesh(
    group,
    new THREE.BoxGeometry(width, groundHeight, depth),
    stoneMaterial('mid'),
    new THREE.Vector3(0, foundationHeight + groundHeight * 0.5, 0),
  );
  addStoneStoreyCourses(group, width, depth, foundationHeight, groundHeight);

  addMesh(
    group,
    new THREE.BoxGeometry(width - 0.12, upperHeight, depth - 0.12),
    wallMaterial,
    new THREE.Vector3(0, groundTop + upperHeight * 0.5, 0),
  );
  addMesh(
    group,
    new THREE.BoxGeometry(width + 0.12, 0.18, depth + 0.12),
    timberMaterial('dark'),
    new THREE.Vector3(0, groundTop + 0.04, 0),
  );
  addMesh(
    group,
    new THREE.BoxGeometry(width + 0.08, 0.14, depth + 0.08),
    stoneMaterial('mortar'),
    new THREE.Vector3(0, wallTop - 0.07, 0),
  );

  const doorX = residenceGroundDoorLocalX(appearance);
  addPlankDoor(group, doorX, foundationHeight + 0.08, frontZ + 0.03);
  addFrontWindow(
    group,
    windowMaterial,
    shutterMaterial,
    -entrySide * 1.38,
    foundationHeight + groundHeight * 0.55,
    frontZ + 0.02,
    0.78,
    1.02,
    false,
  );

  if (tier > 1 && archetype === 'timber_balcony') {
    addFrontWindow(group, windowMaterial, shutterMaterial, -entrySide * 1.35, groundTop + upperHeight * 0.55, frontZ + 0.02);
    addPlankDoor(group, entrySide * 0.82, groundTop + 0.08, frontZ + 0.03, 0.86, 1.84);
    addTimberBalcony(group, entrySide, frontZ, groundTop + 0.08);
  } else if (tier > 1) {
    addFrontWindow(group, windowMaterial, shutterMaterial, -1.38, groundTop + upperHeight * 0.54, frontZ + 0.02);
    addFrontWindow(group, windowMaterial, shutterMaterial, 1.38, groundTop + upperHeight * 0.54, frontZ + 0.02);
  }

  for (const side of [-1, 1] as const) {
    const x = side * (halfW - 0.035);
    addSideWindow(group, windowMaterial, side, x, foundationHeight + groundHeight * 0.56, -0.35, 0.74, 0.98);
    if (tier > 1) addSideWindow(group, windowMaterial, side, x, groundTop + upperHeight * 0.54, 0.42, 0.78, 1.05);
  }

  for (let step = 0; step < 2; step++) {
    addMesh(
      group,
      new THREE.BoxGeometry(1.5 - step * 0.18, 0.16, 0.5),
      stoneMaterial(step === 0 ? 'mid' : 'light'),
      new THREE.Vector3(doorX, 0.08 + step * 0.12, halfD + 0.34 - step * 0.14),
    );
  }

  for (const side of [-1, 1] as const) {
    addMesh(
      group,
      new THREE.BoxGeometry(slopeLen, 0.14, depth + 0.48),
      roofSurfaceMaterial,
      new THREE.Vector3(side * halfW * 0.46, wallTop + ridgeHeight * 0.48, 0),
      new THREE.Euler(0, 0, side * -roofPitch),
    );
  }
  addRoofCourses(group, roofSurfaceMaterial, halfW, depth, wallTop, ridgeHeight, roofPitch);
  addMesh(
    group,
    new THREE.BoxGeometry(0.24, 0.18, depth + 0.62),
    roofSurfaceMaterial,
    new THREE.Vector3(0, wallTop + ridgeHeight + 0.035, 0),
  );

  for (const zSign of [-1, 1] as const) {
    addTriangularGableWall(
      group,
      'z',
      zSign * (halfD - 0.065),
      halfW,
      wallTop,
      ridgeHeight,
      0.16,
      wallMaterial,
    );
    for (const side of [-1, 1] as const) {
      addMesh(
        group,
        new THREE.BoxGeometry(slopeLen, 0.14, 0.15),
        timberMaterial('dark'),
        new THREE.Vector3(side * halfW * 0.46, wallTop + ridgeHeight * 0.48, zSign * (halfD + 0.16)),
        new THREE.Euler(0, 0, side * -roofPitch),
      );
    }
  }

  if (tier > 1 && archetype === 'stone_portal') {
    addStonePortalPorch(group, doorX, frontZ, foundationHeight);
  } else if (archetype === 'working_lean_to') {
    addWorkingLeanTo(group, entrySide === -1 ? 1 : -1, halfW, foundationHeight);
  }

  if (tier === 3 && archetype !== 'working_lean_to') {
    addWorkingLeanTo(group, entrySide === -1 ? 1 : -1, halfW, foundationHeight);
  }

  const chimneySide: -1 | 1 = entrySide === -1 ? 1 : -1;
  const chimneyX = chimneySide * (halfW - 0.92);
  const chimneyZ = -halfD + 1.22;
  const chimneyHeight = 2.02;
  const chimneyY = wallTop + 0.62 + chimneyHeight * 0.5;
  addMesh(
    group,
    new THREE.BoxGeometry(0.72, chimneyHeight, 0.72),
    stoneMaterial('mid'),
    new THREE.Vector3(chimneyX, chimneyY, chimneyZ),
  );
  addMesh(
    group,
    new THREE.BoxGeometry(0.82, 0.18, 0.82),
    stoneMaterial('light'),
    new THREE.Vector3(chimneyX, chimneyY + chimneyHeight * 0.5 + 0.08, chimneyZ),
  );

  const chimneyEmitter = new THREE.Object3D();
  chimneyEmitter.name = 'ChimneyEmitter';
  chimneyEmitter.position.set(chimneyX, chimneyY + chimneyHeight * 0.5 + 0.22, chimneyZ);
  group.add(chimneyEmitter);

  const firewoodPile = new THREE.Group();
  firewoodPile.name = 'FirewoodPile';
  firewoodPile.visible = false;
  group.add(firewoodPile);
  addLogPile(firewoodPile, entrySide * (halfW - 0.72), -halfD - 0.72, 0, 4, 2.15, 0.19);
  addResidenceUpgradeWorks(group, dimensions);

  return group;
}

/**
 * A tier-zero residence is a saved, authoritative cottage worksite. Keep the
 * finished tier-one mesh nested and hidden so completion can swap to the
 * ordinary house cleanly, while a small stone footing and timber frame make
 * partial builder progress readable from the settlement camera.
 */
export function createInitialResidenceConstructionMesh(seed = 0): THREE.Group {
  const marker = createResidenceMesh(seed, 1);
  const works = marker.getObjectByName('ResidenceUpgradeWorks');
  const completedStructure = new THREE.Group();
  completedStructure.name = 'InitialCottageCompletedStructure';
  for (const child of [...marker.children]) {
    if (child === works) continue;
    completedStructure.add(child);
  }
  completedStructure.visible = false;
  marker.add(completedStructure);

  const appearance = pickResidenceAppearance(seed);
  const dimensions = dimensionsForTier(appearance.archetype, 1);
  const halfWidth = dimensions.width * 0.5;
  const halfDepth = dimensions.depth * 0.5;
  const frame = new THREE.Group();
  frame.name = 'InitialCottageConstructionFrame';
  marker.add(frame);

  const addProgressivePart = (
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    position: THREE.Vector3,
    revealAt: number,
    rotation = new THREE.Euler(),
  ): void => {
    const part = addMesh(frame, geometry, material, position, rotation);
    part.name = 'InitialCottageFrameSegment';
    part.userData.revealAt = revealAt;
  };

  // Setting-out boards remain from the first moment, before a cart arrives.
  addProgressivePart(
    new THREE.BoxGeometry(dimensions.width + 0.3, 0.08, 0.12),
    timberMaterial('weathered'),
    new THREE.Vector3(0, 0.04, halfDepth + 0.12),
    0,
  );
  addProgressivePart(
    new THREE.BoxGeometry(dimensions.width + 0.3, 0.08, 0.12),
    timberMaterial('weathered'),
    new THREE.Vector3(0, 0.04, -halfDepth - 0.12),
    0,
  );
  addProgressivePart(
    new THREE.BoxGeometry(0.12, 0.08, dimensions.depth + 0.3),
    timberMaterial('weathered'),
    new THREE.Vector3(halfWidth + 0.12, 0.04, 0),
    0,
  );
  addProgressivePart(
    new THREE.BoxGeometry(0.12, 0.08, dimensions.depth + 0.3),
    timberMaterial('weathered'),
    new THREE.Vector3(-halfWidth - 0.12, 0.04, 0),
    0,
  );

  const footingPositions = [
    [-halfWidth, -halfDepth],
    [0, -halfDepth],
    [halfWidth, -halfDepth],
    [-halfWidth, halfDepth],
    [0, halfDepth],
    [halfWidth, halfDepth],
  ] as const;
  footingPositions.forEach(([x, z], index) => {
    addProgressivePart(
      new THREE.BoxGeometry(index % 3 === 1 ? dimensions.width * 0.42 : 0.72, 0.32, 0.58),
      stoneMaterial(index % 2 === 0 ? 'mid' : 'light'),
      new THREE.Vector3(x, 0.16, z),
      0.08 + index * 0.035,
    );
  });

  const postHeight = 2.38;
  const postPositions = [
    [-halfWidth, -halfDepth],
    [halfWidth, -halfDepth],
    [-halfWidth, halfDepth],
    [halfWidth, halfDepth],
    [0, -halfDepth],
    [0, halfDepth],
  ] as const;
  postPositions.forEach(([x, z], index) => {
    addProgressivePart(
      new THREE.BoxGeometry(0.2, postHeight, 0.2),
      timberMaterial(index % 2 === 0 ? 'dark' : 'mid'),
      new THREE.Vector3(x, 0.32 + postHeight * 0.5, z),
      0.32 + index * 0.055,
    );
  });
  addProgressivePart(
    new THREE.BoxGeometry(dimensions.width + 0.18, 0.2, 0.2),
    timberMaterial('dark'),
    new THREE.Vector3(0, 0.32 + postHeight, -halfDepth),
    0.68,
  );
  addProgressivePart(
    new THREE.BoxGeometry(dimensions.width + 0.18, 0.2, 0.2),
    timberMaterial('dark'),
    new THREE.Vector3(0, 0.32 + postHeight, halfDepth),
    0.74,
  );
  for (const side of [-1, 1] as const) {
    addProgressivePart(
      new THREE.BoxGeometry(dimensions.width * 0.7, 0.16, 0.16),
      timberMaterial('mid'),
      new THREE.Vector3(
        side * dimensions.width * 0.17,
        0.32 + postHeight + dimensions.ridgeHeight * 0.45,
        0,
      ),
      side < 0 ? 0.82 : 0.9,
      new THREE.Euler(0, 0, side * -0.58),
    );
  }
  marker.userData.residenceTier = 0;
  return marker;
}

const PREVIEW_OPACITY = 0.72;

export function createResidencePreviewMesh(seed = 0): THREE.Group {
  const mesh = createResidenceMesh(seed, 1);
  mesh.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const source = child.material;
    if (Array.isArray(source)) return;
    const material = source.clone();
    if (material instanceof THREE.MeshStandardMaterial) {
      material.transparent = true;
      material.opacity = PREVIEW_OPACITY;
      material.depthWrite = false;
    }
    child.material = material;
    child.renderOrder = 15;
  });
  mesh.frustumCulled = false;
  return mesh;
}

export class ResidenceMarkers {
  private readonly root: THREE.Group;
  private readonly meshes = new Map<string, THREE.Group>();
  private readonly smokeEmitters = new Map<string, ChimneySmokeEmitter>();
  private readonly smokeEligible = new Map<string, boolean>();
  private readonly residenceOccupied = new Map<string, boolean>();
  private readonly residencePopulation = new Map<string, number>();
  private fireDisabledResidenceIds = new Set<string>();
  private chimneySmokeAllowed = true;
  private eveningWindowGlow = 0;
  private nightPolicy: Pick<NightPolicyState, 'gathering' | 'curfew'> | undefined;
  private householdClock: GameClock | null = null;

  constructor(parent: THREE.Group) {
    this.root = new THREE.Group();
    this.root.name = 'Residences';
    parent.add(this.root);
  }

  setChimneySmokeAllowed(allowed: boolean): void {
    this.chimneySmokeAllowed = allowed;
    for (const [id, emitter] of this.smokeEmitters) {
      emitter.setActive(
        allowed
          && !this.fireDisabledResidenceIds.has(id)
          && (this.smokeEligible.get(id) ?? false),
      );
    }
  }

  setFireDisabledResidenceIds(ids: ReadonlySet<string>): void {
    if (setsEqual(this.fireDisabledResidenceIds, ids)) return;
    this.fireDisabledResidenceIds = new Set(ids);
    for (const [id, emitter] of this.smokeEmitters) {
      emitter.setActive(
        this.chimneySmokeAllowed
          && !this.fireDisabledResidenceIds.has(id)
          && (this.smokeEligible.get(id) ?? false),
      );
    }
    this.applyWindowGlow();
  }

  setHouseholdClock(clock: GameClock): void {
    this.householdClock = clock;
    this.applyWindowGlow();
  }

  setHouseholdLighting(
    clock: GameClock,
    glow: number,
    nightPolicy?: Pick<NightPolicyState, 'gathering' | 'curfew'>,
  ): void {
    this.householdClock = clock;
    this.eveningWindowGlow = glow;
    this.nightPolicy = nightPolicy;
    this.applyWindowGlow();
  }

  setEveningWindowGlow(glow: number): void {
    this.eveningWindowGlow = glow;
    this.applyWindowGlow();
  }

  private applyWindowGlow(): void {
    for (const [id, marker] of this.meshes) {
      const material = marker.userData.windowMaterial as THREE.MeshStandardMaterial | undefined;
      if (!material) continue;
      applyResidenceWindowGlow(
        material,
        this.windowGlowForResidence(id),
        this.residenceOccupied.get(id) ?? false,
      );
    }
  }

  tick(dt: number): void {
    for (const [id, emitter] of this.smokeEmitters) {
      emitter.setActive(
        this.chimneySmokeAllowed
          && !this.fireDisabledResidenceIds.has(id)
          && (this.smokeEligible.get(id) ?? false),
      );
      emitter.tick(dt);
    }
  }

  syncResidences(
    residences: Iterable<ResidenceState>,
    getHeightAt: (x: number, z: number) => number,
  ): void {
    const nextIds = new Set<string>();
    for (const residence of residences) {
      nextIds.add(residence.id);
      let marker = this.meshes.get(residence.id);
      if (marker && marker.userData.residenceTier !== residence.tier) {
        this.root.remove(marker);
        disposeGroup(marker);
        this.meshes.delete(residence.id);
        this.smokeEmitters.get(residence.id)?.dispose();
        this.smokeEmitters.delete(residence.id);
        marker = undefined;
      }
      if (!marker) {
        const appearanceSeed = hashStringSeed(residence.id);
        const completedTier = residence.tier === 0 ? null : residence.tier;
        marker = completedTier == null
          ? createInitialResidenceConstructionMesh(appearanceSeed)
          : createResidenceMesh(appearanceSeed, completedTier);
        marker.userData.fpCollisionAggregate = true;
        if (completedTier != null) {
          const shadowProxy = createResidenceShadowProxy(completedTier);
          shadowProxy.castShadow = areBuildingShadowsEnabled();
          marker.add(shadowProxy);
        }
        this.root.add(marker);
        this.meshes.set(residence.id, marker);

        const chimneyEmitter = marker.getObjectByName('ChimneyEmitter');
        if (chimneyEmitter) {
          this.smokeEmitters.set(residence.id, new ChimneySmokeEmitter(chimneyEmitter, appearanceSeed));
        }
      }
      const y = getHeightAt(residence.x, residence.z);
      marker.position.set(residence.x, y, residence.z);
      marker.rotation.y = residence.yaw;
      const smokeEligible = !residence.abandoned
        && residence.population > 0
        && getNeedStock(residence.needs, 'firewood') > 0;
      this.smokeEligible.set(residence.id, smokeEligible);
      this.smokeEmitters.get(residence.id)?.setActive(
        this.chimneySmokeAllowed
          && !this.fireDisabledResidenceIds.has(residence.id)
          && smokeEligible,
      );
      this.residenceOccupied.set(
        residence.id,
        !residence.abandoned && residence.population > 0,
      );
      this.residencePopulation.set(residence.id, residence.population);
      this.applyWindowGlowForResidence(marker, residence.id);
      syncFirewoodPile(marker, getNeedStock(residence.needs, 'firewood'));
      syncInitialResidenceConstruction(marker, residence);
      syncResidenceUpgradeWorks(marker, residence);
      const completedTier = residence.tier === 0 ? null : residence.tier;
      if (completedTier != null && !marker.getObjectByName('Building shadow proxy')) {
        const shadowProxy = createResidenceShadowProxy(completedTier);
        shadowProxy.castShadow = areBuildingShadowsEnabled();
        marker.add(shadowProxy);
      }
    }

    for (const [id, marker] of this.meshes) {
      if (nextIds.has(id)) continue;
      this.root.remove(marker);
      disposeGroup(marker);
      this.meshes.delete(id);
      this.smokeEmitters.get(id)?.dispose();
      this.smokeEmitters.delete(id);
      this.smokeEligible.delete(id);
      this.residenceOccupied.delete(id);
      this.residencePopulation.delete(id);
    }
  }

  private applyWindowGlowForResidence(marker: THREE.Group, residenceId: string): void {
    const material = marker.userData.windowMaterial as THREE.MeshStandardMaterial | undefined;
    if (!material) return;
    applyResidenceWindowGlow(
      material,
      this.windowGlowForResidence(residenceId),
      this.residenceOccupied.get(residenceId) ?? false,
    );
  }

  private windowGlowForResidence(residenceId: string): number {
    if (this.fireDisabledResidenceIds.has(residenceId)) return 0;
    if (!this.householdClock) return this.eveningWindowGlow;
    const householdActivity = residenceWindowActivity(
      residenceId,
      this.residencePopulation.get(residenceId) ?? 0,
      this.householdClock,
      this.nightPolicy,
    );
    return this.eveningWindowGlow * householdActivity;
  }

  dispose(): void {
    for (const emitter of this.smokeEmitters.values()) {
      emitter.dispose();
    }
    this.smokeEmitters.clear();
    this.smokeEligible.clear();
    this.residenceOccupied.clear();
    this.residencePopulation.clear();
    this.fireDisabledResidenceIds.clear();
    for (const marker of this.meshes.values()) {
      disposeGroup(marker);
    }
    this.meshes.clear();
    this.root.removeFromParent();
  }
}

function setsEqual<T>(left: ReadonlySet<T>, right: ReadonlySet<T>): boolean {
  if (left === right) return true;
  if (left.size !== right.size) return false;
  for (const value of left) {
    if (!right.has(value)) return false;
  }
  return true;
}

function syncFirewoodPile(marker: THREE.Group, firewoodStock: number): void {
  const pile = marker.getObjectByName('FirewoodPile');
  if (!(pile instanceof THREE.Group)) return;

  if (firewoodStock <= 0.05) {
    pile.visible = false;
    return;
  }

  pile.visible = true;
  const fill = Math.min(1, firewoodStock / RESIDENCE_FIREWOOD_CAPACITY);
  const scale = 0.42 + fill * 0.58;
  pile.scale.setScalar(scale);
}

function disposeGroup(group: THREE.Group): void {
  const windowMaterial = group.userData.windowMaterial as THREE.Material | undefined;
  if (windowMaterial) windowMaterial.dispose();
  group.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose();
    }
  });
}

export function syncInitialResidenceConstruction(
  marker: THREE.Group,
  residence: ResidenceState,
): void {
  const frame = marker.getObjectByName('InitialCottageConstructionFrame');
  if (!(frame instanceof THREE.Group)) return;
  const active = residence.tier === 0 && (residence.upgradeTargetTier ?? 0) === 1;
  frame.visible = active;
  if (!active) return;
  const progress = Math.max(0, Math.min(1, residence.upgradeProgress ?? 0));
  for (const child of frame.children) {
    const revealAt = Number(child.userData.revealAt ?? 0);
    child.visible = progress + 1e-6 >= revealAt;
  }
}

export function syncResidenceUpgradeWorks(
  marker: THREE.Group,
  residence: ResidenceState,
): void {
  const works = marker.getObjectByName('ResidenceUpgradeWorks');
  if (!(works instanceof THREE.Group)) return;
  const active = residenceHasActiveProject(residence);
  works.visible = active;
  if (!active) return;
  const initialConstruction = residence.tier === 0
    && (residence.upgradeTargetTier ?? 0) === 1;
  const backyardConstruction = (residence.backyardProjectKind ?? 0) !== 0;
  for (const child of works.children) {
    if (child.name.startsWith('UpgradeScaffold')) {
      child.visible = !initialConstruction && !backyardConstruction;
    }
  }

  const progress = Math.max(0, Math.min(1, residence.upgradeProgress ?? 0));
  const timberRemaining = Math.max(
    0,
    (residence.upgradeDeliveredTimber ?? 0)
      - (residence.upgradeRequiredTimber ?? 0) * progress,
  );
  const stoneRemaining = Math.max(
    0,
    (residence.upgradeDeliveredStone ?? 0)
      - (residence.upgradeRequiredStone ?? 0) * progress,
  );
  const timberFill = (residence.upgradeRequiredTimber ?? 0) <= 1e-6
    ? 0
    : timberRemaining / (residence.upgradeRequiredTimber ?? 1);
  const stoneFill = (residence.upgradeRequiredStone ?? 0) <= 1e-6
    ? 0
    : stoneRemaining / (residence.upgradeRequiredStone ?? 1);
  syncUpgradeMaterialSegments(works, 'UpgradeTimberSegment:', timberFill);
  syncUpgradeMaterialSegments(works, 'UpgradeStoneSegment:', stoneFill);
  const lockbox = works.getObjectByName('UpgradeCoinLockbox');
  if (lockbox) {
    lockbox.visible = (residence.upgradeDeliveredGold ?? 0) > 0.05 && progress < 0.999;
  }
}

function syncUpgradeMaterialSegments(
  works: THREE.Group,
  prefix: string,
  fill: number,
): void {
  const segments = works.children.filter((child) => child.name.startsWith(prefix));
  const visibleCount = Math.ceil(Math.max(0, Math.min(1, fill)) * segments.length);
  for (let index = 0; index < segments.length; index += 1) {
    segments[index].visible = index < visibleCount;
  }
}
