import {
  MILITARY_FORMATIONS,
  MILITARY_STANCES,
  MILITARY_RECRUITMENT,
  militaryCompanyRankLabel,
  militaryCompanyRequiresProvisions,
  militaryCostText,
  militaryCompanyDisplayName,
  militaryCompanyGainsExperience,
  militaryFormationLabel,
  militaryFormationAvailable,
  militaryFormationDescription,
  militaryRecruitmentCost,
  militaryReinforcementCost,
  militaryResupplyCost,
  militaryStanceAvailable,
  militaryStanceMoraleRequired,
  militaryStanceDescription,
  militaryStanceLabel,
  type MilitaryCompanyKind,
  type MilitaryCompanyState,
} from '../../security/militaryProgression.ts';
import { MILITARY_COMPANY_CARD_ART } from '../../security/militaryCompanyCardArt.ts';
import { renderResourceAmount, renderResourceCost } from '../../ui/resourceCost.ts';
import { getActiveWorldGeneration } from '../../world/worldGenerationContext.ts';

const RECRUITMENT_KIND_ID: Partial<Record<MilitaryCompanyKind, number>> = {
  spearmen: 1,
  'men-at-arms': 2,
  crossbows: 3,
  footmen: 5,
  polearms: 6,
  bowmen: 7,
  hussars: 8,
  'armored-lancers': 9,
  'mounted-archers': 10,
};

const FORMATION_GLYPH: Record<(typeof MILITARY_FORMATIONS)[number], string> = {
  line: '••••',
  column: '⋮',
  'shield-wall': '▰▰▰',
  loose: '·  ·  ·',
  brace: '⌁⌁⌁',
  wedge: '••›',
};

const STANCE_GLYPH: Record<(typeof MILITARY_STANCES)[number], string> = {
  balanced: '◇',
  'stand-ground': '▥',
  'push-forward': '»',
  'give-ground': '‹',
  'missile-alert': '⌃',
};

const MOUNTED_KINDS = new Set<MilitaryCompanyKind>([
  'hussars',
  'armored-lancers',
  'mounted-archers',
]);

function renderStoredResourceAmount(kind: 'oatGrain' | 'water', amount: number): string {
  const value = Math.max(0, Math.round(amount));
  const label = kind === 'oatGrain' ? 'oats' : 'water';
  return `<span class="resource-cost resource-cost--compact" role="img" aria-label="${value} ${label}"><span class="resource-cost__item" data-resource-cost="${kind}" title="${label[0]!.toUpperCase()}${label.slice(1)}"><span class="resource-cost__icon" aria-hidden="true"></span><span class="resource-cost__value">${value}</span></span></span>`;
}

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
  options: { readOnlyPlaytest?: boolean } = {},
): SelectedMilitaryCompanyInspectorView {
  const gainsExperience = militaryCompanyGainsExperience(company.kind);
  const rank = militaryCompanyRankLabel(company);
  const statusLabel = company.departureRequested && company.status === 'active'
    ? 'Leaving after battle'
    : company.status[0]!.toUpperCase() + company.status.slice(1);

  return {
    eyebrow: company.kind === 'mercenary-spears'
      ? 'Mercenary company'
      : gainsExperience ? 'Standing company' : 'Military company',
    title: militaryCompanyDisplayName(company),
    statusText: rank ? `${rank} · ${statusLabel}` : statusLabel,
    statusState: company.status === 'active' ? 'active' : company.status === 'destroyed' ? 'warning' : 'idle',
    image: MILITARY_COMPANY_CARD_ART[company.kind],
    detailsHtml: '',
    supplementalPanelHtml: renderSelectedCompanyCommands(
      company,
      options.readOnlyPlaytest === true,
    ),
  };
}

function renderSelectedCompanyCommands(
  company: MilitaryCompanyState,
  readOnlyPlaytest = false,
): string {
  if (readOnlyPlaytest) {
    return `
      <div class="inspector-action-panel military-company-card" data-inspector-panel-title="Field orders" data-combat-playtest-company-card>
        <h3 class="inspector-action-panel__title">Field orders</h3>
        <p class="inspector-action-panel__hint">This is the isolated combat sandbox. Click a soldier or its strategic woodcut marker to select the whole company, drag across formations to select several, then right-click the terrain to move. Right-clicking an enemy orders an attack.</p>
      </div>
    `;
  }
  const militaryDemands = getActiveWorldGeneration().militaryDemands;
  const canCommand = company.status === 'active' || company.status === 'mustering';
  const needsProvisions = militaryCompanyRequiresProvisions(company.kind, militaryDemands);
  const missingAmmunition = Math.max(0, company.ammunitionCapacity - company.ammunition);
  const ammunitionPerBundle = company.livingMembers > 0
    ? Math.max(1, Math.ceil(company.ammunitionCapacity / company.livingMembers))
    : 1;
  const missingAmmunitionBundles = Math.ceil(missingAmmunition / ammunitionPerBundle);
  const resupplyCost = militaryResupplyCost(company.livingMembers, militaryDemands);
  if (missingAmmunitionBundles > 0) resupplyCost.ammunition = missingAmmunitionBundles;
  const canResupply = company.kind !== 'militia'
    && company.kind !== 'mercenary-spears'
    && company.status === 'active'
    && (needsProvisions || missingAmmunitionBundles > 0);
  const mercenaryLeaving = company.kind === 'mercenary-spears'
    && (company.status === 'leaving' || company.departureRequested);
  const mounted = MOUNTED_KINDS.has(company.kind);
  const retainerGold = company.livingMembers * 2;
  const missingRanks = Math.max(0, company.targetSize - company.livingMembers);
  const canReinforce = company.status === 'active'
    && missingRanks > 0
    && company.kind !== 'militia'
    && company.kind !== 'mercenary-spears';
  const reinforcementCost = canReinforce
    ? militaryReinforcementCost(company.kind, missingRanks, militaryDemands)
    : {};
  const availableFormations = MILITARY_FORMATIONS
    .filter((formation) => militaryFormationAvailable(company.kind, formation));
  const formationButtons = availableFormations
    .map((formation) => `
      <button type="button" class="resource-action-button military-formation-button${company.formation === formation ? ' is-selected' : ''}"
        data-military-company-id="${company.id}" data-military-formation="${MILITARY_FORMATIONS.indexOf(formation)}"
        data-formation-kind="${formation}" aria-pressed="${company.formation === formation}"
        data-tooltip="${militaryFormationDescription(formation)}"
        ${!canCommand || company.formation === formation ? 'disabled' : ''}>
        <span class="military-formation-button__glyph" aria-hidden="true">${FORMATION_GLYPH[formation]}</span>
        <span class="military-formation-button__label">${militaryFormationLabel(formation)}</span>
      </button>
    `).join('');
  const availableStances = MILITARY_STANCES
    .filter((stance) => militaryStanceAvailable(company.kind, stance));
  const stanceButtons = availableStances.map((stance) => `
      <button type="button" class="resource-action-button military-formation-button${company.stance === stance ? ' is-selected' : ''}"
        data-military-company-id="${company.id}" data-military-stance="${MILITARY_STANCES.indexOf(stance)}"
        aria-pressed="${company.stance === stance}" data-tooltip="${militaryStanceDescription(stance)}"
        ${!canCommand || company.stance === stance || company.morale < militaryStanceMoraleRequired(stance) ? 'disabled' : ''}>
        <span class="military-formation-button__glyph" aria-hidden="true">${STANCE_GLYPH[stance]}</span>
        <span class="military-formation-button__label">${militaryStanceLabel(stance)}</span>
      </button>
    `).join('');
  const lifecycleAction = mercenaryLeaving
    ? `<button type="button" class="resource-action-button resource-action-button--icon military-company-action" data-renew-mercenary-contract="${company.id}" data-tooltip="Pay ${retainerGold} gold to recall the departing survivors."><span class="inspector-action-icon" data-action-icon="mercenaries" aria-hidden="true"></span><span class="military-company-action__copy"><strong>Retain company</strong><small>${renderResourceAmount('gold', retainerGold, { compact: true })}</small></span></button>`
    : `<button type="button" class="resource-action-button resource-action-button--icon resource-action-button--secondary military-company-action" data-disband-military-company="${company.id}" data-tooltip="${company.kind === 'mercenary-spears' ? 'End the contract and send the company to the region edge.' : mounted ? 'Return equipment to the Cavalry Yard, ride each surviving horse to its reserved home pasture, then send the residents home.' : 'Stand the company down and return its surviving members home.'}" ${company.status === 'disbanding' || company.status === 'leaving' || company.status === 'destroyed' ? 'disabled' : ''}><span class="inspector-action-icon" data-action-icon="disband-company" aria-hidden="true"></span><span class="military-company-action__copy"><strong>${company.kind === 'mercenary-spears' ? 'End contract' : 'Disband company'}</strong></span></button>`;
  const mountedSupplyRows = mounted
    ? `<div class="military-company-supplies">
        <div class="military-company-supplies__heading">
          <span>Horse field stores</span>
          <span class="military-company-supplies__resources">
            ${renderStoredResourceAmount('oatGrain', company.horseOats)}
            ${renderStoredResourceAmount('water', company.horseWater)}
          </span>
        </div>
        <p><strong>Automatic resupply</strong> Reorders at 2 days and restores 5 days while the company holds position.</p>
      </div>`
    : '';
  return `
    <div class="inspector-action-panel military-company-card" data-inspector-panel-title="Orders">
      <h3 class="inspector-action-panel__title">Orders</h3>
      ${mountedSupplyRows}
      <div class="military-company-card__section-heading">Formation</div>
      <div class="resource-action-row military-company-card__formations" data-formation-count="${availableFormations.length}">${formationButtons}</div>
      <div class="military-company-card__section-heading">Stance</div>
      <div class="resource-action-row military-company-card__formations" data-formation-count="${availableStances.length}">${stanceButtons}</div>
      <div class="resource-action-row military-company-card__actions">
        ${canReinforce ? `<button type="button" class="resource-action-button resource-action-button--icon military-company-action" data-reinforce-military-company="${company.id}" data-tooltip="Call ${missingRanks} replacement ${missingRanks === 1 ? 'man' : 'men'} to muster with this company."><span class="inspector-action-icon" data-action-icon="militia" aria-hidden="true"></span><span class="military-company-action__copy"><strong>Reinforce</strong><small>${renderResourceCost(reinforcementCost, { compact: true })}</small></span></button>` : ''}
        ${canResupply ? `<button type="button" class="resource-action-button resource-action-button--icon military-company-action" data-resupply-military-company="${company.id}" data-tooltip="${needsProvisions ? "Issue three days' supplies." : 'Replace the company ammunition.'}"><span class="inspector-action-icon" data-action-icon="resupply-company" aria-hidden="true"></span><span class="military-company-action__copy"><strong>Resupply</strong><small>${renderResourceCost(resupplyCost, { compact: true })}</small></span></button>` : ''}
        ${lifecycleAction}
      </div>
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
        : `data-recruit-military-kind="${RECRUITMENT_KIND_ID[kind]}"`;
    const timing = kind === 'militia'
      ? 'Selected men physically report here before the company becomes active.'
      : kind === 'mercenary-spears'
        ? 'They enter at a safe map edge and cost one civic treasury gold per surviving man each day. When dismissed, unpaid, idle for seven days, or at the end of their three-week term, they stop accepting orders and march back to that edge. A two-day retainer can recall survivors before they exit.'
        : militaryDemands === 0
          ? 'Only equipment and available resident labor are required; local provisions and wages are disabled.'
          : militaryDemands === 1
            ? 'Equipment, available resident labor, and one three-day savory-preserve ration per soldier are required; local wages are disabled.'
            : 'Equipment and resident labor are required, plus one savory-preserve ration and one ale per soldier and professional wages every three field days.';
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
  const canCommand = company.status === 'active' || company.status === 'mustering';
  const needsProvisions = militaryCompanyRequiresProvisions(company.kind, militaryDemands);
  const missingAmmunition = Math.max(0, company.ammunitionCapacity - company.ammunition);
  const ammunitionPerBundle = company.livingMembers > 0
    ? Math.max(1, Math.ceil(company.ammunitionCapacity / company.livingMembers))
    : 1;
  const missingAmmunitionBundles = Math.ceil(missingAmmunition / ammunitionPerBundle);
  const resupplyCost = militaryResupplyCost(company.livingMembers, militaryDemands);
  if (missingAmmunitionBundles > 0) resupplyCost.ammunition = missingAmmunitionBundles;
  const canResupply = company.kind !== 'militia'
    && company.kind !== 'mercenary-spears'
    && company.status === 'active'
    && (needsProvisions || missingAmmunitionBundles > 0);
  const mercenaryLeaving = company.kind === 'mercenary-spears'
    && (company.status === 'leaving' || company.departureRequested);
  const retainerGold = company.livingMembers * 2;
  const rank = militaryCompanyRankLabel(company);
  const missingRanks = Math.max(0, company.targetSize - company.livingMembers);
  const canReinforce = company.status === 'active'
    && missingRanks > 0
    && company.kind !== 'militia'
    && company.kind !== 'mercenary-spears';
  const reinforcementCost = canReinforce
    ? militaryReinforcementCost(company.kind, missingRanks, militaryDemands)
    : {};
  const formationButtons = MILITARY_FORMATIONS
    .filter((formation) => militaryFormationAvailable(company.kind, formation))
    .map((formation) => `
      <button type="button" class="resource-action-button military-formation-button${company.formation === formation ? ' is-selected' : ''}"
        data-military-company-id="${company.id}" data-military-formation="${MILITARY_FORMATIONS.indexOf(formation)}"
        aria-pressed="${company.formation === formation}" data-tooltip="${militaryFormationDescription(formation)}"
        ${!canCommand || company.formation === formation ? 'disabled' : ''}>
        <span class="military-formation-button__glyph" aria-hidden="true">${FORMATION_GLYPH[formation]}</span>
        <span class="military-formation-button__label">${militaryFormationLabel(formation)}</span>
      </button>
    `).join('');
  const stanceButtons = MILITARY_STANCES
    .filter((stance) => militaryStanceAvailable(company.kind, stance))
    .map((stance) => `
      <button type="button" class="resource-action-button military-formation-button${company.stance === stance ? ' is-selected' : ''}"
        data-military-company-id="${company.id}" data-military-stance="${MILITARY_STANCES.indexOf(stance)}"
        aria-pressed="${company.stance === stance}" data-tooltip="${militaryStanceDescription(stance)}"
        ${!canCommand || company.stance === stance || company.morale < militaryStanceMoraleRequired(stance) ? 'disabled' : ''}>
        <span class="military-formation-button__glyph" aria-hidden="true">${STANCE_GLYPH[stance]}</span>
        <span class="military-formation-button__label">${militaryStanceLabel(stance)}</span>
      </button>
    `).join('');
  return `
    <div class="inspector-action-panel military-company-card" data-inspector-panel-title="${militaryCompanyDisplayName(company)}">
      <ul class="resource-inspector-details military-company-card__details">
        <li><span>State</span><span>${company.status} · ${company.livingMembers} / ${company.targetSize} living</span></li>
        ${rank ? `<li><span>Rank</span><span>${rank}</span></li>` : ''}
        <li><span>Orders</span><span>${militaryFormationLabel(company.formation)} · ${militaryStanceLabel(company.stance)}</span></li>
      </ul>
      <div class="military-company-card__section-heading">Formation</div>
      <div class="resource-action-row military-company-card__formations" data-formation-count="${MILITARY_FORMATIONS.filter((formation) => militaryFormationAvailable(company.kind, formation)).length}">${formationButtons}</div>
      <div class="military-company-card__section-heading">Stance</div>
      <div class="resource-action-row military-company-card__formations" data-formation-count="${MILITARY_STANCES.filter((stance) => militaryStanceAvailable(company.kind, stance)).length}">${stanceButtons}</div>
      <div class="resource-action-row military-company-card__actions">
        ${canReinforce ? `<button type="button" class="resource-action-button resource-action-button--icon" data-reinforce-military-company="${company.id}" data-tooltip="Call ${missingRanks} replacement ${missingRanks === 1 ? 'man' : 'men'} to muster with this company."><span class="inspector-action-icon" data-action-icon="militia" aria-hidden="true"></span><span>Reinforce<br><small>${militaryCostText(reinforcementCost)}</small></span></button>` : ''}
        ${canResupply ? `<button type="button" class="resource-action-button resource-action-button--icon" data-resupply-military-company="${company.id}"><span class="inspector-action-icon" data-action-icon="resupply-company" aria-hidden="true"></span><span>${needsProvisions ? "Issue three days' supplies" : 'Replace ammunition'}<br><small>${militaryCostText(resupplyCost)}</small></span></button>` : ''}
        ${mercenaryLeaving
          ? `<button type="button" class="resource-action-button resource-action-button--icon" data-renew-mercenary-contract="${company.id}"><span class="inspector-action-icon" data-action-icon="mercenaries" aria-hidden="true"></span><span>Pay ${retainerGold} gold to retain company</span></button>`
          : `<button type="button" class="resource-action-button resource-action-button--icon resource-action-button--secondary" data-disband-military-company="${company.id}" ${company.status === 'disbanding' || company.status === 'leaving' || company.status === 'destroyed' ? 'disabled' : ''}><span class="inspector-action-icon" data-action-icon="disband-company" aria-hidden="true"></span><span>${company.kind === 'mercenary-spears' ? 'End contract and send to region edge' : 'Disband and return home'}</span></button>`}
      </div>
      ${mercenaryLeaving ? '<p class="inspector-action-panel__hint">The company will leave after its current engagement; retain it here to keep it in service.</p>' : ''}
    </div>
  `;
}
