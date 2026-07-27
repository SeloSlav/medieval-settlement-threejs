import type { BackyardGardenKind } from '../../residences/backyardGarden.ts';
import { parseGardenPickerKind } from './backyardRenderer.ts';
import { isChapelCofferCollectAction } from './chapelRenderer.ts';
import { parseMarketplaceTradeId } from '../../economy/marketplaceTrade.ts';
import type { InspectableTarget } from '../types.ts';

export type SupplementalPanelHandlers = {
  onPlaceBackyardGarden?: (residenceId: string, kind: BackyardGardenKind) => void | Promise<void>;
  onMarketplaceTrade?: (buildingId: string, tradeId: string) => void | Promise<void>;
  onCancelMarketplaceTradeOrder?: (buildingId: string) => void | Promise<void>;
  onCollectChapelCoffer?: (buildingId: string) => void | Promise<void>;
  onUpgradeResidence?: (residenceId: string) => void | Promise<void>;
  onSetResidenceUpgradePriority?: (
    residenceId: string,
    priority: number,
  ) => void | Promise<void>;
};

export function handleSupplementalPanelClick(
  target: InspectableTarget | null,
  eventTarget: HTMLElement,
  handlers: SupplementalPanelHandlers,
): boolean {
  const upgradeButton = eventTarget.closest<HTMLElement>('[data-action="upgrade-residence"]');
  if (upgradeButton && target?.kind === 'residence') {
    void handlers.onUpgradeResidence?.(target.residence.id);
    return true;
  }
  const upgradePriority = eventTarget
    .closest<HTMLElement>('[data-residence-upgrade-priority]')
    ?.dataset.residenceUpgradePriority;
  if (upgradePriority != null && target?.kind === 'residence') {
    void handlers.onSetResidenceUpgradePriority?.(
      target.residence.id,
      Number(upgradePriority),
    );
    return true;
  }
  const tradeId = parseMarketplaceTradeId(eventTarget);
  if (tradeId && target?.kind === 'building' && target.building.kind === 'marketplace') {
    void handlers.onMarketplaceTrade?.(target.building.id, tradeId);
    return true;
  }
  const cancelTradeOrder = eventTarget.closest<HTMLElement>(
    '[data-inspector-action="cancel-marketplace-trade-order"]',
  );
  if (
    cancelTradeOrder
    && target?.kind === 'building'
    && target.building.kind === 'marketplace'
  ) {
    void handlers.onCancelMarketplaceTradeOrder?.(target.building.id);
    return true;
  }

  if (
    isChapelCofferCollectAction(eventTarget)
    && target?.kind === 'building'
    && target.building.kind === 'chapel'
  ) {
    void handlers.onCollectChapelCoffer?.(target.building.id);
    return true;
  }

  const gardenKind = parseGardenPickerKind(eventTarget);
  if (gardenKind && target?.kind === 'backyard' && !target.garden) {
    void handlers.onPlaceBackyardGarden?.(target.residence.id, gardenKind);
    return true;
  }

  return false;
}
