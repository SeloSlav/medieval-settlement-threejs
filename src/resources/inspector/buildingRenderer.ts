import type { InspectableTarget } from '../types.ts';
import { renderChapelInspector } from './chapelRenderer.ts';
import { renderMarketplaceInspector } from './marketplaceInspector.ts';
import { renderHarvestBuildingInspector } from './harvestBuildingRenderer.ts';
import { renderLumberMillInspector } from './lumberMillRenderer.ts';
import { renderReforesterInspector } from './reforesterRenderer.ts';
import { renderStoneQuarryInspector } from './stoneQuarryRenderer.ts';
import { renderWoodcuttersLodgeInspector } from './woodcuttersLodgeRenderer.ts';
import { renderWellInspector } from './wellRenderer.ts';
import type { InspectorRenderContext, InspectorView } from './renderInspectableTarget.ts';
import { renderExpandedBuildingInspector } from './expandedBuildingRenderer.ts';
import { renderLivestockBuildingInspector } from './livestockBuildingRenderer.ts';
import { renderTownHallInspector } from './townHallRenderer.ts';
import { renderStorehouseInspector } from './storehouseRenderer.ts';

export function renderBuildingInspector(
  target: Extract<InspectableTarget, { kind: 'building' }>,
  context: InspectorRenderContext,
): InspectorView {
  const { building } = target;
  switch (building.kind) {
    case 'chapel':
      return renderChapelInspector(target, context);
    case 'marketplace':
      return renderMarketplaceInspector(target, context);
    case 'town_hall':
      return renderTownHallInspector(target, context);
    case 'village_storehouse':
      return renderStorehouseInspector(target, context);
    case 'lumber_mill':
      return renderLumberMillInspector(target, context);
    case 'woodcutters_lodge':
      return renderWoodcuttersLodgeInspector(target, context);
    case 'stone_quarry':
      return renderStoneQuarryInspector(target, context);
    case 'reforester':
      return renderReforesterInspector(target, context);
    case 'well':
      return renderWellInspector(target, context);
    case 'hunters_hall':
    case 'foragers_shed':
      return renderHarvestBuildingInspector(target, context);
    case 'threshing_barn':
    case 'monastery':
    case 'brewery':
    case 'smokehouse':
    case 'granary':
    case 'apiary':
    case 'watermill':
    case 'carpenter':
    case 'ferry_landing':
    case 'vineyard':
      return renderExpandedBuildingInspector(target, context);
    case 'pastoral_farmstead':
    case 'swineherd':
      return renderLivestockBuildingInspector(target, context);
    default: {
      const unreachable: never = building.kind;
      throw new Error(`Unhandled building kind: ${unreachable}`);
    }
  }
}
