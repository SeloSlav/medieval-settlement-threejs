import * as THREE from 'three';
import type { TerrainProjector } from '../terrain/TerrainProjector.ts';
import type { SceneManager } from '../scene/SceneManager.ts';
import { disposeObject3D } from '../utils/dispose.ts';
import {
  computeResourceTotals,
  computeTradeAvailability,
  maxAssignableLabor,
  type PopulationStats,
  type ResourceTotals,
} from './resourceTotals.ts';
import type { FarmCrop, GameState, InspectableTarget } from './types.ts';
import type { WorldQueries } from './WorldQueries.ts';
import { renderInspectableTarget } from './inspector/renderInspectableTarget.ts';
import { handleSupplementalPanelClick } from './inspector/supplementalPanel.ts';
import type { ParishPolicyState } from '../economy/chapelParish.ts';
import type { RegionalMarketState } from '../economy/regionalMarket.ts';
import { DEFAULT_REGIONAL_MARKET_STATE } from '../economy/regionalMarket.ts';
import type { BackyardGardenKind } from '../residences/backyardGarden.ts';
import { backyardIconPosition } from '../residences/backyardPosition.ts';

type ResourceInspectorOptions = {
  domElement: HTMLElement;
  uiRoot: HTMLElement;
  sceneManager: SceneManager;
  terrainProjector: TerrainProjector;
  worldQueries: WorldQueries;
  getState: () => GameState;
  getEconomicActivityTaxRate?: () => number;
  getParishPolicy?: () => ParishPolicyState;
  getMarketState?: () => RegionalMarketState;
  onDemolishBuilding?: (buildingId: string) => void | Promise<void>;
  onDemolishResidence?: (residenceId: string) => void | Promise<void>;
  onUpgradeResidence?: (residenceId: string) => void | Promise<void>;
  onDemolishBurgageZone?: (zoneId: string) => void | Promise<void>;
  onPlaceBackyardGarden?: (residenceId: string, kind: BackyardGardenKind) => void | Promise<void>;
  onDemolishBackyardGarden?: (residenceId: string) => void | Promise<void>;
  onAssignBuildingLabor?: (buildingId: string, labor: number) => void | Promise<void>;
  onMarketplaceTrade?: (buildingId: string, tradeId: string) => void | Promise<void>;
  onCollectChapelCoffer?: (buildingId: string) => void | Promise<void>;
  onDemolishFarmField?: (fieldId: string) => void | Promise<void>;
  onSetFarmFieldCrop?: (fieldId: string, crop: FarmCrop) => void | Promise<void>;
  onSetFarmFieldPriority?: (fieldId: string, priority: number) => void | Promise<void>;
  onSelectionChange?: (target: InspectableTarget | null) => void;
  isBlocked: () => boolean;
};

export class ResourceInspector {
  private readonly options: ResourceInspectorOptions;
  private readonly panel: HTMLElement;
  private readonly eyebrow: HTMLElement;
  private readonly title: HTMLElement;
  private readonly status: HTMLElement;
  private readonly detailList: HTMLElement;
  private readonly stockpileRoot: HTMLElement;
  private readonly stockpileValues: Record<
    'timber' | 'stone' | 'firewood' | 'water' | 'food' | 'gold' | 'grain' | 'flour' | 'ale' | 'preservedFood' | 'honey' | 'wine',
    HTMLElement
  >;
  private readonly populationValue: HTMLElement;
  private readonly housingValue: HTMLElement;
  private readonly housingSub: HTMLElement;
  private readonly laborValue: HTMLElement;
  private readonly demolishSection: HTMLElement;
  private readonly demolishButton: HTMLButtonElement;
  private readonly demolishSecondaryButton: HTMLButtonElement;
  private readonly demolishHint: HTMLElement;
  private readonly demolishSecondaryHint: HTMLElement;
  private readonly laborSection: HTMLElement;
  private readonly laborCount: HTMLElement;
  private readonly laborHint: HTMLElement;
  private readonly laborDecrease: HTMLButtonElement;
  private readonly laborIncrease: HTMLButtonElement;
  private readonly supplementalPanelSection: HTMLElement;
  private readonly marker: THREE.Mesh;
  private selectedTarget: InspectableTarget | null = null;
  private selectedX = 0;
  private selectedZ = 0;
  private selectedRadius = 6;
  private populationStats: PopulationStats = {
    total: 0,
    assigned: 0,
    available: 0,
    housingCapacity: 0,
    housed: 0,
    vacant: 0,
  };

  constructor(options: ResourceInspectorOptions) {
    this.options = options;

    options.uiRoot.insertAdjacentHTML(
      'beforeend',
      `
      <aside class="resource-inspector-panel" data-resource-inspector hidden aria-label="Resource inspector">
        <header class="road-controls-header resource-inspector-header">
          <div>
            <p class="road-controls-eyebrow" data-inspector-eyebrow>Resources</p>
            <h2 class="road-controls-title" data-inspector-title>Select a site</h2>
            <p class="road-controls-status" data-inspector-status>Click terrain to inspect quarries, buildings, residences, or river access.</p>
          </div>
        </header>
        <div class="resource-inspector-scroll">
          <section class="resource-inspector-details" aria-label="Resource details">
            <ul class="road-controls-list" data-inspector-details></ul>
          </section>
          <section class="resource-inspector-labor" data-inspector-labor hidden aria-label="Labor assignment">
            <div class="resource-inspector-labor-row">
              <span>Assigned labor</span>
              <div class="resource-inspector-labor-controls">
                <button type="button" class="resource-inspector-labor-button" data-action="labor-decrease" aria-label="Decrease labor">−</button>
                <strong data-inspector-labor-count>0</strong>
                <button type="button" class="resource-inspector-labor-button" data-action="labor-increase" aria-label="Increase labor">+</button>
              </div>
            </div>
            <p class="resource-inspector-labor-hint" data-inspector-labor-hint></p>
          </section>
        </div>
        <footer class="resource-inspector-footer">
          <section class="resource-inspector-supplemental" data-inspector-supplemental hidden aria-label="Inspector actions"></section>
          <section class="resource-inspector-actions" data-inspector-actions hidden aria-label="Building actions">
            <button type="button" class="resource-inspector-demolish" data-action="demolish-primary">
              Demolish
            </button>
            <p class="resource-inspector-demolish-hint" data-demolish-hint></p>
            <button type="button" class="resource-inspector-demolish resource-inspector-demolish--secondary" data-action="demolish-secondary" hidden>
              Demolish plot
            </button>
            <p class="resource-inspector-demolish-hint" data-demolish-secondary-hint hidden></p>
          </section>
        </footer>
      </aside>
    `,
    );

    this.panel = this.mustElement(options.uiRoot, '[data-resource-inspector]');
    this.eyebrow = this.mustElement(options.uiRoot, '[data-inspector-eyebrow]');
    this.title = this.mustElement(options.uiRoot, '[data-inspector-title]');
    this.status = this.mustElement(options.uiRoot, '[data-inspector-status]');
    this.detailList = this.mustElement(options.uiRoot, '[data-inspector-details]');
    this.stockpileRoot = this.mustElement(options.uiRoot, '[data-settlement-hud]');
    this.stockpileValues = {
      timber: this.mustElement(options.uiRoot, '[data-stockpile="timber"]'),
      stone: this.mustElement(options.uiRoot, '[data-stockpile="stone"]'),
      firewood: this.mustElement(options.uiRoot, '[data-stockpile="firewood"]'),
      water: this.mustElement(options.uiRoot, '[data-stockpile="water"]'),
      food: this.mustElement(options.uiRoot, '[data-stockpile="food"]'),
      gold: this.mustElement(options.uiRoot, '[data-stockpile="gold"]'),
      grain: this.mustElement(options.uiRoot, '[data-stockpile="grain"]'),
      flour: this.mustElement(options.uiRoot, '[data-stockpile="flour"]'),
      ale: this.mustElement(options.uiRoot, '[data-stockpile="ale"]'),
      preservedFood: this.mustElement(options.uiRoot, '[data-stockpile="preservedFood"]'),
      honey: this.mustElement(options.uiRoot, '[data-stockpile="honey"]'),
      wine: this.mustElement(options.uiRoot, '[data-stockpile="wine"]'),
    };
    this.populationValue = this.mustElement(options.uiRoot, '[data-stockpile="population"]');
    this.housingValue = this.mustElement(options.uiRoot, '[data-stockpile="housing"]');
    this.housingSub = this.mustElement(options.uiRoot, '[data-stockpile="housing-sub"]');
    this.laborValue = this.mustElement(options.uiRoot, '[data-stockpile="labor"]');
    this.demolishSection = this.mustElement(options.uiRoot, '[data-inspector-actions]');
    this.demolishButton = this.mustButton(options.uiRoot, '[data-action="demolish-primary"]');
    this.demolishSecondaryButton = this.mustButton(options.uiRoot, '[data-action="demolish-secondary"]');
    this.demolishHint = this.mustElement(options.uiRoot, '[data-demolish-hint]');
    this.demolishSecondaryHint = this.mustElement(options.uiRoot, '[data-demolish-secondary-hint]');
    this.laborSection = this.mustElement(options.uiRoot, '[data-inspector-labor]');
    this.laborCount = this.mustElement(options.uiRoot, '[data-inspector-labor-count]');
    this.laborHint = this.mustElement(options.uiRoot, '[data-inspector-labor-hint]');
    this.laborDecrease = this.mustButton(options.uiRoot, '[data-action="labor-decrease"]');
    this.laborIncrease = this.mustButton(options.uiRoot, '[data-action="labor-increase"]');
    this.supplementalPanelSection = this.mustElement(options.uiRoot, '[data-inspector-supplemental]');

    this.marker = createSelectionMarker();
    options.sceneManager.selectionGroup.add(this.marker);
    this.marker.visible = false;

    options.domElement.addEventListener('mousedown', this.onPointerDown, { capture: true });
    this.panel.addEventListener('mousedown', (event) => event.stopPropagation());
    this.panel.addEventListener('click', this.onPanelClick);
    this.demolishButton.addEventListener('click', this.onDemolishPrimaryClick);
    this.demolishSecondaryButton.addEventListener('click', this.onDemolishSecondaryClick);
    this.laborDecrease.addEventListener('click', this.onLaborDecrease);
    this.laborIncrease.addEventListener('click', this.onLaborIncrease);
  }

  private readonly onDemolishPrimaryClick = (): void => {
    if (!this.selectedTarget) return;
    if (this.selectedTarget.kind === 'building') {
      void this.options.onDemolishBuilding?.(this.selectedTarget.building.id);
      return;
    }
    if (this.selectedTarget.kind === 'residence') {
      void this.options.onDemolishResidence?.(this.selectedTarget.residence.id);
      return;
    }
    if (this.selectedTarget.kind === 'backyard' && this.selectedTarget.garden) {
      void this.options.onDemolishBackyardGarden?.(this.selectedTarget.residence.id);
      return;
    }
    if (this.selectedTarget.kind === 'farm-field') {
      void this.options.onDemolishFarmField?.(this.selectedTarget.field.id);
    }
  };

  private readonly onPanelClick = (event: MouseEvent): void => {
    event.stopPropagation();
    if (this.selectedTarget?.kind === 'farm-field') {
      const crop = (event.target as HTMLElement).closest<HTMLElement>('[data-field-crop]')?.dataset.fieldCrop;
      if (crop === 'rye' || crop === 'oats' || crop === 'fallow') {
        void this.options.onSetFarmFieldCrop?.(this.selectedTarget.field.id, crop);
        return;
      }
      const priorityValue = (event.target as HTMLElement).closest<HTMLElement>('[data-field-priority]')?.dataset.fieldPriority;
      if (priorityValue != null) {
        void this.options.onSetFarmFieldPriority?.(this.selectedTarget.field.id, Number(priorityValue));
        return;
      }
    }
    handleSupplementalPanelClick(this.selectedTarget, event.target as HTMLElement, {
      onPlaceBackyardGarden: this.options.onPlaceBackyardGarden,
      onMarketplaceTrade: this.options.onMarketplaceTrade,
      onCollectChapelCoffer: this.options.onCollectChapelCoffer,
      onUpgradeResidence: this.options.onUpgradeResidence,
    });
  };

  private readonly onDemolishSecondaryClick = (): void => {
    if (this.selectedTarget?.kind !== 'residence') return;
    void this.options.onDemolishBurgageZone?.(this.selectedTarget.zone.id);
  };

  private readonly onLaborDecrease = (): void => {
    if (this.selectedTarget?.kind !== 'building') return;
    const building = this.selectedTarget.building;
    void this.options.onAssignBuildingLabor?.(building.id, Math.max(0, building.assignedLabor - 1));
  };

  private readonly onLaborIncrease = (): void => {
    if (this.selectedTarget?.kind !== 'building') return;
    const building = this.selectedTarget.building;
    const maxLabor = maxAssignableLabor(building, this.populationStats);
    void this.options.onAssignBuildingLabor?.(building.id, Math.min(maxLabor, building.assignedLabor + 1));
  };

  setHud(totals: ResourceTotals, population: PopulationStats): void {
    this.populationStats = population;
    this.stockpileValues.timber.textContent = Math.round(totals.timber).toString();
    this.stockpileValues.stone.textContent = Math.round(totals.stone).toString();
    this.stockpileValues.firewood.textContent = Math.round(totals.firewood).toString();
    this.stockpileValues.water.textContent = Math.round(totals.water).toString();
    this.stockpileValues.food.textContent = Math.round(totals.food).toString();
    this.stockpileValues.gold.textContent = totals.gold.toFixed(1);
    this.stockpileValues.grain.textContent = Math.round(totals.grain).toString();
    this.stockpileValues.flour.textContent = Math.round(totals.flour).toString();
    this.stockpileValues.ale.textContent = Math.round(totals.ale).toString();
    this.stockpileValues.preservedFood.textContent = Math.round(totals.preservedFood).toString();
    this.stockpileValues.honey.textContent = Math.round(totals.honey).toString();
    this.stockpileValues.wine.textContent = Math.round(totals.wine).toString();
    this.populationValue.textContent = population.total.toString();
    this.housingValue.textContent = `${population.housed}/${population.housingCapacity}`;
    this.housingSub.textContent = population.vacant === 1
      ? '1 vacant'
      : `${population.vacant} vacant`;
    this.laborValue.textContent = population.available.toString();
    const laborSub = this.stockpileRoot.querySelector<HTMLElement>('[data-stockpile="labor-sub"]');
    if (laborSub) {
      laborSub.textContent = population.assigned > 0
        ? `${population.assigned} assigned`
        : 'available';
    }
  }

  selectQuarry(quarryId: string): void {
    const target = this.options.worldQueries.findQuarryTarget(quarryId);
    if (!target) return;
    this.selectTarget(target);
  }

  selectForaging(nodeId: string): void {
    const target = this.options.worldQueries.findForagingTarget(nodeId);
    if (!target) return;
    this.selectTarget(target);
  }

  selectBackyard(residenceId: string): void {
    const target = this.options.worldQueries.findBackyardTarget(residenceId);
    if (!target) return;
    this.selectTarget(target);
  }

  refreshSelection(): void {
    if (!this.selectedTarget) return;
    const latest = this.options.worldQueries.findInspectableTarget(this.selectedX, this.selectedZ);
    if (!latest) {
      this.clearSelection(false);
      return;
    }
    if (this.selectedTarget.kind === 'building' && latest.kind === 'building' && latest.building.id === this.selectedTarget.building.id) {
      this.selectedTarget = latest;
      this.renderTarget(latest);
      return;
    }
    if (this.selectedTarget.kind === 'residence' && latest.kind === 'residence' && latest.residence.id === this.selectedTarget.residence.id) {
      this.selectedTarget = latest;
      this.renderTarget(latest);
      return;
    }
    if (this.selectedTarget.kind === 'quarry' && latest.kind === 'quarry' && latest.definition.id === this.selectedTarget.definition.id) {
      this.selectedTarget = latest;
      this.renderTarget(latest);
      return;
    }
    if (this.selectedTarget.kind === 'foraging' && latest.kind === 'foraging' && latest.definition.id === this.selectedTarget.definition.id) {
      this.selectedTarget = latest;
      this.renderTarget(latest);
      return;
    }
    if (this.selectedTarget.kind === 'backyard' && latest.kind === 'backyard' && latest.residence.id === this.selectedTarget.residence.id) {
      this.selectedTarget = latest;
      this.renderTarget(latest);
      return;
    }
    if (this.selectedTarget.kind === 'river' && latest.kind === 'river') {
      this.selectedTarget = latest;
      this.renderTarget(latest);
      return;
    }
    if (this.selectedTarget.kind === 'farm-field' && latest.kind === 'farm-field' && latest.field.id === this.selectedTarget.field.id) {
      this.selectedTarget = latest;
      this.renderTarget(latest);
      return;
    }
    this.clearSelection(false);
  }

  dispose(): void {
    this.options.domElement.removeEventListener('mousedown', this.onPointerDown, { capture: true });
    this.demolishButton.removeEventListener('click', this.onDemolishPrimaryClick);
    this.demolishSecondaryButton.removeEventListener('click', this.onDemolishSecondaryClick);
    this.panel.removeEventListener('click', this.onPanelClick);
    this.laborDecrease.removeEventListener('click', this.onLaborDecrease);
    this.laborIncrease.removeEventListener('click', this.onLaborIncrease);
    this.options.sceneManager.selectionGroup.remove(this.marker);
    disposeObject3D(this.marker);
    this.panel.remove();
  }

  private readonly onPointerDown = (event: MouseEvent): void => {
    if (event.button !== 0) return;
    if (this.options.isBlocked()) return;
    if (event.altKey) return;

    const point = this.options.terrainProjector.pick(event.clientX, event.clientY);
    if (!point) return;

    const target = this.options.worldQueries.findInspectableTarget(point.x, point.z);
    if (!target) {
      this.clearSelection(true);
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    this.selectTarget(target);
  };

  private selectTarget(target: InspectableTarget): void {
    this.selectedTarget = target;
    if (target.kind === 'quarry') {
      this.selectedX = target.definition.x;
      this.selectedZ = target.definition.z;
      this.selectedRadius = target.definition.pickRadius * 0.42;
    } else if (target.kind === 'foraging') {
      this.selectedX = target.definition.x;
      this.selectedZ = target.definition.z;
      this.selectedRadius = target.definition.pickRadius * 0.42;
    } else if (target.kind === 'building') {
      this.selectedX = target.building.x;
      this.selectedZ = target.building.z;
      this.selectedRadius = 0;
    } else if (target.kind === 'residence') {
      this.selectedX = target.residence.x;
      this.selectedZ = target.residence.z;
      this.selectedRadius = 4.2;
    } else if (target.kind === 'backyard') {
      const position = backyardIconPosition(target.residence, target.zone);
      this.selectedX = position?.x ?? target.residence.x;
      this.selectedZ = position?.z ?? target.residence.z;
      this.selectedRadius = 3.8;
    } else if (target.kind === 'farm-field') {
      const center = target.field.corners.reduce((sum, point) => ({ x: sum.x + point.x / 4, z: sum.z + point.z / 4 }), { x: 0, z: 0 });
      this.selectedX = center.x;
      this.selectedZ = center.z;
      this.selectedRadius = Math.max(3, Math.sqrt(target.field.area) * 0.18);
    } else {
      this.selectedX = target.x;
      this.selectedZ = target.z;
      this.selectedRadius = 6;
    }
    this.renderTarget(target);
    this.updateMarker();
    this.panel.hidden = false;
    this.options.onSelectionChange?.(target);
  }

  private clearSelection(hidePanel: boolean): void {
    this.selectedTarget = null;
    this.marker.visible = false;
    this.demolishSection.hidden = true;
    this.laborSection.hidden = true;
    this.supplementalPanelSection.hidden = true;
    if (hidePanel) this.panel.hidden = true;
    this.options.onSelectionChange?.(null);
  }

  private renderTarget(target: InspectableTarget): void {
    const view = renderInspectableTarget(target, {
      worldQueries: this.options.worldQueries,
      populationStats: this.populationStats,
      resourceTotals: computeResourceTotals(this.options.getState()),
      ...(this.options.getEconomicActivityTaxRate
        ? { getEconomicActivityTaxRate: this.options.getEconomicActivityTaxRate }
        : {}),
      ...(this.options.getParishPolicy
        ? { getParishPolicy: this.options.getParishPolicy }
        : {}),
      getTradeAvailability: () => computeTradeAvailability(this.options.getState()),
      getMarketState: () => this.options.getMarketState?.() ?? DEFAULT_REGIONAL_MARKET_STATE,
    });

    this.eyebrow.textContent = view.eyebrow;
    this.title.textContent = view.title;
    this.status.textContent = view.statusText;
    this.status.dataset.state = view.statusState;
    this.detailList.innerHTML = view.detailsHtml;

    this.demolishSection.hidden = !view.demolish.visible;
    this.demolishButton.textContent = view.demolish.label ?? 'Demolish';
    this.demolishHint.textContent = view.demolish.hint;

    const secondary = view.demolish.secondary;
    this.demolishSecondaryButton.hidden = !secondary;
    this.demolishSecondaryHint.hidden = !secondary;
    if (secondary) {
      this.demolishSecondaryButton.textContent = secondary.label;
      this.demolishSecondaryHint.textContent = secondary.hint;
    } else {
      this.demolishSecondaryButton.textContent = '';
      this.demolishSecondaryHint.textContent = '';
    }

    this.laborSection.hidden = !view.labor.visible;
    if (view.labor.visible) {
      this.laborCount.textContent = view.labor.count.toString();
      this.laborHint.textContent = view.labor.hint;
      this.laborDecrease.disabled = view.labor.decreaseDisabled;
      this.laborIncrease.disabled = view.labor.increaseDisabled;
    }

    if (view.supplementalPanelHtml) {
      this.supplementalPanelSection.hidden = false;
      this.supplementalPanelSection.innerHTML = view.supplementalPanelHtml;
    } else {
      this.supplementalPanelSection.hidden = true;
      this.supplementalPanelSection.innerHTML = '';
    }
  }

  private updateMarker(): void {
    if (!this.selectedTarget || this.selectedTarget.kind === 'building') {
      this.marker.visible = false;
      return;
    }

    const y = this.options.sceneManager.terrain.getHeightAt(this.selectedX, this.selectedZ) + 0.35;
    this.marker.scale.set(this.selectedRadius, 1, this.selectedRadius);
    this.marker.position.set(this.selectedX, y, this.selectedZ);
    this.marker.visible = true;
  }

  private mustElement(root: HTMLElement, selector: string): HTMLElement {
    const element = root.querySelector<HTMLElement>(selector);
    if (!element) throw new Error(`Missing resource inspector element ${selector}`);
    return element;
  }

  private mustButton(root: HTMLElement, selector: string): HTMLButtonElement {
    const element = root.querySelector<HTMLButtonElement>(selector);
    if (!element) throw new Error(`Missing resource inspector button ${selector}`);
    return element;
  }
}

function createSelectionMarker(): THREE.Mesh {
  const geometry = new THREE.RingGeometry(0.72, 1, 48);
  geometry.rotateX(-Math.PI * 0.5);
  const material = new THREE.MeshBasicMaterial({
    color: 0xd7b463,
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'Resource selection marker';
  mesh.renderOrder = 12;
  return mesh;
}
