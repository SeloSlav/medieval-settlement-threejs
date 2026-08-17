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
  gameSpeedLabel,
  hotkeyForGameSpeed,
  type GameSpeed,
} from '../world/gameSpeed.ts';
import type { FireIncidentState } from '../fires/fireIncident.ts';
import type { DeliveryTripState } from '../logistics/deliveryTrips.ts';
import type { ActiveRaidState } from '../security/activeRaid.ts';
import {
  formatFrontierForecast,
  formatFrontierRaidTiming,
  formatRaidReport,
  frontierThreatLabel,
  type ProjectedRaidTarget,
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
import {
  formatFreshFoodLoss,
  formatPreservedFoodLoss,
} from '../economy/foodPreservation.ts';
import type {
  SettlementApproval,
  SettlementApprovalFactor,
} from '../economy/settlementApproval.ts';
import {
  selectSettlementGeologyAlert,
  type SettlementGeologyAlert,
  type SettlementGeologyPlan,
} from '../economy/settlementGeology.ts';
import type { AuthoritativeWorldGeneration } from '../world/worldConfigAuthority.ts';
import {
  FOOD_RESOURCE_KINDS,
  FOOD_RESOURCE_LABELS,
  HUD_RESOURCE_KINDS,
  isHudResourceKind,
  type HudResourceKind,
} from '../resources/resourceTotals.ts';
import { CALENDAR_SECONDS_PER_DAY, SIM_REALTIME_RATE } from '../generated/gameBalance.ts';
import {
  applyHeraldryToElement,
  createHeraldryShield,
  getCurrentNobleProfile,
  getNoble,
} from './nobleProfile.ts';

function gameSpeedTimingLabel(speed: GameSpeed): string {
  if (speed === 0) return 'Freezes the calendar, economy, and world simulation';
  const realSeconds = CALENDAR_SECONDS_PER_DAY / (SIM_REALTIME_RATE * speed);
  const formatted = Number.isInteger(realSeconds)
    ? realSeconds.toFixed(0)
    : realSeconds.toFixed(1);
  return `${formatted}-second day`;
}

const SETTLEMENT_HUD_HTML = `
  <div class="settlement-hud" data-settlement-hud data-fps-panel aria-label="Settlement overview" aria-live="polite">
    <aside class="noble-hud" data-noble-hud aria-label="Noble profile">
      <div class="noble-hud__portrait-shell">
        <img class="noble-hud__portrait" data-noble-hud-portrait alt="" width="560" height="560" />
        <span class="noble-hud__shield" data-noble-hud-shield></span>
      </div>
      <div class="noble-hud__identity">
        <strong data-noble-hud-name></strong>
        <div class="settlement-hud__stat settlement-hud__stat--gold noble-hud__gold" tabindex="0" data-resource="gold" data-tooltip-title="Civic gold" data-tooltip="Spendable gold in settlement lockboxes and the Town Hall treasury.">
          <span class="settlement-hud__label">Gold</span>
          <strong class="settlement-hud__value" data-stockpile="gold">0</strong>
          <span class="settlement-hud__sub settlement-hud__sub--transit" data-stockpile-transit="gold" hidden></span>
        </div>
      </div>
      <button
        type="button"
        class="noble-hud__eye"
        data-noble-eye
        data-tooltip-title="First-Person View"
        data-tooltip="Walk through your estate. The ~ key still works."
        aria-label="Enter first-person view"
        aria-pressed="false"
        disabled
      >
        <svg viewBox="0 0 28 18" aria-hidden="true">
          <path d="M1.5 9s4.4-7 12.5-7 12.5 7 12.5 7-4.4 7-12.5 7S1.5 9 1.5 9Z" />
          <circle cx="14" cy="9" r="3.3" />
        </svg>
      </button>
    </aside>
    <div class="settlement-hud__clock" data-settlement-clock>
      <span class="settlement-hud__clock-date" data-clock-date>Year 1</span>
      <span class="settlement-hud__clock-time" data-clock-time>08:00</span>
      <span class="settlement-hud__clock-detail" data-clock-detail></span>
      <span class="settlement-hud__season" data-season-status tabindex="0"></span>
      <div class="settlement-hud__fire-alert" data-fire-alert hidden>
        <strong data-fire-count>Fire</strong>
        <span data-fire-response>Awaiting a ready well and free hauler</span>
      </div>
      <button
        type="button"
        class="settlement-hud__security-alert"
        data-security-alert
        aria-label="Frontier watch awaiting reports"
        aria-disabled="true"
        tabindex="-1"
        hidden
      >
        <strong data-security-label>Frontier watch</strong>
        <span data-security-detail>Awaiting reports</span>
      </button>
      <div class="settlement-hud__provision-alert" data-provision-alert hidden>
        <strong data-provision-label>Winter stores</strong>
        <span data-provision-detail>Awaiting household ledgers</span>
      </div>
      <div class="settlement-hud__welfare-alert" data-welfare-alert hidden>
        <strong data-welfare-label>Household welfare</strong>
        <span data-welfare-detail>Awaiting parish reports</span>
      </div>
      <div class="settlement-hud__speed" role="group" aria-label="Simulation speed">
        ${GAME_SPEEDS.map((speed) => {
          const hotkey = hotkeyForGameSpeed(speed);
          return `
          <button
            type="button"
            class="settlement-hud__speed-button${speed === 0 ? ' settlement-hud__speed-button--pause' : ''}"
            data-game-speed="${speed}"
            data-tooltip-title="${gameSpeedLabel(speed)}"
            data-tooltip="${gameSpeedTimingLabel(speed)}${hotkey ? ` · Key: ${hotkey}` : ''}"
            aria-label="${speed === 0 ? 'Pause simulation' : `Set simulation speed to ${speed} times`}"
            ${hotkey ? `aria-keyshortcuts="${hotkey}"` : ''}
            aria-pressed="${speed === 1}"
          >
            <span class="settlement-hud__speed-name">${gameSpeedLabel(speed)}</span>
            <span class="settlement-hud__speed-value">${speed === 0 ? '&#x23F8;' : `${speed}×`}</span>
          </button>
        `;
        }).join('')}
      </div>
    </div>
    <div class="settlement-hud__approval-shell" data-approval-shell>
      <button
        type="button"
        class="settlement-hud__approval-button"
        data-approval-button
        data-tier="unavailable"
        aria-controls="settlement-approval-panel"
        aria-expanded="false"
        aria-label="Approval awaiting settlement data"
        disabled
      >
        <span class="settlement-hud__approval-icon" aria-hidden="true">&#10003;</span>
        <span class="settlement-hud__approval-copy">
          <span class="settlement-hud__approval-kicker">Approval</span>
          <strong class="settlement-hud__approval-score" data-approval-score>--</strong>
        </span>
        <span class="settlement-hud__approval-standing">
          <strong data-approval-label>Awaiting ledger</strong>
          <span data-approval-trend aria-hidden="true">&bull;</span>
        </span>
      </button>
      <section
        id="settlement-approval-panel"
        class="settlement-hud__approval-panel"
        data-approval-panel
        data-tier="unavailable"
        role="region"
        aria-labelledby="settlement-approval-title"
        hidden
      >
        <header class="settlement-hud__approval-panel-header">
          <div>
            <span class="settlement-hud__approval-eyebrow">Settlement standing</span>
            <h2 id="settlement-approval-title">Approval</h2>
          </div>
        </header>
        <div class="settlement-hud__approval-reading">
          <strong data-approval-panel-score>--</strong>
          <span data-approval-panel-label>Awaiting ledger</span>
        </div>
        <div
          class="settlement-hud__approval-meter"
          data-approval-meter
          role="meter"
          aria-label="Settlement approval"
          aria-valuemin="0"
          aria-valuemax="100"
          aria-valuenow="0"
        >
          <span data-approval-meter-fill></span>
          <i aria-hidden="true"></i>
        </div>
        <p class="settlement-hud__approval-summary" data-approval-summary>
          Settlement data is not available yet.
        </p>
        <section class="settlement-hud__approval-section">
          <h3>Current effects</h3>
          <ul class="settlement-hud__approval-effects" data-approval-effects></ul>
        </section>
        <section class="settlement-hud__approval-section" data-approval-concerns-section>
          <h3>Needs attention</h3>
          <ul class="settlement-hud__approval-factors" data-approval-concerns></ul>
        </section>
        <section class="settlement-hud__approval-section" data-approval-support-section>
          <h3>Supporting factors</h3>
          <ul class="settlement-hud__approval-factors" data-approval-support></ul>
        </section>
        <p class="settlement-hud__approval-note">
          Approval summarizes live settlement conditions. Authoritative arrivals,
          departures, and welfare remain household-driven.
        </p>
      </section>
    </div>
    <div class="settlement-hud__perf">
      <div
        class="settlement-hud__stat settlement-hud__stat--perf"
        tabindex="0"
        data-stat-row="fps"
        data-tooltip-title="Frame rate"
        data-tooltip="Frames per second. Turns red below 60 and green at 85 or higher."
      >
        <span class="settlement-hud__label">FPS</span>
        <strong class="settlement-hud__value settlement-hud__value--fps" data-stat="fps">--</strong>
      </div>
      <div
        class="settlement-hud__stat settlement-hud__stat--perf"
        tabindex="0"
        data-stat-row="zoom"
        data-tooltip-title="Camera zoom"
        data-tooltip="Camera zoom level. Scroll the mouse wheel to zoom in and out on the map."
      >
        <span class="settlement-hud__label">Zoom</span>
        <strong class="settlement-hud__value settlement-hud__value--zoom" data-stat="zoom">100%</strong>
      </div>
    </div>
    <button
      type="button"
      class="settlement-hud__totals-mode"
      data-resource-totals-mode
      data-mode="surplus"
      data-tooltip-title="Surplus goods (default)"
      data-tooltip="Stored goods available for use after active construction and home-project commitments are deducted. Activate to show total goods."
      aria-label="Showing surplus goods. Show total goods stored."
      aria-pressed="false"
    >
      <span class="settlement-hud__totals-mode-icon" aria-hidden="true">⇄</span>
      <span class="settlement-hud__totals-mode-label" data-resource-totals-mode-label>Surplus</span>
    </button>
    <div class="settlement-hud__body">
      <div class="settlement-hud__stat" tabindex="0" data-resource="labor" data-tooltip-title="Workers free to assign" data-tooltip="People currently available for a new work assignment.">
        <span class="settlement-hud__label">Labor</span>
        <strong class="settlement-hud__value" data-stockpile="labor">0</strong>
        <span class="settlement-hud__sub" data-stockpile="labor-sub">available</span>
      </div>
      <div class="settlement-hud__stat" tabindex="0" data-resource="population" data-tooltip-title="Total population" data-tooltip="All townsfolk currently living in the settlement.">
        <span class="settlement-hud__label">Population</span>
        <strong class="settlement-hud__value" data-stockpile="population">0</strong>
      </div>
      <div class="settlement-hud__stat" tabindex="0" data-resource="housing" data-tooltip-title="Homeless residents" data-tooltip="Townsfolk who do not currently have a home.">
        <span class="settlement-hud__label">Homeless residents</span>
        <strong class="settlement-hud__value" data-stockpile="housing">0</strong>
      </div>
      <div class="settlement-hud__stat" tabindex="0" data-resource="timber" data-tooltip-title="Stored timber" data-tooltip="Unreserved timber in yards, mills, and depots.">
        <span class="settlement-hud__label">Timber</span>
        <strong class="settlement-hud__value" data-stockpile="timber">0</strong>
        <span class="settlement-hud__sub settlement-hud__sub--transit" data-stockpile-transit="timber" hidden></span>
      </div>
      <div class="settlement-hud__stat" tabindex="0" data-resource="stone" data-tooltip-title="Stored stone" data-tooltip="Unreserved stone in quarry yards and depots.">
        <span class="settlement-hud__label">Stone</span>
        <strong class="settlement-hud__value" data-stockpile="stone">0</strong>
        <span class="settlement-hud__sub settlement-hud__sub--transit" data-stockpile-transit="stone" hidden></span>
      </div>
      <div class="settlement-hud__stat" tabindex="0" data-resource="firewood" data-tooltip-title="Stored firewood" data-tooltip="Firewood in lodges, depots, markets, and homes.">
        <span class="settlement-hud__label">Firewood</span>
        <strong class="settlement-hud__value" data-stockpile="firewood">0</strong>
        <span class="settlement-hud__sub settlement-hud__sub--transit" data-stockpile-transit="firewood" hidden></span>
      </div>
      <div class="settlement-hud__stat settlement-hud__stat--water" tabindex="0" data-resource="water" data-tooltip-title="Stored water" data-tooltip="Water in wells, workplaces, and homes.">
        <span class="settlement-hud__label">Water</span>
        <strong class="settlement-hud__value" data-stockpile="water">0</strong>
        <span class="settlement-hud__sub settlement-hud__sub--transit" data-stockpile-transit="water" hidden></span>
      </div>
      <details class="settlement-hud__food-stores" data-food-stores>
        <summary class="settlement-hud__stat settlement-hud__stat--food" tabindex="0" data-resource="food">
          <span class="settlement-hud__label">Food</span>
          <strong class="settlement-hud__value" data-stockpile="food">0</strong>
          <span class="settlement-hud__sub settlement-hud__sub--transit" data-stockpile-transit="food" hidden></span>
        </summary>
        <div
          id="settlement-food-breakdown"
          class="settlement-hud__stores-grid settlement-hud__food-grid"
          data-food-breakdown
          aria-label="Food stores by commodity"
        >
          ${FOOD_RESOURCE_KINDS.map((kind) => `
            <div
              class="settlement-hud__stat settlement-hud__stat--store settlement-hud__food-card"
              data-food-breakdown-row="${kind}"
              data-food-resource="${kind}"
              data-tooltip-title="${FOOD_RESOURCE_LABELS[kind]}"
              data-tooltip="Stored ${FOOD_RESOURCE_LABELS[kind].toLowerCase()} across producers, distributors, carts, and household pantries."
            >
              <span class="settlement-hud__label">${FOOD_RESOURCE_LABELS[kind]}</span>
              <strong class="settlement-hud__value" data-food-breakdown-stored="${kind}">0</strong>
              <span class="settlement-hud__sub settlement-hud__sub--transit" data-food-breakdown-transit="${kind}" hidden></span>
              <span data-food-breakdown-homes="${kind}" hidden>0</span>
              <span data-food-breakdown-surplus="${kind}" hidden>0</span>
            </div>
          `).join('')}
          <div
            class="settlement-hud__stat settlement-hud__stat--store settlement-hud__food-card settlement-hud__food-card--legacy"
            data-food-breakdown-row="legacyFood"
            data-food-resource="legacyFood"
            data-tooltip-title="Legacy mixed food"
            data-tooltip="Compatibility stock from an older save."
            hidden
          >
            <span class="settlement-hud__label">Legacy mixed food</span>
            <strong class="settlement-hud__value" data-food-breakdown-stored="legacyFood">0</strong>
            <span class="settlement-hud__sub settlement-hud__sub--transit" data-food-breakdown-transit="legacyFood" hidden></span>
            <span data-food-breakdown-homes="legacyFood" hidden>0</span>
            <span data-food-breakdown-surplus="legacyFood" hidden>0</span>
          </div>
          <div
            class="settlement-hud__stat settlement-hud__stat--store settlement-hud__food-card settlement-hud__food-card--legacy"
            data-food-breakdown-row="legacyPreservedFood"
            data-food-resource="legacyPreservedFood"
            data-tooltip-title="Legacy preserved staples"
            data-tooltip="Compatibility cured stock from an older save."
            hidden
          >
            <span class="settlement-hud__label">Legacy preserved staples</span>
            <strong class="settlement-hud__value" data-food-breakdown-stored="legacyPreservedFood">0</strong>
            <span class="settlement-hud__sub settlement-hud__sub--transit" data-food-breakdown-transit="legacyPreservedFood" hidden></span>
            <span data-food-breakdown-homes="legacyPreservedFood" hidden>0</span>
            <span data-food-breakdown-surplus="legacyPreservedFood" hidden>0</span>
          </div>
          <span data-food-breakdown-empty hidden></span>
          <span data-food-breakdown-total-stored hidden>0</span>
          <span data-food-breakdown-total-transit hidden>0</span>
          <span data-food-breakdown-total-homes hidden>0</span>
          <span data-food-breakdown-total-surplus hidden>0</span>
        </div>
      </details>
    </div>
    <details class="settlement-hud__stores" data-specialty-stores>
      <summary
        class="settlement-hud__stores-summary"
        aria-label="Stores and provisions, no specialty stock"
      >
        <span class="settlement-hud__stores-label">Stores</span>
        <strong class="settlement-hud__stores-status" data-specialty-stores-status>0</strong>
        <button
          type="button"
          class="settlement-hud__geology-alert"
          data-geology-alert
          aria-label="Inspect geological reserve warning"
          hidden
        ></button>
      </summary>
      <div class="settlement-hud__stores-grid" aria-label="Specialty stores">
      <div class="settlement-hud__stat settlement-hud__stat--store" tabindex="0" data-resource="grain" data-tooltip="Grain stored at physical holdings, granaries, markets, processors, and institutions. Loaded carts are shown separately.">
        <span class="settlement-hud__label">Grain</span>
        <strong class="settlement-hud__value" data-stockpile="grain">0</strong>
        <span class="settlement-hud__sub settlement-hud__sub--transit" data-stockpile-transit="grain" hidden></span>
      </div>
      <div class="settlement-hud__stat settlement-hud__stat--store" tabindex="0" data-resource="barley" data-tooltip="Brewing barley stored at physical farmsteads, granaries, markets, and brewhouses. Barley seed remains protected at its holding; loaded carts are shown separately.">
        <span class="settlement-hud__label">Barley</span>
        <strong class="settlement-hud__value" data-stockpile="barley">0</strong>
        <span class="settlement-hud__sub settlement-hud__sub--transit" data-stockpile-transit="barley" hidden></span>
      </div>
      <div class="settlement-hud__stat settlement-hud__stat--store" tabindex="0" data-resource="malt" data-tooltip="Kiln-dried malt held physically at brewhouses between malting and brewing cycles.">
        <span class="settlement-hud__label">Malt</span>
        <strong class="settlement-hud__value" data-stockpile="malt">0</strong>
        <span class="settlement-hud__sub settlement-hud__sub--transit" data-stockpile-transit="malt" hidden></span>
      </div>
      <div class="settlement-hud__stat settlement-hud__stat--store" tabindex="0" data-resource="flour" data-tooltip="Flour stored at physical mills, granaries, markets, and bakeries. Loaded carts are shown separately.">
        <span class="settlement-hud__label">Flour</span>
        <strong class="settlement-hud__value" data-stockpile="flour">0</strong>
        <span class="settlement-hud__sub settlement-hud__sub--transit" data-stockpile-transit="flour" hidden></span>
      </div>
      <div class="settlement-hud__stat settlement-hud__stat--store" tabindex="0" data-resource="ale" data-tooltip="Ale stored at physical breweries, markets, monasteries, and prosperous homes. Loaded carts are shown separately.">
        <span class="settlement-hud__label">Ale</span>
        <strong class="settlement-hud__value" data-stockpile="ale">0</strong>
        <span class="settlement-hud__sub settlement-hud__sub--transit" data-stockpile-transit="ale" hidden></span>
      </div>
      <div class="settlement-hud__stat settlement-hud__stat--store" tabindex="0" data-resource="preservedFood" data-tooltip="Cured provisions stored at physical smokehouses, granaries, markets, institutions, and prosperous homes. They age slowly rather than lasting forever: smokehouses preserve them best, granaries next, while cupboards and loaded carts lose quality faster. Prosperous households rotate them through the same meal, using less in summer and most in winter; remaining stock substitutes when fresh food fails.">
        <span class="settlement-hud__label">Preserved</span>
        <strong class="settlement-hud__value" data-stockpile="preservedFood">0</strong>
        <span class="settlement-hud__sub settlement-hud__sub--transit" data-stockpile-transit="preservedFood" hidden></span>
      </div>
      <div class="settlement-hud__stat settlement-hud__stat--store" tabindex="0" data-resource="honey" data-tooltip="Honey stored at physical apiaries, markets, and monastery hospitality stores. Enabled monasteries consume it before producers export surplus; loaded carts are shown separately.">
        <span class="settlement-hud__label">Honey</span>
        <strong class="settlement-hud__value" data-stockpile="honey">0</strong>
        <span class="settlement-hud__sub settlement-hud__sub--transit" data-stockpile-transit="honey" hidden></span>
      </div>
      <div class="settlement-hud__stat settlement-hud__stat--store" tabindex="0" data-resource="wine" data-tooltip="Wine stored at physical vineyards, markets, and monastery hospitality stores. Enabled monasteries consume it before producers export surplus; loaded carts are shown separately.">
        <span class="settlement-hud__label">Wine</span>
        <strong class="settlement-hud__value" data-stockpile="wine">0</strong>
        <span class="settlement-hud__sub settlement-hud__sub--transit" data-stockpile-transit="wine" hidden></span>
      </div>
      <div class="settlement-hud__stat settlement-hud__stat--store" tabindex="0" data-resource="wool" data-tooltip="Unspun fleece stored at physical pastoral holdings and weavers. Sheep are shorn once each year in early summer; loaded carts are shown separately.">
        <span class="settlement-hud__label">Wool</span>
        <strong class="settlement-hud__value" data-stockpile="wool">0</strong>
        <span class="settlement-hud__sub settlement-hud__sub--transit" data-stockpile-transit="wool" hidden></span>
      </div>
      <div class="settlement-hud__stat settlement-hud__stat--store" tabindex="0" data-resource="flax" data-tooltip="Harvested flax fibre stored at physical farmsteads and weavers. Weavers need hauled water to prepare flax before weaving; loaded carts are shown separately.">
        <span class="settlement-hud__label">Flax</span>
        <strong class="settlement-hud__value" data-stockpile="flax">0</strong>
        <span class="settlement-hud__sub settlement-hud__sub--transit" data-stockpile-transit="flax" hidden></span>
      </div>
      <div class="settlement-hud__stat settlement-hud__stat--store" tabindex="0" data-resource="cloth" data-tooltip="Woven cloth stored at physical weavers, prosperous homes, and markets awaiting export. Loaded carts are shown separately.">
        <span class="settlement-hud__label">Cloth</span>
        <strong class="settlement-hud__value" data-stockpile="cloth">0</strong>
        <span class="settlement-hud__sub settlement-hud__sub--transit" data-stockpile-transit="cloth" hidden></span>
      </div>
      <div class="settlement-hud__stat settlement-hud__stat--store" tabindex="0" data-resource="iron" data-tooltip="Iron ore and bars held at mines, Trading Posts, and smithies. Every region has finite physical iron seams; rich seed rolls allow non-exhausting deep mining, while staffed Trading Post imports cover shortages. Loaded carts are shown separately.">
        <span class="settlement-hud__label">Iron</span>
        <strong class="settlement-hud__value" data-stockpile="iron">0</strong>
        <span class="settlement-hud__sub settlement-hud__sub--transit" data-stockpile-transit="iron" hidden></span>
      </div>
      <div class="settlement-hud__stat settlement-hud__stat--store" tabindex="0" data-resource="clay" data-tooltip="Wet clay stored at riverbank pits and pottery yards. Ordinary physical banks are finite; rich seed rolls expose faster deep alluvium that does not exhaust. Loaded handcarts are shown separately.">
        <span class="settlement-hud__label">Clay</span>
        <strong class="settlement-hud__value" data-stockpile="clay">0</strong>
        <span class="settlement-hud__sub settlement-hud__sub--transit" data-stockpile-transit="clay" hidden></span>
      </div>
      <div class="settlement-hud__stat settlement-hud__stat--store" tabindex="0" data-resource="salt" data-tooltip="Salt held at mines, Trading Posts, smokehouses, and pastoral holdings. Every region has finite physical salt deposits; rich seed rolls allow non-exhausting deep mining, while staffed Trading Post imports cover shortages. Loaded carts are shown separately.">
        <span class="settlement-hud__label">Salt</span>
        <strong class="settlement-hud__value" data-stockpile="salt">0</strong>
        <span class="settlement-hud__sub settlement-hud__sub--transit" data-stockpile-transit="salt" hidden></span>
      </div>
      <div class="settlement-hud__stat settlement-hud__stat--store" tabindex="0" data-resource="charcoal" data-tooltip="Charcoal stored at burners' yards and smithies. Burning it consumes the same firewood households need for winter heat, so expansion without fuel reserves can become dangerous. Loaded carts are shown separately.">
        <span class="settlement-hud__label">Charcoal</span>
        <strong class="settlement-hud__value" data-stockpile="charcoal">0</strong>
        <span class="settlement-hud__sub settlement-hud__sub--transit" data-stockpile-transit="charcoal" hidden></span>
      </div>
      <div class="settlement-hud__stat settlement-hud__stat--store" tabindex="0" data-resource="pottery" data-tooltip="Fired vessels stored at pottery yards, markets, smokehouses, and prosperous homes. Kilns need river clay, firewood, and puddling water physically carted from a staffed same-branch well; each kiln can put household breakage or smokehouse packing first, while export remains last. Loaded carts are shown separately.">
        <span class="settlement-hud__label">Pottery</span>
        <strong class="settlement-hud__value" data-stockpile="pottery">0</strong>
        <span class="settlement-hud__sub settlement-hud__sub--transit" data-stockpile-transit="pottery" hidden></span>
      </div>
      <div class="settlement-hud__stat settlement-hud__stat--store" tabindex="0" data-resource="roofTiles" data-tooltip="Fired roof tiles stacked at pottery yards or committed to a prosperous house. A kiln must divert clay, firewood, water, labor, and cart time from vessel production; each residence receives and consumes its own physical load.">
        <span class="settlement-hud__label">Roof tiles</span>
        <strong class="settlement-hud__value" data-stockpile="roofTiles">0</strong>
        <span class="settlement-hud__sub settlement-hud__sub--transit" data-stockpile-transit="roofTiles" hidden></span>
      </div>
      <div class="settlement-hud__stat settlement-hud__stat--store" tabindex="0" data-resource="ironwork" data-tooltip="Smith-forged heads, nails, hinges, and fittings stored at smithies, markets, carpenter workshops, and maintained lumber, stone, and clay worksites. Smithies require ore, charcoal, and quench water physically carted from a completed well by an unassigned hauler. A smithy handcart first restores staffed tool buffers by priority and shortest road; each maintained production cycle wears 0.25 ironwork for 20% faster output. Loaded carts are shown separately.">
        <span class="settlement-hud__label">Ironwork</span>
        <strong class="settlement-hud__value" data-stockpile="ironwork">0</strong>
        <span class="settlement-hud__sub settlement-hud__sub--transit" data-stockpile-transit="ironwork" hidden></span>
      </div>
      <div class="settlement-hud__stat settlement-hud__stat--store" tabindex="0" data-resource="polearms" data-tooltip="Polearms stored at physical carpenter workshops and guardhouses. One is required for each paid guard; loaded weapon carts are shown separately." hidden>
        <span class="settlement-hud__label">Polearms</span>
        <strong class="settlement-hud__value" data-stockpile="polearms">0</strong>
        <span class="settlement-hud__sub settlement-hud__sub--transit" data-stockpile-transit="polearms" hidden></span>
      </div>
      </div>
    </details>
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
  private readonly securityAlert: HTMLButtonElement;
  private readonly securityLabel: HTMLElement;
  private readonly securityDetail: HTMLElement;
  private readonly provisionAlert: HTMLElement;
  private readonly provisionLabel: HTMLElement;
  private readonly provisionDetail: HTMLElement;
  private readonly welfareAlert: HTMLElement;
  private readonly welfareLabel: HTMLElement;
  private readonly welfareDetail: HTMLElement;
  private readonly approvalShell: HTMLElement;
  private readonly approvalButton: HTMLButtonElement;
  private readonly approvalScore: HTMLElement;
  private readonly approvalLabel: HTMLElement;
  private readonly approvalTrend: HTMLElement;
  private readonly approvalPanel: HTMLElement;
  private readonly approvalPanelScore: HTMLElement;
  private readonly approvalPanelLabel: HTMLElement;
  private readonly approvalMeter: HTMLElement;
  private readonly approvalMeterFill: HTMLElement;
  private readonly approvalSummary: HTMLElement;
  private readonly approvalEffects: HTMLElement;
  private readonly approvalConcerns: HTMLElement;
  private readonly approvalSupport: HTMLElement;
  private readonly approvalConcernsSection: HTMLElement;
  private readonly approvalSupportSection: HTMLElement;
  private readonly foodStat: HTMLElement;
  private readonly foodStores: HTMLDetailsElement;
  private readonly goldStat: HTMLElement;
  private readonly polearmsStat: HTMLElement;
  private readonly specialtyStores: HTMLDetailsElement;
  private readonly specialtyStoresSummary: HTMLElement;
  private readonly specialtyStoresStatus: HTMLElement;
  private readonly geologyAlert: HTMLButtonElement;
  private readonly geologyResourceRows: Record<
    SettlementGeologyAlert['resource'],
    HTMLElement
  >;
  private readonly speedButtons: HTMLButtonElement[];
  private readonly fpsValue: HTMLElement;
  private readonly zoomValue: HTMLElement;
  private readonly nobleEye: HTMLButtonElement;
  private onToggleFirstPerson: (() => void) | null = null;
  private onLocateResource: ((resource: HudResourceKind) => void) | null = null;
  private onInspectGeologyAttention: ((buildingId: string) => void) | null = null;
  private onInspectSecurityAttention: ((
    target: ProjectedRaidTarget,
    index: number,
    count: number,
  ) => void) | null = null;
  private securityAttentionTargets: readonly ProjectedRaidTarget[] = [];
  private securityAttentionIndex = 0;
  private geologyAttentionBuildingId: string | null = null;
  private lastApprovalScore: number | null = null;
  private lastApprovalTrend: 'rising' | 'falling' | 'steady' = 'steady';
  private approvalTrendExpiresAt = 0;
  private approvalPointerInside = false;
  private approvalCloseTimer: number | null = null;
  private displayedClockDate: string | null = null;
  private displayedClockTime: string | null = null;
  private displayedClockDetail: string | null = null;
  private displayedSabbath: boolean | null = null;
  private displayedNight: boolean | null = null;
  private displayedFps: number | null = null;
  private displayedZoom: number | null = null;
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
    const profile = getCurrentNobleProfile();
    const noble = getNoble(profile.nobleId);
    const noblePortrait = this.mustElement('[data-noble-hud-portrait]') as HTMLImageElement;
    const nobleName = this.mustElement('[data-noble-hud-name]');
    const nobleShieldMount = this.mustElement('[data-noble-hud-shield]');
    noblePortrait.src = noble.portrait;
    noblePortrait.alt = `Portrait of ${profile.displayName}`;
    nobleName.textContent = profile.displayName;
    const nobleShield = createHeraldryShield('heraldry-shield--hud');
    applyHeraldryToElement(nobleShield, profile.heraldry);
    nobleShieldMount.appendChild(nobleShield);
    this.nobleEye = this.mustButton('[data-noble-eye]');
    this.clockDate = this.mustElement('[data-clock-date]');
    this.clockTime = this.mustElement('[data-clock-time]');
    this.clockDetail = this.mustElement('[data-clock-detail]');
    this.seasonStatus = this.mustElement('[data-season-status]');
    this.fireAlert = this.mustElement('[data-fire-alert]');
    this.fireCount = this.mustElement('[data-fire-count]');
    this.fireResponse = this.mustElement('[data-fire-response]');
    this.securityAlert = this.mustButton('[data-security-alert]');
    this.securityLabel = this.mustElement('[data-security-label]');
    this.securityDetail = this.mustElement('[data-security-detail]');
    this.provisionAlert = this.mustElement('[data-provision-alert]');
    this.provisionLabel = this.mustElement('[data-provision-label]');
    this.provisionDetail = this.mustElement('[data-provision-detail]');
    this.welfareAlert = this.mustElement('[data-welfare-alert]');
    this.welfareLabel = this.mustElement('[data-welfare-label]');
    this.welfareDetail = this.mustElement('[data-welfare-detail]');
    this.approvalShell = this.mustElement('[data-approval-shell]');
    this.approvalButton = this.mustButton('[data-approval-button]');
    this.approvalScore = this.mustElement('[data-approval-score]');
    this.approvalLabel = this.mustElement('[data-approval-label]');
    this.approvalTrend = this.mustElement('[data-approval-trend]');
    this.approvalPanel = this.mustElement('[data-approval-panel]');
    this.approvalPanelScore = this.mustElement('[data-approval-panel-score]');
    this.approvalPanelLabel = this.mustElement('[data-approval-panel-label]');
    this.approvalMeter = this.mustElement('[data-approval-meter]');
    this.approvalMeterFill = this.mustElement('[data-approval-meter-fill]');
    this.approvalSummary = this.mustElement('[data-approval-summary]');
    this.approvalEffects = this.mustElement('[data-approval-effects]');
    this.approvalConcerns = this.mustElement('[data-approval-concerns]');
    this.approvalSupport = this.mustElement('[data-approval-support]');
    this.approvalConcernsSection = this.mustElement('[data-approval-concerns-section]');
    this.approvalSupportSection = this.mustElement('[data-approval-support-section]');
    this.foodStat = this.mustElement('[data-resource="food"]');
    this.foodStores = this.mustDetails('[data-food-stores]');
    this.goldStat = this.mustElement('[data-resource="gold"]');
    this.polearmsStat = this.mustElement('[data-resource="polearms"]');
    this.specialtyStores = this.mustDetails('[data-specialty-stores]');
    this.specialtyStoresSummary = this.mustElement(
      '[data-specialty-stores] > .settlement-hud__stores-summary',
    );
    this.specialtyStoresStatus = this.mustElement('[data-specialty-stores-status]');
    this.geologyAlert = this.mustButton('[data-geology-alert]');
    this.geologyResourceRows = {
      stone: this.mustElement('[data-resource="stone"]'),
      clay: this.mustElement('[data-resource="clay"]'),
      iron: this.mustElement('[data-resource="iron"]'),
      salt: this.mustElement('[data-resource="salt"]'),
    };
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
    for (const resource of HUD_RESOURCE_KINDS) {
      const row = this.mustElement(`[data-resource="${resource}"]`);
      const label = row.querySelector<HTMLElement>('.settlement-hud__label')
        ?.textContent
        ?.trim() || resource;
      const detail = row.dataset.tooltip?.trim();
      row.dataset.tooltipTitle = row.dataset.tooltipTitle?.trim() || label;
      row.dataset.tooltip = detail || label;
      row.classList.add('is-resource-locator');
      row.setAttribute('role', 'button');
      row.setAttribute('aria-label', `${label}: locate physical holdings`);
    }
    this.foodStat.setAttribute('aria-controls', 'settlement-food-breakdown');
    this.foodStat.setAttribute('aria-expanded', 'false');
    this.foodStat.setAttribute('aria-label', 'Food: hover or focus to show commodity breakdown');
    delete this.foodStat.dataset.tooltipTitle;
    delete this.foodStat.dataset.tooltip;
    this.panel.addEventListener('click', this.onResourceRowClick);
    this.panel.addEventListener('keydown', this.onResourceRowKeyDown);
    this.securityAlert.addEventListener('click', this.onSecurityAlertClick);
    this.geologyAlert.addEventListener('click', this.onGeologyAlertClick);
    this.approvalButton.addEventListener('click', this.onApprovalOpen);
    this.approvalButton.addEventListener('focus', this.onApprovalOpen);
    this.approvalButton.addEventListener('blur', this.onApprovalBlur);
    this.approvalShell.addEventListener('pointerenter', this.onApprovalPointerEnter);
    this.approvalShell.addEventListener('pointermove', this.onApprovalPointerMove);
    this.approvalShell.addEventListener('pointerleave', this.onApprovalPointerLeave);
    this.foodStores.addEventListener('toggle', this.onFoodStoresToggle);
    this.foodStores.addEventListener('pointerenter', this.onFoodStoresPointerEnter);
    this.foodStores.addEventListener('pointerleave', this.onFoodStoresPointerLeave);
    this.foodStores.addEventListener('focusin', this.onFoodStoresFocusIn);
    this.foodStores.addEventListener('focusout', this.onFoodStoresFocusOut);
    this.foodStat.addEventListener('click', this.onFoodStoresSummaryClick);
    this.specialtyStores.addEventListener('toggle', this.onSpecialtyStoresToggle);
    this.specialtyStores.addEventListener('pointerenter', this.onSpecialtyStoresPointerEnter);
    this.specialtyStores.addEventListener('pointerleave', this.onSpecialtyStoresPointerLeave);
    this.specialtyStores.addEventListener('focusin', this.onSpecialtyStoresFocusIn);
    this.specialtyStores.addEventListener('focusout', this.onSpecialtyStoresFocusOut);
    this.specialtyStoresSummary.addEventListener(
      'click',
      this.onSpecialtyStoresSummaryClick,
    );
    this.nobleEye.addEventListener('click', this.onNobleEyeClick);
    window.addEventListener('keydown', this.onApprovalEscape, true);
  }

  setFirstPersonToggle(handler: (() => void) | null): void {
    this.onToggleFirstPerson = handler;
    this.nobleEye.disabled = handler === null;
  }

  setFirstPersonActive(active: boolean): void {
    this.root.hidden = active;
    this.nobleEye.classList.toggle('is-active', active);
    this.nobleEye.setAttribute('aria-pressed', String(active));
    this.nobleEye.setAttribute(
      'aria-label',
      active ? 'Exit first-person view' : 'Enter first-person view',
    );
  }

  private readonly onNobleEyeClick = (): void => {
    this.onToggleFirstPerson?.();
  };

  setResourceLocator(handler: ((resource: HudResourceKind) => void) | null): void {
    this.onLocateResource = handler;
  }

  setGeologyAttentionHandler(
    handler: ((buildingId: string) => void) | null,
  ): void {
    this.onInspectGeologyAttention = handler;
  }

  setSecurityAttentionHandler(
    handler: ((
      target: ProjectedRaidTarget,
      index: number,
      count: number,
    ) => void) | null,
  ): void {
    this.onInspectSecurityAttention = handler;
    this.refreshSecurityAttentionControl();
  }

  setGeologyState(plan: SettlementGeologyPlan | null): void {
    const alert = plan === null ? null : selectSettlementGeologyAlert(plan);
    this.geologyAttentionBuildingId = alert?.firstAttentionBuildingId ?? null;
    this.geologyAlert.hidden = alert === null;
    this.specialtyStoresStatus.hidden = alert !== null;
    this.specialtyStores.classList.toggle('has-geology-alert', alert !== null);
    delete this.specialtyStores.dataset.geologyLevel;
    for (const resource of ['stone', 'clay', 'iron', 'salt'] as const) {
      const row = this.geologyResourceRows[resource];
      row.classList.toggle(
        'has-geology-alert',
        alert?.resource === resource,
      );
      delete row.dataset.geologyLevel;
    }
    if (alert === null) {
      this.geologyAlert.textContent = '';
      delete this.geologyAlert.dataset.level;
      delete this.geologyAlert.dataset.tooltipTitle;
      delete this.geologyAlert.dataset.tooltip;
      return;
    }

    const resourceLabel = geologyResourceLabel(alert.resource);
    const affectedRow = this.geologyResourceRows[alert.resource];
    this.specialtyStores.dataset.geologyLevel = alert.level;
    affectedRow.dataset.geologyLevel = alert.level;
    this.geologyAlert.dataset.level = alert.level;
    if (alert.reason === 'deep-supports') {
      const worksiteCount = alert.deepSourcesAwaitingSupports;
      this.geologyAlert.textContent = `${resourceLabel} supports`;
      this.geologyAlert.setAttribute(
        'aria-label',
        `Inspect ${resourceLabel.toLowerCase()} extraction warning: ${worksiteCount} staffed deep ${
          worksiteCount === 1 ? 'worksite awaits' : 'worksites await'
        } timber supports`,
      );
    } else {
      const runway = formatGeologyAlertRunway(alert.runwayDays);
      this.geologyAlert.textContent = `${resourceLabel} ${runway}`;
      this.geologyAlert.setAttribute(
        'aria-label',
        `Inspect ${resourceLabel.toLowerCase()} extraction warning: shortest staffed finite seam ${runway}`,
      );
    }
    this.geologyAlert.dataset.tooltipTitle = `${resourceLabel} reserves`;
    this.geologyAlert.dataset.tooltip = geologyAlertTooltip(alert);
  }

  clearGeologyState(): void {
    this.setGeologyState(null);
  }

  setSimulationState(
    speed: GameSpeed,
    environment: EnvironmentState,
    outlook?: NextDayEnvironmentOutlook,
  ): void {
    const description = describeEnvironment(environment);
    this.seasonStatus.textContent = `${description.symbol} ${description.title}`;
    this.seasonStatus.dataset.tooltipTitle = description.title;
    this.seasonStatus.dataset.tooltip = outlook
      ? `${description.detail}\n\n${describeNextDayEnvironmentOutlook(environment, outlook)}.`
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
    this.fireAlert.dataset.tooltipTitle = burning.length === 1
      ? 'Structure fire'
      : `${burning.length} structure fires`;
    this.fireAlert.dataset.tooltip = [
      `Worst fire: ${Math.round(worst.intensity * 100)}% intensity`,
      `${Math.round(worst.damage * 100)}% damage`,
      `${worst.waterDelivered.toFixed(1)} / ${worst.requiredWater.toFixed(1)} water delivered`,
      worst.extinguishChance > 0
        ? `${Math.round(worst.extinguishChance * 100)}% chance on the last bucket attempt`
        : 'Extinguishing odds improve as buckets cool the fire',
      'Covered wells reserve water first; every useful free hauler may carry a bucket concurrently.',
    ].join(' · ');
  }

  setSecurityState(
    security: SettlementSecurityState,
    world: AuthoritativeWorldGeneration | null,
    simTick: number,
    projectedTargets?: string,
    securityAttentionTargets: readonly ProjectedRaidTarget[] = [],
    activeRaid?: ActiveRaidState | null,
    raidThreatActive = false,
    withdrawingCarts = 0,
  ): void {
    const enabled = world?.configured === true && world.conflictMode === 'frontier';
    const warningActive = security.warningStartedTick > 0;
    this.setSecurityAttentionTargets(
      enabled ? securityAttentionTargets : [],
    );
    this.securityAlert.hidden = !enabled;
    this.panel.classList.toggle(
      'has-frontier-threat',
      enabled && (raidThreatActive || warningActive),
    );
    if (!enabled) return;

    const clock = gameClock(simTick);
    this.securityLabel.textContent = `🛡 ${
      raidThreatActive
        ? 'Raiders inside the frontier'
        : frontierThreatLabel(security, world, clock.month)
    }`;
    this.securityAlert.dataset.tooltipTitle = raidThreatActive
      ? 'Raiders inside the frontier'
      : frontierThreatLabel(security, world, clock.month);
    const coverage = Math.round(security.coverage * 100);
    const readyGuards = security.readyGuards.toFixed(security.readyGuards < 10 ? 1 : 0);
    const requiredGuards = security.guardsRequired.toFixed(security.guardsRequired < 10 ? 1 : 0);
    const timing = security.nextRaidTick <= 0
      ? 'Pressure begins at 8 residents'
      : formatFrontierRaidTiming(security, simTick, clock.month);
    const routActive = raidThreatActive && activeRaid?.routStarted === true;
    const mobilization = routActive
      ? `Raiders routed: guards pursuing until the last attacker escapes or falls`
      : raidThreatActive
        ? `Live incursion: labor halted, new cart departures stopped${
          withdrawingCarts > 0
            ? ` · ${withdrawingCarts} handcart${withdrawingCarts === 1 ? '' : 's'} withdrawing`
            : ''
        }`
        : activeRaid
          ? 'All clear: the company is returning'
          : timing;
    this.securityDetail.textContent = `${mobilization} · ${coverage}% watched · weakest district ${readyGuards}/${requiredGuards}${warningActive && security.targetsAtRisk > 0 ? ` · ${security.targetsAtRisk} marked` : ''}`;
    this.securityAlert.dataset.threat = raidThreatActive
      ? 'imminent'
      : warningActive
        ? 'high'
        : 'low';
    this.securityAlert.dataset.tooltip = [
      `Enemy pressure: ${world.enemyPressure}%`,
      `Staffed watchtowers: ${security.staffedWatchtowers}`,
      `Weakest likely watch district: ${readyGuards}/${requiredGuards} guards`,
      `Companies supplied, paid, drilled, and road-linked: ${Math.round(security.defenseReadiness * 100)}%`,
      `Protected settlement value: ${coverage}%`,
      raidThreatActive && activeRaid
        ? activeRaid.routStarted
          ? `The raiding party broke after ${activeRaid.raidersDowned} of ${activeRaid.initialRaiders} attackers fell. Every survivor is now a physical fugitive: guards can pursue them and recover carried loot, while the alarm remains until the last capable raider reaches the frontier or falls.`
          : `Settlement mobilized since tick ${activeRaid.startedTick}: production, construction, migration, and new ordinary-cart departures remain halted until the last capable raider physically escapes or falls. Active carters reverse toward their origins with cargo still exposed, while fire response and household consumption continue.`
        : activeRaid
          ? 'The last hostile is clear: ordinary work and carts have resumed while the company physically returns and casualties are recovered.'
          : undefined,
      raidThreatActive && withdrawingCarts > 0
        ? `${withdrawingCarts} ordinary handcart${withdrawingCarts === 1 ? ' is' : 's are'} physically withdrawing. Raiders can intercept the moving cargo; a pursuer that follows it home continues against the receiving store, capped to the cart’s remaining value.`
        : undefined,
      formatFrontierForecast(security, world.enemyPressure),
      projectedTargets,
      'Ordinary scout reports are uncertain, with larger parties easier to notice. A staffed watchtower reliably reports only an approach lane inside its effective sight radius.',
      'One watchman provides 78% of a tower’s full sight radius; two provide full coverage. Towers farther toward the correct map edge report earlier, while towers on another side provide no warning for this raid.',
      'Each armed company reinforces only its nearest road-linked staffed tower. Short routes give a full muster; long, soft, or missing routes weaken that watch district.',
      'Unlinked armed companies still materialize at their guardhouse and immediately head cross-country for the nearest attacked holding. They are not credited to a specific watch-district forecast; linked roads remain the faster coordinated response.',
      'Incursions strike the richest exposed holdings first; watched holdings remain vulnerable if the guard muster is insufficient.',
      formatRaidReport(security),
    ].filter(Boolean).join(' · ');
  }

  setProvisioningState(provisioning: SettlementProvisioning, month: number): void {
    this.setWelfareState(provisioning);
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
    this.provisionAlert.dataset.tooltipTitle = this.provisionLabel.textContent;
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
      `${provisioning.foodConsumers} housed residents require ${provisioning.grossHouseholdFoodPerDay.toFixed(1)} meal-equivalent units per day; household cured rations currently displace ${provisioning.householdPreservedFoodRotationPerDay.toFixed(1)}, leaving ${provisioning.householdFoodPerDay.toFixed(1)} fresh-food demand.`,
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
      `Fresh-food spoilage is currently ${formatFreshFoodLoss(provisioning.foodSpoilagePerDay)}; cured stores age by ${formatPreservedFoodLoss(provisioning.preservedFoodSpoilagePerDay)} among usable household and distributor stock.`,
      `Local delivery buffer: ${formatHouseholdBufferReadiness(provisioning)}. Food, water, and provisions cover one workday; firewood covers the nightly no-cart interval.`,
      provisioning.roadBranches === null
        ? 'Road-branch provisioning is unavailable.'
        : `Road-branch audit: ${provisioning.roadBranches.foodSuppliedBranches} / ${provisioning.roadBranches.activeBranches} occupied branches have a stocked fresh-food route; ${provisioning.roadBranches.physicalFoodStock.toFixed(1)} fresh and ${provisioning.roadBranches.physicalPreservedFoodStock.toFixed(1)} cured provisions give the weakest branch ${formatProvisionRunway(provisioning.roadBranches.worstFoodRunwayDays)} of fresh-food runway. ${provisioning.roadBranches.heatedBranches > 0 ? `${provisioning.roadBranches.firewoodSuppliedBranches} / ${provisioning.roadBranches.heatedBranches} heated branches have a fuel distributor; the weakest holds ${formatProvisionRunway(provisioning.roadBranches.worstWinterFirewoodRunwayDays)} at winter demand.` : 'No occupied home currently needs household fuel.'}`,
      provisioning.sabbathObserved
        ? `Sunday readiness: ${formatSabbathReadiness(provisioning)}. Labor and carts rest, but households keep consuming delivered provisions.`
        : 'Sunday labor follows the normal schedule.',
      'Guard food and household buffers use local stores. Fresh-food runways consume finite cured stock only at the current seasonal rotation, then return to gross meal demand when that reserve is exhausted. Headline runways use settlement-wide fire-accessible stock; road-branch runways count only household stocks, dispatch-capable stores, and cargo already arriving at a usable destination on that branch. Both assume no new production.',
    ].join(' · ');

    this.goldStat.dataset.tooltip = provisioning.armedGuards > 0
      ? `Guard wages cost ${provisioning.guardWagePerDay.toFixed(1)} gold per day; current funds cover ${formatProvisionRunway(provisioning.guardWageRunwayDays)}.`
      : 'Spendable gold in settlement lockboxes and the Town Hall treasury.';
  }

  setApprovalState(approval: SettlementApproval): void {
    const now = Date.now();
    if (this.lastApprovalScore !== null) {
      const delta = approval.score - this.lastApprovalScore;
      if (delta >= 1) {
        this.lastApprovalTrend = 'rising';
        this.approvalTrendExpiresAt = now + 30_000;
      } else if (delta <= -1) {
        this.lastApprovalTrend = 'falling';
        this.approvalTrendExpiresAt = now + 30_000;
      } else if (now >= this.approvalTrendExpiresAt) {
        this.lastApprovalTrend = 'steady';
      }
    }
    this.lastApprovalScore = approval.score;

    this.approvalButton.disabled = false;
    this.approvalButton.dataset.tier = approval.tier;
    this.approvalPanel.dataset.tier = approval.tier;
    this.approvalScore.textContent = `${approval.score}%`;
    this.approvalLabel.textContent = approval.label;
    this.approvalPanelScore.textContent = `${approval.score}%`;
    this.approvalPanelLabel.textContent = approval.label;
    this.approvalSummary.textContent = approval.summary;
    this.approvalMeter.setAttribute('aria-valuenow', String(approval.score));
    this.approvalMeterFill.style.width = `${approval.score}%`;

    const trendCopy = this.lastApprovalTrend === 'rising'
      ? { symbol: '↑', label: 'rising' }
      : this.lastApprovalTrend === 'falling'
        ? { symbol: '↓', label: 'falling' }
        : { symbol: '•', label: 'steady' };
    this.approvalTrend.textContent = trendCopy.symbol;
    this.approvalTrend.dataset.trend = this.lastApprovalTrend;
    this.approvalButton.setAttribute(
      'aria-label',
      `Approval ${approval.score} percent, ${approval.label}, ${trendCopy.label}. Hover or focus for details.`,
    );

    renderTextList(this.approvalEffects, approval.effects);
    const concerns = approval.factors
      .filter((factor) => factor.impact < 0)
      .sort((left, right) => left.impact - right.impact);
    const support = approval.factors
      .filter((factor) => factor.impact > 0)
      .sort((left, right) => right.impact - left.impact);
    renderApprovalFactorList(
      this.approvalConcerns,
      concerns,
      'No active factor is reducing approval.',
    );
    renderApprovalFactorList(
      this.approvalSupport,
      support,
      'No factor is currently lifting approval above its neutral base.',
    );
    this.approvalConcernsSection.dataset.empty = String(concerns.length === 0);
    this.approvalSupportSection.dataset.empty = String(support.length === 0);
  }

  clearApprovalState(): void {
    this.setApprovalOpen(false);
    this.lastApprovalScore = null;
    this.lastApprovalTrend = 'steady';
    this.approvalTrendExpiresAt = 0;
    this.approvalButton.disabled = true;
    this.approvalButton.dataset.tier = 'unavailable';
    this.approvalPanel.dataset.tier = 'unavailable';
    this.approvalScore.textContent = '--';
    this.approvalLabel.textContent = 'Awaiting ledger';
    this.approvalTrend.textContent = '•';
    this.approvalTrend.dataset.trend = 'steady';
    this.approvalPanelScore.textContent = '--';
    this.approvalPanelLabel.textContent = 'Awaiting ledger';
    this.approvalSummary.textContent = 'Settlement data is not available yet.';
    this.approvalMeter.setAttribute('aria-valuenow', '0');
    this.approvalMeterFill.style.width = '0%';
    this.approvalButton.setAttribute('aria-label', 'Approval awaiting settlement data');
    delete this.approvalButton.dataset.tooltipTitle;
    delete this.approvalButton.dataset.tooltip;
    this.approvalEffects.replaceChildren();
    this.approvalConcerns.replaceChildren();
    this.approvalSupport.replaceChildren();
  }

  private setWelfareState(provisioning: SettlementProvisioning): void {
    const welfare = provisioning.welfare;
    const show = welfare.level === 'watch' || welfare.level === 'critical';
    this.welfareAlert.hidden = !show;
    this.welfareAlert.dataset.level = welfare.level;
    this.panel.classList.toggle('has-welfare-warning', welfare.level === 'watch');
    this.panel.classList.toggle('has-welfare-critical', welfare.level === 'critical');

    this.welfareLabel.textContent = welfare.starvingResidents > 0
      ? 'Households starving'
      : welfare.uncollectedBodiesAtHomes > 0
        && (welfare.openGraves <= 0 || welfare.oldestUncollectedBodyDays >= 1)
        ? 'Burial response blocked'
        : welfare.malnourishedResidents > 0
          ? 'Household health'
          : welfare.sickResidents > 0
            ? 'Illness watch'
            : welfare.upgradeBlockedHouseholds > 0
              ? 'Household services'
              : 'Welfare watch';
    this.welfareAlert.dataset.tooltipTitle = this.welfareLabel.textContent;
    this.welfareDetail.textContent = [
      welfare.starvingResidents > 0
        ? `${welfare.starvingResidents} starving`
        : null,
      welfare.malnourishedResidents > 0
        ? `${welfare.malnourishedResidents} malnourished`
        : welfare.hungryResidents > 0
          ? `${welfare.hungryResidents} hungry`
          : null,
      welfare.sickResidents > 0
        ? `${welfare.sickResidents} sick`
        : null,
      welfare.sickResidents > 0
        ? `herbs ${formatWelfareRunway(welfare.remedyRunwayDays)}`
        : null,
      welfare.uncollectedBodiesAtHomes > 0
        ? `${welfare.uncollectedBodiesAtHomes} at ${welfare.uncollectedBodiesAtHomes === 1 ? 'a home' : 'homes'}`
        : null,
      welfare.uncollectedBodiesAtHomes > 0 || welfare.burialGrounds > 0
        ? `${welfare.openGraves} graves open`
        : null,
      welfare.upgradeBlockedHouseholds > 0
        ? `${welfare.upgradeBlockedHouseholds} upgrades blocked`
        : null,
    ].filter(Boolean).join(' · ');
    this.welfareAlert.dataset.tooltip = [
      `${welfare.stableResidents} / ${welfare.activeResidents} residents live in households without a current health or service warning.`,
      welfare.sickResidents > 0
        ? `${welfare.sickResidents} residents cannot work while ill. The settlement holds ${welfare.householdRemedyStock.toFixed(1)} remedies in homes, ${welfare.preparedRemedyStock.toFixed(1)} at sheds, and ${welfare.remediesInTransit.toFixed(1)} on carts against ${welfare.remedyDemandPerDay.toFixed(2)} per day; ${welfare.untreatedSickHouseholds} sick homes are not yet supplied for a full day.`
        : 'No resident is currently unable to work through illness.',
      welfare.uncollectedBodiesAtHomes > 0
        ? `${welfare.uncollectedBodiesAtHomes} bodies still remain at homes and add local disease pressure. ${welfare.outboundEmptyCarts} empty burial carts are outbound and ${welfare.loadedBurialCarts} loaded carts are returning.`
        : 'No body currently remains at a household.',
      welfare.burialGrounds > 0
        ? `${welfare.occupiedGraves} graves are occupied, ${welfare.reservedGraves} reserved by moving carts, and ${welfare.openGraves} remain open across ${welfare.burialGrounds} grounds.`
        : 'No consecrated burial ground has been laid out.',
      welfare.serviceWarningHouseholds > 0
        ? `${welfare.serviceWarningHouseholds} households have sustained unmet needs; ${welfare.upgradeBlockedHouseholds} cannot be promoted and taxable household output averages ${Math.round(welfare.serviceEconomicOutputMultiplier * 100)}%.`
        : 'Household services are stable, preserving full taxable output and residence promotion.',
      `${welfare.vacantHomes} empty ${welfare.vacantHomes === 1 ? 'home remains' : 'homes remain'} permanently reusable for arriving settlers.`,
      'Open the Town Hall ledger to inspect the highest-risk household.',
    ].join(' · ');
  }

  clearProvisioningState(): void {
    this.provisionAlert.hidden = true;
    this.provisionAlert.dataset.level = 'none';
    this.welfareAlert.hidden = true;
    this.welfareAlert.dataset.level = 'none';
    this.panel.classList.remove(
      'has-provision-warning',
      'has-provision-critical',
      'has-welfare-warning',
      'has-welfare-critical',
    );
    this.clearApprovalState();
  }

  setConflictEnabled(enabled: boolean): void {
    this.polearmsStat.hidden = !enabled;
  }

  setSettlementClock(schedule: SettlementSchedule): void {
    const date = formatCalendarDate(schedule.clock);
    const time = formatClockTime(schedule.clock);
    const pauseLabel = schedule.laborPauseLabel;
    const detail = pauseLabel
      ? `${formatWeekday(schedule.clock)} · ${pauseLabel}`
      : formatWeekday(schedule.clock);
    const sabbath = pauseLabel === 'Sunday sabbath';
    const night = pauseLabel === 'Night hours';
    if (date !== this.displayedClockDate) {
      this.clockDate.textContent = date;
      this.displayedClockDate = date;
    }
    if (time !== this.displayedClockTime) {
      this.clockTime.textContent = time;
      this.displayedClockTime = time;
    }
    if (detail !== this.displayedClockDetail) {
      this.clockDetail.textContent = detail;
      this.displayedClockDetail = detail;
    }
    if (sabbath !== this.displayedSabbath) {
      this.panel.classList.toggle('is-sabbath', sabbath);
      this.displayedSabbath = sabbath;
    }
    if (night !== this.displayedNight) {
      this.panel.classList.toggle('is-night', night);
      this.displayedNight = night;
    }
  }

  setFps(fps: number): void {
    const displayFps = Math.min(90, Math.round(fps));
    if (displayFps === this.displayedFps) return;
    this.fpsValue.textContent = displayFps.toString();
    this.panel.classList.toggle('is-low', displayFps < 60);
    this.panel.classList.toggle('is-fast', displayFps >= 85);
    this.displayedFps = displayFps;
  }

  setZoomPercent(zoomPercent: number): void {
    const displayZoom = Math.max(0, Math.round(zoomPercent));
    if (displayZoom === this.displayedZoom) return;
    this.zoomValue.textContent = `${displayZoom}%`;
    this.displayedZoom = displayZoom;
  }

  private readonly onResourceRowClick = (event: MouseEvent): void => {
    this.activateResourceRow(event.target);
  };

  private readonly onFoodStoresToggle = (): void => {
    const open = this.foodStores.open;
    if (open) this.specialtyStores.open = false;
    this.foodStat.setAttribute('aria-expanded', String(open));
    this.foodStat.classList.toggle('is-open', open);
  };

  private readonly onFoodStoresPointerEnter = (): void => {
    this.foodStores.open = true;
  };

  private readonly onFoodStoresPointerLeave = (): void => {
    this.foodStores.open = false;
  };

  private readonly onFoodStoresFocusIn = (): void => {
    this.foodStores.open = true;
  };

  private readonly onFoodStoresFocusOut = (event: FocusEvent): void => {
    if (event.relatedTarget instanceof Node && this.foodStores.contains(event.relatedTarget)) return;
    this.foodStores.open = false;
  };

  private readonly onFoodStoresSummaryClick = (event: MouseEvent): void => {
    event.preventDefault();
    this.foodStores.open = true;
  };

  private readonly onSpecialtyStoresToggle = (): void => {
    if (this.specialtyStores.open) this.foodStores.open = false;
  };

  private readonly onSpecialtyStoresPointerEnter = (): void => {
    this.specialtyStores.open = true;
  };

  private readonly onSpecialtyStoresPointerLeave = (): void => {
    this.specialtyStores.open = false;
  };

  private readonly onSpecialtyStoresFocusIn = (): void => {
    this.specialtyStores.open = true;
  };

  private readonly onSpecialtyStoresFocusOut = (event: FocusEvent): void => {
    if (
      event.relatedTarget instanceof Node
      && this.specialtyStores.contains(event.relatedTarget)
    ) return;
    this.specialtyStores.open = false;
  };

  private readonly onSpecialtyStoresSummaryClick = (event: MouseEvent): void => {
    event.preventDefault();
    this.specialtyStores.open = true;
  };

  private readonly onResourceRowKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const resource = this.resourceFromTarget(event.target);
    if (!resource || resource === 'food') return;
    event.preventDefault();
    this.activateResourceRow(event.target);
  };

  private readonly onGeologyAlertClick = (event: MouseEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    if (this.geologyAttentionBuildingId !== null) {
      this.onInspectGeologyAttention?.(this.geologyAttentionBuildingId);
    }
  };

  private readonly onSecurityAlertClick = (event: MouseEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    const selection = selectProjectedRaidAttentionTarget(
      this.securityAttentionTargets,
      this.securityAttentionIndex,
    );
    if (selection === null || this.onInspectSecurityAttention === null) return;
    this.onInspectSecurityAttention(
      selection.target,
      selection.index,
      this.securityAttentionTargets.length,
    );
    this.securityAttentionIndex = selection.nextIndex;
    this.refreshSecurityAttentionControl();
  };

  private readonly onApprovalOpen = (): void => {
    this.cancelApprovalClose();
    this.setApprovalOpen(true);
  };

  private readonly onApprovalBlur = (): void => {
    if (!this.approvalPointerInside) {
      this.cancelApprovalClose();
      this.setApprovalOpen(false);
    }
  };

  private readonly onApprovalPointerEnter = (): void => {
    this.approvalPointerInside = true;
    this.cancelApprovalClose();
    this.setApprovalOpen(true);
  };

  private readonly onApprovalPointerMove = (): void => {
    this.approvalPointerInside = true;
    this.cancelApprovalClose();
  };

  private readonly onApprovalPointerLeave = (): void => {
    this.approvalPointerInside = false;
    this.cancelApprovalClose();
    this.approvalCloseTimer = window.setTimeout(() => {
      this.approvalCloseTimer = null;
      if (!this.approvalPointerInside) this.setApprovalOpen(false);
    }, 100);
  };

  private cancelApprovalClose(): void {
    if (this.approvalCloseTimer === null) return;
    window.clearTimeout(this.approvalCloseTimer);
    this.approvalCloseTimer = null;
  }

  private readonly onApprovalEscape = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return;
    if (this.foodStores.open) {
      event.preventDefault();
      this.foodStores.open = false;
      this.foodStat.focus();
      return;
    }
    if (!this.approvalPanel.hidden) {
      event.preventDefault();
      this.setApprovalOpen(false);
      this.approvalButton.focus();
    }
  };

  private setApprovalOpen(open: boolean): void {
    const nextOpen = open && !this.approvalButton.disabled;
    this.approvalPanel.hidden = !nextOpen;
    this.approvalButton.setAttribute('aria-expanded', String(nextOpen));
    this.panel.classList.toggle('has-approval-open', nextOpen);
  }

  private setSecurityAttentionTargets(
    targets: readonly ProjectedRaidTarget[],
  ): void {
    const pendingTarget = selectProjectedRaidAttentionTarget(
      this.securityAttentionTargets,
      this.securityAttentionIndex,
    )?.target ?? null;
    this.securityAttentionTargets = targets;
    this.securityAttentionIndex = pendingTarget === null
      ? 0
      : Math.max(
          0,
          targets.findIndex((target) =>
            target.kind === pendingTarget.kind && target.id === pendingTarget.id),
        );
    this.refreshSecurityAttentionControl();
  }

  private refreshSecurityAttentionControl(): void {
    const selection = selectProjectedRaidAttentionTarget(
      this.securityAttentionTargets,
      this.securityAttentionIndex,
    );
    const inspectable = selection !== null
      && this.onInspectSecurityAttention !== null;
    this.securityAlert.setAttribute('aria-disabled', String(!inspectable));
    this.securityAlert.tabIndex = inspectable ? 0 : -1;
    this.securityAlert.dataset.inspectable = inspectable ? 'true' : 'false';
    if (selection === null) {
      this.securityAlert.setAttribute(
        'aria-label',
        'Frontier watch: no specific physical holding is currently marked',
      );
      return;
    }
    const targetNumber = selection.index + 1;
    const targetCount = this.securityAttentionTargets.length;
    this.securityAlert.setAttribute(
      'aria-label',
      inspectable
        ? `Inspect threatened holding ${targetNumber} of ${targetCount}: ${selection.target.label}. Activate repeatedly to cycle marked holdings.`
        : `Threatened holding ${targetNumber} of ${targetCount}: ${selection.target.label}`,
    );
  }

  private activateResourceRow(target: EventTarget | null): void {
    const resource = this.resourceFromTarget(target);
    if (resource && resource !== 'food') this.onLocateResource?.(resource);
  }

  private resourceFromTarget(target: EventTarget | null): HudResourceKind | null {
    const element = target instanceof HTMLElement
      ? target.closest<HTMLElement>('[data-resource]')
      : null;
    if (!element || !this.panel.contains(element)) return null;
    const resource = element.dataset.resource;
    return resource && isHudResourceKind(resource) ? resource : null;
  }

  private mustElement(selector: string): HTMLElement {
    const element = this.panel.querySelector<HTMLElement>(selector);
    if (!element) throw new Error(`Missing settlement HUD element ${selector}`);
    return element;
  }

  private mustButton(selector: string): HTMLButtonElement {
    const element = this.panel.querySelector<HTMLButtonElement>(selector);
    if (!(element instanceof HTMLButtonElement)) {
      throw new Error(`Missing settlement HUD button ${selector}`);
    }
    return element;
  }

  private mustDetails(selector: string): HTMLDetailsElement {
    const element = this.panel.querySelector<HTMLDetailsElement>(selector);
    if (!(element instanceof HTMLDetailsElement)) {
      throw new Error(`Missing settlement HUD details ${selector}`);
    }
    return element;
  }

  dispose(): void {
    this.cancelApprovalClose();
    this.nobleEye.removeEventListener('click', this.onNobleEyeClick);
    this.securityAlert.removeEventListener('click', this.onSecurityAlertClick);
    this.geologyAlert.removeEventListener('click', this.onGeologyAlertClick);
    this.approvalButton.removeEventListener('click', this.onApprovalOpen);
    this.approvalButton.removeEventListener('focus', this.onApprovalOpen);
    this.approvalButton.removeEventListener('blur', this.onApprovalBlur);
    this.approvalShell.removeEventListener('pointerenter', this.onApprovalPointerEnter);
    this.approvalShell.removeEventListener('pointermove', this.onApprovalPointerMove);
    this.approvalShell.removeEventListener('pointerleave', this.onApprovalPointerLeave);
    this.foodStores.removeEventListener('toggle', this.onFoodStoresToggle);
    this.foodStores.removeEventListener('pointerenter', this.onFoodStoresPointerEnter);
    this.foodStores.removeEventListener('pointerleave', this.onFoodStoresPointerLeave);
    this.foodStores.removeEventListener('focusin', this.onFoodStoresFocusIn);
    this.foodStores.removeEventListener('focusout', this.onFoodStoresFocusOut);
    this.foodStat.removeEventListener('click', this.onFoodStoresSummaryClick);
    this.specialtyStores.removeEventListener('toggle', this.onSpecialtyStoresToggle);
    this.specialtyStores.removeEventListener(
      'pointerenter',
      this.onSpecialtyStoresPointerEnter,
    );
    this.specialtyStores.removeEventListener(
      'pointerleave',
      this.onSpecialtyStoresPointerLeave,
    );
    this.specialtyStores.removeEventListener('focusin', this.onSpecialtyStoresFocusIn);
    this.specialtyStores.removeEventListener('focusout', this.onSpecialtyStoresFocusOut);
    this.specialtyStoresSummary.removeEventListener(
      'click',
      this.onSpecialtyStoresSummaryClick,
    );
    window.removeEventListener('keydown', this.onApprovalEscape, true);
  }
}

export type ProjectedRaidAttentionSelection = {
  target: ProjectedRaidTarget;
  index: number;
  nextIndex: number;
};

export function selectProjectedRaidAttentionTarget(
  targets: readonly ProjectedRaidTarget[],
  requestedIndex: number,
): ProjectedRaidAttentionSelection | null {
  if (targets.length === 0) return null;
  const integerIndex = Number.isFinite(requestedIndex)
    ? Math.trunc(requestedIndex)
    : 0;
  const index = ((integerIndex % targets.length) + targets.length) % targets.length;
  return {
    target: targets[index],
    index,
    nextIndex: (index + 1) % targets.length,
  };
}

function formatWelfareRunway(days: number): string {
  if (!Number.isFinite(days)) return 'not needed';
  if (days < 1) return '<1d';
  if (days < 10) return `${days.toFixed(1)}d`;
  return `${Math.floor(days)}d`;
}

function geologyResourceLabel(
  resource: SettlementGeologyAlert['resource'],
): string {
  return resource[0].toUpperCase() + resource.slice(1);
}

function formatGeologyAlertRunway(days: number): string {
  if (days <= 0.05) return 'spent';
  if (days < 1) return '<1d';
  if (days < 10) return `${days.toFixed(1)}d`;
  return `${Math.floor(days)}d`;
}

function geologyAlertTooltip(alert: SettlementGeologyAlert): string {
  const resource = geologyResourceLabel(alert.resource);
  if (alert.reason === 'deep-supports') {
    const worksiteCount = alert.deepSourcesAwaitingSupports;
    const worksite = `${worksiteCount} staffed deep ${
      worksiteCount === 1 ? 'worksite is' : 'worksites are'
    } stopped awaiting timber shoring.`;
    const supportDemand = alert.deepSupportTimberPerDay > 0.05
      ? `Once supplied, the installed crews need about ${alert.deepSupportTimberPerDay.toFixed(1)} timber per day for supports.`
      : 'The installed crews need a complete timber-support batch before work can resume.';
    const finiteBuffer = alert.runwayDays === null
      ? alert.finiteReserve > 0.05
        ? `${alert.finiteReserve.toFixed(0)} finite reserve remains, but no finite seam is currently being worked.`
        : `No finite ${alert.resource} reserve is available as a fallback.`
      : alert.runwayDays <= 0.05
        ? 'The shortest staffed finite seam is already exhausted.'
        : `The shortest staffed finite seam has about ${formatGeologyAlertRunway(alert.runwayDays)} left.`;
    const supportedOutput = alert.activeDeepSources > 0
      ? `${alert.activeDeepSources} other supported deep ${
          alert.activeDeepSources === 1 ? 'source is' : 'sources are'
        } still producing ${alert.deepExtractionPerDay.toFixed(1)} ${alert.resource} per day.`
      : `No supported deep ${alert.resource} source is currently producing.`;
    return `${resource} support warning. ${worksite} ${supportDemand} ${finiteBuffer} ${supportedOutput} Activate to inspect the blocked worksite and restore its physical timber delivery before keeping labor assigned there.`;
  }
  const runwayDays = alert.runwayDays;
  const runway = alert.runwayDays <= 0.05
    ? 'The shortest staffed finite seam is exhausted.'
    : `The shortest staffed finite seam has about ${formatGeologyAlertRunway(runwayDays)} at its current crew and tool condition.`;
  const deepReplacement = alert.activeDeepSources > 0
    ? `${alert.activeDeepSources} supported deep ${
        alert.activeDeepSources === 1 ? 'source is' : 'sources are'
      } already producing ${alert.deepExtractionPerDay.toFixed(1)} ${alert.resource} per day.`
    : `No supported deep ${alert.resource} source is currently replacing it.`;
  return `${resource} geology warning. ${runway} ${alert.finiteReserve.toFixed(0)} aggregate finite reserve remains across the region. ${deepReplacement} Activate to inspect the shortest-runway worksite and reassign labor, open a deep source, or arrange trade before output stops.`;
}

function renderTextList(parent: HTMLElement, values: readonly string[]): void {
  const fragment = document.createDocumentFragment();
  for (const value of values) {
    const item = document.createElement('li');
    item.textContent = value;
    fragment.appendChild(item);
  }
  parent.replaceChildren(fragment);
}

function renderApprovalFactorList(
  parent: HTMLElement,
  factors: readonly SettlementApprovalFactor[],
  emptyMessage: string,
): void {
  const fragment = document.createDocumentFragment();
  if (factors.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'settlement-hud__approval-empty';
    empty.textContent = emptyMessage;
    fragment.appendChild(empty);
  } else {
    for (const factor of factors) {
      const item = document.createElement('li');
      item.className = `settlement-hud__approval-factor settlement-hud__approval-factor--${
        factor.impact > 0 ? 'positive' : 'negative'
      }`;

      const copy = document.createElement('span');
      copy.className = 'settlement-hud__approval-factor-copy';
      const label = document.createElement('strong');
      label.textContent = factor.label;
      const detail = document.createElement('span');
      detail.textContent = factor.detail;
      copy.append(label, detail);

      const impact = document.createElement('strong');
      impact.className = 'settlement-hud__approval-impact';
      impact.textContent = factor.impact > 0 ? `+${factor.impact}` : String(factor.impact);
      impact.setAttribute(
        'aria-label',
        `${Math.abs(factor.impact)} approval ${factor.impact > 0 ? 'gained' : 'lost'}`,
      );
      item.append(copy, impact);
      fragment.appendChild(item);
    }
  }
  parent.replaceChildren(fragment);
}
