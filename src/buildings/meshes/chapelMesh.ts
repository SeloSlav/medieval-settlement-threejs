import * as THREE from 'three';
import { createCathedralMesh } from './cathedralMesh.ts';
import {
  addMesh,
  metalMaterial,
  residenceFacadeMaterial,
  sharedBuildingDetailMaterial,
  sharedBuildingMaterial,
  stoneMaterial,
  timberMaterial,
} from '../buildingMaterials.ts';
import { addTriangularGableWall } from '../meshPrimitives.ts';
import { createProceduralRoofPanelGeometry } from '../proceduralArchitecture/geometryWriter.ts';
import {
  addProceduralDoor,
  addProceduralWindow,
  addStoneEntranceSteps,
} from './facadeOpeningKit.ts';
import { addHippedRoof } from './buildingMeshKit.ts';
import { getBuildingFootprintHalfExtents } from '../BuildingFootprint.ts';

type ChapelMaterials = {
  limewash: THREE.MeshStandardMaterial;
  limewashShade: THREE.MeshStandardMaterial;
  glass: THREE.MeshStandardMaterial;
  brass: THREE.MeshStandardMaterial;
  redPaint: THREE.MeshStandardMaterial;
  bluePaint: THREE.MeshStandardMaterial;
  ochrePaint: THREE.MeshStandardMaterial;
};

/**
 * The saved/server kind remains `chapel`, but the player-facing building is a
 * parish church. Keep the scale on a nested procedural-model group so runtime
 * helpers (notably the shadow proxy) can still attach to an unscaled root.
 */
export const PARISH_CHURCH_MODEL_SCALE = 1.5;

// The current tier-one residence is 5.2885 m from footing to roof crown.
// Measure the church through its cross, preserving uniform proportions.
const TIER_ONE_CHURCH_HEIGHT = 2 * 5.2885;

type ChurchRoofProfile = {
  width: number;
  wallTop: number;
  ridgeHeight: number;
};

/** A closed tower plinth whose inverted-V underside seats into both slopes. */
function addBelfryRoofBase(
  group: THREE.Group,
  roof: ChurchRoofProfile,
  width: number,
  depth: number,
  towerZ: number,
  topY: number,
  material: THREE.Material,
): void {
  const halfWidth = width * 0.5;
  const ridgeY = roof.wallTop + roof.ridgeHeight + 0.02;
  const pitch = (roof.ridgeHeight + 0.06) / (roof.width * 0.5 + 0.25);
  // Embed the bottom by 6 cm; touching only the ridge leaves the corners
  // floating. The exposed walls follow the roof down to all four corners.
  const bottomAtRidge = ridgeY - 0.06;
  const bottomAtEdge = bottomAtRidge - halfWidth * pitch;
  const outline = new THREE.Shape();
  outline.moveTo(-halfWidth, bottomAtEdge);
  outline.lineTo(0, bottomAtRidge);
  outline.lineTo(halfWidth, bottomAtEdge);
  outline.lineTo(halfWidth, topY);
  outline.lineTo(-halfWidth, topY);
  outline.closePath();
  const geometry = new THREE.ExtrudeGeometry(outline, { depth, bevelEnabled: false, steps: 1 });
  geometry.translate(0, 0, -depth * 0.5);
  const base = addMesh(group, geometry, material, new THREE.Vector3(0, 0, towerZ));
  base.name = 'Church roof-fitted belfry base';
  base.userData.architectureRole = 'roof-fitted-tower-base';
  base.userData.roofSeat = { ridgeY, pitch, halfWidth, depth, towerZ };
}

/** The fence belongs to the permanent plot, outside the scaled tier model. */
function addChurchyardFence(root: THREE.Group, tier: number): void {
  const { halfWidth, halfDepth } = getBuildingFootprintHalfExtents('chapel');
  const fence = new THREE.Group();
  fence.name = 'Churchyard permanent footprint fence';
  fence.userData.architectureRole = 'permanent-footprint-fence';
  fence.userData.footprint = { halfWidth, halfDepth };
  root.add(fence);
  const postWidth = 0.2;
  const x = halfWidth - postWidth * 0.5;
  const z = halfDepth - postWidth * 0.5;
  const gateHalfWidth = 2.4;
  const runs = [
    [-x, -z, x, -z],
    [-x, -z, -x, z],
    [x, -z, x, z],
    [-x, z, -gateHalfWidth - postWidth * 0.5, z],
    [gateHalfWidth + postWidth * 0.5, z, x, z],
  ] as const;
  const placedPosts = new Set<string>();
  for (const [x1, z1, x2, z2] of runs) {
    const length = Math.hypot(x2 - x1, z2 - z1);
    const bays = Math.ceil(length / 1.8);
    for (let i = 0; i <= bays; i++) {
      const px = THREE.MathUtils.lerp(x1, x2, i / bays);
      const pz = THREE.MathUtils.lerp(z1, z2, i / bays);
      const key = `${px.toFixed(4)}:${pz.toFixed(4)}`;
      if (placedPosts.has(key)) continue;
      placedPosts.add(key);
      addMesh(fence, new THREE.BoxGeometry(postWidth, 1.25, postWidth), tier >= 3 ? stoneMaterial('mid') : timberMaterial('dark'),
        new THREE.Vector3(px, 0.625, pz)).name = 'Churchyard fence post';
    }
    if (tier === 4) {
      addMesh(fence, new THREE.BoxGeometry(length, .7, .18), stoneMaterial('mid'),
        new THREE.Vector3((x1+x2)/2,.35,(z1+z2)/2),
        new THREE.Euler(0,-Math.atan2(z2-z1,x2-x1),0)).name='Cathedral consecrated precinct wall';
    }
    for (const y of (tier === 4 ? [.77] : [0.4, 0.92])) {
      addMesh(fence, new THREE.BoxGeometry(length, 0.12, 0.1), tier === 4 ? stoneMaterial('mortar') : timberMaterial('weathered'),
        new THREE.Vector3((x1 + x2) * 0.5, y, (z1 + z2) * 0.5),
        new THREE.Euler(0, -Math.atan2(z2 - z1, x2 - x1), 0)).name = 'Churchyard fence rail';
    }
  }
  fence.userData.entranceWidth = gateHalfWidth * 2;
}

function createChapelMaterials(): ChapelMaterials {
  return {
    limewash: residenceFacadeMaterial('white'),
    limewashShade: sharedBuildingMaterial('masonryLight'),
    glass: sharedBuildingMaterial('glass'),
    brass: sharedBuildingDetailMaterial('brass'),
    redPaint: sharedBuildingDetailMaterial('paintRed'),
    bluePaint: sharedBuildingDetailMaterial('paintBlue'),
    ochrePaint: sharedBuildingDetailMaterial('paintOchre'),
  };
}

function addParishCoffer(group: THREE.Group, frontZ: number, chestX = -1.58): void {
  const chest = new THREE.Group();
  chest.name = 'ChapelCofferChest';
  chest.visible = false;
  addMesh(
    chest,
    new THREE.BoxGeometry(0.88, 0.48, 0.58),
    timberMaterial('dark'),
    new THREE.Vector3(chestX, 0.58, frontZ + 0.38),
  );
  addMesh(
    chest,
    new THREE.BoxGeometry(0.94, 0.18, 0.64),
    timberMaterial('weathered'),
    new THREE.Vector3(chestX, 0.91, frontZ + 0.38),
  );
  for (const x of [chestX - 0.3, chestX + 0.3]) {
    addMesh(
      chest,
      new THREE.BoxGeometry(0.09, 0.72, 0.66),
      metalMaterial('iron'),
      new THREE.Vector3(x, 0.7, frontZ + 0.38),
    );
  }
  addMesh(
    chest,
    new THREE.BoxGeometry(0.18, 0.22, 0.1),
    sharedBuildingDetailMaterial('brass'),
    new THREE.Vector3(chestX, 0.67, frontZ + 0.7),
  );
  group.add(chest);
}

function createLancetGeometry(width: number, height: number, depth: number): THREE.ExtrudeGeometry {
  const springY = height * 0.58;
  const shape = new THREE.Shape();
  shape.moveTo(-width * 0.5, 0);
  shape.lineTo(width * 0.5, 0);
  shape.lineTo(width * 0.5, springY);
  shape.quadraticCurveTo(width * 0.45, height * 0.82, 0, height);
  shape.quadraticCurveTo(-width * 0.45, height * 0.82, -width * 0.5, springY);
  shape.closePath();
  return new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 4 });
}

function createLancetSurroundGeometry(
  outerWidth: number,
  outerHeight: number,
  innerWidth: number,
  innerHeight: number,
  depth: number,
): THREE.ExtrudeGeometry {
  const shape = createLancetShape(outerWidth, outerHeight, THREE.Shape);
  shape.holes.push(createLancetShape(innerWidth, innerHeight, THREE.Path));
  return new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: false,
    curveSegments: 5,
  });
}

function createLancetShape<T extends THREE.Shape | THREE.Path>(
  width: number,
  height: number,
  Constructor: new () => T,
  offsetX = 0,
  offsetY = 0,
): T {
  const springY = height * 0.58;
  const path = new Constructor();
  path.moveTo(offsetX - width * 0.5, offsetY);
  path.lineTo(offsetX + width * 0.5, offsetY);
  path.lineTo(offsetX + width * 0.5, offsetY + springY);
  path.quadraticCurveTo(
    offsetX + width * 0.45,
    offsetY + height * 0.82,
    offsetX,
    offsetY + height,
  );
  path.quadraticCurveTo(
    offsetX - width * 0.45,
    offsetY + height * 0.82,
    offsetX - width * 0.5,
    offsetY + springY,
  );
  path.closePath();
  return path;
}

type ChurchWallAperture = {
  readonly center: number;
  readonly bottom: number;
  readonly width: number;
  readonly height: number;
  readonly shape: 'rectangle' | 'lancet';
};

function createPerforatedChurchWallGeometry(
  span: number,
  height: number,
  thickness: number,
  apertures: readonly ChurchWallAperture[],
): THREE.ExtrudeGeometry {
  const halfSpan = span * 0.5;
  const shape = new THREE.Shape();
  shape.moveTo(-halfSpan, 0);
  shape.lineTo(halfSpan, 0);
  shape.lineTo(halfSpan, height);
  shape.lineTo(-halfSpan, height);
  shape.closePath();
  for (const aperture of apertures) {
    if (aperture.shape === 'lancet') {
      shape.holes.push(createLancetShape(
        aperture.width,
        aperture.height,
        THREE.Path,
        aperture.center,
        aperture.bottom,
      ));
      continue;
    }
    const hole = new THREE.Path();
    const halfWidth = aperture.width * 0.5;
    // Clockwise winding identifies the aperture as a hole.
    hole.moveTo(aperture.center - halfWidth, aperture.bottom);
    hole.lineTo(aperture.center - halfWidth, aperture.bottom + aperture.height);
    hole.lineTo(aperture.center + halfWidth, aperture.bottom + aperture.height);
    hole.lineTo(aperture.center + halfWidth, aperture.bottom);
    hole.closePath();
    shape.holes.push(hole);
  }
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: false,
    curveSegments: 5,
  });
  geometry.translate(0, 0, -thickness * 0.5);
  return geometry;
}

function addChurchWallShell(
  group: THREE.Group,
  options: {
    readonly width: number;
    readonly depth: number;
    readonly foundationHeight: number;
    readonly wallHeight: number;
    readonly frontZ: number;
    readonly material: THREE.Material;
    readonly frontDoor: ChurchWallAperture;
    readonly sideWindows: readonly ChurchWallAperture[];
    readonly namePrefix: string;
  },
): void {
  const thickness = 0.18;
  const bodyWidth = options.width - 0.14;
  const bodyDepth = options.depth - 0.14;
  const front = addMesh(
    group,
    createPerforatedChurchWallGeometry(
      bodyWidth,
      options.wallHeight,
      thickness,
      [options.frontDoor],
    ),
    options.material,
    new THREE.Vector3(0, options.foundationHeight, options.frontZ),
  );
  front.name = `${options.namePrefix} physical front wall apertures`;
  front.userData.churchPhysicalApertureCount = 1;

  const rear = addMesh(
    group,
    createPerforatedChurchWallGeometry(bodyWidth, options.wallHeight, thickness, []),
    options.material,
    new THREE.Vector3(0, options.foundationHeight, -options.frontZ),
  );
  rear.name = `${options.namePrefix} closed rear wall shell`;
  rear.userData.churchPhysicalApertureCount = 0;

  for (const side of [-1, 1] as const) {
    const geometry = createPerforatedChurchWallGeometry(
      bodyDepth,
      options.wallHeight,
      thickness,
      options.sideWindows,
    );
    geometry.rotateY(-Math.PI * 0.5);
    const wall = addMesh(
      group,
      geometry,
      options.material,
      new THREE.Vector3(side * (options.width * 0.5 - 0.07), options.foundationHeight, 0),
    );
    wall.name = `${options.namePrefix} ${side < 0 ? 'left' : 'right'} physical window wall`;
    wall.userData.churchPhysicalApertureCount = options.sideWindows.length;
  }
}

function addLancetWindow(
  group: THREE.Group,
  materials: ChapelMaterials,
  face: 'left' | 'right',
  z: number,
  sillY: number,
  halfWidth: number,
): void {
  const outward = face === 'left' ? -1 : 1;
  const window = new THREE.Group();
  window.name = 'Chapel procedural lancet window opening';
  window.position.set(outward * (halfWidth - 0.035), sillY, z);
  window.rotation.y = outward > 0 ? Math.PI * 0.5 : -Math.PI * 0.5;
  window.userData.facadeOpeningKind = 'window';
  window.userData.facadeOpeningFace = outward > 0 ? 'positive-x' : 'negative-x';
  window.userData.facadeOpeningWidth = 0.66;
  window.userData.facadeOpeningHeight = 1.55;
  window.userData.hasCrossBars = false;
  group.add(window);

  const surround = addMesh(
    window,
    createLancetSurroundGeometry(0.96, 1.9, 0.66, 1.55, 0.11),
    stoneMaterial('light'),
    new THREE.Vector3(0, 0, 0),
  );
  surround.name = 'Chapel open lancet window stone surround';
  surround.userData.facadeOpeningRole = 'window-frame';
  const pane = addMesh(
    window,
    createLancetGeometry(0.66, 1.55, 0.12),
    materials.glass,
    new THREE.Vector3(0, 0.12, 0.075),
  );
  pane.name = 'Chapel clear lancet window pane';
  pane.userData.facadeOpeningRole = 'window-pane';
}

function addSideButtress(
  group: THREE.Group,
  side: -1 | 1,
  z: number,
  wallTop: number,
  halfWidth: number,
): void {
  const x = side * (halfWidth + 0.16);
  addMesh(
    group,
    new THREE.BoxGeometry(0.72, 0.46, 0.92),
    stoneMaterial('mid'),
    new THREE.Vector3(x, 0.23, z),
  );
  addMesh(
    group,
    new THREE.BoxGeometry(0.56, wallTop * 0.68, 0.68),
    stoneMaterial('light'),
    new THREE.Vector3(x - side * 0.05, 0.46 + wallTop * 0.34, z),
  );
  addMesh(
    group,
    new THREE.BoxGeometry(0.63, 0.15, 0.75),
    stoneMaterial('mortar'),
    new THREE.Vector3(x - side * 0.05, 0.46 + wallTop * 0.68, z),
  );
}

function addFoundationStones(group: THREE.Group, width: number, depth: number): void {
  const halfW = width * 0.5;
  const halfD = depth * 0.5;
  const blockHeight = 0.38;

  for (let i = 0; i < 8; i++) {
    const x = -halfW + 0.42 + i * ((width - 0.84) / 7);
    const blockWidth = i % 3 === 0 ? 0.78 : 0.68;
    for (const z of [-halfD - 0.09, halfD + 0.09]) {
      addMesh(
        group,
        new THREE.BoxGeometry(blockWidth, blockHeight + (i % 2) * 0.05, 0.38),
        stoneMaterial(i % 2 === 0 ? 'light' : 'mid'),
        new THREE.Vector3(x, blockHeight * 0.5, z),
        new THREE.Euler(0, (i % 2 === 0 ? 1 : -1) * 0.025, 0),
      );
    }
  }

  for (let i = 0; i < 9; i++) {
    const z = -halfD + 0.4 + i * ((depth - 0.8) / 8);
    for (const x of [-halfW - 0.09, halfW + 0.09]) {
      addMesh(
        group,
        new THREE.BoxGeometry(0.38, blockHeight + ((i + 1) % 2) * 0.05, 0.65),
        stoneMaterial(i % 2 === 0 ? 'mid' : 'light'),
        new THREE.Vector3(x, blockHeight * 0.5, z),
        new THREE.Euler(0, (i % 2 === 0 ? 1 : -1) * 0.035, 0),
      );
    }
  }
}

function addPlankDoor(
  group: THREE.Group,
  materials: ChapelMaterials,
  frontZ: number,
  floorY: number,
): void {
  const doorWidth = 1.38;
  const doorHeight = 2.22;
  const opening = new THREE.Group();
  opening.name = 'Chapel procedural arched door opening';
  opening.position.set(0, floorY, frontZ);
  opening.userData.facadeOpeningKind = 'door';
  opening.userData.facadeOpeningFace = 'positive-z';
  opening.userData.facadeOpeningWidth = doorWidth;
  opening.userData.facadeOpeningHeight = doorHeight;
  opening.userData.hasCrossBars = false;
  group.add(opening);
  addStoneEntranceSteps(opening, {
    thresholdHeight: floorY,
    width: doorWidth,
    namePrefix: 'Chapel',
  });

  const surround = addMesh(
    opening,
    createLancetSurroundGeometry(
      doorWidth + 0.48,
      doorHeight + 0.56,
      doorWidth,
      doorHeight,
      0.16,
    ),
    stoneMaterial('light'),
    new THREE.Vector3(0, -0.02, -0.08),
  );
  surround.name = 'Chapel open arched door stone surround';
  surround.userData.facadeOpeningRole = 'door-frame';
  const reveal = addMesh(
    opening,
    createLancetGeometry(doorWidth, doorHeight, 0.18),
    timberMaterial('dark'),
    new THREE.Vector3(0, 0, 0.025),
  );
  reveal.name = 'Chapel shadowed arched door reveal';
  reveal.userData.facadeOpeningRole = 'door-reveal';
  const leaf = addMesh(
    opening,
    createLancetGeometry(doorWidth - 0.08, doorHeight - 0.06, 0.06),
    timberMaterial('mid'),
    new THREE.Vector3(0, 0.03, 0.175),
  );
  leaf.name = 'Chapel visible arched timber door leaf';
  leaf.userData.facadeOpeningRole = 'door-leaf';

  for (const x of [-0.42, -0.14, 0.14, 0.42]) {
    const seam = addMesh(
      opening,
      new THREE.BoxGeometry(0.014, doorHeight * 0.58, 0.012),
      timberMaterial('dark'),
      new THREE.Vector3(x, doorHeight * 0.31, 0.242),
    );
    seam.name = 'Chapel door vertical plank seam';
    seam.userData.facadeOpeningRole = 'door-plank-seam';
  }

  for (const y of [floorY + 0.48, floorY + 1.42]) {
    const hinge = addMesh(
      opening,
      new THREE.BoxGeometry(0.24, 0.075, 0.045),
      metalMaterial('iron'),
      new THREE.Vector3(-doorWidth * 0.37, y - floorY, 0.255),
    );
    hinge.name = 'Chapel localized door hinge plate';
    hinge.userData.facadeOpeningRole = 'door-hinge';
  }
  const handle = addMesh(
    opening,
    new THREE.TorusGeometry(0.1, 0.025, 6, 12),
    materials.brass,
    new THREE.Vector3(0.38, 1.02, 0.29),
  );
  handle.name = 'Chapel brass ring door handle';
  handle.userData.facadeOpeningRole = 'door-latch';
}

function addFolkFrieze(
  group: THREE.Group,
  materials: ChapelMaterials,
  frontZ: number,
  y: number,
): void {
  const colors = [materials.redPaint, materials.bluePaint, materials.ochrePaint] as const;
  for (let i = 0; i < 9; i++) {
    const x = -1.84 + i * 0.46;
    const diamond = addMesh(
      group,
      new THREE.BoxGeometry(0.25, 0.25, 0.055),
      colors[i % colors.length],
      new THREE.Vector3(x, y, frontZ + 0.075),
      new THREE.Euler(0, 0, Math.PI * 0.25),
    );
    diamond.scale.set(1, 1, 1);
  }
}

function addBellTower(
  group: THREE.Group,
  materials: ChapelMaterials,
  towerZ: number,
  roof: ChurchRoofProfile,
  roofMaterial: THREE.Material,
): void {
  const baseSize = 1.62;
  const belfryFloorY = roof.wallTop + roof.ridgeHeight + 0.28;
  const belfryHeight = 2.08;
  // Keep the yoke tucked beneath the belfry's upper beams so the bell reads as
  // suspended from the steeple ceiling instead of floating near the floor.
  const bellLift = 0.63;

  addBelfryRoofBase(group, roof, baseSize, baseSize, towerZ, belfryFloorY,
    stoneMaterial('light'));

  const footing = addMesh(
    group,
    new THREE.BoxGeometry(baseSize + 0.16, 0.2, baseSize + 0.16),
    stoneMaterial('light'),
    new THREE.Vector3(0, belfryFloorY, towerZ),
  );
  footing.name = 'Parish church belfry ridge footing';
  for (const [sx, sz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]] as const) {
    const post = addMesh(
      group,
      new THREE.BoxGeometry(0.2, belfryHeight, 0.2),
      timberMaterial('dark'),
      new THREE.Vector3(sx * 0.62, belfryFloorY + belfryHeight * 0.5, towerZ + sz * 0.62),
    );
    post.name = 'Parish church belfry timber support post';
  }
  for (const zSign of [-1, 1] as const) {
    const beam = addMesh(
      group,
      new THREE.BoxGeometry(baseSize, 0.18, 0.18),
      timberMaterial('weathered'),
      new THREE.Vector3(0, belfryFloorY + belfryHeight, towerZ + zSign * 0.62),
    );
    beam.name = 'Parish church belfry transverse upper beam';
  }
  for (const xSign of [-1, 1] as const) {
    const beam = addMesh(
      group,
      new THREE.BoxGeometry(0.18, 0.18, baseSize),
      timberMaterial('weathered'),
      new THREE.Vector3(xSign * 0.62, belfryFloorY + belfryHeight, towerZ),
    );
    beam.name = 'Parish church belfry longitudinal upper beam';
  }

  addMesh(
    group,
    new THREE.CylinderGeometry(0.24, 0.43, 0.72, 12),
    materials.brass,
    new THREE.Vector3(0, belfryFloorY + 0.84 + bellLift, towerZ),
  );
  addMesh(
    group,
    new THREE.TorusGeometry(0.4, 0.055, 7, 16),
    materials.brass,
    new THREE.Vector3(0, belfryFloorY + 0.48 + bellLift, towerZ),
    new THREE.Euler(Math.PI * 0.5, 0, 0),
  );
  addMesh(
    group,
    new THREE.CylinderGeometry(0.055, 0.055, 1.34, 8),
    timberMaterial('dark'),
    new THREE.Vector3(0, belfryFloorY + 1.28 + bellLift, towerZ),
    new THREE.Euler(0, 0, Math.PI * 0.5),
  );
  addMesh(
    group,
    new THREE.SphereGeometry(0.09, 8, 6),
    materials.brass,
    new THREE.Vector3(0, belfryFloorY + 0.38 + bellLift, towerZ),
  );

  // The roof skin starts on the upper-beam centerline. Its thickness then
  // overlaps the beam without descending into the open bell apertures.
  const towerRoofY = belfryFloorY + belfryHeight + 0.74;
  addHippedRoof(group, {
    width: 1.32 * Math.SQRT2,
    depth: 1.32 * Math.SQRT2,
    eaveY: towerRoofY - 0.74,
    peakY: towerRoofY + 0.74,
    thickness: 0.1,
    material: roofMaterial,
    centerZ: towerZ,
    name: 'Parish church joined belfry roof cap',
  });
  addMesh(
    group,
    new THREE.CylinderGeometry(0.055, 0.055, 0.78, 8),
    metalMaterial('iron'),
    new THREE.Vector3(0, towerRoofY + 0.98, towerZ),
  );
  addMesh(
    group,
    new THREE.BoxGeometry(0.48, 0.065, 0.065),
    metalMaterial('iron'),
    new THREE.Vector3(0, towerRoofY + 1.12, towerZ),
  );
}

function addPerforatedChurchGable(
  group: THREE.Group,
  halfWidth: number,
  wallTop: number,
  ridgeHeight: number,
  planeZ: number,
  material: THREE.Material,
  oculus: { readonly centerY: number; readonly radius: number },
): THREE.Mesh {
  const shape = new THREE.Shape();
  shape.moveTo(-halfWidth + 0.06, 0);
  shape.lineTo(halfWidth - 0.06, 0);
  shape.lineTo(0, ridgeHeight);
  shape.closePath();
  const opening = new THREE.Path();
  opening.absarc(0, oculus.centerY, oculus.radius, 0, Math.PI * 2, true);
  opening.closePath();
  shape.holes.push(opening);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 0.16,
    bevelEnabled: false,
    curveSegments: 18,
  });
  geometry.translate(0, wallTop, -0.08);
  const gable = addMesh(
    group,
    geometry,
    material,
    new THREE.Vector3(0, 0, planeZ),
  );
  gable.name = 'Large Stone Church physical oculus gable wall';
  gable.userData.churchPhysicalApertureCount = 1;
  gable.userData.churchPhysicalOculus = true;
  return gable;
}

function addCompactChurchRoof(
  group: THREE.Group,
  width: number,
  depth: number,
  wallTop: number,
  ridgeHeight: number,
  material: THREE.Material,
): void {
  const halfW = width * 0.5;
  const run = halfW + 0.25;
  const roofDepth = depth + 0.42;
  const eaveY = wallTop - 0.04;
  const rise = ridgeHeight + 0.06;
  const role = material.name.toLowerCase().includes('clay')
    ? 'clay-tiles'
    : 'split-shingles';
  const left = addMesh(
    group,
    createProceduralRoofPanelGeometry({
      semanticId: 'church-left-joined-roof-plane',
      moduleId: 'church-nave-roof',
      materialRole: role,
      structuralUse: 'roof-covering',
      eaveOrigin: [-run, eaveY, -roofDepth * 0.5],
      eaveVector: [0, 0, roofDepth],
      slopeVector: [run, rise, 0],
      thickness: 0.14,
    }),
    material,
    new THREE.Vector3(),
  );
  left.name = 'Church joined left roof plane';
  left.userData.proceduralRoofShell = true;
  const right = addMesh(
    group,
    createProceduralRoofPanelGeometry({
      semanticId: 'church-right-joined-roof-plane',
      moduleId: 'church-nave-roof',
      materialRole: role,
      structuralUse: 'roof-covering',
      eaveOrigin: [run, eaveY, roofDepth * 0.5],
      eaveVector: [0, 0, -roofDepth],
      slopeVector: [-run, rise, 0],
      thickness: 0.14,
      uvOffsetMeters: [0.13, 0.07],
    }),
    material,
    new THREE.Vector3(),
  );
  right.name = 'Church joined right roof plane';
  right.userData.proceduralRoofShell = true;
  const ridge = addMesh(
    group,
    new THREE.BoxGeometry(0.2, 0.1, roofDepth + 0.1),
    material,
    new THREE.Vector3(0, eaveY + rise + 0.015, 0),
  );
  ridge.name = 'Church low-profile roof-covering ridge cap';
  ridge.userData.proceduralRoofShell = true;
}

function addCompactBellCote(
  group: THREE.Group,
  materials: ChapelMaterials,
  z: number,
  roof: ChurchRoofProfile,
  roofMaterial: THREE.Material,
  stoneTier: boolean,
): void {
  const span = stoneTier ? 1.42 : 1.18;
  const baseY = roof.wallTop + roof.ridgeHeight + 0.25;
  const height = stoneTier ? 1.72 : 1.45;
  const upperBeamHeight = 0.2;
  const bellHeight = 0.58;
  const bellClearance = 0.025;
  const bellY = baseY + height - upperBeamHeight * 0.5 - bellClearance - bellHeight * 0.5;
  const postMaterial = stoneTier ? stoneMaterial('light') : timberMaterial('dark');
  addBelfryRoofBase(group, roof, span + 0.2, span + 0.2, z, baseY + 0.04, postMaterial);
  for (const x of [-span * 0.5, span * 0.5]) {
    for (const zSign of [-1, 1]) {
      const post = addMesh(
        group,
        new THREE.BoxGeometry(stoneTier ? 0.24 : 0.18, height, 0.22),
        postMaterial,
        new THREE.Vector3(x, baseY + height * 0.5, z + zSign * span * 0.5),
      );
      post.name = `Compact church belfry ${stoneTier ? 'stone' : 'timber'} support post`;
    }
  }
  const lowerBeam = addMesh(
    group,
    new THREE.BoxGeometry(span + 0.28, stoneTier ? 0.2 : 0.18, span + 0.28),
    postMaterial,
    new THREE.Vector3(0, baseY + (stoneTier ? 0.1 : 0.09), z),
  );
  lowerBeam.name = 'Compact church belfry lower sill beam';
  for (const side of [-1, 1]) {
    for (const alongX of [true, false]) {
      const upperBeam = addMesh(
        group,
        new THREE.BoxGeometry(alongX ? span + 0.28 : 0.22, upperBeamHeight, alongX ? 0.22 : span + 0.28),
        postMaterial,
        new THREE.Vector3(alongX ? 0 : side * span * 0.5, baseY + height, z + (alongX ? side * span * 0.5 : 0)),
      );
      upperBeam.name = 'Compact church belfry upper beam';
    }
  }
  addMesh(group, new THREE.BoxGeometry(span, 0.16, 0.16), timberMaterial('dark'),
    new THREE.Vector3(0, baseY + height - 0.12, z)).name = 'Compact church bell suspension yoke';
  const bell = addMesh(
    group,
    new THREE.CylinderGeometry(0.18, 0.34, bellHeight, 10),
    materials.brass,
    new THREE.Vector3(0, bellY, z),
  );
  bell.name = 'Compact church bell';
  const capHeight = stoneTier ? 1.08 : 0.9;
  const capEaveY = baseY + height;
  addHippedRoof(group, {
    width: span + 0.46,
    depth: span + 0.46,
    eaveY: capEaveY,
    peakY: capEaveY + capHeight,
    thickness: 0.085,
    material: roofMaterial,
    centerZ: z,
    name: `Compact church ${stoneTier ? 'stone' : 'timber'} belfry joined roof cap`,
  });
  const crossY = baseY + height + (stoneTier ? 1.22 : 1.02);
  addMesh(
    group,
    new THREE.BoxGeometry(0.05, 0.62, 0.05),
    metalMaterial('iron'),
    new THREE.Vector3(0, crossY, z),
  );
  addMesh(
    group,
    new THREE.BoxGeometry(0.38, 0.05, 0.05),
    metalMaterial('iron'),
    new THREE.Vector3(0, crossY + 0.08, z),
  );
}

function createCompactChurchMesh(tier: 1 | 2): THREE.Group {
  const stoneTier = tier === 2;
  const root = new THREE.Group();
  root.name = stoneTier ? 'Small Stone Church' : 'Small Wooden Church';
  const group = new THREE.Group();
  group.name = `${root.name} procedural model`;
  root.add(group);

  const materials = createChapelMaterials();
  const width = stoneTier ? 4.5 : 3.55;
  const depth = stoneTier ? 5.65 : 4.5;
  const foundationHeight = stoneTier ? 0.46 : 0.3;
  const wallHeight = stoneTier ? 2.85 : 2.28;
  const ridgeHeight = stoneTier ? 1.95 : 1.55;
  const halfW = width * 0.5;
  const halfD = depth * 0.5;
  const wallTop = foundationHeight + wallHeight;
  const unscaledHeight = wallTop + ridgeHeight + 0.25 + 1.45 + 1.02 + 0.31;
  group.scale.setScalar(stoneTier ? 1.5 : TIER_ONE_CHURCH_HEIGHT / unscaledHeight);
  const frontZ = halfD - 0.04;
  const wallMaterial = stoneTier
    ? stoneMaterial('light')
    : timberMaterial('weathered');
  const roofMaterial = stoneTier
    ? sharedBuildingMaterial('clayDark')
    : sharedBuildingMaterial('shingle');

  addMesh(
    group,
    new THREE.BoxGeometry(width + 0.34, foundationHeight, depth + 0.34),
    stoneMaterial(stoneTier ? 'mid' : 'mortar'),
    new THREE.Vector3(0, foundationHeight * 0.5, 0),
  );
  if (stoneTier) addFoundationStones(group, width, depth);
  const compactWindowZs = stoneTier ? [-1.2, 1.0] as const : [-0.9, 0.8] as const;
  addChurchWallShell(group, {
    width,
    depth,
    foundationHeight,
    wallHeight,
    frontZ,
    material: wallMaterial,
    frontDoor: stoneTier
      ? {
          center: 0,
          bottom: 0.04,
          width: 1.38,
          height: 2.22,
          shape: 'lancet',
        }
      : {
          center: 0,
          bottom: 0,
          width: 1.18,
          height: 1.94,
          shape: 'rectangle',
        },
    sideWindows: compactWindowZs.map((z): ChurchWallAperture => stoneTier
      ? {
          center: z,
          bottom: 1.05 - foundationHeight,
          width: 0.66,
          height: 1.55,
          shape: 'lancet',
        }
      : {
          center: z,
          bottom: 1.45 - 0.88 * 0.5 - foundationHeight,
          width: 0.68,
          height: 0.88,
          shape: 'rectangle',
        }),
    namePrefix: root.name,
  });

  if (stoneTier) {
    for (const z of compactWindowZs) {
      addLancetWindow(group, materials, 'left', z, 1.05, halfW);
      addLancetWindow(group, materials, 'right', z, 1.05, halfW);
    }
    for (const side of [-1, 1] as const) {
      addSideButtress(group, side, -1.5, wallTop, halfW);
      addSideButtress(group, side, 1.35, wallTop, halfW);
    }
  } else {
    const windowZs = compactWindowZs;
    const windowCenterY = 1.45;
    const windowWidth = 0.68;
    const windowHeight = 0.88;
    for (const side of [-1, 1] as const) {
      for (const [windowIndex, z] of windowZs.entries()) {
        const parts = addProceduralWindow(group, {
          position: new THREE.Vector3(side * (halfW + 0.045), windowCenterY, z),
          face: side > 0 ? 'positive-x' : 'negative-x',
          width: windowWidth,
          height: windowHeight,
          paneMaterial: materials.glass,
          frameMaterial: timberMaterial('dark'),
          sillMaterial: timberMaterial('dark'),
          namePrefix: 'Small wooden church',
        });
        parts.pane.name = `Small wooden church ${side < 0 ? 'left' : 'right'} window pane ${windowIndex + 1}`;
        for (const framePart of parts.frame) {
          framePart.name = 'Small wooden church window perimeter frame';
        }
      }
      // These are façade-bay seams. The former inner pair occupied the same
      // intervals as the windows, so keep one central seam between apertures.
      for (const [postIndex, z] of [-1.78, -0.05, 1.78].entries()) {
        const post = addMesh(
          group,
          new THREE.BoxGeometry(0.16, wallHeight + 0.16, 0.18),
          timberMaterial('dark'),
          new THREE.Vector3(side * (halfW + 0.07), foundationHeight + wallHeight * 0.5, z),
        );
        post.name = `Small wooden church ${side < 0 ? 'left' : 'right'} wall post ${postIndex + 1}`;
      }
    }
  }

  addCompactChurchRoof(group, width, depth, wallTop, ridgeHeight, roofMaterial);
  for (const zSign of [-1, 1] as const) {
    addTriangularGableWall(
      group,
      'z',
      zSign * (halfD + 0.01),
      halfW,
      wallTop,
      ridgeHeight,
      0.14,
      wallMaterial,
    );
  }

  if (stoneTier) {
    addPlankDoor(group, materials, frontZ, foundationHeight + 0.04);
  } else {
    addProceduralDoor(group, {
      position: new THREE.Vector3(0, foundationHeight, frontZ + 0.03),
      face: 'positive-z',
      width: 1.18,
      height: 1.94,
      leafMaterial: timberMaterial('mid'),
      frameMaterial: timberMaterial('dark'),
      namePrefix: 'Small wooden church',
    });
  }

  addCompactBellCote(
    group,
    materials,
    -halfD * 0.35,
    { width, wallTop, ridgeHeight },
    roofMaterial,
    stoneTier,
  );
  addParishCoffer(group, frontZ, stoneTier ? -1.42 : -1.12);
  return root;
}

/**
 * Gorski parish church: limewashed nave, hand-laid limestone base, deep tile
 * roof and an open oak belfry. The underlying chapel asset is enlarged as one
 * procedural unit so it reads as the settlement's spiritual landmark.
 */
function createLargeStoneChurchMesh(): THREE.Group {
  const root = new THREE.Group();
  root.name = 'Large Stone Church';
  const group = new THREE.Group();
  group.name = 'Large Stone Church procedural model';
  group.scale.setScalar(PARISH_CHURCH_MODEL_SCALE);
  root.add(group);
  const materials = createChapelMaterials();
  const roofMaterial = sharedBuildingMaterial('clayDark');

  const width = 5.2;
  const depth = 9.6;
  const foundationHeight = 0.48;
  const wallHeight = 3.75;
  const halfW = width * 0.5;
  const halfD = depth * 0.5;
  const wallTop = foundationHeight + wallHeight;
  const ridgeHeight = 2.55;
  const frontZ = halfD - 0.075;

  addMesh(
    group,
    new THREE.BoxGeometry(width + 0.5, foundationHeight, depth + 0.5),
    stoneMaterial('mid'),
    new THREE.Vector3(0, foundationHeight * 0.5, 0),
  );
  addFoundationStones(group, width, depth);

  addChurchWallShell(group, {
    width,
    depth,
    foundationHeight,
    wallHeight,
    frontZ,
    material: materials.limewash,
    frontDoor: {
      center: 0,
      bottom: 0.08,
      width: 1.38,
      height: 2.22,
      shape: 'lancet',
    },
    sideWindows: [-3, 0, 3].map((z): ChurchWallAperture => ({
      center: z,
      bottom: 1.28 - foundationHeight,
      width: 0.66,
      height: 1.55,
      shape: 'lancet',
    })),
    namePrefix: root.name,
  });
  addMesh(
    group,
    new THREE.BoxGeometry(width + 0.08, 0.24, depth + 0.08),
    materials.limewashShade,
    new THREE.Vector3(0, wallTop - 0.12, 0),
  );

  for (const z of [-3, 0, 3]) {
    addLancetWindow(group, materials, 'left', z, 1.28, halfW);
    addLancetWindow(group, materials, 'right', z, 1.28, halfW);
  }

  addPlankDoor(group, materials, frontZ, foundationHeight + 0.08);
  addParishCoffer(group, frontZ);
  addFolkFrieze(group, materials, frontZ, wallTop - 0.46);

  addCompactChurchRoof(group, width, depth, wallTop, ridgeHeight, roofMaterial);

  for (const zSign of [-1, 1] as const) {
    if (zSign > 0) {
      addPerforatedChurchGable(
        group,
        halfW,
        wallTop,
        ridgeHeight,
        halfD - 0.065,
        materials.limewash,
        { centerY: 1.05, radius: 0.48 },
      );
    } else {
      addTriangularGableWall(
        group,
        'z',
        -halfD + 0.065,
        halfW,
        wallTop,
        ridgeHeight,
        0.16,
        materials.limewash,
      );
    }
  }

  addBellTower(group, materials, 1.18, { width, wallTop, ridgeHeight }, roofMaterial);

  const frontGableZ = halfD + 0.12;
  const oculus = new THREE.Group();
  oculus.name = 'Chapel procedural oculus window opening';
  oculus.position.set(0, wallTop + 1.05, frontGableZ);
  oculus.userData.facadeOpeningKind = 'window';
  oculus.userData.facadeOpeningFace = 'positive-z';
  oculus.userData.facadeOpeningWidth = 0.96;
  oculus.userData.facadeOpeningHeight = 0.96;
  oculus.userData.hasCrossBars = false;
  group.add(oculus);
  const oculusPane = addMesh(
    oculus,
    new THREE.CircleGeometry(0.48, 16),
    materials.glass,
    new THREE.Vector3(),
  );
  oculusPane.name = 'Chapel clear oculus window pane';
  oculusPane.userData.facadeOpeningRole = 'window-pane';
  const oculusSurround = addMesh(
    oculus,
    new THREE.TorusGeometry(0.54, 0.1, 8, 18),
    stoneMaterial('light'),
    new THREE.Vector3(0, 0, 0.02),
  );
  oculusSurround.name = 'Chapel oculus stone perimeter surround';
  oculusSurround.userData.facadeOpeningRole = 'window-frame';

  return root;
}

export function createChapelMesh(tier: 1 | 2 | 3 | 4 = 1): THREE.Group {
  const root = tier === 4 ? createCathedralMesh()
    : tier === 3 ? createLargeStoneChurchMesh() : createCompactChurchMesh(tier);
  if (tier === 4) addParishCoffer(root, 11, -3.1);
  addChurchProgressionDetails(root, tier);
  addChurchyardFence(root, tier);
  return root;
}

/** Architectural and site work grows inside the same reserved churchyard. */
function addChurchProgressionDetails(root: THREE.Group, tier: 1 | 2 | 3 | 4): void {
  const model = root.getObjectByName(`${root.name} procedural model`) as THREE.Group;
  if (tier === 1) {
    const porch = new THREE.Group(); porch.name = 'Wooden church sheltered oak porch';
    porch.position.z = 2.95; model.add(porch);
    for (const x of [-.95,.95]) {
      addMesh(porch,new THREE.BoxGeometry(.16,2.12,.16),timberMaterial('dark'),new THREE.Vector3(x,1.3,.52)).name='Wooden church porch oak column';
      const brace=addMesh(porch,new THREE.BoxGeometry(.1,.68,.1),timberMaterial('mid'),new THREE.Vector3(x-Math.sign(x)*.18,2.13,.52));
      brace.rotation.z=Math.sign(x)*-.55; brace.name='Wooden church porch pegged knee brace';
    }
    addMesh(porch,new THREE.BoxGeometry(2.08,.18,1.45),stoneMaterial('mid'),new THREE.Vector3(0,.14,0)).name='Wooden church porch stone landing';
    addCompactChurchRoof(porch,1.95,1.4,2.36,.75,sharedBuildingMaterial('shingle'));
    porch.traverse(o=>{ if(o.name.startsWith('Church ')) o.name='Wooden porch '+o.name; });
    for(const z of [-2.29,2.3]) {
      addMesh(model,new THREE.BoxGeometry(3.55,.15,.14),timberMaterial('dark'),new THREE.Vector3(0,2.55,z)).name='Wooden church gable tie beam';
    }
  } else if (tier === 2) {
    // Square quoins and a dressed entrance identify the first masonry church.
    for(const x of [-2.2,2.2]) for(const z of [-2.76,2.76]) for(let i=0;i<8;i++) {
      addMesh(model,new THREE.BoxGeometry(i%2?.36:.5,.29,i%2?.5:.36),stoneMaterial(i%2?'mortar':'light'),new THREE.Vector3(x,.58+i*.35,z)).name='Stone church alternating corner quoin';
    }
    for(const side of [-1,1]) {
      addMesh(model,new THREE.BoxGeometry(.14,.18,5.65),stoneMaterial('mortar'),new THREE.Vector3(side*2.28,3.15,0)).name='Stone church carved eaves course';
    }
    const canopy = new THREE.Group();canopy.name='Stone church tiled portal hood';canopy.position.z=3.12;model.add(canopy);
    addCompactChurchRoof(canopy,2.05,.8,2.95,.65,sharedBuildingMaterial('clayDark'));
    canopy.traverse(o=>{ if(o.name.startsWith('Church ')) o.name='Stone portal hood '+o.name; });
  } else if (tier === 3) {
    for(const side of [-1,1] as const) for(const z of [-4.55,-1.5,1.5,4.55]) {
      addSideButtress(model,side,z,4.23,2.6);
    }
    // Dressed stone banding keeps the larger limewashed mass rooted in local masonry.
    for(const x of [-2.52,2.52]) for(const z of [-4.7,4.7]) {
      addMesh(model,new THREE.BoxGeometry(.33,3.75,.33),stoneMaterial('light'),new THREE.Vector3(x,2.2,z)).name='Parish church tall corner pilaster';
    }
  }
  const plot = getBuildingFootprintHalfExtents('chapel');
  const front = tier===4 ? 12.5 : tier===3 ? 8.2 : tier===2 ? 5.9 : 5.8;
  const width = tier===4 ? 4.7 : tier===3 ? 3.6 : 2.5;
  const path = addMesh(root,new THREE.BoxGeometry(width,.06,plot.halfDepth-front-.3),
    stoneMaterial(tier===1?'mortar':'mid'),new THREE.Vector3(0,.035,(plot.halfDepth+front-.3)/2));
  path.name='Churchyard processional approach';
  for(const side of [-1,1]) for(const z of [10.5,13]) {
    const x=side*(tier===4?8.5:5.5);
    addMesh(root,new THREE.BoxGeometry(1.8,.16,.5),timberMaterial('weathered'),new THREE.Vector3(x,.62,z)).name='Churchyard gathering bench';
    for(const dx of [-.6,.6]) addMesh(root,new THREE.BoxGeometry(.18,.5,.4),stoneMaterial('mid'),new THREE.Vector3(x+dx,.3,z));
  }
}
