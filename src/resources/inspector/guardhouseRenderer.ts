import { fireDisabledBuildingIds } from '../../fires/fireIncident.ts';
import { getBuildingCost } from '../buildingEconomy.ts';
import type { InspectableTarget } from '../types.ts';
import {
  buildingCostRows,
  buildingDemolishHint,
  buildingLaborView,
  buildingRoadAccessRow,
} from './buildingCommon.ts';
import {
  militaryCompaniesAt,
  renderMilitaryCompanyRoster,
  renderMilitaryRecruitmentPanels,
} from './militaryCompanyRenderer.ts';
import type { InspectorRenderContext, InspectorView } from './renderInspectableTarget.ts';

export function renderGuardhouseInspector(
  target: Extract<InspectableTarget, { kind: 'building' }>,
  context: InspectorRenderContext,
): InspectorView {
  const { building } = target;
  const companies = militaryCompaniesAt(context.militaryCompanies, building.id);
  const suspendedByFire = fireDisabledBuildingIds(
    context.gameState.fireIncidents.values(),
  ).has(building.id);
  const living = companies.reduce((sum, company) => sum + company.livingMembers, 0);
  const active = companies.filter((company) => company.status === 'active').length;
  const status = suspendedByFire
    ? ['Fire outage — recruitment and supply suspended', 'warning'] as const
    : companies.length === 0
      ? ['Ready to form a military company', 'ready'] as const
      : [`${active} active ${active === 1 ? 'company' : 'companies'} · ${living} soldiers`, active > 0 ? 'ok' : 'warning'] as const;

  return {
    eyebrow: 'Military establishment',
    title: context.worldQueries.getBuildingLabel(building.kind),
    statusText: status[0],
    statusState: status[1],
    detailsHtml: `
      ${buildingCostRows(getBuildingCost(building.kind))}
      ${buildingRoadAccessRow(context.worldQueries, building)}
      <li><span>Role</span><span>Forms, equips, provisions, and drills resident military companies</span></li>
      <li><span>Recruitment</span><span>Companies draw real residents and return survivors to the same households</span></li>
      <li><span>Command</span><span>Select a company in the world to set its formation, stance, and destination</span></li>
    `,
    demolish: companies.some((company) => company.status !== 'destroyed')
      ? {
          visible: false,
          hint: 'Disband or lose every attached company before removing its armory and return point.',
        }
      : { visible: true, hint: buildingDemolishHint(building.kind) },
    labor: buildingLaborView(building, context.populationStats, context.worldQueries),
    supplementalPanelHtml: `
      ${renderMilitaryRecruitmentPanels(
        ['spearmen', 'men-at-arms', 'footmen', 'polearms', 'bowmen', 'crossbows'],
        suspendedByFire || building.constructionComplete === false,
      )}
      ${renderMilitaryCompanyRoster(companies)}
    `,
  };
}
