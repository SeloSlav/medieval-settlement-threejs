import { LODGE_FIREWOOD_PER_DELIVERY } from '../generated/gameBalance.ts';
import { firewoodDeliveryTripSeconds } from './deliveryLogistics.ts';
import type { RoadNetwork } from '../roads/RoadNetwork.ts';

export type LodgeLaborSplit = {
  processing: number;
  delivering: number;
};

/** One deliverer when possible; remaining workers process. A lone worker alternates roles. */
export function lodgeLaborSplit(assignedLabor: number): LodgeLaborSplit {
  if (assignedLabor <= 0) {
    return { processing: 0, delivering: 0 };
  }
  if (assignedLabor === 1) {
    return { processing: 1, delivering: 1 };
  }
  return { processing: assignedLabor - 1, delivering: 1 };
}

export function lodgeLaborAlternates(assignedLabor: number): boolean {
  return assignedLabor === 1;
}

export function formatLodgeCrewSplit(split: LodgeLaborSplit, assignedLabor: number): string {
  if (split.processing === 0 && split.delivering === 0) return 'None assigned';
  if (lodgeLaborAlternates(assignedLabor)) return '1 worker — alternates processing & delivery';
  if (split.delivering === 0) return `${split.processing} processing`;
  return `${split.processing} processing · ${split.delivering} delivering`;
}

export function lodgeFirewoodPerDelivery(deliveryWorkers: number): number {
  if (deliveryWorkers <= 0) return 0;
  return LODGE_FIREWOOD_PER_DELIVERY * deliveryWorkers;
}

export function lodgeDeliveryTripSeconds(
  network: RoadNetwork,
  lodge: { x: number; z: number },
  target: { x: number; z: number } | null,
  deliveryWorkers: number,
): number {
  return firewoodDeliveryTripSeconds(network, lodge, target, deliveryWorkers);
}
