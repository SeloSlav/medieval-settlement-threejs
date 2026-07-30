import * as THREE from 'three';
import type {
  VillagerInspection,
  VillagerRenderer,
} from '../settlement/VillagerRenderer.ts';
import { disposeObject3D } from '../utils/dispose.ts';
import type {
  DeliveryAgentInspection,
  DeliveryAgentRenderer,
} from '../logistics/DeliveryAgentRenderer.ts';
import type { GameState } from '../resources/types.ts';
import { getBuildingDefinition } from '../resources/buildings.ts';
import {
  describeDeliveryTrip,
} from '../logistics/deliveryTrips.ts';
import { villagerDisplayName } from '../settlement/villagerIdentity.ts';

type VillagerInspectorOptions = {
  domElement: HTMLElement;
  uiRoot: HTMLElement;
  camera: THREE.Camera;
  villagers: VillagerRenderer;
  deliveryAgents: DeliveryAgentRenderer;
  getState: () => GameState;
  selectionParent: THREE.Group;
  isBlocked: () => boolean;
  onSelectionChange?: (selected: boolean) => void;
};

export class VillagerInspector {
  private readonly options: VillagerInspectorOptions;
  private readonly panel: HTMLElement;
  private readonly name: HTMLElement;
  private readonly eyebrow: HTMLElement;
  private readonly activity: HTMLElement;
  private readonly current: HTMLElement;
  private readonly initials: HTMLElement;
  private readonly occupation: HTMLElement;
  private readonly workplace: HTMLElement;
  private readonly workplaceLabel: HTMLElement;
  private readonly household: HTMLElement;
  private readonly householdLabel: HTMLElement;
  private readonly crew: HTMLElement;
  private readonly crewLabel: HTMLElement;
  private readonly pace: HTMLElement;
  private readonly paceLabel: HTMLElement;
  private readonly distanceRow: HTMLElement;
  private readonly distance: HTMLElement;
  private readonly closeButton: HTMLButtonElement;
  private readonly marker: THREE.Mesh;
  private selectedPersonIdentity: string | null = null;
  private selectedDeliveryTripId: string | null = null;

  constructor(options: VillagerInspectorOptions) {
    this.options = options;
    options.uiRoot.insertAdjacentHTML(
      'beforeend',
      `
        <aside class="villager-inspector-panel" data-villager-inspector hidden aria-label="Villager details">
          <header class="villager-inspector-header">
            <div class="villager-inspector-portrait" data-villager-initials aria-hidden="true">—</div>
            <div class="villager-inspector-heading">
              <p class="road-controls-eyebrow" data-villager-eyebrow>Villager</p>
              <h2 class="road-controls-title" data-villager-name>Unnamed villager</h2>
              <p class="road-controls-status" data-villager-activity>Select a villager to see what they are doing.</p>
            </div>
            <button class="villager-inspector-close" type="button" data-villager-close aria-label="Close villager details">×</button>
          </header>
          <section class="villager-inspector-current" aria-label="Current activity">
            <span>Current activity</span>
            <strong data-villager-current>—</strong>
          </section>
          <dl class="villager-inspector-stats">
            <div>
              <dt>Occupation</dt>
              <dd data-villager-occupation>—</dd>
            </div>
            <div>
              <dt data-villager-workplace-label>Workplace</dt>
              <dd data-villager-workplace>—</dd>
            </div>
            <div>
              <dt data-villager-household-label>Household</dt>
              <dd data-villager-household>—</dd>
            </div>
            <div>
              <dt data-villager-crew-label>Crew</dt>
              <dd data-villager-crew>—</dd>
            </div>
            <div>
              <dt data-villager-pace-label>Walking pace</dt>
              <dd data-villager-pace>—</dd>
            </div>
            <div data-delivery-distance-row hidden>
              <dt>Distance left</dt>
              <dd data-delivery-distance>—</dd>
            </div>
          </dl>
        </aside>
      `,
    );

    this.panel = mustElement(options.uiRoot, '[data-villager-inspector]');
    this.name = mustElement(this.panel, '[data-villager-name]');
    this.eyebrow = mustElement(this.panel, '[data-villager-eyebrow]');
    this.activity = mustElement(this.panel, '[data-villager-activity]');
    this.current = mustElement(this.panel, '[data-villager-current]');
    this.initials = mustElement(this.panel, '[data-villager-initials]');
    this.occupation = mustElement(this.panel, '[data-villager-occupation]');
    this.workplace = mustElement(this.panel, '[data-villager-workplace]');
    this.workplaceLabel = mustElement(this.panel, '[data-villager-workplace-label]');
    this.household = mustElement(this.panel, '[data-villager-household]');
    this.householdLabel = mustElement(this.panel, '[data-villager-household-label]');
    this.crew = mustElement(this.panel, '[data-villager-crew]');
    this.crewLabel = mustElement(this.panel, '[data-villager-crew-label]');
    this.pace = mustElement(this.panel, '[data-villager-pace]');
    this.paceLabel = mustElement(this.panel, '[data-villager-pace-label]');
    this.distanceRow = mustElement(this.panel, '[data-delivery-distance-row]');
    this.distance = mustElement(this.panel, '[data-delivery-distance]');
    this.closeButton = mustButton(this.panel, '[data-villager-close]');

    this.marker = createVillagerMarker();
    this.marker.visible = false;
    options.selectionParent.add(this.marker);

    options.domElement.addEventListener('mousedown', this.onPointerDown, { capture: true });
    this.panel.addEventListener('mousedown', stopEventPropagation);
    this.closeButton.addEventListener('click', this.onClose);
  }

  tick(): void {
    if (this.selectedDeliveryTripId) {
      const delivery = this.options.deliveryAgents.inspectDeliveryAgent(
        this.selectedDeliveryTripId,
      );
      if (!delivery) {
        this.clearSelection();
        return;
      }
      this.renderDelivery(delivery);
      return;
    }
    if (!this.selectedPersonIdentity) return;
    const inspection = this.options.villagers.inspectVillager(this.selectedPersonIdentity);
    if (!inspection) {
      this.clearSelection();
      return;
    }
    this.renderVillager(inspection);
  }

  selectDeliveryTrip(tripId: string): boolean {
    const delivery = this.options.deliveryAgents.inspectDeliveryAgent(tripId);
    if (!delivery) return false;
    this.selectedPersonIdentity = null;
    this.selectedDeliveryTripId = tripId;
    this.options.deliveryAgents.selectDeliveryAgent(tripId);
    this.panel.hidden = false;
    this.renderDelivery(delivery);
    this.options.onSelectionChange?.(true);
    return true;
  }

  clearSelection(notify = false): void {
    const hadSelection = this.selectedPersonIdentity !== null
      || this.selectedDeliveryTripId !== null;
    this.selectedPersonIdentity = null;
    this.selectedDeliveryTripId = null;
    this.options.deliveryAgents.selectDeliveryAgent(null);
    this.panel.hidden = true;
    this.marker.visible = false;
    if (notify && hadSelection) this.options.onSelectionChange?.(false);
  }

  dispose(): void {
    this.options.domElement.removeEventListener('mousedown', this.onPointerDown, { capture: true });
    this.panel.removeEventListener('mousedown', stopEventPropagation);
    this.closeButton.removeEventListener('click', this.onClose);
    this.marker.removeFromParent();
    disposeObject3D(this.marker);
    this.panel.remove();
  }

  private readonly onPointerDown = (event: MouseEvent): void => {
    if (event.button !== 0 || event.altKey || this.options.isBlocked()) return;
    const delivery = this.options.deliveryAgents.pickDeliveryAgent(
      event.clientX,
      event.clientY,
      this.options.camera,
      this.options.domElement,
    );
    if (delivery) {
      event.preventDefault();
      event.stopImmediatePropagation();
      this.selectDeliveryTrip(delivery.tripId);
      return;
    }

    const inspection = this.options.villagers.pickVillager(
      event.clientX,
      event.clientY,
      this.options.camera,
      this.options.domElement,
    );
    if (!inspection) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    this.options.deliveryAgents.selectDeliveryAgent(null);
    this.selectedDeliveryTripId = null;
    this.selectedPersonIdentity = inspection.personIdentity;
    this.panel.hidden = false;
    this.renderVillager(inspection);
    this.options.onSelectionChange?.(true);
  };

  private readonly onClose = (event: MouseEvent): void => {
    event.stopPropagation();
    this.clearSelection(true);
  };

  private renderVillager(inspection: VillagerInspection): void {
    this.workplaceLabel.textContent = inspection.workplaceLabel;
    this.householdLabel.textContent = inspection.householdLabel;
    this.crewLabel.textContent = inspection.crewLabel;
    this.paceLabel.textContent = inspection.paceLabel;
    this.distanceRow.hidden = true;
    this.name.textContent = inspection.name;
    this.eyebrow.textContent = inspection.eyebrow;
    this.activity.textContent = inspection.activity;
    this.current.textContent = inspection.activity;
    this.activity.dataset.state = inspection.activityState;
    this.initials.textContent = inspection.initials;
    this.occupation.textContent = inspection.occupation;
    this.workplace.textContent = inspection.workplace;
    this.household.textContent = inspection.household;
    this.crew.textContent = inspection.crew;
    this.pace.textContent = inspection.pace;
    this.marker.position.set(
      inspection.position.x,
      inspection.position.y + 2.12,
      inspection.position.z,
    );
    this.marker.rotation.y += 0.035;
    this.marker.visible = inspection.visible;
  }

  private renderDelivery(inspection: DeliveryAgentInspection): void {
    const trip = inspection.trip;
    const state = this.options.getState();
    const origin = state.buildings.get(trip.buildingId);
    const originLabel = origin
      ? getBuildingDefinition(origin.kind).label
      : 'Unknown origin';
    const destination = deliveryDestinationLabel(inspection, state);
    const presentation = describeDeliveryTrip(
      trip,
      originLabel,
      destination,
    );
    const name = villagerDisplayName(
      inspection.personIdentity,
      inspection.modelVariant,
    );

    this.workplaceLabel.textContent = presentation.workplaceHeading;
    this.householdLabel.textContent = presentation.routeHeading;
    this.crewLabel.textContent = 'Cargo';
    this.paceLabel.textContent = 'Cart speed';
    this.distanceRow.hidden = false;
    this.name.textContent = name;
    this.eyebrow.textContent = presentation.eyebrow;
    this.activity.textContent = presentation.activity;
    this.current.textContent = presentation.current;
    this.activity.dataset.state = 'active';
    this.initials.textContent = name
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0] ?? '')
      .join('')
      .toLocaleUpperCase();
    this.occupation.textContent = presentation.occupation;
    this.workplace.textContent = originLabel;
    this.household.textContent = presentation.routeTarget;
    this.crew.textContent = presentation.cargoSummary;
    const speed = trip.speedMps
      * Math.max(1, trip.deliveryWorkers)
      * Math.max(1e-6, trip.travelSpeedMultiplier);
    this.pace.textContent = `${speed.toFixed(1)} m/s`;
    this.distance.textContent = inspection.remainingMeters == null
      ? '—'
      : `${Math.ceil(inspection.remainingMeters).toLocaleString()} m`;
    this.marker.position.set(
      inspection.position.x,
      inspection.position.y + 2.12,
      inspection.position.z,
    );
    this.marker.rotation.y += 0.035;
    this.marker.visible = inspection.visible;
  }
}

function deliveryDestinationLabel(
  inspection: DeliveryAgentInspection,
  state: GameState,
): string {
  const trip = inspection.trip;
  if (trip.destinationKind === 'building' && trip.targetBuildingId) {
    const building = state.buildings.get(trip.targetBuildingId);
    return building ? getBuildingDefinition(building.kind).label : 'Building';
  }
  if (trip.residenceId) {
    const residence = state.residences.get(trip.residenceId);
    if (residence) return `Parcel #${residence.parcelIndex + 1}`;
  }
  if (trip.destinationKind === 'fire') return 'Structure fire';
  if (trip.destinationKind === 'trade') return 'Regional exchange route';
  return 'Unknown destination';
}

function mustElement(root: ParentNode, selector: string): HTMLElement {
  const element = root.querySelector<HTMLElement>(selector);
  if (!element) throw new Error(`Missing villager inspector element ${selector}`);
  return element;
}

function mustButton(root: ParentNode, selector: string): HTMLButtonElement {
  const element = root.querySelector<HTMLButtonElement>(selector);
  if (!element) throw new Error(`Missing villager inspector button ${selector}`);
  return element;
}

function stopEventPropagation(event: MouseEvent): void {
  event.stopPropagation();
}

function createVillagerMarker(): THREE.Mesh {
  const geometry = new THREE.OctahedronGeometry(0.2, 0);
  const material = new THREE.MeshBasicMaterial({
    color: 0xe7c878,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
  });
  const marker = new THREE.Mesh(geometry, material);
  marker.name = 'Selected villager beacon';
  marker.renderOrder = 13;
  return marker;
}
