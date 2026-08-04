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
  onUpgradeChapel?: (buildingId: string) => void | Promise<void>;
  onUpgradeResidence?: (residenceId: string) => void | Promise<void>;
  onRetrofitResidenceTileRoof?: (residenceId: string) => void | Promise<void>;
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
  const chapelUpgrade = eventTarget.closest<HTMLElement>('[data-action="upgrade-chapel"]');
  if (
    chapelUpgrade
    && target?.kind === 'building'
    && target.building.kind === 'chapel'
  ) {
    void handlers.onUpgradeChapel?.(target.building.id);
    return true;
  }
  const upgradeButton = eventTarget.closest<HTMLElement>('[data-action="upgrade-residence"]');
  if (upgradeButton && target?.kind === 'residence') {
    void handlers.onUpgradeResidence?.(target.residence.id);
    return true;
  }
  const roofRetrofitButton = eventTarget.closest<HTMLElement>(
    '[data-action="retrofit-residence-tile-roof"]',
  );
  if (roofRetrofitButton && target?.kind === 'residence') {
    void handlers.onRetrofitResidenceTileRoof?.(target.residence.id);
    return true;
  }
  const upgradePriority = eventTarget
    .closest<HTMLElement>('[data-residence-upgrade-priority]')
    ?.dataset.residenceUpgradePriority;
  const projectResidence = target?.kind === 'residence' || target?.kind === 'backyard'
    ? target.residence
    : null;
  if (upgradePriority != null && projectResidence) {
    void handlers.onSetResidenceUpgradePriority?.(
      projectResidence.id,
      Number(upgradePriority),
    );
    return true;
  }
  const tradeId = parseMarketplaceTradeId(eventTarget);
  if (tradeId && target?.kind === 'building' && target.building.kind === 'trading_post') {
    void handlers.onMarketplaceTrade?.(target.building.id, tradeId);
    return true;
  }
  const cancelTradeOrder = eventTarget.closest<HTMLElement>(
    '[data-inspector-action="cancel-marketplace-trade-order"]',
  );
  if (
    cancelTradeOrder
    && target?.kind === 'building'
    && target.building.kind === 'trading_post'
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
