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
      <li><span>Available companies</span><span>Spear company · trained spear company · crossbow company</span></li>
      <li><span>Resident levy</span><span>Every recruit is an actual available adult man reserved from settlement labor until he returns or dies</span></li>
      <li><span>Formation effects</span><span>Line is balanced · column moves coherently · shield wall resists frontal melee · loose order protects missile spacing</span></li>
      <li><span>Upkeep</span><span>Provisions and Treasury pay are consumed daily; crossbow bolts are finite and explicitly resupplied</span></li>
      <li><span>Legacy guards</span><span>Folded into spear companies. Assigned building labor now represents drill, armory, and quartermaster support—not a free abstract guard army.</span></li>
      <li><span>Losses</span><span>Dead resident soldiers reduce the real household. Their carried equipment remains at a recoverable battlefield site.</span></li>
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
        ['spearmen', 'men-at-arms', 'footmen', 'polearms', 'bowmen', 'crossbows', 'uskok-border-infantry'],
        suspendedByFire || building.constructionComplete === false,
      )}
      ${renderMilitaryCompanyRoster(companies)}
    `,
  };
}
