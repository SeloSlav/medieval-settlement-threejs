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
import { withStaffingPriority } from './staffingPriorityRenderer.ts';
import { renderFoundersCampInspector } from './foundersCampRenderer.ts';
import { renderSalvagePileInspector } from './salvagePileRenderer.ts';
import { withBuildingFireSafety } from './fireSafetyRenderer.ts';
import {
  renderRemoteWorkCampInspector,
  withWorksiteLodging,
} from './remoteWorkCampRenderer.ts';
import { fireForTarget } from '../../fires/fireIncident.ts';
import { withBuildingLocalStorage } from './buildingLocalStorageRenderer.ts';

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
      return withStaffingPriority(renderChapelInspector(target, context), building);
    case 'marketplace':
      return renderMarketStallsInspector(target, context);
    case 'trading_post':
      return withStaffingPriority(renderMarketplaceInspector(target, context), building);
    case 'town_hall':
      return withStaffingPriority(renderTownHallInspector(target, context), building);
    case 'village_storehouse':
      return withStaffingPriority(renderStorehouseInspector(target, context), building);
    case 'watchtower':
      return withStaffingPriority(renderWatchtowerInspector(target, context), building);
    case 'guardhouse':
      return withStaffingPriority(renderGuardhouseInspector(target, context), building);
    case 'palisaded_refuge':
      return renderPalisadedRefugeInspector(target, context);
    case 'lumber_mill':
      return withStaffingPriority(renderLumberMillInspector(target, context), building);
    case 'woodcutters_lodge':
      return withStaffingPriority(renderWoodcuttersLodgeInspector(target, context), building);
    case 'stone_quarry':
      return withStaffingPriority(renderStoneQuarryInspector(target, context), building);
    case 'large_quarry':
      return withStaffingPriority(renderLargeQuarryInspector(target, context), building);
    case 'mine':
      return withStaffingPriority(renderMineralMineInspector(target, context), building);
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
  })();
  return withBuildingFireSafety(
    withBuildingLocalStorage(
      withWorksiteLodging(view, building, context),
      building,
    ),
    building,
    context,
  );
}
