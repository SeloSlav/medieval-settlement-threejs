import {
  MILITARY_FORMATIONS,
  MILITARY_RECRUITMENT,
  militaryCompanyRequiresProvisions,
  militaryCostText,
  militaryCompanyGainsExperience,
  militaryExperienceProgress,
  militaryFormationLabel,
  militaryKindLabel,
  militaryRecruitmentCost,
  militaryResupplyCost,
  type MilitaryCompanyKind,
  type MilitaryCompanyState,
} from '../../security/militaryProgression.ts';
import type { CombatAgentState } from '../../security/combatAgents.ts';
import { MILITARY_COMPANY_CARD_ART } from '../../security/militaryCompanyCardArt.ts';
import { getActiveWorldGeneration } from '../../world/worldGenerationContext.ts';

const GUARDHOUSE_KIND_ID: Partial<Record<MilitaryCompanyKind, number>> = {
  spearmen: 1,
  'men-at-arms': 2,
  crossbows: 3,
  footmen: 5,
  polearms: 6,
  bowmen: 7,
  'uskok-border-infantry': 8,
};

export type SelectedMilitaryCompanyInspectorView = {
  eyebrow: string;
  title: string;
  statusText: string;
  statusState: 'active' | 'warning' | 'idle';
  image: string;
  detailsHtml: string;
  supplementalPanelHtml: string;
};

export function renderSelectedMilitaryCompanyInspector(
  company: MilitaryCompanyState,
  combatAgents: Iterable<CombatAgentState> | undefined,
): SelectedMilitaryCompanyInspectorView {
  const agents = [...(combatAgents ?? [])].filter((agent) => (
    agent.companyId === company.id
    && agent.status !== 'downed'
  ));
  const health = agents.reduce((sum, agent) => sum + Math.max(0, agent.health), 0);
  const maxHealth = agents.reduce((sum, agent) => sum + Math.max(1, agent.maxHealth), 0);
  const healthFraction = maxHealth > 0 ? Math.max(0, Math.min(1, health / maxHealth)) : 0;
  const healthLabel = `${Math.ceil(health)} / ${Math.ceil(maxHealth)}`;
  const gainsExperience = militaryCompanyGainsExperience(company.kind);
  const experience = militaryExperienceProgress(company);
  const statusLabel = company.status[0]!.toUpperCase() + company.status.slice(1);
  const progressionDetails = gainsExperience
    ? `<li data-inspector-primary class="military-company-progress-row" data-company-level="${company.level}">
        <span>Experience</span>
        <strong>${experience.maximum ? 'Mastered' : `${experience.current} / ${experience.required} XP`}</strong>
        <span class="military-company-progress" role="progressbar" aria-label="Company experience" aria-valuemin="0" aria-valuemax="${experience.required}" aria-valuenow="${experience.current}">
          <span style="width: ${(experience.fraction * 100).toFixed(2)}%"></span>
        </span>
      </li>`
    : '';

  return {
    eyebrow: gainsExperience ? 'Veteran company' : 'Military company',
    title: `${militaryKindLabel(company.kind)} #${company.id}`,
    statusText: gainsExperience ? `Level ${company.level} · ${statusLabel}` : statusLabel,
    statusState: company.status === 'active' ? 'active' : company.status === 'destroyed' ? 'warning' : 'idle',
    image: MILITARY_COMPANY_CARD_ART[company.kind],
    detailsHtml: `
      <li data-inspector-primary class="military-company-progress-row" data-company-health>
        <span>Health</span>
        <strong>${healthLabel}</strong>
        <span class="military-company-progress military-company-progress--health" role="progressbar" aria-label="Company health" aria-valuemin="0" aria-valuemax="${Math.ceil(maxHealth)}" aria-valuenow="${Math.ceil(health)}">
          <span style="width: ${(healthFraction * 100).toFixed(2)}%"></span>
        </span>
      </li>
      ${progressionDetails}
    `,
    supplementalPanelHtml: renderSelectedCompanyCommands(company, gainsExperience),
  };
}

function renderSelectedCompanyCommands(
  company: MilitaryCompanyState,
  gainsExperience: boolean,
): string {
  const militaryDemands = getActiveWorldGeneration().militaryDemands;
  const canCommand = company.status === 'active' || company.status === 'mustering';
  const needsProvisions = militaryCompanyRequiresProvisions(company.kind, militaryDemands);
  const missingAmmunition = Math.max(0, company.ammunitionCapacity - company.ammunition);
  const ammunitionPerBundle = company.targetSize > 0
    ? Math.max(1, Math.ceil(company.ammunitionCapacity / company.targetSize))
    : 1;
  const missingAmmunitionBundles = Math.ceil(missingAmmunition / ammunitionPerBundle);
  const resupplyCost = militaryResupplyCost(company.livingMembers, militaryDemands);
  if (missingAmmunitionBundles > 0) resupplyCost.ammunition = missingAmmunitionBundles;
  const canResupply = company.kind !== 'militia'
    && company.kind !== 'mercenary-spears'
    && company.status === 'active'
    && (needsProvisions || missingAmmunitionBundles > 0);
  const mercenaryLeaving = company.kind === 'mercenary-spears' && company.status === 'leaving';
  const retainerGold = company.livingMembers * 2;
  const formationButtons = MILITARY_FORMATIONS
    .filter((formation) => !(
      formation === 'shield-wall'
      && ['crossbows', 'bowmen', 'polearms', 'uskok-border-infantry'].includes(company.kind)
    ))
    .map((formation) => `
      <button type="button" class="resource-action-button resource-action-button--icon resource-action-button--secondary"
        data-military-company-id="${company.id}" data-military-formation="${MILITARY_FORMATIONS.indexOf(formation)}"
        ${!canCommand || company.formation === formation ? 'disabled' : ''}>
        <span class="inspector-action-icon" data-action-icon="formation" aria-hidden="true"></span>
        <span>${militaryFormationLabel(formation)}</span>
      </button>
    `).join('');
  const lifecycleAction = mercenaryLeaving
    ? `<button type="button" class="resource-action-button resource-action-button--icon" data-renew-mercenary-contract="${company.id}"><span class="inspector-action-icon" data-action-icon="mercenaries" aria-hidden="true"></span><span>Pay ${retainerGold} gold to retain company</span></button>`
    : `<button type="button" class="resource-action-button resource-action-button--icon resource-action-button--secondary" data-disband-military-company="${company.id}" ${company.status === 'disbanding' || company.status === 'leaving' || company.status === 'destroyed' ? 'disabled' : ''}><span class="inspector-action-icon" data-action-icon="disband-company" aria-hidden="true"></span><span>${company.kind === 'mercenary-spears' ? 'End contract and send to region edge' : 'Disband and return home'}</span></button>`;
  return `
    <div class="inspector-action-panel military-company-card" data-inspector-panel-title="Orders">
      <div class="resource-action-row military-company-card__formations">${formationButtons}</div>
      <div class="resource-action-row">
        ${canResupply ? `<button type="button" class="resource-action-button resource-action-button--icon" data-resupply-military-company="${company.id}"><span class="inspector-action-icon" data-action-icon="resupply-company" aria-hidden="true"></span><span>${needsProvisions ? "Issue three days' supplies" : 'Replace ammunition'}<br><small>${militaryCostText(resupplyCost)}</small></span></button>` : ''}
        ${lifecycleAction}
      </div>
      <p class="inspector-action-panel__hint">${gainsExperience
        ? 'Surviving a battle and defeating an enemy company earns experience. Level gains strengthen the company while keeping combat ratings hidden; health recovers whenever the company is out of combat.'
        : company.kind === 'militia'
          ? 'Emergency militia do not retain veteran progression. Health still recovers outside combat.'
          : 'Hired mercenaries do not enter the settlement veteran progression. Health still recovers outside combat.'}</p>
    </div>
  `;
}

export function militaryCompaniesAt(
  companies: Iterable<MilitaryCompanyState> | undefined,
  sourceBuildingId: string,
): MilitaryCompanyState[] {
  return [...(companies ?? [])]
    .filter((company) => company.sourceBuildingId === sourceBuildingId)
    .sort((left, right) => Number(left.id) - Number(right.id));
}

export function renderMilitaryRecruitmentPanels(
  kinds: readonly MilitaryCompanyKind[],
  disabled: boolean,
): string {
  const militaryDemands = getActiveWorldGeneration().militaryDemands;
  return kinds.map((kind) => {
    const definition = MILITARY_RECRUITMENT[kind];
    const recruitmentCost = militaryRecruitmentCost(kind, militaryDemands);
    const action = kind === 'militia'
      ? `data-raise-militia="${definition.size}"`
      : kind === 'mercenary-spears'
        ? 'data-hire-mercenary-company'
        : `data-recruit-military-kind="${GUARDHOUSE_KIND_ID[kind]}"`;
    const timing = kind === 'militia'
      ? 'Selected men physically report here before the company becomes active.'
      : kind === 'mercenary-spears'
        ? 'They enter at a safe map edge and cost one Treasury gold per surviving man each day. When dismissed, unpaid, idle for seven days, or at the end of their three-week term, they stop accepting orders and march back to that edge. A two-day retainer can recall survivors before they exit.'
        : militaryDemands === 0
          ? 'Only equipment and available resident labor are required; local provisions and wages are disabled.'
          : militaryDemands === 1
            ? 'Equipment, available resident labor, and one three-day preserved ration per soldier are required; local wages are disabled.'
            : militaryDemands === 2
              ? 'Equipment, resident labor, a three-day ration issue, shared ale, and professional wages are required.'
              : 'Equipment, resident labor, two preserved rations and one ale per soldier, and professional wages are required.';
    const militiaSize = kind === 'militia'
      ? `<label class="military-size-picker">
          <span>Militia company size</span>
          <select class="inspector-policy-select" data-militia-size aria-label="Militia company size">
            ${Array.from({ length: 12 }, (_, index) => index + 1)
              .map((size) => `<option value="${size}" ${size === definition.size ? 'selected' : ''}>${size} ${size === 1 ? 'man' : 'men'} · ${size} ${size === 1 ? 'polearm' : 'polearms'}</option>`)
              .join('')}
          </select>
        </label>`
      : '';
    const buttonLabel = kind === 'militia'
      ? 'Muster selected militia company'
      : `Recruit ${definition.shortLabel} · ${definition.size} men<br><small>${militaryCostText(recruitmentCost)}</small>`;
    return `
      <div class="inspector-action-panel military-recruitment-card" data-inspector-panel-title="${definition.label}">
        <p class="inspector-action-panel__hint">${definition.summary} ${timing}</p>
        ${militiaSize}
        <button type="button" class="resource-action-button resource-action-button--icon" ${action}
          data-tooltip-title="${definition.label}" data-tooltip="${definition.summary}" ${disabled ? 'disabled' : ''}>
          <span class="inspector-action-icon" data-action-icon="${definition.icon}" aria-hidden="true"></span>
          <span>${buttonLabel}</span>
        </button>
      </div>
    `;
  }).join('');
}

export function renderMilitaryCompanyRoster(
  companies: readonly MilitaryCompanyState[],
): string {
  if (companies.length === 0) {
    return `
      <div class="inspector-action-panel" data-inspector-panel-title="Company roster">
        <p class="inspector-action-panel__hint">No company is attached to this building. Recruitment always reserves real resident men except for hired mercenaries.</p>
      </div>
    `;
  }
  const militaryDemands = getActiveWorldGeneration().militaryDemands;
  return companies.map((company) => renderCompany(company, militaryDemands)).join('');
}

function renderCompany(
  company: MilitaryCompanyState,
  militaryDemands: ReturnType<typeof getActiveWorldGeneration>['militaryDemands'],
): string {
  const percent = (value: number) => `${Math.round(value * 100)}%`;
  const canCommand = company.status === 'active' || company.status === 'mustering';
  const needsProvisions = militaryCompanyRequiresProvisions(company.kind, militaryDemands);
  const missingAmmunition = Math.max(0, company.ammunitionCapacity - company.ammunition);
  const ammunitionPerBundle = company.targetSize > 0
    ? Math.max(1, Math.ceil(company.ammunitionCapacity / company.targetSize))
    : 1;
  const missingAmmunitionBundles = Math.ceil(missingAmmunition / ammunitionPerBundle);
  const resupplyCost = militaryResupplyCost(company.livingMembers, militaryDemands);
  if (missingAmmunitionBundles > 0) resupplyCost.ammunition = missingAmmunitionBundles;
  const canResupply = company.kind !== 'militia'
    && company.kind !== 'mercenary-spears'
    && company.status === 'active'
    && (needsProvisions || missingAmmunitionBundles > 0);
  const mercenaryLeaving = company.kind === 'mercenary-spears' && company.status === 'leaving';
  const retainerGold = company.livingMembers * 2;
  const ammunition = company.ammunitionCapacity > 0
    ? `<li><span>${company.kind === 'bowmen' ? 'Arrows' : 'Bolts'}</span><span>${company.ammunition} / ${company.ammunitionCapacity}</span></li>`
    : '';
  const provisions = needsProvisions
    ? `<li><span>Field provisions</span><span>${company.provisionDays.toFixed(1)} days</span></li>`
    : '';
  const mercenaryContract = company.kind === 'mercenary-spears'
    ? `<li><span>Contract</span><span>1 gold/man/day · 7 quiet days · 21-day term</span></li>`
    : '';
  const formationButtons = MILITARY_FORMATIONS
    .filter((formation) => !(
      formation === 'shield-wall'
      && ['crossbows', 'bowmen', 'polearms', 'uskok-border-infantry'].includes(company.kind)
    ))
    .map((formation) => `
      <button type="button" class="resource-action-button resource-action-button--icon resource-action-button--secondary"
        data-military-company-id="${company.id}" data-military-formation="${MILITARY_FORMATIONS.indexOf(formation)}"
        ${!canCommand || company.formation === formation ? 'disabled' : ''}>
        <span class="inspector-action-icon" data-action-icon="formation" aria-hidden="true"></span>
        <span>${militaryFormationLabel(formation)}</span>
      </button>
    `).join('');
  return `
    <div class="inspector-action-panel military-company-card" data-inspector-panel-title="${militaryKindLabel(company.kind)} #${company.id}">
      <ul class="resource-inspector-details military-company-card__details">
        <li><span>State</span><span>${company.status} · ${company.livingMembers} / ${company.targetSize} living</span></li>
        <li><span>Formation</span><span>${militaryFormationLabel(company.formation)}</span></li>
        <li><span>Morale</span><span>${percent(company.morale)}</span></li>
        <li><span>Cohesion</span><span>${percent(company.cohesion)}</span></li>
        <li><span>Fatigue</span><span>${percent(company.fatigue)}</span></li>
        ${provisions}${mercenaryContract}${ammunition}
      </ul>
      <div class="resource-action-row military-company-card__formations">${formationButtons}</div>
      <div class="resource-action-row">
        ${canResupply ? `<button type="button" class="resource-action-button resource-action-button--icon" data-resupply-military-company="${company.id}"><span class="inspector-action-icon" data-action-icon="resupply-company" aria-hidden="true"></span><span>${needsProvisions ? "Issue three days' supplies" : 'Replace ammunition'}<br><small>${militaryCostText(resupplyCost)}</small></span></button>` : ''}
        ${mercenaryLeaving
          ? `<button type="button" class="resource-action-button resource-action-button--icon" data-renew-mercenary-contract="${company.id}"><span class="inspector-action-icon" data-action-icon="mercenaries" aria-hidden="true"></span><span>Pay ${retainerGold} gold to retain company</span></button>`
          : `<button type="button" class="resource-action-button resource-action-button--icon resource-action-button--secondary" data-disband-military-company="${company.id}" ${company.status === 'disbanding' || company.status === 'leaving' || company.status === 'destroyed' ? 'disabled' : ''}><span class="inspector-action-icon" data-action-icon="disband-company" aria-hidden="true"></span><span>${company.kind === 'mercenary-spears' ? 'End contract and send to region edge' : 'Disband and return home'}</span></button>`}
      </div>
      <p class="inspector-action-panel__hint">${mercenaryLeaving ? 'This company is marching back to its original map edge and ignores all movement and attack orders. Pay the displayed two-day retainer before its final survivor exits to restore control and begin a fresh contract.' : 'Click any soldier or drag across a formation to select the entire company. The selection circle encloses its current footprint; right-click moves or attacks with the company as one RTS unit.'} Fallen equipment creates a recoverable battlefield pile. Resident survivors return kit and walk back to their home—or the nearest available home if theirs was lost.</p>
    </div>
  `;
}
