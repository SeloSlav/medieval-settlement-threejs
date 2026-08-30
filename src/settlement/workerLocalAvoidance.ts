const CELL_SIZE_M = 0.72;
const SEPARATION_DISTANCE_M = 0.58;
const SEPARATION_DISTANCE_SQ = SEPARATION_DISTANCE_M * SEPARATION_DISTANCE_M;
const RESPONSE_PER_SECOND = 16;
const RETURN_PER_SECOND = 10;
const EXACT_OVERLAP_EPSILON_SQ = 1e-8;
const MAX_NEIGHBORS_PER_AGENT = 12;

export const WORKER_AVOIDANCE_MAX_OFFSET_M = 0.24;

export type WorkerAvoidanceAgent = {
  x: number;
  z: number;
  appearanceSeed: number;
  avoidanceOffsetX: number;
  avoidanceOffsetZ: number;
};

/**
 * Allocation-free local separation for the worker presentation layer.
 *
 * Simulation routes remain authoritative. This system only adds a small,
 * smoothed render offset, so avoiding a neighbour cannot change path
 * completion, work timing, or deterministic economy state. A fixed spatial
 * hash keeps each update proportional to the workers and their nearby crowd,
 * rather than comparing every worker with every other worker.
 */
export class WorkerLocalAvoidance {
  private readonly capacity: number;
  private readonly bucketMask: number;
  private readonly bucketHeads: Int32Array;
  private readonly next: Int32Array;
  private readonly cellX: Int32Array;
  private readonly cellZ: Int32Array;
  private readonly pushX: Float32Array;
  private readonly pushZ: Float32Array;

  constructor(capacity = 1_024) {
    this.capacity = Math.max(1, Math.floor(capacity));
    let bucketCount = 1;
    while (bucketCount < this.capacity * 2) bucketCount *= 2;
    this.bucketMask = bucketCount - 1;
    this.bucketHeads = new Int32Array(bucketCount);
    this.next = new Int32Array(this.capacity);
    this.cellX = new Int32Array(this.capacity);
    this.cellZ = new Int32Array(this.capacity);
    this.pushX = new Float32Array(this.capacity);
    this.pushZ = new Float32Array(this.capacity);
  }

  update(agents: readonly WorkerAvoidanceAgent[], dtSeconds: number): void {
    const count = Math.min(agents.length, this.capacity);
    if (count === 0 || !Number.isFinite(dtSeconds) || dtSeconds <= 0) return;

    this.bucketHeads.fill(-1);
    this.pushX.fill(0, 0, count);
    this.pushZ.fill(0, 0, count);

    for (let index = 0; index < count; index += 1) {
      const agent = agents[index];
      const x = agent.x + agent.avoidanceOffsetX;
      const z = agent.z + agent.avoidanceOffsetZ;
      const cellX = Math.floor(x / CELL_SIZE_M);
      const cellZ = Math.floor(z / CELL_SIZE_M);
      const bucket = this.bucketFor(cellX, cellZ);
      this.cellX[index] = cellX;
      this.cellZ[index] = cellZ;
      this.next[index] = this.bucketHeads[bucket];
      this.bucketHeads[bucket] = index;
    }

    for (let index = 0; index < count; index += 1) {
      const agent = agents[index];
      const x = agent.x + agent.avoidanceOffsetX;
      const z = agent.z + agent.avoidanceOffsetZ;
      const originCellX = this.cellX[index];
      const originCellZ = this.cellZ[index];

      let acceptedNeighbors = 0;
      neighborCells: for (let dz = -1; dz <= 1; dz += 1) {
        const neighborCellZ = originCellZ + dz;
        for (let dx = -1; dx <= 1; dx += 1) {
          const neighborCellX = originCellX + dx;
          let neighbor = this.bucketHeads[this.bucketFor(neighborCellX, neighborCellZ)];
          while (neighbor >= 0) {
            if (
              neighbor > index
              && this.cellX[neighbor] === neighborCellX
              && this.cellZ[neighbor] === neighborCellZ
            ) {
              const other = agents[neighbor];
              const deltaX = x - (other.x + other.avoidanceOffsetX);
              const deltaZ = z - (other.z + other.avoidanceOffsetZ);
              const distanceSq = deltaX * deltaX + deltaZ * deltaZ;
              if (distanceSq < SEPARATION_DISTANCE_SQ) {
                let directionX: number;
                let directionZ: number;
                let strength: number;
                if (distanceSq <= EXACT_OVERLAP_EPSILON_SQ) {
                  const angle = exactOverlapAngle(
                    agent.appearanceSeed,
                    other.appearanceSeed,
                  );
                  directionX = Math.cos(angle);
                  directionZ = Math.sin(angle);
                  strength = 1;
                } else {
                  const distance = Math.sqrt(distanceSq);
                  const inverseDistance = 1 / distance;
                  directionX = deltaX * inverseDistance;
                  directionZ = deltaZ * inverseDistance;
                  strength = 1 - distance / SEPARATION_DISTANCE_M;
                }
                const separationX = directionX * strength;
                const separationZ = directionZ * strength;
                this.pushX[index] += separationX;
                this.pushZ[index] += separationZ;
                this.pushX[neighbor] -= separationX;
                this.pushZ[neighbor] -= separationZ;
                acceptedNeighbors += 1;
                if (acceptedNeighbors >= MAX_NEIGHBORS_PER_AGENT) {
                  break neighborCells;
                }
              }
            }
            neighbor = this.next[neighbor];
          }
        }
      }
    }

    const responseBlend = 1 - Math.exp(-Math.min(dtSeconds, 0.1) * RESPONSE_PER_SECOND);
    const returnBlend = 1 - Math.exp(-Math.min(dtSeconds, 0.1) * RETURN_PER_SECOND);
    for (let index = 0; index < count; index += 1) {
      const agent = agents[index];
      let targetX = this.pushX[index];
      let targetZ = this.pushZ[index];
      const targetLengthSq = targetX * targetX + targetZ * targetZ;
      if (targetLengthSq > 1e-10) {
        const scale = WORKER_AVOIDANCE_MAX_OFFSET_M / Math.max(
          WORKER_AVOIDANCE_MAX_OFFSET_M,
          Math.sqrt(targetLengthSq),
        );
        targetX *= scale;
        targetZ *= scale;
      }
      const blend = targetLengthSq > 1e-10 ? responseBlend : returnBlend;
      agent.avoidanceOffsetX += (targetX - agent.avoidanceOffsetX) * blend;
      agent.avoidanceOffsetZ += (targetZ - agent.avoidanceOffsetZ) * blend;
      if (
        targetLengthSq <= 1e-10
        && agent.avoidanceOffsetX * agent.avoidanceOffsetX
          + agent.avoidanceOffsetZ * agent.avoidanceOffsetZ < 1e-8
      ) {
        agent.avoidanceOffsetX = 0;
        agent.avoidanceOffsetZ = 0;
      }
    }
  }

  private bucketFor(cellX: number, cellZ: number): number {
    return (
      Math.imul(cellX, 73_856_093)
      ^ Math.imul(cellZ, 19_349_663)
    ) & this.bucketMask;
  }
}

function exactOverlapAngle(leftSeed: number, rightSeed: number): number {
  let mixed = (leftSeed ^ Math.imul(rightSeed, 0x9e3779b1)) >>> 0;
  mixed = Math.imul(mixed ^ (mixed >>> 16), 0x85ebca6b) >>> 0;
  mixed = Math.imul(mixed ^ (mixed >>> 13), 0xc2b2ae35) >>> 0;
  mixed ^= mixed >>> 16;
  return (mixed >>> 0) / 0x1_0000_0000 * Math.PI * 2;
}
