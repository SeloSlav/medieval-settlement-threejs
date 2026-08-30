import assert from 'node:assert/strict';
import {
  WorkerLocalAvoidance,
  WORKER_AVOIDANCE_MAX_OFFSET_M,
  type WorkerAvoidanceAgent,
} from '../src/settlement/workerLocalAvoidance.ts';

function worker(
  x: number,
  z: number,
  appearanceSeed: number,
): WorkerAvoidanceAgent {
  return {
    x,
    z,
    appearanceSeed,
    avoidanceOffsetX: 0,
    avoidanceOffsetZ: 0,
  };
}

const solver = new WorkerLocalAvoidance(16);
const overlapped = [worker(0, 0, 11), worker(0, 0, 29)];
for (let frame = 0; frame < 60; frame += 1) {
  solver.update(overlapped, 1 / 60);
}
const overlapSeparation = Math.hypot(
  overlapped[0].avoidanceOffsetX - overlapped[1].avoidanceOffsetX,
  overlapped[0].avoidanceOffsetZ - overlapped[1].avoidanceOffsetZ,
);
assert.ok(
  overlapSeparation > 0.4,
  `exactly overlapped workers only separated by ${overlapSeparation.toFixed(3)} m`,
);

for (const agent of overlapped) {
  assert.ok(
    Math.hypot(agent.avoidanceOffsetX, agent.avoidanceOffsetZ)
      <= WORKER_AVOIDANCE_MAX_OFFSET_M + 1e-6,
    'avoidance must stay inside the static-route clearance budget',
  );
}

const deterministicA = [worker(0, 0, 101), worker(0, 0, 202), worker(0, 0, 303)];
const deterministicB = deterministicA.map((agent) => worker(
  agent.x,
  agent.z,
  agent.appearanceSeed,
));
const solverA = new WorkerLocalAvoidance(4);
const solverB = new WorkerLocalAvoidance(4);
for (let frame = 0; frame < 30; frame += 1) {
  solverA.update(deterministicA, 1 / 60);
  solverB.update(deterministicB, 1 / 60);
}
assert.deepEqual(
  deterministicA,
  deterministicB,
  'identical worker states must produce deterministic fan-out offsets',
);
assert.equal(
  new Set(deterministicA.map((agent) => (
    `${agent.avoidanceOffsetX.toFixed(4)}:${agent.avoidanceOffsetZ.toFixed(4)}`
  ))).size,
  deterministicA.length,
  'a pile-up must fan out instead of assigning every worker the same offset',
);

overlapped[1].x = 10;
overlapped[1].z = 10;
for (let frame = 0; frame < 60; frame += 1) {
  solver.update(overlapped, 1 / 60);
}
assert.ok(
  Math.hypot(overlapped[0].avoidanceOffsetX, overlapped[0].avoidanceOffsetZ) < 0.001,
  'a worker must smoothly return to its authored path after the neighbour clears',
);

const scaleAgents = Array.from({ length: 1_024 }, (_, index) => worker(
  (index % 32) * 0.7,
  Math.floor(index / 32) * 0.7,
  Math.imul(index + 1, 0x9e3779b1),
));
const scaleSolver = new WorkerLocalAvoidance(scaleAgents.length);
for (let warmup = 0; warmup < 20; warmup += 1) {
  scaleSolver.update(scaleAgents, 1 / 60);
}
const started = performance.now();
for (let frame = 0; frame < 500; frame += 1) {
  scaleSolver.update(scaleAgents, 1 / 60);
}
const elapsedMs = performance.now() - started;
assert.ok(
  elapsedMs < 500,
  `500 avoidance frames for 1,024 workers took ${elapsedMs.toFixed(1)} ms`,
);

// A pathing failure or mass rally can temporarily put every worker in one
// cell. The neighbour cap must keep that pathological case bounded too.
for (const agent of scaleAgents) {
  agent.x = 0;
  agent.z = 0;
  agent.avoidanceOffsetX = 0;
  agent.avoidanceOffsetZ = 0;
}
const pileupStarted = performance.now();
for (let frame = 0; frame < 500; frame += 1) {
  scaleSolver.update(scaleAgents, 1 / 60);
}
const pileupElapsedMs = performance.now() - pileupStarted;
assert.ok(
  pileupElapsedMs < 500,
  `500 worst-case pile-up frames took ${pileupElapsedMs.toFixed(1)} ms`,
);

console.log(
  `test:worker-local-avoidance passed (${elapsedMs.toFixed(1)} ms spread, ${
    pileupElapsedMs.toFixed(1)
  } ms pile-up / 500 frames / 1,024 workers)`,
);
