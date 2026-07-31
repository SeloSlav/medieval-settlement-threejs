import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { addTriangularGableWall } from '../buildings/meshPrimitives.ts';
import { addLogPile } from '../buildings/logPile.ts';
import { BatchedBuildingShadowProxies } from '../buildings/buildingShadowProxy.ts';
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
import type { ServiceCoverageView } from '../resources/serviceCoverage.ts';

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

type TierOneResidenceSurface =
  | 'lime-plaster'
  | 'foundation-stone'
  | 'foundation-cap'
  | 'structural-timber'
  | 'weathered-timber'
  | 'wood-shingle';

function tierOneResidenceMaterial(
  surface: TierOneResidenceSurface,
): THREE.MeshStandardMaterial {
  if (surface === 'lime-plaster') return sharedBuildingMaterial('plasterWhite');
  if (surface === 'foundation-stone') return sharedBuildingMaterial('masonryMid');
  if (surface === 'foundation-cap') return sharedBuildingMaterial('masonryLight');
  if (surface === 'structural-timber') return sharedBuildingMaterial('timberDark');
  if (surface === 'weathered-timber') {
    return sharedBuildingMaterial('timberWeathered');
  }
  return sharedBuildingMaterial('shingle');
}

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
  if (tier === 1) {
    return {
      width: base.width * 0.84,
      depth: base.depth * 0.82,
      foundationHeight: 0.5,
      groundHeight: 2.32,
      upperHeight: 0.22,
      ridgeHeight: 3.25,
    };
  }
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
  weatheredMaterial: THREE.Material = timberMaterial('weathered'),
  structuralMaterial: THREE.Material = timberMaterial('dark'),
): void {
  addMesh(
    group,
    new THREE.BoxGeometry(width, height, 0.075),
    windowMaterial,
    new THREE.Vector3(x, y, z + 0.065),
  );
  addMesh(
    group,
    new THREE.BoxGeometry(width + 0.34, 0.12, 0.22),
    weatheredMaterial,
    new THREE.Vector3(x, y - height * 0.5 - 0.08, z + 0.08),
  );
  for (const side of [-1, 1] as const) {
    const casing = addMesh(
      group,
      new THREE.BoxGeometry(0.12, height + 0.24, 0.13),
      structuralMaterial,
      new THREE.Vector3(x + side * (width * 0.5 + 0.08), y, z + 0.075),
    );
    casing.name = 'Residence front window hewn casing';
  }
  const lintel = addMesh(
    group,
    new THREE.BoxGeometry(width + 0.34, 0.13, 0.14),
    structuralMaterial,
    new THREE.Vector3(x, y + height * 0.5 + 0.08, z + 0.075),
  );
  lintel.name = 'Residence front window hewn lintel';
  const mullion = addMesh(
    group,
    new THREE.BoxGeometry(0.055, height * 0.88, 0.055),
    structuralMaterial,
    new THREE.Vector3(x, y, z + 0.125),
  );
  mullion.name = 'Residence front window vertical mullion';
  const transom = addMesh(
    group,
    new THREE.BoxGeometry(width * 0.88, 0.055, 0.055),
    structuralMaterial,
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
  weatheredMaterial: THREE.Material = timberMaterial('weathered'),
  structuralMaterial: THREE.Material = timberMaterial('dark'),
): void {
  addMesh(
    group,
    new THREE.BoxGeometry(0.075, height, width),
    windowMaterial,
    new THREE.Vector3(x + side * 0.065, y, z),
  );
  addMesh(
    group,
    new THREE.BoxGeometry(0.2, 0.12, width + 0.3),
    weatheredMaterial,
    new THREE.Vector3(x + side * 0.09, y - height * 0.5 - 0.1, z),
  );
  for (const zSide of [-1, 1] as const) {
    const casing = addMesh(
      group,
      new THREE.BoxGeometry(0.13, height + 0.24, 0.12),
      structuralMaterial,
      new THREE.Vector3(x + side * 0.075, y, z + zSide * (width * 0.5 + 0.08)),
    );
    casing.name = 'Residence side window hewn casing';
  }
  const lintel = addMesh(
    group,
    new THREE.BoxGeometry(0.14, 0.13, width + 0.34),
    structuralMaterial,
    new THREE.Vector3(x + side * 0.075, y + height * 0.5 + 0.08, z),
  );
  lintel.name = 'Residence side window hewn lintel';
  const mullion = addMesh(
    group,
    new THREE.BoxGeometry(0.055, height * 0.88, 0.055),
    structuralMaterial,
    new THREE.Vector3(x + side * 0.125, y, z),
  );
  mullion.name = 'Residence side window vertical mullion';
  const transom = addMesh(
    group,
    new THREE.BoxGeometry(0.055, 0.055, width * 0.88),
    structuralMaterial,
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
  weatheredMaterial: THREE.Material = timberMaterial('weathered'),
): void {
  const door = addMesh(
    group,
    new THREE.BoxGeometry(width, height, 0.12),
    sharedBuildingMaterial('interiorDark'),
    new THREE.Vector3(x, baseY + height * 0.5, z + 0.075),
  );
  door.name = 'Residence shadowed plank door aperture';
  door.userData.residenceSurfaceRole = 'dark-aperture';
  for (const side of [-1, 1] as const) {
    const jamb = addMesh(
      group,
      new THREE.BoxGeometry(0.17, height + 0.24, 0.17),
      weatheredMaterial,
      new THREE.Vector3(
        x + side * (width * 0.5 + 0.1),
        baseY + height * 0.5,
        z + 0.06,
      ),
    );
    jamb.name = 'Residence door hewn jamb';
  }
  const lintel = addMesh(
    group,
    new THREE.BoxGeometry(width + 0.48, 0.2, 0.19),
    weatheredMaterial,
    new THREE.Vector3(x, baseY + height + 0.09, z + 0.06),
  );
  lintel.name = 'Residence door hewn lintel';
  for (const y of [baseY + 0.43, baseY + 1.35]) {
    const brace = addMesh(
      group,
      new THREE.BoxGeometry(width * 0.82, 0.075, 0.055),
      weatheredMaterial,
      new THREE.Vector3(x, y, z + 0.205),
    );
    brace.name = 'Residence door cross brace';
  }
  const latch = addMesh(
    group,
    new THREE.BoxGeometry(0.21, 0.055, 0.06),
    sharedBuildingMaterial('metalIron'),
    new THREE.Vector3(x - width * 0.31, baseY + height * 0.52, z + 0.215),
  );
  latch.name = 'Residence door iron latch';
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

type BoxPart = {
  size: readonly [number, number, number];
  position: readonly [number, number, number];
  rotation?: readonly [number, number, number];
};

type OpenBoxFace =
  | 'positive-x'
  | 'negative-x'
  | 'positive-y'
  | 'negative-y'
  | 'positive-z'
  | 'negative-z';

type WeatheredRoofEdgePart = BoxPart & {
  faces: readonly OpenBoxFace[];
  variantSalt: number;
};

const WEATHERED_ROOF_EDGE_TINTS = [
  [0.72, 0.74, 0.75],
  [0.78, 0.74, 0.68],
  [0.66, 0.69, 0.7],
  [0.75, 0.71, 0.64],
] as const;

function mergeBoxParts(parts: readonly BoxPart[]): THREE.BufferGeometry {
  const geometries = parts.map((part) => {
    const geometry = new THREE.BoxGeometry(...part.size);
    const rotation = part.rotation ?? [0, 0, 0];
    geometry.rotateX(rotation[0]);
    geometry.rotateY(rotation[1]);
    geometry.rotateZ(rotation[2]);
    geometry.translate(...part.position);
    return geometry;
  });
  const merged = mergeGeometries(geometries, false);
  for (const geometry of geometries) geometry.dispose();
  if (!merged) throw new Error('Could not merge residence detail geometry.');
  return merged;
}

function mergeRoofShingleCourseParts(
  parts: readonly BoxPart[],
): THREE.BufferGeometry {
  const geometries = parts.map((part) => {
    const indexed = new THREE.BoxGeometry(...part.size);
    const source = indexed.toNonIndexed();
    indexed.dispose();
    const sourcePosition = source.getAttribute('position');
    const sourceNormal = source.getAttribute('normal');
    const positions: number[] = [];
    const normals: number[] = [];

    for (let vertex = 0; vertex < sourcePosition.count; vertex += 3) {
      if (Math.abs(sourceNormal.getZ(vertex)) >= 0.9) continue;
      for (let corner = 0; corner < 3; corner += 1) {
        const index = vertex + corner;
        positions.push(
          sourcePosition.getX(index),
          sourcePosition.getY(index),
          sourcePosition.getZ(index),
        );
        normals.push(
          sourceNormal.getX(index),
          sourceNormal.getY(index),
          sourceNormal.getZ(index),
        );
      }
    }
    source.dispose();

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(positions, 3),
    );
    geometry.setAttribute(
      'normal',
      new THREE.Float32BufferAttribute(normals, 3),
    );
    const rotation = part.rotation ?? [0, 0, 0];
    geometry.rotateX(rotation[0]);
    geometry.rotateY(rotation[1]);
    geometry.rotateZ(rotation[2]);
    geometry.translate(...part.position);
    return geometry;
  });
  const merged = mergeGeometries(geometries, false);
  for (const geometry of geometries) geometry.dispose();
  if (!merged) throw new Error('Could not merge residence shingle-course geometry.');
  merged.userData.residenceRoofCourseOpenGableEnds = true;
  return merged;
}

function mergeWeatheredRoofEdgeParts(
  parts: readonly WeatheredRoofEdgePart[],
  seed: number,
): THREE.BufferGeometry {
  const geometries = parts.map((part) => {
    const indexed = new THREE.BoxGeometry(...part.size);
    const source = indexed.toNonIndexed();
    indexed.dispose();
    const sourcePosition = source.getAttribute('position');
    const sourceNormal = source.getAttribute('normal');
    const positions: number[] = [];
    const normals: number[] = [];
    const colors: number[] = [];
    const variant =
      ((seed + part.variantSalt) % WEATHERED_ROOF_EDGE_TINTS.length
        + WEATHERED_ROOF_EDGE_TINTS.length)
      % WEATHERED_ROOF_EDGE_TINTS.length;
    const tint = WEATHERED_ROOF_EDGE_TINTS[variant]!;

    for (let vertex = 0; vertex < sourcePosition.count; vertex += 3) {
      const face = openBoxFaceFromNormal(
        sourceNormal.getX(vertex),
        sourceNormal.getY(vertex),
        sourceNormal.getZ(vertex),
      );
      if (!part.faces.includes(face)) continue;
      for (let corner = 0; corner < 3; corner += 1) {
        const index = vertex + corner;
        positions.push(
          sourcePosition.getX(index),
          sourcePosition.getY(index),
          sourcePosition.getZ(index),
        );
        normals.push(
          sourceNormal.getX(index),
          sourceNormal.getY(index),
          sourceNormal.getZ(index),
        );
        colors.push(...tint);
      }
    }
    source.dispose();

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(positions, 3),
    );
    geometry.setAttribute(
      'normal',
      new THREE.Float32BufferAttribute(normals, 3),
    );
    geometry.setAttribute(
      'color',
      new THREE.Float32BufferAttribute(colors, 3),
    );
    const rotation = part.rotation ?? [0, 0, 0];
    geometry.rotateX(rotation[0]);
    geometry.rotateY(rotation[1]);
    geometry.rotateZ(rotation[2]);
    geometry.translate(...part.position);
    return geometry;
  });
  const merged = mergeGeometries(geometries, false);
  for (const geometry of geometries) geometry.dispose();
  if (!merged) throw new Error('Could not merge residence roof-edge geometry.');
  // These authored four-tone colors are the weathering treatment for the edge
  // boards. Marking the profile prevents addMesh from replacing them with the
  // generic continuous timber noise while preserving the shared material.
  merged.userData.buildingWeatheringProfile = 'timber';
  merged.userData.residenceRoofEdgePartCount = parts.length;
  return merged;
}

function openBoxFaceFromNormal(
  x: number,
  y: number,
  z: number,
): OpenBoxFace {
  const absoluteX = Math.abs(x);
  const absoluteY = Math.abs(y);
  const absoluteZ = Math.abs(z);
  if (absoluteX >= absoluteY && absoluteX >= absoluteZ) {
    return x >= 0 ? 'positive-x' : 'negative-x';
  }
  if (absoluteY >= absoluteX && absoluteY >= absoluteZ) {
    return y >= 0 ? 'positive-y' : 'negative-y';
  }
  return z >= 0 ? 'positive-z' : 'negative-z';
}

function addTierOneTimberConstruction(
  group: THREE.Group,
  width: number,
  depth: number,
  foundationHeight: number,
  wallTop: number,
  ridgeHeight: number,
  structuralMaterial: THREE.Material,
  weatheredMaterial: THREE.Material,
): void {
  const halfW = width * 0.5;
  const halfD = depth * 0.5;
  const wallHeight = wallTop - foundationHeight;
  const parts: BoxPart[] = [];
  const courseCount = 9;
  for (let course = 1; course < courseCount; course += 1) {
    const y = foundationHeight + wallHeight * (course / courseCount);
    parts.push(
      { size: [width + 0.08, 0.045, 0.08], position: [0, y, halfD + 0.025] },
      { size: [width + 0.08, 0.045, 0.08], position: [0, y, -halfD - 0.025] },
      { size: [0.08, 0.045, depth - 0.04], position: [halfW + 0.025, y, 0] },
      { size: [0.08, 0.045, depth - 0.04], position: [-halfW - 0.025, y, 0] },
    );
  }
  for (const x of [-halfW, halfW]) {
    for (const z of [-halfD, halfD]) {
      parts.push({
        size: [0.18, wallHeight + 0.1, 0.18],
        position: [x, foundationHeight + wallHeight * 0.5, z],
      });
    }
  }
  const construction = addMesh(
    group,
    mergeBoxParts(parts),
    structuralMaterial,
    new THREE.Vector3(),
  );
  construction.name = 'Residence hand-hewn wall courses and notched corners';

  const gableParts: BoxPart[] = [];
  for (const zSign of [-1, 1] as const) {
    const z = zSign * (halfD + 0.045);
    gableParts.push(
      { size: [0.15, ridgeHeight - 0.08, 0.12], position: [0, wallTop + ridgeHeight * 0.48, z] },
      { size: [width * 0.62, 0.13, 0.12], position: [0, wallTop + ridgeHeight * 0.32, z] },
      { size: [width * 0.34, 0.12, 0.12], position: [0, wallTop + ridgeHeight * 0.63, z] },
    );
  }
  const gableScreen = addMesh(
    group,
    mergeBoxParts(gableParts),
    weatheredMaterial,
    new THREE.Vector3(),
  );
  gableScreen.name = 'Residence ventilated timber gable screen';
}

function addTierOneLimewashedInfill(
  group: THREE.Group,
  width: number,
  depth: number,
  foundationHeight: number,
  wallTop: number,
  material: THREE.Material,
): void {
  const halfW = width * 0.5;
  const halfD = depth * 0.5;
  const panelHeight = Math.max(1.5, wallTop - foundationHeight - 0.34);
  const panelY = foundationHeight + 0.12 + panelHeight * 0.5;
  const skin = 0.055;
  const inset = 0.03;
  const infill = addMesh(
    group,
    mergeBoxParts([
      {
        size: [width - 0.38, panelHeight, skin],
        position: [0, panelY, halfD - inset],
      },
      {
        size: [width - 0.38, panelHeight, skin],
        position: [0, panelY, -halfD + inset],
      },
      {
        size: [skin, panelHeight, depth - 0.38],
        position: [halfW - inset, panelY, 0],
      },
      {
        size: [skin, panelHeight, depth - 0.38],
        position: [-halfW + inset, panelY, 0],
      },
    ]),
    material,
    new THREE.Vector3(),
  );
  infill.name = 'Residence limewashed plaster infill shell';
  infill.userData.residenceSurfaceRole = 'lime-plaster';
}

function addRoofShingleCourses(
  group: THREE.Group,
  material: THREE.Material,
  roofHalfSpan: number,
  depth: number,
  depthOverhang: number,
  wallTop: number,
  ridgeHeight: number,
  roofPitch: number,
  eaveDrop: number,
  seed: number,
  tiledRoof: boolean,
): void {
  for (const side of [-1, 1] as const) {
    const parts: BoxPart[] = [];
    const courseCount = 8;
    const roofDepth = depth + depthOverhang * 2;
    const boardsAcross = Math.max(7, Math.ceil(roofDepth / 0.72));
    const boardDepth = roofDepth / boardsAcross;
    const slopeLength = roofHalfSpan / Math.cos(roofPitch);
    const courseLength = slopeLength / courseCount * 0.74;
    const normalX = side * Math.sin(roofPitch);
    const normalY = Math.cos(roofPitch);
    for (let row = 0; row < courseCount; row += 1) {
      const t = (row + 0.48) / courseCount;
      const centerX = side * roofHalfSpan * (1 - t);
      const centerY = wallTop - eaveDrop + (ridgeHeight + eaveDrop) * t;
      for (let board = 0; board < boardsAcross; board += 1) {
        const stagger = ((row + board + Math.abs(seed)) % 3 - 1) * 0.025;
        const z = -roofDepth * 0.5 + boardDepth * (board + 0.5) + stagger;
        parts.push({
          size: [
            courseLength * (0.96 + ((row * 5 + board * 3 + Math.abs(seed)) % 5) * 0.012),
            0.045,
            Math.max(0.2, boardDepth - 0.025),
          ],
          position: [
            centerX + normalX * 0.095,
            centerY + normalY * 0.095,
            z,
          ],
          rotation: [0, 0, side * -roofPitch],
        });
      }
    }
    const courseGeometry = mergeRoofShingleCourseParts(parts);
    courseGeometry.userData.buildingWeatheringComponentVertexCount =
      courseGeometry.getAttribute('position').count / parts.length;
    const courses = addMesh(
      group,
      courseGeometry,
      material,
      new THREE.Vector3(),
    );
    if (!tiledRoof) applyWarmShingleBackFaceFinish(courses);
    courses.name =
      `Residence ${tiledRoof ? 'fired-clay tile' : 'split-wood shingle'} courses ${side < 0 ? 'left' : 'right'}`;
    courses.userData.residenceRoofSurface = true;
    courses.userData.residenceRoofFinish =
      tiledRoof ? 'fired-clay-tile' : 'split-wood-shingle';
  }
}

const SHINGLE_BACK_GRAIN_U = 70.5 / 256;
const SHINGLE_BACK_WARM_TINT = [2.1025, 1.914, 1.682] as const;
const SHINGLE_BACK_GRAIN_PHASES = [
  -0.24,
  -0.15,
  -0.07,
  0,
  0.08,
  0.16,
  0.22,
] as const;

/**
 * Keeps the accepted upper shingle field untouched while the narrow exposed
 * gable ends and soffits sample the same calm longitudinal strip of the shared
 * split-wood map. Physical board blocks start that strip at staggered phases,
 * breaking up ruler-even gable banding without another material, texture,
 * mesh, draw call, or change to the accepted back-face value.
 */
function applyWarmShingleBackFaceFinish(mesh: THREE.Mesh): void {
  if (
    Array.isArray(mesh.material)
    || mesh.material.userData.buildingWeatheringProfile !== 'shingle'
  ) {
    return;
  }
  const position = mesh.geometry.getAttribute('position');
  const normal = mesh.geometry.getAttribute('normal');
  const uv = mesh.geometry.getAttribute('uv');
  const color = mesh.geometry.getAttribute('color');
  const tileMeters = Number(
    (
      mesh.material.userData.splitShinglePattern as
        | { tileMeters?: number }
        | undefined
    )?.tileMeters,
  );
  if (!position || !normal || !uv || !color || !Number.isFinite(tileMeters)) {
    return;
  }

  let vertexCount = 0;
  const componentVertexCount = Number(
    mesh.geometry.userData.buildingWeatheringComponentVertexCount,
  );
  const hasComponents =
    Number.isFinite(componentVertexCount) && componentVertexCount > 0;
  const appliedGrainPhases = new Set<number>();
  for (let index = 0; index < position.count; index += 1) {
    const isGableBack = Math.abs(normal.getZ(index)) >= 0.9;
    const isUnderside = normal.getY(index) <= -0.9;
    if (!isGableBack && !isUnderside) continue;

    const componentIndex = hasComponents
      ? Math.floor(index / componentVertexCount)
      : 0;
    const faceVariant = isUnderside
      ? 0
      : normal.getZ(index) > 0
        ? 1
        : 2;
    const coarseCornerVariant = hasComponents
      ? 0
      : (position.getX(index) > 0 ? 1 : 0)
        + (position.getY(index) > 0 ? 2 : 0)
        + (isUnderside && position.getZ(index) > 0 ? 4 : 0);
    const grainPhase = SHINGLE_BACK_GRAIN_PHASES[
      (componentIndex * 3 + faceVariant * 2 + coarseCornerVariant)
        % SHINGLE_BACK_GRAIN_PHASES.length
    ]!;
    uv.setXY(
      index,
      SHINGLE_BACK_GRAIN_U,
      position.getX(index) / tileMeters + grainPhase,
    );
    color.setXYZ(
      index,
      color.getX(index) * SHINGLE_BACK_WARM_TINT[0],
      color.getY(index) * SHINGLE_BACK_WARM_TINT[1],
      color.getZ(index) * SHINGLE_BACK_WARM_TINT[2],
    );
    appliedGrainPhases.add(grainPhase);
    vertexCount += 1;
  }
  uv.needsUpdate = true;
  color.needsUpdate = true;
  mesh.userData.residenceRoofBackFaceFinish = 'warm-weathered-gray-brown';
  mesh.userData.residenceRoofBackFaceGrain =
    'shared-shingle-longitudinal-phase-staggered-calm-strip';
  mesh.userData.residenceRoofBackFaceVertexCount = vertexCount;
  mesh.userData.residenceRoofBackFacePhaseVariantCount =
    appliedGrainPhases.size;
  mesh.geometry.userData.residenceRoofBackFaceUvColumn =
    SHINGLE_BACK_GRAIN_U;
  mesh.geometry.userData.residenceRoofBackFacePhaseOffsets =
    [...SHINGLE_BACK_GRAIN_PHASES];
  mesh.geometry.userData.residenceRoofBackFaceTint =
    [...SHINGLE_BACK_WARM_TINT];
}

function addWeatheredRoofEdgeCraft(
  group: THREE.Group,
  material: THREE.Material,
  roofHalfSpan: number,
  depth: number,
  depthOverhang: number,
  halfDepth: number,
  wallTop: number,
  ridgeHeight: number,
  roofPitch: number,
  eaveDrop: number,
  ridgeWidth: number,
  ridgeBoardHeight: number,
  seed: number,
): void {
  const roofDepth = depth + depthOverhang * 2;
  const ridgeDepth = roofDepth + 0.12;
  const ridgeSegmentDepth = ridgeDepth / 3;
  const ridgeShift = ((seed % 3) + 3) % 3;
  const ridgeWidthOffsets = [0.012, -0.018, 0.006] as const;
  const ridgeHeightOffsets = [0.008, -0.01, 0.014] as const;
  const ridgeCenterOffsets = [-0.012, 0.014, -0.005] as const;
  const ridgeLengthOffsets = [0.008, -0.006, 0.012] as const;
  const ridgeParts: WeatheredRoofEdgePart[] = [];
  for (let index = 0; index < 3; index += 1) {
    const variationIndex = (index + ridgeShift) % 3;
    const boardHeight =
      ridgeBoardHeight + ridgeHeightOffsets[variationIndex]!;
    const faces: OpenBoxFace[] = [
      'positive-x',
      'negative-x',
      'positive-y',
    ];
    if (index === 0) faces.push('negative-z');
    if (index === 2) faces.push('positive-z');
    ridgeParts.push({
      size: [
        ridgeWidth + ridgeWidthOffsets[variationIndex]!,
        boardHeight,
        ridgeSegmentDepth
          - 0.025
          + ridgeLengthOffsets[variationIndex]!,
      ],
      position: [
        ridgeCenterOffsets[variationIndex]!,
        wallTop + ridgeHeight + 0.055
          + (boardHeight - ridgeBoardHeight) * 0.5,
        -ridgeDepth * 0.5
          + ridgeSegmentDepth * (index + 0.5)
          + ridgeCenterOffsets[(variationIndex + 1) % 3]!,
      ],
      variantSalt: index,
      faces,
    });
  }
  const ridge = addMesh(
    group,
    mergeWeatheredRoofEdgeParts(ridgeParts, seed),
    material,
    new THREE.Vector3(),
  );
  markWeatheredRoofEdge(ridge, 'ridge', ridgeParts.length);
  ridge.name = 'Residence wooden ridge cap';

  const rakeGap = 0.026;
  const rakeThicknesses = [0.128, 0.146, 0.136, 0.152] as const;
  const rakeProjections = [-0.01, 0.014, 0.004, -0.006] as const;
  const rakeNormalOffsets = [-0.008, 0.011, -0.004, 0.007] as const;
  const slopeLength = roofHalfSpan / Math.cos(roofPitch);
  let rakeOrdinal = 0;
  for (const zSign of [-1, 1] as const) {
    for (const side of [-1, 1] as const) {
      const rotationZ = side * -roofPitch;
      const jointVariation =
        (((seed + rakeOrdinal * 3) % 5 + 5) % 5 - 2) * 0.008;
      const jointX = slopeLength * (0.48 + jointVariation - 0.5);
      const intervals = [
        [-slopeLength * 0.5, jointX - rakeGap * 0.5],
        [jointX + rakeGap * 0.5, slopeLength * 0.5],
      ] as const;
      const rakeParts: WeatheredRoofEdgePart[] = intervals.map(
        ([start, end], partIndex) => {
          const variationIndex =
            (rakeOrdinal * 2 + partIndex + ((seed % 4) + 4) % 4) % 4;
          const localX = (start + end) * 0.5;
          const localY = rakeNormalOffsets[variationIndex]!;
          const cos = Math.cos(rotationZ);
          const sin = Math.sin(rotationZ);
          const depth = 0.142 + rakeProjections[variationIndex]!;
          return {
            size: [end - start, rakeThicknesses[variationIndex]!, depth],
            position: [
              side * roofHalfSpan * 0.5 + localX * cos - localY * sin,
              wallTop + (ridgeHeight - eaveDrop) * 0.5
                + localX * sin
                + localY * cos,
              zSign * (
                halfDepth
                  + depthOverhang
                  + depth * 0.5
                  + rakeProjections[(variationIndex + 1) % 4]!
              ),
            ],
            rotation: [0, 0, rotationZ],
            faces: [
              zSign > 0 ? 'positive-z' : 'negative-z',
              'positive-y',
              'negative-y',
            ],
            variantSalt: 3 + rakeOrdinal * 2 + partIndex,
          };
        },
      );
      const rake = addMesh(
        group,
        mergeWeatheredRoofEdgeParts(rakeParts, seed),
        material,
        new THREE.Vector3(),
      );
      markWeatheredRoofEdge(rake, 'gable-rake', rakeParts.length);
      rake.name =
        `Residence weathered-wood gable rake ${zSign < 0 ? 'rear' : 'front'}-${side < 0 ? 'left' : 'right'}`;
      rake.userData.residenceRoofEdgeButtGapMeters = rakeGap;
      rakeOrdinal += 1;
    }
  }

  const fasciaDepth = roofDepth + 0.08;
  const fasciaSegmentDepth = fasciaDepth / 3;
  const fasciaGap = 0.02;
  const fasciaWidths = [0.148, 0.164, 0.154] as const;
  const fasciaHeights = [0.184, 0.208, 0.194] as const;
  const fasciaNormalOffsets = [-0.009, 0.012, -0.004] as const;
  for (const side of [-1, 1] as const) {
    const rotationZ = side * -roofPitch;
    const cos = Math.cos(rotationZ);
    const sin = Math.sin(rotationZ);
    const fasciaParts: WeatheredRoofEdgePart[] = [];
    for (let index = 0; index < 3; index += 1) {
      const variationIndex =
        (index + ((seed + (side > 0 ? 1 : 0)) % 3 + 3) % 3) % 3;
      const segmentStart =
        -fasciaDepth * 0.5
        + fasciaSegmentDepth * index
        + (index === 0 ? 0 : fasciaGap * 0.5);
      const segmentEnd =
        -fasciaDepth * 0.5
        + fasciaSegmentDepth * (index + 1)
        - (index === 2 ? 0 : fasciaGap * 0.5);
      const localY = fasciaNormalOffsets[variationIndex]!;
      fasciaParts.push({
        size: [
          fasciaWidths[variationIndex]!,
          fasciaHeights[variationIndex]!,
          segmentEnd - segmentStart,
        ],
        position: [
          side * roofHalfSpan - localY * sin,
          wallTop - eaveDrop - 0.02 + localY * cos,
          (segmentStart + segmentEnd) * 0.5,
        ],
        rotation: [0, 0, rotationZ],
        faces: [
          side > 0 ? 'positive-x' : 'negative-x',
          'negative-y',
        ],
        variantSalt: 11 + (side > 0 ? 3 : 0) + index,
      });
    }
    const fascia = addMesh(
      group,
      mergeWeatheredRoofEdgeParts(fasciaParts, seed),
      material,
      new THREE.Vector3(),
    );
    markWeatheredRoofEdge(fascia, 'eave-fascia', fasciaParts.length);
    fascia.name = 'Residence deep-eave timber fascia';
    fascia.userData.residenceRoofEdgeButtGapMeters = fasciaGap;
    fascia.userData.residenceRoofEdgeVerticalVariationMeters =
      Math.max(...fasciaHeights) - Math.min(...fasciaHeights);
  }

  group.userData.residenceRoofEdgeFinish = 'muted-weathered-wood';
  group.userData.residenceRoofEdgeVariantCount =
    WEATHERED_ROOF_EDGE_TINTS.length;
}

function markWeatheredRoofEdge(
  mesh: THREE.Mesh,
  role: 'ridge' | 'gable-rake' | 'eave-fascia',
  partCount: number,
): void {
  mesh.userData.residenceRoofSurface = true;
  mesh.userData.residenceRoofFinish = 'weathered-split-wood-edge';
  mesh.userData.residenceRoofEdgeRole = role;
  mesh.userData.residenceRoofEdgePartCount = partCount;
  mesh.userData.residenceRoofEdgeVariantPalette = 'muted-weathered-wood-4';
}

function addStonePortalPorch(
  group: THREE.Group,
  entryX: number,
  frontZ: number,
  foundationHeight: number,
  roofMaterial: THREE.Material,
): void {
  for (const side of [-1, 1] as const) {
    addMesh(
      group,
      new THREE.BoxGeometry(0.16, 1.72, 0.16),
      timberMaterial('dark'),
      new THREE.Vector3(entryX + side * 0.68, foundationHeight + 0.86, frontZ + 0.7),
    );
  }
  const porchRoof = addMesh(
    group,
    new THREE.BoxGeometry(1.7, 0.12, 1.08),
    roofMaterial,
    new THREE.Vector3(entryX, foundationHeight + 1.77, frontZ + 0.36),
    new THREE.Euler(-0.16, 0, 0),
  );
  porchRoof.name = 'Residence stone-portal porch roof';
  porchRoof.userData.residenceRoofSurface = true;
  applyWarmShingleBackFaceFinish(porchRoof);
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
  roofMaterial: THREE.Material,
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
  const annexRoof = addMesh(
    group,
    new THREE.BoxGeometry(annexWidth + 0.22, 0.12, 3.68),
    roofMaterial,
    new THREE.Vector3(x, foundationHeight + annexHeight + 0.12, -0.28),
    new THREE.Euler(0, 0, side * 0.18),
  );
  annexRoof.name = 'Residence working-annex roof';
  annexRoof.userData.residenceRoofSurface = true;
  applyWarmShingleBackFaceFinish(annexRoof);
}

function addTierOneEntryCanopy(
  group: THREE.Group,
  entryX: number,
  frontZ: number,
  foundationHeight: number,
  roofMaterial: THREE.Material,
  structuralMaterial: THREE.Material,
): void {
  const canopyY = foundationHeight + 2.08;
  const canopy = addMesh(
    group,
    new THREE.BoxGeometry(1.72, 0.11, 0.92),
    roofMaterial,
    new THREE.Vector3(entryX, canopyY, frontZ + 0.35),
    new THREE.Euler(0.18, 0, 0),
  );
  canopy.name = 'Residence deep-eave door canopy roof';
  canopy.userData.residenceRoofSurface = true;
  applyWarmShingleBackFaceFinish(canopy);
  for (const side of [-1, 1] as const) {
    const brace = addMesh(
      group,
      new THREE.BoxGeometry(0.1, 0.1, 0.82),
      structuralMaterial,
      new THREE.Vector3(
        entryX + side * 0.65,
        canopyY - 0.34,
        frontZ + 0.2,
      ),
      new THREE.Euler(-0.67, 0, 0),
    );
    brace.name = 'Residence door canopy timber brace';
  }
}

type ResidenceYardDetail = 'bench' | 'drying-rail' | 'kindling-rack';

function addTierOneYardDetail(
  group: THREE.Group,
  seed: number,
  entrySide: -1 | 1,
  halfWidth: number,
  halfDepth: number,
  weatheredMaterial: THREE.Material,
): ResidenceYardDetail {
  const variants: readonly ResidenceYardDetail[] = [
    'bench',
    'drying-rail',
    'kindling-rack',
  ];
  const detail = variants[Math.abs(seed) % variants.length]!;
  const x = -entrySide * Math.min(halfWidth - 0.72, 1.45);
  const z = halfDepth + 0.42;
  const parts: BoxPart[] = [];
  if (detail === 'bench') {
    parts.push(
      { size: [1.45, 0.14, 0.38], position: [x, 0.55, z] },
      { size: [0.13, 0.52, 0.13], position: [x - 0.52, 0.27, z] },
      { size: [0.13, 0.52, 0.13], position: [x + 0.52, 0.27, z] },
      { size: [1.4, 0.11, 0.11], position: [x, 0.88, z - 0.15] },
    );
  } else if (detail === 'drying-rail') {
    parts.push(
      { size: [0.13, 1.42, 0.13], position: [x - 0.55, 0.71, z] },
      { size: [0.13, 1.42, 0.13], position: [x + 0.55, 0.71, z] },
      { size: [1.35, 0.12, 0.12], position: [x, 1.36, z] },
      { size: [1.08, 0.08, 0.08], position: [x, 0.91, z] },
    );
  } else {
    for (let index = 0; index < 7; index += 1) {
      parts.push({
        size: [0.18, 0.18, 0.78],
        position: [
          x - 0.5 + (index % 4) * 0.32,
          0.12 + Math.floor(index / 4) * 0.2,
          z,
        ],
        rotation: [0, (index % 3 - 1) * 0.08, Math.PI * 0.5],
      });
    }
  }
  const propGeometry = mergeBoxParts(parts);
  const stumpGeometry = new THREE.CylinderGeometry(0.3, 0.35, 0.48, 9);
  stumpGeometry.rotateZ(0.035);
  stumpGeometry.translate(
    entrySide * Math.min(halfWidth - 0.68, 1.32),
    0.24,
    halfDepth + 1.02,
  );
  const combinedYardGeometry = mergeGeometries(
    [propGeometry, stumpGeometry],
    false,
  );
  propGeometry.dispose();
  stumpGeometry.dispose();
  if (!combinedYardGeometry) {
    throw new Error('Could not merge residence lived-in yard geometry.');
  }
  const prop = addMesh(
    group,
    combinedYardGeometry,
    weatheredMaterial,
    new THREE.Vector3(),
  );
  prop.name = `Residence lived-in yard detail:${detail}`;
  prop.userData.residenceYardDetail = detail;
  prop.userData.residenceYardWork = 'chopping-block';
  return detail;
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
  for (let index = 0; index < 8; index += 1) {
    const stack = new THREE.Group();
    stack.name = `UpgradeRoofTileSegment:${index}`;
    stack.position.set(
      -0.65 + (index % 4) * 0.42,
      0.04,
      pileZ + 0.72 + Math.floor(index / 4) * 0.42,
    );
    stack.rotation.y = (index % 2 === 0 ? -1 : 1) * 0.05;
    works.add(stack);
    for (let layer = 0; layer < 4; layer += 1) {
      addMesh(
        stack,
        new THREE.BoxGeometry(0.34, 0.035, 0.38),
        layer % 2 === 0
          ? sharedBuildingMaterial('clayRed')
          : sharedBuildingMaterial('clayDark'),
        new THREE.Vector3(0, layer * 0.04, 0),
      ).name = 'Delivered fired roof tile';
    }
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

export function createResidenceMesh(
  seed = 0,
  tier: 1 | 2 | 3 = 1,
  tiledRoof = false,
): THREE.Group {
  const appearance = pickResidenceAppearance(seed);
  const { facade, roof, archetype, entrySide, trim } = appearance;
  const dimensions = dimensionsForTier(archetype, tier);
  const tierOneStructuralMaterial =
    tier === 1
      ? tierOneResidenceMaterial('structural-timber')
      : timberMaterial('dark');
  const tierOneWeatheredMaterial =
    tier === 1
      ? tierOneResidenceMaterial('weathered-timber')
      : timberMaterial('weathered');
  const tierOneFoundationMaterial =
    tier === 1
      ? tierOneResidenceMaterial('foundation-stone')
      : stoneMaterial('mid');
  const tierOneFoundationCapMaterial =
    tier === 1
      ? tierOneResidenceMaterial('foundation-cap')
      : stoneMaterial('light');
  const wallMaterial =
    tier === 1 ? tierOneWeatheredMaterial : residenceFacadeMaterial(facade);
  const roofSurfaceMaterial =
    tiledRoof
      ? sharedBuildingMaterial('clayRed')
      : tier === 1
      ? tierOneResidenceMaterial('wood-shingle')
      : residenceRoofMaterial(roof);
  // Course boards and ridge caps must stay on the same shared roof surface as
  // their substrate. Using the wall-timber material here makes merged courses
  // read as long chocolate bands and bypasses shingle UV/weathering.
  const exposedRoofCourseMaterial = roofSurfaceMaterial;
  const shutterMaterial = residenceTrimMaterial(trim);
  const windowMaterial = createWindowMaterial();

  const group = new THREE.Group();
  group.name = 'Residence';
  group.userData.windowMaterial = windowMaterial;
  group.userData.residenceArchetype = archetype;
  group.userData.residenceTier = tier;
  group.userData.residenceRoof = roof;
  group.userData.residenceTiledRoof = tiledRoof;
  group.userData.residenceRoofFinish =
    tiledRoof ? 'fired-clay-tile' : 'split-wood-shingle';
  group.userData.residenceVisualSeed = seed;

  const { width, depth, foundationHeight, groundHeight, upperHeight, ridgeHeight } = dimensions;
  const halfW = width * 0.5;
  const halfD = depth * 0.5;
  const groundTop = foundationHeight + groundHeight;
  const wallTop = groundTop + upperHeight;
  const roofPitch = Math.atan2(ridgeHeight, halfW);
  const roofOverhang = tier === 1 ? 0.54 : 0.3;
  const roofDepthOverhang = tier === 1 ? 0.68 : 0.31;
  const roofHalfSpan = halfW + roofOverhang;
  const roofEaveDrop = roofOverhang * Math.tan(roofPitch);
  const slopeLen = roofHalfSpan / Math.cos(roofPitch);
  const frontZ = halfD - 0.075;
  group.userData.residenceRoofPitchDegrees = THREE.MathUtils.radToDeg(roofPitch);
  group.userData.residenceRoofOverhangMeters = roofOverhang;

  const foundation = addMesh(
    group,
    new THREE.BoxGeometry(width + 0.38, foundationHeight, depth + 0.38),
    tier === 1 ? tierOneFoundationMaterial : stoneMaterial('light'),
    new THREE.Vector3(0, foundationHeight * 0.5, 0),
  );
  foundation.name = 'Residence limestone plinth';
  if (tier === 1) {
    const plinthCap = addMesh(
      group,
      new THREE.BoxGeometry(width + 0.46, 0.13, depth + 0.46),
      tierOneFoundationCapMaterial,
      new THREE.Vector3(0, foundationHeight - 0.035, 0),
    );
    plinthCap.name = 'Residence limestone plinth cap';
  } else {
    addMesh(
      group,
      new THREE.BoxGeometry(width, groundHeight, depth),
      stoneMaterial('mid'),
      new THREE.Vector3(0, foundationHeight + groundHeight * 0.5, 0),
    );
    addStoneStoreyCourses(group, width, depth, foundationHeight, groundHeight);
  }

  const wallCore = addMesh(
    group,
    new THREE.BoxGeometry(
      width - 0.12,
      tier === 1 ? groundHeight + upperHeight : upperHeight,
      depth - 0.12,
    ),
    wallMaterial,
    new THREE.Vector3(
      0,
      tier === 1
        ? foundationHeight + (groundHeight + upperHeight) * 0.5
        : groundTop + upperHeight * 0.5,
      0,
    ),
  );
  wallCore.name =
    tier === 1 ? 'Residence hand-hewn timber wall core' : 'Residence upper wall core';
  if (tier === 1) {
    addTierOneLimewashedInfill(
      group,
      width,
      depth,
      foundationHeight,
      wallTop,
      tierOneResidenceMaterial('lime-plaster'),
    );
    addTierOneTimberConstruction(
      group,
      width,
      depth,
      foundationHeight,
      wallTop,
      ridgeHeight,
      tierOneStructuralMaterial,
      tierOneWeatheredMaterial,
    );
  }
  const wallPlate = addMesh(
    group,
    new THREE.BoxGeometry(width + 0.12, 0.18, depth + 0.12),
    tier === 1 ? tierOneStructuralMaterial : timberMaterial('dark'),
    new THREE.Vector3(0, tier === 1 ? wallTop - 0.09 : groundTop + 0.04, 0),
  );
  wallPlate.name = 'Residence hewn timber wall plate';
  if (tier > 1) {
    addMesh(
      group,
      new THREE.BoxGeometry(width + 0.08, 0.14, depth + 0.08),
      stoneMaterial('mortar'),
      new THREE.Vector3(0, wallTop - 0.07, 0),
    );
  }

  const doorX = residenceGroundDoorLocalX(appearance);
  addPlankDoor(
    group,
    doorX,
    foundationHeight + 0.08,
    frontZ + 0.03,
    1.02,
    1.92,
    tierOneWeatheredMaterial,
  );
  addFrontWindow(
    group,
    windowMaterial,
    shutterMaterial,
    -entrySide * 1.38,
    foundationHeight + groundHeight * 0.55,
    frontZ + 0.02,
    tier === 1 ? 0.6 : 0.78,
    tier === 1 ? 0.72 : 1.02,
    false,
    tierOneWeatheredMaterial,
    tierOneStructuralMaterial,
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
    addSideWindow(
      group,
      windowMaterial,
      side,
      x,
      foundationHeight + groundHeight * 0.56,
      -0.35,
      tier === 1 ? 0.58 : 0.74,
      tier === 1 ? 0.7 : 0.98,
      tierOneWeatheredMaterial,
      tierOneStructuralMaterial,
    );
    if (tier > 1) addSideWindow(group, windowMaterial, side, x, groundTop + upperHeight * 0.54, 0.42, 0.78, 1.05);
  }

  for (let step = 0; step < 2; step++) {
    addMesh(
      group,
      new THREE.BoxGeometry(1.5 - step * 0.18, 0.16, 0.5),
      tier === 1
        ? (step === 0 ? tierOneFoundationMaterial : tierOneFoundationCapMaterial)
        : stoneMaterial(step === 0 ? 'mid' : 'light'),
      new THREE.Vector3(doorX, 0.08 + step * 0.12, halfD + 0.34 - step * 0.14),
    );
  }

  for (const side of [-1, 1] as const) {
    const roofPlane = addMesh(
      group,
      new THREE.BoxGeometry(
        slopeLen,
        tier === 1 ? 0.16 : 0.14,
        depth + roofDepthOverhang * 2,
      ),
      roofSurfaceMaterial,
      new THREE.Vector3(
        side * roofHalfSpan * 0.5,
        wallTop + (ridgeHeight - roofEaveDrop) * 0.5,
        0,
      ),
      new THREE.Euler(0, 0, side * -roofPitch),
    );
    roofPlane.name = `Residence main roof plane ${side < 0 ? 'left' : 'right'}`;
    roofPlane.userData.residenceRoofSurface = true;
    roofPlane.userData.residenceRoofFinish =
      tiledRoof ? 'fired-clay-tile' : 'split-wood-shingle';
    if (!tiledRoof) applyWarmShingleBackFaceFinish(roofPlane);
  }
  addRoofShingleCourses(
    group,
    exposedRoofCourseMaterial,
    roofHalfSpan,
    depth,
    roofDepthOverhang,
    wallTop,
    ridgeHeight,
    roofPitch,
    roofEaveDrop,
    seed,
    tiledRoof,
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
  }
  addWeatheredRoofEdgeCraft(
    group,
    tierOneWeatheredMaterial,
    roofHalfSpan,
    depth,
    roofDepthOverhang,
    halfD,
    wallTop,
    ridgeHeight,
    roofPitch,
    roofEaveDrop,
    tier === 1 ? 0.3 : 0.24,
    tier === 1 ? 0.24 : 0.18,
    seed,
  );

  if (tier === 1) {
    addTierOneEntryCanopy(
      group,
      doorX,
      frontZ,
      foundationHeight,
      exposedRoofCourseMaterial,
      tierOneStructuralMaterial,
    );
    group.userData.residenceYardDetail = addTierOneYardDetail(
      group,
      seed,
      entrySide,
      halfW,
      halfD,
      tierOneWeatheredMaterial,
    );
    group.userData.residenceYardWork = 'chopping-block';
  } else if (archetype === 'stone_portal') {
    addStonePortalPorch(
      group,
      doorX,
      frontZ,
      foundationHeight,
      roofSurfaceMaterial,
    );
  } else if (archetype === 'working_lean_to') {
    addWorkingLeanTo(
      group,
      entrySide === -1 ? 1 : -1,
      halfW,
      foundationHeight,
      roofSurfaceMaterial,
    );
  }

  if (tier === 3 && archetype !== 'working_lean_to') {
    addWorkingLeanTo(
      group,
      entrySide === -1 ? 1 : -1,
      halfW,
      foundationHeight,
      roofSurfaceMaterial,
    );
  }

  const chimneySide: -1 | 1 = entrySide === -1 ? 1 : -1;
  const chimneyX = chimneySide * (halfW - 0.92);
  const chimneyZ = -halfD + 1.22;
  const chimneyHeight = 2.02;
  const chimneyY = wallTop + 0.62 + chimneyHeight * 0.5;
  addMesh(
    group,
    new THREE.BoxGeometry(0.72, chimneyHeight, 0.72),
    tier === 1 ? tierOneFoundationMaterial : stoneMaterial('mid'),
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
  private readonly shadowProxyBatch: BatchedBuildingShadowProxies;
  private readonly onShadowCastersChanged?: () => void;
  private readonly serviceCoverageRoot: THREE.Group;
  private readonly serviceCoverageGeometry: THREE.RingGeometry;
  private readonly serviceCoverageMaterial: THREE.MeshBasicMaterial;
  private serviceCoverageMesh: THREE.InstancedMesh<
    THREE.RingGeometry,
    THREE.MeshBasicMaterial
  >;
  private serviceCoverageCapacity = 1;
  private readonly meshes = new Map<string, THREE.Group>();
  private serviceCoverageIds = new Set<string>();
  private serviceCoverageKind: ServiceCoverageView['kind'] | null = null;
  private serviceCoverageDirty = false;
  private readonly smokeEmitters = new Map<string, ChimneySmokeEmitter>();
  private readonly smokeEligible = new Map<string, boolean>();
  private readonly residenceOccupied = new Map<string, boolean>();
  private readonly residencePopulation = new Map<string, number>();
  private fireDisabledResidenceIds = new Set<string>();
  private destroyedResidenceIds = new Set<string>();
  private chimneySmokeAllowed = true;
  private eveningWindowGlow = 0;
  private nightPolicy: Pick<NightPolicyState, 'gathering' | 'curfew'> | undefined;
  private householdClock: GameClock | null = null;

  constructor(
    parent: THREE.Group,
    onShadowCastersChanged?: () => void,
  ) {
    this.onShadowCastersChanged = onShadowCastersChanged;
    this.root = new THREE.Group();
    this.root.name = 'Residences';
    this.shadowProxyBatch = new BatchedBuildingShadowProxies(
      this.root,
      'Batched residence shadow proxies',
      areBuildingShadowsEnabled(),
    );
    this.serviceCoverageRoot = new THREE.Group();
    this.serviceCoverageRoot.name = 'Residence service coverage';
    this.serviceCoverageGeometry = new THREE.RingGeometry(0.78, 1, 40);
    this.serviceCoverageGeometry.name = 'Served residence halo geometry';
    this.serviceCoverageMaterial = new THREE.MeshBasicMaterial({
      color: 0xe7c45c,
      opacity: 0.74,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    this.serviceCoverageMaterial.name = 'Served residence halo material';
    this.serviceCoverageMesh = this.createServiceCoverageMesh(
      this.serviceCoverageCapacity,
    );
    this.serviceCoverageRoot.add(this.serviceCoverageMesh);
    parent.add(this.root);
    parent.add(this.serviceCoverageRoot);
  }

  setServiceCoverageHighlights(
    residenceIds: ReadonlySet<string>,
    kind: ServiceCoverageView['kind'] | null,
  ): void {
    if (
      setsEqual(this.serviceCoverageIds, residenceIds)
      && this.serviceCoverageKind === kind
    ) {
      return;
    }
    this.serviceCoverageIds = new Set(residenceIds);
    this.serviceCoverageKind = kind;
    this.serviceCoverageMaterial.color.setHex(
      kind === 'well' ? 0x57c9ff : 0xe7c45c,
    );
    this.serviceCoverageDirty = true;
    this.syncServiceCoverageHighlights();
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

  setDestroyedResidenceIds(ids: ReadonlySet<string>): void {
    if (setsEqual(this.destroyedResidenceIds, ids)) return;
    this.destroyedResidenceIds = new Set(ids);
    for (const [id, marker] of this.meshes) {
      const destroyed = ids.has(id);
      marker.visible = !destroyed;
      const tier = Number(marker.userData.residenceTier ?? 0);
      if (destroyed || tier <= 0) {
        this.shadowProxyBatch.remove(id);
      } else {
        this.shadowProxyBatch.upsertResidence(id, tier as 1 | 2 | 3, marker);
      }
      if (this.serviceCoverageIds.has(id)) this.serviceCoverageDirty = true;
    }
    if (this.shadowProxyBatch.flush()) {
      this.onShadowCastersChanged?.();
    }
    if (this.serviceCoverageDirty) this.syncServiceCoverageHighlights();
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
      if (
        marker
        && (
          marker.userData.residenceTier !== residence.tier
          || marker.userData.residenceTiledRoof !== (residence.tiledRoof === true)
        )
      ) {
        if (this.serviceCoverageIds.has(residence.id)) {
          this.serviceCoverageDirty = true;
        }
        this.root.remove(marker);
        disposeGroup(marker);
        this.meshes.delete(residence.id);
        this.smokeEmitters.get(residence.id)?.dispose();
        this.smokeEmitters.delete(residence.id);
        marker = undefined;
      }
      if (!marker) {
        if (this.serviceCoverageIds.has(residence.id)) {
          this.serviceCoverageDirty = true;
        }
        const appearanceSeed = hashStringSeed(residence.id);
        const completedTier = residence.tier === 0 ? null : residence.tier;
        marker = completedTier == null
          ? createInitialResidenceConstructionMesh(appearanceSeed)
          : createResidenceMesh(
              appearanceSeed,
              completedTier,
              residence.tiledRoof === true,
            );
        marker.userData.fpCollisionAggregate = true;
        this.root.add(marker);
        this.meshes.set(residence.id, marker);

        const chimneyEmitter = marker.getObjectByName('ChimneyEmitter');
        if (chimneyEmitter) {
          this.smokeEmitters.set(residence.id, new ChimneySmokeEmitter(chimneyEmitter, appearanceSeed));
        }
      }
      const y = getHeightAt(residence.x, residence.z);
      if (
        this.serviceCoverageIds.has(residence.id)
        && (
          Math.abs(marker.position.x - residence.x) > 1e-6
          || Math.abs(marker.position.y - y) > 1e-6
          || Math.abs(marker.position.z - residence.z) > 1e-6
        )
      ) {
        this.serviceCoverageDirty = true;
      }
      marker.position.set(residence.x, y, residence.z);
      const destroyed = this.destroyedResidenceIds.has(residence.id);
      marker.visible = !destroyed;
      const condition = residence.condition ?? 0;
      marker.rotation.set(0, residence.yaw, condition * 0.012);
      marker.scale.set(
        1 - condition * 0.018,
        1 - condition * 0.065,
        1 - condition * 0.012,
      );
      const completedTier = residence.tier === 0 ? null : residence.tier;
      if (completedTier == null || destroyed) {
        this.shadowProxyBatch.remove(residence.id);
      } else {
        this.shadowProxyBatch.upsertResidence(
          residence.id,
          completedTier,
          marker,
        );
      }
      marker.userData.residenceCondition = condition;
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
    }

    for (const [id, marker] of this.meshes) {
      if (nextIds.has(id)) continue;
      if (this.serviceCoverageIds.has(id)) {
        this.serviceCoverageDirty = true;
      }
      this.root.remove(marker);
      this.shadowProxyBatch.remove(id);
      disposeGroup(marker);
      this.meshes.delete(id);
      this.smokeEmitters.get(id)?.dispose();
      this.smokeEmitters.delete(id);
      this.smokeEligible.delete(id);
      this.residenceOccupied.delete(id);
      this.residencePopulation.delete(id);
    }
    if (this.shadowProxyBatch.flush()) {
      this.onShadowCastersChanged?.();
    }
    if (this.serviceCoverageDirty) this.syncServiceCoverageHighlights();
  }

  private syncServiceCoverageHighlights(): void {
    this.ensureServiceCoverageCapacity(this.serviceCoverageIds.size);
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();
    const groundRotation = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(-Math.PI / 2, 0, 0),
    );
    const matrix = new THREE.Matrix4();
    let index = 0;
    for (const id of this.serviceCoverageIds) {
      const source = this.meshes.get(id);
      if (!source || !source.visible) continue;
      const radius = serviceCoverageRadius(
        Number(source.userData.residenceTier ?? 1),
      );
      position.copy(source.position);
      position.y += 0.11;
      scale.set(radius, radius, radius);
      matrix.compose(position, groundRotation, scale);
      this.serviceCoverageMesh.setMatrixAt(index, matrix);
      index += 1;
    }
    this.serviceCoverageMesh.count = index;
    this.serviceCoverageMesh.instanceMatrix.needsUpdate = true;
    this.serviceCoverageMesh.computeBoundingSphere();
    this.serviceCoverageMesh.userData.serviceCoverageKind =
      this.serviceCoverageKind;
    this.serviceCoverageDirty = false;
  }

  private ensureServiceCoverageCapacity(required: number): void {
    if (required <= this.serviceCoverageCapacity) return;
    let capacity = this.serviceCoverageCapacity;
    while (capacity < required) capacity *= 2;
    this.serviceCoverageRoot.remove(this.serviceCoverageMesh);
    this.serviceCoverageCapacity = capacity;
    this.serviceCoverageMesh = this.createServiceCoverageMesh(capacity);
    this.serviceCoverageRoot.add(this.serviceCoverageMesh);
  }

  private createServiceCoverageMesh(
    capacity: number,
  ): THREE.InstancedMesh<THREE.RingGeometry, THREE.MeshBasicMaterial> {
    const mesh = new THREE.InstancedMesh(
      this.serviceCoverageGeometry,
      this.serviceCoverageMaterial,
      capacity,
    );
    mesh.name = 'Served residence ground halos';
    mesh.count = 0;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.renderOrder = 18;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    return mesh;
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
    this.serviceCoverageIds.clear();
    this.serviceCoverageKind = null;
    for (const marker of this.meshes.values()) {
      disposeGroup(marker);
    }
    this.meshes.clear();
    this.shadowProxyBatch.dispose();
    this.serviceCoverageGeometry.dispose();
    this.serviceCoverageMaterial.dispose();
    this.serviceCoverageRoot.removeFromParent();
    this.root.removeFromParent();
  }
}

function serviceCoverageRadius(tier: number): number {
  if (tier >= 3) return 5.25;
  if (tier === 2) return 4.55;
  if (tier === 1) return 3.85;
  return 3.35;
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
  const roofTilesRemaining = Math.max(
    0,
    (residence.upgradeDeliveredRoofTiles ?? 0)
      - (residence.upgradeRequiredRoofTiles ?? 0) * progress,
  );
  const roofTileFill = (residence.upgradeRequiredRoofTiles ?? 0) <= 1e-6
    ? 0
    : roofTilesRemaining / (residence.upgradeRequiredRoofTiles ?? 1);
  syncUpgradeMaterialSegments(works, 'UpgradeTimberSegment:', timberFill);
  syncUpgradeMaterialSegments(works, 'UpgradeStoneSegment:', stoneFill);
  syncUpgradeMaterialSegments(works, 'UpgradeRoofTileSegment:', roofTileFill);
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
