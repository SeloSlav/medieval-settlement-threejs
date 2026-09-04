import type { CombatAgentState } from '../security/combatAgents.ts';

type MotionSample = Pick<CombatAgentState, 'x' | 'z' | 'velocityX' | 'velocityZ' | 'status'>;
export type CombatMotion = {
  x: number;
  z: number;
  velocityX: number;
  velocityZ: number;
  age: number;
  receivedAt: number;
  simulationRate: number;
  cadenceScale: number;
  calibrateCadence: boolean;
  started: boolean;
  /** Continuous rendered position and velocity; packets never reset them. */
  targetX: number;
  targetZ: number;
  renderVelocityX: number;
  renderVelocityZ: number;
};

export const COMBAT_PREDICTION_SECONDS = 0.6;
const MOTION_RESPONSE = 8;

/** Server velocity is displacement per simulation second, not per real second.
 * Measure the actual clock rate: a nominal 200 ms heartbeat can take 250 ms
 * under load. Nominal-rate prediction causes repeated backward corrections. */
export function receiveCombatMotion(
  sample: MotionSample,
  prior?: CombatMotion,
  receivedAt = performance.now() / 1000,
): CombatMotion {
  // Holding includes camp patrols; fighting includes pursuit and separation.
  // The final server writer reports zero velocity for stationary actors.
  const moving = sample.status !== 'downed' && sample.status !== 'recovering';
  const vx = moving && Number.isFinite(sample.velocityX) ? sample.velocityX! : 0;
  const vz = moving && Number.isFinite(sample.velocityZ) ? sample.velocityZ! : 0;
  if (!prior) return {
    x: sample.x, z: sample.z, velocityX: vx, velocityZ: vz, age: 0, receivedAt,
    simulationRate: 0, cadenceScale: 1, calibrateCadence: true, started: false,
    targetX: sample.x, targetZ: sample.z, renderVelocityX: 0, renderVelocityZ: 0,
  };
  if (prior.x === sample.x && prior.z === sample.z
    && prior.velocityX === vx && prior.velocityZ === vz) return prior;
  const interval = receivedAt - prior.receivedAt;
  const speed = Math.hypot(vx, vz);
  const oldSpeed = Math.hypot(prior.velocityX, prior.velocityZ);
  const dx = sample.x - prior.x;
  const dz = sample.z - prior.z;
  const distance = Math.hypot(dx, dz);
  if (prior.calibrateCadence && prior.simulationRate > 0 && interval >= 0.08 && interval <= 1
    && speed > 0.1 && oldSpeed > 0.1 && distance > 0.01
    && (vx * prior.velocityX + vz * prior.velocityZ) / (speed * oldSpeed) > 0.95
    && Math.abs(speed - oldSpeed) < speed * 0.1) {
    const scale = distance / (speed * prior.simulationRate * interval);
    // Ignore teleports, reversals, speed orders and bursts when calibrating.
    if (scale >= 0.4 && scale <= 1.25) {
      prior.cadenceScale += (scale - prior.cadenceScale) * (1 - Math.exp(-interval * 1.5));
    }
  }
  prior.calibrateCadence = true;
  prior.x = sample.x;
  prior.z = sample.z;
  prior.velocityX = vx;
  prior.velocityZ = vz;
  prior.age = 0;
  prior.receivedAt = receivedAt;
  return prior;
}

/** An analytic critically damped spring follows the moving prediction.
 * Position and velocity survive packet arrivals, so corrections cannot snap
 * bodies or restart their stride. No snapshot buffer adds input latency. */
export function advanceCombatMotion(motion: CombatMotion, realDt: number, simulationRate: number): void {
  if (realDt <= 0 || simulationRate <= 0) return;
  if (motion.simulationRate > 0 && motion.simulationRate !== simulationRate) {
    motion.calibrateCadence = false;
  }
  motion.simulationRate = simulationRate;
  const rate = simulationRate * motion.cadenceScale;
  const vx = motion.velocityX * rate;
  const vz = motion.velocityZ * rate;
  if (!motion.started) {
    motion.renderVelocityX = vx;
    motion.renderVelocityZ = vz;
    motion.started = true;
  }
  const predictionDt = Math.min(realDt, Math.max(0, COMBAT_PREDICTION_SECONDS - motion.age));
  if (predictionDt > 0) {
    integrateMotion(motion, predictionDt, motion.x + vx * motion.age, motion.z + vz * motion.age, vx, vz);
  }
  if (realDt > predictionDt) {
    integrateMotion(motion, realDt - predictionDt,
      motion.x + vx * COMBAT_PREDICTION_SECONDS, motion.z + vz * COMBAT_PREDICTION_SECONDS, 0, 0);
  }
  motion.age = Math.min(COMBAT_PREDICTION_SECONDS, motion.age + realDt);
}

function integrateMotion(m: CombatMotion, dt: number, x: number, z: number, vx: number, vz: number): void {
  const decay = Math.exp(-MOTION_RESPONSE * dt);
  const ex = m.targetX - x;
  const ez = m.targetZ - z;
  const cx = m.renderVelocityX - vx + MOTION_RESPONSE * ex;
  const cz = m.renderVelocityZ - vz + MOTION_RESPONSE * ez;
  m.targetX = x + vx * dt + (ex + cx * dt) * decay;
  m.targetZ = z + vz * dt + (ez + cz * dt) * decay;
  m.renderVelocityX = vx + (m.renderVelocityX - vx - MOTION_RESPONSE * cx * dt) * decay;
  m.renderVelocityZ = vz + (m.renderVelocityZ - vz - MOTION_RESPONSE * cz * dt) * decay;
}

export type CombatLocomotion = 'idle' | 'walk' | 'run';
export function combatLocomotion(speed: number, current: CombatLocomotion = 'idle'): CombatLocomotion {
  if (speed > (current === 'run' ? 1.7 : 2.05)) return 'run';
  if (speed > (current === 'walk' ? 0.07 : 0.15)) return 'walk';
  return 'idle';
}

/** The crowd mixer advances in paced seconds, just like local villagers. */
export function combatAnimationMovementSpeed(realSpeed: number, animationRate: number): number {
  return animationRate > 0 ? Math.max(0, realSpeed) / animationRate : 0;
}
