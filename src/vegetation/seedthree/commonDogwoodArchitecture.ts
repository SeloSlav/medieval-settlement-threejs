import * as THREE from 'three';
import { Rng } from '@seedthree/core/rng.js';
import type { CommonDogwoodArchitecture } from './commonDogwoodPreset.ts';

export type CommonDogwoodArchitectureStem = {
  terminal: boolean;
  points: THREE.Vector3[];
  orients: THREE.Quaternion[];
  children: CommonDogwoodArchitectureStem[];
  total: number;
};

export type CommonDogwoodArchitectureStats = {
  rootCount: number;
  rootBaseSpread: number;
  rootAzimuthGapCv: number;
  firstForkLengthRange: number;
  meanForkSiblingLengthRatio: number;
  crownCentroidOffsetRatio: number;
};

type BasalDescriptor = {
  azimuth: number;
  splay: number;
  origin: THREE.Vector3;
  firstForkLength: number;
  vigor: number;
};

const DEG_TO_RAD = Math.PI / 180;

/**
 * Breaks the dichotomous generator's radial stool and equal-child Y forks with
 * a deterministic, dogwood-only architecture pass. Topology is unchanged: the
 * same stems, leaf budget, wind weights, and triangle count survive intact.
 */
export function applyCommonDogwoodArchitecture(
  stems: CommonDogwoodArchitectureStem[],
  architecture: CommonDogwoodArchitecture,
  baseSplayDeg: number,
  seed: string,
): CommonDogwoodArchitectureStats {
  const roots = rootStems(stems);
  if (roots.length === 0) throw new Error('Common dogwood architecture requires basal stems');
  const rng = new Rng(`${seed}:architecture-v1`);
  const descriptors = createBasalDescriptors(
    roots.length,
    architecture,
    baseSplayDeg,
    rng,
  );

  for (let index = 0; index < roots.length; index++) {
    reshapeBasalStem(roots[index]!, descriptors[index]!);
  }
  for (const root of roots) {
    applyForkDominance(root, architecture, rng);
  }
  for (const stem of stems) stem.total = stemArcLength(stem);

  return measureArchitecture(stems, roots);
}

function createBasalDescriptors(
  count: number,
  architecture: CommonDogwoodArchitecture,
  baseSplayDeg: number,
  rng: Rng,
): BasalDescriptor[] {
  const vigorOrder = shuffledIndices(count, rng);
  const forkOrder = shuffledIndices(count, rng);
  const occupiedArc = (360 - architecture.lightGapDeg) * DEG_TO_RAD;
  const gapCenter = architecture.lightGapAzimuthDeg * DEG_TO_RAD;
  const occupiedStart = gapCenter + architecture.lightGapDeg * DEG_TO_RAD * 0.5;
  const leanAzimuth = gapCenter + Math.PI;
  const coherentLean = Math.tan(architecture.coherentLeanDeg * DEG_TO_RAD);
  const subordinateCount = Math.max(1, count - architecture.dominantLeaderCount);

  return Array.from({ length: count }, (_, index) => {
    const slotJitter = rng.vary(0, architecture.azimuthSlotJitter);
    const azimuth = occupiedStart
      + ((index + 0.5 + slotJitter) / count) * occupiedArc;
    const splay = THREE.MathUtils.clamp(
      (baseSplayDeg + rng.vary(0, architecture.splayVariationDeg)) * DEG_TO_RAD,
      3 * DEG_TO_RAD,
      42 * DEG_TO_RAD,
    );
    const radial = architecture.stoolRadius * Math.sqrt(rng.next());
    const originAzimuth = azimuth + rng.vary(0, Math.PI / Math.max(4, count));
    const origin = new THREE.Vector3(
      Math.cos(originAzimuth) * radial,
      0,
      Math.sin(originAzimuth) * radial,
    );

    const forkRank = forkOrder[index]!;
    const forkT = count === 1 ? 1 : forkRank / (count - 1);
    const firstForkLength = THREE.MathUtils.lerp(
      architecture.firstForkLength[0],
      architecture.firstForkLength[1],
      forkT,
    );

    const vigorRank = vigorOrder[index]!;
    const vigor = vigorRank < architecture.dominantLeaderCount
      ? 1
      : THREE.MathUtils.lerp(
        architecture.subordinateVigor[1],
        architecture.subordinateVigor[0],
        (vigorRank - architecture.dominantLeaderCount) / Math.max(1, subordinateCount - 1),
      );

    const outward = new THREE.Vector3(
      Math.cos(azimuth) * Math.sin(splay),
      Math.cos(splay),
      Math.sin(azimuth) * Math.sin(splay),
    );
    outward.add(new THREE.Vector3(
      Math.cos(leanAzimuth) * coherentLean * Math.sin(splay),
      0,
      Math.sin(leanAzimuth) * coherentLean * Math.sin(splay),
    )).normalize();

    return {
      azimuth: Math.atan2(outward.z, outward.x),
      splay: Math.acos(THREE.MathUtils.clamp(outward.y, -1, 1)),
      origin,
      firstForkLength,
      vigor,
    };
  });
}

function reshapeBasalStem(
  root: CommonDogwoodArchitectureStem,
  descriptor: BasalDescriptor,
): void {
  if (root.points.length < 2) return;
  const originalBase = root.points[0]!.clone();
  const originalDirection = root.points[1]!.clone().sub(originalBase).normalize();
  const desiredDirection = new THREE.Vector3(
    Math.cos(descriptor.azimuth) * Math.sin(descriptor.splay),
    Math.cos(descriptor.splay),
    Math.sin(descriptor.azimuth) * Math.sin(descriptor.splay),
  ).normalize();
  // Yaw the whole crown into its irregular angular slot without pitching a
  // two-metre subtree outward. Splay variation belongs to the basal cane: its
  // children translate with the altered fork but retain their upright habit.
  const originalAzimuth = Math.atan2(originalDirection.z, originalDirection.x);
  const yaw = shortestSignedAngle(descriptor.azimuth - originalAzimuth);
  const yawRotation = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 1, 0),
    yaw,
  );
  rotateSubtree(root, originalBase, yawRotation);
  const yawedDirection = root.points[1]!.clone().sub(root.points[0]!).normalize();
  const basalRotation = new THREE.Quaternion().setFromUnitVectors(
    yawedDirection,
    desiredDirection,
  );
  const previousFork = root.points.at(-1)!.clone();
  rotateStem(root, originalBase, basalRotation);

  const base = root.points[0]!.clone();
  const rootLength = Math.max(0.001, stemArcLength(root));
  const rootScale = descriptor.firstForkLength / rootLength;
  scaleStemPoints(root, base, rootScale);
  const fork = root.points.at(-1)!.clone();
  const forkShift = fork.clone().sub(previousFork);
  for (const child of root.children) translateSubtree(child, forkShift);
  translateSubtree(root, descriptor.origin.clone().sub(root.points[0]!));
  const translatedFork = root.points.at(-1)!.clone();
  for (const child of root.children) scaleSubtree(child, translatedFork, descriptor.vigor);
}

function applyForkDominance(
  stem: CommonDogwoodArchitectureStem,
  architecture: CommonDogwoodArchitecture,
  rng: Rng,
): void {
  if (stem.children.length > 1 && stem.points.length > 1) {
    const dominant = Math.floor(rng.next() * stem.children.length);
    const pivot = stem.points.at(-1)!.clone();
    const tangent = stem.points.at(-1)!.clone()
      .sub(stem.points.at(-2)!)
      .normalize();
    for (let index = 0; index < stem.children.length; index++) {
      const child = stem.children[index]!;
      const rollRange = architecture.forkRollVariationDeg
        * (index === dominant ? 0.28 : 1);
      const roll = rng.vary(0, rollRange) * DEG_TO_RAD;
      rotateSubtree(
        child,
        pivot,
        new THREE.Quaternion().setFromAxisAngle(tangent, roll),
      );
      if (index !== dominant) {
        const subordinateScale = THREE.MathUtils.clamp(
          architecture.forkSubordinateScale + rng.vary(0, 0.035),
          0.62,
          0.9,
        );
        scaleSubtree(child, pivot, subordinateScale);
      }
    }
  }
  for (const child of stem.children) applyForkDominance(child, architecture, rng);
}

function rootStems(
  stems: CommonDogwoodArchitectureStem[],
): CommonDogwoodArchitectureStem[] {
  const children = new Set<CommonDogwoodArchitectureStem>();
  for (const stem of stems) for (const child of stem.children) children.add(child);
  return stems.filter((stem) => !children.has(stem));
}

function shuffledIndices(count: number, rng: Rng): number[] {
  const indices = Array.from({ length: count }, (_, index) => index);
  for (let index = count - 1; index > 0; index--) {
    const swap = Math.floor(rng.next() * (index + 1));
    [indices[index], indices[swap]] = [indices[swap]!, indices[index]!];
  }
  return indices;
}

function rotateSubtree(
  stem: CommonDogwoodArchitectureStem,
  pivot: THREE.Vector3,
  rotation: THREE.Quaternion,
): void {
  for (const point of stem.points) point.sub(pivot).applyQuaternion(rotation).add(pivot);
  for (const orientation of stem.orients) orientation.premultiply(rotation).normalize();
  for (const child of stem.children) rotateSubtree(child, pivot, rotation);
}

function rotateStem(
  stem: CommonDogwoodArchitectureStem,
  pivot: THREE.Vector3,
  rotation: THREE.Quaternion,
): void {
  for (const point of stem.points) point.sub(pivot).applyQuaternion(rotation).add(pivot);
  for (const orientation of stem.orients) orientation.premultiply(rotation).normalize();
}

function translateSubtree(
  stem: CommonDogwoodArchitectureStem,
  translation: THREE.Vector3,
): void {
  for (const point of stem.points) point.add(translation);
  for (const child of stem.children) translateSubtree(child, translation);
}

function scaleSubtree(
  stem: CommonDogwoodArchitectureStem,
  pivot: THREE.Vector3,
  scale: number,
): void {
  scaleStemPoints(stem, pivot, scale);
  for (const child of stem.children) scaleSubtree(child, pivot, scale);
}

function scaleStemPoints(
  stem: CommonDogwoodArchitectureStem,
  pivot: THREE.Vector3,
  scale: number,
): void {
  for (const point of stem.points) point.sub(pivot).multiplyScalar(scale).add(pivot);
}

function stemArcLength(stem: CommonDogwoodArchitectureStem): number {
  let length = 0;
  for (let index = 1; index < stem.points.length; index++) {
    length += stem.points[index]!.distanceTo(stem.points[index - 1]!);
  }
  return length;
}

function measureArchitecture(
  stems: CommonDogwoodArchitectureStem[],
  roots: CommonDogwoodArchitectureStem[],
): CommonDogwoodArchitectureStats {
  const rootCenter = roots.reduce(
    (center, root) => center.add(root.points[0]!),
    new THREE.Vector3(),
  ).divideScalar(roots.length);
  const rootBaseSpread = Math.max(...roots.map(
    (root) => horizontalDistance(root.points[0]!, rootCenter),
  ));
  const rootAngles = roots.map((root) => {
    const direction = root.points[1]!.clone().sub(root.points[0]!);
    return normalizedAngle(Math.atan2(direction.z, direction.x));
  }).sort((left, right) => left - right);
  const gaps = rootAngles.map((angle, index) => {
    const next = rootAngles[(index + 1) % rootAngles.length]!;
    return normalizedAngle(next - angle);
  });
  const meanGap = gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length;
  const rootAzimuthGapCv = Math.sqrt(
    gaps.reduce((sum, gap) => sum + (gap - meanGap) ** 2, 0) / gaps.length,
  ) / Math.max(0.001, meanGap);

  const firstForkLengths = roots.map(stemArcLength);
  const firstForkLengthRange = Math.max(...firstForkLengths) - Math.min(...firstForkLengths);
  const siblingRatios: number[] = [];
  for (const stem of stems) {
    if (stem.children.length < 2) continue;
    const childLengths = stem.children.map(stemArcLength);
    siblingRatios.push(Math.max(...childLengths) / Math.max(0.001, Math.min(...childLengths)));
  }

  const terminals = stems.filter((stem) => stem.terminal);
  const crownCenter = terminals.reduce(
    (center, stem) => center.add(stem.points.at(-1)!),
    new THREE.Vector3(),
  ).divideScalar(Math.max(1, terminals.length));
  const crownRadius = Math.max(0.001, ...terminals.map(
    (stem) => horizontalDistance(stem.points.at(-1)!, rootCenter),
  ));

  return {
    rootCount: roots.length,
    rootBaseSpread,
    rootAzimuthGapCv,
    firstForkLengthRange,
    meanForkSiblingLengthRatio: siblingRatios.reduce((sum, ratio) => sum + ratio, 0)
      / Math.max(1, siblingRatios.length),
    crownCentroidOffsetRatio: horizontalDistance(crownCenter, rootCenter) / crownRadius,
  };
}

function horizontalDistance(left: THREE.Vector3, right: THREE.Vector3): number {
  return Math.hypot(left.x - right.x, left.z - right.z);
}

function normalizedAngle(angle: number): number {
  const fullTurn = Math.PI * 2;
  return ((angle % fullTurn) + fullTurn) % fullTurn;
}

function shortestSignedAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}
