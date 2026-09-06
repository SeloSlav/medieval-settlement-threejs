import type { SettlementSchedule } from '../world/settlementSchedule.ts';
import {
  formatCalendarDate,
  formatWeekday,
  gameClock,
} from '../world/gameCalendar.ts';
import type {
  EnvironmentState,
  NextDayEnvironmentOutlook,
} from '../world/seasonPolicy.ts';
import { describeEnvironment } from '../world/seasonPolicy.ts';
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
import type { SettlementProvisioning } from '../economy/settlementProvisioning.ts';
import type { SettlementApproval } from '../economy/settlementApproval.ts';
import type { AuthoritativeWorldGeneration } from '../world/worldConfigAuthority.ts';
import { getActiveWorldGeneration } from '../world/worldGenerationContext.ts';
import { describeWorldDifficulty } from '../world/worldDifficulty.ts';
import {
  CALENDAR_DAYS_PER_MONTH,
  CALENDAR_SECONDS_PER_DAY,
  SIM_REALTIME_RATE,
} from '../generated/gameBalance.ts';
import { seasonAlmanacTooltip } from './seasonAlmanac.ts';
import {
  applyHeraldryToElement,
  createHeraldryShield,
  getCurrentNobleProfile,
  getNoble,
} from './nobleProfile.ts';
import {
  LordReportLedger,
  type LordReport,
  type LordReportTarget,
} from './lordReports.ts';
import { HUD_RESOURCE_CARD_PRESENTATION } from './hudResourceCards.ts';
import {
  HUD_FOOD_GROUPS,
  hudFoodResourceLabel,
} from './hudFoodCards.ts';
import { HUD_PROVISION_GROUPS, hudProvisionResourceLabel } from './hudProvisionCards.ts';
import type { SettlementAnimalsView } from './settlementAnimals.ts';
import {
  EMPTY_SETTLEMENT_PEOPLE_VIEW,
  type SettlementPeopleView,
} from './settlementPeople.ts';

const STORES_POINTER_LEAVE_GRACE_MS = 180;

function gameSpeedTimingLabel(speed: GameSpeed): string {
  if (speed === 0) return 'Freezes the calendar, economy, and world simulation';
  const realSeconds = CALENDAR_SECONDS_PER_DAY / (SIM_REALTIME_RATE * speed);
  const formatted = Number.isInteger(realSeconds)
    ? realSeconds.toFixed(0)
    : realSeconds.toFixed(1);
  return `${formatted}-second day`;
}

function formatLedgerAmount(value: number): string {
  const safe = Number.isFinite(value) ? Math.max(0, value) : 0;
  return Number.isInteger(safe) ? safe.toString() : safe.toFixed(1);
}

const SETTLEMENT_HUD_HTML = `
  <div class="settlement-hud" data-settlement-hud data-fps-panel aria-label="Settlement overview" aria-live="polite">
    <aside class="noble-hud" data-noble-hud aria-label="Noble profile">
      <div class="noble-hud__portrait-shell">
        <img class="noble-hud__portrait" data-noble-hud-portrait alt="" width="560" height="560" />
        <span class="noble-hud__shield" data-noble-hud-shield></span>
      </div>
      <div class="noble-hud__identity">
        <div class="noble-hud__title-row">
          <strong class="noble-hud__name" data-noble-hud-name></strong>
        </div>
        <span
          class="noble-hud__difficulty"
          data-world-difficulty-badge
          role="note"
          tabindex="0"
        ></span>
        <div class="settlement-hud__people-card settlement-hud__resource-card noble-hud__gold-card" data-hud-card data-resource-card="gold">
          <div class="settlement-hud__stat settlement-hud__stat--gold noble-hud__gold" tabindex="0" data-resource="gold" aria-describedby="settlement-gold-card">
            <strong class="settlement-hud__value" data-stockpile="gold">0</strong>
          </div>
          <section id="settlement-gold-card" class="settlement-hud__people-panel settlement-hud__resource-panel" aria-label="Treasury ledger" aria-live="off">
            <header class="settlement-hud__people-header">
              <strong>Treasury</strong>
              <span data-resource-card-mode-label="gold">Available surplus</span>
            </header>
            <div class="settlement-hud__resource-reading">
              <strong data-resource-card-amount="gold">0</strong>
              <span data-resource-card-reading-label="gold">Spendable civic gold</span>
            </div>
            <div class="settlement-hud__resource-transit" data-resource-card-transit-row="gold" hidden>
              <span>Separate gold</span>
              <strong data-stockpile-transit="gold"></strong>
            </div>
            <p class="settlement-hud__resource-detail" data-resource-card-detail="gold">${HUD_RESOURCE_CARD_PRESENTATION.gold.surplusDetail}</p>
            <p class="settlement-hud__resource-context" data-resource-card-context="gold" hidden></p>
          </section>
        </div>
      </div>
      <button
        type="button"
        class="noble-hud__eye"
        data-noble-eye
        data-tooltip-title="First-Person View"
        data-tooltip="Choose a point in your estate to enter first-person view."
        aria-label="Enter first-person view"
        aria-pressed="false"
        disabled
      >
        <svg viewBox="0 0 28 18" aria-hidden="true">
          <path d="M1.5 9s4.4-7 12.5-7 12.5 7 12.5 7-4.4 7-12.5 7S1.5 9 1.5 9Z" />
          <circle cx="14" cy="9" r="3.3" />
          <path class="noble-hud__eye-exit-mark" d="M3 16 25 2" />
        </svg>
      </button>
    </aside>
    <div class="settlement-vitals" data-settlement-vitals aria-label="Calendar and settlement controls">
    <div
      class="settlement-vitals__zoom"
      tabindex="0"
      data-stat-row="zoom"
      data-tooltip-title="Camera zoom"
      data-tooltip="Current camera zoom. Scroll the mouse wheel over the world to zoom in and out."
      aria-label="Camera zoom: 100 percent"
      aria-live="off"
    >
      <svg class="settlement-vitals__zoom-icon" viewBox="0 0 18 18" aria-hidden="true">
        <circle cx="7.5" cy="7.5" r="4.75"></circle>
        <path d="m11 11 4 4"></path>
      </svg>
      <strong class="settlement-vitals__zoom-value" data-stat="zoom">100%</strong>
    </div>
    <div class="settlement-hud__clock" data-settlement-clock>
      <span class="settlement-hud__clock-date" data-clock-date>Year 1</span>
      <span class="settlement-hud__clock-detail" data-clock-detail></span>
      <span
        class="settlement-hud__season"
        data-season-status
        tabindex="0"
        aria-label="Season almanac"
      ></span>
      <div class="settlement-vitals__alerts" aria-label="Legacy settlement alerts" aria-hidden="true" hidden>
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
      <div
        class="settlement-hud__welfare-alert"
        data-welfare-alert
        data-tooltip-placement="above"
        hidden
      >
        <strong data-welfare-label>Household welfare</strong>
        <span data-welfare-detail>Awaiting parish reports</span>
      </div>
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
            <span class="settlement-hud__speed-value" aria-hidden="true">${
              speed === 0
                ? '&#x23F8;'
                : speed === 1
                  ? '&#x25B6;'
                  : speed === 4
                    ? '&#x25B6;&#x25B6;'
                    : '&#x25B6;&#x25B6;&#x25B6;'
            }</span>
          </button>
        `;
        }).join('')}
      </div>
    </div>
    </div>
    <div
      class="settlement-hud__ribbon-side settlement-hud__ribbon-side--civic"
      data-settlement-civic-strip
      role="group"
      aria-label="Settlement status"
    >
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
          <h2 id="settlement-approval-title">Approval</h2>
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
        <div class="settlement-hud__approval-factors" data-approval-factors aria-label="Current approval factors">
          <p>No current factors.</p>
        </div>
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
    </div>
    <div class="settlement-hud__body settlement-hud__body--civic">
      <div class="settlement-hud__people-card settlement-hud__people-card--labor" data-people-card="labor">
        <div class="settlement-hud__stat" tabindex="0" data-resource="labor" aria-label="Labor ledger awaiting settlement data">
          <span class="settlement-hud__label">Labor</span>
          <strong class="settlement-hud__value" data-stockpile="labor">0</strong>
          <span class="settlement-hud__sub" data-stockpile="labor-sub">available</span>
        </div>
        <section class="settlement-hud__people-panel" aria-label="Individual labor ledger" aria-live="off">
          <header class="settlement-hud__people-header">
            <strong>Laborers</strong>
            <span>Individual workforce</span>
          </header>
          <div class="settlement-hud__people-metrics">
            <span><strong data-people-total>0</strong>Total</span>
            <span><strong data-people-available>0</strong>Reserve</span>
            <span><strong data-people-assigned>0</strong>At work</span>
          </div>
          <dl class="settlement-hud__people-rows">
            <div data-people-icon="work"><dt>Workplaces</dt><dd data-people-workplaces>0</dd></div>
            <div data-people-icon="build"><dt>Construction</dt><dd data-people-builders>0</dd></div>
            <div data-people-icon="home"><dt>Home projects</dt><dd data-people-home-projects>0</dd></div>
            <div data-people-icon="cart"><dt>Hauling</dt><dd data-people-haulers>0</dd></div>
            <div data-people-icon="care"><dt>Sick</dt><dd data-people-sick>0</dd></div>
          </dl>
          <p class="settlement-hud__people-note">Reserve labor stays assignable to workplaces while temporarily building, hauling, or handling home projects.</p>
        </section>
      </div>
      <div class="settlement-hud__people-card settlement-hud__resource-card settlement-hud__resource-card--residents" data-hud-card data-resident-card>
        <div class="settlement-hud__stat" tabindex="0" data-resource="population" aria-describedby="settlement-residents-card">
          <span class="settlement-hud__label">Population</span>
          <strong class="settlement-hud__value" data-stockpile="population">0</strong>
        </div>
        <section id="settlement-residents-card" class="settlement-hud__people-panel settlement-hud__residents-panel" aria-label="Resident ledger" aria-live="off">
          <header class="settlement-hud__people-header">
            <strong>Residents</strong>
            <span>Individual population</span>
          </header>
          <div class="settlement-hud__people-metrics">
            <span><strong data-resident-card-total>0</strong>Total</span>
            <span><strong data-resident-card-housed>0</strong>Housed</span>
            <span><strong data-resident-card-unhoused>0</strong>Unhoused</span>
          </div>
          <dl class="settlement-hud__people-rows">
            <div data-people-icon="home"><dt>Occupied homes</dt><dd data-resident-card-occupied>0</dd></div>
            <div data-people-icon="care"><dt>Sick residents</dt><dd data-resident-card-sick>0</dd></div>
          </dl>
          <p class="settlement-hud__people-note">Population counts individual residents across every community.</p>
        </section>
      </div>
      <div class="settlement-hud__people-card settlement-hud__people-card--housing" data-people-card="housing">
        <div class="settlement-hud__stat" tabindex="0" data-resource="housing" aria-label="Living-space ledger awaiting settlement data">
          <span class="settlement-hud__label">Living space</span>
          <strong class="settlement-hud__value" data-stockpile="housing">0</strong>
        </div>
        <section class="settlement-hud__people-panel" aria-label="Living space and migration" aria-live="off">
          <header class="settlement-hud__people-header">
            <strong>Homes &amp; migration</strong>
            <span data-housing-meta>No residences</span>
          </header>
          <div class="settlement-hud__people-metrics">
            <span><strong data-housing-residents>0</strong>Residents</span>
            <span><strong data-housing-capacity>0</strong>Places</span>
            <span><strong data-housing-vacant>0</strong>Open</span>
          </div>
          <dl class="settlement-hud__people-rows">
            <div data-people-icon="home"><dt>Occupied homes</dt><dd data-housing-occupied>0 / 0</dd></div>
            <div data-people-icon="space"><dt>Homes with room</dt><dd data-housing-open-homes>0</dd></div>
            <div data-people-icon="founder"><dt>Unhoused residents</dt><dd data-housing-unhoused>0</dd></div>
          </dl>
          <p class="settlement-hud__migration-line" data-migration-label>Place the starter camp to found the settlement.</p>
        </section>
      </div>
      <details class="settlement-hud__animals" data-animals>
        <summary
          class="settlement-hud__animals-summary"
          aria-controls="settlement-animals-roster"
          aria-expanded="false"
          aria-label="Animals: no draft oxen"
        >
          <span class="settlement-hud__animals-label">Animals</span>
          <strong class="settlement-hud__animals-status" data-animals-count>0</strong>
        </summary>
        <section
          id="settlement-animals-roster"
          class="settlement-hud__animals-panel"
          aria-label="Animals ledger"
          aria-live="off"
        >
          <header class="settlement-hud__animals-header">
            <strong>Animals</strong>
            <span data-animals-meta>No animals recorded</span>
          </header>
          <section class="settlement-hud__animals-section settlement-hud__animals-section--draft">
            <header><strong>Draft oxen</strong><span data-animals-stable-capacity>0 / 0 bays</span></header>
            <div class="settlement-hud__animals-metrics" aria-label="Oxen assigned and unassigned summary">
              <span><strong data-animals-posted>0</strong> Assigned</span>
              <span><strong data-animals-automatic>0</strong> Unassigned</span>
              <span><strong data-animals-working>0</strong> Working</span>
            </div>
            <div class="settlement-hud__animals-list" data-animals-list>
              <p class="settlement-hud__animals-empty">Build a Stable and purchase an ox to begin the roster.</p>
            </div>
            <p class="settlement-hud__animals-note">
              Assigned oxen stay with one workplace. Unassigned oxen remain available for a posting and can take automatic work.
            </p>
          </section>
          <section class="settlement-hud__animals-section settlement-hud__animals-section--dogs" data-animals-dogs>
            <header><strong>Guard dogs</strong><span data-animals-dog-meta>0 / 0 bays</span></header>
            <div class="settlement-hud__animals-metrics" aria-label="Dogs assigned and unassigned summary">
              <span><strong data-animals-dog-assigned>0</strong> Assigned</span>
              <span><strong data-animals-dog-free>0</strong> Unassigned</span>
            </div>
            <div class="settlement-hud__animals-list" data-animals-dog-list>
              <p class="settlement-hud__animals-empty">Build a Kennel and purchase a dog to begin the roster.</p>
            </div>
            <p class="settlement-hud__animals-note">
              Assigned dogs work from one Hunting Camp. Unassigned dogs free-patrol and remain available for assignment.
            </p>
          </section>
          <section class="settlement-hud__animals-section" data-animals-herds>
            <header><strong>Managed herds</strong><span data-animals-herd-meta>0 head</span></header>
            <div class="settlement-hud__animal-ledger-list" data-animals-herd-list>
              <p class="settlement-hud__animals-empty">No managed cattle, sheep, or swine.</p>
            </div>
          </section>
          <section class="settlement-hud__animals-section" data-animals-backyards>
            <header><strong>Household pens</strong><span data-animals-backyard-meta>0 pens</span></header>
            <div class="settlement-hud__animal-ledger-list" data-animals-backyard-list>
              <p class="settlement-hud__animals-empty">No household animal pens.</p>
            </div>
          </section>
        </section>
      </details>
    </div>
    </div>
    <div
      class="settlement-hud__ribbon-side settlement-hud__ribbon-side--resources"
      data-settlement-resource-strip
      role="group"
      aria-label="Realm resources"
    >
      <span data-stockpile="water" hidden>0</span>
      <div class="settlement-hud__body settlement-hud__body--resources">
      <div class="settlement-hud__people-card settlement-hud__resource-card settlement-hud__resource-card--right settlement-hud__construction-card" data-hud-card data-resource-card="construction">
        <div
          class="settlement-hud__stat settlement-hud__stat--construction"
          tabindex="0"
          data-resource-group="construction"
          aria-describedby="settlement-construction-card"
          aria-label="Construction materials. Hover or focus for the material ledger."
        >
          <span class="settlement-hud__label">Construction</span>
        </div>
        <section
          id="settlement-construction-card"
          class="settlement-hud__people-panel settlement-hud__resource-panel settlement-hud__construction-panel"
          aria-label="Construction materials ledger"
          aria-live="off"
        >
          <header class="settlement-hud__people-header">
            <strong>Construction</strong>
            <span data-resource-card-mode-label="construction">Available surplus</span>
          </header>
          <section class="settlement-hud__construction-section" aria-labelledby="settlement-construction-structural-materials">
            <h3 id="settlement-construction-structural-materials">Structural materials</h3>
            <div class="settlement-hud__stat settlement-hud__construction-material settlement-hud__resource-row" data-resource="timber">
              <span class="settlement-hud__label">Timber</span>
              <strong class="settlement-hud__value" data-stockpile="timber" data-resource-card-amount="timber">0</strong>
            </div>
            <div class="settlement-hud__stat settlement-hud__construction-material settlement-hud__resource-row" data-resource="stone">
              <span class="settlement-hud__label">Stone</span>
              <strong class="settlement-hud__value" data-stockpile="stone" data-resource-card-amount="stone">0</strong>
            </div>
          </section>
          <section class="settlement-hud__construction-section" aria-labelledby="settlement-construction-finished-materials">
            <h3 id="settlement-construction-finished-materials">Finished materials</h3>
            <div class="settlement-hud__stat settlement-hud__construction-material settlement-hud__resource-row" data-resource="ironwork">
              <span class="settlement-hud__label">Ironwork</span>
              <strong class="settlement-hud__value" data-stockpile="ironwork" data-resource-card-amount="ironwork">0</strong>
            </div>
            <div class="settlement-hud__stat settlement-hud__construction-material settlement-hud__resource-row" data-resource="roofTiles">
              <span class="settlement-hud__label">Roof tiles</span>
              <strong class="settlement-hud__value" data-stockpile="roofTiles" data-resource-card-amount="roofTiles">0</strong>
            </div>
            <div class="settlement-hud__stat settlement-hud__construction-material settlement-hud__resource-row" data-resource="dressedStone">
              <span class="settlement-hud__label">Dressed stone</span>
              <strong class="settlement-hud__value" data-stockpile="dressedStone" data-resource-card-amount="dressedStone">0</strong>
            </div>
          </section>
        </section>
      </div>
      <details class="settlement-hud__food-stores settlement-hud__fuel-stores" data-fuel-stores>
        <summary class="settlement-hud__stat settlement-hud__stat--fuel" tabindex="0" data-resource="firewood">
          <span class="settlement-hud__label">Fuel</span>
          <strong class="settlement-hud__value settlement-hud__supply-value" data-fuel-runway>--</strong>
          <span data-stockpile="firewood" hidden>0</span>
        </summary>
        <div
          id="settlement-fuel-breakdown"
          class="settlement-hud__stores-grid settlement-hud__fuel-grid"
          data-fuel-breakdown
          aria-label="Household fuel stores"
        >
          <div class="settlement-hud__stores-grid-header settlement-hud__people-header settlement-hud__supply-header" role="heading" aria-level="2">
            <strong>Fuel supply</strong>
            <span data-fuel-stores-mode-label>Available surplus</span>
          </div>
          <div class="settlement-hud__supply-summary" data-supply-kind="fuel" data-fuel-supply-summary>
            <strong data-fuel-supply-months>--</strong>
          </div>
          <div class="settlement-hud__stat settlement-hud__stat--store settlement-hud__resource-row settlement-hud__supply-resource" data-resource="firewood" data-fuel-resource="firewood">
            <span class="settlement-hud__label">Firewood</span>
            <strong class="settlement-hud__value" data-fuel-firewood-amount>0</strong>
          </div>
          <div class="settlement-hud__stat settlement-hud__stat--store settlement-hud__resource-row settlement-hud__supply-resource" data-resource="charcoal" data-fuel-resource="charcoal">
            <span class="settlement-hud__label">Charcoal</span>
            <strong class="settlement-hud__value" data-stockpile="charcoal">0</strong>
          </div>
        </div>
      </details>
      <details class="settlement-hud__food-stores" data-food-stores>
        <summary class="settlement-hud__stat settlement-hud__stat--food" tabindex="0" data-resource="food">
          <span class="settlement-hud__label">Food</span>
          <strong class="settlement-hud__value settlement-hud__supply-value" data-food-runway>--</strong>
          <span data-stockpile="food" hidden>0</span>
        </summary>
        <div
          id="settlement-food-breakdown"
          class="settlement-hud__stores-grid settlement-hud__food-grid"
          data-food-breakdown
          aria-label="Food and harvest stores"
        >
          <div class="settlement-hud__stores-scroll">
            <div class="settlement-hud__stores-grid-header settlement-hud__people-header settlement-hud__supply-header" role="heading" aria-level="2">
              <strong>Food supply</strong>
              <span data-food-stores-mode-label>Available surplus</span>
            </div>
            <div class="settlement-hud__supply-summary" data-supply-kind="food" data-food-supply-summary>
              <strong data-food-supply-months>--</strong>
            </div>
            ${HUD_FOOD_GROUPS.map(({ id: category, label, kinds }) => `
              <section class="settlement-hud__stores-section" data-food-category="${category}" aria-labelledby="settlement-food-category-${category}">
                <div class="settlement-hud__stores-grid-header" role="heading" aria-level="3" id="settlement-food-category-${category}"><strong>${label}</strong></div>
                ${kinds.map((kind) => `
                  <div
                    class="settlement-hud__stat settlement-hud__stat--store settlement-hud__resource-row settlement-hud__food-card"
                    data-food-breakdown-row="${kind}"
                    data-food-resource="${kind}"
                  >
                    <span class="settlement-hud__label">${hudFoodResourceLabel(kind)}</span>
                    <strong class="settlement-hud__value" data-food-breakdown-stored="${kind}">0</strong>
                  </div>
                `).join('')}
              </section>
            `).join('')}
          </div>
        </div>
      </details>
      </div>
    <details class="settlement-hud__stores" data-specialty-stores>
      <summary
        class="settlement-hud__stores-summary"
        aria-label="Goods and provisions, no specialty stock"
      >
        <span class="settlement-hud__stores-label">Stores</span>
        <strong class="settlement-hud__stores-status" data-specialty-stores-status>0</strong>
      </summary>
      <div class="settlement-hud__stores-grid" aria-label="Goods and provisions">
        <div class="settlement-hud__stores-scroll">
          <div class="settlement-hud__stores-grid-header settlement-hud__people-header settlement-hud__supply-header" role="heading" aria-level="2">
            <strong>Goods &amp; provisions</strong>
            <span data-specialty-stores-mode-label>Available surplus</span>
          </div>
          ${HUD_PROVISION_GROUPS.map(({ id: category, label, kinds }) => `
            <section class="settlement-hud__stores-section" data-provision-category="${category}" aria-labelledby="settlement-provision-category-${category}">
              <div class="settlement-hud__stores-grid-header" role="heading" aria-level="3" id="settlement-provision-category-${category}"><strong>${label}</strong></div>
              ${kinds.map((kind) => `
                <div class="settlement-hud__stat settlement-hud__stat--store settlement-hud__resource-row" data-resource="${kind}">
                  <span class="settlement-hud__label">${hudProvisionResourceLabel(kind)}</span>
                  <strong class="settlement-hud__value" data-stockpile="${kind}">0</strong>
                </div>
              `).join('')}
            </section>
          `).join('')}
        </div>
      </div>
    </details>
    <details class="settlement-hud__stores settlement-hud__military-stores" data-military-stores>
      <summary class="settlement-hud__stores-summary" aria-label="Military stores, no equipment stocked">
        <span class="settlement-hud__stores-label">Military stores</span>
        <strong class="settlement-hud__stores-status" data-military-stores-status>0</strong>
      </summary>
      <div class="settlement-hud__stores-grid" aria-label="Military equipment stores">
        <div class="settlement-hud__stores-grid-header settlement-hud__people-header settlement-hud__supply-header" role="heading" aria-level="2">
          <strong>Military stores</strong>
          <span data-military-stores-mode-label>Available surplus</span>
        </div>
        <div class="settlement-hud__stores-grid-header" role="heading" aria-level="3"><strong>Arms</strong></div>
        <div class="settlement-hud__stat settlement-hud__stat--store settlement-hud__resource-row" data-resource="polearms"><span class="settlement-hud__label">Polearms</span><strong class="settlement-hud__value" data-stockpile="polearms">0</strong></div>
        <div class="settlement-hud__stat settlement-hud__stat--store settlement-hud__resource-row" data-resource="sidearms"><span class="settlement-hud__label">Sidearms</span><strong class="settlement-hud__value" data-stockpile="sidearms">0</strong></div>
        <div class="settlement-hud__stat settlement-hud__stat--store settlement-hud__resource-row" data-resource="bows"><span class="settlement-hud__label">Bows</span><strong class="settlement-hud__value" data-stockpile="bows">0</strong></div>
        <div class="settlement-hud__stat settlement-hud__stat--store settlement-hud__resource-row" data-resource="crossbows"><span class="settlement-hud__label">Crossbows</span><strong class="settlement-hud__value" data-stockpile="crossbows">0</strong></div>
        <div class="settlement-hud__stores-grid-header" role="heading" aria-level="3"><strong>Protection</strong></div>
        <div class="settlement-hud__stat settlement-hud__stat--store settlement-hud__resource-row" data-resource="shields"><span class="settlement-hud__label">Shields</span><strong class="settlement-hud__value" data-stockpile="shields">0</strong></div>
        <div class="settlement-hud__stat settlement-hud__stat--store settlement-hud__resource-row" data-resource="paddedArmor"><span class="settlement-hud__label">Padded armor</span><strong class="settlement-hud__value" data-stockpile="paddedArmor">0</strong></div>
        <div class="settlement-hud__stat settlement-hud__stat--store settlement-hud__resource-row" data-resource="mailArmor"><span class="settlement-hud__label">Mail armor</span><strong class="settlement-hud__value" data-stockpile="mailArmor">0</strong></div>
        <div class="settlement-hud__stores-grid-header" role="heading" aria-level="3"><strong>Ammunition</strong></div>
        <div class="settlement-hud__stat settlement-hud__stat--store settlement-hud__resource-row" data-resource="ammunition"><span class="settlement-hud__label">Ammunition</span><strong class="settlement-hud__value" data-stockpile="ammunition">0</strong></div>
      </div>
    </details>
    <button
      type="button"
      class="settlement-hud__totals-mode"
      data-resource-totals-mode
      data-mode="surplus"
      aria-label="Showing realm-wide surplus goods. Show total realm holdings."
      aria-pressed="false"
    >
      <span class="settlement-hud__totals-mode-icon" aria-hidden="true">⇄</span>
      <span class="settlement-hud__totals-mode-label" data-resource-totals-mode-label>Realm · Surplus</span>
    </button>
    </div>
  </div>
`;

export class SettlementHud {
  readonly root: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly nobleHud: HTMLElement;
  private readonly vitals: HTMLElement;
  private readonly clockDate: HTMLElement;
  private readonly clockDetail: HTMLElement;
  private readonly seasonStatus: HTMLElement;
  private readonly fireAlert: HTMLElement;
  private readonly fireCount: HTMLElement;
  private readonly fireResponse: HTMLElement;
  private readonly securityAlert: HTMLButtonElement;
  private readonly securityLabel: HTMLElement;
  private readonly securityDetail: HTMLElement;
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
  private readonly approvalFactors: HTMLElement;
  private readonly laborStat: HTMLElement;
  private readonly laborValue: HTMLElement;
  private readonly laborSub: HTMLElement;
  private readonly populationStat: HTMLElement;
  private readonly populationValue: HTMLElement;
  private readonly residentCardTotal: HTMLElement;
  private readonly residentCardHoused: HTMLElement;
  private readonly residentCardUnhoused: HTMLElement;
  private readonly residentCardOccupied: HTMLElement;
  private readonly residentCardSick: HTMLElement;
  private readonly housingStat: HTMLElement;
  private readonly housingValue: HTMLElement;
  private readonly peopleTotal: HTMLElement;
  private readonly peopleAvailable: HTMLElement;
  private readonly peopleAssigned: HTMLElement;
  private readonly peopleWorkplaces: HTMLElement;
  private readonly peopleBuilders: HTMLElement;
  private readonly peopleHomeProjects: HTMLElement;
  private readonly peopleHaulers: HTMLElement;
  private readonly peopleSick: HTMLElement;
  private readonly housingMeta: HTMLElement;
  private readonly housingResidents: HTMLElement;
  private readonly housingCapacity: HTMLElement;
  private readonly housingVacant: HTMLElement;
  private readonly housingOccupied: HTMLElement;
  private readonly housingOpenHomes: HTMLElement;
  private readonly housingUnhoused: HTMLElement;
  private readonly migrationLabel: HTMLElement;
  private readonly foodStat: HTMLElement;
  private readonly foodStores: HTMLDetailsElement;
  private readonly foodRunwayValue: HTMLElement;
  private readonly foodSupplyMonths: HTMLElement;
  private readonly fuelStat: HTMLElement;
  private readonly fuelStores: HTMLDetailsElement;
  private readonly fuelRunwayValue: HTMLElement;
  private readonly fuelSupplyMonths: HTMLElement;
  private readonly goldStat: HTMLElement;
  private readonly goldCardContext: HTMLElement;
  private readonly animals: HTMLDetailsElement;
  private readonly animalsSummary: HTMLElement;
  private readonly animalsCount: HTMLElement;
  private readonly animalsMeta: HTMLElement;
  private readonly animalsPosted: HTMLElement;
  private readonly animalsAutomatic: HTMLElement;
  private readonly animalsWorking: HTMLElement;
  private readonly animalsStableCapacity: HTMLElement;
  private readonly animalsList: HTMLElement;
  private readonly animalsDogMeta: HTMLElement;
  private readonly animalsDogAssigned: HTMLElement;
  private readonly animalsDogFree: HTMLElement;
  private readonly animalsDogList: HTMLElement;
  private readonly animalsHerdMeta: HTMLElement;
  private readonly animalsHerdList: HTMLElement;
  private readonly animalsBackyardMeta: HTMLElement;
  private readonly animalsBackyardList: HTMLElement;
  private readonly specialtyStores: HTMLDetailsElement;
  private readonly specialtyStoresSummary: HTMLElement;
  private readonly militaryStores: HTMLDetailsElement;
  private readonly militaryStoresSummary: HTMLElement;
  private readonly speedButtons: HTMLButtonElement[];
  private readonly fpsValue: HTMLElement;
  private readonly zoomValue: HTMLElement;
  private readonly nobleEye: HTMLButtonElement;
  private readonly lordReportLedger: LordReportLedger;
  private onToggleFirstPerson: (() => void) | null = null;
  private onInspectAnimalBuilding: ((buildingId: string) => void) | null = null;
  private onInspectSecurityAttention: ((
    target: ProjectedRaidTarget,
    index: number,
    count: number,
  ) => void) | null = null;
  private securityAttentionTargets: readonly ProjectedRaidTarget[] = [];
  private securityAttentionIndex = 0;
  private lastApprovalScore: number | null = null;
  private lastApprovalTrend: 'rising' | 'falling' | 'steady' = 'steady';
  private approvalTrendExpiresAt = 0;
  private approvalPointerInside = false;
  private approvalCloseTimer: number | null = null;
  private foodStoresCloseTimer: number | null = null;
  private fuelStoresCloseTimer: number | null = null;
  private animalsCloseTimer: number | null = null;
  private specialtyStoresCloseTimer: number | null = null;
  private militaryStoresCloseTimer: number | null = null;
  private displayedPeopleSignature: string | null = null;
  private displayedAnimalsSignature: string | null = null;
  private displayedClockDate: string | null = null;
  private displayedClockFullDate: string | null = null;
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
    this.nobleHud = this.mustElement('[data-noble-hud]');
    this.vitals = this.mustElement('[data-settlement-vitals]');
    const profile = getCurrentNobleProfile();
    const noble = getNoble(profile.nobleId);
    const noblePortrait = this.mustElement('[data-noble-hud-portrait]') as HTMLImageElement;
    const nobleName = this.mustElement('[data-noble-hud-name]');
    const difficultyBadge = this.mustElement('[data-world-difficulty-badge]');
    const nobleShieldMount = this.mustElement('[data-noble-hud-shield]');
    if (noble.portrait) {
      noblePortrait.src = noble.portrait;
      noblePortrait.alt = `Portrait of ${profile.displayName}`;
    } else {
      noblePortrait.removeAttribute('src');
      noblePortrait.alt = '';
    }
    nobleName.textContent = profile.displayName;
    const difficulty = describeWorldDifficulty(getActiveWorldGeneration());
    difficultyBadge.textContent = difficulty.badgeLabel;
    difficultyBadge.dataset.difficulty = difficulty.id;
    difficultyBadge.dataset.tooltipTitle = difficulty.title;
    difficultyBadge.dataset.tooltip = difficulty.summary;
    difficultyBadge.setAttribute(
      'aria-label',
      `Difficulty: ${difficulty.title}. ${difficulty.summary.replaceAll(' · ', '. ')}.`,
    );
    const nobleShield = createHeraldryShield('heraldry-shield--hud');
    applyHeraldryToElement(nobleShield, profile.heraldry);
    nobleShieldMount.appendChild(nobleShield);
    this.nobleEye = this.mustButton('[data-noble-eye]');
    this.lordReportLedger = new LordReportLedger(this.nobleHud);
    this.clockDate = this.mustElement('[data-clock-date]');
    this.clockDetail = this.mustElement('[data-clock-detail]');
    this.seasonStatus = this.mustElement('[data-season-status]');
    this.fireAlert = this.mustElement('[data-fire-alert]');
    this.fireCount = this.mustElement('[data-fire-count]');
    this.fireResponse = this.mustElement('[data-fire-response]');
    this.securityAlert = this.mustButton('[data-security-alert]');
    this.securityLabel = this.mustElement('[data-security-label]');
    this.securityDetail = this.mustElement('[data-security-detail]');
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
    this.approvalFactors = this.mustElement('[data-approval-factors]');
    this.laborStat = this.mustElement('[data-resource="labor"]');
    this.laborValue = this.mustElement('[data-stockpile="labor"]');
    this.laborSub = this.mustElement('[data-stockpile="labor-sub"]');
    this.populationStat = this.mustElement('[data-resource="population"]');
    this.populationValue = this.mustElement('[data-stockpile="population"]');
    this.residentCardTotal = this.mustElement('[data-resident-card-total]');
    this.residentCardHoused = this.mustElement('[data-resident-card-housed]');
    this.residentCardUnhoused = this.mustElement('[data-resident-card-unhoused]');
    this.residentCardOccupied = this.mustElement('[data-resident-card-occupied]');
    this.residentCardSick = this.mustElement('[data-resident-card-sick]');
    this.housingStat = this.mustElement('[data-resource="housing"]');
    this.housingValue = this.mustElement('[data-stockpile="housing"]');
    this.peopleTotal = this.mustElement('[data-people-total]');
    this.peopleAvailable = this.mustElement('[data-people-available]');
    this.peopleAssigned = this.mustElement('[data-people-assigned]');
    this.peopleWorkplaces = this.mustElement('[data-people-workplaces]');
    this.peopleBuilders = this.mustElement('[data-people-builders]');
    this.peopleHomeProjects = this.mustElement('[data-people-home-projects]');
    this.peopleHaulers = this.mustElement('[data-people-haulers]');
    this.peopleSick = this.mustElement('[data-people-sick]');
    this.housingMeta = this.mustElement('[data-housing-meta]');
    this.housingResidents = this.mustElement('[data-housing-residents]');
    this.housingCapacity = this.mustElement('[data-housing-capacity]');
    this.housingVacant = this.mustElement('[data-housing-vacant]');
    this.housingOccupied = this.mustElement('[data-housing-occupied]');
    this.housingOpenHomes = this.mustElement('[data-housing-open-homes]');
    this.housingUnhoused = this.mustElement('[data-housing-unhoused]');
    this.migrationLabel = this.mustElement('[data-migration-label]');
    this.foodStat = this.mustElement('[data-resource="food"]');
    this.foodStores = this.mustDetails('[data-food-stores]');
    this.foodRunwayValue = this.mustElement('[data-food-runway]');
    this.foodSupplyMonths = this.mustElement('[data-food-supply-months]');
    this.fuelStat = this.mustElement('[data-resource="firewood"]');
    this.fuelStores = this.mustDetails('[data-fuel-stores]');
    this.fuelRunwayValue = this.mustElement('[data-fuel-runway]');
    this.fuelSupplyMonths = this.mustElement('[data-fuel-supply-months]');
    this.goldStat = this.mustElement('[data-resource="gold"]');
    this.goldCardContext = this.mustElement('[data-resource-card-context="gold"]');
    this.animals = this.mustDetails('[data-animals]');
    this.animalsSummary = this.mustElement('[data-animals] > .settlement-hud__animals-summary');
    this.animalsCount = this.mustElement('[data-animals-count]');
    this.animalsMeta = this.mustElement('[data-animals-meta]');
    this.animalsPosted = this.mustElement('[data-animals-posted]');
    this.animalsAutomatic = this.mustElement('[data-animals-automatic]');
    this.animalsWorking = this.mustElement('[data-animals-working]');
    this.animalsStableCapacity = this.mustElement('[data-animals-stable-capacity]');
    this.animalsList = this.mustElement('[data-animals-list]');
    this.animalsDogMeta = this.mustElement('[data-animals-dog-meta]');
    this.animalsDogAssigned = this.mustElement('[data-animals-dog-assigned]');
    this.animalsDogFree = this.mustElement('[data-animals-dog-free]');
    this.animalsDogList = this.mustElement('[data-animals-dog-list]');
    this.animalsHerdMeta = this.mustElement('[data-animals-herd-meta]');
    this.animalsHerdList = this.mustElement('[data-animals-herd-list]');
    this.animalsBackyardMeta = this.mustElement('[data-animals-backyard-meta]');
    this.animalsBackyardList = this.mustElement('[data-animals-backyard-list]');
    this.specialtyStores = this.mustDetails('[data-specialty-stores]');
    this.specialtyStoresSummary = this.mustElement(
      '[data-specialty-stores] > .settlement-hud__stores-summary',
    );
    this.militaryStores = this.mustDetails('[data-military-stores]');
    this.militaryStoresSummary = this.mustElement(
      '[data-military-stores] > .settlement-hud__stores-summary',
    );
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
    for (const summaryCard of [this.laborStat, this.housingStat]) {
      delete summaryCard.dataset.tooltipTitle;
      delete summaryCard.dataset.tooltip;
    }
    this.foodStat.setAttribute('aria-controls', 'settlement-food-breakdown');
    this.foodStat.setAttribute('aria-expanded', 'false');
    this.foodStat.setAttribute(
      'aria-label',
      'Food supply: hover or focus for the resource quantities',
    );
    delete this.foodStat.dataset.tooltipTitle;
    delete this.foodStat.dataset.tooltip;
    this.fuelStat.setAttribute('aria-controls', 'settlement-fuel-breakdown');
    this.fuelStat.setAttribute('aria-expanded', 'false');
    this.fuelStat.setAttribute(
      'aria-label',
      'Fuel supply: hover or focus for the fuel quantities',
    );
    delete this.fuelStat.dataset.tooltipTitle;
    delete this.fuelStat.dataset.tooltip;
    this.panel.addEventListener('pointerover', this.onHudCardPointerOver);
    this.nobleHud.addEventListener('pointerover', this.onHudCardPointerOver);
    this.securityAlert.addEventListener('click', this.onSecurityAlertClick);
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
    this.fuelStores.addEventListener('toggle', this.onFuelStoresToggle);
    this.fuelStores.addEventListener('pointerenter', this.onFuelStoresPointerEnter);
    this.fuelStores.addEventListener('pointerleave', this.onFuelStoresPointerLeave);
    this.fuelStores.addEventListener('focusin', this.onFuelStoresFocusIn);
    this.fuelStores.addEventListener('focusout', this.onFuelStoresFocusOut);
    this.fuelStat.addEventListener('click', this.onFuelStoresSummaryClick);
    this.animals.addEventListener('toggle', this.onAnimalsToggle);
    this.animals.addEventListener('pointerenter', this.onAnimalsPointerEnter);
    this.animals.addEventListener('pointerleave', this.onAnimalsPointerLeave);
    this.animals.addEventListener('focusin', this.onAnimalsFocusIn);
    this.animals.addEventListener('focusout', this.onAnimalsFocusOut);
    this.animals.addEventListener('click', this.onAnimalsClick);
    this.specialtyStores.addEventListener('toggle', this.onSpecialtyStoresToggle);
    this.specialtyStores.addEventListener('pointerenter', this.onSpecialtyStoresPointerEnter);
    this.specialtyStores.addEventListener('pointerleave', this.onSpecialtyStoresPointerLeave);
    this.specialtyStores.addEventListener('focusin', this.onSpecialtyStoresFocusIn);
    this.specialtyStores.addEventListener('focusout', this.onSpecialtyStoresFocusOut);
    this.specialtyStoresSummary.addEventListener(
      'click',
      this.onSpecialtyStoresSummaryClick,
    );
    this.militaryStores.addEventListener('toggle', this.onMilitaryStoresToggle);
    this.militaryStores.addEventListener('pointerenter', this.onMilitaryStoresPointerEnter);
    this.militaryStores.addEventListener('pointerleave', this.onMilitaryStoresPointerLeave);
    this.militaryStores.addEventListener('focusin', this.onMilitaryStoresFocusIn);
    this.militaryStores.addEventListener('focusout', this.onMilitaryStoresFocusOut);
    this.militaryStoresSummary.addEventListener('click', this.onMilitaryStoresSummaryClick);
    this.nobleEye.addEventListener('click', this.onNobleEyeClick);
    window.addEventListener('keydown', this.onApprovalEscape, true);
    // Keep fixed HUD satellites outside the filtered, transformed top ribbon
    // so their placement remains relative to the viewport.
    const uiRoot = parent.parentElement ?? parent;
    uiRoot.append(this.nobleHud, this.vitals);
  }

  addLordReport(report: LordReport): void {
    this.lordReportLedger.add(report);
  }

  addLordReports(reports: Iterable<LordReport>): void {
    this.lordReportLedger.addAll(reports);
  }

  setLordReportTargetHandler(
    handler: ((target: LordReportTarget) => void) | null,
  ): void {
    this.lordReportLedger.setTargetHandler(handler);
  }

  setFirstPersonToggle(handler: (() => void) | null): void {
    this.onToggleFirstPerson = handler;
    this.nobleEye.disabled = handler === null;
  }

  setFirstPersonActive(active: boolean): void {
    this.root.hidden = active;
    this.nobleHud.classList.toggle('is-first-person', active);
    this.vitals.hidden = active;
    this.nobleEye.classList.toggle('is-active', active);
    this.nobleEye.setAttribute('aria-pressed', String(active));
    this.nobleEye.setAttribute(
      'aria-label',
      active ? 'Exit first-person view' : 'Enter first-person view',
    );
    this.nobleEye.dataset.tooltipTitle = active
      ? 'Exit First-Person View'
      : 'First-Person View';
    this.nobleEye.dataset.tooltip = active
      ? 'Return to the overhead estate view.'
      : 'Choose a point in your estate to enter first-person view.';
  }

  private readonly onNobleEyeClick = (): void => {
    this.onToggleFirstPerson?.();
  };

  setAnimalBuildingHandler(handler: ((buildingId: string) => void) | null): void {
    this.onInspectAnimalBuilding = handler;
  }

  setPeopleState(view: SettlementPeopleView): void {
    if (view.signature === this.displayedPeopleSignature) return;
    this.displayedPeopleSignature = view.signature;

    this.laborValue.textContent = view.available.toString();
    this.laborSub.textContent = view.assigned > 0
      ? `${view.assigned} in workplaces`
      : 'reserve';
    this.populationValue.textContent = view.total.toString();
    this.residentCardTotal.textContent = view.total.toString();
    this.residentCardHoused.textContent = view.housed.toString();
    this.residentCardUnhoused.textContent = view.unhoused.toString();
    this.residentCardOccupied.textContent = view.occupiedHomes.toString();
    this.residentCardSick.textContent = view.sick.toString();
    this.housingValue.textContent = view.vacantPlaces.toString();
    this.peopleTotal.textContent = view.total.toString();
    this.peopleAvailable.textContent = view.available.toString();
    this.peopleAssigned.textContent = view.assigned.toString();
    this.peopleWorkplaces.textContent = view.workplaceWorkers.toString();
    this.peopleBuilders.textContent = view.builders.toString();
    this.peopleHomeProjects.textContent = view.homeProjectWorkers.toString();
    this.peopleHaulers.textContent = view.haulers.toString();
    this.peopleSick.textContent = view.sick.toString();
    this.housingMeta.textContent = view.homes === 0
      ? 'No completed homes'
      : `${view.occupiedHomes} / ${view.homes} occupied`;
    this.housingResidents.textContent = view.housed.toString();
    this.housingCapacity.textContent = view.housingCapacity.toString();
    this.housingVacant.textContent = view.vacantPlaces.toString();
    this.housingOccupied.textContent = `${view.occupiedHomes} / ${view.homes}`;
    this.housingOpenHomes.textContent = view.openHomes.toString();
    this.housingUnhoused.textContent = view.unhoused.toString();
    this.migrationLabel.textContent = view.migrationLabel;

    this.laborStat.classList.toggle('is-empty', view.total === 0);
    this.populationStat.classList.toggle('is-empty', view.total === 0);
    this.housingStat.classList.toggle('is-empty', view.housingCapacity === 0);
    this.laborStat.setAttribute(
      'aria-label',
      `Labor: ${view.available} in reserve, ${view.assigned} assigned to workplaces, ${view.sick} sick.`,
    );
    this.housingStat.setAttribute(
      'aria-label',
      `Living space: ${view.vacantPlaces} open of ${view.housingCapacity}; ${view.unhoused} unhoused residents.`,
    );
    this.populationStat.setAttribute(
      'aria-label',
      `Residents: ${view.total} total, ${view.housed} housed, ${view.unhoused} unhoused, ${view.sick} sick.`,
    );
  }

  clearPeopleState(): void {
    this.displayedPeopleSignature = null;
    this.setPeopleState(EMPTY_SETTLEMENT_PEOPLE_VIEW);
  }

  setAnimalsState(view: SettlementAnimalsView): void {
    if (view.signature === this.displayedAnimalsSignature) return;
    this.displayedAnimalsSignature = view.signature;
    const knownHeads = view.ledger?.headCount ?? view.total;
    const backyardPens = view.ledger?.backyard.penCount ?? 0;
    const dogs = view.ledger?.dogs;
    const hasAnimals = knownHeads > 0 || backyardPens > 0;
    this.animalsCount.textContent = `${knownHeads}${backyardPens > 0 ? '+' : ''}`;
    this.animalsPosted.textContent = view.posted.toString();
    this.animalsAutomatic.textContent = view.automatic.toString();
    this.animalsWorking.textContent = view.working.toString();
    this.animals.classList.toggle('has-animals', hasAnimals);
    this.animalsMeta.textContent = !hasAnimals
      ? 'No animals recorded'
      : `${knownHeads} known ${knownHeads === 1 ? 'head' : 'heads'}${backyardPens > 0 ? ` · ${backyardPens} household ${backyardPens === 1 ? 'pen' : 'pens'}` : ''}`;
    const stable = view.ledger?.stable;
    this.animalsStableCapacity.textContent = stable && stable.capacity > 0
      ? `${stable.occupied} / ${stable.capacity} bays · ${stable.purchaseReadyOpenBays} ready`
      : 'No Stable bays';
    this.animalsHerdMeta.textContent = view.ledger
      ? `${view.ledger.herds.headCount} ${view.ledger.herds.headCount === 1 ? 'head' : 'heads'} · ${view.ledger.herds.holdingCount} ${view.ledger.herds.holdingCount === 1 ? 'holding' : 'holdings'}`
      : '0 head';
    this.animalsBackyardMeta.textContent = `${backyardPens} ${backyardPens === 1 ? 'pen' : 'pens'}`;
    this.animalsDogMeta.textContent = dogs && dogs.capacity > 0
      ? `${dogs.total} / ${dogs.capacity} bays · ${dogs.openBays} ready`
      : 'No Kennel bays';
    this.animalsDogAssigned.textContent = (dogs?.assigned ?? 0).toString();
    this.animalsDogFree.textContent = (dogs?.free ?? 0).toString();
    const summary = [
      `Animals: ${knownHeads} known ${knownHeads === 1 ? 'head' : 'heads'}`,
      backyardPens > 0 ? `${backyardPens} household ${backyardPens === 1 ? 'pen' : 'pens'}` : null,
      `${view.total} draft ${view.total === 1 ? 'ox' : 'oxen'}`,
      `${view.posted} assigned ${view.posted === 1 ? 'ox' : 'oxen'}`,
      `${view.automatic} unassigned ${view.automatic === 1 ? 'ox' : 'oxen'}`,
      `${dogs?.assigned ?? 0} assigned ${(dogs?.assigned ?? 0) === 1 ? 'dog' : 'dogs'}`,
      `${dogs?.free ?? 0} unassigned ${(dogs?.free ?? 0) === 1 ? 'dog' : 'dogs'}`,
    ].filter((part): part is string => part !== null).join(', ');
    this.animalsSummary.setAttribute('aria-label', summary);
    delete this.animalsSummary.dataset.tooltipTitle;
    delete this.animalsSummary.dataset.tooltip;

    this.animalsList.replaceChildren();
    if (view.entries.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'settlement-hud__animals-empty';
      empty.textContent = 'Build a Stable and purchase an ox to begin the roster.';
      this.animalsList.appendChild(empty);
    } else view.entries.forEach((entry, index) => {
      const row = document.createElement('article');
      row.className = 'settlement-hud__animal-row';
      row.dataset.assignmentMode = entry.mode;
      row.dataset.activity = entry.activity;

      const header = document.createElement('header');
      const name = document.createElement('strong');
      name.textContent = `Ox ${index + 1}`;
      const mode = document.createElement('span');
      mode.className = 'settlement-hud__animal-mode';
      mode.textContent = entry.mode === 'posted' ? 'Assigned' : 'Unassigned';
      header.append(name, mode);

      const home = document.createElement('p');
      home.className = 'settlement-hud__animal-home';
      home.append('Home · ', this.createAnimalBuildingButton(
        `${entry.stableLabel}, Bay ${entry.bay}`,
        entry.stableId,
      ));

      const posting = document.createElement('p');
      posting.className = 'settlement-hud__animal-posting';
      posting.append(entry.mode === 'posted' ? 'Posting · ' : 'Dispatch · ');
      if (entry.postingBuildingId) {
        posting.append(this.createAnimalBuildingButton(
          entry.postingLabel,
          entry.postingBuildingId,
        ));
      } else {
        posting.append(entry.postingLabel);
      }

      const activity = document.createElement('p');
      activity.className = 'settlement-hud__animal-activity';
      if (entry.activityBuildingId) {
        activity.append(this.createAnimalBuildingButton(
          entry.activityLabel,
          entry.activityBuildingId,
        ));
      } else {
        activity.textContent = entry.activityLabel;
      }
      row.append(header, home, posting, activity);
      this.animalsList.appendChild(row);
    });

    this.animalsDogList.replaceChildren();
    if (!dogs || dogs.entries.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'settlement-hud__animals-empty';
      empty.textContent = 'Build a Kennel and purchase a dog to begin the roster.';
      this.animalsDogList.appendChild(empty);
    } else dogs.entries.forEach((entry, index) => {
      const row = document.createElement('article');
      row.className = 'settlement-hud__animal-row';
      row.dataset.assignmentMode = entry.assignmentBuildingId ? 'posted' : 'automatic';
      row.dataset.activity = entry.assignmentBuildingId ? 'assisting' : 'available';

      const header = document.createElement('header');
      const name = document.createElement('strong');
      name.textContent = `Dog ${index + 1}`;
      const mode = document.createElement('span');
      mode.className = 'settlement-hud__animal-mode';
      mode.textContent = entry.assignmentBuildingId ? 'Assigned' : 'Unassigned';
      header.append(name, mode);

      const home = document.createElement('p');
      home.className = 'settlement-hud__animal-home';
      home.append('Home · ', this.createAnimalBuildingButton(
        `${entry.kennelLabel}, Bay ${entry.bay}`,
        entry.kennelId,
      ));

      const posting = document.createElement('p');
      posting.className = 'settlement-hud__animal-posting';
      posting.append(entry.assignmentBuildingId ? 'Assignment · ' : 'Assignment · Free patrol');
      if (entry.assignmentBuildingId) {
        posting.append(this.createAnimalBuildingButton(
          entry.assignmentLabel,
          entry.assignmentBuildingId,
        ));
      }

      const activity = document.createElement('p');
      activity.className = 'settlement-hud__animal-activity';
      activity.textContent = entry.activityLabel;
      row.append(header, home, posting, activity);
      this.animalsDogList.appendChild(row);
    });

    this.animalsHerdList.replaceChildren();
    const herdRows = view.ledger?.herds.species.filter((entry) =>
      entry.headCount > 0 || entry.holdingCount > 0) ?? [];
    if (herdRows.length === 0) {
      this.appendAnimalLedgerEmpty(
        this.animalsHerdList,
        'No managed cattle, sheep, swine, or horses.',
      );
    } else {
      const herdIcons = { cattle: '🐄', sheep: '🐑', swine: '🐖', horses: '🐎' } as const;
      for (const herd of herdRows) {
        const row = document.createElement('div');
        row.className = 'settlement-hud__animal-ledger-row';
        row.dataset.livestockKind = herd.species;
        row.classList.toggle('is-undersupplied', herd.presentHeadCount > herd.suppliedCapacity);
        const icon = document.createElement('span');
        icon.className = 'settlement-hud__animal-ledger-icon';
        icon.setAttribute('aria-hidden', 'true');
        icon.textContent = herdIcons[herd.species];
        const copy = document.createElement('span');
        copy.className = 'settlement-hud__animal-ledger-copy';
        const label = document.createElement('strong');
        label.textContent = herd.label;
        const detail = document.createElement('small');
        detail.textContent = `${herd.holdingCount} ${herd.holdingCount === 1 ? 'holding' : 'holdings'}${herd.species === 'horses' ? ` · ${herd.presentHeadCount} present · ${herd.headCount - herd.presentHeadCount} away` : ''} · ${formatLedgerAmount(herd.suppliedCapacity)} supplied · ${formatLedgerAmount(herd.forageCapacity)} ${herd.housingLabel === 'Pasture' ? 'forage' : 'pannage'}`;
        copy.append(label, detail);
        const amount = document.createElement('strong');
        amount.className = 'settlement-hud__animal-ledger-value';
        amount.textContent = herd.headCount.toString();
        amount.setAttribute('aria-label', `${herd.headCount} head`);
        row.append(icon, copy, amount);
        this.animalsHerdList.appendChild(row);
      }
    }

    this.animalsBackyardList.replaceChildren();
    const penRows = view.ledger?.backyard.pens.filter((entry) => entry.penCount > 0) ?? [];
    if (penRows.length === 0) {
      this.appendAnimalLedgerEmpty(
        this.animalsBackyardList,
        'No household animal pens.',
      );
    } else {
      const penIcons = {
        chickens: '🐓',
        goats: '🐐',
        pigs: '🐖',
        unstocked: '◇',
      } as const;
      for (const pen of penRows) {
        const row = document.createElement('div');
        row.className = 'settlement-hud__animal-ledger-row';
        row.dataset.livestockKind = pen.kind;
        const icon = document.createElement('span');
        icon.className = 'settlement-hud__animal-ledger-icon';
        icon.setAttribute('aria-hidden', 'true');
        icon.textContent = penIcons[pen.kind];
        const copy = document.createElement('span');
        copy.className = 'settlement-hud__animal-ledger-copy';
        const label = document.createElement('strong');
        label.textContent = pen.label;
        const detail = document.createElement('small');
        detail.textContent = 'Household pens · animal heads are not individually counted';
        copy.append(label, detail);
        const amount = document.createElement('strong');
        amount.className = 'settlement-hud__animal-ledger-value';
        amount.textContent = pen.penCount.toString();
        amount.setAttribute('aria-label', `${pen.penCount} pens`);
        row.append(icon, copy, amount);
        this.animalsBackyardList.appendChild(row);
      }
    }
  }

  clearAnimalsState(): void {
    this.setAnimalsState({
      total: 0,
      posted: 0,
      automatic: 0,
      working: 0,
      entries: [],
      signature: '__no-animals__',
    });
  }

  private createAnimalBuildingButton(label: string, buildingId: string): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'settlement-hud__animal-link';
    button.dataset.animalBuildingId = buildingId;
    button.textContent = label;
    button.setAttribute('aria-label', `${label}: inspect building`);
    return button;
  }

  private appendAnimalLedgerEmpty(container: HTMLElement, text: string): void {
    const empty = document.createElement('p');
    empty.className = 'settlement-hud__animals-empty';
    empty.textContent = text;
    container.appendChild(empty);
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

  setSimulationState(
    speed: GameSpeed,
    environment: EnvironmentState,
    _outlook?: NextDayEnvironmentOutlook,
    severeWeatherEnabled = false,
  ): void {
    const severeWeatherPossible = severeWeatherEnabled || environment.weather === 'drought';
    const description = describeEnvironment(environment, severeWeatherPossible);
    this.seasonStatus.textContent = description.title;
    this.seasonStatus.setAttribute('aria-label', `Season almanac: ${description.title}`);
    this.seasonStatus.dataset.season = environment.season;
    this.seasonStatus.dataset.tooltip = seasonAlmanacTooltip(severeWeatherPossible);
    this.seasonStatus.dataset.tooltipVariant = 'season-almanac';
    this.seasonStatus.dataset.tooltipSeason = environment.season;
    this.panel.classList.toggle('is-paused', speed === 0);
    this.vitals.classList.toggle('is-paused', speed === 0);
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
    this.vitals.classList.toggle('has-fire', burning.length > 0);
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
      `${Math.round(worst.waterDelivered)} / ${Math.round(worst.requiredWater)} water delivered`,
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
    this.vitals.classList.toggle(
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
      'District forecasts account for recruited companies and their road access to staffed towers.',
      'Command recruited companies in the field to meet an attack; buildings do not create extra defenders when the alarm sounds.',
      'Incursions strike the richest exposed holdings first; watched holdings remain vulnerable if the guard muster is insufficient.',
      formatRaidReport(security),
    ].filter(Boolean).join(' · ');
  }

  setProvisioningState(provisioning: SettlementProvisioning, _month: number): void {
    this.setWelfareState(provisioning);
    const foodHasDemand = provisioning.foodConsumers > 0;
    this.setSupplyRunway(
      this.foodStat,
      this.foodRunwayValue,
      this.foodSupplyMonths,
      provisioning.foodRunwayDays,
      foodHasDemand,
    );
    this.foodStat.setAttribute(
      'aria-label',
      `Food supply: ${formatSupplyMonthsRemaining(provisioning.foodRunwayDays, foodHasDemand)}. Hover or focus for the resource quantities.`,
    );

    const fuelHasDemand = provisioning.heatedResidents > 0;
    this.setSupplyRunway(
      this.fuelStat,
      this.fuelRunwayValue,
      this.fuelSupplyMonths,
      provisioning.currentFirewoodRunwayDays,
      fuelHasDemand,
    );
    this.fuelStat.setAttribute(
      'aria-label',
      `Fuel supply: ${formatSupplyMonthsRemaining(provisioning.currentFirewoodRunwayDays, fuelHasDemand)}. Hover or focus for the fuel quantities.`,
    );
    delete this.goldStat.dataset.tooltipTitle;
    delete this.goldStat.dataset.tooltip;
    this.goldCardContext.hidden = true;
    this.goldCardContext.textContent = '';
  }

  private setSupplyRunway(
    stat: HTMLElement,
    compactValue: HTMLElement,
    panelValue: HTMLElement,
    days: number,
    hasDemand: boolean,
  ): void {
    const label = formatSupplyMonths(days, hasDemand);
    compactValue.textContent = label;
    panelValue.textContent = formatSupplyMonthsRemaining(days, hasDemand);
    const level = supplyRunwayLevel(days, hasDemand);
    stat.dataset.supplyLevel = level;
    stat.closest<HTMLDetailsElement>('details')?.setAttribute('data-supply-level', level);
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

    this.approvalFactors.replaceChildren();
    const factors = approval.factors
      .filter((factor) => factor.impact !== 0)
      .sort((left, right) =>
        Math.abs(right.impact) - Math.abs(left.impact)
        || left.label.localeCompare(right.label))
      .slice(0, 6);
    if (factors.length === 0) {
      const empty = document.createElement('p');
      empty.textContent = 'No active modifiers.';
      this.approvalFactors.appendChild(empty);
    } else {
      for (const factor of factors) {
        const row = document.createElement('div');
        row.className = 'settlement-hud__approval-factor';
        row.dataset.impact = factor.impact > 0 ? 'positive' : 'negative';

        const icon = document.createElement('span');
        icon.className = 'settlement-hud__approval-factor-icon';
        icon.setAttribute('aria-hidden', 'true');
        icon.textContent = factor.impact > 0 ? '↑' : '↓';
        const label = document.createElement('span');
        label.textContent = factor.label;
        const impact = document.createElement('strong');
        impact.textContent = `${factor.impact > 0 ? '+' : ''}${factor.impact}`;
        row.append(icon, label, impact);
        this.approvalFactors.appendChild(row);
      }
    }

    const trendCopy = this.lastApprovalTrend === 'rising'
      ? { symbol: '↑', label: 'rising' }
      : this.lastApprovalTrend === 'falling'
        ? { symbol: '↓', label: 'falling' }
        : { symbol: '•', label: 'steady' };
    this.approvalTrend.textContent = trendCopy.symbol;
    this.approvalTrend.dataset.trend = this.lastApprovalTrend;
    this.approvalButton.setAttribute(
      'aria-label',
      `Approval ${approval.score} percent, ${approval.label}, ${trendCopy.label}.`,
    );
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
    const emptyFactor = document.createElement('p');
    emptyFactor.textContent = 'No current factors.';
    this.approvalFactors.replaceChildren(emptyFactor);
    this.approvalMeter.setAttribute('aria-valuenow', '0');
    this.approvalMeterFill.style.width = '0%';
    this.approvalButton.setAttribute('aria-label', 'Approval awaiting settlement data');
    delete this.approvalButton.dataset.tooltipTitle;
    delete this.approvalButton.dataset.tooltip;
  }

  private setWelfareState(provisioning: SettlementProvisioning): void {
    const welfare = provisioning.welfare;
    const show = welfare.level === 'watch' || welfare.level === 'critical';
    this.welfareAlert.hidden = !show;
    this.welfareAlert.dataset.level = welfare.level;
    this.panel.classList.toggle('has-welfare-warning', welfare.level === 'watch');
    this.panel.classList.toggle('has-welfare-critical', welfare.level === 'critical');
    this.vitals.classList.toggle('has-welfare-warning', welfare.level === 'watch');
    this.vitals.classList.toggle('has-welfare-critical', welfare.level === 'critical');

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
    this.welfareDetail.textContent = 'Some homes need attention';
    this.welfareAlert.dataset.tooltip = 'Inspect affected homes for unmet needs.';
  }

  clearProvisioningState(): void {
    this.welfareAlert.hidden = true;
    this.welfareAlert.dataset.level = 'none';
    this.panel.classList.remove(
      'has-welfare-warning',
      'has-welfare-critical',
    );
    this.vitals.classList.remove(
      'has-welfare-warning',
      'has-welfare-critical',
    );
    this.clearApprovalState();
  }

  setConflictEnabled(_enabled: boolean): void {}

  setSettlementClock(
    schedule: SettlementSchedule,
    presentationIsNight = schedule.dayNight.isNight,
  ): void {
    const date = formatCalendarDate(schedule.clock);
    const weekday = formatWeekday(schedule.clock);
    const fullDate = `${weekday}, ${date}`;
    const pauseLabel = schedule.laborPauseLabel;
    const detail = pauseLabel
      ? `${weekday} · ${pauseLabel}`
      : weekday;
    const sabbath = pauseLabel === 'Sunday sabbath';
    const night = presentationIsNight;
    if (date !== this.displayedClockDate) {
      this.clockDate.textContent = date;
      this.displayedClockDate = date;
    }
    if (fullDate !== this.displayedClockFullDate) {
      this.seasonStatus.dataset.tooltipTitle = fullDate;
      this.displayedClockFullDate = fullDate;
    }
    if (detail !== this.displayedClockDetail) {
      this.clockDetail.textContent = detail;
      this.displayedClockDetail = detail;
    }
    if (sabbath !== this.displayedSabbath) {
      this.panel.classList.toggle('is-sabbath', sabbath);
      this.vitals.classList.toggle('is-sabbath', sabbath);
      this.displayedSabbath = sabbath;
    }
    if (night !== this.displayedNight) {
      this.panel.classList.toggle('is-night', night);
      this.vitals.classList.toggle('is-night', night);
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
    this.zoomStat.setAttribute('aria-label', `Camera zoom: ${displayZoom} percent`);
    this.displayedZoom = displayZoom;
  }

  private readonly onHudCardPointerOver = (event: PointerEvent): void => {
    const card = event.target instanceof HTMLElement
      ? event.target.closest<HTMLElement>('[data-hud-card]')
      : null;
    if (card === null) return;
    if (event.relatedTarget instanceof Node && card.contains(event.relatedTarget)) return;

    this.closeHudDisclosureCards();
    this.cancelApprovalClose();
    this.setApprovalOpen(false);
    this.blurFocusedHudCard(card);
  };

  private readonly onFoodStoresToggle = (): void => {
    const open = this.foodStores.open;
    if (open) this.openHudDisclosure(this.foodStores);
    this.foodStat.setAttribute('aria-expanded', String(open));
    this.foodStat.classList.toggle('is-open', open);
  };

  private readonly onFoodStoresPointerEnter = (): void => {
    this.cancelFoodStoresClose();
    this.openHudDisclosure(this.foodStores);
  };

  private readonly onFoodStoresPointerLeave = (): void => {
    this.cancelFoodStoresClose();
    this.foodStoresCloseTimer = window.setTimeout(() => {
      this.foodStoresCloseTimer = null;
      this.foodStores.open = false;
    }, STORES_POINTER_LEAVE_GRACE_MS);
  };

  private readonly onFoodStoresFocusIn = (): void => {
    this.cancelFoodStoresClose();
    this.openHudDisclosure(this.foodStores);
  };

  private readonly onFoodStoresFocusOut = (event: FocusEvent): void => {
    if (event.relatedTarget instanceof Node && this.foodStores.contains(event.relatedTarget)) return;
    this.foodStores.open = false;
  };

  private readonly onFoodStoresSummaryClick = (event: MouseEvent): void => {
    event.preventDefault();
    this.openHudDisclosure(this.foodStores);
  };

  private readonly onFuelStoresToggle = (): void => {
    const open = this.fuelStores.open;
    if (open) this.openHudDisclosure(this.fuelStores);
    this.fuelStat.setAttribute('aria-expanded', String(open));
    this.fuelStat.classList.toggle('is-open', open);
  };

  private readonly onFuelStoresPointerEnter = (): void => {
    this.cancelFuelStoresClose();
    this.openHudDisclosure(this.fuelStores);
  };

  private readonly onFuelStoresPointerLeave = (): void => {
    this.cancelFuelStoresClose();
    this.fuelStoresCloseTimer = window.setTimeout(() => {
      this.fuelStoresCloseTimer = null;
      this.fuelStores.open = false;
    }, STORES_POINTER_LEAVE_GRACE_MS);
  };

  private readonly onFuelStoresFocusIn = (): void => {
    this.cancelFuelStoresClose();
    this.openHudDisclosure(this.fuelStores);
  };

  private readonly onFuelStoresFocusOut = (event: FocusEvent): void => {
    if (event.relatedTarget instanceof Node && this.fuelStores.contains(event.relatedTarget)) return;
    this.fuelStores.open = false;
  };

  private readonly onFuelStoresSummaryClick = (event: MouseEvent): void => {
    event.preventDefault();
    this.openHudDisclosure(this.fuelStores);
  };

  private readonly onAnimalsToggle = (): void => {
    const open = this.animals.open;
    if (open) this.openHudDisclosure(this.animals);
    delete this.animalsSummary.dataset.tooltipTitle;
    delete this.animalsSummary.dataset.tooltip;
    this.animalsSummary.setAttribute('aria-expanded', String(open));
  };

  private readonly onAnimalsPointerEnter = (event: PointerEvent): void => {
    // Touch and pen activation must reach the native <summary> toggle without
    // a synthetic hover opening the disclosure immediately beforehand.
    if (event.pointerType !== 'mouse') return;
    this.cancelAnimalsClose();
    this.openHudDisclosure(this.animals);
  };

  private readonly onAnimalsPointerLeave = (event: PointerEvent): void => {
    if (event.pointerType !== 'mouse') return;
    this.cancelAnimalsClose();
    this.animalsCloseTimer = window.setTimeout(() => {
      this.animalsCloseTimer = null;
      this.animals.open = false;
    }, STORES_POINTER_LEAVE_GRACE_MS);
  };

  private readonly onAnimalsFocusIn = (event: FocusEvent): void => {
    this.cancelAnimalsClose();
    // Let the focused summary retain native disclosure-button semantics.
    // Once open, focus moving into a roster link keeps the panel available.
    if (event.target !== this.animalsSummary) this.openHudDisclosure(this.animals);
  };

  private readonly onAnimalsFocusOut = (event: FocusEvent): void => {
    if (event.relatedTarget instanceof Node && this.animals.contains(event.relatedTarget)) return;
    this.animals.open = false;
  };

  private readonly onAnimalsClick = (event: MouseEvent): void => {
    const buildingId = (event.target as HTMLElement)
      .closest<HTMLElement>('[data-animal-building-id]')
      ?.dataset.animalBuildingId;
    if (!buildingId || !this.onInspectAnimalBuilding) return;
    event.preventDefault();
    event.stopPropagation();
    this.animals.open = false;
    this.onInspectAnimalBuilding(buildingId);
  };

  private readonly onSpecialtyStoresToggle = (): void => {
    if (this.specialtyStores.open) this.openHudDisclosure(this.specialtyStores);
  };

  private readonly onSpecialtyStoresPointerEnter = (): void => {
    this.cancelSpecialtyStoresClose();
    this.openHudDisclosure(this.specialtyStores);
  };

  private readonly onSpecialtyStoresPointerLeave = (): void => {
    this.cancelSpecialtyStoresClose();
    this.specialtyStoresCloseTimer = window.setTimeout(() => {
      this.specialtyStoresCloseTimer = null;
      this.specialtyStores.open = false;
    }, STORES_POINTER_LEAVE_GRACE_MS);
  };

  private readonly onSpecialtyStoresFocusIn = (): void => {
    this.cancelSpecialtyStoresClose();
    this.openHudDisclosure(this.specialtyStores);
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
    this.openHudDisclosure(this.specialtyStores);
  };

  private readonly onMilitaryStoresToggle = (): void => {
    if (this.militaryStores.open) this.openHudDisclosure(this.militaryStores);
  };

  private readonly onMilitaryStoresPointerEnter = (): void => {
    this.cancelMilitaryStoresClose();
    this.openHudDisclosure(this.militaryStores);
  };

  private readonly onMilitaryStoresPointerLeave = (): void => {
    this.cancelMilitaryStoresClose();
    this.militaryStoresCloseTimer = window.setTimeout(() => {
      this.militaryStoresCloseTimer = null;
      this.militaryStores.open = false;
    }, STORES_POINTER_LEAVE_GRACE_MS);
  };

  private readonly onMilitaryStoresFocusIn = (): void => {
    this.cancelMilitaryStoresClose();
    this.openHudDisclosure(this.militaryStores);
  };

  private readonly onMilitaryStoresFocusOut = (event: FocusEvent): void => {
    if (event.relatedTarget instanceof Node && this.militaryStores.contains(event.relatedTarget)) return;
    this.militaryStores.open = false;
  };

  private readonly onMilitaryStoresSummaryClick = (event: MouseEvent): void => {
    event.preventDefault();
    this.openHudDisclosure(this.militaryStores);
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

  private cancelFoodStoresClose(): void {
    if (this.foodStoresCloseTimer === null) return;
    window.clearTimeout(this.foodStoresCloseTimer);
    this.foodStoresCloseTimer = null;
  }

  private cancelFuelStoresClose(): void {
    if (this.fuelStoresCloseTimer === null) return;
    window.clearTimeout(this.fuelStoresCloseTimer);
    this.fuelStoresCloseTimer = null;
  }

  private cancelAnimalsClose(): void {
    if (this.animalsCloseTimer === null) return;
    window.clearTimeout(this.animalsCloseTimer);
    this.animalsCloseTimer = null;
  }

  private cancelSpecialtyStoresClose(): void {
    if (this.specialtyStoresCloseTimer === null) return;
    window.clearTimeout(this.specialtyStoresCloseTimer);
    this.specialtyStoresCloseTimer = null;
  }

  private cancelMilitaryStoresClose(): void {
    if (this.militaryStoresCloseTimer === null) return;
    window.clearTimeout(this.militaryStoresCloseTimer);
    this.militaryStoresCloseTimer = null;
  }

  private closeHudDisclosureCards(except: HTMLDetailsElement | null = null): void {
    const cards = [this.foodStores, this.fuelStores, this.animals, this.specialtyStores, this.militaryStores];
    this.cancelFoodStoresClose();
    this.cancelFuelStoresClose();
    this.cancelAnimalsClose();
    this.cancelSpecialtyStoresClose();
    this.cancelMilitaryStoresClose();
    for (const card of cards) {
      if (card !== except) card.open = false;
    }
  }

  private openHudDisclosure(card: HTMLDetailsElement): void {
    this.closeHudDisclosureCards(card);
    this.cancelApprovalClose();
    this.setApprovalOpen(false);
    this.blurFocusedHudCard(card);
    card.open = true;
  }

  private blurFocusedHudCard(except: HTMLElement): void {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || except.contains(active)) return;
    if (active.closest('[data-hud-card]') !== null) active.blur();
  }

  private readonly onApprovalEscape = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return;
    if (this.foodStores.open) {
      event.preventDefault();
      this.foodStores.open = false;
      this.foodStat.focus();
      return;
    }
    if (this.fuelStores.open) {
      event.preventDefault();
      this.fuelStores.open = false;
      this.fuelStat.focus();
      return;
    }
    if (this.animals.open) {
      event.preventDefault();
      this.animals.open = false;
      this.animalsSummary.focus();
      return;
    }
    if (this.specialtyStores.open) {
      event.preventDefault();
      this.specialtyStores.open = false;
      this.specialtyStoresSummary.focus();
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
    if (nextOpen) {
      this.closeHudDisclosureCards();
      this.blurFocusedHudCard(this.approvalShell);
    }
    this.approvalPanel.hidden = !nextOpen;
    this.approvalButton.setAttribute('aria-expanded', String(nextOpen));
    this.panel.classList.toggle('has-approval-open', nextOpen);
    this.vitals.classList.toggle('has-approval-open', nextOpen);
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
    this.cancelFoodStoresClose();
    this.cancelFuelStoresClose();
    this.cancelAnimalsClose();
    this.cancelSpecialtyStoresClose();
    this.cancelMilitaryStoresClose();
    this.panel.removeEventListener('pointerover', this.onHudCardPointerOver);
    this.nobleHud.removeEventListener('pointerover', this.onHudCardPointerOver);
    this.nobleEye.removeEventListener('click', this.onNobleEyeClick);
    this.lordReportLedger.dispose();
    this.securityAlert.removeEventListener('click', this.onSecurityAlertClick);
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
    this.fuelStores.removeEventListener('toggle', this.onFuelStoresToggle);
    this.fuelStores.removeEventListener('pointerenter', this.onFuelStoresPointerEnter);
    this.fuelStores.removeEventListener('pointerleave', this.onFuelStoresPointerLeave);
    this.fuelStores.removeEventListener('focusin', this.onFuelStoresFocusIn);
    this.fuelStores.removeEventListener('focusout', this.onFuelStoresFocusOut);
    this.fuelStat.removeEventListener('click', this.onFuelStoresSummaryClick);
    this.animals.removeEventListener('toggle', this.onAnimalsToggle);
    this.animals.removeEventListener('pointerenter', this.onAnimalsPointerEnter);
    this.animals.removeEventListener('pointerleave', this.onAnimalsPointerLeave);
    this.animals.removeEventListener('focusin', this.onAnimalsFocusIn);
    this.animals.removeEventListener('focusout', this.onAnimalsFocusOut);
    this.animals.removeEventListener('click', this.onAnimalsClick);
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
    this.militaryStores.removeEventListener('toggle', this.onMilitaryStoresToggle);
    this.militaryStores.removeEventListener('pointerenter', this.onMilitaryStoresPointerEnter);
    this.militaryStores.removeEventListener('pointerleave', this.onMilitaryStoresPointerLeave);
    this.militaryStores.removeEventListener('focusin', this.onMilitaryStoresFocusIn);
    this.militaryStores.removeEventListener('focusout', this.onMilitaryStoresFocusOut);
    this.militaryStoresSummary.removeEventListener('click', this.onMilitaryStoresSummaryClick);
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

function formatSupplyMonths(days: number, hasDemand: boolean): string {
  if (!hasDemand) return '--';
  if (!Number.isFinite(days)) return '∞ mo';
  const months = Math.max(0, days) / CALENDAR_DAYS_PER_MONTH;
  return `${Math.round(months)} mo`;
}

function formatSupplyMonthsRemaining(days: number, hasDemand: boolean): string {
  if (!hasDemand) return 'No current consumption';
  if (!Number.isFinite(days)) return 'No projected shortage';
  const months = Math.max(0, days) / CALENDAR_DAYS_PER_MONTH;
  if (months < 1) return 'Less than 1 month remaining';
  const value = Math.round(months).toString();
  return `About ${value} ${value === '1' ? 'month' : 'months'} remaining`;
}

function supplyRunwayLevel(
  days: number,
  hasDemand: boolean,
): 'none' | 'ready' | 'low' | 'critical' {
  if (!hasDemand) return 'none';
  if (days < CALENDAR_DAYS_PER_MONTH / 2) return 'critical';
  if (days < CALENDAR_DAYS_PER_MONTH) return 'low';
  return 'ready';
}
