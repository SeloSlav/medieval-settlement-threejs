import * as THREE from 'three';

export const BRIDGE_RAILING_START_BLEND = 0.018;
const BAY_SPACING_M = 2.25;
export const BRIDGE_RAILING_EDGE_INSET = 0.18;
const POST_HEIGHT_M = 1.18;
const POST_ANCHOR_DEPTH_M = 0.16;
const POST_WIDTH_M = 0.18;
const CAP_WIDTH_M = 0.24;
const CAP_HEIGHT_M = 0.09;
const RAIL_HEIGHTS_M = [0.43, 0.94] as const;
const RAIL_OVERLAP_M = 0.06;
const LOCAL_RAIL_AXIS = new THREE.Vector3(0, 0, 1);

export type BridgeRailingSection = {
  center: THREE.Vector3;
  leftDeck: THREE.Vector3;
  rightDeck: THREE.Vector3;
  bridgeBlend: number;
};

type RailingRun = {
  points: THREE.Vector3[];
};

export type BridgeRailingTrim = {
  start?: number;
  end?: number;
};

/**
 * Builds sturdy timber guard rails from short surface-following bays. Posts
 * remain upright while each rail pitches and turns between neighboring deck
 * samples, matching the terrain-deformed construction used by burgage fences.
 */
export function buildBridgeRailings(
  sections: readonly BridgeRailingSection[],
  material: THREE.Material,
  trim: BridgeRailingTrim = {},
): THREE.Group | null {
  const runs = collectRailingRuns(sections, trim);
  return buildRailingGroup(runs, material, {
    group: 'Bridge railings',
    posts: 'Bridge railing posts',
    rails: 'Bridge railing rails',
    caps: 'Bridge railing post caps',
  });
}

/** Builds guard rails around the exposed perimeter of a shared bridge hub. */
export function buildBridgeJunctionRailings(
  paths: readonly (readonly THREE.Vector3[])[],
  material: THREE.Material,
): THREE.Group | null {
  const runs = paths
    .map((path) => ({ points: resamplePolyline(path, BAY_SPACING_M) }))
    .filter((run) => run.points.length >= 2);
  return buildRailingGroup(runs, material, {
    group: 'Bridge junction railings',
    posts: 'Bridge junction railing posts',
    rails: 'Bridge junction railing rails',
    caps: 'Bridge junction railing post caps',
  });
}

function buildRailingGroup(
  runs: readonly RailingRun[],
  material: THREE.Material,
  names: { group: string; posts: string; rails: string; caps: string },
): THREE.Group | null {
  if (runs.length === 0) return null;

  const postCount = runs.reduce((total, run) => total + run.points.length, 0);
  const railCount = runs.reduce(
    (total, run) => total + Math.max(0, run.points.length - 1) * RAIL_HEIGHTS_M.length,
    0,
  );
  if (postCount === 0 || railCount === 0) return null;

  const group = new THREE.Group();
  group.name = names.group;
  group.userData.fpCollisionAllowStep = false;
  group.userData.railingRunCount = runs.length;

  const posts = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    material,
    postCount,
  );
  posts.name = names.posts;
  posts.castShadow = true;
  posts.receiveShadow = true;

  const rails = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    material,
    railCount,
  );
  rails.name = names.rails;
  rails.castShadow = true;
  rails.receiveShadow = true;

  const caps = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    material,
    postCount,
  );
  caps.name = names.caps;
  caps.userData.fpNoCollision = true;
  caps.castShadow = true;
  caps.receiveShadow = true;

  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const railStart = new THREE.Vector3();
  const railEnd = new THREE.Vector3();
  const railDirection = new THREE.Vector3();
  let postIndex = 0;
  let railIndex = 0;

  for (const run of runs) {
    for (const point of run.points) {
      quaternion.identity();
      position.set(
        point.x,
        point.y + (POST_HEIGHT_M - POST_ANCHOR_DEPTH_M) * 0.5,
        point.z,
      );
      scale.set(
        POST_WIDTH_M,
        POST_HEIGHT_M + POST_ANCHOR_DEPTH_M,
        POST_WIDTH_M,
      );
      matrix.compose(position, quaternion, scale);
      posts.setMatrixAt(postIndex, matrix);

      position.y = point.y + POST_HEIGHT_M + CAP_HEIGHT_M * 0.25;
      scale.set(CAP_WIDTH_M, CAP_HEIGHT_M, CAP_WIDTH_M);
      matrix.compose(position, quaternion, scale);
      caps.setMatrixAt(postIndex, matrix);
      postIndex += 1;
    }

    for (let bayIndex = 0; bayIndex < run.points.length - 1; bayIndex++) {
      const start = run.points[bayIndex];
      const end = run.points[bayIndex + 1];
      for (let heightIndex = 0; heightIndex < RAIL_HEIGHTS_M.length; heightIndex++) {
        const railHeight = RAIL_HEIGHTS_M[heightIndex];
        railStart.set(start.x, start.y + railHeight, start.z);
        railEnd.set(end.x, end.y + railHeight, end.z);
        railDirection.subVectors(railEnd, railStart);
        const railLength = railDirection.length();
        if (railLength <= 1e-6) continue;

        quaternion.setFromUnitVectors(
          LOCAL_RAIL_AXIS,
          railDirection.multiplyScalar(1 / railLength),
        );
        position.copy(railStart).add(railEnd).multiplyScalar(0.5);
        const isHandrail = heightIndex === RAIL_HEIGHTS_M.length - 1;
        scale.set(
          isHandrail ? 0.16 : 0.12,
          isHandrail ? 0.14 : 0.12,
          railLength + RAIL_OVERLAP_M,
        );
        matrix.compose(position, quaternion, scale);
        rails.setMatrixAt(railIndex, matrix);
        railIndex += 1;
      }
    }
  }

  posts.count = postIndex;
  rails.count = railIndex;
  caps.count = postIndex;
  posts.instanceMatrix.needsUpdate = true;
  rails.instanceMatrix.needsUpdate = true;
  caps.instanceMatrix.needsUpdate = true;
  group.add(posts, rails, caps);
  return group;
}

function collectRailingRuns(
  sections: readonly BridgeRailingSection[],
  trim: BridgeRailingTrim,
): RailingRun[] {
  const runs: RailingRun[] = [];
  let index = 0;

  while (index < sections.length) {
    if (sections[index].bridgeBlend <= BRIDGE_RAILING_START_BLEND) {
      index += 1;
      continue;
    }

    const activeStart = index;
    while (
      index < sections.length
      && sections[index].bridgeBlend > BRIDGE_RAILING_START_BLEND
    ) {
      index += 1;
    }
    const activeEnd = index - 1;
    const start = Math.max(0, activeStart - 1);
    const end = Math.min(sections.length - 1, activeEnd + 1);
    if (end <= start) continue;

    const activeSections = sections.slice(start, end + 1);
    for (const side of ['leftDeck', 'rightDeck'] as const) {
      let sidePath = activeSections.map((section) => (
        insetDeckEdge(section[side], section.center)
      ));
      sidePath = trimPolyline(
        sidePath,
        activeStart === 0 ? trim.start ?? 0 : 0,
        activeEnd === sections.length - 1 ? trim.end ?? 0 : 0,
      );
      const points = resamplePolyline(sidePath, BAY_SPACING_M);
      if (points.length >= 2) runs.push({ points });
    }
  }

  return runs;
}

function trimPolyline(
  path: readonly THREE.Vector3[],
  trimStart: number,
  trimEnd: number,
): THREE.Vector3[] {
  if (path.length < 2) return [];
  const distances = cumulativeDistances(path);
  const totalLength = distances[distances.length - 1];
  const start = THREE.MathUtils.clamp(trimStart, 0, totalLength);
  const end = THREE.MathUtils.clamp(totalLength - trimEnd, start, totalLength);
  if (end - start <= 1e-6) return [];

  const result = [samplePolylineAtDistance(path, distances, start)];
  for (let index = 1; index < path.length - 1; index++) {
    if (distances[index] > start && distances[index] < end) {
      result.push(path[index].clone());
    }
  }
  result.push(samplePolylineAtDistance(path, distances, end));
  return result;
}

function insetDeckEdge(
  deckEdge: THREE.Vector3,
  center: THREE.Vector3,
): THREE.Vector3 {
  const dx = center.x - deckEdge.x;
  const dz = center.z - deckEdge.z;
  const distance = Math.hypot(dx, dz);
  if (distance <= 1e-6) return deckEdge.clone();
  const inset = Math.min(BRIDGE_RAILING_EDGE_INSET, distance * 0.35);
  return new THREE.Vector3(
    deckEdge.x + dx / distance * inset,
    deckEdge.y,
    deckEdge.z + dz / distance * inset,
  );
}

function resamplePolyline(
  path: readonly THREE.Vector3[],
  targetSpacing: number,
): THREE.Vector3[] {
  if (path.length < 2) return [];

  const distances = cumulativeDistances(path);
  const totalLength = distances[distances.length - 1];
  if (totalLength <= 1e-6) return [];

  const bayCount = Math.max(1, Math.ceil(totalLength / targetSpacing));
  const result: THREE.Vector3[] = [];
  let segmentIndex = 0;
  for (let bayIndex = 0; bayIndex <= bayCount; bayIndex++) {
    const distance = totalLength * bayIndex / bayCount;
    while (
      segmentIndex < path.length - 2
      && distances[segmentIndex + 1] < distance
    ) {
      segmentIndex += 1;
    }
    result.push(samplePolylineAtDistance(path, distances, distance, segmentIndex));
  }
  return result;
}

function cumulativeDistances(path: readonly THREE.Vector3[]): number[] {
  const distances = [0];
  for (let index = 1; index < path.length; index++) {
    distances.push(distances[index - 1] + path[index].distanceTo(path[index - 1]));
  }
  return distances;
}

function samplePolylineAtDistance(
  path: readonly THREE.Vector3[],
  distances: readonly number[],
  distance: number,
  hint = 0,
): THREE.Vector3 {
  let segmentIndex = Math.min(hint, path.length - 2);
  while (
    segmentIndex < path.length - 2
    && distances[segmentIndex + 1] < distance
  ) {
    segmentIndex += 1;
  }
  const startDistance = distances[segmentIndex];
  const endDistance = distances[segmentIndex + 1];
  const t = endDistance <= startDistance
    ? 0
    : (distance - startDistance) / (endDistance - startDistance);
  return path[segmentIndex].clone().lerp(path[segmentIndex + 1], t);
}
