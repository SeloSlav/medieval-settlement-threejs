import type { InspectableTarget } from '../types.ts';
import { renderChapelInspector } from './chapelRenderer.ts';
import { renderMarketplaceInspector } from './marketplaceInspector.ts';
import { renderHarvestBuildingInspector } from './harvestBuildingRenderer.ts';
import { renderLumberMillInspector } from './lumberMillRenderer.ts';
import { renderReforesterInspector } from './reforesterRenderer.ts';
import { renderStoneQuarryInspector } from './stoneQuarryRenderer.ts';
import { renderLargeQuarryInspector } from './largeQuarryRenderer.ts';
import { renderWoodcuttersLodgeInspector } from './woodcuttersLodgeRenderer.ts';
import { renderWellInspector } from './wellRenderer.ts';
import type { InspectorRenderContext, InspectorView } from './renderInspectableTarget.ts';
import { renderExpandedBuildingInspector } from './expandedBuildingRenderer.ts';
import { renderLivestockBuildingInspector } from './livestockBuildingRenderer.ts';
import { renderTownHallInspector } from './townHallRenderer.ts';
import { renderStorehouseInspector } from './storehouseRenderer.ts';
import { renderConstructionInspector } from './constructionRenderer.ts';
import { renderWatchtowerInspector } from './watchtowerRenderer.ts';
import { renderGuardhouseInspector } from './guardhouseRenderer.ts';
import { withStaffingPriority } from './staffingPriorityRenderer.ts';
import { renderFoundersCampInspector } from './foundersCampRenderer.ts';
import { renderSalvagePileInspector } from './salvagePileRenderer.ts';

export function renderBuildingInspector(
  target: Extract<InspectableTarget, { kind: 'building' }>,
  context: InspectorRenderContext,
): InspectorView {
  const { building } = target;
  if (building.constructionComplete === false) {
    return renderConstructionInspector(target, context);
  }
  switch (building.kind) {
    case 'founders_camp':
      return renderFoundersCampInspector(target, context);
    case 'salvage_pile':
      return renderSalvagePileInspector(target, context);
    case 'chapel':
      return withStaffingPriority(renderChapelInspector(target, context), building);
    case 'marketplace':
      return withStaffingPriority(renderMarketplaceInspector(target, context), building);
    case 'town_hall':
      return withStaffingPriority(renderTownHallInspector(target, context), building);
    case 'village_storehouse':
      return withStaffingPriority(renderStorehouseInspector(target, context), building);
    case 'watchtower':
      return withStaffingPriority(renderWatchtowerInspector(target, context), building);
    case 'guardhouse':
      return withStaffingPriority(renderGuardhouseInspector(target, context), building);
    case 'lumber_mill':
      return withStaffingPriority(renderLumberMillInspector(target, context), building);
    case 'woodcutters_lodge':
      return withStaffingPriority(renderWoodcuttersLodgeInspector(target, context), building);
    case 'stone_quarry':
      return withStaffingPriority(renderStoneQuarryInspector(target, context), building);
    case 'large_quarry':
      return withStaffingPriority(renderLargeQuarryInspector(target, context), building);
    case 'reforester':
      return withStaffingPriority(renderReforesterInspector(target, context), building);
    case 'well':
      return withStaffingPriority(renderWellInspector(target, context), building);
    case 'hunters_hall':
    case 'foragers_shed':
    case 'fishing_camp':
      return withStaffingPriority(renderHarvestBuildingInspector(target, context), building);
    case 'threshing_barn':
    case 'monastery':
    case 'brewery':
    case 'smokehouse':
    case 'granary':
    case 'apiary':
    case 'watermill':
    case 'carpenter':
    case 'weaver':
    case 'ferry_landing':
    case 'vineyard':
      return withStaffingPriority(renderExpandedBuildingInspector(target, context), building);
    case 'pastoral_farmstead':
    case 'swineherd':
      return withStaffingPriority(renderLivestockBuildingInspector(target, context), building);
    default: {
      const unreachable: never = building.kind;
      throw new Error(`Unhandled building kind: ${unreachable}`);
    }
  }
}
