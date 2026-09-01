import { fireForTarget } from '../../fires/fireIncident.ts';
import { getBuildingCost } from '../buildingEconomy.ts';
import type { InspectableTarget } from '../types.ts';
import {
  buildingCostRows,
  buildingDemolishHint,
  buildingExtentRow,
  buildingLaborView,
  buildingRoadAccessRow,
} from './buildingCommon.ts';
import {
  militaryCompaniesAt,
  renderMilitaryCompanyRoster,
  renderMilitaryRecruitmentPanels,
} from './militaryCompanyRenderer.ts';
import type { InspectorRenderContext, InspectorView } from './renderInspectableTarget.ts';

const MOUNTED_COMPANY_SIZE = 6;

export function renderCavalryYardInspector(
  target: Extract<InspectableTarget, { kind: 'building' }>,
  context: InspectorRenderContext,
): InspectorView {
  const { building } = target;
  const companies = militaryCompaniesAt(context.militaryCompanies, building.id);
  const companyById = new Map(
    [...(context.militaryCompanies ?? [])].map((company) => [company.id, company]),
  );
  const fire = fireForTarget(context.gameState.fireIncidents.values(), 'building', building.id);
  const staffed = building.assignedLabor > 0;
  const availablePastureHorses = [...context.gameState.cavalryHorses.values()].filter((horse) => {
    if (!horse.atPasture || horse.assignedCompanyId !== null || horse.pastureId === null) return false;
    const pasture = context.gameState.pastures.get(horse.pastureId);
    const farmstead = pasture
      ? context.gameState.buildings.get(pasture.farmsteadId)
      : null;
    if (
      !farmstead
      || farmstead.kind !== 'pastoral_farmstead'
      || farmstead.constructionComplete === false
    ) return false;
    if (
      building.settlementId
      && farmstead.settlementId
      && building.settlementId !== farmstead.settlementId
    ) return false;
    return context.worldQueries.isRoadConnected(
      farmstead.x,
      farmstead.z,
      building.x,
      building.z,
    );
  });
  const horsesCommittedHere = [...context.gameState.cavalryHorses.values()].filter((horse) => {
    if (horse.assignedCompanyId === null) return false;
    return companyById.get(horse.assignedCompanyId)?.sourceBuildingId === building.id;
  });
  const musteringHorses = horsesCommittedHere.filter((horse) => horse.atPasture).length;
  const mountedHorses = horsesCommittedHere.length - musteringHorses;
  const canRecruit = fire == null
    && building.constructionComplete !== false
    && staffed
    && availablePastureHorses.length >= MOUNTED_COMPANY_SIZE;
  const status = fire
    ? ['Fire outage — military muster suspended', 'warning'] as const
    : !staffed
      ? ['Unstaffed — assign cavalry-yard hands', 'warning'] as const
      : availablePastureHorses.length >= MOUNTED_COMPANY_SIZE
        ? [`${availablePastureHorses.length} pasture horses available for muster`, 'ok'] as const
        : [`${availablePastureHorses.length} / ${MOUNTED_COMPANY_SIZE} connected pasture horses available`, 'idle'] as const;

  return {
    eyebrow: 'Mounted-company muster and equipment yard',
    title: context.worldQueries.getBuildingLabel(building.kind),
    statusText: status[0],
    statusState: status[1],
    detailsHtml: `
      ${buildingCostRows(getBuildingCost(building.kind))}
      ${buildingRoadAccessRow(context.worldQueries, building)}
      ${buildingExtentRow(building.kind)}
      <li data-inspector-primary><span>Available mounts</span><span>${availablePastureHorses.length} unassigned horses at road-connected Pastoral Farmstead pastures · ${MOUNTED_COMPANY_SIZE} required per company</span></li>
      <li><span>Committed here</span><span>${horsesCommittedHere.length} exact horses · ${musteringHorses} awaiting collection at pasture · ${mountedHorses} mounted or returning</span></li>
      <li><span>No resident stable</span><span>This is a military production building. It never buys, breeds, stores, or permanently houses horses.</span></li>
      <li><span>Physical muster</span><span>Six selected residents walk to six reserved pasture horses, ride them here, and combine with the required weapons, armor, provisions, and assigned yard staff.</span></li>
      <li><span>Atomic company</span><span>All six riders form and operate as one company, matching infantry companies rather than producing a single mounted unit.</span></li>
      <li><span>Field fodder</span><span>Mounted companies carry oats and water year-round, with ambient campaign forage abstracted. Pasture husbandry stops charging for horses while they are away.</span></li>
      <li><span>Disband route</span><span>Survivors return equipment here, ride each exact horse back to its reserved home pasture, dismount, then walk home.</span></li>
    `,
    supplementalPanelHtml: `
      <div class="inspector-action-panel" data-inspector-panel-title="Pasture-supplied muster">
        <p class="resource-inspector-note">Purchase horses at a horse-specialized Pastoral Farmstead pasture. This yard draws from connected available horses and has no lifetime or stall-slot production cap.</p>
        <p class="inspector-action-panel__hint">${availablePastureHorses.length} available now · ${MOUNTED_COMPANY_SIZE} per mounted company · formation completes only after residents, horses, kit, and initial field rations physically reach this yard.</p>
      </div>
      ${renderMilitaryRecruitmentPanels(
        ['hussars', 'armored-lancers', 'mounted-archers'],
        !canRecruit,
      )}
      ${renderMilitaryCompanyRoster(companies)}
    `,
    demolish: companies.some((company) => company.status !== 'destroyed')
      ? { visible: false, hint: 'Disband every attached company before removing its muster and equipment yard.' }
      : {
          visible: true,
          hint: `${buildingDemolishHint(building.kind)} Pasture horses are unaffected because none are housed here.`,
        },
    labor: buildingLaborView(building, context.populationStats, context.worldQueries),
  };
}
