import type { InspectableTarget } from '../types.ts';
import { renderChapelInspector } from './chapelRenderer.ts';
import { renderMarketplaceInspector } from './marketplaceInspector.ts';
import { renderForagersShedInspector } from './foragersShedRenderer.ts';
import { renderHuntersHallInspector } from './huntersHallRenderer.ts';
import { renderLumberMillInspector } from './lumberMillRenderer.ts';
import { renderReforesterInspector } from './reforesterRenderer.ts';
import { renderStoneQuarryInspector } from './stoneQuarryRenderer.ts';
import { renderWoodcuttersLodgeInspector } from './woodcuttersLodgeRenderer.ts';
import { renderWellInspector } from './wellRenderer.ts';
import type { InspectorRenderContext, InspectorView } from './renderInspectableTarget.ts';

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
      return renderHuntersHallInspector(target, context);
    case 'foragers_shed':
      return renderForagersShedInspector(target, context);
    default: {
      const unreachable: never = building.kind;
      throw new Error(`Unhandled building kind: ${unreachable}`);
    }
  }
}
