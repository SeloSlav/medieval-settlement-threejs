import {
  MILITARY_FORMATIONS,
  MILITARY_RECRUITMENT,
  militaryCompanyRequiresProvisions,
  militaryCostText,
  militaryCompanyGainsExperience,
  militaryFormationLabel,
  militaryKindLabel,
  militaryRecruitmentCost,
  militaryResupplyCost,
  type MilitaryCompanyKind,
  type MilitaryCompanyState,
} from '../../security/militaryProgression.ts';
import { MILITARY_COMPANY_CARD_ART } from '../../security/militaryCompanyCardArt.ts';
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
};

const MOUNTED_KINDS = new Set<MilitaryCompanyKind>([
  'hussars',
  'armored-lancers',
  'mounted-archers',
]);

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
  const statusLabel = company.status[0]!.toUpperCase() + company.status.slice(1);

  return {
    eyebrow: gainsExperience ? 'Veteran company' : 'Military company',
    title: `${militaryKindLabel(company.kind)} #${company.id}`,
    statusText: gainsExperience ? `Level ${company.level} · ${statusLabel}` : statusLabel,
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
  const mounted = MOUNTED_KINDS.has(company.kind);
  const retainerGold = company.livingMembers * 2;
  const formationButtons = MILITARY_FORMATIONS
    .filter((formation) => !(
      formation === 'shield-wall'
      && ['crossbows', 'bowmen', 'polearms', 'hussars', 'armored-lancers', 'mounted-archers'].includes(company.kind)
    ))
    .map((formation) => `
      <button type="button" class="resource-action-button military-formation-button${company.formation === formation ? ' is-selected' : ''}"
        data-military-company-id="${company.id}" data-military-formation="${MILITARY_FORMATIONS.indexOf(formation)}"
        data-formation-kind="${formation}" aria-pressed="${company.formation === formation}"
        data-tooltip="${company.formation === formation ? 'Current company formation.' : `Order the company into ${militaryFormationLabel(formation).toLowerCase()} formation.`}"
        ${!canCommand || company.formation === formation ? 'disabled' : ''}>
        <span class="military-formation-button__glyph" aria-hidden="true">${FORMATION_GLYPH[formation]}</span>
        <span class="military-formation-button__label">${militaryFormationLabel(formation)}</span>
      </button>
    `).join('');
  const lifecycleAction = mercenaryLeaving
    ? `<button type="button" class="resource-action-button resource-action-button--icon military-company-action" data-renew-mercenary-contract="${company.id}" data-tooltip="Pay ${retainerGold} gold to recall the departing survivors."><span class="inspector-action-icon" data-action-icon="mercenaries" aria-hidden="true"></span><span class="military-company-action__copy"><strong>Retain company</strong><small>${retainerGold} gold</small></span></button>`
    : `<button type="button" class="resource-action-button resource-action-button--icon resource-action-button--secondary military-company-action" data-disband-military-company="${company.id}" data-tooltip="${company.kind === 'mercenary-spears' ? 'End the contract and send the company to the region edge.' : mounted ? 'Return equipment to the Cavalry Yard, ride each surviving horse to its reserved home pasture, then send the residents home.' : 'Stand the company down and return its surviving members home.'}" ${company.status === 'disbanding' || company.status === 'leaving' || company.status === 'destroyed' ? 'disabled' : ''}><span class="inspector-action-icon" data-action-icon="disband-company" aria-hidden="true"></span><span class="military-company-action__copy"><strong>${company.kind === 'mercenary-spears' ? 'End contract' : 'Disband company'}</strong></span></button>`;
  const mountedSupplyRows = mounted
    ? `<ul class="resource-inspector-details military-company-card__details">
        <li><span>Horse field stores</span><span>${company.horseOats.toFixed(0)} oats · ${company.horseFeed.toFixed(0)} winter feed · ${company.horseWater.toFixed(0)} water</span></li>
        <li><span>Automatic resupply</span><span>Reorders at 2 days toward 5 while the company holds position</span></li>
      </ul>`
    : '';
  return `
    <div class="inspector-action-panel military-company-card" data-inspector-panel-title="Orders">
      <h3 class="inspector-action-panel__title">Orders</h3>
      ${mountedSupplyRows}
      <div class="resource-action-row military-company-card__formations">${formationButtons}</div>
      <div class="resource-action-row military-company-card__actions">
        ${canResupply ? `<button type="button" class="resource-action-button resource-action-button--icon military-company-action" data-resupply-military-company="${company.id}" data-tooltip="${needsProvisions ? "Issue three days' supplies." : 'Replace the company ammunition.'}"><span class="inspector-action-icon" data-action-icon="resupply-company" aria-hidden="true"></span><span class="military-company-action__copy"><strong>Resupply</strong><small>${militaryCostText(resupplyCost)}</small></span></button>` : ''}
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
  const mounted = MOUNTED_KINDS.has(company.kind);
  const retainerGold = company.livingMembers * 2;
  const ammunition = company.ammunitionCapacity > 0
    ? `<li><span>${company.kind === 'bowmen' || company.kind === 'mounted-archers' ? 'Arrows' : 'Bolts'}</span><span>${company.ammunition} / ${company.ammunitionCapacity}</span></li>`
    : '';
  const provisions = needsProvisions
    ? `<li><span>Field provisions</span><span>${company.provisionDays.toFixed(1)} days</span></li>`
    : '';
  const horseSupply = mounted
    ? `<li><span>Horse field stores</span><span>${company.horseOats.toFixed(0)} oats · ${company.horseFeed.toFixed(0)} winter feed · ${company.horseWater.toFixed(0)} water</span></li>
       <li><span>Horse ration</span><span>Oats Mar–Nov; feed Dec–Feb; never both · water year-round</span></li>`
    : '';
  const mercenaryContract = company.kind === 'mercenary-spears'
    ? `<li><span>Contract</span><span>1 gold/man/day · 7 quiet days · 21-day term</span></li>`
    : '';
  const formationButtons = MILITARY_FORMATIONS
    .filter((formation) => !(
      formation === 'shield-wall'
      && ['crossbows', 'bowmen', 'polearms', 'hussars', 'armored-lancers', 'mounted-archers'].includes(company.kind)
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
        ${provisions}${horseSupply}${mercenaryContract}${ammunition}
      </ul>
      <div class="resource-action-row military-company-card__formations">${formationButtons}</div>
      <div class="resource-action-row">
        ${canResupply ? `<button type="button" class="resource-action-button resource-action-button--icon" data-resupply-military-company="${company.id}"><span class="inspector-action-icon" data-action-icon="resupply-company" aria-hidden="true"></span><span>${needsProvisions ? "Issue three days' supplies" : 'Replace ammunition'}<br><small>${militaryCostText(resupplyCost)}</small></span></button>` : ''}
        ${mercenaryLeaving
          ? `<button type="button" class="resource-action-button resource-action-button--icon" data-renew-mercenary-contract="${company.id}"><span class="inspector-action-icon" data-action-icon="mercenaries" aria-hidden="true"></span><span>Pay ${retainerGold} gold to retain company</span></button>`
          : `<button type="button" class="resource-action-button resource-action-button--icon resource-action-button--secondary" data-disband-military-company="${company.id}" ${company.status === 'disbanding' || company.status === 'leaving' || company.status === 'destroyed' ? 'disabled' : ''}><span class="inspector-action-icon" data-action-icon="disband-company" aria-hidden="true"></span><span>${company.kind === 'mercenary-spears' ? 'End contract and send to region edge' : 'Disband and return home'}</span></button>`}
      </div>
      <p class="inspector-action-panel__hint">${mercenaryLeaving ? 'This company is marching back to its original map edge and ignores all movement and attack orders. Pay the displayed two-day retainer before its final survivor exits to restore control and begin a fresh contract.' : 'Click any soldier or drag across a formation to select the entire company. A compact selection circle marks the selected company; right-click moves or attacks with the company as one RTS unit.'} Fallen equipment creates a recoverable battlefield pile. ${mounted ? 'Mounted survivors return kit to the Cavalry Yard, ride their exact horses back to the reserved home pastures, then walk home.' : 'Resident survivors return kit and walk back to their home—or the nearest available home if theirs was lost.'}</p>
    </div>
  `;
}
