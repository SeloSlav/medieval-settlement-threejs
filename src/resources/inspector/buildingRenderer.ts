import type { InspectableTarget } from '../types.ts';
import { renderChapelInspector } from './chapelRenderer.ts';
import { renderMarketplaceInspector } from './marketplaceInspector.ts';
import { renderMarketStallsInspector } from './marketStallsRenderer.ts';
import { renderHarvestBuildingInspector } from './harvestBuildingRenderer.ts';
import { renderLumberMillInspector } from './lumberMillRenderer.ts';
import { renderReforesterInspector } from './reforesterRenderer.ts';
import { renderStoneQuarryInspector } from './stoneQuarryRenderer.ts';
import { renderLargeQuarryInspector } from './largeQuarryRenderer.ts';
import { renderMineralMineInspector } from './mineralMineRenderer.ts';
import { renderWoodcuttersLodgeInspector } from './woodcuttersLodgeRenderer.ts';
import { renderWellInspector } from './wellRenderer.ts';
import {
  hiddenLabor,
  type InspectorRenderContext,
  type InspectorView,
} from './renderInspectableTarget.ts';
import { renderExpandedBuildingInspector } from './expandedBuildingRenderer.ts';
import { renderLivestockBuildingInspector } from './livestockBuildingRenderer.ts';
import { renderTownHallInspector } from './townHallRenderer.ts';
import { renderStorehouseInspector } from './storehouseRenderer.ts';
import { renderConstructionInspector } from './constructionRenderer.ts';
import { renderWatchtowerInspector } from './watchtowerRenderer.ts';
import { renderGuardhouseInspector } from './guardhouseRenderer.ts';
import { renderPalisadedRefugeInspector } from './palisadedRefugeRenderer.ts';
import { renderFoundersCampInspector } from './foundersCampRenderer.ts';
import { renderSalvagePileInspector } from './salvagePileRenderer.ts';
import { withBuildingFireSafety } from './fireSafetyRenderer.ts';
import {
  renderRemoteWorkCampInspector,
  withWorksiteLodging,
} from './remoteWorkCampRenderer.ts';
import { fireForTarget } from '../../fires/fireIncident.ts';
import { withBuildingLocalStorage } from './buildingLocalStorageRenderer.ts';
import { renderWaysideShrineInspector } from './waysideShrineRenderer.ts';
import { renderStableInspector } from './stableRenderer.ts';

export function renderBuildingInspector(
  target: Extract<InspectableTarget, { kind: 'building' }>,
  context: InspectorRenderContext,
): InspectorView {
  const { building } = target;
  const fire = fireForTarget(
    context.gameState.fireIncidents.values(),
    'building',
    building.id,
  );
  if (fire?.status === 'destroyed') {
    return {
      eyebrow: 'Ruin',
      title: `${context.worldQueries.getBuildingLabel(building.kind)} ruins`,
      statusText: 'Destroyed by fire — rebuild the surviving foundations or clear the ruin.',
      statusState: 'warning',
      detailsHtml: `
        <li><span>Site</span><span>Collapsed shell with reusable foundations</span></li>
        <li><span>Operations</span><span>Stopped until reconstruction is complete</span></li>
        <li><span>Salvage</span><span>Any recoverable materials are left in a nearby pile for free haulers</span></li>
      `,
      demolish: {
        visible: true,
        label: 'Clear ruin',
        hint: 'Remove the ruined footprint instead of rebuilding it.',
      },
      labor: hiddenLabor(),
    };
  }
  if (building.constructionComplete === false) {
    return renderConstructionInspector(target, context);
  }
  const view = (() => {
    switch (building.kind) {
    case 'founders_camp':
      return renderFoundersCampInspector(target, context);
    case 'salvage_pile':
      return renderSalvagePileInspector(target, context);
    case 'remote_work_camp':
      return renderRemoteWorkCampInspector(target, context);
    case 'chapel':
      return renderChapelInspector(target, context);
    case 'wayside_shrine':
      return renderWaysideShrineInspector(target, context);
    case 'stable':
      return renderStableInspector(target, context);
    case 'marketplace':
      return renderMarketStallsInspector(target, context);
    case 'trading_post':
      return renderMarketplaceInspector(target, context);
    case 'town_hall':
      return renderTownHallInspector(target, context);
    case 'village_storehouse':
      return renderStorehouseInspector(target, context);
    case 'watchtower':
      return renderWatchtowerInspector(target, context);
    case 'guardhouse':
      return renderGuardhouseInspector(target, context);
    case 'palisaded_refuge':
      return renderPalisadedRefugeInspector(target, context);
    case 'lumber_mill':
      return renderLumberMillInspector(target, context);
    case 'woodcutters_lodge':
      return renderWoodcuttersLodgeInspector(target, context);
    case 'stone_quarry':
      return renderStoneQuarryInspector(target, context);
    case 'large_quarry':
      return renderLargeQuarryInspector(target, context);
    case 'mine':
      return renderMineralMineInspector(target, context);
    case 'reforester':
      return renderReforesterInspector(target, context);
    case 'well':
      return renderWellInspector(target, context);
    case 'hunters_hall':
    case 'foragers_shed':
    case 'fishing_camp':
      return renderHarvestBuildingInspector(target, context);
    case 'threshing_barn':
    case 'monastery':
    case 'brewery':
    case 'tavern':
    case 'smokehouse':
    case 'granary':
    case 'bakery':
    case 'apiary':
    case 'watermill':
    case 'windmill':
    case 'clay_pit':
    case 'charcoal_burner':
    case 'smithy':
    case 'potter_kiln':
    case 'carpenter':
    case 'weaver':
    case 'tannery':
    case 'cobbler':
      return renderExpandedBuildingInspector(target, context);
    case 'pastoral_farmstead':
    case 'swineherd':
      return renderLivestockBuildingInspector(target, context);
    default: {
      const unreachable: never = building.kind;
      throw new Error(`Unhandled building kind: ${unreachable}`);
    }
    }
  })();
  const worksiteView = withWorksiteLodging(view, building, context);
  const storageView = building.kind === 'marketplace'
    ? worksiteView
    : withBuildingLocalStorage(worksiteView, building);
  return withBuildingFireSafety(
    storageView,
    building,
    context,
  );
}
