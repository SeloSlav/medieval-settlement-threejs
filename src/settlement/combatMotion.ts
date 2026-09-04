import type { CombatAgentState } from '../security/combatAgents.ts';
import { SIM_TICK_SECONDS } from '../generated/gameBalance.ts';

type MotionSample = Pick<CombatAgentState, 'x' | 'z' | 'velocityX' | 'velocityZ' | 'status'>;
export type CombatMotion = {
  x: number;
  z: number;
  velocityX: number;
  velocityZ: number;
  age: number;
  targetX: number;
  targetZ: number;
};

export const COMBAT_PREDICTION_SECONDS = SIM_TICK_SECONDS * 1.5;

/** Replicated velocity is in simulation metres/second. Keep it between
 * snapshots so actors don't ease to a stop five times every second. */
export function receiveCombatMotion(sample: MotionSample, prior?: CombatMotion): CombatMotion {
  const moving = sample.status === 'advancing' || sample.status === 'retreating'
    || sample.status === 'returning' || sample.status === 'mustering'
    || sample.status === 'wounded-returning' || sample.status === 'fighting';
  // Contact can still include pursuit movement (a dog biting a fleeing fox).
  // Final server steering reports zero velocity when a fighter actually stops.
  const vx = moving && Number.isFinite(sample.velocityX) ? sample.velocityX! : 0;
  const vz = moving && Number.isFinite(sample.velocityZ) ? sample.velocityZ! : 0;
  if (prior && prior.x === sample.x && prior.z === sample.z
    && prior.velocityX === vx && prior.velocityZ === vz) return prior;
  const motion = prior ?? { x: 0, z: 0, velocityX: 0, velocityZ: 0, age: 0, targetX: 0, targetZ: 0 };
  motion.x = sample.x;
  motion.z = sample.z;
  motion.velocityX = vx;
  motion.velocityZ = vz;
  motion.age = 0;
  motion.targetX = sample.x;
  motion.targetZ = sample.z;
  return motion;
}

export function advanceCombatMotion(motion: CombatMotion, realDt: number, simulationRate: number): void {
  if (realDt <= 0 || simulationRate <= 0) return;
  motion.age = Math.min(COMBAT_PREDICTION_SECONDS, motion.age + realDt);
  motion.targetX = motion.x + motion.velocityX * motion.age * simulationRate;
  motion.targetZ = motion.z + motion.velocityZ * motion.age * simulationRate;
}
