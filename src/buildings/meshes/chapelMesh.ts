import * as THREE from 'three';
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
 * parish church. Keep the scale on a nested authored-model group so runtime
 * helpers (notably the shadow proxy) can still attach to an unscaled root.
 */
export const PARISH_CHURCH_MODEL_SCALE = 1.25;

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
  window.position.set(outward * (halfWidth - 0.035), sillY, z);
  window.rotation.y = outward > 0 ? Math.PI * 0.5 : -Math.PI * 0.5;
  group.add(window);

  addMesh(
    window,
    createLancetGeometry(0.96, 1.9, 0.11),
    stoneMaterial('light'),
    new THREE.Vector3(0, 0, 0),
  );
  addMesh(
    window,
    createLancetGeometry(0.66, 1.55, 0.12),
    materials.glass,
    new THREE.Vector3(0, 0.12, 0.075),
  );

  addMesh(
    window,
    new THREE.BoxGeometry(0.045, 1.38, 0.055),
    timberMaterial('dark'),
    new THREE.Vector3(0, 0.78, 0.145),
  );
  addMesh(
    window,
    new THREE.BoxGeometry(0.56, 0.045, 0.055),
    timberMaterial('dark'),
    new THREE.Vector3(0, 0.72, 0.15),
  );
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

  addMesh(
    group,
    createLancetGeometry(doorWidth + 0.48, doorHeight + 0.56, 0.16),
    stoneMaterial('light'),
    new THREE.Vector3(0, floorY - 0.02, frontZ - 0.08),
  );
  addMesh(
    group,
    createLancetGeometry(doorWidth, doorHeight, 0.18),
    timberMaterial('dark'),
    new THREE.Vector3(0, floorY, frontZ + 0.025),
  );

  const plankWidth = doorWidth / 5;
  for (let i = 0; i < 5; i++) {
    addMesh(
      group,
      new THREE.BoxGeometry(plankWidth * 0.84, doorHeight * 0.68, 0.055),
      i % 2 === 0 ? timberMaterial('mid') : timberMaterial('weathered'),
      new THREE.Vector3(-doorWidth * 0.5 + plankWidth * (i + 0.5), floorY + doorHeight * 0.34, frontZ + 0.225),
    );
  }

  for (const y of [floorY + 0.48, floorY + 1.42]) {
    addMesh(
      group,
      new THREE.BoxGeometry(doorWidth * 0.82, 0.09, 0.065),
      metalMaterial('iron'),
      new THREE.Vector3(0, y, frontZ + 0.27),
    );
  }
  addMesh(
    group,
    new THREE.TorusGeometry(0.1, 0.025, 6, 12),
    materials.brass,
    new THREE.Vector3(0.38, floorY + 1.02, frontZ + 0.31),
  );
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

function addRoofBands(
  group: THREE.Group,
  halfWidth: number,
  depth: number,
  wallTop: number,
  ridgeHeight: number,
  roofPitch: number,
  roofMaterial: THREE.Material,
): void {
  for (const side of [-1, 1] as const) {
    for (let row = 0; row < 6; row++) {
      const t = (row + 0.25) / 6.5;
      const x = side * halfWidth * (1 - t);
      const y = wallTop + ridgeHeight * t;
      addMesh(
        group,
        new THREE.BoxGeometry(0.075, 0.065, depth + 0.5),
        roofMaterial,
        new THREE.Vector3(x, y + 0.025, 0),
        new THREE.Euler(0, 0, side * -roofPitch),
      );
    }
  }
}

function addBellTower(
  group: THREE.Group,
  materials: ChapelMaterials,
  towerZ: number,
  roofY: number,
  roofMaterial: THREE.Material,
): void {
  const baseSize = 1.62;
  const belfryFloorY = roofY + 0.18;
  const belfryHeight = 2.08;
  // Keep the yoke tucked beneath the belfry's upper beams so the bell reads as
  // suspended from the steeple ceiling instead of floating near the floor.
  const bellLift = 0.63;

  addMesh(
    group,
    new THREE.BoxGeometry(baseSize + 0.16, 0.2, baseSize + 0.16),
    stoneMaterial('light'),
    new THREE.Vector3(0, belfryFloorY, towerZ),
  );
  for (const [sx, sz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]] as const) {
    addMesh(
      group,
      new THREE.BoxGeometry(0.2, belfryHeight, 0.2),
      timberMaterial('dark'),
      new THREE.Vector3(sx * 0.62, belfryFloorY + belfryHeight * 0.5, towerZ + sz * 0.62),
    );
  }
  for (const zSign of [-1, 1] as const) {
    addMesh(
      group,
      new THREE.BoxGeometry(baseSize, 0.18, 0.18),
      timberMaterial('weathered'),
      new THREE.Vector3(0, belfryFloorY + belfryHeight, towerZ + zSign * 0.62),
    );
  }
  for (const xSign of [-1, 1] as const) {
    addMesh(
      group,
      new THREE.BoxGeometry(0.18, 0.18, baseSize),
      timberMaterial('weathered'),
      new THREE.Vector3(xSign * 0.62, belfryFloorY + belfryHeight, towerZ),
    );
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

  const towerRoofY = belfryFloorY + belfryHeight + 0.63;
  addMesh(
    group,
    new THREE.ConeGeometry(1.32, 1.48, 4),
    roofMaterial,
    new THREE.Vector3(0, towerRoofY, towerZ),
    new THREE.Euler(0, Math.PI * 0.25, 0),
  );
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

function addCompactChurchRoof(
  group: THREE.Group,
  width: number,
  depth: number,
  wallTop: number,
  ridgeHeight: number,
  material: THREE.Material,
): void {
  const halfW = width * 0.5;
  const roofPitch = Math.atan2(ridgeHeight, halfW);
  const slopeLen = halfW / Math.cos(roofPitch) + 0.25;
  for (const side of [-1, 1] as const) {
    addMesh(
      group,
      new THREE.BoxGeometry(slopeLen, 0.14, depth + 0.42),
      material,
      new THREE.Vector3(side * halfW * 0.46, wallTop + ridgeHeight * 0.48, 0),
      new THREE.Euler(0, 0, side * -roofPitch),
    );
  }
  addMesh(
    group,
    new THREE.BoxGeometry(0.22, 0.17, depth + 0.52),
    material,
    new THREE.Vector3(0, wallTop + ridgeHeight + 0.02, 0),
  );
}

function addCompactBellCote(
  group: THREE.Group,
  materials: ChapelMaterials,
  z: number,
  baseY: number,
  roofMaterial: THREE.Material,
  stoneTier: boolean,
): void {
  const span = stoneTier ? 1.42 : 1.18;
  const height = stoneTier ? 1.72 : 1.45;
  const postMaterial = stoneTier ? stoneMaterial('light') : timberMaterial('dark');
  for (const x of [-span * 0.5, span * 0.5]) {
    addMesh(
      group,
      new THREE.BoxGeometry(stoneTier ? 0.24 : 0.18, height, 0.22),
      postMaterial,
      new THREE.Vector3(x, baseY + height * 0.5, z),
    );
  }
  addMesh(
    group,
    new THREE.BoxGeometry(span + 0.28, 0.2, 0.34),
    postMaterial,
    new THREE.Vector3(0, baseY + height, z),
  );
  addMesh(
    group,
    new THREE.CylinderGeometry(0.18, 0.34, 0.58, 10),
    materials.brass,
    new THREE.Vector3(0, baseY + height * 0.55, z),
  );
  addMesh(
    group,
    new THREE.ConeGeometry(span * 0.72, stoneTier ? 1.08 : 0.9, 4),
    roofMaterial,
    new THREE.Vector3(0, baseY + height + (stoneTier ? 0.48 : 0.4), z),
    new THREE.Euler(0, Math.PI * 0.25, 0),
  );
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
  group.name = `${root.name} authored model`;
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
  const frontZ = halfD - 0.04;
  const wallMaterial = stoneTier
    ? stoneMaterial('light')
    : timberMaterial('weathered');
  const roofMaterial = sharedBuildingMaterial(stoneTier ? 'clayRed' : 'shingle');

  addMesh(
    group,
    new THREE.BoxGeometry(width + 0.34, foundationHeight, depth + 0.34),
    stoneMaterial(stoneTier ? 'mid' : 'mortar'),
    new THREE.Vector3(0, foundationHeight * 0.5, 0),
  );
  if (stoneTier) addFoundationStones(group, width, depth);
  addMesh(
    group,
    new THREE.BoxGeometry(width, wallHeight, depth),
    wallMaterial,
    new THREE.Vector3(0, foundationHeight + wallHeight * 0.5, 0),
  );

  if (stoneTier) {
    for (const z of [-1.2, 1.0]) {
      addLancetWindow(group, materials, 'left', z, 1.05, halfW);
      addLancetWindow(group, materials, 'right', z, 1.05, halfW);
    }
    for (const side of [-1, 1] as const) {
      addSideButtress(group, side, -1.5, wallTop, halfW);
      addSideButtress(group, side, 1.35, wallTop, halfW);
    }
  } else {
    for (const side of [-1, 1] as const) {
      for (const z of [-0.9, 0.8]) {
        addMesh(
          group,
          new THREE.BoxGeometry(0.08, 0.88, 0.68),
          materials.glass,
          new THREE.Vector3(side * (halfW + 0.045), 1.45, z),
        );
        addMesh(
          group,
          new THREE.BoxGeometry(0.12, 1.08, 0.09),
          timberMaterial('dark'),
          new THREE.Vector3(side * (halfW + 0.085), 1.45, z),
        );
        addMesh(
          group,
          new THREE.BoxGeometry(0.12, 0.09, 0.82),
          timberMaterial('dark'),
          new THREE.Vector3(side * (halfW + 0.09), 1.45, z),
        );
      }
      for (const z of [-1.78, -0.58, 0.62, 1.78]) {
        addMesh(
          group,
          new THREE.BoxGeometry(0.16, wallHeight + 0.16, 0.18),
          timberMaterial('dark'),
          new THREE.Vector3(side * (halfW + 0.07), foundationHeight + wallHeight * 0.5, z),
        );
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
    addMesh(
      group,
      new THREE.BoxGeometry(1.18, 1.94, 0.16),
      timberMaterial('dark'),
      new THREE.Vector3(0, foundationHeight + 0.97, frontZ + 0.09),
    );
    for (const x of [-0.42, -0.14, 0.14, 0.42]) {
      addMesh(
        group,
        new THREE.BoxGeometry(0.19, 1.76, 0.04),
        timberMaterial('mid'),
        new THREE.Vector3(x, foundationHeight + 0.97, frontZ + 0.19),
      );
    }
  }

  addCompactBellCote(
    group,
    materials,
    -halfD * 0.35,
    wallTop + ridgeHeight * 0.78,
    roofMaterial,
    stoneTier,
  );
  addParishCoffer(group, frontZ, stoneTier ? -1.42 : -1.12);
  for (let step = 0; step < 2; step++) {
    addMesh(
      group,
      new THREE.BoxGeometry((stoneTier ? 2.0 : 1.62) - step * 0.25, 0.14, 0.52),
      stoneMaterial(step === 0 ? 'mid' : 'light'),
      new THREE.Vector3(0, 0.07 + step * 0.1, halfD + 0.36 - step * 0.13),
    );
  }
  return root;
}

/**
 * Gorski parish church: limewashed nave, hand-laid limestone base, deep tile
 * roof and an open oak belfry. The underlying chapel asset is enlarged as one
 * authored unit so it reads as the settlement's spiritual landmark.
 */
function createLargeStoneChurchMesh(): THREE.Group {
  const root = new THREE.Group();
  root.name = 'Large Stone Church';
  const group = new THREE.Group();
  group.name = 'Large Stone Church authored model';
  group.scale.setScalar(PARISH_CHURCH_MODEL_SCALE);
  root.add(group);
  const materials = createChapelMaterials();
  const roofMaterial = sharedBuildingMaterial('slate');

  const width = 5.2;
  const depth = 6.9;
  const foundationHeight = 0.48;
  const wallHeight = 3.15;
  const halfW = width * 0.5;
  const halfD = depth * 0.5;
  const wallTop = foundationHeight + wallHeight;
  const ridgeHeight = 2.55;
  const roofPitch = Math.atan2(ridgeHeight, halfW);
  const slopeLen = halfW / Math.cos(roofPitch) + 0.28;
  const frontZ = halfD - 0.075;

  addMesh(
    group,
    new THREE.BoxGeometry(width + 0.5, foundationHeight, depth + 0.5),
    stoneMaterial('mid'),
    new THREE.Vector3(0, foundationHeight * 0.5, 0),
  );
  addFoundationStones(group, width, depth);
  addMesh(
    group,
    new THREE.BoxGeometry(width + 0.18, 0.14, depth + 0.18),
    stoneMaterial('mortar'),
    new THREE.Vector3(0, foundationHeight + 0.07, 0),
  );

  addMesh(
    group,
    new THREE.BoxGeometry(width - 0.18, wallHeight, depth - 0.18),
    materials.limewash,
    new THREE.Vector3(0, foundationHeight + wallHeight * 0.5, 0),
  );
  addMesh(
    group,
    new THREE.BoxGeometry(width + 0.08, 0.24, depth + 0.08),
    materials.limewashShade,
    new THREE.Vector3(0, wallTop - 0.12, 0),
  );

  for (const z of [-1.65, 1.15]) {
    addLancetWindow(group, materials, 'left', z, 1.28, halfW);
    addLancetWindow(group, materials, 'right', z, 1.28, halfW);
    addSideButtress(group, -1, z - 0.72, wallTop, halfW);
    addSideButtress(group, 1, z - 0.72, wallTop, halfW);
  }

  addPlankDoor(group, materials, frontZ, foundationHeight + 0.08);
  addParishCoffer(group, frontZ);
  addFolkFrieze(group, materials, frontZ, wallTop - 0.46);

  for (let step = 0; step < 3; step++) {
    addMesh(
      group,
      new THREE.BoxGeometry(2.45 - step * 0.32, 0.16, 0.62),
      stoneMaterial(step === 1 ? 'mid' : 'light'),
      new THREE.Vector3(0, 0.08 + step * 0.12, halfD + 0.52 - step * 0.18),
    );
  }

  for (const side of [-1, 1] as const) {
    addMesh(
      group,
      new THREE.BoxGeometry(slopeLen, 0.15, depth + 0.48),
      roofMaterial,
      new THREE.Vector3(side * halfW * 0.46, wallTop + ridgeHeight * 0.48, 0),
      new THREE.Euler(0, 0, side * -roofPitch),
    );
  }
  addRoofBands(group, halfW, depth, wallTop, ridgeHeight, roofPitch, roofMaterial);
  addMesh(
    group,
    new THREE.BoxGeometry(0.28, 0.2, depth + 0.66),
    roofMaterial,
    new THREE.Vector3(0, wallTop + ridgeHeight + 0.04, 0),
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
      materials.limewash,
    );

    for (const side of [-1, 1] as const) {
      addMesh(
        group,
        new THREE.BoxGeometry(slopeLen, 0.15, 0.16),
        timberMaterial('dark'),
        new THREE.Vector3(side * halfW * 0.46, wallTop + ridgeHeight * 0.48, zSign * (halfD + 0.17)),
        new THREE.Euler(0, 0, side * -roofPitch),
      );
    }
  }

  addBellTower(group, materials, 1.18, wallTop + ridgeHeight * 0.7, roofMaterial);

  const frontGableZ = halfD + 0.12;
  addMesh(
    group,
    new THREE.CircleGeometry(0.48, 16),
    materials.glass,
    new THREE.Vector3(0, wallTop + 1.05, frontGableZ),
  );
  addMesh(
    group,
    new THREE.TorusGeometry(0.54, 0.1, 8, 18),
    stoneMaterial('light'),
    new THREE.Vector3(0, wallTop + 1.05, frontGableZ + 0.02),
  );
  for (let i = 0; i < 4; i++) {
    addMesh(
      group,
      new THREE.BoxGeometry(0.055, 0.88, 0.045),
      timberMaterial('dark'),
      new THREE.Vector3(0, wallTop + 1.05, frontGableZ + 0.07),
      new THREE.Euler(0, 0, i * Math.PI * 0.25),
    );
  }

  // A low parish wall frames the entrance without obscuring the facade.
  for (const side of [-1, 1] as const) {
    for (let i = 0; i < 3; i++) {
      addMesh(
        group,
        new THREE.BoxGeometry(0.82, 0.44 + (i % 2) * 0.06, 0.46),
        stoneMaterial(i % 2 === 0 ? 'light' : 'mid'),
        new THREE.Vector3(side * (1.78 + i * 0.72), 0.22, halfD + 0.82 + i * 0.12),
        new THREE.Euler(0, side * (0.08 + i * 0.035), 0),
      );
    }
  }

  return root;
}

export function createChapelMesh(tier: 1 | 2 | 3 = 3): THREE.Group {
  if (tier === 1 || tier === 2) return createCompactChurchMesh(tier);
  return createLargeStoneChurchMesh();
}
