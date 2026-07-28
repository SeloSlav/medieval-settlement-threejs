import * as THREE from 'three';
import type { TerrainProjector } from '../terrain/TerrainProjector.ts';
import type { SceneManager } from '../scene/SceneManager.ts';
import { disposeObject3D } from '../utils/dispose.ts';
import {
  HUD_RESOURCE_KINDS,
  computeResourceTotals,
  computeMarketplaceTradeAvailability,
  maxAssignableLabor,
  type PopulationStats,
  type ResourceTotals,
} from './resourceTotals.ts';
import { FARM_CROPS, type FarmCrop, type GameState, type InspectableTarget, type LivestockSpecies } from './types.ts';
import type { WorldQueries } from './WorldQueries.ts';
import { renderInspectableTarget } from './inspector/renderInspectableTarget.ts';
import { handleSupplementalPanelClick } from './inspector/supplementalPanel.ts';
import type { ParishPolicyState } from '../economy/chapelParish.ts';
import type { MonasteryPolicyState } from '../economy/monasteryPolicy.ts';
import type { RegionalMarketState } from '../economy/regionalMarket.ts';
import { DEFAULT_REGIONAL_MARKET_STATE } from '../economy/regionalMarket.ts';
import type { BackyardGardenKind } from '../residences/backyardGarden.ts';
import { backyardIconPosition } from '../residences/backyardPosition.ts';
import { fireForTarget, fireSourceLabel } from '../fires/fireIncident.ts';
import {
  buildingFireRecoveryQuote,
  fireRecoveryCoolingSeconds,
  residenceFireRecoveryQuote,
} from '../fires/fireRecovery.ts';
import type { SettlementSecurityState } from '../security/frontierSecurity.ts';
import { formatBuildingCost } from './buildingEconomy.ts';
import {
  isStorehouseCommodity,
  type StorehouseCommodity,
} from '../economy/storehousePolicy.ts';
import { isProcessorOutputTargetKind } from '../economy/processorOutputPolicy.ts';
import { computeSettlementProductionCapacity } from '../economy/settlementProduction.ts';
import { settlementHasStaffedChapel } from '../logistics/landmarkAccess.ts';
import { gameClock } from '../world/gameCalendar.ts';
import { environmentFor } from '../world/seasonPolicy.ts';

type ResourceInspectorOptions = {
  domElement: HTMLElement;
  uiRoot: HTMLElement;
  sceneManager: SceneManager;
  terrainProjector: TerrainProjector;
  worldQueries: WorldQueries;
  getState: () => GameState;
  getEconomicActivityTaxRate?: () => number;
  getSeasonalLaborStewardEnabled?: () => boolean;
  getConstructionLaborStewardEnabled?: () => boolean;
  getProductionLaborStewardEnabled?: () => boolean;
  getLaborStewardReserve?: () => number;
  getParishPolicy?: () => ParishPolicyState;
  getMonasteryPolicy?: () => MonasteryPolicyState;
  getMarketState?: () => RegionalMarketState;
  getSettlementSecurity?: () => SettlementSecurityState;
  getConflictEnabled?: () => boolean;
  getEnemyPressure?: () => number;
  getWorldHydrology?: () => number;
  onDemolishBuilding?: (buildingId: string) => void | Promise<void>;
  onDemolishResidence?: (residenceId: string) => void | Promise<void>;
  onUpgradeResidence?: (residenceId: string) => void | Promise<void>;
  onSetResidenceUpgradePriority?: (
    residenceId: string,
    priority: number,
  ) => void | Promise<void>;
  onRepairFireDamage?: (
    targetKind: 'building' | 'residence',
    targetId: string,
  ) => void | Promise<void>;
  onDemolishBurgageZone?: (zoneId: string) => void | Promise<void>;
  onPlaceBackyardGarden?: (residenceId: string, kind: BackyardGardenKind) => void | Promise<void>;
  onDemolishBackyardGarden?: (residenceId: string) => void | Promise<void>;
  onAssignBuildingLabor?: (buildingId: string, labor: number) => void | Promise<void>;
  onRotateConstructionLabor?: () => void | Promise<void>;
  onRecallIdleSeasonalLabor?: () => void | Promise<void>;
  onCallUpActiveSeasonalLabor?: () => void | Promise<void>;
  onRecallTargetIdleProcessorLabor?: () => void | Promise<void>;
  onCallUpTargetReadyProcessorLabor?: () => void | Promise<void>;
  onBalanceYearRoundLabor?: () => void | Promise<void>;
  onSetConstructionPriority?: (buildingId: string, priority: number) => void | Promise<void>;
  onMarketplaceTrade?: (buildingId: string, tradeId: string) => void | Promise<void>;
  onCancelMarketplaceTradeOrder?: (buildingId: string) => void | Promise<void>;
  onCollectChapelCoffer?: (buildingId: string) => void | Promise<void>;
  onSetEconomicActivityTaxRate?: (taxRate: number) => void | Promise<void>;
  onSetSeasonalLaborSteward?: (enabled: boolean) => void | Promise<void>;
  onSetConstructionLaborSteward?: (enabled: boolean) => void | Promise<void>;
  onSetProductionLaborSteward?: (enabled: boolean) => void | Promise<void>;
  onSetLaborStewardReserve?: (laborReserve: number) => void | Promise<void>;
  onSetChapelParishPolicy?: (autoSweepEnabled: boolean, cofferReserveGold: number, sabbathObservanceEnabled: boolean) => void | Promise<void>;
  onSetMonasteryPolicy?: (titheShare: number, feastsEnabled: boolean) => void | Promise<void>;
  onSetStorehousePolicy?: (buildingId: string, acceptsTimber: boolean, acceptsStone: boolean, acceptsFirewood: boolean) => void | Promise<void>;
  onSetStorehouseStockTarget?: (
    buildingId: string,
    commodity: StorehouseCommodity,
    targetPercent: number,
  ) => void | Promise<void>;
  onSetProcessorOutputTarget?: (
    buildingId: string,
    targetPercent: number,
  ) => void | Promise<void>;
  onSetGranaryPolicy?: (
    buildingId: string,
    acceptsFreshFood: boolean,
    householdsFirst: boolean,
  ) => void | Promise<void>;
  onSetGranaryGrainReserve?: (
    buildingId: string,
    grainReserve: number,
  ) => void | Promise<void>;
  onSetGranaryFreshFoodTarget?: (
    buildingId: string,
    targetPercent: number,
  ) => void | Promise<void>;
  onSetWoodcutterTimberReserve?: (
    buildingId: string,
    timberReserve: number,
  ) => void | Promise<void>;
  onSetCarpenterPolearmReserve?: (
    buildingId: string,
    polearmReserve: number,
  ) => void | Promise<void>;
  onSetGuardhousePayPriority?: (
    buildingId: string,
    payPriority: number,
  ) => void | Promise<void>;
  onSetGuardhouseFoodReserve?: (
    buildingId: string,
    reservePerGuard: number,
  ) => void | Promise<void>;
  onSetMarketplaceIronworkTarget?: (
    buildingId: string,
    ironworkTarget: number,
  ) => void | Promise<void>;
  onSetMarketplaceGoldReserveTarget?: (
    buildingId: string,
    goldReserveTarget: number,
  ) => void | Promise<void>;
  onSetMarketplaceSeedGrainTarget?: (
    buildingId: string,
    seedGrainTarget: number,
  ) => void | Promise<void>;
  onSetMarketplaceSpecialtyExportPolicy?: (
    buildingId: string,
    exportPolicy: number,
  ) => void | Promise<void>;
  onSetHarvestReservePercent?: (
    buildingId: string,
    reservePercent: number,
  ) => void | Promise<void>;
  onDemolishFarmField?: (fieldId: string) => void | Promise<void>;
  onSetFarmFieldCrop?: (fieldId: string, crop: FarmCrop) => void | Promise<void>;
  onSetFarmFieldFollowingCrop?: (
    fieldId: string,
    crop: FarmCrop | null,
  ) => void | Promise<void>;
  onSetFarmFieldPriority?: (fieldId: string, priority: number) => void | Promise<void>;
  onStartFarmFieldEarlyHarvest?: (fieldId: string) => void | Promise<void>;
  onDemolishPasture?: (pastureId: string) => void | Promise<void>;
  onSetLivestockSpecies?: (buildingId: string, species: Exclude<LivestockSpecies, 'swine'>) => void | Promise<void>;
  onSetLivestockBreedingReserve?: (buildingId: string, breedingReserve: number) => void | Promise<void>;
  onSetLivestockHaymakingPercent?: (buildingId: string, haymakingPercent: number) => void | Promise<void>;
  onBeginFarmFieldPlacement?: (farmsteadId: string) => void;
  onBeginPasturePlacement?: (farmsteadId: string) => void;
  onInspectDeliveryTrip?: (tripId: string) => void;
  onFocusWorldPosition?: (x: number, z: number) => void;
  onSelectionChange?: (target: InspectableTarget | null) => void;
  isBlocked: () => boolean;
};

export class ResourceInspector {
  private readonly options: ResourceInspectorOptions;
  private readonly panel: HTMLElement;
  private readonly eyebrow: HTMLElement;
  private readonly title: HTMLElement;
  private readonly status: HTMLElement;
  private readonly heroArt: HTMLElement;
  private readonly heroSymbol: HTMLElement;
  private readonly closeButton: HTMLButtonElement;
  private readonly detailList: HTMLElement;
  private readonly secondaryDetailList: HTMLElement;
  private readonly detailDisclosure: HTMLDetailsElement;
  private readonly detailDisclosureCount: HTMLElement;
  private readonly stockpileRoot: HTMLElement;
  private readonly stockpileValues: Record<
    'timber' | 'stone' | 'firewood' | 'water' | 'food' | 'gold' | 'grain' | 'flour' | 'ale' | 'preservedFood' | 'honey' | 'wine' | 'wool' | 'cloth' | 'ironwork' | 'polearms',
    HTMLElement
  >;
  private readonly stockpileTransitValues: Record<keyof ResourceTotals, HTMLElement>;
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
  private renderedIdentity = '';
  private selectedX = 0;
  private selectedZ = 0;
  private populationStats: PopulationStats = {
    total: 0,
    assigned: 0,
    cartAssigned: 0,
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
          <div class="resource-inspector-hero-art" data-inspector-hero aria-hidden="true">
            <span class="resource-inspector-hero-symbol" data-inspector-symbol>◆</span>
          </div>
          <div class="resource-inspector-heading">
            <p class="road-controls-eyebrow" data-inspector-eyebrow>Resources</p>
            <h2 class="road-controls-title" data-inspector-title>Select a site</h2>
            <p class="road-controls-status resource-inspector-status" data-inspector-status>Click terrain to inspect quarries, buildings, residences, or river access.</p>
          </div>
          <button class="resource-inspector-close" type="button" data-inspector-close aria-label="Close inspector">×</button>
        </header>
        <div class="resource-inspector-scroll">
          <section class="resource-inspector-details" aria-label="At a glance">
            <ul class="road-controls-list" data-inspector-details></ul>
            <details class="resource-inspector-ledger" data-inspector-ledger>
              <summary>
                <span>Full ledger</span>
                <span data-inspector-ledger-count>0 details</span>
              </summary>
              <ul class="road-controls-list resource-inspector-ledger-list" data-inspector-secondary-details></ul>
            </details>
          </section>
          <section class="resource-inspector-labor" data-inspector-labor hidden aria-label="Labor assignment">
            <div class="resource-inspector-labor-row">
              <span class="resource-inspector-labor-label"><span aria-hidden="true">⚒</span> Workforce</span>
              <div class="resource-inspector-labor-controls">
                <button type="button" class="resource-inspector-labor-button" data-action="labor-decrease" aria-label="Decrease labor">−</button>
                <strong data-inspector-labor-count>0</strong>
                <button type="button" class="resource-inspector-labor-button" data-action="labor-increase" aria-label="Increase labor">+</button>
              </div>
            </div>
            <p class="resource-inspector-labor-hint" data-inspector-labor-hint></p>
          </section>
          <section class="resource-inspector-supplemental" data-inspector-supplemental hidden aria-label="Inspector actions"></section>
        </div>
        <footer class="resource-inspector-footer">
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
    this.heroArt = this.mustElement(options.uiRoot, '[data-inspector-hero]');
    this.heroSymbol = this.mustElement(options.uiRoot, '[data-inspector-symbol]');
    this.closeButton = this.mustButton(options.uiRoot, '[data-inspector-close]');
    this.detailList = this.mustElement(options.uiRoot, '[data-inspector-details]');
    this.secondaryDetailList = this.mustElement(options.uiRoot, '[data-inspector-secondary-details]');
    const detailDisclosure = options.uiRoot.querySelector<HTMLDetailsElement>('[data-inspector-ledger]');
    if (!detailDisclosure) throw new Error('Missing resource inspector ledger');
    this.detailDisclosure = detailDisclosure;
    this.detailDisclosureCount = this.mustElement(options.uiRoot, '[data-inspector-ledger-count]');
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
      wool: this.mustElement(options.uiRoot, '[data-stockpile="wool"]'),
      cloth: this.mustElement(options.uiRoot, '[data-stockpile="cloth"]'),
      ironwork: this.mustElement(options.uiRoot, '[data-stockpile="ironwork"]'),
      polearms: this.mustElement(options.uiRoot, '[data-stockpile="polearms"]'),
    };
    this.stockpileTransitValues = Object.fromEntries(
      HUD_RESOURCE_KINDS.map((resource) => [
        resource,
        this.mustElement(options.uiRoot, `[data-stockpile-transit="${resource}"]`),
      ]),
    ) as Record<keyof ResourceTotals, HTMLElement>;
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
    this.supplementalPanelSection.addEventListener('input', this.onSupplementalInput);
    this.supplementalPanelSection.addEventListener('change', this.onSupplementalChange);
    this.demolishButton.addEventListener('click', this.onDemolishPrimaryClick);
    this.demolishSecondaryButton.addEventListener('click', this.onDemolishSecondaryClick);
    this.laborDecrease.addEventListener('click', this.onLaborDecrease);
    this.laborIncrease.addEventListener('click', this.onLaborIncrease);
    this.closeButton.addEventListener('click', this.onCloseClick);
  }

  private readonly onCloseClick = (): void => {
    this.clearSelection(true);
  };

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
      return;
    }
    if (this.selectedTarget.kind === 'pasture') {
      void this.options.onDemolishPasture?.(this.selectedTarget.pasture.id);
    }
  };

  private readonly onPanelClick = (event: MouseEvent): void => {
    event.stopPropagation();
    const inspectDeliveryTripId = (event.target as HTMLElement)
      .closest<HTMLElement>('[data-inspect-delivery-trip]')
      ?.dataset.inspectDeliveryTrip;
    if (inspectDeliveryTripId) {
      this.options.onInspectDeliveryTrip?.(inspectDeliveryTripId);
      return;
    }
    const inspectBuildingId = (event.target as HTMLElement)
      .closest<HTMLElement>('[data-inspect-building]')
      ?.dataset.inspectBuilding;
    if (inspectBuildingId) {
      const target = this.options.worldQueries.findBuildingTarget(inspectBuildingId);
      if (target) {
        this.selectTarget(target);
        this.options.onFocusWorldPosition?.(target.building.x, target.building.z);
      }
      return;
    }
    const inspectFieldId = (event.target as HTMLElement)
      .closest<HTMLElement>('[data-inspect-field]')
      ?.dataset.inspectField;
    if (inspectFieldId) {
      const target = this.options.worldQueries.findFarmFieldTarget(inspectFieldId);
      if (target) {
        this.selectTarget(target);
        const center = target.field.corners.reduce(
          (sum, point) => ({
            x: sum.x + point.x / target.field.corners.length,
            z: sum.z + point.z / target.field.corners.length,
          }),
          { x: 0, z: 0 },
        );
        this.options.onFocusWorldPosition?.(center.x, center.z);
      }
      return;
    }
    const inspectResidenceId = (event.target as HTMLElement)
      .closest<HTMLElement>('[data-inspect-residence]')
      ?.dataset.inspectResidence;
    if (inspectResidenceId) {
      const target = this.options.worldQueries.findResidenceTarget(inspectResidenceId);
      if (target) {
        this.selectTarget(target);
        this.options.onFocusWorldPosition?.(target.residence.x, target.residence.z);
      }
      return;
    }
    if ((event.target as HTMLElement).closest('[data-fire-recovery]')) {
      if (this.selectedTarget?.kind === 'building') {
        void this.options.onRepairFireDamage?.('building', this.selectedTarget.building.id);
      } else if (this.selectedTarget?.kind === 'residence') {
        void this.options.onRepairFireDamage?.('residence', this.selectedTarget.residence.id);
      }
      return;
    }
    if (
      (event.target as HTMLElement).closest('[data-rotate-construction-labor]')
      && this.selectedTarget?.kind === 'building'
      && this.selectedTarget.building.kind === 'town_hall'
    ) {
      void this.options.onRotateConstructionLabor?.();
      return;
    }
    if (
      (event.target as HTMLElement).closest('[data-recall-idle-seasonal-labor]')
      && this.selectedTarget?.kind === 'building'
      && this.selectedTarget.building.kind === 'town_hall'
    ) {
      void this.options.onRecallIdleSeasonalLabor?.();
      return;
    }
    if (
      (event.target as HTMLElement).closest('[data-call-up-active-seasonal-labor]')
      && this.selectedTarget?.kind === 'building'
      && this.selectedTarget.building.kind === 'town_hall'
    ) {
      void this.options.onCallUpActiveSeasonalLabor?.();
      return;
    }
    if (
      (event.target as HTMLElement).closest('[data-recall-target-idle-processor-labor]')
      && this.selectedTarget?.kind === 'building'
      && this.selectedTarget.building.kind === 'town_hall'
    ) {
      void this.options.onRecallTargetIdleProcessorLabor?.();
      return;
    }
    if (
      (event.target as HTMLElement).closest('[data-call-up-target-ready-processor-labor]')
      && this.selectedTarget?.kind === 'building'
      && this.selectedTarget.building.kind === 'town_hall'
    ) {
      void this.options.onCallUpTargetReadyProcessorLabor?.();
      return;
    }
    if (
      (event.target as HTMLElement).closest('[data-balance-year-round-labor]')
      && this.selectedTarget?.kind === 'building'
      && this.selectedTarget.building.kind === 'town_hall'
    ) {
      void this.options.onBalanceYearRoundLabor?.();
      return;
    }
    if (this.selectedTarget?.kind === 'farm-field') {
      if ((event.target as HTMLElement).closest('[data-field-early-harvest]')) {
        void this.options.onStartFarmFieldEarlyHarvest?.(this.selectedTarget.field.id);
        return;
      }
      const crop = (event.target as HTMLElement).closest<HTMLElement>('[data-field-crop]')?.dataset.fieldCrop;
      if (crop != null && FARM_CROPS.includes(crop as FarmCrop)) {
        void this.options.onSetFarmFieldCrop?.(this.selectedTarget.field.id, crop as FarmCrop);
        return;
      }
      const followingCrop = (event.target as HTMLElement)
        .closest<HTMLElement>('[data-field-following-crop]')
        ?.dataset.fieldFollowingCrop;
      if (followingCrop != null && FARM_CROPS.includes(followingCrop as FarmCrop)) {
        void this.options.onSetFarmFieldFollowingCrop?.(
          this.selectedTarget.field.id,
          followingCrop as FarmCrop,
        );
        return;
      }
      if ((event.target as HTMLElement).closest('[data-field-following-clear]')) {
        void this.options.onSetFarmFieldFollowingCrop?.(this.selectedTarget.field.id, null);
        return;
      }
      const priorityValue = (event.target as HTMLElement).closest<HTMLElement>('[data-field-priority]')?.dataset.fieldPriority;
      if (priorityValue != null) {
        void this.options.onSetFarmFieldPriority?.(this.selectedTarget.field.id, Number(priorityValue));
        return;
      }
    }
    if (this.selectedTarget?.kind === 'building') {
      const building = this.selectedTarget.building;
      const constructionPriority = (event.target as HTMLElement)
        .closest<HTMLElement>('[data-construction-priority]')
        ?.dataset.constructionPriority;
      if (constructionPriority != null && !building.constructionComplete) {
        void this.options.onSetConstructionPriority?.(
          building.id,
          Number(constructionPriority),
        );
        return;
      }
      const staffingPriority = (event.target as HTMLElement)
        .closest<HTMLElement>('[data-staffing-priority]')
        ?.dataset.staffingPriority;
      if (staffingPriority != null && building.constructionComplete) {
        void this.options.onSetConstructionPriority?.(
          building.id,
          Number(staffingPriority),
        );
        return;
      }
      const landParcel = (event.target as HTMLElement).closest<HTMLElement>('[data-land-parcel]')?.dataset.landParcel;
      if (landParcel === 'field' && building.kind === 'threshing_barn') {
        this.options.onBeginFarmFieldPlacement?.(building.id);
        return;
      }
      if (landParcel === 'pasture' && (building.kind === 'pastoral_farmstead' || building.kind === 'swineherd')) {
        this.options.onBeginPasturePlacement?.(building.id);
        return;
      }
    }
    if (this.selectedTarget?.kind === 'building' && this.selectedTarget.building.kind === 'pastoral_farmstead') {
      const species = (event.target as HTMLElement).closest<HTMLElement>('[data-livestock-species]')?.dataset.livestockSpecies;
      if (species === 'cattle' || species === 'sheep') {
        void this.options.onSetLivestockSpecies?.(this.selectedTarget.building.id, species);
        return;
      }
    }
    if (
      this.selectedTarget?.kind === 'building'
      && (this.selectedTarget.building.kind === 'pastoral_farmstead'
        || this.selectedTarget.building.kind === 'swineherd')
    ) {
      const reserveValue = (event.target as HTMLElement)
        .closest<HTMLElement>('[data-livestock-breeding-reserve]')
        ?.dataset.livestockBreedingReserve;
      if (reserveValue != null) {
        void this.options.onSetLivestockBreedingReserve?.(
          this.selectedTarget.building.id,
          Number(reserveValue),
        );
        return;
      }
      const haymakingValue = (event.target as HTMLElement)
        .closest<HTMLElement>('[data-livestock-haymaking-percent]')
        ?.dataset.livestockHaymakingPercent;
      if (haymakingValue != null && this.selectedTarget.building.kind === 'pastoral_farmstead') {
        void this.options.onSetLivestockHaymakingPercent?.(
          this.selectedTarget.building.id,
          Number(haymakingValue),
        );
        return;
      }
    }
    if (
      this.selectedTarget?.kind === 'building'
      && this.selectedTarget.building.kind === 'woodcutters_lodge'
    ) {
      const reserveValue = (event.target as HTMLElement)
        .closest<HTMLElement>('[data-woodcutter-timber-reserve]')
        ?.dataset.woodcutterTimberReserve;
      if (reserveValue != null) {
        void this.options.onSetWoodcutterTimberReserve?.(
          this.selectedTarget.building.id,
          Number(reserveValue),
        );
        return;
      }
    }
    if (
      this.selectedTarget?.kind === 'building'
      && this.selectedTarget.building.kind === 'carpenter'
    ) {
      const reserveValue = (event.target as HTMLElement)
        .closest<HTMLElement>('[data-carpenter-polearm-reserve]')
        ?.dataset.carpenterPolearmReserve;
      if (reserveValue != null) {
        void this.options.onSetCarpenterPolearmReserve?.(
          this.selectedTarget.building.id,
          Number(reserveValue),
        );
        return;
      }
    }
    if (
      this.selectedTarget?.kind === 'building'
      && this.selectedTarget.building.kind === 'guardhouse'
    ) {
      const reserveValue = (event.target as HTMLElement)
        .closest<HTMLElement>('[data-guardhouse-food-reserve]')
        ?.dataset.guardhouseFoodReserve;
      if (reserveValue != null) {
        void this.options.onSetGuardhouseFoodReserve?.(
          this.selectedTarget.building.id,
          Number(reserveValue),
        );
        return;
      }
      const priorityValue = (event.target as HTMLElement)
        .closest<HTMLElement>('[data-guardhouse-pay-priority]')
        ?.dataset.guardhousePayPriority;
      if (priorityValue != null) {
        void this.options.onSetGuardhousePayPriority?.(
          this.selectedTarget.building.id,
          Number(priorityValue),
        );
        return;
      }
    }
    if (
      this.selectedTarget?.kind === 'building'
      && this.selectedTarget.building.kind === 'marketplace'
    ) {
      const targetValue = (event.target as HTMLElement)
        .closest<HTMLElement>('[data-marketplace-ironwork-target]')
        ?.dataset.marketplaceIronworkTarget;
      if (targetValue != null) {
        void this.options.onSetMarketplaceIronworkTarget?.(
          this.selectedTarget.building.id,
          Number(targetValue),
        );
        return;
      }
      const goldReserveValue = (event.target as HTMLElement)
        .closest<HTMLElement>('[data-marketplace-gold-reserve-target]')
        ?.dataset.marketplaceGoldReserveTarget;
      if (goldReserveValue != null) {
        void this.options.onSetMarketplaceGoldReserveTarget?.(
          this.selectedTarget.building.id,
          Number(goldReserveValue),
        );
        return;
      }
      const seedTargetValue = (event.target as HTMLElement)
        .closest<HTMLElement>('[data-marketplace-seed-grain-target]')
        ?.dataset.marketplaceSeedGrainTarget;
      if (seedTargetValue != null) {
        void this.options.onSetMarketplaceSeedGrainTarget?.(
          this.selectedTarget.building.id,
          Number(seedTargetValue),
        );
        return;
      }
      const exportPolicyValue = (event.target as HTMLElement)
        .closest<HTMLElement>('[data-marketplace-specialty-export-policy]')
        ?.dataset.marketplaceSpecialtyExportPolicy;
      if (exportPolicyValue != null) {
        void this.options.onSetMarketplaceSpecialtyExportPolicy?.(
          this.selectedTarget.building.id,
          Number(exportPolicyValue),
        );
        return;
      }
    }
    if (
      this.selectedTarget?.kind === 'building'
      && this.selectedTarget.building.kind === 'village_storehouse'
    ) {
      const targetButton = (event.target as HTMLElement)
        .closest<HTMLElement>('[data-storehouse-stock-target]');
      const commodity = targetButton?.dataset.storehouseStockKind;
      const targetValue = targetButton?.dataset.storehouseStockTarget;
      if (targetValue != null && isStorehouseCommodity(commodity)) {
        void this.options.onSetStorehouseStockTarget?.(
          this.selectedTarget.building.id,
          commodity,
          Number(targetValue),
        );
        return;
      }
    }
    if (
      this.selectedTarget?.kind === 'building'
      && isProcessorOutputTargetKind(this.selectedTarget.building.kind)
    ) {
      const targetValue = (event.target as HTMLElement)
        .closest<HTMLElement>('[data-processor-output-target]')
        ?.dataset.processorOutputTarget;
      if (targetValue != null) {
        void this.options.onSetProcessorOutputTarget?.(
          this.selectedTarget.building.id,
          Number(targetValue),
        );
        return;
      }
    }
    if (
      this.selectedTarget?.kind === 'building'
      && this.selectedTarget.building.kind === 'granary'
    ) {
      const reserveValue = (event.target as HTMLElement)
        .closest<HTMLElement>('[data-granary-grain-reserve]')
        ?.dataset.granaryGrainReserve;
      if (reserveValue != null) {
        void this.options.onSetGranaryGrainReserve?.(
          this.selectedTarget.building.id,
          Number(reserveValue),
        );
        return;
      }
      const foodTargetValue = (event.target as HTMLElement)
        .closest<HTMLElement>('[data-granary-fresh-food-target]')
        ?.dataset.granaryFreshFoodTarget;
      if (foodTargetValue != null) {
        void this.options.onSetGranaryFreshFoodTarget?.(
          this.selectedTarget.building.id,
          Number(foodTargetValue),
        );
        return;
      }
    }
    if (
      this.selectedTarget?.kind === 'building'
      && (
        this.selectedTarget.building.kind === 'hunters_hall'
        || this.selectedTarget.building.kind === 'fishing_camp'
      )
    ) {
      const reserveValue = (event.target as HTMLElement)
        .closest<HTMLElement>('[data-harvest-reserve-percent]')
        ?.dataset.harvestReservePercent;
      if (reserveValue != null) {
        void this.options.onSetHarvestReservePercent?.(
          this.selectedTarget.building.id,
          Number(reserveValue),
        );
        return;
      }
    }
    handleSupplementalPanelClick(this.selectedTarget, event.target as HTMLElement, {
      onPlaceBackyardGarden: this.options.onPlaceBackyardGarden,
      onMarketplaceTrade: this.options.onMarketplaceTrade,
      onCancelMarketplaceTradeOrder: this.options.onCancelMarketplaceTradeOrder,
      onCollectChapelCoffer: this.options.onCollectChapelCoffer,
      onUpgradeResidence: this.options.onUpgradeResidence,
      onSetResidenceUpgradePriority: this.options.onSetResidenceUpgradePriority,
    });
  };

  private readonly onDemolishSecondaryClick = (): void => {
    if (this.selectedTarget?.kind !== 'residence') return;
    void this.options.onDemolishBurgageZone?.(this.selectedTarget.zone.id);
  };

  private readonly onSupplementalInput = (event: Event): void => {
    const input = event.target as HTMLInputElement;
    if (input.matches('[data-policy-tax-rate]')) {
      const output = this.supplementalPanelSection.querySelector<HTMLElement>('[data-policy-tax-rate-value]');
      if (output) output.textContent = `${Math.round(Number(input.value))}%`;
    } else if (input.matches('[data-policy-chapel-reserve]')) {
      const output = this.supplementalPanelSection.querySelector<HTMLElement>('[data-policy-chapel-reserve-value]');
      if (output) output.textContent = `${Math.round(Number(input.value))} gold`;
    } else if (input.matches('[data-policy-monastery-tithe]')) {
      const output = this.supplementalPanelSection.querySelector<HTMLElement>('[data-policy-monastery-tithe-value]');
      if (output) output.textContent = `${Math.round(Number(input.value))}%`;
    }
  };

  private readonly onSupplementalChange = (event: Event): void => {
    event.stopPropagation();
    const input = event.target as HTMLInputElement;
    if (this.selectedTarget?.kind !== 'building') return;
    const building = this.selectedTarget.building;

    if (building.kind === 'town_hall' && input.matches('[data-policy-tax-rate]')) {
      void this.options.onSetEconomicActivityTaxRate?.(Number(input.value) / 100);
      return;
    }
    if (building.kind === 'town_hall' && input.matches('[data-policy-seasonal-labor-steward]')) {
      void this.options.onSetSeasonalLaborSteward?.(input.checked);
      return;
    }
    if (building.kind === 'town_hall' && input.matches('[data-policy-construction-labor-steward]')) {
      void this.options.onSetConstructionLaborSteward?.(input.checked);
      return;
    }
    if (building.kind === 'town_hall' && input.matches('[data-policy-production-labor-steward]')) {
      void this.options.onSetProductionLaborSteward?.(input.checked);
      return;
    }
    if (building.kind === 'town_hall' && input.matches('[data-policy-labor-steward-reserve]')) {
      void this.options.onSetLaborStewardReserve?.(Number(input.value));
      return;
    }
    if (building.kind === 'chapel' && input.matches('[data-policy-chapel-auto-sweep], [data-policy-chapel-reserve], [data-policy-chapel-sabbath]')) {
      const autoSweep = this.supplementalPanelSection.querySelector<HTMLInputElement>('[data-policy-chapel-auto-sweep]')?.checked ?? false;
      const reserve = Number(this.supplementalPanelSection.querySelector<HTMLInputElement>('[data-policy-chapel-reserve]')?.value ?? 80);
      const sabbath = this.supplementalPanelSection.querySelector<HTMLInputElement>('[data-policy-chapel-sabbath]')?.checked ?? false;
      void this.options.onSetChapelParishPolicy?.(autoSweep, reserve, sabbath);
      return;
    }
    if (building.kind === 'monastery' && input.matches('[data-policy-monastery-tithe], [data-policy-monastery-feasts]')) {
      const tithe = Number(this.supplementalPanelSection.querySelector<HTMLInputElement>('[data-policy-monastery-tithe]')?.value ?? 30) / 100;
      const feasts = this.supplementalPanelSection.querySelector<HTMLInputElement>('[data-policy-monastery-feasts]')?.checked ?? true;
      void this.options.onSetMonasteryPolicy?.(tithe, feasts);
      return;
    }
    if (building.kind === 'village_storehouse' && input.matches('[data-storehouse-accepts-timber], [data-storehouse-accepts-stone], [data-storehouse-accepts-firewood]')) {
      const timber = this.supplementalPanelSection.querySelector<HTMLInputElement>('[data-storehouse-accepts-timber]')?.checked ?? false;
      const stone = this.supplementalPanelSection.querySelector<HTMLInputElement>('[data-storehouse-accepts-stone]')?.checked ?? false;
      const firewood = this.supplementalPanelSection.querySelector<HTMLInputElement>('[data-storehouse-accepts-firewood]')?.checked ?? false;
      void this.options.onSetStorehousePolicy?.(building.id, timber, stone, firewood);
      return;
    }
    if (building.kind === 'granary' && input.matches('[data-granary-accepts-fresh-food], [data-granary-households-first]')) {
      const acceptsFreshFood = this.supplementalPanelSection.querySelector<HTMLInputElement>('[data-granary-accepts-fresh-food]')?.checked ?? true;
      const householdsFirst = this.supplementalPanelSection.querySelector<HTMLInputElement>('[data-granary-households-first]')?.checked ?? false;
      void this.options.onSetGranaryPolicy?.(building.id, acceptsFreshFood, householdsFirst);
    }
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

  setHud(
    totals: ResourceTotals,
    population: PopulationStats,
    inTransit?: ResourceTotals,
    goldAwaitingCollection = 0,
    guardhousePayrollGold = 0,
  ): void {
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
    this.stockpileValues.wool.textContent = Math.round(totals.wool).toString();
    this.stockpileValues.cloth.textContent = Math.round(totals.cloth).toString();
    this.stockpileValues.ironwork.textContent = Math.round(totals.ironwork).toString();
    this.stockpileValues.polearms.textContent = Math.round(totals.polearms).toString();
    for (const resource of HUD_RESOURCE_KINDS) {
      const transit = this.stockpileTransitValues[resource];
      const amount = Math.max(0, inTransit?.[resource] ?? 0);
      const details = [];
      if (resource === 'gold' && goldAwaitingCollection > 1e-6) {
        details.push(`+${formatTransitAmount(goldAwaitingCollection)} awaiting collection`);
      }
      if (resource === 'gold' && guardhousePayrollGold > 1e-6) {
        details.push(`${formatTransitAmount(guardhousePayrollGold)} in company pay chests`);
      }
      if (amount > 1e-6) {
        details.push(`+${formatTransitAmount(amount)} en route`);
      }
      transit.hidden = details.length === 0;
      const stat = this.stockpileValues[resource]
        .closest<HTMLElement>('.settlement-hud__stat');
      stat?.classList.toggle(
        'is-empty',
        totals[resource] <= 1e-6 && details.length === 0,
      );
      transit.textContent = details.join(' · ');
    }
    const specialtyResources = [
      'grain',
      'flour',
      'ale',
      'preservedFood',
      'honey',
      'wine',
      'wool',
      'cloth',
      'ironwork',
      'polearms',
    ] as const;
    const stockedSpecialties = specialtyResources.filter((resource) =>
      totals[resource] > 1e-6 || (inTransit?.[resource] ?? 0) > 1e-6);
    const specialtyStore = this.stockpileRoot.querySelector<HTMLElement>(
      '[data-specialty-stores]',
    );
    const specialtyStoreStatus = this.stockpileRoot.querySelector<HTMLElement>(
      '[data-specialty-stores-status]',
    );
    specialtyStore?.classList.toggle('has-stock', stockedSpecialties.length > 0);
    if (specialtyStoreStatus) {
      specialtyStoreStatus.textContent = stockedSpecialties.length === 0
        ? 'No specialty stock'
        : `${stockedSpecialties.length} ${stockedSpecialties.length === 1 ? 'stock' : 'stocks'} active`;
    }
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

  selectBuilding(buildingId: string): void {
    const target = this.options.worldQueries.findBuildingTarget(buildingId);
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
      this.options.onSelectionChange?.(latest);
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
    if (this.selectedTarget.kind === 'pasture' && latest.kind === 'pasture' && latest.pasture.id === this.selectedTarget.pasture.id) {
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
    this.supplementalPanelSection.removeEventListener('input', this.onSupplementalInput);
    this.supplementalPanelSection.removeEventListener('change', this.onSupplementalChange);
    this.laborDecrease.removeEventListener('click', this.onLaborDecrease);
    this.laborIncrease.removeEventListener('click', this.onLaborIncrease);
    this.closeButton.removeEventListener('click', this.onCloseClick);
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
    const previousIdentity = inspectableIdentity(this.selectedTarget);
    this.selectedTarget = target;
    if (previousIdentity !== inspectableIdentity(target)) {
      this.detailDisclosure.open = false;
    }
    if (target.kind === 'quarry') {
      this.selectedX = target.definition.x;
      this.selectedZ = target.definition.z;
    } else if (target.kind === 'foraging') {
      this.selectedX = target.definition.x;
      this.selectedZ = target.definition.z;
    } else if (target.kind === 'building') {
      this.selectedX = target.building.x;
      this.selectedZ = target.building.z;
    } else if (target.kind === 'residence') {
      this.selectedX = target.residence.x;
      this.selectedZ = target.residence.z;
    } else if (target.kind === 'backyard') {
      const position = backyardIconPosition(target.residence, target.zone);
      this.selectedX = position?.x ?? target.residence.x;
      this.selectedZ = position?.z ?? target.residence.z;
    } else if (target.kind === 'farm-field') {
      const center = target.field.corners.reduce((sum, point) => ({ x: sum.x + point.x / 4, z: sum.z + point.z / 4 }), { x: 0, z: 0 });
      this.selectedX = center.x;
      this.selectedZ = center.z;
    } else if (target.kind === 'pasture') {
      const center = target.pasture.corners.reduce((sum, point) => ({ x: sum.x + point.x / 4, z: sum.z + point.z / 4 }), { x: 0, z: 0 });
      this.selectedX = center.x;
      this.selectedZ = center.z;
    } else {
      this.selectedX = target.x;
      this.selectedZ = target.z;
    }
    this.renderTarget(target);
    this.updateMarker();
    this.panel.hidden = false;
    this.options.onSelectionChange?.(target);
  }

  clearSelection(hidePanel = true): void {
    this.selectedTarget = null;
    this.marker.visible = false;
    this.demolishSection.hidden = true;
    this.laborSection.hidden = true;
    this.supplementalPanelSection.hidden = true;
    if (hidePanel) this.panel.hidden = true;
    this.options.onSelectionChange?.(null);
  }

  private renderTarget(target: InspectableTarget): void {
    const identity = inspectableIdentity(target);
    const preservePolicyState = this.renderedIdentity === identity;
    const openPolicyIndices = new Set(
      preservePolicyState
        ? Array.from(
            this.supplementalPanelSection.querySelectorAll<HTMLDetailsElement>('.inspector-policy-card'),
          ).flatMap((card, index) => (card.open ? [index] : []))
        : [],
    );
    const gameState = this.options.getState();
    const resourceTotals = computeResourceTotals(gameState);
    const needsProductionForecast = (
      target.kind === 'residence' && target.residence.tier === 2
    ) || (
      target.kind === 'building'
      && target.building.kind === 'town_hall'
      && target.building.constructionComplete !== false
    );
    const sabbathObserved = (
      this.options.getParishPolicy?.().sabbathObservanceEnabled ?? false
    ) && settlementHasStaffedChapel(gameState);
    const settlementProduction = needsProductionForecast
      ? computeSettlementProductionCapacity(
          gameState,
          sabbathObserved,
          (building) => this.options.worldQueries.getRoadComponentId(
            building.x,
            building.z,
          ),
          environmentFor(
            gameState.seed,
            this.options.getWorldHydrology?.() ?? 50,
            gameClock(gameState.tick),
          ).watermillThroughputMultiplier,
        )
      : undefined;
    const view = renderInspectableTarget(target, {
      gameState,
      worldQueries: this.options.worldQueries,
      populationStats: this.populationStats,
      resourceTotals,
      worldHydrology: this.options.getWorldHydrology?.() ?? 50,
      conflictEnabled: this.options.getConflictEnabled?.() ?? false,
      enemyPressure: this.options.getEnemyPressure?.() ?? 0,
      ...(settlementProduction ? { settlementProduction } : {}),
      ...(this.options.getEconomicActivityTaxRate
        ? { getEconomicActivityTaxRate: this.options.getEconomicActivityTaxRate }
        : {}),
      ...(this.options.getSeasonalLaborStewardEnabled
        ? { getSeasonalLaborStewardEnabled: this.options.getSeasonalLaborStewardEnabled }
        : {}),
      ...(this.options.getConstructionLaborStewardEnabled
        ? { getConstructionLaborStewardEnabled: this.options.getConstructionLaborStewardEnabled }
        : {}),
      ...(this.options.getProductionLaborStewardEnabled
        ? { getProductionLaborStewardEnabled: this.options.getProductionLaborStewardEnabled }
        : {}),
      ...(this.options.getLaborStewardReserve
        ? { getLaborStewardReserve: this.options.getLaborStewardReserve }
        : {}),
      ...(this.options.getParishPolicy
        ? { getParishPolicy: this.options.getParishPolicy }
        : {}),
      ...(this.options.getMonasteryPolicy
        ? { getMonasteryPolicy: this.options.getMonasteryPolicy }
        : {}),
      getTradeAvailability: (marketplace) => computeMarketplaceTradeAvailability(
        this.options.getState(),
        marketplace,
        (ax, az, bx, bz) => this.options.worldQueries.isRoadConnected(ax, az, bx, bz),
      ),
      getMarketState: () => this.options.getMarketState?.() ?? DEFAULT_REGIONAL_MARKET_STATE,
      ...(this.options.getSettlementSecurity
        ? { getSettlementSecurity: this.options.getSettlementSecurity }
        : {}),
    });
    const fire = target.kind === 'building'
      ? fireForTarget(gameState.fireIncidents.values(), 'building', target.building.id)
      : target.kind === 'residence'
        ? fireForTarget(gameState.fireIncidents.values(), 'residence', target.residence.id)
        : null;
    if (fire) {
      const residenceRecoveryActive = target.kind === 'residence'
        && target.residence.fireRepairActive === true;
      const response = residenceRecoveryActive
        ? 'Structural recovery is underway through the shared construction queue'
        : fire.status === 'burning'
        ? fire.responseWellId
          ? 'A staffed well has dispatched a bucket carrier'
          : 'No staffed well currently has this fire inside its work extent'
        : fire.status === 'destroyed'
          ? 'Fire out; the surviving foundations can be rebuilt'
          : 'Fire suppressed; structural repairs are required';
      const carpenterSupported = this.options.worldQueries.hasCarpenterSupportAt(
        { x: fire.x, z: fire.z },
      );
      const recovery = target.kind === 'building'
        ? buildingFireRecoveryQuote(target.building, fire, carpenterSupported)
        : target.kind === 'residence'
          ? residenceFireRecoveryQuote(target.residence, fire, carpenterSupported)
          : null;
      const coolingSeconds = fireRecoveryCoolingSeconds(fire, gameState.tick);
      const canAffordRecovery = recovery != null
        && resourceTotals.timber + 1e-6 >= recovery.cost.timber
        && resourceTotals.stone + 1e-6 >= recovery.cost.stone;
      const recoveryLabel = recovery?.kind === 'rebuild'
        ? target.kind === 'residence' ? 'Rebuild homestead' : 'Rebuild structure'
        : target.kind === 'residence' ? 'Repair homestead' : 'Begin repairs';
      view.detailsHtml = `
        <li><span>Fire cause</span><strong>${fireSourceLabel(fire.ignitionSource)}</strong></li>
        <li><span>Fire intensity</span><strong>${Math.round(fire.intensity * 100)}%</strong></li>
        <li><span>Structural damage</span><strong>${Math.round(fire.damage * 100)}%</strong></li>
        <li><span>Water delivered</span><strong>${fire.waterDelivered.toFixed(1)} / ${fire.requiredWater.toFixed(1)}</strong></li>
        <li><span>Response</span><strong>${response}</strong></li>
        ${fire.extinguishChance > 0
          ? `<li><span>Last attempt odds</span><strong>${Math.round(fire.extinguishChance * 100)}%</strong></li>`
          : ''}
        ${recovery && !residenceRecoveryActive ? `<li><span>${recovery.kind === 'rebuild' ? 'Rebuild' : 'Repair'} cost</span><strong>${formatBuildingCost(recovery.cost)}${recovery.carpenterSupported ? ' · carpenter-supported' : ''}</strong></li>` : ''}
        ${view.detailsHtml}
      `;
      if (!residenceRecoveryActive) {
        view.statusText = fire.status === 'burning'
          ? 'Burning — production and household activity are suspended until the fire is out.'
          : fire.status === 'destroyed'
            ? 'Destroyed by fire — rebuild the surviving foundations or clear the ruin.'
            : 'Fire out — repair the damage before activity can resume.';
        view.statusState = 'warning';
      }
      if (target.kind === 'building' && view.labor.visible) {
        view.labor = {
          ...view.labor,
          hint: target.building.assignedLabor > 0
            ? `${target.building.assignedLabor} assigned ${target.building.assignedLabor === 1 ? 'worker is' : 'workers are'} idle during the outage. Workers may be recalled now; repair before assigning more.`
            : 'Fire damage blocks new staffing until the structure is repaired.',
          increaseDisabled: true,
        };
      }
      if (!residenceRecoveryActive) {
        view.supplementalPanelHtml = fire.status === 'burning' || !recovery
        ? `<div class="inspector-action-panel">
            <p class="inspector-action-panel__hint">Keep a staffed, supplied well within work extent. Fire calls preempt routine water deliveries.</p>
          </div>`
        : `<div class="inspector-action-panel">
            <p class="inspector-action-panel__hint">${target.kind === 'building'
              ? 'Recovery reuses the existing site and enters the normal material-hauling and builder-work pipeline.'
              : 'Fire recovery reuses the surviving homestead footprint; the rebuilt cottage returns vacant and can be settled again.'}</p>
            <button type="button" class="resource-action-button" data-fire-recovery ${
              coolingSeconds > 1e-6 || !canAffordRecovery ? 'disabled' : ''
            }>${coolingSeconds > 1e-6
              ? `Cooling (${Math.ceil(coolingSeconds)}s)`
              : !canAffordRecovery
                ? `Need ${formatBuildingCost(recovery.cost)}`
                : `${recoveryLabel} · ${formatBuildingCost(recovery.cost)}`}</button>
            ${recovery.carpenterSupported ? '<p class="inspector-action-panel__hint">A staffed road-linked carpenter reduces the timber requirement by 10%.</p>' : ''}
          </div>`;
      }
    }

    this.eyebrow.textContent = view.eyebrow;
    this.title.textContent = view.title;
    this.status.textContent = view.statusText;
    this.status.dataset.state = view.statusState;
    this.applyPresentation(target);
    this.renderDetails(view.detailsHtml);

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
      this.organizeSupplementalPanel(openPolicyIndices, preservePolicyState);
    } else {
      this.supplementalPanelSection.hidden = true;
      this.supplementalPanelSection.innerHTML = '';
    }
    this.renderedIdentity = identity;
  }

  private applyPresentation(target: InspectableTarget): void {
    const presentation = inspectablePresentation(target);
    this.panel.dataset.inspectorKind = presentation.kind;
    this.heroSymbol.textContent = presentation.symbol;
    this.heroArt.style.backgroundImage = presentation.image
      ? `linear-gradient(90deg, rgba(15, 17, 13, 0.06), rgba(15, 17, 13, 0.64)), url("${presentation.image}")`
      : '';
    this.heroArt.classList.toggle('has-art', Boolean(presentation.image));
  }

  private renderDetails(detailsHtml: string): void {
    this.detailList.innerHTML = detailsHtml;
    const rows = [...this.detailList.children]
      .filter((element): element is HTMLElement => element instanceof HTMLElement);
    const ranked = rows.map((row, index) => {
      const label = row.firstElementChild?.textContent?.trim() ?? '';
      const value = row.lastElementChild?.textContent?.trim() ?? '';
      decorateInspectorRow(row, label, value);
      return {
        row,
        index,
        score: inspectorRowScore(row, label, value, index),
      };
    });
    const primaryTarget = Math.min(6, Math.max(3, Math.ceil(rows.length * 0.22)));
    const primaryRows = new Set(
      [...ranked]
        .sort((a, b) => b.score - a.score || a.index - b.index)
        .slice(0, primaryTarget)
        .map(({ row }) => row),
    );
    for (const { row } of ranked) {
      if (row.querySelector('button, input, select, progress')) primaryRows.add(row);
    }

    const primary = rows.filter((row) => primaryRows.has(row));
    const secondary = rows.filter((row) => !primaryRows.has(row));
    this.detailList.replaceChildren(...primary);
    this.secondaryDetailList.replaceChildren(...secondary);
    this.detailDisclosure.hidden = secondary.length === 0;
    this.detailDisclosureCount.textContent = secondary.length === 1
      ? '1 detail'
      : `${secondary.length} details`;
  }

  private organizeSupplementalPanel(
    openPolicyIndices: ReadonlySet<number>,
    preserveState: boolean,
  ): void {
    const panels = [...this.supplementalPanelSection.children]
      .filter((element): element is HTMLElement =>
        element instanceof HTMLElement
        && element.classList.contains('inspector-action-panel'));
    if (panels.length < 3) return;

    panels.forEach((panel, index) => {
      const titleSource = panel.querySelector(
        '.city-admin-panel__slider-label span, .city-admin-panel__toggle span, button, .inspector-policy-select',
      );
      const fallback = panel.querySelector('.inspector-action-panel__hint')
        ?.textContent
        ?.split(/[.!?]/)[0]
        ?.trim();
      const title = titleSource?.textContent?.trim() || fallback || `Policy ${index + 1}`;
      const disclosure = document.createElement('details');
      disclosure.className = 'inspector-policy-card';
      disclosure.open = preserveState ? openPolicyIndices.has(index) : index === 0;
      const summary = document.createElement('summary');
      summary.innerHTML = `<span aria-hidden="true">${inspectorPolicyIcon(title)}</span><strong></strong><span aria-hidden="true">+</span>`;
      const strong = summary.querySelector('strong');
      if (strong) strong.textContent = title.length > 54 ? `${title.slice(0, 51)}…` : title;
      panel.before(disclosure);
      disclosure.append(summary, panel);
    });
  }

  private updateMarker(): void {
    if (!this.selectedTarget || this.selectedTarget.kind === 'building') {
      this.marker.visible = false;
      return;
    }

    const y = this.options.sceneManager.terrain.getHeightAt(this.selectedX, this.selectedZ) + 2.1;
    this.marker.scale.set(0.85, 1.15, 0.85);
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

function formatTransitAmount(amount: number): string {
  if (Math.abs(amount - Math.round(amount)) <= 1e-6) {
    return Math.round(amount).toLocaleString();
  }
  if (amount < 0.1) return amount.toFixed(2);
  return amount.toFixed(1);
}

type InspectorPresentation = {
  kind: string;
  symbol: string;
  image?: string;
};

const BUILDING_INSPECTOR_ART: Partial<Record<string, string>> = {
  apiary: 'apiary.webp',
  brewery: 'brewery.webp',
  carpenter: 'carpenter.webp',
  chapel: 'chapel.webp',
  ferry_landing: 'ferry-landing.webp',
  fishing_camp: 'fishing-camp.webp',
  foragers_shed: 'foragers-hut.webp',
  founders_camp: 'residence.webp',
  granary: 'granary.webp',
  guardhouse: 'guardhouse.webp',
  hunters_hall: 'hunter-hall.webp',
  large_quarry: 'large-quarry.webp',
  lumber_mill: 'lumber-mill.webp',
  marketplace: 'market.webp',
  monastery: 'monastery.webp',
  pastoral_farmstead: 'pastoral-farmstead.webp',
  reforester: 'reforester.webp',
  salvage_pile: 'village-storehouse.webp',
  smokehouse: 'smokehouse.webp',
  stone_quarry: 'stonecutters-camp.webp',
  swineherd: 'swineherd.webp',
  threshing_barn: 'threshing-barn.webp',
  town_hall: 'town-hall.webp',
  village_storehouse: 'village-storehouse.webp',
  vineyard: 'vineyard.webp',
  watchtower: 'watchtower.webp',
  watermill: 'watermill.webp',
  weaver: 'weaver.webp',
  well: 'water-well.webp',
  woodcutters_lodge: 'woodcutters-lodge.webp',
};

function inspectableIdentity(target: InspectableTarget | null): string {
  if (!target) return '';
  switch (target.kind) {
    case 'building': return `building:${target.building.id}`;
    case 'residence': return `residence:${target.residence.id}`;
    case 'backyard': return `backyard:${target.residence.id}`;
    case 'farm-field': return `field:${target.field.id}`;
    case 'pasture': return `pasture:${target.pasture.id}`;
    case 'quarry': return `quarry:${target.definition.id}`;
    case 'foraging': return `foraging:${target.definition.id}`;
    case 'river': return `river:${target.x.toFixed(1)}:${target.z.toFixed(1)}`;
  }
}

function inspectablePresentation(target: InspectableTarget): InspectorPresentation {
  if (target.kind === 'building') {
    const file = BUILDING_INSPECTOR_ART[target.building.kind];
    const civic = target.building.kind === 'town_hall'
      || target.building.kind === 'chapel'
      || target.building.kind === 'monastery';
    const agricultural = target.building.kind === 'threshing_barn'
      || target.building.kind === 'pastoral_farmstead'
      || target.building.kind === 'swineherd'
      || target.building.kind === 'apiary'
      || target.building.kind === 'vineyard';
    const storage = target.building.kind === 'granary'
      || target.building.kind === 'village_storehouse'
      || target.building.kind === 'salvage_pile';
    return {
      kind: civic ? 'civic' : agricultural ? 'agriculture' : storage ? 'storage' : 'building',
      symbol: civic ? '\u269C' : agricultural ? '\u2748' : storage ? '\u25A3' : '\u2692',
      ...(file ? { image: `/assets/ui/build-menu/cards/${file}` } : {}),
    };
  }
  if (target.kind === 'residence' || target.kind === 'backyard') {
    return {
      kind: 'residence',
      symbol: '\u2302',
      image: '/assets/ui/build-menu/cards/residence.webp',
    };
  }
  if (target.kind === 'farm-field') {
    return {
      kind: 'agriculture',
      symbol: '\u2748',
      image: '/assets/ui/build-menu/cards/grain-field.webp',
    };
  }
  if (target.kind === 'pasture') {
    return {
      kind: 'agriculture',
      symbol: '\u2748',
      image: '/assets/ui/build-menu/cards/pasture.webp',
    };
  }
  if (target.kind === 'quarry') {
    return {
      kind: 'resource',
      symbol: '\u25C6',
      image: '/assets/ui/build-menu/cards/stonecutters-camp.webp',
    };
  }
  if (target.kind === 'foraging') {
    return {
      kind: 'resource',
      symbol: '\u2767',
      image: '/assets/ui/build-menu/cards/foragers-hut.webp',
    };
  }
  return {
    kind: 'water',
    symbol: '\u224B',
    image: '/assets/ui/build-menu/cards/ferry-landing.webp',
  };
}

function decorateInspectorRow(row: HTMLElement, label: string, value: string): void {
  const normalized = `${label} ${value}`.toLowerCase();
  const labelElement = row.firstElementChild;
  const valueElement = row.lastElementChild;
  labelElement?.classList.add('inspector-detail-label');
  valueElement?.classList.add('inspector-detail-value');
  const icon = document.createElement('span');
  icon.className = 'inspector-row-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = inspectorDetailIcon(normalized);
  row.prepend(icon);
  if (/(\bfire\b|burn|destroy|danger|critical|blocked|short|starv|damage|exposed|unserved)/.test(normalized)) {
    row.dataset.state = 'warning';
  } else if (/(ready|complete|healthy|connected|active|staffed|supplied|secure)/.test(normalized)) {
    row.dataset.state = 'positive';
  } else {
    delete row.dataset.state;
  }

  const ratio = value.match(/(-?\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/);
  const percent = value.match(/(-?\d+(?:\.\d+)?)\s*%/);
  const denominator = ratio ? Number(ratio[2]) : 0;
  const meter = ratio && denominator > 0
    ? (Number(ratio[1]) / denominator) * 100
    : percent
      ? Number(percent[1])
      : null;
  if (meter !== null && Number.isFinite(meter)) {
    row.classList.add('has-meter');
    row.style.setProperty('--inspector-meter', `${Math.max(0, Math.min(100, meter))}%`);
  } else {
    row.classList.remove('has-meter');
    row.style.removeProperty('--inspector-meter');
  }
}

function inspectorRowScore(
  row: HTMLElement,
  label: string,
  value: string,
  index: number,
): number {
  const normalizedLabel = label.toLowerCase();
  const normalizedValue = value.toLowerCase();
  const normalized = `${normalizedLabel} ${normalizedValue}`;
  let score = index === 0 ? 18 : index === 1 ? 8 : 0;
  if (row.querySelector('button, input, select, progress')) score += 100;
  if (/(\bfire\b|burn|destroy|danger|critical|blocked|short|starv|damage|exposed|unserved)/.test(normalized)) score += 30;
  if (/(status|progress|assigned|workforce|population|household|resident|active cart|crop|yield|output|input|condition|priority|coverage|readiness|runway)/.test(normalizedLabel)) score += 16;
  if (/(role|current|available|vacant|capacity|service|production|health|security|threat)/.test(normalizedLabel)) score += 10;
  const ratio = normalizedValue.match(/(-?\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/);
  if (ratio) score += Number(ratio[1]) > 0 ? 10 : -8;
  if (/\d+(?:\.\d+)?\s*%/.test(normalizedValue)) score += 6;
  if (/(stored|storage|stock)/.test(normalizedLabel)) score += 3;
  if (/(lifecycle|clearance|permanent storage|construction supply|placement|access rule|final clearance)/.test(normalizedLabel)) score -= 9;
  if (value.length > 72) score -= 12;
  if (index > 12) score -= 2;
  return score;
}

function inspectorDetailIcon(normalized: string): string {
  if (/(timber|firewood|wood|log)/.test(normalized)) return '\u2571';
  if (/(\bfire\b|burn|damage)/.test(normalized)) return '!';
  if (/(labor|worker|staff|builder|crew)/.test(normalized)) return '\u2692';
  if (/(stone|quarry|rock)/.test(normalized)) return '\u25C6';
  if (/(water|river|well|ferry)/.test(normalized)) return '\u224B';
  if (/(food|grain|flour|ale|honey|wine|crop|yield|field|fertility)/.test(normalized)) return '\u2767';
  if (/(house|resident|population|shelter|home|vacant)/.test(normalized)) return '\u2302';
  if (/(road|cart|route|delivery|haul)/.test(normalized)) return '\u21C4';
  if (/(gold|coin|tax|receipt|wealth|wage)/.test(normalized)) return '\u25C9';
  if (/(guard|watch|security|threat|arm|polearm)/.test(normalized)) return '\u2726';
  if (/(stored|storage|stock|capacity|warehouse)/.test(normalized)) return '\u25A3';
  return '\u25C7';
}

function inspectorPolicyIcon(title: string): string {
  const normalized = title.toLowerCase();
  if (/(tax|gold|receipt|wage|trade)/.test(normalized)) return '\u25C9';
  if (/(labor|worker|construction|production|staff)/.test(normalized)) return '\u2692';
  if (/(food|grain|harvest|fresh|reserve)/.test(normalized)) return '\u2767';
  if (/(guard|watch|security|arm)/.test(normalized)) return '\u2726';
  if (/(water|river)/.test(normalized)) return '\u224B';
  return '\u2699';
}

function createSelectionMarker(): THREE.Mesh {
  const geometry = new THREE.OctahedronGeometry(0.32, 0);
  const material = new THREE.MeshBasicMaterial({
    color: 0xd7b463,
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'Resource inspection beacon';
  mesh.renderOrder = 12;
  return mesh;
}
