import type { SettlementSchedule } from '../world/settlementSchedule.ts';
import {
  formatCalendarDate,
  formatClockTime,
  formatWeekday,
  gameClock,
} from '../world/gameCalendar.ts';
import type {
  EnvironmentState,
  NextDayEnvironmentOutlook,
} from '../world/seasonPolicy.ts';
import {
  describeEnvironment,
  describeNextDayEnvironmentOutlook,
} from '../world/seasonPolicy.ts';
import {
  GAME_SPEEDS,
  PLAYER_GAME_SPEEDS,
  gameSpeedLabel,
  hotkeyForGameSpeed,
  type GameSpeed,
} from '../world/gameSpeed.ts';
import type { FireIncidentState } from '../fires/fireIncident.ts';
import type { DeliveryTripState } from '../logistics/deliveryTrips.ts';
import {
  formatFrontierForecast,
  formatFrontierRaidTiming,
  formatRaidReport,
  frontierThreatLabel,
  type SettlementSecurityState,
} from '../security/frontierSecurity.ts';
import {
  formatHouseholdBufferReadiness,
  formatProvisionDays,
  formatProvisionRunway,
  formatSabbathReadiness,
  HOUSEHOLD_BUFFER_WARNING_COVERAGE,
  PROVISION_CRITICAL_DAYS,
  settlementProvisionLevel,
  shouldShowProvisioning,
  WINTER_RESERVE_DAYS,
  type SettlementProvisioning,
} from '../economy/settlementProvisioning.ts';
import { formatFreshFoodLoss } from '../economy/foodPreservation.ts';
import type { AuthoritativeWorldGeneration } from '../world/worldConfigAuthority.ts';

const SETTLEMENT_HUD_HTML = `
  <div class="settlement-hud" data-settlement-hud data-fps-panel aria-label="Settlement overview" aria-live="polite">
    <div class="settlement-hud__clock" data-settlement-clock>
      <span class="settlement-hud__clock-date" data-clock-date>Year 1</span>
      <span class="settlement-hud__clock-time" data-clock-time>08:00</span>
      <span class="settlement-hud__clock-detail" data-clock-detail></span>
      <span class="settlement-hud__season" data-season-status></span>
      <div class="settlement-hud__fire-alert" data-fire-alert hidden>
        <strong data-fire-count>Fire</strong>
        <span data-fire-response>Awaiting a staffed well</span>
      </div>
      <div class="settlement-hud__security-alert" data-security-alert hidden>
        <strong data-security-label>Frontier watch</strong>
        <span data-security-detail>Awaiting reports</span>
      </div>
      <div class="settlement-hud__provision-alert" data-provision-alert hidden>
        <strong data-provision-label>Winter stores</strong>
        <span data-provision-detail>Awaiting household ledgers</span>
      </div>
      <div class="settlement-hud__speed" role="group" aria-label="Simulation speed">
        ${PLAYER_GAME_SPEEDS.map((speed) => `
          <button
            type="button"
            class="settlement-hud__speed-button"
            data-game-speed="${speed}"
            data-tooltip="${gameSpeedLabel(speed)} · ${speed === 1 ? '60-minute day' : speed === 5 ? '12-minute day' : speed === 20 ? '3-minute day' : '30-second day'} · Key ${hotkeyForGameSpeed(speed)}"
            aria-label="${gameSpeedLabel(speed)} speed"
            aria-keyshortcuts="${hotkeyForGameSpeed(speed)}"
            aria-pressed="${speed === 1}"
          >
            <span class="settlement-hud__speed-name">${gameSpeedLabel(speed)}</span>
            <span class="settlement-hud__speed-value">${speed}×</span>
          </button>
        `).join('')}
      </div>
    </div>
    <div class="settlement-hud__perf">
      <div
        class="settlement-hud__stat settlement-hud__stat--perf"
        tabindex="0"
        data-tooltip="Frames per second. Turns amber below 60 and gold at 85 or higher."
      >
        <span class="settlement-hud__label">FPS</span>
        <strong class="settlement-hud__value settlement-hud__value--fps" data-stat="fps">--</strong>
      </div>
      <div
        class="settlement-hud__stat settlement-hud__stat--perf"
        tabindex="0"
        data-stat-row="zoom"
        data-tooltip="Camera zoom level. Scroll the mouse wheel to zoom in and out on the map."
      >
        <span class="settlement-hud__label">Zoom</span>
        <strong class="settlement-hud__value settlement-hud__value--zoom" data-stat="zoom">100%</strong>
      </div>
    </div>
    <div class="settlement-hud__body">
      <div class="settlement-hud__stat" tabindex="0" data-resource="timber" data-tooltip="Timber in your treasury plus lumber stored at mills and lodges. Building costs spend treasury first, then pull from building storage.">
        <span class="settlement-hud__label">Timber</span>
        <strong class="settlement-hud__value" data-stockpile="timber">0</strong>
      </div>
      <div class="settlement-hud__stat" tabindex="0" data-resource="stone" data-tooltip="Stone in your treasury plus quarry camp storage. Construction spends treasury first, then quarry storage.">
        <span class="settlement-hud__label">Stone</span>
        <strong class="settlement-hud__value" data-stockpile="stone">0</strong>
      </div>
      <div class="settlement-hud__stat" tabindex="0" data-resource="firewood" data-tooltip="Firewood held in treasury, woodcutter lodges, and residence stocks combined.">
        <span class="settlement-hud__label">Firewood</span>
        <strong class="settlement-hud__value" data-stockpile="firewood">0</strong>
      </div>
      <div class="settlement-hud__stat settlement-hud__stat--water" tabindex="0" data-resource="water" data-tooltip="Water in treasury, wells, and residence stocks combined.">
        <span class="settlement-hud__label">Water</span>
        <strong class="settlement-hud__value" data-stockpile="water">0</strong>
      </div>
      <div class="settlement-hud__stat settlement-hud__stat--food" tabindex="0" data-resource="food" data-tooltip="Food in treasury, supplier buildings, and residence stocks combined.">
        <span class="settlement-hud__label">Food</span>
        <strong class="settlement-hud__value" data-stockpile="food">0</strong>
      </div>
      <div class="settlement-hud__stat settlement-hud__stat--gold" tabindex="0" data-resource="gold" data-tooltip="Treasury gold from taxed village economic activity. Select a staffed Town Hall to adjust tax policy.">
        <span class="settlement-hud__label">Gold</span>
        <strong class="settlement-hud__value" data-stockpile="gold">0</strong>
      </div>
      <div class="settlement-hud__stat" tabindex="0" data-resource="population" data-tooltip="Total population: starting townsfolk plus residents who have moved into homes.">
        <span class="settlement-hud__label">Population</span>
        <strong class="settlement-hud__value" data-stockpile="population">0</strong>
      </div>
      <div class="settlement-hud__stat" tabindex="0" data-resource="housing" data-tooltip="Residents housed versus total housing capacity. A first settler establishes an empty home; later arrivals require every need active at that house tier to hold a local buffer. Select a Town Hall for the settlement-wide growth forecast.">
        <span class="settlement-hud__label">Housing</span>
        <strong class="settlement-hud__value" data-stockpile="housing">0/0</strong>
        <span class="settlement-hud__sub" data-stockpile="housing-sub">0 vacant</span>
      </div>
      <div class="settlement-hud__stat" tabindex="0" data-resource="labor" data-tooltip="Workers free to assign. Labor equals population minus workers assigned to buildings or temporarily reserved for freelance cart runs. Select a Town Hall to compare permanent jobs, temporary builders, cart crews, live route load, sector staffing, and the workforce available when current housing fills.">
        <span class="settlement-hud__label">Labor</span>
        <strong class="settlement-hud__value" data-stockpile="labor">0</strong>
        <span class="settlement-hud__sub" data-stockpile="labor-sub">available</span>
      </div>
    </div>
    <div class="settlement-hud__stores" aria-label="Specialty stores">
      <div class="settlement-hud__stat settlement-hud__stat--store" tabindex="0" data-resource="grain" data-tooltip="Grain in treasury and farmstead storage.">
        <span class="settlement-hud__label">Grain</span>
        <strong class="settlement-hud__value" data-stockpile="grain">0</strong>
      </div>
      <div class="settlement-hud__stat settlement-hud__stat--store" tabindex="0" data-resource="flour" data-tooltip="Flour in treasury and mill or granary storage.">
        <span class="settlement-hud__label">Flour</span>
        <strong class="settlement-hud__value" data-stockpile="flour">0</strong>
      </div>
      <div class="settlement-hud__stat settlement-hud__stat--store" tabindex="0" data-resource="ale" data-tooltip="Ale in treasury, brewhouses, monasteries, and tier-3 homes.">
        <span class="settlement-hud__label">Ale</span>
        <strong class="settlement-hud__value" data-stockpile="ale">0</strong>
      </div>
      <div class="settlement-hud__stat settlement-hud__stat--store" tabindex="0" data-resource="preservedFood" data-tooltip="Preserved food in treasury, smokehouses, and tier-3 homes.">
        <span class="settlement-hud__label">Preserved</span>
        <strong class="settlement-hud__value" data-stockpile="preservedFood">0</strong>
      </div>
      <div class="settlement-hud__stat settlement-hud__stat--store" tabindex="0" data-resource="honey" data-tooltip="Honey in treasury, apiaries, marketplaces, and monastery hospitality stores. Enabled monasteries consume it before producers export surplus.">
        <span class="settlement-hud__label">Honey</span>
        <strong class="settlement-hud__value" data-stockpile="honey">0</strong>
      </div>
      <div class="settlement-hud__stat settlement-hud__stat--store" tabindex="0" data-resource="wine" data-tooltip="Wine in treasury, vineyards, marketplaces, and monastery hospitality stores. Enabled monasteries consume it before producers export surplus.">
        <span class="settlement-hud__label">Wine</span>
        <strong class="settlement-hud__value" data-stockpile="wine">0</strong>
      </div>
      <div class="settlement-hud__stat settlement-hud__stat--store" tabindex="0" data-resource="wool" data-tooltip="Unspun sheep fleece in treasury, pastoral holdings, and weavers' stores. Sheep are shorn once each year in early summer.">
        <span class="settlement-hud__label">Wool</span>
        <strong class="settlement-hud__value" data-stockpile="wool">0</strong>
      </div>
      <div class="settlement-hud__stat settlement-hud__stat--store" tabindex="0" data-resource="cloth" data-tooltip="Woven cloth in treasury, weavers' workshops, tier-3 homes, and marketplaces awaiting export.">
        <span class="settlement-hud__label">Cloth</span>
        <strong class="settlement-hud__value" data-stockpile="cloth">0</strong>
      </div>
      <div class="settlement-hud__stat settlement-hud__stat--store" tabindex="0" data-resource="ironwork" data-tooltip="Imported wrought-iron spearheads and fittings in treasury, marketplaces, and carpenter workshops. A staffed marketplace must order them; road carts haul them to a carpenter." hidden>
        <span class="settlement-hud__label">Ironwork</span>
        <strong class="settlement-hud__value" data-stockpile="ironwork">0</strong>
      </div>
      <div class="settlement-hud__stat settlement-hud__stat--store" tabindex="0" data-resource="polearms" data-tooltip="Polearms in treasury, carpenter workshops, and guardhouses. One is required for each paid guard." hidden>
        <span class="settlement-hud__label">Polearms</span>
        <strong class="settlement-hud__value" data-stockpile="polearms">0</strong>
      </div>
    </div>
  </div>
`;

export class SettlementHud {
  readonly root: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly clockDate: HTMLElement;
  private readonly clockTime: HTMLElement;
  private readonly clockDetail: HTMLElement;
  private readonly seasonStatus: HTMLElement;
  private readonly fireAlert: HTMLElement;
  private readonly fireCount: HTMLElement;
  private readonly fireResponse: HTMLElement;
  private readonly securityAlert: HTMLElement;
  private readonly securityLabel: HTMLElement;
  private readonly securityDetail: HTMLElement;
  private readonly provisionAlert: HTMLElement;
  private readonly provisionLabel: HTMLElement;
  private readonly provisionDetail: HTMLElement;
  private readonly foodStat: HTMLElement;
  private readonly firewoodStat: HTMLElement;
  private readonly goldStat: HTMLElement;
  private readonly ironworkStat: HTMLElement;
  private readonly polearmsStat: HTMLElement;
  private readonly speedButtons: HTMLButtonElement[];
  private readonly fpsValue: HTMLElement;
  private readonly zoomValue: HTMLElement;
  readonly zoomStat: HTMLElement;

  constructor(parent: HTMLElement, onSetGameSpeed?: (speed: GameSpeed) => void) {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = SETTLEMENT_HUD_HTML.trim();
    const panel = wrapper.firstElementChild;
    if (!(panel instanceof HTMLElement)) {
      throw new Error('SettlementHud template failed to parse.');
    }
    parent.appendChild(panel);
    this.root = panel;
    this.panel = panel;
    this.clockDate = this.mustElement('[data-clock-date]');
    this.clockTime = this.mustElement('[data-clock-time]');
    this.clockDetail = this.mustElement('[data-clock-detail]');
    this.seasonStatus = this.mustElement('[data-season-status]');
    this.fireAlert = this.mustElement('[data-fire-alert]');
    this.fireCount = this.mustElement('[data-fire-count]');
    this.fireResponse = this.mustElement('[data-fire-response]');
    this.securityAlert = this.mustElement('[data-security-alert]');
    this.securityLabel = this.mustElement('[data-security-label]');
    this.securityDetail = this.mustElement('[data-security-detail]');
    this.provisionAlert = this.mustElement('[data-provision-alert]');
    this.provisionLabel = this.mustElement('[data-provision-label]');
    this.provisionDetail = this.mustElement('[data-provision-detail]');
    this.foodStat = this.mustElement('[data-resource="food"]');
    this.firewoodStat = this.mustElement('[data-resource="firewood"]');
    this.goldStat = this.mustElement('[data-resource="gold"]');
    this.ironworkStat = this.mustElement('[data-resource="ironwork"]');
    this.polearmsStat = this.mustElement('[data-resource="polearms"]');
    this.speedButtons = [...this.panel.querySelectorAll<HTMLButtonElement>('[data-game-speed]')];
    for (const button of this.speedButtons) {
      button.addEventListener('click', () => {
        const speed = Number(button.dataset.gameSpeed) as GameSpeed;
        if (GAME_SPEEDS.includes(speed)) {
          onSetGameSpeed?.(speed);
        }
      });
    }
    this.fpsValue = this.mustElement('[data-stat="fps"]');
    this.zoomValue = this.mustElement('[data-stat="zoom"]');
    this.zoomStat = this.mustElement('[data-stat-row="zoom"]');
  }

  setSimulationState(
    speed: GameSpeed,
    environment: EnvironmentState,
    outlook?: NextDayEnvironmentOutlook,
  ): void {
    const description = describeEnvironment(environment);
    this.seasonStatus.textContent = `${description.symbol} ${description.title}`;
    this.seasonStatus.dataset.tooltip = outlook
      ? `${description.detail} ${describeNextDayEnvironmentOutlook(environment, outlook)}.`
      : description.detail;
    this.panel.classList.toggle('is-paused', speed === 0);
    for (const button of this.speedButtons) {
      const buttonSpeed = Number(button.dataset.gameSpeed);
      const active = buttonSpeed === speed;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    }
  }

  setSpeedControlsEnabled(enabled: boolean): void {
    for (const button of this.speedButtons) {
      button.disabled = !enabled;
    }
  }

  setFireState(
    incidents: Iterable<FireIncidentState>,
    trips: Iterable<DeliveryTripState>,
  ): void {
    const burning = [...incidents].filter((incident) => incident.status === 'burning');
    this.fireAlert.hidden = burning.length === 0;
    this.panel.classList.toggle('has-fire', burning.length > 0);
    if (burning.length === 0) return;

    const responders = [...trips].filter((trip) =>
      trip.destinationKind === 'fire' && trip.phase !== 'inbound').length;
    const worst = burning.reduce((current, incident) =>
      incident.damage + incident.intensity > current.damage + current.intensity
        ? incident
        : current);
    this.fireCount.textContent = burning.length === 1
      ? '🔥 Structure fire'
      : `🔥 ${burning.length} structure fires`;
    this.fireResponse.textContent = responders > 0
      ? `${responders} bucket ${responders === 1 ? 'carrier' : 'carriers'} responding`
      : 'No bucket carrier in transit';
    this.fireAlert.dataset.tooltip = [
      `Worst fire: ${Math.round(worst.intensity * 100)}% intensity`,
      `${Math.round(worst.damage * 100)}% damage`,
      `${worst.waterDelivered.toFixed(1)} / ${worst.requiredWater.toFixed(1)} water delivered`,
      worst.extinguishChance > 0
        ? `${Math.round(worst.extinguishChance * 100)}% chance on the last bucket attempt`
        : 'Extinguishing odds improve as buckets cool the fire',
      'Only staffed wells whose work extent reaches the fire can respond.',
    ].join(' · ');
  }

  setSecurityState(
    security: SettlementSecurityState,
    world: AuthoritativeWorldGeneration | null,
    simTick: number,
    projectedTargets?: string,
  ): void {
    const enabled = world?.configured === true && world.conflictMode === 'frontier';
    this.securityAlert.hidden = !enabled;
    this.panel.classList.toggle('has-frontier-threat', enabled && security.threat >= 0.7);
    if (!enabled) return;

    const clock = gameClock(simTick);
    this.securityLabel.textContent = `🛡 ${frontierThreatLabel(security, world, clock.month)}`;
    const coverage = Math.round(security.coverage * 100);
    const readyGuards = security.readyGuards.toFixed(security.readyGuards < 10 ? 1 : 0);
    const requiredGuards = security.guardsRequired.toFixed(security.guardsRequired < 10 ? 1 : 0);
    const timing = security.nextRaidTick <= 0
      ? 'Pressure begins at 8 residents'
      : formatFrontierRaidTiming(security, simTick, clock.month);
    this.securityDetail.textContent = `${timing} · ${coverage}% watched · ${readyGuards}/${requiredGuards} ready${security.threat >= 0.4 && security.targetsAtRisk > 0 ? ` · ${security.targetsAtRisk} marked` : ''}`;
    this.securityAlert.dataset.threat = security.threat >= 0.9
      ? 'imminent'
      : security.threat >= 0.7
        ? 'high'
        : security.threat >= 0.4
          ? 'rising'
          : 'low';
    this.securityAlert.dataset.tooltip = [
      `Enemy pressure: ${world.enemyPressure}%`,
      `Staffed watchtowers: ${security.staffedWatchtowers}`,
      `Ready paid guards: ${readyGuards}`,
      `Guard readiness: ${Math.round(security.defenseReadiness * 100)}%`,
      `Protected settlement value: ${coverage}%`,
      formatFrontierForecast(security, world.enemyPressure),
      projectedTargets,
      'One watchman provides 78% of a tower’s full radius; two provide full coverage.',
      'Armed guards need provisions and wages. A short road route to a staffed tower gives a full muster; long or missing signal routes reduce effective strength.',
      'Incursions strike the richest exposed holdings first; watched holdings remain vulnerable if the guard muster is insufficient.',
      formatRaidReport(security),
    ].filter(Boolean).join(' · ');
  }

  setProvisioningState(provisioning: SettlementProvisioning, month: number): void {
    const level = settlementProvisionLevel(provisioning, month);
    const show = shouldShowProvisioning(provisioning, month);
    const winterRelevant = month >= 9 || month <= 2;
    const sabbathShort = provisioning.sabbathObserved
      && provisioning.sabbathReadyHouseholds < provisioning.sabbathHouseholds;
    const householdBuffersShort = provisioning.householdBufferHouseholds > 0
      && provisioning.householdBufferCoverage < HOUSEHOLD_BUFFER_WARNING_COVERAGE;
    const roadFoodCritical = provisioning.roadBranches !== null
      && provisioning.roadBranches.worstFoodRunwayDays < PROVISION_CRITICAL_DAYS;
    const roadFuelCritical = winterRelevant
      && provisioning.roadBranches !== null
      && provisioning.roadBranches.worstWinterFirewoodRunwayDays
        < PROVISION_CRITICAL_DAYS;
    const roadBranchShort = roadFoodCritical
      || roadFuelCritical
      || (
        provisioning.roadBranches !== null
        && (
          provisioning.roadBranches.foodWarningBranches > 0
          || (
            winterRelevant
            && provisioning.roadBranches.winterFirewoodWarningBranches > 0
          )
        )
      );
    this.provisionAlert.hidden = !show;
    this.provisionAlert.dataset.level = level;
    this.panel.classList.toggle('has-provision-warning', level === 'watch');
    this.panel.classList.toggle('has-provision-critical', level === 'critical');

    this.provisionLabel.textContent = level === 'critical'
      ? roadFoodCritical || roadFuelCritical
        ? '⚠ Isolated branch'
        : '⚠ Provision shortage'
      : sabbathShort
        ? 'Sunday stores'
        : householdBuffersShort
          ? 'Household buffers'
          : roadBranchShort
            ? 'Road-branch stores'
            : winterRelevant
              ? '❄ Winter stores'
              : '⚖ Provision watch';
    this.provisionDetail.textContent = [
      `food ${formatProvisionDays(provisioning.foodRunwayDays)}`,
      provisioning.heatedResidents > 0
        ? `winter fuel ${formatProvisionDays(provisioning.winterFirewoodRunwayDays)} / ${WINTER_RESERVE_DAYS}d`
        : null,
      provisioning.householdBufferHouseholds > 0
        ? `homes ${provisioning.householdBufferReadyHouseholds}/${provisioning.householdBufferHouseholds}`
        : null,
      provisioning.roadBranches !== null
        && (
          provisioning.roadBranches.foodWarningBranches > 0
          || provisioning.roadBranches.foodUnservedBranches > 0
        )
        ? `weakest branch food ${formatProvisionDays(provisioning.roadBranches.worstFoodRunwayDays)}`
        : null,
      winterRelevant
        && provisioning.roadBranches !== null
        && (
          provisioning.roadBranches.winterFirewoodWarningBranches > 0
          || provisioning.roadBranches.firewoodUnservedBranches > 0
        )
        ? `branch fuel ${formatProvisionDays(provisioning.roadBranches.worstWinterFirewoodRunwayDays)}`
        : null,
      provisioning.assignedGuards > 0
        ? `arms ${provisioning.armedGuards}/${provisioning.assignedGuards}`
        : null,
      provisioning.armedGuards > 0
        ? `guard food ${formatProvisionDays(provisioning.guardProvisionRunwayDays)}`
        : null,
      provisioning.armedGuards > 0
        ? `wages ${formatProvisionDays(provisioning.guardWageRunwayDays)}`
        : null,
      provisioning.sabbathObserved
        ? `Sunday ${provisioning.sabbathReadyHouseholds}/${provisioning.sabbathHouseholds} homes`
        : null,
      provisioning.fireQuarantinedFoodStock > 0.05
        || provisioning.fireQuarantinedFirewoodStock > 0.05
        ? `fire quarantine ${provisioning.fireQuarantinedFoodStock.toFixed(0)} food/${provisioning.fireQuarantinedFirewoodStock.toFixed(0)} fuel`
        : null,
    ].filter(Boolean).join(' · ');

    this.provisionAlert.dataset.tooltip = [
      `${provisioning.foodConsumers} housed residents consume ${provisioning.householdFoodPerDay.toFixed(1)} food per day.`,
      provisioning.assignedGuards > 0
        ? `${provisioning.armedGuards} / ${provisioning.assignedGuards} assigned guards are armed; ${provisioning.unarmedGuards} still need polearms.`
        : 'No paid guard company is currently assigned.',
      provisioning.armedGuards > 0
        ? `Guardhouses hold ${provisioning.guardFoodStock.toFixed(1)} food; the first local company runs short in ${formatProvisionRunway(provisioning.guardProvisionRunwayDays)}. Wages cost ${provisioning.guardWagePerDay.toFixed(1)} gold per day (${formatProvisionRunway(provisioning.guardWageRunwayDays)}).`
        : 'No armed guard upkeep is currently due.',
      provisioning.heatedResidents > 0
        ? `A full winter needs about ${Math.ceil(provisioning.winterFirewoodNeed)} firewood at the current heated population.`
        : 'Tier-one households do not yet require household firewood.',
      provisioning.displacedHouseholds > 0
        ? `${provisioning.displacedResidents} residents in ${provisioning.displacedHouseholds} fire-disabled homes are excluded from demand and household-buffer forecasts until recovery.`
        : 'No occupied household is currently fire-disabled.',
      provisioning.fireQuarantinedFoodStock > 0.05
        || provisioning.fireQuarantinedFirewoodStock > 0.05
        ? `Fire quarantine makes ${provisioning.fireQuarantinedFoodStock.toFixed(1)} food and ${provisioning.fireQuarantinedFirewoodStock.toFixed(1)} firewood temporarily inaccessible. Food in damaged buildings continues to spoil.`
        : 'No provisions are currently quarantined by structural fire damage.',
      `Fresh-food spoilage is currently ${formatFreshFoodLoss(provisioning.foodSpoilagePerDay)}; ${Math.round(provisioning.protectedFoodShare * 100)}% is held in sheltered stores.`,
      `Local delivery buffer: ${formatHouseholdBufferReadiness(provisioning)}. Food, water, and provisions cover one workday; firewood covers the nightly no-cart interval.`,
      provisioning.roadBranches === null
        ? 'Road-branch provisioning is unavailable.'
        : `Road-branch audit: ${provisioning.roadBranches.foodSuppliedBranches} / ${provisioning.roadBranches.activeBranches} occupied branches have a stocked food route; the weakest has ${formatProvisionRunway(provisioning.roadBranches.worstFoodRunwayDays)}. ${provisioning.roadBranches.heatedBranches > 0 ? `${provisioning.roadBranches.firewoodSuppliedBranches} / ${provisioning.roadBranches.heatedBranches} heated branches have a fuel distributor; the weakest holds ${formatProvisionRunway(provisioning.roadBranches.worstWinterFirewoodRunwayDays)} at winter demand.` : 'No occupied home currently needs household fuel.'}`,
      provisioning.sabbathObserved
        ? `Sunday readiness: ${formatSabbathReadiness(provisioning)}. Labor and carts rest, but households keep consuming delivered provisions.`
        : 'Sunday labor follows the normal schedule.',
      'Guard food and household buffers use local stores. Headline runways use settlement-wide stock that is currently accessible; road-branch runways count only household stocks, dispatch-capable stores, and cargo already arriving at a usable destination on that branch. Both assume no new production.',
    ].join(' · ');

    this.foodStat.dataset.tooltip = [
      `${provisioning.foodStock.toFixed(1)} food is owned across the treasury, buildings, and homes; ${provisioning.usableFoodStock.toFixed(1)} is currently accessible.`,
      provisioning.fireQuarantinedFoodStock > 0.05
        ? `${provisioning.fireQuarantinedFoodStock.toFixed(1)} food is quarantined at fire-damaged sites and does not extend the runway.`
        : null,
      `Current demand: ${provisioning.totalFoodPerDay.toFixed(1)} per day.`,
      `Current spoilage: ${formatFreshFoodLoss(provisioning.foodSpoilagePerDay)}.`,
      `Spoilage-adjusted runway: ${formatProvisionRunway(provisioning.foodRunwayDays)}.`,
      provisioning.roadBranches === null
        ? null
        : `Weakest occupied road branch: ${formatProvisionRunway(provisioning.roadBranches.worstFoodRunwayDays)} from physical household-usable stores.`,
      'Granaries reduce fresh-food spoilage but add a collection haul; disable intake at a granary to keep local suppliers serving nearby homes directly.',
    ].filter(Boolean).join(' ');
    this.firewoodStat.dataset.tooltip = [
      `${provisioning.firewoodStock.toFixed(1)} firewood is owned across the treasury, buildings, and homes; ${provisioning.usableFirewoodStock.toFixed(1)} is currently accessible.`,
      provisioning.fireQuarantinedFirewoodStock > 0.05
        ? `${provisioning.fireQuarantinedFirewoodStock.toFixed(1)} firewood is quarantined at fire-damaged sites and does not extend the runway.`
        : null,
      `Current runway: ${formatProvisionRunway(provisioning.currentFirewoodRunwayDays)}.`,
      `Winter runway: ${formatProvisionRunway(provisioning.winterFirewoodRunwayDays)} at frost demand.`,
      provisioning.roadBranches === null || provisioning.roadBranches.heatedBranches === 0
        ? null
        : `Weakest heated road branch: ${formatProvisionRunway(provisioning.roadBranches.worstWinterFirewoodRunwayDays)} at frost demand.`,
    ].filter(Boolean).join(' ');
    this.goldStat.dataset.tooltip = provisioning.armedGuards > 0
      ? `Treasury gold from taxed village activity. Armed guard wages cost ${provisioning.guardWagePerDay.toFixed(1)} gold per day; current wage runway is ${formatProvisionRunway(provisioning.guardWageRunwayDays)}.`
      : 'Treasury gold from taxed village economic activity. Select a staffed Town Hall to adjust tax policy.';
  }

  clearProvisioningState(): void {
    this.provisionAlert.hidden = true;
    this.provisionAlert.dataset.level = 'none';
    this.panel.classList.remove('has-provision-warning', 'has-provision-critical');
  }

  setConflictEnabled(enabled: boolean): void {
    this.ironworkStat.hidden = !enabled;
    this.polearmsStat.hidden = !enabled;
  }

  setSettlementClock(schedule: SettlementSchedule): void {
    this.clockDate.textContent = formatCalendarDate(schedule.clock);
    this.clockTime.textContent = formatClockTime(schedule.clock);
    const pauseLabel = schedule.laborPauseLabel;
    this.clockDetail.textContent = pauseLabel
      ? `${formatWeekday(schedule.clock)} · ${pauseLabel}`
      : formatWeekday(schedule.clock);
    this.panel.classList.toggle('is-sabbath', pauseLabel === 'Sunday sabbath');
    this.panel.classList.toggle('is-night', pauseLabel === 'Night hours');
  }

  setFps(fps: number): void {
    const displayFps = Math.min(90, Math.round(fps));
    this.fpsValue.textContent = displayFps.toString();
    this.panel.classList.toggle('is-low', displayFps < 60);
    this.panel.classList.toggle('is-fast', displayFps >= 85);
  }

  setZoomPercent(zoomPercent: number): void {
    const displayZoom = Math.max(0, Math.round(zoomPercent));
    this.zoomValue.textContent = `${displayZoom}%`;
  }

  private mustElement(selector: string): HTMLElement {
    const element = this.panel.querySelector<HTMLElement>(selector);
    if (!element) throw new Error(`Missing settlement HUD element ${selector}`);
    return element;
  }
}
