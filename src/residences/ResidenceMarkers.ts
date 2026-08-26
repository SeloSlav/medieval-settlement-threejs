import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { addTriangularGableWall } from '../buildings/meshPrimitives.ts';
import { addLogPile } from '../buildings/logPile.ts';
import { BatchedBuildingShadowProxies } from '../buildings/buildingShadowProxy.ts';
import {
  addProceduralDoor,
  addProceduralWindow,
  type DoorEntranceAccess,
} from '../buildings/meshes/facadeOpeningKit.ts';
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
import type { ResidenceState } from '../resources/types.ts';
import { RESIDENCE_FIREWOOD_CAPACITY } from '../generated/gameBalance.ts';
import { hashStringSeed } from '../utils/random.ts';
import type { GameClock } from '../world/gameCalendar.ts';
import { residenceWindowActivity } from './householdRoutine.ts';
import type { ServiceCoverageView } from '../resources/serviceCoverage.ts';
import { batchResidenceStaticMeshes } from './staticResidenceBatch.ts';
import { ResidenceStaticBatches } from './ResidenceStaticBatches.ts';

const WINDOW_GLOW_EMISSIVE = 0xffc060;
const WINDOW_GLOW_COLOR = 0x4a3820;
const WINDOW_DARK_EMISSIVE = 0x18201f;
const WINDOW_DARK_COLOR = 0x303a39;
// Leaves 0.315 m between the widest window's folded-open shutter and center post.
const SIDE_WINDOW_CENTER_OFFSET_METERS = 1.25;

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

type ResidenceTier = 1 | 2 | 3 | 4;
type ResidenceRoofFinish = 'bundled-thatch' | 'split-wood-shingle' | 'fired-clay-tile';

type TierOneResidenceSurface =
  | 'wattle-daub'
  | 'foundation-stone'
  | 'structural-timber'
  | 'weathered-timber'
  | 'thatch';

function tierOneResidenceMaterial(
  surface: TierOneResidenceSurface,
): THREE.MeshStandardMaterial {
  if (surface === 'wattle-daub') return sharedBuildingMaterial('plasterGrey');
  if (surface === 'foundation-stone') return sharedBuildingMaterial('masonryDark');
  if (surface === 'structural-timber') return sharedBuildingMaterial('timberDark');
  if (surface === 'weathered-timber') {
    return sharedBuildingMaterial('timberWeathered');
  }
  return sharedBuildingMaterial('thatch');
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

function dimensionsForTier(archetype: ResidenceArchetype, tier: ResidenceTier): HouseDimensions {
  const base = dimensionsForArchetype(archetype);
  if (tier === 1) {
    return {
      width: base.width * 0.76,
      depth: base.depth * 0.88,
      foundationHeight: 0.3,
      groundHeight: 2.02,
      upperHeight: 0.08,
      ridgeHeight: 2.72,
    };
  }
  if (tier === 4) return { width: base.width * 1.38, depth: base.depth * 1.28, foundationHeight: 0.72, groundHeight: 2.72, upperHeight: 2.7, ridgeHeight: 2.95 };
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
  glazed = true,
): void {
  const parts = addProceduralWindow(group, {
    position: new THREE.Vector3(x, y, z),
    face: 'positive-z',
    width,
    height,
    paneMaterial: windowMaterial,
    frameMaterial: structuralMaterial,
    sillMaterial: weatheredMaterial,
    shutterMaterial,
    shutters,
    namePrefix: 'Residence front',
  });
  parts.root.userData.residenceWallCutThrough = !glazed;
  parts.root.userData.residenceWindowGlazing = glazed
    ? 'glazed-pane'
    : 'open-aperture';
  if (glazed) {
    parts.pane.name = 'Residence front window pane';
  } else {
    parts.pane.removeFromParent();
    parts.pane.geometry.dispose();
    parts.reveal.position.z = -0.34;
    parts.reveal.material = windowMaterial;
    parts.reveal.name = 'Residence front window recessed lit interior';
    parts.reveal.userData.facadeOpeningRole = 'window-interior';
    parts.reveal.userData.residenceWindowInteriorDepthMeters = 0.34;
  }
  for (const framePart of parts.frame) {
    if (framePart.userData.facadeOpeningRole === 'window-jamb') {
      framePart.name = 'Residence front window hewn casing';
    } else if (framePart.userData.facadeOpeningRole === 'window-lintel') {
      framePart.name = 'Residence front window hewn lintel';
    }
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
  glazed = true,
): void {
  const parts = addProceduralWindow(group, {
    position: new THREE.Vector3(x, y, z),
    face: side > 0 ? 'positive-x' : 'negative-x',
    width,
    height,
    paneMaterial: windowMaterial,
    frameMaterial: structuralMaterial,
    sillMaterial: weatheredMaterial,
    namePrefix: 'Residence side',
  });
  parts.root.userData.residenceWallCutThrough = !glazed;
  parts.root.userData.residenceWindowGlazing = glazed
    ? 'glazed-pane'
    : 'open-aperture';
  if (glazed) {
    parts.pane.name = 'Residence side window pane';
  } else {
    parts.pane.removeFromParent();
    parts.pane.geometry.dispose();
    parts.reveal.position.z = -0.34;
    parts.reveal.material = windowMaterial;
    parts.reveal.name = 'Residence side window recessed lit interior';
    parts.reveal.userData.facadeOpeningRole = 'window-interior';
    parts.reveal.userData.residenceWindowInteriorDepthMeters = 0.34;
  }
  for (const framePart of parts.frame) {
    if (framePart.userData.facadeOpeningRole === 'window-jamb') {
      framePart.name = 'Residence side window hewn casing';
    } else if (framePart.userData.facadeOpeningRole === 'window-lintel') {
      framePart.name = 'Residence side window hewn lintel';
    }
  }
}

function addPlankDoor(
  group: THREE.Group,
  x: number,
  baseY: number,
  z: number,
  width = 1.02,
  height = 1.92,
  weatheredMaterial: THREE.Material = timberMaterial('weathered'),
  entranceAccess: DoorEntranceAccess = 'auto-stone-steps',
): void {
  const parts = addProceduralDoor(group, {
    position: new THREE.Vector3(x, baseY, z),
    face: 'positive-z',
    width,
    height,
    leafMaterial: timberMaterial('mid'),
    frameMaterial: weatheredMaterial,
    namePrefix: 'Residence',
    entranceAccess,
  });
  parts.reveal.name = 'Residence shadowed plank door aperture';
  parts.reveal.userData.residenceSurfaceRole = 'dark-aperture';
  parts.leaf.name = 'Residence visible timber plank door leaf';
  parts.latch.name = 'Residence door iron latch';
  for (const framePart of parts.frame) {
    if (framePart.userData.facadeOpeningRole === 'door-jamb') {
      framePart.name = 'Residence door hewn jamb';
    } else if (framePart.userData.facadeOpeningRole === 'door-lintel') {
      framePart.name = 'Residence door hewn lintel';
    } else if (
      framePart.userData.facadeOpeningRole === 'door-threshold'
      && entranceAccess === 'ground-level'
    ) {
      // The Tier 1 sill is centred 0.08 m above the foundation with a
      // 0.17 m section, placing its underside 0.085 m below the door origin.
      // Continue that construction line through the threshold instead of
      // leaving a bright stone block perched above the sill.
      framePart.position.y = -0.035;
      framePart.name = 'Residence sill-flush ground-level door threshold';
      framePart.userData.residenceThresholdBottomOffsetMeters = -0.085;
      framePart.userData.residenceThresholdAlignment = 'lower-timber-sill-underside';
    }
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

function addTierFourFacadeFinish(
  group: THREE.Group,
  width: number,
  depth: number,
  groundTop: number,
  wallTop: number,
): void {
  const upperHeight = wallTop - groundTop;
  const pierHeight = upperHeight + 0.08;
  const pierY = groundTop + upperHeight * 0.5;
  for (const x of [-width * 0.5, width * 0.5]) {
    for (const z of [-depth * 0.5, depth * 0.5]) {
      const pier = addMesh(
        group,
        new THREE.BoxGeometry(0.28, pierHeight, 0.28),
        stoneMaterial('light'),
        new THREE.Vector3(x, pierY, z),
      );
      pier.name = 'Residence tier-four ashlar upper-storey corner pier';
      pier.userData.residenceFacadeModule = 'tier-4-corner-pier';
    }
  }
  for (const z of [-depth * 0.5 - 0.03, depth * 0.5 + 0.03]) {
    const band = addMesh(
      group,
      new THREE.BoxGeometry(width + 0.34, 0.2, 0.16),
      stoneMaterial('light'),
      new THREE.Vector3(0, groundTop + 0.06, z),
    );
    band.name = 'Residence tier-four dressed-stone floor band';
    band.userData.residenceFacadeModule = 'tier-4-floor-band';
  }
  for (const x of [-width * 0.5 - 0.03, width * 0.5 + 0.03]) {
    const band = addMesh(
      group,
      new THREE.BoxGeometry(0.16, 0.2, depth + 0.34),
      stoneMaterial('light'),
      new THREE.Vector3(x, groundTop + 0.06, 0),
    );
    band.name = 'Residence tier-four dressed-stone side band';
    band.userData.residenceFacadeModule = 'tier-4-floor-band';
  }
}

function addTierFourCrossGable(
  group: THREE.Group,
  halfDepth: number,
  wallTop: number,
  roofMaterial: THREE.Material,
  wallMaterial: THREE.Material,
  windowMaterial: THREE.MeshStandardMaterial,
  shutterMaterial: THREE.MeshStandardMaterial,
  roofFinish: ResidenceRoofFinish,
): void {
  const width = 2.45;
  const depth = 1.12;
  const wallHeight = 1.08;
  const ridgeHeight = 0.92;
  const baseY = wallTop + 0.3;
  const centerZ = halfDepth + 0.02;
  const halfWidth = width * 0.5;
  const roofOverhang = 0.18;
  const roofHalfSpan = halfWidth + roofOverhang;
  const pitch = Math.atan2(ridgeHeight, halfWidth);
  const eaveDrop = roofOverhang * Math.tan(pitch);
  const slopeLength = roofHalfSpan / Math.cos(pitch);

  const dormerWall = addMesh(
    group,
    new THREE.BoxGeometry(width, wallHeight, depth),
    wallMaterial,
    new THREE.Vector3(0, baseY + wallHeight * 0.5, centerZ),
  );
  dormerWall.name = 'Residence tier-four central cross-gable mass';
  dormerWall.userData.residenceFacadeModule = 'tier-4-cross-gable';
  for (const zSign of [-1, 1] as const) {
    addTriangularGableWall(
      group,
      'z',
      centerZ + zSign * (depth * 0.5 - 0.035),
      halfWidth,
      baseY + wallHeight,
      ridgeHeight,
      0.12,
      wallMaterial,
    );
  }
  for (const side of [-1, 1] as const) {
    const roof = addMesh(
      group,
      new THREE.BoxGeometry(slopeLength, 0.12, depth + 0.32),
      roofMaterial,
      new THREE.Vector3(
        side * roofHalfSpan * 0.5,
        baseY + wallHeight + (ridgeHeight - eaveDrop) * 0.5,
        centerZ,
      ),
      new THREE.Euler(0, 0, side * -pitch),
    );
    roof.name = `Residence tier-four cross-gable tiled roof ${side < 0 ? 'left' : 'right'}`;
    roof.userData.residenceRoofSurface = true;
    roof.userData.residenceRoofFinish = roofFinish;
    roof.userData.residenceRoofModule = 'tier-4-cross-gable-roof';
  }
  addFrontWindow(
    group,
    windowMaterial,
    shutterMaterial,
    0,
    baseY + wallHeight * 0.53,
    centerZ + depth * 0.5 + 0.015,
    0.72,
    0.84,
    false,
  );
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

type TierOneWallOpening = {
  center: number;
  width: number;
  bottom: number;
  height: number;
};

type TierOneWallOpeningPlan = {
  front: TierOneWallOpening[];
  sides: TierOneWallOpening[];
};

function createTierOneWallOpeningPlan(
  doorX: number,
  frontWindowX: number,
  foundationHeight: number,
  groundHeight: number,
): TierOneWallOpeningPlan {
  const windowCenterY = foundationHeight + groundHeight * 0.55;
  return {
    front: [
      {
        center: doorX,
        width: 1.02,
        bottom: foundationHeight + 0.035,
        height: 1.84,
      },
      {
        center: frontWindowX,
        width: 0.62,
        bottom: windowCenterY - 0.34,
        height: 0.68,
      },
    ],
    sides: [{
      center: -SIDE_WINDOW_CENTER_OFFSET_METERS,
      width: 0.6,
      bottom: windowCenterY - 0.33,
      height: 0.66,
    }],
  };
}

function addTierOneWallShellWithOpenings(
  group: THREE.Group,
  width: number,
  depth: number,
  foundationHeight: number,
  wallTop: number,
  openings: TierOneWallOpeningPlan,
  material: THREE.Material,
  seed: number,
): THREE.Mesh {
  const halfW = width * 0.5;
  const halfD = depth * 0.5;
  const thickness = 0.18;
  const parts: BoxPart[] = [];
  appendPartitionedWall(
    parts,
    'front-back',
    -halfW + 0.1,
    halfW - 0.1,
    foundationHeight,
    wallTop,
    halfD - thickness * 0.5,
    thickness,
    openings.front,
  );
  appendPartitionedWall(
    parts,
    'front-back',
    -halfW + 0.1,
    halfW - 0.1,
    foundationHeight,
    wallTop,
    -halfD + thickness * 0.5,
    thickness,
    [],
  );
  for (const side of [-1, 1] as const) {
    appendPartitionedWall(
      parts,
      'side',
      -halfD + 0.1,
      halfD - 0.1,
      foundationHeight,
      wallTop,
      side * (halfW - thickness * 0.5),
      thickness,
      openings.sides,
    );
  }
  const wall = addMesh(
    group,
    applyTierOneDaubTint(mergeBoxParts(parts), seed),
    material,
    new THREE.Vector3(),
  );
  wall.name = 'Residence tier-one wall shell with true apertures';
  wall.userData.residenceWallOpeningCount =
    openings.front.length + openings.sides.length * 2;
  wall.userData.residenceWallConstruction = 'segmented-around-openings';
  wall.userData.residenceSurfaceRole = 'clay-lime-daub';
  return wall;
}

function appendPartitionedWall(
  parts: BoxPart[],
  orientation: 'front-back' | 'side',
  horizontalMin: number,
  horizontalMax: number,
  verticalMin: number,
  verticalMax: number,
  fixedCoordinate: number,
  thickness: number,
  openings: readonly TierOneWallOpening[],
): void {
  const horizontalCuts = sortedUniqueCuts([
    horizontalMin,
    horizontalMax,
    ...openings.flatMap((opening) => [
      THREE.MathUtils.clamp(opening.center - opening.width * 0.5, horizontalMin, horizontalMax),
      THREE.MathUtils.clamp(opening.center + opening.width * 0.5, horizontalMin, horizontalMax),
    ]),
  ]);
  const verticalCuts = sortedUniqueCuts([
    verticalMin,
    verticalMax,
    ...openings.flatMap((opening) => [
      THREE.MathUtils.clamp(opening.bottom, verticalMin, verticalMax),
      THREE.MathUtils.clamp(opening.bottom + opening.height, verticalMin, verticalMax),
    ]),
  ]);

  for (let horizontalIndex = 0; horizontalIndex < horizontalCuts.length - 1; horizontalIndex += 1) {
    const start = horizontalCuts[horizontalIndex];
    const end = horizontalCuts[horizontalIndex + 1];
    if (end - start <= 1e-4) continue;
    const horizontalCenter = (start + end) * 0.5;
    for (let verticalIndex = 0; verticalIndex < verticalCuts.length - 1; verticalIndex += 1) {
      const bottom = verticalCuts[verticalIndex];
      const top = verticalCuts[verticalIndex + 1];
      if (top - bottom <= 1e-4) continue;
      const verticalCenter = (bottom + top) * 0.5;
      const insideOpening = openings.some((opening) => (
        horizontalCenter > opening.center - opening.width * 0.5 + 1e-5
        && horizontalCenter < opening.center + opening.width * 0.5 - 1e-5
        && verticalCenter > opening.bottom + 1e-5
        && verticalCenter < opening.bottom + opening.height - 1e-5
      ));
      if (insideOpening) continue;
      parts.push(orientation === 'front-back'
        ? {
            size: [end - start, top - bottom, thickness],
            position: [horizontalCenter, verticalCenter, fixedCoordinate],
          }
        : {
            size: [thickness, top - bottom, end - start],
            position: [fixedCoordinate, verticalCenter, horizontalCenter],
          });
    }
  }
}

function sortedUniqueCuts(values: readonly number[]): number[] {
  return [...values]
    .sort((left, right) => left - right)
    .filter((value, index, sorted) => (
      index === 0 || Math.abs(value - sorted[index - 1]) > 1e-6
    ));
}

function addTierOneRubbleFooting(
  group: THREE.Group,
  width: number,
  depth: number,
  foundationHeight: number,
  seed: number,
  material: THREE.Material,
): THREE.Mesh {
  const parts: THREE.BufferGeometry[] = [];
  const coreIndexed = new THREE.BoxGeometry(
    width - 0.08,
    foundationHeight * 0.5,
    depth - 0.08,
  );
  const core = coreIndexed.toNonIndexed();
  coreIndexed.dispose();
  core.translate(0, foundationHeight * 0.25, 0);
  parts.push(core);
  const halfW = width * 0.5;
  const halfD = depth * 0.5;
  let ordinal = 0;

  const addCourse = (
    span: number,
    count: number,
    face: 'front-back' | 'side',
    fixed: number,
  ): void => {
    const nominal = span / count;
    for (let index = 0; index < count; index += 1) {
      const widthVariation = tierOneCraftVariation(seed, ordinal++, 0.18);
      const heightVariation = tierOneCraftVariation(seed, ordinal++, 0.055);
      const centerVariation = tierOneCraftVariation(seed, ordinal++, 0.045);
      const verticalVariation = tierOneCraftVariation(seed, ordinal++, 0.032);
      const stoneSpan = nominal * (0.72 + widthVariation);
      const stoneHeight = foundationHeight * 0.78 + heightVariation;
      const along = -span * 0.5 + nominal * (index + 0.5) + centerVariation;
      const stone = new THREE.IcosahedronGeometry(0.5, 0);
      if (face === 'front-back') {
        stone.scale(stoneSpan, stoneHeight, 0.42);
        stone.rotateY(tierOneCraftVariation(seed, ordinal++, 0.14));
        stone.rotateZ(tierOneCraftVariation(seed, ordinal++, 0.075));
        stone.translate(
          along,
          foundationHeight * 0.5 + verticalVariation,
          fixed,
        );
      } else {
        stone.scale(0.42, stoneHeight, stoneSpan);
        stone.rotateY(tierOneCraftVariation(seed, ordinal++, 0.14));
        stone.rotateX(tierOneCraftVariation(seed, ordinal++, 0.075));
        stone.translate(
          fixed,
          foundationHeight * 0.5 + verticalVariation,
          along,
        );
      }
      parts.push(stone);
    }
  };

  addCourse(width, Math.max(6, Math.round(width / 0.72)), 'front-back', halfD + 0.04);
  addCourse(width, Math.max(6, Math.round(width / 0.72)), 'front-back', -halfD - 0.04);
  addCourse(depth, Math.max(7, Math.round(depth / 0.72)), 'side', halfW + 0.04);
  addCourse(depth, Math.max(7, Math.round(depth / 0.72)), 'side', -halfW - 0.04);

  const footingGeometry = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  if (!footingGeometry) throw new Error('Could not merge tier-one rubble footing.');
  const footing = addMesh(
    group,
    applyTierOneRubbleTint(footingGeometry, seed),
    material,
    new THREE.Vector3(),
  );
  footing.name = 'Residence low rubble fieldstone footing';
  footing.userData.residenceFoundationConstruction = 'rough-laid-rubble-course';
  footing.userData.residenceFoundationStoneCount = parts.length - 1;
  return footing;
}

function tierOneCraftVariation(seed: number, ordinal: number, amount: number): number {
  const wave = Math.sin((seed + 17) * 12.9898 + (ordinal + 3) * 78.233) * 43_758.5453;
  return ((wave - Math.floor(wave)) * 2 - 1) * amount;
}

function applyTierOneRubbleTint(
  geometry: THREE.BufferGeometry,
  seed: number,
): THREE.BufferGeometry {
  const position = geometry.getAttribute('position');
  const colors = new Float32Array(position.count * 3);
  for (let index = 0; index < position.count; index += 1) {
    const variation = 0.6 + tierOneCraftVariation(seed, index, 0.08);
    colors[index * 3] = variation * 0.92;
    colors[index * 3 + 1] = variation * 0.9;
    colors[index * 3 + 2] = variation * 0.84;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.userData.buildingWeatheringProfile = 'masonry';
  geometry.userData.residenceRubbleTint = 'damp-fieldstone';
  return geometry;
}

function applyTierOneHewnTimberTint(
  geometry: THREE.BufferGeometry,
  seed: number,
): THREE.BufferGeometry {
  const position = geometry.getAttribute('position');
  const colors = new Float32Array(position.count * 3);
  for (let index = 0; index < position.count; index += 1) {
    const variation = 0.68 + tierOneCraftVariation(seed, index, 0.075);
    colors[index * 3] = variation * 0.92;
    colors[index * 3 + 1] = variation * 0.84;
    colors[index * 3 + 2] = variation * 0.75;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.userData.buildingWeatheringProfile = 'timber';
  geometry.userData.residenceHewnTimberTint = 'smoke-darkened-oak';
  return geometry;
}

function applyTierOneDaubTint(
  geometry: THREE.BufferGeometry,
  seed: number,
): THREE.BufferGeometry {
  const position = geometry.getAttribute('position');
  geometry.computeBoundingBox();
  const minimumY = geometry.boundingBox?.min.y ?? 0;
  const maximumY = geometry.boundingBox?.max.y ?? 1;
  const height = Math.max(0.1, maximumY - minimumY);
  const colors = new Float32Array(position.count * 3);
  for (let index = 0; index < position.count; index += 1) {
    const heightT = THREE.MathUtils.clamp(
      (position.getY(index) - minimumY) / height,
      0,
      1,
    );
    const dampBase = 0.82 + heightT * 0.11;
    const variation = tierOneCraftVariation(seed, index, 0.045);
    colors[index * 3] = dampBase + variation;
    colors[index * 3 + 1] = dampBase * 0.94 + variation * 0.7;
    colors[index * 3 + 2] = dampBase * 0.84 + variation * 0.45;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.userData.buildingWeatheringProfile = 'plaster';
  geometry.userData.residenceDaubTint = 'earthy-clay-lime';
  return geometry;
}

function sideBracePart(
  x: number,
  fromZ: number,
  fromY: number,
  toZ: number,
  toY: number,
): BoxPart {
  const dz = toZ - fromZ;
  const dy = toY - fromY;
  return {
    size: [0.13, 0.13, Math.hypot(dz, dy)],
    position: [x, (fromY + toY) * 0.5, (fromZ + toZ) * 0.5],
    rotation: [-Math.atan2(dy, dz), 0, 0],
  };
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
  seed: number,
): void {
  const halfW = width * 0.5;
  const halfD = depth * 0.5;
  const wallHeight = wallTop - foundationHeight;
  const sideFrameTop = wallTop - 0.25;
  const sideFrameHeight = sideFrameTop - foundationHeight;
  const parts: BoxPart[] = [
    {
      size: [width + 0.08, 0.17, 0.16],
      position: [0, foundationHeight + 0.08, halfD + 0.025],
    },
    {
      size: [width + 0.08, 0.17, 0.16],
      position: [0, foundationHeight + 0.08, -halfD - 0.025],
    },
    {
      size: [0.16, 0.17, depth - 0.06],
      position: [halfW + 0.025, foundationHeight + 0.08, 0],
    },
    {
      size: [0.16, 0.17, depth - 0.06],
      position: [-halfW - 0.025, foundationHeight + 0.08, 0],
    },
  ];
  for (const x of [-halfW, halfW]) {
    for (const z of [-halfD, halfD]) {
      parts.push({
        size: [0.18, sideFrameHeight, 0.18],
        position: [x, foundationHeight + sideFrameHeight * 0.5, z],
      });
    }
  }
  for (const z of [-halfD - 0.035, halfD + 0.035]) {
    parts.push({
      size: [0.16, wallHeight, 0.14],
      position: [0, foundationHeight + wallHeight * 0.5, z],
    });
  }
  for (const x of [-halfW - 0.035, halfW + 0.035]) {
    parts.push({
      size: [0.14, sideFrameHeight, 0.16],
      position: [x, foundationHeight + sideFrameHeight * 0.5, 0.42],
    });
    for (const zSide of [-1, 1] as const) {
      parts.push(sideBracePart(
        x,
        zSide * (halfD - 0.1),
        sideFrameTop - 0.1,
        zSide * (halfD * 0.68),
        sideFrameTop - 0.62,
      ));
    }
  }
  const construction = addMesh(
    group,
    applyTierOneHewnTimberTint(mergeBoxParts(parts), seed + 701),
    structuralMaterial,
    new THREE.Vector3(),
  );
  construction.name = 'Residence hand-hewn sill post and brace frame';
  construction.userData.residenceFacadeTimberRhythm = 'sill-post-side-brace-frame';
  construction.userData.residenceFacadeTimberRole = 'load-bearing-frame';
  construction.userData.residenceFrontRearDiagonalBraceCount = 0;
  construction.userData.residenceSideDiagonalBraceCount = 4;
  construction.userData.residenceSideFrameTopY = sideFrameTop;
  construction.userData.residenceSideFrameRoofClearanceMeters = wallTop - sideFrameTop;

  const gableParts: BoxPart[] = [];
  for (const zSign of [-1, 1] as const) {
    const z = zSign * (halfD + 0.045);
    gableParts.push(
      { size: [0.15, ridgeHeight - 0.08, 0.12], position: [0, wallTop + ridgeHeight * 0.48, z] },
      { size: [halfW * 1.32, 0.14, 0.12], position: [0, wallTop + ridgeHeight * 0.34, z] },
    );
  }
  const gableScreen = addMesh(
    group,
    applyTierOneHewnTimberTint(mergeBoxParts(gableParts), seed + 907),
    weatheredMaterial,
    new THREE.Vector3(),
  );
  gableScreen.name = 'Residence rough kingpost and collar gables';
  gableScreen.userData.residenceGableConstruction = 'kingpost-collar-frame';
}

type TierOneThatchRoofShape = {
  roofHalfSpan: number;
  roofDepth: number;
  wallTop: number;
  ridgeHeight: number;
  eaveDrop: number;
  roofPitch: number;
  seed: number;
};

const TIER_ONE_THATCH_METERS_PER_TILE = 1.4;
const TIER_ONE_THATCH_SURFACE_LIFT = 0.12;

function tierOneThatchSurfaceY(
  x: number,
  z: number,
  shape: TierOneThatchRoofShape,
): number {
  const slopeT = 1 - THREE.MathUtils.clamp(
    Math.abs(x) / shape.roofHalfSpan,
    0,
    1,
  );
  const depthT = THREE.MathUtils.clamp(z / shape.roofDepth + 0.5, 0, 1);
  const linear = shape.wallTop
    - shape.eaveDrop
    + (shape.ridgeHeight + shape.eaveDrop) * slopeT;
  const handPackedSag = -0.105 * Math.sin(Math.PI * slopeT);
  const ridgeSag = -0.052
    * Math.sin(Math.PI * depthT)
    * (0.26 + slopeT * 0.74);
  return linear + handPackedSag + ridgeSag + TIER_ONE_THATCH_SURFACE_LIFT;
}

function createTierOneThatchBlanketGeometry(
  side: -1 | 1,
  shape: TierOneThatchRoofShape,
): THREE.BufferGeometry {
  const slopeSegments = 7;
  const depthSegments = 10;
  const top: THREE.Vector3[][] = [];
  const bottom: THREE.Vector3[][] = [];
  for (let slopeIndex = 0; slopeIndex <= slopeSegments; slopeIndex += 1) {
    const slopeT = slopeIndex / slopeSegments;
    const topRow: THREE.Vector3[] = [];
    const bottomRow: THREE.Vector3[] = [];
    for (let depthIndex = 0; depthIndex <= depthSegments; depthIndex += 1) {
      const depthT = depthIndex / depthSegments;
      const eaveWobble = slopeIndex === 0
        ? tierOneCraftVariation(shape.seed + side * 31, depthIndex, 0.065)
        : 0;
      const vergeWobble = depthIndex === 0 || depthIndex === depthSegments
        ? tierOneCraftVariation(shape.seed + side * 47, slopeIndex, 0.045)
        : 0;
      const x = side * (
        shape.roofHalfSpan * (1 - slopeT) + eaveWobble
      );
      const zSign = depthIndex === 0 ? -1 : depthIndex === depthSegments ? 1 : 0;
      const z = -shape.roofDepth * 0.5
        + shape.roofDepth * depthT
        + zSign * vergeWobble;
      const packingVariation = tierOneCraftVariation(
        shape.seed + side * 59,
        slopeIndex * 19 + depthIndex,
        0.014,
      ) * Math.sin(Math.PI * slopeT);
      const eaveDropVariation = slopeIndex === 0
        ? Math.abs(tierOneCraftVariation(shape.seed, depthIndex + 113, 0.045))
        : 0;
      const y = tierOneThatchSurfaceY(x, z, shape)
        + packingVariation
        - eaveDropVariation;
      const thickness = THREE.MathUtils.lerp(0.29, 0.2, slopeT);
      topRow.push(new THREE.Vector3(x, y, z));
      bottomRow.push(new THREE.Vector3(x, y - thickness, z));
    }
    top.push(topRow);
    bottom.push(bottomRow);
  }

  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const uvFor = (point: THREE.Vector3): [number, number] => [
    Math.hypot(
      shape.roofHalfSpan - Math.abs(point.x),
      point.y - (shape.wallTop - shape.eaveDrop),
    ) / TIER_ONE_THATCH_METERS_PER_TILE,
    point.z / TIER_ONE_THATCH_METERS_PER_TILE,
  ];
  const appendFace = (
    sourceCorners: readonly THREE.Vector3[],
    expectedNormal: THREE.Vector3,
  ): void => {
    let corners = [...sourceCorners];
    const actualNormal = new THREE.Vector3()
      .subVectors(corners[1]!, corners[0]!)
      .cross(new THREE.Vector3().subVectors(corners[2]!, corners[0]!));
    if (actualNormal.dot(expectedNormal) < 0) {
      corners = [corners[0]!, corners[3]!, corners[2]!, corners[1]!];
    }
    const base = positions.length / 3;
    for (const corner of corners) {
      positions.push(corner.x, corner.y, corner.z);
      uvs.push(...uvFor(corner));
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };

  const upperNormal = new THREE.Vector3(side, 1, 0).normalize();
  for (let slopeIndex = 0; slopeIndex < slopeSegments; slopeIndex += 1) {
    for (let depthIndex = 0; depthIndex < depthSegments; depthIndex += 1) {
      appendFace([
        top[slopeIndex]![depthIndex]!,
        top[slopeIndex + 1]![depthIndex]!,
        top[slopeIndex + 1]![depthIndex + 1]!,
        top[slopeIndex]![depthIndex + 1]!,
      ], upperNormal);
      appendFace([
        bottom[slopeIndex]![depthIndex]!,
        bottom[slopeIndex]![depthIndex + 1]!,
        bottom[slopeIndex + 1]![depthIndex + 1]!,
        bottom[slopeIndex + 1]![depthIndex]!,
      ], new THREE.Vector3(0, -1, 0));
    }
  }
  for (let depthIndex = 0; depthIndex < depthSegments; depthIndex += 1) {
    appendFace([
      bottom[0]![depthIndex]!,
      top[0]![depthIndex]!,
      top[0]![depthIndex + 1]!,
      bottom[0]![depthIndex + 1]!,
    ], new THREE.Vector3(side, 0, 0));
    appendFace([
      bottom[slopeSegments]![depthIndex]!,
      bottom[slopeSegments]![depthIndex + 1]!,
      top[slopeSegments]![depthIndex + 1]!,
      top[slopeSegments]![depthIndex]!,
    ], new THREE.Vector3(-side, 0, 0));
  }
  for (const depthIndex of [0, depthSegments]) {
    const zSign = depthIndex === 0 ? -1 : 1;
    for (let slopeIndex = 0; slopeIndex < slopeSegments; slopeIndex += 1) {
      appendFace([
        bottom[slopeIndex]![depthIndex]!,
        bottom[slopeIndex + 1]![depthIndex]!,
        top[slopeIndex + 1]![depthIndex]!,
        top[slopeIndex]![depthIndex]!,
      ], new THREE.Vector3(0, 0, zSign));
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.userData.metricUvMeters = TIER_ONE_THATCH_METERS_PER_TILE;
  geometry.userData.residenceThatchBlanketGrid = {
    slopeSegments,
    depthSegments,
  };
  return geometry;
}

function markTierOneThatchEdge(
  mesh: THREE.Mesh,
  role: 'thatch-ridge-roll' | 'ragged-thatch-eave' | 'soft-thatch-verge',
  partCount: number,
): void {
  mesh.userData.residenceRoofSurface = true;
  mesh.userData.residenceRoofFinish = 'bundled-thatch';
  mesh.userData.residenceRoofEdgeRole = role;
  mesh.userData.residenceRoofEdgePartCount = partCount;
  mesh.userData.residenceRoofEdgeVariantPalette = 'hand-packed-thatch';
}

function addTierOneThatchEdgeCraft(
  group: THREE.Group,
  material: THREE.Material,
  shape: TierOneThatchRoofShape,
): void {
  const ridgeParts: THREE.BufferGeometry[] = [];
  const ridgePartCount = 3;
  const ridgePartDepth = shape.roofDepth / ridgePartCount;
  for (let index = 0; index < ridgePartCount; index += 1) {
    const radius = 0.17 + tierOneCraftVariation(shape.seed, 201 + index, 0.018);
    const length = ridgePartDepth + 0.09
      + tierOneCraftVariation(shape.seed, 211 + index, 0.04);
    const z = -shape.roofDepth * 0.5 + ridgePartDepth * (index + 0.5);
    const geometry = new THREE.CylinderGeometry(radius, radius * 0.94, length, 8, 1, false);
    geometry.rotateX(Math.PI * 0.5);
    geometry.translate(
      tierOneCraftVariation(shape.seed, 221 + index, 0.018),
      tierOneThatchSurfaceY(0, z, shape) + 0.075,
      z + tierOneCraftVariation(shape.seed, 231 + index, 0.025),
    );
    ridgeParts.push(geometry);
  }
  const ridgeGeometry = mergeGeometries(ridgeParts, false);
  for (const geometry of ridgeParts) geometry.dispose();
  if (!ridgeGeometry) throw new Error('Could not merge tier-one thatch ridge geometry.');
  const ridge = addMesh(group, ridgeGeometry, material, new THREE.Vector3());
  ridge.name = 'Residence hand-packed straw ridge roll';
  markTierOneThatchEdge(ridge, 'thatch-ridge-roll', ridgePartCount);

  const eavePartCount = 10;
  for (const side of [-1, 1] as const) {
    const parts: BoxPart[] = [];
    const partDepth = shape.roofDepth / eavePartCount;
    for (let index = 0; index < eavePartCount; index += 1) {
      const z = -shape.roofDepth * 0.5 + partDepth * (index + 0.5);
      const outward = tierOneCraftVariation(shape.seed + side * 13, 241 + index, 0.045);
      const drop = Math.abs(tierOneCraftVariation(shape.seed + side * 17, 251 + index, 0.055));
      parts.push({
        size: [0.31 + outward, 0.15 + drop * 0.45, partDepth + 0.075],
        position: [
          side * (shape.roofHalfSpan + 0.035 + outward * 0.35),
          tierOneThatchSurfaceY(shape.roofHalfSpan, z, shape) - 0.055 - drop,
          z,
        ],
        rotation: [0, 0, side * -shape.roofPitch],
      });
    }
    const eave = addMesh(
      group,
      mergeBoxParts(parts),
      material,
      new THREE.Vector3(),
    );
    eave.name = `Residence ragged bundled-thatch eave ${side < 0 ? 'left' : 'right'}`;
    markTierOneThatchEdge(eave, 'ragged-thatch-eave', parts.length);
    eave.userData.residenceThatchEaveVariationMeters = 0.1;
  }

  const vergePartCount = 4;
  const slopeLength = shape.roofHalfSpan / Math.cos(shape.roofPitch);
  for (const zSign of [-1, 1] as const) {
    for (const side of [-1, 1] as const) {
      const parts: BoxPart[] = [];
      for (let index = 0; index < vergePartCount; index += 1) {
        const slopeT = (index + 0.5) / vergePartCount;
        const x = side * shape.roofHalfSpan * (1 - slopeT);
        const z = zSign * (shape.roofDepth * 0.5 + 0.055
          + tierOneCraftVariation(shape.seed + side * 7, 271 + index, 0.035));
        parts.push({
          size: [
            slopeLength / vergePartCount + 0.12,
            0.145 + Math.abs(tierOneCraftVariation(shape.seed, 281 + index, 0.035)),
            0.22,
          ],
          position: [
            x,
            tierOneThatchSurfaceY(x, z, shape) + 0.025,
            z,
          ],
          rotation: [0, 0, side * -shape.roofPitch],
        });
      }
      const verge = addMesh(
        group,
        mergeBoxParts(parts),
        material,
        new THREE.Vector3(),
      );
      verge.name = `Residence soft thatch verge ${zSign < 0 ? 'rear' : 'front'}-${side < 0 ? 'left' : 'right'}`;
      markTierOneThatchEdge(verge, 'soft-thatch-verge', parts.length);
    }
  }

  group.userData.residenceRoofEdgeFinish = 'hand-dressed-thatch';
  group.userData.residenceRoofEdgeVariantCount = 7;
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
  finish: ResidenceRoofFinish,
): void {
  const thatched = finish === 'bundled-thatch';
  for (const side of [-1, 1] as const) {
    const parts: BoxPart[] = [];
    const courseCount = thatched ? 4 : 8;
    const roofDepth = depth + depthOverhang * 2;
    const boardsAcross = thatched
      ? 1
      : Math.max(7, Math.ceil(roofDepth / 0.72));
    const boardDepth = roofDepth / boardsAcross;
    const slopeLength = roofHalfSpan / Math.cos(roofPitch);
    const courseLength = slopeLength / courseCount * (thatched ? 1.34 : 0.74);
    const normalX = side * Math.sin(roofPitch);
    const normalY = Math.cos(roofPitch);
    for (let row = 0; row < courseCount; row += 1) {
      const t = (row + 0.48) / courseCount;
      const centerX = side * roofHalfSpan * (1 - t);
      const centerY = wallTop - eaveDrop + (ridgeHeight + eaveDrop) * t;
      for (let board = 0; board < boardsAcross; board += 1) {
        const stagger = thatched
          ? 0
          : ((row + board + Math.abs(seed)) % 3 - 1) * 0.025;
        const z = -roofDepth * 0.5 + boardDepth * (board + 0.5) + stagger;
        parts.push({
          size: [
            courseLength * (0.96 + ((row * 5 + board * 3 + Math.abs(seed)) % 5) * 0.012),
            thatched ? 0.05 : 0.045,
            Math.max(0.2, boardDepth - (thatched ? 0.012 : 0.025)),
          ],
          position: [
            centerX + normalX * (thatched ? 0.052 : 0.095),
            centerY + normalY * (thatched ? 0.052 : 0.095),
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
    if (finish === 'split-wood-shingle') applyWarmShingleBackFaceFinish(courses);
    courses.name =
      `Residence ${finish === 'fired-clay-tile' ? 'fired-clay tile' : finish === 'bundled-thatch' ? 'bundled-thatch' : 'split-wood shingle'} courses ${side < 0 ? 'left' : 'right'}`;
    courses.userData.residenceRoofSurface = true;
    courses.userData.residenceRoofFinish = finish;
    if (thatched) {
      courses.userData.residenceThatchBundleCount = parts.length;
      courses.userData.residenceThatchCourseCount = courseCount;
    }
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
  const scaffoldPostGeometry = new THREE.CylinderGeometry(
    0.07,
    0.085,
    scaffoldHeight,
    7,
  );
  const scaffoldWidthRailGeometry = new THREE.BoxGeometry(
    dimensions.width + 1.15,
    0.1,
    0.1,
  );
  const scaffoldDepthRailGeometry = new THREE.BoxGeometry(
    0.1,
    0.1,
    dimensions.depth + 1.15,
  );
  const scaffoldPlatformGeometry = new THREE.BoxGeometry(
    0.58,
    0.1,
    dimensions.depth + 1.05,
  );
  const deliveredTimberGeometry = new THREE.CylinderGeometry(0.1, 0.12, 1.45, 7);
  const deliveredStoneGeometries = [
    new THREE.BoxGeometry(0.34, 0.24, 0.3),
    new THREE.BoxGeometry(0.4, 0.24, 0.3),
  ] as const;
  const deliveredRoofTileGeometry = new THREE.BoxGeometry(0.34, 0.035, 0.38);
  for (const x of [-halfWidth, halfWidth]) {
    for (const z of [-halfDepth, halfDepth]) {
      const post = addMesh(
        works,
        scaffoldPostGeometry,
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
        scaffoldWidthRailGeometry,
        timberMaterial('weathered'),
        new THREE.Vector3(0, y, z),
      );
      rail.name = 'UpgradeScaffoldRail';
    }
    for (const x of [-halfWidth, halfWidth]) {
      const rail = addMesh(
        works,
        scaffoldDepthRailGeometry,
        timberMaterial('weathered'),
        new THREE.Vector3(x, y, 0),
      );
      rail.name = 'UpgradeScaffoldRail';
    }
  }
  for (const x of [-halfWidth, halfWidth]) {
    const platform = addMesh(
      works,
      scaffoldPlatformGeometry,
      timberMaterial('weathered'),
      new THREE.Vector3(x, Math.max(2.2, scaffoldHeight * 0.56), 0),
    );
    platform.name = 'UpgradeScaffoldPlatform';
  }

  const pileZ = halfDepth + 0.9;
  for (let index = 0; index < 8; index += 1) {
    const timber = addMesh(
      works,
      deliveredTimberGeometry,
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
      deliveredStoneGeometries[index % 2]!,
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
        deliveredRoofTileGeometry,
        layer % 2 === 0
          ? sharedBuildingMaterial('clayRed')
          : sharedBuildingMaterial('clayDark'),
        new THREE.Vector3(0, layer * 0.04, 0),
      ).name = 'Delivered fired roof tile';
    }
  }
}

export function createResidenceMesh(
  seed = 0,
  tier: ResidenceTier = 1,
  _legacyTiledRoof = false,
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
  const wallMaterial =
    tier === 1
      ? tierOneResidenceMaterial('wattle-daub')
      : residenceFacadeMaterial(facade);
  const roofFinish: ResidenceRoofFinish = tier === 1
    ? 'bundled-thatch'
    : tier >= 4
      ? 'fired-clay-tile'
      : 'split-wood-shingle';
  const effectiveTiledRoof = roofFinish === 'fired-clay-tile';
  const roofSurfaceMaterial = roofFinish === 'fired-clay-tile'
    ? sharedBuildingMaterial('clayRed')
    : roofFinish === 'bundled-thatch'
      ? tierOneResidenceMaterial('thatch')
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
  group.userData.residenceTiledRoof = effectiveTiledRoof;
  group.userData.residenceRoofFinish = roofFinish;
  group.userData.residenceRoofTierContract = tier === 1
    ? 'tier-1-thatch'
    : tier >= 4
      ? 'tier-4-fired-tile'
      : 'tier-2-3-split-wood';
  group.userData.residenceVisualSeed = seed;
  group.userData.residenceBuildingPlan = {
    tier,
    seed,
    massing: tier === 1
      ? ['low-longhouse-mass', 'deep-sagging-thatch-roof']
      : tier === 4
        ? ['expanded-two-storey-mass', 'central-cross-gable']
        : ['two-storey-house-mass'],
    facadeModules: tier === 4
      ? ['stone-ground-storey', 'ashlar-corner-piers', 'dressed-floor-band', 'cross-gable']
      : tier === 1
        ? [
            'rough-rubble-footing',
            'clay-lime-daub-infill',
            'true-wall-apertures',
            'hewn-sill-post-side-brace-frame',
          ]
        : ['stone-ground-storey', 'plastered-upper-storey'],
    roofFinish,
  };

  const { width, depth, foundationHeight, groundHeight, upperHeight, ridgeHeight } = dimensions;
  const halfW = width * 0.5;
  const halfD = depth * 0.5;
  const groundTop = foundationHeight + groundHeight;
  const wallTop = groundTop + upperHeight;
  const roofPitch = Math.atan2(ridgeHeight, halfW);
  const roofOverhang = tier === 1 ? 0.54 : 0.3;
  const roofDepthOverhang = tier === 1 ? 0.78 : 0.31;
  const roofHalfSpan = halfW + roofOverhang;
  const roofEaveDrop = roofOverhang * Math.tan(roofPitch);
  const slopeLen = roofHalfSpan / Math.cos(roofPitch);
  const frontZ = halfD - 0.075;
  const doorX = residenceGroundDoorLocalX(appearance);
  const frontWindowX = -entrySide * 1.38;
  const tierOneOpenings = tier === 1
    ? createTierOneWallOpeningPlan(
        doorX,
        frontWindowX,
        foundationHeight,
        groundHeight,
      )
    : null;
  group.userData.residenceRoofPitchDegrees = THREE.MathUtils.radToDeg(roofPitch);
  group.userData.residenceRoofOverhangMeters = roofOverhang;

  if (tier === 1) {
    addTierOneRubbleFooting(
      group,
      width,
      depth,
      foundationHeight,
      seed,
      tierOneFoundationMaterial,
    );
  } else {
    const foundation = addMesh(
      group,
      new THREE.BoxGeometry(width + 0.38, foundationHeight, depth + 0.38),
      stoneMaterial('light'),
      new THREE.Vector3(0, foundationHeight * 0.5, 0),
    );
    foundation.name = 'Residence limestone plinth';
    addMesh(
      group,
      new THREE.BoxGeometry(width, groundHeight, depth),
      stoneMaterial('mid'),
      new THREE.Vector3(0, foundationHeight + groundHeight * 0.5, 0),
    );
    addStoneStoreyCourses(group, width, depth, foundationHeight, groundHeight);
  }

  const wallCore = tier === 1 && tierOneOpenings
    ? addTierOneWallShellWithOpenings(
        group,
        width,
        depth,
        foundationHeight,
        wallTop,
        tierOneOpenings,
        wallMaterial,
        seed,
      )
    : addMesh(
        group,
        new THREE.BoxGeometry(width - 0.12, upperHeight, depth - 0.12),
        wallMaterial,
        new THREE.Vector3(0, groundTop + upperHeight * 0.5, 0),
      );
  if (tier > 1) wallCore.name = 'Residence upper wall core';
  if (tier === 1) {
    addTierOneTimberConstruction(
      group,
      width,
      depth,
      foundationHeight,
      wallTop,
      ridgeHeight,
      tierOneStructuralMaterial,
      tierOneWeatheredMaterial,
      seed,
    );
  }
  if (tier === 1) {
    const frontRearTieBeamY = groundTop + 0.04;
    const frontRearTieBeams = addMesh(
      group,
      mergeBoxParts([
        {
          size: [width + 0.12, 0.18, 0.16],
          position: [0, frontRearTieBeamY, halfD + 0.035],
        },
        {
          size: [width + 0.12, 0.18, 0.16],
          position: [0, frontRearTieBeamY, -halfD - 0.035],
        },
      ]),
      tierOneStructuralMaterial,
      new THREE.Vector3(),
    );
    frontRearTieBeams.name = 'Residence hewn timber wall plate';
    frontRearTieBeams.userData.residenceFrontRearTieBeamY = frontRearTieBeamY;
    frontRearTieBeams.userData.residenceWallColorTransitionY = groundTop;
    frontRearTieBeams.userData.residenceDoorHeadClearanceMeters =
      frontRearTieBeamY - 0.09 - (foundationHeight + 0.08 + 1.72);

    const recessedSidePlates = addMesh(
      group,
      mergeBoxParts([
        {
          size: [0.16, 0.18, depth - 0.06],
          position: [halfW + 0.035, wallTop - 0.25, 0],
        },
        {
          size: [0.16, 0.18, depth - 0.06],
          position: [-halfW - 0.035, wallTop - 0.25, 0],
        },
      ]),
      tierOneStructuralMaterial,
      new THREE.Vector3(),
    );
    recessedSidePlates.name = 'Residence recessed side wall plates below thatch';
    recessedSidePlates.userData.residenceSideFrameRoofClearanceMeters = 0.25;
  } else {
    const wallPlate = addMesh(
      group,
      new THREE.BoxGeometry(width + 0.12, 0.18, depth + 0.12),
      timberMaterial('dark'),
      new THREE.Vector3(0, groundTop + 0.04, 0),
    );
    wallPlate.name = 'Residence hewn timber wall plate';
  }
  if (tier > 1) {
    addMesh(
      group,
      new THREE.BoxGeometry(width + 0.08, 0.14, depth + 0.08),
      stoneMaterial('mortar'),
      new THREE.Vector3(0, wallTop - 0.07, 0),
    );
  }
  if (tier === 4) {
    addTierFourFacadeFinish(group, width, depth, groundTop, wallTop);
  }

  addPlankDoor(
    group,
    doorX,
    foundationHeight + 0.08,
    frontZ + 0.03,
    tier === 1 ? 0.9 : 1.02,
    tier === 1 ? 1.72 : 1.92,
    tierOneWeatheredMaterial,
    tier === 1 ? 'ground-level' : 'auto-stone-steps',
  );
  addFrontWindow(
    group,
    windowMaterial,
    shutterMaterial,
    frontWindowX,
    foundationHeight + groundHeight * 0.55,
    frontZ + 0.02,
    tier === 1 ? 0.5 : 0.78,
    tier === 1 ? 0.56 : 1.02,
    false,
    tierOneWeatheredMaterial,
    tierOneStructuralMaterial,
    tier !== 1,
  );

  if (tier > 1 && archetype === 'timber_balcony') {
    addFrontWindow(group, windowMaterial, shutterMaterial, -entrySide * 1.35, groundTop + upperHeight * 0.55, frontZ + 0.02);
    addPlankDoor(
      group,
      entrySide * 0.82,
      groundTop + 0.08,
      frontZ + 0.03,
      0.86,
      1.84,
      tierOneWeatheredMaterial,
      'existing-platform',
    );
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
      -SIDE_WINDOW_CENTER_OFFSET_METERS,
      tier === 1 ? 0.48 : 0.74,
      tier === 1 ? 0.54 : 0.98,
      tierOneWeatheredMaterial,
      tierOneStructuralMaterial,
      tier !== 1,
    );
    if (tier > 1) {
      addSideWindow(
        group,
        windowMaterial,
        side,
        x,
        groundTop + upperHeight * 0.54,
        SIDE_WINDOW_CENTER_OFFSET_METERS,
        0.78,
        1.05,
      );
    }
  }

  const tierOneThatchShape: TierOneThatchRoofShape | null = tier === 1
    ? {
        roofHalfSpan,
        roofDepth: depth + roofDepthOverhang * 2,
        wallTop,
        ridgeHeight,
        eaveDrop: roofEaveDrop,
        roofPitch,
        seed,
      }
    : null;
  for (const side of [-1, 1] as const) {
    const roofPlane = addMesh(
      group,
      tierOneThatchShape
        ? createTierOneThatchBlanketGeometry(side, tierOneThatchShape)
        : new THREE.BoxGeometry(
            slopeLen,
            0.14,
            depth + roofDepthOverhang * 2,
          ),
      roofSurfaceMaterial,
      tierOneThatchShape
        ? new THREE.Vector3()
        : new THREE.Vector3(
            side * roofHalfSpan * 0.5,
            wallTop + (ridgeHeight - roofEaveDrop) * 0.5,
            0,
          ),
      tierOneThatchShape
        ? new THREE.Euler()
        : new THREE.Euler(0, 0, side * -roofPitch),
    );
    roofPlane.name = tierOneThatchShape
      ? `Residence hand-laid bundled-thatch blanket ${side < 0 ? 'left' : 'right'}`
      : `Residence main roof plane ${side < 0 ? 'left' : 'right'}`;
    roofPlane.userData.residenceRoofSurface = true;
    roofPlane.userData.residenceRoofFinish = roofFinish;
    if (tierOneThatchShape) {
      roofPlane.userData.residenceThatchCourseCount = 7;
      roofPlane.userData.residenceThatchConstruction = 'continuous-hand-packed-blanket';
    }
    if (roofFinish === 'split-wood-shingle') applyWarmShingleBackFaceFinish(roofPlane);
  }
  if (tierOneThatchShape) {
    addTierOneThatchEdgeCraft(
      group,
      exposedRoofCourseMaterial,
      tierOneThatchShape,
    );
  } else {
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
      roofFinish,
    );
  }

  for (const zSign of [-1, 1] as const) {
    const beforeGable = group.children.length;
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
    if (tier === 1) {
      const gable = group.children[beforeGable] as THREE.Mesh | undefined;
      if (gable?.isMesh) {
        applyTierOneDaubTint(
          gable.geometry,
          seed + (zSign > 0 ? 1_109 : 1_103),
        );
        gable.name = `Residence earthy daub gable ${zSign > 0 ? 'front' : 'rear'}`;
        gable.userData.residenceSurfaceRole = 'clay-lime-daub';
      }
    }
  }
  if (tier > 1) {
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
      0.24,
      0.18,
      seed,
    );
  }
  if (tier === 4) {
    addTierFourCrossGable(
      group,
      halfD,
      wallTop,
      roofSurfaceMaterial,
      wallMaterial,
      windowMaterial,
      shutterMaterial,
      roofFinish,
    );
  }

  if (tier > 1 && archetype === 'stone_portal') {
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

  if (tier >= 3 && archetype !== 'working_lean_to') {
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
  const chimneyEmitter = new THREE.Object3D();
  chimneyEmitter.name = 'ChimneyEmitter';
  if (tier === 1) {
    const roofExitY = tierOneThatchShape
      ? tierOneThatchSurfaceY(chimneyX, chimneyZ, tierOneThatchShape)
      : wallTop + ridgeHeight - Math.abs(chimneyX) * Math.tan(roofPitch);
    chimneyEmitter.position.set(chimneyX, roofExitY + 0.065, chimneyZ);
    chimneyEmitter.userData.residenceSmokeExit = 'through-thatch';
    group.userData.residenceSmokeExit = 'through-thatch';
    group.userData.residenceHasChimney = false;
  } else {
    const chimneyHeight = 2.02;
    const chimneyY = wallTop + 0.62 + chimneyHeight * 0.5;
    const chimneyBody = addMesh(
      group,
      new THREE.BoxGeometry(0.72, chimneyHeight, 0.72),
      stoneMaterial('mid'),
      new THREE.Vector3(chimneyX, chimneyY, chimneyZ),
    );
    chimneyBody.name = 'Residence masonry chimney body';
    chimneyBody.userData.residenceChimney = true;
    const chimneyCap = addMesh(
      group,
      new THREE.BoxGeometry(0.82, 0.18, 0.82),
      stoneMaterial('light'),
      new THREE.Vector3(chimneyX, chimneyY + chimneyHeight * 0.5 + 0.08, chimneyZ),
    );
    chimneyCap.name = 'Residence masonry chimney cap';
    chimneyCap.userData.residenceChimney = true;
    chimneyEmitter.position.set(
      chimneyX,
      chimneyY + chimneyHeight * 0.5 + 0.22,
      chimneyZ,
    );
    chimneyEmitter.userData.residenceSmokeExit = 'chimney';
    group.userData.residenceSmokeExit = 'chimney';
    group.userData.residenceHasChimney = true;
  }
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
  private readonly staticBatches: ResidenceStaticBatches;
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
  private readonly smokeActive = new Map<string, boolean>();
  private readonly residenceOccupied = new Map<string, boolean>();
  private readonly residencePopulation = new Map<string, number>();
  private readonly residenceWindowActivities = new Map<string, number>();
  private readonly appliedWindowGlow = new Map<string, number>();
  private readonly appliedWindowOccupied = new Map<string, boolean>();
  private fireDisabledResidenceIds = new Set<string>();
  private destroyedResidenceIds = new Set<string>();
  private chimneySmokeAllowed = true;
  private eveningWindowGlow = 0;
  private householdClock: GameClock | null = null;
  private householdActivityInputsInitialized = false;
  private householdActivityHour = -1;
  private householdActivityMinute = -1;

  constructor(
    parent: THREE.Group,
    onShadowCastersChanged?: () => void,
  ) {
    this.onShadowCastersChanged = onShadowCastersChanged;
    this.root = new THREE.Group();
    this.root.name = 'Residences';
    this.staticBatches = new ResidenceStaticBatches(this.root);
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
    if (this.chimneySmokeAllowed === allowed) return;
    this.chimneySmokeAllowed = allowed;
    for (const id of this.smokeEmitters.keys()) {
      this.updateSmokeActive(id);
    }
  }

  setFireDisabledResidenceIds(ids: ReadonlySet<string>): void {
    if (setsEqual(this.fireDisabledResidenceIds, ids)) return;
    const previousIds = this.fireDisabledResidenceIds;
    this.fireDisabledResidenceIds = new Set(ids);
    for (const id of previousIds) {
      if (ids.has(id)) continue;
      this.updateSmokeActive(id);
      const marker = this.meshes.get(id);
      if (marker) this.applyWindowGlowForResidence(marker, id);
    }
    for (const id of ids) {
      if (previousIds.has(id)) continue;
      this.updateSmokeActive(id);
      const marker = this.meshes.get(id);
      if (marker) this.applyWindowGlowForResidence(marker, id);
    }
  }

  setDestroyedResidenceIds(ids: ReadonlySet<string>): void {
    if (setsEqual(this.destroyedResidenceIds, ids)) return;
    this.destroyedResidenceIds = new Set(ids);
    for (const [id, marker] of this.meshes) {
      const destroyed = ids.has(id);
      marker.visible = !destroyed;
      this.staticBatches.setResidenceVisible(id, !destroyed);
      const tier = Number(marker.userData.residenceTier ?? 0);
      if (destroyed || tier <= 0) {
        this.shadowProxyBatch.remove(id);
      } else {
        this.shadowProxyBatch.upsertResidence(id, tier as ResidenceTier, marker);
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
    if (!this.updateHouseholdActivityInputs(clock)) return;
    this.recomputeHouseholdWindowActivities();
    this.applyWindowGlow();
  }

  setHouseholdLighting(
    clock: GameClock,
    glow: number,
  ): void {
    const glowChanged = this.eveningWindowGlow !== glow;
    this.householdClock = clock;
    this.eveningWindowGlow = glow;
    const activityChanged = this.updateHouseholdActivityInputs(clock);
    if (activityChanged) this.recomputeHouseholdWindowActivities();
    if (!activityChanged && !glowChanged) return;
    this.applyWindowGlow();
  }

  setEveningWindowGlow(glow: number): void {
    if (this.eveningWindowGlow === glow) return;
    this.eveningWindowGlow = glow;
    this.applyWindowGlow();
  }

  private applyWindowGlow(): void {
    for (const [id, marker] of this.meshes) {
      this.applyWindowGlowForResidence(marker, id);
    }
  }

  tick(dt: number): void {
    for (const emitter of this.smokeEmitters.values()) {
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
          || marker.userData.residenceTiledRoof !== (residence.tier >= 4)
        )
      ) {
        if (this.serviceCoverageIds.has(residence.id)) {
          this.serviceCoverageDirty = true;
        }
        this.root.remove(marker);
        this.staticBatches.removeResidence(residence.id);
        disposeGroup(marker);
        this.meshes.delete(residence.id);
        this.smokeEmitters.get(residence.id)?.dispose();
        this.smokeEmitters.delete(residence.id);
        this.smokeActive.delete(residence.id);
        this.appliedWindowGlow.delete(residence.id);
        this.appliedWindowOccupied.delete(residence.id);
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
              completedTier >= 4,
            );
        marker.userData.fpCollisionAggregate = true;
        this.root.add(marker);
        batchResidenceStaticMeshes(marker);
        this.staticBatches.registerResidence(residence.id, marker);
        this.meshes.set(residence.id, marker);

        const chimneyEmitter = marker.getObjectByName('ChimneyEmitter');
        if (chimneyEmitter) {
          this.smokeEmitters.set(
            residence.id,
            new ChimneySmokeEmitter(chimneyEmitter, appearanceSeed),
          );
          this.smokeActive.set(residence.id, false);
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
      this.staticBatches.updateResidence(residence.id, marker, !destroyed);
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
      this.updateSmokeActive(residence.id);
      this.residenceOccupied.set(
        residence.id,
        !residence.abandoned && residence.population > 0,
      );
      const previousPopulation = this.residencePopulation.get(residence.id);
      this.residencePopulation.set(residence.id, residence.population);
      if (
        this.householdClock
        && (
          previousPopulation === undefined
          || householdMemberCount(previousPopulation)
            !== householdMemberCount(residence.population)
          || !this.residenceWindowActivities.has(residence.id)
        )
      ) {
        this.recomputeHouseholdWindowActivity(residence.id, residence.population);
      }
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
      this.staticBatches.removeResidence(id);
      this.shadowProxyBatch.remove(id);
      disposeGroup(marker);
      this.meshes.delete(id);
      this.smokeEmitters.get(id)?.dispose();
      this.smokeEmitters.delete(id);
      this.smokeEligible.delete(id);
      this.smokeActive.delete(id);
      this.residenceOccupied.delete(id);
      this.residencePopulation.delete(id);
      this.residenceWindowActivities.delete(id);
      this.appliedWindowGlow.delete(id);
      this.appliedWindowOccupied.delete(id);
    }
    if (this.shadowProxyBatch.flush()) {
      this.onShadowCastersChanged?.();
    }
    this.staticBatches.finalizeGeometryBuffers();
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
    const glow = this.windowGlowForResidence(residenceId);
    const occupied = this.residenceOccupied.get(residenceId) ?? false;
    if (
      this.appliedWindowGlow.get(residenceId) === glow
      && this.appliedWindowOccupied.get(residenceId) === occupied
    ) {
      return;
    }
    applyResidenceWindowGlow(
      material,
      glow,
      occupied,
    );
    this.appliedWindowGlow.set(residenceId, glow);
    this.appliedWindowOccupied.set(residenceId, occupied);
  }

  private windowGlowForResidence(residenceId: string): number {
    if (this.fireDisabledResidenceIds.has(residenceId)) return 0;
    if (!this.householdClock) return this.eveningWindowGlow;
    let householdActivity = this.residenceWindowActivities.get(residenceId);
    if (householdActivity === undefined) {
      householdActivity = this.recomputeHouseholdWindowActivity(
        residenceId,
        this.residencePopulation.get(residenceId) ?? 0,
      );
    }
    return this.eveningWindowGlow * householdActivity;
  }

  private updateSmokeActive(residenceId: string): void {
    const emitter = this.smokeEmitters.get(residenceId);
    if (!emitter) return;
    const active = this.chimneySmokeAllowed
      && !this.fireDisabledResidenceIds.has(residenceId)
      && (this.smokeEligible.get(residenceId) ?? false);
    if (this.smokeActive.get(residenceId) === active) return;
    this.smokeActive.set(residenceId, active);
    emitter.setActive(active);
  }

  private updateHouseholdActivityInputs(
    clock: Pick<GameClock, 'hour' | 'minute'>,
  ): boolean {
    if (
      this.householdActivityInputsInitialized
      && this.householdActivityHour === clock.hour
      && this.householdActivityMinute === clock.minute
    ) {
      return false;
    }
    this.householdActivityInputsInitialized = true;
    this.householdActivityHour = clock.hour;
    this.householdActivityMinute = clock.minute;
    return true;
  }

  private recomputeHouseholdWindowActivities(): void {
    for (const [residenceId, population] of this.residencePopulation) {
      this.recomputeHouseholdWindowActivity(residenceId, population);
    }
  }

  private recomputeHouseholdWindowActivity(
    residenceId: string,
    population: number,
  ): number {
    if (!this.householdClock) return 1;
    const activity = residenceWindowActivity(
      residenceId,
      population,
      this.householdClock,
    );
    this.residenceWindowActivities.set(residenceId, activity);
    return activity;
  }

  dispose(): void {
    for (const emitter of this.smokeEmitters.values()) {
      emitter.dispose();
    }
    this.smokeEmitters.clear();
    this.smokeEligible.clear();
    this.smokeActive.clear();
    this.residenceOccupied.clear();
    this.residencePopulation.clear();
    this.residenceWindowActivities.clear();
    this.appliedWindowGlow.clear();
    this.appliedWindowOccupied.clear();
    this.fireDisabledResidenceIds.clear();
    this.serviceCoverageIds.clear();
    this.serviceCoverageKind = null;
    for (const marker of this.meshes.values()) {
      disposeGroup(marker);
    }
    this.meshes.clear();
    this.staticBatches.dispose();
    this.shadowProxyBatch.dispose();
    this.serviceCoverageGeometry.dispose();
    this.serviceCoverageMaterial.dispose();
    this.serviceCoverageRoot.removeFromParent();
    this.root.removeFromParent();
  }
}

function serviceCoverageRadius(tier: number): number {
  if (tier >= 4) return 5.9;
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

function householdMemberCount(population: number): number {
  return Math.max(0, Math.min(32, Math.floor(population)));
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
  const geometries = new Set<THREE.BufferGeometry>();
  group.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      if (child.userData.residenceStaticCollisionProxy === true) return;
      geometries.add(child.geometry);
    }
  });
  for (const geometry of geometries) geometry.dispose();
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
  const active = (residence.upgradeTargetTier ?? 0) > residence.tier
    || residence.fireRepairActive === true
    || residence.decayRepairActive === true
    || residence.roofTileRetrofitActive === true;
  works.visible = active;
  if (!active) return;
  const initialConstruction = residence.tier === 0
    && (residence.upgradeTargetTier ?? 0) === 1;
  for (const child of works.children) {
    if (child.name.startsWith('UpgradeScaffold')) {
      child.visible = !initialConstruction;
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
