import * as THREE from 'three';
import type { BuildingKind } from '../resources/types.ts';
import {
  addMesh,
  metalMaterial,
  shingleMaterial,
  stoneMaterial,
  tileMaterial,
  timberMaterial,
} from './buildingMaterials.ts';

function addLogPile(
  group: THREE.Group,
  baseX: number,
  baseZ: number,
  floorY: number,
  pileRows: number,
  logLength: number,
  logRadius: number,
): void {
  const logSpacing = logRadius * 1.72;
  const rowSpacing = logRadius * 1.82;

  for (let row = 0; row < pileRows; row++) {
    const logsInRow = pileRows - row;
    const rowY = floorY + logRadius + row * rowSpacing;
    const rowSpan = (logsInRow - 1) * logSpacing;
    for (let col = 0; col < logsInRow; col++) {
      addMesh(
        group,
        new THREE.CylinderGeometry(logRadius * 0.93, logRadius * 1.05, logLength, 8),
        (row + col) % 2 === 0 ? timberMaterial('weathered') : timberMaterial('mid'),
        new THREE.Vector3(baseX, rowY, baseZ - rowSpan * 0.5 + col * logSpacing),
        new THREE.Euler(0, 0, Math.PI * 0.5),
      );
    }
  }
}

function addCircularSaw(group: THREE.Group, x: number, z: number, floorY: number): void {
  const bladeRadius = 1.35;
  const tableY = floorY + 0.25;

  // Heavy timber bed and cast-iron table top.
  addMesh(
    group,
    new THREE.BoxGeometry(3.8, 0.24, 1.9),
    timberMaterial('dark'),
    new THREE.Vector3(x, floorY + 0.12, z),
  );
  addMesh(
    group,
    new THREE.BoxGeometry(3.55, 0.07, 1.72),
    metalMaterial('iron'),
    new THREE.Vector3(x, tableY, z),
  );

  // Vertical blade facing the log intake bay.
  addMesh(
    group,
    new THREE.CylinderGeometry(bladeRadius, bladeRadius, 0.05, 28),
    metalMaterial('steel'),
    new THREE.Vector3(x + 0.18, tableY + bladeRadius * 0.82, z),
    new THREE.Euler(0, 0, Math.PI * 0.5),
  );

  // Timber guard frame over the upper blade arc.
  const guardX = x + 0.18;
  const guardBaseY = tableY + bladeRadius * 0.15;
  const guardTopY = tableY + bladeRadius * 1.75;
  for (const zSign of [-1, 1] as const) {
    addMesh(
      group,
      new THREE.BoxGeometry(0.14, guardTopY - guardBaseY, 0.14),
      timberMaterial('dark'),
      new THREE.Vector3(guardX, (guardBaseY + guardTopY) * 0.5, z + zSign * bladeRadius * 0.62),
    );
  }
  addMesh(
    group,
    new THREE.BoxGeometry(0.14, 0.14, bladeRadius * 1.32),
    timberMaterial('dark'),
    new THREE.Vector3(guardX, guardTopY, z),
  );

  // Drive pulley and crank wheel beside the table.
  addMesh(
    group,
    new THREE.CylinderGeometry(0.62, 0.62, 0.14, 18),
    metalMaterial('iron'),
    new THREE.Vector3(x - 1.25, floorY + 0.62, z - 0.75),
    new THREE.Euler(Math.PI * 0.5, 0, 0),
  );
  addMesh(
    group,
    new THREE.BoxGeometry(0.12, 0.85, 0.12),
    timberMaterial('mid'),
    new THREE.Vector3(x - 1.25, floorY + 0.62, z - 0.75),
  );
  addMesh(
    group,
    new THREE.BoxGeometry(0.55, 0.1, 0.1),
    timberMaterial('light'),
    new THREE.Vector3(x - 1.25, floorY + 1.02, z - 0.75),
  );
}

/** Long timber sawmill — stone plinth, plank walls, red terracotta gabled roof. */
export function createLumberMillMesh(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Lumber mill';

  const length = 18;
  const width = 7;
  const stoneHeight = 1.2;
  const wallHeight = 3.6;
  const halfL = length * 0.5;
  const halfW = width * 0.5;
  const totalWall = stoneHeight + wallHeight;

  // Limestone plinth — Gorski Kotar white stone base.
  addMesh(
    group,
    new THREE.BoxGeometry(length + 0.35, stoneHeight, width + 0.35),
    stoneMaterial('light'),
    new THREE.Vector3(0, stoneHeight * 0.5, 0),
  );

  addMesh(
    group,
    new THREE.BoxGeometry(length + 0.08, 0.18, width + 0.08),
    stoneMaterial('mortar'),
    new THREE.Vector3(0, stoneHeight + 0.09, 0),
  );

  // Corner quoins.
  for (const [sx, sz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]] as const) {
    addMesh(
      group,
      new THREE.BoxGeometry(0.55, totalWall, 0.55),
      stoneMaterial('mid'),
      new THREE.Vector3(sx * (halfL - 0.18), totalWall * 0.5, sz * (halfW - 0.18)),
    );
  }

  // Timber post frame along long walls.
  const postSpacing = 2.4;
  for (let x = -halfL + 1.2; x <= halfL - 0.5; x += postSpacing) {
    for (const z of [-halfW + 0.22, halfW - 0.22]) {
      addMesh(
        group,
        new THREE.BoxGeometry(0.22, wallHeight, 0.22),
        timberMaterial('dark'),
        new THREE.Vector3(x, stoneHeight + wallHeight * 0.5, z),
      );
    }
  }

  // Horizontal plank cladding between posts.
  const plankHeight = 0.42;
  const plankCount = Math.floor(wallHeight / plankHeight);
  for (let row = 0; row < plankCount; row++) {
    const y = stoneHeight + plankHeight * 0.5 + row * plankHeight;
    const shade = row % 2 === 0 ? timberMaterial('mid') : timberMaterial('weathered');
    addMesh(group, new THREE.BoxGeometry(length - 0.5, plankHeight * 0.88, 0.16), shade, new THREE.Vector3(0, y, halfW - 0.08));
    addMesh(group, new THREE.BoxGeometry(length - 0.5, plankHeight * 0.88, 0.16), shade, new THREE.Vector3(0, y, -halfW + 0.08));
  }

  // Gable end walls (timber over stone).
  addMesh(
    group,
    new THREE.BoxGeometry(0.2, wallHeight, width - 0.4),
    timberMaterial('light'),
    new THREE.Vector3(halfL - 0.1, stoneHeight + wallHeight * 0.5, 0),
  );
  addMesh(
    group,
    new THREE.BoxGeometry(0.2, wallHeight, width - 0.4),
    timberMaterial('light'),
    new THREE.Vector3(-halfL + 0.1, stoneHeight + wallHeight * 0.5, 0),
  );

  // Open bay / log intake on front gable.
  addMesh(
    group,
    new THREE.BoxGeometry(0.12, 2.45, 3.4),
    timberMaterial('dark'),
    new THREE.Vector3(halfL + 0.02, stoneHeight + 1.35, 0),
  );

  const roofY = stoneHeight + wallHeight;
  const floorY = stoneHeight;

  // Main-floor circular saw — visible through the open intake bay.
  addCircularSaw(group, halfL - 4.8, 0.35, floorY);

  // Interior log piles awaiting the blade.
  addLogPile(group, -halfL + 3.8, -1.6, floorY, 4, 2.4, 0.22);
  addLogPile(group, -1.2, 1.85, floorY, 3, 2.0, 0.2);
  addLogPile(group, halfL - 8.2, -0.4, floorY, 4, 2.2, 0.21);

  // Loft deck — horizontal ceiling where the wall frame meets the roof attic.
  addMesh(
    group,
    new THREE.BoxGeometry(length - 0.55, 0.14, width - 0.45),
    timberMaterial('light'),
    new THREE.Vector3(0, roofY - 0.06, 0),
  );

  // Loft joists visible from the main floor below.
  for (let x = -halfL + 2.2; x <= halfL - 2.2; x += 2.8) {
    addMesh(
      group,
      new THREE.BoxGeometry(0.16, 0.2, width - 0.52),
      timberMaterial('dark'),
      new THREE.Vector3(x, roofY - 0.2, 0),
    );
  }

  // Red terracotta tile roof — ridge along the long axis, triangular gable ends.
  const ridgeHeight = 2.6;
  const roofPitch = Math.atan2(ridgeHeight, halfW);
  const slopeLength = halfW / Math.cos(roofPitch) + 0.3;

  for (const side of [-1, 1] as const) {
    addMesh(
      group,
      new THREE.BoxGeometry(length + 0.65, 0.12, slopeLength),
      tileMaterial(0),
      new THREE.Vector3(0, roofY + ridgeHeight * 0.5, side * halfW * 0.46),
      new THREE.Euler(side > 0 ? roofPitch : -roofPitch, 0, 0),
    );
  }

  addMesh(
    group,
    new THREE.BoxGeometry(length + 0.8, 0.22, 0.36),
    tileMaterial(2),
    new THREE.Vector3(0, roofY + ridgeHeight + 0.06, 0),
  );

  // Triangular gable ends — sloped faces in the Y–Z plane meeting at the ridge.
  for (const xSign of [-1, 1] as const) {
    for (const zSide of [-1, 1] as const) {
      addMesh(
        group,
        new THREE.BoxGeometry(0.16, 0.12, slopeLength * 0.96),
        tileMaterial(1),
        new THREE.Vector3(xSign * (halfL + 0.06), roofY + ridgeHeight * 0.48, zSide * halfW * 0.46),
        new THREE.Euler(zSide > 0 ? roofPitch : -roofPitch, 0, 0),
      );
    }
  }

  // Stone chimney — common in the region.
  addMesh(
    group,
    new THREE.BoxGeometry(0.9, 2.8, 0.9),
    stoneMaterial('mid'),
    new THREE.Vector3(-halfL + 1.5, totalWall + 1.35, halfW - 1.2),
  );
  addMesh(
    group,
    new THREE.BoxGeometry(1.0, 0.18, 1.0),
    stoneMaterial('mid'),
    new THREE.Vector3(-halfL + 1.5, totalWall + 2.75, halfW - 1.2),
  );

  // Triangular log pile beside the mill — stacked rows tapering to a point.
  addLogPile(group, halfL - 1.8, halfW + 1.6, 0, 5, 3.0, 0.26);

  return group;
}

/** A-frame forester hut — stone plinth, timber walls, shingled roof. */
export function createReforesterHutMesh(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Reforester hut';

  const width = 6.4;
  const depth = 5.8;
  const stoneHeight = 1.0;
  const wallHeight = 2.15;
  const halfW = width * 0.5;
  const halfD = depth * 0.5;
  const wallTop = stoneHeight + wallHeight;
  const ridgeHeight = 3.35;
  const roofPitch = Math.atan2(ridgeHeight, halfW);
  const slopeLen = halfW / Math.cos(roofPitch) + 0.25;
  const wallInset = 0.1;
  const plankHeight = 0.38;
  const plankRows = Math.floor(wallHeight / plankHeight);

  // Limestone plinth — continuous base tying the shell together.
  addMesh(
    group,
    new THREE.BoxGeometry(width + 0.38, stoneHeight, depth + 0.38),
    stoneMaterial('light'),
    new THREE.Vector3(0, stoneHeight * 0.5, 0),
  );
  addMesh(
    group,
    new THREE.BoxGeometry(width + 0.1, 0.16, depth + 0.1),
    stoneMaterial('mortar'),
    new THREE.Vector3(0, stoneHeight + 0.08, 0),
  );

  // Corner quoins and posts — frame every wall corner.
  for (const [sx, sz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]] as const) {
    addMesh(
      group,
      new THREE.BoxGeometry(0.42, wallHeight + 0.14, 0.42),
      stoneMaterial('mid'),
      new THREE.Vector3(sx * (halfW - 0.14), stoneHeight + (wallHeight + 0.14) * 0.5, sz * (halfD - 0.14)),
    );
    addMesh(
      group,
      new THREE.BoxGeometry(0.2, wallHeight, 0.2),
      timberMaterial('dark'),
      new THREE.Vector3(sx * (halfW - wallInset), stoneHeight + wallHeight * 0.5, sz * (halfD - wallInset)),
    );
  }

  // Side walls — horizontal plank cladding between corner posts.
  for (let row = 0; row < plankRows; row++) {
    const y = stoneHeight + plankHeight * 0.5 + row * plankHeight;
    const shade = row % 2 === 0 ? timberMaterial('mid') : timberMaterial('weathered');
    addMesh(
      group,
      new THREE.BoxGeometry(0.18, plankHeight * 0.88, depth - 0.42),
      shade,
      new THREE.Vector3(-halfW + 0.09, y, 0),
    );
    addMesh(
      group,
      new THREE.BoxGeometry(0.18, plankHeight * 0.88, depth - 0.42),
      shade,
      new THREE.Vector3(halfW - 0.09, y, 0),
    );
  }

  // Back wall planks.
  for (let row = 0; row < plankRows; row++) {
    const y = stoneHeight + plankHeight * 0.5 + row * plankHeight;
    const shade = row % 2 === 0 ? timberMaterial('mid') : timberMaterial('weathered');
    addMesh(
      group,
      new THREE.BoxGeometry(width - 0.42, plankHeight * 0.88, 0.18),
      shade,
      new THREE.Vector3(0, y, -halfD + 0.09),
    );
  }

  // Front wall with door — plank sections flanking a framed opening.
  const doorWidth = 1.15;
  const doorHeight = 1.95;
  const doorCenterX = 0.12;
  const doorLeft = doorCenterX - doorWidth * 0.5;
  const doorRight = doorCenterX + doorWidth * 0.5;
  const frontZ = halfD - 0.09;
  const leftPanelWidth = doorLeft - (-halfW + 0.21);
  const rightPanelWidth = halfW - 0.21 - doorRight;

  for (let row = 0; row < plankRows; row++) {
    const y = stoneHeight + plankHeight * 0.5 + row * plankHeight;
    const shade = row % 2 === 0 ? timberMaterial('mid') : timberMaterial('weathered');
    const rowTop = y + plankHeight * 0.44;
    const doorTop = stoneHeight + doorHeight;

    if (rowTop <= doorTop) {
      addMesh(
        group,
        new THREE.BoxGeometry(leftPanelWidth, plankHeight * 0.88, 0.18),
        shade,
        new THREE.Vector3(-halfW + 0.21 + leftPanelWidth * 0.5, y, frontZ),
      );
      addMesh(
        group,
        new THREE.BoxGeometry(rightPanelWidth, plankHeight * 0.88, 0.18),
        shade,
        new THREE.Vector3(halfW - 0.21 - rightPanelWidth * 0.5, y, frontZ),
      );
    } else {
      addMesh(
        group,
        new THREE.BoxGeometry(width - 0.42, plankHeight * 0.88, 0.18),
        shade,
        new THREE.Vector3(0, y, frontZ),
      );
    }
  }

  // Door frame and panel — same timber-frame language as the lumber mill.
  addMesh(
    group,
    new THREE.BoxGeometry(0.14, doorHeight + 0.12, 0.22),
    timberMaterial('dark'),
    new THREE.Vector3(doorLeft - 0.04, stoneHeight + doorHeight * 0.5, frontZ + 0.04),
  );
  addMesh(
    group,
    new THREE.BoxGeometry(0.14, doorHeight + 0.12, 0.22),
    timberMaterial('dark'),
    new THREE.Vector3(doorRight + 0.04, stoneHeight + doorHeight * 0.5, frontZ + 0.04),
  );
  addMesh(
    group,
    new THREE.BoxGeometry(doorWidth + 0.32, 0.14, 0.22),
    timberMaterial('dark'),
    new THREE.Vector3(doorCenterX, stoneHeight + doorHeight + 0.04, frontZ + 0.04),
  );
  addMesh(
    group,
    new THREE.BoxGeometry(doorWidth - 0.08, doorHeight - 0.1, 0.1),
    timberMaterial('weathered'),
    new THREE.Vector3(doorCenterX, stoneHeight + doorHeight * 0.5 - 0.02, frontZ + 0.01),
  );

  // Wall plate tying the front and back walls to the side posts.
  for (const zSign of [-1, 1] as const) {
    addMesh(
      group,
      new THREE.BoxGeometry(width - 0.24, 0.16, 0.16),
      timberMaterial('dark'),
      new THREE.Vector3(0, wallTop - 0.04, zSign * (halfD - wallInset)),
    );
  }

  // Loft deck — horizontal ceiling where the wall frame meets the roof attic.
  addMesh(
    group,
    new THREE.BoxGeometry(width - 0.55, 0.14, depth - 0.45),
    timberMaterial('light'),
    new THREE.Vector3(0, wallTop - 0.06, 0),
  );

  // Loft joists visible from the main floor below.
  for (let z = -halfD + 2.2; z <= halfD - 2.2; z += 2.8) {
    addMesh(
      group,
      new THREE.BoxGeometry(width - 0.52, 0.2, 0.16),
      timberMaterial('dark'),
      new THREE.Vector3(0, wallTop - 0.2, z),
    );
  }

  // Ridge beam.
  addMesh(
    group,
    new THREE.BoxGeometry(0.18, 0.18, depth - 0.12),
    timberMaterial('dark'),
    new THREE.Vector3(0, wallTop + ridgeHeight, 0),
  );

  // Shingled roof slopes.
  for (const side of [-1, 1] as const) {
    addMesh(
      group,
      new THREE.BoxGeometry(slopeLen, 0.11, depth + 0.28),
      shingleMaterial(),
      new THREE.Vector3(side * halfW * 0.46, wallTop + ridgeHeight * 0.48, 0),
      new THREE.Euler(0, 0, side * -roofPitch),
    );
  }

  // Gable infill — closes the front and back triangles beneath the roof.
  const gableSlopeLen = halfW / Math.cos(roofPitch);
  for (const zSign of [-1, 1] as const) {
    for (const xSign of [-1, 1] as const) {
      addMesh(
        group,
        new THREE.BoxGeometry(gableSlopeLen * 0.94, 0.12, 0.16),
        shingleMaterial(),
        new THREE.Vector3(xSign * halfW * 0.46, wallTop + ridgeHeight * 0.48, zSign * (halfD - 0.06)),
        new THREE.Euler(0, 0, xSign * -roofPitch),
      );
    }
  }

  // Axe block beside the door, resting on the plinth.
  addMesh(
    group,
    new THREE.BoxGeometry(0.55, 0.42, 0.55),
    timberMaterial('dark'),
    new THREE.Vector3(halfW - 0.55, stoneHeight + 0.21, halfD - 0.45),
  );

  return group;
}

/** Open-pit stone quarry — terraced cut blocks, timber hoist frame, foreman's shed. */
export function createStoneQuarryMesh(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Stone quarry';

  const pitRadius = 8.5;
  const terraceCount = 4;
  const terraceStep = 0.65;

  // Terraced pit ring — cut stone benches stepping down (weathered grey limestone).
  for (let tier = 0; tier < terraceCount; tier++) {
    const scale = 1 - tier * 0.18;
    const y = tier * terraceStep;
    const inner = pitRadius * scale;
    const shade = tier === 0 ? 'mid' : tier === terraceCount - 1 ? 'mortar' : 'mid';
    addMesh(
      group,
      new THREE.CylinderGeometry(inner, inner + 1.05, 0.58, 12, 1, false),
      stoneMaterial(shade),
      new THREE.Vector3(0, y + 0.29, 0),
    );
  }

  // Central spoil heap.
  addMesh(
    group,
    new THREE.ConeGeometry(3.2, 2.2, 10),
    stoneMaterial('mortar'),
    new THREE.Vector3(1.2, 1.1, -0.9),
  );

  // Timber hoist frame over the pit edge — tall enough to read against pit depth.
  const frameX = pitRadius * 0.62;
  const frameSpan = 3.4;
  const frameHeight = 5.8;
  for (const z of [-frameSpan, frameSpan] as const) {
    addMesh(
      group,
      new THREE.BoxGeometry(0.34, frameHeight, 0.34),
      timberMaterial('dark'),
      new THREE.Vector3(frameX, frameHeight * 0.5, z),
    );
  }
  addMesh(
    group,
    new THREE.BoxGeometry(0.26, 0.26, frameSpan * 2 + 0.5),
    timberMaterial('weathered'),
    new THREE.Vector3(frameX, frameHeight - 0.15, 0),
  );
  addMesh(
    group,
    new THREE.BoxGeometry(0.16, 0.16, frameSpan * 1.7),
    timberMaterial('mid'),
    new THREE.Vector3(frameX - 0.45, frameHeight * 0.72, 0),
    new THREE.Euler(0, 0, 0.28),
  );

  // Cut stone blocks stacked beside ramp — roughly knee-to-waist height per block.
  for (let i = 0; i < 7; i++) {
    const bx = -pitRadius - 0.85 - (i % 2) * 0.55;
    const bz = -2.2 + i * 0.85;
    addMesh(
      group,
      new THREE.BoxGeometry(1.1, 0.72 + (i % 3) * 0.14, 0.95),
      stoneMaterial(i % 2 === 0 ? 'mid' : 'mortar'),
      new THREE.Vector3(bx, 0.36 + Math.floor(i / 2) * 0.68, bz),
    );
  }

  // Foreman's stone shed on rim — ~2.5× player height, door ~2 m.
  const shedX = -pitRadius + 1.8;
  const shedZ = pitRadius * 0.42;
  const shedW = 5.2;
  const shedD = 4.2;
  const shedWallH = 2.55;
  const shedHalfD = shedD * 0.5;
  const shedRidgeH = 1.35;

  addMesh(
    group,
    new THREE.BoxGeometry(shedW + 0.35, 0.32, shedD + 0.35),
    stoneMaterial('mortar'),
    new THREE.Vector3(shedX, 0.16, shedZ),
  );
  addMesh(
    group,
    new THREE.BoxGeometry(shedW, shedWallH, shedD),
    stoneMaterial('mid'),
    new THREE.Vector3(shedX, 0.32 + shedWallH * 0.5, shedZ),
  );
  addMesh(
    group,
    new THREE.BoxGeometry(0.95, 2.05, 0.12),
    timberMaterial('weathered'),
    new THREE.Vector3(shedX + 0.6, 0.32 + 1.05, shedZ + shedHalfD - 0.04),
  );

  const shedRoofPitch = Math.atan2(shedRidgeH, shedHalfD);
  const shedSlopeLen = shedHalfD / Math.cos(shedRoofPitch) + 0.2;
  const shedRoofY = 0.32 + shedWallH;
  for (const side of [-1, 1] as const) {
    addMesh(
      group,
      new THREE.BoxGeometry(shedW + 0.3, 0.1, shedSlopeLen),
      tileMaterial(side > 0 ? 1 : 0),
      new THREE.Vector3(shedX, shedRoofY + shedRidgeH * 0.5, shedZ + side * shedHalfD * 0.46),
      new THREE.Euler(side > 0 ? shedRoofPitch : -shedRoofPitch, 0, 0),
    );
  }
  addMesh(
    group,
    new THREE.BoxGeometry(shedW + 0.4, 0.16, 0.28),
    tileMaterial(2),
    new THREE.Vector3(shedX, shedRoofY + shedRidgeH + 0.04, shedZ),
  );

  return group;
}

export function createBuildingMesh(kind: BuildingKind): THREE.Group {
  switch (kind) {
    case 'lumber_mill':
      return createLumberMillMesh();
    case 'reforester':
      return createReforesterHutMesh();
    case 'stone_quarry':
      return createStoneQuarryMesh();
    default: {
      const unreachable: never = kind;
      return unreachable;
    }
  }
}
