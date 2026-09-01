import * as THREE from 'three';
import type { TerrainProjector } from '../terrain/TerrainProjector.ts';
import type { SceneManager } from '../scene/SceneManager.ts';
import { disposeObject3D } from '../utils/dispose.ts';
import {
  FOOD_RESOURCE_KINDS,
  HUD_RESOURCE_KINDS,
  computeResourceTotals,
  computeMarketplaceTradeAvailability,
  maxAssignableLabor,
  type HudResourceKind,
  type FoodResourceKind,
  type PopulationStats,
  type ResourceTotals,
} from './resourceTotals.ts';

const FOOD_BREAKDOWN_ROW_KINDS = [
  ...FOOD_RESOURCE_KINDS,
  'legacyPreservedFood',
] as const;
type FoodBreakdownRowKind = FoodResourceKind | 'legacyPreservedFood';
type FoodBreakdownRowElements = {
  row: HTMLElement;
  stored: HTMLElement;
  transit: HTMLElement;
  homes: HTMLElement;
  surplus: HTMLElement;
};
import {
  readResourceTotalsPresentation,
  saveResourceTotalsPresentation,
  type ResourceTotalsPresentation,
} from './resourceTotalsPresentation.ts';
import { FARM_CROPS, type FarmCrop, type GameState, type InspectableTarget, type LivestockSpecies } from './types.ts';
import type { WorldQueries } from './WorldQueries.ts';
import { renderInspectableTarget } from './inspector/renderInspectableTarget.ts';
import {
  inspectorDetailIcon,
  inspectorDetailState,
} from './inspector/detailRowPresentation.ts';
import { handleSupplementalPanelClick } from './inspector/supplementalPanel.ts';
import type { ParishPolicyState } from '../economy/chapelParish.ts';
import type { MonasteryPolicyState } from '../economy/monasteryPolicy.ts';
import type { FiscalPolicyState } from '../economy/fiscalPolicy.ts';
import type { PantrySafeguardPolicyCode } from '../economy/pantrySafeguardPolicy.ts';
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
import type { CombatAgentState } from '../security/combatAgents.ts';
import {
  militaryCompanyDisplayName,
  type MilitaryCompanyState,
} from '../security/militaryProgression.ts';
import { renderBuildingResourceCost } from '../ui/resourceCost.ts';
import { BACKYARD_EXTENSION_CARD_ART } from '../ui/buildMenuCards.ts';
import {
  HUD_RESOURCE_CARD_KINDS,
  HUD_RESOURCE_CARD_PRESENTATION,
  isHudResourceCardKind,
  type HudResourceCardKind,
} from '../ui/hudResourceCards.ts';
import {
  isStorehouseCommodity,
  type StorehouseCommodity,
} from '../economy/storehousePolicy.ts';
import {
  isStorageCommodity,
  type StorageCommodity,
} from '../economy/storageAcceptancePolicy.ts';
import { isProcessorOutputTargetKind } from '../economy/processorOutputPolicy.ts';
import {
  isProductionRateBuilding,
  maintenanceRateMultiplier,
  productionRateMultiplier,
} from '../economy/productionRatePolicy.ts';
import { computeSettlementProductionCapacity } from '../economy/settlementProduction.ts';
import { windWeatherThroughputMultiplier } from '../wind/windField.ts';
import { settlementHasStaffedChapel } from '../logistics/landmarkAccess.ts';
import { gameClock } from '../world/gameCalendar.ts';
import { environmentFor } from '../world/seasonPolicy.ts';
import {
  serviceCoverageLabel,
  type MarketplaceServiceFulfillment,
  type ServiceCoverageView,
} from './serviceCoverage.ts';
import { PlayerAuthoredHoverOutline } from './PlayerAuthoredHoverOutline.ts';
import {
  foodSpoilageLabel,
  type FoodInventoryKind,
} from '../economy/foodInventory.ts';
import { AlertDialog } from '../ui/AlertDialog.ts';
import { hasCustomTreeWorkArea } from './treeWorkArea.ts';
import { resourceNodeArtUrl } from './resourceNodeArt.ts';
import { BUILDING_CARD_ART } from './buildingCardArt.ts';
import { computeLandUseProfile } from '../regions/landUseProfile.ts';
import { renderSelectedMilitaryCompanyInspector } from './inspector/militaryCompanyRenderer.ts';

const INSPECTOR_TOOLTIP_MAX_LENGTH = 120;

type ResourceInspectorOptions = {
  domElement: HTMLElement;
  uiRoot: HTMLElement;
  sceneManager: SceneManager;
  terrainProjector: TerrainProjector;
  worldQueries: WorldQueries;
  getState: () => GameState;
  getEconomicActivityTaxRate?: (settlementId?: string) => number;
  getPantrySafeguardPolicy?: (settlementId?: string) => PantrySafeguardPolicyCode;
  getFiscalPolicy?: (settlementId?: string) => FiscalPolicyState;
  getSeasonalLaborStewardEnabled?: (settlementId?: string) => boolean;
  getConstructionLaborStewardEnabled?: (settlementId?: string) => boolean;
  getProductionLaborStewardEnabled?: (settlementId?: string) => boolean;
  getLaborStewardReserve?: (settlementId?: string) => number;
  getParishPolicy?: () => ParishPolicyState;
  getMonasteryPolicy?: () => MonasteryPolicyState;
  getMarketState?: () => RegionalMarketState;
  getSettlementSecurity?: () => SettlementSecurityState;
  getCombatAgents?: () => Iterable<CombatAgentState>;
  getMilitaryCompanies?: () => Iterable<MilitaryCompanyState>;
  getConflictEnabled?: () => boolean;
  getEnemyPressure?: () => number;
  getWorldHydrology?: () => number;
  getSevereWeatherEnabled?: () => boolean;
  getWellAquiferNetworksEnabled?: () => boolean;
  getWorldResourceAbundance?: () => number;
  getPendingTreeWorkAreaBuildingId?: () => string | null;
  onDemolishBuilding?: (buildingId: string) => void | Promise<void>;
  onDemolishResidence?: (residenceId: string) => void | Promise<void>;
  onUpgradeResidence?: (residenceId: string) => void | Promise<void>;
  onConvertResidenceToSmallholding?: (residenceId: string) => void | Promise<void>;
  onRetrofitResidenceTileRoof?: (residenceId: string) => void | Promise<void>;
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
  onSpecializeOrchard?: (residenceId: string, kind: BackyardGardenKind) => void | Promise<void>;
  onSpecializeAnimalPen?: (residenceId: string, kind: BackyardGardenKind) => void | Promise<void>;
  onSpecializeVegetableGarden?: (residenceId: string, kind: BackyardGardenKind) => void | Promise<void>;
  onUpgradeFlowerGardenLuxury?: (residenceId: string) => void | Promise<void>;
  onDemolishBackyardGarden?: (residenceId: string) => void | Promise<void>;
  onAssignBuildingLabor?: (buildingId: string, labor: number) => void | Promise<void>;
  onRotateConstructionLabor?: (townHallId: string) => void | Promise<void>;
  onRecallIdleSeasonalLabor?: (townHallId: string) => void | Promise<void>;
  onCallUpActiveSeasonalLabor?: (townHallId: string) => void | Promise<void>;
  onRecallTargetIdleProcessorLabor?: (townHallId: string) => void | Promise<void>;
  onCallUpTargetReadyProcessorLabor?: (townHallId: string) => void | Promise<void>;
  onBalanceYearRoundLabor?: (townHallId: string) => void | Promise<void>;
  onRaiseMilitia?: (townHallId: string, requested: number) => void | Promise<void>;
  onDisbandMilitia?: () => void | Promise<void>;
  onRecruitMilitaryCompany?: (sourceBuildingId: string, kind: number) => void | Promise<void>;
  onHireMercenaryCompany?: (townHallId: string) => void | Promise<void>;
  onDisbandMilitaryCompany?: (companyId: string) => void | Promise<void>;
  onRenewMercenaryContract?: (companyId: string) => void | Promise<void>;
  onResupplyMilitaryCompany?: (companyId: string) => void | Promise<void>;
  onSetMilitaryFormation?: (companyId: string, formation: number) => void | Promise<void>;
  onSetConstructionPriority?: (buildingId: string, priority: number) => void | Promise<void>;
  onSetTradingPostTradeRule?: (
    buildingId: string,
    commodityKind: number,
    mode: number,
    targetSurplus: number,
  ) => void | Promise<void>;
  onUpgradeChapel?: (buildingId: string) => void | Promise<void>;
  onSetEconomicActivityTaxRate?: (townHallId: string, taxRate: number) => void | Promise<void>;
  onSetPantrySafeguardPolicy?: (
    townHallId: string,
    policy: PantrySafeguardPolicyCode,
  ) => void | Promise<void>;
  onSetFiscalPolicy?: (
    townHallId: string,
    landLevyRate: number,
    importDutyRate: number,
    exportDutyRate: number,
  ) => void | Promise<void>;
  onSetSeasonalLaborSteward?: (townHallId: string, enabled: boolean) => void | Promise<void>;
  onSetConstructionLaborSteward?: (townHallId: string, enabled: boolean) => void | Promise<void>;
  onSetProductionLaborSteward?: (townHallId: string, enabled: boolean) => void | Promise<void>;
  onSetLaborStewardReserve?: (townHallId: string, laborReserve: number) => void | Promise<void>;
  onSetChapelParishPolicy?: (sabbathObservanceEnabled: boolean) => void | Promise<void>;
  onSetMonasteryPolicy?: (titheShare: number, feastsEnabled: boolean) => void | Promise<void>;
  onSetMonasteryCharter?: (levyRate: number) => void | Promise<void>;
  onSetMonasteryNextExtension?: (buildingId: string, extension: number) => void | Promise<void>;
  onSetStorehousePolicy?: (
    buildingId: string,
    acceptsTimber: boolean,
    acceptsStone: boolean,
    acceptsFirewood: boolean,
    acceptsCharcoal: boolean,
    acceptsIron: boolean,
    acceptsClay: boolean,
    acceptsSalt: boolean,
  ) => void | Promise<void>;
  onSetStorehouseStockTarget?: (
    buildingId: string,
    commodity: StorehouseCommodity,
    targetPercent: number,
  ) => void | Promise<void>;
  onSetLivestockMilkUsePolicy?: (
    buildingId: string,
    milkUsePolicy: number,
  ) => void | Promise<void>;
  onSetStorageCommodityAcceptance?: (
    buildingId: string,
    commodity: StorageCommodity,
    accepts: boolean,
  ) => void | Promise<void>;
  onSetAllStorageAcceptance?: (
    buildingId: string,
    accepts: boolean,
  ) => void | Promise<void>;
  onSetBreweryRecipePolicy?: (
    buildingId: string,
    recipePolicy: number,
  ) => void | Promise<void>;
  onSetBuildingProductionRate?: (
    buildingId: string,
    ratePercent: number,
  ) => void | Promise<void>;
  onSetSmokehouseRecipePolicy?: (
    buildingId: string,
    recipePolicy: number,
  ) => void | Promise<void>;
  onSetWeaverInputPolicy?: (
    buildingId: string,
    inputPolicy: number,
  ) => void | Promise<void>;
  onSetPotterFiringPolicy?: (
    buildingId: string,
    firingPolicy: number,
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
  onSetCarpenterCartServiceTarget?: (
    buildingId: string,
    targetTrips: number,
  ) => void | Promise<void>;
  onSetGuardhousePayPriority?: (
    buildingId: string,
    payPriority: number,
  ) => void | Promise<void>;
  onSetGuardhouseFoodReserve?: (
    buildingId: string,
    reservePerGuard: number,
  ) => void | Promise<void>;
  onSetGuardhouseMusterPost?: (
    buildingId: string,
    watchtowerId: string | null,
  ) => void | Promise<void>;
  onSetMarketplaceIronworkTarget?: (
    buildingId: string,
    ironworkTarget: number,
  ) => void | Promise<void>;
  onSetMarketplaceIronTarget?: (
    buildingId: string,
    ironTarget: number,
  ) => void | Promise<void>;
  onSetMarketplaceSaltTarget?: (
    buildingId: string,
    saltTarget: number,
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
  onSetMarketplaceSpecialtyFamilyExportPolicy?: (
    buildingId: string,
    family: number,
    exportPolicy: number,
  ) => void | Promise<void>;
  onSetApiaryHarvestPolicy?: (
    buildingId: string,
    harvestPolicy: number,
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
  onSetThreshingPriority?: (buildingId: string, priority: number) => void | Promise<void>;
  onStartFarmFieldEarlyHarvest?: (fieldId: string) => void | Promise<void>;
  onDemolishPasture?: (pastureId: string) => void | Promise<void>;
  onDemolishGraveyard?: (graveyardId: string) => void | Promise<void>;
  onSetLivestockSpecies?: (pastureId: string, species: Exclude<LivestockSpecies, 'swine'>) => void | Promise<void>;
  onTradeLivestock?: (pastureId: string, headDelta: number) => void | Promise<void>;
  onPurchaseStableOx?: (stableId: string) => void | Promise<void>;
  onPurchaseKennelDog?: (kennelId: string) => void | Promise<void>;
  onSetBuildingOxen?: (buildingId: string, targetCount: number) => void | Promise<void>;
  onSetBuildingDogs?: (buildingId: string, targetCount: number) => void | Promise<void>;
  onSetLivestockBreedingReserve?: (pastureId: string, breedingReserve: number) => void | Promise<void>;
  onSetLivestockHaymakingPercent?: (pastureId: string, haymakingPercent: number) => void | Promise<void>;
  onBeginFarmFieldPlacement?: (
    farmsteadId: string,
    crops: [FarmCrop, FarmCrop, FarmCrop],
    autoManage: boolean,
  ) => void;
  onBeginPasturePlacement?: (farmsteadId: string) => void;
  onBeginGraveyardPlacement?: (chapelId: string) => void;
  onBeginVineyardPlacement?: (monasteryId: string) => void;
  onBeginTreeWorkAreaPlacement?: (buildingId: string) => void;
  onClearTreeWorkArea?: (buildingId: string) => void | Promise<void>;
  onInspectDeliveryTrip?: (tripId: string) => void;
  onFocusWorldPosition?: (x: number, z: number) => void;
  onServiceCoverageChange?: (
    residenceIds: ReadonlySet<string>,
    kind: ServiceCoverageView['kind'] | null,
    marketplaceFulfillment: ServiceCoverageView['marketplaceFulfillment'],
    serviceBuildingId: string | null,
  ) => void;
  onTargetSelected?: (target: InspectableTarget) => void;
  onSelectionChange?: (target: InspectableTarget | null) => void;
  isBlocked: () => boolean;
};

const DEFAULT_TOTAL_RESOURCE_TOOLTIP =
  'All physically stored stock for this resource, including household reserves and goods committed to active projects. Loaded carts remain listed separately until unloading.';

const NON_SPECIALTY_HUD_RESOURCE_KINDS = new Set<HudResourceKind>([
  'timber',
  'stone',
  'firewood',
  'water',
  'food',
  'gold',
  'charcoal',
]);

const MILITARY_HUD_RESOURCE_KINDS = new Set<HudResourceKind>([
  'polearms',
  'sidearms',
  'shields',
  'bows',
  'crossbows',
  'paddedArmor',
  'mailArmor',
  'ammunition',
]);

const SPECIALTY_HUD_RESOURCE_KINDS = HUD_RESOURCE_KINDS.filter(
  (resource) => !NON_SPECIALTY_HUD_RESOURCE_KINDS.has(resource)
    && !MILITARY_HUD_RESOURCE_KINDS.has(resource),
);

export class ResourceInspector {
  private readonly options: ResourceInspectorOptions;
  private readonly panel: HTMLElement;
  private readonly eyebrow: HTMLElement;
  private readonly title: HTMLElement;
  private readonly status: HTMLElement;
  private readonly heroArt: HTMLElement;
  private readonly heroImage: HTMLImageElement;
  private readonly heroSymbol: HTMLElement;
  private readonly serviceCoverageButton: HTMLButtonElement;
  private readonly closeButton: HTMLButtonElement;
  private readonly detailList: HTMLElement;
  private readonly stockpileRoot: HTMLElement;
  private readonly stockpileValues: Record<HudResourceKind, HTMLElement>;
  private readonly stockpileTransitValues: Record<HudResourceKind, HTMLElement>;
  private readonly foodBreakdownRows: Record<
    FoodBreakdownRowKind,
    FoodBreakdownRowElements
  >;
  private readonly foodBreakdownEmpty: HTMLElement;
  private readonly foodBreakdownTotalStored: HTMLElement;
  private readonly foodBreakdownTotalTransit: HTMLElement;
  private readonly foodBreakdownTotalHomes: HTMLElement;
  private readonly foodBreakdownTotalSurplus: HTMLElement;
  private readonly resourceTotalsModeButton: HTMLButtonElement;
  private readonly resourceTotalsModeLabel: HTMLElement;
  private readonly foodStoresModeLabel: HTMLElement;
  private readonly fuelStoresModeLabel: HTMLElement;
  private readonly fuelFirewoodAmount: HTMLElement;
  private readonly specialtyStoresModeLabel: HTMLElement;
  private readonly militaryStoresModeLabel: HTMLElement;
  private readonly militaryKitReadiness: HTMLElement;
  private readonly resourceCardAmounts: Record<HudResourceCardKind, HTMLElement>;
  private readonly resourceCardModeLabels: Record<HudResourceCardKind, HTMLElement>;
  private readonly resourceCardDetails: Record<HudResourceCardKind, HTMLElement>;
  private readonly surplusResourceTooltips = new Map<HudResourceKind, string>();
  private readonly populationValue: HTMLElement;
  private readonly housingValue: HTMLElement;
  private readonly laborValue: HTMLElement;
  private readonly demolishSection: HTMLElement;
  private readonly demolishButton: HTMLButtonElement;
  private readonly demolishSecondaryButton: HTMLButtonElement;
  private readonly demolishHint: HTMLElement;
  private readonly demolishSecondaryHint: HTMLElement;
  private readonly primaryActionSection: HTMLElement;
  private readonly laborSection: HTMLElement;
  private readonly laborLabel: HTMLElement;
  private readonly laborCount: HTMLElement;
  private readonly laborHint: HTMLElement;
  private readonly laborDecrease: HTMLButtonElement;
  private readonly laborIncrease: HTMLButtonElement;
  private readonly oxTeamSection: HTMLElement;
  private readonly oxTeamCount: HTMLElement;
  private readonly oxTeamPool: HTMLElement;
  private readonly oxTeamHint: HTMLElement;
  private readonly oxTeamDecrease: HTMLButtonElement;
  private readonly oxTeamIncrease: HTMLButtonElement;
  private readonly supplementalPanelSection: HTMLElement;
  private readonly deleteDialog: AlertDialog;
  private readonly marker: THREE.Mesh;
  private readonly hoverOutline: PlayerAuthoredHoverOutline;
  private selectedTarget: InspectableTarget | null = null;
  private selectedMilitaryCompanyId: string | null = null;
  private heroImageSource: string | null = null;
  private heroImageRequestId = 0;
  private serviceCoverageBuildingId: string | null = null;
  private serviceCoverageResidenceIds = new Set<string>();
  private serviceCoverageMarketplaceFulfillment = new Map<
    string,
    MarketplaceServiceFulfillment
  >();
  private serviceCoverageProjection: ServiceCoverageView | null = null;
  private serviceCoverageTabPreviewBuildingId: string | null = null;
  private renderedIdentity = '';
  private renderedSupplementalPanelHtml = '';
  private selectedX = 0;
  private selectedZ = 0;
  private resourceTotalsPresentation: ResourceTotalsPresentation =
    readResourceTotalsPresentation();
  private surplusTotals: ResourceTotals | null = null;
  private storedTotals: ResourceTotals | null = null;
  private inTransitTotals: ResourceTotals | undefined;
  private goldAwaitingCollection = 0;
  private guardhousePayrollGold = 0;
  private populationStats: PopulationStats = {
    total: 0,
    assigned: 0,
    flexibleAssigned: 0,
    cartAssigned: 0,
    dedicatedSmallholding: 0,
    available: 0,
    idle: 0,
    housingCapacity: 0,
    housed: 0,
    vacant: 0,
  };

  constructor(options: ResourceInspectorOptions) {
    this.options = options;
    this.hoverOutline = new PlayerAuthoredHoverOutline({
      domElement: options.domElement,
      camera: options.sceneManager.camera,
      terrainProjector: options.terrainProjector,
      parent: options.sceneManager.selectionGroup,
      getState: options.getState,
      getRoadNetwork: () => options.worldQueries.getRoadNetworkSnapshot(),
      getHeightAt: (x, z) => options.worldQueries.getHeightAt(x, z),
      isBlocked: options.isBlocked,
    });

    options.uiRoot.insertAdjacentHTML(
      'beforeend',
      `
      <aside class="resource-inspector-panel" data-resource-inspector hidden aria-label="Resource inspector">
        <header class="road-controls-header resource-inspector-header">
          <div class="resource-inspector-hero-art" data-inspector-hero aria-hidden="true">
            <img class="resource-inspector-hero-image" data-inspector-hero-image alt="" decoding="async" draggable="false" hidden />
            <span class="resource-inspector-hero-symbol" data-inspector-symbol>◆</span>
          </div>
          <div class="resource-inspector-heading">
            <p class="road-controls-eyebrow" data-inspector-eyebrow>Resources</p>
            <h2 class="road-controls-title" data-inspector-title>Select a site</h2>
            <p class="road-controls-status resource-inspector-status" data-inspector-status>Click terrain to inspect quarries, buildings, residences, or river access.</p>
          </div>
          <div class="resource-inspector-header-actions">
            <button class="resource-action-button resource-action-button--icon resource-action-button--toggle resource-inspector-coverage" type="button" data-service-coverage-toggle aria-label="Show served homes" aria-pressed="false" data-tooltip="Show served homes" hidden>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="12" r="2.2"></circle>
                <path d="M7.9 16.1a5.8 5.8 0 0 1 0-8.2M16.1 7.9a5.8 5.8 0 0 1 0 8.2M4.7 19.3a10.3 10.3 0 0 1 0-14.6M19.3 4.7a10.3 10.3 0 0 1 0 14.6"></path>
              </svg>
            </button>
            <button class="resource-inspector-close" type="button" data-inspector-close aria-label="Close inspector">×</button>
          </div>
        </header>
        <div class="resource-inspector-scroll">
          <section class="resource-inspector-details" aria-label="At a glance">
            <ul class="road-controls-list" data-inspector-details></ul>
          </section>
          <section class="resource-inspector-labor" data-inspector-labor hidden aria-label="Labor assignment">
            <div class="resource-inspector-labor-row">
              <span class="resource-inspector-labor-label"><span aria-hidden="true">⚒</span> <span data-inspector-labor-label>Workforce</span></span>
              <div class="resource-inspector-labor-controls">
                <button type="button" class="resource-action-button resource-action-button--icon resource-inspector-labor-button" data-action="labor-decrease" aria-label="Decrease labor">−</button>
                <strong data-inspector-labor-count aria-live="polite">0 / 0</strong>
                <button type="button" class="resource-action-button resource-action-button--icon resource-inspector-labor-button" data-action="labor-increase" aria-label="Increase labor">+</button>
              </div>
            </div>
            <p class="resource-inspector-labor-hint" data-inspector-labor-hint></p>
          </section>
          <section class="resource-inspector-labor resource-inspector-ox-team" data-inspector-ox-team hidden aria-label="Ox posting">
            <div class="resource-inspector-labor-row">
              <span class="resource-inspector-labor-label">
                <span class="resource-inspector-ox-mark" aria-hidden="true"></span>
                <span class="resource-inspector-assignment-copy">
                  <span>Posted oxen</span>
                  <small data-inspector-ox-pool>Automatic pool · 0</small>
                </span>
              </span>
              <div class="resource-inspector-labor-controls">
                <button type="button" class="resource-action-button resource-action-button--icon resource-inspector-labor-button" data-action="ox-decrease" data-ox-posting-delta="-1" aria-label="Decrease posted oxen">−</button>
                <strong data-inspector-ox-count aria-live="polite">0 / 0</strong>
                <button type="button" class="resource-action-button resource-action-button--icon resource-inspector-labor-button" data-action="ox-increase" data-ox-posting-delta="1" aria-label="Increase posted oxen">+</button>
              </div>
            </div>
            <p class="resource-inspector-labor-hint resource-inspector-ox-hint" data-inspector-ox-hint></p>
          </section>
          <section class="resource-inspector-supplemental" data-inspector-supplemental hidden aria-label="Inspector actions"></section>
        </div>
        <footer class="resource-inspector-footer">
          <section class="resource-inspector-actions" data-inspector-actions hidden aria-label="Building actions">
            <div class="resource-inspector-primary-action" data-inspector-primary-action hidden></div>
            <button type="button" class="resource-action-button resource-action-button--danger resource-inspector-demolish" data-action="demolish-primary">
              Demolish
            </button>
            <p class="resource-inspector-demolish-hint" data-demolish-hint></p>
            <button type="button" class="resource-action-button resource-action-button--danger resource-inspector-demolish resource-inspector-demolish--secondary" data-action="demolish-secondary" hidden>
              Demolish plot
            </button>
            <p class="resource-inspector-demolish-hint" data-demolish-secondary-hint hidden></p>
          </section>
        </footer>
      </aside>
    `,
    );

    this.panel = this.mustElement(options.uiRoot, '[data-resource-inspector]');
    this.deleteDialog = new AlertDialog(options.uiRoot);
    this.eyebrow = this.mustElement(options.uiRoot, '[data-inspector-eyebrow]');
    this.title = this.mustElement(options.uiRoot, '[data-inspector-title]');
    this.status = this.mustElement(options.uiRoot, '[data-inspector-status]');
    this.heroArt = this.mustElement(options.uiRoot, '[data-inspector-hero]');
    this.heroImage = this.mustElement(
      options.uiRoot,
      '[data-inspector-hero-image]',
    ) as HTMLImageElement;
    this.heroSymbol = this.mustElement(options.uiRoot, '[data-inspector-symbol]');
    this.serviceCoverageButton = this.mustButton(
      options.uiRoot,
      '[data-service-coverage-toggle]',
    );
    this.closeButton = this.mustButton(options.uiRoot, '[data-inspector-close]');
    this.detailList = this.mustElement(options.uiRoot, '[data-inspector-details]');
    this.stockpileRoot = this.mustElement(options.uiRoot, '[data-settlement-hud]');
    this.resourceTotalsModeButton = this.mustButton(
      options.uiRoot,
      '[data-resource-totals-mode]',
    );
    this.resourceTotalsModeLabel = this.mustElement(
      options.uiRoot,
      '[data-resource-totals-mode-label]',
    );
    this.foodStoresModeLabel = this.mustElement(
      options.uiRoot,
      '[data-food-stores-mode-label]',
    );
    this.fuelStoresModeLabel = this.mustElement(
      options.uiRoot,
      '[data-fuel-stores-mode-label]',
    );
    this.fuelFirewoodAmount = this.mustElement(
      options.uiRoot,
      '[data-fuel-firewood-amount]',
    );
    this.specialtyStoresModeLabel = this.mustElement(
      options.uiRoot,
      '[data-specialty-stores-mode-label]',
    );
    this.militaryStoresModeLabel = this.mustElement(
      options.uiRoot,
      '[data-military-stores-mode-label]',
    );
    this.militaryKitReadiness = this.mustElement(
      options.uiRoot,
      '[data-military-kit-readiness]',
    );
    this.resourceCardAmounts = Object.fromEntries(
      HUD_RESOURCE_CARD_KINDS.map((resource) => [
        resource,
        this.mustElement(options.uiRoot, `[data-resource-card-amount="${resource}"]`),
      ]),
    ) as Record<HudResourceCardKind, HTMLElement>;
    this.resourceCardModeLabels = Object.fromEntries(
      HUD_RESOURCE_CARD_KINDS.map((resource) => [
        resource,
        this.mustElement(options.uiRoot, `[data-resource-card-mode-label="${resource}"]`),
      ]),
    ) as Record<HudResourceCardKind, HTMLElement>;
    this.resourceCardDetails = Object.fromEntries(
      HUD_RESOURCE_CARD_KINDS.map((resource) => [
        resource,
        this.mustElement(options.uiRoot, `[data-resource-card-detail="${resource}"]`),
      ]),
    ) as Record<HudResourceCardKind, HTMLElement>;
    this.stockpileValues = {
      timber: this.mustElement(options.uiRoot, '[data-stockpile="timber"]'),
      stone: this.mustElement(options.uiRoot, '[data-stockpile="stone"]'),
      firewood: this.mustElement(options.uiRoot, '[data-stockpile="firewood"]'),
      water: this.mustElement(options.uiRoot, '[data-stockpile="water"]'),
      food: this.mustElement(options.uiRoot, '[data-stockpile="food"]'),
      gold: this.mustElement(options.uiRoot, '[data-stockpile="gold"]'),
      ryeGrain: this.mustElement(options.uiRoot, '[data-stockpile="ryeGrain"]'),
      oatGrain: this.mustElement(options.uiRoot, '[data-stockpile="oatGrain"]'),
      animalFeed: this.mustElement(options.uiRoot, '[data-stockpile="animalFeed"]'),
      maslinGrain: this.mustElement(options.uiRoot, '[data-stockpile="maslinGrain"]'),
      barley: this.mustElement(options.uiRoot, '[data-stockpile="barley"]'),
      malt: this.mustElement(options.uiRoot, '[data-stockpile="malt"]'),
      ryeFlour: this.mustElement(options.uiRoot, '[data-stockpile="ryeFlour"]'),
      maslinFlour: this.mustElement(options.uiRoot, '[data-stockpile="maslinFlour"]'),
      ale: this.mustElement(options.uiRoot, '[data-stockpile="ale"]'),
      cider: this.mustElement(options.uiRoot, '[data-stockpile="cider"]'),
      pearCider: this.mustElement(options.uiRoot, '[data-stockpile="pearCider"]'),
      mead: this.mustElement(options.uiRoot, '[data-stockpile="mead"]'),
      preservedFood: this.mustElement(options.uiRoot, '[data-stockpile="preservedFood"]'),
      honey: this.mustElement(options.uiRoot, '[data-stockpile="honey"]'),
      wax: this.mustElement(options.uiRoot, '[data-stockpile="wax"]'),
      candles: this.mustElement(options.uiRoot, '[data-stockpile="candles"]'),
      wine: this.mustElement(options.uiRoot, '[data-stockpile="wine"]'),
      wool: this.mustElement(options.uiRoot, '[data-stockpile="wool"]'),
      flax: this.mustElement(options.uiRoot, '[data-stockpile="flax"]'),
      yarn: this.mustElement(options.uiRoot, '[data-stockpile="yarn"]'),
      linen: this.mustElement(options.uiRoot, '[data-stockpile="linen"]'),
      cloth: this.mustElement(options.uiRoot, '[data-stockpile="cloth"]'),
      pelts: this.mustElement(options.uiRoot, '[data-stockpile="pelts"]'),
      hides: this.mustElement(options.uiRoot, '[data-stockpile="hides"]'),
      leather: this.mustElement(options.uiRoot, '[data-stockpile="leather"]'),
      shoes: this.mustElement(options.uiRoot, '[data-stockpile="shoes"]'),
      ironwork: this.mustElement(options.uiRoot, '[data-stockpile="ironwork"]'),
      polearms: this.mustElement(options.uiRoot, '[data-stockpile="polearms"]'),
      sidearms: this.mustElement(options.uiRoot, '[data-stockpile="sidearms"]'),
      shields: this.mustElement(options.uiRoot, '[data-stockpile="shields"]'),
      bows: this.mustElement(options.uiRoot, '[data-stockpile="bows"]'),
      crossbows: this.mustElement(options.uiRoot, '[data-stockpile="crossbows"]'),
      paddedArmor: this.mustElement(options.uiRoot, '[data-stockpile="paddedArmor"]'),
      mailArmor: this.mustElement(options.uiRoot, '[data-stockpile="mailArmor"]'),
      ammunition: this.mustElement(options.uiRoot, '[data-stockpile="ammunition"]'),
      iron: this.mustElement(options.uiRoot, '[data-stockpile="iron"]'),
      clay: this.mustElement(options.uiRoot, '[data-stockpile="clay"]'),
      salt: this.mustElement(options.uiRoot, '[data-stockpile="salt"]'),
      charcoal: this.mustElement(options.uiRoot, '[data-stockpile="charcoal"]'),
      pottery: this.mustElement(options.uiRoot, '[data-stockpile="pottery"]'),
      roofTiles: this.mustElement(options.uiRoot, '[data-stockpile="roofTiles"]'),
    };
    for (const resource of HUD_RESOURCE_KINDS) {
      const stat = this.stockpileValues[resource]
        .closest<HTMLElement>('.settlement-hud__stat');
      const tooltip = stat?.dataset.tooltip;
      if (tooltip) this.surplusResourceTooltips.set(resource, tooltip);
    }
    this.stockpileTransitValues = Object.fromEntries(
      HUD_RESOURCE_KINDS.map((resource) => [
        resource,
        this.mustElement(options.uiRoot, `[data-stockpile-transit="${resource}"]`),
      ]),
    ) as Record<HudResourceKind, HTMLElement>;
    this.foodBreakdownRows = Object.fromEntries(
      FOOD_BREAKDOWN_ROW_KINDS.map((kind) => [
        kind,
        {
          row: this.mustElement(options.uiRoot, `[data-food-breakdown-row="${kind}"]`),
          stored: this.mustElement(options.uiRoot, `[data-food-breakdown-stored="${kind}"]`),
          transit: this.mustElement(options.uiRoot, `[data-food-breakdown-transit="${kind}"]`),
          homes: this.mustElement(options.uiRoot, `[data-food-breakdown-homes="${kind}"]`),
          surplus: this.mustElement(options.uiRoot, `[data-food-breakdown-surplus="${kind}"]`),
        },
      ]),
    ) as Record<FoodBreakdownRowKind, FoodBreakdownRowElements>;
    this.foodBreakdownEmpty = this.mustElement(options.uiRoot, '[data-food-breakdown-empty]');
    this.foodBreakdownTotalStored = this.mustElement(options.uiRoot, '[data-food-breakdown-total-stored]');
    this.foodBreakdownTotalTransit = this.mustElement(options.uiRoot, '[data-food-breakdown-total-transit]');
    this.foodBreakdownTotalHomes = this.mustElement(options.uiRoot, '[data-food-breakdown-total-homes]');
    this.foodBreakdownTotalSurplus = this.mustElement(options.uiRoot, '[data-food-breakdown-total-surplus]');
    this.populationValue = this.mustElement(options.uiRoot, '[data-stockpile="population"]');
    this.housingValue = this.mustElement(options.uiRoot, '[data-stockpile="housing"]');
    this.laborValue = this.mustElement(options.uiRoot, '[data-stockpile="labor"]');
    this.demolishSection = this.mustElement(options.uiRoot, '[data-inspector-actions]');
    this.demolishButton = this.mustButton(options.uiRoot, '[data-action="demolish-primary"]');
    this.demolishSecondaryButton = this.mustButton(options.uiRoot, '[data-action="demolish-secondary"]');
    this.demolishHint = this.mustElement(options.uiRoot, '[data-demolish-hint]');
    this.demolishSecondaryHint = this.mustElement(options.uiRoot, '[data-demolish-secondary-hint]');
    this.primaryActionSection = this.mustElement(options.uiRoot, '[data-inspector-primary-action]');
    this.laborSection = this.mustElement(options.uiRoot, '[data-inspector-labor]');
    this.laborLabel = this.mustElement(options.uiRoot, '[data-inspector-labor-label]');
    this.laborCount = this.mustElement(options.uiRoot, '[data-inspector-labor-count]');
    this.laborHint = this.mustElement(options.uiRoot, '[data-inspector-labor-hint]');
    this.laborDecrease = this.mustButton(options.uiRoot, '[data-action="labor-decrease"]');
    this.laborIncrease = this.mustButton(options.uiRoot, '[data-action="labor-increase"]');
    this.oxTeamSection = this.mustElement(options.uiRoot, '[data-inspector-ox-team]');
    this.oxTeamCount = this.mustElement(options.uiRoot, '[data-inspector-ox-count]');
    this.oxTeamPool = this.mustElement(options.uiRoot, '[data-inspector-ox-pool]');
    this.oxTeamHint = this.mustElement(options.uiRoot, '[data-inspector-ox-hint]');
    this.oxTeamDecrease = this.mustButton(options.uiRoot, '[data-ox-posting-delta="-1"]');
    this.oxTeamIncrease = this.mustButton(options.uiRoot, '[data-ox-posting-delta="1"]');
    this.supplementalPanelSection = this.mustElement(options.uiRoot, '[data-inspector-supplemental]');

    this.marker = createSelectionMarker();
    options.sceneManager.selectionGroup.add(this.marker);
    this.marker.visible = false;

    options.domElement.addEventListener('mousedown', this.onPointerDown, { capture: true });
    this.panel.addEventListener('mousedown', (event) => event.stopPropagation());
    this.panel.addEventListener('click', this.onPanelClick);
    this.supplementalPanelSection.addEventListener('input', this.onSupplementalInput);
    this.supplementalPanelSection.addEventListener('change', this.onSupplementalChange);
    this.supplementalPanelSection.addEventListener('keydown', this.onSupplementalKeyDown);
    this.demolishButton.addEventListener('click', this.onDemolishPrimaryClick);
    this.demolishSecondaryButton.addEventListener('click', this.onDemolishSecondaryClick);
    this.laborDecrease.addEventListener('click', this.onLaborDecrease);
    this.laborIncrease.addEventListener('click', this.onLaborIncrease);
    this.serviceCoverageButton.addEventListener(
      'click',
      this.onServiceCoverageToggle,
    );
    window.addEventListener('keydown', this.onWindowKeyDown);
    window.addEventListener('keyup', this.onWindowKeyUp);
    window.addEventListener('blur', this.onWindowBlur);
    this.closeButton.addEventListener('click', this.onCloseClick);
    this.resourceTotalsModeButton.addEventListener(
      'click',
      this.onResourceTotalsModeToggle,
    );
    this.syncResourceTotalsPresentation();
  }

  private readonly onCloseClick = (): void => {
    this.clearSelection(true);
  };

  private readonly onServiceCoverageToggle = (event: MouseEvent): void => {
    event.stopPropagation();
    const target = this.selectedTarget;
    if (
      target?.kind !== 'building'
      || target.building.constructionComplete === false
      || this.serviceCoverageProjection == null
    ) {
      return;
    }

    if (
      this.serviceCoverageBuildingId === target.building.id
      && this.serviceCoverageTabPreviewBuildingId == null
    ) {
      this.clearServiceCoverage();
      this.syncServiceCoverageButton(target);
      return;
    }

    this.serviceCoverageTabPreviewBuildingId = null;
    this.serviceCoverageBuildingId = target.building.id;
    this.refreshServiceCoverage(this.serviceCoverageProjection);
    this.syncServiceCoverageButton(target);
  };

  private readonly onWindowKeyDown = (event: KeyboardEvent): void => {
    if (
      event.key !== 'Tab'
      || event.altKey
      || event.ctrlKey
      || event.metaKey
      || event.shiftKey
      || isTextEntryElement(event.target)
      || this.options.isBlocked()
    ) {
      return;
    }

    const target = this.selectedTarget;
    const projection = this.serviceCoverageProjection;
    if (
      target?.kind !== 'building'
      || target.building.kind !== 'marketplace'
      || target.building.constructionComplete === false
      || projection?.kind !== 'marketplace'
    ) {
      return;
    }

    event.preventDefault();
    if (event.repeat || this.serviceCoverageBuildingId === target.building.id) return;
    this.serviceCoverageTabPreviewBuildingId = target.building.id;
    this.serviceCoverageBuildingId = target.building.id;
    this.refreshServiceCoverage(projection);
    this.syncServiceCoverageButton(target);
  };

  private readonly onWindowKeyUp = (event: KeyboardEvent): void => {
    if (event.key !== 'Tab' || this.serviceCoverageTabPreviewBuildingId == null) return;
    event.preventDefault();
    this.endServiceCoverageTabPreview();
  };

  private readonly onWindowBlur = (): void => {
    this.endServiceCoverageTabPreview();
  };

  private endServiceCoverageTabPreview(): void {
    const previewBuildingId = this.serviceCoverageTabPreviewBuildingId;
    if (previewBuildingId == null) return;
    this.serviceCoverageTabPreviewBuildingId = null;
    if (this.serviceCoverageBuildingId === previewBuildingId) {
      this.clearServiceCoverage();
      if (this.selectedTarget) this.syncServiceCoverageButton(this.selectedTarget);
    }
  }

  private readonly onResourceTotalsModeToggle = (): void => {
    this.resourceTotalsPresentation =
      this.resourceTotalsPresentation === 'surplus' ? 'total' : 'surplus';
    saveResourceTotalsPresentation(this.resourceTotalsPresentation);
    this.syncResourceTotalsPresentation();
    this.renderHudResourceTotals();
  };

  private syncResourceTotalsPresentation(): void {
    const showingTotal = this.resourceTotalsPresentation === 'total';
    this.resourceTotalsModeButton.dataset.mode = this.resourceTotalsPresentation;
    this.resourceTotalsModeButton.setAttribute('aria-pressed', String(showingTotal));
    this.resourceTotalsModeButton.setAttribute(
      'aria-label',
      showingTotal
        ? 'Showing total realm holdings. Show realm surplus goods.'
        : 'Showing realm-wide surplus goods. Show total realm holdings.',
    );
    this.resourceTotalsModeButton.dataset.tooltip = showingTotal
      ? 'All physical goods across every community, including goods committed to active construction and home projects. Activate to show realm surplus.'
      : 'Goods available across every community after active construction and home-project commitments are deducted. Activate to show all realm holdings.';
    this.resourceTotalsModeButton.dataset.tooltipTitle = showingTotal
      ? 'Total realm holdings'
      : 'Realm surplus (default)';
    this.resourceTotalsModeLabel.textContent = showingTotal ? 'Realm · Total' : 'Realm · Surplus';
    const panelModeLabel = showingTotal ? 'Total stored' : 'Available surplus';
    this.foodStoresModeLabel.textContent = panelModeLabel;
    this.fuelStoresModeLabel.textContent = panelModeLabel;
    this.specialtyStoresModeLabel.textContent = panelModeLabel;
    this.militaryStoresModeLabel.textContent = panelModeLabel;
    this.stockpileRoot.dataset.resourceTotalsPresentation =
      this.resourceTotalsPresentation;
    for (const resource of HUD_RESOURCE_CARD_KINDS) {
      const presentation = HUD_RESOURCE_CARD_PRESENTATION[resource];
      this.resourceCardModeLabels[resource].textContent = panelModeLabel;
      this.resourceCardDetails[resource].textContent = showingTotal
        ? presentation.totalDetail
        : presentation.surplusDetail;
    }

    for (const resource of HUD_RESOURCE_KINDS) {
      const stat = this.stockpileValues[resource]
        .closest<HTMLElement>('.settlement-hud__stat');
      if (!stat) continue;
      if (
        (isHudResourceCardKind(resource) && stat.closest('[data-hud-card]'))
        || stat.matches('.settlement-hud__stat--food, .settlement-hud__stat--fuel')
      ) {
        delete stat.dataset.tooltipTitle;
        delete stat.dataset.tooltip;
        delete stat.dataset.tooltipAmount;
        delete stat.dataset.tooltipAmountLabel;
        continue;
      }
      const tooltip = showingTotal
        ? DEFAULT_TOTAL_RESOURCE_TOOLTIP
        : this.surplusResourceTooltips.get(resource);
      if (tooltip) stat.dataset.tooltip = tooltip;
    }
  }

  private readonly onDemolishPrimaryClick = (): void => {
    const target = this.selectedTarget;
    if (!target) return;
    const actionLabel = this.demolishButton.textContent?.trim() || 'Demolish';
    void this.confirmDestructiveAction(
      actionLabel,
      this.destructiveTargetLabel(target),
      async () => {
        if (target.kind === 'building') {
          await this.options.onDemolishBuilding?.(target.building.id);
          return;
        }
        if (target.kind === 'residence') {
          await this.options.onDemolishResidence?.(target.residence.id);
          return;
        }
        if (target.kind === 'backyard' && target.garden) {
          await this.options.onDemolishBackyardGarden?.(target.residence.id);
          return;
        }
        if (target.kind === 'farm-field') {
          await this.options.onDemolishFarmField?.(target.field.id);
          return;
        }
        if (target.kind === 'pasture') {
          await this.options.onDemolishPasture?.(target.pasture.id);
          return;
        }
        if (target.kind === 'graveyard') {
          await this.options.onDemolishGraveyard?.(target.graveyard.id);
        }
      },
      this.demolishHint.textContent?.trim() ?? '',
    );
  };

  private readonly onPanelClick = (event: MouseEvent): void => {
    event.stopPropagation();
    const raiseMilitia = (event.target as HTMLElement).closest<HTMLElement>('[data-raise-militia]');
    if (raiseMilitia && this.selectedTarget?.kind === 'building' && this.selectedTarget.building.kind === 'town_hall') {
      const sizePicker = raiseMilitia
        .closest<HTMLElement>('.military-recruitment-card')
        ?.querySelector<HTMLSelectElement>('[data-militia-size]');
      void this.options.onRaiseMilitia?.(
        this.selectedTarget.building.id,
        Number(sizePicker?.value ?? raiseMilitia.dataset.raiseMilitia ?? 5),
      );
      return;
    }
    if ((event.target as HTMLElement).closest('[data-disband-militia]')) {
      void this.options.onDisbandMilitia?.();
      return;
    }
    const recruitMilitary = (event.target as HTMLElement).closest<HTMLElement>('[data-recruit-military-kind]');
    if (
      recruitMilitary
      && this.selectedTarget?.kind === 'building'
      && (this.selectedTarget.building.kind === 'guardhouse' || this.selectedTarget.building.kind === 'cavalry_yard')
    ) {
      void this.options.onRecruitMilitaryCompany?.(
        this.selectedTarget.building.id,
        Number(recruitMilitary.dataset.recruitMilitaryKind),
      );
      return;
    }
    const hireMercenaries = (event.target as HTMLElement).closest<HTMLElement>('[data-hire-mercenary-company]');
    if (hireMercenaries && this.selectedTarget?.kind === 'building' && this.selectedTarget.building.kind === 'town_hall') {
      void this.options.onHireMercenaryCompany?.(this.selectedTarget.building.id);
      return;
    }
    const disbandMilitary = (event.target as HTMLElement).closest<HTMLElement>('[data-disband-military-company]');
    if (disbandMilitary?.dataset.disbandMilitaryCompany) {
      void this.confirmMilitaryCompanyDisband(disbandMilitary.dataset.disbandMilitaryCompany);
      return;
    }
    const renewMercenaries = (event.target as HTMLElement).closest<HTMLElement>('[data-renew-mercenary-contract]');
    if (renewMercenaries?.dataset.renewMercenaryContract) {
      void this.options.onRenewMercenaryContract?.(renewMercenaries.dataset.renewMercenaryContract);
      return;
    }
    const resupplyMilitary = (event.target as HTMLElement).closest<HTMLElement>('[data-resupply-military-company]');
    if (resupplyMilitary?.dataset.resupplyMilitaryCompany) {
      void this.options.onResupplyMilitaryCompany?.(resupplyMilitary.dataset.resupplyMilitaryCompany);
      return;
    }
    const formation = (event.target as HTMLElement).closest<HTMLElement>('[data-military-formation]');
    if (formation?.dataset.militaryCompanyId && formation.dataset.militaryFormation != null) {
      void this.options.onSetMilitaryFormation?.(
        formation.dataset.militaryCompanyId,
        Number(formation.dataset.militaryFormation),
      );
      return;
    }
    const dogPostingButton = (event.target as HTMLElement)
      .closest<HTMLButtonElement>('[data-dog-posting-delta]');
    if (dogPostingButton && this.selectedTarget?.kind === 'building') {
      if (dogPostingButton.disabled) return;
      const team = dogPostingButton.closest<HTMLElement>('[data-hunting-dog-team]');
      const delta = Number(dogPostingButton.dataset.dogPostingDelta);
      const currentCount = Number(team?.dataset.postedCount);
      const maxCount = Number(team?.dataset.maxCount);
      if (Number.isFinite(delta) && Number.isFinite(currentCount) && Number.isFinite(maxCount)) {
        const targetCount = Math.max(
          0,
          Math.min(Math.floor(maxCount), Math.floor(currentCount + delta)),
        );
        void this.options.onSetBuildingDogs?.(
          this.selectedTarget.building.id,
          targetCount,
        );
      }
      return;
    }
    const oxPostingButton = (event.target as HTMLElement)
      .closest<HTMLButtonElement>('[data-ox-posting-delta]');
    if (oxPostingButton && this.selectedTarget?.kind === 'building') {
      if (oxPostingButton.disabled) return;
      const delta = Number(oxPostingButton.dataset.oxPostingDelta);
      const currentCount = Number(this.oxTeamSection.dataset.postedCount);
      const maxCount = Number(this.oxTeamSection.dataset.maxCount);
      if (Number.isFinite(delta) && Number.isFinite(currentCount) && Number.isFinite(maxCount)) {
        const targetCount = Math.max(
          0,
          Math.min(Math.floor(maxCount), Math.floor(currentCount + delta)),
        );
        void this.options.onSetBuildingOxen?.(
          this.selectedTarget.building.id,
          targetCount,
        );
      }
      return;
    }
    if (
      this.selectedTarget?.kind === 'building'
      && (this.selectedTarget.building.kind === 'village_storehouse'
        || this.selectedTarget.building.kind === 'granary')
    ) {
      const commodityButton = (event.target as HTMLElement)
        .closest<HTMLElement>('[data-storage-commodity]');
      const commodity = commodityButton?.dataset.storageCommodity;
      if (isStorageCommodity(commodity)) {
        void this.options.onSetStorageCommodityAcceptance?.(
          this.selectedTarget.building.id,
          commodity,
          commodityButton?.dataset.storageAccepts !== 'true',
        );
        return;
      }
      const allButton = (event.target as HTMLElement)
        .closest<HTMLElement>('[data-storage-accept-all]');
      if (allButton?.dataset.storageAcceptAll != null) {
        void this.options.onSetAllStorageAcceptance?.(
          this.selectedTarget.building.id,
          allButton.dataset.storageAcceptAll === 'true',
        );
        return;
      }
    }
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
    const fireRecoveryButton = (event.target as HTMLElement)
      .closest<HTMLElement>('[data-fire-recovery]');
    if (fireRecoveryButton) {
      if (fireRecoveryButton.getAttribute('aria-disabled') === 'true') return;
      if (this.selectedTarget?.kind === 'building') {
        void this.options.onRepairFireDamage?.('building', this.selectedTarget.building.id);
      } else if (this.selectedTarget?.kind === 'residence') {
        void this.options.onRepairFireDamage?.('residence', this.selectedTarget.residence.id);
      }
      return;
    }
    const demolishGraveyardId = (event.target as HTMLElement)
      .closest<HTMLElement>('[data-demolish-graveyard]')
      ?.dataset.demolishGraveyard;
    if (demolishGraveyardId) {
      void this.confirmDestructiveAction(
        'Remove burial ground',
        'Empty burial ground',
        () => this.options.onDemolishGraveyard?.(demolishGraveyardId),
      );
      return;
    }
    const inspectPastureId = (event.target as HTMLElement)
      .closest<HTMLElement>('[data-inspect-pasture]')
      ?.dataset.inspectPasture;
    if (inspectPastureId) {
      const target = this.options.worldQueries.findPastureTarget(inspectPastureId);
      if (target) {
        this.selectTarget(target);
        const center = target.pasture.corners.reduce(
          (sum, point) => ({
            x: sum.x + point.x / target.pasture.corners.length,
            z: sum.z + point.z / target.pasture.corners.length,
          }),
          { x: 0, z: 0 },
        );
        this.options.onFocusWorldPosition?.(center.x, center.z);
      }
      return;
    }
    if (
      (event.target as HTMLElement).closest('[data-rotate-construction-labor]')
      && this.selectedTarget?.kind === 'building'
      && this.selectedTarget.building.kind === 'town_hall'
    ) {
      void this.options.onRotateConstructionLabor?.(this.selectedTarget.building.id);
      return;
    }
    if (
      (event.target as HTMLElement).closest('[data-recall-idle-seasonal-labor]')
      && this.selectedTarget?.kind === 'building'
      && this.selectedTarget.building.kind === 'town_hall'
    ) {
      void this.options.onRecallIdleSeasonalLabor?.(this.selectedTarget.building.id);
      return;
    }
    if (
      (event.target as HTMLElement).closest('[data-call-up-active-seasonal-labor]')
      && this.selectedTarget?.kind === 'building'
      && this.selectedTarget.building.kind === 'town_hall'
    ) {
      void this.options.onCallUpActiveSeasonalLabor?.(this.selectedTarget.building.id);
      return;
    }
    if (
      (event.target as HTMLElement).closest('[data-recall-target-idle-processor-labor]')
      && this.selectedTarget?.kind === 'building'
      && this.selectedTarget.building.kind === 'town_hall'
    ) {
      void this.options.onRecallTargetIdleProcessorLabor?.(this.selectedTarget.building.id);
      return;
    }
    if (
      (event.target as HTMLElement).closest('[data-call-up-target-ready-processor-labor]')
      && this.selectedTarget?.kind === 'building'
      && this.selectedTarget.building.kind === 'town_hall'
    ) {
      void this.options.onCallUpTargetReadyProcessorLabor?.(this.selectedTarget.building.id);
      return;
    }
    if (
      (event.target as HTMLElement).closest('[data-balance-year-round-labor]')
      && this.selectedTarget?.kind === 'building'
      && this.selectedTarget.building.kind === 'town_hall'
    ) {
      void this.options.onBalanceYearRoundLabor?.(this.selectedTarget.building.id);
      return;
    }
    if (this.selectedTarget?.kind === 'farm-field') {
      if ((event.target as HTMLElement).closest('[data-field-early-harvest]')) {
        void this.options.onStartFarmFieldEarlyHarvest?.(this.selectedTarget.field.id);
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
      const purchaseOxButton = (event.target as HTMLElement)
        .closest<HTMLButtonElement>('[data-purchase-ox]');
      if (building.kind === 'stable' && purchaseOxButton) {
        if (
          purchaseOxButton.getAttribute('aria-disabled') === 'true'
          || purchaseOxButton.dataset.purchasePending === 'true'
        ) return;

        const idleLabel = purchaseOxButton.getAttribute('aria-label');
        purchaseOxButton.dataset.purchasePending = 'true';
        purchaseOxButton.setAttribute('aria-busy', 'true');
        purchaseOxButton.setAttribute('aria-disabled', 'true');
        purchaseOxButton.setAttribute('aria-label', 'Purchasing draft ox.');
        void Promise.resolve()
          .then(() => this.options.onPurchaseStableOx?.(building.id))
          .finally(() => {
            if (!purchaseOxButton.isConnected) return;
            delete purchaseOxButton.dataset.purchasePending;
            purchaseOxButton.removeAttribute('aria-busy');
            purchaseOxButton.removeAttribute('aria-disabled');
            if (idleLabel) purchaseOxButton.setAttribute('aria-label', idleLabel);
          });
        return;
      }
      const purchaseDogButton = (event.target as HTMLElement)
        .closest<HTMLButtonElement>('[data-purchase-dog]');
      if (building.kind === 'kennel' && purchaseDogButton) {
        if (
          purchaseDogButton.getAttribute('aria-disabled') === 'true'
          || purchaseDogButton.dataset.purchasePending === 'true'
        ) return;
        const idleLabel = purchaseDogButton.getAttribute('aria-label');
        purchaseDogButton.dataset.purchasePending = 'true';
        purchaseDogButton.setAttribute('aria-busy', 'true');
        purchaseDogButton.setAttribute('aria-disabled', 'true');
        purchaseDogButton.setAttribute('aria-label', 'Purchasing guard dog.');
        void Promise.resolve()
          .then(() => this.options.onPurchaseKennelDog?.(building.id))
          .finally(() => {
            if (!purchaseDogButton.isConnected) return;
            delete purchaseDogButton.dataset.purchasePending;
            purchaseDogButton.removeAttribute('aria-busy');
            purchaseDogButton.removeAttribute('aria-disabled');
            if (idleLabel) purchaseDogButton.setAttribute('aria-label', idleLabel);
          });
        return;
      }
      if (
        (event.target as HTMLElement).closest('[data-tree-work-area-action]')
        && (
          building.kind === 'lumber_mill'
          || building.kind === 'woodcutters_lodge'
          || building.kind === 'reforester'
        )
      ) {
        if (hasCustomTreeWorkArea(building)) {
          void this.options.onClearTreeWorkArea?.(building.id);
        } else {
          this.options.onBeginTreeWorkAreaPlacement?.(building.id);
        }
        return;
      }
      const threshingPriority = (event.target as HTMLElement)
        .closest<HTMLElement>('[data-threshing-priority]')
        ?.dataset.threshingPriority;
      if (threshingPriority != null && building.kind === 'threshing_barn') {
        void this.options.onSetThreshingPriority?.(
          building.id,
          Number(threshingPriority),
        );
        return;
      }
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
      const landParcel = (event.target as HTMLElement).closest<HTMLElement>('[data-land-parcel]')?.dataset.landParcel;
      if (landParcel === 'field' && building.kind === 'threshing_barn') {
        this.options.onBeginFarmFieldPlacement?.(building.id, ['rye', 'rye', 'rye'], false);
        return;
      }
      if (landParcel === 'pasture' && (building.kind === 'pastoral_farmstead' || building.kind === 'swineherd')) {
        this.options.onBeginPasturePlacement?.(building.id);
        return;
      }
      if (landParcel === 'graveyard' && building.kind === 'chapel') {
        this.options.onBeginGraveyardPlacement?.(building.id);
        return;
      }
      if (landParcel === 'vineyard' && building.kind === 'monastery') {
        this.options.onBeginVineyardPlacement?.(building.id);
        return;
      }
    }
    if (
      this.selectedTarget?.kind === 'pasture'
      && this.selectedTarget.farmstead
      && (this.selectedTarget.farmstead.kind === 'pastoral_farmstead'
        || this.selectedTarget.farmstead.kind === 'swineherd')
    ) {
      const species = (event.target as HTMLElement)
        .closest<HTMLElement>('[data-livestock-species]')
        ?.dataset.livestockSpecies;
      if (
        this.selectedTarget.farmstead.kind === 'pastoral_farmstead'
        && (species === 'cattle' || species === 'sheep' || species === 'horses')
      ) {
        void this.options.onSetLivestockSpecies?.(
          this.selectedTarget.pasture.id,
          species,
        );
        return;
      }
      const livestockTradeValue = (event.target as HTMLElement)
        .closest<HTMLElement>('[data-livestock-trade]')
        ?.dataset.livestockTrade;
      if (livestockTradeValue != null) {
        const headDelta = Number(livestockTradeValue);
        if (Number.isInteger(headDelta) && headDelta !== 0) {
          void this.options.onTradeLivestock?.(
            this.selectedTarget.pasture.id,
            headDelta,
          );
        }
        return;
      }
      const reserveValue = (event.target as HTMLElement)
        .closest<HTMLElement>('[data-livestock-breeding-reserve]')
        ?.dataset.livestockBreedingReserve;
      if (reserveValue != null) {
        void this.options.onSetLivestockBreedingReserve?.(
          this.selectedTarget.pasture.id,
          Number(reserveValue),
        );
        return;
      }
      const haymakingValue = (event.target as HTMLElement)
        .closest<HTMLElement>('[data-livestock-haymaking-percent]')
        ?.dataset.livestockHaymakingPercent;
      if (haymakingValue != null && this.selectedTarget.farmstead.kind === 'pastoral_farmstead') {
        void this.options.onSetLivestockHaymakingPercent?.(
          this.selectedTarget.pasture.id,
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
      const serviceTargetValue = (event.target as HTMLElement)
        .closest<HTMLElement>('[data-carpenter-cart-service-target]')
        ?.dataset.carpenterCartServiceTarget;
      if (serviceTargetValue != null) {
        void this.options.onSetCarpenterCartServiceTarget?.(
          this.selectedTarget.building.id,
          Number(serviceTargetValue),
        );
        return;
      }
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
      const musterWatchtowerId = (event.target as HTMLElement)
        .closest<HTMLElement>('[data-guardhouse-muster-watchtower]')
        ?.dataset.guardhouseMusterWatchtower;
      if (musterWatchtowerId != null) {
        void this.options.onSetGuardhouseMusterPost?.(
          this.selectedTarget.building.id,
          musterWatchtowerId === 'auto' ? null : musterWatchtowerId,
        );
        return;
      }
    }
    if (
      this.selectedTarget?.kind === 'building'
      && this.selectedTarget.building.kind === 'trading_post'
    ) {
      const tradeModeButton = (event.target as HTMLElement)
        .closest<HTMLElement>('[data-trade-rule-mode]');
      if (tradeModeButton) {
        const row = tradeModeButton.closest<HTMLElement>('[data-trade-rule-row]');
        const commodityKind = Number(tradeModeButton.dataset.commodityKind);
        const mode = Number(tradeModeButton.dataset.tradeRuleMode);
        const rawTargetSurplus = Number(
          row?.querySelector<HTMLInputElement>('[data-trade-surplus-input]')?.value ?? 0,
        );
        const targetSurplus = Number.isFinite(rawTargetSurplus)
          ? Math.max(0, Math.min(9_999, Math.round(rawTargetSurplus)))
          : 0;
        void this.options.onSetTradingPostTradeRule?.(
          this.selectedTarget.building.id,
          commodityKind,
          mode,
          targetSurplus,
        );
        return;
      }
      const surplusButton = (event.target as HTMLElement)
        .closest<HTMLElement>('[data-trade-surplus-delta]');
      if (surplusButton) {
        const row = surplusButton.closest<HTMLElement>('[data-trade-rule-row]');
        const input = row?.querySelector<HTMLInputElement>('[data-trade-surplus-input]');
        if (!row || !input) return;
        const current = Number(input.value);
        const delta = Number(surplusButton.dataset.tradeSurplusDelta);
        const value = Math.max(0, Math.min(9_999, Math.round(
          (Number.isFinite(current) ? current : 0) + (Number.isFinite(delta) ? delta : 0),
        )));
        input.value = String(value);
        void this.options.onSetTradingPostTradeRule?.(
          this.selectedTarget.building.id,
          Number(input.dataset.commodityKind),
          Number(row.dataset.tradeMode ?? 0),
          value,
        );
        return;
      }
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
      const ironTargetValue = (event.target as HTMLElement)
        .closest<HTMLElement>('[data-marketplace-iron-target]')
        ?.dataset.marketplaceIronTarget;
      if (ironTargetValue != null) {
        void this.options.onSetMarketplaceIronTarget?.(
          this.selectedTarget.building.id,
          Number(ironTargetValue),
        );
        return;
      }
      const saltTargetValue = (event.target as HTMLElement)
        .closest<HTMLElement>('[data-marketplace-salt-target]')
        ?.dataset.marketplaceSaltTarget;
      if (saltTargetValue != null) {
        void this.options.onSetMarketplaceSaltTarget?.(
          this.selectedTarget.building.id,
          Number(saltTargetValue),
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
        .closest<HTMLElement>('[data-marketplace-specialty-family-policy]')
        ?.dataset.marketplaceSpecialtyFamilyPolicy;
      const exportFamilyValue = (event.target as HTMLElement)
        .closest<HTMLElement>('[data-marketplace-specialty-family-policy]')
        ?.dataset.marketplaceSpecialtyFamily;
      if (exportPolicyValue != null && exportFamilyValue != null) {
        void this.options.onSetMarketplaceSpecialtyFamilyExportPolicy?.(
          this.selectedTarget.building.id,
          Number(exportFamilyValue),
          Number(exportPolicyValue),
        );
        return;
      }
      const legacyExportPolicyValue = (event.target as HTMLElement)
        .closest<HTMLElement>('[data-marketplace-specialty-export-policy]')
        ?.dataset.marketplaceSpecialtyExportPolicy;
      if (legacyExportPolicyValue != null) {
        void this.options.onSetMarketplaceSpecialtyExportPolicy?.(
          this.selectedTarget.building.id,
          Number(legacyExportPolicyValue),
        );
        return;
      }
    }
    if (
      this.selectedTarget?.kind === 'building'
      && this.selectedTarget.building.kind === 'apiary'
    ) {
      const value = (event.target as HTMLElement)
        .closest<HTMLElement>('[data-apiary-harvest-policy]')
        ?.dataset.apiaryHarvestPolicy;
      if (value != null) {
        void this.options.onSetApiaryHarvestPolicy?.(
          this.selectedTarget.building.id,
          Number(value),
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
      if (this.selectedTarget.building.kind === 'brewery') {
        const recipePolicy = (event.target as HTMLElement)
          .closest<HTMLElement>('[data-brewery-recipe-policy]')
          ?.dataset.breweryRecipePolicy;
        if (recipePolicy != null) {
          void this.options.onSetBreweryRecipePolicy?.(
            this.selectedTarget.building.id,
            Number(recipePolicy),
          );
          return;
        }
      }
      if (this.selectedTarget.building.kind === 'smokehouse') {
        const recipePolicy = (event.target as HTMLElement)
          .closest<HTMLElement>('[data-smokehouse-recipe-policy]')
          ?.dataset.smokehouseRecipePolicy;
        if (recipePolicy != null) {
          void this.options.onSetSmokehouseRecipePolicy?.(
            this.selectedTarget.building.id,
            Number(recipePolicy),
          );
          return;
        }
      }
      if (
        this.selectedTarget.building.kind === 'spinning_retting_house'
        || this.selectedTarget.building.kind === 'weaver'
      ) {
        const inputPolicy = (event.target as HTMLElement)
          .closest<HTMLElement>('[data-weaver-input-policy]')
          ?.dataset.weaverInputPolicy;
        if (inputPolicy != null) {
          void this.options.onSetWeaverInputPolicy?.(
            this.selectedTarget.building.id,
            Number(inputPolicy),
          );
          return;
        }
      }
      if (this.selectedTarget.building.kind === 'potter_kiln') {
        const firingPolicy = (event.target as HTMLElement)
          .closest<HTMLElement>('[data-potter-firing-policy]')
          ?.dataset.potterFiringPolicy;
        if (firingPolicy != null) {
          void this.options.onSetPotterFiringPolicy?.(
            this.selectedTarget.building.id,
            Number(firingPolicy),
          );
          return;
        }
      }
    }
    if (
      this.selectedTarget?.kind === 'building'
      && this.selectedTarget.building.kind === 'pastoral_farmstead'
    ) {
      const milkUsePolicy = (event.target as HTMLElement)
        .closest<HTMLElement>('[data-livestock-milk-use]')
        ?.dataset.livestockMilkUse;
      if (milkUsePolicy != null) {
        void this.options.onSetLivestockMilkUsePolicy?.(
          this.selectedTarget.building.id,
          Number(milkUsePolicy),
        );
        return;
      }
    }
    if (
      this.selectedTarget?.kind === 'building'
      && this.selectedTarget.building.kind === 'granary'
    ) {
      const householdsFirstValue = (event.target as HTMLElement)
        .closest<HTMLElement>('[data-granary-households-first]')
        ?.dataset.granaryHouseholdsFirst;
      if (householdsFirstValue != null) {
        void this.options.onSetGranaryPolicy?.(
          this.selectedTarget.building.id,
          this.selectedTarget.building.granaryAcceptsFreshFood !== false,
          householdsFirstValue === 'true',
        );
        return;
      }
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
        this.selectedTarget.building.kind === 'foragers_shed'
        ||
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
    if (
      this.selectedTarget?.kind === 'building'
      && this.selectedTarget.building.kind === 'monastery'
    ) {
      const extensionValue = (event.target as HTMLElement)
        .closest<HTMLElement>('[data-monastery-extension-choice]')
        ?.dataset.monasteryExtensionChoice;
      if (extensionValue != null) {
        void this.options.onSetMonasteryNextExtension?.(
          this.selectedTarget.building.id,
          Number(extensionValue),
        );
        return;
      }
    }
    handleSupplementalPanelClick(this.selectedTarget, event.target as HTMLElement, {
      onPlaceBackyardGarden: this.options.onPlaceBackyardGarden,
      onSpecializeOrchard: this.options.onSpecializeOrchard,
      onSpecializeAnimalPen: this.options.onSpecializeAnimalPen,
      onSpecializeVegetableGarden: this.options.onSpecializeVegetableGarden,
      onUpgradeFlowerGardenLuxury: this.options.onUpgradeFlowerGardenLuxury,
      onUpgradeChapel: this.options.onUpgradeChapel,
      onUpgradeResidence: this.options.onUpgradeResidence,
      onConvertResidenceToSmallholding: this.options.onConvertResidenceToSmallholding,
      onRetrofitResidenceTileRoof: this.options.onRetrofitResidenceTileRoof,
      onSetResidenceUpgradePriority: this.options.onSetResidenceUpgradePriority,
    });
  };

  private readonly onDemolishSecondaryClick = (): void => {
    const target = this.selectedTarget;
    if (target?.kind !== 'residence') return;
    const actionLabel = this.demolishSecondaryButton.textContent?.trim()
      || 'Remove entire plot';
    void this.confirmDestructiveAction(
      actionLabel,
      `${target.residenceCount} residence${target.residenceCount === 1 ? '' : 's'}`,
      () => this.options.onDemolishBurgageZone?.(target.zone.id),
      this.demolishSecondaryHint.textContent?.trim() ?? '',
    );
  };

  private async confirmMilitaryCompanyDisband(companyId: string): Promise<void> {
    const company = [...(this.options.getMilitaryCompanies?.() ?? [])]
      .find((candidate) => candidate.id === companyId);
    if (!company) return;
    const mercenary = company.kind === 'mercenary-spears';
    const mounted = company.kind === 'hussars'
      || company.kind === 'armored-lancers'
      || company.kind === 'mounted-archers';
    const actionLabel = mercenary ? 'End contract' : 'Disband company';
    const confirmed = await this.deleteDialog.confirm({
      eyebrow: mercenary ? 'Confirm contract end' : 'Confirm stand-down',
      title: actionLabel,
      description: mercenary
        ? `${militaryCompanyDisplayName(company)} will stop accepting orders and march back to the region edge.`
        : mounted
          ? `${militaryCompanyDisplayName(company)} will stand down. Survivors return their kit, ride each horse to its home pasture, then return home.`
          : `${militaryCompanyDisplayName(company)} will stand down. Survivors return their equipment and go home.`,
      confirmLabel: actionLabel,
      cancelLabel: 'Keep company',
    });
    if (!confirmed) return;
    await this.options.onDisbandMilitaryCompany?.(companyId);
  }

  private async confirmDestructiveAction(
    actionLabel: string,
    targetLabel: string,
    action: () => void | Promise<void> | undefined,
    detail = '',
  ): Promise<void> {
    const confirmed = await this.deleteDialog.confirm({
      eyebrow: 'Confirm removal',
      title: actionLabel,
      description: detail
        ? `${targetLabel} · irreversible. ${detail}`
        : `${targetLabel} · irreversible`,
      confirmLabel: actionLabel,
      cancelLabel: 'Cancel',
    });
    if (!confirmed) return;
    await action();
  }

  private destructiveTargetLabel(target: InspectableTarget): string {
    switch (target.kind) {
      case 'building':
        return this.options.worldQueries.getBuildingLabel(target.building.kind);
      case 'residence':
        return `Residence · parcel ${target.residence.parcelIndex + 1}`;
      case 'backyard':
        return 'Backyard holding';
      case 'farm-field':
        return 'Farm field';
      case 'pasture':
        return 'Pasture';
      case 'graveyard':
        return 'Burial ground';
      case 'quarry':
      case 'foraging':
      case 'river':
        return 'Selected site';
    }
  }

  private readonly onSupplementalInput = (event: Event): void => {
    const input = event.target as HTMLInputElement;
    if (input.matches('[data-policy-tax-rate]')) {
      const output = this.supplementalPanelSection.querySelector<HTMLElement>('[data-policy-tax-rate-value]');
      if (output) output.textContent = `${Math.round(Number(input.value))}%`;
    } else if (input.matches('[data-policy-land-levy]')) {
      const output = this.supplementalPanelSection.querySelector<HTMLElement>('[data-policy-land-levy-value]');
      if (output) output.textContent = `${Math.round(Number(input.value))}% annually`;
    } else if (input.matches('[data-policy-import-duty]')) {
      const output = this.supplementalPanelSection.querySelector<HTMLElement>('[data-policy-import-duty-value]');
      if (output) output.textContent = `${Math.round(Number(input.value))}%`;
    } else if (input.matches('[data-policy-export-duty]')) {
      const output = this.supplementalPanelSection.querySelector<HTMLElement>('[data-policy-export-duty-value]');
      if (output) output.textContent = `${Math.round(Number(input.value))}%`;
    } else if (input.matches('[data-policy-monastery-tithe]')) {
      const output = this.supplementalPanelSection.querySelector<HTMLElement>('[data-policy-monastery-tithe-value]');
      if (output) output.textContent = `${Math.round(Number(input.value))}%`;
    } else if (input.matches('[data-production-rate-slider]')) {
      const percent = Math.max(0, Math.min(100, Math.round(Number(input.value))));
      const multiplier = productionRateMultiplier(percent);
      const maintenanceMultiplier = maintenanceRateMultiplier(percent);
      const value = input.closest<HTMLElement>('.inspector-action-panel')
        ?.querySelector<HTMLElement>('[data-production-rate-value]');
      const maintenance = input.closest<HTMLElement>('.inspector-action-panel')
        ?.querySelector<HTMLElement>('[data-production-rate-maintenance]');
      const normalAnnual = Math.max(0, Number(input.dataset.ironworkPerYearAtNormal));
      if (value) {
        value.textContent = multiplier <= 1e-9
          ? `${percent}% · Paused · 0× upkeep`
          : `${percent}% · ${multiplier.toFixed(multiplier % 1 === 0 ? 0 : 1)}× pace · ${maintenanceMultiplier.toFixed(maintenanceMultiplier % 1 === 0 ? 0 : 2)}× upkeep`;
      }
      if (maintenance) {
        maintenance.textContent = `Ironwork upkeep: ${(normalAnnual * maintenanceMultiplier).toFixed(1)}/year maximum at current roster. Upkeep scales with pace squared; actual consumption follows completed work.`;
      }
    } else if (input.matches('[data-harvest-reserve-slider]')) {
      const reserve = Math.max(0, Math.round(Number(input.value)));
      const capacity = Math.max(0, Number(input.dataset.harvestReserveCapacity));
      const unit = input.dataset.harvestReserveUnit ?? 'wild stock';
      const percent = capacity > 0 ? Math.round(reserve / capacity * 100) : 0;
      const verb = this.selectedTarget?.kind === 'building'
        && this.selectedTarget.building.kind === 'hunters_hall'
        ? 'Hunt'
        : this.selectedTarget?.kind === 'building'
          && this.selectedTarget.building.kind === 'fishing_camp'
          ? 'Fish'
          : 'Gather';
      const liveTitle = `${verb} until ${reserve} ${unit} remain`;
      const liveDetail = `${percent}% of capacity · applied proportionally to every managed source when released.`;
      const panel = input.closest<HTMLElement>('.inspector-action-panel');
      const output = panel?.querySelector<HTMLElement>('[data-harvest-reserve-value]');
      const share = panel?.querySelector<HTMLElement>('[data-harvest-reserve-share]');
      if (output) output.textContent = `${reserve} ${unit}`;
      if (share) share.textContent = liveDetail;
      if (panel) {
        panel.dataset.inspectorPanelTitle = liveTitle;
        const heading = panel.querySelector<HTMLElement>(
          ':scope > .inspector-action-panel__title',
        );
        if (heading) {
          heading.textContent = liveTitle;
          syncFocusableInspectorTooltip(heading, liveTitle, liveDetail);
        }
      }
    }
  };

  private readonly onSupplementalChange = (event: Event): void => {
    event.stopPropagation();
    const input = event.target as HTMLInputElement;
    if (this.selectedTarget?.kind === 'farm-field') {
      const field = this.selectedTarget.field;
      const panel = input.closest<HTMLElement>('.inspector-action-panel');
      const repeatSelect = panel?.querySelector<HTMLSelectElement>('[data-field-rotation-repeat]');
      const nextSelect = panel?.querySelector<HTMLSelectElement>('[data-field-rotation-next]');
      const followingSelect = panel?.querySelector<HTMLSelectElement>('[data-field-rotation-following]');
      const autoManage = panel?.querySelector<HTMLInputElement>('[data-field-rotation-auto-manage]');
      const cropValue = (select: HTMLSelectElement | null | undefined): FarmCrop | null => (
        select && FARM_CROPS.includes(select.value as FarmCrop)
          ? select.value as FarmCrop
          : null
      );
      const cropText = (select: HTMLSelectElement | null | undefined, fallback: FarmCrop): string =>
        select?.selectedOptions[0]?.textContent?.trim()
        ?? fallback[0].toUpperCase() + fallback.slice(1);
      const syncFieldRotationPresentation = (): void => {
        if (!panel || !autoManage) return;
        for (const select of [repeatSelect, nextSelect, followingSelect]) {
          const crop = cropValue(select);
          const icon = select?.closest<HTMLElement>('.farm-rotation-row')
            ?.querySelector<HTMLElement>('[data-field-crop-icon]');
          if (icon && crop) icon.dataset.fieldCropIcon = crop;
        }
        const managed = autoManage.checked;
        const single = panel.querySelector<HTMLElement>('[data-field-rotation-single]');
        const cycle = panel.querySelector<HTMLElement>('[data-field-rotation-cycle]');
        const summary = panel.querySelector<HTMLElement>('[data-field-rotation-summary]');
        if (single) single.hidden = managed;
        if (cycle) cycle.hidden = !managed;
        autoManage.setAttribute('aria-expanded', String(managed));
        if (!summary) return;
        summary.textContent = managed
          ? `${field.crop[0].toUpperCase()}${field.crop.slice(1)} → ${cropText(nextSelect, field.nextCrop)} → ${cropText(followingSelect, field.nextCrop)} · repeats forever`
          : `${field.crop[0].toUpperCase()}${field.crop.slice(1)} remains in the ground · then ${cropText(repeatSelect, field.nextCrop)} repeats every crop year`;
      };

      if (input.matches('[data-field-rotation-auto-manage]')) {
        syncFieldRotationPresentation();
        void this.options.onSetFarmFieldFollowingCrop?.(
          field.id,
          input.checked ? cropValue(followingSelect) ?? field.nextCrop : null,
        );
        return;
      }
      if (input.matches('[data-field-rotation-repeat], [data-field-rotation-next]')) {
        syncFieldRotationPresentation();
        const crop = cropValue(input as unknown as HTMLSelectElement);
        if (crop) void this.options.onSetFarmFieldCrop?.(field.id, crop);
        return;
      }
      if (input.matches('[data-field-rotation-following]')) {
        syncFieldRotationPresentation();
        const crop = cropValue(input as unknown as HTMLSelectElement);
        if (crop) void this.options.onSetFarmFieldFollowingCrop?.(field.id, crop);
        return;
      }
      return;
    }
    if (this.selectedTarget?.kind !== 'building') return;
    const building = this.selectedTarget.building;

    if (
      isProductionRateBuilding(building.kind)
      && input.matches('[data-production-rate-slider]')
    ) {
      void this.options.onSetBuildingProductionRate?.(
        building.id,
        Number(input.value),
      );
      return;
    }

    if (
      (
        building.kind === 'foragers_shed'
        || building.kind === 'hunters_hall'
        || building.kind === 'fishing_camp'
      )
      && input.matches('[data-harvest-reserve-slider]')
    ) {
      const capacity = Math.max(0, Number(input.dataset.harvestReserveCapacity));
      const reserve = Math.max(0, Number(input.value));
      const reservePercent = capacity > 0
        ? Math.round(reserve / capacity * 100)
        : 0;
      void this.options.onSetHarvestReservePercent?.(building.id, reservePercent);
      return;
    }

    if (building.kind === 'trading_post' && input.matches('[data-trade-surplus-input]')) {
      const row = input.closest<HTMLElement>('[data-trade-rule-row]');
      const rawTargetSurplus = Number(input.value);
      const targetSurplus = Number.isFinite(rawTargetSurplus)
        ? Math.max(0, Math.min(9_999, Math.round(rawTargetSurplus)))
        : 0;
      input.value = String(targetSurplus);
      void this.options.onSetTradingPostTradeRule?.(
        building.id,
        Number(input.dataset.commodityKind),
        Number(row?.dataset.tradeMode ?? 0),
        targetSurplus,
      );
      return;
    }

    if (building.kind === 'town_hall' && input.matches('[data-policy-tax-rate]')) {
      void this.options.onSetEconomicActivityTaxRate?.(building.id, Number(input.value) / 100);
      return;
    }
    if (building.kind === 'town_hall' && input.matches('[data-pantry-safeguard-policy]')) {
      const value = Number(input.value);
      const policy: PantrySafeguardPolicyCode = value === 0 || value === 2 ? value : 1;
      void this.options.onSetPantrySafeguardPolicy?.(building.id, policy);
      return;
    }
    if (building.kind === 'town_hall' && input.matches('[data-policy-seasonal-labor-steward]')) {
      void this.options.onSetSeasonalLaborSteward?.(building.id, input.checked);
      return;
    }
    if (building.kind === 'town_hall' && input.matches('[data-policy-construction-labor-steward]')) {
      void this.options.onSetConstructionLaborSteward?.(building.id, input.checked);
      return;
    }
    if (building.kind === 'town_hall' && input.matches('[data-policy-land-levy], [data-policy-import-duty], [data-policy-export-duty]')) {
      const percent = (selector: string): number => Number(
        this.supplementalPanelSection.querySelector<HTMLInputElement>(selector)?.value ?? 0,
      ) / 100;
      void this.options.onSetFiscalPolicy?.(
        building.id,
        percent('[data-policy-land-levy]'),
        percent('[data-policy-import-duty]'),
        percent('[data-policy-export-duty]'),
      );
      return;
    }
    if (building.kind === 'town_hall' && input.matches('[data-policy-production-labor-steward]')) {
      void this.options.onSetProductionLaborSteward?.(building.id, input.checked);
      return;
    }
    if (building.kind === 'town_hall' && input.matches('[data-policy-labor-steward-reserve]')) {
      void this.options.onSetLaborStewardReserve?.(building.id, Number(input.value));
      return;
    }
    if (building.kind === 'chapel' && input.matches('[data-policy-chapel-sabbath]')) {
      const sabbath = this.supplementalPanelSection.querySelector<HTMLInputElement>('[data-policy-chapel-sabbath]')?.checked ?? false;
      void this.options.onSetChapelParishPolicy?.(sabbath);
      return;
    }
    if (building.kind === 'monastery' && input.matches('[data-policy-monastery-tithe], [data-policy-monastery-feasts]')) {
      const tithe = Number(this.supplementalPanelSection.querySelector<HTMLInputElement>('[data-policy-monastery-tithe]')?.value ?? 30) / 100;
      const feasts = this.supplementalPanelSection.querySelector<HTMLInputElement>('[data-policy-monastery-feasts]')?.checked ?? true;
      void this.options.onSetMonasteryPolicy?.(tithe, feasts);
      return;
    }
    if (building.kind === 'town_hall' && input.matches('[data-policy-monastery-levy]')) {
      void this.options.onSetMonasteryCharter?.(Number(input.value) / 100);
      return;
    }
    if (building.kind === 'monastery' && input.matches('[data-monastery-next-extension]')) {
      void this.options.onSetMonasteryNextExtension?.(building.id, Number(input.value));
      return;
    }
    if (
      building.kind === 'village_storehouse'
      && input.matches(
        '[data-storehouse-accepts-timber], [data-storehouse-accepts-stone], '
        + '[data-storehouse-accepts-firewood], [data-storehouse-accepts-charcoal], '
        + '[data-storehouse-accepts-iron], '
        + '[data-storehouse-accepts-clay], [data-storehouse-accepts-salt]',
      )
    ) {
      const timber = this.supplementalPanelSection.querySelector<HTMLInputElement>('[data-storehouse-accepts-timber]')?.checked ?? false;
      const stone = this.supplementalPanelSection.querySelector<HTMLInputElement>('[data-storehouse-accepts-stone]')?.checked ?? false;
      const firewood = this.supplementalPanelSection.querySelector<HTMLInputElement>('[data-storehouse-accepts-firewood]')?.checked ?? false;
      const charcoal = this.supplementalPanelSection.querySelector<HTMLInputElement>('[data-storehouse-accepts-charcoal]')?.checked ?? true;
      const iron = this.supplementalPanelSection.querySelector<HTMLInputElement>('[data-storehouse-accepts-iron]')?.checked ?? true;
      const clay = this.supplementalPanelSection.querySelector<HTMLInputElement>('[data-storehouse-accepts-clay]')?.checked ?? true;
      const salt = this.supplementalPanelSection.querySelector<HTMLInputElement>('[data-storehouse-accepts-salt]')?.checked ?? true;
      void this.options.onSetStorehousePolicy?.(
        building.id,
        timber,
        stone,
        firewood,
        charcoal,
        iron,
        clay,
        salt,
      );
      return;
    }
  };

  private readonly onSupplementalKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Enter') return;
    const input = event.target as HTMLInputElement;
    if (!input.matches('[data-trade-surplus-input]')) return;
    event.preventDefault();
    input.dispatchEvent(new Event('change', { bubbles: true }));
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
    surplusTotals: ResourceTotals,
    storedTotals: ResourceTotals,
    population: PopulationStats,
    starterCampCreated: boolean,
    inTransit?: ResourceTotals,
    goldAwaitingCollection = 0,
    guardhousePayrollGold = 0,
  ): void {
    this.populationStats = population;
    this.surplusTotals = surplusTotals;
    this.storedTotals = storedTotals;
    this.inTransitTotals = inTransit;
    this.goldAwaitingCollection = goldAwaitingCollection;
    this.guardhousePayrollGold = guardhousePayrollGold;
    this.renderHudResourceTotals();
    const displayedPopulation = starterCampCreated ? population.total : 0;
    const displayedOpenLivingPlaces = starterCampCreated ? population.vacant : 0;
    const displayedLabor = starterCampCreated ? population.available : 0;
    this.populationValue.textContent = displayedPopulation.toString();
    this.housingValue.textContent = displayedOpenLivingPlaces.toString();
    this.laborValue.textContent = displayedLabor.toString();
    this.setHudTooltipAmount(this.populationValue, displayedPopulation, 'Current population');
    this.setHudTooltipAmount(
      this.housingValue,
      displayedOpenLivingPlaces,
      'Open living places',
    );
    this.setHudTooltipAmount(this.laborValue, displayedLabor, 'Workers available');
    const laborSub = this.stockpileRoot.querySelector<HTMLElement>('[data-stockpile="labor-sub"]');
    if (laborSub) {
      laborSub.textContent = starterCampCreated && population.assigned > 0
        ? `${population.assigned} in workplaces`
        : 'reserve';
    }
  }

  private renderHudResourceTotals(): void {
    const totals = this.resourceTotalsPresentation === 'total'
      ? this.storedTotals
      : this.surplusTotals;
    if (!totals) return;

    for (const resource of HUD_RESOURCE_KINDS) {
      this.stockpileValues[resource].textContent = Math.round(totals[resource]).toString();
    }
    for (const resource of HUD_RESOURCE_CARD_KINDS) {
      this.resourceCardAmounts[resource].textContent = Math.round(totals[resource]).toString();
    }
    this.fuelFirewoodAmount.textContent = Math.round(totals.firewood).toString();
    const amountLabel = this.resourceTotalsPresentation === 'total'
      ? 'Total stored'
      : 'Available surplus';
    for (const resource of HUD_RESOURCE_KINDS) {
      this.setHudTooltipAmount(this.stockpileValues[resource], totals[resource], amountLabel);
    }
    this.renderFoodBreakdown();
    for (const resource of HUD_RESOURCE_KINDS) {
      const transit = this.stockpileTransitValues[resource];
      const amount = Math.max(0, this.inTransitTotals?.[resource] ?? 0);
      const details = [];
      if (resource === 'gold' && this.goldAwaitingCollection > 1e-6) {
        details.push(`+${formatTransitAmount(this.goldAwaitingCollection)} awaiting collection`);
      }
      if (resource === 'gold' && this.guardhousePayrollGold > 1e-6) {
        details.push(`${formatTransitAmount(this.guardhousePayrollGold)} in company pay chests`);
      }
      if (amount > 1e-6) {
        details.push(`+${formatTransitAmount(amount)} en route`);
      }
      const resourceCardTransitRow = transit.closest<HTMLElement>(
        '[data-resource-card-transit-row]',
      );
      if (resourceCardTransitRow) {
        resourceCardTransitRow.hidden = details.length === 0;
        transit.hidden = false;
      } else {
        transit.hidden = details.length === 0;
      }
      const stat = this.stockpileValues[resource]
        .closest<HTMLElement>('.settlement-hud__stat');
      stat?.classList.toggle(
        'is-empty',
        totals[resource] <= 1e-6 && details.length === 0,
      );
      transit.textContent = details.join(' · ');
    }
    const stockedSpecialties = SPECIALTY_HUD_RESOURCE_KINDS.filter((resource) =>
      totals[resource] > 1e-6 || (this.inTransitTotals?.[resource] ?? 0) > 1e-6);
    const specialtyStore = this.stockpileRoot.querySelector<HTMLElement>(
      '[data-specialty-stores]',
    );
    const specialtyStoreStatus = this.stockpileRoot.querySelector<HTMLElement>(
      '[data-specialty-stores-status]',
    );
    const specialtyStoreSummary = specialtyStore?.querySelector<HTMLElement>(
      '.settlement-hud__stores-summary',
    );
    specialtyStore?.classList.toggle('has-stock', stockedSpecialties.length > 0);
    if (specialtyStoreStatus) {
      specialtyStoreStatus.textContent = stockedSpecialties.length.toString();
    }
    if (specialtyStoreSummary) {
      const storeDescription = stockedSpecialties.length === 0
        ? 'No specialty stock'
        : `${stockedSpecialties.length} ${stockedSpecialties.length === 1 ? 'stock' : 'stocks'} active`;
      delete specialtyStoreSummary.dataset.tooltipTitle;
      delete specialtyStoreSummary.dataset.tooltip;
      specialtyStoreSummary.setAttribute('aria-label', `Stores and provisions, ${storeDescription.toLowerCase()}`);
    }
    const stockedMilitary = [...MILITARY_HUD_RESOURCE_KINDS].filter((resource) =>
      totals[resource] > 1e-6 || (this.inTransitTotals?.[resource] ?? 0) > 1e-6);
    const militaryStore = this.stockpileRoot.querySelector<HTMLElement>('[data-military-stores]');
    const militaryStoreStatus = this.stockpileRoot.querySelector<HTMLElement>('[data-military-stores-status]');
    const militaryStoreSummary = militaryStore?.querySelector<HTMLElement>('.settlement-hud__stores-summary');
    militaryStore?.classList.toggle('has-stock', stockedMilitary.length > 0);
    if (militaryStoreStatus) {
      militaryStoreStatus.textContent = Math.round(
        [...MILITARY_HUD_RESOURCE_KINDS].reduce((sum, resource) => sum + totals[resource], 0),
      ).toString();
    }
    const spearKits = Math.floor(Math.min(totals.polearms, totals.shields, totals.paddedArmor));
    const footKits = Math.floor(Math.min(totals.sidearms, totals.shields, totals.paddedArmor));
    const rangedKits = Math.floor(Math.min(totals.bows + totals.crossbows, totals.ammunition));
    const bottleneck = [
      ['polearms', totals.polearms],
      ['sidearms', totals.sidearms],
      ['shields', totals.shields],
      ['padded armor', totals.paddedArmor],
      ['mail armor', totals.mailArmor],
      ['bows/crossbows', totals.bows + totals.crossbows],
      ['ammunition', totals.ammunition],
    ] as const;
    const bottleneckLabel = bottleneck.reduce((least, candidate) =>
      candidate[1] < least[1] ? candidate : least)[0];
    this.militaryKitReadiness.textContent = `Spear ${spearKits} · foot ${footKits} · ranged ${rangedKits} · bottleneck: ${bottleneckLabel}`;
    militaryStoreSummary?.setAttribute(
      'aria-label',
      `Military stores, ${stockedMilitary.length} stocked categories. ${this.militaryKitReadiness.textContent}`,
    );
  }

  private renderFoodBreakdown(): void {
    if (!this.storedTotals || !this.surplusTotals) return;
    const showingTotal = this.resourceTotalsPresentation === 'total';
    const amountLabel = showingTotal ? 'Total stored' : 'Available surplus';
    for (const kind of FOOD_BREAKDOWN_ROW_KINDS) {
      const stored = Math.max(0, this.storedTotals[kind]);
      const transit = Math.max(0, this.inTransitTotals?.[kind] ?? 0);
      const surplus = Math.max(0, this.surplusTotals[kind]);
      const displayed = showingTotal ? stored : surplus;
      const homes = Math.max(0, stored - surplus);
      const elements = this.foodBreakdownRows[kind];
      const stocked = stored + transit > 1e-6;
      const namedFood = (FOOD_RESOURCE_KINDS as readonly string[]).includes(kind);
      const visible = namedFood || stocked;
      const inventoryKind = (kind === 'legacyPreservedFood'
          ? 'preservedFood'
          : kind) as FoodInventoryKind;
      elements.row.hidden = !visible;
      elements.row.classList.toggle('is-empty', !stocked);
      elements.stored.textContent = formatTransitAmount(displayed);
      elements.row.dataset.tooltipAmount = formatTransitAmount(displayed);
      elements.row.dataset.tooltipAmountLabel = amountLabel;
      elements.row.dataset.tooltip = foodSpoilageLabel(inventoryKind);
      elements.transit.hidden = transit <= 1e-6;
      elements.transit.textContent = transit > 1e-6
        ? `+${formatTransitAmount(transit)} cart`
        : '';
      elements.homes.textContent = formatTransitAmount(homes);
      elements.surplus.textContent = formatTransitAmount(surplus);
    }
    const stored = Math.max(0, this.storedTotals.food);
    const transit = Math.max(0, this.inTransitTotals?.food ?? 0);
    const surplus = Math.max(0, this.surplusTotals.food);
    this.foodBreakdownEmpty.hidden = true;
    this.foodBreakdownTotalStored.textContent = formatTransitAmount(stored);
    this.foodBreakdownTotalTransit.textContent = formatTransitAmount(transit);
    this.foodBreakdownTotalHomes.textContent = formatTransitAmount(
      Math.max(0, stored - surplus),
    );
    this.foodBreakdownTotalSurplus.textContent = formatTransitAmount(surplus);
  }

  private setHudTooltipAmount(
    valueElement: HTMLElement,
    amount: number,
    label: string,
  ): void {
    const stat = valueElement.closest<HTMLElement>('.settlement-hud__stat');
    if (!stat) return;
    if (!stat.dataset.tooltip?.trim() || stat.matches('[data-fuel-resource]')) {
      delete stat.dataset.tooltipAmount;
      delete stat.dataset.tooltipAmountLabel;
      return;
    }
    stat.dataset.tooltipAmount = formatTransitAmount(Math.max(0, amount));
    stat.dataset.tooltipAmountLabel = label;
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

  selectMilitaryCompany(companyId: string): void {
    const company = [...(this.options.getMilitaryCompanies?.() ?? [])]
      .find((candidate) => candidate.id === companyId);
    if (!company) return;
    this.serviceCoverageTabPreviewBuildingId = null;
    this.clearServiceCoverage();
    this.serviceCoverageProjection = null;
    this.selectedTarget = null;
    this.selectedMilitaryCompanyId = company.id;
    this.marker.visible = false;
    this.renderMilitaryCompany(company);
    this.panel.hidden = false;
    this.options.onSelectionChange?.(null);
  }

  /** Moves keyboard focus into an inspector opened by an external HUD link. */
  focusPanel(): void {
    if (this.panel.hidden) return;
    this.closeButton.focus({ preventScroll: true });
  }

  /** Reveals the last-minute retainer action after a leaving company is
   * selected in the world, without forcing the camera away from its march. */
  focusMercenaryContract(companyId: string): void {
    const button = [...this.supplementalPanelSection.querySelectorAll<HTMLButtonElement>(
      '[data-renew-mercenary-contract]',
    )].find((candidate) => candidate.dataset.renewMercenaryContract === companyId);
    if (!button) {
      this.focusPanel();
      return;
    }
    button.scrollIntoView({ block: 'nearest' });
    button.focus({ preventScroll: true });
  }

  selectResidence(residenceId: string): void {
    const target = this.options.worldQueries.findResidenceTarget(residenceId);
    if (!target) return;
    this.selectTarget(target);
  }

  refreshSelection(): void {
    if (this.selectedMilitaryCompanyId) {
      const company = [...(this.options.getMilitaryCompanies?.() ?? [])]
        .find((candidate) => candidate.id === this.selectedMilitaryCompanyId);
      if (!company) {
        this.clearSelection(false);
        return;
      }
      this.renderMilitaryCompany(company);
      return;
    }
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
    if (this.selectedTarget.kind === 'graveyard' && latest.kind === 'graveyard' && latest.graveyard.id === this.selectedTarget.graveyard.id) {
      this.selectedTarget = latest;
      this.renderTarget(latest);
      return;
    }
    this.clearSelection(false);
  }

  dispose(): void {
    this.clearServiceCoverage();
    this.hoverOutline.dispose();
    this.deleteDialog.dispose();
    this.options.domElement.removeEventListener('mousedown', this.onPointerDown, { capture: true });
    this.demolishButton.removeEventListener('click', this.onDemolishPrimaryClick);
    this.demolishSecondaryButton.removeEventListener('click', this.onDemolishSecondaryClick);
    this.panel.removeEventListener('click', this.onPanelClick);
    this.supplementalPanelSection.removeEventListener('input', this.onSupplementalInput);
    this.supplementalPanelSection.removeEventListener('change', this.onSupplementalChange);
    this.supplementalPanelSection.removeEventListener('keydown', this.onSupplementalKeyDown);
    this.laborDecrease.removeEventListener('click', this.onLaborDecrease);
    this.laborIncrease.removeEventListener('click', this.onLaborIncrease);
    this.serviceCoverageButton.removeEventListener(
      'click',
      this.onServiceCoverageToggle,
    );
    window.removeEventListener('keydown', this.onWindowKeyDown);
    window.removeEventListener('keyup', this.onWindowKeyUp);
    window.removeEventListener('blur', this.onWindowBlur);
    this.closeButton.removeEventListener('click', this.onCloseClick);
    this.resourceTotalsModeButton.removeEventListener(
      'click',
      this.onResourceTotalsModeToggle,
    );
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
    if (
      this.serviceCoverageBuildingId
      && (
        target.kind !== 'building'
        || target.building.id !== this.serviceCoverageBuildingId
      )
    ) {
      this.serviceCoverageTabPreviewBuildingId = null;
      this.clearServiceCoverage();
    }
    this.selectedMilitaryCompanyId = null;
    this.selectedTarget = target;
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
    } else if (target.kind === 'graveyard') {
      const center = target.graveyard.corners.reduce((sum, point) => ({ x: sum.x + point.x / 4, z: sum.z + point.z / 4 }), { x: 0, z: 0 });
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
    this.options.onTargetSelected?.(target);
  }

  clearSelection(hidePanel = true): void {
    this.serviceCoverageTabPreviewBuildingId = null;
    this.clearServiceCoverage();
    this.serviceCoverageProjection = null;
    this.selectedTarget = null;
    this.selectedMilitaryCompanyId = null;
    this.marker.visible = false;
    this.demolishSection.hidden = true;
    this.primaryActionSection.hidden = true;
    this.primaryActionSection.innerHTML = '';
    this.laborSection.hidden = true;
    this.oxTeamSection.hidden = true;
    this.supplementalPanelSection.hidden = true;
    this.serviceCoverageButton.hidden = true;
    if (hidePanel) this.panel.hidden = true;
    this.options.onSelectionChange?.(null);
  }

  private renderTarget(target: InspectableTarget): void {
    const identity = inspectableIdentity(target);
    const preservePolicyState = this.renderedIdentity === identity;
    const tradingPostScrollTop = preservePolicyState
      ? this.supplementalPanelSection
          .querySelector<HTMLElement>('[data-trading-post-scroll]')?.scrollTop ?? 0
      : 0;
    const militiaSizeDraft = preservePolicyState
      ? this.supplementalPanelSection
          .querySelector<HTMLSelectElement>('[data-militia-size]')?.value ?? null
      : null;
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
    const productionEnvironment = needsProductionForecast
      ? environmentFor(
          gameState.seed,
          this.options.getWorldHydrology?.() ?? 50,
          gameClock(gameState.tick),
          this.options.getSevereWeatherEnabled?.() ?? false,
        )
      : null;
    const productionRouteTargets = needsProductionForecast
      ? [...gameState.buildings.values()]
      : [];
    const productionRouteDistances = new Map<string, Map<string, number | null>>();
    const productionToolRouteDistance = (
      source: { id: string; x: number; z: number },
      destination: { id: string; x: number; z: number },
    ): number | null => {
      let distances = productionRouteDistances.get(source.id);
      if (!distances) {
        const values = this.options.worldQueries.getLocalDeliveryDistancesFrom(
          source,
          productionRouteTargets,
        );
        distances = new Map(
          productionRouteTargets.map((candidate, index) => [
            candidate.id,
            values[index] ?? null,
          ]),
        );
        productionRouteDistances.set(source.id, distances);
      }
      return distances.get(destination.id) ?? null;
    };
    const settlementProduction = needsProductionForecast
      ? computeSettlementProductionCapacity(
          gameState,
          sabbathObserved,
          (building) => this.options.worldQueries.getRoadComponentId(
            building.x,
            building.z,
          ),
          productionEnvironment?.watermillThroughputMultiplier ?? 1,
          productionEnvironment?.surfaceClayThroughputMultiplier ?? 1,
          productionEnvironment?.preservedFoodDemandMultiplier ?? 1,
          gameClock(gameState.tick).month,
          this.options.getWorldResourceAbundance?.() ?? 50,
          productionEnvironment?.charcoalBurnerThroughputMultiplier ?? 1,
          productionToolRouteDistance,
          this.options.worldQueries.getRoadConditionSpeedMultiplier(),
          windWeatherThroughputMultiplier(productionEnvironment?.weather ?? 'fair'),
        )
      : undefined;
    const targetSettlementId = target.kind === 'building'
      ? target.building.settlementId
      : target.kind === 'residence' || target.kind === 'backyard'
        ? target.residence.settlementId
        : target.kind === 'farm-field' || target.kind === 'pasture'
          ? target.farmstead?.settlementId
          : target.kind === 'graveyard'
            ? target.chapel?.settlementId
          : undefined;
    const getEconomicActivityTaxRate = this.options.getEconomicActivityTaxRate;
    const getPantrySafeguardPolicy = this.options.getPantrySafeguardPolicy;
    const getSeasonalLaborStewardEnabled = this.options.getSeasonalLaborStewardEnabled;
    const getConstructionLaborStewardEnabled = this.options.getConstructionLaborStewardEnabled;
    const getFiscalPolicy = this.options.getFiscalPolicy;
    const getProductionLaborStewardEnabled = this.options.getProductionLaborStewardEnabled;
    const getLaborStewardReserve = this.options.getLaborStewardReserve;
    const landUseProfile = computeLandUseProfile(
      this.options.sceneManager.worldLayout.settings,
      {
        buildings: gameState.buildings.values(),
        residences: gameState.residences.values(),
        farmFields: gameState.farmFields.values(),
        pastures: gameState.pastures.values(),
        vineyardParcels: gameState.vineyardParcels?.values() ?? [],
      },
    );
    const view = renderInspectableTarget(target, {
      gameState,
      landUseProfile,
      worldQueries: this.options.worldQueries,
      populationStats: this.populationStats,
      resourceTotals,
      worldHydrology: this.options.getWorldHydrology?.() ?? 50,
      severeWeatherEnabled: this.options.getSevereWeatherEnabled?.() ?? false,
      wellAquiferNetworksEnabled: this.options.getWellAquiferNetworksEnabled?.() ?? false,
      worldResourceAbundance: this.options.getWorldResourceAbundance?.() ?? 50,
      conflictEnabled: this.options.getConflictEnabled?.() ?? false,
      enemyPressure: this.options.getEnemyPressure?.() ?? 0,
      pendingTreeWorkAreaBuildingId:
        this.options.getPendingTreeWorkAreaBuildingId?.() ?? null,
      ...(settlementProduction ? { settlementProduction } : {}),
      ...(getEconomicActivityTaxRate
        ? { getEconomicActivityTaxRate: () => getEconomicActivityTaxRate(targetSettlementId) }
        : {}),
      ...(getPantrySafeguardPolicy
        ? { getPantrySafeguardPolicy: () => getPantrySafeguardPolicy(targetSettlementId) }
        : {}),
      ...(getSeasonalLaborStewardEnabled
        ? { getSeasonalLaborStewardEnabled: () => getSeasonalLaborStewardEnabled(targetSettlementId) }
        : {}),
      ...(getConstructionLaborStewardEnabled
        ? { getConstructionLaborStewardEnabled: () => getConstructionLaborStewardEnabled(targetSettlementId) }
        : {}),
      ...(getFiscalPolicy
        ? { getFiscalPolicy: () => getFiscalPolicy(targetSettlementId) }
        : {}),
      ...(getProductionLaborStewardEnabled
        ? { getProductionLaborStewardEnabled: () => getProductionLaborStewardEnabled(targetSettlementId) }
        : {}),
      ...(getLaborStewardReserve
        ? { getLaborStewardReserve: () => getLaborStewardReserve(targetSettlementId) }
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
      ...(this.options.getCombatAgents
        ? { combatAgents: this.options.getCombatAgents() }
        : {}),
      ...(this.options.getMilitaryCompanies
        ? { militaryCompanies: this.options.getMilitaryCompanies() }
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
          ? 'A nearby well is coordinating the available bucket carriers'
          : 'No stocked well and free hauler can currently answer this fire'
        : fire.status === 'destroyed'
          ? 'Fire out; the surviving foundations can be rebuilt'
          : 'Fire suppressed; structural repairs are required';
      const carpenterSupported = this.options.worldQueries.hasCarpenterSupportAt(
        { x: fire.x, z: fire.z },
      );
      const scriptoriumRecoveryMultiplier = this.options.worldQueries
        .getScriptoriumRecoveryMultiplierAt({ x: fire.x, z: fire.z });
      const recovery = target.kind === 'building'
        ? buildingFireRecoveryQuote(
            target.building,
            fire,
            carpenterSupported,
            scriptoriumRecoveryMultiplier,
          )
        : target.kind === 'residence'
          ? residenceFireRecoveryQuote(
              target.residence,
              fire,
              carpenterSupported,
              scriptoriumRecoveryMultiplier,
            )
          : null;
      const coolingSeconds = fireRecoveryCoolingSeconds(fire, gameState.tick);
      const canAffordRecovery = recovery != null
        && resourceTotals.timber + 1e-6 >= recovery.cost.timber
        && resourceTotals.stone + 1e-6 >= recovery.cost.stone;
      const recoveryLabel = recovery?.kind === 'rebuild' ? 'Rebuild' : 'Repair';
      view.detailsHtml = `
        <li><span>Fire cause</span><strong>${fireSourceLabel(fire.ignitionSource)}</strong></li>
        <li><span>Fire intensity</span><strong>${Math.round(fire.intensity * 100)}%</strong></li>
        <li><span>Structural damage</span><strong>${Math.round(fire.damage * 100)}%</strong></li>
        <li><span>Water delivered</span><strong>${fire.waterDelivered.toFixed(1)} / ${fire.requiredWater.toFixed(1)}</strong></li>
        <li><span>Response</span><strong>${response}</strong></li>
        ${fire.extinguishChance > 0
          ? `<li><span>Last attempt odds</span><strong>${Math.round(fire.extinguishChance * 100)}%</strong></li>`
          : ''}
        ${recovery && !residenceRecoveryActive ? `<li><span>${recovery.kind === 'rebuild' ? 'Rebuild' : 'Repair'} cost</span><strong>${renderBuildingResourceCost(recovery.cost)}${recovery.carpenterSupported ? ' · carpenter-supported' : ''}${recovery.scriptoriumRecoveryMultiplier < 1 ? ` · scriptorium ${Math.round((1 - recovery.scriptoriumRecoveryMultiplier) * 100)}%` : ''}</strong></li>` : ''}
        ${view.detailsHtml}
      `;
      if (!residenceRecoveryActive) {
        view.statusText = target.kind === 'residence'
          ? fire.status === 'burning'
            ? 'Burning · activity suspended'
            : fire.status === 'destroyed'
              ? 'Destroyed · rebuild or demolish'
              : 'Fire out · repair required'
          : fire.status === 'burning'
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
        let recoveryButton = '';
        if (recovery && fire.status !== 'burning') {
          const recoveryBlocked = coolingSeconds > 1e-6 || !canAffordRecovery;
          const recoveryAvailability = coolingSeconds > 1e-6
            ? `Cooling · ${Math.ceil(coolingSeconds)}s`
            : !canAffordRecovery
              ? 'Insufficient resources'
              : '';
          const recoveryDetail = [
            recoveryAvailability,
            recovery.carpenterSupported ? 'Carpenter support' : '',
            recovery.scriptoriumRecoveryMultiplier < 1
              ? `Scriptorium ${Math.round((1 - recovery.scriptoriumRecoveryMultiplier) * 100)}%`
              : '',
            'Existing footprint',
          ].filter(Boolean).join(' · ');
          recoveryButton = `<button type="button" class="resource-action-button resource-action-button--icon" data-fire-recovery
              data-tooltip-title="${recoveryLabel}"
              data-tooltip="${recoveryDetail}"
              ${recoveryBlocked ? 'aria-disabled="true"' : ''}>
              <span class="inspector-action-icon" data-action-icon="fire-recovery" aria-hidden="true"></span><span>${recoveryLabel}${coolingSeconds > 1e-6
                ? ` · ${Math.ceil(coolingSeconds)}s`
                : ` · ${renderBuildingResourceCost(recovery.cost, { compact: true })}`}</span>
            </button>`;
        }
        view.supplementalPanelHtml = target.kind === 'residence'
          ? recoveryButton
          : fire.status === 'burning' || !recovery
            ? `<div class="inspector-action-panel">
                <p class="inspector-action-panel__hint">Keep a staffed, supplied well within work extent. Fire calls preempt routine water deliveries.</p>
              </div>`
            : `<div class="inspector-action-panel">
                <p class="inspector-action-panel__hint">Recovery reuses the existing site and enters the normal material-hauling and builder-work pipeline.</p>
                ${recoveryButton}
                ${recovery.carpenterSupported ? '<p class="inspector-action-panel__hint">A staffed road-linked carpenter reduces the timber requirement by 10%.</p>' : ''}
              </div>`;
      }
    }

    this.eyebrow.textContent = view.eyebrow;
    this.title.textContent = view.title;
    const compactStatus = target.kind === 'building'
      ? compactBuildingStatus(view.statusText)
      : view.statusText;
    this.status.textContent = compactStatus;
    this.status.hidden = compactStatus.length === 0;
    this.status.dataset.state = view.statusState;
    syncFocusableInspectorTooltip(
      this.status,
      view.title,
      compactStatus === view.statusText ? '' : view.statusText,
    );
    this.applyPresentation(target);
    this.syncServiceCoverageButton(target, view.serviceCoverage);
    this.renderDetails(view.detailsHtml);

    const primaryActionHtml = view.primaryActionHtml?.trim() ?? '';
    this.primaryActionSection.hidden = primaryActionHtml.length === 0;
    if (this.primaryActionSection.innerHTML !== primaryActionHtml) {
      this.primaryActionSection.innerHTML = primaryActionHtml;
    }
    this.demolishSection.hidden = !view.demolish.visible && primaryActionHtml.length === 0;
    this.demolishButton.hidden = !view.demolish.visible;
    this.demolishButton.textContent = view.demolish.label ?? 'Demolish';
    this.demolishHint.textContent = view.demolish.hint;
    const compactDemolition = target.kind === 'building'
      || target.kind === 'residence'
      || target.kind === 'backyard'
      || target.kind === 'farm-field'
      || target.kind === 'pasture'
      || target.kind === 'graveyard';
    this.demolishHint.hidden = compactDemolition
      || view.demolish.hint.trim().length === 0;
    syncInspectorTooltip(
      this.demolishButton,
      view.demolish.label ?? 'Demolish',
      compactDemolition ? view.demolish.hint : '',
    );

    const secondary = view.demolish.secondary;
    this.demolishSecondaryButton.hidden = !secondary;
    if (secondary) {
      this.demolishSecondaryButton.textContent = secondary.label;
      this.demolishSecondaryHint.textContent = secondary.hint;
      this.demolishSecondaryHint.hidden = compactDemolition
        || secondary.hint.trim().length === 0;
      syncInspectorTooltip(
        this.demolishSecondaryButton,
        secondary.label,
        compactDemolition ? secondary.hint : '',
      );
    } else {
      this.demolishSecondaryButton.textContent = '';
      this.demolishSecondaryHint.textContent = '';
      this.demolishSecondaryHint.hidden = true;
      syncInspectorTooltip(this.demolishSecondaryButton, '', '');
    }

    this.laborSection.hidden = !view.labor.visible;
    if (view.labor.visible) {
      const laborLabel = view.labor.label ?? 'Workforce';
      this.laborLabel.textContent = target.kind === 'building'
        ? `${laborLabel} · ${target.building.constructionComplete === false
            ? this.populationStats.idle
            : this.populationStats.available} ${target.building.constructionComplete === false ? 'idle' : 'reserve'}`
        : laborLabel;
      this.laborCount.textContent = view.labor.maxCount == null
        ? view.labor.count.toString()
        : `${view.labor.count} / ${view.labor.maxCount}`;
      this.laborHint.textContent = view.labor.hint;
      this.laborHint.hidden = target.kind === 'building' || view.labor.hint.trim().length === 0;
      syncFocusableInspectorTooltip(
        this.laborLabel,
        laborLabel,
        target.kind === 'building' ? view.labor.hint : '',
      );
      this.laborDecrease.disabled = view.labor.decreaseDisabled;
      this.laborIncrease.disabled = view.labor.increaseDisabled;
    } else {
      this.laborHint.hidden = true;
      syncFocusableInspectorTooltip(this.laborLabel, '', '');
    }

    const oxTeam = view.oxTeam;
    this.oxTeamSection.hidden = !oxTeam?.visible;
    if (oxTeam?.visible) {
      this.oxTeamSection.dataset.postedCount = oxTeam.count.toString();
      this.oxTeamSection.dataset.maxCount = oxTeam.maxCount.toString();
      this.oxTeamCount.textContent = `${oxTeam.count} / ${oxTeam.maxCount}`;
      this.oxTeamPool.textContent = `Automatic pool · ${oxTeam.automaticPoolCount}`;
      this.oxTeamHint.textContent = oxTeam.hint;
      this.oxTeamDecrease.disabled = oxTeam.decreaseDisabled;
      this.oxTeamIncrease.disabled = oxTeam.increaseDisabled;
    } else {
      delete this.oxTeamSection.dataset.postedCount;
      delete this.oxTeamSection.dataset.maxCount;
      this.oxTeamCount.textContent = '0 / 0';
      this.oxTeamPool.textContent = 'Automatic pool · 0';
      this.oxTeamHint.textContent = '';
    }

    if (view.supplementalPanelHtml) {
      const supplementalPanelChanged = !preservePolicyState
        || this.renderedSupplementalPanelHtml !== view.supplementalPanelHtml;
      if (supplementalPanelChanged) {
        this.supplementalPanelSection.innerHTML = view.supplementalPanelHtml;
        this.standardizeSupplementalPanels();
        const militiaSizePicker = this.supplementalPanelSection
          .querySelector<HTMLSelectElement>('[data-militia-size]');
        if (militiaSizePicker && militiaSizeDraft) militiaSizePicker.value = militiaSizeDraft;
      }
      const hasSupplementalContent = this.supplementalPanelSection.childElementCount > 0;
      this.supplementalPanelSection.hidden = !hasSupplementalContent;
      if (hasSupplementalContent) {
        const tradingPostScroll = this.supplementalPanelSection
          .querySelector<HTMLElement>('[data-trading-post-scroll]');
        if (tradingPostScroll) tradingPostScroll.scrollTop = tradingPostScrollTop;
      }
    } else {
      this.supplementalPanelSection.hidden = true;
      if (this.renderedSupplementalPanelHtml) {
        this.supplementalPanelSection.innerHTML = '';
      }
    }
    this.renderedSupplementalPanelHtml = view.supplementalPanelHtml ?? '';
    this.renderedIdentity = identity;
  }

  private renderMilitaryCompany(company: MilitaryCompanyState): void {
    const view = renderSelectedMilitaryCompanyInspector(
      company,
      { readOnlyPlaytest: company.id.startsWith('combat-playtest:') },
    );
    this.eyebrow.textContent = view.eyebrow;
    this.title.textContent = view.title;
    this.status.textContent = view.statusText;
    this.status.hidden = view.statusText.length === 0;
    this.status.dataset.state = view.statusState;
    syncFocusableInspectorTooltip(this.status, view.title, '');
    this.panel.dataset.inspectorTarget = 'military-company';
    this.panel.dataset.inspectorKind = 'military';
    this.heroSymbol.textContent = '⚔';
    this.applyHeroImage(view.image);
    this.serviceCoverageButton.hidden = true;
    this.serviceCoverageButton.setAttribute('aria-pressed', 'false');
    this.renderDetails(view.detailsHtml);

    this.primaryActionSection.hidden = true;
    this.primaryActionSection.innerHTML = '';
    this.demolishSection.hidden = true;
    this.demolishButton.hidden = true;
    this.demolishSecondaryButton.hidden = true;
    this.demolishHint.hidden = true;
    this.demolishSecondaryHint.hidden = true;
    this.laborSection.hidden = true;
    this.oxTeamSection.hidden = true;

    if (this.renderedSupplementalPanelHtml !== view.supplementalPanelHtml) {
      this.supplementalPanelSection.innerHTML = view.supplementalPanelHtml;
      this.standardizeSupplementalPanels();
    }
    this.supplementalPanelSection.hidden = view.supplementalPanelHtml.trim().length === 0;
    this.renderedSupplementalPanelHtml = view.supplementalPanelHtml;
    this.renderedIdentity = `military-company:${company.id}`;
  }

  private syncServiceCoverageButton(
    target: InspectableTarget,
    projection: ServiceCoverageView | undefined = this.serviceCoverageProjection ?? undefined,
  ): void {
    const supported = target.kind === 'building'
      && target.building.constructionComplete !== false
      && projection != null
      && target.building.kind === projection.kind;
    this.serviceCoverageProjection = supported ? projection : null;
    this.serviceCoverageButton.hidden = !supported;
    if (
      target.kind !== 'building'
      || target.building.constructionComplete === false
      || !supported
      || !projection
    ) {
      this.serviceCoverageButton.setAttribute('aria-pressed', 'false');
      return;
    }

    const active = this.serviceCoverageBuildingId === target.building.id;
    if (active) this.refreshServiceCoverage(projection);
    const count = active ? this.serviceCoverageResidenceIds.size : 0;
    const service = serviceCoverageLabel(projection.kind);
    const countLabel = `${count} served home${count === 1 ? '' : 's'}`;
    const shortcut = projection.kind === 'marketplace' ? ' Hold Tab to preview.' : '';
    const label = active
      ? `Hide ${service} coverage (${countLabel})`
      : `Show ${service} coverage.${shortcut}`;
    this.serviceCoverageButton.setAttribute('aria-pressed', String(active));
    this.serviceCoverageButton.setAttribute('aria-label', label);
    this.serviceCoverageButton.dataset.tooltip = label;
  }

  private refreshServiceCoverage(
    projection: ServiceCoverageView,
  ): void {
    if (this.serviceCoverageBuildingId == null) return;
    const residenceIds = new Set(projection.residenceIds);
    const marketplaceFulfillment = new Map(projection.marketplaceFulfillment ?? []);
    if (
      setsHaveSameValues(this.serviceCoverageResidenceIds, residenceIds)
      && mapsHaveSameValues(
        this.serviceCoverageMarketplaceFulfillment,
        marketplaceFulfillment,
      )
    ) return;
    this.serviceCoverageResidenceIds = residenceIds;
    this.serviceCoverageMarketplaceFulfillment = marketplaceFulfillment;
    this.options.onServiceCoverageChange?.(
      residenceIds,
      projection.kind,
      marketplaceFulfillment,
      this.serviceCoverageBuildingId,
    );
  }

  private clearServiceCoverage(): void {
    if (
      this.serviceCoverageBuildingId == null
      && this.serviceCoverageResidenceIds.size === 0
      && this.serviceCoverageMarketplaceFulfillment.size === 0
    ) {
      return;
    }
    this.serviceCoverageBuildingId = null;
    this.serviceCoverageResidenceIds = new Set();
    this.serviceCoverageMarketplaceFulfillment = new Map();
    this.options.onServiceCoverageChange?.(
      this.serviceCoverageResidenceIds,
      null,
      this.serviceCoverageMarketplaceFulfillment,
      null,
    );
  }

  private applyPresentation(target: InspectableTarget): void {
    const presentation = inspectablePresentation(target);
    this.panel.dataset.inspectorTarget = target.kind;
    this.panel.dataset.inspectorKind = presentation.kind;
    this.heroSymbol.textContent = presentation.symbol;
    this.applyHeroImage(presentation.image ?? null);
  }

  private applyHeroImage(source: string | null): void {
    if (source === this.heroImageSource) return;

    this.heroImageSource = source;
    const requestId = ++this.heroImageRequestId;
    this.heroArt.classList.remove('has-art', 'is-art-unavailable');
    this.heroImage.hidden = true;
    this.heroImage.onload = null;
    this.heroImage.onerror = null;
    this.heroImage.removeAttribute('src');

    if (!source) {
      delete this.heroArt.dataset.artState;
      return;
    }

    this.heroArt.dataset.artState = 'loading';
    const isCurrentRequest = () => (
      this.heroImageRequestId === requestId
      && this.heroImageSource === source
      && this.heroImage.getAttribute('src') === source
    );
    const markArtAvailable = () => {
      if (!isCurrentRequest()) return;
      this.heroImage.onload = null;
      this.heroImage.onerror = null;
      this.heroImage.hidden = false;
      this.heroArt.classList.add('has-art');
      this.heroArt.classList.remove('is-art-unavailable');
      this.heroArt.dataset.artState = 'ready';
    };
    const markArtUnavailable = () => {
      if (!isCurrentRequest()) return;
      this.heroImage.onload = null;
      this.heroImage.onerror = null;
      this.heroImage.removeAttribute('src');
      this.heroImage.hidden = true;
      this.heroArt.classList.remove('has-art');
      this.heroArt.classList.add('is-art-unavailable');
      this.heroArt.dataset.artState = 'fallback';
    };
    this.heroImage.onload = markArtAvailable;
    this.heroImage.onerror = markArtUnavailable;
    this.heroImage.src = source;
    void this.heroImage.decode().then(markArtAvailable).catch(markArtUnavailable);
  }

  private renderDetails(detailsHtml: string): void {
    this.detailList.innerHTML = detailsHtml;
    const rows = [...this.detailList.children]
      .filter((element): element is HTMLElement => element instanceof HTMLElement);
    const detailsSection = this.detailList.closest<HTMLElement>('.resource-inspector-details');
    if (detailsSection) detailsSection.hidden = rows.length === 0;
    if (rows.length === 0) return;
    const ranked = rows.map((row, index) => {
      const label = row.firstElementChild?.textContent?.trim() ?? '';
      const value = row.lastElementChild?.textContent?.trim() ?? '';
      decorateInspectorRow(row, label, value);
      return {
        row,
        index,
        label,
        value,
        score: inspectorRowScore(row, label, value, index),
      };
    });
    const residenceSummaryRows = ranked
      .filter(({ row }) => row.hasAttribute('data-residence-summary'))
      .map(({ row }) => row);
    if (
      this.panel.dataset.inspectorTarget === 'residence'
      && residenceSummaryRows.length > 0
    ) {
      this.detailList.replaceChildren(...withInspectorSectionHeadings(residenceSummaryRows));
      return;
    }
    if (this.panel.dataset.inspectorTarget === 'building') {
      const compactRows = ranked
        .filter(({ row }) =>
          row.hasAttribute('data-local-storage')
          || row.hasAttribute('data-fire-safety')
          || row.hasAttribute('data-land-use-affinities')
          || row.hasAttribute('data-construction-summary'))
        .map(({ row }) => row);
      this.detailList.replaceChildren(...withInspectorSectionHeadings(compactRows));
      return;
    }
    const pinnedPrimaryRows = ranked
      .filter(({ row }) => row.hasAttribute('data-inspector-primary'))
      .map(({ row }) => row);
    const pinnedSecondaryRows = new Set(
      ranked
        .filter(({ row }) => row.hasAttribute('data-inspector-secondary'))
        .map(({ row }) => row),
    );
    const primaryLimit = this.panel.dataset.inspectorTarget === 'building' ? 4 : 6;
    const primaryTarget = Math.max(
      pinnedPrimaryRows.length,
      Math.min(primaryLimit, Math.max(3, Math.ceil(rows.length * 0.22))),
    );
    const primaryRows = new Set(pinnedPrimaryRows);
    for (const { row } of [...ranked].sort(
      (a, b) => b.score - a.score || a.index - b.index,
    )) {
      if (primaryRows.size >= primaryTarget) break;
      if (pinnedSecondaryRows.has(row)) continue;
      primaryRows.add(row);
    }
    for (const { row } of ranked) {
      if (
        !pinnedSecondaryRows.has(row)
        && row.querySelector('button, input, select, progress')
      ) {
        primaryRows.add(row);
      }
    }

    const visibleRows = rows.filter((row) => primaryRows.has(row));
    this.detailList.replaceChildren(...withInspectorSectionHeadings(visibleRows));
  }

  private standardizeSupplementalPanels(): void {
    const controlSelector = 'button, input, select, textarea, a[href], [contenteditable="true"]';
    for (const child of [...this.supplementalPanelSection.children]) {
      if (!(child instanceof HTMLElement)) continue;
      if (child.matches('.resource-inspector-note, .inspector-action-panel__hint')) {
        child.remove();
        continue;
      }
      if (child.classList.contains('inspector-action-panel')) continue;
      if (!child.matches(controlSelector) && !child.querySelector(controlSelector)) continue;

      const wrapper = document.createElement('section');
      wrapper.className = 'inspector-action-panel';
      const heading = child.querySelector<HTMLElement>('h2, h3, h4, h5, h6');
      wrapper.dataset.inspectorPanelTitle = heading?.textContent?.trim() || 'Actions';
      child.before(wrapper);
      wrapper.append(child);
    }

    const panels = [...this.supplementalPanelSection.children]
      .filter((element): element is HTMLElement =>
        element instanceof HTMLElement
        && element.classList.contains('inspector-action-panel'));

    for (const panel of panels) {
      const controls = [...panel.querySelectorAll<HTMLElement>(
        controlSelector,
      )].filter((control) => !control.hasAttribute('hidden'));
      const hasStableOxRoster = panel.querySelector('[data-stable-ox-slot]') != null;
      if (controls.length === 0 && !hasStableOxRoster) {
        const guidance = panel.textContent?.trim() ?? '';
        if (guidance && this.status.dataset.state === 'warning') {
          appendFocusableInspectorTooltip(
            this.status,
            this.title.textContent?.trim() || 'Building status',
            guidance,
          );
        }
        panel.remove();
        continue;
      }

      const heading = panel.querySelector<HTMLElement>(
        '.inspector-action-panel__title, h2, h3, h4, h5, h6, .storage-acceptance__heading strong',
      );
      const subgroupNodes = [...panel.querySelectorAll<HTMLElement>(
        ':scope > .inspector-action-panel__hint, :scope > .resource-inspector-note',
      )].filter((node) => node.nextElementSibling?.matches('.resource-action-row'));
      const descriptiveNodes = [...panel.querySelectorAll<HTMLElement>(
        ':scope > .inspector-action-panel__hint, :scope > .resource-inspector-note, .trading-post-ledger__intro',
      )].filter((node) => !subgroupNodes.includes(node));
      const description = [...subgroupNodes, ...descriptiveNodes]
        .map((node) => node.textContent?.trim() ?? '')
        .filter(Boolean)
        .join(' ');
      const selectedControl = panel.querySelector<HTMLElement>(
        'button[aria-pressed="true"], button.is-selected, button:disabled, option:checked',
      );
      const firstControl = controls[0];
      const title = panel.dataset.inspectorPanelTitle?.trim()
        || heading?.textContent?.trim()
        || selectedControl?.textContent?.trim()
        || firstControl?.textContent?.trim()
        || 'Actions';

      const compactTitle = compactInspectorLabel(title);
      panel.dataset.inspectorPanelTitle = compactTitle;
      panel.dataset.inspectorControlCount = String(controls.length);
      panel.dataset.inspectorActionGroup = '';
      panel.classList.add('inspector-action-panel--compact');
      const compactChildren = [...panel.children].filter((child) =>
        child instanceof HTMLElement
        && !child.hasAttribute('hidden')
        && child !== heading
        && !descriptiveNodes.includes(child));
      if (compactChildren.length > 1 && compactChildren.every(
        (child) => child instanceof HTMLButtonElement,
      )) {
        panel.classList.add('inspector-action-panel--button-grid');
      }

      for (const control of controls) {
        if (!(control instanceof HTMLButtonElement)) continue;
        if (control.classList.contains('inspector-action-panel__button')) {
          control.classList.remove('inspector-action-panel__button');
          control.classList.add('resource-action-button');
        }
        if (control.classList.contains('inspector-action-panel__button--icon')) {
          control.classList.remove('inspector-action-panel__button--icon');
          control.classList.add('resource-action-button--icon');
        }
        compactActionTooltip(control);
      }
      for (const tooltipTarget of panel.querySelectorAll<HTMLElement>(
        '[title], [data-tooltip]',
      )) {
        if (tooltipTarget instanceof HTMLButtonElement) continue;
        compactNonButtonTooltip(tooltipTarget);
      }

      heading?.remove();
      for (const node of descriptiveNodes) node.remove();
      for (const node of subgroupNodes) {
        const detail = node.textContent?.trim() ?? '';
        const rowLabel = node.nextElementSibling?.getAttribute('aria-label')?.trim() ?? '';
        const firstClause = detail.split(/\s+[—–]\s+|\s+·\s+|:\s+/u)[0]?.trim() ?? detail;
        const subgroupLabel = compactInspectorLabel(rowLabel || firstClause || 'Options');
        node.className = 'inspector-action-panel__subheading';
        node.textContent = subgroupLabel;
        if (detail && detail !== subgroupLabel) {
          syncFocusableInspectorTooltip(node, subgroupLabel, detail);
        }
      }

      const groupHeading = document.createElement('h3');
      groupHeading.className = 'inspector-action-panel__title';
      groupHeading.textContent = compactTitle;
      if (description) {
        syncFocusableInspectorTooltip(groupHeading, compactTitle, description);
      }
      panel.prepend(groupHeading);
    }

    for (const note of this.supplementalPanelSection.querySelectorAll<HTMLElement>(
      ':scope > .resource-inspector-note, :scope > .inspector-action-panel__hint',
    )) {
      note.remove();
    }
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

function setsHaveSameValues<T>(
  left: ReadonlySet<T>,
  right: ReadonlySet<T>,
): boolean {
  if (left.size !== right.size) return false;
  for (const value of left) {
    if (!right.has(value)) return false;
  }
  return true;
}

function mapsHaveSameValues<K, V>(
  left: ReadonlyMap<K, V>,
  right: ReadonlyMap<K, V>,
): boolean {
  if (left.size !== right.size) return false;
  for (const [key, value] of left) {
    if (right.get(key) !== value) return false;
  }
  return true;
}

function isTextEntryElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.matches('input, textarea, select, [contenteditable="true"]');
}

function formatTransitAmount(amount: number): string {
  return Math.max(0, Math.round(amount)).toLocaleString();
}

type InspectorPresentation = {
  kind: string;
  symbol: string;
  image?: string;
};

function inspectableIdentity(target: InspectableTarget | null): string {
  if (!target) return '';
  switch (target.kind) {
    case 'building': return `building:${target.building.id}`;
    case 'residence': return `residence:${target.residence.id}`;
    case 'backyard': return `backyard:${target.residence.id}`;
    case 'farm-field': return `field:${target.field.id}`;
    case 'pasture': return `pasture:${target.pasture.id}`;
    case 'graveyard': return `graveyard:${target.graveyard.id}`;
    case 'quarry': return `quarry:${target.definition.id}`;
    case 'foraging': return `foraging:${target.definition.id}`;
    case 'river': return `river:${target.x.toFixed(1)}:${target.z.toFixed(1)}`;
  }
}

export function inspectablePresentation(target: InspectableTarget): InspectorPresentation {
  if (target.kind === 'building') {
    const image = BUILDING_CARD_ART[target.building.kind];
    const civic = target.building.kind === 'founders_camp'
      || target.building.kind === 'town_hall'
      || target.building.kind === 'chapel'
      || target.building.kind === 'monastery'
      || target.building.kind === 'stable';
    const agricultural = target.building.kind === 'threshing_barn'
      || target.building.kind === 'pastoral_farmstead'
      || target.building.kind === 'swineherd'
      || target.building.kind === 'apiary';
    const storage = target.building.kind === 'granary'
      || target.building.kind === 'village_storehouse'
      || target.building.kind === 'salvage_pile';
    return {
      kind: civic ? 'civic' : agricultural ? 'agriculture' : storage ? 'storage' : 'building',
      symbol: civic ? '\u269C' : agricultural ? '\u2748' : storage ? '\u25A3' : '\u2692',
      image,
    };
  }
  if (target.kind === 'residence') {
    return {
      kind: 'residence',
      symbol: '\u2302',
      image: '/assets/ui/build-menu/cards/residence.webp',
    };
  }
  if (target.kind === 'backyard') {
    return {
      kind: 'agriculture',
      symbol: '\u2748',
      image: BACKYARD_EXTENSION_CARD_ART,
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
      image: resourceNodeArtUrl(
        target.definition.kind,
        target.definition.resource,
        target.state.isRich === true,
      ),
    };
  }
  if (target.kind === 'graveyard') {
    return {
      kind: 'civic',
      symbol: '\u271D',
      image: '/assets/ui/build-menu/cards/burial-ground.webp',
    };
  }
  if (target.kind === 'foraging') {
    return {
      kind: 'resource',
      symbol: '\u2767',
      image: resourceNodeArtUrl(
        target.definition.kind,
        target.definition.resource,
        target.state.isRich === true,
      ),
    };
  }
  return {
    kind: 'water',
    symbol: '\u224B',
    image: '/assets/ui/build-menu/cards/fishing-camp.webp',
  };
}

function compactBuildingStatus(status: string): string {
  const normalized = status.trim();
  if (normalized.length <= 72) return normalized;
  const firstSentence = normalized.split(/(?<=[.!?])\s+/u)[0]?.trim() ?? normalized;
  if (firstSentence.length <= 72) return firstSentence.replace(/[.!?]+$/u, '');
  const firstClause = firstSentence.split(/\s+[—–]\s+|\s+·\s+/u)[0]?.trim() ?? firstSentence;
  if (firstClause.length <= 72) return firstClause;
  return `${firstClause.slice(0, 69).trimEnd()}…`;
}

function syncInspectorTooltip(
  element: HTMLElement,
  title: string,
  detail: string,
): void {
  const normalizedDetail = compactInspectorDetail(detail);
  if (!normalizedDetail) {
    delete element.dataset.tooltipTitle;
    delete element.dataset.tooltip;
    return;
  }
  element.dataset.tooltipTitle = title.trim() || 'Details';
  element.dataset.tooltip = normalizedDetail;
}

function syncFocusableInspectorTooltip(
  element: HTMLElement,
  title: string,
  detail: string,
): void {
  const normalizedDetail = compactInspectorDetail(detail);
  syncInspectorTooltip(element, title, normalizedDetail);
  if (!normalizedDetail) {
    element.removeAttribute('tabindex');
    element.removeAttribute('aria-label');
    return;
  }
  const visibleText = element.textContent?.trim() ?? '';
  element.tabIndex = 0;
  element.setAttribute(
    'aria-label',
    `${title.trim() || 'Details'}${visibleText ? `: ${visibleText}` : ''}. ${normalizedDetail}`,
  );
}

function compactActionTooltip(button: HTMLButtonElement): void {
  const nativeTitle = button.getAttribute('title')?.trim() ?? '';
  const detail = button.dataset.tooltip?.trim() || nativeTitle;
  button.removeAttribute('title');
  if (!detail) return;
  syncInspectorTooltip(
    button,
    compactInspectorLabel(
      button.dataset.tooltipTitle?.trim() || button.textContent?.trim() || 'Action',
    ),
    detail,
  );
}

function compactNonButtonTooltip(element: HTMLElement): void {
  const nativeTitle = element.getAttribute('title')?.trim() ?? '';
  const detail = compactInspectorDetail(element.dataset.tooltip?.trim() || nativeTitle);
  if (!detail) {
    element.removeAttribute('title');
    return;
  }
  const title = compactInspectorLabel(
    element.dataset.tooltipTitle?.trim()
      || element.getAttribute('aria-label')?.trim()
      || element.textContent?.trim()
      || 'Details',
  );
  if (element instanceof HTMLOptionElement) {
    element.title = detail;
    return;
  }
  if (element.classList.contains('resource-cost__item') && nativeTitle) {
    const visibleAmount = element
      .querySelector<HTMLElement>('.resource-cost__value')
      ?.textContent
      ?.trim() ?? '';
    element.removeAttribute('title');
    delete element.dataset.tooltipTitle;
    element.dataset.tooltip = compactInspectorDetail(
      [visibleAmount, nativeTitle].filter(Boolean).join(' '),
    );
    return;
  }
  element.removeAttribute('title');
  syncInspectorTooltip(element, title, detail);
}

function compactInspectorLabel(label: string): string {
  const normalized = label.replace(/\s+/gu, ' ').trim();
  if (normalized.length <= 48) return normalized;
  return `${normalized.slice(0, 45).trimEnd()}…`;
}

function compactInspectorDetail(detail: string): string {
  const normalized = detail.replace(/\s+/gu, ' ').trim();
  if (normalized.length <= INSPECTOR_TOOLTIP_MAX_LENGTH) return normalized;
  const firstSentence = normalized.split(/(?<=[.!?])\s+/u)[0]?.trim() ?? normalized;
  if (firstSentence.length <= INSPECTOR_TOOLTIP_MAX_LENGTH) return firstSentence;
  const firstClause = firstSentence.split(/\s+[—–]\s+|\s+·\s+|;\s+/u)[0]?.trim() ?? firstSentence;
  if (firstClause.length <= INSPECTOR_TOOLTIP_MAX_LENGTH) return firstClause;
  return `${firstClause.slice(0, INSPECTOR_TOOLTIP_MAX_LENGTH - 1).trimEnd()}…`;
}

function appendFocusableInspectorTooltip(
  element: HTMLElement,
  title: string,
  detail: string,
): void {
  const combinedDetail = [element.dataset.tooltip?.trim() ?? '', detail.trim()]
    .filter(Boolean)
    .join(' ');
  syncFocusableInspectorTooltip(
    element,
    element.dataset.tooltipTitle?.trim() || title,
    combinedDetail,
  );
}

function decorateInspectorRow(row: HTMLElement, label: string, value: string): void {
  if (row.hasAttribute('data-inspector-resource-strip')) {
    row.classList.add('inspector-resource-strip-row');
    return;
  }
  const normalized = `${label} ${value}`.toLowerCase();
  const state = inspectorDetailState(label, value, row.dataset.inspectorState);
  const labelElement = row.firstElementChild;
  const valueElement = row.lastElementChild;
  labelElement?.classList.add('inspector-detail-label');
  valueElement?.classList.add('inspector-detail-value');
  const icon = document.createElement('span');
  icon.className = 'inspector-row-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = inspectorDetailIcon(normalized, state);
  row.prepend(icon);
  const detail = row.dataset.inspectorDetail?.trim();
  if (detail) {
    const compactDetail = compactInspectorDetail(detail);
    row.removeAttribute('title');
    row.dataset.tooltipTitle = label;
    row.dataset.tooltip = compactDetail;
    row.setAttribute('aria-label', `${label}: ${value}. ${compactDetail}`);
  } else if (row.dataset.tooltip) {
    syncInspectorTooltip(row, row.dataset.tooltipTitle?.trim() || label, row.dataset.tooltip);
  }
  if (state) {
    row.dataset.state = state;
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

function withInspectorSectionHeadings(rows: readonly HTMLElement[]): HTMLElement[] {
  const children: HTMLElement[] = [];
  let previousSection = '';
  for (const row of rows) {
    const section = row.dataset.inspectorSection?.trim() ?? '';
    if (section && section !== previousSection) {
      const heading = document.createElement('li');
      heading.className = 'inspector-detail-section';
      heading.setAttribute('role', 'presentation');
      const label = document.createElement('span');
      label.textContent = section;
      heading.append(label);
      children.push(heading);
    }
    children.push(row);
    previousSection = section;
  }
  return children;
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
  if (
    (row.dataset.state === 'warning' || row.dataset.state === 'danger')
    && /(\bfire\b|burn|destroy|danger|critical|blocked|short|starv|damage|expos|unserved)/.test(normalized)
  ) score += 30;
  if (/(status|progress|assigned|workforce|population|household|resident|active cart|crop|yield|output|input|condition|priority|coverage|readiness|runway)/.test(normalizedLabel)) score += 16;
  if (/(current|available|vacant|capacity|service|production|health|security|threat)/.test(normalizedLabel)) score += 10;
  const ratio = normalizedValue.match(/(-?\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/);
  if (ratio) score += Number(ratio[1]) > 0 ? 10 : -8;
  if (/\d+(?:\.\d+)?\s*%/.test(normalizedValue)) score += 6;
  if (/(stored|storage|stock)/.test(normalizedLabel)) score += 3;
  if (/(role|purpose|rule|lifecycle|clearance|permanent storage|construction supply|placement|final clearance)/.test(normalizedLabel)) score -= 32;
  if (value.length <= 32) score += 6;
  else if (value.length > 80) score -= 32;
  else if (value.length > 52) score -= 14;
  if (index > 12) score -= 2;
  return score;
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
