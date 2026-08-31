import type {
  CombatAgentFaction,
  CombatAgentState,
} from './combatAgents.ts';
import {
  MILITARY_RECRUITMENT,
  type MilitaryCompanyKind,
} from './militaryProgression.ts';

export const MILITARY_COMPANY_STRATEGIC_ICON_ART = {
  militia: '/assets/ui/icons/actions/militia.png',
  spearmen: '/assets/ui/icons/actions/spearmen.png',
  'men-at-arms': '/assets/ui/icons/actions/men-at-arms.png',
  crossbows: '/assets/ui/icons/actions/crossbows.png',
  'mercenary-spears': '/assets/ui/icons/actions/mercenaries.png',
  footmen: '/assets/ui/icons/actions/footmen.png',
  polearms: '/assets/ui/icons/actions/polearms.png',
  bowmen: '/assets/ui/icons/actions/bowmen.png',
} as const satisfies Record<MilitaryCompanyKind, string>;

/** Converts the per-soldier simulation faction back to its selectable company
 * identity. Guards and hostile agents are deliberately excluded: neither is a
 * player-commandable military company. */
export function militaryCompanyKindForFaction(
  faction: CombatAgentFaction,
): MilitaryCompanyKind | null {
  switch (faction) {
    case 'militia': return 'militia';
    case 'spearman': return 'spearmen';
    case 'man-at-arms': return 'men-at-arms';
    case 'crossbow': return 'crossbows';
    case 'mercenary-spear': return 'mercenary-spears';
    case 'footman': return 'footmen';
    case 'polearm': return 'polearms';
    case 'bowman': return 'bowmen';
    default: return null;
  }
}

export function militaryCompanyKindForAgents(
  agents: readonly Pick<CombatAgentState, 'faction'>[],
): MilitaryCompanyKind | null {
  for (const agent of agents) {
    const kind = militaryCompanyKindForFaction(agent.faction);
    if (kind) return kind;
  }
  return null;
}

export function militaryCompanyStrategicLabel(kind: MilitaryCompanyKind): string {
  return MILITARY_RECRUITMENT[kind].shortLabel;
}
