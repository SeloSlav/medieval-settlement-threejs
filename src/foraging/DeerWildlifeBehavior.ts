import { GAME_HABITAT_DISRUPTION_RADIUS } from '../generated/gameBalance.ts';

export type DeerBehaviorMode = 'idle' | 'graze' | 'walk' | 'flee';

export type DeerSex = 'doe' | 'stag';

export type DeerSexCounts = {
  doeCount: number;
  stagCount: number;
};

export type DeerObserver = {
  x: number;
  z: number;
  crouching: boolean;
};

export type DeerForcedThreat = Pick<DeerObserver, 'x' | 'z'> & {
  id?: string;
};

export type DeerMotionState = {
  x: number;
  z: number;
  homeX: number;
  homeZ: number;
  targetX: number;
  targetZ: number;
  heading: number;
  speed: number;
  mode: DeerBehaviorMode;
  modeTimer: number;
  fleeBias: number;
  migrationTargetX: number | null;
  migrationTargetZ: number | null;
};

export type DeerBehaviorContext = {
  observer: DeerObserver | null;
  /** A non-stealth disturbance that alarms the complete habitat herd. */
  forcedThreat?: DeerForcedThreat | null;
  /** All simultaneous non-stealth disturbances affecting this habitat. */
  forcedThreats?: readonly DeerForcedThreat[];
  random: () => number;
  isBlockedAt?: (x: number, z: number) => boolean;
};

export const DEER_FLEE_TRIGGER_DISTANCE = 19;
export const DEER_FLEE_RELEASE_DISTANCE = 32;
/** The authoritative habitat-disruption circle is also the herd's grazing area. */
export const DEER_ROAM_RADIUS = GAME_HABITAT_DISRUPTION_RADIUS;
export const DEER_FLEE_BOUNDARY_RADIUS = 52;
export const DEER_CROUCH_DETECTION_HALF_ANGLE = Math.PI * (65 / 180);

const TAU = Math.PI * 2;
const WALK_SPEED = 1.25;
const FLEE_SPEED = 7.1;
const MIGRATION_ARRIVAL_DISTANCE = 0.7;
const MIN_REST_SECONDS = 2.2;
const MAX_REST_SECONDS = 6.8;

type DeerThreat = {
  directionX: number;
  directionZ: number;
  distance: number;
  forced: boolean;
};

export function updateDeerMotion(
  state: DeerMotionState,
  dtSeconds: number,
  context: DeerBehaviorContext,
): void {
  const dt = Math.min(Math.max(dtSeconds, 0), 0.1);
  if (dt <= 0) return;

  const forcedThreatActive = Boolean(
    context.forcedThreat
    || context.forcedThreats?.length,
  );
  if (hasActiveDeerMigration(state) && !forcedThreatActive) {
    updateMigration(state, dt, context);
    return;
  }

  const observerDistance = context.observer
    ? Math.hypot(state.x - context.observer.x, state.z - context.observer.z)
    : Number.POSITIVE_INFINITY;

  const observerDetected = Boolean(
    context.observer
    && canDeerDetectObserver(state, context.observer, observerDistance),
  );
  if (observerDetected || forcedThreatActive) {
    if (state.mode !== 'flee') beginFlee(state);
    state.modeTimer = Math.max(state.modeTimer, 1.15);
  }

  state.modeTimer -= dt;

  if (state.mode === 'flee') {
    updateFleeing(
      state,
      dt,
      selectFleeThreat(state, context, observerDistance, observerDetected),
      context,
    );
    return;
  }

  if (state.mode === 'walk') {
    updateWalking(state, dt, context);
    return;
  }

  state.speed = approach(state.speed, 0, 4.5 * dt);
  if (state.modeTimer <= 0) beginWalk(state, context);
}

export function chooseInitialDeerMode(random: () => number): DeerBehaviorMode {
  return random() < 0.56 ? 'graze' : 'idle';
}

export function chooseRestDuration(random: () => number): number {
  return lerp(MIN_REST_SECONDS, MAX_REST_SECONDS, random());
}

/**
 * Starts a witnessed authoritative habitat relocation without changing the
 * deer's current world position. Each deer may receive its own arrival point,
 * while `homeX/homeZ` remain the shared new habitat center.
 */
export function beginDeerMigration(
  state: DeerMotionState,
  targetX: number,
  targetZ: number,
  homeX: number,
  homeZ: number,
): void {
  state.migrationTargetX = targetX;
  state.migrationTargetZ = targetZ;
  state.homeX = homeX;
  state.homeZ = homeZ;
  state.targetX = targetX;
  state.targetZ = targetZ;
  state.mode = 'flee';
  state.modeTimer = 0;
}

export function hasActiveDeerMigration(
  state: Pick<DeerMotionState, 'migrationTargetX' | 'migrationTargetZ'>,
): boolean {
  return state.migrationTargetX !== null && state.migrationTargetZ !== null;
}

/** Completes an unobserved relocation at its exact terminal pose. */
export function snapDeerMigration(
  state: DeerMotionState,
  random: () => number,
): boolean {
  if (!hasActiveDeerMigration(state)) return false;
  finishMigration(state, random);
  return true;
}

/**
 * Standing players alert deer from any direction inside the awareness radius.
 * Crouching limits awareness to a forward cone, leaving a true blind approach
 * behind the animal until it turns enough to see the player.
 */
export function canDeerDetectObserver(
  state: Pick<DeerMotionState, 'x' | 'z' | 'heading'>,
  observer: DeerObserver,
  knownDistance?: number,
): boolean {
  const dx = observer.x - state.x;
  const dz = observer.z - state.z;
  const distance = knownDistance ?? Math.hypot(dx, dz);
  if (distance > DEER_FLEE_TRIGGER_DISTANCE) return false;
  if (!observer.crouching) return true;
  if (distance < 0.001) return true;

  const inverseDistance = 1 / distance;
  const directionToObserverX = dx * inverseDistance;
  const directionToObserverZ = dz * inverseDistance;
  const forwardX = Math.sin(state.heading);
  const forwardZ = Math.cos(state.heading);
  const facingDot = forwardX * directionToObserverX + forwardZ * directionToObserverZ;
  return facingDot >= Math.cos(DEER_CROUCH_DETECTION_HALF_ANGLE);
}

/**
 * Keeps small resource herds doe-heavy while guaranteeing that mixed herds show
 * both models. Five animals resolve to one stag and four does.
 */
export function herdSexCounts(count: number): DeerSexCounts {
  const herdSize = Math.max(0, Math.floor(count));
  if (herdSize === 0) return { doeCount: 0, stagCount: 0 };
  if (herdSize === 1) return { doeCount: 1, stagCount: 0 };

  const stagCount = Math.min(herdSize - 1, Math.max(1, Math.round(herdSize * 0.2)));
  return {
    doeCount: herdSize - stagCount,
    stagCount,
  };
}

export function createHerdSexDistribution(count: number, random: () => number): DeerSex[] {
  const { doeCount, stagCount } = herdSexCounts(count);
  const distribution: DeerSex[] = [
    ...Array.from({ length: stagCount }, () => 'stag' as const),
    ...Array.from({ length: doeCount }, () => 'doe' as const),
  ];

  for (let index = distribution.length - 1; index > 0; index--) {
    const swapIndex = Math.floor(random() * (index + 1));
    const current = distribution[index];
    distribution[index] = distribution[swapIndex];
    distribution[swapIndex] = current;
  }
  return distribution;
}

function updateWalking(
  state: DeerMotionState,
  dt: number,
  context: DeerBehaviorContext,
): void {
  const dx = state.targetX - state.x;
  const dz = state.targetZ - state.z;
  const targetDistance = Math.hypot(dx, dz);
  if (targetDistance < 0.8 || state.modeTimer <= 0) {
    beginRest(state, context.random);
    return;
  }

  state.heading = turnToward(state.heading, Math.atan2(dx, dz), 2.2 * dt);
  state.speed = approach(state.speed, WALK_SPEED, 1.8 * dt);
  tryMove(state, dt, context, false);
}

function updateFleeing(
  state: DeerMotionState,
  dt: number,
  threat: DeerThreat | null,
  context: DeerBehaviorContext,
): void {
  if (!threat || (
    !threat.forced
    && threat.distance >= DEER_FLEE_RELEASE_DISTANCE
    && state.modeTimer <= 0
  )) {
    beginWalk(state, context, true);
    return;
  }

  if (threat.forced || threat.distance < DEER_FLEE_RELEASE_DISTANCE) {
    state.modeTimer = Math.max(state.modeTimer, 0.35);
  }

  let desiredX = threat.directionX;
  let desiredZ = threat.directionZ;

  const homeDx = state.homeX - state.x;
  const homeDz = state.homeZ - state.z;
  const homeDistance = Math.hypot(homeDx, homeDz);
  let refugeBlend = 0;
  if (threat.forced && homeDistance > DEER_ROAM_RADIUS) {
    const homeLength = Math.max(homeDistance, 0.001);
    const outwardX = -homeDx / homeLength;
    const outwardZ = -homeDz / homeLength;
    const refugeEnvelope = 1 - smoothstep(
      DEER_FLEE_BOUNDARY_RADIUS + 2,
      DEER_FLEE_BOUNDARY_RADIUS + 8,
      homeDistance,
    );
    refugeBlend = smoothstep(
      DEER_FLEE_BOUNDARY_RADIUS - 7,
      DEER_FLEE_BOUNDARY_RADIUS,
      homeDistance,
    ) * refugeEnvelope;

    // Once clear of the grazing circle, keep an alarmed herd pacing around its
    // refuge boundary. This avoids both unbounded flight and the old behavior
    // where home steering sent deer back through an active logging crew.
    let tangentX = outwardZ;
    let tangentZ = -outwardX;
    if (tangentX * desiredX + tangentZ * desiredZ < 0) {
      tangentX = -tangentX;
      tangentZ = -tangentZ;
    }
    desiredX = lerp(desiredX, tangentX, refugeBlend);
    desiredZ = lerp(desiredZ, tangentZ, refugeBlend);

    const outsideCorrection = smoothstep(
      DEER_FLEE_BOUNDARY_RADIUS,
      DEER_FLEE_BOUNDARY_RADIUS + 3,
      homeDistance,
    ) * refugeEnvelope;
    desiredX += (homeDx / homeLength) * outsideCorrection * 1.35;
    desiredZ += (homeDz / homeLength) * outsideCorrection * 1.35;
    const desiredLength = Math.hypot(desiredX, desiredZ);
    if (desiredLength > 0.001) {
      desiredX /= desiredLength;
      desiredZ /= desiredLength;
    }
  } else if (homeDistance > DEER_ROAM_RADIUS) {
    const homeWeight = smoothstep(DEER_ROAM_RADIUS, DEER_FLEE_BOUNDARY_RADIUS, homeDistance) * 0.88;
    const homeLength = Math.max(homeDistance, 0.001);
    desiredX = lerp(desiredX, homeDx / homeLength, homeWeight);
    desiredZ = lerp(desiredZ, homeDz / homeLength, homeWeight);
  }

  const desiredHeading = Math.atan2(desiredX, desiredZ)
    + state.fleeBias * (threat.forced ? 1 - refugeBlend : 1);
  state.heading = turnToward(state.heading, desiredHeading, 4.6 * dt);
  state.speed = approach(state.speed, FLEE_SPEED, 7.5 * dt);
  tryMove(state, dt, context, true);
}

function updateMigration(
  state: DeerMotionState,
  dt: number,
  context: DeerBehaviorContext,
): void {
  const targetX = state.migrationTargetX;
  const targetZ = state.migrationTargetZ;
  if (targetX === null || targetZ === null) return;

  const dx = targetX - state.x;
  const dz = targetZ - state.z;
  const distance = Math.hypot(dx, dz);
  if (distance <= MIGRATION_ARRIVAL_DISTANCE) {
    finishMigration(state, context.random);
    return;
  }

  state.mode = 'flee';
  state.modeTimer = 0;
  state.heading = turnToward(state.heading, Math.atan2(dx, dz), 4.6 * dt);
  state.speed = approach(state.speed, FLEE_SPEED, 7.5 * dt);
  const travel = Math.min(distance, state.speed * dt);
  const nextX = state.x + Math.sin(state.heading) * travel;
  const nextZ = state.z + Math.cos(state.heading) * travel;
  if (context.isBlockedAt?.(nextX, nextZ)) {
    const turnDirection = context.random() < 0.5 ? -1 : 1;
    state.heading = wrapAngle(state.heading + turnDirection * 1.18);
    return;
  }

  state.x = nextX;
  state.z = nextZ;
  if (travel >= distance - 1e-6) finishMigration(state, context.random);
}

function finishMigration(state: DeerMotionState, random: () => number): void {
  const targetX = state.migrationTargetX;
  const targetZ = state.migrationTargetZ;
  if (targetX === null || targetZ === null) return;
  state.x = targetX;
  state.z = targetZ;
  state.targetX = targetX;
  state.targetZ = targetZ;
  state.migrationTargetX = null;
  state.migrationTargetZ = null;
  state.speed = 0;
  beginRest(state, random);
}

function selectFleeThreat(
  state: Pick<DeerMotionState, 'x' | 'z' | 'heading' | 'mode'>,
  context: DeerBehaviorContext,
  observerDistance: number,
  observerDetected: boolean,
): DeerThreat | null {
  let forcedDirectionX = 0;
  let forcedDirectionZ = 0;
  let forcedDistance = Number.POSITIVE_INFINITY;
  let closestForcedThreat: DeerForcedThreat | null = null;
  let forcedCount = 0;
  const singleForcedThreat = context.forcedThreat ?? null;
  const forcedThreats = context.forcedThreats ?? [];
  const singleThreatCount = singleForcedThreat ? 1 : 0;
  const forcedThreatCount = singleThreatCount + forcedThreats.length;
  for (let index = 0; index < forcedThreatCount; index += 1) {
    const source = index < singleThreatCount
      ? singleForcedThreat
      : forcedThreats[index - singleThreatCount];
    if (!source || !Number.isFinite(source.x) || !Number.isFinite(source.z)) continue;
    const dx = state.x - source.x;
    const dz = state.z - source.z;
    const distance = Math.hypot(dx, dz);
    if (
      distance < forcedDistance
      || (
        distance === forcedDistance
        && stableThreatId(source).localeCompare(stableThreatId(closestForcedThreat)) < 0
      )
    ) {
      forcedDistance = distance;
      closestForcedThreat = source;
    }
    if (distance > 0.001) {
      const weight = 1 / Math.max(distance, 1);
      forcedDirectionX += (dx / distance) * weight;
      forcedDirectionZ += (dz / distance) * weight;
    }
    forcedCount += 1;
  }

  if (forcedCount > 0 && context.observer && observerDetected && observerDistance > 0.001) {
    const observerWeight = 1 / Math.max(observerDistance, 1);
    forcedDirectionX += ((state.x - context.observer.x) / observerDistance) * observerWeight;
    forcedDirectionZ += ((state.z - context.observer.z) / observerDistance) * observerWeight;
  }

  if (forcedCount > 0) {
    let directionLength = Math.hypot(forcedDirectionX, forcedDirectionZ);
    if (directionLength <= 0.000_001) {
      // Equal threats on opposite sides cancel. Break that stalemate by taking
      // a stable perpendicular escape instead of running toward either logger.
      const source = closestForcedThreat;
      const dx = source ? state.x - source.x : 0;
      const dz = source ? state.z - source.z : 0;
      const distance = Math.hypot(dx, dz);
      if (distance > 0.001) {
        const turn = stableThreatTurn(stableThreatId(source));
        forcedDirectionX = (dz / distance) * turn;
        forcedDirectionZ = (-dx / distance) * turn;
      } else {
        const angle = stableThreatAngle(stableThreatId(source));
        forcedDirectionX = Math.sin(angle);
        forcedDirectionZ = Math.cos(angle);
      }
      directionLength = 1;
    }
    return {
      directionX: forcedDirectionX / directionLength,
      directionZ: forcedDirectionZ / directionLength,
      distance: forcedDistance,
      forced: true,
    };
  }

  const observer = context.observer && (
    observerDetected
    || state.mode === 'flee'
  )
    ? {
        directionX: observerDistance > 0.001
          ? (state.x - context.observer.x) / observerDistance
          : Math.sin(state.heading),
        directionZ: observerDistance > 0.001
          ? (state.z - context.observer.z) / observerDistance
          : Math.cos(state.heading),
        distance: observerDistance,
        forced: false,
      }
    : null;
  return observer;
}

function stableThreatId(source: DeerForcedThreat | null): string {
  return source?.id ?? '';
}

function stableThreatTurn(id: string): -1 | 1 {
  return stableThreatHash(id) % 2 === 0 ? -1 : 1;
}

function stableThreatAngle(id: string): number {
  return (stableThreatHash(id) / 0xffff_ffff) * TAU;
}

function stableThreatHash(id: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function tryMove(
  state: DeerMotionState,
  dt: number,
  context: DeerBehaviorContext,
  fleeing: boolean,
): void {
  const nextX = state.x + Math.sin(state.heading) * state.speed * dt;
  const nextZ = state.z + Math.cos(state.heading) * state.speed * dt;
  if (context.isBlockedAt?.(nextX, nextZ)) {
    const turnDirection = context.random() < 0.5 ? -1 : 1;
    state.heading = wrapAngle(state.heading + turnDirection * (fleeing ? 1.18 : 0.82));
    if (!fleeing) beginWalk(state, context);
    return;
  }

  state.x = nextX;
  state.z = nextZ;
}

function beginFlee(state: DeerMotionState): void {
  state.mode = 'flee';
  state.modeTimer = 1.15;
}

function beginWalk(
  state: DeerMotionState,
  context: DeerBehaviorContext,
  returningHome = false,
): void {
  state.mode = 'walk';
  state.modeTimer = lerp(7.5, 15, context.random());

  for (let attempt = 0; attempt < 10; attempt++) {
    const angle = context.random() * TAU;
    const radius = returningHome
      ? Math.sqrt(context.random()) * DEER_ROAM_RADIUS * 0.42
      : Math.sqrt(context.random()) * DEER_ROAM_RADIUS;
    const x = state.homeX + Math.sin(angle) * radius;
    const z = state.homeZ + Math.cos(angle) * radius;
    if (context.isBlockedAt?.(x, z)) continue;
    state.targetX = x;
    state.targetZ = z;
    return;
  }

  state.targetX = state.homeX;
  state.targetZ = state.homeZ;
}

function beginRest(state: DeerMotionState, random: () => number): void {
  state.mode = random() < 0.62 ? 'graze' : 'idle';
  state.modeTimer = chooseRestDuration(random);
}

function approach(value: number, target: number, maxDelta: number): number {
  if (value < target) return Math.min(value + maxDelta, target);
  return Math.max(value - maxDelta, target);
}

function turnToward(current: number, target: number, maxDelta: number): number {
  const delta = wrapAngle(target - current);
  return wrapAngle(current + Math.max(-maxDelta, Math.min(maxDelta, delta)));
}

function wrapAngle(angle: number): number {
  let wrapped = (angle + Math.PI) % TAU;
  if (wrapped < 0) wrapped += TAU;
  return wrapped - Math.PI;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
