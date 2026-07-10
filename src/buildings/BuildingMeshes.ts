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

/** Long timber sawmill — white stone plinth, plank walls, red terracotta tile roof. */
export function createLumberMillMesh(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Lumber mill';

  const length = 16;
  const width = 6.2;
  const stoneHeight = 1.15;
  const wallHeight = 3.35;
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

  // Red terracotta tile roof — gabled, runs along the long axis.
  const roofPitch = Math.atan2(2.15, halfW);
  const slopeLength = halfW / Math.cos(roofPitch) + 0.35;
  const roofY = stoneHeight + wallHeight;

  for (const side of [-1, 1] as const) {
    addMesh(
      group,
      new THREE.BoxGeometry(length + 0.7, 0.14, slopeLength),
      tileMaterial(0),
      new THREE.Vector3(0, roofY + halfW * Math.tan(roofPitch) * 0.5, side * halfW * 0.42),
      new THREE.Euler(side > 0 ? -roofPitch : roofPitch, 0, 0),
    );
  }

  // Ridge cap tiles.
  addMesh(
    group,
    new THREE.BoxGeometry(length + 0.85, 0.22, 0.38),
    tileMaterial(2),
    new THREE.Vector3(0, roofY + 2.15 + 0.08, 0),
  );

  // Tile courses — subtle strips along both roof slopes.
  const tileStripCount = 7;
  for (let i = 0; i < tileStripCount; i++) {
    const t = i / (tileStripCount - 1);
    const stripY = roofY + 0.12 + t * 2.05;
    const stripZ = halfW * 0.38 * (1 - t * 0.55);
    const variant = (i % 3) as 0 | 1 | 2;
    for (const side of [-1, 1] as const) {
      addMesh(
        group,
        new THREE.BoxGeometry(length + 0.5, 0.06, 0.28),
        tileMaterial(variant),
        new THREE.Vector3(0, stripY, side * stripZ),
        new THREE.Euler(side > 0 ? -roofPitch * 0.92 : roofPitch * 0.92, 0, 0),
      );
    }
  }

  // Gable end tile fills.
  for (const xSign of [-1, 1] as const) {
    addMesh(
      group,
      new THREE.BoxGeometry(0.18, 2.1, width * 0.92),
      tileMaterial(1),
      new THREE.Vector3(xSign * (halfL + 0.08), roofY + 1.05, 0),
      new THREE.Euler(0, 0, xSign * 0.12),
    );
  }

  // Stone chimney — common in the region.
  addMesh(
    group,
    new THREE.BoxGeometry(0.85, 2.6, 0.85),
    stoneMaterial('mid'),
    new THREE.Vector3(-halfL + 1.4, totalWall + 1.25, halfW - 1.1),
  );
  addMesh(
    group,
    new THREE.BoxGeometry(0.95, 0.18, 0.95),
    stoneMaterial('light'),
    new THREE.Vector3(-halfL + 1.4, totalWall + 2.55, halfW - 1.1),
  );

  // Timber log stack beside the mill.
  for (let i = 0; i < 5; i++) {
    addMesh(
      group,
      new THREE.CylinderGeometry(0.22, 0.26, 2.8, 8),
      timberMaterial('weathered'),
      new THREE.Vector3(halfL - 2.2 - i * 0.08, stoneHeight + 0.55, halfW + 1.35),
      new THREE.Euler(0, 0, Math.PI * 0.5),
    );
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

/** Open-pit stone quarry — terraced cut blocks, timber hoist frame, stone ramp. */
export function createStoneQuarryMesh(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Stone quarry';

  const pitRadius = 5.5;
  const terraceCount = 3;

  // Terraced pit ring — cut stone benches stepping down.
  for (let tier = 0; tier < terraceCount; tier++) {
    const scale = 1 - tier * 0.22;
    const y = tier * 0.55;
    const inner = pitRadius * scale;
    addMesh(
      group,
      new THREE.CylinderGeometry(inner, inner + 0.85, 0.48, 10, 1, false),
      stoneMaterial(tier === 0 ? 'light' : 'mid'),
      new THREE.Vector3(0, y + 0.24, 0),
    );
  }

  // Central spoil heap.
  addMesh(
    group,
    new THREE.ConeGeometry(2.2, 1.6, 8),
    stoneMaterial('mortar'),
    new THREE.Vector3(0.8, 0.8, -0.6),
  );

  // Timber hoist frame over the pit edge.
  const frameX = pitRadius * 0.55;
  for (const z of [-1.8, 1.8] as const) {
    addMesh(
      group,
      new THREE.BoxGeometry(0.28, 4.2, 0.28),
      timberMaterial('dark'),
      new THREE.Vector3(frameX, 2.1, z),
    );
  }
  addMesh(
    group,
    new THREE.BoxGeometry(0.22, 0.22, 4.2),
    timberMaterial('weathered'),
    new THREE.Vector3(frameX, 4.05, 0),
  );
  addMesh(
    group,
    new THREE.BoxGeometry(0.14, 0.14, 3.6),
    timberMaterial('mid'),
    new THREE.Vector3(frameX - 0.35, 3.2, 0),
    new THREE.Euler(0, 0, 0.28),
  );

  // Cut stone blocks stacked beside ramp.
  for (let i = 0; i < 5; i++) {
    const bx = -pitRadius - 0.6 - (i % 2) * 0.4;
    const bz = -1.4 + i * 0.65;
    addMesh(
      group,
      new THREE.BoxGeometry(0.85, 0.55 + (i % 3) * 0.12, 0.75),
      stoneMaterial(i % 2 === 0 ? 'light' : 'mid'),
      new THREE.Vector3(bx, 0.28 + Math.floor(i / 2) * 0.5, bz),
    );
  }

  // Low stone office / tool shed on rim.
  addMesh(
    group,
    new THREE.BoxGeometry(2.8, 1.35, 2.2),
    stoneMaterial('light'),
    new THREE.Vector3(-pitRadius + 0.2, 0.68, pitRadius * 0.35),
  );
  addMesh(
    group,
    new THREE.BoxGeometry(3.0, 0.18, 2.35),
    tileMaterial(),
    new THREE.Vector3(-pitRadius + 0.2, 1.42, pitRadius * 0.35),
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
