import type { BackyardGardenKind } from '../../residences/backyardGarden.ts';
import { parseGardenPickerKind } from './backyardRenderer.ts';
import { isChapelCofferCollectAction } from './chapelRenderer.ts';
import { parseMarketplaceTradeId } from '../../economy/marketplaceTrade.ts';
import type { InspectableTarget } from '../types.ts';

export type SupplementalPanelHandlers = {
  onPlaceBackyardGarden?: (residenceId: string, kind: BackyardGardenKind) => void | Promise<void>;
  onMarketplaceTrade?: (buildingId: string, tradeId: string) => void | Promise<void>;
  onCollectChapelCoffer?: (buildingId: string) => void | Promise<void>;
};

export function handleSupplementalPanelClick(
  target: InspectableTarget | null,
  eventTarget: HTMLElement,
  handlers: SupplementalPanelHandlers,
): boolean {
  const tradeId = parseMarketplaceTradeId(eventTarget);
  if (tradeId && target?.kind === 'building' && target.building.kind === 'marketplace') {
    void handlers.onMarketplaceTrade?.(target.building.id, tradeId);
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
