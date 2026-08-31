import * as THREE from 'three';
import { addMesh, timberMaterial } from '../buildingMaterials.ts';
import type { LeanToHighEdge } from './buildingMeshKit.ts';

export type LeanToSupportFrameOptions = {
  readonly namePrefix: string;
  readonly highEdge: LeanToHighEdge;
  readonly freestanding?: boolean;
  readonly groundY?: number;
  readonly postCount?: 2 | 3;
  readonly beamSize?: number;
  readonly postSize?: number;
  readonly endInset?: number;
};

type RoofEdge = {
  readonly coordinate: number;
  readonly undersideY: number;
};

/**
 * Adds the load path that an attached craft-yard roof needs to read as a
 * structure: a wall ledger at the high edge, a post-supported outer eave
 * beam, and (for a detached shelter) a second row of posts under the ledger.
 *
 * The support elevations are sampled from the authored roof vertices rather
 * than re-derived from nominal pitch. This keeps the beams touching the
 * actual procedural roof skin after thickness and UV-writer changes.
 */
export function addLeanToSupportFrame(
  group: THREE.Group,
  roof: THREE.Mesh,
  options: LeanToSupportFrameOptions,
): THREE.Group {
  const {
    namePrefix,
    highEdge,
    freestanding = false,
    groundY = 0,
    postCount = 2,
    beamSize = 0.18,
    postSize = 0.17,
    endInset = 0.34,
  } = options;
  const position = roof.geometry.getAttribute('position');
  if (!position || position.count === 0) {
    throw new Error(`${namePrefix} roof has no positions for structural support sampling.`);
  }
  roof.geometry.computeBoundingBox();
  const bounds = roof.geometry.boundingBox;
  if (!bounds) throw new Error(`${namePrefix} roof has no bounds for structural support sampling.`);

  const slopesAlongX = highEdge === 'negativeX' || highEdge === 'positiveX';
  const slopeAxis = slopesAlongX ? 'x' : 'z';
  const eaveAxis = slopesAlongX ? 'z' : 'x';
  const highCoordinate = highEdge === 'negativeX'
    ? bounds.min.x
    : highEdge === 'positiveX'
      ? bounds.max.x
      : highEdge === 'negativeZ'
        ? bounds.min.z
        : bounds.max.z;
  const lowCoordinate = highEdge === 'negativeX'
    ? bounds.max.x
    : highEdge === 'positiveX'
      ? bounds.min.x
      : highEdge === 'negativeZ'
        ? bounds.max.z
        : bounds.min.z;
  const high = sampleRoofEdge(position, slopeAxis, highCoordinate, bounds);
  const low = sampleRoofEdge(position, slopeAxis, lowCoordinate, bounds);
  // Centre the timber beneath the covering rather than outside its drip line.
  // Half of each beam still overlaps the sampled edge, preserving contact
  // while keeping support geometry inside the authored roof silhouette.
  const beamInset = beamSize * 0.46;
  const supportedHigh: RoofEdge = {
    ...high,
    coordinate: high.coordinate + Math.sign(low.coordinate - high.coordinate) * beamInset,
  };
  const supportedLow: RoofEdge = {
    ...low,
    coordinate: low.coordinate + Math.sign(high.coordinate - low.coordinate) * beamInset,
  };
  const eaveMin = eaveAxis === 'x' ? bounds.min.x : bounds.min.z;
  const eaveMax = eaveAxis === 'x' ? bounds.max.x : bounds.max.z;
  const eaveSpan = eaveMax - eaveMin;
  if (eaveSpan <= endInset * 2) {
    throw new Error(`${namePrefix} roof is too narrow for its authored support inset.`);
  }

  const frame = new THREE.Group();
  frame.name = `${namePrefix} connected support frame`;
  frame.userData.architectureRole = freestanding
    ? 'freestanding-roof-load-path'
    : 'wall-ledger-roof-load-path';
  group.add(frame);

  const ledger = addEaveBeam(
    frame,
    supportedHigh,
    eaveAxis,
    eaveMin,
    eaveSpan,
    beamSize,
    `${namePrefix} wall ledger`,
  );
  ledger.userData.architectureRole = 'roof-bearing-ledger';
  const eaveBeam = addEaveBeam(
    frame,
    supportedLow,
    eaveAxis,
    eaveMin,
    eaveSpan,
    beamSize,
    `${namePrefix} post-supported eave beam`,
  );
  eaveBeam.userData.architectureRole = 'roof-bearing-eave-beam';

  addPostRow(
    frame,
    supportedLow,
    eaveAxis,
    eaveMin,
    eaveMax,
    groundY,
    postCount,
    postSize,
    beamSize,
    endInset,
    `${namePrefix} outer roof-bearing post`,
  );
  if (freestanding) {
    addPostRow(
      frame,
      supportedHigh,
      eaveAxis,
      eaveMin,
      eaveMax,
      groundY,
      postCount,
      postSize,
      beamSize,
      endInset,
      `${namePrefix} inner roof-bearing post`,
    );
  }

  roof.userData.supportFrameName = frame.name;
  roof.userData.supportedRoof = true;
  return frame;
}

function sampleRoofEdge(
  position: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  slopeAxis: 'x' | 'z',
  coordinate: number,
  bounds: THREE.Box3,
): RoofEdge {
  const span = slopeAxis === 'x'
    ? bounds.max.x - bounds.min.x
    : bounds.max.z - bounds.min.z;
  const tolerance = Math.max(1e-4, span * 1e-4);
  let undersideY = Infinity;
  for (let index = 0; index < position.count; index += 1) {
    const sample = slopeAxis === 'x' ? position.getX(index) : position.getZ(index);
    if (Math.abs(sample - coordinate) > tolerance) continue;
    undersideY = Math.min(undersideY, position.getY(index));
  }
  if (!Number.isFinite(undersideY)) {
    throw new Error(`Roof edge at ${coordinate} could not be sampled.`);
  }
  return { coordinate, undersideY };
}

function addEaveBeam(
  group: THREE.Group,
  edge: RoofEdge,
  eaveAxis: 'x' | 'z',
  eaveMin: number,
  eaveSpan: number,
  beamSize: number,
  name: string,
): THREE.Mesh {
  const beam = addMesh(
    group,
    new THREE.BoxGeometry(
      eaveAxis === 'x' ? eaveSpan : beamSize,
      beamSize,
      eaveAxis === 'z' ? eaveSpan : beamSize,
    ),
    timberMaterial('dark'),
    new THREE.Vector3(
      eaveAxis === 'x' ? eaveMin + eaveSpan * 0.5 : edge.coordinate,
      edge.undersideY - beamSize * 0.48,
      eaveAxis === 'z' ? eaveMin + eaveSpan * 0.5 : edge.coordinate,
    ),
  );
  beam.name = name;
  return beam;
}

function addPostRow(
  group: THREE.Group,
  edge: RoofEdge,
  eaveAxis: 'x' | 'z',
  eaveMin: number,
  eaveMax: number,
  groundY: number,
  postCount: 2 | 3,
  postSize: number,
  beamSize: number,
  endInset: number,
  name: string,
): void {
  const beamBottom = edge.undersideY - beamSize + 0.015;
  const postHeight = beamBottom - groundY;
  if (postHeight <= 0.25) throw new Error(`${name} has no usable height.`);
  for (let index = 0; index < postCount; index += 1) {
    const alpha = postCount === 2 ? index : index * 0.5;
    const coordinate = THREE.MathUtils.lerp(eaveMin + endInset, eaveMax - endInset, alpha);
    const post = addMesh(
      group,
      new THREE.BoxGeometry(postSize, postHeight, postSize),
      timberMaterial(index % 2 === 0 ? 'dark' : 'mid'),
      new THREE.Vector3(
        eaveAxis === 'x' ? coordinate : edge.coordinate,
        groundY + postHeight * 0.5,
        eaveAxis === 'z' ? coordinate : edge.coordinate,
      ),
    );
    post.name = name;
    post.userData.architectureRole = 'roof-bearing-post';
  }
}
