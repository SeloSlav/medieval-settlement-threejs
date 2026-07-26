import type { RoadNetwork } from '../roads/RoadNetwork.ts';
import type { BuildingState, ResidenceState } from '../resources/types.ts';
import {
  claimResidencesForFoodSuppliers,
  claimResidencesForFirewoodSuppliers,
  claimResidencesForWells,
  peekNextDeliveryTarget,
  peekNextWaterDeliveryTarget,
  sortResidencesForDelivery,
  sortResidencesForWaterDelivery,
} from './roadLogistics.ts';
import { peekNextFoodDeliveryTarget } from './foodLogistics.ts';

type ClaimFn = (
  network: RoadNetwork,
  buildings: BuildingState[],
  residences: ResidenceState[],
) => Map<string, string>;

export class DeliveryClaimQueries {
  protected readonly claims: Map<string, string>;
  protected readonly residences: ResidenceState[];
  protected readonly network: RoadNetwork;

  constructor(
    network: RoadNetwork,
    buildings: BuildingState[],
    residences: ResidenceState[],
    claimFn: ClaimFn,
  ) {
    this.network = network;
    this.residences = residences;
    this.claims = claimFn(
      network,
      buildings.filter((building) => building.constructionComplete !== false),
      residences,
    );
  }

  getClaimedResidences(supplier: BuildingState): ResidenceState[] {
    const claimed = this.residences.filter((residence) => this.claims.get(residence.id) === supplier.id);
    return this.sortClaimed(supplier, claimed);
  }

  peekNextTarget(supplier: BuildingState): ResidenceState | null {
    const claimed = this.residences.filter((residence) => this.claims.get(residence.id) === supplier.id);
    return this.peekTarget(supplier, claimed);
  }

  getServingSupplierForResidence(residenceId: string): string | null {
    return this.claims.get(residenceId) ?? null;
  }

  protected sortClaimed(_supplier: BuildingState, residences: ResidenceState[]): ResidenceState[] {
    return residences;
  }

  protected peekTarget(_supplier: BuildingState, _residences: ResidenceState[]): ResidenceState | null {
    return null;
  }
}

export class FirewoodDeliveryClaimQueries extends DeliveryClaimQueries {
  constructor(network: RoadNetwork, buildings: BuildingState[], residences: ResidenceState[]) {
    super(network, buildings, residences, claimResidencesForFirewoodSuppliers);
  }

  protected override sortClaimed(lodge: BuildingState, residences: ResidenceState[]): ResidenceState[] {
    return sortResidencesForDelivery(this.network, lodge, residences);
  }

  protected override peekTarget(lodge: BuildingState, residences: ResidenceState[]): ResidenceState | null {
    return peekNextDeliveryTarget(this.network, lodge, residences);
  }
}

/** Compatibility name retained for lodge-specific inspector callers. */
export class LodgeDeliveryClaimQueries extends FirewoodDeliveryClaimQueries {}

export class WellDeliveryClaimQueries extends DeliveryClaimQueries {
  constructor(network: RoadNetwork, buildings: BuildingState[], residences: ResidenceState[]) {
    super(network, buildings, residences, claimResidencesForWells);
  }

  override getClaimedResidences(well: BuildingState): ResidenceState[] {
    const claimed = this.residences.filter(
      (residence) =>
        !residence.abandoned
        && residence.population > 0
        && this.claims.get(residence.id) === well.id,
    );
    return this.sortClaimed(well, claimed);
  }

  protected override sortClaimed(well: BuildingState, residences: ResidenceState[]): ResidenceState[] {
    return sortResidencesForWaterDelivery(this.network, well, residences);
  }

  protected override peekTarget(well: BuildingState, residences: ResidenceState[]): ResidenceState | null {
    return peekNextWaterDeliveryTarget(this.network, well, residences);
  }

  override peekNextTarget(supplier: BuildingState): ResidenceState | null {
    const claimed = this.residences.filter((residence) => {
      if (this.claims.get(residence.id) !== supplier.id) return false;
      return !residence.abandoned && residence.population > 0;
    });
    return this.peekTarget(supplier, claimed);
  }

  getOccupiedClaimedResidences(well: BuildingState): ResidenceState[] {
    return this.getClaimedResidences(well);
  }
}

export class FoodDeliveryClaimQueries extends DeliveryClaimQueries {
  constructor(
    network: RoadNetwork,
    buildings: BuildingState[],
    residences: ResidenceState[],
    eligible: (
      supplier: BuildingState,
      residence: ResidenceState,
      roadDistance: number,
    ) => boolean = () => true,
  ) {
    super(
      network,
      buildings,
      residences,
      (claimNetwork, suppliers, homes) =>
        claimResidencesForFoodSuppliers(claimNetwork, suppliers, homes, eligible),
    );
  }

  protected override peekTarget(supplier: BuildingState, residences: ResidenceState[]): ResidenceState | null {
    return peekNextFoodDeliveryTarget(this.network, supplier, residences);
  }
}
