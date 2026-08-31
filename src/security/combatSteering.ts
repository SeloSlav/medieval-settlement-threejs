import {
  COMBAT_STEERING_ALIGNMENT_WEIGHT,
  COMBAT_STEERING_CELL_SIZE_M,
  COMBAT_STEERING_COHESION_WEIGHT,
  COMBAT_STEERING_ENGAGEMENT_MIN_RADIUS_M,
  COMBAT_STEERING_ENGAGEMENT_RADIUS_FACTOR,
  COMBAT_STEERING_ENGAGEMENT_RING_SPACING_M,
  COMBAT_STEERING_ENGAGEMENT_SLOT_COUNT,
  COMBAT_STEERING_EXACT_OVERLAP_EPSILON_SQ,
  COMBAT_STEERING_GOAL_WEIGHT,
  COMBAT_STEERING_HARD_CLEARANCE_EPSILON_M,
  COMBAT_STEERING_HARD_CONSTRAINT_ITERATIONS,
  COMBAT_STEERING_MAX_NEIGHBORS,
  COMBAT_STEERING_MAX_TURN_RADIANS_PER_SECOND,
  COMBAT_STEERING_NEIGHBOR_RADIUS_M,
  COMBAT_STEERING_PREDICTION_SECONDS,
  COMBAT_STEERING_PREDICTIVE_WEIGHT,
  COMBAT_STEERING_RANGED_DEPTH_SPACING_M,
  COMBAT_STEERING_RANGED_LINE_SPACING_M,
  COMBAT_STEERING_RANGED_PREFERRED_RANGE_FACTOR,
  COMBAT_STEERING_SEPARATION_DISTANCE_M,
  COMBAT_STEERING_SEPARATION_WEIGHT,
  COMBAT_STEERING_VELOCITY_RESPONSE_PER_SECOND,
} from '../generated/gameBalance.ts';

const SEPARATION_DISTANCE_SQ = COMBAT_STEERING_SEPARATION_DISTANCE_M
  * COMBAT_STEERING_SEPARATION_DISTANCE_M;
const NEIGHBOR_RADIUS_SQ = COMBAT_STEERING_NEIGHBOR_RADIUS_M
  * COMBAT_STEERING_NEIGHBOR_RADIUS_M;
const NEIGHBOR_CELL_RADIUS = Math.max(
  1,
  Math.ceil(COMBAT_STEERING_NEIGHBOR_RADIUS_M / COMBAT_STEERING_CELL_SIZE_M),
);
const STOP_DISTANCE_SQ = 0.0064;
const HARD_SEPARATION_DISTANCE_M = COMBAT_STEERING_SEPARATION_DISTANCE_M
  + COMBAT_STEERING_HARD_CLEARANCE_EPSILON_M;
const HARD_SEPARATION_DISTANCE_SQ = HARD_SEPARATION_DISTANCE_M
  * HARD_SEPARATION_DISTANCE_M;

export type CombatSteeringAgent = {
  /** The canonical position used by simulation, targeting and rendering. */
  state: { x: number; z: number };
  steeringSeed: number;
  steeringTeam: number;
  steeringCompany: number;
  steeringEnabled: boolean;
  steeringGoalX: number;
  steeringGoalZ: number;
  steeringSpeed: number;
  steeringVelocityX: number;
  steeringVelocityZ: number;
};

export type CombatSteeringBounds = {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
};

/**
 * Allocation-free canonical crowd steering for physical combatants.
 *
 * Unlike the worker presentation offset, this solver writes the real agent
 * coordinates. A typed-array uniform hash makes all-combatant separation and
 * predictive avoidance proportional to agents plus their local neighbours.
 * Goal seeking remains dominant; alignment and cohesion are only accumulated
 * for members of the same company.
 */
export class CanonicalCombatSteeringGrid {
  private readonly capacity: number;
  private readonly bucketMask: number;
  private readonly bucketHeads: Int32Array;
  private readonly next: Int32Array;
  private readonly cellX: Int32Array;
  private readonly cellZ: Int32Array;
  private readonly preferredX: Float64Array;
  private readonly preferredZ: Float64Array;
  private readonly nextVelocityX: Float64Array;
  private readonly nextVelocityZ: Float64Array;
  private readonly nextX: Float64Array;
  private readonly nextZ: Float64Array;
  /** Reused fixed-size nearest/urgency set for one source body. */
  private readonly neighborIndices: Int32Array;
  private readonly neighborPriority: Uint8Array;
  private readonly neighborMetric: Float64Array;

  constructor(capacity = 1_024) {
    this.capacity = Math.max(1, Math.floor(capacity));
    let bucketCount = 1;
    while (bucketCount < this.capacity * 2) bucketCount *= 2;
    this.bucketMask = bucketCount - 1;
    this.bucketHeads = new Int32Array(bucketCount);
    this.next = new Int32Array(this.capacity);
    this.cellX = new Int32Array(this.capacity);
    this.cellZ = new Int32Array(this.capacity);
    this.preferredX = new Float64Array(this.capacity);
    this.preferredZ = new Float64Array(this.capacity);
    this.nextVelocityX = new Float64Array(this.capacity);
    this.nextVelocityZ = new Float64Array(this.capacity);
    this.nextX = new Float64Array(this.capacity);
    this.nextZ = new Float64Array(this.capacity);
    this.neighborIndices = new Int32Array(COMBAT_STEERING_MAX_NEIGHBORS);
    this.neighborPriority = new Uint8Array(COMBAT_STEERING_MAX_NEIGHBORS);
    this.neighborMetric = new Float64Array(COMBAT_STEERING_MAX_NEIGHBORS);
  }

  update(
    agents: readonly CombatSteeringAgent[],
    count: number,
    dtSeconds: number,
    bounds: CombatSteeringBounds,
  ): void {
    const activeCount = Math.min(Math.max(0, Math.floor(count)), agents.length, this.capacity);
    if (activeCount === 0 || !Number.isFinite(dtSeconds) || dtSeconds <= 0) return;
    const dt = Math.min(dtSeconds, 0.2);

    this.bucketHeads.fill(-1);
    for (let index = 0; index < activeCount; index += 1) {
      const agent = agents[index]!;
      if (!agent.steeringEnabled) {
        this.next[index] = -1;
        this.preferredX[index] = 0;
        this.preferredZ[index] = 0;
        continue;
      }
      const x = agent.state.x;
      const z = agent.state.z;
      const cellX = Math.floor(x / COMBAT_STEERING_CELL_SIZE_M);
      const cellZ = Math.floor(z / COMBAT_STEERING_CELL_SIZE_M);
      const bucket = this.bucketFor(cellX, cellZ);
      this.cellX[index] = cellX;
      this.cellZ[index] = cellZ;
      this.next[index] = this.bucketHeads[bucket]!;
      this.bucketHeads[bucket] = index;

      const goalX = agent.steeringGoalX - x;
      const goalZ = agent.steeringGoalZ - z;
      const distanceSq = goalX * goalX + goalZ * goalZ;
      if (distanceSq <= STOP_DISTANCE_SQ || agent.steeringSpeed <= 0) {
        this.preferredX[index] = 0;
        this.preferredZ[index] = 0;
      } else {
        const distance = Math.sqrt(distanceSq);
        const speed = Math.min(agent.steeringSpeed, distance / dt);
        this.preferredX[index] = goalX / distance * speed;
        this.preferredZ[index] = goalZ / distance * speed;
      }
    }

    for (let index = 0; index < activeCount; index += 1) {
      const agent = agents[index]!;
      if (!agent.steeringEnabled) {
        this.nextVelocityX[index] = 0;
        this.nextVelocityZ[index] = 0;
        this.nextX[index] = agent.state.x;
        this.nextZ[index] = agent.state.z;
        continue;
      }
      const x = agent.state.x;
      const z = agent.state.z;
      const preferredX = this.preferredX[index]!;
      const preferredZ = this.preferredZ[index]!;
      const preferredLength = Math.hypot(preferredX, preferredZ);
      const goalDirectionX = preferredLength > 1e-8 ? preferredX / preferredLength : 0;
      const goalDirectionZ = preferredLength > 1e-8 ? preferredZ / preferredLength : 0;

      let separationX = 0;
      let separationZ = 0;
      let predictiveX = 0;
      let predictiveZ = 0;
      let alignmentX = 0;
      let alignmentZ = 0;
      let cohesionX = 0;
      let cohesionZ = 0;
      let companyNeighbors = 0;
      let separationNeighbors = 0;
      let predictiveNeighbors = 0;
      const ownPersistedSpeedSq = agent.steeringVelocityX * agent.steeringVelocityX
        + agent.steeringVelocityZ * agent.steeringVelocityZ;
      const ownVelocityX = ownPersistedSpeedSq > 1e-8
        ? agent.steeringVelocityX : preferredX;
      const ownVelocityZ = ownPersistedSpeedSq > 1e-8
        ? agent.steeringVelocityZ : preferredZ;
      let selectedNeighborCount = 0;

      // Select collision threats before flock-only neighbours, then retain the
      // closest/most urgent fixed-size set. This prevents a dense friendly
      // company from consuming the cap before a nearby enemy is considered.
      for (
        let cellDeltaZ = -NEIGHBOR_CELL_RADIUS;
        cellDeltaZ <= NEIGHBOR_CELL_RADIUS;
        cellDeltaZ += 1
      ) {
        const neighborCellZ = this.cellZ[index]! + cellDeltaZ;
        for (
          let cellDeltaX = -NEIGHBOR_CELL_RADIUS;
          cellDeltaX <= NEIGHBOR_CELL_RADIUS;
          cellDeltaX += 1
        ) {
          const neighborCellX = this.cellX[index]! + cellDeltaX;
          let neighbor = this.bucketHeads[this.bucketFor(neighborCellX, neighborCellZ)]!;
          while (neighbor >= 0) {
            if (
              neighbor !== index
              && this.cellX[neighbor] === neighborCellX
              && this.cellZ[neighbor] === neighborCellZ
            ) {
              const other = agents[neighbor]!;
              const deltaX = x - other.state.x;
              const deltaZ = z - other.state.z;
              const distanceSq = deltaX * deltaX + deltaZ * deltaZ;
              if (distanceSq > NEIGHBOR_RADIUS_SQ) {
                neighbor = this.next[neighbor]!;
                continue;
              }
              const otherPersistedSpeedSq = other.steeringVelocityX * other.steeringVelocityX
                + other.steeringVelocityZ * other.steeringVelocityZ;
              const otherVelocityX = otherPersistedSpeedSq > 1e-8
                ? other.steeringVelocityX : this.preferredX[neighbor]!;
              const otherVelocityZ = otherPersistedSpeedSq > 1e-8
                ? other.steeringVelocityZ : this.preferredZ[neighbor]!;
              const relativeVelocityX = ownVelocityX - otherVelocityX;
              const relativeVelocityZ = ownVelocityZ - otherVelocityZ;
              const relativeSpeedSq = relativeVelocityX * relativeVelocityX
                + relativeVelocityZ * relativeVelocityZ;
              let predictiveCollision = false;
              if (relativeSpeedSq > 1e-8) {
                const toward = -(deltaX * relativeVelocityX + deltaZ * relativeVelocityZ);
                const closestTime = Math.min(
                  COMBAT_STEERING_PREDICTION_SECONDS,
                  Math.max(0, toward / relativeSpeedSq),
                );
                if (closestTime > 0) {
                  const futureX = deltaX + relativeVelocityX * closestTime;
                  const futureZ = deltaZ + relativeVelocityZ * closestTime;
                  const futureDistanceSq = futureX * futureX + futureZ * futureZ;
                  if (futureDistanceSq < SEPARATION_DISTANCE_SQ) {
                    predictiveCollision = true;
                  }
                }
              }
              const sameCompany = (
                agent.steeringCompany !== 0
                && agent.steeringCompany === other.steeringCompany
                && agent.steeringTeam === other.steeringTeam
              );
              const immediateCollision = distanceSq < SEPARATION_DISTANCE_SQ;
              if (!immediateCollision && !predictiveCollision && !sameCompany) {
                neighbor = this.next[neighbor]!;
                continue;
              }

              const priority = immediateCollision ? 0 : predictiveCollision ? 1 : 2;
              const metric = distanceSq;
              let insertAt = selectedNeighborCount;
              while (insertAt > 0) {
                const previous = insertAt - 1;
                const previousIndex = this.neighborIndices[previous]!;
                const previousPriority = this.neighborPriority[previous]!;
                const previousMetric = this.neighborMetric[previous]!;
                const previousAgent = agents[previousIndex]!;
                const comesBefore = priority < previousPriority
                  || (
                    priority === previousPriority
                    && (
                      metric < previousMetric
                      || (
                        metric === previousMetric
                        && (
                          other.steeringSeed < previousAgent.steeringSeed
                          || (
                            other.steeringSeed === previousAgent.steeringSeed
                            && neighbor < previousIndex
                          )
                        )
                      )
                    )
                  );
                if (!comesBefore) break;
                if (insertAt < COMBAT_STEERING_MAX_NEIGHBORS) {
                  this.neighborIndices[insertAt] = previousIndex;
                  this.neighborPriority[insertAt] = previousPriority;
                  this.neighborMetric[insertAt] = previousMetric;
                }
                insertAt -= 1;
              }
              if (insertAt < COMBAT_STEERING_MAX_NEIGHBORS) {
                this.neighborIndices[insertAt] = neighbor;
                this.neighborPriority[insertAt] = priority;
                this.neighborMetric[insertAt] = metric;
                if (selectedNeighborCount < COMBAT_STEERING_MAX_NEIGHBORS) {
                  selectedNeighborCount += 1;
                }
              }
            }
            neighbor = this.next[neighbor]!;
          }
        }
      }

      for (let selected = 0; selected < selectedNeighborCount; selected += 1) {
        const neighbor = this.neighborIndices[selected]!;
        const other = agents[neighbor]!;
        const deltaX = x - other.state.x;
        const deltaZ = z - other.state.z;
        const distanceSq = deltaX * deltaX + deltaZ * deltaZ;
        if (distanceSq < SEPARATION_DISTANCE_SQ) {
          let awayX: number;
          let awayZ: number;
          let distance: number;
          if (distanceSq <= COMBAT_STEERING_EXACT_OVERLAP_EPSILON_SQ) {
            const angle = exactOverlapAngle(
              agent.steeringSeed,
              other.steeringSeed,
              index,
              neighbor,
            );
            awayX = Math.cos(angle);
            awayZ = Math.sin(angle);
            distance = 0;
          } else {
            distance = Math.sqrt(distanceSq);
            awayX = deltaX / distance;
            awayZ = deltaZ / distance;
          }
          const pressure = 1 - distance / COMBAT_STEERING_SEPARATION_DISTANCE_M;
          separationX += awayX * pressure;
          separationZ += awayZ * pressure;
          separationNeighbors += 1;
        }

        const otherPersistedSpeedSq = other.steeringVelocityX * other.steeringVelocityX
          + other.steeringVelocityZ * other.steeringVelocityZ;
        const otherVelocityX = otherPersistedSpeedSq > 1e-8
          ? other.steeringVelocityX : this.preferredX[neighbor]!;
        const otherVelocityZ = otherPersistedSpeedSq > 1e-8
          ? other.steeringVelocityZ : this.preferredZ[neighbor]!;
        const relativeVelocityX = ownVelocityX - otherVelocityX;
        const relativeVelocityZ = ownVelocityZ - otherVelocityZ;
        const relativeSpeedSq = relativeVelocityX * relativeVelocityX
          + relativeVelocityZ * relativeVelocityZ;
        if (relativeSpeedSq > 1e-8) {
          const toward = -(deltaX * relativeVelocityX + deltaZ * relativeVelocityZ);
          const closestTime = Math.min(
            COMBAT_STEERING_PREDICTION_SECONDS,
            Math.max(0, toward / relativeSpeedSq),
          );
          if (closestTime > 0) {
            const futureX = deltaX + relativeVelocityX * closestTime;
            const futureZ = deltaZ + relativeVelocityZ * closestTime;
            const futureDistanceSq = futureX * futureX + futureZ * futureZ;
            if (futureDistanceSq < SEPARATION_DISTANCE_SQ) {
              let avoidX: number;
              let avoidZ: number;
              if (futureDistanceSq <= SEPARATION_DISTANCE_SQ * 0.16) {
                const lowSeed = Math.min(agent.steeringSeed, other.steeringSeed);
                const highSeed = Math.max(agent.steeringSeed, other.steeringSeed);
                const side = (mixSeed(lowSeed ^ Math.imul(highSeed, 0x9e37_79b1)) & 1)
                  === 0 ? -1 : 1;
                const relativeSpeed = Math.sqrt(relativeSpeedSq);
                avoidX = -relativeVelocityZ / relativeSpeed * side;
                avoidZ = relativeVelocityX / relativeSpeed * side;
              } else {
                const futureDistance = Math.sqrt(futureDistanceSq);
                avoidX = futureX / futureDistance;
                avoidZ = futureZ / futureDistance;
              }
              const urgency = (1 - closestTime / COMBAT_STEERING_PREDICTION_SECONDS)
                * (1 - Math.sqrt(futureDistanceSq) / COMBAT_STEERING_SEPARATION_DISTANCE_M);
              predictiveX += avoidX * urgency;
              predictiveZ += avoidZ * urgency;
              predictiveNeighbors += 1;
            }
          }
        }

        if (
          agent.steeringCompany !== 0
          && agent.steeringCompany === other.steeringCompany
          && agent.steeringTeam === other.steeringTeam
        ) {
          const otherSpeed = Math.hypot(
            other.steeringVelocityX,
            other.steeringVelocityZ,
          );
          if (otherSpeed > 1e-8) {
            alignmentX += other.steeringVelocityX / otherSpeed;
            alignmentZ += other.steeringVelocityZ / otherSpeed;
          }
          cohesionX += other.state.x - x;
          cohesionZ += other.state.z - z;
          companyNeighbors += 1;
        }
      }

      if (separationNeighbors > 0) {
        separationX /= separationNeighbors;
        separationZ /= separationNeighbors;
      }
      if (predictiveNeighbors > 0) {
        predictiveX /= predictiveNeighbors;
        predictiveZ /= predictiveNeighbors;
      }
      let avoidanceX = separationX * COMBAT_STEERING_SEPARATION_WEIGHT
        + predictiveX * COMBAT_STEERING_PREDICTIVE_WEIGHT;
      let avoidanceZ = separationZ * COMBAT_STEERING_SEPARATION_WEIGHT
        + predictiveZ * COMBAT_STEERING_PREDICTIVE_WEIGHT;
      const avoidanceLength = Math.hypot(avoidanceX, avoidanceZ);
      const maxAvoidance = COMBAT_STEERING_GOAL_WEIGHT * 0.72;
      if (avoidanceLength > maxAvoidance) {
        avoidanceX *= maxAvoidance / avoidanceLength;
        avoidanceZ *= maxAvoidance / avoidanceLength;
      }
      let steerX = goalDirectionX * COMBAT_STEERING_GOAL_WEIGHT + avoidanceX;
      let steerZ = goalDirectionZ * COMBAT_STEERING_GOAL_WEIGHT + avoidanceZ;
      if (companyNeighbors > 0) {
        const alignmentLength = Math.hypot(alignmentX, alignmentZ);
        if (alignmentLength > 1e-8) {
          steerX += alignmentX / alignmentLength * COMBAT_STEERING_ALIGNMENT_WEIGHT;
          steerZ += alignmentZ / alignmentLength * COMBAT_STEERING_ALIGNMENT_WEIGHT;
        }
        const cohesionLength = Math.hypot(cohesionX, cohesionZ);
        if (cohesionLength > 1e-8) {
          steerX += cohesionX / cohesionLength * COMBAT_STEERING_COHESION_WEIGHT;
          steerZ += cohesionZ / cohesionLength * COMBAT_STEERING_COHESION_WEIGHT;
        }
      }

      const steerLength = Math.hypot(steerX, steerZ);
      let desiredVelocityX = 0;
      let desiredVelocityZ = 0;
      if (steerLength > 1e-8) {
        const separationPressure = Math.hypot(separationX, separationZ)
          + Math.hypot(predictiveX, predictiveZ);
        const flockPressure = companyNeighbors > 0
          ? COMBAT_STEERING_ALIGNMENT_WEIGHT + COMBAT_STEERING_COHESION_WEIGHT
          : 0;
        const motionSpeed = preferredLength > 1e-8
          ? Math.min(agent.steeringSpeed, preferredLength)
          : Math.min(
            agent.steeringSpeed * 0.45,
            (separationPressure + flockPressure) * agent.steeringSpeed,
          );
        desiredVelocityX = steerX / steerLength * motionSpeed;
        desiredVelocityZ = steerZ / steerLength * motionSpeed;
      }

      const response = 1 - Math.exp(
        -dt * COMBAT_STEERING_VELOCITY_RESPONSE_PER_SECOND,
      );
      let velocityX = agent.steeringVelocityX
        + (desiredVelocityX - agent.steeringVelocityX) * response;
      let velocityZ = agent.steeringVelocityZ
        + (desiredVelocityZ - agent.steeringVelocityZ) * response;
      const oldSpeed = Math.hypot(agent.steeringVelocityX, agent.steeringVelocityZ);
      const newSpeed = Math.hypot(velocityX, velocityZ);
      if (oldSpeed > 1e-7 && newSpeed > 1e-7) {
        const oldAngle = Math.atan2(agent.steeringVelocityZ, agent.steeringVelocityX);
        const newAngle = Math.atan2(velocityZ, velocityX);
        const angleDelta = wrappedAngle(newAngle - oldAngle);
        const maxTurn = COMBAT_STEERING_MAX_TURN_RADIANS_PER_SECOND * dt;
        if (Math.abs(angleDelta) > maxTurn) {
          const limitedAngle = oldAngle + Math.sign(angleDelta) * maxTurn;
          velocityX = Math.cos(limitedAngle) * newSpeed;
          velocityZ = Math.sin(limitedAngle) * newSpeed;
        }
      }

      this.nextVelocityX[index] = velocityX;
      this.nextVelocityZ[index] = velocityZ;
      this.nextX[index] = clamp(x + velocityX * dt, bounds.minX, bounds.maxX);
      this.nextZ[index] = clamp(z + velocityZ * dt, bounds.minZ, bounds.maxZ);
    }

    this.applyHardSweptConstraints(agents, activeCount, dt, bounds);

    for (let index = 0; index < activeCount; index += 1) {
      const agent = agents[index]!;
      agent.steeringVelocityX = this.nextVelocityX[index]!;
      agent.steeringVelocityZ = this.nextVelocityZ[index]!;
      agent.state.x = this.nextX[index]!;
      agent.state.z = this.nextZ[index]!;
    }
  }

  private bucketFor(cellX: number, cellZ: number): number {
    return (
      Math.imul(cellX, 73_856_093)
      ^ Math.imul(cellZ, 19_349_663)
    ) & this.bucketMask;
  }

  /**
   * Projects candidate relative trajectories onto deterministic collision-free
   * tangent rays. This is a real canonical position/velocity constraint, not a
   * presentation offset: a pair cannot tunnel through and exchange sides
   * between simulation ticks. Fixed passes and fixed-size top-K scratch keep
   * the hot path allocation-free and mirrorable by the Rust reducer.
   */
  private applyHardSweptConstraints(
    agents: readonly CombatSteeringAgent[],
    activeCount: number,
    dt: number,
    bounds: CombatSteeringBounds,
  ): void {
    for (
      let iteration = 0;
      iteration < COMBAT_STEERING_HARD_CONSTRAINT_ITERATIONS;
      iteration += 1
    ) {
      if (iteration > 0) this.rebuildGridFromCandidatePositions(agents, activeCount);
      for (let index = 0; index < activeCount; index += 1) {
        const agent = agents[index]!;
        if (!agent.steeringEnabled) continue;

        for (
          let cellDeltaZ = -NEIGHBOR_CELL_RADIUS;
          cellDeltaZ <= NEIGHBOR_CELL_RADIUS;
          cellDeltaZ += 1
        ) {
          const neighborCellZ = this.cellZ[index]! + cellDeltaZ;
          for (
            let cellDeltaX = -NEIGHBOR_CELL_RADIUS;
            cellDeltaX <= NEIGHBOR_CELL_RADIUS;
            cellDeltaX += 1
          ) {
            const neighborCellX = this.cellX[index]! + cellDeltaX;
            let neighbor = this.bucketHeads[this.bucketFor(neighborCellX, neighborCellZ)]!;
            while (neighbor >= 0) {
              if (
                neighbor > index
                && agents[neighbor]!.steeringEnabled
                && this.cellX[neighbor] === neighborCellX
                && this.cellZ[neighbor] === neighborCellZ
              ) {
                // Hard correctness cannot share the soft steering's bounded
                // influence set: every local swept/penetrating pair is a
                // physical constraint, even in a 64-body pile-up.
                this.projectHardPair(agents, index, neighbor, bounds);
              }
              neighbor = this.next[neighbor]!;
            }
          }
        }
      }
    }

    this.enforceFinalCandidateClearance(agents, activeCount, bounds);

    // Persist the constrained displacement as velocity. Prediction on the next
    // tick therefore sees the actual canonical motion, not the rejected soft
    // candidate velocity.
    for (let index = 0; index < activeCount; index += 1) {
      const agent = agents[index]!;
      if (!agent.steeringEnabled) continue;
      this.nextVelocityX[index] = (this.nextX[index]! - agent.state.x) / dt;
      this.nextVelocityZ[index] = (this.nextZ[index]! - agent.state.z) / dt;
    }
  }

  private rebuildGridFromCandidatePositions(
    agents: readonly CombatSteeringAgent[],
    activeCount: number,
  ): void {
    this.bucketHeads.fill(-1);
    for (let index = 0; index < activeCount; index += 1) {
      if (!agents[index]!.steeringEnabled) {
        this.next[index] = -1;
        continue;
      }
      const cellX = Math.floor(this.nextX[index]! / COMBAT_STEERING_CELL_SIZE_M);
      const cellZ = Math.floor(this.nextZ[index]! / COMBAT_STEERING_CELL_SIZE_M);
      const bucket = this.bucketFor(cellX, cellZ);
      this.cellX[index] = cellX;
      this.cellZ[index] = cellZ;
      this.next[index] = this.bucketHeads[bucket]!;
      this.bucketHeads[bucket] = index;
    }
  }

  /**
   * Pathological imports and same-point spawns can begin with more mutually
   * penetrating constraints than a short PBD cleanup can converge. Finalize
   * bodies in stable order into an incremental output-position grid; blocked
   * candidates probe deterministic concentric slots until they find a point
   * clear of every already finalized body. Ordinary valid formations accept
   * their first candidate and pay one local query per soldier.
   */
  private enforceFinalCandidateClearance(
    agents: readonly CombatSteeringAgent[],
    activeCount: number,
    bounds: CombatSteeringBounds,
  ): void {
    this.bucketHeads.fill(-1);
    const slotsPerRing = COMBAT_STEERING_MAX_NEIGHBORS;
    const maximumAttempts = Math.max(slotsPerRing, activeCount * slotsPerRing);
    for (let index = 0; index < activeCount; index += 1) {
      const agent = agents[index]!;
      if (!agent.steeringEnabled) {
        this.next[index] = -1;
        continue;
      }
      const originX = this.nextX[index]!;
      const originZ = this.nextZ[index]!;
      let candidateX = originX;
      let candidateZ = originZ;
      let attempt = 0;
      while (
        !this.candidateClearsPlacedBodies(candidateX, candidateZ)
        && attempt < maximumAttempts
      ) {
        const ring = Math.floor(attempt / slotsPerRing) + 1;
        const slot = attempt % slotsPerRing;
        const phase = mixSeed(agent.steeringSeed) % slotsPerRing;
        const angle = (slot + phase) / slotsPerRing * Math.PI * 2;
        const radius = ring * HARD_SEPARATION_DISTANCE_M;
        candidateX = clamp(originX + Math.cos(angle) * radius, bounds.minX, bounds.maxX);
        candidateZ = clamp(originZ + Math.sin(angle) * radius, bounds.minZ, bounds.maxZ);
        attempt += 1;
      }
      this.nextX[index] = candidateX;
      this.nextZ[index] = candidateZ;
      const cellX = Math.floor(candidateX / COMBAT_STEERING_CELL_SIZE_M);
      const cellZ = Math.floor(candidateZ / COMBAT_STEERING_CELL_SIZE_M);
      const bucket = this.bucketFor(cellX, cellZ);
      this.cellX[index] = cellX;
      this.cellZ[index] = cellZ;
      this.next[index] = this.bucketHeads[bucket]!;
      this.bucketHeads[bucket] = index;
    }
  }

  private candidateClearsPlacedBodies(candidateX: number, candidateZ: number): boolean {
    const candidateCellX = Math.floor(candidateX / COMBAT_STEERING_CELL_SIZE_M);
    const candidateCellZ = Math.floor(candidateZ / COMBAT_STEERING_CELL_SIZE_M);
    for (
      let cellDeltaZ = -NEIGHBOR_CELL_RADIUS;
      cellDeltaZ <= NEIGHBOR_CELL_RADIUS;
      cellDeltaZ += 1
    ) {
      const neighborCellZ = candidateCellZ + cellDeltaZ;
      for (
        let cellDeltaX = -NEIGHBOR_CELL_RADIUS;
        cellDeltaX <= NEIGHBOR_CELL_RADIUS;
        cellDeltaX += 1
      ) {
        const neighborCellX = candidateCellX + cellDeltaX;
        let neighbor = this.bucketHeads[this.bucketFor(neighborCellX, neighborCellZ)]!;
        while (neighbor >= 0) {
          if (
            this.cellX[neighbor] === neighborCellX
            && this.cellZ[neighbor] === neighborCellZ
          ) {
            const deltaX = candidateX - this.nextX[neighbor]!;
            const deltaZ = candidateZ - this.nextZ[neighbor]!;
            if (deltaX * deltaX + deltaZ * deltaZ < HARD_SEPARATION_DISTANCE_SQ) {
              return false;
            }
          }
          neighbor = this.next[neighbor]!;
        }
      }
    }
    return true;
  }

  private projectHardPair(
    agents: readonly CombatSteeringAgent[],
    left: number,
    right: number,
    bounds: CombatSteeringBounds,
  ): void {
    const leftAgent = agents[left]!;
    const rightAgent = agents[right]!;
    let startDeltaX = leftAgent.state.x - rightAgent.state.x;
    let startDeltaZ = leftAgent.state.z - rightAgent.state.z;
    const startDistanceSq = startDeltaX * startDeltaX + startDeltaZ * startDeltaZ;
    let startDistance = Math.sqrt(startDistanceSq);

    if (startDistanceSq <= COMBAT_STEERING_EXACT_OVERLAP_EPSILON_SQ) {
      const angle = exactOverlapAngle(
        leftAgent.steeringSeed,
        rightAgent.steeringSeed,
        left,
        right,
      );
      startDeltaX = Math.cos(angle);
      startDeltaZ = Math.sin(angle);
      startDistance = 1;
    }
    const normalX = startDeltaX / startDistance;
    const normalZ = startDeltaZ / startDistance;
    const endDeltaX = this.nextX[left]! - this.nextX[right]!;
    const endDeltaZ = this.nextZ[left]! - this.nextZ[right]!;
    let correctionX = 0;
    let correctionZ = 0;

    if (startDistanceSq < HARD_SEPARATION_DISTANCE_SQ) {
      // When imported/spawned bodies already penetrate, retain their original
      // radial ordering and move the final pair onto the safe half-plane.
      const projectedDistance = endDeltaX * normalX + endDeltaZ * normalZ;
      const required = HARD_SEPARATION_DISTANCE_M - projectedDistance;
      if (required <= 0) return;
      correctionX = normalX * required;
      correctionZ = normalZ * required;
    } else {
      const relativeStepX = endDeltaX - startDeltaX;
      const relativeStepZ = endDeltaZ - startDeltaZ;
      const relativeStepSq = relativeStepX * relativeStepX
        + relativeStepZ * relativeStepZ;
      if (relativeStepSq <= 1e-12) return;
      const closestTime = clamp(
        -(startDeltaX * relativeStepX + startDeltaZ * relativeStepZ) / relativeStepSq,
        0,
        1,
      );
      const closestX = startDeltaX + relativeStepX * closestTime;
      const closestZ = startDeltaZ + relativeStepZ * closestTime;
      if (closestX * closestX + closestZ * closestZ >= HARD_SEPARATION_DISTANCE_SQ) return;

      // The deterministic side makes both implementations select the same
      // boundary of the relative-velocity obstacle. Projecting onto the
      // positive tangent ray preserves forward progress without tunnelling.
      const radiusRatio = clamp(HARD_SEPARATION_DISTANCE_M / startDistance, 0, 1);
      const inwardFactor = Math.sqrt(Math.max(0, 1 - radiusRatio * radiusRatio));
      const side = pairPassingSide(leftAgent.steeringSeed, rightAgent.steeringSeed);
      const perpendicularX = -normalZ * side;
      const perpendicularZ = normalX * side;
      const tangentX = -normalX * inwardFactor + perpendicularX * radiusRatio;
      const tangentZ = -normalZ * inwardFactor + perpendicularZ * radiusRatio;
      const along = Math.max(0, relativeStepX * tangentX + relativeStepZ * tangentZ);
      correctionX = tangentX * along - relativeStepX;
      correctionZ = tangentZ * along - relativeStepZ;
    }

    const halfCorrectionX = correctionX * 0.5;
    const halfCorrectionZ = correctionZ * 0.5;
    this.nextX[left] = clamp(
      this.nextX[left]! + halfCorrectionX,
      bounds.minX,
      bounds.maxX,
    );
    this.nextZ[left] = clamp(
      this.nextZ[left]! + halfCorrectionZ,
      bounds.minZ,
      bounds.maxZ,
    );
    this.nextX[right] = clamp(
      this.nextX[right]! - halfCorrectionX,
      bounds.minX,
      bounds.maxX,
    );
    this.nextZ[right] = clamp(
      this.nextZ[right]! - halfCorrectionZ,
      bounds.minZ,
      bounds.maxZ,
    );
  }
}

/** Stable ring angle used to spread melee attackers around a target. */
export function engagementSlotAngle(
  sourceSlot: number,
  companySeed: number,
  targetSeed: number,
): number {
  const phase = mixSeed(companySeed ^ Math.imul(targetSeed, 0x9e37_79b1))
    % COMBAT_STEERING_ENGAGEMENT_SLOT_COUNT;
  const rank = Math.max(0, Math.floor(sourceSlot));
  const ring = Math.floor(rank / COMBAT_STEERING_ENGAGEMENT_SLOT_COUNT);
  const slot = rank % COMBAT_STEERING_ENGAGEMENT_SLOT_COUNT;
  const stagger = ring % 2 === 1 ? 0.5 : 0;
  return (slot + phase + stagger) / COMBAT_STEERING_ENGAGEMENT_SLOT_COUNT
    * Math.PI * 2;
}

export function engagementSlotRadius(weaponRange: number, sourceSlot = 0): number {
  const rank = Math.max(0, Math.floor(sourceSlot));
  const ring = Math.floor(rank / COMBAT_STEERING_ENGAGEMENT_SLOT_COUNT);
  return Math.max(
    COMBAT_STEERING_ENGAGEMENT_MIN_RADIUS_M,
    weaponRange * COMBAT_STEERING_ENGAGEMENT_RADIUS_FACTOR,
  ) + ring * COMBAT_STEERING_ENGAGEMENT_RING_SPACING_M;
}

/** Stable line slot used by bow and crossbow companies while firing. */
export function rangedLineLateral(
  sourceSlot: number,
  companySize: number,
): number {
  const columns = Math.max(2, Math.min(8, Math.ceil(Math.sqrt(Math.max(1, companySize) * 2))));
  const column = sourceSlot % columns;
  return (column - (columns - 1) * 0.5) * COMBAT_STEERING_RANGED_LINE_SPACING_M;
}

export function rangedLineDepth(sourceSlot: number, companySize: number): number {
  const columns = Math.max(2, Math.min(8, Math.ceil(Math.sqrt(Math.max(1, companySize) * 2))));
  return Math.floor(sourceSlot / columns) * COMBAT_STEERING_RANGED_DEPTH_SPACING_M;
}

export function rangedPreferredDistance(range: number): number {
  return range * COMBAT_STEERING_RANGED_PREFERRED_RANGE_FACTOR;
}

function exactOverlapAngle(
  leftSeed: number,
  rightSeed: number,
  leftIndex: number,
  rightIndex: number,
): number {
  const leftFirst = leftSeed === rightSeed ? leftIndex < rightIndex : leftSeed < rightSeed;
  const low = leftFirst ? leftSeed : rightSeed;
  const high = leftFirst ? rightSeed : leftSeed;
  const angle = mixSeed(low ^ Math.imul(high, 0x9e37_79b1)) / 0x1_0000_0000
    * Math.PI * 2;
  return leftFirst ? angle : angle + Math.PI;
}

function mixSeed(value: number): number {
  let mixed = value >>> 0;
  mixed = Math.imul(mixed ^ (mixed >>> 16), 0x85eb_ca6b) >>> 0;
  mixed = Math.imul(mixed ^ (mixed >>> 13), 0xc2b2_ae35) >>> 0;
  mixed ^= mixed >>> 16;
  return mixed >>> 0;
}

function pairPassingSide(leftSeed: number, rightSeed: number): number {
  const lowSeed = Math.min(leftSeed, rightSeed);
  const highSeed = Math.max(leftSeed, rightSeed);
  return (mixSeed(lowSeed ^ Math.imul(highSeed, 0x9e37_79b1)) & 1) === 0 ? -1 : 1;
}

function wrappedAngle(value: number): number {
  return Math.atan2(Math.sin(value), Math.cos(value));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
