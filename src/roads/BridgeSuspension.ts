import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { prepareBuildingGeometryUvs } from '../buildings/buildingMetricUvs.ts';
import type { BridgeSpan } from './RiverBridgeSpans.ts';

/**
 * Dimensions are grouped by the visual role they control. The complete
 * suspension assembly is derived from the sampled road path; no part receives
 * an independent late-positioning offset.
 */
export const BRIDGE_SUSPENSION_STYLE = {
  silhouette: {
    towerHeight: 3.05,
    towerEmbedDepth: 0.22,
    towerPostWidth: 0.3,
    towerPostDepth: 0.34,
    towerCrossbeamHeight: 2.62,
    towerCrossbeamThickness: 0.24,
    towerCrossbeamDepth: 0.3,
    towerCapWidth: 0.38,
    towerCapHeight: 0.1,
    anchorPostHeight: 0.82,
    anchorPostWidth: 0.3,
  },
  cables: {
    attachmentHeight: 2.86,
    mainRadius: 0.055,
    backstayRadius: 0.048,
    suspenderRadius: 0.032,
    suspenderDeckHeight: 0.94,
    minimumSag: 0.58,
    sagPerMeter: 0.24,
    minimumCableClearance: 1.3,
    radialSegments: 6,
  },
  placement: {
    towerEdgeInset: 0.23,
    middleTowerMinimumSpan: 11,
    anchorBackset: 4.6,
    minimumAnchorBackset: 0.8,
    hangerSpacing: 1.55,
    cableSampleSpacing: 0.62,
  },
} as const;

export const BRIDGE_SUSPENSION_DEBUG_MODES = [
  'final',
  'towers',
  'mainCables',
  'backstays',
  'anchorages',
  'suspenders',
] as const;

export type BridgeSuspensionDebugMode = (
  typeof BRIDGE_SUSPENSION_DEBUG_MODES[number]
);

type SuspensionPart = Exclude<BridgeSuspensionDebugMode, 'final'>;

type PathFrame = {
  point: THREE.Vector3;
  tangent: THREE.Vector3;
  normal: THREE.Vector3;
};

type TowerStation = {
  distance: number;
  frame: PathFrame;
};

type SpanPlan = {
  span: BridgeSpan;
  towers: TowerStation[];
};

const LOCAL_BOX_AXIS = new THREE.Vector3(0, 0, 1);
const LOCAL_CYLINDER_AXIS = new THREE.Vector3(0, 1, 0);

/**
 * Adds the visible load path missing from the deck-only bridge: paired timber
 * towers, a main cable on each side, vertical suspenders, and bank backstays
 * terminating at paired anchor posts.
 */
export function buildBridgeSuspensionStructure(
  path: readonly THREE.Vector3[],
  width: number,
  spans: readonly BridgeSpan[],
  timberMaterial: THREE.Material,
  cableMaterial: THREE.Material = timberMaterial,
): THREE.Group | null {
  if (path.length < 2 || spans.length === 0 || width <= 0) return null;

  const distances = cumulativeDistances(path);
  const totalLength = distances[distances.length - 1] ?? 0;
  if (totalLength <= 1e-6) return null;

  const halfTowerWidth = Math.max(
    BRIDGE_SUSPENSION_STYLE.silhouette.towerPostWidth * 0.75,
    width * 0.5 - BRIDGE_SUSPENSION_STYLE.placement.towerEdgeInset,
  );
  const plans = spans
    .map((span) => createSpanPlan(path, distances, totalLength, span))
    .filter((plan): plan is SpanPlan => plan !== null);
  if (plans.length === 0) return null;

  const group = new THREE.Group();
  group.name = 'Bridge suspension structure';
  group.userData.fpNoCollision = true;

  const towers = createPartGroup('Bridge suspension towers', 'towers');
  const mainCables = createPartGroup('Bridge main suspension cables', 'mainCables');
  const backstays = createPartGroup('Bridge suspension backstays', 'backstays');
  const anchorages = createPartGroup('Bridge suspension anchorages', 'anchorages');
  const suspenders = createPartGroup('Bridge suspension hangers', 'suspenders');

  const towerPostMatrices: THREE.Matrix4[] = [];
  const towerCrossbeamMatrices: THREE.Matrix4[] = [];
  const towerCapMatrices: THREE.Matrix4[] = [];
  const anchorPostMatrices: THREE.Matrix4[] = [];
  const suspenderMatrices: THREE.Matrix4[] = [];
  const mainCableGeometries: THREE.BufferGeometry[] = [];
  const backstayGeometries: THREE.BufferGeometry[] = [];
  let cableBayCount = 0;

  for (const plan of plans) {
    for (const tower of plan.towers) {
      addTowerMatrices(
        tower,
        halfTowerWidth,
        towerPostMatrices,
        towerCrossbeamMatrices,
        towerCapMatrices,
      );
    }

    for (let towerIndex = 0; towerIndex < plan.towers.length - 1; towerIndex += 1) {
      const start = plan.towers[towerIndex];
      const end = plan.towers[towerIndex + 1];
      const bayLength = end.distance - start.distance;
      if (bayLength <= 1e-6) continue;
      cableBayCount += 1;

      for (const side of [-1, 1] as const) {
        const cablePoints = createMainCablePoints(
          path,
          distances,
          start.distance,
          end.distance,
          halfTowerWidth * side,
        );
        const cableGeometry = createCableTube(
          cablePoints,
          BRIDGE_SUSPENSION_STYLE.cables.mainRadius,
        );
        if (cableGeometry) mainCableGeometries.push(cableGeometry);

        addSuspenderMatrices(
          path,
          distances,
          start.distance,
          end.distance,
          halfTowerWidth * side,
          suspenderMatrices,
        );
      }
    }

    addEndAnchorage(
      path,
      distances,
      plan.span.rampStart,
      plan.towers[0],
      -1,
      halfTowerWidth,
      anchorPostMatrices,
      backstayGeometries,
    );
    addEndAnchorage(
      path,
      distances,
      plan.span.rampEnd,
      plan.towers[plan.towers.length - 1],
      1,
      halfTowerWidth,
      anchorPostMatrices,
      backstayGeometries,
    );
  }

  addInstancedBoxes(
    towers,
    'Bridge suspension tower posts',
    timberMaterial,
    towerPostMatrices,
  );
  addInstancedBoxes(
    towers,
    'Bridge suspension tower crossbeams',
    timberMaterial,
    towerCrossbeamMatrices,
  );
  addInstancedBoxes(
    towers,
    'Bridge suspension tower caps',
    timberMaterial,
    towerCapMatrices,
  );
  addMergedCableMesh(
    mainCables,
    'Bridge main suspension cable tubes',
    cableMaterial,
    mainCableGeometries,
  );
  addMergedCableMesh(
    backstays,
    'Bridge suspension backstay tubes',
    cableMaterial,
    backstayGeometries,
  );
  addInstancedBoxes(
    anchorages,
    'Bridge suspension anchor posts',
    timberMaterial,
    anchorPostMatrices,
  );
  addInstancedCylinders(
    suspenders,
    'Bridge suspension vertical hangers',
    cableMaterial,
    suspenderMatrices,
  );

  for (const part of [towers, mainCables, backstays, anchorages, suspenders]) {
    if (part.children.length > 0) group.add(part);
  }
  if (group.children.length === 0) return null;

  const geometry = collectGeometryStats(group);
  group.userData.bridgeSuspension = {
    version: 1,
    deterministicInput: 'sampled-path-and-bridge-spans',
    debugMode: 'final' satisfies BridgeSuspensionDebugMode,
    debugModes: [...BRIDGE_SUSPENSION_DEBUG_MODES],
    style: BRIDGE_SUSPENSION_STYLE,
    spanCount: plans.length,
    towerStationCount: plans.reduce((total, plan) => total + plan.towers.length, 0),
    cableBayCount,
    mainCableCount: mainCableGeometries.length,
    backstayCount: backstayGeometries.length,
    anchorageCount: anchorPostMatrices.length,
    suspenderCount: suspenderMatrices.length,
    geometry,
  };
  return group;
}

/** Shows one semantic load-path component while retaining a final composite. */
export function setBridgeSuspensionDebugMode(
  group: THREE.Group,
  mode: BridgeSuspensionDebugMode,
): void {
  for (const child of group.children) {
    const part = child.userData.bridgeSuspensionPart as SuspensionPart | undefined;
    child.visible = mode === 'final' || part === mode;
  }
  const evidence = group.userData.bridgeSuspension as { debugMode?: string } | undefined;
  if (evidence) evidence.debugMode = mode;
}

function createSpanPlan(
  path: readonly THREE.Vector3[],
  distances: readonly number[],
  totalLength: number,
  span: BridgeSpan,
): SpanPlan | null {
  const deckStart = THREE.MathUtils.clamp(span.deckStart, 0, totalLength);
  const deckEnd = THREE.MathUtils.clamp(span.deckEnd, deckStart, totalLength);
  const deckLength = deckEnd - deckStart;
  if (deckLength <= 1e-6) return null;

  const stationDistances = deckLength
    >= BRIDGE_SUSPENSION_STYLE.placement.middleTowerMinimumSpan
    ? [deckStart, (deckStart + deckEnd) * 0.5, deckEnd]
    : [deckStart, deckEnd];
  const towers = stationDistances
    .map((distance) => {
      const frame = samplePathFrame(path, distances, distance);
      return frame ? { distance, frame } : null;
    })
    .filter((station): station is TowerStation => station !== null);
  if (towers.length < 2) return null;
  return { span, towers };
}

function addTowerMatrices(
  station: TowerStation,
  sideOffset: number,
  postMatrices: THREE.Matrix4[],
  crossbeamMatrices: THREE.Matrix4[],
  capMatrices: THREE.Matrix4[],
): void {
  const { silhouette } = BRIDGE_SUSPENSION_STYLE;
  const postHeight = silhouette.towerHeight + silhouette.towerEmbedDepth;
  for (const side of [-1, 1] as const) {
    const position = sidePoint(station.frame, sideOffset * side);
    position.y += (silhouette.towerHeight - silhouette.towerEmbedDepth) * 0.5;
    postMatrices.push(composeBoxMatrix(
      position,
      new THREE.Quaternion(),
      new THREE.Vector3(
        silhouette.towerPostWidth,
        postHeight,
        silhouette.towerPostDepth,
      ),
    ));

    position.y = station.frame.point.y
      + silhouette.towerHeight
      + silhouette.towerCapHeight * 0.35;
    capMatrices.push(composeBoxMatrix(
      position,
      new THREE.Quaternion(),
      new THREE.Vector3(
        silhouette.towerCapWidth,
        silhouette.towerCapHeight,
        silhouette.towerCapWidth,
      ),
    ));
  }

  const crossbeamStart = sidePoint(station.frame, -sideOffset - 0.12);
  const crossbeamEnd = sidePoint(station.frame, sideOffset + 0.12);
  crossbeamStart.y = station.frame.point.y + silhouette.towerCrossbeamHeight;
  crossbeamEnd.y = crossbeamStart.y;
  crossbeamMatrices.push(composeBoxBetween(
    crossbeamStart,
    crossbeamEnd,
    silhouette.towerCrossbeamDepth,
    silhouette.towerCrossbeamThickness,
  ));
}

function createMainCablePoints(
  path: readonly THREE.Vector3[],
  distances: readonly number[],
  startDistance: number,
  endDistance: number,
  sideOffset: number,
): THREE.Vector3[] {
  const { cables, placement } = BRIDGE_SUSPENSION_STYLE;
  const bayLength = endDistance - startDistance;
  const sampleCount = THREE.MathUtils.clamp(
    Math.ceil(bayLength / placement.cableSampleSpacing),
    6,
    56,
  );
  const maximumSag = Math.max(
    0,
    cables.attachmentHeight - cables.minimumCableClearance,
  );
  const sag = Math.min(
    maximumSag,
    Math.max(cables.minimumSag, bayLength * cables.sagPerMeter),
  );
  const points: THREE.Vector3[] = [];

  for (let sampleIndex = 0; sampleIndex <= sampleCount; sampleIndex += 1) {
    const t = sampleIndex / sampleCount;
    const frame = samplePathFrame(
      path,
      distances,
      THREE.MathUtils.lerp(startDistance, endDistance, t),
    );
    if (!frame) continue;
    const point = sidePoint(frame, sideOffset);
    point.y = frame.point.y
      + cables.attachmentHeight
      - sag * 4 * t * (1 - t);
    points.push(point);
  }
  return points;
}

function addSuspenderMatrices(
  path: readonly THREE.Vector3[],
  distances: readonly number[],
  startDistance: number,
  endDistance: number,
  sideOffset: number,
  matrices: THREE.Matrix4[],
): void {
  const { cables, placement } = BRIDGE_SUSPENSION_STYLE;
  const bayLength = endDistance - startDistance;
  const intervalCount = Math.max(2, Math.ceil(bayLength / placement.hangerSpacing));
  const maximumSag = Math.max(
    0,
    cables.attachmentHeight - cables.minimumCableClearance,
  );
  const sag = Math.min(
    maximumSag,
    Math.max(cables.minimumSag, bayLength * cables.sagPerMeter),
  );

  for (let intervalIndex = 1; intervalIndex < intervalCount; intervalIndex += 1) {
    const t = intervalIndex / intervalCount;
    const frame = samplePathFrame(
      path,
      distances,
      THREE.MathUtils.lerp(startDistance, endDistance, t),
    );
    if (!frame) continue;
    const top = sidePoint(frame, sideOffset);
    top.y = frame.point.y
      + cables.attachmentHeight
      - sag * 4 * t * (1 - t);
    const bottom = sidePoint(frame, sideOffset);
    bottom.y = frame.point.y + cables.suspenderDeckHeight;
    if (top.y - bottom.y <= cables.suspenderRadius * 2) continue;
    matrices.push(composeCylinderBetween(bottom, top));
  }
}

function addEndAnchorage(
  path: readonly THREE.Vector3[],
  distances: readonly number[],
  rampBoundary: number,
  tower: TowerStation,
  direction: -1 | 1,
  sideOffset: number,
  anchorMatrices: THREE.Matrix4[],
  backstayGeometries: THREE.BufferGeometry[],
): void {
  const { silhouette, cables, placement } = BRIDGE_SUSPENSION_STYLE;
  const availableBackset = Math.abs(tower.distance - rampBoundary);
  const backset = Math.min(placement.anchorBackset, availableBackset * 0.82);
  if (backset < placement.minimumAnchorBackset) return;
  const anchorDistance = tower.distance + direction * backset;
  const anchorFrame = samplePathFrame(path, distances, anchorDistance);
  if (!anchorFrame) return;

  for (const side of [-1, 1] as const) {
    const anchor = sidePoint(anchorFrame, sideOffset * side);
    anchor.y += silhouette.anchorPostHeight * 0.5 - 0.1;
    anchorMatrices.push(composeBoxMatrix(
      anchor,
      new THREE.Quaternion(),
      new THREE.Vector3(
        silhouette.anchorPostWidth,
        silhouette.anchorPostHeight + 0.2,
        silhouette.anchorPostWidth,
      ),
    ));

    const anchorTop = sidePoint(anchorFrame, sideOffset * side);
    anchorTop.y += silhouette.anchorPostHeight * 0.78;
    const towerTop = sidePoint(tower.frame, sideOffset * side);
    towerTop.y += cables.attachmentHeight;
    const geometry = createCableTube(
      [towerTop, anchorTop],
      cables.backstayRadius,
    );
    if (geometry) backstayGeometries.push(geometry);
  }
}

function createPartGroup(name: string, part: SuspensionPart): THREE.Group {
  const group = new THREE.Group();
  group.name = name;
  group.userData.bridgeSuspensionPart = part;
  group.userData.fpNoCollision = true;
  return group;
}

function addInstancedBoxes(
  parent: THREE.Group,
  name: string,
  material: THREE.Material,
  matrices: readonly THREE.Matrix4[],
): void {
  if (matrices.length === 0) return;
  const mesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    material,
    matrices.length,
  );
  mesh.name = name;
  matrices.forEach((matrix, index) => mesh.setMatrixAt(index, matrix));
  mesh.instanceMatrix.needsUpdate = true;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
}

function addInstancedCylinders(
  parent: THREE.Group,
  name: string,
  material: THREE.Material,
  matrices: readonly THREE.Matrix4[],
): void {
  if (matrices.length === 0) return;
  const radius = BRIDGE_SUSPENSION_STYLE.cables.suspenderRadius;
  const mesh = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(
      radius,
      radius,
      1,
      BRIDGE_SUSPENSION_STYLE.cables.radialSegments,
    ),
    material,
    matrices.length,
  );
  mesh.name = name;
  matrices.forEach((matrix, index) => mesh.setMatrixAt(index, matrix));
  mesh.instanceMatrix.needsUpdate = true;
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  parent.add(mesh);
}

function addMergedCableMesh(
  parent: THREE.Group,
  name: string,
  material: THREE.Material,
  geometries: THREE.BufferGeometry[],
): void {
  if (geometries.length === 0) return;
  const geometry = mergeCableGeometries(geometries);
  if (!geometry) return;
  const mesh = new THREE.Mesh(
    prepareBuildingGeometryUvs(geometry, material),
    material,
  );
  mesh.name = name;
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  parent.add(mesh);
}

function mergeCableGeometries(
  geometries: THREE.BufferGeometry[],
): THREE.BufferGeometry | null {
  if (geometries.length === 1) return geometries[0];
  const merged = mergeGeometries(geometries, false);
  if (!merged) {
    for (const geometry of geometries) geometry.dispose();
    return null;
  }
  for (const geometry of geometries) geometry.dispose();
  return merged;
}

function createCableTube(
  points: readonly THREE.Vector3[],
  radius: number,
): THREE.BufferGeometry | null {
  if (points.length < 2) return null;
  const curve = points.length === 2
    ? new THREE.LineCurve3(points[0], points[1])
    : new THREE.CatmullRomCurve3([...points], false, 'centripetal');
  return new THREE.TubeGeometry(
    curve,
    Math.max(4, points.length - 1),
    radius,
    BRIDGE_SUSPENSION_STYLE.cables.radialSegments,
    false,
  );
}

function composeBoxBetween(
  start: THREE.Vector3,
  end: THREE.Vector3,
  width: number,
  height: number,
): THREE.Matrix4 {
  const direction = end.clone().sub(start);
  const length = direction.length();
  const quaternion = new THREE.Quaternion();
  if (length > 1e-6) {
    quaternion.setFromUnitVectors(LOCAL_BOX_AXIS, direction.multiplyScalar(1 / length));
  }
  return composeBoxMatrix(
    start.clone().add(end).multiplyScalar(0.5),
    quaternion,
    new THREE.Vector3(width, height, Math.max(length, 1e-6)),
  );
}

function composeCylinderBetween(
  start: THREE.Vector3,
  end: THREE.Vector3,
): THREE.Matrix4 {
  const direction = end.clone().sub(start);
  const length = direction.length();
  const quaternion = new THREE.Quaternion();
  if (length > 1e-6) {
    quaternion.setFromUnitVectors(
      LOCAL_CYLINDER_AXIS,
      direction.multiplyScalar(1 / length),
    );
  }
  return new THREE.Matrix4().compose(
    start.clone().add(end).multiplyScalar(0.5),
    quaternion,
    new THREE.Vector3(1, Math.max(length, 1e-6), 1),
  );
}

function composeBoxMatrix(
  position: THREE.Vector3,
  quaternion: THREE.Quaternion,
  scale: THREE.Vector3,
): THREE.Matrix4 {
  return new THREE.Matrix4().compose(position, quaternion, scale);
}

function sidePoint(frame: PathFrame, sideOffset: number): THREE.Vector3 {
  return frame.point.clone().addScaledVector(frame.normal, sideOffset);
}

function samplePathFrame(
  path: readonly THREE.Vector3[],
  distances: readonly number[],
  requestedDistance: number,
): PathFrame | null {
  if (path.length < 2) return null;
  const totalLength = distances[distances.length - 1] ?? 0;
  const distance = THREE.MathUtils.clamp(requestedDistance, 0, totalLength);
  let segmentIndex = 0;
  while (
    segmentIndex < path.length - 2
    && distances[segmentIndex + 1] < distance
  ) {
    segmentIndex += 1;
  }
  const start = path[segmentIndex];
  const end = path[segmentIndex + 1];
  const startDistance = distances[segmentIndex];
  const endDistance = distances[segmentIndex + 1];
  const segmentLength = endDistance - startDistance;
  const t = segmentLength <= 1e-6
    ? 0
    : (distance - startDistance) / segmentLength;
  const tangent = new THREE.Vector3(end.x - start.x, 0, end.z - start.z);
  if (tangent.lengthSq() <= 1e-12) tangent.set(1, 0, 0);
  else tangent.normalize();
  return {
    point: start.clone().lerp(end, t),
    tangent,
    normal: new THREE.Vector3(-tangent.z, 0, tangent.x),
  };
}

function cumulativeDistances(path: readonly THREE.Vector3[]): number[] {
  const distances = [0];
  for (let index = 1; index < path.length; index += 1) {
    distances.push(
      distances[index - 1]
      + Math.hypot(
        path[index].x - path[index - 1].x,
        path[index].z - path[index - 1].z,
      ),
    );
  }
  return distances;
}

function collectGeometryStats(group: THREE.Group): {
  drawCalls: number;
  triangles: number;
  instances: number;
} {
  let drawCalls = 0;
  let triangles = 0;
  let instances = 0;
  group.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    drawCalls += 1;
    const geometry = mesh.geometry;
    const baseTriangles = geometry.index
      ? geometry.index.count / 3
      : (geometry.getAttribute('position')?.count ?? 0) / 3;
    const instanceCount = (mesh as THREE.InstancedMesh).isInstancedMesh
      ? (mesh as THREE.InstancedMesh).count
      : 1;
    triangles += baseTriangles * instanceCount;
    instances += instanceCount;
  });
  return {
    drawCalls,
    triangles: Math.round(triangles),
    instances,
  };
}
