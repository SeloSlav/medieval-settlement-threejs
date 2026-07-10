import * as THREE from 'three';
import type { BuildingKind } from '../resources/types.ts';
import {
  addMesh,
  mossMaterial,
  shingleMaterial,
  stoneMaterial,
  tileMaterial,
  timberMaterial,
} from './buildingMaterials.ts';

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

  // Red terracotta tile roof — ridge along the long axis, triangular gable ends.
  const ridgeHeight = 2.6;
  const roofPitch = Math.atan2(ridgeHeight, halfW);
  const slopeLength = halfW / Math.cos(roofPitch) + 0.3;
  const roofY = stoneHeight + wallHeight;

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
  const logRadius = 0.26;
  const logLength = 3.0;
  const logSpacing = logRadius * 1.72;
  const rowSpacing = logRadius * 1.82;
  const pileRows = 5;
  const pileX = halfL - 1.8;
  const pileZ = halfW + 1.6;

  for (let row = 0; row < pileRows; row++) {
    const logsInRow = pileRows - row;
    const rowY = logRadius + row * rowSpacing;
    const rowSpan = (logsInRow - 1) * logSpacing;
    for (let col = 0; col < logsInRow; col++) {
      addMesh(
        group,
        new THREE.CylinderGeometry(logRadius * 0.93, logRadius * 1.05, logLength, 8),
        (row + col) % 2 === 0 ? timberMaterial('weathered') : timberMaterial('mid'),
        new THREE.Vector3(pileX, rowY, pileZ - rowSpan * 0.5 + col * logSpacing),
        new THREE.Euler(0, 0, Math.PI * 0.5),
      );
    }
  }

  return group;
}

/** Small A-frame forester hut — stone knee wall, timber frame, mossy roof. */
export function createReforesterHutMesh(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Reforester hut';

  const width = 3.4;
  const depth = 3.1;
  const stoneHeight = 0.72;
  const halfW = width * 0.5;
  const halfD = depth * 0.5;
  const ridgeHeight = 2.85;
  const roofPitch = Math.atan2(ridgeHeight, halfW);
  const slopeLen = halfW / Math.cos(roofPitch) + 0.2;

  // Stone foundation pad.
  addMesh(
    group,
    new THREE.BoxGeometry(width + 0.5, 0.28, depth + 0.5),
    stoneMaterial('light'),
    new THREE.Vector3(0, 0.14, 0),
  );

  // White stone knee walls on three sides.
  addMesh(
    group,
    new THREE.BoxGeometry(width, stoneHeight, 0.28),
    stoneMaterial('mid'),
    new THREE.Vector3(0, stoneHeight * 0.5 + 0.28, -halfD + 0.14),
  );
  addMesh(
    group,
    new THREE.BoxGeometry(0.28, stoneHeight, depth - 0.2),
    stoneMaterial('mid'),
    new THREE.Vector3(-halfW + 0.14, stoneHeight * 0.5 + 0.28, 0.08),
  );
  addMesh(
    group,
    new THREE.BoxGeometry(0.28, stoneHeight, depth - 0.2),
    stoneMaterial('mid'),
    new THREE.Vector3(halfW - 0.14, stoneHeight * 0.5 + 0.28, 0.08),
  );

  const baseY = stoneHeight + 0.28;

  // Exposed A-frame timbers.
  for (const xSign of [-1, 1] as const) {
    addMesh(
      group,
      new THREE.BoxGeometry(0.14, ridgeHeight + 0.4, 0.14),
      timberMaterial('dark'),
      new THREE.Vector3(xSign * (halfW - 0.18), baseY + ridgeHeight * 0.48, -halfD + 0.22),
      new THREE.Euler(0, 0, xSign * -roofPitch),
    );
    addMesh(
      group,
      new THREE.BoxGeometry(0.14, ridgeHeight + 0.4, 0.14),
      timberMaterial('dark'),
      new THREE.Vector3(xSign * (halfW - 0.18), baseY + ridgeHeight * 0.48, halfD - 0.22),
      new THREE.Euler(0, 0, xSign * roofPitch),
    );
  }

  // Ridge beam.
  addMesh(
    group,
    new THREE.BoxGeometry(0.16, 0.16, depth + 0.15),
    timberMaterial('dark'),
    new THREE.Vector3(0, baseY + ridgeHeight, 0),
  );

  // Cross beam at front (open porch feel).
  addMesh(
    group,
    new THREE.BoxGeometry(width - 0.2, 0.12, 0.12),
    timberMaterial('mid'),
    new THREE.Vector3(0, baseY + 1.05, halfD - 0.12),
  );

  // Wooden shingle roof planes.
  for (const side of [-1, 1] as const) {
    addMesh(
      group,
      new THREE.BoxGeometry(slopeLen, 0.1, depth + 0.35),
      shingleMaterial(),
      new THREE.Vector3(side * halfW * 0.46, baseY + ridgeHeight * 0.48, 0),
      new THREE.Euler(0, 0, side * -roofPitch),
    );
  }

  // Moss and grass patches on the roof — typical of mountain huts in the region.
  const mossPatches = [
    { x: -0.35, z: -0.4, sx: 1.1, sz: 0.85, kind: 'moss' as const },
    { x: 0.45, z: 0.15, sx: 0.95, sz: 1.2, kind: 'grass' as const },
    { x: -0.15, z: 0.55, sx: 0.8, sz: 0.7, kind: 'moss' as const },
    { x: 0.6, z: -0.25, sx: 0.75, sz: 0.65, kind: 'grass' as const },
    { x: 0, z: 0, sx: 1.3, sz: 0.55, kind: 'moss' as const },
  ];

  for (const patch of mossPatches) {
    const side = patch.x >= 0 ? 1 : -1;
    const localY = baseY + ridgeHeight * 0.62 + patch.z * 0.25;
    const localX = patch.x * 0.55 + side * 0.25;
    addMesh(
      group,
      new THREE.BoxGeometry(patch.sx, 0.07, patch.sz),
      mossMaterial(patch.kind),
      new THREE.Vector3(localX, localY, patch.z * 0.35),
      new THREE.Euler(-roofPitch * 0.85 * side, patch.z * 0.15, 0),
    );
  }

  // Low timber door on front.
  addMesh(
    group,
    new THREE.BoxGeometry(0.85, 1.45, 0.08),
    timberMaterial('weathered'),
    new THREE.Vector3(0.15, baseY + 0.78, halfD - 0.04),
  );

  // Small stacked forestry tools — axe block.
  addMesh(
    group,
    new THREE.BoxGeometry(0.45, 0.38, 0.45),
    timberMaterial('dark'),
    new THREE.Vector3(halfW + 0.35, baseY + 0.19, halfD - 0.55),
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
