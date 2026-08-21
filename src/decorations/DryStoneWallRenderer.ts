import * as THREE from 'three';
import type { Terrain } from '../terrain/Terrain.ts';
import type { RoadNetwork } from '../roads/RoadNetwork.ts';
import {
  createDryStoneWallPlan,
  DRY_STONE_WALL_SEED,
  DRY_STONE_WALL_VARIANTS,
  type DryStonePlacement,
  type DryStoneWallDebugMode,
  type DryStoneWallPlan,
  type DryStoneWallState,
} from './DryStoneWall.ts';
import {
  createDryStoneWallMaterials,
  type DryStoneWallMaterialSet,
} from './DryStoneWallMaterial.ts';
import { isDryStoneWallStoneClearOfRoads } from './DryStoneWallRoadSnap.ts';

const MAX_PREVIEW_ANCHORS = 16;

type BuildBatch = {
  placements: DryStonePlacement[];
  wallIds: string[];
};

export class DryStoneWallRenderer {
  readonly group = new THREE.Group();
  readonly previewGroup = new THREE.Group();
  private readonly terrain: Terrain;
  private readonly materials: DryStoneWallMaterialSet;
  private readonly stoneGeometries: THREE.BufferGeometry[];
  private readonly previewStones = new THREE.Group();
  private readonly cursor: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private readonly anchorMarkers: THREE.InstancedMesh;
  private readonly anchorMatrix = new THREE.Matrix4();
  private readonly matrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly scale = new THREE.Vector3();
  private readonly rotation = new THREE.Quaternion();
  private readonly yAxis = new THREE.Vector3(0, 1, 0);
  private readonly color = new THREE.Color();
  private walls: DryStoneWallState[] = [];
  private roadNetwork: RoadNetwork | null = null;
  private signature = '';
  private previewSignature = '';
  private debugMode: DryStoneWallDebugMode = 'final';

  constructor(options: {
    terrain: Terrain;
    parent: THREE.Object3D;
    previewParent: THREE.Object3D;
  }) {
    this.terrain = options.terrain;
    this.materials = createDryStoneWallMaterials();
    this.stoneGeometries = Array.from(
      { length: DRY_STONE_WALL_VARIANTS },
      (_, variant) => createChippedStoneGeometry(variant),
    );
    this.group.name = 'Dry-stone wall decorations';
    this.previewGroup.name = 'Dry-stone wall placement preview';
    this.previewStones.name = 'Dry-stone wall preview stones';
    this.previewGroup.add(this.previewStones);

    this.cursor = new THREE.Mesh(
      new THREE.RingGeometry(0.56, 0.72, 28),
      new THREE.MeshBasicMaterial({
        color: 0xb9c99e,
        transparent: true,
        opacity: 0.96,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    this.cursor.name = 'Dry-stone wall roadside cursor';
    this.cursor.rotation.x = -Math.PI * 0.5;
    this.cursor.renderOrder = 34;
    this.cursor.visible = false;
    this.cursor.castShadow = false;
    this.cursor.receiveShadow = false;

    const anchorMaterial = new THREE.MeshBasicMaterial({
      color: 0xc7c0ac,
      depthWrite: false,
    });
    this.anchorMarkers = new THREE.InstancedMesh(
      new THREE.DodecahedronGeometry(0.31, 0),
      anchorMaterial,
      MAX_PREVIEW_ANCHORS,
    );
    this.anchorMarkers.name = 'Dry-stone wall spline anchors';
    this.anchorMarkers.count = 0;
    this.anchorMarkers.renderOrder = 33;
    this.anchorMarkers.castShadow = false;
    this.anchorMarkers.receiveShadow = false;
    this.previewGroup.add(this.cursor, this.anchorMarkers);

    options.parent.add(this.group);
    options.previewParent.add(this.previewGroup);
  }

  sync(walls: Iterable<DryStoneWallState>, roadNetwork: RoadNetwork | null = this.roadNetwork): void {
    this.roadNetwork = roadNetwork;
    const next = [...walls];
    const roadRevision = roadNetwork?.getTopologyRevision() ?? 0;
    const signature = `${this.debugMode}|r${roadRevision}|${next.map((wall) => `${wall.id}:${wall.revision}:${wall.seed}`).join('|')}`;
    if (signature === this.signature) return;
    this.signature = signature;
    this.walls = next;
    const plans = next.map((wall) => createDryStoneWallPlan(
      wall,
      this.terrain,
      'final',
      roadNetwork
        ? { stoneAllowed: (stone) => isDryStoneWallStoneClearOfRoads(roadNetwork, stone) }
        : undefined,
    ));
    this.rebuild(this.group, plans, this.materials.stone, false);
  }

  setDebugMode(mode: DryStoneWallDebugMode): void {
    if (this.debugMode === mode) return;
    this.debugMode = mode;
    this.signature = '';
    this.sync(this.walls);
  }

  getDebugMode(): DryStoneWallDebugMode {
    return this.debugMode;
  }

  updatePreview(
    path: readonly THREE.Vector3[],
    valid: boolean,
    anchors: readonly THREE.Vector3[],
  ): void {
    this.updateAnchors(anchors, valid);
    if (path.length < 2) {
      this.previewStones.clear();
      this.previewSignature = '';
      return;
    }
    const roadRevision = this.roadNetwork?.getTopologyRevision() ?? 0;
    const signature = `${valid ? 1 : 0}|r${roadRevision}|${path.map((point) => `${point.x.toFixed(1)},${point.z.toFixed(1)}`).join('|')}`;
    if (signature === this.previewSignature) return;
    this.previewSignature = signature;
    const state: DryStoneWallState = {
      id: 'preview',
      seed: DRY_STONE_WALL_SEED,
      controlPoints: path.map(vectorToTuple),
      sampledPath: path.map(vectorToTuple),
      length: pathLength(path),
      revision: 1,
    };
    const plan = createDryStoneWallPlan(
      state,
      this.terrain,
      'preview',
      this.roadNetwork
        ? { stoneAllowed: (stone) => isDryStoneWallStoneClearOfRoads(this.roadNetwork!, stone) }
        : undefined,
    );
    this.rebuild(
      this.previewStones,
      [plan],
      valid ? this.materials.previewValid : this.materials.previewInvalid,
      true,
    );
  }

  setPreviewCursor(point: THREE.Vector3 | null, validRoadsideStart = true): void {
    if (!point) {
      this.cursor.visible = false;
      return;
    }
    this.cursor.visible = true;
    this.cursor.position.set(point.x, point.y + 0.16, point.z);
    this.cursor.material.color.setHex(validRoadsideStart ? 0xb9c99e : 0xc84b43);
  }

  clearPreview(): void {
    this.previewStones.clear();
    this.previewSignature = '';
    this.anchorMarkers.count = 0;
    this.anchorMarkers.instanceMatrix.needsUpdate = true;
  }

  getPickMeshes(): THREE.Object3D[] {
    return [...this.group.children];
  }

  dispose(): void {
    this.group.removeFromParent();
    this.previewGroup.removeFromParent();
    this.group.clear();
    this.previewGroup.clear();
    for (const geometry of this.stoneGeometries) geometry.dispose();
    this.cursor.geometry.dispose();
    this.cursor.material.dispose();
    this.anchorMarkers.geometry.dispose();
    (this.anchorMarkers.material as THREE.Material).dispose();
    this.materials.dispose();
  }

  private rebuild(
    target: THREE.Group,
    plans: readonly DryStoneWallPlan[],
    stoneMaterial: THREE.Material,
    preview: boolean,
  ): void {
    target.clear();
    const batches: BuildBatch[] = Array.from(
      { length: DRY_STONE_WALL_VARIANTS },
      () => ({ placements: [], wallIds: [] }),
    );
    for (const plan of plans) {
      for (const stone of plan.stones) {
        batches[stone.variant].placements.push(stone);
        batches[stone.variant].wallIds.push(stone.wallId);
      }
    }

    let stoneCount = 0;
    let triangleCount = 0;
    let drawCalls = 0;
    for (let variant = 0; variant < batches.length; variant += 1) {
      const batch = batches[variant];
      if (batch.placements.length === 0) continue;
      const geometry = this.stoneGeometries[variant];
      const mesh = new THREE.InstancedMesh(geometry, stoneMaterial, batch.placements.length);
      mesh.name = preview
        ? `Dry-stone preview variant ${variant + 1}`
        : `Dry-stone wall variant ${variant + 1}`;
      mesh.castShadow = !preview;
      mesh.receiveShadow = true;
      mesh.renderOrder = preview ? 30 : 0;
      mesh.userData.dryStoneWallIds = batch.wallIds;
      for (let index = 0; index < batch.placements.length; index += 1) {
        const stone = batch.placements[index];
        this.composeStoneMatrix(stone);
        mesh.setMatrixAt(index, this.matrix);
        if (!preview) {
          this.resolveStoneColor(stone, variant, this.color);
          mesh.setColorAt(index, this.color);
        }
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      target.add(mesh);
      stoneCount += batch.placements.length;
      triangleCount += geometryTriangleCount(geometry) * batch.placements.length;
      drawCalls += 1;
    }

    target.userData.dryStoneWallDiagnostics = {
      seedManifest: plans.map((plan) => ({ id: plan.wallId, seed: plan.seed })),
      debugMode: this.debugMode,
      quality: preview ? 'preview' : 'final',
      wallCount: plans.length,
      stoneCount,
      omittedRoadOverlapCount: plans.reduce(
        (sum, plan) => sum + plan.diagnostics.omittedStoneCount,
        0,
      ),
      geometryVariantCount: DRY_STONE_WALL_VARIANTS,
      triangles: triangleCount,
      drawCalls,
      textureSet: 'dedicated-generated limestone PBR',
      invariants: [
        'two independently walked courses keep vertical joints staggered',
        'every stone is terrain seated and remains readable without post-processing',
        'road corridors omit overlapping stones without invalidating the spline',
        'wall layout and material microstructure are deterministic',
      ],
    };
  }

  private composeStoneMatrix(stone: DryStonePlacement): void {
    this.position.set(stone.x, stone.y, stone.z);
    this.rotation.setFromAxisAngle(this.yAxis, stone.yaw);
    this.scale.set(stone.width, stone.height, stone.depth);
    this.matrix.compose(this.position, this.rotation, this.scale);
  }

  private resolveStoneColor(
    stone: DryStonePlacement,
    variant: number,
    target: THREE.Color,
  ): THREE.Color {
    if (this.debugMode === 'courses') {
      return target.setHex(stone.course === 0 ? 0x6d8aa0 : 0xd5a45a);
    }
    if (this.debugMode === 'variants') {
      return target.setHSL(variant / DRY_STONE_WALL_VARIANTS, 0.52, 0.62);
    }
    const tone = stone.tone;
    return target.setRGB(tone, tone, tone);
  }

  private updateAnchors(points: readonly THREE.Vector3[], valid: boolean): void {
    const step = Math.max(1, Math.floor(points.length / MAX_PREVIEW_ANCHORS));
    let count = 0;
    const material = this.anchorMarkers.material as THREE.MeshBasicMaterial;
    material.color.setHex(valid ? 0xc7c0ac : 0xc84b43);
    for (let index = 0; index < points.length && count < MAX_PREVIEW_ANCHORS; index += step) {
      const point = points[index];
      this.anchorMatrix.identity();
      this.anchorMatrix.setPosition(point.x, point.y + 0.38, point.z);
      this.anchorMarkers.setMatrixAt(count, this.anchorMatrix);
      count += 1;
    }
    this.anchorMarkers.count = count;
    this.anchorMarkers.instanceMatrix.needsUpdate = count > 0;
  }
}

export function createChippedStoneGeometry(variant: number): THREE.BufferGeometry {
  const random = mulberry32(0xa511e9b3 ^ Math.imul(variant + 1, 0x9e3779b9));
  const baseFootprint = [
    [-0.39, -0.5], [0.38, -0.5], [0.5, -0.34], [0.5, 0.34],
    [0.38, 0.5], [-0.39, 0.5], [-0.5, 0.34], [-0.5, -0.34],
  ] as const;
  const footprint = baseFootprint.map(([x, z], index) => {
    const chip = index === variant % baseFootprint.length ? 0.78 : 1;
    return new THREE.Vector2(
      x * (0.91 + random() * 0.14) * chip + (random() - 0.5) * 0.025,
      z * (0.9 + random() * 0.16) * chip + (random() - 0.5) * 0.025,
    );
  });
  const ringHeights = [0, 0.085 + random() * 0.035, 0.79 + random() * 0.08, 1] as const;
  const ringScales = [0.8 + random() * 0.07, 1, 0.95 + random() * 0.055, 0.77 + random() * 0.1] as const;
  const rings = ringHeights.map((y, ringIndex) => footprint.map((point, pointIndex) => {
    const topWobble = ringIndex >= 2 ? (random() - 0.5) * 0.045 : 0;
    const asymmetricScale = ringScales[ringIndex] * (0.97 + random() * 0.06);
    return new THREE.Vector3(
      point.x * asymmetricScale + topWobble,
      y + (ringIndex === 3 ? (random() - 0.5) * 0.055 : 0),
      point.y * asymmetricScale + topWobble * (pointIndex % 2 === 0 ? 0.7 : -0.4),
    );
  }));

  const positions: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const uvOffset = variant * 0.173;
  for (let ring = 0; ring < rings.length - 1; ring += 1) {
    for (let side = 0; side < footprint.length; side += 1) {
      const next = (side + 1) % footprint.length;
      const a = rings[ring][side];
      const b = rings[ring][next];
      const c = rings[ring + 1][next];
      const d = rings[ring + 1][side];
      const desired = new THREE.Vector3(
        a.x + b.x + c.x + d.x,
        0,
        a.z + b.z + c.z + d.z,
      ).normalize();
      const u0 = uvOffset;
      const u1 = 1 + uvOffset;
      emitQuad(
        positions,
        uvs,
        colors,
        a, b, c, d,
        [u0, ringHeights[ring] * 1.35 + uvOffset],
        [u1, ringHeights[ring] * 1.35 + uvOffset],
        [u1, ringHeights[ring + 1] * 1.35 + uvOffset],
        [u0, ringHeights[ring + 1] * 1.35 + uvOffset],
        desired,
      );
    }
  }

  const topCenter = averageRing(rings[3]);
  const bottomCenter = averageRing(rings[0]);
  for (let side = 0; side < footprint.length; side += 1) {
    const next = (side + 1) % footprint.length;
    emitTriangle(
      positions,
      uvs,
      colors,
      topCenter,
      rings[3][side],
      rings[3][next],
      [0.5 + uvOffset, 0.5 + uvOffset],
      [rings[3][side].x + 0.5 + uvOffset, rings[3][side].z + 0.5 + uvOffset],
      [rings[3][next].x + 0.5 + uvOffset, rings[3][next].z + 0.5 + uvOffset],
      new THREE.Vector3(0, 1, 0),
    );
    emitTriangle(
      positions,
      uvs,
      colors,
      bottomCenter,
      rings[0][next],
      rings[0][side],
      [0.5 + uvOffset, 0.5 + uvOffset],
      [rings[0][next].x + 0.5 + uvOffset, rings[0][next].z + 0.5 + uvOffset],
      [rings[0][side].x + 0.5 + uvOffset, rings[0][side].z + 0.5 + uvOffset],
      new THREE.Vector3(0, -1, 0),
    );
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.name = `Chipped dry-stone variant ${variant + 1}`;
  geometry.userData.semanticDimensions = { length: 1, height: 1, depth: 1 };
  geometry.userData.triangleCount = positions.length / 9;
  return geometry;
}

function emitQuad(
  positions: number[],
  uvs: number[],
  colors: number[],
  a: THREE.Vector3,
  b: THREE.Vector3,
  c: THREE.Vector3,
  d: THREE.Vector3,
  uvA: readonly [number, number],
  uvB: readonly [number, number],
  uvC: readonly [number, number],
  uvD: readonly [number, number],
  desiredNormal: THREE.Vector3,
): void {
  emitTriangle(positions, uvs, colors, a, b, c, uvA, uvB, uvC, desiredNormal);
  emitTriangle(positions, uvs, colors, a, c, d, uvA, uvC, uvD, desiredNormal);
}

function emitTriangle(
  positions: number[],
  uvs: number[],
  colors: number[],
  a: THREE.Vector3,
  b: THREE.Vector3,
  c: THREE.Vector3,
  uvA: readonly [number, number],
  uvB: readonly [number, number],
  uvC: readonly [number, number],
  desiredNormal: THREE.Vector3,
): void {
  const normal = new THREE.Vector3().subVectors(b, a)
    .cross(new THREE.Vector3().subVectors(c, a));
  const flipped = normal.dot(desiredNormal) < 0;
  const vertices = flipped ? [a, c, b] : [a, b, c];
  const triangleUvs = flipped ? [uvA, uvC, uvB] : [uvA, uvB, uvC];
  for (let index = 0; index < 3; index += 1) {
    const vertex = vertices[index];
    const uv = triangleUvs[index];
    positions.push(vertex.x, vertex.y, vertex.z);
    uvs.push(uv[0], uv[1]);
    const dampBase = THREE.MathUtils.smoothstep(vertex.y, 0, 0.28);
    const topLight = THREE.MathUtils.smoothstep(vertex.y, 0.72, 1);
    const value = 0.78 + topLight * 0.2 - dampBase * 0.09;
    colors.push(value * 0.98, value, value * 0.94);
  }
}

function averageRing(ring: readonly THREE.Vector3[]): THREE.Vector3 {
  const center = new THREE.Vector3();
  for (const point of ring) center.add(point);
  return center.multiplyScalar(1 / ring.length);
}

function geometryTriangleCount(geometry: THREE.BufferGeometry): number {
  return geometry.index
    ? geometry.index.count / 3
    : (geometry.getAttribute('position')?.count ?? 0) / 3;
}

function pathLength(path: readonly THREE.Vector3[]): number {
  let length = 0;
  for (let index = 1; index < path.length; index += 1) {
    length += Math.hypot(path[index].x - path[index - 1].x, path[index].z - path[index - 1].z);
  }
  return length;
}

function vectorToTuple(vector: THREE.Vector3): [number, number, number] {
  return [vector.x, vector.y, vector.z];
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
