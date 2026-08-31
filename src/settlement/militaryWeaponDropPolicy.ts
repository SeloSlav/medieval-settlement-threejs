import type { CombatAgentStatus } from '../security/combatAgents.ts';
import {
  isMilitaryEquipmentKind,
  type MilitaryEquipmentKind,
} from './militaryEquipment.ts';

/**
 * A held weapon becomes a ground-owned battlefield object only after the
 * authoritative combatant reaches `downed`. Animation names (including hurt
 * and fall), low health, locomotion, or a temporary reaction never detach it.
 */
export function shouldCreateBattlefieldWeaponDrop(
  status: CombatAgentStatus,
  tool: string | null,
): tool is MilitaryEquipmentKind {
  return status === 'downed'
    && tool !== null
    && isMilitaryEquipmentKind(tool);
}
