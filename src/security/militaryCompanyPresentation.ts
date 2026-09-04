import type {
  CombatAgentFaction,
  CombatAgentState,
} from './combatAgents.ts';
import {
  MILITARY_RECRUITMENT,
  type MilitaryCompanyKind,
} from './militaryProgression.ts';

/** High-contrast strategic silhouettes are deliberately separate from the
 * detailed recruitment art so every company reads at the far map stops. */
export const MILITARY_COMPANY_STRATEGIC_ICON_ART = {
  militia: '/assets/ui/icons/military-map/militia.png',
  spearmen: '/assets/ui/icons/military-map/spearmen.png',
  'men-at-arms': '/assets/ui/icons/military-map/men-at-arms.png',
  crossbows: '/assets/ui/icons/military-map/crossbows.png',
  'mercenary-spears': '/assets/ui/icons/military-map/mercenary-spears.png',
  footmen: '/assets/ui/icons/military-map/footmen.png',
  polearms: '/assets/ui/icons/military-map/polearms.png',
  bowmen: '/assets/ui/icons/military-map/bowmen.png',
  hussars: '/assets/ui/icons/military-map/hussars.png',
  'armored-lancers': '/assets/ui/icons/military-map/armored-lancers.png',
  'mounted-archers': '/assets/ui/icons/military-map/mounted-archers.png',
} as const satisfies Record<MilitaryCompanyKind, string>;

export type HostileCompanyStrategicKind = 'raiders' | 'bandits' | 'wildlife';

/** Hostile formations use the same crimson badge and white silhouette system. */
export const HOSTILE_COMPANY_STRATEGIC_ICON_ART = {
  raiders: '/assets/ui/icons/military-map/raiders.png',
  bandits: '/assets/ui/icons/military-map/bandits.png',
  wildlife: '/assets/ui/icons/military-map/wildlife.png',
} as const satisfies Record<HostileCompanyStrategicKind, string>;

export function hostileCompanyStrategicLabel(kind: HostileCompanyStrategicKind): string {
  if (kind === 'bandits') return 'Bandit company';
  if (kind === 'wildlife') return 'Hostile wild animals';
  return 'Enemy raiders';
}

export function hostileCompanyStrategicKindForFaction(
  faction: CombatAgentFaction,
): HostileCompanyStrategicKind | null {
  if (faction === 'raider') return 'raiders';
  if (faction === 'bandit') return 'bandits';
  if (faction === 'fox' || faction === 'wolf') return 'wildlife';
  return null;
}

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
    case 'hussar': return 'hussars';
    case 'armored-lancer': return 'armored-lancers';
    case 'mounted-archer': return 'mounted-archers';
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
