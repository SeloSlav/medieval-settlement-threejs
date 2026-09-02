import type { CombatAgentState } from '../security/combatAgents.ts';
import {
  MILITARY_FORMATIONS, MILITARY_STANCES,
  militaryCompanyRequiresProvisions, militaryFormationAvailable, militaryFormationLabel,
  militaryStanceAvailable, militaryStanceLabel,
  militaryFormationDescription, militaryStanceDescription, militaryStanceMoraleRequired,
  type MilitaryCompanyState, type MilitaryFormation, type MilitaryStance,
} from '../security/militaryProgression.ts';
import { getActiveWorldGeneration } from '../world/worldGenerationContext.ts';

export type MilitaryOrder =
  | { kind: 'formation'; value: number }
  | { kind: 'stance'; value: number }
  | { kind: 'running' | 'fire-at-will'; value: number }
  | { kind: 'reinforce' | 'resupply' | 'retain' | 'disband' };

const dots = (points: number[][]) => points.map(([x, y]) => `<rect x="${x}" y="${y}" width="4" height="4" rx=".6"/>`).join('');
const formationIcons: Record<MilitaryFormation, string> = {
  line: dots([[2, 8], [8, 8], [14, 8], [20, 8], [2, 14], [8, 14], [14, 14], [20, 14]]),
  column: dots([[8, 2], [14, 2], [8, 8], [14, 8], [8, 14], [14, 14], [8, 20], [14, 20]]),
  'shield-wall': '<path d="M2 4h6v11l-3 4-3-4zm8 0h6v11l-3 4-3-4zm8 0h6v11l-3 4-3-4z"/>',
  loose: dots([[2, 2], [20, 2], [11, 11], [2, 20], [20, 20]]),
  brace: '<path d="M3 21h20v3H3zM4 18 12 2l2 1-8 16zm7 0L19 2l2 1-8 16zm7 0L25 4l2 1-7 14z"/>',
  wedge: dots([[11, 2], [6, 8], [16, 8], [2, 14], [20, 14], [11, 14]]),
};
const stanceIcons: Record<MilitaryStance, string> = {
  balanced: '<path d="m13 2 11 11-11 11L2 13zm0 5-6 6 6 6 6-6z"/>',
  'stand-ground': '<path d="M3 20h20v3H3zM5 3h3v14H5zm6 0h3v14h-3zm6 0h3v14h-3z"/>',
  'push-forward': '<path d="m3 5 8 8-8 8 3 3 11-11L6 2zm10 0 8 8-8 8 3 3 11-11L16 2z"/>',
  'give-ground': '<path d="m23 5-8 8 8 8-3 3L9 13 20 2zm-10 0-8 8 8 8-3 3L-1 13 10 2z"/>',
  'missile-alert': '<path d="m2 10 11-8 11 8-2 3-9-6-9 6zm4 5h14v5l-7 5-7-5z"/>',
};
export function militaryOrderIcon(kind: 'formation' | 'stance', name: MilitaryFormation | MilitaryStance): string {
  const paths = kind === 'formation' ? formationIcons[name as MilitaryFormation] : stanceIcons[name as MilitaryStance];
  return `<svg viewBox="0 0 28 28" aria-hidden="true" focusable="false">${paths}</svg>`;
}

/** Health and focus come from living soldiers, never morale or company headcount. */
export function militaryCompanyVitals(agents: Iterable<CombatAgentState>): Map<string, { health: number; x: number; z: number; radius: number }> {
  const groups = new Map<string, CombatAgentState[]>();
  for (const agent of agents) {
    if (!agent.companyId || agent.health <= 0 || agent.status === 'downed') continue;
    const group = groups.get(agent.companyId) ?? [];
    group.push(agent);
    groups.set(agent.companyId, group);
  }
  return new Map([...groups].map(([id, members]) => {
    const x = members.reduce((sum, a) => sum + a.x, 0) / members.length;
    const z = members.reduce((sum, a) => sum + a.z, 0) / members.length;
    const maxHealth = members.reduce((sum, a) => sum + Math.max(0, a.maxHealth), 0);
    return [id, {
      health: maxHealth > 0 ? Math.min(1, Math.max(0, members.reduce((sum, a) => sum + a.health, 0) / maxHealth)) : 0,
      x, z,
      radius: Math.max(...members.map((a) => Math.hypot(a.x - x, a.z - z))),
    }];
  }));
}

export function militaryCompanyFocusZoom(radius: number): number {
  // Keep ordinary companies in a readable overhead view; widen for dispersed ranks.
  return Math.max(35, Math.min(170, 8800 / Math.max(52, radius * 4 + 24)));
}

export function militaryOrderAvailable(company: MilitaryCompanyState, order: MilitaryOrder): boolean {
  if (company.id.startsWith('combat-playtest:')) return false;
  const active = company.status === 'active';
  switch (order.kind) {
    case 'formation': return (active || company.status === 'mustering')
      && militaryFormationAvailable(company.kind, MILITARY_FORMATIONS[order.value]!);
    case 'stance': return (active || company.status === 'mustering')
      && militaryStanceAvailable(company.kind, MILITARY_STANCES[order.value]!)
      && company.morale >= militaryStanceMoraleRequired(MILITARY_STANCES[order.value]!);
    case 'running': return active && (order.value === 0 || company.fatigue < 0.95);
    case 'fire-at-will': return active && ['bowmen', 'crossbows', 'mounted-archers'].includes(company.kind);
    case 'retain': return company.kind === 'mercenary-spears' && company.status !== 'destroyed'
      && (company.status === 'leaving' || company.departureRequested);
    case 'disband': return (active || company.status === 'mustering') && !company.departureRequested;
    case 'reinforce': return active && company.kind !== 'militia' && company.kind !== 'mercenary-spears'
      && company.livingMembers < company.targetSize;
    case 'resupply': return active && company.kind !== 'militia' && company.kind !== 'mercenary-spears'
      && (company.ammunition < company.ammunitionCapacity
        || militaryCompanyRequiresProvisions(company.kind, getActiveWorldGeneration().militaryDemands));
  }
}

export function renderMilitaryOrders(companies: readonly MilitaryCompanyState[]): string {
  if (!companies.length) return '';
  const buttons = (kind: 'formation' | 'stance', names: readonly (MilitaryFormation | MilitaryStance)[]) => names.flatMap((name, value) => {
    const supported = companies.every((company) => kind === 'formation'
      ? militaryFormationAvailable(company.kind, name as MilitaryFormation)
      : militaryStanceAvailable(company.kind, name as MilitaryStance));
    if (!supported) return [];
    const selected = companies.every((company) => company[kind] === name);
    const enabled = companies.every((company) => militaryOrderAvailable(company, { kind, value }));
    const label = kind === 'formation' ? militaryFormationLabel(name as MilitaryFormation) : militaryStanceLabel(name as MilitaryStance);
    const description = kind === 'formation' ? militaryFormationDescription(name as MilitaryFormation) : militaryStanceDescription(name as MilitaryStance);
    return `<button type="button" class="military-order${selected ? ' is-selected' : ''}" data-military-order="${kind}" data-order-value="${value}" data-${kind}-kind="${name}" aria-label="${label}" data-tooltip="${description}" aria-pressed="${selected}" ${enabled ? '' : 'disabled'}>${militaryOrderIcon(kind, name)}</button>`;
  }).join('');
  const actions = [
    ['reinforce', 'Reinforce', 'militia'], ['resupply', 'Resupply', 'resupply-company'],
    ['retain', 'Retain company', 'mercenaries'], ['disband', 'Disband company', 'disband-company'],
  ] as const;
  const lifecycle = actions.filter(([kind]) => companies.every((company) => militaryOrderAvailable(company, { kind })))
    .map(([kind, label, icon]) => `<button type="button" class="military-order" data-military-order="${kind}" aria-label="${label}" data-tooltip="${label}"><span class="inspector-action-icon" data-action-icon="${icon}" aria-hidden="true"></span></button>`).join('');
  const toggle = (kind: 'running' | 'fire-at-will', current: boolean, label: string, description: string, icon: string) => {
    const value = current ? 0 : 1;
    const enabled = companies.every(company => militaryOrderAvailable(company, { kind, value }));
    return `<button type="button" class="military-order${current ? ' is-selected' : ''}" data-military-order="${kind}" data-order-value="${value}" aria-label="${label}" data-tooltip="${description}" aria-pressed="${current}" ${enabled ? '' : 'disabled'}><svg viewBox="0 0 28 28" aria-hidden="true">${icon}</svg></button>`;
  };
  const running = companies.every(c => c.running);
  const risky = companies.every(c => c.fireAtWill);
  const pace = toggle('running', running, 'Run', running ? 'Walk to conserve strength for the fight.' : 'Run to cover ground quickly at the cost of stamina.', '<circle cx="17" cy="4" r="3"/><path d="m12 8 6 2 4 7-3 1-4-6-3 6 7 6-2 2-9-7 2-7-5 4-2-2zM8 19l3 2-5 6-3-2z"/>');
  const fire = companies.every(c => ['bowmen', 'crossbows', 'mounted-archers'].includes(c.kind))
    ? toggle('fire-at-will', risky, 'Risk friendly fire', risky ? 'Hold shots whenever friendly soldiers are in the firing lane.' : 'Keep shooting even when friendly soldiers risk being hit.', '<path d="m4 23 17-17h-7V3h12v12h-3V8L6 25zM3 8h8v3H3z"/>') : '';
  return `<div class="military-menu__order-group" role="group" aria-label="Movement and fire">${pace}${fire}</div>
    <div class="military-menu__order-group" role="group" aria-label="Formations">${buttons('formation', MILITARY_FORMATIONS)}</div>
    <div class="military-menu__order-group" role="group" aria-label="Stances">${buttons('stance', MILITARY_STANCES)}</div>
    ${lifecycle ? `<div class="military-menu__order-group" role="group" aria-label="Company actions">${lifecycle}</div>` : ''}`;
}
