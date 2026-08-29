import { LODGE_FIREWOOD_PER_DELIVERY } from '../generated/gameBalance.ts';
import { firewoodDeliveryTripSeconds } from './deliveryLogistics.ts';
import type { RoadNetwork } from '../roads/RoadNetwork.ts';

export type LodgeLaborSplit = {
  processing: number;
  delivering: number;
};

/** Assigned lodge workers always process; a free settlement hauler carries stock. */
export function lodgeLaborSplit(
  assignedLabor: number,
  freeHaulersAvailable = 1,
): LodgeLaborSplit {
  return {
    processing: Math.max(0, Math.floor(assignedLabor)),
    delivering: freeHaulersAvailable > 0 ? 1 : 0,
  };
}

export function lodgeLaborAlternates(_assignedLabor: number): boolean {
  return false;
}

/** Delivery never reduces the producer's sustained processing headcount. */
export function lodgeSustainedProcessingLabor(assignedLabor: number): number {
  return Math.max(0, Math.floor(assignedLabor));
}

export function formatLodgeCrewSplit(split: LodgeLaborSplit, assignedLabor: number): string {
  const processing = Math.max(0, Math.floor(assignedLabor));
  const producerLabel = processing === 0 ? 'No woodcutter assigned' : `${processing} harvesting`;
  const haulLabel = split.delivering > 0
    ? 'free hauler available'
    : 'waiting for a free hauler';
  return `${producerLabel} · ${haulLabel}`;
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
  travelSpeedMultiplier = 1,
): number {
  return firewoodDeliveryTripSeconds(
    network,
    lodge,
    target,
    deliveryWorkers,
    travelSpeedMultiplier,
  );
}
